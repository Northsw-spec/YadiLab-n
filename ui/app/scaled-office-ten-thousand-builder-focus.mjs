import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";

const PAGE_SIZE=100;
const PAGE_COUNT=100;
const ORIGINAL_DEVICE_COUNT=10000;
const ORIGINAL_LINK_COUNT=10000;
const MAX_CONTEXT_PEERS=16;
const MAX_VISIBLE_ORIGINAL_EDGES=250;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const fail=code=>{const err=new Error(code);err.code=code;throw err;};
const validId=x=>typeof x==="string"&&ID.test(x);

/**
 * P4c3b: a display-only, exact-source focused slice of the full 10k/10k
 * NORMALIZED compiler graph, preserving the original editable Builder model.
 *
 * Original source row pages are not site/building/floor declarations. A peer
 * appears only if at least two genuinely original edges touch this page;
 * there are no inferred, aggregate, or remapped physical cables. A hidden
 * original edge remains in the canonical Builder and is counted, not removed.
 *
 * Only the focused subset is passed to ELK/canvas projection; the 10k source
 * graph is never laid out as one unbounded canvas. The new 10k path is separate
 * from the stable 1k P2b1/P2b2C source and UI contracts.
 */
export async function buildScaledOfficeTenThousandFocus(fullModel,sourceRowIds,page){
  if(!Array.isArray(sourceRowIds)||
     sourceRowIds.length!==ORIGINAL_DEVICE_COUNT||
     !Number.isSafeInteger(page)||page<1||page>PAGE_COUNT)
    fail("SCALE_P4C3B_FOCUS_SELECTION_BLOCKED");
  const originals=new Set(sourceRowIds);
  if(originals.size!==ORIGINAL_DEVICE_COUNT||
     !sourceRowIds.every(validId)||
     !fullModel||typeof fullModel!=="object"||
     !Array.isArray(fullModel.resources)||
     !Array.isArray(fullModel.connections)||
     fullModel.resources.length!==ORIGINAL_DEVICE_COUNT||
     fullModel.connections.length!==ORIGINAL_LINK_COUNT)
    fail("SCALE_P4C3B_FOCUS_SOURCE_MISMATCH");

  // Independently validate all canonical modeled originals; no untrusted
  // duplicate ID or endpoint may enter the display-only graph.
  const interfacesByNode=new Map();
  for(const resource of fullModel.resources){
    if(!resource||!validId(resource.id)||!originals.has(resource.id)||
       interfacesByNode.has(resource.id)||!Array.isArray(resource.interfaces))
      fail("SCALE_P4C3B_FOCUS_SOURCE_MISMATCH");
    const available=new Set();
    for(const p of resource.interfaces){
      if(!p||!validId(p.id)||available.has(p.id))
        fail("SCALE_P4C3B_FOCUS_PORT_MISMATCH");
      available.add(p.id);
    }
    interfacesByNode.set(resource.id,available);
  }
  if(interfacesByNode.size!==ORIGINAL_DEVICE_COUNT)
    fail("SCALE_P4C3B_FOCUS_SOURCE_MISMATCH");

  const edgeIds=new Set(),occupiedSourcePorts=new Set();
  for(const edge of fullModel.connections){
    if(!edge||!validId(edge.id))
      fail("SCALE_P4C3B_FOCUS_SOURCE_MISMATCH");
    if(edgeIds.has(edge.id))fail("SCALE_P4C3B_FOCUS_DUPLICATE_EDGE");
    edgeIds.add(edge.id);
    if(!edge.from||!edge.to||!validId(edge.from.resource)||
       !validId(edge.to.resource)||
       !originals.has(edge.from.resource)||
       !originals.has(edge.to.resource)||
       edge.from.resource===edge.to.resource)
      fail("SCALE_P4C3B_FOCUS_SOURCE_MISMATCH");
    if(!validId(edge.from.port)||!validId(edge.to.port)||
       !interfacesByNode.get(edge.from.resource)?.has(edge.from.port)||
       !interfacesByNode.get(edge.to.resource)?.has(edge.to.port))
      fail("SCALE_P4C3B_FOCUS_PORT_MISMATCH");
    for(const endpoint of [edge.from,edge.to]){
      const key=endpoint.resource+"\u0000"+endpoint.port;
      if(occupiedSourcePorts.has(key))fail("SCALE_P4C3B_FOCUS_PORT_MISMATCH");
      occupiedSourcePorts.add(key);
    }
  }
  const base=new Set(sourceRowIds.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE));
  if(base.size!==PAGE_SIZE)
    fail("SCALE_P4C3B_FOCUS_SELECTION_BLOCKED");

  const touching=new Map();
  for(const edge of fullModel.connections){
    const from=edge.from.resource,to=edge.to.resource;
    if(base.has(from)&&!base.has(to)){
      const members=touching.get(to)??new Set();
      members.add(from);touching.set(to,members);
    }else if(base.has(to)&&!base.has(from)){
      const members=touching.get(from)??new Set();
      members.add(to);touching.set(from,members);
    }
  }
  const context=[...touching].filter(([,members])=>members.size>=2)
    .sort((a,b)=>b[1].size-a[1].size||a[0].localeCompare(b[0],"en"))
    .slice(0,MAX_CONTEXT_PEERS).map(([id])=>id);
  const shown=new Set([...base,...context]);
  if(shown.size>PAGE_SIZE+MAX_CONTEXT_PEERS)
    fail("SCALE_P4C3B_FOCUS_SELECTION_BLOCKED");

  // P4c3b MUST enforce an explicit source-port pair on *every* Office link.
  // Duplicate resource/port use was checked independently by source mapper;
  // this pass refuses a stale or edited compiled model that violates it.
  if(occupiedSourcePorts.size!==ORIGINAL_LINK_COUNT*2)
    fail("SCALE_P4C3B_FOCUS_PORT_MISMATCH");
  // No source-row identity should be fabricated or silently omitted by views.
  if(new Set(fullModel.connections.map(x=>x.id)).size!==ORIGINAL_LINK_COUNT)
    fail("SCALE_P4C3B_FOCUS_DUPLICATE_EDGE");

  // Only exact previously declared original source links whose both
  // endpoints are visible can be passed to ELK or ReactFlow projection.
  const links=fullModel.connections.filter(edge=>
    shown.has(edge.from.resource)&&shown.has(edge.to.resource)&&
    (base.has(edge.from.resource)||base.has(edge.to.resource)));
  if(links.length>MAX_VISIBLE_ORIGINAL_EDGES)
    fail("SCALE_P4C3B_FOCUS_TOO_LARGE");
  const visibleEdgeIds=new Set(links.map(x=>x.id));
  if(visibleEdgeIds.size!==links.length)
    fail("SCALE_P4C3B_FOCUS_DUPLICATE_EDGE");
  const requestedPorts=new Map([...shown].map(x=>[x,new Set()]));
  for(const edge of links){
    requestedPorts.get(edge.from.resource).add(edge.from.port);
    requestedPorts.get(edge.to.resource).add(edge.to.port);
  }
  const resources=fullModel.resources.filter(x=>shown.has(x.id)).map(resource=>({
    ...resource,
    interfaces:resource.interfaces.filter(p=>requestedPorts.get(resource.id).has(p.id))
  }));
  if(resources.length!==shown.size||
     resources.some(x=>x.interfaces.length!==requestedPorts.get(x.id).size))
    fail("SCALE_P4C3B_FOCUS_PORT_MISMATCH");

  const bounded={...fullModel,zones:[],resources,connections:links};
  let layout;
  try{layout=await runAutoLayout(bounded,new ElkLayoutBackend());}
  catch{fail("SCALE_P4C3B_FOCUS_LAYOUT_BLOCKED");}
  if(!layout?.ok||!layout.document||
     layout.document.scenarioId!==bounded.scenarioId)
    fail("SCALE_P4C3B_FOCUS_LAYOUT_BLOCKED");

  let canvas;
  try{canvas=projectScenarioToCanvas(bounded,layout.document);}
  catch{fail("SCALE_P4C3B_FOCUS_PROJECTION_BLOCKED");}
  if(!Array.isArray(canvas?.nodes)||!Array.isArray(canvas?.edges)||
     canvas.diagnostics?.some(x=>x.severity==="error")||
     canvas.nodes.length!==resources.length||
     canvas.edges.length!==links.length||
     canvas.nodes.some(n=>!shown.has(n.id)||
       n.layoutStatus!=="resolved"||
       !Number.isFinite(n.position?.x)||
       !Number.isFinite(n.position?.y)||
       !(n.width>0)||!(n.height>0))||
     canvas.edges.some(e=>!visibleEdgeIds.has(e.id))||
     new Set(canvas.nodes.map(x=>x.id)).size!==shown.size||
     new Set(canvas.edges.map(x=>x.id)).size!==links.length)
    fail("SCALE_P4C3B_FOCUS_PROJECTION_BLOCKED");

  return Object.freeze({
    page,pageCount:PAGE_COUNT,
    canonicalNodes:ORIGINAL_DEVICE_COUNT,canonicalLinks:ORIGINAL_LINK_COUNT,
    focusedNodes:canvas.nodes.length,focusedEdges:canvas.edges.length,
    hiddenOriginalLinks:ORIGINAL_LINK_COUNT-links.length,
    rowFirst:(page-1)*PAGE_SIZE+1,rowLast:page*PAGE_SIZE,
    focusCanvas:canvas,contextNodeIds:Object.freeze(context),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}
