import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scenarioLaunchStillCurrent } from "../../ui/app/scenario-launch-guard.mjs";
import { webcrypto } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with { type: "json" };
import example from "../../ui/app/welcome-scenario.json" with { type: "json" };
import {
  PROJECT_FORMAT, PROJECT_VERSION, PROJECT_MAX_BYTES,
  createProjectDocument, readProjectDocument, readProjectFile, writeProjectFile,
  assertProjectOpenDiskUnchanged,
  projectFilename, projectSnapshot, projectHasUnsavedChanges, projectHasLiveUnsavedChanges,
  projectNeedsUnloadWarning,
  projectFilePickerStillCurrent, sameEditableProjectRevision,
  projectFileAssociationStillCurrent, sameProjectFileEntry,
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
// PROJECT-076B: imported provenance is optional historical metadata, but its
// internal identity and target references must remain fail-closed on Save/Open.
const provenanceSource = structuredClone(source);
const provenanceSha = "a".repeat(64);
provenanceSource.networkImportProvenance = { version: "network-import-provenance/v1",
  source: { sourceId: `src_${provenanceSha}`, sha256: provenanceSha, byteSize: 1, mediaType: "text/csv" },
  facts: [{ factId: "nip_1", targetKind: "resource", targetId: provenanceSource.resources[0].id,
    field: "Devices.Asset ID", mapping: "EXACT", locator: { kind: "record-row", table: "Devices", row: 2 } }] };
const provenanceText = await createProjectDocument({ ...workspace, source: provenanceSource }, opts);
assert.deepEqual((await readProjectDocument(provenanceText, opts)).source.networkImportProvenance,
  provenanceSource.networkImportProvenance, "valid provenance survives exact native project roundtrip");
for (const [mutate, code] of [
  [candidate => { candidate.networkImportProvenance.source.sourceId = "src_" + "b".repeat(64); }, "NETWORK_IMPORT_PROVENANCE_SOURCE_ID"],
  [candidate => { candidate.networkImportProvenance.facts[0].targetId = "ghost"; }, "NETWORK_IMPORT_PROVENANCE_TARGET"],
  [candidate => { candidate.networkImportProvenance.facts.push(structuredClone(candidate.networkImportProvenance.facts[0])); }, "NETWORK_IMPORT_PROVENANCE_DUPLICATE_FACT"],
]) {
  const candidate = structuredClone(provenanceSource); mutate(candidate);
  await assert.rejects(createProjectDocument({ ...workspace, source: candidate }, opts), new RegExp(code));
}
// PROJECT-076C: a deleted topology target is retained as explicit historical
// import evidence and must round-trip, while a forged historical marker cannot
// hide a still-live binding (or silently re-bind after identity reuse).
const historicalProvenanceSource = structuredClone(provenanceSource);
historicalProvenanceSource.networkImportProvenance.facts[0].targetId = "retired_asset";
historicalProvenanceSource.networkImportProvenance.facts[0].targetStatus = "HISTORICAL";
const historicalText = await createProjectDocument({ ...workspace, source: historicalProvenanceSource }, opts);
assert.deepEqual((await readProjectDocument(historicalText, opts)).source.networkImportProvenance,
  historicalProvenanceSource.networkImportProvenance, "historical deleted-target provenance survives native Save/Open");
const forgedHistorical = structuredClone(provenanceSource);
forgedHistorical.networkImportProvenance.facts[0].targetStatus = "HISTORICAL";
await assert.rejects(createProjectDocument({ ...workspace, source: forgedHistorical }, opts),
  /NETWORK_IMPORT_PROVENANCE_TARGET/, "historical status must not relabel a live provenance target");
// PROJECT-026: a truly blank New project is a legitimate editable draft, not
// a compiled/runnable scenario. It must Save/Open without inventing resources,
// links, test results or objectives. The executable source contract is unchanged.
const draftSchema = structuredClone(schema);
draftSchema.$id = "urn:app:schema:editable-project-source:0.1.0";
draftSchema.properties.resources.minItems = 0;
draftSchema.properties.objectives.minItems = 0;
// A New Builder's completion is a non-runnable empty conjunction; preserve
// the strict compiler's nonempty-rule requirement on genuine runtime sources.
draftSchema.$defs.rule.oneOf[0].properties.rules.minItems = 0;
const draftValidator = new Ajv2020({ strict: true }).compile(draftSchema);
const blankDraft = {
  formatId: source.formatId, schemaVersion: source.schemaVersion,
  scenarioId: "new_project",
  metadata: { title: "New YadiLab project", language: "sv",
    briefing: "An editable blank project, not an Engine-verified lab." },
  requires: { capabilities: [], profiles: [] },
  zones: [], resources: [], connections: [], tests: [], findings: [], objectives: [],
  completion: { op: "all", rules: [] },
};
assert.equal(validateSource(blankDraft), false,
  "Executable scenarios must still require a resource and an objective");
assert.equal(draftValidator(blankDraft), true,
  "Editable project schema must accept a genuinely blank canonical draft");
const blankBytes = await createProjectDocument(
  { mode: "builder", source: blankDraft, layoutOverrides: [] },
  { validateSource: draftValidator });
const blankOpened = await readProjectDocument(blankBytes,
  { validateSource: draftValidator });
assert.deepEqual(blankOpened.source, blankDraft,
  "Blank New project must reopen with zero invented resources or objectives");
assert.deepEqual(blankOpened.layoutOverrides, []);
const orphanDraftLink = structuredClone(source.connections[0]);
orphanDraftLink.id = "orphan_draft_link";
orphanDraftLink.from.resource = "unknown_source";
orphanDraftLink.to.resource = "unknown_target";
assert.equal(draftValidator({ ...blankDraft, connections: [orphanDraftLink] }), true,
  "Negative orphan-link fixture must pass the editable source JSON schema");
await assert.rejects(createProjectDocument({
  mode: "builder",
  source: { ...blankDraft, connections: [orphanDraftLink] }, layoutOverrides: [],
}, { validateSource: draftValidator }), /PROJECT_DANGLING_CONNECTION/,
"Editable draft exception may not authorize fabricated connectivity");
console.log("PASS PROJECT-026: blank editable .yadilab project Save/Open without weakening executable source gate or fabricating topology");
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
// PROJECT-024: reject corrupt content BEFORE invoking schema/semantic validators.
// An invalid checksum never authorizes traversal of a large, untrusted source.
// A matching checksum still cannot legitimize dangling canonical references.
const tamperedSource = structuredClone(doc);
tamperedSource.content.source.connections[0].to.resource = "missing_device";
let corruptValidatorCalls = 0;
await assert.rejects(readProjectDocument(JSON.stringify(tamperedSource), {
  validateSource: () => {
    corruptValidatorCalls++;
    throw Error("CORRUPT_SOURCE_MUST_NOT_REACH_VALIDATOR");
  },
}), /PROJECT_CHECKSUM_MISMATCH/,
"Corrupt project content must fail its checksum before schema validation");
assert.equal(corruptValidatorCalls, 0,
  "Checksum failure must not call even a provided source validator");
tamperedSource.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(JSON.stringify(tamperedSource.content))
)).toString("hex");
await assert.rejects(readProjectDocument(JSON.stringify(tamperedSource), opts),
  /PROJECT_DANGLING_CONNECTION/,
  "A valid checksum must not bypass referential-integrity checks");
console.log("PASS PROJECT-024: integrity gate precedes untrusted schema traversal; matching hash still requires semantic validation");

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
// PROJECT-038: the exported writer is a disk-trust boundary, not just an
// internal helper. An omitted destination policy would otherwise allow
// unchecked overwrite of arbitrary existing .yadilab files.
let unguardedReadCalls = 0;
let unguardedWriteCalls = 0;
const unguardedExistingFile = {
  async getFile() {
    unguardedReadCalls++;
    return file("other-project.yadilab", "IRREPLACEABLE OTHER PROJECT");
  },
  async createWritable() {
    unguardedWriteCalls++;
    throw Error("A write without destination policy must never open a stream");
  },
};
await assert.rejects(writeProjectFile(unguardedExistingFile, text),
  /PROJECT_DESTINATION_POLICY_REQUIRED/,
  "Omitting the write policy must be rejected before inspecting/touching the disk");
await assert.rejects(writeProjectFile(unguardedExistingFile, text, { requireEmptyTarget: false }),
  /PROJECT_DESTINATION_POLICY_REQUIRED/,
  "Explicit false is not permission to overwrite an unassociated file");
