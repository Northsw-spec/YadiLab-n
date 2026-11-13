// New, explicit user-controlled editable .yadilab project document (not runtime autosave).
// Hashes attest integrity of serialized source bytes, NOT physical network or Engine truth.
export const PROJECT_FORMAT = "yadilab.project";
export const PROJECT_VERSION = 1;
export const PROJECT_MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// Mirror core-model/src/operation-policy.ts at the native MJS boundary.
// A SHA-256-correct project can still contain an authored repair operation
// that would rewrite canonical identities; reject it on BOTH Save and Open.
const forbiddenOperationSegments = new Set(["__proto__", "prototype", "constructor"]);
const immutableInterfaceOperationFields = new Set(["id", "name", "label", "type"]);
function mutableSolutionOperationPath(path) {
  if (typeof path !== "string" || !path.length || path.trim() !== path) return false;
  const parts = path.split(".");
  if (parts.some(part => !part || forbiddenOperationSegments.has(part))) return false;
  if (parts[0] === "properties") return parts.length >= 2;
  if (parts[0] !== "interfaces" || parts.length < 3) return false;
  const index = parts[1];
  if (!/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))
    return false;
  const field = parts[2];
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(field) &&
    !immutableInterfaceOperationFields.has(field);
}

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
  // Only canonical objects with declared `id` fields participate in the
  // global identity namespace. The source schema defines editorial `hints`
  // as { level, text } without IDs; requiring one blocks valid Save/Open.
  for (const key of ["zones", "resources", "connections", "tests", "findings",
    "objectives", "troubleshootingObjectives", "notes"]) {
    if (source[key] !== undefined) identifiers(source[key], ids, "DUPLICATE_ID");
  }
  const zoneIds = new Set(source.zones.map(x => x.id));
  const resourceIds = new Set(source.resources.map(x => x.id));
  const connectionIds = new Set(source.connections.map(x => x.id));
  const provenance = source.networkImportProvenance;
  if (provenance !== undefined) {
    if (provenance.source.sourceId !== "src_" + provenance.source.sha256)
      blocked("NETWORK_IMPORT_PROVENANCE_SOURCE_ID");
    const factIds = new Set();
    for (const fact of provenance.facts) {
      if (factIds.has(fact.factId)) blocked("NETWORK_IMPORT_PROVENANCE_DUPLICATE_FACT");
      factIds.add(fact.factId);
      const target = fact.targetId;
      const targetExists = fact.targetKind === "resource" ? target !== undefined && resourceIds.has(target) :
        fact.targetKind === "connection" ? target !== undefined && connectionIds.has(target) :
        fact.targetKind === "zone" ? target !== undefined && zoneIds.has(target) : false;
      // Historical provenance records one-way Builder deletions. It cannot be
      // used to relabel a live binding or to detach scenario-level evidence.
      const valid = fact.targetStatus === "HISTORICAL" ? fact.targetKind !== "scenario" && target !== undefined && !targetExists :
        fact.targetKind === "scenario" ? target === undefined : targetExists;
      if (!valid) blocked("NETWORK_IMPORT_PROVENANCE_TARGET");
    }
  }
  const officeProvenance = source.officeReviewProvenance;
  if (officeProvenance !== undefined) {
    if (officeProvenance.source.sourceId !== "src_" + officeProvenance.source.sha256)
      blocked("OFFICE_REVIEW_PROVENANCE_SOURCE_ID");
    if (officeProvenance.targetModel.scenarioId !== source.scenarioId)
      blocked("OFFICE_REVIEW_PROVENANCE_SCENARIO_MISMATCH");
    if (officeProvenance.status === "CURRENT" && officeProvenance.targetModel.sourceRevision !== 0)
      blocked("OFFICE_REVIEW_PROVENANCE_REVISION");
    const officeFactIds = new Set();
    for (const fact of officeProvenance.facts) {
      if (officeFactIds.has(fact.factId)) blocked("OFFICE_REVIEW_PROVENANCE_DUPLICATE_FACT");
      officeFactIds.add(fact.factId);
      const targetExists = fact.targetKind === "resource" ? resourceIds.has(fact.targetId) : connectionIds.has(fact.targetId);
      if (officeProvenance.status === "CURRENT" && !targetExists)
        blocked("OFFICE_REVIEW_PROVENANCE_TARGET");
      const fieldTargetKind = fact.field === "resource.id" ? "resource" : "connection";
      if (fact.targetKind !== fieldTargetKind)
        blocked("OFFICE_REVIEW_PROVENANCE_TARGET");
      if (fact.locator.sourceSha256 !== officeProvenance.source.sha256 ||
          fact.locator.part !== "word/document.xml")
        blocked("OFFICE_REVIEW_PROVENANCE_LOCATOR");
    }
  }
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
  // Mirror the Compiler's explicit validation for Foundation test types.
  // Other test types retain their existing schema and compiler contracts:
  // do not infer undocumented selector semantics or invent resources.
  const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;
  const checkTestResource = (params, key) => {
    if (typeof params[key] !== "string" || params[key].length === 0)
      blocked("TEST_PARAM_REQUIRED");
    if (!resourceIds.has(params[key])) blocked("UNKNOWN_TEST_RESOURCE");
  };
  for (const test of source.tests) {
    const params = test.params;
    const requireParamText = key => {
      if (typeof params[key] !== "string" || params[key].length === 0)
        blocked("TEST_PARAM_REQUIRED");
    };
    // Keep native Save/Open aligned with Foundation Compiler. A syntactically
    // valid, SHA-matching file may not carry unresolvable resource IDs or a
    // protocol/port that Runtime would silently reinterpret as missing.
    if (["network.reachability", "network.segmentation", "network.route_test"]
        .includes(test.type)) {
      checkTestResource(params, "from");
      checkTestResource(params, "to");
      const protocol = params.protocol;
      if (protocol === undefined) {
        if (test.type !== "network.route_test") blocked("TEST_PARAM_REQUIRED");
      } else if (!["tcp", "udp", "icmp", "any"].includes(protocol)) {
        blocked("TEST_PARAM_INVALID");
      }
      if (params.port !== undefined && !validPort(params.port))
        blocked("TEST_PARAM_INVALID");
      if (protocol === "udp" && !validPort(params.port))
        blocked("TEST_PARAM_REQUIRED");
      if (protocol === "icmp" && params.port !== undefined)
        blocked("TEST_PARAM_INVALID");
    } else if (test.type === "identity.authentication_test") {
      checkTestResource(params, "subject");
      checkTestResource(params, "target");
    } else if (test.type === "identity.privilege_path"
        || test.type === "identity.permission") {
      checkTestResource(params, "subject");
      checkTestResource(params, "resource");
      requireParamText("permission");
    } else if (test.type === "identity.membership") {
      checkTestResource(params, "subject");
      checkTestResource(params, "group");
    } else if (test.type === "windows.hardening_check"
        || test.type === "linux.hardening_check") {
      checkTestResource(params, "target");
      requireParamText("path");
      if (!Object.prototype.hasOwnProperty.call(params, "equals"))
        blocked("TEST_PARAM_REQUIRED");
    } else if (test.type === "network.port_scan" ||
        test.type === "virtualization.management_exposure") {
      checkTestResource(params, "from");
      checkTestResource(params, "to");
      if (params.protocol !== undefined &&
          params.protocol !== "tcp" && params.protocol !== "udp")
        blocked("TEST_PARAM_INVALID");
      if (test.type === "virtualization.management_exposure") {
        if (!validPort(params.port)) blocked("TEST_PARAM_REQUIRED");
      } else {
        const validSingle = validPort(params.port);
        const validList = Array.isArray(params.ports) &&
          params.ports.length > 0 && params.ports.every(validPort);
        if (!validSingle && !validList) blocked("TEST_PARAM_REQUIRED");
        if (params.port !== undefined && !validSingle)
          blocked("TEST_PARAM_INVALID");
        if (params.ports !== undefined && !validList)
          blocked("TEST_PARAM_INVALID");
        if (params.port !== undefined && params.ports !== undefined)
          blocked("TEST_PARAM_AMBIGUOUS");
      }
    } else if (["identity.password_audit", "logging.visibility_test",
      "logging.alert_test", "backup.restore_test"].includes(test.type)) {
      checkTestResource(params, "target");
      if (params.path !== undefined &&
          (typeof params.path !== "string" || !params.path.length))
        blocked("TEST_PARAM_INVALID");
      if (params.equals !== undefined && typeof params.equals !== "boolean")
        blocked("TEST_PARAM_INVALID");
    }
  }
  // A troubleshooting requirement has a local ID namespace within its
  // objective, not a global canonical resource ID. Check known references
  // and minimum selector presence before persisting the evidence model.
  for (const objective of source.troubleshootingObjectives ?? []) {
    const requirementIds = new Set();
    for (const requirement of objective.requirements) {
      if (requirementIds.has(requirement.id))
        blocked("DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID");
      requirementIds.add(requirement.id);
      if (requirement.kind === "observation") {
        if (requirement.category === undefined &&
            requirement.targetId === undefined && requirement.command === undefined)
          blocked("TROUBLESHOOTING_REQUIREMENT_EMPTY");
        if (requirement.targetId !== undefined &&
            !resourceIds.has(requirement.targetId))
          blocked("UNKNOWN_TROUBLESHOOTING_RESOURCE");
      } else {
        if (["category", "sourceId", "destinationId", "protocol", "port",
          "queryName", "truth"].every(key => requirement[key] === undefined))
          blocked("TROUBLESHOOTING_REQUIREMENT_EMPTY");
        for (const key of ["sourceId", "destinationId"]) {
          if (requirement[key] !== undefined && !resourceIds.has(requirement[key]))
            blocked("UNKNOWN_TROUBLESHOOTING_RESOURCE");
        }
      }
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
  // The schema proves rule shape, not whether its canonical IDs still
  // exist. Mirror Compiler rule reference validation at manual Save/Open,
  // walking nested all/any/not rules iteratively so depth does not add
  // another application-level recursion failure.
  const checkRuleReferences = root => {
    const pending = [root];
    while (pending.length) {
      const rule = pending.pop();
      const requireResource = key => {
        if (!resourceIds.has(rule[key])) blocked("UNKNOWN_RULE_RESOURCE");
      };
      switch (rule.op) {
        case "all":
        case "any":
          for (const child of rule.rules) pending.push(child);
          break;
        case "not":
          pending.push(rule.rule);
          break;
        case "equals":
        case "service_enabled":
          requireResource("target");
          break;
        case "reachable":
          requireResource("from");
          requireResource("to");
          break;
        case "member_of":
          requireResource("subject");
          requireResource("group");
          break;
        case "has_permission":
          requireResource("subject");
          requireResource("resource");
          break;
        case "test_result":
          if (!testIds.has(rule.test)) blocked("UNKNOWN_RULE_TEST");
          break;
      }
    }
  };
  for (const finding of source.findings) checkRuleReferences(finding.when);
  for (const objective of source.objectives)
    checkRuleReferences(objective.condition);
  checkRuleReferences(source.completion);
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
    if (!mutableSolutionOperationPath(operation.path))
      blocked("SOLUTION_OPERATION_PATH_FORBIDDEN");
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

// A clean Builder file can still be in the middle of an explicit disk write,
// native chooser, or verified Open. Closing during any operation risks an
// interrupted write or an uncompleted user-requested file transition.
// Request a browser beforeunload warning until the operation settles; the
// browser, not the app, ultimately decides whether to display that prompt.
export function projectNeedsUnloadWarning(hasUnsavedChanges, fileOperationActive) {
  return Boolean(hasUnsavedChanges || fileOperationActive);
}

// Native and fallback file pickers both return asynchronously. A selected
// document can replace only the exact workspace and file-association epoch
// which initiated the chooser; a later file selection must not replace New
// or an imported scenario that was activated while the dialog was open.
export function projectFilePickerStillCurrent(startWorkspace, startEpoch,
  activeWorkspace, activeEpoch) {
  return startWorkspace === activeWorkspace &&
    Number.isSafeInteger(startEpoch) && startEpoch >= 0 &&
    startEpoch === activeEpoch;
}

// A source swap is an edit of the associated project only if the canonical
// scenario identity is unchanged. A newly imported/drafted Builder may carry
// a larger revision and dirty=true; those fields alone cannot authorize
// continued writes to another scenario's existing .yadilab file. An explicit
// scenario-transition generation rejects same-ID replacement projects, too.
export function sameEditableProjectRevision(previous, next, sourceReplaced = false) {
  return sourceReplaced === false &&
    previous?.mode === "builder" && next?.mode === "builder" &&
    next.dirty === true &&
    Number.isSafeInteger(previous.sourceRevision) &&
    Number.isSafeInteger(next.sourceRevision) &&
    next.sourceRevision > previous.sourceRevision &&
    typeof previous.source?.scenarioId === "string" &&
    previous.source.scenarioId.length > 0 &&
    next.source?.scenarioId === previous.source.scenarioId;
}
// The native file association is reconciled after React paints, but a new
// authored project can be committed synchronously before that effect runs.
// Save must not reuse the old file handle during that window, including when
// the new project reuses the previous public scenarioId. Ordinary in-place
// edits and non-source Builder updates remain authorized.
export function projectFileAssociationStillCurrent(previous, active,
  associatedTransition, currentTransition) {
  if (!Number.isSafeInteger(associatedTransition) || associatedTransition < 0 ||
      !Number.isSafeInteger(currentTransition) || currentTransition < 0 ||
      associatedTransition !== currentTransition) return false;
  if (previous === active) return true;
  if (!previous || !active || previous.mode !== active.mode) return false;
  if (previous.mode === "builder")
    return previous.source === active.source ||
      sameEditableProjectRevision(previous, active);
  if (previous.mode === "runtime")
    return previous.source === active.source;
  return false;
}

export function projectSnapshot(workspace) {
  if (!workspace || workspace.mode !== "builder") return null;
  return JSON.stringify({ source: workspace.source, layoutOverrides: workspace.layoutOverrides ?? [] });
}
// Read the *live* Builder published by the app, not just the last painted
// snapshot. An inspector Apply followed immediately by Save/New/Close in the
// same JavaScript event can precede React's scheduled state commit. Runtime
// previews retain the last editable Builder snapshot instead.
export function projectHasLiveUnsavedChanges(activeWorkspace, lastBuilderSnapshot,
  savedSnapshot, unpersisted = false) {
  const current = activeWorkspace?.mode === "builder"
    ? projectSnapshot(activeWorkspace) : lastBuilderSnapshot;
  return projectHasUnsavedChanges(current, savedSnapshot, unpersisted);
}
async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) blocked("CRYPTO_UNAVAILABLE");
  if (!(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array) ||
      bytes.byteLength > PROJECT_MAX_BYTES) blocked("FILE_TOO_LARGE");
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function sha256(text) {
  return sha256Bytes(encoder.encode(text));
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
  // The file is untrusted until its content digest matches. Avoid running
  // potentially expensive source/schema/reference validation on modified
  // bytes; a matching digest is integrity only, not permission to skip
  // canonical semantic checks.
  const digest = await sha256(JSON.stringify(document.content));
  if (digest !== document.contentSha256) blocked("CHECKSUM_MISMATCH");
  checkedPayload(document.content, validateSource);
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
  // TextDecoder intentionally strips a UTF-8 BOM. The file association
  // fingerprint must cover the actual physical bytes, not decoded JSON.
  return { ...checked, fileSha256: await sha256Bytes(raw) };
}
export async function digestProjectText(text) {
  if (typeof text !== "string") blocked("FILE_INVALID");
  return sha256(text);
}
// A File acquired from showOpenFilePicker() is a snapshot. While its source
// is being parsed, another OS process may replace the actual disk contents.
// Check the SAME handle again just before attaching it to the Builder.
// A later Save also checks external changes, but Open must not claim a stale
// snapshot represents the currently selected physical file.
export async function assertProjectOpenDiskUnchanged(handle, expectedFileSha256) {
  if (!handle || typeof handle.getFile !== "function")
    blocked("OPEN_READBACK_UNAVAILABLE");
  if (typeof expectedFileSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(expectedFileSha256))
    blocked("EXPECTED_DIGEST_INVALID");
  let diskFile;
  try { diskFile = await handle.getFile(); }
  catch { blocked("OPEN_READBACK_UNAVAILABLE"); }
  if (!diskFile || typeof diskFile.arrayBuffer !== "function" ||
      (diskFile.size !== undefined && (!Number.isSafeInteger(diskFile.size) ||
       diskFile.size < 1 || diskFile.size > PROJECT_MAX_BYTES)))
    blocked("OPEN_READBACK_UNAVAILABLE");
  let bytes;
  try { bytes = await diskFile.arrayBuffer(); }
  catch { blocked("OPEN_READBACK_UNAVAILABLE"); }
  if (!(bytes instanceof ArrayBuffer) ||
      bytes.byteLength < 1 || bytes.byteLength > PROJECT_MAX_BYTES)
    blocked("OPEN_READBACK_UNAVAILABLE");
  // Compare actual bytes, not TextDecoder-normalized characters. A BOM-only
  // external edit changes the native file even though its JSON reads the same.
  if (await sha256Bytes(bytes) !== expectedFileSha256)
    blocked("EXTERNAL_FILE_CHANGED_DURING_OPEN");
  return true;
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
  // The API promises physical-file identity, not merely a single handle's
  // opinion. If either handle disagrees or gives a malformed result, fail
  // closed: Save As must never silently rebind to an uncertain target.
  let same, reciprocal;
  try {
    same = await previous.isSameEntry(selected);
    reciprocal = await selected.isSameEntry(previous);
  } catch { blocked("FILE_IDENTITY_UNAVAILABLE"); }
  if (typeof same !== "boolean" || typeof reciprocal !== "boolean" ||
      same !== reciprocal) blocked("FILE_IDENTITY_INVALID");
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
  // Validate the final serialized bytes BEFORE opening a writable stream.
  // This exported boundary must not truncate a real file for an oversized or
  // malformed payload, even if a caller bypasses createProjectDocument().
  if (typeof text !== "string") blocked("FILE_INVALID");
  const encoded = encoder.encode(text);
  if (encoded.byteLength < 1 || encoded.byteLength > PROJECT_MAX_BYTES)
    blocked("FILE_TOO_LARGE");
  // A native write must carry one explicit non-destructive destination
  // policy. The UI supplies one, but this exported boundary is also callable
  // by other integrations. Without either, createWritable() would overwrite
  // ANY existing project without comparing disk bytes or requiring an empty
  // Save As target. Fail before even touching the native handle.
  if (!requireEmptyTarget && expectedFileSha256 === undefined)
    blocked("DESTINATION_POLICY_REQUIRED");
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
    if (!before || typeof before.arrayBuffer !== "function" ||
        !Number.isSafeInteger(before.size) || before.size < 0)
      blocked("CONFLICT_READ_UNAVAILABLE");
    // Do not allocate an unbounded external file into browser memory. A
    // concurrent writer may have enlarged it since the last verified Save.
    if (before.size > PROJECT_MAX_BYTES) blocked("EXTERNAL_FILE_CHANGED");
    const buffer = await before.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > PROJECT_MAX_BYTES)
      blocked("EXTERNAL_FILE_CHANGED");
    // SHA-256 on raw disk bytes prevents a BOM-only external modification
    // from silently passing conflict detection before destructive Save.
    if (await sha256Bytes(buffer) !== expectedFileSha256)
      blocked("EXTERNAL_FILE_CHANGED");
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
  if (!actual || typeof actual.arrayBuffer !== "function" ||
      !Number.isSafeInteger(actual.size) || actual.size < 0)
    blocked("READBACK_UNAVAILABLE");
  // Readback must obey the same size ceiling as Open and conflict detection.
  // The post-write file may have been replaced by another OS process.
  if (actual.size > PROJECT_MAX_BYTES) blocked("READBACK_INVALID");
  const bytes = await actual.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > PROJECT_MAX_BYTES)
    blocked("READBACK_INVALID");
  // Compare exact native bytes. TextDecoder discards a leading UTF-8 BOM;
  // comparing its decoded text could therefore report a verified Save even
  // though another process changed the physical file after close().
  const expectedBytes = encoded;
  const diskBytes = new Uint8Array(bytes);
  if (diskBytes.byteLength !== expectedBytes.byteLength)
    blocked("READBACK_MISMATCH");
  for (let i = 0; i < expectedBytes.byteLength; i++) {
    if (diskBytes[i] !== expectedBytes[i]) blocked("READBACK_MISMATCH");
  }
  return true;
}
