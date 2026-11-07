import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";

/**
 * SCALE-001 P2b2C: source-bound, read-only site → building → floor focus.
 *
 * Source is ALWAYS the complete original, editable, user-reviewed Builder
 * source. Trusted-source hash must come from the import host, not the user's
 * sidecar. The host separately revalidates that SHA against actual source
 * bytes immediately before invoking this function.
 *
 * This selects exact pre-existing devices/links. Any omitted link merely lies
 * outside the current viewport. Nothing here is a discovered real building,
 * a physical-cabling certificate, an Engine test or an aggregate cable.
 */
const PAGE_SIZE=100;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const error=code=>{const x=new Error(code);x.code=code;throw x;};
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
const safeId=value=>typeof value==="string"&&ID.test(value);
const safeHash=value=>typeof value==="string"&&SHA.test(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freezeRows=value=>Object.freeze(value.map(x=>Object.freeze(x)));
const pair=x=>({resource:x.resource,...(x.port!==undefined?{port:x.port}:{})});
const descriptor=x=>({linkId:x.id,from:pair(x.from),to:pair(x.to)});
const sameLink=(a,b)=>a.linkId===b.linkId&&equal(a.from,b.from)&&
  equal(a.to,b.to)&&a.fromSiteId===b.fromSiteId&&a.toSiteId===b.toSiteId;
const setEqual=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));

function inspectExactCanonical(source,approved,trusted){
  if(!object(trusted)||!safeHash(trusted.trustedSourceModelHash)||
    !object(source)||!object(approved)||
    !safeHash(approved.sourceModelHash)||
    !safeHash(approved.sourceOriginalSha256)||
    approved.sourceModelHash!==trusted.trustedSourceModelHash||
    approved.status!=="READY_FOR_PRESENTATION"||
    approved.profileId!=="office.declared-site-hierarchy.v1"||
    approved.canActivate!==false||
    approved.engineVerified!==false||
    approved.physicalTopologyVerified!==false)
    error("SCALE_P2B2_SOURCE_CHANGED");
  if(!Array.isArray(source.resources)||source.resources.length!==1000||
    !Array.isArray(source.connections)||source.connections.length!==999||
    !Array.isArray(source.tests)||source.tests.length!==0||
    !Array.isArray(approved.memberships)||
    !Array.isArray(approved.unassignedDeviceIds)||
    !Array.isArray(approved.crossSiteOriginalLinks)||
    !Array.isArray(approved.declaredSites)||
    !Array.isArray(approved.declaredBuildings)||
    !Array.isArray(approved.declaredFloors))
    error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
  const resources=new Map();
  for(const n of source.resources){
    if(!object(n)||!safeId(n.id)||resources.has(n.id)||
      !Array.isArray(n.interfaces))
      error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
    const ports=new Set();
    for(const p of n.interfaces){
      if(!object(p)||!safeId(p.id)||ports.has(p.id))
        error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
      ports.add(p.id);
    }
    resources.set(n.id,ports);
  }
  const connections=new Map();
  for(const edge of source.connections){
    if(!object(edge)||!safeId(edge.id)||connections.has(edge.id)||
      !object(edge.from)||!object(edge.to))
      error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
    for(const endpoint of [edge.from,edge.to]){
      if(!resources.has(endpoint.resource)||
        (endpoint.port!==undefined&&
          (!safeId(endpoint.port)||!resources.get(endpoint.resource).has(endpoint.port))))
        error("SCALE_P2B2_FOCUS_PORT_INVALID");
    }
    connections.set(edge.id,edge);
  }
  const sites=new Map(),buildings=new Map(),floors=new Map(),allIds=new Set();
  for(const [rows,target] of [
    [approved.declaredSites,sites],
    [approved.declaredBuildings,buildings],
    [approved.declaredFloors,floors]
  ]){
    for(const x of rows){
      if(!object(x)||!safeId(x.id)||allIds.has(x.id)||
        typeof x.label!=="string"||!x.label.trim()||
        x.label!==x.label.trim()||x.label.length>96||
        /[\x00-\x1f\x7f<>]/.test(x.label))
        error("SCALE_P2B2_FOCUS_SCOPE_INVALID");
      allIds.add(x.id);
      target.set(x.id,x);
    }
  }
  for(const b of buildings.values()){
    if(!sites.has(b.siteId))error("SCALE_P2B2_FOCUS_SCOPE_INVALID");
  }
  for(const f of floors.values()){
    if(!buildings.has(f.buildingId))
      error("SCALE_P2B2_FOCUS_SCOPE_INVALID");
  }
  const memberships=new Map();
  for(const m of approved.memberships){
    if(!object(m)||!safeId(m.deviceId)||memberships.has(m.deviceId)||
      !resources.has(m.deviceId)||!sites.has(m.siteId)||
      !buildings.has(m.buildingId)||!floors.has(m.floorId)||
      buildings.get(m.buildingId).siteId!==m.siteId||
      floors.get(m.floorId).buildingId!==m.buildingId)
      error("SCALE_P2B2_FOCUS_MEMBERSHIP_INVALID");
    memberships.set(m.deviceId,m);
  }
  const unassigned=source.resources.filter(n=>!memberships.has(n.id)).map(n=>n.id);
  if(!equal(unassigned,approved.unassignedDeviceIds))
    error("SCALE_P2B2_FOCUS_UNASSIGNED_MISMATCH");
  // Original intersite evidence MUST be exactly the canonical source link
  // subset, including the original endpoint orientation and both original
  // ports. Cross-site ledger rows are references, never new graph edges.
  const actualCross=[];
  for(const edge of source.connections){
    const from=memberships.get(edge.from.resource);
    const to=memberships.get(edge.to.resource);
    if(!from||!to||from.siteId===to.siteId)continue;
    actualCross.push({
      ...descriptor(edge),fromSiteId:from.siteId,toSiteId:to.siteId
    });
  }
  if(actualCross.length!==approved.crossSiteOriginalLinks.length||
    actualCross.some((x,i)=>!sameLink(x,approved.crossSiteOriginalLinks[i])))
    error("SCALE_P2B2_FOCUS_LEDGER_MISMATCH");
  return {resources,connections,memberships,sites,buildings,floors};
}