assert.equal(unguardedReadCalls, 0,
  "Missing write policy must fail before any native file handle interaction");
assert.equal(unguardedWriteCalls, 0,
  "Missing write policy must never create a writable stream");
assert.equal(await writeProjectFile(handle,text,{requireEmptyTarget:true}),true,
  "A verified empty destination remains available for first Save As");
assert.equal(stored,text);
const fromDisk = await readProjectFile(await handle.getFile(),opts);
assert.deepEqual(fromDisk.source,restored.source);
assert.deepEqual(fromDisk.layoutOverrides,restored.layoutOverrides);
assert.match(fromDisk.fileSha256,/^[0-9a-f]{64}$/);
// PROJECT-028: exact native disk identity must be based on raw File bytes,
// not TextDecoder's normalized text. UTF-8 BOM is discarded by TextDecoder,
// so adding the three BOM bytes changes the physical file while preserving
// the decoded JSON text. Open and Save must still detect the byte change.
const bomBytes = new Uint8Array(3 + new TextEncoder().encode(text).byteLength);
bomBytes.set([0xef, 0xbb, 0xbf]);
bomBytes.set(new TextEncoder().encode(text), 3);
const bomFile = () => ({
  name: "network.yadilab", size: bomBytes.byteLength,
  async arrayBuffer() { return bomBytes.buffer.slice(0); },
});
assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(bomBytes), text,
  "BOM test must prove different physical bytes decode to identical JSON text");
const withBom = await readProjectFile(bomFile(), opts);
assert.deepEqual(withBom.source, fromDisk.source, "BOM file remains valid JSON");
assert.notEqual(withBom.fileSha256, fromDisk.fileSha256,
  "Native file fingerprint must change when BOM bytes are added");
await assert.rejects(assertProjectOpenDiskUnchanged(
  { async getFile() { return bomFile(); } }, fromDisk.fileSha256),
  /PROJECT_EXTERNAL_FILE_CHANGED_DURING_OPEN/,
  "Open must not attach a verified handle if external bytes gained a BOM");
let bomSaveWriteAttempts = 0;
await assert.rejects(writeProjectFile({
  async getFile() { return bomFile(); },
  async createWritable() { bomSaveWriteAttempts++; throw Error("must not write"); },
}, text, { expectedFileSha256: fromDisk.fileSha256 }),
/PROJECT_EXTERNAL_FILE_CHANGED/,
"Save must reject byte-changed existing file before a writable is opened");
assert.equal(bomSaveWriteAttempts, 0);
assert.equal(await assertProjectOpenDiskUnchanged(
  { async getFile() { return bomFile(); } }, withBom.fileSha256), true,
  "An explicitly opened BOM-bearing file must recognize the same exact bytes");
console.log("PASS PROJECT-028: exact native Open/Save SHA-256 tracks physical bytes including UTF-8 BOM");

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
await assert.rejects(writeProjectFile(handle, "MUST_NOT_REPLACE_REAL_FILE"),
  /PROJECT_DESTINATION_POLICY_REQUIRED/,
  "A caller must not overwrite an associated non-empty file without exact disk fingerprint");
assert.equal(stored, firstWrite, "Unchecked native write must preserve the existing project");
console.log("PASS PROJECT-038: native writer fails closed unless empty-target or exact SHA-256 policy is explicit");
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
// PROJECT-044: neither of two FileSystemHandle objects may unilaterally
// decide that Save As points at a different file. A disagreement might
// otherwise reset the expected SHA policy and allow writing an empty file
// through a mismatched handle identity.
const asymmetricSelected = { ...handle,
  isSameEntry: async other => other === handle };
await assert.rejects(sameProjectFileEntry(handle, asymmetricSelected),
  /PROJECT_FILE_IDENTITY_INVALID/,
  "Selected handle claims same entry while current handle claims different");
await assert.rejects(assertSafeRecoveryTarget([handle], asymmetricSelected),
  /PROJECT_FILE_IDENTITY_INVALID/,
  "Quarantined file cannot be bypassed by an asymmetric handle");
await assert.rejects(sameProjectFileEntry(
  { isSameEntry: async () => true }, { isSameEntry: async () => false }),
  /PROJECT_FILE_IDENTITY_INVALID/,
  "Current handle claims same entry while selected handle claims different");
await assert.rejects(sameProjectFileEntry(handle, {
  ...handle, isSameEntry: async () => "false",
}), /PROJECT_FILE_IDENTITY_INVALID/,
  "Nonboolean reciprocal identity answers cannot be accepted");
assert.equal(await sameProjectFileEntry(handle, samePhysicalFile), true,
  "Matching reciprocal identity must preserve legitimate Save As");
assert.equal(await sameProjectFileEntry(handle, differentFile), false,
  "Two matching different-entry answers must still permit a new empty target");
console.log("PASS PROJECT-044: reciprocal native file identity required for Save As and quarantine");
stored += "EXTERNAL-EDIT";
const conflictContent = stored;
await assert.rejects(writeProjectFile(samePhysicalFile,text,
    {expectedFileSha256:fromDisk.fileSha256}),/PROJECT_EXTERNAL_FILE_CHANGED/);
assert.equal(stored,conflictContent,
  "Second JS handle must not overwrite externally modified physical file");
stored=firstWrite;
// PROJECT-030: direct native write calls must validate bytes before touching
// an existing file. A bypassed serializer must never truncate a real project.
let preflightWriteCount = 0;
const preflightHandle = {
  async getFile() { return file("network.yadilab", firstWrite); },
  async createWritable() { preflightWriteCount++; throw Error("must not truncate"); },
};
await assert.rejects(writeProjectFile(preflightHandle, null), /PROJECT_FILE_INVALID/);
await assert.rejects(writeProjectFile(preflightHandle, ""), /PROJECT_FILE_TOO_LARGE/);
await assert.rejects(writeProjectFile(preflightHandle, "x".repeat(PROJECT_MAX_BYTES + 1)),
  /PROJECT_FILE_TOO_LARGE/);
assert.equal(preflightWriteCount, 0, "Invalid payload must never open a writable stream");
console.log("PASS PROJECT-030: native write rejects invalid and oversized bytes before disk access");
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
let alteredReadbackCount = 0;
await assert.rejects(writeProjectFile({ ...handle, async getFile() {
  // The two prewrite checks must see the legitimate associated file. The
  // replacement happens only after the app's write has completed.
  alteredReadbackCount++;
  return file("network.yadilab", alteredReadbackCount <= 2 ? stored : stored+"CORRUPT");
}}, text, { expectedFileSha256: fromDisk.fileSha256 }), /PROJECT_READBACK_MISMATCH/);
assert.equal(alteredReadbackCount, 3,
  "Readback mismatch must happen after both mandatory exact-digest conflict checks");
// PROJECT-029: UTF-8 TextDecoder silently removes a leading BOM. After the
// native write has closed, an external process can change the physical bytes
// without changing the decoded JSON text. Save must fail the exact-byte
// readback; an apparent equivalent decoded document is not verified disk I/O.
const writtenWithBom = new Uint8Array(3 + new TextEncoder().encode(text).length);
writtenWithBom.set([0xef, 0xbb, 0xbf]);
writtenWithBom.set(new TextEncoder().encode(text), 3);
assert.equal(new TextDecoder("utf-8", {fatal:true}).decode(writtenWithBom), text,
  "BOM readback fixture must prove that decoded text alone hides disk change");
let bomReadbackWrites = 0;
let bomReadbackChecks = 0;
await assert.rejects(writeProjectFile({
  async createWritable() { return {
    async write() { bomReadbackWrites++; },
    async close() {},
  }; },
  async getFile() {
    bomReadbackChecks++;
    // Save As explicitly verifies both empty-target checks before writing;
    // an external BOM insertion after close must still fail exact readback.
    if (bomReadbackChecks <= 2) return file("network.yadilab", "");
    return {
      name: "network.yadilab", size: writtenWithBom.byteLength,
      async arrayBuffer() { return writtenWithBom.buffer.slice(0); },
    };
  },
}, text, { requireEmptyTarget: true }), /PROJECT_READBACK_MISMATCH/,
"Save must refuse post-write BOM insertion even when decoded JSON is unchanged");
assert.equal(bomReadbackWrites, 1,
  "Post-write readback must check the single explicit completed write");
