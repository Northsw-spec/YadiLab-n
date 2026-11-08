import type { ImportCell, ImportDiagnostic, ImportDocument, ImportRecord, ImportTable } from "./types.js";

// Inventory-to-workbook bridge. It maps only fields explicitly present in the
// source. Address proximity, gateways and hostnames NEVER imply a physical link.
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const key = (value: string): string => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const format = (name: string): string => name.trim().replace(/\s+/g, " ");

const aliases = {
  id: ["nodeId", "Asset ID", "asset_id", "Device ID", "deviceId", "ID"],
  label: ["displayName", "Hostname", "Host Name", "Name", "Device Name"],
  type: ["type", "Device Type", "Device Role", "Role", "Kind"],
  ip: ["IPv4", "IP Address", "IP", "IPv4 Address"],
  cidr: ["CIDR", "IP/CIDR", "IPv4/CIDR"],
  prefix: ["prefix", "Prefix Length", "CIDR Prefix"],
  mac: ["MAC", "MAC Address"],
  gateway: ["Default Gateway", "Gateway", "Default GW"],
  target: ["Connected To", "Connects To", "Link To", "Peer ID", "Peer Node"],
} as const;
const RECOGNIZED_DEVICE_HEADERS = new Set(
  Object.values(aliases).flatMap((names) => names.map(key)),
);
const INVENTORY_TABLE_IDS = new Set(["devices", "nodes", "records"]);
function populatedSourceCell(value: unknown): boolean {
  // A false, 0 or structured original value is not an empty cell.
  return value !== null && value !== undefined &&
    !(typeof value === "string" && value.trim() === "");
}

