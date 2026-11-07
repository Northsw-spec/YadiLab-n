import assert from "node:assert/strict";
import fs from "node:fs";
import { createInitialEngineState } from "../../dist-observation-engine-test/engine/src/index.js";
import { injectFault } from "../../dist-observation-engine-test/fault-engine/src/index.js";
import {
  OBSERVATION_ENGINE_ID,
  OBSERVATION_ENGINE_VERSION,
  listObservableTargets,
  listObservationCommands,
  runObservation,
} from "../../dist-observation-engine-test/observation-engine/src/index.js";

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const windowsPack=JSON.parse(fs.readFileSync("fault-packs/builtin/windows-core.json","utf8"));
const linuxPack=JSON.parse(fs.readFileSync("fault-packs/builtin/linux-core.json","utf8"));
const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"observation_lab",sourceHash:"7".repeat(64),metadata:{title:"Observation lab",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Windows 1",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dnsSearchDomains:["corp.example"],dhcp:{enabled:true,gateway:"10.0.0.1",dnsServers:["10.0.0.53"],prefixLength:24},aclDefaultAction:"allow",networkProfile:"domain",rdp:{enabled:true,port:3389,protocol:"tcp"},smb:{enabled:true,port:445,protocol:"tcp"},winrm:{enabled:true,port:5985,protocol:"tcp"}}},
{id:"linux1",type:"linux.server",label:"Linux 1",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dnsSearchDomains:["corp.example"],dhcp:{enabled:true,gateway:"10.0.0.1",dnsServers:["10.0.0.53"],prefixLength:24},aclDefaultAction:"allow",ssh:{enabled:true,port:22,protocol:"tcp"},http:{enabled:true,port:80,protocol:"tcp"},networkManager:{enabled:true},systemdResolved:{enabled:true}}},
{id:"fw1",type:"network.firewall",label:"Firewall",interfaces:[],properties:{}}
],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const initial=createInitialEngineState(scenario);
const text=(r)=>r.ok?r.transcript.lines.join("\n"):"";
const observe=(state,target,commandId)=>runObservation({state,targetId:target,commandId});
const inject=async(pack,faultId,target,seed=1)=>{const r=await injectFault({scenario,state:initial,pack,faultId,bindings:{target},seed,mode:"RUNTIME_INJECTION"});ok(r.ok,`${faultId} injects for observation test`);return r.ok?r.state:initial;};

