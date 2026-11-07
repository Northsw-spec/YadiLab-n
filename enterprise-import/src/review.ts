import type { EnterpriseMappingProfile, EnterpriseMappingReview } from "../../core-model/src/generated/contracts.js";
import { computeMappingProfileHash, webCryptoImportHashProvider } from "./hash.js";
import { selectEnterpriseImportAdapter } from "./adapters.js";
import type { EnterpriseImportHashProvider, EnterpriseMappingReviewRequest, EnterpriseMappingReviewResult, ImportDocument, MappingClass, MappingReviewDecision } from "./types.js";
import { EnterpriseImportError } from "./types.js";

type TableMapping = EnterpriseMappingProfile["tables"][number];
type Selector = TableMapping["entity"]["id"];

type ReviewMapping = EnterpriseMappingReview["tables"][number]["mappings"][number];

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function headerKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }

function sourceDescriptor(hash: string, request: EnterpriseMappingReviewRequest): EnterpriseMappingReview["source"] {
  const base = { sourceId: `src_${hash}`, mediaType: request.source.mediaType, sha256: hash, byteSize: request.source.bytes.byteLength };
  return request.source.displayName ? { ...base, displayName: request.source.displayName } : base;
}

function availableFieldCounts(document: ImportDocument, tableId: string): { field: string; occurrences: number }[] {
  const table = document.tables.find((x) => x.tableId === tableId);
  if (!table) return [];
  const counts = new Map<string, number>();
  for (const record of table.records) for (const field of Object.keys(record.fields)) counts.set(field, (counts.get(field) ?? 0) + 1);
  return [...counts].map(([field, occurrences]) => ({ field, occurrences })).sort((a,b)=>a.field.localeCompare(b.field,"en"));
}

function selectorCandidates(fields: readonly string[], selector: Selector): { status: "RESOLVED" | "MISSING" | "AMBIGUOUS"; selectedField?: string; selectedClass?: MappingClass; candidates: { field: string; class: MappingClass }[] } {
  for (const match of selector.matches) {
    const candidates = match.class === "EXACT" || match.class === "USER_MAPPED"
      ? fields.filter((x) => x === match.field)
      : fields.filter((x) => headerKey(x) === headerKey(match.field));
    if (candidates.length === 1) return { status: "RESOLVED", selectedField: candidates[0]!, selectedClass: match.class as MappingClass, candidates: [{ field: candidates[0]!, class: match.class as MappingClass }] };
    if (candidates.length > 1) return { status: "AMBIGUOUS", candidates: candidates.sort((a,b)=>a.localeCompare(b,"en")).map((field)=>({ field, class: match.class as MappingClass })) };
  }
  return { status: "MISSING", candidates: [] };
}

function reviewOne(mappingId: string, role: ReviewMapping["role"], required: boolean, fields: readonly string[], selector: Selector): ReviewMapping {
  const resolved = selectorCandidates(fields, selector);
  const base = { mappingId, role, required, status: resolved.status, candidates: resolved.candidates } as const;
  if (resolved.status === "RESOLVED") return { ...base, selectedField: resolved.selectedField!, selectedClass: resolved.selectedClass! };
  return base;
}

