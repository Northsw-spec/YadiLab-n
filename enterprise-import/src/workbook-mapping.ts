import type { ScenarioSource, Scenariosourceconnection, Scenariosourceresource } from "../../core-model/src/generated/contracts.js";
import type { ImportDiagnostic, ImportDocument, ImportRecord } from "./types.js";
import { documentationNotes, resolveWorkbookCompatibility, type LegacyWorkbookProfile } from "./workbook-compatibility.js";

export const YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION = "1.0.0" as const;
export const standardWorkbookSheets = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Routes", "VLANs", "STP", "Services", "Firewall", "NAT", "Flows", "Layout"] as const;
export type StandardWorkbookSheet = typeof standardWorkbookSheets[number];
// Only these original workbook fields survive canonical Builder projection.
// The other recognized standard sheets (Routes/VLANs/STP/Services/Firewall/
// NAT/Flows) are not executable source imports in this mapping profile.
// A nonblank declaration outside this contract cannot be called "mapped".
const projectedWorkbookFields: Readonly<Record<string, ReadonlySet<string>>> = {
  Metadata: new Set(["schemaVersion", "scenarioId", "title", "description", "notice", "sourceUrl", "scope"]),
  Zones: new Set(["zoneId", "displayName", "kind", "Illustrative Subnet", "Segmentation Note"]),
  Nodes: new Set(["nodeId", "displayName", "type", "zoneId", "gateway", "Default Gateway", "Floor / Area", "Department", "Function", "Training Note"]),
  Interfaces: new Set(["nodeId", "interfaceId", "name", "IPv4", "prefix",
    "IPv6", "IPv6Prefix", "MAC", "MTU", "Addressing Note"]),
  Links: new Set(["linkId", "nodeA", "nodeB", "interfaceA", "interfaceB", "kind", "Medium", "Training Note"]),
  Layout: new Set(["nodeId", "rank"]),
};
// These optional *projected* text fields used to become fallback labels/IDs
// or disappear when a producer supplies a populated boolean/object/nonfinite
// number. Missing/blank optional cells are not claims and retain the documented
// defaults. Mandatory fields have their own existing field-level validation.
const optionalProjectedTextFields: Readonly<Record<string, readonly string[]>> = {
  Metadata: ["title", "description"],
  Zones: ["displayName"],
  Nodes: ["gateway", "Default Gateway"],
  Interfaces: ["name"],
};

export interface WorkbookImportResult { readonly ok: boolean; readonly source?: ScenarioSource; readonly diagnostics: readonly ImportDiagnostic[]; readonly preview: WorkbookPreview; }
export interface WorkbookPreview { readonly mode: "PREVIEW"; readonly profile?: LegacyWorkbookProfile; readonly sheetsFound: readonly string[]; readonly authoritativeSheets?: readonly string[]; readonly documentationSheets?: readonly string[]; readonly preservedDocumentation?: readonly { readonly sheet: string; readonly rows: number; readonly populatedCells: number }[]; readonly sheetsRequired: readonly string[]; readonly sheetsOptional: readonly string[]; readonly rowsPerSheet: Readonly<Record<string, number>>; readonly mappedRows: Readonly<Record<string, number>>; readonly rejectedRows: Readonly<Record<string, number>>; readonly errors: number; readonly warnings: number; }

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KINDS = new Set(["internet", "wan", "dmz", "lan", "server", "management", "security", "backup", "guest", "custom"]);
// Mirror schema/scenario-source.schema.json constraints on fields that the
// workbook mapping emits, so preview does not accept a source Save will reject.
const RESOURCE_TYPE = /^[a-z][a-z0-9_.-]{0,127}$/;
const MAC_ADDRESS = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/;
// IPv4 and its optional CIDR mask are explicit imported facts. Validate
// before mapping instead of silently accepting invalid octets or inventing
// a second mask for an already-qualified source address.
const validPrefix = (prefix: string): boolean => /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
function parseIPv4(source: string): { host: string; mask?: string } | undefined {
  const pieces = source.split("/");
  if (pieces.length > 2) return undefined;
  const host = pieces[0];
  const mask = pieces[1];
  if (!host || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      host.split(".").some(octet => Number(octet) > 255 || (octet.length > 1 && octet.startsWith("0"))) ||
      (mask !== undefined && !validPrefix(mask))) return undefined;
  return { host, ...(mask === undefined ? {} : { mask }) };
}
// Imported IPv6 must be a real address, not merely a nonempty Builder string.
// This self-contained validator works in both browser and Node without network
// access. An IPv4-mapped tail counts as exactly two of the eight IPv6 groups.
const validIPv6Prefix = (prefix: string): boolean =>
  /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128;
