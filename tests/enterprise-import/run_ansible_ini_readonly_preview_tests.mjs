import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {previewAnsibleIniStaticInventory,ANSIBLE_INI_PREVIEW_PROFILE} from "../../dist-enterprise-import-test/enterprise-import/src/ansible-ini-preview.js";
import {EnterpriseImportError} from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import {selectEnterpriseImportAdapter} from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";
const dir="tests/fixtures/import/ansible-ini/";
const oracle=JSON.parse(fs.readFileSync(dir+"oracles.json","utf8"));
const read=n=>Uint8Array.from(fs.readFileSync(dir+n));
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const utf8=s=>new TextEncoder().encode(s);
let checks=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++;}
async function blocked(bytes,code){await assert.rejects(previewAnsibleIniStaticInventory(bytes),e=>e instanceof EnterpriseImportError&&e.code===code,"expected "+code);checks++;}
eq(oracle.profileId,ANSIBLE_INI_PREVIEW_PROFILE);
for(const item of oracle.positives){
  const source=read(item.file),originalSha=hash(source);
  const got=await previewAnsibleIniStaticInventory(source);
  eq(got.status,"REVIEW_REQUIRED");eq(got.canActivate,false);
  eq(got.profileId,ANSIBLE_INI_PREVIEW_PROFILE);eq(got.semanticTrack,"CONFIG_DOCUMENTED");
  eq(got.sourceSha256,originalSha);eq(hash(source),originalSha,"source unmodified");
  eq(got.hosts.map(h=>h.inventoryName),item.hosts,"host list");
  eq(Object.fromEntries(got.hosts.filter(h=>h.reportedConnectionAddress).map(h=>[h.inventoryName,h.reportedConnectionAddress])),item.addresses,"only declared addresses");
  eq(got.hosts.filter(h=>h.addressTruth==="UNKNOWN").map(h=>h.inventoryName),item.unknown);
  eq(Object.fromEntries(got.hosts.map(h=>[h.inventoryName,h.directGroups])),item.directGroups,"direct Ansible group membership");
  for(const [g,c] of Object.entries(item.groupChildren??{})) eq(got.groupChildren[g],c,"declared children");
  for(const h of got.hosts)for(const loc of h.locators){
    eq(loc.sourceSha256,originalSha);eq(loc.kind,"ansible-ini-host");eq(loc.hostKey,h.inventoryName);
    const line=new TextDecoder().decode(source).split(/\r?\n/)[loc.lineNumber-1]?.trim();
    assert.ok(line===h.inventoryName||line?.startsWith(h.inventoryName+" "),"locator original source line");checks++;
  }
  for(const secret of item.forbiddenOutputSubstrings??[])eq(JSON.stringify(got).includes(secret),false,"no secret output");
  for(const k of ["links","connections","routes","scenario","engineState","physicalLink","verified"]){
    eq(Object.hasOwn(got,k),false,"no network/Engine truth");
  }
  eq(JSON.stringify(got),JSON.stringify(await previewAnsibleIniStaticInventory(source)),"deterministic");
}
for(const n of oracle.negatives)await blocked(read(n.file),n.code);
const first=await previewAnsibleIniStaticInventory(read("valid-ungrouped.ini"));
eq(first.hosts[0].locators[0].lineNumber,2);eq(first.hosts[0].locators[0].section,"ungrouped");
const multi=await previewAnsibleIniStaticInventory(read("valid-multigroup.ini"));
eq(multi.hosts[0].locators.map(l=>l.lineNumber),[2,6]);
eq(multi.hosts[0].locators.map(l=>l.section),["east","west"]);
const secrets=await previewAnsibleIniStaticInventory(read("valid-sensitive-vars.ini"));
eq(secrets.diagnostics.map(d=>d.code),["ANSIBLE_INI_VARIABLES_NOT_IMPORTED"]);
await blocked(new Uint8Array(),"ANSIBLE_INI_SOURCE_SIZE_INVALID");
await blocked(new Uint8Array(262145),"ANSIBLE_INI_SOURCE_SIZE_INVALID");
await blocked(Uint8Array.from([0xc3,0x28]),"ANSIBLE_INI_UTF8_INVALID");
await blocked(utf8("[web]\napp01\0\n"),"ANSIBLE_INI_CHARACTER_UNSUPPORTED");
await blocked(utf8("[web]\rapp01\n"),"ANSIBLE_INI_CHARACTER_UNSUPPORTED");
await blocked(utf8("[web]\napp01 ansible_host=999.0.0.1\n"),"ANSIBLE_INI_ADDRESS_UNSUPPORTED");
await blocked(utf8("[web]\napp01 ansible_host=192.0.2.1\n[db]\napp01\n"),"ANSIBLE_INI_HOST_CONFLICT");
await blocked(utf8("[web]\n__proto__\n"),"ANSIBLE_INI_NAME_UNSUPPORTED");
await blocked(utf8("[web]\napp01 ansible_host=192.0.2.1 ansible_host=192.0.2.2\n"),"ANSIBLE_INI_HOST_TOKEN_INVALID");
await blocked(utf8("[web]\napp01\napp01\n"),"ANSIBLE_INI_SECTION_DUPLICATE");
await blocked(utf8("[web]\napp01\n".repeat(6000)),"ANSIBLE_INI_LINE_BUDGET");
await blocked(utf8("[web]\napp01 "+("x".repeat(4098))),"ANSIBLE_INI_LINE_BUDGET");
const lf=await previewAnsibleIniStaticInventory(utf8("[web]\napp01\n"));
const crlf=await previewAnsibleIniStaticInventory(utf8("[web]\r\napp01\r\n"));
assert.notEqual(lf.sourceSha256,crlf.sourceSha256,"original byte-level SHA");checks++;
eq(lf.hosts.map(h=>h.inventoryName),crlf.hosts.map(h=>h.inventoryName));
assert.throws(()=>selectEnterpriseImportAdapter("application/x-ansible-inventory+ini"),/No import adapter supports/);checks++;
console.log("PASS ANSIBLE-INI-P1 "+checks+" strict assertions; read-only parser, NOT browser or Parrot acceptance.");