export async function analyzeEnterpriseMapping(document: ImportDocument, profile: EnterpriseMappingProfile, context: {
  adapter: { id: string; version: string };
  source: EnterpriseMappingReview["source"];
  mappingHash: string;
}): Promise<EnterpriseMappingReview> {
  const diagnostics: Array<EnterpriseMappingReview["diagnostics"][number]> = [];
  const availableTables = document.tables.map((x)=>x.tableId).sort((a,b)=>a.localeCompare(b,"en"));
  const seenTableIds = new Set<string>(); const seenMappingIds = new Set<string>();
  const tables: Array<EnterpriseMappingReview["tables"][number]> = [];
  let blocked = false; let reviewRequired = false;

  for (const tableMap of profile.tables) {
    if (seenTableIds.has(tableMap.tableId)) { diagnostics.push({ code:"IMPORT_DUPLICATE_TABLE_MAPPING_ID",severity:"error",message:`Duplicate table mapping ID ${tableMap.tableId}.`,table:tableMap.sourceTable }); blocked=true; }
    seenTableIds.add(tableMap.tableId);
    const sourceTablePresent = availableTables.includes(tableMap.sourceTable);
    if (!sourceTablePresent) { diagnostics.push({ code:"IMPORT_MAPPING_TABLE_REVIEW_REQUIRED",severity:"warning",message:`Mapped source table ${tableMap.sourceTable} is not present and requires review.`,table:tableMap.sourceTable }); reviewRequired=true; }
    const availableFields = availableFieldCounts(document, tableMap.sourceTable);
    const fields = availableFields.map((x)=>x.field);
    const mappings: ReviewMapping[] = [];
    mappings.push(reviewOne(`${tableMap.tableId}_entity_id`, "entity.id", true, fields, tableMap.entity.id));
    mappings.push(reviewOne(`${tableMap.tableId}_entity_label`, "entity.label", !tableMap.entity.label.fallbackToId, fields, tableMap.entity.label.selector));
    for (const fact of tableMap.facts) {
      if (seenMappingIds.has(fact.mappingId)) { diagnostics.push({ code:"IMPORT_DUPLICATE_MAPPING_ID",severity:"error",message:`Duplicate mapping ID ${fact.mappingId}.`,table:tableMap.sourceTable,mappingId:fact.mappingId }); blocked=true; }
      seenMappingIds.add(fact.mappingId);
      mappings.push(reviewOne(fact.mappingId, "fact", fact.presence === "required", fields, fact.selector));
    }
    for (const m of mappings) {
      if (m.status === "AMBIGUOUS") { diagnostics.push({ code:"IMPORT_MAPPING_AMBIGUOUS",severity:"warning",message:`Mapping ${m.mappingId} matches multiple source fields and requires an explicit user mapping.`,table:tableMap.sourceTable,mappingId:m.mappingId }); reviewRequired=true; }
      if (m.status === "MISSING" && m.required) { diagnostics.push({ code:"IMPORT_MAPPING_REQUIRED_MISSING",severity:"warning",message:`Required mapping ${m.mappingId} has no source field and requires review.`,table:tableMap.sourceTable,mappingId:m.mappingId }); reviewRequired=true; }
      if (m.status === "MISSING" && !m.required) diagnostics.push({ code:"IMPORT_MAPPING_OPTIONAL_MISSING",severity:"info",message:`Optional mapping ${m.mappingId} has no source field.`,table:tableMap.sourceTable,mappingId:m.mappingId });
    }
    tables.push({ tableId: tableMap.tableId, sourceTable: tableMap.sourceTable, sourceTablePresent, availableFields, mappings });
  }

  return {
    formatId:"infrastructure-cyber-lab.enterprise-mapping-review", schemaVersion:"0.1.0",
    status: blocked ? "BLOCKED" : reviewRequired ? "REVIEW_REQUIRED" : "READY",
    adapter: context.adapter, source: context.source,
    mapping:{ profileId:profile.profileId, version:profile.version, sha256:context.mappingHash },
    availableTables, tables, diagnostics,
  };
}