function validIPv6(source: string): boolean {
  const parts = source.split("/");
  if (parts.length > 2 || (parts.length === 2 && !validIPv6Prefix(parts[1]!)))
    return false;
  let host = parts[0]!;
  if (!host || /[^0-9A-Fa-f:.]/.test(host) || host.includes(":::")) return false;
  if (host.includes(".")) {
    const colon = host.lastIndexOf(":");
    if (colon < 0 || !parseIPv4(host.slice(colon + 1))) return false;
    host = host.slice(0, colon) + ":0:0";
  }
  const compressed = host.includes("::");
  if (compressed && host.indexOf("::") !== host.lastIndexOf("::")) return false;
  const groups = compressed
    ? host.split("::").flatMap(section => section ? section.split(":") : [])
    : host.split(":");
  return groups.every(group => /^[0-9A-Fa-f]{1,4}$/.test(group)) &&
    (compressed ? groups.length < 8 : groups.length === 8);
}
const LINK_KINDS = new Set(["network", "management", "trust", "authentication", "dependency", "data_flow"]);
const byTable = (document: ImportDocument) => new Map(document.tables.map((table) => [table.tableId, table] as const));
const value = (record: ImportRecord, field: string): unknown => record.fields[field]?.value;
const text = (record: ImportRecord, field: string): string | undefined => {
  const v = value(record, field);
  return typeof v === "string" && v.trim() !== "" ? v.trim() :
    typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
};
const integer = (record: ImportRecord, field: string): number | undefined => { const v = value(record, field); const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN; return Number.isSafeInteger(n) ? n : undefined; };
// Optional source fields may be blank in CSV/XLSX/ODS; blank is not a
// declaration. Nonblank malformed values must still be rejected explicitly.
const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const bool = (record: ImportRecord, field: string): boolean | undefined => { const v = value(record, field); return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined; };
function diagnostic(code: string, message: string, table: string, row: number, field?: string): ImportDiagnostic { return { code, severity: "error", message, table, row, ...(field ? { field } : {}) }; }
function rows(table: ReturnType<typeof byTable>, name: string): readonly ImportRecord[] { return table.get(name)?.records ?? []; }

