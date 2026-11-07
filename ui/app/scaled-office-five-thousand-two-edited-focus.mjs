import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";
import {
  reviewScaledOfficeFiveThousandAppendOnly,
  buildScaledOfficeFiveThousandEditedFocus
} from "./scaled-office-five-thousand-edited-focus.mjs";

const ORIGINAL_NODES=5000;
const ORIGINAL_LINKS=5000;
const FIRST_APPEND_COUNT=5001;
const SECOND_APPEND_COUNT=5002;
const LAST_PAGE=52;
const IDENTIFIER=/^[a-z][a-z0-9_-]{0,63}$/;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const json=x=>JSON.stringify(x);
const arr=Array.isArray;

/**
 * P3d3: a *second*, separately approved, append-only unlinked Builder device.
 * The P3d2 5001 intermediate snapshot is mandatory; a direct 5000->5002
 * source cannot silently skip the first manual review. Both verified original
 * port-linked source rows and the first approved addition remain deep-identical.
 * Does not make any source or Engine/physical network truth assertion.
 */
export function reviewScaledOfficeFiveThousandTwoAppends(
  baselineSource,baselineModel,editedSource,editedModel,originalIds,
  firstApprovedSource,firstApprovedModel
){
  if(!arr(originalIds)||originalIds.length!==ORIGINAL_NODES||
     !arr(baselineSource?.resources)||baselineSource.resources.length!==ORIGINAL_NODES||
     originalIds.some((id,i)=>baselineSource.resources[i]?.id!==id))
    fail("SCALE_P3D3_ORIGINAL_CHANGED");
  try{
    reviewScaledOfficeFiveThousandAppendOnly(
      baselineSource,baselineModel,
      firstApprovedSource,firstApprovedModel,originalIds);
  }catch{
    fail("SCALE_P3D3_FIRST_REVIEW_BLOCKED");
  }
  if(!editedSource||!editedModel||
     !arr(editedSource.resources)||!arr(editedModel.resources)||
     !arr(editedSource.connections)||!arr(editedModel.connections)||
     editedSource.resources.length!==SECOND_APPEND_COUNT||
     editedModel.resources.length!==SECOND_APPEND_COUNT||
     editedSource.connections.length!==ORIGINAL_LINKS||
     editedModel.connections.length!==ORIGINAL_LINKS)
    fail("SCALE_P3D3_APPEND_ONLY_BLOCKED");

  const firstId=firstApprovedSource.resources[ORIGINAL_NODES].id;
  const second=editedSource.resources[FIRST_APPEND_COUNT];
  const secondModel=editedModel.resources[FIRST_APPEND_COUNT];
  const allSourceIds=editedSource.resources.map(r=>r?.id);
  const allModelIds=editedModel.resources.map(r=>r?.id);
  if(!second||!secondModel||
     typeof second.id!=="string"||!IDENTIFIER.test(second.id)||
     second.id===firstId||secondModel.id!==second.id||
     new Set(allSourceIds).size!==SECOND_APPEND_COUNT||
     new Set(allModelIds).size!==SECOND_APPEND_COUNT)
    fail("SCALE_P3D3_APPEND_ONLY_BLOCKED");

  // This restores the EXACT separately approved P3d2 source, including
  // metadata/asset locks/zones/tests/notes; no hidden change can ride along.
  const previous={...editedSource,
    resources:editedSource.resources.slice(0,FIRST_APPEND_COUNT)};
  if(json(previous)!==json(firstApprovedSource)||
     json(editedModel.resources.slice(0,FIRST_APPEND_COUNT))!==
       json(firstApprovedModel.resources)||
     json(editedModel.connections)!==json(firstApprovedModel.connections)||
     editedSource.scenarioId!==baselineSource.scenarioId||
     editedModel.scenarioId!==baselineModel.scenarioId)
    fail("SCALE_P3D3_ORIGINAL_CHANGED");
  return Object.freeze({
    addedIds:Object.freeze([firstId,second.id]),
    originalNodeCount:ORIGINAL_NODES,
    originalLinkCount:ORIGINAL_LINKS,
    editedNodeCount:SECOND_APPEND_COUNT,
    editedLinkCount:ORIGINAL_LINKS,
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}

/**
 * Never send a 5002-node graph to ELK. Original row pages 1..50 and
 * the P3d2 approved first appended device page 51 reuse the previously
 * verified bounded flow. Page 52 lays out just the second unlinked device.
 */
export async function buildScaledOfficeFiveThousandTwoEditedFocus(
  baselineSource,baselineModel,editedSource,editedModel,originalIds,page,
  firstApprovedSource,firstApprovedModel
){
  if(!Number.isSafeInteger(page)||page<1||page>LAST_PAGE)
    fail("SCALE_P3D3_SELECTION_BLOCKED");
  const proof=reviewScaledOfficeFiveThousandTwoAppends(
    baselineSource,baselineModel,editedSource,editedModel,originalIds,
    firstApprovedSource,firstApprovedModel);
  let focus;
  if(page<=51){
    const prior=await buildScaledOfficeFiveThousandEditedFocus(
      baselineSource,baselineModel,firstApprovedSource,firstApprovedModel,
      originalIds,page);
    focus={...prior};
  }else{
    const resource=editedModel.resources[FIRST_APPEND_COUNT];
    if(resource?.id!==proof.addedIds[1])
      fail("SCALE_P3D3_APPEND_ONLY_BLOCKED");
    // ID-sized display-only text does not truncate canonical authored labels.
    const bounded={...editedModel,zones:[],resources:[
      {...resource,label:resource.id}
    ],connections:[]};
    let layout;
    try{layout=await runAutoLayout(bounded,new ElkLayoutBackend());}
    catch{fail("SCALE_P3D3_LAYOUT_BLOCKED");}
    if(!layout?.ok||!layout.document||
       layout.document.scenarioId!==bounded.scenarioId)
      fail("SCALE_P3D3_LAYOUT_BLOCKED");
    let canvas;
    try{canvas=projectScenarioToCanvas(bounded,layout.document);}
    catch{fail("SCALE_P3D3_PROJECTION_BLOCKED");}
    if(!arr(canvas?.nodes)||!arr(canvas?.edges)||
       canvas.nodes.length!==1||canvas.edges.length!==0||
       canvas.nodes[0].id!==resource.id||
       canvas.nodes[0].layoutStatus!=="resolved"||
       !Number.isFinite(canvas.nodes[0].position?.x)||
       !Number.isFinite(canvas.nodes[0].position?.y)||
       !(canvas.nodes[0].width>0)||!(canvas.nodes[0].height>0)||
       canvas.diagnostics?.some(x=>x.severity==="error"))
      fail("SCALE_P3D3_PROJECTION_BLOCKED");
    focus={
      page,rowFirst:SECOND_APPEND_COUNT,rowLast:SECOND_APPEND_COUNT,
      focusedNodes:1,focusedEdges:0,hiddenOriginalLinks:ORIGINAL_LINKS,
      focusCanvas:canvas,contextNodeIds:[]
    };
  }
  const selected=page===51?ORIGINAL_NODES:FIRST_APPEND_COUNT;
  return Object.freeze({
    ...focus,
    pageCount:LAST_PAGE,
    canonicalNodes:SECOND_APPEND_COUNT,canonicalLinks:ORIGINAL_LINKS,
    editedBounded:true,twoEditedBounded:true,
    addedResourceIds:proof.addedIds,
    addedResourceId:page>=51?proof.addedIds[page-51]:null,
    addedResourceOriginalLabel:page>=51?editedModel.resources[selected].label:null,
    addedResourceLabel:"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW",
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}
