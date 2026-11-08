import type { ScenarioSource, Scenariosourceconnection, Scenariosourceresource } from "../../core-model/src/generated/contracts.js";
import type { ImportDiagnostic, ImportDocument, ImportRecord } from "./types.js";

export const YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION = "1.0.0" as const;
export const standardWorkbookSheets = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Routes", "VLANs", "STP", "Services", "Firewall", "NAT", "Flows", "Layout"] as const;
export type StandardWorkbookSheet = typeof standardWorkbookSheets[number];

export interface WorkbookImportResult { readonly ok: boolean; readonly source?: ScenarioSource; readonly diagnostics: readonly ImportDiagnostic[]; readonly preview: WorkbookPreview; }
export interface WorkbookPreview { readonly mode: "PREVIEW"; readonly sheetsFound: readonly string[]; readonly sheetsRequired: readonly string[]; readonly sheetsOptional: readonly string[]; readonly rowsPerSheet: Readonly<Record<string, number>>; readonly mappedRows: Readonly<Record<string, number>>; readonly rejectedRows: Readonly<Record<string, number>>; readonly errors: number; readonly warnings: number; }

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KINDS = new Set(["internet", "wan", "dmz", "lan", "server", "management", "security", "backup", "guest", "custom"]);
// Mirror schema/scenario-source.schema.json constraints on fields that the
// workbook mapping emits, so preview does not accept a source Save will reject.
const RESOURCE_TYPE = /^[a-z][a-z0-9_.-]{0,127}$/;
const MAC_ADDRESS = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/;
const LINK_KINDS = new Set(["network", "management", "trust", "authentication", "dependency", "data_flow"]);
const byTable = (document: ImportDocument) => new Map(document.tables.map((table) => [table.tableId, table] as const));
const value = (record: ImportRecord, field: string): unknown => record.fields[field]?.value;
const text = (record: ImportRecord, field: string): string | undefined => { const v = value(record, field); return typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : undefined; };
const integer = (record: ImportRecord, field: string): number | undefined => { const v = value(record, field); const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN; return Number.isSafeInteger(n) ? n : undefined; };
// Optional source fields may be blank in CSV/XLSX/ODS; blank is not a
// declaration. Nonblank malformed values must still be rejected explicitly.
const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const bool = (record: ImportRecord, field: string): boolean | undefined => { const v = value(record, field); return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined; };
function diagnostic(code: string, message: string, table: string, row: number, field?: string): ImportDiagnostic { return { code, severity: "error", message, table, row, ...(field ? { field } : {}) }; }
function rows(table: ReturnType<typeof byTable>, name: string): readonly ImportRecord[] { return table.get(name)?.records ?? []; }

