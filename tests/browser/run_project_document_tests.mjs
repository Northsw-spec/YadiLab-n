import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with { type: "json" };
import example from "../../ui/app/welcome-scenario.json" with { type: "json" };
import {
  PROJECT_FORMAT, PROJECT_VERSION, PROJECT_MAX_BYTES,
  createProjectDocument, readProjectDocument, readProjectFile, writeProjectFile,
  projectFilename, projectSnapshot, projectHasUnsavedChanges, sameProjectFileEntry,
  assertSafeRecoveryTarget,
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
const emptyExample = projectSnapshot({ mode: "builder", source, layoutOverrides: [] });
assert.equal(projectHasUnsavedChanges(emptyExample, emptyExample, false), false,
  "Initial welcome project is a sample, not a newly created project");
assert.equal(projectHasUnsavedChanges(emptyExample, emptyExample, true), true,
  "Brand new project must remain unsaved with zero user edits");
assert.equal(projectHasUnsavedChanges(null, emptyExample, true), true,
  "Unpersisted project remains unsaved in Runtime preview");
assert.equal(projectHasUnsavedChanges(emptyExample + " edited", emptyExample, false), true,
  "Editing a verified saved project must re-enable unsaved warning");
assert.equal(projectHasUnsavedChanges(emptyExample, emptyExample, false), false,
  "Successful verified save clears the unsaved state");
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
const samePhysicalFile = { ...handle };
handle.isSameEntry = async other => other === handle || other === samePhysicalFile;
samePhysicalFile.isSameEntry = async other => other === handle || other === samePhysicalFile;
assert.equal(await sameProjectFileEntry(handle,handle),true);
assert.equal(await sameProjectFileEntry(handle,samePhysicalFile),true,
  "Two different JS handles to the same physical file must be recognized");
assert.equal(await sameProjectFileEntry(null,samePhysicalFile),false);
const differentFile = { ...handle, isSameEntry:async()=>false };
assert.equal(await sameProjectFileEntry(handle,differentFile),false);
// The file stays unsafe even after its previous object handle was detached,
// and even if Save As returns an alias for the very same physical path.
await assert.rejects(assertSafeRecoveryTarget([handle],handle),
  /PROJECT_FILE_REQUIRES_REOPEN/);
await assert.rejects(assertSafeRecoveryTarget([handle],samePhysicalFile),
  /PROJECT_FILE_REQUIRES_REOPEN/);
await assert.doesNotReject(assertSafeRecoveryTarget([handle],differentFile));
await assert.rejects(assertSafeRecoveryTarget([handle,differentFile],samePhysicalFile),
  /PROJECT_FILE_REQUIRES_REOPEN/,
  "Saving to a different file must not forget previously failed targets");
await assert.rejects(assertSafeRecoveryTarget(Array(33).fill(handle),differentFile),
  /PROJECT_QUARANTINE_LIMIT_REOPEN/,
  "Too many unverified file handles must fail closed");
await assert.rejects(sameProjectFileEntry(handle,{...handle,isSameEntry:null}),
  /PROJECT_FILE_IDENTITY_UNAVAILABLE/,
  "Lack of identity comparison must block potentially destructive Save As");
await assert.rejects(sameProjectFileEntry({...handle,isSameEntry:async()=>"true"},samePhysicalFile),
  /PROJECT_FILE_IDENTITY_INVALID/,
  "Malformed answer from the queried current handle must fail closed");
stored += "EXTERNAL-EDIT";
const conflictContent = stored;
await assert.rejects(writeProjectFile(samePhysicalFile,text,
    {expectedFileSha256:fromDisk.fileSha256}),/PROJECT_EXTERNAL_FILE_CHANGED/);
assert.equal(stored,conflictContent,
  "Second JS handle must not overwrite externally modified physical file");
stored=firstWrite;
// Save As must never overwrite an unrelated project just because the file picker
// returned a writable handle to that existing, non-empty destination.
let destinationDisk = "IRREPLACEABLE OTHER PROJECT";
let destinationOpenCount = 0;
let destinationWriteCount = 0;
const destinationHandle = {
  async getFile() { return file("other-project.yadilab", destinationDisk); },
  async createWritable() {
    destinationOpenCount++;
    return {
      async write(blob) { destinationWriteCount++; destinationDisk = await blob.text(); },
      async close() {},
      async abort() {},
    };
  },
};
await assert.rejects(writeProjectFile(destinationHandle, text, { requireEmptyTarget: true }),
  /PROJECT_DESTINATION_NOT_EMPTY/);
assert.equal(destinationDisk, "IRREPLACEABLE OTHER PROJECT");
assert.equal(destinationOpenCount, 0, "Existing file must be rejected before opening writable stream");
assert.equal(destinationWriteCount, 0);
await assert.rejects(writeProjectFile(destinationHandle, text, {
  requireEmptyTarget: true, expectedFileSha256: fromDisk.fileSha256,
}), /PROJECT_DESTINATION_POLICY_CONFLICT/);
await assert.rejects(writeProjectFile({
  ...destinationHandle, async getFile() { return { name: "unverifiable.yadilab" }; },
}, text, { requireEmptyTarget: true }), /PROJECT_DESTINATION_UNVERIFIABLE/);
destinationDisk = "";
assert.equal(await writeProjectFile(destinationHandle, text, { requireEmptyTarget: true }), true,
  "New empty project destination must remain writable with full readback");
assert.equal(destinationDisk, text);
// External creation/edit between the two destination checks also fails closed.
let delayedDestination = "";
let delayedAbortCount = 0;
let delayedWriteCount = 0;
const racedDestination = {
  async getFile() { return file("raced-new-project.yadilab", delayedDestination); },
  async createWritable() {
    delayedDestination = "ANOTHER WRITER CREATED CONTENT DURING OPEN";
    return {
      async write() { delayedWriteCount++; },
      async close() { throw Error("Unexpected close"); },
      async abort() { delayedAbortCount++; },
    };
  },
};
await assert.rejects(writeProjectFile(racedDestination, text, { requireEmptyTarget: true }),
  /PROJECT_DESTINATION_NOT_EMPTY/);
assert.equal(delayedWriteCount, 0);
assert.equal(delayedAbortCount, 1);
assert.equal(delayedDestination, "ANOTHER WRITER CREATED CONTENT DURING OPEN");
// RACE: an independent writer edits the file while createWritable() resolves.
// The second digest must refuse to write and abort the provisional stream.
let raceDisk = firstWrite;
let raceAbortCount = 0;
let raceWriteCount = 0;
const duringWritableOpen = {
  async getFile() { return file("network.yadilab", raceDisk); },
  async createWritable() {
    raceDisk += " EXTERNAL_MODIFICATION_DURING_OPEN";
    return {
      async write() { raceWriteCount++; },
      async abort() { raceAbortCount++; },
      async close() { throw new Error("Should never close a rejected write"); },
    };
  },
};
await assert.rejects(
  writeProjectFile(duringWritableOpen, text, { expectedFileSha256: fromDisk.fileSha256 }),
  /PROJECT_EXTERNAL_FILE_CHANGED/,
  "Concurrent edit during createWritable must be rejected before writing bytes");
assert.equal(raceWriteCount, 0, "No application bytes may be written on a stale stream");
assert.equal(raceAbortCount, 1, "Provisional stream must be aborted after race detection");
assert.equal(raceDisk, firstWrite + " EXTERNAL_MODIFICATION_DURING_OPEN",
  "Independent writer's bytes must survive failed application Save");
await assert.rejects(writeProjectFile({ ...handle, async getFile() {
  return file("network.yadilab",stored+"CORRUPT");
}}, text),/PROJECT_READBACK_MISMATCH/);
await assert.rejects(writeProjectFile({ ...handle,async createWritable() {
  return {async write(){throw Error("DISK_FULL");},async abort(){},async close(){}};
}},text),/DISK_FULL/);
// A genuine 10k/10k source must roundtrip every device, link, endpoint and port
// without inventing new connectivity or changing unselected canonical fields.
const large = structuredClone(source);
for (let i = 0; i < 10000; i++) {
  large.resources.push({ id: "device_" + i, type: "server.generic",
    label: "Device " + i, zone: large.zones[0].id, properties: {} });
  large.connections.push({ id: "wire_" + i, kind: "network",
    from: { resource: "device_" + i, port: "eth0" },
    to: { resource: "device_" + ((i+1) % 10000), port: "eth1" }, properties: {} });
}
const largeWorkspace = { ...workspace, source: large, layoutOverrides: [
  { id: "device_0", x: 13.25, y: 97 },
  { id: "device_9999", x: 144.5, y: 220 },
] };
const largeFile = await createProjectDocument(largeWorkspace, opts);
const largeReopened = await readProjectDocument(largeFile, opts);
assert.equal(largeReopened.source.resources.length, source.resources.length + 10000);
assert.equal(largeReopened.source.connections.length, source.connections.length + 10000);
assert.deepEqual(largeReopened.source.connections[largeReopened.source.connections.length - 1],
  large.connections[large.connections.length - 1]);
assert.deepEqual(largeReopened.layoutOverrides, largeWorkspace.layoutOverrides);
assert.deepEqual(largeReopened.source.resources[largeReopened.source.resources.length - 1],
  large.resources[large.resources.length - 1]);
assert.equal(Buffer.byteLength(largeFile, "utf8") < PROJECT_MAX_BYTES, true);
console.log("PASS PROJECT-001 SCALE: 10,000 source devices, 10,000 linked port references, and manual coordinates survive exact project roundtrip");
console.log("PASS PROJECT-001: user-controlled format v1, SHA-256, exact source/link/layout roundtrip, corruption and write/readback negative tests");