console.log("PASS PROJECT-029: native Save readback verifies byte-for-byte equality, not decoder-normalized JSON");
await assert.rejects(writeProjectFile({ ...handle,async createWritable() {
  return {async write(){throw Error("DISK_FULL");},async abort(){},async close(){}};
}},text, { expectedFileSha256: fromDisk.fileSha256 }),/DISK_FULL/);
// PROJECT-023: an external process can replace a verified project file with
// a very large one just before Save or during createWritable. Reject its
// advertised size BEFORE arrayBuffer() allocates memory, and never write into
// that unsafe target. The same bound applies to the verified post-write readback.
let oversizedConflictReads = 0;
let oversizedConflictWritables = 0;
await assert.rejects(writeProjectFile({
  async getFile() { return { size: PROJECT_MAX_BYTES + 1,
    async arrayBuffer() { oversizedConflictReads++; throw Error("unsafe allocation"); } }; },
  async createWritable() { oversizedConflictWritables++; throw Error("must not open"); },
}, text, { expectedFileSha256: fromDisk.fileSha256 }),
/PROJECT_EXTERNAL_FILE_CHANGED/,
"An oversized externally replaced project must be rejected before allocation");
assert.equal(oversizedConflictReads, 0);
assert.equal(oversizedConflictWritables, 0);

let conflictReadPhase = 0;
let midWriteUnsafeReads = 0;
let midWriteWrites = 0;
let midWriteAborts = 0;
await assert.rejects(writeProjectFile({
  async getFile() {
    conflictReadPhase++;
    if (conflictReadPhase === 1) return file("network.yadilab", firstWrite);
    return { size: PROJECT_MAX_BYTES + 1,
      async arrayBuffer() { midWriteUnsafeReads++; throw Error("unsafe allocation"); } };
  },
  async createWritable() { return {
    async write() { midWriteWrites++; },
    async close() { throw Error("should not close"); },
    async abort() { midWriteAborts++; },
  }; },
}, text, { expectedFileSha256: fromDisk.fileSha256 }),
/PROJECT_EXTERNAL_FILE_CHANGED/,
"An oversized replacement during writable-open must abort without writing");
assert.equal(conflictReadPhase, 2);
assert.equal(midWriteUnsafeReads, 0);
assert.equal(midWriteWrites, 0);
assert.equal(midWriteAborts, 1);

let oversizedReadbackReads = 0;
let oversizedReadbackWrites = 0;
let oversizedReadbackChecks = 0;
await assert.rejects(writeProjectFile({
  async createWritable() { return {
    async write() { oversizedReadbackWrites++; },
    async close() {},
  }; },
  async getFile() {
    oversizedReadbackChecks++;
    if (oversizedReadbackChecks <= 2) return file("network.yadilab", "");
    return { size: PROJECT_MAX_BYTES + 1,
      async arrayBuffer() { oversizedReadbackReads++; throw Error("unsafe allocation"); } };
  },
}, text, { requireEmptyTarget: true }), /PROJECT_READBACK_INVALID/,
"An oversized post-write file must not be read into browser memory");
assert.equal(oversizedReadbackWrites, 1);
assert.equal(oversizedReadbackReads, 0);
console.log("PASS PROJECT-023: Save conflict and readback reject oversized disk files before allocation");

// A genuine 10k/10k source must roundtrip every device, link, endpoint and port
// without inventing new connectivity or changing unselected canonical fields.
const large = structuredClone(source);
for (let i = 0; i < 10000; i++) {
  large.resources.push({ id: "device_" + i, type: "server.generic",
    label: "Device " + i, zone: large.zones[0].id,
    interfaces: [{ id: "eth0" }, { id: "eth1" }], properties: {} });
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
// A delayed ELK result must never commit to a different project generation,
// or overwrite an edit made while the same launch was in flight.
const startingWorkspace = { source: "old" };
const newerWorkspace = { source: "new" };
assert.equal(scenarioLaunchStillCurrent(12,12,startingWorkspace,startingWorkspace),true);
assert.equal(scenarioLaunchStillCurrent(12,13,startingWorkspace,startingWorkspace),false);
assert.equal(scenarioLaunchStillCurrent(12,12,startingWorkspace,newerWorkspace),false);
assert.equal(scenarioLaunchStillCurrent(12,12,null,null),false);
let liveEpoch = 12, liveWorkspace = startingWorkspace, committed = newerWorkspace;
let releaseLayout;
const heldLayout = new Promise(resolve => { releaseLayout = resolve; });
const staleLaunch = (async () => {
  await heldLayout;
  if (scenarioLaunchStillCurrent(12,liveEpoch,startingWorkspace,liveWorkspace))
    committed = startingWorkspace;
})();
liveEpoch = 13; liveWorkspace = newerWorkspace;
releaseLayout();
await staleLaunch;
assert.equal(committed,newerWorkspace,"Delayed layout result replaced a New project");
// Structural wiring checks: each actual asynchronous launch handler must recheck
// after the awaited layout and before touching the canonical workspace.
const uiSource = readFileSync(new URL("../../ui/app/main.mjs",import.meta.url),"utf8");
for (const action of ["openGuidedLab","openEnterpriseScenario","openVerifiedDeliveryScenario"]) {
  const start = uiSource.indexOf(`  const ${action} = async (startRuntime) => {`);
  const end = uiSource.indexOf("\n  };",start);
  assert.ok(start>=0 && end>start,action+" launch handler missing");
  const body = uiSource.slice(start,end);
  assert.match(body,/await compileBuilderWorkspace\(next, compilerOptions\);\s+if \(!isLiveLaunch\(\)\) return;/,
    action+" missing post-compile validation");
  assert.match(body,/const layout = await autoLayoutBuilder\(next, new ElkLayoutBackend\(\)\);[\s\S]*?if \(!isLiveLaunch\(\)\) return;\s+if \(!layout\.ok\)/,
    action+" missing post-ELK validation before diagnostics");
}
// PROJECT-004: schema-valid but cyclic zone parent references must never
// enter editable project files. The compiler rejects cycles, so the manual
// Save/Open boundary must reject them too rather than admitting hidden zones.
const selfParent = structuredClone(source);
selfParent.zones[0].parent = selfParent.zones[0].id;
assert.equal(validateSource(selfParent), true, "fixture must pass the source JSON schema");
await assert.rejects(createProjectDocument({ ...workspace, source: selfParent }, opts),
  /PROJECT_ZONE_PARENT_CYCLE/, "self-parent must be rejected before writing");
const twoZoneCycle = structuredClone(source);
twoZoneCycle.zones[0].parent = twoZoneCycle.zones[1].id;
twoZoneCycle.zones[1].parent = twoZoneCycle.zones[0].id;
assert.equal(validateSource(twoZoneCycle), true);
await assert.rejects(createProjectDocument({ ...workspace, source: twoZoneCycle }, opts),
  /PROJECT_ZONE_PARENT_CYCLE/, "mutual zone parent cycle must be blocked");

// An attacker can forge a fresh, valid SHA-256 over a cyclic project file.
// Structural validation, NOT just checksum equality, must reject it on Open.
const forgedCycle = structuredClone(doc);
forgedCycle.content.source.zones[0].parent = forgedCycle.content.source.zones[0].id;
forgedCycle.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(JSON.stringify(forgedCycle.content))
)).toString("hex");
await assert.rejects(readProjectDocument(JSON.stringify(forgedCycle), opts),
  /PROJECT_ZONE_PARENT_CYCLE/, "validly hashed cyclic project must not be opened");

// Iterative ancestry validation must support deeply nested acyclic zones
// without recursion overflow or quadratic work at project-file scale.
const deepZones = structuredClone(source);
for (let i = 0; i < 5000; i++) deepZones.zones.push({
  id: "depth_" + i, label: "Depth " + i, kind: "custom",
  ...(i ? { parent: "depth_" + (i - 1) } : {}),
});
const deepText = await createProjectDocument({ ...workspace, source: deepZones }, opts);
assert.deepEqual((await readProjectDocument(deepText, opts)).source.zones, deepZones.zones);
const deepCycle = structuredClone(deepZones);
deepCycle.zones[4].parent = "depth_4999";
await assert.rejects(createProjectDocument({ ...workspace, source: deepCycle }, opts),
  /PROJECT_ZONE_PARENT_CYCLE/, "long ancestor loop must be rejected");
