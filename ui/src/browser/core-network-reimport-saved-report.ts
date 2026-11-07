import type { CoreReimportReview, CoreReimportObjectCounts } from "./core-network-reimport-review.js";

export interface CoreReimportSavedReport {
  readonly formatId: "yadilab.core-network-reimport-review.v1";
  readonly schemaVersion: 1;
  readonly status: "REVIEW_ONLY";
  readonly kind: "LIVE_WORKSPACE_VS_INCOMING_ORIGINAL";
  readonly currentWorkspaceSourceSha256: string;
  readonly incomingOriginalSourceSha256: string;
  readonly incomingOriginalByteSize: number;
  readonly currentWorkspaceMode: "builder" | "runtime";
  readonly currentWorkspaceRevision: number;
  readonly sourceLinkChoice?: "LINKS_SHEET" | "INLINE_CONNECTED_TO";
  readonly resources: CoreReimportObjectCounts;
  readonly connections: CoreReimportObjectCounts;
  readonly canActivate: false;
  readonly physicalTopologyVerified: false;
  readonly engineVerified: false;
}
type Readable = {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};
const FORMAT = "yadilab.core-network-reimport-review.v1";
const SHA = /^[a-f0-9]{64}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}\.json$/;
const MAX_REPORT_BYTES = 16 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const FIELDS = Object.freeze([
  "formatId","schemaVersion","status","kind",
  "currentWorkspaceSourceSha256","incomingOriginalSourceSha256",
  "incomingOriginalByteSize","currentWorkspaceMode","currentWorkspaceRevision",
  "resources","connections","canActivate","physicalTopologyVerified","engineVerified",
]);
const COUNT_FIELDS = Object.freeze(["added","removed","changed","unchanged"]);
function invalid():never {
  throw Object.assign(new Error("IC020_P2C1_SIDECAR_INVALID"),{
    code:"IC020_P2C1_SIDECAR_INVALID",
  });
}
function mismatch():never {
  throw Object.assign(new Error("IC020_P2C1_REPLAY_MISMATCH"),{
    code:"IC020_P2C1_REPLAY_MISMATCH",
  });
}
function plain(value:unknown):value is Record<string,unknown>{
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype || proto===null;
}
function keys(value:Record<string,unknown>,required:readonly string[]):boolean {
  return Reflect.ownKeys(value).length===required.length &&
    required.every(k=>Object.hasOwn(value,k));
}
function safeInteger(n:unknown,max:number):n is number{
  return typeof n==="number" && Number.isSafeInteger(n) && n>=0 && n<=max;
}
function counts(input:unknown):CoreReimportObjectCounts{
  if(!plain(input) || !keys(input,COUNT_FIELDS))invalid();
  const {added,removed,changed,unchanged}=input;
  if(!safeInteger(added,4096)||!safeInteger(removed,4096)||
     !safeInteger(changed,4096)||!safeInteger(unchanged,4096)||
     added+changed+unchanged>4096 || removed+changed+unchanged>4096)invalid();
  return Object.freeze({added,removed,changed,unchanged});
}
/**
 * No row values, labels, names, IPs, file names, paths, private source content
 * or previous-original-byte claims ever enter this portable report.
 * All types and fields are checked again even if called with forged JS data.
 */
