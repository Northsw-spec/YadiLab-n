import assert from "node:assert/strict";
import fs from "node:fs";
import { createInitialEngineState } from "../../dist-observation-engine-test/engine/src/index.js";
import { injectFault } from "../../dist-observation-engine-test/fault-engine/src/index.js";
import {
  OBSERVATION_ENGINE_VERSION,
  listActiveProbeDefinitions,
  listActiveProbeDestinations,
  runActiveProbe,
} from "../../dist-observation-engine-test/observation-engine/src/index.js";

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const windowsPack=JSON.parse(fs.readFileSync("fault-packs/builtin/windows-core.json","utf8"));
const linuxPack=JSON.parse(fs.readFileSync("fault-packs/builtin/linux-core.json","utf8"));
const networkPack=JSON.parse(fs.readFileSync("fault-packs/builtin/network-core.json","utf8"));

const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"active_probe_lab",sourceHash:"9".repeat(64),metadata:{title:"Active probe lab",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Windows client",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.1.53"],dhcp:{enabled:true},aclDefaultAction:"allow",rdp:{enabled:true,port:3389,protocol:"tcp"}}},
{id:"linux1",type:"linux.workstation",label:"Linux client",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.1.53"],dhcp:{enabled:true},aclDefaultAction:"allow",ssh:{enabled:true,port:22,protocol:"tcp"}}},
{id:"r1",type:"network.router",label:"Router",interfaces:[{id:"lan",label:"LAN",addresses:["10.0.0.1/24","10.0.1.1/24","10.0.2.1/24"]}],properties:{routes:[{id:"route-app",destination:"app1",via:"app1",action:"forward",enabled:true},{id:"route-dns",destination:"dns1",via:"dns1",action:"forward",enabled:true}],neighbors:[{id:"neighbor-app",targetResourceId:"app1",protocol:"ARP",address:"10.0.2.80",mac:"02:00:00:00:02:80",interface:"lan",state:"REACHABLE"},{id:"neighbor-dns",targetResourceId:"dns1",protocol:"ARP",address:"10.0.1.53",mac:"02:00:00:00:01:53",interface:"lan",state:"STALE"}]}},
{id:"dns1",type:"network.dns_server",label:"DNS",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.1.53/24"]}],properties:{dns:{enabled:true,records:[{name:"app.lab.test",address:"10.0.2.80"}]}}},
{id:"app1",type:"linux.server",label:"Application server",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.2.80/24"]}],properties:{http:{enabled:true,port:80,protocol:"tcp"},ssh:{enabled:true,port:22,protocol:"tcp"}}}
],connections:[
{id:"win-r1",kind:"network",from:{resource:"win1"},to:{resource:"r1"},properties:{}},
{id:"lin-r1",kind:"network",from:{resource:"linux1"},to:{resource:"r1"},properties:{}},
{id:"win-lin",kind:"network",from:{resource:"win1"},to:{resource:"linux1"},properties:{}},
{id:"r1-dns",kind:"network",from:{resource:"r1"},to:{resource:"dns1"},properties:{}},
{id:"r1-app",kind:"network",from:{resource:"r1"},to:{resource:"app1"},properties:{}}
],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const initial=createInitialEngineState(scenario);
const text=(r)=>r.ok?r.transcript.lines.join("\n"):"";
const probe=(state,args)=>runActiveProbe({scenario,state,...args});
const inject=async(pack,faultId,target,seed=1,state=initial)=>{const r=await injectFault({scenario,state,pack,faultId,bindings:{target},seed,mode:"RUNTIME_INJECTION"});ok(r.ok,`${faultId} injects for active-probe test`);return r.ok?r.state:state;};

{
 const win=listActiveProbeDefinitions(initial,"win1"); const lin=listActiveProbeDefinitions(initial,"linux1");
 eq(win.length,6,"Windows exposes six active probes including UDP delivery and DHCP DORA"); eq(lin.length,6,"Linux exposes six active probes including UDP delivery and DHCP DORA");
 ok(win.every(x=>x.os==="windows"),"Windows probes are OS-scoped"); ok(lin.every(x=>x.os==="linux"),"Linux probes are OS-scoped");
 eq(listActiveProbeDefinitions(initial,"r1"),[],"router is not falsely exposed as guest active-probe source");
 eq(listActiveProbeDestinations(initial,"win1").map(x=>x.id),["app1","dns1","linux1","r1"],"destination catalog is deterministic and excludes source");
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"}); ok(r.ok,"Windows modeled ping runs"); if(r.ok){eq(r.transcript.truth,"TRUE","Windows ping proves healthy ICMP reachability");eq(r.transcript.engineVersion,OBSERVATION_ENGINE_VERSION,"active probe uses current observation engine version");eq(r.transcript.modeled,true,"active probe explicitly modeled");eq(r.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION","active probe boundary explicit");eq(r.transcript.probeMode,"ACTIVE_MODELED_PROBE","active probe mode explicit");eq(r.transcript.path,["win1","r1","app1"],"ping exposes deterministic path");eq(r.transcript.routeDecisions?.length,1,"active probe carries the Engine route trace");eq(r.transcript.routeDecisions?.[0]?.resourceId,"r1","active probe preserves route-decision resource");eq(r.transcript.routeDecisions?.[0]?.selectedRouteId,"route-app","active probe preserves exact Engine route winner");eq(r.transcript.neighborDecisions?.length,1,"active probe carries the Engine neighbor trace");eq(r.transcript.neighborDecisions?.[0]?.resourceId,"r1","active probe preserves neighbor-decision resource");eq(r.transcript.neighborDecisions?.[0]?.selectedEntryId,"neighbor-app","active probe preserves exact Engine neighbor selection");eq(r.transcript.neighborDecisions?.[0]?.selectedMac,"02:00:00:00:02:80","active probe preserves modeled MAC without synthesis");eq(r.transcript.policyDecisions?.length,1,"active probe carries Engine-owned policy decision trace");eq(r.transcript.policyDecisions?.[0]?.kind,"ACL","active probe preserves policy decision kind");eq(r.transcript.policyDecisions?.[0]?.selectedPolicyId,"win1.aclDefaultAction","active probe preserves exact Engine default-policy identity");eq(r.transcript.policyDecisions?.[0]?.usedDefault,true,"active probe preserves Engine default-action provenance");ok(text(r).includes("no Windows guest command or PowerShell executed"),"ping transcript denies real execution");ok(text(r).includes("default gateway '10.0.0.1' maps"),"off-link ping verifies modeled gateway mapping");}
}
{
 const r=probe(initial,{sourceId:"linux1",probeId:"linux.ping",destinationId:"app1"}); ok(r.ok,"Linux modeled ping runs"); if(r.ok){eq(r.transcript.truth,"TRUE","Linux ping proves healthy ICMP reachability");eq(r.transcript.path,["linux1","r1","app1"],"Linux ping exposes path");}
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});ok(r.ok,"Test-NetConnection modeled probe runs");if(r.ok){eq(r.transcript.truth,"TRUE","TCP/80 succeeds");eq(r.transcript.port,80,"port preserved");ok(text(r).includes("declared enabled service")||text(r).includes("declared enabled service"),"listener evidence appears");}
 const closed=probe(initial,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:443});ok(closed.ok,"closed-port modeled probe runs");if(closed.ok){eq(closed.transcript.truth,"FALSE","undeclared TCP/443 fails");eq(closed.transcript.blockingPoint,"app1","closed port blocks at destination");}
}
{
 const r=probe(initial,{sourceId:"linux1",probeId:"linux.nc_tcp",destinationId:"app1",port:22});ok(r.ok,"Linux nc modeled probe runs");if(r.ok){eq(r.transcript.truth,"TRUE","TCP/22 succeeds");ok(text(r).includes("nc -vz")===false,"transcript lines remain evidence, command stored separately");eq(r.transcript.command,"nc -vz app1 22","Linux command-shaped surface deterministic");}
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.tracert",destinationId:"app1"});ok(r.ok,"Windows tracert modeled probe runs");if(r.ok){eq(r.transcript.truth,"TRUE","healthy path probe true");ok(text(r).includes("2\tr1"),"tracert shows router hop");ok(text(r).includes("3\tapp1"),"tracert shows destination hop");}
 const l=probe(initial,{sourceId:"linux1",probeId:"linux.tracepath",destinationId:"app1"});ok(l.ok,"Linux tracepath modeled probe runs");if(l.ok){eq(l.transcript.truth,"TRUE","healthy Linux path true");eq(l.transcript.command,"tracepath app1","tracepath command surface deterministic");}
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.resolve_dnsname",queryName:"App.Lab.Test."});ok(r.ok,"Windows DNS modeled probe runs");if(r.ok){eq(r.transcript.truth,"TRUE","DNS healthy answer succeeds");eq(r.transcript.queryName,"app.lab.test","DNS query canonicalized case/trailing dot");eq(r.transcript.resolvedAddress,"10.0.2.80","DNS answer comes from modeled record");eq(r.transcript.resolvedResourceIds,["app1"],"DNS answer maps to declared resource");eq(r.transcript.dnsChainDecision?.truth,"TRUE","DNS transcript carries Engine-owned chain truth");eq(r.transcript.dnsChainDecision?.attempts[0]?.disposition,"RESOLVED","DNS transcript carries exact resolver-stage disposition");eq(r.transcript.dnsChainDecision?.selectedResolverResourceId,"dns1","DNS transcript binds selected resolver resource");ok(text(r).includes("Resolver: 10.0.1.53 (dns1)"),"resolver identity shown");}
 const l=probe(initial,{sourceId:"linux1",probeId:"linux.dig",queryName:"app.lab.test"});ok(l.ok,"Linux dig modeled probe runs");if(l.ok){eq(l.transcript.truth,"TRUE","Linux dig answer succeeds");eq(l.transcript.resolvedAddress,"10.0.2.80","Linux dig returns same modeled record");}
}
{
 const wrong=await inject(windowsPack,"windows.routing.set_wrong_default_gateway","win1",0x710001);
 const r=probe(wrong,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});ok(r.ok,"wrong-gateway ping runs");if(r.ok){eq(r.transcript.truth,"FALSE","wrong default gateway blocks off-link active probe");eq(r.transcript.blockingPoint,"win1","wrong gateway blocks at source");ok(text(r).includes("not on-link")||text(r).includes("does not map to any intermediate next-hop"),"wrong gateway reason explicit");}
}
{
 const wrong=await inject(linuxPack,"linux.routing.set_wrong_default_gateway","linux1",0x710002);
 const r=probe(wrong,{sourceId:"linux1",probeId:"linux.ping",destinationId:"app1"});ok(r.ok,"Linux wrong-gateway ping runs");if(r.ok){eq(r.transcript.truth,"FALSE","Linux wrong default gateway blocks off-link probe");eq(r.transcript.blockingPoint,"linux1","Linux wrong gateway blocks at source");}
}

