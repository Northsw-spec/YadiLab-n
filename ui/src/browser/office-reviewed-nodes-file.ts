import { previewDocxTableStructure } from "../../../enterprise-import/src/docx-tables-structural-preview.js";
import { previewOdtTableStructure } from "../../../enterprise-import/src/odt-tables-structural-preview.js";
import { mapReviewedOfficeOriginalToNodes, type OfficeReviewedNodesDecision,
  type OfficeReviewedNodesCandidate } from "../../../enterprise-import/src/office-reviewed-node-candidate.js";
import { mapReviewedOfficeOriginalToConnections, type OfficeReviewedConnectionsDecision,
  type OfficeReviewedConnectionsCandidate } from "../../../enterprise-import/src/office-reviewed-connection-candidate.js";
import { mapReviewedOfficeOriginalToPorts, type OfficeReviewedPortsDecision,
  type OfficeReviewedPortsCandidate } from "../../../enterprise-import/src/office-reviewed-port-candidate.js";
import { mapReviewedOfficeOriginalToLinkRows, type OfficeReviewedLinkRowsDecision,
  type OfficeReviewedLinkRowsCandidate } from "../../../enterprise-import/src/office-reviewed-link-row-candidate.js";
import { mapReviewedOfficeOriginalToSixByFive, type OfficeReviewedSixByFiveDecision,
  type OfficeReviewedSixByFiveCandidate } from "../../../enterprise-import/src/office-reviewed-six-by-five-candidate.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface OfficeReviewedReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type OfficeFormat = "docx" | "odt";
export interface OfficeReviewedPreview {
  readonly format: OfficeFormat;
  readonly preview: Awaited<ReturnType<typeof previewDocxTableStructure>> |
    Awaited<ReturnType<typeof previewOdtTableStructure>>;
}
const MAX_BYTES = 16 * 1024 * 1024;
const deny = (code: string): never => { throw new EnterpriseImportError(code, code); };
const formatOf = (file: OfficeReviewedReadableFile): OfficeFormat => {
  if (!file || typeof file.name !== "string" || file.name.length > 240 ||
      !/^[^/\\\0]+\.(docx|odt)$/i.test(file.name) ||
      typeof file.arrayBuffer !== "function") return deny("IC040_P1B_FILE_INVALID");
  return /\.docx$/i.test(file.name) ? "docx" : "odt";
};
async function readOriginal(file: OfficeReviewedReadableFile, expected: OfficeFormat): Promise<Uint8Array> {
  if (formatOf(file) !== expected) return deny("IC040_P1B_FILE_INVALID");
  if (file.size !== undefined && (!Number.isSafeInteger(file.size) ||
      file.size < 4 || file.size > MAX_BYTES)) return deny("IC040_P1B_FILE_SIZE_INVALID");
  const result: unknown = await file.arrayBuffer();
  if (!(result instanceof ArrayBuffer) || result.byteLength < 4 ||
      result.byteLength > MAX_BYTES) return deny("IC040_P1B_FILE_SIZE_INVALID");
  return new Uint8Array(result);
}
const structural = async (raw: Uint8Array, format: OfficeFormat) =>
  format === "docx" ? previewDocxTableStructure(raw) : previewOdtTableStructure(raw);

/** One local original read and structural metadata only. No source cell values. */
export async function previewOfficeNodesFile(file: OfficeReviewedReadableFile): Promise<OfficeReviewedPreview> {
  const format = formatOf(file);
  const bytes = await readOriginal(file, format);
  const preview = await structural(bytes, format);
  return { format, preview };
}

/**
 * Both before compilation and after layout, independently read the selected
 * original File again and require full structure/SHA parity. P1a remains the
 * single cell-consent and secret-denial authority.
 */
export async function verifyOfficeCandidateFile(
  file: OfficeReviewedReadableFile,
  expected: OfficeReviewedPreview,
  decision: OfficeReviewedNodesDecision | OfficeReviewedConnectionsDecision | OfficeReviewedPortsDecision | OfficeReviewedLinkRowsDecision | OfficeReviewedSixByFiveDecision,
  isCurrent: () => boolean,
): Promise<OfficeReviewedNodesCandidate | OfficeReviewedConnectionsCandidate | OfficeReviewedPortsCandidate | OfficeReviewedLinkRowsCandidate | OfficeReviewedSixByFiveCandidate> {
  if (typeof isCurrent !== "function" || !isCurrent()) return deny("IC040_P1B_STALE");
  if (!expected || !expected.preview || (expected.format !== "docx" && expected.format !== "odt") ||
      expected.format !== decision?.format ||
      decision.sourceSha256 !== expected.preview.sourceSha256 ||
      expected.preview.status !== "REVIEW_REQUIRED" ||
      expected.preview.canActivate !== false || expected.preview.textIncluded !== false ||
      expected.preview.engineVerified !== false ||
      expected.preview.physicalTopologyVerified !== false) {
    return deny("IC040_P1B_SOURCE_CHANGED");
  }
  const raw = await readOriginal(file, expected.format);
  if (!isCurrent()) return deny("IC040_P1B_STALE");
  const refreshed = await structural(raw, expected.format);
  if (!isCurrent()) return deny("IC040_P1B_STALE");
  if (JSON.stringify(refreshed) !== JSON.stringify(expected.preview)) {
    return deny("IC040_P1B_SOURCE_CHANGED");
  }
  const mapped = "capacityProfile" in decision
    ? await mapReviewedOfficeOriginalToSixByFive(raw, decision)
    : "linkRows" in decision
      ? await mapReviewedOfficeOriginalToLinkRows(raw, decision)
    : "portSelections" in decision
      ? await mapReviewedOfficeOriginalToPorts(raw, decision)
    : "connections" in decision
      ? await mapReviewedOfficeOriginalToConnections(raw, decision)
      : await mapReviewedOfficeOriginalToNodes(raw, decision);
  if (!isCurrent()) return deny("IC040_P1B_STALE");
  if (mapped.status !== "READY_FOR_COMPILATION" || !mapped.source ||
      mapped.canActivate !== false || mapped.engineVerified !== false ||
      mapped.physicalTopologyVerified !== false) {
    return deny(mapped.diagnostics[0]?.code ?? "IC040_P1B_CANDIDATE_BLOCKED");
  }
  return mapped;
}
