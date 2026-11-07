import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewAnsibleYamlFileReadOnly } from "../../dist-browser-test/ui/src/browser/ansible-yaml-file-preview.js";
import { AnsibleInventoryPanel, AnsibleInventoryDetails } from "../../ui/app/ansible-inventory-panel.mjs";
import { AnsibleAssociationReview } from "../../ui/app/ansible-association-review.mjs";

const read = (name) => Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-yaml/" + name));
const valid = read("valid-nested.yml");
const named = (name, data = valid, size = data.length) => ({
  name, size, async arrayBuffer() { return data.buffer.slice(data.byteOffset,data.byteOffset + data.byteLength); },
});
let checks = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
const blocks = async (file, code) => {
  await assert.rejects(previewAnsibleYamlFileReadOnly(file), (e) => e?.code === code, code);
  checks++;
};
const result = await previewAnsibleYamlFileReadOnly(named("inventory.YAML"));
eq(result.filename,"inventory.YAML");
eq(result.preview.status,"REVIEW_REQUIRED");
eq(result.preview.canActivate,false);
eq(result.preview.semanticTrack,"CONFIG_DOCUMENTED");
eq(result.preview.hosts.length,4);
eq(result.preview.groupPaths.length,3);
eq(result.preview.hosts[3].addressTruth,"UNKNOWN");
eq(result.preview.sourceSha256,crypto.createHash("sha256").update(valid).digest("hex"));
eq(Object.hasOwn(result,"workspace"),false);
eq(Object.hasOwn(result,"scenario"),false);
eq(Object.hasOwn(result.preview,"Engine"),false);
const html=renderToStaticMarkup(React.createElement(AnsibleInventoryDetails,{result}));
for(const marker of [
  'data-ansible-preview="CONFIG_DOCUMENTED"',
  'data-ansible-host="0"', 'data-ansible-host="3"',
  'data-ansible-source-hash="true"', 'data-ansible-truth-boundary="true"',
  'data-ansible-groups="true"', 'data-ansible-hosts="true"',
  'data-ansible-activation-status="BLOCKED"',
  'rtr01','app02','192.0.2.10','Address status: UNKNOWN',
  'all/routers', 'NOT verified physical assets',
]) { assert.ok(html.includes(marker),"Missing required read-only UI element "+marker); checks++; }
eq(renderToStaticMarkup(React.createElement(AnsibleInventoryDetails,{result:null}))
  .includes('data-ansible-empty="true"'),true);
const dialog=renderToStaticMarkup(React.createElement(AnsibleInventoryPanel,{
  inspectFile:previewAnsibleYamlFileReadOnly,onClose() {},
}));
for(const marker of ['role="dialog"','aria-modal="true"','data-ansible-panel="CONFIG_DOCUMENTED"',
  'data-ansible-file="true"','accept=".yml,.yaml"','data-ansible-close="true"']) {
  assert.ok(dialog.includes(marker),"No dialog marker "+marker); checks++;
}
eq(/data-ansible-activate|data-ansible-import|data-network-import-activate/.test(dialog),false,
  "No scenario activation route");
const secrets = await previewAnsibleYamlFileReadOnly(named("secrets.yaml",read("valid-sensitive-vars.yml")));
const secretHtml = renderToStaticMarkup(React.createElement(AnsibleInventoryDetails,{result:secrets}));
for(const canary of ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
  "SYNTHETIC_TOKEN_CANARY_NOT_REAL","synthetic_admin"]) {
  eq(secretHtml.includes(canary),false,"Secret leaked into DOM: "+canary);
}
const malicious = {...result, preview:{...result.preview,
  hosts:[{...result.preview.hosts[0],inventoryName:'<img src=x onerror=alert(1)>'}],
  groupPaths:['<script>alert(2)</script>'],
}};
const escaped=renderToStaticMarkup(React.createElement(AnsibleInventoryDetails,{result:malicious}));
eq(escaped.includes("<img src"),false,"Never inject DOM image");
eq(escaped.includes("<script>alert(2)</script>"),false,"Never inject executable script");
eq(escaped.includes("&lt;img"),true,"Host id escaped by React");
eq(escaped.includes("&lt;script&gt;"),true,"Group path escaped by React");
const modeled={scenarioId:"site_existing",sourceRevision:4,
 resources:[{id:"rds01",label:"RDS server"},{id:"fw01",label:"Firewall"}]};