export function validateNetworkWorkbook(document: ImportDocument): readonly ImportDiagnostic[] {
  const diagnostics: ImportDiagnostic[] = [];
  const tables = byTable(document);
  for (const table of document.tables) if (!standardWorkbookSheets.includes(table.tableId as StandardWorkbookSheet)) diagnostics.push({ code: "WORKBOOK_UNSUPPORTED_SHEET", severity: "warning", message: `Sheet '${table.tableId}' is not part of the Network Workbook Schema v${YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION}.`, table: table.tableId });
  for (const required of ["Metadata", "Nodes"] as const) if (!tables.has(required)) diagnostics.push({ code: "WORKBOOK_REQUIRED_SHEET_MISSING", severity: "error", message: `Required sheet '${required}' is missing.`, table: required });
  // The Metadata sheet is a single authoritative workbook identity.
  // Do not drop competing records or reinterpret an explicitly newer schema.
  if (tables.has("Metadata")) {
    const metadataRows = rows(tables, "Metadata");
    if (metadataRows.length === 0) diagnostics.push({
      code: "WORKBOOK_METADATA_EMPTY", severity: "error",
      message: "The required Metadata sheet must contain one record.",
      table: "Metadata",
    });
    if (metadataRows.length > 1) diagnostics.push({
      code: "WORKBOOK_METADATA_MULTIPLE", severity: "error",
      message: "Multiple competing Metadata records cannot establish a single source identity.",
      table: "Metadata",
    });
    for (const record of metadataRows) {
      const declaredVersion = text(record, "schemaVersion");
      if (declaredVersion && declaredVersion !== YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION)
        diagnostics.push(diagnostic("WORKBOOK_SCHEMA_VERSION_UNSUPPORTED",
          "Metadata.schemaVersion is not supported; the imported structure was not reinterpreted.",
          "Metadata", record.recordIndex, "schemaVersion"));
      const scenarioId = text(record, "scenarioId");
      if (scenarioId && !ID.test(scenarioId))
        diagnostics.push(diagnostic("WORKBOOK_SCENARIO_ID_INVALID",
          "Metadata.scenarioId must be a stable canonical ID.",
          "Metadata", record.recordIndex, "scenarioId"));
    }
  }
  const seen = new Map<string, number>();
  for (const table of document.tables) { const prior = seen.get(table.tableId) ?? 0; if (prior > 0) diagnostics.push({ code: "WORKBOOK_DUPLICATE_SHEET", severity: "error", message: `Duplicate sheet/table '${table.tableId}'.`, table: table.tableId }); seen.set(table.tableId, prior + 1); }
  for (const record of rows(tables, "Nodes")) {
    const id = text(record, "nodeId");
    const type = text(record, "type");
    if (!id || !ID.test(id))
      diagnostics.push(diagnostic("WORKBOOK_NODE_ID_INVALID",
        "Nodes.nodeId must be a stable canonical ID.", "Nodes", record.recordIndex, "nodeId"));
    if (!text(record, "displayName"))
      diagnostics.push(diagnostic("WORKBOOK_NODE_LABEL_MISSING",
        "Nodes.displayName is required.", "Nodes", record.recordIndex, "displayName"));
    if (!type)
      diagnostics.push(diagnostic("WORKBOOK_NODE_TYPE_MISSING",
        "Nodes.type is required.", "Nodes", record.recordIndex, "type"));
    else if (!RESOURCE_TYPE.test(type))
      diagnostics.push(diagnostic("WORKBOOK_NODE_TYPE_INVALID",
        "Nodes.type must be a canonical lowercase resource type identifier.",
        "Nodes", record.recordIndex, "type"));
  }
  const nodeNames = rows(tables, "Nodes").map((record) => text(record, "nodeId")).filter((id): id is string => Boolean(id));
  if (nodeNames.length !== new Set(nodeNames).size) diagnostics.push({ code: "WORKBOOK_DUPLICATE_NODE_ID", severity: "error", message: "Nodes.nodeId values must be unique.", table: "Nodes" });
  if (rows(tables, "Nodes").length === 0) diagnostics.push({ code: "WORKBOOK_NO_NODES", severity: "error", message: "At least one network node is required.", table: "Nodes" });
  const nodeIds = new Set(rows(tables, "Nodes").map((record) => text(record, "nodeId")).filter((id): id is string => Boolean(id)));
  // A declared port on a link is a topology assertion: require that exact
  // interface on the specific endpoint node. Never guess it from IP, subnet,
  // gateway, switch role or link order.
  const interfacesByNode = new Map<string, Set<string>>();
  for (const record of rows(tables, "Interfaces")) {
    const nodeId = text(record, "nodeId");
    const id = text(record, "interfaceId") ?? text(record, "name");
    if (!nodeId || !nodeIds.has(nodeId)) diagnostics.push(diagnostic("WORKBOOK_INTERFACE_NODE_UNKNOWN", `Interface references unknown node '${nodeId ?? ""}'.`, "Interfaces", record.recordIndex, "nodeId"));
    if (!id || !ID.test(id)) diagnostics.push(diagnostic("WORKBOOK_INTERFACE_ID_INVALID", "Interfaces.interfaceId must be a stable canonical ID.", "Interfaces", record.recordIndex, "interfaceId"));
    if (nodeId && id && nodeIds.has(nodeId) && ID.test(id)) {
      const declared = interfacesByNode.get(nodeId) ?? new Set<string>();
      if (declared.has(id)) diagnostics.push(diagnostic("WORKBOOK_DUPLICATE_INTERFACE_ID",
        "A device declares the same interfaceId more than once; links cannot resolve the duplicate.",
        "Interfaces", record.recordIndex, "interfaceId"));
      declared.add(id);
      interfacesByNode.set(nodeId, declared);
    }
    const mtu = integer(record, "MTU");
    if (!blank(value(record, "MTU")) && (mtu === undefined || mtu < 1))
      diagnostics.push(diagnostic("WORKBOOK_MTU_INVALID",
        "Interfaces.MTU must be a positive integer.", "Interfaces", record.recordIndex, "MTU"));
    const mac = text(record, "MAC");
    if (mac && !MAC_ADDRESS.test(mac))
      diagnostics.push(diagnostic("WORKBOOK_MAC_INVALID",
        "Interfaces.MAC must contain six colon-separated hexadecimal octets.",
        "Interfaces", record.recordIndex, "MAC"));
  }
  // Zone references belong to the same canonical namespace as nodes. A
  // valid-looking workbook must not promise an importable Builder source that
  // later fails its zone/reference integrity checks during Save or Compile.
  const zoneIds = new Set<string>();
  for (const record of rows(tables, "Zones")) {
    const id = text(record, "zoneId");
    const kind = text(record, "kind");
    if (!id || !ID.test(id))
      diagnostics.push(diagnostic("WORKBOOK_ZONE_ID_INVALID",
        "Zones.zoneId must be a stable canonical ID.", "Zones", record.recordIndex, "zoneId"));
    if (id && ID.test(id)) {
      if (zoneIds.has(id))
        diagnostics.push(diagnostic("WORKBOOK_DUPLICATE_ZONE_ID",
          "Each declared zone needs a unique zoneId.", "Zones", record.recordIndex, "zoneId"));
      if (nodeIds.has(id))
        diagnostics.push(diagnostic("WORKBOOK_CANONICAL_ID_COLLISION",
          "Zone and node IDs must be distinct canonical identifiers.", "Zones", record.recordIndex, "zoneId"));
      zoneIds.add(id);
    }
    if (kind && !KINDS.has(kind))
      diagnostics.push(diagnostic("WORKBOOK_ZONE_KIND_INVALID",
        "Unknown zone kind.", "Zones", record.recordIndex, "kind"));
  }
  for (const record of rows(tables, "Nodes")) {
    const zone = text(record, "zoneId");
    if (zone && !zoneIds.has(zone))
      diagnostics.push(diagnostic("WORKBOOK_NODE_ZONE_UNKNOWN",
        "Nodes.zoneId references no declared zone. Import cannot infer zone membership.",
        "Nodes", record.recordIndex, "zoneId"));
  }
  // Layout target references must resolve to an explicitly declared node or
  // zone. No missing object may be invented merely to satisfy a layout hint.
  for (const record of rows(tables, "Layout")) {
    const target = text(record, "nodeId");
    if (target && !nodeIds.has(target) && !zoneIds.has(target))
      diagnostics.push(diagnostic("WORKBOOK_LAYOUT_TARGET_UNKNOWN",
        "Layout.nodeId references no declared node or zone.",
        "Layout", record.recordIndex, "nodeId"));
    if (!blank(value(record, "rank")) && integer(record, "rank") === undefined)
      diagnostics.push(diagnostic("WORKBOOK_LAYOUT_RANK_INVALID",
        "Layout.rank must be a signed safe integer; no layout order will be inferred.",
        "Layout", record.recordIndex, "rank"));
  }
  for (const record of rows(tables, "Links")) {
    const id = text(record, "linkId"), a = text(record, "nodeA"), b = text(record, "nodeB");
    const portA = text(record, "interfaceA"), portB = text(record, "interfaceB");
    const kind = text(record, "kind");
    if (kind && !LINK_KINDS.has(kind))
      diagnostics.push(diagnostic("WORKBOOK_LINK_KIND_INVALID",
        "Links.kind is not a canonical scenario connection kind.",
        "Links", record.recordIndex, "kind"));
    if (!id || !ID.test(id)) diagnostics.push(diagnostic("WORKBOOK_LINK_ID_INVALID", "Links.linkId must be a stable canonical ID.", "Links", record.recordIndex, "linkId"));
    if (!a || !nodeIds.has(a)) diagnostics.push(diagnostic("WORKBOOK_LINK_ENDPOINT_UNKNOWN", `Links.nodeA references unknown node '${a ?? ""}'.`, "Links", record.recordIndex, "nodeA"));
    if (!b || !nodeIds.has(b)) diagnostics.push(diagnostic("WORKBOOK_LINK_ENDPOINT_UNKNOWN", `Links.nodeB references unknown node '${b ?? ""}'.`, "Links", record.recordIndex, "nodeB"));
    if (a && portA && nodeIds.has(a) && !interfacesByNode.get(a)?.has(portA))
      diagnostics.push(diagnostic("WORKBOOK_LINK_PORT_UNKNOWN",
        "Links.interfaceA references a port not declared on its specified endpoint node.",
        "Links", record.recordIndex, "interfaceA"));
    if (b && portB && nodeIds.has(b) && !interfacesByNode.get(b)?.has(portB))
      diagnostics.push(diagnostic("WORKBOOK_LINK_PORT_UNKNOWN",
        "Links.interfaceB references a port not declared on its specified endpoint node.",
        "Links", record.recordIndex, "interfaceB"));
  }
  const linkNames = rows(tables, "Links").map((record) => text(record, "linkId")).filter((id): id is string => Boolean(id));
  if (linkNames.length !== new Set(linkNames).size) diagnostics.push({ code: "WORKBOOK_DUPLICATE_LINK_ID", severity: "error", message: "Links.linkId values must be unique.", table: "Links" });
  return diagnostics;
}

