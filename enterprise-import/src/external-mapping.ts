import type { EnterpriseBaseline, EnterpriseMappingProfile, ScenarioSource } from "../../core-model/src/generated/contracts.js";
import { projectEnterpriseBaselineToScenario } from "../../enterprise-projection/src/index.js";
import { mapImportDocumentToBaseline } from "./mapping.js";
import { computeMappingProfileHash, webCryptoImportHashProvider } from "./hash.js";
import type { EnterpriseImportHashProvider, ImportDiagnostic, ImportDocument } from "./types.js";

export type ExternalFormatStatus = "SUPPORTED" | "PARTIAL" | "BLOCKED" | "UNSUPPORTED";

export interface ExternalFormatCapability {
  readonly format: string;
  readonly status: ExternalFormatStatus;
  readonly parser: string;
  readonly dependency: string;
  readonly mapping: string;
  readonly roundtrip: string;
  readonly securityLimits: readonly string[];
  readonly browserParrot: string;
}

export interface ExternalMappingPreview {
  readonly sourceName: string;
  readonly detectedFormat: string;
  readonly mapped: { readonly nodes: number; readonly links: number; readonly interfaces: number; readonly zones: number; readonly routes: number; readonly services: number; readonly flows: number; readonly faults: number };
  readonly unmapped: number;
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly mode: "PREVIEW";
}