const assocHtml=renderToStaticMarkup(React.createElement(AnsibleAssociationReview,{
 result,model:modeled,onExport:async()=>{},
}));
for(const token of ['data-ansible-association-review="REVIEW_REQUIRED"',
 'data-ansible-associate-host="0"','data-ansible-associate-host="3"',
 'data-ansible-association-ack="true"','data-ansible-association-export="true"',
 'Do not associate (default)','unverified inventory-to-model','rds01']) {
 assert.ok(assocHtml.includes(token),"Missing P3 review control: "+token);checks++;
}
eq(assocHtml.includes('disabled=""'),true,"No default selection or ack disables export");
const runtime=renderToStaticMarkup(React.createElement(AnsibleAssociationReview,{
 result,model:null,onExport:async()=>{},
}));
eq(runtime.includes('data-ansible-association-review="BUILDER_REQUIRED"'),true);
eq(runtime.includes('data-ansible-associate-host="0"'),false,"Runtime has no selectable resources");
const hostileTarget=renderToStaticMarkup(React.createElement(AnsibleAssociationReview,{
 result,model:{...modeled,resources:[{id:"rds01",label:'<svg onload=alert(1)>'}]},
 onExport:async()=>{},
}));
eq(hostileTarget.includes('<svg onload='),false,"No attacker target HTML element");
eq(hostileTarget.includes('&lt;svg'),true,"React escapes target labels");
const assocCode=fs.readFileSync("ui/app/ansible-association-review.mjs","utf8");
eq(/\bsetWorkspace\s*\(|dangerouslySetInnerHTML|\bonActivate\s*[:=]/.test(assocCode),
 false,"No workspace mutation nor injected HTML in review");
const source=fs.readFileSync("ui/app/main.mjs","utf8");
for(const re of [/reviewAnsibleYamlOriginalFileAssociations\(/,
 /downloadJson\(\{[\s\S]*?filename: `ansible-inventory-associations-/,
 /onExportAssociation: async \(originalFile,inventoryPreview,decision,isCurrent\)/,
 /sourceRevision: workspace\.sourceRevision/]) {
 assert.match(source,re);checks++;
}
const panelCode = fs.readFileSync("ui/app/ansible-inventory-panel.mjs","utf8");
const executable=panelCode.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,"");
const forbidden=/\bsetWorkspace\s*\(|dangerouslySetInnerHTML|\bonActivate\s*[:=]|\bonConfirm\s*[:=]/;
eq(forbidden.test(executable),false,"Cannot mutate YadiLab workspace");
eq(forbidden.test(executable+"\nsetWorkspace(null)"),true,"Mutation negative control");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const re of [/data-inspect-ansible": "CONFIG_DOCUMENTED"/,
  /onInspectAnsible: \(\) => setAnsibleInventoryOpen\(true\)/,
  /ansibleInventoryOpen \? e\(AnsibleInventoryPanel/,
  /inspectFile: previewAnsibleYamlFileReadOnly/,
  /onClose: \(\) => setAnsibleInventoryOpen\(false\)/]) {
  assert.match(main,re);checks++;
}
await blocks(named("unknown.xml"),"ANSIBLE_YAML_FILE_EXTENSION_INVALID");
await blocks(named("invalid/evil.yaml"),"ANSIBLE_YAML_FILE_EXTENSION_INVALID");
await blocks(named("none.yaml",new Uint8Array()),"ANSIBLE_YAML_FILE_SIZE_INVALID");
await blocks(named("oversize.yaml",valid,256*1024+1),"ANSIBLE_YAML_FILE_SIZE_INVALID");
await blocks(named("plugin.yml",read("invalid-dynamic-plugin.yml")),"ANSIBLE_YAML_ROOT_INVALID");
await blocks(named("alias.yaml",read("invalid-alias.yml")),"ANSIBLE_YAML_ALIAS_FORBIDDEN");
await blocks(named("invalid.yml",read("invalid-duplicate-key.yml")),"ANSIBLE_YAML_PARSE_INVALID");
console.log(`PASS ANSIBLE-YAML-P2: ${checks} strict browser boundary, SSR/redaction, negative tests and static no-Engine wiring (not real browser acceptance).`);
