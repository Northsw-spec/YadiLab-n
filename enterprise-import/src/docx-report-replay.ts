import { previewDocxTableStructure } from "./docx-tables-structural-preview.js";
import { discloseReviewedDocxCell, type DocxDisclosedCell } from "./docx-cell-disclosure.js";
import { reviewDocxCellAssociation, DOCX_REVIEWED_ASSOCIATION_FORMAT,
  type DocxBuilderSnapshot, type DocxReviewedAssociationSidecar } from "./docx-association-review.js";
import { reviewDocxMultiReferences, DOCX_MULTI_REFERENCE_FORMAT } from "./docx-multi-reference-review.js";
import { EnterpriseImportError } from "./types.js";

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_DOCX_BYTES = 16 * 1024 * 1024;
const HEX = /^[0-9a-f]{64}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function deny(code: string): never { throw new EnterpriseImportError(code, code); }

/** Reject pathological untrusted JSON before canonical structural comparison. */
function canonical(value: unknown, depth = 0, tally = { nodes: 0 }): string {
  tally.nodes++;
  if (depth > 14 || tally.nodes > 1500) deny("DOCX_REPLAY_REPORT_INVALID");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) deny("DOCX_REPLAY_REPORT_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 20) deny("DOCX_REPLAY_REPORT_INVALID");
    return "[" + value.map(v => canonical(v, depth + 1, tally)).join(",") + "]";
  }
  if (record(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length > 25) deny("DOCX_REPLAY_REPORT_INVALID");
    return "{" + keys.map(key => JSON.stringify(key) + ":" +
      canonical(value[key], depth + 1, tally)).join(",") + "}";
  }
  return deny("DOCX_REPLAY_REPORT_INVALID");
}
function parsedReport(bytes: Uint8Array): Record<string, unknown> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
      bytes.byteLength > MAX_REPORT_BYTES) deny("DOCX_REPLAY_REPORT_SIZE_INVALID");
  let raw: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    raw = JSON.parse(text) as unknown;
  } catch {
    deny("DOCX_REPLAY_REPORT_INVALID");
  }
  if (!record(raw)) deny("DOCX_REPLAY_REPORT_INVALID");
  canonical(raw); // enforce max depth / nodes, no strange JSON types
  return raw;
}
function shaOf(report: Record<string, unknown>): string {
  if (!record(report.source) || typeof report.source.sha256 !== "string" ||
      !HEX.test(report.source.sha256)) deny("DOCX_REPLAY_REPORT_INVALID");
  return report.source.sha256;
}
function builderTarget(report: Record<string, unknown>): { scenarioId: string; sourceRevision: number } {
  if (!record(report.targetModel) ||
      typeof report.targetModel.scenarioId !== "string" ||
      !Number.isSafeInteger(report.targetModel.sourceRevision)) deny("DOCX_REPLAY_REPORT_INVALID");
  return { scenarioId: report.targetModel.scenarioId,
    sourceRevision: report.targetModel.sourceRevision as number };
}
function typedLocator(raw: unknown): {
  kind: "docx-table-cell"; part: "word/document.xml"; sourceSha256: string;
  tableOrdinal: number; rowOrdinal: number; cellOrdinal: number;
} {
  if (!record(raw) || raw.kind !== "docx-table-cell" || raw.part !== "word/document.xml" ||
      !HEX.test(String(raw.sourceSha256)) ||
      ![raw.tableOrdinal,raw.rowOrdinal,raw.cellOrdinal].every(n =>
        Number.isSafeInteger(n) && typeof n === "number" && n >= 0)) {
    deny("DOCX_REPLAY_LOCATOR_INVALID");
  }
  return {
    kind: "docx-table-cell", part: "word/document.xml",
    sourceSha256: raw.sourceSha256 as string,
    tableOrdinal: raw.tableOrdinal as number, rowOrdinal:raw.rowOrdinal as number,
    cellOrdinal:raw.cellOrdinal as number,
  };
}
async function replayCell(source: Uint8Array, sha: string, loc: unknown): Promise<DocxDisclosedCell> {
  const locator = typedLocator(loc);
  try {
    return await discloseReviewedDocxCell(source, sha, locator, true);
  } catch {
    deny("DOCX_REPLAY_SOURCE_BLOCKED");
  }
}
function p4Sidecar(cell: DocxDisclosedCell, model: DocxBuilderSnapshot,
  target: unknown, report: Record<string, unknown>): DocxReviewedAssociationSidecar {
  const targetModel=builderTarget(report);
  const result=reviewDocxCellAssociation(cell,model,{
    sourceSha256:cell.sourceSha256,
    scenarioId:targetModel.scenarioId,sourceRevision:targetModel.sourceRevision,
    targetResourceId:typeof target==="string" ? target : "",
    acknowledgeNotVerified:true,
  });
  if (result.status!=="READY_FOR_EXPORT" || !result.sidecar) deny("DOCX_REPLAY_MODEL_MISMATCH");
  return result.sidecar;
}

