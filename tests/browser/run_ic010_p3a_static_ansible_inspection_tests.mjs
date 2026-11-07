import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectSharedDocumentFileReadOnly } from "../../dist-browser-test/ui/src/browser/structured-document-inspection-file.js";
import { inspectStaticAnsibleSourceReadOnly } from "../../dist-browser-test/enterprise-import/src/structured-ansible-source-inspection.js";
import { previewAnsibleStaticInventory } from "../../dist-browser-test/enterprise-import/src/ansible-yaml-preview.js";
import { previewAnsibleIniStaticInventory } from "../../dist-browser-test/enterprise-import/src/ansible-ini-preview.js";
import { builtinEnterpriseImportAdapters, selectEnterpriseImportAdapter } from "../../dist-browser-test/enterprise-import/src/adapters.js";
import { inspectPlannedExternalSource } from "../../dist-browser-test/enterprise-import/src/planned-format-profiles.js";
import { StructuredXmlInspectionPanel, StructuredXmlInspectionDetails } from "../../ui/app/structured-xml-inspection-panel.mjs";

let checks = 0;
const eq=(actual,expected,note)=>{assert.deepEqual(actual,expected,note);checks++;};
const yes=(value,note)=>{assert.ok(value,note);checks++;};
const raw=(name)=>Uint8Array.from(fs.readFileSync("tests/fixtures/import/"+name));
const hash=(bytes)=>crypto.createHash("sha256").update(bytes).digest("hex");
const file=(name,bytes)=>({name,size:bytes.length,
  async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
const reject=async(obj,code)=>{await assert.rejects(inspectSharedDocumentFileReadOnly(obj),
  (e)=>e?.code===code,"Expected fixed "+code);checks++;};

const examples=[
  ["inventory.yaml",raw("ansible-yaml/valid-nested.yml"),"ansible.inventory.static.yaml.v1",
   "ANSIBLE_YAML_INVENTORY",4,3,4],
  ["inventory.YML",raw("ansible-yaml/valid-sensitive-vars.yml"),"ansible.inventory.static.yaml.v1",
   "ANSIBLE_YAML_INVENTORY",1,1,1],
  ["inventory.ini",raw("ansible-ini/valid-multigroup.ini"),"ansible.inventory.static.ini.v1",
   "ANSIBLE_INI_INVENTORY",2,2,3],
  ["inventory.INI",raw("ansible-ini/valid-sensitive-vars.ini"),"ansible.inventory.static.ini.v1",
   "ANSIBLE_INI_INVENTORY",1,1,1],
];
for(const [name,bytes,profile,kind,hosts,groups,locators] of examples){
  const before=hash(bytes);
  const result=await inspectSharedDocumentFileReadOnly(file(name,bytes));
  eq(result.status,"REVIEW_REQUIRED");
  eq(result.profileId,profile);
  eq(result.semanticTrack,"CONFIG_DOCUMENTED");
  eq(result.sourceSha256,before,"Original source byte hash");
  eq(result.documentLocator,{kind:"source-document",profileId:profile,sourceSha256:before});
  eq(result.summary,{kind,documentedHosts:hosts,documentedGroups:groups,originalHostLocatorCount:locators});
  eq(result.canActivate,false);
  eq(result.modelMutated,false);
  eq(result.engineVerified,false);
  eq(result.physicalTopologyVerified,false);
  yes(Object.isFrozen(result) && Object.isFrozen(result.documentLocator) &&
    Object.isFrozen(result.summary),"Immutable source metadata");
  eq(hash(bytes),before,"Source remains unchanged");
  const html=renderToStaticMarkup(React.createElement(StructuredXmlInspectionDetails,{result}));
  for(const expected of [
    'data-ic010-p2-result="REVIEW_REQUIRED"',
    'data-ic010-p2-track="CONFIG_DOCUMENTED"',
    'data-ic010-p2-counts="'+kind+'"',
    'data-ic010-p2-activation="BLOCKED"',
    "Documented hosts: "+hosts, "Groups: "+groups,
    "Source-bound host references: "+locators,before,profile,
  ]) yes(html.includes(expected),"Expected safe aggregate DOM: "+expected);
  const serialized=JSON.stringify(result)+html;
  for(const privateText of [
    "ansible_host=", "ansible_password", "ansible_user", "app01",
    "protected01", "SECRET_INI_HOST_CANARY_DONT_EXPORT",
    "SYNTHETIC_SECRET_CANARY_NOT_REAL", "SYNTHETIC_TOKEN_CANARY_NOT_REAL",
    "203.0.113.10", "203.0.113.25", "/tmp/SYNTHETIC_PRIVATE_PATH",
    "SENSITIVE_HOST_PRIVATE", "groupPath", "reportedConnectionAddress",
    "hostKey", "lineNumber", "locators",
  ]) eq(serialized.includes(privateText),false,"No original item identifier/secret leak: "+privateText);
  const originalPreview=kind==="ANSIBLE_YAML_INVENTORY"
    ? await previewAnsibleStaticInventory(bytes):await previewAnsibleIniStaticInventory(bytes);
  const expectedCount=originalPreview.hosts.reduce((n,h)=>n+h.locators.length,0);
  eq(result.summary.originalHostLocatorCount,expectedCount,"Actual producer source item locators counted");
  yes(originalPreview.hosts.every(h=>h.locators.every(l=>l.sourceSha256===before)),
    "Producer original per-item locators bind to original SHA");
  eq(JSON.stringify(await inspectSharedDocumentFileReadOnly(file(name,bytes))),
     JSON.stringify(result),"Deterministic metadata");
}
for(const [name,bytes,code] of [
  ["bad.yaml",raw("ansible-yaml/invalid-alias.yml"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.yml",raw("ansible-yaml/invalid-custom-tag.yml"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.yaml",raw("ansible-yaml/invalid-playbook.yml"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.yaml",raw("ansible-yaml/invalid-dynamic-plugin.yml"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.ini",raw("ansible-ini/invalid-ini-command.ini"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.ini",raw("ansible-ini/invalid-jinja-address.ini"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["bad.ini",raw("ansible-ini/invalid-host-address-conflict.ini"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["fake.yaml",raw("ansible-ini/valid-multigroup.ini"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
  ["fake.ini",raw("ansible-yaml/valid-nested.yml"),"IC010_STATIC_CONTENT_UNRECOGNIZED"],
]){
  const outcome=await inspectSharedDocumentFileReadOnly(file(name,bytes));
  eq(outcome.status,"BLOCKED");
  eq(outcome.code,code);
  eq(outcome.canActivate,false);
  eq(outcome.engineVerified,false);
  eq(Object.hasOwn(outcome,"sourceSha256"),false,"No partial hash from blocked source");
  eq(Object.hasOwn(outcome,"summary"),false,"No partial parsed content after rejection");
}
const valid=raw("ansible-yaml/valid-nested.yml");
const invalidLen=new Uint8Array(262145);
let reads=0;
await reject({name:"bad.yaml",size:262145,async arrayBuffer(){reads++;return new ArrayBuffer(1)}},
             "IC010_P3_SOURCE_SIZE_INVALID");
eq(reads,0,"Source >256KiB never touched");
await reject({name:"bad.ini",size:0,async arrayBuffer(){reads++;return new ArrayBuffer(1)}},
             "IC010_P3_SOURCE_SIZE_INVALID");
eq(reads,0,"Empty source never touched");
await reject({name:"bad.yaml",size:1,async arrayBuffer(){return invalidLen.buffer}},
             "IC010_P3_SOURCE_READ_INVALID");
await reject({name:"bad.ini",size:2,async arrayBuffer(){return "text-only-pretender"}},
             "IC010_P3_SOURCE_READ_INVALID");
await reject({name:"../secrets.ini",size:valid.length,async arrayBuffer(){reads++;return valid.buffer}},
             "IC010_P3_FILE_INVALID");
eq(reads,0,"Traversal rejected before I/O");
await reject({name:"unsupported.pcapng",size:valid.length,async arrayBuffer(){reads++;return valid.buffer}},
             "IC010_P3_EXTENSION_UNSUPPORTED");
eq(reads,0,"Unsupported planned format rejected before I/O");
await reject({name:"bad.yaml",size:NaN,async arrayBuffer(){reads++;return valid.buffer}},
             "IC010_P3_SOURCE_SIZE_INVALID");
eq(reads,0,"Invalid claimed size rejected before I/O");
await reject(null,"IC010_P3_FILE_INVALID");
const copied=Uint8Array.from(valid);
const originalSha=hash(copied);
const pending=inspectStaticAnsibleSourceReadOnly("inventory.yaml",copied);
copied.fill(0);
const stable=await pending;
eq(stable.status,"REVIEW_REQUIRED","Source copied synchronously before first await");
eq(stable.sourceSha256,originalSha,"Snapshot is original source");
const blockedEmpty=await inspectStaticAnsibleSourceReadOnly("inventory.yml",new Uint8Array(0));
eq(blockedEmpty.code,"IC010_STATIC_SOURCE_SIZE_INVALID");
const blockedExtension=await inspectStaticAnsibleSourceReadOnly("inventory.txt",valid);
eq(blockedExtension.code,"IC010_STATIC_EXTENSION_UNSUPPORTED");

const panel=renderToStaticMarkup(React.createElement(StructuredXmlInspectionPanel,{
  inspectFile:inspectSharedDocumentFileReadOnly,onClose(){},workspaceIdentity:{},
  getCurrentWorkspaceIdentity(){return {};}
}));
for(const needle of ['accept=".graphml,.drawio,.nessus,.xml,.yml,.yaml,.ini,.docx,.odt"',
  'data-ic010-p2-file="true"','data-ic010-p2-consent="true"',
  'data-ic010-p2-inspect="true"','data-ic010-p2-close="true"',
  "static Ansible inventories"]){
  yes(panel.includes(needle),"Shared chooser includes P3a contract "+needle);
}
const consentInput=panel.match(/<input[^>]*data-ic010-p2-consent="true"[^>]*>/)?.[0]??"";
const inspectButton=panel.match(/<button[^>]*data-ic010-p2-inspect="true"[^>]*>/)?.[0]??"";
yes(consentInput.includes("disabled"),"Consent remains unavailable before selection");
yes(inspectButton.includes("disabled"),"Inspection remains unavailable before consent");
eq(/data-network-import-activate|data-active-probe-engine|data-graphml-map-confirm/.test(panel),
   false,"No Builder/Engine controls in shared view");
eq(inspectPlannedExternalSource("hosts.yaml").status,"BLOCKED",
  "Generic planned registry must remain BLOCKED");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
  ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
  "Five enterprise adapters still registered");
eq(selectEnterpriseImportAdapter("text/csv").id,"builtin.csv","CSV modeler remains existing entry");
assert.throws(()=>selectEnterpriseImportAdapter("application/x-ansible-inventory"),
  /No import adapter supports/);checks++;
console.log("PASS IC-010 P3a Ansible YAML/INI shared source inspection: "+checks+
  " parser, privacy, hash, per-item locator integrity, spoof and consent assertions.");