export function previewNetworkWorkbook(document: ImportDocument, diagnostics: readonly ImportDiagnostic[] = validateNetworkWorkbook(document)): WorkbookPreview {
  const rowsPerSheet: Record<string, number> = {}; const mappedRows: Record<string, number> = {}; const rejectedRows: Record<string, number> = {};
  for (const table of document.tables) {
    // A physical row can contain several bad fields: count it once in
    // rejectedRows, while preview.errors still counts every diagnostic.
    // Table-level errors without a row are not fictional rejected source rows.
    const invalidRowIds = new Set(diagnostics
      .filter((x) => x.table === table.tableId && x.severity === "error" && Number.isInteger(x.row))
      .map((x) => x.row));
    const rejected = table.records.filter((record) => invalidRowIds.has(record.recordIndex)).length;
    rowsPerSheet[table.tableId] = (rowsPerSheet[table.tableId] ?? 0) + table.records.length;
    rejectedRows[table.tableId] = (rejectedRows[table.tableId] ?? 0) + rejected;
    mappedRows[table.tableId] = (rowsPerSheet[table.tableId] ?? 0) - (rejectedRows[table.tableId] ?? 0);
  }
  return { mode: "PREVIEW", sheetsFound: document.tables.map((x) => x.tableId), sheetsRequired: ["Metadata", "Nodes"], sheetsOptional: standardWorkbookSheets.filter((x) => x !== "Metadata" && x !== "Nodes"), rowsPerSheet, mappedRows, rejectedRows, errors: diagnostics.filter((x) => x.severity === "error").length, warnings: diagnostics.filter((x) => x.severity === "warning").length };
}