export function validateNetworkWorkbook(document: ImportDocument): readonly ImportDiagnostic[] {
  const compatibility = resolveWorkbookCompatibility(document);
  const diagnostics: ImportDiagnostic[] = [...compatibility.diagnostics];
  const tables = byTable(compatibility.document);
  const documentationSheets = new Set(compatibility.documentationSheets);
  for (const table of compatibility.document.tables) if (!documentationSheets.has(table.tableId) && !standardWorkbookSheets.includes(table.tableId as StandardWorkbookSheet)) diagnostics.push({ code: "WORKBOOK_UNSUPPORTED_SHEET", severity: "warning", message: `Sheet '${table.tableId}' is not part of the Network Workbook Schema v${YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION}.`, table: table.tableId });
  // A "READY" preview must never silently discard populated source facts.
  // In particular Routes, VLANs, STP, Firewall, NAT, Services and Flows are
  // recognized workbook sheets but NOT projected by this topology mapper.
  // Inspect each actual row so the preview reports physical rejected rows,
  // without treating empty optional template cells as declarations.
  for (const table of compatibility.document.tables) {
    if (documentationSheets.has(table.tableId)) continue;
    const projected = projectedWorkbookFields[table.tableId];
    for (const record of table.records) {
      if (!projected) {
        if (Object.values(record.fields).some(cell => !blank(cell.value)))
          diagnostics.push(diagnostic("WORKBOOK_SHEET_NOT_MAPPED",
            "Populated rows in this sheet are not supported by the Builder topology projection. No source facts were silently accepted.",
            table.tableId, record.recordIndex));
        continue;
      }
      for (const [field, cell] of Object.entries(record.fields)) {
        if (!projected.has(field) && !blank(cell.value))
          diagnostics.push(diagnostic("WORKBOOK_FIELD_NOT_MAPPED",
            "A nonblank source column is not represented in the canonical Builder projection. Remove or explicitly map it before import.",
            table.tableId, record.recordIndex, field));
      }
    }
  }
  // Do not transform a populated but unrepresentable declaration into a
  // seemingly blank field. A boolean metadata title, for example, was
  // silently replaced with scenarioId while preview still reported READY.
  for (const table of compatibility.document.tables) {
    if (documentationSheets.has(table.tableId)) continue;
    const optionalFields = optionalProjectedTextFields[table.tableId] ?? [];
    for (const record of table.records) {
      for (const field of optionalFields) {
        if (!blank(value(record, field)) && text(record, field) === undefined)
          diagnostics.push(diagnostic("WORKBOOK_PROJECTED_FIELD_TYPE_INVALID",
            "A populated projected text field is not representable; the declaration must be corrected before Builder activation.",
            table.tableId, record.recordIndex, field));
      }
    }
  }
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
      if (!blank(value(record, "schemaVersion")) && declaredVersion !== YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION)
        diagnostics.push(diagnostic("WORKBOOK_SCHEMA_VERSION_UNSUPPORTED",
          "Metadata.schemaVersion is not supported; the imported structure was not reinterpreted.",
          "Metadata", record.recordIndex, "schemaVersion"));
      const scenarioId = text(record, "scenarioId");
      if (!blank(value(record, "scenarioId")) && (!scenarioId || !ID.test(scenarioId)))
        diagnostics.push(diagnostic("WORKBOOK_SCENARIO_ID_INVALID",
          "Metadata.scenarioId must be a stable canonical ID.",
          "Metadata", record.recordIndex, "scenarioId"));
    }
  }
  const seen = new Map<string, number>();
  for (const table of document.tables) { const prior = seen.get(table.tableId) ?? 0; if (prior > 0) diagnostics.push({ code: "WORKBOOK_DUPLICATE_SHEET", severity: "error", message: `Duplicate sheet/table '${table.tableId}'.`, table: table.tableId }); seen.set(table.tableId, prior + 1); }
  for (const record of rows(tables, "Nodes")) {
    const gateway = text(record, "gateway");
    const gatewayAlias = text(record, "Default Gateway");
    // These names describe the same source fact. If both are populated and
    // disagree, never silently prefer one note or assert a modeled route.
    if (gateway && gatewayAlias && gateway !== gatewayAlias)
      diagnostics.push(diagnostic("WORKBOOK_GATEWAY_DECLARATION_CONFLICT",
        "Nodes.gateway and Nodes.Default Gateway disagree; the source must choose one gateway declaration.",
        "Nodes", record.recordIndex, "Default Gateway"));
    const id = text(record, "nodeId");
    const type = text(record, "type");
    if (!id || !ID.test(id))
      diagnostics.push(diagnostic("WORKBOOK_NODE_ID_INVALID",
        "Nodes.nodeId must be a stable canonical ID.", "Nodes", record.recordIndex, "nodeId"));
    if (!text(record, "displayName"))
      diagnostics.push(diagnostic("WORKBOOK_NODE_LABEL_MISSING",
        "Nodes.displayName is required.", "Nodes", record.recordIndex, "displayName"));
    if (!blank(value(record, "zoneId")) && !text(record, "zoneId"))
      diagnostics.push(diagnostic("WORKBOOK_NODE_ZONE_INVALID",
        "Nodes.zoneId must identify an explicitly declared zone; an invalid typed value cannot be discarded.",
        "Nodes", record.recordIndex, "zoneId"));
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
    if (!id || !ID.test(id) ||
        (!blank(value(record, "interfaceId")) && !text(record, "interfaceId")))
      diagnostics.push(diagnostic("WORKBOOK_INTERFACE_ID_INVALID",
        "Interfaces.interfaceId must be a stable canonical ID; an invalid typed value cannot fall back to name.",
        "Interfaces", record.recordIndex, "interfaceId"));
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
    if (!blank(value(record, "MAC")) && (!mac || !MAC_ADDRESS.test(mac)))
      diagnostics.push(diagnostic("WORKBOOK_MAC_INVALID",
        "Interfaces.MAC must contain six colon-separated hexadecimal octets.",
        "Interfaces", record.recordIndex, "MAC"));
    const ipv4 = text(record, "IPv4");
    const prefix = text(record, "prefix");
    const parsedIPv4 = ipv4 === undefined ? undefined : parseIPv4(ipv4);
    if (!blank(value(record, "IPv4")) && !parsedIPv4)
      diagnostics.push(diagnostic("WORKBOOK_IPV4_INVALID",
        "Interfaces.IPv4 must be four valid octets, optionally with a /0 through /32 CIDR mask.",
        "Interfaces", record.recordIndex, "IPv4"));
    if (!blank(value(record, "prefix"))) {
      if (ipv4 === undefined)
        diagnostics.push(diagnostic("WORKBOOK_IPV4_PREFIX_WITHOUT_ADDRESS",
          "Interfaces.prefix cannot establish an IPv4 address when Interfaces.IPv4 is absent.",
          "Interfaces", record.recordIndex, "prefix"));
      else if (prefix === undefined || !validPrefix(prefix))
        diagnostics.push(diagnostic("WORKBOOK_IPV4_PREFIX_INVALID",
          "Interfaces.prefix must be a documented IPv4 prefix from 0 through 32.",
          "Interfaces", record.recordIndex, "prefix"));
      else if (parsedIPv4?.mask !== undefined && Number(parsedIPv4.mask) !== Number(prefix))
        diagnostics.push(diagnostic("WORKBOOK_IPV4_PREFIX_CONFLICT",
          "Separate Interfaces.prefix conflicts with the mask already declared by Interfaces.IPv4.",
          "Interfaces", record.recordIndex, "prefix"));
    }
    const ipv6 = text(record, "IPv6");
    const ipv6Prefix = text(record, "IPv6Prefix");
    if (!blank(value(record, "IPv6")) && (!ipv6 || !validIPv6(ipv6)))
      diagnostics.push(diagnostic("WORKBOOK_IPV6_INVALID",
        "Interfaces.IPv6 must be a valid IPv6 address, optionally with a /0 through /128 prefix; zone IDs are not supported.",
        "Interfaces", record.recordIndex, "IPv6"));
    if (!blank(value(record, "IPv6Prefix"))) {
      if (ipv6 === undefined)
        diagnostics.push(diagnostic("WORKBOOK_IPV6_PREFIX_WITHOUT_ADDRESS",
          "Interfaces.IPv6Prefix requires an explicitly documented Interfaces.IPv6 address.",
          "Interfaces", record.recordIndex, "IPv6Prefix"));
      else if (ipv6Prefix === undefined || !validIPv6Prefix(ipv6Prefix))
        diagnostics.push(diagnostic("WORKBOOK_IPV6_PREFIX_INVALID",
          "Interfaces.IPv6Prefix must be an integer from 0 through 128.",
          "Interfaces", record.recordIndex, "IPv6Prefix"));
      else if (ipv6.includes("/") &&
          Number(ipv6.split("/")[1]) !== Number(ipv6Prefix))
        diagnostics.push(diagnostic("WORKBOOK_IPV6_PREFIX_CONFLICT",
          "Separate Interfaces.IPv6Prefix conflicts with the prefix declared by Interfaces.IPv6.",
          "Interfaces", record.recordIndex, "IPv6Prefix"));
    }
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
    if (!blank(value(record, "kind")) && (!kind || !KINDS.has(kind)))
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
    if (!blank(value(record, "nodeId")) && !target)
      diagnostics.push(diagnostic("WORKBOOK_LAYOUT_TARGET_INVALID",
        "Layout.nodeId must be a declared node or zone identifier; an invalid typed value cannot be discarded.",
        "Layout", record.recordIndex, "nodeId"));
    // A declared rank without a target is not an empty optional layout row.
    // Silently dropping it would lose an explicit source layout assertion.
    if (blank(value(record, "nodeId")) && !blank(value(record, "rank")))
      diagnostics.push(diagnostic("WORKBOOK_LAYOUT_TARGET_MISSING",
        "Layout.nodeId is required when Layout.rank is declared; no target will be inferred.",
        "Layout", record.recordIndex, "nodeId"));
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
    if (!blank(value(record, "kind")) && (!kind || !LINK_KINDS.has(kind)))
      diagnostics.push(diagnostic("WORKBOOK_LINK_KIND_INVALID",
        "Links.kind is not a canonical scenario connection kind.",
        "Links", record.recordIndex, "kind"));
    if (!blank(value(record, "interfaceA")) && !portA)
      diagnostics.push(diagnostic("WORKBOOK_LINK_PORT_INVALID",
        "Links.interfaceA must name a declared source port; an invalid typed value cannot be omitted.",
        "Links", record.recordIndex, "interfaceA"));
    if (!blank(value(record, "interfaceB")) && !portB)
      diagnostics.push(diagnostic("WORKBOOK_LINK_PORT_INVALID",
        "Links.interfaceB must name a declared source port; an invalid typed value cannot be omitted.",
        "Links", record.recordIndex, "interfaceB"));
    if (!id || !ID.test(id)) diagnostics.push(diagnostic("WORKBOOK_LINK_ID_INVALID", "Links.linkId must be a stable canonical ID.", "Links", record.recordIndex, "linkId"));
    // Zone, node and link IDs share one canonical source namespace. A
    // link colliding with an existing object cannot be saved or compiled,
    // even if its endpoint references are otherwise valid.
    if (id && ID.test(id) && (nodeIds.has(id) || zoneIds.has(id)))
      diagnostics.push(diagnostic("WORKBOOK_CANONICAL_ID_COLLISION",
        "Links.linkId collides with a declared zone or node ID.",
        "Links", record.recordIndex, "linkId"));
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
  const compatibility = resolveWorkbookCompatibility(document);
  const rowsPerSheet: Record<string, number> = {}; const mappedRows: Record<string, number> = {}; const rejectedRows: Record<string, number> = {};
  // Use the compatibility projection for authoritative rows. It maps
  // normalized SRC worksheet names to canonical Nodes/Interfaces/Links/… IDs
  // while leaving documentation sheets under their original names.
  const sourceTables = compatibility.document.tables;
  for (const table of sourceTables) {
    const canonicalName = table.tableId;
    // A physical row can contain several bad fields: count it once in
    // rejectedRows, while preview.errors still counts every diagnostic.
    // Table-level errors without a row are not fictional rejected source rows.
    const invalidRowIds = new Set(diagnostics
      .filter((x) => (x.table === table.tableId || x.table === canonicalName) && x.severity === "error" && Number.isInteger(x.row))
      .map((x) => x.row));
    const rejected = table.records.filter((record) => invalidRowIds.has(record.recordIndex)).length;
    rowsPerSheet[table.tableId] = (rowsPerSheet[table.tableId] ?? 0) + table.records.length;
    rejectedRows[table.tableId] = (rejectedRows[table.tableId] ?? 0) + rejected;
    // A row in a review-only or unknown sheet is never projected, even when
    // it contains only empty template cells. Do not inflate mappedRows.
    mappedRows[table.tableId] = projectedWorkbookFields[canonicalName]
      ? (rowsPerSheet[table.tableId] ?? 0) - (rejectedRows[table.tableId] ?? 0)
      : 0;
  }
  return { mode: "PREVIEW", profile: compatibility.profile, sheetsFound: compatibility.originalSheets, authoritativeSheets: compatibility.authoritativeSheets, documentationSheets: compatibility.documentationSheets, preservedDocumentation: compatibility.preservedDocumentation, sheetsRequired: ["Metadata", "Nodes"], sheetsOptional: standardWorkbookSheets.filter((x) => x !== "Metadata" && x !== "Nodes"), rowsPerSheet, mappedRows, rejectedRows, errors: diagnostics.filter((x) => x.severity === "error").length, warnings: diagnostics.filter((x) => x.severity === "warning").length };
}

