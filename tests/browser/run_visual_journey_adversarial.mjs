import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = {
  scenarioId: "s",
  sourceHash: "h",
  resources: [
    { id: "a", type: "linux.host", label: "A", interfaces: [], properties: {} },
    { id: "b", type: "linux.host", label: "B", interfaces: [], properties: {} },
  ],
  zones: [],
  connections: [],
};
const base = {
  engineId: "foundation.observation", engineVersion: "1", modeled: true, boundary: "NO_GUEST_COMMAND_EXECUTION", probeMode: "ACTIVE_MODELED_PROBE",
  scenarioId: "s", scenarioHash: "h", stateRevision: 1, sourceId: "a", sourceLabel: "A", sourceType: "linux.host", probeId: "linux.ping",
  command: "ping -c 4 b", category: "connectivity", truth: "TRUE", destinationId: "b", destinationLabel: "B", protocol: "icmp", path: ["a", "b"], lines: [], evidence: [],
};

assert.equal(buildVisualJourneyFromActiveProbe(scenario, { ...base, scenarioHash: "wrong" }).diagnostics[0].code, "VISUAL_JOURNEY_SCENARIO_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(scenario, { ...base, sourceId: "missing", path: ["missing", "b"] }).diagnostics[0].code, "VISUAL_JOURNEY_SOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(scenario, { ...base, path: ["b", "a"] }).diagnostics[0].code, "VISUAL_JOURNEY_PATH_SOURCE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(scenario, base).diagnostics.at(-1).code, "VISUAL_JOURNEY_CONNECTION_UNMAPPED");
const route = { resourceId: "a", destinationId: "b", nextHopResourceId: "b", truth: "TRUE", candidates: [{ index: 0, routeId: "r", disposition: "MATCH", selected: true }], selectedRouteId: "r", explanation: [] };
assert.equal(buildVisualJourneyFromActiveProbe({ ...scenario, connections: [{ id: "ab", kind: "network", from: { resource: "a" }, to: { resource: "b" }, properties: {} }] }, { ...base, routeDecisions: [{ ...route, resourceId: "ghost" }] }).diagnostics[0].code, "VISUAL_JOURNEY_ROUTE_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe({ ...scenario, connections: [{ id: "ab", kind: "network", from: { resource: "a" }, to: { resource: "b" }, properties: {} }] }, { ...base, routeDecisions: [{ ...route, nextHopResourceId: "a" }] }).diagnostics[0].code, "VISUAL_JOURNEY_ROUTE_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe({ ...scenario, connections: [{ id: "ab", kind: "network", from: { resource: "a" }, to: { resource: "b" }, properties: {} }] }, { ...base, routeDecisions: [{ ...route, selectedRouteId: "other" }] }).diagnostics[0].code, "VISUAL_JOURNEY_ROUTE_TRACE_SELECTION_INVALID");
const neighbor = {
  resourceId: "a", destinationId: "b", nextHopResourceId: "b", truth: "TRUE",
  candidates: [{ index: 0, entryId: "n", disposition: "MATCH", selected: true, targetResourceId: "b", protocol: "ARP", address: "10.0.0.2", mac: "02:00:00:00:00:02", interfaceId: "e0", state: "REACHABLE" }],
  selectedEntryId: "n", selectedProtocol: "ARP", selectedAddress: "10.0.0.2", selectedMac: "02:00:00:00:00:02", outgoingInterface: "e0", selectedState: "REACHABLE", explanation: [],
};
const linked = { ...scenario, connections: [{ id: "ab", kind: "network", from: { resource: "a" }, to: { resource: "b" }, properties: {} }] };
const linkedLocal = { ...linked, resources: linked.resources.map((resource) => resource.id === "a" ? { ...resource, properties: { ...resource.properties, isFirewall: true } } : resource) };
const comparison = {
  sourceId:"a",destinationId:"b",protocol:"icmp",forwardTruth:"TRUE",forwardPath:["a","b"],
  returnTruth:"TRUE",returnPath:["b","a"],symmetry:"SYMMETRIC",returnEvaluationMode:"FULL",returnSecurityStatus:"MODELED",
  natStateImplication:"NONE",interfaceComparisons:[],explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,pathComparison:{...comparison,sourceId:"ghost"}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_ENDPOINT_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,pathComparison:{...comparison,forwardPath:["a"]}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_FORWARD_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,pathComparison:{...comparison,returnPath:["a","b"]}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_RETURN_ENDPOINT_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,pathComparison:{...comparison,symmetry:"ASYMMETRIC"}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_SYMMETRY_MISMATCH");
const tcpBase={...base,protocol:"tcp",port:443,probeId:"linux.nc_tcp",command:"nc -vz b 443"};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,pathComparison:{...comparison,protocol:"tcp",servicePort:443,returnEvaluationMode:"NETWORK_ONLY",returnSecurityStatus:"RETURN_TUPLE_NOT_MODELED",returnPolicyDecisions:[{resourceId:"a"}]}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_SECURITY_FABRICATED");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,pathComparison:{...comparison,protocol:"tcp",servicePort:443,returnEvaluationMode:"FULL",returnSecurityStatus:"MODELED"}}).diagnostics[0].code,"VISUAL_JOURNEY_PATH_COMPARISON_RETURN_MODE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked, { ...base, neighborDecisions: [{ ...neighbor, nextHopResourceId: "a" }] }).diagnostics[0].code, "VISUAL_JOURNEY_NEIGHBOR_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked, { ...base, neighborDecisions: [{ ...neighbor, selectedEntryId: "tampered" }] }).diagnostics[0].code, "VISUAL_JOURNEY_NEIGHBOR_TRACE_SELECTION_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked, { ...base, neighborDecisions: [{ ...neighbor, selectedMac: "02:00:00:00:00:99" }] }).diagnostics[0].code, "VISUAL_JOURNEY_NEIGHBOR_TRACE_PROJECTION_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked, { ...base, neighborDecisions: [{ ...neighbor, truth: "FALSE" }] }).diagnostics[0].code, "VISUAL_JOURNEY_NEIGHBOR_TRACE_TRUTH_MISMATCH");

