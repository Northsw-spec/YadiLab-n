import assert from "node:assert/strict";
import fs from "node:fs";
import {
  injectFault,
  rollbackLatestFault,
  verifyFaultPack,
  computeFaultPackIdentity,
} from "../../dist-fault-engine-test/fault-engine/src/index.js";
import { createInitialEngineState, queryReachability } from "../../dist-fault-engine-test/engine/src/index.js";

let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const pack=JSON.parse(fs.readFileSync("fault-packs/builtin/network-core.json","utf8"));

const scenario={
  formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"wave1_lab",sourceHash:"c".repeat(64),
  metadata:{title:"Wave 1",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],
  resources:[
    {id:"client1",type:"windows.workstation",label:"Client",zone:"users",interfaces:[{id:"eth0",addresses:["10.10.10.10/24"]}],properties:{
      defaultGateway:"10.10.10.1",vlan:10,vlans:[10],dnsServers:["10.10.10.53"],dnsSearchDomains:["corp.example"],
      dhcp:{enabled:true,gateway:"10.10.10.1",dnsServers:["10.10.10.53"],prefixLength:24},stable:"keep"
    }},
    {id:"router1",type:"network.router",label:"Router",interfaces:[{id:"lan",addresses:["10.10.10.1/24"]},{id:"srv",addresses:["10.10.20.1/24"]}],properties:{
      vlans:[10,20],routes:[{id:"server_route",destination:"server1",via:"server1",action:"forward",enabled:true}],stable:"keep"
    }},
    {id:"switch1",type:"network.switch",label:"Switch",interfaces:[{id:"p1",addresses:[]}],properties:{
      vlans:[10,20],allowedVlans:[10,20,30],portAdminUp:true,stpPorts:[{interface:"p1",role:"DESIGNATED",state:"FORWARDING",bpdu:"SEND"}],stable:"keep"
    }},
    {id:"dns1",type:"network.dns_server",label:"DNS",interfaces:[{id:"eth0",addresses:["10.10.10.53/24"]}],properties:{
      dns:{enabled:true,records:[{name:"app.corp.example",address:"10.10.20.20"}]},stable:"keep"
    }},
    {id:"dhcp1",type:"network.dhcp_server",label:"DHCP",interfaces:[{id:"eth0",addresses:["10.10.10.54/24"]}],properties:{
      dhcp:{enabled:true,availableLeases:50,gateway:"10.10.10.1",dnsServers:["10.10.10.53"],prefixLength:24},stable:"keep"
    }},
    {id:"firewall1",type:"network.firewall",label:"Firewall",interfaces:[],properties:{
      aclDefaultAction:"allow",defaultAction:"allow",
      rules:[{id:"allow_server",source:"client1",destination:"server1",protocol:"tcp",port:443,action:"allow",enabled:true}],
      natPolicy:"required",natRules:[{id:"https_dnat",type:"dnat",source:"client1",destination:"server1",protocol:"tcp",externalPort:443,translatedPort:443,action:"translate",enabled:true}],
      routes:[{id:"server_route",destination:"server1",via:"server1",action:"forward",enabled:true}],stable:"keep"
    }},
    {id:"server1",type:"linux.server",label:"Server",zone:"servers",interfaces:[{id:"eth0",addresses:["10.10.20.20/24"]}],properties:{
      vlans:[20],services:[{name:"https",enabled:true,port:443,protocol:"tcp"}],stable:"keep"
    }}
  ],
  connections:[
    {id:"c_r",kind:"network",from:{resource:"client1"},to:{resource:"router1"},properties:{vlan:10}},
    {id:"r_s",kind:"network",from:{resource:"router1"},to:{resource:"server1"},properties:{}},
    {id:"c_f",kind:"network",from:{resource:"client1"},to:{resource:"firewall1"},properties:{}},
    {id:"f_s",kind:"network",from:{resource:"firewall1"},to:{resource:"server1"},properties:{direction:"forward"}}
  ],
  tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]
};

