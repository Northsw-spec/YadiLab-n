import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyOperation,
  applyOperations,
  createInitialEngineState,
  evaluateEngine,
  evaluateRule,
  evaluateTest,
  queryAuthentication,
  queryMembership,
  queryPermission,
  queryHostStackView,
  queryListenerServiceState,
  queryTcpStateMachine,
  queryDhcpDora,
  queryDnsChain,
  queryReachability,
  queryServiceEnabled,
} from "../../dist-engine-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

const initial = createInitialEngineState(scenario);

eq(queryReachability(scenario, initial, "ghost", "rds01", "tcp", 3389).truth, "UNKNOWN", "unknown source is unknown");
eq(queryReachability(scenario, initial, "attacker", "ghost", "tcp", 3389).truth, "UNKNOWN", "unknown destination is unknown");
eq(queryReachability(scenario, initial, "attacker", "rds01", "tcp", 70000).truth, "UNKNOWN", "invalid port is unknown");
eq(queryReachability(scenario, initial, "attacker", "rds01", "any").truth, "UNKNOWN", "specific TCP allow does not prove generic any-protocol reachability");

const malformedAction = structuredClone(scenario);
malformedAction.resources.find((r) => r.id === "firewall01").properties.rules[0].action = "permit-ish";
const malformedActionResult = queryReachability(malformedAction, createInitialEngineState(malformedAction), "attacker", "rds01", "tcp", 3389);
eq(malformedActionResult.truth, "UNKNOWN", "unsupported firewall action does not coerce to allow/deny");
const malformedActionDecision = malformedActionResult.value?.policyDecisions?.find((decision) => decision.resourceId === "firewall01");
eq(malformedActionDecision?.truth, "UNKNOWN", "firewall X-Ray preserves unsupported-action uncertainty");
eq(malformedActionDecision?.rules[0]?.disposition, "MATCH", "unsupported action trace distinguishes rule match from verdict uncertainty");
eq(malformedActionDecision?.selectedPolicyId, "firewall01.rules[0]", "unsupported matching action still identifies the selected policy row");