export async function runEnterpriseMappingReview(request: EnterpriseMappingReviewRequest, hashProvider: EnterpriseImportHashProvider = webCryptoImportHashProvider): Promise<EnterpriseMappingReviewResult> {
  const hash = await hashProvider.sha256Bytes(request.source.bytes);
  const source = sourceDescriptor(hash, request);
  const mappingHash = await computeMappingProfileHash(request.mappingProfile, hashProvider);
  let adapter = request.adapter;
  try {
    if (!adapter) adapter = selectEnterpriseImportAdapter(request.source.mediaType);
    const normalized = request.source.mediaType.split(";",1)[0]!.trim().toLowerCase();
    if (!adapter.mediaTypes.some((x)=>x.toLowerCase()===normalized)) throw new EnterpriseImportError("IMPORT_ADAPTER_MEDIA_TYPE_MISMATCH",`Adapter ${adapter.id} does not claim media type ${request.source.mediaType}.`);
    const parsed = await adapter.parse(request.source,{options:request.options ? {...request.options} : {}});
    const review = await analyzeEnterpriseMapping(parsed.document,request.mappingProfile,{adapter:{id:adapter.id,version:adapter.version},source,mappingHash});
    const diagnostics = [...parsed.diagnostics.map((x)=>({code:x.code,severity:x.severity,message:x.message,...(x.table?{table:x.table}:{}),...(x.field?{field:x.field}:{}),...(x.mappingId?{mappingId:x.mappingId}:{})})),...review.diagnostics];
    const status = diagnostics.some((x)=>x.severity==="error") ? "BLOCKED" : review.status;
    return { review:{...review,status,diagnostics}, document:parsed.document };
  } catch (error) {
    const code=error instanceof EnterpriseImportError?error.code:"IMPORT_INTERNAL_ERROR"; const message=error instanceof Error?error.message:String(error);
    return { review:{formatId:"infrastructure-cyber-lab.enterprise-mapping-review",schemaVersion:"0.1.0",status:"BLOCKED",adapter:adapter?{id:adapter.id,version:adapter.version}:{id:"unresolved",version:"0.0.0"},source,mapping:{profileId:request.mappingProfile.profileId,version:request.mappingProfile.version,sha256:mappingHash},availableTables:[],tables:[],diagnostics:[{code,severity:"error",message}]}};
  }
}

function selectorForMapping(table: TableMapping, mappingId: string): Selector | undefined {
  if (mappingId === `${table.tableId}_entity_id`) return table.entity.id;
  if (mappingId === `${table.tableId}_entity_label`) return table.entity.label.selector;
  return table.facts.find((x)=>x.mappingId===mappingId)?.selector;
}

export function applyMappingReviewDecisions(profile: EnterpriseMappingProfile, document: ImportDocument, decisions: readonly MappingReviewDecision[], nextVersion: string): EnterpriseMappingProfile {
  if (!SEMVER.test(nextVersion) || nextVersion === profile.version) throw new EnterpriseImportError("IMPORT_MAPPING_VERSION_INVALID","A reviewed mapping profile requires a new valid semantic version.");
  const next = structuredClone(profile) as EnterpriseMappingProfile;
  (next as {version:string}).version=nextVersion;
  const seen = new Set<string>();
  for (const decision of decisions) {
    const key=decision.kind==="table"?`table:${decision.tableId}`:`field:${decision.mappingId}`;
    if (seen.has(key)) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_DUPLICATE",`Duplicate mapping review decision ${key}.`); seen.add(key);
    if (decision.kind === "table") {
      const table = next.tables.find((x)=>x.tableId===decision.tableId); if (!table) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_UNKNOWN",`Unknown table mapping ${decision.tableId}.`);
      if (!document.tables.some((x)=>x.tableId===decision.sourceTable)) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_FIELD_UNKNOWN",`Source table ${decision.sourceTable} does not exist in the parsed document.`);
      (table as {sourceTable:string}).sourceTable=decision.sourceTable; continue;
    }
    const owning = next.tables.find((x)=>selectorForMapping(x,decision.mappingId)); if (!owning) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_UNKNOWN",`Unknown field mapping ${decision.mappingId}.`);
    const sourceTable=document.tables.find((x)=>x.tableId===owning.sourceTable); if (!sourceTable) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_TABLE_MISSING",`Source table ${owning.sourceTable} must be mapped before field decisions are applied.`);
    const fields=new Set(sourceTable.records.flatMap((r)=>Object.keys(r.fields)));
    if (!fields.has(decision.field)) throw new EnterpriseImportError("IMPORT_MAPPING_DECISION_FIELD_UNKNOWN",`Field ${decision.field} does not exist in source table ${owning.sourceTable}.`);
    const selector=selectorForMapping(owning,decision.mappingId)!;
    const remaining=selector.matches.filter((x)=>!(x.class==="USER_MAPPED"&&x.field===decision.field));
    (selector as {matches:{field:string;class:"EXACT"|"ALIAS"|"USER_MAPPED"}[]}).matches=[{field:decision.field,class:"USER_MAPPED"},...remaining];
  }
  return next;
}