{
 const targets=listObservableTargets(initial); eq(targets.map(x=>x.id),["linux1","win1"],"only Windows/Linux hosts are observable targets");
 const win=listObservationCommands(initial,"win1"); const lin=listObservationCommands(initial,"linux1");
 eq(win.length,7,"Windows Wave-1 exposes seven commands"); eq(lin.length,7,"Linux Wave-1 exposes seven commands");
 ok(win.every(c=>c.os==="windows"),"Windows command catalog is OS scoped"); ok(lin.every(c=>c.os==="linux"),"Linux command catalog is OS scoped");
 eq(listObservationCommands(initial,"fw1"),[],"network firewall is not falsely treated as a guest OS target");
}
{
 const r=observe(initial,"win1","windows.ipconfig_all"); ok(r.ok,"healthy Windows ipconfig observation succeeds"); if(r.ok){eq(r.transcript.engineId,OBSERVATION_ENGINE_ID,"observation engine ID explicit");eq(r.transcript.engineVersion,OBSERVATION_ENGINE_VERSION,"observation engine version explicit");eq(r.transcript.modeled,true,"transcript marked modeled");eq(r.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION","guest execution boundary explicit");eq(r.transcript.stateRevision,0,"transcript binds state revision");ok(text(r).includes("10.0.0.10/24"),"ipconfig shows modeled address");ok(text(r).includes("Default Gateway: 10.0.0.1"),"ipconfig shows gateway");ok(text(r).includes("DNS Servers: 10.0.0.53"),"ipconfig shows DNS");ok(text(r).includes("DHCP Enabled: Yes"),"ipconfig shows DHCP state");}
}
{
 const r=observe(initial,"linux1","linux.nmcli_device_show");ok(r.ok,"healthy Linux nmcli observation succeeds");if(r.ok){ok(text(r).includes("NetworkManager: active"),"nmcli shows NetworkManager active");ok(text(r).includes("10.0.0.20/24"),"nmcli shows modeled Linux address");ok(text(r).includes("DHCP Enabled: yes"),"nmcli shows DHCP state");}
}

const cases=[
 [windowsPack,"windows.routing.set_wrong_default_gateway","win1","windows.route_print",(s)=>s.includes("192.0.2.1")||s.includes("198.51.100.1"),"Windows wrong gateway visible in route observation"],
 [windowsPack,"windows.dns.replace_resolvers","win1","windows.ipconfig_all",(s)=>s.includes("DNS Servers: 203.0.113.53"),"Windows DNS fault visible in ipconfig"],
 [windowsPack,"windows.dhcp.disable_client","win1","windows.get_netipconfiguration",(s)=>s.includes("DhcpEnabled: false"),"Windows DHCP fault visible"],
 [windowsPack,"windows.firewall.force_default_deny","win1","windows.get_netfirewallprofile",(s)=>s.includes("default action: deny"),"Windows firewall fault visible"],
 [windowsPack,"windows.interface.set_apipa_address","win1","windows.ipconfig_all",(s)=>s.includes("169.254.77.10/16"),"Windows APIPA visible"],
 [windowsPack,"windows.rdp.disable_service","win1","windows.get_service",(s)=>s.includes("TermService (rdp) Status=Stopped"),"Windows RDP service stop visible"],
 [windowsPack,"windows.smb.disable_service","win1","windows.get_service",(s)=>s.includes("LanmanServer (smb) Status=Stopped"),"Windows SMB service stop visible"],
 [windowsPack,"windows.winrm.disable_service","win1","windows.get_service",(s)=>s.includes("WinRM (winrm) Status=Stopped"),"Windows WinRM service stop visible"],
 [windowsPack,"windows.network.set_public_profile","win1","windows.get_netconnectionprofile",(s)=>s.includes("NetworkCategory: public"),"Windows public profile visible"],
 [linuxPack,"linux.routing.set_wrong_default_gateway","linux1","linux.ip_route",(s)=>s.includes("192.0.2.1")||s.includes("198.51.100.1"),"Linux wrong gateway visible in ip route"],
 [linuxPack,"linux.dns.replace_resolvers","linux1","linux.resolvectl_status",(s)=>s.includes("DNS Servers: 203.0.113.53"),"Linux DNS fault visible"],
 [linuxPack,"linux.dhcp.disable_client","linux1","linux.nmcli_device_show",(s)=>s.includes("DHCP Enabled: no"),"Linux DHCP fault visible"],
 [linuxPack,"linux.firewall.force_default_deny","linux1","linux.nft_list_ruleset",(s)=>s.includes("default action: deny"),"Linux firewall fault visible"],
 [linuxPack,"linux.interface.set_link_local_address","linux1","linux.ip_addr",(s)=>s.includes("169.254.77.20/16"),"Linux link-local address visible"],
 [linuxPack,"linux.ssh.disable_service","linux1","linux.systemctl_status",(s)=>s.includes("sshd: inactive"),"Linux SSH service stop visible"],
 [linuxPack,"linux.http.disable_service","linux1","linux.systemctl_status",(s)=>s.includes("http: inactive"),"Linux HTTP stop visible"],
 [linuxPack,"linux.networkmanager.disable_service","linux1","linux.nmcli_device_show",(s)=>s.includes("NetworkManager: inactive"),"Linux NetworkManager stop visible"],
 [linuxPack,"linux.systemd_resolved.disable_service","linux1","linux.resolvectl_status",(s)=>s.includes("systemd-resolved: inactive"),"Linux resolved stop visible"],
];
for(const [pack,fault,target,command,predicate,message] of cases){const state=await inject(pack,fault,target,0x70000001);const r=observe(state,target,command);ok(r.ok,`${fault} observation runs`);if(r.ok)ok(predicate(text(r)),message);}
{
 const state=await inject(windowsPack,"windows.rdp.change_listener_port","win1",2);const r=observe(state,"win1","windows.get_nettcpconnection_listen");ok(r.ok,"Windows moved listener observation");if(r.ok){ok(!text(r).includes("3389 service=rdp"),"old RDP listener absent");ok(/TCP LISTEN 339[01] service=rdp/.test(text(r)),"new RDP listener visible");}
}
{
 const state=await inject(windowsPack,"windows.rdp.disable_service","win1",1);const r=observe(state,"win1","windows.get_nettcpconnection_listen");ok(r.ok,"Windows disabled-listener observation");if(r.ok)ok(!text(r).includes("service=rdp"),"disabled RDP does not appear as listener");
}
{
 const state=await inject(linuxPack,"linux.ssh.change_listener_port","linux1",3);const r=observe(state,"linux1","linux.ss_listen");ok(r.ok,"Linux moved listener observation");if(r.ok){ok(!text(r).includes("TCP LISTEN 22 service=ssh"),"old SSH listener absent");ok(/TCP LISTEN (2222|22022) service=ssh/.test(text(r)),"new SSH listener visible");}
}
{
 const state=await inject(linuxPack,"linux.ssh.disable_service","linux1",1);const r=observe(state,"linux1","linux.ss_listen");ok(r.ok,"Linux disabled-listener observation");if(r.ok)ok(!text(r).includes("service=ssh"),"disabled SSH does not appear as listener");
}
console.log(`PASS Diagnostic / Observation Engine Wave 1 functional: ${checks} assertions.`);
