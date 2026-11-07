import { previewAnsibleIniFileReadOnly, type AnsibleIniReadableFile } from "./ansible-ini-file-preview.js";
import { reviewAnsibleIniInventoryAssociations,
  type AnsibleIniAssociationDecision, type AnsibleIniAssociationSidecar,
  type AnsibleIniBuilderSnapshot } from "../../../enterprise-import/src/ansible-ini-association-review.js";
import type { AnsibleIniPreview } from "../../../enterprise-import/src/ansible-ini-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const HEX=/^[a-f0-9]{64}$/;
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/**
 * A reviewed P3 sidecar is produced ONLY from the actual current original INI.
 * Re-run production strict P1/P2 parsing, compare full preview and live Builder
 * across async boundary. All errors are fixed safe codes, not private input.
 */
export async function reviewAnsibleIniOriginalFileAssociations(
  original:AnsibleIniReadableFile,
  expected:AnsibleIniPreview,
  getCurrentModel:()=>AnsibleIniBuilderSnapshot|null,
  decision:AnsibleIniAssociationDecision,
  isCurrent:()=>boolean,
):Promise<AnsibleIniAssociationSidecar>{
  if(!expected||expected.profileId!=="ansible.inventory.static.ini.v1"||
     expected.status!=="REVIEW_REQUIRED"||expected.canActivate!==false||
     expected.semanticTrack!=="CONFIG_DOCUMENTED"||!HEX.test(expected.sourceSha256)||
     !Array.isArray(expected.hosts)||!Array.isArray(expected.groupNames)||
     !expected.groupChildren||typeof expected.groupChildren!=="object"||
     !Array.isArray(expected.diagnostics))
    return deny("ANSIBLE_INI_P4_SOURCE_INVALID");
  if(!decision||decision.acknowledgeNotVerified!==true)
    return deny("ANSIBLE_INI_P4_ACK_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    return deny("ANSIBLE_INI_P4_STALE");
  if(typeof getCurrentModel!=="function")
    return deny("ANSIBLE_INI_P4_BUILDER_REQUIRED");
  const before=getCurrentModel();
  if(!before)return deny("ANSIBLE_INI_P4_BUILDER_REQUIRED");
  const parsed=(await previewAnsibleIniFileReadOnly(original).catch(
    ()=>deny("ANSIBLE_INI_P4_SOURCE_BLOCKED"))).preview;
  if(!isCurrent())return deny("ANSIBLE_INI_P4_STALE");
  if(parsed.sourceSha256!==expected.sourceSha256||
     JSON.stringify(parsed)!==JSON.stringify(expected))
    return deny("ANSIBLE_INI_P4_SOURCE_CHANGED");
  const after=getCurrentModel();
  if(!after||JSON.stringify(before)!==JSON.stringify(after))
    return deny("ANSIBLE_INI_P4_STALE");
  const reviewed=reviewAnsibleIniInventoryAssociations(parsed,after,decision);
  if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar)
    return deny(reviewed.diagnostics[0]?.code??"ANSIBLE_INI_P4_BLOCKED");
  if(!isCurrent())return deny("ANSIBLE_INI_P4_STALE");
  const last=getCurrentModel();
  if(!last||JSON.stringify(after)!==JSON.stringify(last))
    return deny("ANSIBLE_INI_P4_STALE");
  return reviewed.sidecar;
}