const mapping={
  "routing.remove_default_gateway":"client1",
  "routing.set_wrong_default_gateway":"client1",
  "routing.blackhole_primary_route":"router1",
  "routing.set_wrong_next_hop":"router1",
  "routing.disable_primary_route":"router1",
  "vlan.replace_membership":"client1",
  "vlan.set_wrong_access_vlan":"client1",
  "l2.disable_switch_port":"switch1",
  "l2.force_stp_blocking":"switch1",
  "l2.restrict_trunk_vlans":"switch1",
  "dns.replace_resolvers":"client1",
  "dns.remove_all_resolvers":"client1",
  "dns.set_wrong_search_domain":"client1",
  "dns.disable_server":"dns1",
  "dns.corrupt_primary_record":"dns1",
  "dhcp.disable_client":"client1",
  "dhcp.set_wrong_gateway":"client1",
  "dhcp.set_wrong_dns":"client1",
  "dhcp.set_wrong_prefix":"client1",
  "dhcp.exhaust_server_pool":"dhcp1",
  "firewall.force_default_deny":"firewall1",
  "firewall.default_action_deny":"firewall1",
  "firewall.disable_primary_rule":"firewall1",
  "nat.disable_primary_dnat":"firewall1",
  "nat.wrong_translated_port":"firewall1",
};

const verified=await verifyFaultPack(pack);
ok(verified.ok,`Wave-1 built-in pack verifies: ${JSON.stringify(verified.diagnostics)}`);
eq(await computeFaultPackIdentity(pack),pack.packIdentity,"Wave-1 pack identity is reproducible");
eq(pack.version,"0.2.0","Wave-1 pack version is 0.2.0");
eq(pack.faults.length,25,"Wave-1 pack contains 25 deterministic faults");
eq(Object.keys(mapping).sort(),pack.faults.map(x=>x.faultId).sort(),"Every built-in fault has a functional target mapping");

const buckets={routing:0,vlan_l2:0,dns:0,dhcp:0,firewall_nat:0};
for(const f of pack.faults){
  if(f.faultId.startsWith("routing.")) buckets.routing++;
  else if(f.faultId.startsWith("vlan.")||f.faultId.startsWith("l2.")) buckets.vlan_l2++;
  else if(f.faultId.startsWith("dns.")) buckets.dns++;
  else if(f.faultId.startsWith("dhcp.")) buckets.dhcp++;
  else if(f.faultId.startsWith("firewall.")||f.faultId.startsWith("nat.")) buckets.firewall_nat++;
  ok(f.preconditions.length>0,`${f.faultId} declares preconditions`);
  ok(f.expectedEffects.length>0,`${f.faultId} declares expected effects`);
  ok(f.observableSymptoms.length>0,`${f.faultId} declares observable symptoms`);
  eq(f.recovery.mode,"restore_pre_injection",`${f.faultId} uses canonical reversible recovery`);
  eq(Object.keys(f.difficulty).sort(),["dependencyDepth","evidenceVisibility","layers","remediationConstraints"],`${f.faultId} exposes only transparent difficulty dimensions`);
}
eq(buckets,{routing:5,vlan_l2:5,dns:5,dhcp:5,firewall_nat:5},"Wave-1 covers five faults in each requested domain family");

for(const f of pack.faults){
  const initial=createInitialEngineState(scenario);
  const target=mapping[f.faultId];
  const result=await injectFault({scenario,state:initial,pack,faultId:f.faultId,bindings:{target},seed:0x12345678,mode:"RUNTIME_INJECTION"});
  ok(result.ok,`${f.faultId} injects on a valid modeled target: ${JSON.stringify(result.diagnostics)}`);
  if(!result.ok) continue;
  eq(result.overlay.instances.length,1,`${f.faultId} records one coherent fault instance`);
  eq(result.overlay.instances[0].changedResources,[target],`${f.faultId} blast radius is exactly its declared target`);
  eq(result.overlay.instances[0].expectedEffectsVerified,true,`${f.faultId} expected effects are verified`);
  eq(result.overlay.instances[0].negativeControlsVerified,true,`${f.faultId} negative controls are verified`);
  const rollback=await rollbackLatestFault(scenario,result.state,result.overlay);
  ok(rollback.ok,`${f.faultId} rolls back safely: ${JSON.stringify(rollback.diagnostics)}`);
  if(rollback.ok) eq(rollback.state.resources,initial.resources,`${f.faultId} recovery restores exact pre-injection resource state`);
}

