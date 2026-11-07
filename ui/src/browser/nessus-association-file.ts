import { previewNessusFileReadOnly, type NessusReadableFile } from "./nessus-v2-file-preview.js";
import { reviewNessusHostReferences, type NessusHostReviewDecision,
  type NessusBuilderSnapshot, type NessusReviewedHostSidecar } from "../../../enterprise-import/src/nessus-association-review.js";
import type { NessusSeveritySummary } from "../../../enterprise-import/src/nessus-v2-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const HEX=/^[0-9a-f]{64}$/;
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/**
 * P5 export gate: re-read actual selected .nessus using strict production P1,
 * then compare FULL original source summary and live Builder across the await.
 * File selection epoch is invalidated on replace/close/unmount by the panel.
 * No scan, network, Builder mutation or unverified physical/Engine promotion.
 */
export async function reviewNessusOriginalFileAssociations(
  original:NessusReadableFile,
  expected:NessusSeveritySummary,
  getCurrentModel:()=>NessusBuilderSnapshot|null,
  decision:NessusHostReviewDecision,
  isCurrent:()=>boolean,
):Promise<NessusReviewedHostSidecar>{
  if(!expected||expected.profileId!=="nessus.xml.severity-summary.v1"||
     expected.status!=="EVIDENCE_ONLY"||
     expected.semanticTrack!=="EVIDENCE_OBSERVED"||
     expected.canActivate!==false||expected.engineVerified!==false||
     expected.physicalTopologyVerified!==false||
     !HEX.test(expected.sourceSha256)||
     !Number.isSafeInteger(expected.hostCount)||expected.hostCount<0||expected.hostCount>256||
     !Number.isSafeInteger(expected.findingCount)||expected.findingCount<0||
     expected.findingCount>10000||
     !Array.isArray(expected.severityCounts)||expected.severityCounts.length!==5||
     !expected.severityCounts.every(n=>Number.isSafeInteger(n)&&n>=0)||
     expected.severityCounts.reduce((a,b)=>a+b,0)!==expected.findingCount)
    return deny("NESSUS_P5_SOURCE_INVALID");
  if(!decision||decision.acknowledgeNotVerified!==true)
    return deny("NESSUS_ASSOC_ACK_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())
    return deny("NESSUS_P5_STALE");
  if(typeof getCurrentModel!=="function")
    return deny("NESSUS_ASSOC_BUILDER_REQUIRED");
  const before=getCurrentModel();
  if(!before)return deny("NESSUS_ASSOC_BUILDER_REQUIRED");
  const parsed=await previewNessusFileReadOnly(original).catch(
    ()=>deny("NESSUS_P5_SOURCE_BLOCKED"));
  if(!isCurrent())return deny("NESSUS_P5_STALE");
  if(parsed.sourceSha256!==expected.sourceSha256||
     JSON.stringify(parsed)!==JSON.stringify(expected))
    return deny("NESSUS_P5_SOURCE_CHANGED");
  const after=getCurrentModel();
  if(!after||JSON.stringify(before)!==JSON.stringify(after))
    return deny("NESSUS_P5_STALE");
  const reviewed=reviewNessusHostReferences(parsed,after,decision);
  if(reviewed.status!=="READY_FOR_EXPORT")
    return deny(reviewed.diagnostics[0]?.code??"NESSUS_ASSOC_BLOCKED");
  if(!isCurrent())return deny("NESSUS_P5_STALE");
  const last=getCurrentModel();
  if(!last||JSON.stringify(after)!==JSON.stringify(last))
    return deny("NESSUS_P5_STALE");
  return reviewed.sidecar;
}
