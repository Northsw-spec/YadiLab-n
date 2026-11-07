import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++;}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
function writeState(root,label,omit=new Set()) {
  const items=[["package-lock.json",false],["node_modules/pkg.txt",false],["ui/dist/index.html",false],["distribution/linux-x86_64/app-launcher",false]];
  for (const [rel] of items) { if (omit.has(rel.split("/")[0]) || omit.has(rel)) continue; const p=path.join(root,...rel.split("/")); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,`${label}:${rel}\n`); }
}
function read(root,rel){ const p=path.join(root,...rel.split("/")); return fs.existsSync(p)?fs.readFileSync(p,"utf8"):null; }
function run(args,env={}) { return spawnSync(process.execPath,args,{cwd:project,encoding:"utf8",env:{...process.env,...env}}); }
const base=fs.mkdtempSync(path.join(os.tmpdir(),"yadilab-tx-"));
try {
  const root=path.join(base,"app"); const stage=path.join(base,"stage"); fs.mkdirSync(root); fs.mkdirSync(stage); writeState(root,"old"); writeState(stage,"new");
  let r=run(["scripts/promote_offline_browser_build.mjs",root,stage]);
  eq(r.status,0,`successful promotion: ${r.stderr}`);
  for (const rel of ["package-lock.json","node_modules/pkg.txt","ui/dist/index.html","distribution/linux-x86_64/app-launcher"]) eq(read(root,rel),`new:${rel}\n`,`${rel} promoted`);
  ok(!fs.existsSync(path.join(base,".app.offline-install-transaction")),"transaction directory removed after commit");

  fs.rmSync(root,{recursive:true,force:true}); fs.rmSync(stage,{recursive:true,force:true}); fs.mkdirSync(root); fs.mkdirSync(stage); writeState(root,"old"); writeState(stage,"new");
  r=run(["scripts/promote_offline_browser_build.mjs",root,stage],{YADILAB_PROMOTION_FAIL_AFTER:"2"});
  eq(r.status,1,"injected promotion failure fails closed");
  for (const rel of ["package-lock.json","node_modules/pkg.txt","ui/dist/index.html","distribution/linux-x86_64/app-launcher"]) eq(read(root,rel),`old:${rel}\n`,`${rel} rolled back after ordinary failure`);
  ok(!fs.existsSync(path.join(base,".app.offline-install-transaction")),"ordinary failure rollback removes journal");

  fs.rmSync(root,{recursive:true,force:true}); fs.rmSync(stage,{recursive:true,force:true}); fs.mkdirSync(root); fs.mkdirSync(stage); writeState(root,"old"); writeState(stage,"new");
  r=run(["scripts/promote_offline_browser_build.mjs",root,stage],{YADILAB_PROMOTION_CRASH_AFTER:"2"});
  eq(r.status,86,"simulated hard interruption leaves recoverable journal");
  ok(fs.existsSync(path.join(base,".app.offline-install-transaction/journal.json")),"interrupted promotion journal persists");
  r=run(["scripts/recover_offline_browser_build_transaction.mjs",root]);
  eq(r.status,0,`recovery succeeds: ${r.stderr}`);
  for (const rel of ["package-lock.json","node_modules/pkg.txt","ui/dist/index.html","distribution/linux-x86_64/app-launcher"]) eq(read(root,rel),`old:${rel}\n`,`${rel} restored after interrupted process`);
  ok(!fs.existsSync(path.join(base,".app.offline-install-transaction")),"recovery removes transaction journal");
} finally { fs.rmSync(base,{recursive:true,force:true}); }
console.log(`PASS offline build transaction suite: ${checks} assertions.`);
