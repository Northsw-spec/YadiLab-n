import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { applyNotesAuthoring, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const source=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-source.json"),"utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const ws=createBuilderWorkspace(source); const baseline=JSON.stringify(ws.source);
for (const [payload,label] of [
  ["{}","notes must be array"],
  ["[{\"id\":\"n1\",\"text\":\"\"}]","empty note text rejected"],
  ["[{\"id\":\"n1\",\"text\":\"ok\",\"target\":\"missing\"}]","unknown note target rejected"],
  ["[{\"id\":\"rds01\",\"text\":\"collision\"}]","note id cannot collide with resource"],
  ["[{\"id\":\"n1\",\"text\":\"a\"},{\"id\":\"n1\",\"text\":\"b\"}]","duplicate note ids rejected"],
]) { const r=applyNotesAuthoring(ws,payload); ok(!r.ok,label); eq(JSON.stringify(r.workspace.source),baseline,`${label} atomically preserves source`); }
console.log(`PASS builder notes adversarial suite: ${checks} assertions.`);
