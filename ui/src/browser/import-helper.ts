import type {
  EnterpriseBaseline,
  EnterpriseImportReport,
  EnterpriseMappingProfile,
  EnterpriseMappingReview,
  EnterpriseReimportDiff,
  EnterpriseReimportMergePlan,
} from "../../../core-model/src/generated/contracts.js";
import { projectEnterpriseBaselineToScenario, type EnterpriseProjectionOptions } from "../../../enterprise-projection/src/index.js";
import { createBuilderWorkspace } from "./builder.js";
import type { BuilderWorkspace } from "./types.js";
import {
  applyEnterpriseReimportMerge,
  applyMappingReviewDecisions,
  compareEnterpriseBaselines,
  planEnterpriseReimportMerge,
  runEnterpriseImport,
  runEnterpriseMappingReview,
  type EnterpriseImportSourceInput,
  type EnterpriseMappingReviewRequest,
  type MappingReviewDecision,
  type EnterpriseMergeResolution,
  type ImportDocument,
} from "../../../enterprise-import/src/index.js";

export interface BinaryReadableFile {
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ImportHelperStatus = "IDLE" | "SOURCE_READY" | "REVIEW_REQUIRED" | "READY_TO_IMPORT" | "IMPORTED" | "REIMPORT_REVIEW" | "MERGE_REVIEW" | "MERGED" | "BLOCKED";

export interface ImportHelperReviewView {
  readonly status: EnterpriseMappingReview["status"];
  readonly sourceName?: string;
  readonly adapter: string;
  readonly tables: readonly {
    readonly tableId: string;
    readonly sourceTable: string;
    readonly sourceTablePresent: boolean;
    readonly availableFields: readonly { readonly field: string; readonly occurrences: number }[];
    readonly mappings: readonly {
      readonly mappingId: string;
      readonly role: string;
      readonly required: boolean;
      readonly status: string;
      readonly selectedField?: string;
      readonly selectedClass?: string;
      readonly candidates: readonly { readonly field: string; readonly class: string }[];
    }[];
  }[];
  readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
}

export interface ImportHelperImportView {
  readonly status: EnterpriseImportReport["status"];
  readonly baselineIdentity?: string;
  readonly tables: number;
  readonly records: number;
  readonly entities: number;
  readonly facts: number;
  readonly unknownFacts: number;
  readonly invalidFacts: number;
  readonly unmappedFields: number;
  readonly conflicts: number;
  readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
}

export interface ImportHelperDiffView {
  readonly changed: boolean;
  readonly summary: EnterpriseReimportDiff["summary"];
  readonly entityChanges: EnterpriseReimportDiff["entityChanges"];
  readonly relationshipChanges: EnterpriseReimportDiff["relationshipChanges"];
  readonly factChanges: EnterpriseReimportDiff["factChanges"];
}

export interface ImportHelperMergeView {
  readonly status: EnterpriseReimportMergePlan["status"];
  readonly entries: EnterpriseReimportMergePlan["entries"];
  readonly reviewRequired: number;
}

const MEDIA_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
};

export function enterpriseMediaTypeForFile(name: string, declaredType?: string): string {
  const lower = name.toLowerCase();
  for (const [extension, mediaType] of Object.entries(MEDIA_BY_EXTENSION)) {
    if (lower.endsWith(extension)) return mediaType;
  }
  const basename = lower.split(/[\\/]/).at(-1) ?? lower;
  const hasExtension = /\.[a-z0-9]+$/i.test(basename);
  const normalized = declaredType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!hasExtension && normalized && Object.values(MEDIA_BY_EXTENSION).includes(normalized)) return normalized;
  throw new Error(`Unsupported enterprise import file '${name}'. Supported extensions: ${Object.keys(MEDIA_BY_EXTENSION).join(", ")}.`);
}

