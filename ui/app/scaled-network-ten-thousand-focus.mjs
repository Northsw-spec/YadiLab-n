import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";

/** P4b1: explicitly consented original CSV 10000/10000 source row focus.
 * All 10000 nodes/links remain in canonical Builder; only a source-identity
 * subset enters ELK/ReactFlow, never invented/aggregated edges or Engine.
 */
const NODES=10000,LINKS=10000,ROW_SIZE=100,MAX_PEERS=16,MAX_EDGES=250;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const validId=x=>typeof x==="string"&&ID.test(x);
const has=x=>Array.isArray(x);

export async function buildScaledNetworkTenThousandFocus(model,sourceRowIds,page){
  if(!Number.isSafeInteger(page)||page<1||page>100)
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  if(!model||typeof model!=="object"||!has(model.resources)||
     !has(model.connections)||!has(sourceRowIds)||
     model.resources.length!==NODES||model.connections.length!==LINKS||
     sourceRowIds.length!==NODES)
    fail("SCALE_P4B1_SOURCE_BLOCKED");

  const nodeById=new Map(),portsById=new Map(),ordinal=new Map();
  for(let i=0;i<NODES;i++){
    const row=model.resources[i],id=sourceRowIds[i];
    if(!row||!validId(row.id)||row.id!==id||nodeById.has(id)||
       !has(row.interfaces)||!validId(id))
      fail("SCALE_P4B1_SOURCE_BLOCKED");
    const ports=new Set();
    for(const port of row.interfaces){
      if(!port||!validId(port.id)||ports.has(port.id))
        fail("SCALE_P4B1_SOURCE_BLOCKED");
      ports.add(port.id);
    }
    nodeById.set(id,row);
    portsById.set(id,ports);
    ordinal.set(id,i);
  }
  const edges=new Set();
  for(const edge of model.connections){
    if(!edge||!validId(edge.id)||edges.has(edge.id)||
       !edge.from||!edge.to||
       !validId(edge.from.resource)||!validId(edge.to.resource)||
       !nodeById.has(edge.from.resource)||!nodeById.has(edge.to.resource)||
       edge.from.resource===edge.to.resource)
      fail("SCALE_P4B1_SOURCE_BLOCKED");
    edges.add(edge.id);
    for(const side of ["from","to"]){
      const p=edge[side].port;
      if(p!==undefined&&(!validId(p)||!portsById.get(edge[side].resource)?.has(p)))
        fail("SCALE_P4B1_SOURCE_BLOCKED");
    }
  }

  const first=(page-1)*ROW_SIZE,last=page*ROW_SIZE;
  const base=new Set(sourceRowIds.slice(first,last));
  if(base.size!==ROW_SIZE)fail("SCALE_P4B1_SOURCE_BLOCKED");
  // Only independently declared links create graph neighbors. Deterministic
  // sorted source row order, not geography, subnet heuristics or inference.
  const peerIds=new Set();
  for(const edge of model.connections){
    const a=base.has(edge.from.resource),b=base.has(edge.to.resource);
    if(a&&!b)peerIds.add(edge.to.resource);
    else if(b&&!a)peerIds.add(edge.from.resource);
  }
  const context=[...peerIds].sort((a,b)=>
    ordinal.get(a)-ordinal.get(b)).slice(0,MAX_PEERS);
  const shown=new Set([...base,...context]);
  if(shown.size>ROW_SIZE+MAX_PEERS)
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  const visible=model.connections.filter(edge=>
    shown.has(edge.from.resource)&&shown.has(edge.to.resource)&&
    (base.has(edge.from.resource)||base.has(edge.to.resource)));
  if(visible.length>MAX_EDGES)
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  const visibleIds=new Set(visible.map(x=>x.id));
  if(visibleIds.size!==visible.length)
    fail("SCALE_P4B1_SOURCE_BLOCKED");
  const requested=new Map([...shown].map(x=>[x,new Set()]));
  for(const edge of visible){
    if(edge.from.port!==undefined)requested.get(edge.from.resource).add(edge.from.port);
    if(edge.to.port!==undefined)requested.get(edge.to.resource).add(edge.to.port);
  }
  const resources=model.resources.filter(x=>shown.has(x.id)).map(x=>({
    ...x,interfaces:x.interfaces.filter(p=>requested.get(x.id).has(p.id))
  }));
  if(resources.length!==shown.size||
     resources.some(x=>x.interfaces.length!==requested.get(x.id).size))
    fail("SCALE_P4B1_SOURCE_BLOCKED");
  const bounded={...model,zones:[],resources,connections:visible};
  let layout;
  try{layout=await runAutoLayout(bounded,new ElkLayoutBackend());}
  catch{fail("SCALE_P4B1_LAYOUT_BLOCKED");}
  if(!layout?.ok||!layout.document||layout.document.scenarioId!==model.scenarioId)
    fail("SCALE_P4B1_LAYOUT_BLOCKED");
  let canvas;
  try{canvas=projectScenarioToCanvas(bounded,layout.document);}
  catch{fail("SCALE_P4B1_PROJECTION_BLOCKED");}
  if(!has(canvas?.nodes)||!has(canvas?.edges)||
     canvas.nodes.length!==shown.size||canvas.edges.length!==visible.length||
     canvas.diagnostics?.some(d=>d.severity==="error")||
     new Set(canvas.nodes.map(n=>n.id)).size!==shown.size||
     new Set(canvas.edges.map(e=>e.id)).size!==visible.length||
     canvas.nodes.some(n=>!shown.has(n.id)||n.layoutStatus!=="resolved"||
       !Number.isFinite(n.position?.x)||!Number.isFinite(n.position?.y)||
       !(n.width>0)||!(n.height>0))||
     canvas.edges.some(e=>!visibleIds.has(e.id)))
    fail("SCALE_P4B1_PROJECTION_BLOCKED");
  return Object.freeze({
    page,pageCount:100,rowFirst:first+1,rowLast:last,
    canonicalNodes:NODES,canonicalLinks:LINKS,
    focusedNodes:canvas.nodes.length,focusedEdges:canvas.edges.length,
    hiddenOriginalLinks:LINKS-visible.length,
    focusCanvas:canvas,contextNodeIds:Object.freeze(context),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}