export interface DocxReferenceReplayResult {
  readonly status: "REFERENCE_REPLAY_MATCH";
  readonly sourceSha256: string;
  readonly reportFormat: typeof DOCX_REVIEWED_ASSOCIATION_FORMAT | typeof DOCX_MULTI_REFERENCE_FORMAT;
  readonly referencesChecked: number;
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly identityVerified: false;
  readonly physicalTopologyVerified: false;
  readonly engineVerified: false;
  readonly modelMutated: false;
}

/**
 * Verify one uploaded P4/P5 report against the full ORIGINAL .docx and CURRENT
 * Builder identity. Never return, export, log or cache any cell content.
 */
export async function replayReviewedDocxReferences(
  docxBytes: Uint8Array, reportBytes: Uint8Array,
  model: DocxBuilderSnapshot | null, operatorAcknowledged: boolean,
): Promise<DocxReferenceReplayResult> {
  if (operatorAcknowledged !== true) deny("DOCX_REPLAY_CONSENT_REQUIRED");
  if (!model) deny("DOCX_REPLAY_BUILDER_REQUIRED");
  if (!(docxBytes instanceof Uint8Array) || docxBytes.byteLength < 4 ||
      docxBytes.byteLength > MAX_DOCX_BYTES) deny("DOCX_REPLAY_DOCX_SIZE_INVALID");

  const report=parsedReport(reportBytes);
  const type=report.formatId;
  if (type !== DOCX_REVIEWED_ASSOCIATION_FORMAT &&
      type !== DOCX_MULTI_REFERENCE_FORMAT) deny("DOCX_REPLAY_FORMAT_UNSUPPORTED");
  const sha=shaOf(report);
  builderTarget(report);
  let preview;
  try { preview=await previewDocxTableStructure(docxBytes); }
  catch { deny("DOCX_REPLAY_SOURCE_BLOCKED"); }
  if (preview.sourceSha256 !== sha) deny("DOCX_REPLAY_SOURCE_CHANGED");

  let expected: unknown;
  let count: number;
  if (type===DOCX_REVIEWED_ASSOCIATION_FORMAT) {
    if (!record(report.source) || !record(report.association)) deny("DOCX_REPLAY_REPORT_INVALID");
    const cell=await replayCell(docxBytes,sha,report.source.cellLocator);
    expected=p4Sidecar(cell,model,report.association.targetResourceId,report);
    count=1;
  } else {
    if (!Array.isArray(report.references) ||
        report.references.length < 2 || report.references.length > 10) {
      deny("DOCX_REPLAY_COUNT_INVALID");
    }
    const staged: DocxReviewedAssociationSidecar[]=[];
    const modelId=builderTarget(report);
    for (const ref of report.references) {
      if (!record(ref)) deny("DOCX_REPLAY_REPORT_INVALID");
      const cell=await replayCell(docxBytes,sha,ref.cellLocator);
      staged.push(p4Sidecar(cell,model,ref.targetResourceId,report));
    }
    const reviewed=reviewDocxMultiReferences(staged,model,{
      sourceSha256:sha,scenarioId:modelId.scenarioId,
      sourceRevision:modelId.sourceRevision,acknowledgeNotVerified:true,
    });
    if (reviewed.status!=="READY_FOR_EXPORT" || !reviewed.sidecar) {
      deny("DOCX_REPLAY_REPORT_MISMATCH");
    }
    expected=reviewed.sidecar;
    count=staged.length;
  }
  if (canonical(report)!==canonical(expected)) deny("DOCX_REPLAY_REPORT_MISMATCH");
  return Object.freeze({
    status:"REFERENCE_REPLAY_MATCH",sourceSha256:sha,
    reportFormat:type,referencesChecked:count,
    semanticTrack:"CONFIG_DOCUMENTED",
    identityVerified:false,physicalTopologyVerified:false,
    engineVerified:false,modelMutated:false,
  });
}