function validate(input:unknown):CoreReimportSavedReport{
  if(!plain(input))invalid();
  const link=Object.hasOwn(input,"sourceLinkChoice");
  const expected=link?[...FIELDS,"sourceLinkChoice"]:FIELDS;
  if(!keys(input,expected))invalid();
  if(input.formatId!==FORMAT || input.schemaVersion!==1 ||
     input.status!=="REVIEW_ONLY" || input.kind!=="LIVE_WORKSPACE_VS_INCOMING_ORIGINAL" ||
     input.canActivate!==false || input.physicalTopologyVerified!==false ||
     input.engineVerified!==false ||
     typeof input.currentWorkspaceSourceSha256!=="string" ||
     !SHA.test(input.currentWorkspaceSourceSha256) ||
     typeof input.incomingOriginalSourceSha256!=="string" ||
     !SHA.test(input.incomingOriginalSourceSha256) ||
     !safeInteger(input.incomingOriginalByteSize,MAX_SOURCE_BYTES) ||
     input.incomingOriginalByteSize===0 ||
     (input.currentWorkspaceMode!=="builder" && input.currentWorkspaceMode!=="runtime") ||
     !safeInteger(input.currentWorkspaceRevision,1000000000) ||
     (link && input.sourceLinkChoice!=="LINKS_SHEET" &&
       input.sourceLinkChoice!=="INLINE_CONNECTED_TO"))invalid();
  const resources=counts(input.resources),connections=counts(input.connections);
  return Object.freeze({
    formatId:FORMAT,
    schemaVersion:1,
    status:"REVIEW_ONLY",
    kind:"LIVE_WORKSPACE_VS_INCOMING_ORIGINAL",
    currentWorkspaceSourceSha256:input.currentWorkspaceSourceSha256,
    incomingOriginalSourceSha256:input.incomingOriginalSourceSha256,
    incomingOriginalByteSize:input.incomingOriginalByteSize,
    currentWorkspaceMode:input.currentWorkspaceMode,
    currentWorkspaceRevision:input.currentWorkspaceRevision,
    ...(link?{sourceLinkChoice:input.sourceLinkChoice as "LINKS_SHEET"|"INLINE_CONNECTED_TO"}:{}),
    resources,connections,
    canActivate:false,
    physicalTopologyVerified:false,
    engineVerified:false,
  });
}
export function createSavedCoreReimportReport(report:CoreReimportReview):CoreReimportSavedReport{
  if(!report || report.status!=="REVIEW_REQUIRED" ||
     report.kind!=="LIVE_WORKSPACE_VS_INCOMING_ORIGINAL" ||
     report.canAutoApply!==false || report.engineVerified!==false ||
     report.physicalTopologyVerified!==false)invalid();
  // This projection is intentionally exhaustive: no unreviewed fields copied.
  return validate({
    formatId:FORMAT,schemaVersion:1,status:"REVIEW_ONLY",
    kind:"LIVE_WORKSPACE_VS_INCOMING_ORIGINAL",
    currentWorkspaceSourceSha256:report.currentWorkspaceSourceSha256,
    incomingOriginalSourceSha256:report.incomingOriginalSourceSha256,
    incomingOriginalByteSize:report.incomingOriginalByteSize,
    currentWorkspaceMode:report.currentWorkspaceMode,
    currentWorkspaceRevision:report.currentWorkspaceRevision,
    ...(report.sourceLinkChoice?{sourceLinkChoice:report.sourceLinkChoice}:{}),
    resources:report.resources,connections:report.connections,
    canActivate:false,physicalTopologyVerified:false,engineVerified:false,
  });
}
/** Recheck saved object again at the final comparison boundary. */
export function matchSavedCoreReimportReport(
  saved:unknown,current:CoreReimportReview
):CoreReimportSavedReport{
  // Any invalid imported record must produce the same fixed safe rejection.
  const checked=validate(saved);
  const expected=createSavedCoreReimportReport(current);
  if(JSON.stringify(checked)!==JSON.stringify(expected))mismatch();
  return checked;
}
export function savedCoreReimportReportText(report:CoreReimportReview):string{
  const text=JSON.stringify(createSavedCoreReimportReport(report),null,2)+"\n";
  if(new TextEncoder().encode(text).byteLength>MAX_REPORT_BYTES)invalid();
  return text;
}
export async function readSavedCoreReimportReport(
  file:Readable, isCurrent:()=>boolean
):Promise<CoreReimportSavedReport>{
  if(!file || typeof file.name!=="string" || !NAME.test(file.name) ||
     (file.size!==undefined && (!safeInteger(file.size,MAX_REPORT_BYTES)||file.size===0)))
    invalid();
  if(!isCurrent())mismatch();
  let data:ArrayBuffer;
  try{data=await file.arrayBuffer();}catch{invalid();}
  if(!isCurrent())mismatch();
  if(data.byteLength===0 || data.byteLength>MAX_REPORT_BYTES ||
     (file.size!==undefined && data.byteLength!==file.size))invalid();
  let parsed:unknown;
  try{
    parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(new Uint8Array(data)));
  }catch{invalid();}
  if(!isCurrent())mismatch();
  return validate(parsed);
}