function pick(record: ImportRecord, candidates: readonly string[], table: string, diagnostics: ImportDiagnostic[]): ImportCell | undefined {
  // Alias precedence is only applied if exactly one source header matches.
  const wanted = new Set(candidates.map(key));
  const fields = Object.keys(record.fields).filter((h) => wanted.has(key(h)));
  if (fields.length > 1) {
    diagnostics.push({ code: "NETWORK_IMPORT_FIELD_AMBIGUOUS", severity: "error", message: "Multiple candidate headers declare the same mapped field. Resolve the ambiguity before import; original column names are not shown.", table, row: record.recordIndex });
    return undefined;
  }
  return fields.length ? record.fields[fields[0]!] : undefined;
}
function stringCell(cell: ImportCell | undefined): string | undefined {
  const value = cell?.value;
  return typeof value === "string" && value.trim() ? format(value) : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
// A populated JSON/XLSX/ODS field with an unrepresentable value is not blank.
// In particular false/true/object must not turn into missing IP, MAC, peer,
// role or link kind and permit the operator to activate incomplete topology.
function rejectUnrepresentableField(
  cell: ImportCell | undefined, field: string, table: string, row: number,
  diagnostics: ImportDiagnostic[],
): void {
  if (populatedSourceCell(cell?.value) && stringCell(cell) === undefined) {
    diagnostics.push({
      code: "NETWORK_IMPORT_FIELD_TYPE_INVALID", severity: "error",
      message: `The declared ${field} value cannot be represented as text; it was not accepted as missing source data.`,
      table, row, field,
    });
  }
}
function cellValue(value: string, source: ImportCell | undefined, table: string, row: number): ImportCell {
  return { value, locator: source?.locator ?? { kind: "record-row", table, row } };
}
function roleType(value: string | undefined, table: string, row: number, diagnostics: ImportDiagnostic[]): string {
  if (!value) {
    diagnostics.push({ code: "NETWORK_IMPORT_ROLE_UNSPECIFIED", severity: "warning", message: "Device type not provided; shown as generic resource. No role inferred from IP or hostname.", table, row });
    return "resource.generic";
  }
  const types: Record<string, string> = {
    switch: "network.switch", l2switch: "network.switch", l3switch: "network.switch",
    router: "network.router", firewall: "network.firewall", gateway: "network.router",
    server: "server.generic", linux: "endpoint.linux", linuxclient: "endpoint.linux",
    windows: "endpoint.windows", workstation: "endpoint.windows", pc: "endpoint.windows",
    client: "endpoint.windows", endpoint: "endpoint.windows", host: "resource.generic",
    hypervisor: "virtualization.hypervisor", proxmox: "virtualization.proxmox",
  };
  const normalized = key(value);
  if (types[normalized]) return types[normalized];
  if (/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(value)) return value;
  diagnostics.push({ code: "NETWORK_IMPORT_ROLE_UNKNOWN", severity: "warning", message: "An unrecognized device role was not mapped; rendered as a generic resource. Original role text is not displayed.", table, row });
  return "resource.generic";
}
function canonicalRecord(index: number, table: string, values: Record<string, { value: string; source?: ImportCell | undefined }>): ImportRecord {
  const fields: Record<string, ImportCell> = {};
  for (const [field, item] of Object.entries(values)) fields[field] = cellValue(item.value, item.source, table, index);
  return { recordIndex: index, fields };
}
const positiveInt = (text: string | undefined): boolean => text !== undefined && /^\d+$/.test(text) && Number(text) >= 0 && Number(text) <= 32;
const MAC_ADDRESS = /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export type NetworkLinkSourceDecision = "LINKS_SHEET" | "INLINE_CONNECTED_TO";
export interface NetworkLinkSourceConflict {
  readonly inlineDeclaredLinks: number;
  readonly sheetDeclaredLinks: number;
}
export interface NetworkInventoryNormalization {
  readonly document: ImportDocument;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly linkSourceConflict?: NetworkLinkSourceConflict;
  readonly linkSourceChoice?: NetworkLinkSourceDecision;
  readonly unmappedColumnCount: number;
}

/**
 * Preserve the original producer's unambiguous link source. Only an explicit
 * operator decision may select between two conflicting declarations; no
 * gateway/IP/host inferred physical edges, and no silent merge.
 */
export function normalizeNetworkInventoryDocument(
  document: ImportDocument,
  options: Readonly<{ linkSourceChoice?: NetworkLinkSourceDecision }> = {},
): NetworkInventoryNormalization {
  const choice = options?.linkSourceChoice;
  const validChoice = choice === undefined || choice === "LINKS_SHEET" || choice === "INLINE_CONNECTED_TO";
  // Do not silently prefer the first of two competing network inventory
  // tables. This also covers canonical Metadata+Nodes mixed with Devices.
  const inventories = document.tables.filter((t) =>
    INVENTORY_TABLE_IDS.has(t.tableId.toLowerCase()));
  if (inventories.length > 1) return { document, unmappedColumnCount: 0, diagnostics: [{
    code: "NETWORK_IMPORT_DEVICE_TABLE_AMBIGUOUS", severity: "error",
    message: "Multiple competing device inventory tables were supplied. No source table was selected or combined.",
  }] };
  // The already canonical Nodes/Metadata/Links workbook schema remains unchanged.
  if (document.tables.some((t) => t.tableId === "Metadata") &&
      document.tables.some((t) => t.tableId === "Nodes")) {
    if (choice !== undefined) return { document, unmappedColumnCount: 0, diagnostics: [{
      code: "NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID", severity: "error",
      message: "A link-source decision requires conflicting Devices inline links and a separate Links table.",
    }] };
    return { document, diagnostics: [], unmappedColumnCount: 0 };
  }
  const inventory = inventories[0];
  if (!inventory) return { document, unmappedColumnCount: 0, diagnostics: [{
    code: "NETWORK_IMPORT_INVENTORY_MISSING", severity: "error",
    message: "Expected one supported Devices or Nodes table, or a CSV/TSV device inventory.",
  }] };
  const diagnostics: ImportDiagnostic[] = [];
  const nonemptyUnmappedHeaders = new Set<string>();
  const nodes: ImportRecord[] = [], interfaces: ImportRecord[] = [], inlineLinks: ImportRecord[] = [];
  for (const row of inventory.records) {
    for (const [header, cell] of Object.entries(row.fields)) {
      const normalizedHeader = key(header);
      if (!RECOGNIZED_DEVICE_HEADERS.has(normalizedHeader) &&
          populatedSourceCell(cell.value)) nonemptyUnmappedHeaders.add(normalizedHeader);
    }
    const fields = (Object.keys(aliases) as (keyof typeof aliases)[]).reduce((out, name) => {
      out[name] = pick(row, aliases[name], inventory.tableId, diagnostics); return out;
    }, {} as Record<keyof typeof aliases, ImportCell | undefined>);
    // Only genuinely blank optional declarations may use documented fallbacks.
    // Invalid typed values must block activation, not disappear into defaults.
    for (const field of ["label", "type", "ip", "cidr", "mac", "gateway", "target"] as const) {
      rejectUnrepresentableField(fields[field], field, inventory.tableId, row.recordIndex, diagnostics);
    }
    const id = stringCell(fields.id), label = stringCell(fields.label), type = stringCell(fields.type);
    if (!id || !ID.test(id)) { diagnostics.push({ code: "NETWORK_IMPORT_DEVICE_ID_INVALID", severity: "error", message: `Device row ${row.recordIndex} needs a stable lowercase ID (a-z, 0-9, underscore or hyphen).`, table: inventory.tableId, row: row.recordIndex }); continue; }
    const mappedType = roleType(type, inventory.tableId, row.recordIndex, diagnostics);
    const nodeValues: Record<string, { value: string; source?: ImportCell | undefined }> = {
      nodeId: { value: id, source: fields.id }, displayName: { value: label ?? id, source: fields.label ?? fields.id }, type: { value: mappedType, source: fields.type ?? fields.id },
    };
    const declaredGateway = stringCell(fields.gateway);
    if (declaredGateway) nodeValues.gateway = { value: declaredGateway, source: fields.gateway };
    nodes.push(canonicalRecord(row.recordIndex, "Nodes", nodeValues));
    const cidr = stringCell(fields.cidr), ip = stringCell(fields.ip), prefix = stringCell(fields.prefix);
    // Independent source fields cannot establish competing IPv4/prefix truth.
    // Previously CIDR silently overwrote a different IP Address or prefix.
    const inline = ip ? /^(.*)\/(\d{1,2})$/.exec(ip) : null;
    const cidrParts = cidr ? /^(.*)\/(\d{1,2})$/.exec(cidr) : null;
    const ipHost = inline ? inline[1] : ip;
    const cidrHost = cidrParts ? cidrParts[1] : cidr;
    const presentPrefixes = [prefix, inline?.[2], cidrParts?.[2]]
      .filter((value): value is string => value !== undefined);
    const conflictingAddress = Boolean(ipHost && cidrHost && ipHost !== cidrHost);
    const conflictingPrefix = presentPrefixes.length > 1 &&
      presentPrefixes.some((value) => Number(value) !== Number(presentPrefixes[0]));
    if (conflictingAddress || conflictingPrefix) {
      diagnostics.push({
        code: "NETWORK_IMPORT_ADDRESS_CONFLICT", severity: "error",
        message: "Independent nonblank address or prefix declarations disagree. No value was automatically preferred or activated.",
        table: inventory.tableId, row: row.recordIndex,
      });
      continue;
    }
    const address = cidrHost ?? ipHost;
    const subnetPrefix = cidrParts?.[2] ?? inline?.[2] ?? prefix;
    // An explicit prefix is meaningful only alongside an explicit IPv4 host.
    // Preserve an orphan declaration for canonical workbook validation rather
    // than silently dropping it when the device has no IP (even if it has MAC).
    if (!address && subnetPrefix !== undefined) diagnostics.push({
      code: "NETWORK_IMPORT_PREFIX_WITHOUT_IP", severity: "error",
      message: "A declared subnet prefix requires a documented IPv4 address; no host or network was inferred.",
      table: inventory.tableId, row: row.recordIndex,
    });
    if (populatedSourceCell(fields.prefix?.value) && prefix === undefined) diagnostics.push({
      code: "NETWORK_IMPORT_PREFIX_INVALID", severity: "error",
      message: "A nonblank subnet prefix must be text or a finite number; the declaration cannot be ignored.",
      table: inventory.tableId, row: row.recordIndex,
    });
    const mac = stringCell(fields.mac);
    const invalidMac = mac !== undefined && !MAC_ADDRESS.test(mac);
    if (invalidMac) diagnostics.push({
      code: "NETWORK_IMPORT_MAC_INVALID", severity: "error",
      message: "Invalid documented MAC address; expected six hexadecimal octets separated by colons. Original address and device identity are not shown.",
      table: inventory.tableId, row: row.recordIndex,
    });
    // A MAC is a declared interface attribute even when no IPv4 address
    // exists. Preserve the fact as a generic interface, but do not infer
    // an IP, physical port, connection, routing state or Engine result.
    if (address || mac || subnetPrefix !== undefined) {
      if (address && (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) ||
          address.split(".").some((x) => Number(x) > 255) ||
          (subnetPrefix !== undefined && !positiveInt(subnetPrefix)))) {
        diagnostics.push({ code: "NETWORK_IMPORT_IP_INVALID", severity: "error", message: "Invalid documented IPv4 address or prefix. Original address and device identity are not shown.", table: inventory.tableId, row: row.recordIndex });
      } else if (!invalidMac) {
        const values: Record<string, { value: string; source?: ImportCell | undefined }> = {
          nodeId: { value: id, source: fields.id }, interfaceId: { value: "primary", source: fields.id }, name: { value: "primary", source: fields.id },
        };
        if (address) values.IPv4 = { value: address, source: fields.ip ?? fields.cidr };
        if (subnetPrefix !== undefined) values.prefix = { value: subnetPrefix, source: fields.prefix ?? fields.cidr ?? fields.ip };
        if (mac) values.MAC = { value: mac, source: fields.mac };
        interfaces.push(canonicalRecord(row.recordIndex, "Interfaces", values));
      }
    }
    const gateway = stringCell(fields.gateway);
    if (gateway) {
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(gateway) || gateway.split(".").some((x) => Number(x) > 255)) diagnostics.push({ code: "NETWORK_IMPORT_GATEWAY_INVALID", severity: "error", message: "Invalid documented default gateway; original gateway and device identity are not shown.", table: inventory.tableId, row: row.recordIndex });
      else diagnostics.push({ code: "NETWORK_IMPORT_GATEWAY_NOT_LINK", severity: "warning", message: "A declared gateway is retained only as a source note; no physical connection or modeled route is inferred.", table: inventory.tableId, row: row.recordIndex });
    }
    const target = stringCell(fields.target);
    if (target) inlineLinks.push(canonicalRecord(row.recordIndex, "Links", {
      linkId: { value: `link_row_${row.recordIndex}`, source: fields.target }, nodeA: { value: id, source: fields.id }, nodeB: { value: target, source: fields.target },
    }));
  }
  const unmappedColumnCount = nonemptyUnmappedHeaders.size;
  if (unmappedColumnCount > 0) diagnostics.push({
    code: "NETWORK_IMPORT_COLUMNS_UNMAPPED", severity: "warning",
    message: "Some source columns are unsupported, were not mapped, and do not establish modeled assets, links or Engine truth.",
  });
  const explicitTables = document.tables.filter((t) => t.tableId.toLowerCase() === "links");
  const explicitLinks = explicitTables[0];
  if (explicitTables.length > 1) diagnostics.push({
    code: "NETWORK_IMPORT_LINK_SHEET_AMBIGUOUS", severity: "error",
    message: "Multiple Links tables are present; resolve the duplicate source tables before import.",
  });
  const conflicted = inlineLinks.length > 0 && explicitLinks !== undefined;
  const linkSourceConflict: NetworkLinkSourceConflict | undefined =
    inlineLinks.length > 0 && explicitLinks !== undefined ? Object.freeze({
      inlineDeclaredLinks: inlineLinks.length,
      sheetDeclaredLinks: explicitLinks.records.length,
    }) : undefined;
  if (!validChoice || (choice !== undefined && !conflicted)) diagnostics.push({
    code: "NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID", severity: "error",
    message: "A link-source choice is valid only between an explicit Links table and inline Connected To declarations.",
  });
  if (conflicted && choice === undefined) diagnostics.push({
    code: "NETWORK_IMPORT_LINK_SOURCES_CONFLICT", severity: "error",
    message: "Two explicit link sources conflict. Review and choose one; neither is automatically trusted, merged or activated.",
  });
  if (conflicted && (choice === "LINKS_SHEET" || choice === "INLINE_CONNECTED_TO")) diagnostics.push({
    code: "NETWORK_IMPORT_LINK_SOURCE_REVIEWED", severity: "warning",
    message: choice === "LINKS_SHEET"
      ? "Operator chose the explicit Links table only; inline Connected To declarations were excluded."
      : "Operator chose inline Connected To declarations only; the explicit Links table was excluded.",
  });
  // A discarded source does not contribute any modeled link.
  const useSheet = Boolean(explicitLinks) && (!conflicted || choice === "LINKS_SHEET");
  const links = useSheet ? explicitLinks!.records.map((row) => {
    const pickLink = (names: readonly string[]) => pick(row, names, explicitLinks!.tableId, diagnostics);
    const id = pickLink(["linkId", "Link ID", "Connection ID"]);
    const from = pickLink(["nodeA", "From", "Source", "From Device", "Source Device"]);
    const to = pickLink(["nodeB", "To", "Destination", "To Device", "Target Device"]);
    const portA = pickLink(["interfaceA", "From Port", "Source Port"]);
    const portB = pickLink(["interfaceB", "To Port", "Target Port"]);
    const kind = pickLink(["kind", "Link Type", "Connection Type"]);
    // Do not manufacture a row-based ID or default network link kind from
    // an explicit but nontext declaration in a separate Links sheet.
    for (const [field, cell] of [
      ["linkId", id], ["nodeA", from], ["nodeB", to],
      ["interfaceA", portA], ["interfaceB", portB], ["kind", kind],
    ] as const) {
      rejectUnrepresentableField(cell, field, explicitLinks!.tableId, row.recordIndex, diagnostics);
    }
    const linkId = stringCell(id) ?? `link_sheet_row_${row.recordIndex}`;
    const values: Record<string, { value: string; source?: ImportCell | undefined }> = {
      linkId: { value: linkId, source: id }, nodeA: { value: stringCell(from) ?? "", source: from }, nodeB: { value: stringCell(to) ?? "", source: to },
    };
    if (stringCell(portA)) values.interfaceA = { value: stringCell(portA)!, source: portA };
    if (stringCell(portB)) values.interfaceB = { value: stringCell(portB)!, source: portB };
    if (stringCell(kind)) values.kind = { value: stringCell(kind)!, source: kind };
    return canonicalRecord(row.recordIndex, "Links", values);
  }) : inlineLinks;
  if (new Set(nodes.map((r) => stringCell(r.fields.nodeId))).size !== nodes.length)
    diagnostics.push({ code: "NETWORK_IMPORT_DUPLICATE_DEVICE_ID", severity: "error", message: "Duplicate device IDs. Each device must have a unique stable ID." });
  const metadata: ImportTable = { tableId: "Metadata", records: [canonicalRecord(1, "Metadata", { scenarioId: { value: "imported_network" }, title: { value: "Imported Network Topology" } })] };
  const output: ImportTable[] = [metadata, { tableId: "Nodes", records: nodes }, { tableId: "Interfaces", records: interfaces }, { tableId: "Links", records: links }];
  if (!links.length) diagnostics.push({ code: "NETWORK_IMPORT_NO_EXPLICIT_LINKS", severity: "warning", message: "No explicit network links were supplied; the topology will show devices without connecting them." });
  if (nodes.length === 0) diagnostics.push({ code: "NETWORK_IMPORT_NO_DEVICES", severity: "error", message: "No valid device rows were found." });
  return {
    document: { tables: output }, diagnostics, unmappedColumnCount,
    ...(linkSourceConflict ? { linkSourceConflict } : {}),
    ...(conflicted && (choice === "LINKS_SHEET" || choice === "INLINE_CONNECTED_TO")
      ? { linkSourceChoice: choice } : {}),
  };
}
