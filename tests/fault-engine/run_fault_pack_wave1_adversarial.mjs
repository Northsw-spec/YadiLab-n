import assert from "node:assert/strict";
import fs from "node:fs";
import { injectFault } from "../../dist-fault-engine-test/fault-engine/src/index.js";
import { createInitialEngineState } from "../../dist-fault-engine-test/engine/src/index.js";

let checks=0;
const check=async(name,fn)=>{await fn();checks++;};
const pack=JSON.parse(fs.readFileSync("fault-packs/builtin/network-core.json","utf8"));
const base={
  formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"wave1_adv",sourceHash:"d".repeat(64),
  metadata:{title:"Wave1 adversarial",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],
  resources:[
    {id:"client1",type:"windows.workstation",label:"Client",interfaces:[],properties:{defaultGateway:"10.0.0.1",vlan:10,vlans:[10],dnsServers:["10.0.0.53"],dnsSearchDomains:["corp.example"],dhcp:{enabled:true,gateway:"10.0.0.1",dnsServers:["10.0.0.53"],prefixLength:24}}},
    {id:"router1",type:"network.router",label:"Router",interfaces:[],properties:{routes:[{destination:"server1",via:"server1",action:"forward",enabled:true}]}},
    {id:"switch1",type:"network.switch",label:"Switch",interfaces:[],properties:{allowedVlans:[10,20],portAdminUp:true,stp:{portState:"forwarding"}}},
    {id:"dns1",type:"network.dns_server",label:"DNS",interfaces:[],properties:{dns:{enabled:true,records:[{name:"a",address:"10.0.0.80"}]}}},
    {id:"dhcp1",type:"network.dhcp_server",label:"DHCP",interfaces:[],properties:{dhcp:{availableLeases:10}}},
    {id:"firewall1",type:"network.firewall",label:"FW",interfaces:[],properties:{defaultAction:"allow",aclDefaultAction:"allow",rules:[{action:"allow"}],natRules:[{type:"dnat",translatedPort:443,enabled:true}]}}
  ],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]
};

await check("DNS server fault rejects non-DNS target",async()=>{
  const r=await injectFault({scenario:base,state:createInitialEngineState(base),pack,faultId:"dns.disable_server",bindings:{target:"client1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code==="FAULT_BINDING_TYPE_MISMATCH"));
});
await check("switch-port fault rejects endpoint target",async()=>{
  const r=await injectFault({scenario:base,state:createInitialEngineState(base),pack,faultId:"l2.disable_switch_port",bindings:{target:"client1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code==="FAULT_BINDING_TYPE_MISMATCH"));
});
await check("missing DHCP option fails closed",async()=>{
  const r=await injectFault({scenario:base,state:createInitialEngineState(base),pack,faultId:"dhcp.set_wrong_gateway",bindings:{target:"router1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code.startsWith("FAULT_PRECONDITION_")));
});
await check("already-disabled DHCP client cannot create no-op injection",async()=>{
  const scenario=structuredClone(base); scenario.resources.find(x=>x.id==="client1").properties.dhcp.enabled=false;
  const r=await injectFault({scenario,state:createInitialEngineState(scenario),pack,faultId:"dhcp.disable_client",bindings:{target:"client1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code==="FAULT_PRECONDITION_FALSE"));
});
await check("resolver candidate no-op is rejected by preconditions",async()=>{
  const scenario=structuredClone(base); scenario.resources.find(x=>x.id==="client1").properties.dnsServers=["192.0.2.53"];
  const r=await injectFault({scenario,state:createInitialEngineState(scenario),pack,faultId:"dns.replace_resolvers",bindings:{target:"client1"},seed:0,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code==="FAULT_PRECONDITION_FALSE"));
});
await check("DNS replacement and resolver removal are declared incompatible",async()=>{
  const initial=createInitialEngineState(base);
  const first=await injectFault({scenario:base,state:initial,pack,faultId:"dns.replace_resolvers",bindings:{target:"client1"},seed:3,mode:"RUNTIME_INJECTION"});
  assert.equal(first.ok,true);
  const second=await injectFault({scenario:base,state:first.state,pack,faultId:"dns.remove_all_resolvers",bindings:{target:"client1"},seed:4,mode:"RUNTIME_INJECTION",activeOverlay:first.overlay});
  assert.equal(second.ok,false); assert.ok(second.diagnostics.some(x=>x.code==="FAULT_INCOMPATIBLE_ACTIVE"));
});
await check("blackhole and disabled-route faults are declared incompatible",async()=>{
  const initial=createInitialEngineState(base);
  const first=await injectFault({scenario:base,state:initial,pack,faultId:"routing.blackhole_primary_route",bindings:{target:"router1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(first.ok,true);
  const second=await injectFault({scenario:base,state:first.state,pack,faultId:"routing.disable_primary_route",bindings:{target:"router1"},seed:2,mode:"RUNTIME_INJECTION",activeOverlay:first.overlay});
  assert.equal(second.ok,false); assert.ok(second.diagnostics.some(x=>x.code==="FAULT_INCOMPATIBLE_ACTIVE"));
});
await check("disabled DNAT and wrong translated-port faults are incompatible",async()=>{
  const initial=createInitialEngineState(base);
  const first=await injectFault({scenario:base,state:initial,pack,faultId:"nat.disable_primary_dnat",bindings:{target:"firewall1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(first.ok,true);
  const second=await injectFault({scenario:base,state:first.state,pack,faultId:"nat.wrong_translated_port",bindings:{target:"firewall1"},seed:2,mode:"RUNTIME_INJECTION",activeOverlay:first.overlay});
  assert.equal(second.ok,false); assert.ok(second.diagnostics.some(x=>x.code==="FAULT_INCOMPATIBLE_ACTIVE"));
});
await check("wrong access VLAN fault fails when target has no singular VLAN model",async()=>{
  const r=await injectFault({scenario:base,state:createInitialEngineState(base),pack,faultId:"vlan.set_wrong_access_vlan",bindings:{target:"switch1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code.startsWith("FAULT_PRECONDITION_")));
});
await check("DNAT fault rejects router target by resource type",async()=>{
  const r=await injectFault({scenario:base,state:createInitialEngineState(base),pack,faultId:"nat.disable_primary_dnat",bindings:{target:"router1"},seed:1,mode:"RUNTIME_INJECTION"});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code==="FAULT_BINDING_TYPE_MISMATCH"));
});

console.log(`PASS Fault Pack Expansion Wave 1 adversarial: ${checks} assertions.`);
