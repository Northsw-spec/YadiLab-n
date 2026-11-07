import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewAnsibleIniFileReadOnly } from "../../dist-browser-test/ui/src/browser/ansible-ini-file-preview.js";
import { AnsibleIniInventoryPanel, AnsibleIniInventoryDetails } from "../../ui/app/ansible-ini-inspection-panel.mjs";
const read = name => Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-ini/" + name));
const byteHash = b => crypto.createHash("sha256").update(b).digest("hex");
const valid = read("valid-ungrouped.ini");
const file = (name, data=valid, size=data.length) => ({
 name,size,async arrayBuffer(){return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);}
});
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const blocks=async(f,code)=>{
 await assert.rejects(previewAnsibleIniFileReadOnly(f),e=>e?.code===code,code);checks++;
};
const result=await previewAnsibleIniFileReadOnly(file("Inventory.INI"));
eq(result.filename,"Inventory.INI");
eq(result.preview.status,"REVIEW_REQUIRED");
eq(result.preview.semanticTrack,"CONFIG_DOCUMENTED");
eq(result.preview.canActivate,false);
eq(result.preview.sourceSha256,byteHash(valid));
eq(result.preview.hosts.map(h=>h.inventoryName),["jump01","app01","app02","db01"]);
eq(result.preview.hosts[0].locators[0].lineNumber,2);
eq(result.preview.hosts[2].addressTruth,"UNKNOWN");
eq(result.preview.hosts[0].directGroups,[]);
eq(result.preview.groupNames,["web","database"]);
eq(Object.hasOwn(result,"workspace"),false);
eq(Object.hasOwn(result,"scenario"),false);
for(const forbidden of ["links","connections","physicalLinks","engineState","resources"]){
 eq(Object.hasOwn(result.preview,forbidden),false,"source MUST NOT create physical topology");
}
const html=renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result}));
for(const mark of ['data-ansible-ini-preview="CONFIG_DOCUMENTED"',
 'data-ansible-ini-host="0"','data-ansible-ini-host="3"',
 'data-ansible-ini-source-hash="true"','data-ansible-ini-summary="true"',
 'data-ansible-ini-truth-boundary="true"','data-ansible-ini-activation-status="BLOCKED"',
 'jump01','db01','203.0.113.10','Original source lines: 2','Address status: UNKNOWN','ungrouped',
 'NOT verified physical assets']) {
 assert.ok(html.includes(mark),"Missing readonly element "+mark);checks++;
}
eq(renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result:null}))
 .includes('data-ansible-ini-empty="true"'),true);
const modal=renderToStaticMarkup(React.createElement(AnsibleIniInventoryPanel,{
 inspectFile:previewAnsibleIniFileReadOnly,onClose(){throw Error("onClose must be passive SSR");}
}));
for(const mark of ['role="dialog"','aria-modal="true"',
 'data-ansible-ini-panel="CONFIG_DOCUMENTED"',
 'data-ansible-ini-file="true"','accept=".ini"','data-ansible-ini-close="true"']){
 assert.ok(modal.includes(mark),"Missing panel file control "+mark);checks++;
}
eq(/data-ansible-ini-activate|data-ansible-ini-import/.test(modal),false);
// The association review appears only AFTER file inspection; null-preview dialog is empty.
const hierarchy=await previewAnsibleIniFileReadOnly(file("site.ini",read("valid-hierarchy.ini")));
const hhtml=renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result:hierarchy}));
for(const mark of ["site","child groups: routers, servers","rtr01","app01","app02"]){
 assert.ok(hhtml.includes(mark),"Lost explicit hierarchy "+mark);checks++;
}
const repeated=await previewAnsibleIniFileReadOnly(file("east.ini",read("valid-multigroup.ini")));
const rhtml=renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result:repeated}));
eq(repeated.preview.hosts.length,2);
eq(repeated.preview.hosts[0].locators.map(l=>l.lineNumber),[2,6]);
eq(rhtml.includes("Direct inventory groups: east, west"),true);
const sensitive=await previewAnsibleIniFileReadOnly(file("secret.ini",read("valid-sensitive-vars.ini")));
const sh=renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result:sensitive}));
for(const secret of ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
 "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"]){
 eq(sh.includes(secret),false,"Sensitive original source variable leaked into DOM"); 
}
eq(sh.includes("ANSIBLE_INI_VARIABLES_NOT_IMPORTED"),true);
const hostile={...result,filename:'<script>alert(1)</script>',
 preview:{...result.preview,groupNames:['<img src=x onerror=alert(2)>'],
  hosts:[{...result.preview.hosts[0],inventoryName:'<svg onload=alert(3)>'}]}
};
const x=renderToStaticMarkup(React.createElement(AnsibleIniInventoryDetails,{result:hostile}));
eq(x.includes("<script>"),false);eq(x.includes("<img src"),false);eq(x.includes("<svg onload"),false);
for(const mark of ["&lt;script&gt;","&lt;img","&lt;svg"]){eq(x.includes(mark),true);}
for(const negative of [
 ["bad.txt","ANSIBLE_INI_FILE_EXTENSION_INVALID"],
 ["a/evil.ini","ANSIBLE_INI_FILE_EXTENSION_INVALID"],
 ["..\\evil.ini","ANSIBLE_INI_FILE_EXTENSION_INVALID"],
 ["bad.ini\0.txt","ANSIBLE_INI_FILE_EXTENSION_INVALID"],
 ["missing.ini","ANSIBLE_INI_FILE_SIZE_INVALID"]
]){
 const [name,expected]=negative;
 await blocks(file(name,name==="missing.ini"?new Uint8Array():valid),expected);
}
await blocks(file("huge.ini",valid,262145),"ANSIBLE_INI_FILE_SIZE_INVALID");
await blocks({...file("invalid.ini"),arrayBuffer:async()=>new ArrayBuffer(262145)},"ANSIBLE_INI_FILE_SIZE_INVALID");
await blocks(file("invalid.ini",read("invalid-cycle.ini")),"ANSIBLE_INI_GROUP_CYCLE");
await blocks(file("invalid.ini",read("invalid-host-range.ini")),"ANSIBLE_INI_HOST_RANGE_UNSUPPORTED");
await blocks(file("invalid.ini",read("invalid-unsafe-address.ini")),"ANSIBLE_INI_ADDRESS_UNSUPPORTED");
await blocks(file("invalid.ini",read("invalid-host-address-conflict.ini")),"ANSIBLE_INI_HOST_CONFLICT");
const bridge=fs.readFileSync("ui/src/browser/ansible-ini-file-preview.ts","utf8");
const panel=fs.readFileSync("ui/app/ansible-ini-inspection-panel.mjs","utf8");
for(const [name,text] of [["bridge",bridge],["panel",panel]]){
 eq(/\bsetWorkspace\s*\(|\bdangerouslySetInnerHTML\b|\bfetch\s*\(|\bexec\s*\(|\bonActivate\b|\bonExport\b/.test(text),false,
   name+" must not have workspace, script or network activation path");
}
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const pattern of [
 /data-inspect-ansible-ini": "CONFIG_DOCUMENTED"/,
 /onInspectAnsibleIni: \(\) => setAnsibleIniOpen\(true\)/,
 /ansibleIniOpen \? e\(AnsibleIniInventoryPanel/,
 /inspectFile: previewAnsibleIniFileReadOnly/,
 /onClose: \(\) => setAnsibleIniOpen\(false\)/
]) {assert.match(main,pattern);checks++;}
console.log("PASS ANSIBLE-INI-P2 "+checks+" isolated file bridge, React SSR, source redaction, escape, negative inputs and integration checks (NOT real Chromium).");