// Engine-semantic checks for the domains the Foundation runtime already evaluates directly.
{
  const initial=createInitialEngineState(scenario);
  const before=queryReachability(scenario,initial,"client1","server1","any");
  ok(before.truth==="TRUE",`routing baseline is reachable: ${before.explanation.join(" ")}`);
  const injected=await injectFault({scenario,state:initial,pack,faultId:"routing.blackhole_primary_route",bindings:{target:"router1"},seed:1,mode:"RUNTIME_INJECTION"});
  ok(injected.ok,"routing blackhole semantic injection succeeds");
  if(injected.ok) eq(queryReachability(scenario,injected.state,"client1","server1","any").truth,"FALSE","blackhole route changes Engine reachability to FALSE");
}
{
  const vlanScenario=structuredClone(scenario);
  vlanScenario.connections=[{id:"c_s",kind:"network",from:{resource:"client1"},to:{resource:"server1"},properties:{vlan:10}}];
  vlanScenario.resources.find(x=>x.id==="server1").properties.vlans=[10];
  delete vlanScenario.resources.find(x=>x.id==="client1").properties.vlan;
  const initial=createInitialEngineState(vlanScenario);
  eq(queryReachability(vlanScenario,initial,"client1","server1","any").truth,"TRUE","VLAN baseline is reachable");
  const injected=await injectFault({scenario:vlanScenario,state:initial,pack,faultId:"vlan.replace_membership",bindings:{target:"client1"},seed:1,mode:"RUNTIME_INJECTION"});
  ok(injected.ok,"VLAN membership semantic injection succeeds");
  if(injected.ok) eq(queryReachability(vlanScenario,injected.state,"client1","server1","any").truth,"FALSE","wrong VLAN membership changes Engine reachability to FALSE");
}
{
  const fwScenario=structuredClone(scenario);
  fwScenario.connections=[{id:"c_f",kind:"network",from:{resource:"client1"},to:{resource:"firewall1"},properties:{}},{id:"f_s",kind:"network",from:{resource:"firewall1"},to:{resource:"server1"},properties:{direction:"forward"}}];
  fwScenario.resources.find(x=>x.id==="firewall1").properties.natPolicy="optional";
  fwScenario.resources.find(x=>x.id==="firewall1").properties.defaultAction="deny";
  const initial=createInitialEngineState(fwScenario);
  eq(queryReachability(fwScenario,initial,"client1","server1","tcp",443).truth,"TRUE","firewall-rule baseline is reachable");
  const injected=await injectFault({scenario:fwScenario,state:initial,pack,faultId:"firewall.disable_primary_rule",bindings:{target:"firewall1"},seed:1,mode:"RUNTIME_INJECTION"});
  ok(injected.ok,"firewall rule semantic injection succeeds");
  if(injected.ok) eq(queryReachability(fwScenario,injected.state,"client1","server1","tcp",443).truth,"FALSE","disabled allow rule falls through to default deny");
}
{
  const natScenario=structuredClone(scenario);
  natScenario.connections=[{id:"c_f",kind:"network",from:{resource:"client1"},to:{resource:"firewall1"},properties:{}},{id:"f_s",kind:"network",from:{resource:"firewall1"},to:{resource:"server1"},properties:{direction:"forward"}}];
  const initial=createInitialEngineState(natScenario);
  eq(queryReachability(natScenario,initial,"client1","server1","tcp",443).truth,"TRUE","DNAT baseline is reachable");
  const injected=await injectFault({scenario:natScenario,state:initial,pack,faultId:"nat.disable_primary_dnat",bindings:{target:"firewall1"},seed:1,mode:"RUNTIME_INJECTION"});
  ok(injected.ok,"DNAT disable semantic injection succeeds");
  if(injected.ok) eq(queryReachability(natScenario,injected.state,"client1","server1","tcp",443).truth,"FALSE","required DNAT disabled changes Engine reachability to FALSE");
}

console.log(`PASS Fault Pack Expansion Wave 1 functional: ${checks} assertions.`);
