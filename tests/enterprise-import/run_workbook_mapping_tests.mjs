import assert from "node:assert/strict";
import { csvImportAdapter, mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument, previewNetworkWorkbook, validateNetworkWorkbook } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";

const cell = (value) => ({ value, locator: { kind: "record-row", table: "test", row: 1 } });
const record = (recordIndex, fields) => ({ recordIndex, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, cell(value)])) });
const workbook = (count = 30) => ({ tables: [
  { tableId: "Metadata", records: [record(1, { schemaVersion: "1.0.0", scenarioId: `workbook_${count}`, title: `Workbook ${count}` })] },
  { tableId: "Nodes", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, displayName: `Node ${i + 1}`, type: "server.generic" })) },
  { tableId: "Interfaces", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, interfaceId: "eth0", name: "eth0", IPv4: `10.0.${Math.floor(i / 254)}.${(i % 254) + 1}`, prefix: "24", MTU: 1500 })) },
  { tableId: "Links", records: Array.from({ length: Math.max(0, count - 1) }, (_, i) => record(i + 1, { linkId: `link_${i + 1}`, nodeA: `node_${i + 1}`, interfaceA: "eth0", nodeB: `node_${i + 2}`, interfaceB: "eth0", kind: "network" })) },
  { tableId: "Layout", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, rank: i })) },
] });
for (const count of [30, 50, 80]) { const result = mapNetworkWorkbookToScenario(workbook(count)); assert.equal(result.ok, true); assert.equal(result.source?.resources.length, count); assert.equal(result.source?.connections.length, count - 1); assert.equal(result.preview.mode, "PREVIEW"); }
const bad = workbook(2); bad.tables.find((x) => x.tableId === "Links").records[0].fields.nodeB.value = "missing"; const diagnostics = validateNetworkWorkbook(bad); assert.ok(diagnostics.some((x) => x.code === "WORKBOOK_LINK_ENDPOINT_UNKNOWN")); assert.equal(mapNetworkWorkbookToScenario(bad).ok, false);
const preview = previewNetworkWorkbook(workbook(30)); assert.equal(preview.rowsPerSheet.Nodes, 30); assert.equal(preview.mappedRows.Nodes, 30); assert.equal(preview.errors, 0);
// IMPORT-033: the preview must not advertise a source as importable when
// its zone or layout references cannot survive canonical Builder validation.
// Positive path: explicit Zones may be attached to Nodes and layoutHints.
const zoned = workbook(2);
zoned.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "floor_a", displayName: "Floor A", kind: "lan" }),
] });
zoned.tables.find(x => x.tableId === "Nodes").records[0].fields.zoneId = cell("floor_a");
zoned.tables.find(x => x.tableId === "Layout").records[0].fields.nodeId.value = "floor_a";
const zonedResult = mapNetworkWorkbookToScenario(zoned);
assert.equal(zonedResult.ok, true, JSON.stringify(zonedResult.diagnostics));
assert.equal(zonedResult.source.resources[0].zone, "floor_a");
assert.equal(zonedResult.source.layoutHints[0].target, "floor_a");
assert.deepEqual(zonedResult.source.zones.map(x => x.id), ["floor_a"]);

const unknownZone = workbook(2);
unknownZone.tables.find(x => x.tableId === "Nodes").records[0].fields.zoneId = cell("missing_zone");
const unknownZoneResult = mapNetworkWorkbookToScenario(unknownZone);
assert.equal(unknownZoneResult.ok, false);
assert.ok(unknownZoneResult.diagnostics.some(x =>
  x.code === "WORKBOOK_NODE_ZONE_UNKNOWN" && x.table === "Nodes" && x.row === 1));
assert.ok(unknownZoneResult.preview.errors > 0);
assert.equal(unknownZoneResult.source, undefined,
  "Invalid reference must never expose a seemingly importable source");

const duplicatedZone = workbook(2);
duplicatedZone.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "site_a", displayName: "Site A" }),
  record(2, { zoneId: "site_a", displayName: "Duplicate Site A" }),
] });
assert.ok(validateNetworkWorkbook(duplicatedZone).some(x =>
  x.code === "WORKBOOK_DUPLICATE_ZONE_ID"));
assert.equal(mapNetworkWorkbookToScenario(duplicatedZone).ok, false);

const collidingZone = workbook(2);
collidingZone.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "node_1", displayName: "Zone collides with node ID" }),
] });
assert.ok(validateNetworkWorkbook(collidingZone).some(x =>
  x.code === "WORKBOOK_CANONICAL_ID_COLLISION"));
assert.equal(mapNetworkWorkbookToScenario(collidingZone).ok, false);

const ghostLayout = workbook(2);
ghostLayout.tables.find(x => x.tableId === "Layout").records[0].fields.nodeId.value = "missing_target";
const ghostLayoutResult = mapNetworkWorkbookToScenario(ghostLayout);
assert.equal(ghostLayoutResult.ok, false);
assert.ok(ghostLayoutResult.diagnostics.some(x =>
  x.code === "WORKBOOK_LAYOUT_TARGET_UNKNOWN" && x.table === "Layout" && x.row === 1));
assert.equal(ghostLayoutResult.source, undefined,
  "Unknown layout object must not be emitted into canonical layoutHints");
console.log("PASS IMPORT-033: declared zones/layout references accepted; unknown, duplicate and colliding IDs rejected");

// IMPORT-034: the workbook preview must enforce the canonical scenario
// schema for the fields it maps. It must not advertise "ok" only for a later
// project Save or Compile to reject malformed source data.
const validFields = workbook(2);
validFields.tables.find(x => x.tableId === "Interfaces").records[0].fields.MAC =
  cell("AA:bb:CC:dd:EE:01");
validFields.tables.find(x => x.tableId === "Interfaces").records[0].fields.MTU =
  cell(9000);
validFields.tables.find(x => x.tableId === "Links").records[0].fields.kind =
  cell("management");
const validFieldsResult = mapNetworkWorkbookToScenario(validFields);
assert.equal(validFieldsResult.ok, true, JSON.stringify(validFieldsResult.diagnostics));
assert.equal(validFieldsResult.source.resources[0].interfaces[0].mac,
  "AA:bb:CC:dd:EE:01", "Preserve documented MAC case without normalization");
assert.equal(validFieldsResult.source.resources[0].interfaces[0].mtu, 9000);
assert.equal(validFieldsResult.source.connections[0].kind, "management");

