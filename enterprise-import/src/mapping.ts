import type { EnterpriseBaseline, EnterpriseMappingProfile } from "../../core-model/src/generated/contracts.js";
import { canonicalEnterpriseJson, computeEnterpriseBaselineIdentity } from "../../enterprise-model/src/canonical.js";
import { computeMappingProfileHash, computeRawValueHash } from "./hash.js";
import type { EnterpriseImportHashProvider, ImportCell, ImportDiagnostic, ImportDocument, ImportRecord, MappingClass } from "./types.js";

type TableMapping = EnterpriseMappingProfile["tables"][number];
type FieldSelector = TableMapping["entity"]["id"];
type FactMapping = TableMapping["facts"][number];
type EnterpriseFact = EnterpriseBaseline["facts"][number];
type EnterpriseProvenance = EnterpriseBaseline["provenance"][number];

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const IPV4 = /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/;
const CIDR4 = /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}\/(?:[0-9]|[12][0-9]|3[0-2])$/;
const MAC = /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
function validIpv4(value: string): boolean { return IPV4.test(value) && value.split(".").every((x) => Number(x) <= 255); }
function headerKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function present(value: unknown): boolean { return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === ""); }

function resolveField(record: ImportRecord, selector: FieldSelector): { kind: "match"; field: string; cell: ImportCell; mappingClass: MappingClass } | { kind: "ambiguous"; fields: readonly string[] } | undefined {
  for (const match of selector.matches) {
    if (match.class === "EXACT" || match.class === "USER_MAPPED") {
      const cell = record.fields[match.field];
      if (cell) return { kind: "match", field: match.field, cell, mappingClass: match.class };
    } else {
      const wanted = headerKey(match.field);
      const candidates = Object.entries(record.fields).filter(([name]) => headerKey(name) === wanted);
      if (candidates.length === 1) return { kind: "match", field: candidates[0]![0], cell: candidates[0]![1], mappingClass: match.class };
      if (candidates.length > 1) return { kind: "ambiguous", fields: candidates.map(([name]) => name).sort((a,b)=>a.localeCompare(b,"en")) };
    }
  }
  return undefined;
}

function convertValue(value: unknown, valueType: FactMapping["valueType"], trimStrings: boolean): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === "string" && trimStrings) value = value.trim();
  switch (valueType) {
    case "string": return typeof value === "string" ? { ok: true, value } : { ok: false };
    case "boolean":
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true" || value === "false") return { ok: true, value: value === "true" };
      return { ok: false };
    case "integer":
      if (typeof value === "number" && Number.isSafeInteger(value)) return { ok: true, value };
      if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/.test(value)) { const n = Number(value); return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false }; }
      return { ok: false };
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return { ok: true, value: Number(value) };
      return { ok: false };
    case "port": {
      const n = typeof value === "number" ? value : typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : NaN;
      return Number.isInteger(n) && n >= 0 && n <= 65535 ? { ok: true, value: n } : { ok: false };
    }
    case "ipv4": return typeof value === "string" && validIpv4(value) ? { ok: true, value } : { ok: false };
    case "ipv6": return typeof value === "string" && value.includes(":") ? { ok: true, value } : { ok: false };
    case "cidr": return typeof value === "string" && ((CIDR4.test(value) && validIpv4(value.split("/")[0]!)) || (value.includes(":") && /\/[0-9]{1,3}$/.test(value))) ? { ok: true, value } : { ok: false };
    case "mac": return typeof value === "string" && MAC.test(value) ? { ok: true, value } : { ok: false };
    case "protocol": return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value) ? { ok: true, value } : { ok: false };
    case "reference": return typeof value === "string" && ID.test(value) ? { ok: true, value } : { ok: false };
    case "list": return Array.isArray(value) ? { ok: true, value } : { ok: false };
    case "map": return value !== null && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: false };
    default: return { ok: false };
  }
}

async function stableId(prefix: string, seed: string, hashProvider: EnterpriseImportHashProvider): Promise<string> {
  const hash = await hashProvider.sha256Utf8(seed);
  return `${prefix}_${hash.slice(0, 24)}`;
}

export interface MapDocumentResult { readonly baseline: EnterpriseBaseline; readonly diagnostics: readonly ImportDiagnostic[]; readonly unmappedFields: readonly { table: string; field: string; occurrences: number }[]; readonly conflicts: readonly { conflictId: string; code: string; message: string; refs: readonly string[] }[]; }