const mac = {
  resourceId:"a",sourceResourceId:"x",destinationId:"b",nextHopResourceId:"b",truth:"TRUE",
  sourceMac:"02:00:00:00:00:01",destinationMac:"02:00:00:00:00:02",ingressInterface:"p1",expectedEgressInterface:"p2",
  selectedEntryId:"d",selectedEgressInterface:"p2",learning:"REFRESHED",forwarding:"UNICAST",
  candidates:[
    {index:0,entryId:"s",disposition:"SOURCE_MATCH",selected:false,mac:"02:00:00:00:00:01",interfaceId:"p1"},
    {index:1,entryId:"d",disposition:"DESTINATION_MATCH",selected:true,mac:"02:00:00:00:00:02",interfaceId:"p2"},
  ],explanation:[]
};
const macScenario={...scenario,resources:[
  {id:"x",type:"linux.host",label:"X",interfaces:[{id:"x0",kind:"ethernet",addresses:[]}],properties:{}},
  {id:"a",type:"network.switch",label:"A",interfaces:[{id:"p1",kind:"ethernet",addresses:[]},{id:"p2",kind:"ethernet",addresses:[]},{id:"p3",kind:"ethernet",addresses:[]}],properties:{}},
  {id:"b",type:"linux.host",label:"B",interfaces:[{id:"b0",kind:"ethernet",addresses:[]}],properties:{}},
],connections:[
  {id:"xa",kind:"network",from:{resource:"x",port:"x0"},to:{resource:"a",port:"p1"},properties:{}},
  {id:"ab",kind:"network",from:{resource:"a",port:"p2"},to:{resource:"b",port:"b0"},properties:{}},
]};
const macBase={...base,sourceId:"x",sourceLabel:"X",path:["x","a","b"]};
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[{...mac,sourceResourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[{...mac,selectedEntryId:"tampered"}]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_SELECTION_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[{...mac,selectedEgressInterface:"p3"}]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_PROJECTION_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[{...mac,truth:"FALSE"}]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_TRUTH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[{...mac,learning:"MOVED"}]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_LEARNING_INVALID");
const unmappedMac={...mac,truth:"FALSE",selectedEntryId:"wrong-port",selectedEgressInterface:"p3",candidates:[
  mac.candidates[0],
  {index:1,entryId:"wrong-port",disposition:"DESTINATION_MATCH",selected:true,mac:"02:00:00:00:00:02",interfaceId:"p3"},
]};
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,truth:"FALSE",blockingPoint:"a",macDecisions:[unmappedMac]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_INTERFACE_UNMAPPED");
const duplicateCandidate={...mac,candidates:[mac.candidates[0],{...mac.candidates[1],index:0}]};
assert.equal(buildVisualJourneyFromActiveProbe(macScenario,{...macBase,macDecisions:[duplicateCandidate]}).diagnostics[0].code,"VISUAL_JOURNEY_MAC_TRACE_CANDIDATE_DUPLICATE");



const vlan = {
  resourceId:"a",sourceResourceId:"x",destinationId:"b",nextHopResourceId:"b",truth:"TRUE",vlan:10,
  ingressInterface:"p1",egressInterface:"p2",ingressMode:"ACCESS",egressMode:"TRUNK",ingressTag:"UNTAGGED",egressTag:"TAGGED",rewrite:"ADD_TAG",
  ports:[
    {interfaceId:"p1",mode:"ACCESS",accessVlan:10,egressTag:"UNTAGGED",disposition:"INGRESS"},
    {interfaceId:"p2",mode:"TRUNK",allowedVlans:[10,20],egressTag:"TAGGED",disposition:"EGRESS"},
    {interfaceId:"p3",mode:"ACCESS",accessVlan:20,disposition:"BLOCKED"},
  ],explanation:[]
};
const vlanScenario={...scenario,resources:[
  {id:"x",type:"linux.host",label:"X",interfaces:[{id:"x0",kind:"ethernet",addresses:[]}],properties:{}},
  {id:"a",type:"network.switch",label:"A",interfaces:[{id:"p1",kind:"ethernet",addresses:[]},{id:"p2",kind:"ethernet",addresses:[]},{id:"p3",kind:"ethernet",addresses:[]}],properties:{}},
  {id:"b",type:"linux.host",label:"B",interfaces:[{id:"b0",kind:"ethernet",addresses:[]}],properties:{}},
],connections:[
  {id:"xa",kind:"network",from:{resource:"x",port:"x0"},to:{resource:"a",port:"p1"},properties:{}},
  {id:"ab",kind:"network",from:{resource:"a",port:"p2"},to:{resource:"b",port:"b0"},properties:{}},
]};
const vlanBase={...base,sourceId:"x",sourceLabel:"X",path:["x","a","b"]};
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,resourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,nextHopResourceId:"x"}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,rewrite:"PRESERVE_UNTAGGED"}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_REWRITE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,egressTag:undefined}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_TRUE_INCOMPLETE");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,ports:vlan.ports.slice(0,2)}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_PORT_TABLE_INCOMPLETE");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,ports:[vlan.ports[0],{...vlan.ports[1],allowedVlans:[10],nativeVlan:20},vlan.ports[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_PORT_CONFIG_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,vlanDecisions:[{...vlan,ports:[{...vlan.ports[0],disposition:"ELIGIBLE"},vlan.ports[1],vlan.ports[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_ROLE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,truth:"UNKNOWN",blockingPoint:"a",vlanDecisions:[{...vlan,truth:"UNKNOWN",vlan:undefined,ingressMode:undefined,egressMode:undefined,ingressTag:undefined,egressTag:undefined,rewrite:"ADD_TAG"}]}).diagnostics[0].code,"VISUAL_JOURNEY_VLAN_TRACE_UNKNOWN_REWRITE");

const stp={
  resourceId:"a",sourceResourceId:"x",destinationId:"b",nextHopResourceId:"b",truth:"TRUE",modelComplete:true,
  ingressInterface:"p1",egressInterface:"p2",protocol:"RSTP",bridgeId:"b1",rootBridgeId:"root",rootPathCost:4,isRootBridge:false,
  ports:[
    {interfaceId:"p1",disposition:"INGRESS",role:"ROOT",state:"FORWARDING",bpdu:"RECEIVE"},
    {interfaceId:"p2",disposition:"EGRESS",role:"DESIGNATED",state:"FORWARDING",bpdu:"SEND"},
    {interfaceId:"p3",disposition:"OTHER",role:"ALTERNATE",state:"DISCARDING",bpdu:"RECEIVE"},
  ],explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,resourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,nextHopResourceId:"x"}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,truth:"FALSE"}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_TRUTH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,modelComplete:false}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_TRUTH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,ports:stp.ports.slice(0,2)}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_PORT_TABLE_INCOMPLETE");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,isRootBridge:true}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_BRIDGE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(vlanScenario,{...vlanBase,stpDecisions:[{...stp,ports:[stp.ports[0],{...stp.ports[1],state:"FORWARD"},stp.ports[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_STP_TRACE_PORT_VALUE_INVALID");


