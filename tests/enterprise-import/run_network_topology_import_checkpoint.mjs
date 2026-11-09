import assert from "node:assert/strict";
import fs from "node:fs";
import { mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument, csvImportAdapter, xlsxImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";

const csv = async (contents) => (await csvImportAdapter.parse({ bytes: new TextEncoder().encode(contents), mediaType: "text/csv" }, { options: { tableName: "Devices" } })).document;
const map = (document) => { const prepared = normalizeNetworkInventoryDocument(document); const result = mapNetworkWorkbookToScenario(prepared.document); const diagnostics = [...prepared.diagnostics, ...result.diagnostics]; return { prepared, result, ok: result.ok && !diagnostics.some((d) => d.severity === "error"), diagnostics }; };
const connected = `Asset ID,Hostname,Device Type,IP Address,Connected To\nsw01,Core Switch,Switch,10.10.0.2,rt01\nrt01,Main Router,Router,10.10.0.1,\npc01,Office PC,Windows,10.10.0.20,sw01\n`;
const a = map(await csv(connected));
assert.equal(a.result.ok, true, JSON.stringify(a.diagnostics));
assert.equal(a.result.source.resources.length, 3);
assert.equal(a.result.source.connections.length, 2);
assert.equal(a.result.source.resources.find((x) => x.id === "sw01").type, "network.switch");
assert.equal(a.result.source.resources.find((x) => x.id === "rt01").type, "network.router");
assert.deepEqual(a.result.source.resources.find((x) => x.id === "pc01").interfaces[0].addresses, ["10.10.0.20"]);
assert.deepEqual(a.result.source.connections.map((x) => [x.from.resource, x.to.resource]), [["sw01", "rt01"], ["pc01", "sw01"]]);
// PROJECT-076D: the intermediate canonical document must make generated
// defaults explicit instead of fabricating table/row locators for them.
const generatedMetadata = a.prepared.document.tables.find((table) => table.tableId === "Metadata")?.records[0]?.fields;
assert.equal(generatedMetadata?.scenarioId.locator.kind, "system-generated");
assert.equal(generatedMetadata?.scenarioId.sourceBinding, "SYSTEM_GENERATED");
const generatedInterface = a.prepared.document.tables.find((table) => table.tableId === "Interfaces")?.records[0]?.fields;
assert.equal(generatedInterface?.interfaceId.locator.kind, "system-generated");
assert.equal(generatedInterface?.name.sourceBinding, "SYSTEM_GENERATED");
const generatedLink = a.prepared.document.tables.find((table) => table.tableId === "Links")?.records[0]?.fields;
assert.equal(generatedLink?.linkId.locator.kind, "system-generated");
assert.equal(generatedLink?.nodeB.sourceBinding, "ALIAS");
const transformedRole = a.prepared.document.tables.find((table) => table.tableId === "Nodes")?.records[0]?.fields.type;
assert.equal(transformedRole?.sourceBinding, "TRANSFORMED");
const noConnections = map(await csv(`Asset ID,Hostname,Device Type,IP Address,Default Gateway\nsw01,Switch,Switch,10.0.0.2,10.0.0.1\nrt01,Router,Router,10.0.0.1,\n`));
assert.equal(noConnections.result.ok, true, JSON.stringify(noConnections.diagnostics));
assert.equal(noConnections.result.source.connections.length, 0, "Never infer links from addresses or gateways");
assert.equal(noConnections.result.source.notes.length, 1, "Explicit gateway value is recorded as source metadata, not a link");
assert.ok(noConnections.diagnostics.some((d) => d.code === "NETWORK_IMPORT_NO_EXPLICIT_LINKS"));
// PROJECT-032: Source-declared MAC-only inventory entries must not disappear
// simply because an IPv4 address is unknown. Never fabricate an address,
// cable, physical switch port or tested reachability for that resource.
const macOnly = map(await csv(`Asset ID,Hostname,Device Type,MAC Address
swmac,MAC-only Switch,Switch,AA:BB:CC:DD:EE:01
bare,No MAC or IP,Server,
`));
assert.equal(macOnly.ok, true, JSON.stringify(macOnly.diagnostics));
const macSwitch = macOnly.result.source.resources.find(x => x.id === "swmac");
assert.equal(macSwitch?.interfaces?.length, 1,
  "Explicit MAC without IPv4 must produce one documented interface");
assert.equal(macSwitch.interfaces[0].mac, "AA:BB:CC:DD:EE:01",
  "Do not alter the original documented MAC address");
assert.equal(macSwitch.interfaces[0].addresses, undefined,
  "MAC-only row must never invent an IPv4 address");
assert.equal(macOnly.result.source.resources.find(x => x.id === "bare")?.interfaces,
  undefined, "An empty MAC/IP row must not invent an interface");
assert.equal(macOnly.result.source.connections.length, 0,
  "A MAC address is not proof of a physical link");
assert.ok(!macOnly.diagnostics.some(d => d.code === "NETWORK_IMPORT_IP_INVALID"));
const invalidMac = map(await csv(`Asset ID,Hostname,Device Type,MAC Address
badmac,Unparseable,Server,AA:BB:CC:DD:EE:GG
`));
assert.equal(invalidMac.ok, false, "Malformed MAC must not be treated as valid imported topology");
assert.ok(invalidMac.diagnostics.some(d => d.code === "NETWORK_IMPORT_MAC_INVALID"),
  "Invalid explicit MAC must generate a clear fail-closed diagnostic");
const ipAndMac = map(await csv(`Asset ID,Hostname,Device Type,IP Address,MAC Address
hostmac,Documented Host,Server,10.12.0.11,0a:0b:0c:0d:0e:0f
`));
assert.equal(ipAndMac.ok, true, JSON.stringify(ipAndMac.diagnostics));
assert.deepEqual(ipAndMac.result.source.resources[0].interfaces[0].addresses,
  ["10.12.0.11"], "Existing IPv4+MAC source must retain documented address");
assert.equal(ipAndMac.result.source.resources[0].interfaces[0].mac,
  "0a:0b:0c:0d:0e:0f");
console.log("PASS PROJECT-032: MAC-only source retained, blank rows unchanged, invalid MAC rejected, no inferred links");

const ghost = map(await csv(`Asset ID,Hostname,Device Type,Connected To\nnode01,PC,Windows,ghost\n`));
assert.equal(ghost.result.ok, false);
assert.ok(ghost.diagnostics.some((d) => d.code === "WORKBOOK_LINK_ENDPOINT_UNKNOWN"));
const duplicate = map(await csv(`Asset ID,Hostname,Device Type\nnode01,PC,Windows\nnode01,PC2,Windows\n`));
assert.equal(duplicate.result.ok, false);
assert.ok(duplicate.diagnostics.some((d) => d.code === "NETWORK_IMPORT_DUPLICATE_DEVICE_ID"));
const invalid = map(await csv(`Asset ID,Hostname,Device Type,IP Address\nnode01,PC,Windows,999.0.0.1\n`));
assert.equal(invalid.ok, false);
assert.ok(invalid.diagnostics.some((d) => d.code === "NETWORK_IMPORT_IP_INVALID"));
const mixed = map(await csv(`Asset ID,Hostname,Device Type,IP Address\na1,Unknown,SomeNewRole,10.0.0.2\n`));
assert.equal(mixed.result.ok, true);
assert.equal(mixed.result.source.resources[0].type, "resource.generic");
assert.ok(mixed.diagnostics.some((d) => d.code === "NETWORK_IMPORT_ROLE_UNKNOWN"));
const sample = new Uint8Array(fs.readFileSync("examples/enterprise-import/enterprise-import-template.xlsx"));
const sampleParsed = await xlsxImportAdapter.parse({ bytes: sample, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { options: {} });
const sampleMapped = map(sampleParsed.document);
assert.equal(sampleMapped.result.ok, true, JSON.stringify(sampleMapped.diagnostics));
assert.ok(sampleMapped.result.source.resources.length > 0);
console.log("PASS IMPORT-001: CSV devices, explicit links, MAC preservation, no inferred topology, switch/router, fail-closed invalid source fields, real XLSX.");
