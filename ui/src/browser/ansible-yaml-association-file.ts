import { previewAnsibleYamlFileReadOnly, type AnsibleYamlReadableFile } from "./ansible-yaml-file-preview.js";
import { reviewAnsibleInventoryAssociations,
  type AnsibleAssociationDecision, type AnsibleAssociationSidecar,
  type AnsibleBuilderSnapshot } from "../../../enterprise-import/src/ansible-association-review.js";
import type { AnsibleStaticInventoryPreview } from "../../../enterprise-import/src/ansible-yaml-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const HEX=/^[a-f0-9]{64}$/;
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/**
 * Re-parse original immutable-on-screen YAML through the production P1 file
 * boundary before P3 metadata-only export. Live Builder is checked twice,
 * including labels/IDs; selection generation prevents asynchronous stale saves.
 * No writes, network requests, Ansible execution, or raw YAML in diagnostics.
 */
export async function reviewAnsibleYamlOriginalFileAssociations(
  originalFile:AnsibleYamlReadableFile,
  expected:AnsibleStaticInventoryPreview,
  getCurrentModel:()=>AnsibleBuilderSnapshot|null,
  decision:AnsibleAssociationDecision,
  isCurrent:()=>boolean,
):Promise<AnsibleAssociationSidecar>{
  if(!expected||expected.status!=="REVIEW_REQUIRED"||
     expected.profileId!=="ansible.inventory.static.yaml.v1"||
     expected.semanticTrack!=="CONFIG_DOCUMENTED"||
     expected.canActivate!==false||!HEX.test(expected.sourceSha256)||
     !Array.isArray(expected.hosts)||!Array.isArray(expected.groupPaths)||
     !Array.isArray(expected.diagnostics)){
    deny("ANSIBLE_YAML_ASSOC_SOURCE_INVALID");
  }
  if(!decision||decision.acknowledgeNotVerified!==true)
    deny("ANSIBLE_YAML_ASSOC_ACK_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    deny("ANSIBLE_YAML_ASSOC_STALE");
  if(typeof getCurrentModel!=="function")
    deny("ANSIBLE_YAML_ASSOC_BUILDER_REQUIRED");
  const before=getCurrentModel();
  if(!before)deny("ANSIBLE_YAML_ASSOC_BUILDER_REQUIRED");
  const parsed=(await previewAnsibleYamlFileReadOnly(originalFile).catch(
    ()=>deny("ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED"))).preview;
  if(!isCurrent())deny("ANSIBLE_YAML_ASSOC_STALE");
  if(parsed.sourceSha256!==expected.sourceSha256||
     JSON.stringify(parsed)!==JSON.stringify(expected)){
    deny("ANSIBLE_YAML_ASSOC_SOURCE_CHANGED");
  }
  const after=getCurrentModel();
  if(!after||JSON.stringify(before)!==JSON.stringify(after))
    deny("ANSIBLE_YAML_ASSOC_STALE");
  const reviewed=reviewAnsibleInventoryAssociations(parsed,after,decision);
  if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar)
    return deny(reviewed.diagnostics[0]?.code??"ANSIBLE_YAML_ASSOC_BLOCKED");
  const sidecar=reviewed.sidecar;
  if(!isCurrent())deny("ANSIBLE_YAML_ASSOC_STALE");
  const final=getCurrentModel();
  if(!final||JSON.stringify(after)!==JSON.stringify(final))
    deny("ANSIBLE_YAML_ASSOC_STALE");
  return sidecar;
}