for (const { table, field, invalid, code } of [
  { table: "Nodes", field: "type", invalid: "Server Generic", code: "WORKBOOK_NODE_TYPE_INVALID" },
  { table: "Interfaces", field: "MAC", invalid: "AA:BB:CC:DD:EE:GG", code: "WORKBOOK_MAC_INVALID" },
  { table: "Interfaces", field: "MTU", invalid: 0, code: "WORKBOOK_MTU_INVALID" },
  { table: "Interfaces", field: "MTU", invalid: -1500, code: "WORKBOOK_MTU_INVALID" },
  { table: "Links", field: "kind", invalid: "ethernet", code: "WORKBOOK_LINK_KIND_INVALID" },
]) {
  const invalidWorkbook = workbook(2);
  invalidWorkbook.tables.find(x => x.tableId === table).records[0].fields[field] = cell(invalid);
  const result = mapNetworkWorkbookToScenario(invalidWorkbook);
  assert.equal(result.ok, false, `Invalid ${table}.${field} must fail preview`);
  assert.ok(result.diagnostics.some(d => d.code === code &&
    d.table === table && d.row === 1 && d.field === field),
    `Missing ${code} source-specific row diagnostic`);
  assert.ok(result.preview.errors > 0, "Invalid mapped fields must flag the preview");
  assert.equal(result.source, undefined,
    "Import must not expose canonical source with invalid typed fields");
}
console.log("PASS IMPORT-034: valid MAC/MTU/link kinds preserved; malformed schema fields fail before activation");