export async function mapImportDocumentToBaseline(args: {
  baselineId: string;
  source: EnterpriseBaseline["sources"][number];
  document: ImportDocument;
  profile: EnterpriseMappingProfile;
  adapter: { id: string; version: string };
  options: Readonly<Record<string, unknown>>;
  conflictResolutions: EnterpriseBaseline["importContract"]["conflictResolutions"];
  hashProvider: EnterpriseImportHashProvider;
}): Promise<MapDocumentResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const conflicts: { conflictId: string; code: string; message: string; refs: readonly string[] }[] = [];
  const provenance: EnterpriseProvenance[] = [];
  const entities: EnterpriseBaseline["entities"][number][] = [];
  const facts: EnterpriseFact[] = [];
  const usedFields = new Map<string, Set<string>>();
  const mappingHash = await computeMappingProfileHash(args.profile, args.hashProvider);
  const trimStrings = args.options.trimStrings === true;
  const seenTableIds = new Set<string>(); const seenMappingIds = new Set<string>();
  const duplicateEntityCandidates = new Map<string, { table: string; row: number }[]>();
  for (const tableMap of args.profile.tables) {
    const table = args.document.tables.find((x) => x.tableId === tableMap.sourceTable);
    if (!table) continue;
    for (const record of table.records) {
      const resolved = resolveField(record, tableMap.entity.id);
      if (resolved?.kind !== "match" || !present(resolved.cell.value)) continue;
      const raw = typeof resolved.cell.value === "string" && trimStrings ? resolved.cell.value.trim() : resolved.cell.value;
      if (typeof raw !== "string" || !ID.test(raw)) continue;
      const list = duplicateEntityCandidates.get(raw) ?? [];
      list.push({ table: table.tableId, row: record.recordIndex });
      duplicateEntityCandidates.set(raw, list);
    }
  }
  const resolutionById = new Map(args.conflictResolutions.map((x) => [x.resolutionId, x] as const));
  const usedResolutionIds = new Set<string>();
  const conflictIdsEmitted = new Set<string>();
  for (const tableMap of args.profile.tables) {
    if (seenTableIds.has(tableMap.tableId)) diagnostics.push({ code: "IMPORT_DUPLICATE_TABLE_MAPPING_ID", severity: "error", message: `Duplicate table mapping ID ${tableMap.tableId}.`, table: tableMap.sourceTable });
    seenTableIds.add(tableMap.tableId);
    for (const factMap of tableMap.facts) { if (seenMappingIds.has(factMap.mappingId)) diagnostics.push({ code: "IMPORT_DUPLICATE_MAPPING_ID", severity: "error", message: `Duplicate fact mapping ID ${factMap.mappingId}.`, table: tableMap.sourceTable, mappingId: factMap.mappingId }); seenMappingIds.add(factMap.mappingId); }
  }

  const addProvenance = async (table: string, row: number, field: string, cell: ImportCell, mappingId: string, mappingClass: MappingClass): Promise<string> => {
    const provenanceId = await stableId("prov", `${args.source.sourceId}|${table}|${row}|${field}|${mappingId}|${canonicalEnterpriseJson(cell.value)}`, args.hashProvider);
    provenance.push({ provenanceId, sourceRef: args.source.sourceId, locator: cell.locator, field, rawValueHash: await computeRawValueHash(cell.value, args.hashProvider), mapping: { mappingId, class: mappingClass } });
    return provenanceId;
  };

  for (const tableMap of args.profile.tables) {
    const table = args.document.tables.find((x) => x.tableId === tableMap.sourceTable);
    if (!table) {
      diagnostics.push({ code: "IMPORT_REQUIRED_TABLE_MISSING", severity: "error", message: `Mapped source table ${tableMap.sourceTable} is missing.`, table: tableMap.sourceTable });
      continue;
    }
    const used = usedFields.get(table.tableId) ?? new Set<string>(); usedFields.set(table.tableId, used);
    for (const record of table.records) {
      const idResolved = resolveField(record, tableMap.entity.id);
      if (idResolved?.kind === "ambiguous") { diagnostics.push({ code: "IMPORT_FIELD_AMBIGUOUS", severity: "error", message: `Entity ID mapping matches multiple fields: ${idResolved.fields.join(", ")}.`, table: table.tableId, row: record.recordIndex }); continue; }
      if (!idResolved || !present(idResolved.cell.value)) {
        diagnostics.push({ code: "IMPORT_REQUIRED_ENTITY_ID_MISSING", severity: "error", message: "Entity ID field is missing.", table: table.tableId, row: record.recordIndex });
        continue;
      }
      used.add(idResolved.field);
      const idValue = typeof idResolved.cell.value === "string" && trimStrings ? idResolved.cell.value.trim() : idResolved.cell.value;
      if (typeof idValue !== "string" || !ID.test(idValue)) {
        diagnostics.push({ code: "IMPORT_ENTITY_ID_INVALID", severity: "error", message: `Entity ID must already be a stable ASCII-safe ID; got ${String(idValue)}.`, table: table.tableId, row: record.recordIndex, field: idResolved.field });
        continue;
      }
      const duplicateRows = duplicateEntityCandidates.get(idValue) ?? [];
      const conflictIdForEntity = await stableId("conflict", `entity|${idValue}`, args.hashProvider);
      if (duplicateRows.length > 1) {
        const resolution = resolutionById.get(conflictIdForEntity);
        if (resolution) {
          usedResolutionIds.add(resolution.resolutionId);
          const choice = resolution.choice as unknown;
          const validChoice = resolution.code === "IMPORT_ENTITY_COLLISION" && choice !== null && typeof choice === "object" && !Array.isArray(choice)
            && (choice as Record<string, unknown>).strategy === "select-record"
            && typeof (choice as Record<string, unknown>).table === "string"
            && Number.isInteger((choice as Record<string, unknown>).row);
          if (!validChoice) {
            diagnostics.push({ code: "IMPORT_CONFLICT_RESOLUTION_INVALID", severity: "error", message: `Conflict resolution ${resolution.resolutionId} is invalid for entity collision ${idValue}.`, table: table.tableId, row: record.recordIndex });
          } else {
            const selectedTable = (choice as Record<string, unknown>).table as string;
            const selectedRow = (choice as Record<string, unknown>).row as number;
            const targetExists = duplicateRows.some((x) => x.table === selectedTable && x.row === selectedRow);
            if (!targetExists) {
              diagnostics.push({ code: "IMPORT_CONFLICT_RESOLUTION_INVALID", severity: "error", message: `Conflict resolution ${resolution.resolutionId} selects a record that is not part of the collision.`, table: table.tableId, row: record.recordIndex });
            } else if (table.tableId !== selectedTable || record.recordIndex !== selectedRow) {
              diagnostics.push({ code: "IMPORT_CONFLICT_RECORD_SKIPPED", severity: "info", message: `Record skipped by explicit conflict resolution for entity ${idValue}.`, table: table.tableId, row: record.recordIndex });
              continue;
            }
          }
        }
      }
      const idProv = await addProvenance(table.tableId, record.recordIndex, idResolved.field, idResolved.cell, `${tableMap.tableId}_entity_id`, idResolved.mappingClass);
      const labelResolved = resolveField(record, tableMap.entity.label.selector);
      let label = idValue; const entityProv = [idProv];
      if (labelResolved?.kind === "ambiguous") diagnostics.push({ code: "IMPORT_FIELD_AMBIGUOUS", severity: "error", message: `Entity label mapping matches multiple fields: ${labelResolved.fields.join(", ")}.`, table: table.tableId, row: record.recordIndex });
      if (labelResolved?.kind === "match" && present(labelResolved.cell.value)) {
        used.add(labelResolved.field);
        const raw = typeof labelResolved.cell.value === "string" && trimStrings ? labelResolved.cell.value.trim() : labelResolved.cell.value;
        if (typeof raw === "string" && raw.length > 0) { label = raw; entityProv.push(await addProvenance(table.tableId, record.recordIndex, labelResolved.field, labelResolved.cell, `${tableMap.tableId}_entity_label`, labelResolved.mappingClass)); }
        else diagnostics.push({ code: "IMPORT_ENTITY_LABEL_INVALID", severity: "warning", message: "Entity label is not a non-empty string; entity ID is used as fallback.", table: table.tableId, row: record.recordIndex, field: labelResolved.field });
      } else if (!tableMap.entity.label.fallbackToId) diagnostics.push({ code: "IMPORT_REQUIRED_ENTITY_LABEL_MISSING", severity: "error", message: "Entity label is missing and fallbackToId is disabled.", table: table.tableId, row: record.recordIndex });
      if (entities.some((x) => x.entityId === idValue)) {
        diagnostics.push({ code: "IMPORT_ENTITY_COLLISION", severity: "error", message: `Multiple source records map to entity ID ${idValue}.`, table: table.tableId, row: record.recordIndex });
        if (!conflictIdsEmitted.has(conflictIdForEntity)) {
          conflicts.push({ conflictId: conflictIdForEntity, code: "IMPORT_ENTITY_COLLISION", message: `Multiple source records map to entity ID ${idValue}.`, refs: [idValue] });
          conflictIdsEmitted.add(conflictIdForEntity);
        }
        continue;
      }
      entities.push({ entityId: idValue, entityType: tableMap.entity.entityType, label, provenanceRefs: entityProv });

      for (const factMap of tableMap.facts) {
        const resolved = resolveField(record, factMap.selector);
        const factId = await stableId("fact", `${idValue}|${factMap.mappingId}`, args.hashProvider);
        if (resolved?.kind === "ambiguous") { diagnostics.push({ code: "IMPORT_FIELD_AMBIGUOUS", severity: "error", message: `Mapping ${factMap.mappingId} matches multiple fields: ${resolved.fields.join(", ")}.`, table: table.tableId, row: record.recordIndex, mappingId: factMap.mappingId }); if (factMap.onMissing === "unknown") facts.push({ factId, subjectRef: idValue, path: factMap.path, valueType: factMap.valueType, state: "UNKNOWN", reasonCode: "SOURCE_AMBIGUOUS" }); continue; }
        if (!resolved || !present(resolved.cell.value)) {
          if (factMap.presence === "required") diagnostics.push({ code: "IMPORT_REQUIRED_FIELD_MISSING", severity: "error", message: `Required mapped field ${factMap.mappingId} is missing.`, table: table.tableId, row: record.recordIndex, mappingId: factMap.mappingId });
          if (factMap.onMissing === "unknown") facts.push({ factId, subjectRef: idValue, path: factMap.path, valueType: factMap.valueType, state: "UNKNOWN", reasonCode: "SOURCE_MISSING" });
          continue;
        }
        used.add(resolved.field);
        const provId = await addProvenance(table.tableId, record.recordIndex, resolved.field, resolved.cell, factMap.mappingId, resolved.mappingClass);
        const converted = convertValue(resolved.cell.value, factMap.valueType, trimStrings);
        if (!converted.ok) {
          diagnostics.push({ code: "IMPORT_VALUE_INVALID", severity: factMap.presence === "required" ? "error" : "warning", message: `Value for ${factMap.mappingId} cannot be deterministically converted to ${factMap.valueType}.`, table: table.tableId, row: record.recordIndex, field: resolved.field, mappingId: factMap.mappingId });
          facts.push({ factId, subjectRef: idValue, path: factMap.path, valueType: factMap.valueType, state: "INVALID", reasonCode: "PARSE_FAILED", rawValue: resolved.cell.value, provenanceRefs: [provId] });
        } else {
          facts.push({ factId, subjectRef: idValue, path: factMap.path, valueType: factMap.valueType, state: "KNOWN", value: converted.value, provenanceRefs: [provId] });
        }
      }
    }
  }

  for (const resolution of args.conflictResolutions) {
    if (!usedResolutionIds.has(resolution.resolutionId)) diagnostics.push({ code: "IMPORT_CONFLICT_RESOLUTION_STALE", severity: "error", message: `Conflict resolution ${resolution.resolutionId} does not match a current resolvable conflict.` });
  }

  const unmappedFields: { table: string; field: string; occurrences: number }[] = [];
  for (const table of args.document.tables) {
    const used = usedFields.get(table.tableId) ?? new Set<string>();
    const counts = new Map<string, number>();
    for (const record of table.records) for (const field of Object.keys(record.fields)) if (!used.has(field)) counts.set(field, (counts.get(field) ?? 0) + 1);
    for (const [field, occurrences] of [...counts].sort(([a],[b]) => a.localeCompare(b,"en"))) unmappedFields.push({ table: table.tableId, field, occurrences });
  }

  const draft = {
    formatId: "infrastructure-cyber-lab.enterprise-baseline" as const,
    schemaVersion: "0.2.0", modelVersion: "0.1.0", baselineId: args.baselineId, baselineIdentity: "0".repeat(64),
    importContract: { adapter: args.adapter, mapping: { profileId: args.profile.profileId, version: args.profile.version, sha256: mappingHash }, options: args.options, conflictResolutions: args.conflictResolutions },
    sources: [args.source], provenance, entities, relationships: [], facts,
  } satisfies EnterpriseBaseline;
  const baselineIdentity = await computeEnterpriseBaselineIdentity(draft, { sha256Utf8: (x) => args.hashProvider.sha256Utf8(x) });
  const baseline: EnterpriseBaseline = { ...draft, baselineIdentity };
  return { baseline, diagnostics, unmappedFields, conflicts };
}