const policy = {
  resourceId:"a", destinationId:"b", kind:"ACL", truth:"TRUE",
  rules:[
    {index:0,ruleId:"first",disposition:"NO_MATCH",selected:false,action:"deny"},
    {index:1,ruleId:"allow",disposition:"MATCH",selected:true,action:"allow"},
    {index:2,ruleId:"late",disposition:"NOT_EVALUATED",selected:false,action:"deny"},
  ],selectedPolicyId:"allow",defaultAction:"deny",usedDefault:false,explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,resourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,destinationId:"a"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,truth:"FALSE",blockingPoint:"a",policyDecisions:[{...policy,resourceId:"b"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,kind:"NAT"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_KIND_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,selectedPolicyId:"tampered"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_SELECTION_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,rules:[policy.rules[0],{...policy.rules[1],index:3},policy.rules[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_RULE_TABLE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,rules:[{...policy.rules[0],disposition:"NOT_EVALUATED"},policy.rules[1],policy.rules[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_ORDER_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,truth:"FALSE"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_TRUTH_MISMATCH");
const defaultPolicy={resourceId:"a",destinationId:"b",kind:"ACL",truth:"FALSE",rules:[],selectedPolicyId:"a.aclDefaultAction",defaultAction:"deny",usedDefault:true,explanation:[]};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,truth:"FALSE",blockingPoint:"a",policyDecisions:[{...defaultPolicy,selectedPolicyId:undefined}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_DEFAULT_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[policy,{...policy}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_DUPLICATE");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,rules:[policy.rules[0],{...policy.rules[1],ruleId:"first"},policy.rules[2]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_RULE_ID_DUPLICATE");
const indeterminateDefault={resourceId:"a",destinationId:"b",kind:"ACL",truth:"TRUE",rules:[{index:0,ruleId:"cidr",disposition:"INDETERMINATE",selected:false,action:"deny"}],selectedPolicyId:"a.aclDefaultAction",defaultAction:"allow",usedDefault:true,explanation:[]};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[indeterminateDefault]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_DEFAULT_INVALID");

const nat={
  resourceId:"a",destinationId:"b",kind:"DNAT",truth:"TRUE",policyMode:"required",transformation:"TRANSLATED",
  selectedRuleId:"dnat-one",inputSource:"10.0.0.2",outputSource:"10.0.0.2",inputPort:8443,outputPort:443,
  rules:[
    {index:0,ruleId:"dnat-one",declaredType:"dnat",disposition:"MATCH",selected:true,externalPort:8443,translatedPort:443,action:"translate",sourceMatch:"TRUE",destinationMatch:true,protocolMatch:true,portMatch:true},
    {index:1,ruleId:"snat-two",declaredType:"snat",disposition:"NOT_EVALUATED",selected:false,translatedSource:"198.51.100.2",action:"translate"},
  ],explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,resourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,destinationId:"a"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,kind:"NPT"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_KIND_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[nat,{...nat}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_DUPLICATE");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,selectedRuleId:"tampered"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_SELECTION_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,rules:[{...nat.rules[0],index:3},nat.rules[1]]}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_RULE_TABLE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,rules:[{...nat.rules[0],selected:false,disposition:"NOT_EVALUATED"},{...nat.rules[1],selected:false,disposition:"NO_MATCH"}],selectedRuleId:undefined,transformation:"PASSTHROUGH"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_ORDER_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[[{...nat,truth:"FALSE"}][0]]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_TRUTH_MISMATCH");
const snatPat={...nat,kind:"SNAT",selectedRuleId:"snat-one",inputPort:443,outputPort:444,inputSource:"10.0.0.2",outputSource:"198.51.100.2",rules:[{...nat.rules[0],ruleId:"snat-one",declaredType:"snat",port:443,externalPort:undefined,translatedPort:undefined,translatedSource:"198.51.100.2"}]};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[snatPat]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_SNAT_PAT_UNSUPPORTED");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,outputSource:"198.51.100.2"}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_DNAT_SOURCE_REWRITE");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,selectedRuleId:undefined,rules:nat.rules.map(rule=>({...rule,selected:false,disposition:rule.index===0?"NO_MATCH":"OTHER_KIND"}))}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_TRANSFORMATION_MISMATCH");
const declaredNat={...nat,truth:"UNKNOWN",transformation:"UNKNOWN",selectedRuleId:undefined,rules:[{index:0,ruleId:"snat-declared",declaredType:"snat",disposition:"DECLARED",selected:false,action:"translate"}]};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[declaredNat]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_DECLARED_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,natDecisions:[{...nat,rules:[nat.rules[0],{...nat.rules[1],ruleId:"dnat-one"}]}]}).diagnostics[0].code,"VISUAL_JOURNEY_NAT_TRACE_RULE_ID_DUPLICATE");


const conntrack={
  resourceId:"a",destinationId:"b",truth:"TRUE",complete:true,selectedEntryId:"ct1",connectionState:"ESTABLISHED",observedSource:"198.51.100.10",observedPort:443,
  entries:[{index:0,entryId:"ct1",disposition:"MATCH",selected:true,source:"198.51.100.10",destination:"b",protocol:"tcp",port:443,state:"ESTABLISHED",sourceMatch:"TRUE",destinationMatch:true,protocolMatch:true,portMatch:true}],explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,resourceId:"ghost"}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_RESOURCE_UNKNOWN");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,destinationId:"a"}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_PATH_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[conntrack,{...conntrack}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_DUPLICATE");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,selectedEntryId:"tampered"}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_SELECTION_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,entries:[{...conntrack.entries[0],index:2}]}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_TABLE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,entries:[conntrack.entries[0],{...conntrack.entries[0],index:1,selected:false}]}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_ENTRY_ID_DUPLICATE");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,connectionState:"RELATED"}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_STATE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,conntrackDecisions:[{...conntrack,truth:"FALSE",selectedEntryId:undefined,connectionState:undefined,entries:[{...conntrack.entries[0],selected:false,disposition:"NO_MATCH"}],complete:false}]}).diagnostics[0].code,"VISUAL_JOURNEY_CONNTRACK_TRACE_TRUTH_MISMATCH");
