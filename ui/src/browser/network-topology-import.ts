import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument, selectEnterpriseImportAdapter } from "../../../enterprise-import/src/index.js";
import type { ImportDiagnostic } from "../../../enterprise-import/src/types.js";
import type { NetworkLinkSourceDecision, NetworkLinkSourceConflict } from "../../../enterprise-import/src/network-inventory.js";
import { webCryptoImportHashProvider } from "../../../enterprise-import/src/hash.js";
import { readEnterpriseImportFile, type BinaryReadableFile } from "./import-helper.js";

export interface NetworkTopologyImportPreview {
  readonly ok: boolean;
  readonly source?: ScenarioSource;
  readonly filename: string;
  readonly sourceSha256: string;
  readonly sourceByteSize: number;
  readonly unmappedColumnCount: number;
  readonly linkSourceConflict?: NetworkLinkSourceConflict;
  readonly linkSourceChoice?: NetworkLinkSourceDecision;
  readonly sheets: readonly string[];
  readonly devices: number;
  readonly links: number;
  readonly diagnostics: readonly ImportDiagnostic[];
}

const MAX_QUICK_SOURCE_BYTES = 16 * 1024 * 1024;
const ORIGINAL_SHA256 = /^[a-f0-9]{64}$/;
function fail(code: "IC020_P1_SOURCE_CHANGED" | "IC020_P1_STALE"): never {
  throw Object.assign(new Error(code), { code });
}

export async function previewNetworkTopologyFile(
  file: BinaryReadableFile,
  options: Readonly<{ linkSourceChoice?: NetworkLinkSourceDecision }> = {},
): Promise<NetworkTopologyImportPreview> {
  if (!file || typeof file.name !== "string" || file.name.length < 1 ||
      file.name.length > 240 || /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
      file.name.trim() !== file.name || !/\.(json|csv|tsv|xlsx|ods)$/i.test(file.name)) {
    throw new Error("IC020_P1_FILE_INVALID");
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_QUICK_SOURCE_BYTES)) {
    throw new Error("IC020_P1_SOURCE_SIZE_INVALID");
  }
  const input = await readEnterpriseImportFile(file);
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_QUICK_SOURCE_BYTES ||
      (file.size !== undefined && file.size !== input.bytes.byteLength)) {
    throw new Error("IC020_P1_SOURCE_SIZE_INVALID");
  }
  const sourceSha256 = await webCryptoImportHashProvider.sha256Bytes(input.bytes);
  const adapter = selectEnterpriseImportAdapter(input.mediaType);
  const parsed = await adapter.parse(input, { options: { tableName: "Devices" } });
  const normalized = normalizeNetworkInventoryDocument(parsed.document, options);
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  const diagnostics = [...parsed.diagnostics, ...normalized.diagnostics, ...mapped.diagnostics];
  const ok = mapped.ok && !diagnostics.some((x) => x.severity === "error") && Boolean(mapped.source);
  return { ok, ...(ok && mapped.source ? { source: mapped.source } : {}), filename: file.name,
    sourceSha256, sourceByteSize: input.bytes.byteLength,
    unmappedColumnCount: normalized.unmappedColumnCount,
    ...(normalized.linkSourceConflict ? { linkSourceConflict: normalized.linkSourceConflict } : {}),
    ...(normalized.linkSourceChoice ? { linkSourceChoice: normalized.linkSourceChoice } : {}),
    sheets: parsed.document.tables.map((x) => x.tableId), devices: mapped.source?.resources.length ?? normalized.document.tables.find((t) => t.tableId === "Nodes")?.records.length ?? 0,
    links: mapped.source?.connections.length ?? normalized.document.tables.find((t) => t.tableId === "Links")?.records.length ?? 0,
    diagnostics };
}


/**
 * IC-020 P1. Re-parse the same local original AFTER manual review and before
 * replacing any active Builder/Runtime workspace. A file name/mtime or cached
 * mapped ScenarioSource is not sufficient proof of unchanged source bytes.
 * The current() guard is supplied by the modal and covers file epoch plus
 * current Builder/Runtime workspace identity; failure is fail-closed.
 */
export async function verifyNetworkTopologyOriginalForActivation(
  file: BinaryReadableFile,
  expected: NetworkTopologyImportPreview,
  current: () => boolean,
): Promise<void> {
  if (!current()) fail("IC020_P1_STALE");
  if (!expected?.ok || !expected.source || !ORIGINAL_SHA256.test(expected.sourceSha256) ||
      !Number.isSafeInteger(expected.sourceByteSize) || expected.sourceByteSize < 1 ||
      expected.sourceByteSize > MAX_QUICK_SOURCE_BYTES || expected.filename !== file.name) {
    fail("IC020_P1_SOURCE_CHANGED");
  }
  let latest: NetworkTopologyImportPreview;
  try {
    latest = await previewNetworkTopologyFile(file, expected.linkSourceChoice
      ? { linkSourceChoice: expected.linkSourceChoice } : {});
  } catch {
    // Do not expose raw source/ZIP/parser errors after consented review.
    fail("IC020_P1_SOURCE_CHANGED");
  }
  if (!current()) fail("IC020_P1_STALE");
  if (!latest.ok || !latest.source ||
      latest.filename !== expected.filename ||
      latest.sourceSha256 !== expected.sourceSha256 ||
      latest.sourceByteSize !== expected.sourceByteSize ||
      latest.unmappedColumnCount !== expected.unmappedColumnCount ||
      latest.linkSourceChoice !== expected.linkSourceChoice ||
      JSON.stringify(latest.linkSourceConflict) !== JSON.stringify(expected.linkSourceConflict) ||
      latest.devices !== expected.devices || latest.links !== expected.links ||
      JSON.stringify(latest.source) !== JSON.stringify(expected.source) ||
      JSON.stringify(latest.diagnostics) !== JSON.stringify(expected.diagnostics)) {
    fail("IC020_P1_SOURCE_CHANGED");
  }
}
