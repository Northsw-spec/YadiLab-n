import type { ScenarioSource, Scenariosourceconnection, Scenariosourceresource } from "../../core-model/src/generated/contracts.js";
import type { ImportDiagnostic, ImportDocument, ImportRecord } from "./types.js";

export const YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION = "1.0.0" as const;
export const standardWorkbookSheets = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Routes", "VLANs", "STP", "Services", "Firewall", "NAT", "Flows", "Layout"] as const;
export type StandardWorkbookSheet = typeof standardWorkbookSheets[number];

export interface WorkbookImportResult { readonly ok: boolean; readonly source?: ScenarioSource; readonly diagnostics: readonly ImportDiagnostic[]; readonly preview: WorkbookPreview; }
export interface WorkbookPreview { readonly mode: "PREVIEW"; readonly sheetsFound: readonly string[]; readonly sheetsRequired: readonly string[]; readonly sheetsOptional: readonly string[]; readonly rowsPerSheet: Readonly<Record<string, number>>; readonly mappedRows: Readonly<Record<string, number>>; readonly rejectedRows: Readonly<Record<string, number>>; readonly errors: number; readonly warnings: number; }

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KINDS = new Set(["internet", "wan", "dmz", "lan", "server", "management", "security", "backup", "guest", "custom"]);
const byTable = (document: ImportDocument) => new Map(document.tables.map((table) => [table.tableId, table] as const));
const value = (record: ImportRecord, field: string): unknown => record.fields[field]?.value;
const text = (record: ImportRecord, field: string): string | undefined => { const v = value(record, field); return typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : undefined; };
const integer = (record: ImportRecord, field: string): number | undefined => { const v = value(record, field); const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN; return Number.isSafeInteger(n) ? n : undefined; };
const bool = (record: ImportRecord, field: string): boolean | undefined => { const v = value(record, field); return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined; };
function diagnostic(code: string, message: string, table: string, row: number, field?: string): ImportDiagnostic { return { code, severity: "error", message, table, row, ...(field ? { field } : {}) }; }
function rows(table: ReturnType<typeof byTable>, name: string): readonly ImportRecord[] { return table.get(name)?.records ?? []; }

export function validateNetworkWorkbook(document: ImportDocument): readonly ImportDiagnostic[] {
  const diagnostics: ImportDiagnostic[] = [];
  const tables = byTable(document);
  for (const table of document.tables) if (!standardWorkbookSheets.includes(table.tableId as StandardWorkbookSheet)) diagnostics.push({ code: "WORKBOOK_UNSUPPORTED_SHEET", severity: "warning", message: `Sheet '${table.tableId}' is not part of the Network Workbook Schema v${YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION}.`, table: table.tableId });
  for (const required of ["Metadata", "Nodes"] as const) if (!tables.has(required)) diagnostics.push({ code: "WORKBOOK_REQUIRED_SHEET_MISSING", severity: "error", message: `Required sheet '${required}' is missing.`, table: required });
  const seen = new Map<string, number>();
  for (const table of document.tables) { const prior = seen.get(table.tableId) ?? 0; if (prior > 0) diagnostics.push({ code: "WORKBOOK_DUPLICATE_SHEET", severity: "error", message: `Duplicate sheet/table '${table.tableId}'.`, table: table.tableId }); seen.set(table.tableId, prior + 1); }
  for (const record of rows(tables, "Nodes")) { const id = text(record, "nodeId"); if (!id || !ID.test(id)) diagnostics.push(diagnostic("WORKBOOK_NODE_ID_INVALID", "Nodes.nodeId must be a stable canonical ID.", "Nodes", record.recordIndex, "nodeId")); if (!text(record, "displayName")) diagnostics.push(diagnostic("WORKBOOK_NODE_LABEL_MISSING", "Nodes.displayName is required.", "Nodes", record.recordIndex, "displayName")); if (!text(record, "type")) diagnostics.push(diagnostic("WORKBOOK_NODE_TYPE_MISSING", "Nodes.type is required.", "Nodes", record.recordIndex, "type")); }
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
    if (value(record, "MTU") !== undefined && mtu === undefined) diagnostics.push(diagnostic("WORKBOOK_MTU_INVALID", "Interfaces.MTU must be an integer.", "Interfaces", record.recordIndex, "MTU"));
  }
  for (const record of rows(tables, "Zones")) { const id = text(record, "zoneId"); const kind = text(record, "kind"); if (!id || !ID.test(id)) diagnostics.push(diagnostic("WORKBOOK_ZONE_ID_INVALID", "Zones.zoneId must be a stable canonical ID.", "Zones", record.recordIndex, "zoneId")); if (kind && !KINDS.has(kind)) diagnostics.push(diagnostic("WORKBOOK_ZONE_KIND_INVALID", `Unknown zone kind '${kind}'.`, "Zones", record.recordIndex, "kind")); }
  for (const record of rows(tables, "Links")) {
    const id = text(record, "linkId"), a = text(record, "nodeA"), b = text(record, "nodeB");
    const portA = text(record, "interfaceA"), portB = text(record, "interfaceB");
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
  for (const table of document.tables) { rowsPerSheet[table.tableId] = table.records.length; const errors = diagnostics.filter((x) => x.table === table.tableId && x.severity === "error").length; mappedRows[table.tableId] = Math.max(0, table.records.length - errors); rejectedRows[table.tableId] = errors; }
  return { mode: "PREVIEW", sheetsFound: document.tables.map((x) => x.tableId), sheetsRequired: ["Metadata", "Nodes"], sheetsOptional: standardWorkbookSheets.filter((x) => x !== "Metadata" && x !== "Nodes"), rowsPerSheet, mappedRows, rejectedRows, errors: diagnostics.filter((x) => x.severity === "error").length, warnings: diagnostics.filter((x) => x.severity === "warning").length };
}

export function mapNetworkWorkbookToScenario(document: ImportDocument): WorkbookImportResult {
  const diagnostics = [...validateNetworkWorkbook(document)]; const preview = previewNetworkWorkbook(document, diagnostics); if (diagnostics.some((x) => x.severity === "error")) return { ok: false, diagnostics, preview };
  const tables = byTable(document); const metadata = rows(tables, "Metadata")[0]; const scenarioId = text(metadata ?? { recordIndex: 1, fields: {} }, "scenarioId") ?? "workbook_scenario"; const title = text(metadata ?? { recordIndex: 1, fields: {} }, "title") ?? scenarioId; const description = text(metadata ?? { recordIndex: 1, fields: {} }, "description");
  if (!ID.test(scenarioId)) return { ok: false, diagnostics: [...diagnostics, diagnostic("WORKBOOK_SCENARIO_ID_INVALID", "Metadata.scenarioId must be a stable canonical ID.", "Metadata", metadata?.recordIndex ?? 1, "scenarioId")], preview };
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
