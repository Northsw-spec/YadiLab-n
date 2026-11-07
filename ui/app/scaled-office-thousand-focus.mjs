import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";

const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const PAGE_SIZE=100;
const MAX_PEERS=16;

/** Derive a display-only subgraph of the NORMALIZED canonical compiler model.
 * Pages are original source *row* groups, NEVER physical/administrative zones.
 * No mutations to Builder source, compile model, or Engine are permitted. */
export async function buildScaledOfficeThousandFocus(fullModel,sourceRowIds,page){
 if(!fullModel||!Array.isArray(sourceRowIds)||sourceRowIds.length!==1000||
    !Number.isSafeInteger(page)||page<1||page>10)
   fail("SCALE_P2B1_FOCUS_SELECTION_BLOCKED");
 const originalIds=new Set(sourceRowIds);
 if(originalIds.size!==1000||fullModel.resources?.length!==1000||
    fullModel.connections?.length!==999||
    !fullModel.resources.every(r=>originalIds.has(r.id)))
   fail("SCALE_P2B1_FOCUS_SOURCE_MISMATCH");
 const base=new Set(sourceRowIds.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE));
 if(base.size!==PAGE_SIZE)fail("SCALE_P2B1_FOCUS_SELECTION_BLOCKED");
 const peerTouch=new Map();
 for(const edge of fullModel.connections){
   const from=edge.from?.resource,to=edge.to?.resource;
   if(!originalIds.has(from)||!originalIds.has(to))
     fail("SCALE_P2B1_FOCUS_SOURCE_MISMATCH");
   // Only a genuinely connected original peer is eligible for context.
   if(base.has(from)&&!base.has(to)){
     const peers=peerTouch.get(to)??new Set();peers.add(from);peerTouch.set(to,peers);
   }else if(base.has(to)&&!base.has(from)){
     const peers=peerTouch.get(from)??new Set();peers.add(to);peerTouch.set(from,peers);
   }
 }
 // Require >=2 distinct declared links to active source-row nodes. This
 // avoids bringing dozens of unrelated leaf hosts into the first hub page.
 const context=[...peerTouch].filter(([,n])=>n.size>=2)
   .sort((a,b)=>b[1].size-a[1].size||a[0].localeCompare(b[0],"en"))
   .slice(0,MAX_PEERS).map(([id])=>id);
 const shown=new Set([...base,...context]);
 if(shown.size>PAGE_SIZE+MAX_PEERS)
   fail("SCALE_P2B1_FOCUS_TOO_LARGE");
 const connected=fullModel.connections.filter(edge=>
   shown.has(edge.from.resource)&&shown.has(edge.to.resource)&&
   (base.has(edge.from.resource)||base.has(edge.to.resource)));
 const distinctEdges=new Set(connected.map(edge=>edge.id));
 if(distinctEdges.size!==connected.length)
   fail("SCALE_P2B1_FOCUS_DUPLICATE_EDGE");
 const requiredPorts=new Map([...shown].map(id=>[id,new Set()]));
 for(const edge of connected){
   if(edge.from.port)requiredPorts.get(edge.from.resource).add(edge.from.port);
   if(edge.to.port)requiredPorts.get(edge.to.resource).add(edge.to.port);
 }
 const resources=fullModel.resources.filter(r=>shown.has(r.id)).map(r=>({
   ...r,
   interfaces:r.interfaces.filter(p=>requiredPorts.get(r.id).has(p.id))
 }));
 const known=new Map(resources.map(r=>[r.id,new Set(r.interfaces.map(p=>p.id))]));
 if(resources.length!==shown.size||connected.some(edge=>
    (edge.from.port&&!known.get(edge.from.resource)?.has(edge.from.port))||
    (edge.to.port&&!known.get(edge.to.resource)?.has(edge.to.port))))
   fail("SCALE_P2B1_FOCUS_PORT_MISMATCH");
 const scenario={
   ...fullModel,
   zones:[],resources,connections:connected
 };
 const result=await runAutoLayout(scenario,new ElkLayoutBackend());
 if(!result.ok||!result.document||
    result.document.scenarioId!==scenario.scenarioId)
   fail("SCALE_P2B1_FOCUS_LAYOUT_BLOCKED");
 const projection=projectScenarioToCanvas(scenario,result.document);
 if(projection.diagnostics.some(d=>d.severity==="error")||
    projection.nodes.length!==shown.size||
    projection.edges.length!==connected.length||
    projection.nodes.some(n=>n.layoutStatus!=="resolved"||
       !Number.isFinite(n.position.x)||!Number.isFinite(n.position.y)||
       !(n.width>0)||!(n.height>0))||
    projection.edges.some(edge=>!distinctEdges.has(edge.id)))
   fail("SCALE_P2B1_FOCUS_PROJECTION_BLOCKED");
 // These are NOT aggregate or synthesized connectors; only approved
 // original source connections between currently visible endpoints.
 const hiddenCount=fullModel.connections.length-connected.length;
 return Object.freeze({
   page,canonicalNodes:fullModel.resources.length,
   canonicalLinks:fullModel.connections.length,
   focusedNodes:projection.nodes.length,focusedEdges:projection.edges.length,
   hiddenOriginalLinks:hiddenCount,
   rowFirst:(page-1)*PAGE_SIZE+1,rowLast:page*PAGE_SIZE,
   focusCanvas:projection,
   contextNodeIds:context
 });
}
