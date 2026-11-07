import { replayDrawioSavedReferences, type DrawioReplayMatch } from "../../../enterprise-import/src/drawio-report-replay.js";
import type { DrawioBuilderSnapshot } from "../../../enterprise-import/src/drawio-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
export interface DrawioReplayReadableFile {
  readonly name:string;readonly size?:number;arrayBuffer():Promise<ArrayBuffer>;
}
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};
async function read(file:DrawioReplayReadableFile, ext:"drawio"|"json",limit:number):Promise<Uint8Array>{
  if(!file||typeof file.name!=="string"||file.name.length>240||file.name.length<6||
     !/^[^/\\\0]+$/.test(file.name)||!file.name.toLowerCase().endsWith("."+ext)||
     typeof file.arrayBuffer!=="function")deny("DRAWIO_REPLAY_FILE_INVALID");
  if(file.size!==undefined&&(!Number.isSafeInteger(file.size)||file.size<2||file.size>limit))
    deny("DRAWIO_REPLAY_FILE_SIZE_INVALID");
  const data:ArrayBuffer=await file.arrayBuffer().catch(()=>{
    throw new EnterpriseImportError("DRAWIO_REPLAY_FILE_INVALID","DRAWIO_REPLAY_FILE_INVALID");
  });
  if(!(data instanceof ArrayBuffer)||data.byteLength<2||data.byteLength>limit)
    deny("DRAWIO_REPLAY_FILE_SIZE_INVALID");
  return new Uint8Array(data);
}
/** State/race check against real live Builder after each asynchronous file read. */
export async function replayDrawioSavedReportFiles(
  original:DrawioReplayReadableFile,report:DrawioReplayReadableFile,
  getModel:()=>DrawioBuilderSnapshot|null,acknowledged:boolean,
  isCurrent:()=>boolean,
):Promise<DrawioReplayMatch>{
  if(acknowledged!==true)deny("DRAWIO_REPLAY_CONSENT_REQUIRED");
  if(!isCurrent())deny("DRAWIO_REPLAY_STALE");
  const first=getModel();
  if(!first)deny("DRAWIO_REPLAY_BUILDER_REQUIRED");
  const baseline=JSON.stringify(first);
  const source=await read(original,"drawio",2*1024*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)deny("DRAWIO_REPLAY_STALE");
  const saved=await read(report,"json",64*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)deny("DRAWIO_REPLAY_STALE");
  const result=await replayDrawioSavedReferences(source,saved,getModel(),true);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)deny("DRAWIO_REPLAY_STALE");
  return result;
}