console.log("PASS PROJECT-004: self, mutual, forged-valid-hash and deep ancestor cycles rejected; nested acyclic zones preserved");
// PROJECT-005: a checksum-correct .yadilab document must not admit links
// to missing ports or ambiguous duplicate interface IDs, even if JSON schema
// itself accepts the object. These invariants already exist in the Compiler.
const missingPort = structuredClone(source);
missingPort.connections[0].from.port = "ghost_port";
assert.equal(validateSource(missingPort), true, "missing port fixture is schema-valid");
await assert.rejects(
  createProjectDocument({ ...workspace, source: missingPort }, opts),
  /PROJECT_UNKNOWN_CONNECTION_PORT/,
  "Save must refuse links pointing at undeclared source-side ports");
const missingToPort = structuredClone(source);
missingToPort.connections[0].to.port = "ghost_port";
assert.equal(validateSource(missingToPort), true);
await assert.rejects(
  createProjectDocument({ ...workspace, source: missingToPort }, opts),
  /PROJECT_UNKNOWN_CONNECTION_PORT/,
  "Save must refuse links pointing at undeclared target-side ports");
const duplicatePorts = structuredClone(source);
duplicatePorts.resources[0].interfaces = [{ id: "eth0" }, { id: "eth0" }];
assert.equal(validateSource(duplicatePorts), true);
await assert.rejects(
  createProjectDocument({ ...workspace, source: duplicatePorts }, opts),
  /PROJECT_DUPLICATE_INTERFACE_ID/,
  "Save must refuse duplicate interface identity within a resource");
const validPorts = structuredClone(source);
validPorts.resources[0].interfaces = [{ id: "eth0" }, { id: "eth1" }];
validPorts.resources[1].interfaces = [{ id: "outside" }];
validPorts.connections[0].from.port = "eth0";
validPorts.connections[0].to.port = "outside";
const validPortsText = await createProjectDocument({ ...workspace, source: validPorts }, opts);
assert.deepEqual((await readProjectDocument(validPortsText, opts)).source, validPorts,
  "Valid source- and target-port identities must survive exact roundtrip");
const forgedMissingPort = structuredClone(doc);
forgedMissingPort.content.source.connections[0].from.port = "ghost_port";
forgedMissingPort.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(JSON.stringify(forgedMissingPort.content))
)).toString("hex");
await assert.rejects(
  readProjectDocument(JSON.stringify(forgedMissingPort), opts),
  /PROJECT_UNKNOWN_CONNECTION_PORT/,
  "Correctly rehashed corrupt port reference must fail on Open");
const forgedDuplicatePorts = structuredClone(doc);
forgedDuplicatePorts.content.source.resources[0].interfaces = [{id: "eth0"}, {id: "eth0"}];
forgedDuplicatePorts.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(JSON.stringify(forgedDuplicatePorts.content))
)).toString("hex");
await assert.rejects(
  readProjectDocument(JSON.stringify(forgedDuplicatePorts), opts),
  /PROJECT_DUPLICATE_INTERFACE_ID/,
  "Correctly rehashed ambiguous ports must fail on Open");
console.log("PASS PROJECT-005: missing endpoints and duplicate port IDs fail closed; declared 10k link/port references and valid mappings roundtrip");
// PROJECT-006: preserve the chain from findings to real evidence tests and
// from annotations to existing canonical objects. JSON schema and SHA-256
// alone cannot prove that these references are resolvable.
const orphanEvidence = structuredClone(source);
orphanEvidence.findings[0].evidenceTests = ["not_a_test"];
assert.equal(validateSource(orphanEvidence), true, "orphan evidence is schema-valid");
await assert.rejects(createProjectDocument({ ...workspace, source: orphanEvidence }, opts),
  /PROJECT_UNKNOWN_EVIDENCE_TEST/, "Save must refuse an evidence reference to a missing test");
const orphanNote = structuredClone(source);
orphanNote.notes = [{ id: "orphan_note", text: "Source was inspected", target: "not_a_resource" }];
assert.equal(validateSource(orphanNote), true, "orphan note is schema-valid");
await assert.rejects(createProjectDocument({ ...workspace, source: orphanNote }, opts),
  /PROJECT_UNKNOWN_NOTE_TARGET/, "Save must refuse a note attached to a missing object");
const validEvidence = structuredClone(source);
validEvidence.notes = [
  { id: "network_note", text: "Reviewed connection", target: "fw_rds" },
  { id: "test_note", text: "Test evidence", target: "direct_rdp" },
  { id: "zone_note", text: "Zone location", target: "dmz" },
];
const validEvidenceText = await createProjectDocument({ ...workspace, source: validEvidence }, opts);
assert.deepEqual((await readProjectDocument(validEvidenceText, opts)).source, validEvidence,
  "Valid evidence, note targets and link identities must survive exact project roundtrip");
for (const [label, mutate, code] of [
  ["orphan evidence", d => { d.content.source.findings[0].evidenceTests = ["not_a_test"]; },
    /PROJECT_UNKNOWN_EVIDENCE_TEST/],
  ["orphan note", d => { d.content.source.notes = [
    { id: "orphan_note", text: "Source was inspected", target: "not_a_resource" }]; },
    /PROJECT_UNKNOWN_NOTE_TARGET/],
]) {
  const forged = structuredClone(doc);
  mutate(forged);
  forged.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(forged.content))
  )).toString("hex");
  await assert.rejects(readProjectDocument(JSON.stringify(forged), opts), code,
    "Open must refuse correctly rehashed " + label);
}
console.log("PASS PROJECT-006: orphan finding evidence and note targets rejected on Save/Open; valid references roundtrip");
// PROJECT-007: the Compiler rejects orphan solution mutations and layout
// references, but a SHA-256-correct .yadilab file must fail earlier on Open.
// Unknown IDs cannot silently become verified repairs or drawn objects.
const invalidSolutionTarget = structuredClone(source);
invalidSolutionTarget.canonicalSolution.operations[0].target = "missing_device";
assert.equal(validateSource(invalidSolutionTarget), true, "solution orphan is schema-valid");
await assert.rejects(createProjectDocument(
  { ...workspace, source: invalidSolutionTarget }, opts),
  /PROJECT_UNKNOWN_SOLUTION_TARGET/,
  "Save must reject a repair operation targeting a non-existent resource");

// PROJECT-060: a correct JSON schema and exact SHA-256 cannot authorize
// canonical repair operations that Engine will reject as identity rewrites.
for (const badPath of [
  "id", "type", "zone", "label", "interfaces", "interfaces.0.id",
  "interfaces.0.name", "properties.__proto__.polluted",
  "properties.constructor.prototype.access",
  "interfaces.9999999999999999999999999.addresses",
]) {
  const unsafe = structuredClone(source);
  unsafe.canonicalSolution.operations[0].path = badPath;
  assert.equal(validateSource(unsafe), true, "unsafe solution path remains schema-valid: " + badPath);
  await assert.rejects(createProjectDocument({ ...workspace, source: unsafe }, opts),
    /PROJECT_SOLUTION_OPERATION_PATH_FORBIDDEN/,
    "Save refuses unsupported canonical repair path before any native write: " + badPath);
}
const safeOperations = structuredClone(source);
safeOperations.canonicalSolution.operations = [
  { op: "set", target: "rds01", path: "properties.nla", value: true },
  { op: "set", target: "rds01", path: "interfaces.0.addresses", value: ["192.0.2.7"] },
];
const safeOperationText = await createProjectDocument({ ...workspace, source: safeOperations }, opts);
assert.deepEqual((await readProjectDocument(safeOperationText, opts)).source.canonicalSolution,
  safeOperations.canonicalSolution,
  "Save/Open preserves canonical repair edits that stay inside mutable state");


const invalidHintTarget = structuredClone(source);
invalidHintTarget.layoutHints[0].target = "missing_device";
assert.equal(validateSource(invalidHintTarget), true, "layout target orphan is schema-valid");
await assert.rejects(createProjectDocument(
  { ...workspace, source: invalidHintTarget }, opts),
  /PROJECT_UNKNOWN_LAYOUT_TARGET/,
  "Save must reject a layout hint for a missing resource or zone");

const invalidHintParent = structuredClone(source);
invalidHintParent.layoutHints[0].parent = "missing_zone";
assert.equal(validateSource(invalidHintParent), true, "layout parent orphan is schema-valid");
await assert.rejects(createProjectDocument(
  { ...workspace, source: invalidHintParent }, opts),
  /PROJECT_UNKNOWN_LAYOUT_PARENT/,
  "Save must reject a layout hint with a missing parent zone");