export function mapNetworkWorkbookToScenario(document: ImportDocument): WorkbookImportResult {
  const compatibility = resolveWorkbookCompatibility(document);
  const diagnostics = [...validateNetworkWorkbook(document)]; const preview = previewNetworkWorkbook(document, diagnostics); if (diagnostics.some((x) => x.severity === "error")) return { ok: false, diagnostics, preview };
  const tables = byTable(compatibility.document); const metadata = rows(tables, "Metadata")[0]; const scenarioId = text(metadata ?? { recordIndex: 1, fields: {} }, "scenarioId") ?? "workbook_scenario"; const title = text(metadata ?? { recordIndex: 1, fields: {} }, "title") ?? scenarioId; const description = text(metadata ?? { recordIndex: 1, fields: {} }, "description");
  const zones = rows(tables, "Zones").map((record) => ({ id: text(record, "zoneId")!, label: text(record, "displayName") ?? text(record, "zoneId")!, ...(text(record, "kind") ? { kind: text(record, "kind") as never } : {}) }));
  const resourceMap = new Map<string, Scenariosourceresource>();
  for (const record of rows(tables, "Nodes")) { const id = text(record, "nodeId")!; const zone = text(record, "zoneId"); resourceMap.set(id, { id, type: text(record, "type")!, label: text(record, "displayName")!, ...(zone ? { zone } : {}), properties: {} }); }
  for (const record of rows(tables, "Interfaces")) { const nodeId = text(record, "nodeId")!; const resource = resourceMap.get(nodeId)!; const id = text(record, "interfaceId") ?? text(record, "name")!; const label = text(record, "name"); const ipv4 = text(record, "IPv4"); const prefix = text(record, "prefix"); const ipv6 = text(record, "IPv6"); const ipv6Prefix = text(record, "IPv6Prefix"); const addresses = [ipv4 && prefix && !ipv4.includes("/") ? `${ipv4}/${prefix}` : ipv4, ipv6 && ipv6Prefix && !ipv6.includes("/") ? `${ipv6}/${ipv6Prefix}` : ipv6].filter((x): x is string => Boolean(x)); const mac = text(record, "MAC"); const mtu = integer(record, "MTU"); const iface = { id, ...(label ? { label } : {}), ...(addresses.length ? { addresses } : {}), ...(mac ? { mac } : {}), ...(mtu !== undefined ? { mtu } : {}) }; resourceMap.set(nodeId, { ...resource, interfaces: [...(resource.interfaces ?? []), iface] }); }
  const connections: Scenariosourceconnection[] = rows(tables, "Links").map((record) => { const interfaceA = text(record, "interfaceA"); const interfaceB = text(record, "interfaceB"); return { id: text(record, "linkId")!, kind: (text(record, "kind") as Scenariosourceconnection["kind"] | undefined) ?? "network", from: { resource: text(record, "nodeA")!, ...(interfaceA ? { port: interfaceA } : {}) }, to: { resource: text(record, "nodeB")!, ...(interfaceB ? { port: interfaceB } : {}) }, properties: {} }; });
  // Generated review artifacts are not original source facts. Reserve the
  // namespace occupied by every explicitly declared source object before
  // allocating their identities, instead of invalidating legitimate IDs in
  // workbook input. Candidate IDs remain deterministic across previews.
  const occupiedIds = new Set<string>([
    ...zones.map(zone => zone.id), ...resourceMap.keys(),
    ...connections.map(connection => connection.id),
  ]);
  const generatedId = (base: string): string => {
    let id = base.slice(0, 64);
    let suffix = 0;
    while (occupiedIds.has(id)) {
      suffix++;
      const ending = `_${suffix}`;
      id = base.slice(0, 64 - ending.length) + ending;
    }
    occupiedIds.add(id);
    return id;
  };
  // Imported source declarations establish modeled nodes/links, not that
  // cabling, network operation or the operator's expected topology was verified.
  // Never auto-complete merely by comparing a resource's imported type to itself.
  // This review signal is deliberately UNSET on every imported resource.
  const objective = {
    id: generatedId("imported_topology_manual_verification"),
    title: "Review imported nodes and explicit network connections",
    category: "enterprise-import", required: true,
    condition: { op: "equals" as const, target: [...resourceMap.values()][0]!.id,
      path: "imported_topology_manual_verification", value: "VERIFIED" },
  };
  const documentationSourceNotes = documentationNotes(document, compatibility.profile).map(({ table, record, field, cell }) => {
    const target = table === "Nodes" || table === "Interfaces" ? text(record, "nodeId") : table === "Links" ? text(record, "linkId") : table === "Zones" ? text(record, "zoneId") : undefined;
    const rendered = typeof cell.value === "string" ? cell.value : JSON.stringify(cell.value);
    const tableSlug = table.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "sheet";
    return { id: generatedId(`source_doc_${tableSlug}_${record.recordIndex}_${field.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`), title: `Source documentation · ${table}.${field}`, text: `${table}.${field} = ${rendered ?? ""}`, ...(target ? { target } : {}) };
  });
  const source: ScenarioSource = { formatId: "infrastructure-cyber-lab.scenario-source", schemaVersion: "0.1.0", scenarioId, metadata: { title, ...(description ? { description } : {}), language: "en" }, requires: { capabilities: [{ id: "core.network", version: "^1.0.0" }], profiles: [] }, zones, resources: [...resourceMap.values()], connections, tests: [], findings: [], objectives: [objective], completion: objective.condition,
    notes: [...documentationSourceNotes, ...rows(tables, "Nodes").flatMap((record) => {
      const gw = text(record, "gateway") ?? text(record, "Default Gateway");
      const nodeId = text(record, "nodeId");
      return gw && nodeId ? [{ id: generatedId(`gateway_note_${record.recordIndex}`), title: "Declared default gateway", text: `Source declares gateway ${gw} for ${nodeId}. Inventory-only: no cable, route or tested reachability is inferred.`, target: nodeId }] : [];
    })], layoutHints: rows(tables, "Layout").flatMap((record) => { const target = text(record, "nodeId"); const rank = integer(record, "rank"); return target ? [{ target, ...(rank !== undefined ? { rank } : {}) }] : []; }) };
  return { ok: true, source, diagnostics, preview };
}