const statefulPolicy={resourceId:"a",destinationId:"b",kind:"FIREWALL",firewallScope:"LOCAL_HOST",truth:"TRUE",rules:[{index:0,ruleId:"stateful",disposition:"MATCH",selected:true,action:"allow",connectionState:"ESTABLISHED",connectionStateMatch:"TRUE"}],selectedPolicyId:"stateful",defaultAction:"deny",usedDefault:false,explanation:[]};

assert.equal(buildVisualJourneyFromActiveProbe(linkedLocal,{...base,policyDecisions:[{...statefulPolicy,firewallScope:undefined}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_FIREWALL_SCOPE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linkedLocal,{...base,policyDecisions:[{...statefulPolicy,firewallScope:"NETWORK"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_FIREWALL_SCOPE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...base,policyDecisions:[{...policy,firewallScope:"NETWORK"}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_FIREWALL_SCOPE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linkedLocal,{...base,conntrackDecisions:[conntrack],policyDecisions:[{...statefulPolicy,rules:[{...statefulPolicy.rules[0],connectionStateMatch:"FALSE"}]}]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linkedLocal,{...base,policyDecisions:[statefulPolicy]}).diagnostics[0].code,"VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_MISMATCH");


const hostStack = {
  resourceId:"b",truth:"TRUE",model:"EXPLICIT_HOST_STACK",complete:true,
  processes:[{processId:"p-web",name:"nginx",pid:2210,service:"https"}],
  sockets:[{socketId:"s-web",protocol:"tcp",localAddress:"0.0.0.0",localPort:443,bindScope:"WILDCARD",state:"LISTEN",processId:"p-web",service:"https"}],
  services:[{index:0,name:"https",enabled:true,port:443,protocol:"tcp",owningProcessIds:["p-web"],socketIds:["s-web"]}],
  selectedServiceNames:["https"],selectedSocketIds:["s-web"],listenerConsistency:"CONSISTENT",explanation:[]
};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,resourceId:"a"}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_RESOURCE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,model:"SERVICE_DECLARATIONS",complete:false}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_SERVICE_ONLY_FABRICATION");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,sockets:[{...hostStack.sockets[0],bindScope:"SPECIFIC"}]}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_SOCKET_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,sockets:[{...hostStack.sockets[0],processId:"ghost"}]}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_SOCKET_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,selectedSocketIds:[]}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_SELECTED_SOCKET_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:{...hostStack,services:[{...hostStack.services[0],socketIds:[]}]}}).diagnostics[0].code,"VISUAL_JOURNEY_HOST_STACK_OWNERSHIP_MISMATCH");
const listenerTrace={resourceId:"b",truth:"TRUE",protocol:"tcp",port:443,model:"EXPLICIT_HOST_STACK",complete:true,listenerState:"LISTENING",serviceState:"ENABLED",disposition:"LISTENING",selectedServiceNames:["https"],selectedSocketIds:["s-web"],listenerConsistency:"CONSISTENT",explanation:[]};
const tcpStateTrace={sourceId:"a",destinationId:"b",port:443,truth:"TRUE",model:"EXPLICIT_HOST_STACK",complete:true,disposition:"LISTENING",listenerTruth:"TRUE",socketRows:[{socketId:"s-web",localAddress:"0.0.0.0",localPort:443,state:"LISTEN",role:"LISTENER",selected:true,processId:"p-web",service:"https",allowedNextStates:["SYN_RECEIVED"]}],selectedSocketIds:["s-web"],currentStates:["LISTEN"],canonicalTransitions:[{ from: "CLOSED", to: "SYN_SENT", trigger: "active open / SYN" },{ from: "CLOSED", to: "LISTEN", trigger: "passive open" },{ from: "LISTEN", to: "SYN_RECEIVED", trigger: "SYN received" },{ from: "SYN_SENT", to: "ESTABLISHED", trigger: "SYN/ACK received; ACK sent" },{ from: "SYN_RECEIVED", to: "ESTABLISHED", trigger: "ACK received" },{ from: "ESTABLISHED", to: "FIN_WAIT_1", trigger: "active close / FIN" },{ from: "ESTABLISHED", to: "CLOSE_WAIT", trigger: "peer FIN received" },{ from: "FIN_WAIT_1", to: "FIN_WAIT_2", trigger: "ACK of local FIN" },{ from: "FIN_WAIT_1", to: "CLOSING", trigger: "peer FIN before local FIN ACK" },{ from: "FIN_WAIT_1", to: "TIME_WAIT", trigger: "peer FIN and local FIN acknowledged" },{ from: "FIN_WAIT_2", to: "TIME_WAIT", trigger: "peer FIN received; ACK sent" },{ from: "CLOSE_WAIT", to: "LAST_ACK", trigger: "local close / FIN" },{ from: "CLOSING", to: "TIME_WAIT", trigger: "ACK of local FIN" },{ from: "LAST_ACK", to: "CLOSED", trigger: "ACK of local FIN" },{ from: "TIME_WAIT", to: "CLOSED", trigger: "TIME-WAIT timer expiry" },],sequenceAckTimeline:"NOT_MODELED",retransmissionMarkers:"NOT_MODELED",explanation:[]};
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack}).diagnostics[0].code,"VISUAL_JOURNEY_LISTENER_TRACE_REQUIRED");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:{...listenerTrace,resourceId:"a"},tcpStateMachineDecision:tcpStateTrace}).diagnostics[0].code,"VISUAL_JOURNEY_LISTENER_TRACE_BINDING_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:{...listenerTrace,selectedSocketIds:[]},tcpStateMachineDecision:tcpStateTrace}).diagnostics[0].code,"VISUAL_JOURNEY_LISTENER_TRACE_SELECTION_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:{...listenerTrace,serviceState:"DISABLED"},tcpStateMachineDecision:tcpStateTrace}).diagnostics[0].code,"VISUAL_JOURNEY_LISTENER_TRACE_SERVICE_STATE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:{...listenerTrace,listenerState:"NOT_LISTENING",disposition:"NO_LISTENER",truth:"FALSE"},tcpStateMachineDecision:{...tcpStateTrace,listenerTruth:"FALSE",truth:"FALSE",disposition:"CONNECTION_REFUSED"},truth:"FALSE",blockingPoint:"b"}).diagnostics[0].code,"VISUAL_JOURNEY_LISTENER_TRACE_STATE_MISMATCH");


assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:listenerTrace}).diagnostics[0].code,"VISUAL_JOURNEY_TCP_TRACE_REQUIRED");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:listenerTrace,tcpStateMachineDecision:{...tcpStateTrace,destinationId:"a"}}).diagnostics[0].code,"VISUAL_JOURNEY_TCP_TRACE_BINDING_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:listenerTrace,tcpStateMachineDecision:{...tcpStateTrace,currentStates:["ESTABLISHED"]}}).diagnostics[0].code,"VISUAL_JOURNEY_TCP_STATE_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:listenerTrace,tcpStateMachineDecision:{...tcpStateTrace,selectedSocketIds:[]}}).diagnostics[0].code,"VISUAL_JOURNEY_TCP_SELECTION_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(linked,{...tcpBase,hostStackDecision:hostStack,listenerServiceDecision:listenerTrace,tcpStateMachineDecision:{...tcpStateTrace,socketRows:[{...tcpStateTrace.socketRows[0],role:"SESSION",state:"ESTABLISHED",allowedNextStates:["FIN_WAIT_1","CLOSE_WAIT"]}]}}).diagnostics[0].code,"VISUAL_JOURNEY_TCP_SESSION_PEER_MISSING");



const dnsScenario={...linked,resources:[...linked.resources,{id:"dns1",type:"network.dns_server",label:"DNS",interfaces:[{id:"d0",addresses:["10.0.0.53/24"]}],properties:{}}]};
const dnsTrace={sourceId:"a",queryName:"app.lab",truth:"TRUE",configuredResolversState:"KNOWN",resolverAddresses:["10.0.0.53"],attempts:[{index:0,resolverAddress:"10.0.0.53",mappedResourceIds:["dns1"],selectedResourceId:"dns1",networkTruth:"TRUE",networkPath:["a","dns1"],serviceState:"KNOWN",serviceEnabled:true,recordsState:"KNOWN",matchedRecordCount:1,answerAddress:"10.0.0.2",answerResourceIds:["b"],disposition:"RESOLVED"}],selectedResolverAddress:"10.0.0.53",selectedResolverResourceId:"dns1",resolvedAddress:"10.0.0.2",resolvedResourceIds:["b"],explanation:[]};
const dnsBase={...base,probeId:"windows.resolve_dnsname",command:"Resolve-DnsName app.lab",category:"dns",truth:"TRUE",destinationId:undefined,destinationLabel:undefined,protocol:undefined,port:undefined,path:undefined,queryName:"app.lab",resolvedAddress:"10.0.0.2",resolvedResourceIds:["b"],dnsChainDecision:dnsTrace};
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:{...dnsTrace,sourceId:"ghost"}}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_BINDING_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:{...dnsTrace,resolvedAddress:"10.0.0.99"}}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_ANSWER_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:{...dnsTrace,attempts:[{...dnsTrace.attempts[0],mappedResourceIds:["b"]}]}}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_MAPPING_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:{...dnsTrace,attempts:[{...dnsTrace.attempts[0],networkTruth:"FALSE"}]}}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:{...dnsTrace,selectedResolverResourceId:"b"}}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_SUCCESS_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dnsScenario,{...dnsBase,dnsChainDecision:undefined}).diagnostics[0].code,"VISUAL_JOURNEY_DNS_TRACE_REQUIRED");



