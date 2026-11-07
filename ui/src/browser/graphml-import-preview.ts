import { previewGraphmlReadOnly, type GraphmlReadOnlyPreview } from "../../../enterprise-import/src/graphml-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const MAX_GRAPHML_BYTES = 2 * 1024 * 1024;

/** Minimal file interface, keeping the browser boundary independent of DOM types. */
export interface GraphmlReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface GraphmlFilePreview {
  readonly filename: string;
  readonly preview: GraphmlReadOnlyPreview;
}

/**
 * Preview only: never creates a YadiLab scenario, cable, route, active
 * workspace or Engine evaluation. Validation of GraphML structural bytes
 * remains the responsibility of previewGraphmlReadOnly.
 */
export async function previewGraphmlFileReadOnly(file: GraphmlReadableFile): Promise<GraphmlFilePreview> {
  if (!file || typeof file.name !== "string" ||
      !/^[^/\\\0]+\.graphml$/i.test(file.name)) {
    throw new EnterpriseImportError("GRAPHML_FILE_EXTENSION_INVALID", "Choose one .graphml file; no alternate XML profiles are assumed.");
  }
  if (file.size !== undefined && (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_GRAPHML_BYTES)) {
    throw new EnterpriseImportError("GRAPHML_FILE_SIZE_INVALID", "GraphML file must be nonempty and at most 2 MiB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GRAPHML_BYTES) {
    throw new EnterpriseImportError("GRAPHML_FILE_SIZE_INVALID", "GraphML file must be nonempty and at most 2 MiB.");
  }
  return { filename: file.name, preview: await previewGraphmlReadOnly(bytes) };
}

/**
 * IC-030 P1 activation barrier. The same immutable-looking File handle is
 * actually re-read; an original may change between preview and confirmation.
 * Reparse and compare ALL structural fields (including source locators and
 * directed edges), not just the filename/declared byte count.
 */
export async function verifyGraphmlOriginalForReviewedActivation(
  original: GraphmlReadableFile,
  expected: GraphmlReadOnlyPreview,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) {
    throw new EnterpriseImportError("IC030_P1_STALE", "The reviewed GraphML selection is no longer current.");
  }
  if (!expected || expected.profileId !== "graphml.structural.v1" ||
      expected.status !== "REVIEW_REQUIRED" || expected.canActivate !== false ||
      !/^[0-9a-f]{64}$/.test(expected.sourceSha256)) {
    throw new EnterpriseImportError("IC030_P1_SOURCE_CHANGED", "The reviewed GraphML source identity is invalid.");
  }
  // The existing bounded preview bridge validates extension, declared size,
  // actual bytes and the safe no-DTD GraphML grammar on every fresh read.
  const current = await previewGraphmlFileReadOnly(original);
  if (!isCurrent()) {
    throw new EnterpriseImportError("IC030_P1_STALE", "The reviewed GraphML selection changed during revalidation.");
  }
  if (JSON.stringify(current.preview) !== JSON.stringify(expected)) {
    throw new EnterpriseImportError("IC030_P1_SOURCE_CHANGED", "Original GraphML bytes or structural evidence changed after review.");
  }
}