{
 const wrong=await inject(windowsPack,"windows.routing.set_wrong_default_gateway","win1",0x710011);
 const local=probe(wrong,{sourceId:"win1",probeId:"windows.ping",destinationId:"linux1"});ok(local.ok,"wrong-gateway local-subnet ping runs");if(local.ok){eq(local.transcript.truth,"TRUE","wrong default gateway does not break same-subnet modeled ping");}
 const offlink=probe(wrong,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});ok(offlink.ok,"wrong-gateway off-subnet ping reruns");if(offlink.ok){eq(offlink.transcript.truth,"FALSE","same wrong gateway breaks off-subnet modeled ping");ok(text(offlink).includes("not on-link")||text(offlink).includes("does not map"),"gateway failure explains modeled next-hop problem");}
}
{
 const removed=await inject(networkPack,"routing.remove_default_gateway","win1",0x710012);
 const r=probe(removed,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});ok(r.ok,"removed-gateway active probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","removed gateway blocks known off-link destination");eq(r.transcript.blockingPoint,"win1","missing gateway blocks at source");}
}
{
 const apipa=await inject(windowsPack,"windows.interface.set_apipa_address","win1",0x710013);
 const r=probe(apipa,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});ok(r.ok,"APIPA active probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","APIPA plus old gateway cannot reach off-link application");ok(text(r).includes("not on-link"),"APIPA failure identifies unreachable modeled gateway");}
}