const dhcpScenario={
  ...linked,
  resources:[...linked.resources,{id:"sw1",type:"network.switch",label:"SW",interfaces:[{id:"p1",addresses:[]},{id:"p2",addresses:[]}],properties:{}},{id:"dhcp1",type:"network.dhcp_server",label:"DHCP",interfaces:[{id:"d0",addresses:["10.20.0.2/24"]}],properties:{}}],
  connections:[...linked.connections,{id:"a-sw",kind:"network",from:{resource:"a"},to:{resource:"sw1",port:"p1"},properties:{}},{id:"sw-dhcp",kind:"network",from:{resource:"sw1",port:"p2"},to:{resource:"dhcp1",port:"d0"},properties:{}}]
};
const dhcpTrace={clientId:"a",truth:"TRUE",clientState:"KNOWN",clientEnabled:true,attempts:[{index:0,serverResourceId:"dhcp1",discoverTruth:"TRUE",discoverPath:["a","sw1","dhcp1"],discoverExplanation:[],offerReturnTruth:"TRUE",offerReturnPath:["dhcp1","sw1","a"],offerReturnExplanation:[],serverEnabled:true,availableLeases:5,matchedOfferCount:1,offeredAddress:"10.20.0.100",gateway:"10.20.0.1",dnsServers:["10.20.0.53"],prefixLength:24,disposition:"OFFERED"}],stages:[{stage:"DISCOVER",truth:"TRUE",explanation:[]},{stage:"OFFER",truth:"TRUE",serverResourceId:"dhcp1",explanation:[]},{stage:"REQUEST",truth:"TRUE",serverResourceId:"dhcp1",explanation:[]},{stage:"ACK",truth:"TRUE",serverResourceId:"dhcp1",explanation:[]}],selectedServerResourceId:"dhcp1",offeredAddress:"10.20.0.100",gateway:"10.20.0.1",dnsServers:["10.20.0.53"],prefixLength:24,explanation:[]};
const dhcpBase={...base,probeId:"linux.dhclient",command:"dhclient -v",category:"dhcp",truth:"TRUE",destinationId:undefined,destinationLabel:undefined,protocol:undefined,port:undefined,path:undefined,dhcpDoraDecision:dhcpTrace};
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:{...dhcpTrace,clientId:"ghost"}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_TRACE_BINDING_MISMATCH");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:undefined}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_TRACE_REQUIRED");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,destinationId:"b",path:["a","b"]}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_PACKET_PATH_FABRICATED");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:{...dhcpTrace,stages:[...dhcpTrace.stages].reverse()}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_STAGE_ORDER_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:{...dhcpTrace,attempts:[{...dhcpTrace.attempts[0],serverResourceId:"b"}]}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_SERVER_ATTEMPT_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:{...dhcpTrace,attempts:[{...dhcpTrace.attempts[0],discoverPath:["a","dhcp1"]}]}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_DISCOVER_PATH_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,dhcpDoraDecision:{...dhcpTrace,selectedServerResourceId:"ghost"}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_SUCCESS_INVALID");
assert.equal(buildVisualJourneyFromActiveProbe(dhcpScenario,{...dhcpBase,truth:"FALSE",dhcpDoraDecision:{...dhcpTrace,truth:"FALSE"}}).diagnostics[0].code,"VISUAL_JOURNEY_DHCP_NONTRUE_LEASE");

console.log("PASS visual journey adversarial: 97");