const validLayoutAndSolution = structuredClone(source);
validLayoutAndSolution.layoutHints = [
  { target: "firewall01", parent: "dmz", rank: 1 },
  { target: "wan", rank: 0 },
  { target: "rds01", parent: "server", order: 2 },
];
const validLayoutText = await createProjectDocument(
  { ...workspace, source: validLayoutAndSolution }, opts);
assert.deepEqual((await readProjectDocument(validLayoutText, opts)).source,
  validLayoutAndSolution, "Valid layout hierarchy and repair targets must roundtrip exactly");

for (const [kind, mutate, expected] of [
  ["solution target", d => { d.content.source.canonicalSolution.operations[0].target = "missing_device"; },
    /PROJECT_UNKNOWN_SOLUTION_TARGET/],
  ["solution identity rewrite", d => { d.content.source.canonicalSolution.operations[0].path = "id"; },
    /PROJECT_SOLUTION_OPERATION_PATH_FORBIDDEN/],
  ["solution interface identity rewrite", d => { d.content.source.canonicalSolution.operations[0].path = "interfaces.0.id"; },
    /PROJECT_SOLUTION_OPERATION_PATH_FORBIDDEN/],
  ["solution prototype mutation", d => { d.content.source.canonicalSolution.operations[0].path = "properties.__proto__.polluted"; },
    /PROJECT_SOLUTION_OPERATION_PATH_FORBIDDEN/],
  ["layout target", d => { d.content.source.layoutHints[0].target = "missing_device"; },
    /PROJECT_UNKNOWN_LAYOUT_TARGET/],
  ["layout parent", d => { d.content.source.layoutHints[0].parent = "missing_zone"; },
    /PROJECT_UNKNOWN_LAYOUT_PARENT/],
]) {
  const forged = structuredClone(doc);
  mutate(forged);
  forged.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(forged.content))
  )).toString("hex");
  await assert.rejects(readProjectDocument(JSON.stringify(forged), opts),
    expected, "Open must reject SHA-256-correct orphan " + kind);
}
console.log("PASS PROJECT-007: unknown solution/layout targets and hint parent fail on Save/Open; valid nested layouts roundtrip");
// PROJECT-008: source.hints items are schema-defined as {level, text}, not
// globally identified resources. A valid training project must not be denied
// Save/Open simply because its editorial hints have no `id` property.
const sourceWithHints = structuredClone(source);
sourceWithHints.hints = [
  { level: 1, text: "Inspect the perimeter before applying a repair." },
  { level: 2, text: "Check the verified network evidence." },
  { level: 2, text: "Keep the original link and port identities." },
];
assert.equal(validateSource(sourceWithHints), true,
  "Hint objects without IDs are valid scenario-source schema");
const hintedWorkspace = { ...workspace, source: sourceWithHints };
const hintedText = await createProjectDocument(hintedWorkspace, opts);
const reopenedHints = await readProjectDocument(hintedText, opts);
assert.deepEqual(reopenedHints.source, sourceWithHints,
  "Saving and opening a project must preserve all hints without inventing IDs");
assert.deepEqual(reopenedHints.source.hints, sourceWithHints.hints,
  "Ordered hints, repeated levels and original text must survive an exact roundtrip");
assert.deepEqual((await readProjectFile(file("hints.yadilab", hintedText), opts)).source.hints,
  sourceWithHints.hints, "A native .yadilab file with hints must reopen");
assert.equal(reopenedHints.source.resources.length, source.resources.length,
  "Hint roundtrip must not change resources or network links");
assert.deepEqual(reopenedHints.layoutOverrides, workspace.layoutOverrides,
  "Hint roundtrip must retain explicit Builder layout");
const malformedHints = structuredClone(source);
malformedHints.hints = [{ level: 1, text: "Do not accept undeclared keys", id: "fake" }];
assert.equal(validateSource(malformedHints), false,
  "Hints with invented IDs must still fail the canonical source schema");
await assert.rejects(createProjectDocument(
  { ...workspace, source: malformedHints }, opts),
  /PROJECT_SOURCE_SCHEMA_INVALID/,
  "Accepting valid hints must not weaken schema validation");
console.log("PASS PROJECT-008: schema-valid hint arrays Save/Open without fake IDs; text/order/layout preserved and malformed hint rejected");
// PROJECT-009: compiler-known test types require resolvable resource
// selectors and valid basic parameters, and troubleshooting evidence must
// refer to a real resource with unambiguous local requirement identities.
// JSON schema permits these dangling semantics; Save/Open must fail closed.
const badTestResource = structuredClone(source);
badTestResource.tests.push({
  id: "port_scan_missing_source", type: "network.port_scan",
  params: { from: "missing_device", to: "rds01", port: 443 },
});
assert.equal(validateSource(badTestResource), true);
await assert.rejects(createProjectDocument({ ...workspace, source: badTestResource }, opts),
  /PROJECT_UNKNOWN_TEST_RESOURCE/, "Save must reject unknown test source resources");
const badTestParam = structuredClone(source);
badTestParam.tests.push({
  id: "bad_port_scan", type: "network.port_scan",
  params: { from: "attacker", to: "rds01", port: 0 },
});
assert.equal(validateSource(badTestParam), true);
await assert.rejects(createProjectDocument({ ...workspace, source: badTestParam }, opts),
  /PROJECT_TEST_PARAM_REQUIRED/, "Save must reject invalid required scan port");
const badTestTarget = structuredClone(source);
badTestTarget.tests.push({
  id: "missing_audit_target", type: "identity.password_audit",
  params: { target: "not_a_device" },
});
assert.equal(validateSource(badTestTarget), true);
await assert.rejects(createProjectDocument({ ...workspace, source: badTestTarget }, opts),
  /PROJECT_UNKNOWN_TEST_RESOURCE/, "Save must reject missing known test target");
const badTestOption = structuredClone(source);
badTestOption.tests.push({
  id: "bad_optional_type", type: "logging.visibility_test",
  params: { target: "rds01", equals: "true" },
});
assert.equal(validateSource(badTestOption), true);
await assert.rejects(createProjectDocument({ ...workspace, source: badTestOption }, opts),
  /PROJECT_TEST_PARAM_INVALID/, "Save must reject invalid known test option");

const troubleshootingFixture = () => ({
  id: "troubleshooting_network", title: "Review network signals",
  required: true, evidenceOrder: "ordered",
  requirements: [
    { id: "route_observation", label: "Observe interface",
      kind: "observation", targetId: "firewall01" },
    { id: "reachability_probe", label: "Check reachability",
      kind: "active_probe", sourceId: "attacker", destinationId: "rds01" },
  ],
});
const invalidTroubleshooting = structuredClone(source);
invalidTroubleshooting.troubleshootingObjectives = [troubleshootingFixture()];
invalidTroubleshooting.troubleshootingObjectives[0].requirements[1].sourceId = "missing_device";
assert.equal(validateSource(invalidTroubleshooting), true);
await assert.rejects(createProjectDocument(
  { ...workspace, source: invalidTroubleshooting }, opts),
  /PROJECT_UNKNOWN_TROUBLESHOOTING_RESOURCE/,
  "Save must reject active probe against an absent source resource");
const invalidObservation = structuredClone(source);
invalidObservation.troubleshootingObjectives = [troubleshootingFixture()];
invalidObservation.troubleshootingObjectives[0].requirements[0].targetId = "missing_device";
assert.equal(validateSource(invalidObservation), true);
await assert.rejects(createProjectDocument(
  { ...workspace, source: invalidObservation }, opts),
  /PROJECT_UNKNOWN_TROUBLESHOOTING_RESOURCE/,
  "Save must reject observation targeting absent resource");
const duplicateRequirement = structuredClone(source);
duplicateRequirement.troubleshootingObjectives = [troubleshootingFixture()];
duplicateRequirement.troubleshootingObjectives[0].requirements[1].id = "route_observation";
assert.equal(validateSource(duplicateRequirement), true);
await assert.rejects(createProjectDocument(
  { ...workspace, source: duplicateRequirement }, opts),
  /PROJECT_DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID/,
  "Save must reject ambiguous requirement identity within one objective");
