import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";
import {buildScaledNetworkTenThousandFocus} from "./scaled-network-ten-thousand-focus.mjs";

const ORIGINAL_NODES=10000;
const ORIGINAL_LINKS=10000;
const MAX_ADDITION=1;
const MAX_PAGE=101;
const IDENTIFIER=/^[a-z][a-z0-9_-]{0,63}$/;
const denied=code=>{const error=new Error(code);error.code=code;throw error;};
const array=x=>Array.isArray(x);
const json=x=>JSON.stringify(x);

/**
 * P4e2: Strict proof that ONE locally authored, still unconnected Builder
 * resource was APPENDED to the exact approved original 10k/10k XLSX source.
 * The first 10k original source resources, all original links and their exact
 * compiled counterparts must survive without any order, port or property
 * mutation. No prior source row gets silently reclassified as a new one.
 *
 * This is NOT a re-import, topology discovery, Engine result, site hierarchy
 * or approval of a new physical cable. No ELK or ReactFlow is run here.
 */
export function reviewScaledXlsxTenThousandAppendOnly(
  baselineSource,baselineModel,editedSource,editedModel,originalIds
){
  if(!baselineSource||!baselineModel||!editedSource||!editedModel||
     !array(originalIds)||originalIds.length!==ORIGINAL_NODES||
     !array(baselineSource.resources)||!array(baselineModel.resources)||
     !array(baselineSource.connections)||!array(baselineModel.connections)||
     baselineSource.resources.length!==ORIGINAL_NODES||
     baselineModel.resources.length!==ORIGINAL_NODES||
     baselineSource.connections.length!==ORIGINAL_LINKS||
     baselineModel.connections.length!==ORIGINAL_LINKS)
    denied("SCALE_P4E2_BASELINE_BLOCKED");
  if(!array(editedSource.resources)||!array(editedModel.resources)||
     !array(editedSource.connections)||!array(editedModel.connections)||
     editedSource.resources.length!==ORIGINAL_NODES+MAX_ADDITION||
     editedModel.resources.length!==ORIGINAL_NODES+MAX_ADDITION||
     editedSource.connections.length!==ORIGINAL_LINKS||
     editedModel.connections.length!==ORIGINAL_LINKS)
    denied("SCALE_P4E2_APPEND_ONLY_BLOCKED");
  const originals=new Set(originalIds);
  if(originals.size!==ORIGINAL_NODES||
     originalIds.some((id,i)=>!IDENTIFIER.test(id)||
       baselineSource.resources[i]?.id!==id||
       baselineModel.resources[i]?.id!==id))
    denied("SCALE_P4E2_ORIGINAL_CHANGED");
  const added=editedSource.resources[ORIGINAL_NODES];
  const normalizedAddition=editedModel.resources[ORIGINAL_NODES];
  if(!added||!normalizedAddition||typeof added.id!=="string"||
     !IDENTIFIER.test(added.id)||originals.has(added.id)||
     normalizedAddition.id!==added.id||
     new Set(editedSource.resources.map(x=>x?.id)).size!==ORIGINAL_NODES+1||
     new Set(editedModel.resources.map(x=>x?.id)).size!==ORIGINAL_NODES+1)
    denied("SCALE_P4E2_APPEND_ONLY_BLOCKED");

  // Exact original XLSX rows and port-linked references, not merely the
  // number of nodes/edges. Compare BOTH canonical editable source and the
  // independently compiled normalized graph.
  if(json(editedSource.resources.slice(0,ORIGINAL_NODES))!==json(baselineSource.resources)||
     json(editedSource.connections)!==json(baselineSource.connections)||
     json(editedModel.resources.slice(0,ORIGINAL_NODES))!==json(baselineModel.resources)||
     json(editedModel.connections)!==json(baselineModel.connections))
    denied("SCALE_P4E2_ORIGINAL_CHANGED");
  // Non-graph fields are also bound to the approved XLSX source: a hidden
  // note, test/Engine assertion, or asset-zone change cannot ride along.
  const restored={...editedSource,resources:editedSource.resources.slice(0,ORIGINAL_NODES)};
  if(json(restored)!==json(baselineSource)||
     !array(baselineSource.tests)||baselineSource.tests.length!==0)
    denied("SCALE_P4E2_ORIGINAL_CHANGED");
  if(baselineSource.scenarioId!==editedSource.scenarioId||
     baselineModel.scenarioId!==editedModel.scenarioId||
     baselineSource.scenarioId!==baselineModel.scenarioId)
    denied("SCALE_P4E2_ORIGINAL_CHANGED");
  // A second untrusted edge, including a newly created link to the added
  // device, is excluded by the exact connection comparison and count.
  return Object.freeze({
    addedId:added.id,
    originalNodeCount:ORIGINAL_NODES,
    originalLinkCount:ORIGINAL_LINKS,
    editedNodeCount:ORIGINAL_NODES+MAX_ADDITION,
    editedLinkCount:ORIGINAL_LINKS,
    canActivate:false,
    engineVerified:false,
    physicalTopologyVerified:false
  });
}

