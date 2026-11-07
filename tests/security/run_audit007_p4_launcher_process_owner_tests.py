#!/usr/bin/env python3
"""AUDIT-007 P4: disposable real Linux process-identity vs mutable comm oracle."""
import ctypes
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "distribution" / "linux-x86_64"
assert (DIST / "app-launcher").is_file(), "Must build the release distribution first"
CHILD = r"""
import ctypes,socket
assert ctypes.CDLL(None).prctl(15,ctypes.c_char_p(b"app-launcher"),0,0,0)==0
s=socket.socket()
s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(("127.0.0.1",0));s.listen(10)
print(s.getsockname()[1],flush=True)
while True:
 c,_=s.accept()
 try:
  c.settimeout(0.8)
  c.recv(2048)
  c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad")
 except OSError: pass
 finally: c.close()
"""
assertions=0
def check(ok,why):
 global assertions
 assert ok,why
 assertions+=1

def cleanup(child):
 if child.poll() is None:
  child.terminate()
  try: child.wait(timeout=3)
  except subprocess.TimeoutExpired: child.kill();child.wait(timeout=3)
 else: child.wait(timeout=3)
 if child.stdout: child.stdout.close()

def port_free():
 with socket.socket() as s:
  s.bind(("127.0.0.1",0))
  return s.getsockname()[1]

def wait_listening(port,child,limit=8):
 end=time.monotonic()+limit
 while time.monotonic()<end:
  if child.poll() is not None: return False
  try:
   with socket.create_connection(("127.0.0.1",port),timeout=0.2): return True
  except OSError: time.sleep(.05)
 return False

def run_start(root,port):
 env=os.environ.copy()
 env.update({"YADILAB_PORT":str(port),"YADILAB_TEST_ONCE":"1","XDG_RUNTIME_DIR":str(root/"runtime")})
 return subprocess.run(["bash",str(root/"start-yadilab.sh")],env=env,
  stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=30)

def unrelated_named_process(root):
 child=subprocess.Popen([sys.executable,"-u","-c",CHILD],
  stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
 try:
  port=int(child.stdout.readline().strip())
  check(wait_listening(port,child),"disposable same-name listener not bound")
  check((Path("/proc")/str(child.pid)/"comm").read_text().strip()=="app-launcher","prctl comm not set")
  check(os.path.realpath(f"/proc/{child.pid}/exe")!=
      os.path.realpath(root/"distribution/linux-x86_64/app-launcher"),
      "unrelated control executable was actually the trusted launcher")
  found=subprocess.run(["ss","-H","-ltnp",f"sport = :{port}"],
    text=True,capture_output=True,check=True)
  check(f"pid={child.pid}," in found.stdout,"ss did not expose disposable PID")
  result=run_start(root,port)
  check(result.returncode!=0,
      "UNSAFE: launcher accepted a different executable with spoofed process name")
  check(child.poll() is None,
      "UNSAFE: launcher killed disposable unrelated same-UID app-launcher-named process")
  check("stoppas inte automatiskt" in result.stdout or
        "processidentitet" in result.stdout.lower(),
        "source did not fail closed with process identity denial: "+result.stdout[-1200:])
  check(wait_listening(port,child),
      "unrelated listener port was captured during unsafe restart")
 finally:
  cleanup(child)

def genuine_launcher_restart(root):
 exe=root/"distribution/linux-x86_64/app-launcher"
 port=port_free()
 child=subprocess.Popen([str(exe),"--port",str(port)],stdout=subprocess.DEVNULL,
   stderr=subprocess.DEVNULL)
 try:
  check(wait_listening(port,child),"authentic YadiLab launcher not listening")
  check(os.path.realpath(f"/proc/{child.pid}/exe")==os.path.realpath(exe),
        "authentic launcher identity mismatch")
  result=run_start(root,port)
  check(result.returncode==0,
        "legitimate same-executable YadiLab restart refused: "+result.stdout[-1400:])
  check("Stoppar gammal YadiLab app-launcher PID" in result.stdout,
        "valid restart was not logged as exact verified executable")
  child.wait(timeout=5)
  check(child.returncode is not None,"verified old launcher was not stopped")
 finally:
  cleanup(child)

with tempfile.TemporaryDirectory(prefix="yadilab-audit007-p4-") as temp:
 root=Path(temp)
 (root/"distribution").mkdir()
 (root/"runtime").mkdir()
 shutil.copy2(ROOT/"start-yadilab.sh",root/"start-yadilab.sh")
 shutil.copytree(DIST,root/"distribution"/"linux-x86_64",symlinks=True)
 unrelated_named_process(root)
 genuine_launcher_restart(root)
print(f"PASS AUDIT-007 P4: {assertions} real Ubuntu same-name process denial / exact built launcher restart assertions")