const emptyRequirement = structuredClone(source);
emptyRequirement.troubleshootingObjectives = [troubleshootingFixture()];
emptyRequirement.troubleshootingObjectives[0].requirements[0] = {
  id: "route_observation", label: "Missing selector", kind: "observation",
};
assert.equal(validateSource(emptyRequirement), true);
await assert.rejects(createProjectDocument(
  { ...workspace, source: emptyRequirement }, opts),
  /PROJECT_TROUBLESHOOTING_REQUIREMENT_EMPTY/,
  "Save must reject evidence requirements with no selectors");

const validTestTroubleshooting = structuredClone(source);
validTestTroubleshooting.tests.push(
  { id: "valid_scan", type: "network.port_scan",
    params: { from: "attacker", to: "rds01", ports: [80, 443], protocol: "tcp" } },
  { id: "valid_audit", type: "identity.password_audit",
    params: { target: "rds01", equals: false } },
);
validTestTroubleshooting.troubleshootingObjectives = [troubleshootingFixture()];
assert.equal(validateSource(validTestTroubleshooting), true);
const validTestFile = await createProjectDocument(
  { ...workspace, source: validTestTroubleshooting }, opts);
assert.deepEqual((await readProjectDocument(validTestFile, opts)).source,
  validTestTroubleshooting, "Valid test selectors and evidence requirements must roundtrip exactly");

for (const [caseName, corrupt, expected] of [
  ["test reference", p => p.source.tests.push({
    id: "forged_audit", type: "identity.password_audit",
    params: { target: "missing_device" },
  }), /PROJECT_UNKNOWN_TEST_RESOURCE/],
  ["troubleshooting probe", p => {
    p.source.troubleshootingObjectives = [troubleshootingFixture()];
    p.source.troubleshootingObjectives[0].requirements[1].destinationId = "missing_device";
  }, /PROJECT_UNKNOWN_TROUBLESHOOTING_RESOURCE/],
  ["duplicate troubleshooting IDs", p => {
    p.source.troubleshootingObjectives = [troubleshootingFixture()];
    p.source.troubleshootingObjectives[0].requirements[1].id = "route_observation";
  }, /PROJECT_DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID/],
]) {
  const forged = structuredClone(doc);
  corrupt(forged.content);
  forged.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(forged.content))
  )).toString("hex");
  await assert.rejects(readProjectDocument(JSON.stringify(forged), opts),
    expected, "Open must reject correctly hashed " + caseName);
}
// PROJECT-050: a checksum-valid .yadilab must not contain dangling Foundation
// selectors, malformed network port/protocol or ambiguous scan ranges. Match
// the Compiler's test contract on BOTH explicit Save and untrusted Open.
const invalidProjectTests = [
  ["network.reachability",{from:"ghost",to:"rds01",protocol:"tcp",port:3389},
   "UNKNOWN_TEST_RESOURCE"],
  ["network.segmentation",{from:"attacker",to:"ghost",protocol:"tcp"},
   "UNKNOWN_TEST_RESOURCE"],
  ["network.route_test",{from:"attacker",to:"rds01",protocol:"ftp"},
   "TEST_PARAM_INVALID"],
  ["network.reachability",{from:"attacker",to:"rds01"},"TEST_PARAM_REQUIRED"],
  ["network.segmentation",{from:"attacker",to:"rds01",protocol:"tcp",port:70000},
   "TEST_PARAM_INVALID"],
  ["network.route_test",{from:"attacker",to:"rds01",protocol:"udp"},"TEST_PARAM_REQUIRED"],
  ["network.route_test",{from:"attacker",to:"rds01",protocol:"icmp",port:443},
   "TEST_PARAM_INVALID"],
  ["identity.authentication_test",{subject:"ghost",target:"rds01"},"UNKNOWN_TEST_RESOURCE"],
  ["identity.authentication_test",{subject:"attacker",target:"ghost"},"UNKNOWN_TEST_RESOURCE"],
  ["identity.privilege_path",{subject:"attacker",resource:"ghost",permission:"read"},
   "UNKNOWN_TEST_RESOURCE"],
  ["identity.permission",{subject:"attacker",resource:"rds01"},"TEST_PARAM_REQUIRED"],
  ["identity.permission",{subject:"ghost",resource:"rds01",permission:"read"},
   "UNKNOWN_TEST_RESOURCE"],
  ["identity.membership",{subject:"attacker",group:"ghost"},"UNKNOWN_TEST_RESOURCE"],
  ["windows.hardening_check",{target:"ghost",path:"properties.nla",equals:true},
   "UNKNOWN_TEST_RESOURCE"],
  ["windows.hardening_check",{target:"rds01",equals:true},"TEST_PARAM_REQUIRED"],
  ["linux.hardening_check",{target:"rds01",path:"properties.enabled"},"TEST_PARAM_REQUIRED"],
  ["network.port_scan",{from:"attacker",to:"rds01",port:443,ports:[22]},
   "TEST_PARAM_AMBIGUOUS"],
  ["network.port_scan",{from:"attacker",to:"rds01",port:0,ports:[22]},
   "TEST_PARAM_INVALID"],
  ["network.port_scan",{from:"attacker",to:"rds01",port:443,ports:["ssh"]},
   "TEST_PARAM_INVALID"],
];
for (const [kind,params,code] of invalidProjectTests) {
  const test = {id:"project_050_test",type:kind,params};
  const changed=structuredClone(source);
  changed.tests.push(test);
  assert.equal(validateSource(changed),true,
    "JSON shape alone does not enforce " + kind + " semantics");
  await assert.rejects(
    createProjectDocument({...workspace,source:changed},opts),
    new RegExp("PROJECT_" + code),
    "Manual Save must fail before writing a broken " + kind);
  const forged=structuredClone(doc);
  forged.content.source.tests.push(test);
  forged.contentSha256=Buffer.from(await webcrypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(JSON.stringify(forged.content))
  )).toString("hex");
  await assert.rejects(readProjectDocument(JSON.stringify(forged),opts),
    new RegExp("PROJECT_" + code),
    "A correctly rehashed malformed " + kind + " must not reopen");
}
for (const [name,test] of [
  ["route_test implicit any protocol",
   {id:"project_050_route",type:"network.route_test",
    params:{from:"attacker",to:"rds01"}}],
  ["reachability explicit ICMP without port",
   {id:"project_050_icmp",type:"network.reachability",
    params:{from:"attacker",to:"rds01",protocol:"icmp"}}],
  ["permission declared subject, object and permission",
   {id:"project_050_permission",type:"identity.permission",
    params:{subject:"attacker",resource:"rds01",permission:"read"}}],
  ["membership declared subject and group",
   {id:"project_050_group",type:"identity.membership",
    params:{subject:"attacker",group:"admin01"}}],
  ["hardening declared property comparison",
   {id:"project_050_hardening",type:"linux.hardening_check",
    params:{target:"rds01",path:"properties.security.enabled",equals:false}}],
  ["port scan exact ports list",
   {id:"project_050_scan",type:"network.port_scan",
    params:{from:"attacker",to:"rds01",ports:[22,443]}}],
]) {
  const changed=structuredClone(source);
  changed.tests.push(test);
  const saved=await createProjectDocument({...workspace,source:changed},opts);
  const opened=await readProjectDocument(saved,opts);
  assert.deepEqual(opened.source.tests.at(-1),test,
    "Valid " + name + " must survive explicit verified hash roundtrip");
  assert.deepEqual(opened.layoutOverrides,workspace.layoutOverrides);
}
console.log("PASS PROJECT-050: all Foundation test selectors/ports fail closed on native Save and correctly rehashed Open");

