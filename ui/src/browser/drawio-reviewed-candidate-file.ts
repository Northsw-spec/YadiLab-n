import { extractDrawioOrdinalGraph, mapReviewedDrawioOriginalToBuilder,
  type DrawioGraphReviewDecision, type DrawioOrdinalGraph, type DrawioGraphCandidate }
  from "../../../enterprise-import/src/drawio-reviewed-candidate.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
import type { DrawioReadableFile } from "./drawio-file-preview.js";

const MAX_BYTES = 2 * 1024 * 1024;
const deny = (code: string): never => {
  throw new EnterpriseImportError(code, code);
};

/** Local-only original bytes; no rendered labels, file upload, URL or storage. */
export async function readDrawioReviewedOriginalBytes(file: DrawioReadableFile): Promise<Uint8Array> {
  if (!file || typeof file.name !== "string" || file.name.length > 240 ||
      !/^[^/\\\0]+\.drawio$/i.test(file.name) ||
      typeof file.arrayBuffer !== "function") {
    return deny("DRAWIO_FILE_EXTENSION_INVALID");
  }
  if (file.size !== undefined && (!Number.isSafeInteger(file.size) ||
      file.size < 1 || file.size > MAX_BYTES)) {
    return deny("DRAWIO_FILE_SIZE_INVALID");
  }
  const raw = await file.arrayBuffer();
  if (!(raw instanceof ArrayBuffer) || raw.byteLength < 1 ||
      raw.byteLength > MAX_BYTES) return deny("DRAWIO_FILE_SIZE_INVALID");
  return new Uint8Array(raw);
}

/** A single initial File read, with a strictly bounded ordinal-only projection. */
export async function previewDrawioCandidateFile(
  file: DrawioReadableFile,
): Promise<{ readonly graph: DrawioOrdinalGraph; readonly originalBytes: Uint8Array }> {
  const originalBytes = await readDrawioReviewedOriginalBytes(file);
  const graph = await extractDrawioOrdinalGraph(originalBytes);
  return { graph, originalBytes };
}

/**
 * Last-moment *same original File* re-read after canonical compilation/layout.
 * The original and all page/vertex/edge ordinals must still match exactly;
 * a forged count/endpoint or changed same-length XML must never activate.
 */
export async function verifyDrawioOriginalForReviewedActivation(
  original: DrawioReadableFile,
  expected: DrawioOrdinalGraph,
  decision: DrawioGraphReviewDecision,
  isCurrent: () => boolean,
): Promise<DrawioGraphCandidate> {
  if (typeof isCurrent !== "function" || !isCurrent()) {
    return deny("IC030_P2B_STALE");
  }
  const bytes = await readDrawioReviewedOriginalBytes(original);
  if (!isCurrent()) return deny("IC030_P2B_STALE");
  const mapped = await mapReviewedDrawioOriginalToBuilder(bytes, expected, decision);
  if (!isCurrent()) return deny("IC030_P2B_STALE");
  if (mapped.status !== "READY_FOR_COMPILATION" || !mapped.source) {
    return deny(mapped.diagnostics[0]?.code ?? "DRAWIO_CANDIDATE_BLOCKED");
  }
  return mapped;
}
