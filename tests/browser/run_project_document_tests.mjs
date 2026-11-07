import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with { type: "json" };
import example from "../../ui/app/welcome-scenario.json" with { type: "json" };
import {
  PROJECT_FORMAT, PROJECT_VERSION, PROJECT_MAX_BYTES,
  createProjectDocument, readProjectDocument, readProjectFile, writeProjectFile,
  projectFilename, projectSnapshot,
} from "../../ui/app/project-document.mjs";
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
const validateSource = new Ajv2020({ strict: true }).compile(schema);
const opts = { validateSource };
const source = structuredClone(example);
const workspace = { mode: "builder", source, sourceRevision: 4, dirty: true,
  selection: { ids: ["firewall01"], primary: "firewall01" },
  layoutOverrides: [{ id: "firewall01", x: 120, y: 150, width: 300 }] };
assert.ok(projectFilename("../../../test").endsWith("test.yadilab"));
assert.ok(!projectFilename("../../../test").includes("/"));
assert.equal(projectFilename("Net.yadilab"), "Net.yadilab");
assert.equal(projectSnapshot({ mode: "runtime" }), null);
const text = await createProjectDocument(workspace, opts);
const doc = JSON.parse(text);
assert.equal(doc.formatId, PROJECT_FORMAT);
assert.equal(doc.schemaVersion, PROJECT_VERSION);
assert.equal(doc.content.source.resources.length, 4);
assert.equal(doc.content.source.connections.length, 3);
assert.ok(doc.contentSha256.match(/^[0-9a-f]{64}$/));
const restored = await readProjectDocument(text, opts);
assert.deepEqual(restored.source, source);
assert.deepEqual(restored.layoutOverrides, workspace.layoutOverrides);
assert.equal("compile" in restored, false);
assert.equal("engineState" in restored, false);
assert.equal("selection" in restored, false);
assert.equal("dirty" in restored, false);
assert.equal(JSON.stringify(JSON.parse(await createProjectDocument(workspace, opts))), JSON.stringify(doc));
const file = (name, text) => ({ name, size: new TextEncoder().encode(text).length,
  async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
assert.deepEqual((await readProjectFile(file("network.yadilab", text), opts)).source, source);
await assert.rejects(readProjectFile(file("network.json", text), opts), /PROJECT_FILE_INVALID/);
await assert.rejects(readProjectFile({ name: "x.yadilab", size: PROJECT_MAX_BYTES + 1,
  arrayBuffer() { throw new Error("must reject size before read"); } }, opts), /PROJECT_FILE_INVALID/);
await assert.rejects(readProjectFile({ name:"x.yadilab",size:1,async arrayBuffer() {
  return new Uint8Array([0xff]).buffer; } }, opts), /PROJECT_UTF8_INVALID/);
const tamper = (mutate) => { const copy=structuredClone(doc); mutate(copy); return JSON.stringify(copy); };
await assert.rejects(readProjectDocument(tamper(x=>x.content.source.scenarioId="tampered"),opts), /PROJECT_CHECKSUM_MISMATCH/);
await assert.rejects(readProjectDocument(tamper(x=>x.schemaVersion=999),opts), /PROJECT_FORMAT_UNSUPPORTED/);
await assert.rejects(readProjectDocument("{",opts), /PROJECT_JSON_INVALID/);
await assert.rejects(readProjectDocument(tamper(x=>x.extra=true),opts), /PROJECT_SHAPE_INVALID/);
await assert.rejects(createProjectDocument({mode:"runtime",source},opts), /PROJECT_BUILDER_REQUIRED/);
await assert.rejects(createProjectDocument({...workspace,source:{...source,resources:[...source.resources,source.resources[0]]}},opts), /PROJECT_DUPLICATE_ID/);
await assert.rejects(createProjectDocument({...workspace,source:{...source,connections:[{...source.connections[0],to:{resource:"nonexistent"}}]}},opts), /PROJECT_DANGLING_CONNECTION/);
await assert.rejects(createProjectDocument({...workspace,layoutOverrides:[{id:"ghost",x:0,y:0}]},opts), /PROJECT_LAYOUT_INVALID/);
await assert.rejects(createProjectDocument({...workspace,layoutOverrides:[{id:"firewall01",x:Infinity,y:0}]},opts), /PROJECT_LAYOUT_INVALID/);
await assert.rejects(createProjectDocument({...workspace,layoutOverrides:[
  {id:"firewall01",x:1,y:1}, {id:"firewall01",x:3,y:3}]},opts), /PROJECT_LAYOUT_INVALID/);
let stored="";
const handle={
  async createWritable() {
    return { async write(blob){stored=await blob.text();},async close(){} };
  },
  async getFile() { return file("network.yadilab", stored); },
};
assert.equal(await writeProjectFile(handle,text),true);
assert.equal(stored,text);
const fromDisk = await readProjectFile(await handle.getFile(),opts);
assert.deepEqual(fromDisk.source,restored.source);
assert.deepEqual(fromDisk.layoutOverrides,restored.layoutOverrides);
assert.match(fromDisk.fileSha256,/^[0-9a-f]{64}$/);
const firstWrite = stored;
await assert.rejects(writeProjectFile(handle,text,{expectedFileSha256:"bad"}),/PROJECT_EXPECTED_DIGEST_INVALID/);
await assert.rejects(writeProjectFile(handle,text,{expectedFileSha256:(fromDisk.fileSha256[0] === "0" ? "1" : "0")+fromDisk.fileSha256.slice(1)}),
  /PROJECT_EXTERNAL_FILE_CHANGED/);
assert.equal(stored,firstWrite,"External modification conflict must never overwrite bytes");
stored += "\\n"; // Existing document's exact bytes changed externally.
await assert.rejects(writeProjectFile(handle,text,{expectedFileSha256:fromDisk.fileSha256}),
  /PROJECT_EXTERNAL_FILE_CHANGED/);
assert.equal(stored,firstWrite+"\\n","Refused overwrite must leave external modification intact");
stored=firstWrite;
assert.equal(await writeProjectFile(handle,text,{expectedFileSha256:fromDisk.fileSha256}),true);
await assert.rejects(writeProjectFile({ ...handle, async getFile() {
  return file("network.yadilab",stored+"CORRUPT");
}}, text),/PROJECT_READBACK_MISMATCH/);
await assert.rejects(writeProjectFile({ ...handle,async createWritable() {
  return {async write(){throw Error("DISK_FULL");},async abort(){},async close(){}};
}},text),/DISK_FULL/);
console.log("PASS PROJECT-001: user-controlled format v1, SHA-256, exact source/link/layout roundtrip, corruption and write/readback negative tests");