console.log("PASS PROJECT-009: test params and troubleshooting evidence fail closed on Save/Open, valid selectors and source roundtrip");
// PROJECT-010: JSON schema validates rule syntax, but unlike Compiler
// semantics it does not prove that referenced test and resource IDs exist.
// Check all rule forms including deeply nested all/any/not, at Save and Open.
const brokenRuleCases = [
  ["equals.target", p => { p.completion = {
    op: "equals", target: "missing_device", path: "properties.enabled", value: true,
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["service_enabled.target", p => { p.completion = {
    op: "service_enabled", target: "missing_device", service: "ssh",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["reachable.from", p => { p.completion = {
    op: "reachable", from: "missing_device", to: "rds01",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["reachable.to", p => { p.completion = {
    op: "reachable", from: "attacker", to: "missing_device",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["member_of.group", p => { p.findings[0].when = {
    op: "member_of", subject: "attacker", group: "missing_device",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["member_of.subject", p => { p.findings[0].when = {
    op: "member_of", subject: "missing_device", group: "rds01",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["has_permission.subject", p => { p.objectives[0].condition = {
    op: "has_permission", subject: "missing_device",
    resource: "rds01", permission: "read",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["has_permission.resource", p => { p.objectives[0].condition = {
    op: "has_permission", subject: "attacker",
    resource: "missing_device", permission: "read",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["test_result.test", p => { p.completion = {
    op: "test_result", test: "missing_test", expected: "TRUE",
  }; }, /PROJECT_UNKNOWN_RULE_TEST/],
  ["nested any/not/test_result", p => { p.completion = {
    op: "all", rules: [{ op: "any", rules: [
      { op: "reachable", from: "attacker", to: "rds01" },
      { op: "not", rule: { op: "test_result", test: "missing_test", expected: "FALSE" } },
    ] }],
  }; }, /PROJECT_UNKNOWN_RULE_TEST/],
];
for (const [label, mutate, expected] of brokenRuleCases) {
  const broken = structuredClone(source);
  mutate(broken);
  assert.equal(validateSource(broken), true, label + " fixture must pass JSON schema");
  await assert.rejects(createProjectDocument({ ...workspace, source: broken }, opts),
    expected, "Save must reject schema-valid dangling " + label);
}
const validRules = structuredClone(source);
validRules.findings[0].when = {
  op: "all", rules: [
    { op: "reachable", from: "attacker", to: "rds01", protocol: "tcp", port: 3389 },
    { op: "not", rule: { op: "test_result", test: "admin_rdp", expected: "FALSE" } },
  ],
};
validRules.objectives[0].condition = {
  op: "any", rules: [
    { op: "equals", target: "firewall01", path: "properties.rules.0.action", value: "deny" },
    { op: "service_enabled", target: "rds01", service: "rdp" },
  ],
};
validRules.completion = {
  op: "all", rules: [
    { op: "member_of", subject: "attacker", group: "admin01" },
    { op: "has_permission", subject: "admin01", resource: "rds01", permission: "read" },
    { op: "test_result", test: "direct_rdp", expected: "FALSE" },
  ],
};
assert.equal(validateSource(validRules), true);
const validRuleText = await createProjectDocument({ ...workspace, source: validRules }, opts);
assert.deepEqual((await readProjectDocument(validRuleText, opts)).source, validRules,
  "Valid nested rule references and original identities must roundtrip exactly");
for (const [label, mutate, expected] of [
  ["missing completion resource", p => { p.source.completion = {
    op: "reachable", from: "missing_device", to: "rds01",
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
  ["unknown finding test", p => { p.source.findings[0].when = {
    op: "test_result", test: "missing_test", expected: "TRUE",
  }; }, /PROJECT_UNKNOWN_RULE_TEST/],
  ["nested objective resource", p => { p.source.objectives[0].condition = {
    op: "any", rules: [{ op: "not", rule: {
      op: "has_permission", subject: "attacker",
      resource: "missing_device", permission: "read",
    } }],
  }; }, /PROJECT_UNKNOWN_RULE_RESOURCE/],
]) {
  const forged = structuredClone(doc);
  mutate(forged.content);
  forged.contentSha256 = Buffer.from(await webcrypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(forged.content))
  )).toString("hex");
  await assert.rejects(readProjectDocument(JSON.stringify(forged), opts),
    expected, "Open must reject a valid-hash project with " + label);
}
console.log("PASS PROJECT-010: all nested rule resource/test IDs checked at Save/Open; valid rules and identities preserved");
// PROJECT-012: File System Access exposes a point-in-time File snapshot.
// The physical file can change after Open obtains it but before association.
// Only a second, exact-fingerprint read of the original handle can authorize
// association to the selected project; no disk write is part of Open.
const openRead = await readProjectFile(file("open-snapshot.yadilab", text), opts);
let liveOpenBytes = text;
let openReadCalls = 0;
const openDiskHandle = {
  async getFile() {
    openReadCalls++;
    return file("open-snapshot.yadilab", liveOpenBytes);
  },
};
assert.equal(await assertProjectOpenDiskUnchanged(openDiskHandle,
  openRead.fileSha256), true, "Identical selected disk bytes permit Open");
assert.equal(openReadCalls, 1, "Readback must inspect the original physical handle");
liveOpenBytes += " EXTERNAL_CHANGE_AFTER_SNAPSHOT";
await assert.rejects(assertProjectOpenDiskUnchanged(
  openDiskHandle, openRead.fileSha256), /PROJECT_EXTERNAL_FILE_CHANGED_DURING_OPEN/,
  "An external write after File snapshot must invalidate Open");
liveOpenBytes = text;
await assert.rejects(assertProjectOpenDiskUnchanged(
  { async getFile() { throw new Error("Access revoked"); } },
  openRead.fileSha256), /PROJECT_OPEN_READBACK_UNAVAILABLE/,
  "Unverifiable physical file cannot be associated");
await assert.rejects(assertProjectOpenDiskUnchanged({
  async getFile() { return { size: PROJECT_MAX_BYTES + 1,
    async arrayBuffer() { throw new Error("must reject before allocating"); } }; },
}, openRead.fileSha256), /PROJECT_OPEN_READBACK_UNAVAILABLE/,
  "Open readback must enforce the file size bound before reading");
await assert.rejects(assertProjectOpenDiskUnchanged(
  openDiskHandle, "invalid"), /PROJECT_EXPECTED_DIGEST_INVALID/,
  "Open readback must not bypass the required SHA-256 fingerprint");
console.log("PASS PROJECT-012: native Open detects physical disk swap after verified snapshot; changed/unreadable handles rejected");
// PROJECT-013: a different canonical scenario must never inherit the
// previously selected native .yadilab just because its revision is higher.
const savedScenario = {
  mode: "builder", source: { scenarioId: "previous_scenario" },
  sourceRevision: 12, dirty: false,
};
const genuineEdit = {
  mode: "builder", source: { scenarioId: "previous_scenario" },
  sourceRevision: 13, dirty: true,
};
assert.equal(sameEditableProjectRevision(savedScenario, genuineEdit), true,
  "Normal edits must retain their native file association");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, source: { scenarioId: "different_scenario" },
}), false, "A dirty new scenario with higher revision must detach the previous file");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, sourceRevision: 12,
}), false, "Equal revision cannot prove an edit belongs to same project");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, dirty: false,
}), false, "New source with no declared edit must not silently rebind a file");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, mode: "runtime",
}), false, "Runtime activation is not a local Builder edit");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, sourceRevision: Number.POSITIVE_INFINITY,
}), false, "Malformed revision must not preserve project handle");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, source: { scenarioId: "" },
}), false, "Empty canonical scenario identity must never retain an existing handle");
// PROJECT-014: an explicit project transition is stronger than a reused
// public scenario ID. Distinct native projects may have the same scenarioId
// and independent revision counters, so those are not proof of file lineage.
assert.equal(sameEditableProjectRevision(savedScenario, genuineEdit, false), true,
  "An ordinary in-place Builder edit preserves the known native association");
assert.equal(sameEditableProjectRevision(savedScenario, genuineEdit, true), false,
  "A switched project with the SAME ID and HIGHER revision must detach");
assert.equal(sameEditableProjectRevision({
  ...savedScenario, source: { scenarioId: "import_reused_name" },
}, {
  ...genuineEdit, source: { scenarioId: "import_reused_name" },
}, true), false,
  "A higher-revision imported project may not inherit a same-ID handle");
assert.equal(sameEditableProjectRevision(savedScenario, {
  ...genuineEdit, sourceRevision: 13, source: { scenarioId: "another_project" },
}, true), false,
  "Cross-project replacement stays detached even when the scenario differs");
// PROJECT-048: React may not have painted a new authored scenario when the
// user presses Save. The old native handle must NEVER survive that pending
// project-transition generation, including with a reused canonical public ID.
const attachedProject = {
  mode: "builder", source: { scenarioId: "shared_project", metadata: { title: "Previously saved" } },
  sourceRevision: 12, dirty: false, layoutOverrides: [],
};
const sameSourceSelection = { ...attachedProject, selection: { ids: [] } };
const attachedEdit = {
  ...attachedProject, sourceRevision: 13, dirty: true,
  source: { scenarioId: "shared_project", metadata: { title: "Newly edited" } },
};
const replacedSameId = {
  ...attachedEdit, sourceRevision: 999, dirty: true,
  source: { scenarioId: "shared_project", metadata: { title: "Different project" } },
};
const replacedDifferentId = {
  ...attachedEdit, source: { scenarioId: "different_project" },
};
for (const [name, previous, live, originGeneration, liveGeneration, expected] of [
  ["unchanged workspace", attachedProject, attachedProject, 17, 17, true],
  ["selection-only", attachedProject, sameSourceSelection, 17, 17, true],
  ["ordinary same-project edit", attachedProject, attachedEdit, 17, 17, true],
  ["source edit after generation switch", attachedProject, attachedEdit, 17, 18, false],
  ["new project with reused scenario ID", attachedProject, replacedSameId, 17, 18, false],
  ["new project with different scenario ID", attachedProject, replacedDifferentId, 17, 18, false],
  ["different identity with no generation", attachedProject, replacedDifferentId, 17, 17, false],
  ["equal revision is not an edit", attachedProject,
    { ...attachedEdit, sourceRevision: 12 }, 17, 17, false],
  ["unmarked replacement is not an edit", attachedProject,
    { ...attachedEdit, dirty: false }, 17, 17, false],
  ["source change from untracked runtime", { mode: "runtime", source: attachedProject.source },
    { mode: "runtime", source: replacedDifferentId.source }, 17, 17, false],
  ["rendered runtime may remain current", { mode: "runtime", source: attachedProject.source },
    { mode: "runtime", source: attachedProject.source }, 17, 17, true],
  ["builder-runtime mode changes are different", attachedProject,
    { mode: "runtime", source: attachedProject.source }, 17, 17, false],
  ["malformed origin generation", attachedProject, attachedProject, -1, -1, false],
  ["fractional generation", attachedProject, attachedProject, 1.5, 1.5, false],
  ["missing current source", attachedProject, null, 17, 17, false],
]) assert.equal(projectFileAssociationStillCurrent(previous, live,
    originGeneration, liveGeneration), expected,
    "PROJECT-048 file association policy: " + name);
console.log("PASS PROJECT-048: Save association distinguishes same-turn project replacement from valid Builder edits");

console.log("PASS PROJECT-014: explicit scenario transition invalidates native file association even for reused scenario ID");
console.log("PASS PROJECT-013: native project association retained only for same-scenario Builder edits");
// PROJECT-016: an in-flight explicit project operation requires a closing
// warning even for a clean, previously verified project file. This is distinct
// from dirty source and must clear when the operation has settled.
assert.equal(projectNeedsUnloadWarning(false, false), false,
  "A clean, idle project must not produce a needless unload warning");
assert.equal(projectNeedsUnloadWarning(true, false), true,
  "Unsaved source changes must request the browser closing warning");
assert.equal(projectNeedsUnloadWarning(false, true), true,
  "A clean but actively saving/opening project must request the warning");
assert.equal(projectNeedsUnloadWarning(true, true), true,
  "Concurrent dirty state and active operation must keep the warning");
assert.equal(projectNeedsUnloadWarning(false, false), false,
  "After completion, a clean project must return to ordinary closing behavior");
console.log("PASS PROJECT-016: beforeunload warning covers active native file I/O as well as unsaved Builder state");
// PROJECT-017: native write failure can leave disk state uncertain while the
// in-memory source is byte-for-byte equal to the last verified baseline.
// The failed-write unpersisted marker, not source differences alone, must
// continue to force both discard confirmation and beforeunload protection.
const verifiedBeforeFailure = projectHasUnsavedChanges(emptyExample, emptyExample, false);
const uncertainAfterFailure = projectHasUnsavedChanges(emptyExample, emptyExample, true);
assert.equal(verifiedBeforeFailure, false,
  "Verified clean project must not be labeled unsaved before native failure");
assert.equal(uncertainAfterFailure, true,
  "Failed write must override a clean/equal in-memory source snapshot");
assert.equal(projectNeedsUnloadWarning(uncertainAfterFailure, false), true,
  "A failed write must request close protection even after file lock is released");
assert.equal(projectNeedsUnloadWarning(
  projectHasUnsavedChanges(emptyExample, emptyExample, false), false), false,
  "A verified recovery write must clear closing protection on clean source");
console.log("PASS PROJECT-017: failed write marker preserves unsaved/discard/unload protections until verified recovery");

// PROJECT-018: a fallback file-picker selection is authorized only if the
// exact originating Builder workspace and file epoch are still current.
// Scenario names and revision numbers are not proof of identity.
const pickerOrigin = { mode: "builder", source: { scenarioId: "same_name" } };
const pickerReplacement = { mode: "builder", source: { scenarioId: "same_name" } };
assert.equal(projectFilePickerStillCurrent(pickerOrigin, 15, pickerOrigin, 15), true,
  "The same unchanged origin must allow its selected file");
assert.equal(projectFilePickerStillCurrent(pickerOrigin, 15, pickerReplacement, 15), false,
  "A different source with identical public scenarioId must be rejected");
assert.equal(projectFilePickerStillCurrent(pickerOrigin, 15, pickerOrigin, 16), false,
  "A native association reset during the picker must reject stale selection");
assert.equal(projectFilePickerStillCurrent(pickerOrigin, -1, pickerOrigin, -1), false,
  "Invalid epoch must not authorize file selection");
assert.equal(projectFilePickerStillCurrent(pickerOrigin, 15.5, pickerOrigin, 15.5), false,
  "Nonintegral file epoch must be rejected");
// PROJECT-046: a legitimate inspector Apply may publish its Builder source
// before React has committed the next render. The project file boundary must
// use that live workspace rather than a stale painted dirty flag or snapshot.
const savedLiveWorkspace = {
  mode: "builder", source: structuredClone(example), sourceRevision: 0,
  dirty: false, layoutOverrides: [],
};
const liveBaseline = projectSnapshot(savedLiveWorkspace);
const unsavedEdit = {
  ...savedLiveWorkspace, sourceRevision: 1, dirty: true,
  source: { ...savedLiveWorkspace.source,
    metadata: { ...savedLiveWorkspace.source.metadata,
      title: "PROJECT-046 pending source" } },
};
assert.equal(projectHasLiveUnsavedChanges(savedLiveWorkspace, liveBaseline,
  liveBaseline, false), false, "Unmodified current Builder needs no warning");
assert.equal(projectHasLiveUnsavedChanges(unsavedEdit, liveBaseline,
  liveBaseline, false), true,
  "An immediate unpainted Builder edit must require discard confirmation");
assert.equal(projectHasLiveUnsavedChanges({
  ...unsavedEdit, dirty: false,
}, liveBaseline, liveBaseline, false), true,
  "A stale/incorrect dirty boolean may not override changed canonical bytes");
assert.equal(projectHasLiveUnsavedChanges({
  ...savedLiveWorkspace, layoutOverrides: [
    { id: "firewall01", x: 30, y: 60, width: 200 },
  ], dirty: false,
}, liveBaseline, liveBaseline, false), true,
  "A published layout edit without a React repaint must also require confirmation");
assert.equal(projectHasLiveUnsavedChanges({ mode: "runtime" },
  projectSnapshot(unsavedEdit), liveBaseline, false), true,
  "Entering Runtime must retain protection for the last edited Builder");
assert.equal(projectHasLiveUnsavedChanges({ mode: "runtime" },
  liveBaseline, liveBaseline, false), false,
  "Clean Builder followed by Runtime should not warn merely for the mode change");
assert.equal(projectHasLiveUnsavedChanges(savedLiveWorkspace, liveBaseline,
  liveBaseline, true), true,
  "An uncertain native write must force the warning even when source matches");
assert.equal(projectNeedsUnloadWarning(projectHasLiveUnsavedChanges(
  unsavedEdit, liveBaseline, liveBaseline, false), false), true,
  "Tab closing must warn on a same-turn pending edit");
assert.equal(projectHasLiveUnsavedChanges(unsavedEdit,
  liveBaseline, projectSnapshot(unsavedEdit), false), false,
  "A verified save of exactly the current source must clear the warning");
console.log("PASS PROJECT-046: live Builder, layout, Runtime preview and failed write preserve unsaved guards");

console.log("PASS PROJECT-018: native/fallback Open selection bound to initial workspace identity and file epoch");
console.log("PASS PROJECT-002: all three async lab launches fail closed after stale ELK layout");
console.log("PASS PROJECT-001: user-controlled format v1, SHA-256, exact source/link/layout roundtrip, corruption and write/readback negative tests");