export function selectDeclaredOfficeHierarchySlice(
  source,approved,scopeKind,scopeId,page,trust
){
  let snapshot;
  try{snapshot=JSON.stringify(source);}catch{
    error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
  }
  if(typeof snapshot!=="string"||snapshot.length>10*1024*1024)
    error("SCALE_P2B2_FOCUS_SOURCE_INVALID");
  const context=inspectExactCanonical(source,approved,trust);
  const scopes={
    site:context.sites,building:context.buildings,floor:context.floors
  };
  if(!Object.prototype.hasOwnProperty.call(scopes,scopeKind)||
     !safeId(scopeId)||!scopes[scopeKind].has(scopeId)||
     !Number.isSafeInteger(page)||page<1)
    error("SCALE_P2B2_FOCUS_SCOPE_INVALID");
  const ids=source.resources.filter(n=>{
    const membership=context.memberships.get(n.id);
    return membership&&membership[scopeKind+"Id"]===scopeId;
  }).map(n=>n.id);
  const pageCount=Math.max(1,Math.ceil(ids.length/PAGE_SIZE));
  if(page>pageCount)error("SCALE_P2B2_FOCUS_PAGE_INVALID");
  const viewNodeIds=ids.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const visible=new Set(viewNodeIds);
  const viewLinks=source.connections.filter(link=>
    visible.has(link.from.resource)&&visible.has(link.to.resource));
  const viewEdgeIds=viewLinks.map(x=>x.id);
  if(new Set(viewEdgeIds).size!==viewEdgeIds.length||
    viewNodeIds.length>PAGE_SIZE)
    error("SCALE_P2B2_FOCUS_GRAPH_INVALID");
  if(JSON.stringify(source)!==snapshot)
    error("SCALE_P2B2_SOURCE_CHANGED");
  return Object.freeze({
    scopeKind,scopeId,page,pageCount,membersInScope:ids.length,
    canonicalNodes:source.resources.length,
    canonicalLinks:source.connections.length,
    sourceModelHash:approved.sourceModelHash,
    sourceOriginalSha256:approved.sourceOriginalSha256,
    viewNodeIds:Object.freeze(viewNodeIds),
    viewEdgeIds:Object.freeze(viewEdgeIds),
    viewLinks:freezeRows(viewLinks.map(descriptor).map(d=>({
      id:d.linkId,from:d.from,to:d.to
    }))),
    focusedNodes:viewNodeIds.length,focusedEdges:viewEdgeIds.length,
    hiddenOriginalLinks:source.connections.length-viewLinks.length,
    unassignedOriginals:approved.unassignedDeviceIds.length,
    crossSiteOriginalLinks:approved.crossSiteOriginalLinks.length,
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}

function verifyCompilerModel(source,compiledModel){
  if(!object(compiledModel)||!Array.isArray(compiledModel.resources)||
    !Array.isArray(compiledModel.connections)||
    compiledModel.resources.length!==source.resources.length||
    compiledModel.connections.length!==source.connections.length)
    error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
  const originalNodes=new Set(source.resources.map(x=>x.id));
  const normalizedNodes=new Set(compiledModel.resources.map(x=>x.id));
  if(!setEqual(originalNodes,normalizedNodes))
    error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
  const originalEdges=new Map(source.connections.map(x=>[x.id,x]));
  const compiledEdges=new Set();
  for(const edge of compiledModel.connections){
    if(!object(edge)||!safeId(edge.id)||compiledEdges.has(edge.id))
      error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
    compiledEdges.add(edge.id);
    const original=originalEdges.get(edge.id);
    if(!original||!equal(pair(original.from),pair(edge.from))||
      !equal(pair(original.to),pair(edge.to)))
      error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
  }
}

export async function buildDeclaredOfficeHierarchyFocus(
  source,approved,scopeKind,scopeId,page,options
){
  const selected=selectDeclaredOfficeHierarchySlice(
    source,approved,scopeKind,scopeId,page,options);
  const model=options?.compiledModel??source;
  verifyCompilerModel(source,model);
  const visible=new Set(selected.viewNodeIds);
  const edgeIds=new Set(selected.viewEdgeIds);
  const edges=model.connections.filter(link=>edgeIds.has(link.id));
  const requiredPorts=new Map(selected.viewNodeIds.map(id=>[id,new Set()]));
  for(const edge of edges){
    if(!visible.has(edge.from.resource)||!visible.has(edge.to.resource))
      error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
    if(edge.from.port)requiredPorts.get(edge.from.resource).add(edge.from.port);
    if(edge.to.port)requiredPorts.get(edge.to.resource).add(edge.to.port);
  }
  const resources=model.resources.filter(r=>visible.has(r.id)).map(r=>{
    const wanted=requiredPorts.get(r.id);
    if(!Array.isArray(r.interfaces)||!wanted)
      error("SCALE_P2B2_FOCUS_PORT_INVALID");
    const ports=r.interfaces.filter(p=>wanted.has(p.id));
    if(ports.length!==wanted.size)
      error("SCALE_P2B2_FOCUS_PORT_INVALID");
    return {...r,interfaces:ports};
  });
  if(resources.length!==selected.viewNodeIds.length||
    edges.length!==selected.viewEdgeIds.length)
    error("SCALE_P2B2_FOCUS_COMPILED_MISMATCH");
  if(!resources.length){
    return Object.freeze({...selected,
      focusCanvas:{nodes:[],edges:[],diagnostics:[]}
    });
  }
  const subset={...model,zones:[],resources,connections:edges};
  const result=await runAutoLayout(subset,new ElkLayoutBackend());
  if(!result.ok||!result.document||
    result.document.scenarioId!==subset.scenarioId)
    error("SCALE_P2B2_FOCUS_LAYOUT_BLOCKED");
  const projection=projectScenarioToCanvas(subset,result.document);
  if(!Array.isArray(projection.nodes)||!Array.isArray(projection.edges)||
    projection.diagnostics?.some(x=>x.severity==="error")||
    projection.nodes.length!==selected.viewNodeIds.length||
    projection.edges.length!==selected.viewEdgeIds.length||
    !setEqual(new Set(projection.nodes.map(n=>n.id)),visible)||
    !setEqual(new Set(projection.edges.map(x=>x.id)),edgeIds)||
    projection.nodes.some(n=>n.layoutStatus!=="resolved"||
      !Number.isFinite(n.position.x)||!Number.isFinite(n.position.y)||
      !(n.width>0)||!(n.height>0)))
    error("SCALE_P2B2_FOCUS_PROJECTION_BLOCKED");
  return Object.freeze({...selected,focusCanvas:projection});
}
