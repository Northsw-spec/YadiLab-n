import type { EnterpriseBaseline, EnterpriseImportReport } from "../../core-model/src/generated/contracts.js";
import { verifyEnterpriseBaseline } from "../../enterprise-model/src/validation.js";
import { selectEnterpriseImportAdapter } from "./adapters.js";
import { computeMappingProfileHash, webCryptoImportHashProvider } from "./hash.js";
import { mapImportDocumentToBaseline } from "./mapping.js";
import type { EnterpriseImportHashProvider, EnterpriseImportRequest, EnterpriseImportResult, ImportDiagnostic } from "./types.js";
import { EnterpriseImportError } from "./types.js";

function normalizeOptions(options: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> { return options ? { ...options } : {}; }

function sourceDescriptor(args: { hash: string; mediaType: string; byteSize: number; displayName?: string }): EnterpriseBaseline["sources"][number] {
  return args.displayName ? { sourceId: `src_${args.hash}`, mediaType: args.mediaType, sha256: args.hash, byteSize: args.byteSize, displayName: args.displayName } : { sourceId: `src_${args.hash}`, mediaType: args.mediaType, sha256: args.hash, byteSize: args.byteSize };
}

export async function runEnterpriseImport(request: EnterpriseImportRequest, hashProvider: EnterpriseImportHashProvider = webCryptoImportHashProvider): Promise<EnterpriseImportResult> {
  const options = normalizeOptions(request.options);
  const sourceHash = await hashProvider.sha256Bytes(request.source.bytes);
  const source = sourceDescriptor({ hash: sourceHash, mediaType: request.source.mediaType, byteSize: request.source.bytes.byteLength, ...(request.source.displayName ? { displayName: request.source.displayName } : {}) });
  const mappingHash = await computeMappingProfileHash(request.mappingProfile, hashProvider);
  let adapter = request.adapter;
  if (!adapter) {
    try { adapter = selectEnterpriseImportAdapter(request.source.mediaType); }
    catch (error) {
      const code = error instanceof EnterpriseImportError ? error.code : "IMPORT_INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      const report: EnterpriseImportReport = {
        formatId: "infrastructure-cyber-lab.enterprise-import-report", schemaVersion: "0.1.0", status: "BLOCKED",
        adapter: { id: "unresolved", version: "0.0.0" }, source, mapping: { profileId: request.mappingProfile.profileId, version: request.mappingProfile.version, sha256: mappingHash },
        stats: { tables: 0, records: 0, entities: 0, facts: 0, unknownFacts: 0, invalidFacts: 0 }, diagnostics: [{ code, severity: "error", message }], unmappedFields: [], conflicts: [],
      };
      return { report };
    }
  }
  const baseReport = {
    formatId: "infrastructure-cyber-lab.enterprise-import-report" as const, schemaVersion: "0.1.0", adapter: { id: adapter.id, version: adapter.version }, source,
    mapping: { profileId: request.mappingProfile.profileId, version: request.mappingProfile.version, sha256: mappingHash },
  };
  try {
    if (!adapter.mediaTypes.some((x) => x.toLowerCase() === request.source.mediaType.split(";",1)[0]!.trim().toLowerCase())) throw new EnterpriseImportError("IMPORT_ADAPTER_MEDIA_TYPE_MISMATCH", `Adapter ${adapter.id} does not claim media type ${request.source.mediaType}.`);
    const parsed = await adapter.parse(request.source, { options });
    const mapped = await mapImportDocumentToBaseline({ baselineId: request.baselineId, source, document: parsed.document, profile: request.mappingProfile, adapter: { id: adapter.id, version: adapter.version }, options, conflictResolutions: request.conflictResolutions ?? [], hashProvider });
    const verification = await verifyEnterpriseBaseline(mapped.baseline, { sha256Utf8: (x) => hashProvider.sha256Utf8(x) });
    const diagnostics: ImportDiagnostic[] = [...parsed.diagnostics, ...mapped.diagnostics, ...verification.diagnostics.map((x) => ({ code: x.code, severity: "error" as const, message: x.message }))];
    const status = diagnostics.some((x) => x.severity === "error") ? "BLOCKED" : "READY";
    const stats = { tables: parsed.document.tables.length, records: parsed.document.tables.reduce((n,t)=>n+t.records.length,0), entities: mapped.baseline.entities.length, facts: mapped.baseline.facts.length, unknownFacts: mapped.baseline.facts.filter((x)=>x.state==="UNKNOWN").length, invalidFacts: mapped.baseline.facts.filter((x)=>x.state==="INVALID").length };
    const report: EnterpriseImportReport = { ...baseReport, status, baselineIdentity: mapped.baseline.baselineIdentity, stats, diagnostics, unmappedFields: mapped.unmappedFields, conflicts: mapped.conflicts };
    return { report, baseline: mapped.baseline, document: parsed.document };
  } catch (error) {
    const code = error instanceof EnterpriseImportError ? error.code : "IMPORT_INTERNAL_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    const report: EnterpriseImportReport = { ...baseReport, status: "BLOCKED", stats: { tables: 0, records: 0, entities: 0, facts: 0, unknownFacts: 0, invalidFacts: 0 }, diagnostics: [{ code, severity: "error", message }], unmappedFields: [], conflicts: [] };
    return { report };
  }
}
