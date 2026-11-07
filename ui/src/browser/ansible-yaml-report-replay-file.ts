import { previewAnsibleYamlFileReadOnly, type AnsibleYamlReadableFile } from "./ansible-yaml-file-preview.js";
import { replayAnsibleYamlSavedReferences,
  type AnsibleYamlReplayMatch } from "../../../enterprise-import/src/ansible-yaml-report-replay.js";
import type { AnsibleBuilderSnapshot } from "../../../enterprise-import/src/ansible-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface AnsibleYamlReplayReadableFile extends AnsibleYamlReadableFile {}
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

async function read(file:AnsibleYamlReplayReadableFile,extension:"json"|"yaml",limit:number):Promise<Uint8Array>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+$/.test(file.name)||
     !(extension==="yaml"?/\.(?:yaml|yml)$/i:/\.json$/i).test(file.name)||
     typeof file.arrayBuffer!=="function")deny("ANSIBLE_YAML_REPLAY_FILE_INVALID");
  if(file.size!==undefined&&
     (!Number.isSafeInteger(file.size)||file.size<2||file.size>limit))
    deny("ANSIBLE_YAML_REPLAY_FILE_SIZE_INVALID");
  let buffer:ArrayBuffer;
  try {buffer=await file.arrayBuffer();}
  catch { return deny("ANSIBLE_YAML_REPLAY_FILE_INVALID"); }
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<2||
     buffer.byteLength>limit)deny("ANSIBLE_YAML_REPLAY_FILE_SIZE_INVALID");
  return new Uint8Array(buffer);
}
/**
 * Two explicit local files; re-read original, re-parse through P1/P2 and
 * compare entire model snapshots across async boundaries. No file persistence.
 */
export async function replayAnsibleYamlSavedReportFiles(
  original:AnsibleYamlReplayReadableFile,report:AnsibleYamlReplayReadableFile,
  getModel:()=>AnsibleBuilderSnapshot|null,acknowledged:boolean,
  isCurrent:()=>boolean,
):Promise<AnsibleYamlReplayMatch>{
  if(acknowledged!==true)deny("ANSIBLE_YAML_REPLAY_CONSENT_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    deny("ANSIBLE_YAML_REPLAY_STALE");
  if(typeof getModel!=="function")deny("ANSIBLE_YAML_REPLAY_BUILDER_REQUIRED");
  const first=getModel();
  if(!first)deny("ANSIBLE_YAML_REPLAY_BUILDER_REQUIRED");
  const baseline=JSON.stringify(first);
  const source=await read(original,"yaml",256*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_YAML_REPLAY_STALE");
  // Enforce the P2 filename, parser and redaction boundary on original source.
  const actual=await previewAnsibleYamlFileReadOnly({
    name:original.name,size:source.byteLength,async arrayBuffer(){
      const copy=new ArrayBuffer(source.byteLength);
      new Uint8Array(copy).set(source);
      return copy;
    },
  }).catch(()=>deny("ANSIBLE_YAML_REPLAY_SOURCE_BLOCKED"));
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_YAML_REPLAY_STALE");
  const saved=await read(report,"json",256*1024);
  if(!isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_YAML_REPLAY_STALE");
  const matched=await replayAnsibleYamlSavedReferences(source,saved,getModel(),true);
  if(matched.sourceSha256!==actual.preview.sourceSha256||
     !isCurrent()||JSON.stringify(getModel())!==baseline)
    deny("ANSIBLE_YAML_REPLAY_STALE");
  return matched;
}