export async function readEnterpriseImportFile(file: BinaryReadableFile): Promise<EnterpriseImportSourceInput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`Enterprise import file '${file.name}' is empty.`);
  return { bytes, mediaType: enterpriseMediaTypeForFile(file.name, file.type), displayName: file.name };
}

export async function readEnterpriseMappingProfileFile(file: { readonly name: string; text(): Promise<string> }): Promise<EnterpriseMappingProfile> {
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Mapping profile must be a JSON file.");
  const text = await file.text();
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`Mapping profile JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mapping profile must be a JSON object.");
  const candidate = value as Partial<EnterpriseMappingProfile>;
  if (candidate.formatId !== "infrastructure-cyber-lab.enterprise-mapping-profile") throw new Error("Mapping profile has the wrong formatId.");
  if (typeof candidate.profileId !== "string" || !candidate.profileId) throw new Error("Mapping profile is missing profileId.");
  if (typeof candidate.version !== "string" || !candidate.version) throw new Error("Mapping profile is missing version.");
  if (!Array.isArray(candidate.tables)) throw new Error("Mapping profile is missing tables.");
  return value as EnterpriseMappingProfile;
}

export async function reviewEnterpriseImport(args: EnterpriseMappingReviewRequest): Promise<{ readonly review: EnterpriseMappingReview; readonly document?: ImportDocument; readonly view: ImportHelperReviewView }> {
  const result = await runEnterpriseMappingReview(args);
  return { review: result.review, ...(result.document ? { document: result.document } : {}), view: buildImportHelperReviewView(result.review) };
}

export function buildImportHelperReviewView(review: EnterpriseMappingReview): ImportHelperReviewView {
  const sourceName = review.source.displayName;
  return {
    status: review.status,
    ...(sourceName ? { sourceName } : {}),
    adapter: `${review.adapter.id}@${review.adapter.version}`,
    tables: review.tables.map((table) => ({
      tableId: table.tableId,
      sourceTable: table.sourceTable,
      sourceTablePresent: table.sourceTablePresent,
      availableFields: table.availableFields.map((field) => ({ field: field.field, occurrences: field.occurrences })),
      mappings: table.mappings.map((mapping) => ({
        mappingId: mapping.mappingId,
        role: mapping.role,
        required: mapping.required,
        status: mapping.status,
        ...(mapping.selectedField ? { selectedField: mapping.selectedField } : {}),
        ...(mapping.selectedClass ? { selectedClass: mapping.selectedClass } : {}),
        candidates: mapping.candidates.map((candidate) => ({ field: candidate.field, class: candidate.class })),
      })),
    })),
    diagnostics: review.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
  };
}

export function applyImportHelperMappingDecisions(args: {
  readonly profile: EnterpriseMappingProfile;
  readonly document: NonNullable<Awaited<ReturnType<typeof runEnterpriseMappingReview>>["document"]>;
  readonly decisions: readonly MappingReviewDecision[];
  readonly nextVersion: string;
}): EnterpriseMappingProfile {
  return applyMappingReviewDecisions(args.profile, args.document, args.decisions, args.nextVersion);
}

export async function importEnterpriseBaseline(args: {
  readonly baselineId: string;
  readonly source: EnterpriseImportSourceInput;
  readonly mappingProfile: EnterpriseMappingProfile;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly conflictResolutions?: EnterpriseBaseline["importContract"]["conflictResolutions"];
}): Promise<{ readonly report: EnterpriseImportReport; readonly baseline?: EnterpriseBaseline; readonly view: ImportHelperImportView }> {
  const result = await runEnterpriseImport(args);
  return { report: result.report, ...(result.baseline ? { baseline: result.baseline } : {}), view: buildImportHelperImportView(result.report) };
}

export function buildImportHelperImportView(report: EnterpriseImportReport): ImportHelperImportView {
  return {
    status: report.status,
    ...(report.baselineIdentity ? { baselineIdentity: report.baselineIdentity } : {}),
    tables: report.stats.tables,
    records: report.stats.records,
    entities: report.stats.entities,
    facts: report.stats.facts,
    unknownFacts: report.stats.unknownFacts,
    invalidFacts: report.stats.invalidFacts,
    unmappedFields: report.unmappedFields.length,
    conflicts: report.conflicts.length,
    diagnostics: report.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
  };
}

export function previewEnterpriseReimport(previous: EnterpriseBaseline, next: EnterpriseBaseline): { readonly diff: EnterpriseReimportDiff; readonly view: ImportHelperDiffView } {
  const diff = compareEnterpriseBaselines(previous, next);
  const summary = diff.summary;
  const changed = Object.values(summary).some((value) => value > 0);
  return { diff, view: { changed, summary, entityChanges: diff.entityChanges, relationshipChanges: diff.relationshipChanges, factChanges: diff.factChanges } };
}

export async function planImportHelperMerge(ancestor: EnterpriseBaseline, current: EnterpriseBaseline, incoming: EnterpriseBaseline): Promise<{ readonly plan: EnterpriseReimportMergePlan; readonly view: ImportHelperMergeView }> {
  const plan = await planEnterpriseReimportMerge(ancestor, current, incoming);
  return { plan, view: { status: plan.status, entries: plan.entries, reviewRequired: plan.entries.filter((entry) => entry.decision === "REVIEW_REQUIRED").length } };
}

export async function applyImportHelperMerge(args: {
  readonly ancestor: EnterpriseBaseline;
  readonly current: EnterpriseBaseline;
  readonly incoming: EnterpriseBaseline;
  readonly plan: EnterpriseReimportMergePlan;
  readonly resolutions?: readonly EnterpriseMergeResolution[];
}): Promise<EnterpriseBaseline> {
  const result = await applyEnterpriseReimportMerge(args);
  return result.baseline;
}


export function nextMappingProfileVersion(version: string): string {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Mapping profile version '${version}' is not semantic versioning.`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export interface ImportHelperConflictCandidate { readonly table: string; readonly row: number; readonly entityId: string; readonly label?: string }

function firstSelectorField(profile: EnterpriseMappingProfile, tableId: string, role: "id" | "label"): string | undefined {
  const table = profile.tables.find((item) => item.tableId === tableId);
  const selector = role === "id" ? table?.entity.id : table?.entity.label.selector;
  return selector?.matches[0]?.field;
}

export function findEntityConflictCandidates(document: ImportDocument, profile: EnterpriseMappingProfile, entityId: string): readonly ImportHelperConflictCandidate[] {
  const candidates: ImportHelperConflictCandidate[] = [];
  for (const tableMap of profile.tables) {
    const table = document.tables.find((item) => item.tableId === tableMap.sourceTable);
    if (!table) continue;
    const idFields = tableMap.entity.id.matches.map((item) => item.field);
    const labelFields = tableMap.entity.label.selector.matches.map((item) => item.field);
    for (const record of table.records) {
      const idEntry = idFields.map((field) => [field, record.fields[field]] as const).find(([, cell]) => cell?.value === entityId);
      if (!idEntry) continue;
      const label = labelFields.map((field) => record.fields[field]?.value).find((value) => typeof value === "string" && value.length > 0);
      candidates.push({ table: table.tableId, row: record.recordIndex, entityId, ...(typeof label === "string" ? { label } : {}) });
    }
  }
  return candidates.sort((a, b) => a.table.localeCompare(b.table, "en") || a.row - b.row);
}


export async function projectImportHelperBaseline(
  baseline: EnterpriseBaseline,
  options?: EnterpriseProjectionOptions,
): Promise<{ readonly report: Awaited<ReturnType<typeof projectEnterpriseBaselineToScenario>>["report"]; readonly workspace?: BuilderWorkspace }> {
  const result = await projectEnterpriseBaselineToScenario({ baseline, ...(options ? { options } : {}) });
  return result.ok ? { report: result.report, workspace: createBuilderWorkspace(result.source) } : { report: result.report };
}
