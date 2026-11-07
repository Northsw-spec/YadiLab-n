import { previewAnsibleIniFileReadOnly, type AnsibleIniReadableFile } from "./ansible-ini-file-preview.js";
import { replayAnsibleIniSavedReferences,
  type AnsibleIniReplayMatch } from "../../../enterprise-import/src/ansible-ini-report-replay.js";
import type { AnsibleIniBuilderSnapshot } from "../../../enterprise-import/src/ansible-ini-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface AnsibleIniReplayReadableFile extends AnsibleIniReadableFile {}
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

async function read(file:AnsibleIniReplayReadableFile,extension:"json"|"ini",limit:number):Promise<Uint8Array>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+$/.test(file.name)||
     !(extension==="ini"?/\.ini$/i:/\.json$/i).test(file.name)||
     typeof file.arrayBuffer!=="function")deny("ANSIBLE_INI_REPLAY_FILE_INVALID");
  if(file.size!==undefined&&
     (!Number.isSafeInteger(file.size)||file.size<2||file.size>limit))
    deny("ANSIBLE_INI_REPLAY_FILE_SIZE_INVALID");
  let buffer:ArrayBuffer;
  try {buffer=await file.arrayBuffer();}
  catch { return deny("ANSIBLE_INI_REPLAY_FILE_INVALID"); }
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<2||
     buffer.byteLength>limit)deny("ANSIBLE_INI_REPLAY_FILE_SIZE_INVALID");
  return new Uint8Array(buffer);
}
/**
 * Two explicit local files; re-read original, re-parse through P1/P2 and
 * compare entire model snapshots across async boundaries. No file persistence.
 */
export async function replayAnsibleIniSavedReportFiles(
  original:AnsibleIniReplayReadableFile,report:AnsibleIniReplayReadableFile,
  getModel:()=>AnsibleIniBuilderSnapshot|null,acknowledged:boolean,
  isCurrent:()=>boolean,
):Promise<AnsibleIniReplayMatch>{
  if(acknowledged!==true)deny("ANSIBLE_INI_REPLAY_CONSENT_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    deny("ANSIBLE_INI_REPLAY_STALE");
  if(typeof getModel!=="function")deny("ANSIBLE_INI_REPLAY_BUILDER_REQUIRED");
  const first=getModel();
  if(!first)deny("ANSIBLE_INI_REPLAY_BUILDER_REQUIRED");
  const baseline=JSON.stringify(first);
  const source=await read(original,"ini",256*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_INI_REPLAY_STALE");
  // Enforce the P2 filename, parser and redaction boundary on original INI source.
  const actual=await previewAnsibleIniFileReadOnly({
    name:original.name,size:source.byteLength,async arrayBuffer(){
      const copy=new ArrayBuffer(source.byteLength);
      new Uint8Array(copy).set(source);
      return copy;
    },
  }).catch(()=>deny("ANSIBLE_INI_REPLAY_SOURCE_BLOCKED"));
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_INI_REPLAY_STALE");
  const saved=await read(report,"json",256*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_INI_REPLAY_STALE");
  const matched=await replayAnsibleIniSavedReferences(source,saved,getModel(),true);
  if(matched.sourceSha256!==actual.preview.sourceSha256||
     !isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_INI_REPLAY_STALE");
  return matched;
}
