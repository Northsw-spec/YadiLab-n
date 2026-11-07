import assert from "node:assert/strict";
import { createInitialEngineState } from "../../dist-observation-engine-test/engine/src/index.js";
import { runActiveProbe } from "../../dist-observation-engine-test/observation-engine/src/index.js";
let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"active_probe_adv",sourceHash:"b".repeat(64),metadata:{title:"Active probe adversarial",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win",type:"windows.workstation",label:"Win",interfaces:[{id:"e0",label:"e0",addresses:["10.0.0.2/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"]}},
{id:"lin",type:"linux.server",label:"Lin",interfaces:[{id:"e0",label:"e0",addresses:["10.0.0.3/24"]}],properties:{}},
{id:"router",type:"network.router",label:"Router",interfaces:[{id:"e0",label:"e0",addresses:["10.0.0.1/24"]}],properties:{}}
],connections:[{id:"w-r",kind:"network",from:{resource:"win"},to:{resource:"router"},properties:{}}],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const state=createInitialEngineState(scenario);
const req=(x)=>runActiveProbe({scenario,state,...x});
await ok("scenario/state mismatch fails closed",()=>{const other={...scenario,sourceHash:"c".repeat(64)};const r=runActiveProbe({scenario:other,state,sourceId:"win",probeId:"windows.ping",destinationId:"router"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_STATE_SCENARIO_MISMATCH");});
await ok("unknown source fails closed",()=>{const r=req({sourceId:"missing",probeId:"windows.ping",destinationId:"router"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_SOURCE_NOT_FOUND");});
await ok("unsupported source fails closed",()=>{const r=req({sourceId:"router",probeId:"windows.ping",destinationId:"win"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_SOURCE_UNSUPPORTED");});
await ok("unknown probe fails closed",()=>{const r=req({sourceId:"win",probeId:"windows.magic",destinationId:"router"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_UNKNOWN");});
await ok("cross-OS probe fails closed",()=>{const r=req({sourceId:"win",probeId:"linux.ping",destinationId:"router"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_OS_MISMATCH");});
await ok("missing destination fails closed",()=>{const r=req({sourceId:"win",probeId:"windows.ping"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_DESTINATION_REQUIRED");});
await ok("unknown destination fails closed",()=>{const r=req({sourceId:"win",probeId:"windows.ping",destinationId:"missing"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_DESTINATION_NOT_FOUND");});
await ok("self destination fails closed",()=>{const r=req({sourceId:"win",probeId:"windows.ping",destinationId:"win"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_SELF_DESTINATION_UNSUPPORTED");});
for(const port of [0,65536,22.5,NaN]) await ok(`invalid TCP port ${String(port)} fails closed`,()=>{const r=req({sourceId:"win",probeId:"windows.test_netconnection",destinationId:"router",port});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_PORT_INVALID");});
for(const name of ["","bad name","../secret","a\nb","a".repeat(254)]) await ok(`invalid DNS name ${JSON.stringify(name)} fails closed`,()=>{const r=req({sourceId:"win",probeId:"windows.resolve_dnsname",queryName:name});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"ACTIVE_PROBE_DNS_NAME_INVALID");});
await ok("missing DNS resolver model becomes UNKNOWN, never fabricated",()=>{const noDns={...state,resources:{...state.resources,win:{...state.resources.win,properties:{defaultGateway:"10.0.0.1"}}}};const r=runActiveProbe({scenario,state:noDns,sourceId:"win",probeId:"windows.resolve_dnsname",queryName:"app.lab"});assert.equal(r.ok,true);assert.equal(r.transcript.truth,"UNKNOWN");assert.equal(r.transcript.resolvedAddress,undefined);assert.equal(r.transcript.dnsChainDecision?.configuredResolversState,"ABSENT");assert.deepEqual(r.transcript.dnsChainDecision?.attempts,[]);});
await ok("malformed DNS resolver list becomes UNKNOWN warning",()=>{const bad={...state,resources:{...state.resources,win:{...state.resources.win,properties:{...state.resources.win.properties,dnsServers:"10.0.0.53"}}}};const r=runActiveProbe({scenario,state:bad,sourceId:"win",probeId:"windows.resolve_dnsname",queryName:"app.lab"});assert.equal(r.ok,true);assert.equal(r.transcript.truth,"UNKNOWN");assert.equal(r.transcript.dnsChainDecision?.configuredResolversState,"MALFORMED");assert.ok(r.diagnostics.some(x=>x.code==="ACTIVE_PROBE_DNS_SERVERS_MALFORMED"));});
await ok("active probe transcript cannot expose hidden fault ground truth",()=>{const r=req({sourceId:"win",probeId:"windows.ping",destinationId:"router"});assert.equal(r.ok,true);const raw=JSON.stringify(r);for(const forbidden of ["hiddenTruth","faultOrigin","canonicalSolution","recoveryOrder","instructorTruth"]) assert.ok(!raw.includes(forbidden));});
await ok("active probe transcript explicitly denies real guest execution",()=>{const r=req({sourceId:"win",probeId:"windows.ping",destinationId:"router"});assert.equal(r.ok,true);assert.equal(r.transcript.modeled,true);assert.equal(r.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");assert.equal(r.transcript.probeMode,"ACTIVE_MODELED_PROBE");assert.ok(r.transcript.lines[0].includes("no Windows guest command"));});
await ok("malformed ACL policy propagates UNKNOWN Engine trace without UI inference",()=>{const bad={...state,resources:{...state.resources,router:{...state.resources.router,properties:{...state.resources.router.properties,acls:{action:"allow"}}}}};const r=runActiveProbe({scenario,state:bad,sourceId:"win",probeId:"windows.ping",destinationId:"router"});assert.equal(r.ok,true);assert.equal(r.transcript.truth,"UNKNOWN");const decision=r.transcript.policyDecisions?.find(x=>x.kind==="ACL"&&x.resourceId==="router");assert.equal(decision?.truth,"UNKNOWN");assert.deepEqual(decision?.rules,[]);assert.equal(decision?.selectedPolicyId,undefined);});

await ok("malformed VLAN switchport propagates UNKNOWN evidence without fabrication",()=>{
 const vlanScenario=structuredClone(scenario);
 const win=vlanScenario.resources.find(r=>r.id==="win"); const lin=vlanScenario.resources.find(r=>r.id==="lin");
 win.interfaces=[{id:"e0",label:"e0",addresses:["10.0.0.2/24"],mac:"02:00:00:00:00:02"}]; win.properties.defaultGateway=undefined;
 lin.interfaces=[{id:"e0",label:"e0",addresses:["10.0.0.3/24"],mac:"02:00:00:00:00:03"}]; lin.properties.http={enabled:true,port:80,protocol:"tcp"};
 vlanScenario.resources.push({id:"sw",type:"network.switch",label:"SW",interfaces:[
   {id:"p1",label:"p1",addresses:[],switchport:{mode:"access"}},
   {id:"p2",label:"p2",addresses:[],switchport:{mode:"access",accessVlan:10}},
 ],properties:{}});
 vlanScenario.connections=[
   {id:"w-sw",kind:"network",from:{resource:"win",port:"e0"},to:{resource:"sw",port:"p1"},properties:{}},
   {id:"sw-l",kind:"network",from:{resource:"sw",port:"p2"},to:{resource:"lin",port:"e0"},properties:{}},
 ];
 const vlanState=createInitialEngineState(vlanScenario);
 const r=runActiveProbe({scenario:vlanScenario,state:vlanState,sourceId:"win",probeId:"windows.test_netconnection",destinationId:"lin",port:80});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.vlanDecisions?.length,1); assert.equal(r.transcript.vlanDecisions?.[0]?.truth,"UNKNOWN");
 assert.equal(r.transcript.vlanDecisions?.[0]?.vlan,undefined); assert.equal(r.transcript.vlanDecisions?.[0]?.rewrite,"UNKNOWN");
});

await ok("partial STP port model propagates UNKNOWN trace without forwarding invention",()=>{
 const stpScenario=structuredClone(scenario);
 const win=stpScenario.resources.find(r=>r.id==="win"); const lin=stpScenario.resources.find(r=>r.id==="lin");
 win.interfaces=[{id:"e0",label:"e0",addresses:["10.0.0.2/24"],mac:"02:00:00:00:00:02"}]; win.properties.defaultGateway=undefined;
 lin.interfaces=[{id:"e0",label:"e0",addresses:["10.0.0.3/24"],mac:"02:00:00:00:00:03"}]; lin.properties.http={enabled:true,port:80,protocol:"tcp"};
 stpScenario.resources.push({id:"sw",type:"network.switch",label:"SW",interfaces:[{id:"p1",label:"p1",addresses:[]},{id:"p2",label:"p2",addresses:[]}],properties:{stp:{protocol:"RSTP",bridgeId:"b1",rootBridgeId:"b1"},stpPorts:[{interface:"p1",role:"DESIGNATED",state:"FORWARDING"}]}});
 stpScenario.connections=[{id:"w-sw",kind:"network",from:{resource:"win",port:"e0"},to:{resource:"sw",port:"p1"},properties:{}},{id:"sw-l",kind:"network",from:{resource:"sw",port:"p2"},to:{resource:"lin",port:"e0"},properties:{}}];
 const r=runActiveProbe({scenario:stpScenario,state:createInitialEngineState(stpScenario),sourceId:"win",probeId:"windows.test_netconnection",destinationId:"lin",port:80});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN"); assert.equal(r.transcript.stpDecisions?.length,1); assert.equal(r.transcript.stpDecisions?.[0]?.truth,"UNKNOWN"); assert.equal(r.transcript.stpDecisions?.[0]?.egressInterface,"p2");
});

await ok("malformed DNAT translation propagates UNKNOWN Engine NAT trace without fabrication",()=>{
 const natScenario=structuredClone(scenario);
 const lin=natScenario.resources.find(r=>r.id==="lin"); const router=natScenario.resources.find(r=>r.id==="router");
 lin.properties.http={enabled:true,port:80,protocol:"tcp"};
 router.properties.routes=[{id:"route-lin",destination:"lin",via:"lin",action:"forward",enabled:true}];
 router.properties.natPolicy="required";
 router.properties.natRules=[{id:"bad-dnat",type:"dnat",source:"win",destination:"lin",protocol:"tcp",externalPort:80,translatedPort:70000}];
 natScenario.connections=[
   {id:"w-r",kind:"network",from:{resource:"win"},to:{resource:"router"},properties:{}},
   {id:"r-l",kind:"network",from:{resource:"router"},to:{resource:"lin"},properties:{}},
 ];
 const natState=createInitialEngineState(natScenario);
 const r=runActiveProbe({scenario:natScenario,state:natState,sourceId:"win",probeId:"windows.test_netconnection",destinationId:"lin",port:80});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.natDecisions?.length,1); assert.equal(r.transcript.natDecisions?.[0]?.kind,"DNAT");
 assert.equal(r.transcript.natDecisions?.[0]?.truth,"UNKNOWN"); assert.equal(r.transcript.natDecisions?.[0]?.transformation,"UNKNOWN");
 assert.equal(r.transcript.natDecisions?.[0]?.rules?.[0]?.disposition,"MALFORMED"); assert.equal(r.transcript.natDecisions?.[0]?.selectedRuleId,undefined);
});


await ok("malformed conntrack propagates UNKNOWN Engine session trace without fabrication",()=>{
 const ctScenario=structuredClone(scenario);
 const lin=ctScenario.resources.find(r=>r.id==="lin"); const router=ctScenario.resources.find(r=>r.id==="router");
 lin.properties.http={enabled:true,port:80,protocol:"tcp"};
 router.type="network.firewall";
 router.properties.rules=[{id:"allow-established",source:"win",destination:"lin",protocol:"tcp",port:80,connectionState:"ESTABLISHED",action:"allow"}];
 router.properties.defaultAction="deny";
 router.properties.conntrack={complete:true,entries:[{id:"ct1",source:"bad-ip",destination:"lin",protocol:"tcp",port:80,state:"ESTABLISHED"}]};
 ctScenario.connections=[{id:"w-r",kind:"network",from:{resource:"win"},to:{resource:"router"},properties:{}},{id:"r-l",kind:"network",from:{resource:"router"},to:{resource:"lin"},properties:{}}];
 const r=runActiveProbe({scenario:ctScenario,state:createInitialEngineState(ctScenario),sourceId:"win",probeId:"windows.test_netconnection",destinationId:"lin",port:80});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.conntrackDecisions?.length,1); assert.equal(r.transcript.conntrackDecisions?.[0]?.truth,"UNKNOWN");
 assert.equal(r.transcript.conntrackDecisions?.[0]?.entries?.[0]?.disposition,"MALFORMED"); assert.equal(r.transcript.conntrackDecisions?.[0]?.selectedEntryId,undefined);
 const policy=r.transcript.policyDecisions?.find(x=>x.kind==="FIREWALL"&&x.resourceId==="router"); assert.equal(policy?.rules?.[0]?.connectionStateMatch,"UNKNOWN");
});


await ok("malformed local-firewall marker propagates UNKNOWN without fabricated scope",()=>{
 const malformedScenario=structuredClone(scenario);
 const malformedState=createInitialEngineState(malformedScenario);
 const bad={...malformedState,resources:{...malformedState.resources,router:{...malformedState.resources.router,properties:{...malformedState.resources.router.properties,isFirewall:"yes"}}}};
 const r=runActiveProbe({scenario:malformedScenario,state:bad,sourceId:"win",probeId:"windows.ping",destinationId:"router"});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.blockingPoint,"router");
 assert.equal(r.transcript.policyDecisions?.some(x=>x.kind==="FIREWALL"&&x.resourceId==="router") ?? false,false);
});

await ok("local firewall policy without marker fails closed without fabricated scope",()=>{
 const localScenario=structuredClone(scenario);
 const router=localScenario.resources.find(r=>r.id==="router");
 const localState=createInitialEngineState(localScenario);
 const bad={...localState,resources:{...localState.resources,router:{...localState.resources.router,properties:{...localState.resources.router.properties,rules:[{id:"allow",action:"allow"}],defaultAction:"deny"}}}};
 const r=runActiveProbe({scenario:localScenario,state:bad,sourceId:"win",probeId:"windows.ping",destinationId:"router"});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.blockingPoint,"router");
 assert.equal(r.transcript.policyDecisions?.some(x=>x.kind==="FIREWALL"&&x.resourceId==="router") ?? false,false);
});


await ok("malformed host-stack propagates UNKNOWN ownership trace without partial fabrication",()=>{
 const hostScenario=structuredClone(scenario);
 const router=hostScenario.resources.find(r=>r.id==="router");
 router.properties.http={enabled:true,port:80,protocol:"tcp"};
 const hostState=createInitialEngineState(hostScenario);
 const bad={...hostState,resources:{...hostState.resources,router:{...hostState.resources.router,properties:{...hostState.resources.router.properties,hostStack:{complete:true,processes:[{id:"p",name:"svc",service:"http"}],sockets:[{id:"s",protocol:"tcp",localAddress:"0.0.0.0",localPort:80,state:"LISTEN",processId:"ghost",service:"http"}]}}}}};
 const r=runActiveProbe({scenario:hostScenario,state:bad,sourceId:"win",probeId:"windows.test_netconnection",destinationId:"router",port:80});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.hostStackDecision?.truth,"UNKNOWN");
 assert.equal(r.transcript.hostStackDecision?.model,"EXPLICIT_HOST_STACK");
 assert.deepEqual(r.transcript.hostStackDecision?.processes,[]); assert.deepEqual(r.transcript.hostStackDecision?.sockets,[]);
 assert.deepEqual(r.transcript.hostStackDecision?.selectedSocketIds,[]); assert.equal(r.transcript.hostStackDecision?.listenerConsistency,"UNMODELED");
 assert.equal(r.transcript.listenerServiceDecision?.truth,"UNKNOWN");
 assert.equal(r.transcript.listenerServiceDecision?.model,"EXPLICIT_HOST_STACK");
 assert.equal(r.transcript.listenerServiceDecision?.disposition,"MALFORMED");
 assert.deepEqual(r.transcript.listenerServiceDecision?.selectedSocketIds,[]);
 assert.equal(r.transcript.tcpStateMachineDecision?.truth,"UNKNOWN");
 assert.equal(r.transcript.tcpStateMachineDecision?.disposition,"MALFORMED");
 assert.deepEqual(r.transcript.tcpStateMachineDecision?.socketRows,[]);
});


await ok("DHCP probe missing client DHCP state remains UNKNOWN without fabricated lease",()=>{
 const r=req({sourceId:"win",probeId:"windows.ipconfig_renew"});
 assert.equal(r.ok,true); assert.equal(r.transcript.category,"dhcp"); assert.equal(r.transcript.truth,"UNKNOWN");
 assert.equal(r.transcript.dhcpDoraDecision?.clientState,"ABSENT"); assert.equal(r.transcript.dhcpDoraDecision?.offeredAddress,undefined);
 assert.deepEqual(r.transcript.dhcpDoraDecision?.attempts,[]); assert.equal(r.transcript.destinationId,undefined);
});
await ok("DHCP probe malformed client DHCP state fails closed as UNKNOWN",()=>{
 const bad={...state,resources:{...state.resources,win:{...state.resources.win,properties:{...state.resources.win.properties,dhcp:{enabled:"yes"}}}}};
 const r=runActiveProbe({scenario,state:bad,sourceId:"win",probeId:"windows.ipconfig_renew"});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"UNKNOWN"); assert.equal(r.transcript.dhcpDoraDecision?.clientState,"MALFORMED");
 assert.equal(r.transcript.dhcpDoraDecision?.selectedServerResourceId,undefined); assert.equal(r.transcript.dhcpDoraDecision?.offeredAddress,undefined);
});
await ok("DHCP probe through L3 router does not fabricate relay",()=>{
 const sc=structuredClone(scenario); const win=sc.resources.find(r=>r.id==="win"); win.properties.dhcp={enabled:true};
 sc.resources.push({id:"dhcp1",type:"network.dhcp_server",label:"DHCP",interfaces:[{id:"e0",label:"e0",addresses:["10.0.1.2/24"]}],properties:{dhcp:{enabled:true,availableLeases:2,offers:[{client:"win",address:"10.0.0.50"}],prefixLength:24}}});
 sc.connections.push({id:"r-dhcp",kind:"network",from:{resource:"router"},to:{resource:"dhcp1"},properties:{}});
 const r=runActiveProbe({scenario:sc,state:createInitialEngineState(sc),sourceId:"win",probeId:"windows.ipconfig_renew"});
 assert.equal(r.ok,true); assert.equal(r.transcript.truth,"FALSE"); assert.equal(r.transcript.dhcpDoraDecision?.attempts[0]?.disposition,"L2_BLOCKED");
 assert.equal(r.transcript.dhcpDoraDecision?.selectedServerResourceId,undefined); assert.equal(r.transcript.dhcpDoraDecision?.offeredAddress,undefined);
});

console.log(`PASS Diagnostic / Observation Engine Wave 2 active probes adversarial: ${pass}/${pass} assertions.`);
