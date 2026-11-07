// New, explicit user-controlled editable .yadilab project document (not runtime autosave).
// Hashes attest integrity of serialized source bytes, NOT physical network or Engine truth.
export const PROJECT_FORMAT = "yadilab.project";
export const PROJECT_VERSION = 1;
export const PROJECT_MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function blocked(code) {
  const error = new Error("PROJECT_" + code);
  error.code = "PROJECT_" + code;
  throw error;
}
const ownKeys = (obj, expected) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
      Object.keys(obj).sort().join("|") !== [...expected].sort().join("|"))
    blocked("SHAPE_INVALID");
};
const finite = value => Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const identifiers = (items, all, code) => {
  if (!Array.isArray(items)) blocked("SOURCE_INVALID");
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id ||
        all.has(item.id)) blocked(code);
    all.add(item.id);
  }
};
export function verifyEditableProject(source, layoutOverrides, validateSource) {
  if (typeof validateSource !== "function") blocked("VALIDATOR_REQUIRED");
  const validated = validateSource(source);
  if (validated !== true && validated?.valid !== true) blocked("SOURCE_SCHEMA_INVALID");
  const ids = new Set();
  for (const key of ["zones", "resources", "connections", "tests", "findings",
    "objectives", "troubleshootingObjectives", "hints", "notes"]) {
    if (source[key] !== undefined) identifiers(source[key], ids, "DUPLICATE_ID");
  }
  const zoneIds = new Set(source.zones.map(x => x.id));
  const resourceIds = new Set(source.resources.map(x => x.id));
  const zoneParent = new Map();
  for (const zone of source.zones) {
    if (zone.parent !== undefined) {
      if (!zoneIds.has(zone.parent)) blocked("UNKNOWN_ZONE_PARENT");
      zoneParent.set(zone.id, zone.parent);
    }
  }
  // Schema validation permits cycles. A cycle can make zones unreachable from
  // the layout roots; reject on both Save and Open before any workspace change.
  // Iterative, memoized ancestry traversal avoids stack overflow and O(n^2)
  // walks for 10k+ deeply nested zones.
  const cleared = new Set();
  for (const zone of source.zones) {
    let current = zone.id;
    const visiting = new Set();
    while (current !== undefined && !cleared.has(current)) {
      if (visiting.has(current)) blocked("ZONE_PARENT_CYCLE");
      visiting.add(current);
      current = zoneParent.get(current);
    }
    for (const id of visiting) cleared.add(id);
  }
  const interfacesByResource = new Map();
  for (const resource of source.resources) {
    if (resource.zone && !zoneIds.has(resource.zone)) blocked("UNKNOWN_RESOURCE_ZONE");
    // Every physical/logical port is identified within its resource. The
    // source schema validates syntax, but does not enforce uniqueness.
    const portIds = new Set();
    for (const iface of resource.interfaces ?? []) {
      if (portIds.has(iface.id)) blocked("DUPLICATE_INTERFACE_ID");
      portIds.add(iface.id);
    }
    interfacesByResource.set(resource.id, portIds);
  }
  for (const edge of source.connections) {
    if (!resourceIds.has(edge.from?.resource) || !resourceIds.has(edge.to?.resource))
      blocked("DANGLING_CONNECTION");
    // A declared endpoint port must refer to an actual interface. Do not
    // invent a port on Save or reopen a link that cannot be compiled.
    for (const side of [edge.from, edge.to]) {
      if (side.port !== undefined && !interfacesByResource.get(side.resource).has(side.port))
        blocked("UNKNOWN_CONNECTION_PORT");
    }
  }
  // Evidence and annotations must not silently refer to deleted or renamed
  // canonical objects. The schema enforces ID syntax but not referential
  // integrity; apply the same object sets as Compiler semantic validation.
  const testIds = new Set(source.tests.map(test => test.id));
  for (const finding of source.findings) {
    for (const testId of finding.evidenceTests ?? []) {
      if (!testIds.has(testId)) blocked("UNKNOWN_EVIDENCE_TEST");
    }
  }
  const noteTargets = new Set([
    ...zoneIds, ...resourceIds,
    ...source.connections.map(edge => edge.id),
    ...testIds,
    ...source.findings.map(finding => finding.id),
    ...source.objectives.map(objective => objective.id),
    ...(source.troubleshootingObjectives ?? []).map(objective => objective.id),
  ]);
  for (const note of source.notes ?? []) {
    if (note.target !== undefined && !noteTargets.has(note.target))
      blocked("UNKNOWN_NOTE_TARGET");
  }
  // Canonical solutions identify specific resources to mutate. A valid
  // document digest cannot legitimize a repair operation against a deleted
  // device; keep the same reference constraints as Compiler validation.
  for (const operation of source.canonicalSolution?.operations ?? []) {
    if (!resourceIds.has(operation.target)) blocked("UNKNOWN_SOLUTION_TARGET");
  }
  // These are source-defined layout hints, distinct from the separately
  // validated editable layout overrides. Targets may be zones or resources,
  // while a parent must be an actual zone.
  const layoutTargets = new Set([...zoneIds, ...resourceIds]);
  for (const hint of source.layoutHints ?? []) {
    if (!layoutTargets.has(hint.target)) blocked("UNKNOWN_LAYOUT_TARGET");
    if (hint.parent !== undefined && !zoneIds.has(hint.parent))
      blocked("UNKNOWN_LAYOUT_PARENT");
  }
  if (!Array.isArray(layoutOverrides) || layoutOverrides.length > 20_000)
    blocked("LAYOUT_INVALID");
  const movable = new Set([...zoneIds, ...resourceIds]);
  const seen = new Set();
  for (const entry of layoutOverrides) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some(k => !["id", "x", "y", "width", "height"].includes(k)) ||
        typeof entry.id !== "string" || seen.has(entry.id) ||
        !movable.has(entry.id) || !finite(entry.x) || !finite(entry.y) ||
        (entry.width !== undefined && (!finite(entry.width) || entry.width <= 0)) ||
        (entry.height !== undefined && (!finite(entry.height) || entry.height <= 0)))
      blocked("LAYOUT_INVALID");
    seen.add(entry.id);
  }
}
// A newly created or imported project is unsaved until an actual verified
// native write or an explicit successful Open, even if no edits were made.
export function projectHasUnsavedChanges(currentSnapshot, savedSnapshot, unpersisted) {
  return Boolean(unpersisted) || currentSnapshot !== savedSnapshot;
}

