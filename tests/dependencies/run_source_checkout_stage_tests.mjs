import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeSourceCheckoutIdentity } from "../../scripts/source-checkout-identity.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (v,m)=>{assert.ok(v,m);checks++;};
const eq = (a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const base = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-source-stage-"));
try {
  const src = path.join(base, "src"); const stage = path.join(base, "stage");
  fs.mkdirSync(path.join(src, "scripts"), {recursive:true});
  fs.mkdirSync(path.join(src, "ui/dist"), {recursive:true});
  fs.mkdirSync(path.join(src, "distribution/linux-x86_64"), {recursive:true});
  fs.mkdirSync(path.join(src, "node_modules/pkg"), {recursive:true});
  fs.writeFileSync(path.join(src, "package.json"), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(src, "scripts/run.sh"), '#!/bin/sh\necho ok\n'); fs.chmodSync(path.join(src,"scripts/run.sh"),0o755);
  fs.writeFileSync(path.join(src, "package-lock.json"), 'excluded\n');
  fs.writeFileSync(path.join(src, "ui/dist/generated"), 'excluded\n');
  fs.writeFileSync(path.join(src, "distribution/linux-x86_64/generated"), 'excluded\n');
  fs.writeFileSync(path.join(src, "node_modules/pkg/index"), 'excluded\n');
  const r = spawnSync(process.execPath,[path.join(project,"scripts/stage_source_checkout.mjs"),src,stage],{encoding:"utf8"});
  eq(r.status,0,`stage succeeds: ${r.stderr}`);
  eq(computeSourceCheckoutIdentity(stage),computeSourceCheckoutIdentity(src),"stage preserves exact source identity");
  eq(fs.statSync(path.join(stage,"scripts/run.sh")).mode & 0o777,0o755,"stage preserves executable mode");
  ok(!fs.existsSync(path.join(stage,"package-lock.json")),"root package-lock excluded from stage");
  ok(!fs.existsSync(path.join(stage,"node_modules")),"node_modules excluded from stage");
  ok(!fs.existsSync(path.join(stage,"ui/dist")),"browser dist excluded from stage");
  ok(!fs.existsSync(path.join(stage,"distribution")),"distribution excluded from stage");

  const nested = spawnSync(process.execPath,[path.join(project,"scripts/stage_source_checkout.mjs"),src,path.join(src,"nested-stage")],{encoding:"utf8"});
  eq(nested.status,77,"stage inside source checkout is rejected");
  const occupied = path.join(base,"occupied"); fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied,"keep"),"x");
  const occ = spawnSync(process.execPath,[path.join(project,"scripts/stage_source_checkout.mjs"),src,occupied],{encoding:"utf8"});
  eq(occ.status,77,"non-empty stage is rejected");
  eq(fs.readFileSync(path.join(occupied,"keep"),"utf8"),"x","non-empty stage content preserved");
} finally { fs.rmSync(base,{recursive:true,force:true}); }
console.log(`PASS source checkout stage suite: ${checks} assertions.`);
