import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { EngineState, MtuEvaluationRequest, MtuEvaluationTrace } from "./types.js";

function positiveInteger(value:unknown):value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function resourceInterface(state:EngineState,resourceId:string,interfaceId:string):Readonly<Record<string,unknown>>|undefined {
  const resource=state.resources[resourceId]; return resource?.interfaces.find(item=>item.id===interfaceId);
}
function connectionFor(scenario:NormalizedScenario,resourceId:string,interfaceId:string):NormalizedScenario["connections"][number]|undefined {
  return [...scenario.connections].filter(connection=>{
    if(connection.kind!=="network"&&connection.kind!=="management") return false;
    if(connection.from.resource===resourceId&&connection.from.port===interfaceId) return true;
    return connection.to.resource===resourceId&&connection.to.port===interfaceId&&connection.properties.direction!=="forward";
  }).sort((a,b)=>a.id.localeCompare(b.id,"en"))[0];
}
function readMtu(value:unknown):number|undefined { return value===undefined?undefined:positiveInteger(value)?value:NaN; }
function base(request:MtuEvaluationRequest,comparison:MtuEvaluationTrace["comparison"],truth:MtuEvaluationTrace["truth"],explanation:readonly string[],extra:Partial<MtuEvaluationTrace>={}):MtuEvaluationTrace {
  return {resourceId:request.resourceId,egressInterface:request.egressInterface,...(request.packetSize!==undefined?{packetSize:request.packetSize}:{}),...(request.ipVersion?{ipVersion:request.ipVersion}:{}),...(request.df!==undefined?{df:request.df}:{}),comparison,truth,fragmentation:"NOT_MODELED",icmp:"NOT_MODELED",provenance:"ENGINE_MTU_EVALUATION",explanation,...extra};
}

export function evaluateMtuAtEgress(scenario:NormalizedScenario,state:EngineState,request:MtuEvaluationRequest):MtuEvaluationTrace {
  const resource=state.resources[request.resourceId];
  if(!resource||!scenario.resources.some(item=>item.id===request.resourceId)) return base(request,"UNKNOWN","UNKNOWN",[`Resource '${request.resourceId}' is absent from the scenario or Engine state.`]);
  if(!resourceInterface(state,request.resourceId,request.egressInterface)||!scenario.resources.find(item=>item.id===request.resourceId)?.interfaces.some(item=>item.id===request.egressInterface)) return base(request,"UNKNOWN","UNKNOWN",[`Egress interface '${request.resourceId}.${request.egressInterface}' is absent or ambiguous.`]);
  if(request.packetSize===undefined) return base(request,"UNMODELED","UNKNOWN",["Packet size is not modeled; the Engine does not infer it from protocol."]);
  if(!positiveInteger(request.packetSize)) return base(request,"UNKNOWN","UNKNOWN",["Packet size must be a positive integer."]);
  const connection=connectionFor(scenario,request.resourceId,request.egressInterface);
  if(!connection) return base(request,"UNKNOWN","UNKNOWN",[`No enabled network/management connection is mapped to '${request.resourceId}.${request.egressInterface}'.`]);
  const interfaceMtu=readMtu(resourceInterface(state,request.resourceId,request.egressInterface)?.mtu);
  const linkRaw=connection.properties.mtu??connection.properties.linkMtu;
  const linkMtu=readMtu(linkRaw);
  if(Number.isNaN(interfaceMtu)||Number.isNaN(linkMtu)) return base(request,"UNKNOWN","UNKNOWN",["Interface or link MTU is malformed."],{connectionId:connection.id});
  if(interfaceMtu===undefined&&linkMtu===undefined) return base(request,"UNKNOWN","UNKNOWN",["Neither egress interface MTU nor link MTU is modeled."],{connectionId:connection.id});
  const egressMtu=interfaceMtu===undefined?linkMtu!:linkMtu===undefined?interfaceMtu:Math.min(interfaceMtu,linkMtu);
  const comparison=request.packetSize<=egressMtu?"WITHIN_MTU":"EXCEEDS_MTU";
  return base(request,comparison,comparison==="WITHIN_MTU"?"TRUE":"FALSE",[`Packet size ${request.packetSize} bytes ${comparison==="WITHIN_MTU"?"does not exceed":"exceeds"} egress MTU ${egressMtu} bytes.`],{connectionId:connection.id,egressMtu});
}

export function derivePathMtu(scenario:NormalizedScenario,state:EngineState,path:readonly string[]):MtuEvaluationTrace {
  const first=path[0]??"UNKNOWN"; const last=path[path.length-1]??first; const request:MtuEvaluationRequest={resourceId:first,egressInterface:"UNKNOWN",provenPath:path};
  if(path.length<2) return base(request,"UNKNOWN","UNKNOWN",["A proven path with at least two resources is required."]);
  const mtus:number[]=[]; const explanation:string[]=[]; const connectionIds:string[]=[];
  for(let index=0;index<path.length-1;index+=1){ const from=path[index]!,to=path[index+1]!; const connection=[...scenario.connections].filter(item=>item.kind==="network"&&(item.from.resource===from&&item.to.resource===to||item.from.resource===to&&item.to.resource===from&&item.properties.direction!=="forward")).sort((a,b)=>a.id.localeCompare(b.id,"en"))[0]; if(!connection){ return base({...request,resourceId:from,egressInterface:"UNKNOWN"},"UNKNOWN","UNKNOWN",[`Proven path hop '${from}' -> '${to}' has no mapped connection.`]); } connectionIds.push(connection.id); const endpoint=connection.from.resource===from?connection.from:connection.to; const iface=resourceInterface(state,from,endpoint.port??""); const interfaceMtu=readMtu(iface?.mtu); const linkMtu=readMtu(connection.properties.mtu??connection.properties.linkMtu); if(Number.isNaN(interfaceMtu)||Number.isNaN(linkMtu)||interfaceMtu===undefined&&linkMtu===undefined) return base({...request,resourceId:from,egressInterface:endpoint.port??"UNKNOWN"},"UNKNOWN","UNKNOWN",[`Path MTU is incomplete at '${from}' -> '${to}'.`],{connectionId:connection.id}); mtus.push(interfaceMtu===undefined?linkMtu!:linkMtu===undefined?interfaceMtu:Math.min(interfaceMtu,linkMtu)); }
  const pathMtu=Math.min(...mtus); explanation.push(`Path MTU is the minimum of ${mtus.length} fully modeled egress/link MTU values: ${pathMtu} bytes.`); return base({resourceId:first,egressInterface:"PATH",provenPath:path},"UNMODELED","UNKNOWN",explanation,{pathMtu,...(connectionIds[0]?{connectionId:connectionIds[0]}:{})});
}