export interface ExternalCanonicalMappingResult {
  readonly ok: boolean;
  readonly source?: ScenarioSource;
  readonly baseline?: EnterpriseBaseline;
  readonly preview: ExternalMappingPreview;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export const externalDataCapabilities: readonly ExternalFormatCapability[] = [
  { format: "Native JSON", status: "SUPPORTED", parser: "jsonImportAdapter", dependency: "none beyond locked runtime", mapping: "explicit EnterpriseMappingProfile", roundtrip: "canonical JSON/source path", securityLimits: ["object-root contract", "bounded source bytes", "fail-closed schema/identity"], browserParrot: "verified" },
  { format: "CSV", status: "SUPPORTED", parser: "csvImportAdapter", dependency: "none beyond locked runtime", mapping: "explicit column aliases/profile", roundtrip: "canonical JSON export", securityLimits: ["quoted-field parser", "column-count and duplicate-header checks"], browserParrot: "verified through existing import path" },
  { format: "TSV", status: "SUPPORTED", parser: "tsvImportAdapter", dependency: "none beyond locked runtime", mapping: "explicit column aliases/profile", roundtrip: "canonical JSON export", securityLimits: ["column-count and duplicate-header checks"], browserParrot: "verified through existing import path" },
  { format: "XLSX", status: "SUPPORTED", parser: "xlsxImportAdapter", dependency: "locked @zip.js/zip.js only", mapping: "explicit sheet/column profile", roundtrip: "canonical JSON export", securityLimits: ["external relationships, macros, DTD, duplicate paths and archive bombs blocked"], browserParrot: "verified through existing workbook path" },
  { format: "ODS", status: "SUPPORTED", parser: "odsImportAdapter", dependency: "locked @zip.js/zip.js only", mapping: "explicit sheet/column profile", roundtrip: "canonical JSON export", securityLimits: ["external href, scripts, encryption, DTD and archive bombs blocked"], browserParrot: "verified through existing workbook path" },
  { format: "DOCX", status: "UNSUPPORTED", parser: "none", dependency: "none added", mapping: "manual mapping required", roundtrip: "none", securityLimits: ["no free-text topology inference"], browserParrot: "not applicable" },
  { format: "PDF", status: "UNSUPPORTED", parser: "none", dependency: "none added", mapping: "manual mapping required", roundtrip: "none", securityLimits: ["no free-text or diagram topology inference"], browserParrot: "not applicable" },
  { format: "YAML", status: "UNSUPPORTED", parser: "none", dependency: "none added", mapping: "manual mapping required", roundtrip: "none", securityLimits: ["no heuristic parser"], browserParrot: "not applicable" },
  { format: "XML", status: "UNSUPPORTED", parser: "none", dependency: "none added", mapping: "manual mapping required", roundtrip: "none", securityLimits: ["no unbounded XML parser"], browserParrot: "not applicable" },
];

function countMapped(profile: EnterpriseMappingProfile, document: ImportDocument) {
  const ids = new Set(profile.tables.map((x) => x.sourceTable));
  const tables = document.tables.filter((x) => ids.has(x.tableId));
  const records = tables.reduce((n, table) => n + table.records.length, 0);
  const fields = tables.flatMap((table) => table.records.flatMap((record) => Object.keys(record.fields)));
  const hasPath = (suffix: string) => profile.tables.flatMap((x) => x.facts).some((x) => x.path.toLowerCase().includes(suffix));
  return { nodes: records, links: hasPath("relationship") ? records : 0, interfaces: hasPath("interface") ? records : 0, zones: hasPath("zone") ? records : 0, routes: hasPath("route") ? records : 0, services: hasPath("service") ? records : 0, flows: hasPath("flow") ? records : 0, faults: hasPath("fault") ? records : 0, fields: fields.length };
}

export function previewExternalMapping(args: { sourceName: string; detectedFormat: string; document: ImportDocument; profile: EnterpriseMappingProfile; diagnostics?: readonly ImportDiagnostic[]; unmappedFields?: readonly { table: string; field: string; occurrences: number }[] }): ExternalMappingPreview {
  const diagnostics = args.diagnostics ?? [];
  const mapped = countMapped(args.profile, args.document);
  const unmapped = (args.unmappedFields ?? []).reduce((n, x) => n + x.occurrences, 0);
  return { sourceName: args.sourceName, detectedFormat: args.detectedFormat, mapped: { nodes: mapped.nodes, links: mapped.links, interfaces: mapped.interfaces, zones: mapped.zones, routes: mapped.routes, services: mapped.services, flows: mapped.flows, faults: mapped.faults }, unmapped, errors: diagnostics.filter((x) => x.severity === "error").length, warnings: diagnostics.filter((x) => x.severity === "warning").length, diagnostics: [...diagnostics], mode: "PREVIEW" };
}

export async function mapExternalDocumentToCanonicalScenario(args: { baselineId: string; source: EnterpriseBaseline["sources"][number]; document: ImportDocument; profile: EnterpriseMappingProfile; adapter: { id: string; version: string }; options?: Readonly<Record<string, unknown>>; conflictResolutions?: EnterpriseBaseline["importContract"]["conflictResolutions"]; sourceName: string; detectedFormat: string; hashProvider?: EnterpriseImportHashProvider }): Promise<ExternalCanonicalMappingResult> {
  const hashProvider = args.hashProvider ?? webCryptoImportHashProvider;
  const mapped = await mapImportDocumentToBaseline({ baselineId: args.baselineId, source: args.source, document: args.document, profile: args.profile, adapter: args.adapter, options: args.options ?? {}, conflictResolutions: args.conflictResolutions ?? [], hashProvider });
  const diagnostics = [...mapped.diagnostics];
  const preview = previewExternalMapping({ sourceName: args.sourceName, detectedFormat: args.detectedFormat, document: args.document, profile: args.profile, diagnostics, unmappedFields: mapped.unmappedFields });
  if (diagnostics.some((x) => x.severity === "error")) return { ok: false, baseline: mapped.baseline, preview, diagnostics };
  const projected = await projectEnterpriseBaselineToScenario({ baseline: mapped.baseline });
  if (!projected.ok) return { ok: false, baseline: mapped.baseline, preview, diagnostics: [...diagnostics, ...projected.report.diagnostics.map((x) => ({ code: x.code, severity: x.severity, message: x.message }))] };
  return { ok: true, source: projected.source, baseline: mapped.baseline, preview, diagnostics };
}

export async function computeExternalMappingProfileHash(profile: EnterpriseMappingProfile, hashProvider: EnterpriseImportHashProvider = webCryptoImportHashProvider): Promise<string> { return computeMappingProfileHash(profile, hashProvider); }
