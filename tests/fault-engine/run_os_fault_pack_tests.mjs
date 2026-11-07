import assert from "node:assert/strict";
import fs from "node:fs";
import {computeFaultPackIdentity,injectFault,rollbackLatestFault,verifyFaultPack} from "../../dist-fault-engine-test/fault-engine/src/index.js";
import {createInitialEngineState,queryListeningPort,queryServiceEnabled} from "../../dist-fault-engine-test/engine/src/index.js";

let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const windowsPack=JSON.parse(fs.readFileSync("fault-packs/builtin/windows-core.json","utf8"));
const linuxPack=JSON.parse(fs.readFileSync("fault-packs/builtin/linux-core.json","utf8"));
const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"os_fault_lab",sourceHash:"d".repeat(64),metadata:{title:"OS faults",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Windows 1",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dhcp:{enabled:true,gateway:"10.0.0.1",dnsServers:["10.0.0.53"],prefixLength:24},aclDefaultAction:"allow",networkProfile:"domain",rdp:{enabled:true,port:3389,protocol:"tcp"},smb:{enabled:true,port:445,protocol:"tcp"},winrm:{enabled:true,port:5985,protocol:"tcp"},stable:"keep"}},
{id:"linux1",type:"linux.server",label:"Linux 1",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dhcp:{enabled:true,gateway:"10.0.0.1",dnsServers:["10.0.0.53"],prefixLength:24},aclDefaultAction:"allow",ssh:{enabled:true,port:22,protocol:"tcp"},http:{enabled:true,port:80,protocol:"tcp"},networkManager:{enabled:true},systemdResolved:{enabled:true},stable:"keep"}}
],connections:[{id:"w_l",kind:"network",from:{resource:"win1"},to:{resource:"linux1"},properties:{}}],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const targets={
"windows.routing.set_wrong_default_gateway":"win1","windows.dns.replace_resolvers":"win1","windows.dhcp.disable_client":"win1","windows.firewall.force_default_deny":"win1","windows.interface.set_apipa_address":"win1","windows.rdp.disable_service":"win1","windows.rdp.change_listener_port":"win1","windows.smb.disable_service":"win1","windows.winrm.disable_service":"win1","windows.network.set_public_profile":"win1",
"linux.routing.set_wrong_default_gateway":"linux1","linux.dns.replace_resolvers":"linux1","linux.dhcp.disable_client":"linux1","linux.firewall.force_default_deny":"linux1","linux.interface.set_link_local_address":"linux1","linux.ssh.disable_service":"linux1","linux.ssh.change_listener_port":"linux1","linux.http.disable_service":"linux1","linux.networkmanager.disable_service":"linux1","linux.systemd_resolved.disable_service":"linux1"};
for(const [pack,label,prefix] of [[windowsPack,"Windows","windows."],[linuxPack,"Linux","linux."]]){
 const verified=await verifyFaultPack(pack);ok(verified.ok,`${label} pack verifies: ${JSON.stringify(verified.diagnostics)}`);eq(await computeFaultPackIdentity(pack),pack.packIdentity,`${label} identity reproducible`);eq(pack.version,"0.1.0",`${label} pack version`);eq(pack.faults.length,10,`${label} pack contains 10 faults`);eq(pack.faults.filter(f=>f.faultId.startsWith(prefix)).length,10,`${label} fault IDs remain in OS namespace`);
 for(const f of pack.faults){ok(f.preconditions.length>0,`${f.faultId} preconditions`);ok(f.expectedEffects.length>0,`${f.faultId} expected effects`);ok(f.observableSymptoms.length>0,`${f.faultId} symptoms`);eq(f.recovery.mode,"restore_pre_injection",`${f.faultId} reversible recovery`);eq(Object.keys(f.difficulty).sort(),["dependencyDepth","evidenceVisibility","layers","remediationConstraints"],`${f.faultId} transparent difficulty only`);ok(!f.targetBindings[0].resourceTypes.includes("*"),`${f.faultId} is OS-target constrained`);
  const initial=createInitialEngineState(scenario);const r=await injectFault({scenario,state:initial,pack,faultId:f.faultId,bindings:{target:targets[f.faultId]},seed:0x68000001,mode:"RUNTIME_INJECTION"});ok(r.ok,`${f.faultId} injects: ${JSON.stringify(r.diagnostics)}`);if(!r.ok)continue;eq(r.overlay.instances[0].changedResources,[targets[f.faultId]],`${f.faultId} blast radius one target`);const rb=await rollbackLatestFault(scenario,r.state,r.overlay);ok(rb.ok,`${f.faultId} rollback`);if(rb.ok)eq(rb.state.resources,initial.resources,`${f.faultId} exact recovery`);
 }
}
{
 const initial=createInitialEngineState(scenario);eq(queryListeningPort(initial,"win1","tcp",3389).truth,"TRUE","RDP baseline listens on 3389");const r=await injectFault({scenario,state:initial,pack:windowsPack,faultId:"windows.rdp.disable_service",bindings:{target:"win1"},seed:1,mode:"RUNTIME_INJECTION"});ok(r.ok,"RDP disable injection");if(r.ok)eq(queryListeningPort(r.state,"win1","tcp",3389).truth,"FALSE","disabled RDP changes listener truth to FALSE");
}
{
 const initial=createInitialEngineState(scenario);const r=await injectFault({scenario,state:initial,pack:windowsPack,faultId:"windows.rdp.change_listener_port",bindings:{target:"win1"},seed:2,mode:"RUNTIME_INJECTION"});ok(r.ok,"RDP port move injection");if(r.ok){eq(queryListeningPort(r.state,"win1","tcp",3389).truth,"FALSE","old RDP port no longer listening");const moved=r.state.resources.win1.properties.rdp.port;eq(queryListeningPort(r.state,"win1","tcp",moved).truth,"TRUE","new RDP port is listening");}
}
{
 const initial=createInitialEngineState(scenario);eq(queryServiceEnabled(initial,"win1","smb").truth,"TRUE","SMB baseline enabled");const r=await injectFault({scenario,state:initial,pack:windowsPack,faultId:"windows.smb.disable_service",bindings:{target:"win1"},seed:1,mode:"RUNTIME_INJECTION"});ok(r.ok,"SMB disable injection");if(r.ok)eq(queryServiceEnabled(r.state,"win1","smb").truth,"FALSE","SMB Engine service truth becomes FALSE");
}
{
 const initial=createInitialEngineState(scenario);eq(queryListeningPort(initial,"linux1","tcp",22).truth,"TRUE","SSH baseline listens on 22");const r=await injectFault({scenario,state:initial,pack:linuxPack,faultId:"linux.ssh.disable_service",bindings:{target:"linux1"},seed:1,mode:"RUNTIME_INJECTION"});ok(r.ok,"SSH disable injection");if(r.ok)eq(queryListeningPort(r.state,"linux1","tcp",22).truth,"FALSE","disabled SSH changes listener truth to FALSE");
}
{
 const initial=createInitialEngineState(scenario);const r=await injectFault({scenario,state:initial,pack:linuxPack,faultId:"linux.ssh.change_listener_port",bindings:{target:"linux1"},seed:3,mode:"RUNTIME_INJECTION"});ok(r.ok,"SSH port move injection");if(r.ok){eq(queryListeningPort(r.state,"linux1","tcp",22).truth,"FALSE","old SSH port no longer listening");const moved=r.state.resources.linux1.properties.ssh.port;eq(queryListeningPort(r.state,"linux1","tcp",moved).truth,"TRUE","new SSH port is listening");}
}
{
 const initial=createInitialEngineState(scenario);eq(queryServiceEnabled(initial,"linux1","http").truth,"TRUE","HTTP baseline enabled");const r=await injectFault({scenario,state:initial,pack:linuxPack,faultId:"linux.http.disable_service",bindings:{target:"linux1"},seed:1,mode:"RUNTIME_INJECTION"});ok(r.ok,"HTTP disable injection");if(r.ok)eq(queryServiceEnabled(r.state,"linux1","http").truth,"FALSE","HTTP Engine service truth becomes FALSE");
}
console.log(`PASS Windows + Linux Fault Packs functional: ${checks} assertions.`);