{
 const denied=await inject(windowsPack,"windows.firewall.force_default_deny","win1",0x710014);
 const r=probe(denied,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});ok(r.ok,"Windows default-deny active TCP probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","Windows host default-deny blocks unmatched active probe");eq(r.transcript.blockingPoint,"win1","Windows host policy blocks at source");ok(text(r).includes("ACL default action"),"Windows host firewall reason explicit");}
}
{
 const denied=await inject(linuxPack,"linux.firewall.force_default_deny","linux1",0x710015);
 const r=probe(denied,{sourceId:"linux1",probeId:"linux.nc_tcp",destinationId:"app1",port:80});ok(r.ok,"Linux default-deny active TCP probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","Linux host default-deny blocks unmatched active probe");eq(r.transcript.blockingPoint,"linux1","Linux host policy blocks at source");}
}

{
 const wrongDns=await inject(windowsPack,"windows.dns.replace_resolvers","win1",0x710003);
 const r=probe(wrongDns,{sourceId:"win1",probeId:"windows.resolve_dnsname",queryName:"app.lab.test"});ok(r.ok,"wrong-resolver DNS probe runs");if(r.ok){ok(r.transcript.truth!=="TRUE","wrong resolver cannot produce fabricated success");eq(r.transcript.resolvedAddress,undefined,"wrong resolver does not invent DNS answer");ok(text(r).includes("no declared network.dns_server matches"),"wrong resolver mapping failure visible");}
}
{
 const off=await inject(networkPack,"dns.disable_server","dns1",0x710004);
 const r=probe(off,{sourceId:"win1",probeId:"windows.resolve_dnsname",queryName:"app.lab.test"});ok(r.ok,"disabled DNS server probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","disabled DNS service yields deterministic failure");ok(text(r).includes("DNS service is disabled"),"disabled service reason visible");}
}
{
 const corrupt=await inject(networkPack,"dns.corrupt_primary_record","dns1",0x710005);
 const r=probe(corrupt,{sourceId:"win1",probeId:"windows.resolve_dnsname",queryName:"app.lab.test"});ok(r.ok,"corrupt DNS record probe runs");if(r.ok){eq(r.transcript.truth,"TRUE","corrupt record still resolves syntactically");ok(["192.0.2.80","198.51.100.80","203.0.113.80"].includes(r.transcript.resolvedAddress),"corrupt record returns deterministic wrong documentation address");eq(r.transcript.resolvedResourceIds,[],"wrong DNS answer maps to no declared resource");ok(text(r).includes("<no declared resource matches returned address>"),"wrong answer mapping evidence explicit");}
}
{
 const appOff=await inject(linuxPack,"linux.http.disable_service","app1",0x710006);
 const r=probe(appOff,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});ok(r.ok,"disabled HTTP TCP probe runs");if(r.ok){eq(r.transcript.truth,"FALSE","disabled HTTP service blocks TCP/80");eq(r.transcript.blockingPoint,"app1","disabled service blocks at app target");}
}
{
 const badRoute=await inject(networkPack,"routing.set_wrong_next_hop","r1",0x710007);
 const r=probe(badRoute,{sourceId:"win1",probeId:"windows.tracert",destinationId:"app1"});ok(r.ok,"wrong router next-hop trace runs");if(r.ok){eq(r.transcript.truth,"FALSE","wrong next hop blocks path");eq(r.transcript.blockingPoint,"r1","path reports router as blocking point");ok(text(r).includes("1\twin1")&&text(r).includes("2\tr1"),"trace shows only proven hops through blocking point");ok(!text(r).includes("3\tapp1"),"trace does not claim destination reached after block");}
}
{
 const before=JSON.stringify(initial);const a=probe(initial,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});const b=probe(initial,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});eq(a,b,"same state and request produce byte-stable active-probe result");eq(JSON.stringify(initial),before,"active probes never mutate Engine state");
}


