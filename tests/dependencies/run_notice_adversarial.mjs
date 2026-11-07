import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildResolvedBundleInventory, validateLicensePolicy } from "../../scripts/third-party-notices-lib.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."); let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++};
function fixture(mutator){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"app-notices-adv-"));fs.mkdirSync(path.join(tmp,"dependencies"),{recursive:true});const dep=JSON.parse(fs.readFileSync(path.join(root,"dependencies/browser-runtime.policy.json"),"utf8"));const lic=JSON.parse(fs.readFileSync(path.join(root,"dependencies/license-inventory.policy.json"),"utf8"));mutator?.(dep,lic,tmp);fs.writeFileSync(path.join(tmp,"dependencies/browser-runtime.policy.json"),JSON.stringify(dep));fs.writeFileSync(path.join(tmp,"dependencies/license-inventory.policy.json"),JSON.stringify(lic));return tmp;}
let t=fixture((d,l)=>{l.entries.find(x=>x.name==="react").version="19.2.0"}); try{const r=validateLicensePolicy(t);ok(!r.ok,"license version drift rejected");ok(r.diagnostics.some(x=>x.code==="LICENSE_POLICY_VERSION_MISMATCH"),"version drift diagnostic named");}finally{fs.rmSync(t,{recursive:true,force:true})}
t=fixture((d,l)=>{l.entries.find(x=>x.name==="ajv").license=""}); try{const r=validateLicensePolicy(t);ok(!r.ok,"missing license rejected");ok(r.diagnostics.some(x=>x.code==="LICENSE_POLICY_LICENSE_MISSING"),"missing license diagnostic named");}finally{fs.rmSync(t,{recursive:true,force:true})}
t=fixture((d,l)=>{l.entries.push({...l.entries[0]})}); try{const r=validateLicensePolicy(t);ok(!r.ok,"duplicate entry rejected");ok(r.diagnostics.some(x=>x.code==="LICENSE_POLICY_DUPLICATE"),"duplicate diagnostic named");}finally{fs.rmSync(t,{recursive:true,force:true})}
t=fixture(()=>{}); try{const dir=path.join(t,"node_modules/react");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"react",version:"19.3.0"}));fs.writeFileSync(path.join(dir,"index.js"),"export {};\n");assert.throws(()=>buildResolvedBundleInventory(t,{inputs:{[path.join(dir,"index.js")]:{}}}),/no machine-readable license/);checks++;}finally{fs.rmSync(t,{recursive:true,force:true})}
t=fixture(()=>{}); try{assert.throws(()=>buildResolvedBundleInventory(t,{inputs:{}}),/inventory is empty/);checks++;}finally{fs.rmSync(t,{recursive:true,force:true})}
console.log(`PASS third-party notices/inventory adversarial suite: ${checks} assertions.`);