export function projectSnapshot(workspace) {
  if (!workspace || workspace.mode !== "builder") return null;
  return JSON.stringify({ source: workspace.source, layoutOverrides: workspace.layoutOverrides ?? [] });
}
async function sha256(text) {
  if (!globalThis.crypto?.subtle) blocked("CRYPTO_UNAVAILABLE");
  const bytes = encoder.encode(text);
  if (bytes.byteLength > PROJECT_MAX_BYTES) blocked("FILE_TOO_LARGE");
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function checkedPayload(payload, validateSource) {
  ownKeys(payload, ["source", "layoutOverrides"]);
  verifyEditableProject(payload.source, payload.layoutOverrides, validateSource);
}
export async function createProjectDocument(workspace, { validateSource } = {}) {
  if (workspace?.mode !== "builder") blocked("BUILDER_REQUIRED");
  const raw = projectSnapshot(workspace);
  if (raw === null) blocked("BUILDER_REQUIRED");
  if (encoder.encode(raw).byteLength > PROJECT_MAX_BYTES) blocked("FILE_TOO_LARGE");
  // JSON snapshot is detached synchronously before awaiting WebCrypto.
  const payload = JSON.parse(raw);
  checkedPayload(payload, validateSource);
  const contentSha256 = await sha256(raw);
  const document = {
    formatId: PROJECT_FORMAT,
    schemaVersion: PROJECT_VERSION,
    digestAlgorithm: "SHA-256",
    contentSha256,
    content: payload,
  };
  const fileText = JSON.stringify(document, null, 2) + "\n";
  if (encoder.encode(fileText).byteLength > PROJECT_MAX_BYTES)
    blocked("FILE_TOO_LARGE");
  return fileText;
}
export async function readProjectDocument(text, { validateSource } = {}) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > PROJECT_MAX_BYTES)
    blocked("FILE_TOO_LARGE");
  let document;
  try { document = JSON.parse(text); }
  catch { blocked("JSON_INVALID"); }
  ownKeys(document, ["formatId", "schemaVersion", "digestAlgorithm", "contentSha256", "content"]);
  if (document.formatId !== PROJECT_FORMAT ||
      document.schemaVersion !== PROJECT_VERSION ||
      document.digestAlgorithm !== "SHA-256" ||
      typeof document.contentSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(document.contentSha256))
    blocked("FORMAT_UNSUPPORTED");
  checkedPayload(document.content, validateSource);
  const digest = await sha256(JSON.stringify(document.content));
  if (digest !== document.contentSha256) blocked("CHECKSUM_MISMATCH");
  // Never restore compile, Engine state, runtime evaluation or external file handles.
  return { source: document.content.source, layoutOverrides: document.content.layoutOverrides };
}
export function projectFilename(value) {
  const clean = String(value ?? "Untitled").replace(/[\\/\x00-\x1f<>:"|?*]/g, "_")
    .replace(/\.+$/, "").trim().slice(0, 100) || "Untitled";
  return clean.toLowerCase().endsWith(".yadilab") ? clean : clean + ".yadilab";
}
export async function readProjectFile(file, options = {}) {
  if (!file || typeof file.name !== "string" ||
      !/\.yadilab$/i.test(file.name) ||
      (file.size !== undefined && (!Number.isSafeInteger(file.size) ||
       file.size < 1 || file.size > PROJECT_MAX_BYTES)) ||
      typeof file.arrayBuffer !== "function")
    blocked("FILE_INVALID");
  const raw = await file.arrayBuffer();
  if (!(raw instanceof ArrayBuffer) || raw.byteLength > PROJECT_MAX_BYTES)
    blocked("FILE_TOO_LARGE");
  let text;
  try { text = decoder.decode(raw); }
  catch { blocked("UTF8_INVALID"); }
  const checked = await readProjectDocument(text, options);
  return { ...checked, fileSha256: await sha256(text) };
}
export async function digestProjectText(text) {
  if (typeof text !== "string") blocked("FILE_INVALID");
  return sha256(text);
}
// File System Access may return a fresh JS handle for the same physical path
// selected again through Save As. Comparing JS object references is unsafe.
// If an existing project association cannot be compared, reject the overwrite.
export async function sameProjectFileEntry(previous, selected) {
  if (!previous) return false;
  if (!selected) blocked("FILE_IDENTITY_UNAVAILABLE");
  if (previous === selected) return true;
  if (typeof previous.isSameEntry !== "function" ||
      typeof selected.isSameEntry !== "function")
    blocked("FILE_IDENTITY_UNAVAILABLE");
  let same;
  try { same = await previous.isSameEntry(selected); }
  catch { blocked("FILE_IDENTITY_UNAVAILABLE"); }
  if (typeof same !== "boolean") blocked("FILE_IDENTITY_INVALID");
  return same;
}

// A failed write may have left a file changed or in an uncertain state.
// Save As must NOT erase that history by returning a fresh JS handle to
// the same underlying file. Only explicit Open/New can reset quarantine.
export async function assertSafeRecoveryTarget(quarantinedHandles, selected) {
  if (!Array.isArray(quarantinedHandles) || quarantinedHandles.length > 32)
    blocked("QUARANTINE_LIMIT_REOPEN");
  for (const previous of quarantinedHandles) {
    if (await sameProjectFileEntry(previous, selected))
      blocked("FILE_REQUIRES_REOPEN");
  }
}

export async function writeProjectFile(handle, text, { expectedFileSha256, requireEmptyTarget = false } = {}) {
  if (!handle || typeof handle.createWritable !== "function" ||
      typeof handle.getFile !== "function") blocked("WRITE_UNSUPPORTED");
  // An unrelated Save As target may already contain a different project.
  // File-picker selection is NOT permission to silently destroy those bytes.
  // Opening the existing document is the explicit way to associate it for Save.
  if (requireEmptyTarget && expectedFileSha256 !== undefined)
    blocked("DESTINATION_POLICY_CONFLICT");
  const assertEmptyDestination = async () => {
    const file = await handle.getFile();
    if (!file || !Number.isSafeInteger(file.size) || file.size < 0)
      blocked("DESTINATION_UNVERIFIABLE");
    if (file.size !== 0) blocked("DESTINATION_NOT_EMPTY");
  };
  if (requireEmptyTarget) await assertEmptyDestination();
  // Native File System Access does not provide a compare-and-swap write.
  // Check both BEFORE opening the writable and AGAIN immediately before write.
  // This closes the race while createWritable resolves; it cannot guarantee
  // atomic exclusion against another OS process modifying the file afterwards.
  const assertOriginalDiskBytes = async () => {
    const before = await handle.getFile();
    if (!before || typeof before.arrayBuffer !== "function") blocked("CONFLICT_READ_UNAVAILABLE");
    const buffer = await before.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > PROJECT_MAX_BYTES)
      blocked("EXTERNAL_FILE_CHANGED");
    let earlier;
    try { earlier = decoder.decode(buffer); }
    catch { blocked("EXTERNAL_FILE_CHANGED"); }
    if (await sha256(earlier) !== expectedFileSha256) blocked("EXTERNAL_FILE_CHANGED");
  };
  if (expectedFileSha256 !== undefined) {
    if (typeof expectedFileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedFileSha256))
      blocked("EXPECTED_DIGEST_INVALID");
    await assertOriginalDiskBytes();
  }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    if (expectedFileSha256 !== undefined) await assertOriginalDiskBytes();
    if (requireEmptyTarget) await assertEmptyDestination();
    await writable.write(new Blob([text], { type: "application/json;charset=utf-8" }));
    await writable.close();
    writable = null;
  } catch (error) {
    if (writable && typeof writable.abort === "function") {
      try { await writable.abort(); } catch { /* original write error takes precedence */ }
    }
    throw error;
  }
  const actual = await handle.getFile();
  if (!actual || typeof actual.arrayBuffer !== "function") blocked("READBACK_UNAVAILABLE");
  const bytes = await actual.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > PROJECT_MAX_BYTES)
    blocked("READBACK_INVALID");
  let confirmed;
  try { confirmed = decoder.decode(bytes); }
  catch { blocked("READBACK_INVALID"); }
  if (confirmed !== text) blocked("READBACK_MISMATCH");
  return true;
}
