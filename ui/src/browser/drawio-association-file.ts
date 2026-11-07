import { previewDrawioFileReadOnly, type DrawioReadableFile } from "./drawio-file-preview.js";
import { reviewDrawioVertexAssociations, validDrawioSummary, type DrawioBuilderSnapshot,
 type DrawioReviewedDecision, type DrawioReviewedSidecar } from "../../../enterprise-import/src/drawio-association-review.js";
import type { DrawioStructurePreview } from "../../../enterprise-import/src/drawio-structural-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/** Source and live Builder are rechecked after asynchronous original-file parsing. */
export async function reviewDrawioOriginalFileReferences(
  file:DrawioReadableFile, expected:DrawioStructurePreview,
  getCurrentModel:()=>DrawioBuilderSnapshot|null,
  decision:DrawioReviewedDecision, isCurrent:()=>boolean,
):Promise<DrawioReviewedSidecar>{
  if(!validDrawioSummary(expected))deny("DRAWIO_ASSOC_SOURCE_INVALID");
  if(!decision||decision.acknowledgeNotVerified!==true)deny("DRAWIO_ASSOC_ACK_REQUIRED");
  if(!isCurrent())deny("DRAWIO_ASSOC_STALE");
  const before=getCurrentModel();
  if(!before)deny("DRAWIO_ASSOC_BUILDER_REQUIRED");
  const current=await previewDrawioFileReadOnly(file);
  if(!isCurrent())deny("DRAWIO_ASSOC_STALE");
  if(current.sourceSha256!==expected.sourceSha256||
     current.pageCount!==expected.pageCount||current.vertexCount!==expected.vertexCount||
     current.drawnEdgeCount!==expected.drawnEdgeCount||
     current.compressedPageCount!==expected.compressedPageCount||
     current.pages.some((p,i)=>p.pageOrdinal!==expected.pages[i]?.pageOrdinal||
       p.vertexCount!==expected.pages[i]?.vertexCount||
       p.drawnEdgeCount!==expected.pages[i]?.drawnEdgeCount)){
    deny("DRAWIO_ASSOC_SOURCE_CHANGED");
  }
  const after=getCurrentModel();
  if(!after||JSON.stringify(after)!==JSON.stringify(before))deny("DRAWIO_ASSOC_STALE");
  const review=reviewDrawioVertexAssociations(current,after,decision);
  if(review.status==="READY_FOR_EXPORT")return review.sidecar;
  return deny(review.diagnostics[0]?.code??"DRAWIO_ASSOC_BLOCKED");
}