const defaultDeny = structuredClone(scenario);
defaultDeny.resources.find((r) => r.id === "firewall01").properties = { rules: [], defaultAction: "deny" };
eq(queryReachability(defaultDeny, createInitialEngineState(defaultDeny), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "default deny blocks");
const defaultAllow = structuredClone(scenario);
defaultAllow.resources.find((r) => r.id === "firewall01").properties = { rules: [], defaultAction: "allow" };
eq(queryReachability(defaultAllow, createInitialEngineState(defaultAllow), "attacker", "rds01", "tcp", 3389).truth, "TRUE", "default allow permits with listener evidence");

// Phase 90 adversarial firewall-scope classification.
const malformedLocalMarker = structuredClone(scenario);
malformedLocalMarker.resources.find((r) => r.id === "rds01").properties.isFirewall = "yes";
const malformedLocalMarkerResult = queryReachability(malformedLocalMarker, createInitialEngineState(malformedLocalMarker), "attacker", "rds01", "tcp", 3389);
eq(malformedLocalMarkerResult.truth, "UNKNOWN", "malformed local firewall marker fails closed instead of silently bypassing host policy classification");
eq(malformedLocalMarkerResult.value?.blockingPoint, "rds01", "malformed local firewall classification is localized to the affected host");

const unclassifiedLocalPolicy = structuredClone(scenario);
unclassifiedLocalPolicy.resources.find((r) => r.id === "rds01").properties.rules = [{ id: "local-deny", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "deny" }];
const unclassifiedLocalPolicyResult = queryReachability(unclassifiedLocalPolicy, createInitialEngineState(unclassifiedLocalPolicy), "attacker", "rds01", "tcp", 3389);
eq(unclassifiedLocalPolicyResult.truth, "UNKNOWN", "host firewall rules without isFirewall=true fail closed instead of being ignored");
eq(unclassifiedLocalPolicyResult.value?.policyDecisions?.some((decision) => decision.resourceId === "rds01"), false, "Engine does not fabricate a local host firewall trace when scope is unprovable");

const contradictoryNetworkMarker = structuredClone(scenario);
contradictoryNetworkMarker.resources.find((r) => r.id === "firewall01").properties.isFirewall = false;
const contradictoryNetworkMarkerResult = queryReachability(contradictoryNetworkMarker, createInitialEngineState(contradictoryNetworkMarker), "attacker", "rds01", "tcp", 3389);
eq(contradictoryNetworkMarkerResult.value?.policyDecisions?.find((decision) => decision.resourceId === "firewall01")?.firewallScope, "NETWORK", "network.firewall resource type remains authoritative at runtime even if a contradictory marker is injected");


// Phase 89 adversarial conntrack/session-state validation.
function statefulClone() {
  const candidate = structuredClone(scenario);
  candidate.resources.find((r) => r.id === "attacker").interfaces = [{ id: "eth0", label: "eth0", addresses: ["198.51.100.10"] }];
  const firewall = candidate.resources.find((r) => r.id === "firewall01");
  firewall.properties.rules = [
    { id: "allow-established", source: "wan", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "ESTABLISHED", action: "allow" },
  ];
  firewall.properties.defaultAction = "deny";
  firewall.properties.conntrack = {
    complete: true,
    entries: [{ id: "ct1", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" }],
  };
  return candidate;
}

const incompleteConntrack = statefulClone();
incompleteConntrack.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: false, entries: [] };
const incompleteConntrackResult = queryReachability(incompleteConntrack, createInitialEngineState(incompleteConntrack), "attacker", "rds01", "tcp", 3389);
eq(incompleteConntrackResult.truth, "UNKNOWN", "incomplete conntrack miss fails closed instead of being treated as session absence");
eq(incompleteConntrackResult.value?.conntrackDecisions?.[0]?.truth, "UNKNOWN", "incomplete table uncertainty is explicit in Engine trace");

const duplicateConntrack = statefulClone();
duplicateConntrack.resources.find((r) => r.id === "firewall01").properties.conntrack.entries.push(
  { id: "ct1", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" },
);
const duplicateConntrackResult = queryReachability(duplicateConntrack, createInitialEngineState(duplicateConntrack), "attacker", "rds01", "tcp", 3389);
eq(duplicateConntrackResult.truth, "UNKNOWN", "duplicate conntrack entry identity fails closed");
eq(duplicateConntrackResult.value?.conntrackDecisions?.[0]?.entries[1]?.disposition, "MALFORMED", "duplicate conntrack identity is visible as malformed evidence");

const ambiguousConntrack = statefulClone();
ambiguousConntrack.resources.find((r) => r.id === "firewall01").properties.conntrack.entries.push(
  { id: "ct2", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "RELATED" },
);
const ambiguousConntrackResult = queryReachability(ambiguousConntrack, createInitialEngineState(ambiguousConntrack), "attacker", "rds01", "tcp", 3389);
eq(ambiguousConntrackResult.truth, "UNKNOWN", "multiple active conntrack rows for the same tuple are ambiguous and fail closed");
eq(ambiguousConntrackResult.value?.conntrackDecisions?.[0]?.selectedEntryId, undefined, "ambiguous conntrack lookup never invents a selected entry");

const unknownConntrackState = statefulClone();
unknownConntrackState.resources.find((r) => r.id === "firewall01").properties.conntrack.entries[0].state = "UNKNOWN";
const unknownConntrackStateResult = queryReachability(unknownConntrackState, createInitialEngineState(unknownConntrackState), "attacker", "rds01", "tcp", 3389);
eq(unknownConntrackStateResult.truth, "UNKNOWN", "matching UNKNOWN session state cannot satisfy an ESTABLISHED rule");
eq(unknownConntrackStateResult.value?.conntrackDecisions?.[0]?.selectedEntryId, "ct1", "unknown state may bind a tuple without fabricating state truth");

const missingConntrack = statefulClone();
delete missingConntrack.resources.find((r) => r.id === "firewall01").properties.conntrack;
const missingConntrackResult = queryReachability(missingConntrack, createInitialEngineState(missingConntrack), "attacker", "rds01", "tcp", 3389);
eq(missingConntrackResult.truth, "UNKNOWN", "stateful rule without Engine conntrack evidence fails closed");
eq(missingConntrackResult.value?.conntrackDecisions, undefined, "missing table does not fabricate conntrack evidence");

const malformedConntrack = statefulClone();
malformedConntrack.resources.find((r) => r.id === "firewall01").properties.conntrack.entries[0].source = "not-an-ip";
const malformedConntrackResult = queryReachability(malformedConntrack, createInitialEngineState(malformedConntrack), "attacker", "rds01", "tcp", 3389);
eq(malformedConntrackResult.truth, "UNKNOWN", "malformed conntrack entry fails closed for stateful policy");
eq(malformedConntrackResult.value?.conntrackDecisions?.[0]?.entries[0]?.disposition, "MALFORMED", "malformed conntrack row remains explicit in trace");

const malformedStateRule = statefulClone();
malformedStateRule.resources.find((r) => r.id === "firewall01").properties.rules[0].connectionState = "MAGIC";
const malformedStateRuleResult = queryReachability(malformedStateRule, createInitialEngineState(malformedStateRule), "attacker", "rds01", "tcp", 3389);
eq(malformedStateRuleResult.truth, "UNKNOWN", "unsupported firewall connectionState fails closed");
eq(malformedStateRuleResult.value?.policyDecisions?.find((d) => d.resourceId === "firewall01")?.rules[0]?.disposition, "MALFORMED", "unsupported connectionState is visible in policy trace");

const directed = structuredClone(scenario);
directed.connections = [{ id: "oneway", kind: "network", from: { resource: "attacker" }, to: { resource: "rds01" }, properties: { direction: "forward" } }];
eq(queryReachability(directed, createInitialEngineState(directed), "rds01", "attacker", "any").truth, "FALSE", "forward-only connection is not reversed");
const directedComparison = queryReachability(directed, createInitialEngineState(directed), "attacker", "rds01", "tcp", 3389).value?.pathComparison;
eq(directedComparison?.returnTruth, "FALSE", "forward-only topology produces a proven missing return path");
eq(directedComparison?.symmetry, "ASYMMETRIC", "one-way path is classified asymmetric rather than assumed symmetric");
eq(directedComparison?.returnSecurityStatus, "RETURN_TUPLE_NOT_MODELED", "one-way TCP comparison still preserves reverse tuple uncertainty boundary");
const disabled = structuredClone(directed);
disabled.connections[0].properties.enabled = false;
eq(queryReachability(disabled, createInitialEngineState(disabled), "attacker", "rds01", "any").truth, "FALSE", "disabled connection is absent from topology");

const serviceTrue = queryServiceEnabled(initial, "rds01", "rdp");
eq(serviceTrue.truth, "TRUE", "declared RDP service enabled");
const serviceMissing = queryServiceEnabled(initial, "rds01", "ssh");
eq(serviceMissing.truth, "UNKNOWN", "undeclared service is unknown");
const serviceOff = applyOperation(initial, { op: "set", target: "rds01", path: "properties.rdp.enabled", value: false });
ok(serviceOff.ok, "service-off setup succeeds");
if (!serviceOff.ok) process.exit(1);
eq(queryServiceEnabled(serviceOff.state, "rds01", "rdp").truth, "FALSE", "declared disabled service false");

const removeNla = applyOperation(initial, { op: "remove", target: "rds01", path: "properties.nla" });
ok(removeNla.ok, "remove existing property succeeds");
if (!removeNla.ok) process.exit(1);
ok(!Object.hasOwn(removeNla.state.resources.rds01.properties, "nla"), "remove deletes property in new state");
ok(Object.hasOwn(initial.resources.rds01.properties, "nla"), "remove does not mutate original");
const removeMissing = applyOperation(initial, { op: "remove", target: "rds01", path: "properties.never" });
ok(!removeMissing.ok, "remove missing property rejected");
const arrayOut = applyOperation(initial, { op: "set", target: "firewall01", path: "properties.rules.99.action", value: "deny" });
ok(!arrayOut.ok, "out-of-range array path rejected");
const batchRemove = applyOperations(initial, [
  { op: "set", target: "rds01", path: "properties.nla", value: true },
  { op: "remove", target: "rds01", path: "properties.never" },
]);
ok(!batchRemove.ok, "batch with invalid remove rejected");
eq(batchRemove.state.resources.rds01.properties.nla, false, "invalid batch rolls back set");

const identity = {
  formatId: "infrastructure-cyber-lab.scenario", schemaVersion: "0.1.0", scenarioId: "id_adv", sourceHash: "c".repeat(64),
  metadata: { title: "id", description: "", language: "sv", authors: [], tags: [], briefing: "" }, minimumEngineVersion: "0.2.0",
  capabilityLocks: [], profileLocks: [], zones: [], connections: [], tests: [], findings: [], objectives: [], hints: [],
  resources: [
    { id: "u", type: "identity.user", label: "u", interfaces: [], properties: {} },
    { id: "g", type: "identity.group", label: "g", interfaces: [], properties: { memberOf: [] } },
    { id: "s", type: "server.generic", label: "s", interfaces: [], properties: { permissions: [{ subject: "u", permission: "read", effect: "deny" }, { subject: "g", permission: "read", effect: "allow" }], authentication: { enabled: true, allowedGroups: ["g"], mfaRequired: true } } },
  ], completion: { op: "equals", target: "u", path: "properties.x", value: true },
};
const idState = createInitialEngineState(identity);
eq(queryMembership(idState, "u", "g").truth, "UNKNOWN", "missing user memberOf is unknown");
eq(queryPermission(idState, "u", "s", "read").truth, "FALSE", "direct deny is decisive");
eq(queryPermission(idState, "u", "s", "write").truth, "FALSE", "authoritative ACL with no match is false");
eq(queryAuthentication(idState, "u", "s").truth, "UNKNOWN", "incomplete membership prevents auth false precision");

const idMember = applyOperation(idState, { op: "set", target: "u", path: "properties.memberOf", value: ["g"] });
ok(idMember.ok, "memberOf can be added at existing properties object");
if (!idMember.ok) process.exit(1);
eq(queryMembership(idMember.state, "u", "g").truth, "TRUE", "new membership true");
eq(queryAuthentication(idMember.state, "u", "s").truth, "UNKNOWN", "authorized identity with undeclared MFA remains unknown");
const idMfaOff = applyOperation(idMember.state, { op: "set", target: "u", path: "properties.mfaEnabled", value: false });
ok(idMfaOff.ok, "mfa state added");
if (!idMfaOff.ok) process.exit(1);
eq(queryAuthentication(idMfaOff.state, "u", "s").truth, "FALSE", "explicit MFA disabled blocks auth");

const unknownRule = evaluateRule({ op: "any", rules: [
  { op: "equals", target: "rds01", path: "properties.missing", value: 1 },
  { op: "equals", target: "rds01", path: "properties.nla", value: false },
] }, { scenario, state: initial, testResults: {} });
eq(unknownRule.truth, "TRUE", "any true is decisive over unknown");
const falseRule = evaluateRule({ op: "all", rules: [
  { op: "equals", target: "rds01", path: "properties.missing", value: 1 },
  { op: "equals", target: "rds01", path: "properties.nla", value: true },
] }, { scenario, state: initial, testResults: {} });
eq(falseRule.truth, "FALSE", "all false is decisive over unknown");

const unsupported = evaluateTest(scenario, initial, { id: "x", type: "network.future_test", label: "x", params: {} });
eq(unsupported.outcome, "UNKNOWN", "unsupported test type returns unknown");
const malformedTest = evaluateTest(scenario, initial, { id: "x", type: "network.reachability", label: "x", params: { from: 1, to: "rds01", protocol: "tcp" } });
eq(malformedTest.outcome, "UNKNOWN", "malformed test params return unknown");
const hardeningTrue = evaluateTest(scenario, initial, { id: "x", type: "windows.hardening_check", label: "x", params: { target: "rds01", path: "properties.nla", equals: false } });
eq(hardeningTrue.outcome, "TRUE", "hardening equals test supported");
const hardeningUnknown = evaluateTest(scenario, initial, { id: "x", type: "windows.hardening_check", label: "x", params: { target: "rds01", path: "properties.nope", equals: false } });
eq(hardeningUnknown.outcome, "UNKNOWN", "hardening missing evidence unknown");
const segmentation = evaluateTest(scenario, initial, { id: "x", type: "network.segmentation", label: "x", params: { from: "attacker", to: "rds01", protocol: "tcp", port: 3389 } });
eq(segmentation.outcome, "FALSE", "segmentation inverts proven reachability");

const evalA = evaluateEngine(scenario, initial);
const evalB = evaluateEngine(scenario, initial);
eq(evalA, evalB, "repeated evaluation is deterministic");
eq(evalA.evidence.map((e) => e.sequence), [1, 2], "evidence sequence is stable across deterministic evaluation");


const malformedPortScan = evaluateTest(scenario, initial, { id: "scanbad", type: "network.port_scan", label: "scanbad", params: { from: "attacker", to: "rds01", ports: [0, 70000] } });
eq(malformedPortScan.outcome, "UNKNOWN", "malformed port scan is unknown");
const malformedMgmt = evaluateTest(scenario, initial, { id: "mgmtbad", type: "virtualization.management_exposure", label: "mgmtbad", params: { from: "attacker", to: "rds01", protocol: "icmp", port: 3389 } });
eq(malformedMgmt.outcome, "UNKNOWN", "management exposure rejects unsupported transport");
const missingAuditEvidence = evaluateTest(scenario, initial, { id: "auditbad", type: "backup.restore_test", label: "auditbad", params: { target: "rds01" } });
eq(missingAuditEvidence.outcome, "UNKNOWN", "missing backup evidence is unknown rather than false");
const nonBooleanAudit = structuredClone(scenario);
nonBooleanAudit.resources.find((r) => r.id === "rds01").properties.backup = { restoreTested: "yes" };
eq(evaluateTest(nonBooleanAudit, createInitialEngineState(nonBooleanAudit), { id: "auditbad2", type: "backup.restore_test", label: "auditbad2", params: { target: "rds01" } }).outcome, "UNKNOWN", "non-boolean audit evidence is unknown");


const malformedRoute = structuredClone(scenario);
malformedRoute.resources.find((r) => r.id === "firewall01").properties.routes = [{ destination: "not-a-cidr", action: "forward" }];
eq(queryReachability(malformedRoute, createInitialEngineState(malformedRoute), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "malformed declared route data propagates unknown");
const conflictingRoutes = structuredClone(scenario);
conflictingRoutes.resources.find((r) => r.id === "firewall01").properties.routes = [
  { destination: "rds01", via: "rds01", action: "forward" },
  { destination: "rds01", action: "blackhole" },
];
eq(queryReachability(conflictingRoutes, createInitialEngineState(conflictingRoutes), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "equally-specific conflicting routes are unknown");
const conflictingTrace = queryReachability(conflictingRoutes, createInitialEngineState(conflictingRoutes), "attacker", "rds01", "tcp", 3389).value?.routeDecisions?.[0];
eq(conflictingTrace?.truth, "UNKNOWN", "conflicting route trace remains UNKNOWN");
eq(conflictingTrace?.selectedRouteId, undefined, "conflicting equal-specificity routes expose no invented winner");
eq(conflictingTrace?.candidates.filter((candidate) => candidate.selected), [], "conflicting route rows are not visually marked selected");
const malformedRouteTrace = queryReachability(malformedRoute, createInitialEngineState(malformedRoute), "attacker", "rds01", "tcp", 3389).value?.routeDecisions?.[0];
eq(malformedRouteTrace?.candidates[0]?.disposition, "MALFORMED", "malformed route data is explicit in the trace");
const malformedNeighbor = structuredClone(scenario);
malformedNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors = [
  { id: "bad-family", targetResourceId: "rds01", protocol: "ND", address: "10.20.0.10", state: "REACHABLE" },
];
const malformedNeighborResult = queryReachability(malformedNeighbor, createInitialEngineState(malformedNeighbor), "attacker", "rds01", "tcp", 3389);
eq(malformedNeighborResult.truth, "UNKNOWN", "ARP/ND protocol and address-family mismatch is unknown");
eq(malformedNeighborResult.value?.neighborDecisions?.[0]?.candidates[0]?.disposition, "MALFORMED", "malformed neighbor data is explicit in trace");
const duplicateNeighbor = structuredClone(scenario);
duplicateNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors = [
  { id: "n1", targetResourceId: "rds01", protocol: "ARP", address: "10.20.0.10", state: "REACHABLE" },
  { id: "n2", targetResourceId: "rds01", protocol: "ARP", address: "10.20.0.10", state: "FAILED" },
];
const duplicateNeighborResult = queryReachability(duplicateNeighbor, createInitialEngineState(duplicateNeighbor), "attacker", "rds01", "tcp", 3389);
eq(duplicateNeighborResult.truth, "UNKNOWN", "multiple matching neighbor rows never produce an invented winner");
eq(duplicateNeighborResult.value?.neighborDecisions?.[0]?.selectedEntryId, undefined, "ambiguous neighbor table exposes no selected entry");
eq(duplicateNeighborResult.value?.neighborDecisions?.[0]?.candidates.filter((candidate) => candidate.selected), [], "ambiguous neighbor rows are not visually selected");
const missingNeighbor = structuredClone(scenario);
missingNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors = [
  { id: "other", targetResourceId: "admin01", protocol: "ARP", address: "10.20.0.20", state: "REACHABLE" },
];
eq(queryReachability(missingNeighbor, createInitialEngineState(missingNeighbor), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "absent next-hop row is unknown rather than a fabricated cache miss or success");
const malformedVlan = structuredClone(scenario);
malformedVlan.connections[0].properties.vlan = 5000;
eq(queryReachability(malformedVlan, createInitialEngineState(malformedVlan), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "invalid VLAN declaration is unknown");
const malformedMembership = structuredClone(scenario);
malformedMembership.connections[0].properties.vlan = 10;
malformedMembership.resources.find((r) => r.id === "attacker").properties.vlans = ["ten"];
eq(queryReachability(malformedMembership, createInitialEngineState(malformedMembership), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "malformed VLAN membership is unknown");
const malformedAcl = structuredClone(scenario);
malformedAcl.resources.find((r) => r.id === "rds01").properties.acls = [{ source: "attacker", destination: "rds01", protocol: "tcp", port: 3389, action: "permit-ish" }];
eq(queryReachability(malformedAcl, createInitialEngineState(malformedAcl), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unsupported ACL action is unknown");


const malformedNat = structuredClone(scenario);
malformedNat.resources.find((r) => r.id === "firewall01").properties.natPolicy = "required";
malformedNat.resources.find((r) => r.id === "firewall01").properties.natRules = [
  { type: "dnat", destination: "rds01", protocol: "tcp", externalPort: 3389, translatedPort: 70000 },
];
const malformedNatResult = queryReachability(malformedNat, createInitialEngineState(malformedNat), "attacker", "rds01", "tcp", 3389);
eq(malformedNatResult.truth, "UNKNOWN", "invalid translated NAT port is unknown");
eq(malformedNatResult.value?.natDecisions?.[0]?.truth, "UNKNOWN", "invalid DNAT translation emits explicit UNKNOWN trace");
eq(malformedNatResult.value?.natDecisions?.[0]?.rules[0]?.disposition, "MALFORMED", "invalid DNAT translated port is marked malformed in Engine trace");
const malformedNatPolicy = structuredClone(scenario);
malformedNatPolicy.resources.find((r) => r.id === "firewall01").properties.natPolicy = "magic";
eq(queryReachability(malformedNatPolicy, createInitialEngineState(malformedNatPolicy), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unsupported natPolicy is unknown");
const wrongNatDestination = structuredClone(scenario);
wrongNatDestination.resources.find((r) => r.id === "firewall01").properties.natPolicy = "required";
wrongNatDestination.resources.find((r) => r.id === "firewall01").properties.natRules = [
  { type: "dnat", translatedDestination: "admin01", protocol: "tcp", externalPort: 3389, translatedPort: 3389 },
];
eq(queryReachability(wrongNatDestination, createInitialEngineState(wrongNatDestination), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "required NAT with rule translating another destination does not satisfy target");

// Phase 35 fail-closed SNAT and source-address uncertainty.
const badSnatBase = structuredClone(scenario);
badSnatBase.resources.find((r) => r.id === "attacker").interfaces = [{ id: "wan", addresses: ["10.42.0.10/24"] }];
badSnatBase.resources.find((r) => r.id === "firewall01").properties.snatPolicy = "required";
badSnatBase.resources.find((r) => r.id === "firewall01").properties.natRules = [
  { id: "outgoing", type: "snat", source: "attacker", destination: "rds01", protocol: "tcp", translatedSource: "198.51.100.25" },
];
const invalidSnatAddress = structuredClone(badSnatBase);
invalidSnatAddress.resources.find((r) => r.id === "firewall01").properties.natRules[0].translatedSource = "999.1.1.1";
eq(queryReachability(invalidSnatAddress, createInitialEngineState(invalidSnatAddress), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "SNAT with invalid translated source fails closed");
const ambiguousSnatSource = structuredClone(badSnatBase);
ambiguousSnatSource.resources.find((r) => r.id === "attacker").interfaces[0].addresses.push("10.42.0.11/24");
const ambiguousSnatResult = queryReachability(ambiguousSnatSource, createInitialEngineState(ambiguousSnatSource), "attacker", "rds01", "tcp", 3389);
eq(ambiguousSnatResult.truth, "UNKNOWN", "multiple source IP candidates cannot prove SNAT");
eq(ambiguousSnatResult.value?.natDecisions?.[0]?.rules[0]?.disposition, "INDETERMINATE", "ambiguous SNAT source becomes an explicit indeterminate rule trace");
eq(ambiguousSnatResult.value?.natDecisions?.[0]?.selectedRuleId, undefined, "indeterminate SNAT rule is never falsely selected");
const noSnatSource = structuredClone(badSnatBase);
noSnatSource.resources.find((r) => r.id === "attacker").interfaces = [];
eq(queryReachability(noSnatSource, createInitialEngineState(noSnatSource), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "missing source IP cannot prove SNAT");
const unsupportedNat66 = structuredClone(badSnatBase);
unsupportedNat66.resources.find((r) => r.id === "firewall01").properties.natRules[0].translatedSource = "2001:db8::1";
eq(queryReachability(unsupportedNat66, createInitialEngineState(unsupportedNat66), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "Foundation does not claim NAT66 support");
const unsupportedPat = structuredClone(badSnatBase);
unsupportedPat.resources.find((r) => r.id === "firewall01").properties.natRules[0].translatedPort = 45000;
eq(queryReachability(unsupportedPat, createInitialEngineState(unsupportedPat), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "Foundation SNAT does not infer port address translation");
const unknownSnatPolicy = structuredClone(badSnatBase);
unknownSnatPolicy.resources.find((r) => r.id === "firewall01").properties.snatPolicy = "magic";
eq(queryReachability(unknownSnatPolicy, createInitialEngineState(unknownSnatPolicy), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unsupported SNAT policy fails closed");
const unknownSourceCidr = structuredClone(scenario);
unknownSourceCidr.resources.find((r) => r.id === "rds01").properties.acls = [
  { source: "10.42.0.0/16", destination: "rds01", protocol: "tcp", port: 3389, action: "deny" },
];
unknownSourceCidr.resources.find((r) => r.id === "rds01").properties.aclDefaultAction = "allow";
const unknownSourceCidrResult = queryReachability(unknownSourceCidr, createInitialEngineState(unknownSourceCidr), "attacker", "rds01", "tcp", 3389);
eq(unknownSourceCidrResult.truth, "UNKNOWN", "missing original source address cannot bypass an earlier CIDR deny rule");
const unknownSourceDecision = unknownSourceCidrResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(unknownSourceDecision?.rules[0]?.disposition, "INDETERMINATE", "ACL X-Ray marks unresolved CIDR selector as indeterminate");
eq(unknownSourceDecision?.selectedPolicyId, undefined, "indeterminate ACL row never becomes a selected policy");
eq(unknownSourceDecision?.usedDefault, false, "indeterminate earlier rule cannot fall through to default allow");

const malformedAclCollection = structuredClone(scenario);
malformedAclCollection.resources.find((r) => r.id === "rds01").properties.acls = { action: "allow" };
const malformedAclCollectionResult = queryReachability(malformedAclCollection, createInitialEngineState(malformedAclCollection), "attacker", "rds01", "tcp", 3389);
eq(malformedAclCollectionResult.truth, "UNKNOWN", "non-array ACL collection fails closed");
const malformedAclCollectionDecision = malformedAclCollectionResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(malformedAclCollectionDecision?.truth, "UNKNOWN", "malformed ACL collection produces explicit UNKNOWN Engine trace");
eq(malformedAclCollectionDecision?.rules, [], "malformed ACL collection cannot invent rule rows");

const malformedAclDefault = structuredClone(scenario);
malformedAclDefault.resources.find((r) => r.id === "rds01").properties.aclDefaultAction = "permit-ish";
const malformedAclDefaultResult = queryReachability(malformedAclDefault, createInitialEngineState(malformedAclDefault), "attacker", "rds01", "tcp", 3389);
eq(malformedAclDefaultResult.truth, "UNKNOWN", "unsupported default-only ACL action fails closed in Engine");
const malformedAclDefaultDecision = malformedAclDefaultResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(malformedAclDefaultDecision?.usedDefault, false, "unsupported ACL default is not reported as a used decision");
eq(malformedAclDefaultDecision?.selectedPolicyId, undefined, "unsupported ACL default has no selected policy identity");
const invalidSourceCidr = structuredClone(badSnatBase);
invalidSourceCidr.resources.find((r) => r.id === "rds01").properties.acls = [
  { source: "10.42.0.0/33", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" },
];
eq(queryReachability(invalidSourceCidr, createInitialEngineState(invalidSourceCidr), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "invalid CIDR rule cannot be silently treated as unrelated resource selector");

const hiddenMalformedSnat = structuredClone(badSnatBase);
hiddenMalformedSnat.resources.find((r) => r.id === "firewall01").properties.natRules.push(
  { id: "later-invalid", type: "snat", translatedSource: "not-an-address" },
);
const hiddenMalformedSnatResult = queryReachability(hiddenMalformedSnat, createInitialEngineState(hiddenMalformedSnat), "attacker", "rds01", "tcp", 3389);
eq(hiddenMalformedSnatResult.truth, "UNKNOWN", "a valid earlier SNAT rule cannot hide a malformed later rule");
eq(hiddenMalformedSnatResult.value?.natDecisions?.[0]?.rules[0]?.disposition, "DECLARED", "SNAT prevalidation does not falsely claim the earlier valid rule was match-evaluated");
eq(hiddenMalformedSnatResult.value?.natDecisions?.[0]?.rules[1]?.disposition, "MALFORMED", "SNAT prevalidation exposes the later malformed declaration that fails closed");
const hiddenUnsupportedType = structuredClone(badSnatBase);
hiddenUnsupportedType.resources.find((r) => r.id === "firewall01").properties.natRules.push(
  { id: "later-unsupported", type: "masquerade", translatedSource: "198.51.100.25" },
);
const hiddenUnsupportedTypeResult = queryReachability(hiddenUnsupportedType, createInitialEngineState(hiddenUnsupportedType), "attacker", "rds01", "tcp", 3389);
eq(hiddenUnsupportedTypeResult.truth, "UNKNOWN", "unsupported NAT type cannot be hidden by an earlier matching SNAT rule");
eq(hiddenUnsupportedTypeResult.value?.natDecisions?.[0]?.rules[1]?.disposition, "MALFORMED", "unsupported NAT type is explicit in the SNAT validation trace");



// Phase 84 fail-closed MAC/CAM cases.
function adversarialSwitchingScenario() {
  const doc = structuredClone(scenario);
  const attacker = doc.resources.find((r) => r.id === "attacker");
  const rds = doc.resources.find((r) => r.id === "rds01");
  attacker.type = "linux.workstation";
  attacker.interfaces = [{ id: "eth0", label: "eth0", addresses: ["10.20.0.11/24"], mac: "02:00:00:00:20:11" }];
  rds.interfaces = [{ id: "eth0", label: "eth0", addresses: ["10.20.0.10/24"], mac: "02:00:00:00:20:10" }];
  doc.resources.push({ id: "sw01", type: "network.switch", label: "SW01", interfaces: [{ id: "p1", label: "p1", addresses: [] }, { id: "p2", label: "p2", addresses: [] }, { id: "p3", label: "p3", addresses: [] }], properties: { macTable: [] }, asset: { id: "network.switch", version: "1.0.0" } });
  doc.resources.push({ id: "observer", type: "linux.host", label: "Observer", interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.20.0.12/24"], mac: "02:00:00:00:20:12" }], properties: {} });
  doc.connections = [
    { id: "client_sw", kind: "network", from: { resource: "attacker", port: "eth0" }, to: { resource: "sw01", port: "p1" }, properties: {} },
    { id: "sw_rds", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "rds01", port: "eth0" }, properties: {} },
    { id: "sw_observer", kind: "network", from: { resource: "sw01", port: "p3" }, to: { resource: "observer", port: "eth0" }, properties: {} },
  ];
  return doc;
}
const ambiguousMac = adversarialSwitchingScenario();
ambiguousMac.resources.find((r) => r.id === "sw01").properties.macTable = [
  { id: "d1", mac: "02:00:00:00:20:10", interface: "p2" },
  { id: "d2", mac: "02:00:00:00:20:10", interface: "p3" },
];
const ambiguousMacResult = queryReachability(ambiguousMac, createInitialEngineState(ambiguousMac), "attacker", "rds01", "tcp", 3389);
eq(ambiguousMacResult.truth, "UNKNOWN", "ambiguous FDB destination entries fail closed");
eq(ambiguousMacResult.value?.macDecisions?.[0]?.selectedEntryId, undefined, "ambiguous FDB trace exposes no invented winner");
const malformedMac = adversarialSwitchingScenario();
malformedMac.resources.find((r) => r.id === "sw01").properties.macTable = [{ id: "bad", mac: "02:00:00:00:20:10", interface: "missing" }];
eq(queryReachability(malformedMac, createInitialEngineState(malformedMac), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "FDB entry referencing unknown interface fails closed");
const wrongPortMac = adversarialSwitchingScenario();
wrongPortMac.resources.find((r) => r.id === "sw01").properties.macTable = [{ id: "dst", mac: "02:00:00:00:20:10", interface: "p3" }];
const wrongPortResult = queryReachability(wrongPortMac, createInitialEngineState(wrongPortMac), "attacker", "rds01", "tcp", 3389);
eq(wrongPortResult.truth, "FALSE", "known-unicast FDB winner on another egress disproves declared path");
eq(wrongPortResult.value?.macDecisions?.[0]?.selectedEgressInterface, "p3", "wrong-path egress remains explicit in trace");
const duplicateEndpointMac = adversarialSwitchingScenario();
duplicateEndpointMac.resources.find((r) => r.id === "rds01").interfaces[0].mac = "02:00:00:00:20:11";
eq(queryReachability(duplicateEndpointMac, createInitialEngineState(duplicateEndpointMac), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "distinct peers with the same modeled MAC fail closed");
const multicastDestinationMac = adversarialSwitchingScenario();
multicastDestinationMac.resources.find((r) => r.id === "rds01").interfaces[0].mac = "01:00:5e:00:00:01";
eq(queryReachability(multicastDestinationMac, createInitialEngineState(multicastDestinationMac), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "multicast destination is not misclassified as unknown unicast without membership modeling");
const groupSourceMac = adversarialSwitchingScenario();
groupSourceMac.resources.find((r) => r.id === "attacker").interfaces[0].mac = "01:00:5e:00:00:02";
eq(queryReachability(groupSourceMac, createInitialEngineState(groupSourceMac), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "group-addressed source MAC is never learned as an Ethernet source");



// Phase 85 VLAN/access/trunk fail-closed cases.
function phase85AdversarialVlanScenario() {
  const doc = adversarialSwitchingScenario();
  const sw = doc.resources.find((r) => r.id === "sw01");
  delete sw.properties.macTable;
  sw.interfaces.find((i) => i.id === "p1").switchport = { mode: "access", accessVlan: 10 };
  sw.interfaces.find((i) => i.id === "p2").switchport = { mode: "access", accessVlan: 10 };
  sw.interfaces.find((i) => i.id === "p3").switchport = { mode: "access", accessVlan: 20 };
  return doc;
}
const vlanMissingAccess = phase85AdversarialVlanScenario();
delete vlanMissingAccess.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p1").switchport.accessVlan;
eq(queryReachability(vlanMissingAccess, createInitialEngineState(vlanMissingAccess), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "access switchport without accessVlan fails closed");

const vlanEmptyTrunk = phase85AdversarialVlanScenario();
vlanEmptyTrunk.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p2").switchport = { mode: "trunk", allowedVlans: [] };
eq(queryReachability(vlanEmptyTrunk, createInitialEngineState(vlanEmptyTrunk), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "trunk with empty allowed VLAN set fails closed");

const vlanBadNative = phase85AdversarialVlanScenario();
vlanBadNative.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p2").switchport = { mode: "trunk", allowedVlans: [10], nativeVlan: 20 };
eq(queryReachability(vlanBadNative, createInitialEngineState(vlanBadNative), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "native VLAN not present in allowed VLAN set fails closed");

const vlanMissingConnectedPortModel = phase85AdversarialVlanScenario();
delete vlanMissingConnectedPortModel.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p2").switchport;
eq(queryReachability(vlanMissingConnectedPortModel, createInitialEngineState(vlanMissingConnectedPortModel), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "connected switch interface without switchport truth fails closed once explicit VLAN model exists");

const vlanUnsupportedMode = phase85AdversarialVlanScenario();
vlanUnsupportedMode.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p2").switchport = { mode: "hybrid", accessVlan: 10 };
eq(queryReachability(vlanUnsupportedMode, createInitialEngineState(vlanUnsupportedMode), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unsupported switchport mode fails closed");

const vlanTrunkNoFrame = phase85AdversarialVlanScenario();
vlanTrunkNoFrame.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p1").switchport = { mode: "trunk", allowedVlans: [10] };
eq(queryReachability(vlanTrunkNoFrame, createInitialEngineState(vlanTrunkNoFrame), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "trunk ingress without Engine frame VLAN or explicit link VLAN fails closed");

const vlanTrunkExplicit = phase85AdversarialVlanScenario();
vlanTrunkExplicit.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p1").switchport = { mode: "trunk", allowedVlans: [10] };
vlanTrunkExplicit.connections.find((c) => c.id === "client_sw").properties.vlan = 20;
eq(queryReachability(vlanTrunkExplicit, createInitialEngineState(vlanTrunkExplicit), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "trunk rejects explicitly modeled VLAN outside allowed set");

const vlanDuplicatePortLink = phase85AdversarialVlanScenario();
vlanDuplicatePortLink.connections.push({ id: "duplicate_p2", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "observer", port: "eth0" }, properties: {} });
eq(queryReachability(vlanDuplicatePortLink, createInitialEngineState(vlanDuplicatePortLink), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "switchport mapped to multiple enabled connections fails closed");

const vlanConnectionConflict = phase85AdversarialVlanScenario();
vlanConnectionConflict.connections.find((c) => c.id === "client_sw").properties.vlan = 20;
const vlanConnectionConflictResult = queryReachability(vlanConnectionConflict, createInitialEngineState(vlanConnectionConflict), "attacker", "rds01", "tcp", 3389);
eq(vlanConnectionConflictResult.truth, "FALSE", "explicit connection VLAN conflicting with access VLAN is disproven");
eq(vlanConnectionConflictResult.value?.vlanDecisions?.[0]?.vlan, 10, "conflict trace retains Engine access classification instead of adopting link label");

const vlanFloodIncomplete = adversarialSwitchingScenario();
const vlanFloodIncompleteSw = vlanFloodIncomplete.resources.find((r) => r.id === "sw01");
vlanFloodIncompleteSw.interfaces.find((i) => i.id === "p1").switchport = { mode: "access", accessVlan: 10 };
vlanFloodIncompleteSw.interfaces.find((i) => i.id === "p2").switchport = { mode: "access", accessVlan: 10 };
// p3 is connected but intentionally has no switchport model.
vlanFloodIncompleteSw.properties.macTable = [{ id: "src", mac: "02:00:00:00:20:11", interface: "p1", vlan: 10 }];
eq(queryReachability(vlanFloodIncomplete, createInitialEngineState(vlanFloodIncomplete), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unknown-unicast flood refuses to fabricate VLAN eligibility for an unmodeled connected port");

// Phase 86 STP/BPDU fail-closed cases.
function phase86AdversarialStpScenario() {
  const doc = adversarialSwitchingScenario();
  const sw = doc.resources.find((r) => r.id === "sw01");
  sw.properties.stp = { protocol: "RSTP", bridgeId: "32768.020000000001", rootBridgeId: "32768.020000000099", rootPathCost: 4 };
  sw.properties.stpPorts = [
    { interface: "p1", role: "ROOT", state: "FORWARDING", bpdu: "RECEIVE" },
    { interface: "p2", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
    { interface: "p3", role: "ALTERNATE", state: "DISCARDING", bpdu: "RECEIVE" },
  ];
  return doc;
}
const stpMissingPort = phase86AdversarialStpScenario();
stpMissingPort.resources.find((r) => r.id === "sw01").properties.stpPorts = stpMissingPort.resources.find((r) => r.id === "sw01").properties.stpPorts.filter((p) => p.interface !== "p3");
eq(queryReachability(stpMissingPort, createInitialEngineState(stpMissingPort), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "partial STP state cannot imply eligibility for an unmodeled connected port");

const stpDuplicatePort = phase86AdversarialStpScenario();
stpDuplicatePort.resources.find((r) => r.id === "sw01").properties.stpPorts.push({ interface: "p2", role: "ALTERNATE", state: "BLOCKING" });
eq(queryReachability(stpDuplicatePort, createInitialEngineState(stpDuplicatePort), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "duplicate STP port rows fail closed");

const stpAmbiguousPortLink = phase86AdversarialStpScenario();
stpAmbiguousPortLink.connections.push({ id: "duplicate_p2_stp", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "observer", port: "eth0" }, properties: {} });
eq(queryReachability(stpAmbiguousPortLink, createInitialEngineState(stpAmbiguousPortLink), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "STP interface mapped to multiple enabled connections fails closed");

const stpUnknownPort = phase86AdversarialStpScenario();
stpUnknownPort.resources.find((r) => r.id === "sw01").properties.stpPorts.find((p) => p.interface === "p2").state = "UNKNOWN";
eq(queryReachability(stpUnknownPort, createInitialEngineState(stpUnknownPort), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "UNKNOWN STP egress state never becomes forwarding");

const stpMalformedState = phase86AdversarialStpScenario();
stpMalformedState.resources.find((r) => r.id === "sw01").properties.stpPorts.find((p) => p.interface === "p2").state = "FWD";
eq(queryReachability(stpMalformedState, createInitialEngineState(stpMalformedState), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "unsupported STP state fails closed");

const stpMalformedBridge = phase86AdversarialStpScenario();
stpMalformedBridge.resources.find((r) => r.id === "sw01").properties.stp.rootPathCost = -1;
eq(queryReachability(stpMalformedBridge, createInitialEngineState(stpMalformedBridge), "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "malformed STP bridge state fails closed");


// Phase 92 host-stack runtime tampering fails closed without fabricated process/socket ownership.
const badHostProcessRef = structuredClone(scenario);
badHostProcessRef.resources.find((r) => r.id === "rds01").properties.hostStack = {
  complete: true,
  processes: [{ id: "proc-rdp", name: "svchost.exe", service: "rdp" }],
  sockets: [{ id: "sock-rdp", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "LISTEN", processId: "ghost", service: "rdp" }],
};
const badHostProcessView = queryHostStackView(createInitialEngineState(badHostProcessRef), "rds01", "tcp", 3389);
eq(badHostProcessView.truth, "UNKNOWN", "socket reference to an unknown process fails closed");
eq(badHostProcessView.value?.truth, "UNKNOWN", "malformed host-stack trace exposes UNKNOWN rather than repaired ownership");
eq(badHostProcessView.value?.processes, [], "malformed host-stack trace does not leak partially trusted process ownership");

const duplicateHostProcess = structuredClone(scenario);
duplicateHostProcess.resources.find((r) => r.id === "rds01").properties.hostStack = {
  complete: true,
  processes: [{ id: "dup", name: "a" }, { id: "dup", name: "b" }],
  sockets: [],
};
eq(queryHostStackView(createInitialEngineState(duplicateHostProcess), "rds01").truth, "UNKNOWN", "duplicate process IDs fail closed");

const mismatchedServiceBinding = structuredClone(scenario);
const mismatchRds = mismatchedServiceBinding.resources.find((r) => r.id === "rds01");
mismatchRds.properties.http = { enabled: true, port: 80, protocol: "tcp" };
mismatchRds.properties.hostStack = {
  complete: true,
  processes: [{ id: "proc", name: "worker", service: "rdp" }],
  sockets: [{ id: "sock", protocol: "tcp", localAddress: "127.0.0.1", localPort: 80, state: "LISTEN", processId: "proc", service: "http" }],
};
eq(queryHostStackView(createInitialEngineState(mismatchedServiceBinding), "rds01", "tcp", 80).truth, "UNKNOWN", "socket/process service disagreement fails closed");

const invalidUdpListen = structuredClone(scenario);
const udpRds = invalidUdpListen.resources.find((r) => r.id === "rds01");
udpRds.properties.dns = { enabled: true, port: 53, protocol: "udp" };
udpRds.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "dns", protocol: "udp", localAddress: "0.0.0.0", localPort: 53, state: "LISTEN", service: "dns" }] };
eq(queryHostStackView(createInitialEngineState(invalidUdpListen), "rds01", "udp", 53).truth, "UNKNOWN", "UDP socket cannot fabricate TCP LISTEN semantics");

const validUdpBound = structuredClone(scenario);
const boundRds = validUdpBound.resources.find((r) => r.id === "rds01");
boundRds.properties.dns = { enabled: true, port: 53, protocol: "udp" };
boundRds.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "dns", protocol: "udp", localAddress: "::1", localPort: 53, state: "BOUND", service: "dns" }] };
const validUdpBoundView = queryHostStackView(createInitialEngineState(validUdpBound), "rds01", "udp", 53);
eq(validUdpBoundView.truth, "TRUE", "UDP BOUND socket is valid bounded host-stack evidence");
eq(validUdpBoundView.value?.sockets[0]?.bindScope, "LOOPBACK", "IPv6 loopback socket is classified as loopback bind");
eq(validUdpBoundView.value?.selectedSocketIds, ["dns"], "UDP BOUND socket can be selected for modeled UDP service view");



// Phase 93 adversarial DNS chain evidence must fail closed rather than guess.
const dnsScenario = structuredClone(scenario);
dnsScenario.resources = [
  { id: "dns-client", type: "windows.workstation", label: "DNS Client", asset: { id: "windows.workstation", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.10/24"] }], properties: { dnsServers: ["10.10.0.53"] } },
  { id: "dns1", type: "network.dns_server", label: "DNS", asset: { id: "network.dns_server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.53/24"] }], properties: { dns: { enabled: true, records: [{ name: "app.lab.test", address: "10.10.0.80" }] } } },
  { id: "app", type: "linux.server", label: "App", asset: { id: "linux.server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.80/24"] }], properties: {} },
];
dnsScenario.connections = [{ id: "client-dns", kind: "network", from: { resource: "dns-client", port: "eth0" }, to: { resource: "dns1", port: "eth0" }, properties: {} }];
const dnsBaseState = createInitialEngineState(dnsScenario);
eq(queryDnsChain(dnsScenario, dnsBaseState, "ghost", "app.lab.test").truth, "UNKNOWN", "missing DNS source is UNKNOWN");
eq(queryDnsChain(dnsScenario, dnsBaseState, "dns-client", "bad name").truth, "UNKNOWN", "invalid DNS name is UNKNOWN at direct Engine boundary");
const dnsMissingResolvers = structuredClone(dnsBaseState);
dnsMissingResolvers.resources["dns-client"] = { ...dnsMissingResolvers.resources["dns-client"], properties: {} };
eq(queryDnsChain(dnsScenario, dnsMissingResolvers, "dns-client", "app.lab.test").value?.configuredResolversState, "ABSENT", "missing resolver configuration is explicit ABSENT");
const dnsMalformedResolvers = structuredClone(dnsBaseState);
dnsMalformedResolvers.resources["dns-client"] = { ...dnsMalformedResolvers.resources["dns-client"], properties: { dnsServers: "10.10.0.53" } };
eq(queryDnsChain(dnsScenario, dnsMalformedResolvers, "dns-client", "app.lab.test").value?.configuredResolversState, "MALFORMED", "malformed resolver configuration is explicit MALFORMED");
const dnsUnmapped = structuredClone(dnsBaseState);
dnsUnmapped.resources["dns-client"] = { ...dnsUnmapped.resources["dns-client"], properties: { dnsServers: ["10.10.0.99"] } };
const dnsUnmappedResult = queryDnsChain(dnsScenario, dnsUnmapped, "dns-client", "app.lab.test");
eq(dnsUnmappedResult.truth, "UNKNOWN", "unmapped resolver address never fabricates DNS failure/success");
eq(dnsUnmappedResult.value?.attempts[0]?.disposition, "UNMAPPED", "unmapped resolver is visible in trace");
const dnsAmbiguousScenario = structuredClone(dnsScenario);
dnsAmbiguousScenario.resources.push({ id: "dns2", type: "network.dns_server", label: "DNS2", asset: { id: "network.dns_server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.53/24"] }], properties: { dns: { enabled: true, records: [] } } });
const dnsAmbiguous = queryDnsChain(dnsAmbiguousScenario, createInitialEngineState(dnsAmbiguousScenario), "dns-client", "app.lab.test");
eq(dnsAmbiguous.truth, "UNKNOWN", "duplicate resolver-address mapping is UNKNOWN");
eq(dnsAmbiguous.value?.attempts[0]?.disposition, "AMBIGUOUS_MAPPING", "duplicate resolver mapping is explicit");
const dnsDuplicateRecordsScenario = structuredClone(dnsScenario);
dnsDuplicateRecordsScenario.resources.find((r) => r.id === "dns1").properties.dns.records.push({ name: "app.lab.test", address: "10.10.0.81" });
const dnsDuplicateRecords = queryDnsChain(dnsDuplicateRecordsScenario, createInitialEngineState(dnsDuplicateRecordsScenario), "dns-client", "app.lab.test");
eq(dnsDuplicateRecords.truth, "UNKNOWN", "duplicate matching DNS records are UNKNOWN");
eq(dnsDuplicateRecords.value?.attempts[0]?.disposition, "RECORD_AMBIGUOUS", "ambiguous record set is explicit");
const dnsMalformedRecordScenario = structuredClone(dnsScenario);
dnsMalformedRecordScenario.resources.find((r) => r.id === "dns1").properties.dns.records[0].address = 123;
const dnsMalformedRecord = queryDnsChain(dnsMalformedRecordScenario, createInitialEngineState(dnsMalformedRecordScenario), "dns-client", "app.lab.test");
eq(dnsMalformedRecord.truth, "UNKNOWN", "malformed DNS answer is UNKNOWN");
eq(dnsMalformedRecord.value?.attempts[0]?.disposition, "RECORD_MALFORMED", "malformed answer stage is explicit");


// Phase 94 adversarial DHCP DORA evidence fails closed on absent, malformed, ambiguous and relay-only state.
const dhcpScenario = structuredClone(scenario);
dhcpScenario.resources = [
  { id: "client", type: "linux.workstation", label: "Client", asset: { id: "linux.workstation", version: "1.0.0" }, interfaces: [], properties: { dhcp: { enabled: true } } },
  { id: "sw", type: "network.switch", label: "Switch", asset: { id: "network.switch", version: "1.0.0" }, interfaces: [], properties: {} },
  { id: "dhcp", type: "network.dhcp_server", label: "DHCP", asset: { id: "network.dhcp_server", version: "1.0.0" }, interfaces: [], properties: { dhcp: { enabled: true, availableLeases: 2, offers: [{ client: "client", address: "10.30.0.10" }], prefixLength: 24 } } },
];
dhcpScenario.connections = [
  { id: "c-sw", kind: "network", from: { resource: "client" }, to: { resource: "sw" }, properties: {} },
  { id: "sw-d", kind: "network", from: { resource: "sw" }, to: { resource: "dhcp" }, properties: {} },
];
const dhcpBaseState = createInitialEngineState(dhcpScenario);
eq(queryDhcpDora(dhcpScenario, dhcpBaseState, "ghost").truth, "UNKNOWN", "missing DHCP client is UNKNOWN");
const dhcpMissingClientState = structuredClone(dhcpBaseState);
dhcpMissingClientState.resources.client = { ...dhcpMissingClientState.resources.client, properties: {} };
eq(queryDhcpDora(dhcpScenario, dhcpMissingClientState, "client").value?.clientState, "ABSENT", "missing DHCP client model is explicit ABSENT");
const dhcpMalformedClient = structuredClone(dhcpBaseState);
dhcpMalformedClient.resources.client = { ...dhcpMalformedClient.resources.client, properties: { dhcp: { enabled: "yes" } } };
eq(queryDhcpDora(dhcpScenario, dhcpMalformedClient, "client").value?.clientState, "MALFORMED", "malformed DHCP client state is explicit MALFORMED");
const dhcpNoOffers = structuredClone(dhcpBaseState);
dhcpNoOffers.resources.dhcp = { ...dhcpNoOffers.resources.dhcp, properties: { dhcp: { enabled: true, availableLeases: 2, prefixLength: 24 } } };
const dhcpNoOffersResult = queryDhcpDora(dhcpScenario, dhcpNoOffers, "client");
eq(dhcpNoOffersResult.truth, "UNKNOWN", "missing explicit server offer table remains UNKNOWN rather than inventing an address");
eq(dhcpNoOffersResult.value?.attempts[0]?.disposition, "OFFERS_UNKNOWN", "missing offer table is visible in trace");
const dhcpDuplicateOffer = structuredClone(dhcpBaseState);
dhcpDuplicateOffer.resources.dhcp = { ...dhcpDuplicateOffer.resources.dhcp, properties: { dhcp: { enabled: true, availableLeases: 2, offers: [{ client: "client", address: "10.30.0.10" }, { client: "client", address: "10.30.0.11" }], prefixLength: 24 } } };
const dhcpDuplicateOfferResult = queryDhcpDora(dhcpScenario, dhcpDuplicateOffer, "client");
eq(dhcpDuplicateOfferResult.truth, "UNKNOWN", "duplicate client offers remain UNKNOWN");
eq(dhcpDuplicateOfferResult.value?.attempts[0]?.disposition, "OFFER_AMBIGUOUS", "duplicate offers are explicit in trace");
const dhcpMalformedOffer = structuredClone(dhcpBaseState);
dhcpMalformedOffer.resources.dhcp = { ...dhcpMalformedOffer.resources.dhcp, properties: { dhcp: { enabled: true, availableLeases: 2, offers: [{ client: "client", address: "not-an-ip" }], prefixLength: 24 } } };
eq(queryDhcpDora(dhcpScenario, dhcpMalformedOffer, "client").value?.attempts[0]?.disposition, "OFFER_MALFORMED", "malformed offered address fails closed");
const dhcpRelayScenario = structuredClone(dhcpScenario);
dhcpRelayScenario.resources = dhcpRelayScenario.resources.filter((r) => r.id !== "sw");
dhcpRelayScenario.resources.splice(1, 0, { id: "router", type: "network.router", label: "Router", asset: { id: "network.router", version: "1.0.0" }, interfaces: [], properties: {} });
dhcpRelayScenario.connections = [
  { id: "c-r", kind: "network", from: { resource: "client" }, to: { resource: "router" }, properties: {} },
  { id: "r-d", kind: "network", from: { resource: "router" }, to: { resource: "dhcp" }, properties: {} },
];
const dhcpRelay = queryDhcpDora(dhcpRelayScenario, createInitialEngineState(dhcpRelayScenario), "client");
eq(dhcpRelay.truth, "FALSE", "DHCP does not cross an L3 router without an explicit relay model");
eq(dhcpRelay.value?.attempts[0]?.disposition, "L2_BLOCKED", "relay-only path is explicitly blocked at L2 boundary");


// Phase 95 adversarial listener/service-state evidence fails closed without fabricating listener truth.
const listenerScenario = structuredClone(scenario);
listenerScenario.resources = [{
  id: "svc-host",
  type: "linux.server",
  label: "Service Host",
  asset: { id: "linux.server", version: "1.0.0" },
  interfaces: [],
  properties: {
    services: [{ name: "ssh", enabled: false, port: 22, protocol: "tcp" }],
    hostStack: {
      complete: true,
      processes: [{ id: "proc-ssh", name: "sshd", service: "ssh" }],
      sockets: [{ id: "sock-ssh", protocol: "tcp", localAddress: "0.0.0.0", localPort: 22, state: "LISTEN", processId: "proc-ssh", service: "ssh" }],
    },
  },
}];
listenerScenario.connections = [];
const disabledButListening = queryListenerServiceState(createInitialEngineState(listenerScenario), "svc-host", "tcp", 22);
eq(disabledButListening.truth, "TRUE", "explicit LISTEN socket remains authoritative even when service declaration says disabled");
eq(disabledButListening.value?.serviceState, "DISABLED", "disabled service state is preserved separately from socket listener truth");
eq(disabledButListening.value?.listenerConsistency, "MISMATCH", "disabled-service/listening-socket disagreement is visible rather than hidden");

const malformedListenerScenario = structuredClone(listenerScenario);
malformedListenerScenario.resources[0].properties.hostStack.sockets.push(structuredClone(malformedListenerScenario.resources[0].properties.hostStack.sockets[0]));
const malformedListener = queryListenerServiceState(createInitialEngineState(malformedListenerScenario), "svc-host", "tcp", 22);
eq(malformedListener.truth, "UNKNOWN", "duplicate explicit socket identity makes listener truth UNKNOWN");
eq(malformedListener.value?.disposition, "MALFORMED", "malformed host-stack listener evidence is labeled MALFORMED");
eq(malformedListener.value?.selectedSocketIds, [], "malformed listener evidence does not expose a selected socket");

const absentListener = queryListenerServiceState(createInitialEngineState(listenerScenario), "ghost-service-host", "tcp", 22);
eq(absentListener.truth, "UNKNOWN", "absent listener target remains UNKNOWN");
eq(absentListener.value?.disposition, "RESOURCE_ABSENT", "absent target is explicitly classified");

const serviceOnlyNoMatchScenario = structuredClone(listenerScenario);
delete serviceOnlyNoMatchScenario.resources[0].properties.hostStack;
serviceOnlyNoMatchScenario.resources[0].properties.services = [{ name: "ssh", enabled: true, port: 2222, protocol: "tcp" }];
const serviceOnlyNoMatch = queryListenerServiceState(createInitialEngineState(serviceOnlyNoMatchScenario), "svc-host", "tcp", 22);
eq(serviceOnlyNoMatch.truth, "FALSE", "service-only compatibility proves false when declared services use another port");
eq(serviceOnlyNoMatch.value?.disposition, "NO_LISTENER", "service-only wrong-port decision is explicit NO_LISTENER");



// Phase 96 adversarial: malformed/ambiguous TCP lifecycle evidence fails closed.
const tcpAdversarialScenario = structuredClone(listenerScenario);
tcpAdversarialScenario.resources.unshift({
  id: "tcp-client",
  type: "endpoint.client",
  label: "TCP Client",
  asset: { id: "linux.client", version: "1.0.0" },
  interfaces: [{ id: "eth0", label: "eth0", addresses: ["198.51.100.10/24"] }],
  properties: {},
});
const tcpServer = tcpAdversarialScenario.resources.find((r) => r.id === "svc-host");
tcpServer.properties.hostStack.sockets = [
  { id: "listen", protocol: "tcp", localAddress: "0.0.0.0", localPort: 22, state: "LISTEN", processId: "proc-ssh", service: "ssh" },
  { id: "s1", protocol: "tcp", localAddress: "10.0.0.20", localPort: 22, remoteAddress: "198.51.100.10", remotePort: 50001, state: "ESTABLISHED", processId: "proc-ssh", service: "ssh" },
  { id: "s2", protocol: "tcp", localAddress: "10.0.0.20", localPort: 22, remoteAddress: "198.51.100.10", remotePort: 50002, state: "CLOSE_WAIT", processId: "proc-ssh", service: "ssh" },
];
const ambiguousTcp = queryTcpStateMachine(createInitialEngineState(tcpAdversarialScenario), "tcp-client", "svc-host", 22);
eq(ambiguousTcp.truth, "UNKNOWN", "multiple source-bound sessions with conflicting lifecycle state remain UNKNOWN");
eq(ambiguousTcp.value?.disposition, "SESSION_AMBIGUOUS", "conflicting TCP session states are explicitly classified ambiguous");
eq(ambiguousTcp.value?.currentStates, ["CLOSE_WAIT", "ESTABLISHED"], "ambiguous trace preserves the conflicting current states without choosing one");

const declarationTcpScenario = structuredClone(tcpAdversarialScenario);
delete declarationTcpScenario.resources.find((r) => r.id === "svc-host").properties.hostStack;
const declarationTcp = queryTcpStateMachine(createInitialEngineState(declarationTcpScenario), "tcp-client", "svc-host", 22);
eq(declarationTcp.truth, "UNKNOWN", "service-only compatibility cannot fabricate TCP socket lifecycle state");
eq(declarationTcp.value?.disposition, "DECLARATION_ONLY", "service-only TCP trace is explicitly declaration-only");
eq(declarationTcp.value?.socketRows, [], "service-only TCP trace fabricates no socket-state rows");

const malformedTcpScenario = structuredClone(tcpAdversarialScenario);
malformedTcpScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets.push(structuredClone(malformedTcpScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets[0]));
const malformedTcpState = queryTcpStateMachine(createInitialEngineState(malformedTcpScenario), "tcp-client", "svc-host", 22);
eq(malformedTcpState.truth, "UNKNOWN", "duplicate socket identity makes TCP state-machine truth UNKNOWN");
eq(malformedTcpState.value?.disposition, "MALFORMED", "malformed Host Stack is explicit in TCP state-machine trace");

const udpTcpStateScenario = structuredClone(tcpAdversarialScenario);
const udpHost = udpTcpStateScenario.resources.find((r) => r.id === "svc-host");
udpHost.properties.dns = { enabled: true, port: 53, protocol: "udp" };
udpHost.properties.hostStack.sockets = [{ id: "bad-udp", protocol: "udp", localAddress: "0.0.0.0", localPort: 53, state: "SYN_SENT", service: "dns" }];
eq(queryHostStackView(createInitialEngineState(udpTcpStateScenario), "svc-host", "udp", 53).truth, "UNKNOWN", "UDP socket cannot use TCP SYN_SENT lifecycle state");

eq(queryTcpStateMachine(createInitialEngineState(tcpAdversarialScenario), "ghost-client", "svc-host", 22).value?.disposition, "RESOURCE_ABSENT", "TCP state-machine query fails closed when source resource is absent");

console.log(`PASS engine adversarial suite: ${checks} assertions.`);
