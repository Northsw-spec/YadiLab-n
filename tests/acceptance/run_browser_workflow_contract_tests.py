#!/usr/bin/env python3
"""Dependency-free negative contract checks; NOT a real-browser PASS claim."""
import http.server
from pathlib import Path
import subprocess
import sys
import threading

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/'tests/acceptance/run_live_browser_workflow.py'
checks=0

def expect(expr,why):
    global checks
    assert expr,why
    checks+=1

p=subprocess.run([sys.executable,str(SCRIPT),'--selftest'],capture_output=True,text=True,timeout=10)
expect(p.returncode==0,'independent archive selftests pass')
expect('5 fixture scenarios' in p.stdout,'fixture scenarios are exercised')

p=subprocess.run([sys.executable,str(SCRIPT),'--url','https://example.org/', '--chromium','/nonexistent'],capture_output=True,text=True,timeout=10)
expect(p.returncode==1,'remote/non-loopback URL must not be accepted')
expect('loopback' in p.stderr.lower(),'rejected URL has explicit diagnostic')
for hostile in ('http://127.0.0.1:18951@evil.invalid/', 'http://127.0.0.1:80/', 'http://127.0.0.1:18951/../'):
    q=subprocess.run([sys.executable,str(SCRIPT),'--url',hostile,'--chromium','/nonexistent'],capture_output=True,text=True,timeout=10)
    expect(q.returncode==1,f'reject hostile/noncanonical URL {hostile}')

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        b=b'{"status":"shell-only"}'
        self.send_response(200);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def log_message(self,*a):pass

server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    url=f'http://127.0.0.1:{server.server_port}/'
    p=subprocess.run([sys.executable,str(SCRIPT),'--url',url,'--chromium','/nonexistent'],capture_output=True,text=True,timeout=10)
    expect(p.returncode==77,'shell-only release must be BLOCKED before Chromium launch')
    expect('dependency-resolved' in p.stderr,'shell-only refusal explains true external limitation')
finally:server.shutdown()

p=subprocess.run([sys.executable,str(SCRIPT),'--url','http://127.0.0.1:18953/','--chromium','/nonexistent'],capture_output=True,text=True,timeout=10)
expect(p.returncode==77,'no live loopback distribution means BLOCKED')

source=SCRIPT.read_text()
for contract in ['Kompilera + layout','Exportera elevpaket','verify_downloaded_student_package','Verkställ via Engine',
                 'Autospara nu','Återställ autosparning','Exportera framsteg','Återställ scenario','Ångra','Gör om',
                 'Skapa checkpoint','Återställ senaste checkpoint','Tillbaka till byggläget','source-import-acceptance.json',
                 'tamper_student_zip','get_by_role','set_input_files','verify_offline_reload','--offline-launcher',
                 'serviceWorker.controller','process.terminate','offline-reload-evidence.json']:
    expect(contract in source,f'actual workflow must include {contract}')

print(f'PASS browser workflow fail-closed contract: {checks} assertions (real browser still gated).')