export function mapNetworkWorkbookToScenario(document: ImportDocument): WorkbookImportResult {
  const diagnostics = [...validateNetworkWorkbook(document)]; const preview = previewNetworkWorkbook(document, diagnostics); if (diagnostics.some((x) => x.severity === "error")) return { ok: false, diagnostics, preview };
  const tables = byTable(document); const metadata = rows(tables, "Metadata")[0]; const scenarioId = text(metadata ?? { recordIndex: 1, fields: {} }, "scenarioId") ?? "workbook_scenario"; const title = text(metadata ?? { recordIndex: 1, fields: {} }, "title") ?? scenarioId; const description = text(metadata ?? { recordIndex: 1, fields: {} }, "description");
  const zones = rows(tables, "Zones").map((record) => ({ id: text(record, "zoneId")!, label: text(record, "displayName") ?? text(record, "zoneId")!, ...(text(record, "kind") ? { kind: text(record, "kind") as never } : {}) }));
  const resourceMap = new Map<string, Scenariosourceresource>();
  for (const record of rows(tables, "Nodes")) { const id = text(record, "nodeId")!; const zone = text(record, "zoneId"); resourceMap.set(id, { id, type: text(record, "type")!, label: text(record, "displayName")!, ...(zone ? { zone } : {}), properties: {} }); }
  for (const record of rows(tables, "Interfaces")) { const nodeId = text(record, "nodeId")!; const resource = resourceMap.get(nodeId)!; const id = text(record, "interfaceId") ?? text(record, "name")!; const label = text(record, "name"); const ipv4 = text(record, "IPv4"); const prefix = text(record, "prefix"); const ipv6 = text(record, "IPv6"); const addresses = [ipv4 && prefix ? `${ipv4}/${prefix}` : ipv4, ipv6].filter((x): x is string => Boolean(x)); const mac = text(record, "MAC"); const mtu = integer(record, "MTU"); const iface = { id, ...(label ? { label } : {}), ...(addresses.length ? { addresses } : {}), ...(mac ? { mac } : {}), ...(mtu !== undefined ? { mtu } : {}) }; resourceMap.set(nodeId, { ...resource, interfaces: [...(resource.interfaces ?? []), iface] }); }
  const connections: Scenariosourceconnection[] = rows(tables, "Links").map((record) => { const interfaceA = text(record, "interfaceA"); const interfaceB = text(record, "interfaceB"); return { id: text(record, "linkId")!, kind: (text(record, "kind") as Scenariosourceconnection["kind"] | undefined) ?? "network", from: { resource: text(record, "nodeA")!, ...(interfaceA ? { port: interfaceA } : {}) }, to: { resource: text(record, "nodeB")!, ...(interfaceB ? { port: interfaceB } : {}) }, properties: {} }; });
  // Imported source declarations establish modeled nodes/links, not that
  // cabling, network operation or the operator's expected topology was verified.
  // Never auto-complete merely by comparing a resource's imported type to itself.
  // This review signal is deliberately UNSET on every imported resource.
  const objective = {
    id: "imported_topology_manual_verification",
    title: "Review imported nodes and explicit network connections",
    category: "enterprise-import", required: true,
    condition: { op: "equals" as const, target: [...resourceMap.values()][0]!.id,
      path: "imported_topology_manual_verification", value: "VERIFIED" },
  };
  const source: ScenarioSource = { formatId: "infrastructure-cyber-lab.scenario-source", schemaVersion: "0.1.0", scenarioId, metadata: { title, ...(description ? { description } : {}), language: "en" }, requires: { capabilities: [{ id: "core.network", version: "^1.0.0" }], profiles: [] }, zones, resources: [...resourceMap.values()], connections, tests: [], findings: [], objectives: [objective], completion: objective.condition,
    notes: rows(tables, "Nodes").flatMap((record) => {
      const gw = text(record, "gateway") ?? text(record, "Default Gateway");
      const nodeId = text(record, "nodeId");
      return gw && nodeId ? [{ id: `gateway_note_${record.recordIndex}`, title: "Declared default gateway", text: `Source declares gateway ${gw} for ${nodeId}. Inventory-only: no cable, route or tested reachability is inferred.`, target: nodeId }] : [];
    }), layoutHints: rows(tables, "Layout").flatMap((record) => { const target = text(record, "nodeId"); const rank = integer(record, "rank"); return target ? [{ target, ...(rank !== undefined ? { rank } : {}) }] : []; }) };
  return { ok: true, source, diagnostics, preview };
}