{
 const swScenario=structuredClone(scenario);
 const win=swScenario.resources.find(r=>r.id==="win1"); const app=swScenario.resources.find(r=>r.id==="app1");
 win.interfaces=[{id:"eth0",label:"Ethernet",addresses:["10.0.2.10/24"],mac:"02:00:00:00:02:10"}]; win.properties.defaultGateway=undefined;
 app.interfaces=[{id:"eth0",label:"eth0",addresses:["10.0.2.80/24"],mac:"02:00:00:00:02:80"}];
 swScenario.resources.push({id:"sw01",type:"network.switch",label:"SW01",interfaces:[{id:"p1",label:"p1",addresses:[]},{id:"p2",label:"p2",addresses:[]}],properties:{macTable:[{id:"dst",mac:"02:00:00:00:02:80",interface:"p2"}]}});
 swScenario.connections=[{id:"win-sw",kind:"network",from:{resource:"win1",port:"eth0"},to:{resource:"sw01",port:"p1"},properties:{}},{id:"sw-app",kind:"network",from:{resource:"sw01",port:"p2"},to:{resource:"app1",port:"eth0"},properties:{}}];
 const swState=createInitialEngineState(swScenario);
 const r=runActiveProbe({scenario:swScenario,state:swState,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"switching active probe runs"); if(r.ok){eq(r.transcript.truth,"TRUE","switching active probe remains reachable");eq(r.transcript.macDecisions?.length,1,"active probe carries Engine MAC decision");eq(r.transcript.macDecisions?.[0]?.resourceId,"sw01","MAC decision binds to switch");eq(r.transcript.macDecisions?.[0]?.forwarding,"UNICAST","active probe preserves exact Engine unicast decision");eq(r.transcript.macDecisions?.[0]?.selectedEgressInterface,"p2","active probe preserves exact Engine egress");}
 const floodScenario=structuredClone(swScenario);
 floodScenario.resources.find(r=>r.id==="sw01").properties.macTable=[];
 const floodState=createInitialEngineState(floodScenario);
 const flood=runActiveProbe({scenario:floodScenario,state:floodState,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(flood.ok,"switching flood active probe runs"); if(flood.ok){eq(flood.transcript.macDecisions?.[0]?.learning,"LEARNED","active probe preserves Engine source-MAC learning disposition");eq(flood.transcript.macDecisions?.[0]?.forwarding,"FLOOD","active probe preserves Engine flood decision");eq(flood.transcript.macDecisions?.[0]?.floodInterfaces,["p2"],"active probe preserves exact Engine flood set");}
}



{
 const vlanScenario=structuredClone(scenario);
 const win=vlanScenario.resources.find(r=>r.id==="win1"); const app=vlanScenario.resources.find(r=>r.id==="app1");
 win.interfaces=[{id:"eth0",label:"Ethernet",addresses:["10.0.2.10/24"],mac:"02:00:00:00:02:10"}]; win.properties.defaultGateway=undefined;
 app.interfaces=[{id:"eth0",label:"eth0",addresses:["10.0.2.80/24"],mac:"02:00:00:00:02:80"}];
 vlanScenario.resources.push({id:"swv1",type:"network.switch",label:"SW VLAN 1",interfaces:[
   {id:"p1",label:"p1",addresses:[],switchport:{mode:"access",accessVlan:10}},
   {id:"p2",label:"p2",addresses:[],switchport:{mode:"trunk",allowedVlans:[10,20]}},
 ],properties:{}});
 vlanScenario.resources.push({id:"swv2",type:"network.switch",label:"SW VLAN 2",interfaces:[
   {id:"p1",label:"p1",addresses:[],switchport:{mode:"trunk",allowedVlans:[10,20]}},
   {id:"p2",label:"p2",addresses:[],switchport:{mode:"access",accessVlan:10}},
 ],properties:{}});
 vlanScenario.connections=[
   {id:"win-swv1",kind:"network",from:{resource:"win1",port:"eth0"},to:{resource:"swv1",port:"p1"},properties:{}},
   {id:"swv1-swv2",kind:"network",from:{resource:"swv1",port:"p2"},to:{resource:"swv2",port:"p1"},properties:{}},
   {id:"swv2-app",kind:"network",from:{resource:"swv2",port:"p2"},to:{resource:"app1",port:"eth0"},properties:{}},
 ];
 const vlanState=createInitialEngineState(vlanScenario);
 const r=runActiveProbe({scenario:vlanScenario,state:vlanState,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"VLAN switching active probe runs"); if(r.ok){
   eq(r.transcript.truth,"TRUE","VLAN active probe preserves reachable Engine verdict");
   eq(r.transcript.vlanDecisions?.length,2,"active probe carries both Engine VLAN decisions");
   eq(r.transcript.vlanDecisions?.map(d=>d.resourceId),["swv1","swv2"],"active probe preserves VLAN decision order");
   eq(r.transcript.vlanDecisions?.map(d=>d.rewrite),["ADD_TAG","REMOVE_TAG"],"active probe preserves exact tag add/remove rewrites");
   eq(r.transcript.vlanDecisions?.[0]?.vlan,10,"active probe preserves Engine-classified VLAN id");
   eq(r.transcript.vlanDecisions?.[1]?.ingressTag,"TAGGED","active probe carries Engine frame tag state to second switch");
 }
}

{
 const stpScenario=structuredClone(scenario);
 const win=stpScenario.resources.find(r=>r.id==="win1"); const app=stpScenario.resources.find(r=>r.id==="app1");
 win.interfaces=[{id:"eth0",label:"Ethernet",addresses:["10.0.2.10/24"],mac:"02:00:00:00:02:10"}]; win.properties.defaultGateway=undefined;
 app.interfaces=[{id:"eth0",label:"eth0",addresses:["10.0.2.80/24"],mac:"02:00:00:00:02:80"}];
 stpScenario.resources.push({id:"sws",type:"network.switch",label:"SW STP",interfaces:[
   {id:"p1",label:"p1",addresses:[]},{id:"p2",label:"p2",addresses:[]},
 ],properties:{macTable:[{id:"dst",mac:"02:00:00:00:02:80",interface:"p2"}],stp:{protocol:"RSTP",bridgeId:"b1",rootBridgeId:"root",rootPathCost:4},stpPorts:[
   {interface:"p1",role:"ROOT",state:"FORWARDING",bpdu:"RECEIVE"},{interface:"p2",role:"DESIGNATED",state:"FORWARDING",bpdu:"SEND"},
 ]}});
 stpScenario.connections=[
   {id:"win-sws",kind:"network",from:{resource:"win1",port:"eth0"},to:{resource:"sws",port:"p1"},properties:{}},
   {id:"sws-app",kind:"network",from:{resource:"sws",port:"p2"},to:{resource:"app1",port:"eth0"},properties:{}},
 ];
 const stpState=createInitialEngineState(stpScenario);
 const r=runActiveProbe({scenario:stpScenario,state:stpState,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"STP active probe runs"); if(r.ok){eq(r.transcript.truth,"TRUE","STP active probe preserves reachable Engine verdict");eq(r.transcript.stpDecisions?.length,1,"active probe carries Engine STP decision");eq(r.transcript.stpDecisions?.[0]?.rootBridgeId,"root","active probe preserves Engine root identity");eq(r.transcript.stpDecisions?.[0]?.ports.find(p=>p.interfaceId==="p2")?.bpdu,"SEND","active probe preserves explicit BPDU direction");}
}

{
 const natScenario=structuredClone(scenario);
 const router=natScenario.resources.find(r=>r.id==="r1");
 router.properties.natPolicy="required";
 router.properties.snatPolicy="required";
 router.properties.natRules=[
   {id:"app-port-forward",type:"dnat",source:"win1",destination:"app1",protocol:"tcp",externalPort:8080,translatedPort:80},
   {id:"app-source-nat",type:"snat",source:"win1",destination:"app1",protocol:"tcp",port:80,translatedSource:"198.51.100.7"},
 ];
 const natState=createInitialEngineState(natScenario);
 const r=runActiveProbe({scenario:natScenario,state:natState,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:8080});
 ok(r.ok,"NAT/PAT active probe runs"); if(r.ok){
   eq(r.transcript.truth,"TRUE","NAT/PAT active probe preserves reachable Engine verdict");
   eq(r.transcript.natDecisions?.map(d=>d.kind),["DNAT","SNAT"],"active probe preserves ordered Engine NAT decision traces");
   eq(r.transcript.natDecisions?.[0]?.selectedRuleId,"app-port-forward","active probe preserves exact DNAT winner");
   eq(r.transcript.natDecisions?.[0]?.inputPort,8080,"active probe preserves DNAT input port");
   eq(r.transcript.natDecisions?.[0]?.outputPort,80,"active probe preserves DNAT translated port");
   eq(r.transcript.natDecisions?.[0]?.transformation,"TRANSLATED","active probe preserves DNAT transformation disposition");
   eq(r.transcript.natDecisions?.[1]?.selectedRuleId,"app-source-nat","active probe preserves exact SNAT winner");
   eq(r.transcript.natDecisions?.[1]?.inputSource,"10.0.0.10","active probe preserves SNAT input source");
   eq(r.transcript.natDecisions?.[1]?.outputSource,"198.51.100.7","active probe preserves SNAT translated source");
   eq(r.transcript.natDecisions?.[1]?.inputPort,80,"SNAT trace receives the post-DNAT port without inventing PAT");
   eq(r.transcript.natDecisions?.[1]?.outputPort,80,"SNAT trace keeps source-port PAT explicitly unsupported");
 }
}


{
 const conntrackScenario=structuredClone(scenario);
 const router=conntrackScenario.resources.find(r=>r.id==="r1");
 router.type="network.firewall";
 router.properties.rules=[{id:"allow-established-http",source:"win1",destination:"app1",protocol:"tcp",port:80,connectionState:"ESTABLISHED",action:"allow"}];
 router.properties.defaultAction="deny";
 router.properties.conntrack={complete:true,entries:[{id:"ct-http",source:"10.0.0.10",destination:"app1",protocol:"tcp",port:80,state:"ESTABLISHED"}]};
 const r=runActiveProbe({scenario:conntrackScenario,state:createInitialEngineState(conntrackScenario),sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"conntrack/session active probe runs"); if(r.ok){
   eq(r.transcript.truth,"TRUE","active probe preserves stateful firewall allow verdict");
   eq(r.transcript.conntrackDecisions?.length,1,"active probe carries Engine conntrack decision trace");
   eq(r.transcript.conntrackDecisions?.[0]?.selectedEntryId,"ct-http","active probe preserves exact conntrack entry identity");
   eq(r.transcript.conntrackDecisions?.[0]?.connectionState,"ESTABLISHED","active probe preserves exact session state");
   eq(r.transcript.conntrackDecisions?.[0]?.entries[0]?.disposition,"MATCH","active probe preserves exact tuple-match disposition");
   const policy=r.transcript.policyDecisions?.find(d=>d.kind==="FIREWALL"&&d.resourceId==="r1");
   eq(policy?.selectedPolicyId,"allow-established-http","active probe binds stateful session evidence to exact firewall rule");
   eq(policy?.firewallScope,"NETWORK","active probe preserves Engine network-firewall scope");
   eq(policy?.rules[0]?.connectionStateMatch,"TRUE","active probe preserves Engine conntrack-state match truth in policy trace");
 }
}


{
 const localFirewallScenario=structuredClone(scenario);
 const app=localFirewallScenario.resources.find(r=>r.id==="app1");
 app.properties.isFirewall=true;
 app.properties.rules=[{id:"local-allow-http",source:"win1",destination:"app1",protocol:"tcp",port:80,action:"allow"}];
 app.properties.defaultAction="deny";
 const r=runActiveProbe({scenario:localFirewallScenario,state:createInitialEngineState(localFirewallScenario),sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"local host firewall active probe runs"); if(r.ok){
   eq(r.transcript.truth,"TRUE","local host firewall preserves reachable Engine verdict");
   const policy=r.transcript.policyDecisions?.find(d=>d.kind==="FIREWALL"&&d.resourceId==="app1");
   eq(policy?.firewallScope,"LOCAL_HOST","active probe preserves Engine local-host firewall scope");
   eq(policy?.selectedPolicyId,"local-allow-http","active probe preserves exact local-host firewall rule identity");
   eq(policy?.truth,"TRUE","active probe preserves local-host firewall allow truth");
 }
}


{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});
 ok(r.ok,"Phase 91 ping path comparison probe runs"); if(r.ok){
   eq(r.transcript.pathComparison?.forwardPath,["win1","r1","app1"],"active probe propagates Engine forward path comparison");
   eq(r.transcript.pathComparison?.returnPath,["app1","r1","win1"],"active probe propagates independently evaluated return path");
   eq(r.transcript.pathComparison?.symmetry,"SYMMETRIC","active probe preserves Engine symmetry classification");
   eq(r.transcript.pathComparison?.returnEvaluationMode,"FULL","portless active probe preserves full return evaluation mode");
   eq(r.transcript.pathComparison?.returnSecurityStatus,"MODELED","portless active probe preserves modeled reverse security status");
 }
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"Phase 91 TCP path comparison probe runs"); if(r.ok){
   eq(r.transcript.pathComparison?.forwardPath,["win1","r1","app1"],"TCP probe propagates Engine forward path");
   eq(r.transcript.pathComparison?.returnPath,["app1","r1","win1"],"TCP probe propagates Engine return network path");
   eq(r.transcript.pathComparison?.returnEvaluationMode,"NETWORK_ONLY","TCP service probe does not fabricate reverse service tuple");
   eq(r.transcript.pathComparison?.returnSecurityStatus,"RETURN_TUPLE_NOT_MODELED","TCP probe exposes missing client ephemeral return-port boundary");
   eq(r.transcript.pathComparison?.returnPolicyDecisions?.length ?? 0,0,"TCP network-only return carries no fabricated reverse firewall policy evidence");
   eq(r.transcript.pathComparison?.returnConntrackDecisions?.length ?? 0,0,"TCP network-only return carries no fabricated reverse conntrack evidence");
 }
}


{
 const hostScenario=structuredClone(scenario);
 const app=hostScenario.resources.find(r=>r.id==="app1");
 app.properties.hostStack={complete:true,processes:[{id:"proc-http",name:"nginx",pid:2210,service:"http"}],sockets:[{id:"sock-http",protocol:"tcp",localAddress:"0.0.0.0",localPort:80,state:"LISTEN",processId:"proc-http",service:"http"}]};
 const r=runActiveProbe({scenario:hostScenario,state:createInitialEngineState(hostScenario),sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"Phase 92 explicit host-stack active probe runs"); if(r.ok){
   eq(r.transcript.truth,"TRUE","host-stack projection does not change healthy TCP listener truth");
   eq(r.transcript.hostStackDecision?.model,"EXPLICIT_HOST_STACK","active probe preserves explicit host-stack model");
   eq(r.transcript.hostStackDecision?.complete,true,"active probe preserves host-stack snapshot completeness");
   eq(r.transcript.hostStackDecision?.processes?.[0]?.name,"nginx","active probe preserves modeled process name");
   eq(r.transcript.hostStackDecision?.processes?.[0]?.pid,2210,"active probe preserves modeled PID");
   eq(r.transcript.hostStackDecision?.sockets?.[0]?.bindScope,"WILDCARD","active probe preserves Engine-derived bind scope");
   eq(r.transcript.hostStackDecision?.selectedSocketIds,["sock-http"],"active probe preserves exact selected listener socket");
   eq(r.transcript.hostStackDecision?.listenerConsistency,"CONSISTENT","active probe preserves Engine listener consistency");
   eq(r.transcript.listenerServiceDecision?.truth,"TRUE","active probe propagates Engine listener truth");
   eq(r.transcript.listenerServiceDecision?.model,"EXPLICIT_HOST_STACK","active probe preserves explicit listener model");
   eq(r.transcript.listenerServiceDecision?.listenerState,"LISTENING","active probe preserves explicit LISTENING state");
   eq(r.transcript.listenerServiceDecision?.serviceState,"ENABLED","active probe preserves service state separately from listener state");
   eq(r.transcript.listenerServiceDecision?.selectedSocketIds,["sock-http"],"active probe binds listener truth to exact socket identity");
   eq(r.transcript.tcpStateMachineDecision?.truth,"TRUE","active probe propagates Engine TCP state-machine truth");
   eq(r.transcript.tcpStateMachineDecision?.disposition,"LISTENING","active probe preserves listener-only TCP state disposition");
   eq(r.transcript.tcpStateMachineDecision?.currentStates,["LISTEN"],"active probe preserves current LISTEN state");
   eq(r.transcript.tcpStateMachineDecision?.sequenceAckTimeline,"NOT_MODELED","active probe does not fabricate TCP sequence/ack telemetry");
 }
}
{
 const r=probe(initial,{sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});
 ok(r.ok,"Phase 92 service-only host-stack active probe runs"); if(r.ok){
   eq(r.transcript.hostStackDecision?.model,"SERVICE_DECLARATIONS","legacy service model is explicit in active probe trace");
   eq(r.transcript.hostStackDecision?.complete,false,"service-only host-stack is never presented as a complete process/socket snapshot");
   eq(r.transcript.hostStackDecision?.processes,[],"service-only host-stack does not invent processes or PIDs");
   eq(r.transcript.hostStackDecision?.sockets,[],"service-only host-stack does not invent sockets");
   eq(r.transcript.hostStackDecision?.selectedServiceNames,["http"],"service-only trace preserves selected declared service");
   eq(r.transcript.listenerServiceDecision?.truth,"TRUE","legacy service-only listener truth remains compatible");
   eq(r.transcript.listenerServiceDecision?.model,"SERVICE_DECLARATIONS","active probe explicitly labels declaration-only listener model");
   eq(r.transcript.listenerServiceDecision?.selectedSocketIds,[],"declaration-only compatibility never fabricates socket identity");
   eq(r.transcript.tcpStateMachineDecision?.truth,"UNKNOWN","service-only active probe does not fabricate TCP lifecycle truth");
   eq(r.transcript.tcpStateMachineDecision?.disposition,"DECLARATION_ONLY","service-only TCP state is explicitly declaration-only");
   eq(r.transcript.tcpStateMachineDecision?.socketRows,[],"service-only TCP state trace fabricates no socket rows");
 }
}


{
 const dhcpScenario={...structuredClone(scenario),scenarioId:"active_probe_dhcp",sourceHash:"d".repeat(64)};
 dhcpScenario.resources=[
  {id:"dhcp-client",type:"windows.workstation",label:"DHCP Client",interfaces:[{id:"eth0",label:"eth0",addresses:[]}],properties:{dhcp:{enabled:true}}},
  {id:"sw1",type:"network.switch",label:"Switch",interfaces:[{id:"p1",label:"p1",addresses:[]},{id:"p2",label:"p2",addresses:[]}],properties:{}},
  {id:"dhcp1",type:"network.dhcp_server",label:"DHCP",interfaces:[{id:"eth0",label:"eth0",addresses:["10.20.0.2/24"]}],properties:{dhcp:{enabled:true,availableLeases:5,offers:[{client:"dhcp-client",address:"10.20.0.100"}],gateway:"10.20.0.1",dnsServers:["10.20.0.53"],prefixLength:24}}},
 ];
 dhcpScenario.connections=[
  {id:"client-sw",kind:"network",from:{resource:"dhcp-client"},to:{resource:"sw1"},properties:{}},
  {id:"sw-dhcp",kind:"network",from:{resource:"sw1"},to:{resource:"dhcp1"},properties:{}},
 ];
 const r=runActiveProbe({scenario:dhcpScenario,state:createInitialEngineState(dhcpScenario),sourceId:"dhcp-client",probeId:"windows.ipconfig_renew"});
 ok(r.ok,"Windows modeled DHCP DORA probe runs without destination argument"); if(r.ok){
   eq(r.transcript.category,"dhcp","DHCP probe category is explicit");
   eq(r.transcript.command,"ipconfig /renew","DHCP probe preserves learner-facing Windows command");
   eq(r.transcript.truth,"TRUE","unique local DHCP offer completes modeled DORA");
   eq(r.transcript.dhcpDoraDecision?.truth,"TRUE","transcript preserves Engine-owned DHCP truth");
   eq(r.transcript.dhcpDoraDecision?.selectedServerResourceId,"dhcp1","transcript preserves selected DHCP server");
   eq(r.transcript.dhcpDoraDecision?.offeredAddress,"10.20.0.100","transcript preserves explicit modeled lease");
   eq(r.transcript.dhcpDoraDecision?.stages.map(x=>[x.stage,x.truth]),[["DISCOVER","TRUE"],["OFFER","TRUE"],["REQUEST","TRUE"],["ACK","TRUE"]],"transcript carries exact DORA stage truth");
   eq(r.transcript.dhcpDoraDecision?.attempts[0]?.discoverPath,["dhcp-client","sw1","dhcp1"],"transcript preserves Engine-proven Discover L2 path");
   eq(r.transcript.dhcpDoraDecision?.attempts[0]?.offerReturnPath,["dhcp1","sw1","dhcp-client"],"transcript preserves Engine-proven Offer return L2 path");
   ok(text(r).includes("no guest DHCP command executed"),"DHCP probe states no guest command execution");
   ok(text(r).includes("DHCP relay")&&text(r).includes("not modeled"),"DHCP probe declares relay/non-feature boundary");
 }
}
{
 const linuxDhcp={...structuredClone(scenario),scenarioId:"active_probe_linux_dhcp",sourceHash:"e".repeat(64)};
 linuxDhcp.resources=[{id:"linux1",type:"linux.workstation",label:"Linux",interfaces:[{id:"eth0",label:"eth0",addresses:[]}],properties:{dhcp:{enabled:false}}}];
 linuxDhcp.connections=[];
 const r=runActiveProbe({scenario:linuxDhcp,state:createInitialEngineState(linuxDhcp),sourceId:"linux1",probeId:"linux.dhclient"});
 ok(r.ok,"Linux modeled DHCP probe runs without destination argument"); if(r.ok){eq(r.transcript.command,"dhclient -v","Linux DHCP command label preserved");eq(r.transcript.truth,"FALSE","disabled modeled DHCP client yields deterministic FALSE");eq(r.transcript.dhcpDoraDecision?.clientEnabled,false,"disabled client state preserved in Engine trace");}
}

await import("./run_udp_icmp_probe_tests.mjs");
console.log(`PASS Diagnostic / Observation Engine Wave 2 active probes functional: ${checks} assertions.`);
