import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeclaredInventory, buildResolvedBundleInventory, renderThirdPartyNotices, validateLicensePolicy, writeInventoryArtifacts } from "../../scripts/third-party-notices-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,e,m)=>{assert.deepEqual(a,e,m);checks++};
const checked=validateLicensePolicy(root); ok(checked.ok,`license policy matches dependency policy: ${JSON.stringify(checked.diagnostics)}`);
const declared=buildDeclaredInventory(root); eq(declared.status,"declared-direct-baseline","baseline status explicit"); eq(declared.completeResolvedBundleInventory,false,"baseline cannot claim resolved completeness"); eq(declared.entries.length,8,"all direct dependencies inventoried");
const notice=renderThirdPartyNotices(declared); eq(fs.readFileSync(path.join(root,"THIRD_PARTY_NOTICES.md"),"utf8"),notice,"checked-in notices are generated output"); eq(JSON.parse(fs.readFileSync(path.join(root,"dependencies/third-party-inventory.json"),"utf8")),declared,"checked-in inventory is generated output");
for(const name of ["react","react-dom","ajv","elkjs","@xyflow/react","@zip.js/zip.js","typescript","esbuild"]) ok(declared.entries.some(x=>x.name===name),`${name} present in declared inventory`);
ok(notice.includes("dependency-resolved production browser build"),"baseline notice carries release gate");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"app-notices-resolved-"));
try {
  fs.mkdirSync(path.join(tmp,"dependencies"),{recursive:true});
  fs.copyFileSync(path.join(root,"dependencies/browser-runtime.policy.json"),path.join(tmp,"dependencies/browser-runtime.policy.json"));
  fs.copyFileSync(path.join(root,"dependencies/license-inventory.policy.json"),path.join(tmp,"dependencies/license-inventory.policy.json"));
  for(const pkg of [{name:"react",version:"19.3.0",license:"MIT"},{name:"dep-x",version:"1.2.3",license:"BSD-2-Clause"}]){
    const dir=path.join(tmp,"node_modules",pkg.name); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify(pkg)); fs.writeFileSync(path.join(dir,"index.js"),"export {};\n");
  }
  const meta={inputs:{[path.join(tmp,"node_modules/react/index.js")]:{},[path.join(tmp,"node_modules/dep-x/index.js")]:{}}};
  const resolved=buildResolvedBundleInventory(tmp,meta); eq(resolved.status,"bundle-resolved","resolved status explicit"); eq(resolved.completeResolvedBundleInventory,true,"resolved inventory marks completeness"); eq(resolved.bundledRuntimeComponents.length,2,"resolved inventory uses actual bundle inputs"); ok(resolved.bundledRuntimeComponents.some(x=>x.name==="dep-x"&&x.license==="BSD-2-Clause"),"transitive bundled package license captured");
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

for (const mask of [0o002, 0o077]) {
  const modeTmp=fs.mkdtempSync(path.join(os.tmpdir(),"app-notices-mode-"));
  const previous=process.umask(mask);
  try {
    writeInventoryArtifacts(modeTmp, declared);
  } finally {
    process.umask(previous);
  }
  try {
    eq(fs.statSync(path.join(modeTmp,"dependencies/third-party-inventory.json")).mode & 0o777,0o644,`inventory mode canonical under umask ${mask.toString(8)}`);
    eq(fs.statSync(path.join(modeTmp,"THIRD_PARTY_NOTICES.md")).mode & 0o777,0o644,`notices mode canonical under umask ${mask.toString(8)}`);
  } finally { fs.rmSync(modeTmp,{recursive:true,force:true}); }
}

console.log(`PASS third-party notices/inventory suite: ${checks} assertions.`);
