import { replayReviewedOdtReferences, type OdtReferenceReplayResult } from "../../../enterprise-import/src/odt-report-replay.js";
import type { OdtBuilderSnapshot } from "../../../enterprise-import/src/odt-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface LocalReplayFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
async function readBounded(file: LocalReplayFile, extension: "odt"|"json",
  max: number): Promise<Uint8Array> {
  const name=file?.name;
  const nameOkay=typeof name==="string" && name.length>=6 &&
    name.length<=240 && !/[/\\\0]/.test(name) &&
    name.toLowerCase().endsWith("."+extension);
  if (!nameOkay || typeof file.arrayBuffer!=="function") {
    throw new EnterpriseImportError("ODT_REPLAY_FILE_INVALID","ODT_REPLAY_FILE_INVALID");
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size<2 || file.size>max)) {
    throw new EnterpriseImportError("ODT_REPLAY_FILE_SIZE_INVALID","ODT_REPLAY_FILE_SIZE_INVALID");
  }
  const raw=await file.arrayBuffer();
  if (!(raw instanceof ArrayBuffer) || raw.byteLength<2 || raw.byteLength>max) {
    throw new EnterpriseImportError("ODT_REPLAY_FILE_SIZE_INVALID","ODT_REPLAY_FILE_SIZE_INVALID");
  }
  return new Uint8Array(raw);
}
/** Local only, source/report are independently byte-limited before parsing. */
export async function replaySavedOdtReportFiles(
  odtFile: LocalReplayFile, reportFile: LocalReplayFile,
  model: OdtBuilderSnapshot | null, acknowledged: boolean,
): Promise<OdtReferenceReplayResult> {
  if(acknowledged!==true){
    throw new EnterpriseImportError("ODT_REPLAY_CONSENT_REQUIRED","ODT_REPLAY_CONSENT_REQUIRED");
  }
  if(!model){
    throw new EnterpriseImportError("ODT_REPLAY_BUILDER_REQUIRED","ODT_REPLAY_BUILDER_REQUIRED");
  }
  const odt=await readBounded(odtFile,"odt",16*1024*1024);
  const report=await readBounded(reportFile,"json",64*1024);
  return replayReviewedOdtReferences(odt,report,model,true);
}