/**
 * Only the actually approved bounded original source graph (pages 1..100)
 * or a standalone unlinked locally added Builder device (page 101) reaches
 * real ELK. Both are slices of the compiled canonical model, never inferred
 * or synthesized connections. The entire editable 10001/10000 source is NEVER
 * sent to ELK/ReactFlow.
 */
export async function buildScaledXlsxTenThousandEditedFocus(
  baselineSource,baselineModel,editedSource,editedModel,originalIds,page
){
  if(!Number.isSafeInteger(page)||page<1||page>MAX_PAGE)
    denied("SCALE_P4E2_SELECTION_BLOCKED");
  const reviewed=reviewScaledXlsxTenThousandAppendOnly(
    baselineSource,baselineModel,editedSource,editedModel,originalIds);
  let focus;
  if(page<=100){
    const original=await buildScaledNetworkTenThousandFocus(
      baselineModel,originalIds,page);
    focus={...original};
  }else{
    const resource=editedModel.resources[ORIGINAL_NODES];
    if(resource?.id!==reviewed.addedId)
      denied("SCALE_P4E2_APPEND_ONLY_BLOCKED");
    // The actual user-entered Builder label can exceed the fixed ELK node's
    // measured 44-character readability capacity. Do not change, truncate,
    // infer or rewrite canonical source/model: draw the exact immutable ID
    // in a DISPLAY-ONLY copy and show the complete authored label separately.
    // The same isolated resource remains the one unique canonical Builder ID.
    const displayOnlyResource={...resource,label:resource.id};
    const bounded={...editedModel,zones:[],
      resources:[displayOnlyResource],connections:[]};
    let layout;
    try{layout=await runAutoLayout(bounded,new ElkLayoutBackend());}
    catch{denied("SCALE_P4E2_LAYOUT_BLOCKED");}
    if(!layout?.ok||!layout.document||
       layout.document.scenarioId!==bounded.scenarioId)
      denied("SCALE_P4E2_LAYOUT_BLOCKED");
    let canvas;
    try{canvas=projectScenarioToCanvas(bounded,layout.document);}
    catch{denied("SCALE_P4E2_PROJECTION_BLOCKED");}
    if(!array(canvas?.nodes)||!array(canvas?.edges)||
       canvas.nodes.length!==1||canvas.edges.length!==0||
       canvas.nodes[0].id!==reviewed.addedId||
       canvas.nodes[0].layoutStatus!=="resolved"||
       !Number.isFinite(canvas.nodes[0].position?.x)||
       !Number.isFinite(canvas.nodes[0].position?.y)||
       !(canvas.nodes[0].width>0)||!(canvas.nodes[0].height>0)||
       canvas.diagnostics?.some(d=>d.severity==="error"))
      denied("SCALE_P4E2_PROJECTION_BLOCKED");
    focus={
      page,rowFirst:ORIGINAL_NODES+1,rowLast:ORIGINAL_NODES+1,
      focusedNodes:1,focusedEdges:0,hiddenOriginalLinks:ORIGINAL_LINKS,
      focusCanvas:canvas,contextNodeIds:[]
    };
  }
  return Object.freeze({
    ...focus,
    pageCount:MAX_PAGE,
    canonicalNodes:ORIGINAL_NODES+MAX_ADDITION,
    canonicalLinks:ORIGINAL_LINKS,
    editedBounded:true,
    addedResourceId:reviewed.addedId,
    addedResourceOriginalLabel:editedModel.resources[ORIGINAL_NODES].label,
    addedResourceLabel:"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW",
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}
