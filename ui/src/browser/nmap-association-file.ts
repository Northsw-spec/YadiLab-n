import { previewNmapXmlFileReadOnly, type NmapXmlReadableFile } from "./nmap-xml-file-preview.js";
import { reviewNmapObservationAssociations, type NmapManualAssociationDecision,
  type NmapModelSnapshot, type NmapAssociationSidecar } from "../../../enterprise-import/src/nmap-association-review.js";
import type { NmapReadOnlyEvidence } from "../../../enterprise-import/src/nmap-xml-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const HEX=/^[0-9a-f]{64}$/;
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/**
 * P4 export gate: no trust in previously rendered scan evidence or Builder.
 * Re-read the selected original XML using the full strict production profile,
 * then check source identity, review-generation epoch and live Builder after
 * the await. This function never downloads, writes Builder or runs a scan.
 */
export async function reviewNmapOriginalFileAssociations(
  original:NmapXmlReadableFile,
  expected:NmapReadOnlyEvidence,
  getCurrentModel:()=>NmapModelSnapshot|null,
  decision:NmapManualAssociationDecision,
  isCurrent:()=>boolean,
):Promise<NmapAssociationSidecar>{
  if(!expected||expected.profileId!=="nmap.xml.observations.v1"||
     expected.status!=="EVIDENCE_ONLY"||expected.canActivate!==false||
     expected.semanticTrack!=="EVIDENCE_OBSERVED"||
     !HEX.test(expected.sourceSha256)||!Array.isArray(expected.hosts)||
     !Number.isSafeInteger(expected.observationsCount)||
     expected.observationsCount<0)
    return deny("NMAP_P4_SOURCE_INVALID");
  if(!decision||decision.acknowledgeNotVerified!==true)
    return deny("NMAP_P4_ACK_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    return deny("NMAP_P4_STALE");
  if(typeof getCurrentModel!=="function")
    return deny("NMAP_P4_BUILDER_REQUIRED");
  const before=getCurrentModel();
  if(!before)return deny("NMAP_P4_BUILDER_REQUIRED");
  const parsed=(await previewNmapXmlFileReadOnly(original).catch(
    ()=>deny("NMAP_P4_SOURCE_BLOCKED"))).preview;
  if(!isCurrent())return deny("NMAP_P4_STALE");
  if(parsed.sourceSha256!==expected.sourceSha256||
     JSON.stringify(parsed)!==JSON.stringify(expected))
    return deny("NMAP_P4_SOURCE_CHANGED");
  const after=getCurrentModel();
  if(!after||JSON.stringify(before)!==JSON.stringify(after))
    return deny("NMAP_P4_STALE");
  const reviewed=reviewNmapObservationAssociations(parsed,after,decision);
  if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar)
    return deny(reviewed.diagnostics[0]?.code??"NMAP_P4_BLOCKED");
  if(!isCurrent())return deny("NMAP_P4_STALE");
  const latest=getCurrentModel();
  if(!latest||JSON.stringify(after)!==JSON.stringify(latest))
    return deny("NMAP_P4_STALE");
  return reviewed.sidecar;
}