// IMPORT-035: optional empty MTU cells are not declarations. Keep the exact
// topology importable when CSV/XLSX/ODS supplies blank optional columns,
// while a signed Layout.rank from source must remain a documented integer.
for (const empty of ["", "  ", null]) {
  const blankOptional = workbook(2);
  blankOptional.tables.find(x => x.tableId === "Interfaces").records[0].fields.MTU = cell(empty);
  blankOptional.tables.find(x => x.tableId === "Layout").records[0].fields.rank = cell("-3");
  const result = mapNetworkWorkbookToScenario(blankOptional);
  assert.equal(result.ok, true,
    `Blank optional MTU ${JSON.stringify(empty)} must not reject real inventory: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.source.resources[0].interfaces[0].mtu, undefined,
    "Do not manufacture a default MTU from an empty source cell");
  assert.equal(result.source.resources[1].interfaces[0].mtu, 1500,
    "Do not change another explicitly documented MTU");
  assert.equal(result.source.layoutHints[0].rank, -3,
    "Preserve an explicitly declared signed layout rank from a text cell");
}
for (const invalidRank of ["first", "1.5", true]) {
  const badRank = workbook(2);
  badRank.tables.find(x => x.tableId === "Layout").records[0].fields.rank = cell(invalidRank);
  const result = mapNetworkWorkbookToScenario(badRank);
  assert.equal(result.ok, false,
    `Malformed explicit layout rank ${JSON.stringify(invalidRank)} must fail before Builder activation`);
  assert.ok(result.diagnostics.some(x => x.code === "WORKBOOK_LAYOUT_RANK_INVALID" &&
    x.table === "Layout" && x.row === 1 && x.field === "rank"),
    "Malformed rank needs a row- and field-specific diagnostic");
  assert.ok(result.preview.errors > 0);
  assert.equal(result.source, undefined, "Invalid layout rank must not be silently omitted");
}
const badExplicitMtu = workbook(2);
badExplicitMtu.tables.find(x => x.tableId === "Interfaces").records[0].fields.MTU = cell("not-a-number");
const badExplicitResult = mapNetworkWorkbookToScenario(badExplicitMtu);
assert.equal(badExplicitResult.ok, false, "An explicit invalid MTU is still rejected");
assert.ok(badExplicitResult.diagnostics.some(x => x.code === "WORKBOOK_MTU_INVALID"));
console.log("PASS IMPORT-035: blank optional MTU accepted; signed layout rank preserved; invalid explicit fields rejected");



// IMPORT-036: preview row counts are physical source rows, not the count of
// diagnostics. Multiple field errors on one row reject that row just once.
const multipleErrorsInOneRow = workbook(2);
const firstNode = multipleErrorsInOneRow.tables.find(t => t.tableId === "Nodes").records[0];
firstNode.fields.nodeId.value = "INVALID NODE!";
firstNode.fields.displayName.value = "";
firstNode.fields.type.value = "Bad Type";
const rowResult = mapNetworkWorkbookToScenario(multipleErrorsInOneRow);
assert.equal(rowResult.ok, false);
assert.equal(rowResult.preview.rowsPerSheet.Nodes, 2);
assert.equal(rowResult.preview.rejectedRows.Nodes, 1,
  "Three field errors on a node are not three rejected source rows");
assert.equal(rowResult.preview.mappedRows.Nodes, 1,
  "Remaining valid source row must not disappear from the preview");
assert.ok(rowResult.preview.errors >= 3,
  "Count actual distinct diagnostics separately from rejected rows");

// Previously scenarioId was checked only *after* the preview was built:
// return value said import failed but preview misleadingly reported zero errors.
const badMetadataId = workbook(2);
badMetadataId.tables[0].records[0].fields.scenarioId = cell("Invalid Scenario!");
const badMetadataResult = mapNetworkWorkbookToScenario(badMetadataId);
assert.equal(badMetadataResult.ok, false);
assert.equal(badMetadataResult.source, undefined);
assert.ok(badMetadataResult.diagnostics.some(d =>
  d.code === "WORKBOOK_SCENARIO_ID_INVALID" &&
  d.table === "Metadata" && d.row === 1 && d.field === "scenarioId"));
assert.equal(badMetadataResult.preview.errors, 1,
  "An invalid scenario ID must appear in the same preview shown to the operator");
assert.equal(badMetadataResult.preview.rejectedRows.Metadata, 1);

// The version field is source evidence, not a hint to silently import a
// future workbook with potentially different semantics as current schema.
const futureWorkbook = workbook(2);
futureWorkbook.tables[0].records[0].fields.schemaVersion = cell("2.0.0");
const futureResult = mapNetworkWorkbookToScenario(futureWorkbook);
assert.equal(futureResult.ok, false);
assert.equal(futureResult.source, undefined);
assert.ok(futureResult.diagnostics.some(d =>
  d.code === "WORKBOOK_SCHEMA_VERSION_UNSUPPORTED" &&
  d.table === "Metadata" && d.row === 1 && d.field === "schemaVersion"));
assert.ok(futureResult.preview.errors > 0);

const emptyMetadata = workbook(2);
emptyMetadata.tables[0].records = [];
const emptyMetadataResult = mapNetworkWorkbookToScenario(emptyMetadata);
assert.equal(emptyMetadataResult.ok, false,
  "A required Metadata sheet with no record cannot be silently synthesized");
assert.ok(emptyMetadataResult.diagnostics.some(d => d.code === "WORKBOOK_METADATA_EMPTY"));
assert.ok(emptyMetadataResult.preview.errors > 0);

const ambiguousMetadata = workbook(2);
ambiguousMetadata.tables[0].records.push(record(2,
  { schemaVersion: "1.0.0", scenarioId: "other_scenario", title: "Other Scenario" }));
const ambiguousResult = mapNetworkWorkbookToScenario(ambiguousMetadata);
assert.equal(ambiguousResult.ok, false,
  "An extra competing Metadata record cannot silently be discarded");
assert.ok(ambiguousResult.diagnostics.some(d => d.code === "WORKBOOK_METADATA_MULTIPLE"));
assert.ok(ambiguousResult.preview.errors > 0);

// Inventory-normalized workbooks may omit version metadata; absence must
// remain compatible while an explicitly unsupported version is rejected.
const noVersion = workbook(2);
delete noVersion.tables[0].records[0].fields.schemaVersion;
assert.equal(mapNetworkWorkbookToScenario(noVersion).ok, true);

console.log("PASS IMPORT-036: truthful row totals, metadata identity and version validation");

// IMPORT-037: an explicit IPv4/CIDR is one documented address, even if
// a spreadsheet also declares the same prefix in the separate column.
// Malformed or conflicting IP assertions must fail closed before activation.
const ifaceOn = document => document.tables.find(t => t.tableId === "Interfaces").records[0].fields;

// IMPORT-041: reject ambiguous leading-zero IPv4 octets instead of
// presenting a potentially reinterpreted address as trusted source topology.
const ordinaryIPv4 = workbook(2);
ifaceOn(ordinaryIPv4).IPv4 = cell("10.0.0.1/24");
assert.equal(mapNetworkWorkbookToScenario(ordinaryIPv4).ok, true,
  "Ordinary explicit IPv4/CIDR must remain importable");
for (const ambiguous of ["010.0.0.1", "10.00.0.1", "10.0.0.001/24"]) {
  const malformed = workbook(2);
  ifaceOn(malformed).IPv4 = cell(ambiguous);
  const result = mapNetworkWorkbookToScenario(malformed);
  assert.equal(result.ok, false, `Ambiguous IPv4 ${ambiguous} must fail closed`);
  assert.ok(result.diagnostics.some(d => d.code === "WORKBOOK_IPV4_INVALID" &&
    d.table === "Interfaces" && d.row === 1 && d.field === "IPv4"));
  assert.equal(result.source, undefined, "No ambiguous address may enter Builder");
}
console.log("PASS IMPORT-041: canonical IPv4 accepted, leading-zero octets rejected");

const inlineCidr = workbook(2);
ifaceOn(inlineCidr).IPv4 = cell("10.0.0.1/24");
ifaceOn(inlineCidr).prefix = cell("24");
const inlineResult = mapNetworkWorkbookToScenario(inlineCidr);
assert.equal(inlineResult.ok, true, JSON.stringify(inlineResult.diagnostics));
assert.deepEqual(inlineResult.source.resources[0].interfaces[0].addresses,
  ["10.0.0.1/24"], "Do not write duplicate /24/24 for the same declared prefix");
assert.equal(inlineResult.source.connections.length, 1,
  "A prefix may not create inferred physical network links");

const inlineOnly = workbook(2);
ifaceOn(inlineOnly).IPv4 = cell("10.0.0.1/24");
delete ifaceOn(inlineOnly).prefix;
assert.deepEqual(mapNetworkWorkbookToScenario(inlineOnly).source.resources[0].interfaces[0].addresses,
  ["10.0.0.1/24"], "Preserve explicit IPv4/CIDR with no second prefix column");

const zeroPrefix = workbook(2);
ifaceOn(zeroPrefix).prefix = cell(0);
assert.deepEqual(mapNetworkWorkbookToScenario(zeroPrefix).source.resources[0].interfaces[0].addresses,
  ["10.0.0.1/0"], "A declared /0 is a valid prefix, not a missing value");

const macOnlyAddress = workbook(2);
delete ifaceOn(macOnlyAddress).IPv4;
delete ifaceOn(macOnlyAddress).prefix;
ifaceOn(macOnlyAddress).MAC = cell("AA:BB:CC:DD:EE:01");
const macOnlyResult = mapNetworkWorkbookToScenario(macOnlyAddress);
assert.equal(macOnlyResult.ok, true, JSON.stringify(macOnlyResult.diagnostics));
assert.equal(macOnlyResult.source.resources[0].interfaces[0].mac, "AA:BB:CC:DD:EE:01");
assert.equal(macOnlyResult.source.resources[0].interfaces[0].addresses, undefined,
  "Do not invent an IP for a documented MAC-only interface");

for (const { ip, prefix, code, field } of [
  { ip: "999.0.0.1", prefix: "24", code: "WORKBOOK_IPV4_INVALID", field: "IPv4" },
  { ip: "10.0.0", prefix: "24", code: "WORKBOOK_IPV4_INVALID", field: "IPv4" },
  { ip: "10.0.0.1/33", prefix: undefined, code: "WORKBOOK_IPV4_INVALID", field: "IPv4" },
  { ip: "10.0.0.1/24/25", prefix: undefined, code: "WORKBOOK_IPV4_INVALID", field: "IPv4" },
  { ip: "10.0.0.1", prefix: "33", code: "WORKBOOK_IPV4_PREFIX_INVALID", field: "prefix" },
  { ip: "10.0.0.1", prefix: "24.5", code: "WORKBOOK_IPV4_PREFIX_INVALID", field: "prefix" },
  { ip: "10.0.0.1/24", prefix: "23", code: "WORKBOOK_IPV4_PREFIX_CONFLICT", field: "prefix" },
  { ip: undefined, prefix: "24", code: "WORKBOOK_IPV4_PREFIX_WITHOUT_ADDRESS", field: "prefix" },
]) {
  const invalid = workbook(2);
  if (ip === undefined) delete ifaceOn(invalid).IPv4; else ifaceOn(invalid).IPv4 = cell(ip);
  if (prefix === undefined) delete ifaceOn(invalid).prefix; else ifaceOn(invalid).prefix = cell(prefix);
  const result = mapNetworkWorkbookToScenario(invalid);
  assert.equal(result.ok, false, `Invalid address ${JSON.stringify({ ip, prefix })} must fail closed`);
  assert.ok(result.diagnostics.some(d => d.code === code && d.table === "Interfaces" &&
    d.row === 1 && d.field === field), `Expected source-localized ${code}`);
  assert.ok(result.preview.errors > 0);
  assert.equal(result.source, undefined, "Invalid declarations must never produce an importable source");
}
console.log("PASS IMPORT-037: explicit IPv4/CIDR preserved, conflicting or malformed source rejected");

// IMPORT-039: a source link ID occupies the same canonical namespace as
// zones and nodes. The importer may not return ok:true for an object whose
// duplicate identity only fails later during .yadilab Save or compilation.
for (const { duplicate, addZone } of [
  { duplicate: "node_1", addZone: false },
  { duplicate: "floor_a", addZone: true },
]) {
  const invalid = workbook(2);
  if (addZone) invalid.tables.push({
    tableId: "Zones", records: [record(1, {
      zoneId: "floor_a", displayName: "Floor A", kind: "lan",
    })],
  });
  invalid.tables.find(t => t.tableId === "Links").records[0].fields.linkId =
    cell(duplicate);
  const result = mapNetworkWorkbookToScenario(invalid);
  assert.equal(result.ok, false, "Link IDs cannot shadow explicit source objects");
  assert.ok(result.diagnostics.some(d =>
    d.code === "WORKBOOK_CANONICAL_ID_COLLISION" &&
    d.table === "Links" && d.row === 1 && d.field === "linkId"),
    "Collision must identify the actual offending link row and field");
  assert.ok(result.preview.errors > 0);
  assert.equal(result.source, undefined, "No invalid canonical topology may be activated");
}
// Internally generated review objectives and gateway notes must avoid
// *real*, unchanged imported IDs. The original node, link and zone IDs have
// priority; only generated identities may be renamed deterministically.
const generatedCollision = workbook(2);
const renamed = "imported_topology_manual_verification";
generatedCollision.tables.find(t => t.tableId === "Nodes").records[0].fields.nodeId = cell(renamed);
generatedCollision.tables.find(t => t.tableId === "Nodes").records[0].fields.gateway = cell("10.0.0.254");
generatedCollision.tables.find(t => t.tableId === "Interfaces").records[0].fields.nodeId = cell(renamed);
generatedCollision.tables.find(t => t.tableId === "Links").records[0].fields.nodeA = cell(renamed);
generatedCollision.tables.find(t => t.tableId === "Layout").records[0].fields.nodeId = cell(renamed);
generatedCollision.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "gateway_note_1", displayName: "Unchanged declared zone" }),
] });
const generated = mapNetworkWorkbookToScenario(generatedCollision);
assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
assert.equal(generated.source.resources[0].id, renamed, "Never rename an imported node");
assert.deepEqual(generated.source.zones.map(z => z.id), ["gateway_note_1"],
  "Never rename a declared source zone to accommodate a generated note");
assert.deepEqual(generated.source.connections.map(c => c.id), ["link_1"],
  "Never infer or rename a source-declared connection");
assert.equal(generated.source.objectives[0].id, renamed + "_1",
  "Generated review objective must choose a free canonical identity");
assert.equal(generated.source.notes[0].id, "gateway_note_1_1",
  "Generated gateway note must not collide with a declared zone");
assert.equal(generated.source.notes[0].target, renamed,
  "Gateway note must remain attached to the original node identity");
assert.match(generated.source.notes[0].text, /10\.0\.0\.254/,
  "Preserve the exact documented gateway, but do not infer a route");
const canonicalIds = [
  ...generated.source.resources.map(x => x.id),
  ...generated.source.zones.map(x => x.id),
  ...generated.source.connections.map(x => x.id),
  ...generated.source.objectives.map(x => x.id),
  ...generated.source.notes.map(x => x.id),
];
assert.equal(new Set(canonicalIds).size, canonicalIds.length,
  "The generated source must be safe for global Save/Open ID validation");
const repeat = mapNetworkWorkbookToScenario(generatedCollision);
assert.deepEqual(repeat.source, generated.source,
  "Generated IDs and source must be byte-for-byte deterministic across previews");
const shadowObjectiveWithLink = workbook(2);
shadowObjectiveWithLink.tables.find(t => t.tableId === "Links").records[0].fields.linkId =
  cell("imported_topology_manual_verification");
const linkShadow = mapNetworkWorkbookToScenario(shadowObjectiveWithLink);
assert.equal(linkShadow.ok, true, JSON.stringify(linkShadow.diagnostics));
assert.equal(linkShadow.source.connections[0].id,
  "imported_topology_manual_verification", "The imported link owns its actual ID");
assert.equal(linkShadow.source.objectives[0].id,
  "imported_topology_manual_verification_1", "Generated objective must not shadow link ID");
console.log("PASS IMPORT-039: link namespace enforced; generated objective/notes never shadow source identities");

// IMPORT-040: a nonblank but nontext spreadsheet value is NOT a missing
// declaration. In particular Links.kind=true/false previously became a
// fabricated "network" link because the text helper ignored booleans.
const invalidTypedWorkbook = (table, field, invalid) => {
  const candidate = workbook(2);
  if (table === "Zones") candidate.tables.push({ tableId: "Zones", records: [
    record(1, { zoneId: "floor_a", displayName: "Floor A" }),
  ] });
  candidate.tables.find(t => t.tableId === table).records[0].fields[field] = cell(invalid);
  return candidate;
};
for (const { table, field, invalid, code } of [
  { table: "Links", field: "kind", invalid: true, code: "WORKBOOK_LINK_KIND_INVALID" },
  { table: "Links", field: "kind", invalid: false, code: "WORKBOOK_LINK_KIND_INVALID" },
  { table: "Links", field: "interfaceA", invalid: true, code: "WORKBOOK_LINK_PORT_INVALID" },
  { table: "Links", field: "interfaceB", invalid: false, code: "WORKBOOK_LINK_PORT_INVALID" },
  { table: "Nodes", field: "zoneId", invalid: true, code: "WORKBOOK_NODE_ZONE_INVALID" },
  { table: "Interfaces", field: "interfaceId", invalid: false, code: "WORKBOOK_INTERFACE_ID_INVALID" },
  { table: "Zones", field: "kind", invalid: false, code: "WORKBOOK_ZONE_KIND_INVALID" },
  { table: "Interfaces", field: "MAC", invalid: true, code: "WORKBOOK_MAC_INVALID" },
  { table: "Metadata", field: "scenarioId", invalid: true, code: "WORKBOOK_SCENARIO_ID_INVALID" },
  { table: "Metadata", field: "schemaVersion", invalid: false, code: "WORKBOOK_SCHEMA_VERSION_UNSUPPORTED" },
]) {
  const mapped = mapNetworkWorkbookToScenario(
    invalidTypedWorkbook(table, field, invalid));
  assert.equal(mapped.ok, false,
    `Explicit ${table}.${field}=${JSON.stringify(invalid)} cannot be omitted or defaulted`);
  assert.ok(mapped.diagnostics.some(d => d.code === code &&
    d.table === table && d.row === 1 && d.field === field),
    `Typed invalid source must report its actual ${table} row, field and error`);
  assert.equal(mapped.preview.rejectedRows[table], 1,
    "One invalid typed declaration rejects one actual source row");
  assert.ok(mapped.preview.errors > 0);
  assert.equal(mapped.source, undefined,
    "An explicit invalid field must never enter canonical Builder source");
}
const optionalBlankKind = workbook(2);
optionalBlankKind.tables.find(t => t.tableId === "Links").records[0].fields.kind =
  cell("  ");
optionalBlankKind.tables.find(t => t.tableId === "Interfaces").records[0].fields.MAC =
  cell(null);
optionalBlankKind.tables[0].records[0].fields.schemaVersion = cell("");
optionalBlankKind.tables[0].records[0].fields.scenarioId = cell("");
optionalBlankKind.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "floor_a", displayName: "Floor A", kind: "" }),
] });
const blankKindResult = mapNetworkWorkbookToScenario(optionalBlankKind);
assert.equal(blankKindResult.ok, true, JSON.stringify(blankKindResult.diagnostics));
assert.equal(blankKindResult.source.scenarioId, "workbook_scenario",
  "Truly absent scenario identity retains the documented fallback");
assert.equal(blankKindResult.source.connections[0].kind, "network",
  "Only an actually blank link kind may use the documented default");
assert.equal(blankKindResult.source.zones[0].kind, undefined);
assert.equal(blankKindResult.source.resources[0].interfaces[0].mac, undefined);
const explicitManagement = workbook(2);
explicitManagement.tables.find(t => t.tableId === "Links").records[0].fields.kind =
  cell("management");
assert.equal(mapNetworkWorkbookToScenario(explicitManagement).source.connections[0].kind,
  "management", "Never change a valid explicit link type");
console.log("PASS IMPORT-040: explicit typed values fail closed; blank optionals and valid link kinds preserve semantics");

// IMPORT-041: layout target and rank integrity MUST run in required CI.
// A malformed nonblank target, or an explicit rank with no target, cannot
// silently disappear from the canonical source.
const validLayoutTarget = workbook(2);
const validTargetResult = mapNetworkWorkbookToScenario(validLayoutTarget);
assert.equal(validTargetResult.ok, true, JSON.stringify(validTargetResult.diagnostics));
assert.deepEqual(validTargetResult.source.layoutHints[0],
  { target: "node_1", rank: 0 },
  "Valid, explicit layout target and rank must survive mapping");
for (const { target, rank, code } of [
  { target: true, rank: 2, code: "WORKBOOK_LAYOUT_TARGET_INVALID" },
  { target: false, rank: 2, code: "WORKBOOK_LAYOUT_TARGET_INVALID" },
  { target: "", rank: 2, code: "WORKBOOK_LAYOUT_TARGET_MISSING" },
  { target: "  ", rank: "3", code: "WORKBOOK_LAYOUT_TARGET_MISSING" },
  { target: null, rank: 0, code: "WORKBOOK_LAYOUT_TARGET_MISSING" },
]) {
  const document = workbook(2);
  const first = document.tables.find(t => t.tableId === "Layout").records[0];
  first.fields.nodeId = cell(target);
  first.fields.rank = cell(rank);
  const result = mapNetworkWorkbookToScenario(document);
  assert.equal(result.ok, false,
    `Explicit layout rank with target ${JSON.stringify(target)} must fail closed`);
  assert.ok(result.diagnostics.some(d =>
    d.code === code && d.table === "Layout" &&
    d.row === 1 && d.field === "nodeId"),
    `Missing localized ${code} for unrepresentable layout declaration`);
  assert.equal(result.preview.rejectedRows.Layout, 1,
    "One invalid layout declaration rejects precisely one physical source row");
  assert.ok(result.preview.errors >= 1);
  assert.equal(result.source, undefined,
    "Invalid layout data may not activate a canonical Builder source");
}
const blankLayoutRow = workbook(2);
const optionalLayout = blankLayoutRow.tables.find(t => t.tableId === "Layout").records[0];
optionalLayout.fields.nodeId = cell(" ");
optionalLayout.fields.rank = cell(null);
const emptyLayoutResult = mapNetworkWorkbookToScenario(blankLayoutRow);
assert.equal(emptyLayoutResult.ok, true, JSON.stringify(emptyLayoutResult.diagnostics));
assert.deepEqual(emptyLayoutResult.source.layoutHints, [{ target: "node_2", rank: 1 }],
  "A truly empty optional layout row must not create a target or invalidate good rows");
console.log("PASS IMPORT-041: required CI validates explicit layout targets and orphan ranks");

// IMPORT-042: inventory normalization must not drop a declared subnet prefix
// when the CSV/JSON/XLSX source has no IPv4 host. Canonical mapping must
// independently fail closed, even if a caller ignores normalization errors.
const deviceInventory = (extra) => ({ tables: [{ tableId: "Devices", records: [
  record(1, { "Asset ID": "device_1", Hostname: "Imported device", "Device Type": "Server", ...extra }),
] }] });
for (const extra of [
  { "Prefix Length": "24" },
  { "Prefix Length": 0 },
  { "MAC Address": "AA:BB:CC:DD:EE:01", "Prefix Length": "24" },
]) {
  const normalized = normalizeNetworkInventoryDocument(deviceInventory(extra));
  assert.ok(normalized.diagnostics.some(d => d.code === "NETWORK_IMPORT_PREFIX_WITHOUT_IP" &&
    d.table === "Devices" && d.row === 1),
    "Source-localized error required for a prefix without an IPv4 host");
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  assert.equal(mapped.ok, false, "Orphan prefixes must fail even if normalization diagnostics are not consumed");
  assert.ok(mapped.diagnostics.some(d => d.code === "WORKBOOK_IPV4_PREFIX_WITHOUT_ADDRESS" &&
    d.table === "Interfaces" && d.row === 1 && d.field === "prefix"));
  assert.ok(mapped.preview.errors > 0);
  assert.equal(mapped.source, undefined, "No orphan network prefix may reach Builder");
}
for (const blankPrefix of [undefined, "", "   ", null]) {
  const normalized = normalizeNetworkInventoryDocument(deviceInventory({ "Prefix Length": blankPrefix }));
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  assert.ok(!normalized.diagnostics.some(d => d.severity === "error"));
  assert.equal(mapped.ok, true, JSON.stringify(mapped.diagnostics));
  assert.equal(mapped.source.resources[0].interfaces, undefined,
    "A genuinely empty optional prefix must not synthesize an interface");
}
const documentedIPv4 = normalizeNetworkInventoryDocument(deviceInventory({
  "IP Address": "10.20.30.40", "Prefix Length": "24",
}));
assert.equal(documentedIPv4.diagnostics.filter(d => d.severity === "error").length, 0);
assert.deepEqual(mapNetworkWorkbookToScenario(documentedIPv4.document).source.resources[0].interfaces[0].addresses,
  ["10.20.30.40/24"], "Keep explicitly documented IPv4 and prefix intact");
const invalidTypedPrefix = normalizeNetworkInventoryDocument(deviceInventory({
  "IP Address": "10.20.30.40", "Prefix Length": true,
}));
assert.ok(invalidTypedPrefix.diagnostics.some(d =>
  d.code === "NETWORK_IMPORT_PREFIX_INVALID" && d.table === "Devices" && d.row === 1),
  "Nonblank nontext prefix values must not silently be omitted");
console.log("PASS IMPORT-042: inventory orphan-prefix and invalid typed prefix fail closed; blank and valid source preserved");

// IMPORT-043: an explicit nonblank but nontext value is not a missing
// declaration. This is critical for JSON booleans and malformed workbook cells
// that previously became omitted network facts, generic roles or default links.
for (const { column, invalid, field } of [
  { column: "Hostname", invalid: true, field: "label" },
  { column: "Device Type", invalid: false, field: "type" },
  { column: "IP Address", invalid: true, field: "ip" },
  { column: "CIDR", invalid: false, field: "cidr" },
  { column: "MAC Address", invalid: {}, field: "mac" },
  { column: "Default Gateway", invalid: true, field: "gateway" },
  { column: "Connected To", invalid: false, field: "target" },
]) {
  const normalized = normalizeNetworkInventoryDocument(deviceInventory({ [column]: invalid }));
  assert.ok(normalized.diagnostics.some(d =>
    d.code === "NETWORK_IMPORT_FIELD_TYPE_INVALID" &&
    d.table === "Devices" && d.row === 1 && d.field === field),
    `Explicit invalid ${column} must not silently become an absent source fact`);
}
// A separate Links sheet may not synthesize a link ID or default its kind
// when the source provides an unsupported boolean/object instead.
const sheetInventory = changes => ({ tables: [
  { tableId: "Devices", records: [
    record(1, { "Asset ID": "device_1", Hostname: "One", "Device Type": "Server" }),
    record(2, { "Asset ID": "device_2", Hostname: "Two", "Device Type": "Server" }),
  ] },
  { tableId: "Links", records: [record(1, {
    linkId: "edge_1", nodeA: "device_1", nodeB: "device_2", kind: "management", ...changes,
  })] },
] });
for (const { field, invalid } of [
  { field: "linkId", invalid: true },
  { field: "nodeA", invalid: false },
  { field: "nodeB", invalid: {} },
  { field: "interfaceA", invalid: true },
  { field: "interfaceB", invalid: false },
  { field: "kind", invalid: true },
]) {
  const normalized = normalizeNetworkInventoryDocument(sheetInventory({ [field]: invalid }));
  assert.ok(normalized.diagnostics.some(d =>
    d.code === "NETWORK_IMPORT_FIELD_TYPE_INVALID" &&
    d.table === "Links" && d.row === 1 && d.field === field),
    `Explicit invalid Links.${field} must fail before activation`);
}
const goodTypedInventory = normalizeNetworkInventoryDocument(deviceInventory({
  "IP Address": "10.0.0.5", "MAC Address": "AA:BB:CC:DD:EE:01",
  "Device Type": "Server", "Default Gateway": "10.0.0.1",
}));
assert.equal(goodTypedInventory.diagnostics.some(d => d.severity === "error"), false,
  "Documented IPv4/MAC/default gateway must remain importable");
assert.deepEqual(mapNetworkWorkbookToScenario(goodTypedInventory.document).source.resources[0].interfaces[0].addresses,
  ["10.0.0.5"]);
const goodExplicitLink = normalizeNetworkInventoryDocument(sheetInventory({}));
assert.equal(goodExplicitLink.diagnostics.some(d => d.severity === "error"), false);
const linkedSource = mapNetworkWorkbookToScenario(goodExplicitLink.document);
assert.equal(linkedSource.ok, true, JSON.stringify(linkedSource.diagnostics));
assert.equal(linkedSource.source.connections[0].id, "edge_1");
assert.equal(linkedSource.source.connections[0].kind, "management");
assert.equal(linkedSource.source.connections[0].from.resource, "device_1");
assert.equal(linkedSource.source.connections[0].to.resource, "device_2");
const blankOptionalLink = normalizeNetworkInventoryDocument(sheetInventory({
  linkId: " ", kind: null, interfaceA: "", interfaceB: null,
}));
assert.equal(blankOptionalLink.diagnostics.some(d => d.severity === "error"), false);
const defaultLink = mapNetworkWorkbookToScenario(blankOptionalLink.document);
assert.equal(defaultLink.ok, true, JSON.stringify(defaultLink.diagnostics));
assert.equal(defaultLink.source.connections[0].id, "link_sheet_row_1");
assert.equal(defaultLink.source.connections[0].kind, "network");
console.log("PASS IMPORT-043: typed network declarations rejected; valid, blank and explicit links preserved");

// IMPORT-044: canonical workbook IPv6 must be valid before Builder activation.
// The source schema itself only guarantees a nonempty address string.
const ipv6Interface = book => book.tables.find(t => t.tableId === "Interfaces").records[0].fields;
for (const address of [
  "::", "::1", "fe80::", "2001:db8::1", "2001:db8::1/64",
  "2001:0db8:0000:0000:0000:ff00:0042:8329", "::ffff:192.0.2.1",
  "::ffff:192.0.2.1/128", "1:2:3:4:5:6:192.0.2.1",
  "2001:db8::1/0", "1:2:3:4:5:6:7:8",
]) {
  const book = workbook(2);
  const iface = ipv6Interface(book);
  delete iface.IPv4;
  delete iface.prefix;
  iface.IPv6 = cell(address);
  const mapped = mapNetworkWorkbookToScenario(book);
  assert.equal(mapped.ok, true, JSON.stringify(mapped.diagnostics));
  assert.deepEqual(mapped.source.resources[0].interfaces[0].addresses, [address],
    "Exact documented IPv6 is retained without invented IPv4");
}
for (const address of [
  "2001:db8", "2001:::1", "1::2::3", "2001:db8:zz::1",
  "2001:db8:0:0:0:0:0:0:1", "1:2:3:4:5:6:7::8",
  "2001:db8::1/129", "2001:db8::1/-1", "2001:db8::1/64/65",
  "2001:db8::1/", "fe80::1%eth0", "10.0.0.1",
  "::ffff:999.1.1.1", "::ffff:010.0.0.1", "[2001:db8::1]",
  true, {}, 1234,
]) {
  const book = workbook(2);
  ipv6Interface(book).IPv6 = cell(address);
  const mapped = mapNetworkWorkbookToScenario(book);
  assert.equal(mapped.ok, false, "Malformed IPv6 must fail: " + JSON.stringify(address));
  assert.ok(mapped.diagnostics.some(d => d.code === "WORKBOOK_IPV6_INVALID" &&
    d.table === "Interfaces" && d.row === 1 && d.field === "IPv6"));
  assert.equal(mapped.preview.rejectedRows.Interfaces, 1);
  assert.equal(mapped.source, undefined);
}
for (const [ipv6, prefix, expected] of [
  ["2001:db8::10", 64, "2001:db8::10/64"],
  ["2001:db8::10/64", 64, "2001:db8::10/64"],
  ["::", 0, "::/0"],
  ["fe80::2", 128, "fe80::2/128"],
]) {
  const book = workbook(2);
  ipv6Interface(book).IPv6 = cell(ipv6);
  ipv6Interface(book).IPv6Prefix = cell(prefix);
  const mapped = mapNetworkWorkbookToScenario(book);
  assert.equal(mapped.ok, true, JSON.stringify(mapped.diagnostics));
  assert.deepEqual(mapped.source.resources[0].interfaces[0].addresses,
    ["10.0.0.1/24", expected], "IPv4 and IPv6 declared masks must be preserved");
}
for (const { ipv6, prefix, code } of [
  { ipv6: undefined, prefix: 64, code: "WORKBOOK_IPV6_PREFIX_WITHOUT_ADDRESS" },
  { ipv6: "2001:db8::1", prefix: 129, code: "WORKBOOK_IPV6_PREFIX_INVALID" },
  { ipv6: "2001:db8::1", prefix: false, code: "WORKBOOK_IPV6_PREFIX_INVALID" },
  { ipv6: "2001:db8::1", prefix: "64.5", code: "WORKBOOK_IPV6_PREFIX_INVALID" },
  { ipv6: "2001:db8::1/64", prefix: 65, code: "WORKBOOK_IPV6_PREFIX_CONFLICT" },
]) {
  const book = workbook(2);
  if (ipv6 !== undefined) ipv6Interface(book).IPv6 = cell(ipv6);
  ipv6Interface(book).IPv6Prefix = cell(prefix);
  const mapped = mapNetworkWorkbookToScenario(book);
  assert.equal(mapped.ok, false);
  assert.ok(mapped.diagnostics.some(d => d.code === code && d.table === "Interfaces" &&
    d.row === 1 && d.field === "IPv6Prefix"), "Missing invalid-prefix diagnostic " + code);
  assert.equal(mapped.source, undefined);
}
// Actual CSV adapter => Devices normalization => canonical Builder source.
// This checks source locators and the complete dual-stack interface identity.
const dualStackHeaders = [
  "Asset ID", "Hostname", "Device Type", "IP Address", "Prefix Length",
  "IPv6 Address", "IPv6 Prefix", "Interface ID", "Interface Name",
  "MTU", "MAC Address", "Connected To",
];
const dualStackRows = [
  ["edge01", "Edge Router", "Router", "10.14.0.1", "24",
    "2001:db8:14::1", "64", "eth0", "LAN Uplink", "1500",
    "AA:BB:CC:DD:EE:01", "peer01"],
  ["peer01", "Peer", "Server", "", "", "fe80::2", "", "eth1", "",
    "9000", "", ""],
];
const dualStackCsv = [dualStackHeaders.join(","),
  ...dualStackRows.map(row => row.join(","))].join("\n") + "\n";
const csvParsed = await csvImportAdapter.parse({
  bytes: new TextEncoder().encode(dualStackCsv), mediaType: "text/csv",
}, { options: { tableName: "Devices" } });
const csvPrepared = normalizeNetworkInventoryDocument(csvParsed.document);
assert.equal(csvPrepared.unmappedColumnCount, 0,
  "IPv6, port metadata and MTU must be recognized rather than ignored");
assert.equal(csvPrepared.diagnostics.some(d => d.severity === "error"), false,
  JSON.stringify(csvPrepared.diagnostics));
assert.deepEqual(
  csvPrepared.document.tables.find(t => t.tableId === "Interfaces").records[0].fields.IPv6.locator,
  csvParsed.document.tables[0].records[0].fields["IPv6 Address"].locator,
  "Preserve original IPv6 source cell locator");
const dualStackMapped = mapNetworkWorkbookToScenario(csvPrepared.document);
assert.equal(dualStackMapped.ok, true, JSON.stringify(dualStackMapped.diagnostics));
const edge = dualStackMapped.source.resources.find(r => r.id === "edge01");
const peer = dualStackMapped.source.resources.find(r => r.id === "peer01");
assert.deepEqual(edge.interfaces[0], {
  id: "eth0", label: "LAN Uplink", addresses: ["10.14.0.1/24", "2001:db8:14::1/64"],
  mac: "AA:BB:CC:DD:EE:01", mtu: 1500,
});
assert.deepEqual(peer.interfaces[0], {
  id: "eth1", label: "eth1", addresses: ["fe80::2"], mtu: 9000,
});
assert.equal(dualStackMapped.source.connections.length, 1);
assert.deepEqual(dualStackMapped.source.connections[0].from, { resource: "edge01" });
assert.deepEqual(dualStackMapped.source.connections[0].to, { resource: "peer01" });
assert.equal(dualStackMapped.source.notes?.length ?? 0, 0,
  "Addresses must not fabricate gateway notes or tested routes");
const portDeclaredOnly = normalizeNetworkInventoryDocument(deviceInventory({
  "Interface ID": "eth0", "Interface Name": "LAN uplink", MTU: 1500,
}));
assert.equal(portDeclaredOnly.diagnostics.some(d => d.severity === "error"), false);
const portOnlyResult = mapNetworkWorkbookToScenario(portDeclaredOnly.document);
assert.equal(portOnlyResult.ok, true, JSON.stringify(portOnlyResult.diagnostics));
assert.deepEqual(portOnlyResult.source.resources[0].interfaces[0],
  { id: "eth0", label: "LAN uplink", mtu: 1500 },
  "An explicit interface identity/MTU without IP does not invent an address");
const nameOnly = normalizeNetworkInventoryDocument(deviceInventory({
  "Interface Name": "uplink0",
}));
assert.equal(mapNetworkWorkbookToScenario(nameOnly.document).source.resources[0].interfaces[0].id,
  "uplink0", "Canonical declared interface name must survive as an ID");
const literalPortLabel = normalizeNetworkInventoryDocument(deviceInventory({
  "Interface Name": "GigabitEthernet0/1",
}));
const namedPort = mapNetworkWorkbookToScenario(literalPortLabel.document);
assert.equal(namedPort.ok, true, JSON.stringify(namedPort.diagnostics));
assert.deepEqual(namedPort.source.resources[0].interfaces[0],
  { id: "primary", label: "GigabitEthernet0/1" },
  "Noncanonical interface name may be a label, not a fabricated physical ID");
for (const { values, code, origin, field } of [
  { values: { "IPv6 Address": "2001:::1" }, code: "WORKBOOK_IPV6_INVALID",
    origin: "Interfaces", field: "IPv6" },
  { values: { "IPv6 Prefix": 64 }, code: "NETWORK_IMPORT_IPV6_PREFIX_WITHOUT_ADDRESS",
    origin: "Devices", field: "ipv6Prefix" },
  { values: { "IPv6 Address": "2001:db8::1", "IPv6 Prefix": 129 },
    code: "WORKBOOK_IPV6_PREFIX_INVALID", origin: "Interfaces", field: "IPv6Prefix" },
  { values: { "IPv6 Address": "2001:db8::1/64", "IPv6 Prefix": 65 },
    code: "WORKBOOK_IPV6_PREFIX_CONFLICT", origin: "Interfaces", field: "IPv6Prefix" },
  { values: { "IPv6 Address": true }, code: "NETWORK_IMPORT_FIELD_TYPE_INVALID",
    origin: "Devices", field: "ipv6" },
  { values: { "IPv6 Prefix": false }, code: "NETWORK_IMPORT_FIELD_TYPE_INVALID",
    origin: "Devices", field: "ipv6Prefix" },
  { values: { "Interface ID": "eth0/1" }, code: "WORKBOOK_INTERFACE_ID_INVALID",
    origin: "Interfaces", field: "interfaceId" },
  { values: { "Interface Name": true }, code: "NETWORK_IMPORT_FIELD_TYPE_INVALID",
    origin: "Devices", field: "interfaceName" },
  { values: { "Interface ID": true }, code: "NETWORK_IMPORT_FIELD_TYPE_INVALID",
    origin: "Devices", field: "interfaceId" },
  { values: { MTU: false }, code: "NETWORK_IMPORT_FIELD_TYPE_INVALID",
    origin: "Devices", field: "mtu" },
  { values: { MTU: "0" }, code: "WORKBOOK_MTU_INVALID",
    origin: "Interfaces", field: "MTU" },
  { values: { MTU: "1500.5" }, code: "WORKBOOK_MTU_INVALID",
    origin: "Interfaces", field: "MTU" },
]) {
  const normalized = normalizeNetworkInventoryDocument(deviceInventory(values));
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  const diagnostics = [...normalized.diagnostics, ...mapped.diagnostics];
  assert.ok(diagnostics.some(d => d.code === code && d.table === origin &&
    d.row === 1 && d.field === field),
    "Missing source-field diagnostic " + code + ": " + JSON.stringify(diagnostics));
  assert.ok(!mapped.ok || normalized.diagnostics.some(d => d.severity === "error"),
    "Malformed IPv6, MTU or port must block activation");
}
const competingIPv6 = normalizeNetworkInventoryDocument(deviceInventory({
  IPv6: "2001:db8::1", "IPv6 Address": "2001:db8::2",
}));
assert.ok(competingIPv6.diagnostics.some(d => d.code === "NETWORK_IMPORT_FIELD_AMBIGUOUS"),
  "Competing IPv6 columns must not silently prefer one source truth");
const blankNewFields = normalizeNetworkInventoryDocument(deviceInventory({
  IPv6: null, "IPv6 Prefix": " ", MTU: "", "Interface ID": null, "Interface Name": "",
}));
assert.equal(blankNewFields.diagnostics.some(d => d.severity === "error"), false);
const blankMapped = mapNetworkWorkbookToScenario(blankNewFields.document);
assert.equal(blankMapped.ok, true, JSON.stringify(blankMapped.diagnostics));
assert.equal(blankMapped.source.resources[0].interfaces, undefined,
  "Genuinely blank optional metadata must not invent an interface");
console.log("PASS IMPORT-044: end-to-end dual-stack CSV preserves source IPv6, ports and MTU; invalid and competing declarations block activation");

console.log("PASS dev2 workbook mapping: 15 assertions across 30/50/80 nodes and fail-closed references.");
