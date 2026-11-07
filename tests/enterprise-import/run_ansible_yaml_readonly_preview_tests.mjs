import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { previewAnsibleStaticInventory } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-yaml-preview.js";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import { selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

const prefix = "tests/fixtures/import/ansible-yaml/";
const read = (file) => Uint8Array.from(fs.readFileSync(prefix + file));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const encoder = new TextEncoder();
let tests = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); tests++; };
const blocked = async (input, code) => {
  await assert.rejects(previewAnsibleStaticInventory(input),
    (err) => err instanceof EnterpriseImportError && err.code === code,
    `Expected ${code}`);
  tests++;
};

const source = read("valid-nested.yml");
const preview = await previewAnsibleStaticInventory(source);
eq(preview.status, "REVIEW_REQUIRED");
eq(preview.canActivate, false);
eq(preview.profileId, "ansible.inventory.static.yaml.v1");
eq(preview.semanticTrack, "CONFIG_DOCUMENTED");
eq(preview.sourceSha256, hash(source), "SHA-256 of original YAML source");
eq(preview.hosts.map((x)=>x.inventoryName), ["control01","rtr01","app01","app02"]);
eq(preview.hosts.map((x)=>x.reportedConnectionAddress ?? null),
  ["192.0.2.10","192.0.2.1","198.51.100.20",null]);
eq(preview.hosts.map((x)=>x.addressTruth),
  ["REPORTED_NOT_VERIFIED","REPORTED_NOT_VERIFIED","REPORTED_NOT_VERIFIED","UNKNOWN"]);
eq(preview.groupPaths, ["all","all/routers","all/servers"]);
eq(preview.hosts[1].groupPaths, ["all/routers"]);
eq(preview.hosts[2].groupPaths, ["all/servers"]);
eq(preview.hosts[1].locators[0], {
  kind:"ansible-yaml-host",sourceSha256:hash(source),groupPath:"all/routers",hostKey:"rtr01"
});
eq(preview.diagnostics[0].code, "ANSIBLE_YAML_VARIABLES_NOT_IMPORTED");
for (const key of ["connections","links","routes","scenario","engineState","physicalLink","verified"]) {
  eq(Object.hasOwn(preview,key),false,"No topology or Engine truth: "+key);
}
eq(JSON.stringify(preview), JSON.stringify(await previewAnsibleStaticInventory(source)),"Deterministic repeat");
eq(hash(source), preview.sourceSha256,"Source was not mutated");
const repeat = await previewAnsibleStaticInventory(read("valid-repeated-host.yml"));
eq(repeat.hosts.map((x)=>x.inventoryName), ["app01","app02"],"Repeated Ansible host is one record");
eq(repeat.hosts[0].groupPaths, ["all/east","all/west"],"Multiple group membership retained");
eq(repeat.hosts[0].locators.length,2);
eq(repeat.hosts[0].reportedConnectionAddress, "192.0.2.20");
const secrets = await previewAnsibleStaticInventory(read("valid-sensitive-vars.yml"));
eq(secrets.hosts.length,1);
eq(secrets.hosts[0].reportedConnectionAddress,"203.0.113.10");
eq(secrets.diagnostics[0].code,"ANSIBLE_YAML_VARIABLES_NOT_IMPORTED");
for (const canary of ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
                       "SYNTHETIC_TOKEN_CANARY_NOT_REAL","synthetic_admin"]) {
  eq(JSON.stringify(secrets).includes(canary),false,"Sensitive variable value must not leak: "+canary);
}

await blocked(read("invalid-duplicate-key.yml"), "ANSIBLE_YAML_PARSE_INVALID");
await blocked(read("invalid-alias.yml"), "ANSIBLE_YAML_ALIAS_FORBIDDEN");
await blocked(read("invalid-custom-tag.yml"), "ANSIBLE_YAML_PARSE_INVALID");
await blocked(read("invalid-dynamic-plugin.yml"), "ANSIBLE_YAML_ROOT_INVALID");
await blocked(read("invalid-playbook.yml"), "ANSIBLE_YAML_EXPECTED_MAPPING");
await blocked(read("invalid-multiple-documents.yml"), "ANSIBLE_YAML_DOCUMENT_COUNT");
await blocked(read("invalid-nonscalar-address.yml"), "ANSIBLE_YAML_ADDRESS_UNSUPPORTED");
await blocked(read("invalid-group-recursion.yml"), "ANSIBLE_YAML_GROUP_RECURSIVE");
await blocked(read("invalid-merge-alias.yml"), "ANSIBLE_YAML_ALIAS_FORBIDDEN");
await blocked(new Uint8Array(), "ANSIBLE_YAML_SOURCE_SIZE_INVALID");
await blocked(new Uint8Array(256*1024+1), "ANSIBLE_YAML_SOURCE_SIZE_INVALID");
await blocked(encoder.encode("all:\n  hosts:\n    a:\n      ansible_host: 999.0.0.1\n"),
  "ANSIBLE_YAML_ADDRESS_UNSUPPORTED");
await blocked(encoder.encode("all:\n  children:\n    group1:\n      hosts:\n        srv:\n          ansible_host: 192.0.2.10\n    group2:\n      hosts:\n        srv:\n          ansible_host: 192.0.2.11\n"),
  "ANSIBLE_YAML_HOST_CONFLICT");
await blocked(encoder.encode("all:\n  hosts:\n    __proto__: null\n"),"ANSIBLE_YAML_FORBIDDEN_KEY");
await blocked(encoder.encode("all:\n  hosts:\n    root01: \n      ansible_host: \"{{ lookup(\u0027pipe\u0027, \u0027id\u0027) }}\"\n"),
  "ANSIBLE_YAML_ADDRESS_UNSUPPORTED");
await blocked(encoder.encode("all:\n  children:\n    web:\n      hosts:\n        a: null\n      children:\n        web:\n          hosts:\n            b: null\n"),"ANSIBLE_YAML_GROUP_RECURSIVE");
const empty = await previewAnsibleStaticInventory(encoder.encode("all:\n  children:\n    spare:\n"));
eq(empty.hosts.length,0);
eq(empty.groupPaths,["all","all/spare"]);

assert.throws(()=>selectEnterpriseImportAdapter("application/x-ansible-inventory+yaml"),
  /No import adapter supports/);tests++;
console.log(`PASS ANSIBLE-YAML-P1: ${tests} independent strict YAML, redaction, provenance and no-inference assertions. No active adapter.`);
