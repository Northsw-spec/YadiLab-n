import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  ENGINE_VERSION,
  applyOperation,
  applyOperations,
  createInitialEngineState,
  evaluateEngine,
  evaluateTest,
  evaluateRule,
  queryAuthentication,
  queryMembership,
  queryPermission,
  queryHostStackView,
  queryListenerServiceState,
  queryTcpStateMachine,
  queryDhcpDora,
  queryDnsChain,
  queryReachability,
  truthAll,
  truthAny,
  truthNot,
} from "../../dist-engine-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", rel), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

// Three-valued logic contract.
eq(ENGINE_VERSION, "0.8.0", "engine version");
eq(truthNot("TRUE"), "FALSE", "not true");
eq(truthNot("FALSE"), "TRUE", "not false");
eq(truthNot("UNKNOWN"), "UNKNOWN", "not unknown");
eq(truthAll(["TRUE", "TRUE"]), "TRUE", "all true");
eq(truthAll(["TRUE", "UNKNOWN"]), "UNKNOWN", "all uncertainty propagates");
eq(truthAll(["UNKNOWN", "FALSE"]), "FALSE", "all false decisive");
eq(truthAny(["FALSE", "FALSE"]), "FALSE", "any false");
eq(truthAny(["FALSE", "UNKNOWN"]), "UNKNOWN", "any uncertainty propagates");
eq(truthAny(["UNKNOWN", "TRUE"]), "TRUE", "any true decisive");

const scenario = fixture("valid/scenario-normalized.json");
const compiledScenario = JSON.parse(fs.readFileSync(path.join(root, "tests/generated/compiled-foundation.json"), "utf8"));
const compiledState = createInitialEngineState(compiledScenario);
const compiledEval = evaluateEngine(compiledScenario, compiledState);
eq(compiledEval.tests[0].outcome, "TRUE", "compiler-generated scenario executes in Engine");
eq(compiledEval.findings[0].state, "TRUE", "compiler-generated finding evaluates in Engine");
eq(compiledEval.completion.truth, "FALSE", "compiler-generated initial completion state is false");

const initial = createInitialEngineState(scenario);
eq(initial.stateRevision, 0, "initial revision");
eq(initial.scenarioHash, scenario.sourceHash, "scenario hash preserved");

// Foundation acceptance scenario: exposed RDP is provably reachable.
const reachable = queryReachability(scenario, initial, "attacker", "rds01", "tcp", 3389);
eq(reachable.truth, "TRUE", `RDP initially reachable: ${reachable.explanation.join(" | ")}`);
eq(reachable.value?.path, ["attacker", "firewall01", "rds01"], "deterministic path");
ok(reachable.explanation.some((line) => line.includes("allows")), "explanation names allow decision");
ok(reachable.explanation.some((line) => line.includes("listens")), "explanation names listener evidence");
const baseFirewallDecision = reachable.value?.policyDecisions?.find((decision) => decision.resourceId === "firewall01");
eq(baseFirewallDecision?.kind, "FIREWALL", "reachability exposes Engine-owned firewall decision trace");
eq(baseFirewallDecision?.firewallScope, "NETWORK", "network.firewall trace is explicitly classified as NETWORK scope");
eq(baseFirewallDecision?.truth, "TRUE", "firewall decision trace preserves allow truth");
eq(baseFirewallDecision?.selectedPolicyId, "firewall01.rules[0]", "firewall trace identifies the selected ordered rule");
eq(baseFirewallDecision?.rules[0]?.disposition, "MATCH", "selected firewall rule is marked MATCH");
eq(baseFirewallDecision?.rules[0]?.selected, true, "selected firewall rule is explicit in trace");

// Phase 90: local host firewall and network firewall are distinct Engine-owned policy locations.
const localFirewallScenario = structuredClone(scenario);
const localRds = localFirewallScenario.resources.find((r) => r.id === "rds01");
localRds.properties.isFirewall = true;
localRds.properties.rules = [
  { id: "local-deny-rdp", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "deny" },
];
localRds.properties.defaultAction = "allow";
const localFirewallResult = queryReachability(localFirewallScenario, createInitialEngineState(localFirewallScenario), "attacker", "rds01", "tcp", 3389);
eq(localFirewallResult.truth, "FALSE", "destination local host firewall can block after the network firewall allowed the path");
eq(localFirewallResult.value?.blockingPoint, "rds01", "local host firewall drop occurs at the destination host decision point");
const localFirewallDecisions = localFirewallResult.value?.policyDecisions?.filter((decision) => decision.kind === "FIREWALL") ?? [];
eq(localFirewallDecisions.map((decision) => decision.firewallScope), ["NETWORK", "LOCAL_HOST"], "Engine trace distinguishes network and local host firewall scopes in path order");
eq(localFirewallDecisions[1]?.resourceId, "rds01", "local host firewall trace is bound to the host resource");
eq(localFirewallDecisions[1]?.selectedPolicyId, "local-deny-rdp", "local host firewall retains exact selected rule identity");

// Phase 95 cross-layer listener truth: explicit complete Host Stack overrides declaration-only listener assumptions.
const explicitNoListenerScenario = structuredClone(scenario);
const explicitNoListenerRds = explicitNoListenerScenario.resources.find((r) => r.id === "rds01");
explicitNoListenerRds.properties.hostStack = {
  complete: true,
  processes: [{ id: "proc-rdp", name: "TermService", service: "rdp" }],
  sockets: [],
};
const explicitNoListenerReachability = queryReachability(explicitNoListenerScenario, createInitialEngineState(explicitNoListenerScenario), "attacker", "rds01", "tcp", 3389);
eq(explicitNoListenerReachability.truth, "FALSE", "enabled RDP declaration cannot prove reachability when complete Host Stack proves no listener");
eq(explicitNoListenerReachability.value?.blockingPoint, "rds01", "missing explicit listener blocks at destination host");
eq(explicitNoListenerReachability.value?.listenerServiceDecision?.model, "EXPLICIT_HOST_STACK", "reachability carries explicit listener/service model");
eq(explicitNoListenerReachability.value?.listenerServiceDecision?.listenerState, "NOT_LISTENING", "reachability exposes explicit NOT_LISTENING state");
eq(explicitNoListenerReachability.value?.listenerServiceDecision?.serviceState, "ENABLED", "service enablement remains separately visible when listener is absent");
eq(explicitNoListenerReachability.value?.listenerServiceDecision?.disposition, "NO_LISTENER", "enabled service without LISTEN socket is classified as NO_LISTENER");
eq(explicitNoListenerReachability.value?.hostStackDecision?.listenerConsistency, "MISMATCH", "host stack exposes service/listener mismatch instead of hiding it");

const explicitListenerScenario = structuredClone(explicitNoListenerScenario);
explicitListenerScenario.resources.find((r) => r.id === "rds01").properties.hostStack.sockets = [
  { id: "sock-rdp", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "LISTEN", processId: "proc-rdp", service: "rdp" },
];
const explicitListenerReachability = queryReachability(explicitListenerScenario, createInitialEngineState(explicitListenerScenario), "attacker", "rds01", "tcp", 3389);
eq(explicitListenerReachability.truth, "TRUE", "explicit LISTEN socket restores provable TCP reachability");
eq(explicitListenerReachability.value?.listenerServiceDecision?.listenerState, "LISTENING", "reachability carries explicit LISTENING state");
eq(explicitListenerReachability.value?.listenerServiceDecision?.selectedSocketIds, ["sock-rdp"], "reachability binds listener truth to exact socket identity");

const localFirewallAllowScenario = structuredClone(localFirewallScenario);
localFirewallAllowScenario.resources.find((r) => r.id === "rds01").properties.rules[0].action = "allow";
const localFirewallAllowResult = queryReachability(localFirewallAllowScenario, createInitialEngineState(localFirewallAllowScenario), "attacker", "rds01", "tcp", 3389);
eq(localFirewallAllowResult.truth, "TRUE", "network firewall plus local host firewall can both explicitly allow the flow");
eq(localFirewallAllowResult.value?.policyDecisions?.filter((decision) => decision.kind === "FIREWALL").map((decision) => decision.firewallScope), ["NETWORK", "LOCAL_HOST"], "successful path preserves both firewall decision locations");

// Phase 91: Engine-owned forward/return path comparison.
const basePathComparison = reachable.value?.pathComparison;
eq(basePathComparison?.forwardPath, ["attacker", "firewall01", "rds01"], "path comparison preserves the authoritative forward path");
eq(basePathComparison?.returnPath, ["rds01", "firewall01", "attacker"], "path comparison computes the deterministic return path");
eq(basePathComparison?.symmetry, "SYMMETRIC", "base topology return path is the exact reverse of forward path");
eq(basePathComparison?.returnEvaluationMode, "NETWORK_ONLY", "TCP service flow uses network-only return analysis when ephemeral return port is not modeled");
eq(basePathComparison?.returnSecurityStatus, "RETURN_TUPLE_NOT_MODELED", "TCP return security truth is explicitly not fabricated");
eq(basePathComparison?.returnPolicyDecisions, undefined, "network-only return analysis emits no reverse firewall policy trace");

const asymmetricScenario = structuredClone(scenario);
asymmetricScenario.resources.push({ id: "return-router", type: "network.router", label: "Return Router", asset: { id: "network.router", version: "1.0.0" }, interfaces: [], properties: {} });
asymmetricScenario.connections = [
  { id: "fwd-a-fw", kind: "network", from: { resource: "attacker" }, to: { resource: "firewall01" }, properties: { direction: "forward" } },
  { id: "fwd-fw-rds", kind: "network", from: { resource: "firewall01" }, to: { resource: "rds01" }, properties: { direction: "forward" } },
  { id: "ret-rds-router", kind: "network", from: { resource: "rds01" }, to: { resource: "return-router" }, properties: { direction: "forward" } },
  { id: "ret-router-a", kind: "network", from: { resource: "return-router" }, to: { resource: "attacker" }, properties: { direction: "forward" } },
];
const asymmetricResult = queryReachability(asymmetricScenario, createInitialEngineState(asymmetricScenario), "attacker", "rds01", "tcp", 3389);
eq(asymmetricResult.truth, "TRUE", "forward flow remains reachable in directed asymmetric topology");
eq(asymmetricResult.value?.pathComparison?.returnPath, ["rds01", "return-router", "attacker"], "return path follows independently declared directed topology");
eq(asymmetricResult.value?.pathComparison?.symmetry, "ASYMMETRIC", "different forward and return transit nodes produce explicit asymmetric classification");


// Phase 89: explicit conntrack/session state gates stateful firewall rules.
const statefulScenario = structuredClone(scenario);
const statefulAttacker = statefulScenario.resources.find((r) => r.id === "attacker");
statefulAttacker.interfaces = [{ id: "eth0", label: "eth0", addresses: ["198.51.100.10"] }];
const statefulFirewall = statefulScenario.resources.find((r) => r.id === "firewall01");
statefulFirewall.properties.rules = [
  { id: "allow-established-rdp", source: "wan", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "ESTABLISHED", action: "allow" },
];
statefulFirewall.properties.defaultAction = "deny";
statefulFirewall.properties.conntrack = {
  complete: true,
  entries: [
    { id: "ct-rdp", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" },
  ],
};
const establishedResult = queryReachability(statefulScenario, createInitialEngineState(statefulScenario), "attacker", "rds01", "tcp", 3389);
eq(establishedResult.truth, "TRUE", "ESTABLISHED conntrack state satisfies an explicit stateful allow rule");
const establishedConntrack = establishedResult.value?.conntrackDecisions?.find((decision) => decision.resourceId === "firewall01");
eq(establishedConntrack?.truth, "TRUE", "conntrack lookup is independently proven");
eq(establishedConntrack?.connectionState, "ESTABLISHED", "conntrack trace exposes the exact modeled session state");
eq(establishedConntrack?.selectedEntryId, "ct-rdp", "conntrack trace binds the exact matching entry");
eq(establishedConntrack?.entries[0]?.disposition, "MATCH", "matching conntrack row is explicit");
eq(establishedConntrack?.entries[0]?.selected, true, "matching conntrack row is selected by Engine");
const establishedPolicy = establishedResult.value?.policyDecisions?.find((decision) => decision.resourceId === "firewall01");
eq(establishedPolicy?.selectedPolicyId, "allow-established-rdp", "stateful firewall decision preserves selected rule identity");
eq(establishedPolicy?.rules[0]?.connectionState, "ESTABLISHED", "firewall X-Ray preserves declared connectionState");
eq(establishedPolicy?.rules[0]?.connectionStateMatch, "TRUE", "firewall rule trace binds conntrack state truth");

const completeConntrackMiss = structuredClone(statefulScenario);
completeConntrackMiss.resources.find((r) => r.id === "firewall01").properties.conntrack.entries[0].port = 22;
const completeConntrackMissResult = queryReachability(completeConntrackMiss, createInitialEngineState(completeConntrackMiss), "attacker", "rds01", "tcp", 3389);
eq(completeConntrackMissResult.truth, "FALSE", "complete conntrack miss does not satisfy stateful allow and falls through to default deny");
eq(completeConntrackMissResult.value?.conntrackDecisions?.[0]?.truth, "FALSE", "complete conntrack table can prove session absence");
eq(completeConntrackMissResult.value?.policyDecisions?.find((d) => d.resourceId === "firewall01")?.rules[0]?.connectionStateMatch, "FALSE", "stateful rule records proven state mismatch");

const invalidStateDenied = structuredClone(statefulScenario);
const invalidFirewall = invalidStateDenied.resources.find((r) => r.id === "firewall01");
invalidFirewall.properties.rules = [
  { id: "deny-invalid", source: "wan", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "INVALID", action: "deny" },
  { id: "allow-established", source: "wan", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "ESTABLISHED", action: "allow" },
];
invalidFirewall.properties.conntrack.entries[0].state = "INVALID";
const invalidStateResult = queryReachability(invalidStateDenied, createInitialEngineState(invalidStateDenied), "attacker", "rds01", "tcp", 3389);
eq(invalidStateResult.truth, "FALSE", "known INVALID conntrack state can deterministically select an explicit deny rule");
eq(invalidStateResult.value?.policyDecisions?.find((d) => d.resourceId === "firewall01")?.selectedPolicyId, "deny-invalid", "INVALID-state deny retains ordered policy identity");

const orderedAcl = structuredClone(scenario);
orderedAcl.resources.find((r) => r.id === "rds01").properties.acls = [
  { id: "deny_ssh", source: "any", destination: "rds01", protocol: "tcp", port: 22, action: "deny" },
  { id: "allow_rdp", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" },
  { id: "late_deny", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "deny" },
];
orderedAcl.resources.find((r) => r.id === "rds01").properties.aclDefaultAction = "deny";
const orderedAclResult = queryReachability(orderedAcl, createInitialEngineState(orderedAcl), "attacker", "rds01", "tcp", 3389);
eq(orderedAclResult.truth, "TRUE", "ordered ACL preserves first-match allow behavior");
const orderedAclDecision = orderedAclResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(orderedAclDecision?.rules.map((rule) => rule.disposition), ["NO_MATCH", "MATCH", "NOT_EVALUATED"], "ACL X-Ray records ordered evaluation without pretending later rules ran");
eq(orderedAclDecision?.selectedPolicyId, "allow_rdp", "ACL trace identifies selected rule");
eq(orderedAclDecision?.usedDefault, false, "ACL first-match trace does not claim default action was used");

const aclDefaultDeny = structuredClone(scenario);
aclDefaultDeny.resources.find((r) => r.id === "rds01").properties.aclDefaultAction = "deny";
const aclDefaultDenyResult = queryReachability(aclDefaultDeny, createInitialEngineState(aclDefaultDeny), "attacker", "rds01", "tcp", 3389);
eq(aclDefaultDenyResult.truth, "FALSE", "Engine owns default-only ACL deny decisions");
const aclDefaultDecision = aclDefaultDenyResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(aclDefaultDecision?.usedDefault, true, "ACL trace marks default action use");
eq(aclDefaultDecision?.selectedPolicyId, "rds01.aclDefaultAction", "ACL default decision has stable policy identity");
eq(aclDefaultDecision?.rules, [], "default-only ACL exposes an empty ordered rule table");

// Pure immutable reducer: canonical remediation denies the path.
const denied = applyOperation(initial, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(denied.ok, "firewall operation succeeds");
if (!denied.ok) process.exit(1);
eq(denied.state.stateRevision, 1, "revision increments");
eq(initial.resources.firewall01.properties.rules[0].action, "allow", "initial state remains immutable");
eq(denied.state.resources.firewall01.properties.rules[0].action, "deny", "new state contains remediation");
const blocked = queryReachability(scenario, denied.state, "attacker", "rds01", "tcp", 3389);
eq(blocked.truth, "FALSE", `RDP blocked after remediation: ${blocked.explanation.join(" | ")}`);
eq(blocked.value?.blockingPoint, "firewall01", "blocking point reported");
ok(blocked.explanation.some((line) => line.includes("blocks")), "explanation names deny decision");

// Alternative valid remediation: disabling destination service also blocks reachability.
const serviceOff = applyOperation(initial, { op: "set", target: "rds01", path: "properties.rdp.enabled", value: false });
ok(serviceOff.ok, "service disable operation succeeds");
if (!serviceOff.ok) process.exit(1);
eq(queryReachability(scenario, serviceOff.state, "attacker", "rds01", "tcp", 3389).truth, "FALSE", "disabled service blocks endpoint reachability");

// Unknown is preserved when policy or listener evidence is insufficient.
const noPolicy = structuredClone(scenario);
noPolicy.resources.find((r) => r.id === "firewall01").properties = {};
const noPolicyState = createInitialEngineState(noPolicy);
eq(queryReachability(noPolicy, noPolicyState, "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "missing firewall policy is unknown, not false");
const noListener = structuredClone(scenario);
noListener.resources.find((r) => r.id === "rds01").properties = {};
const noListenerState = createInitialEngineState(noListener);
eq(queryReachability(noListener, noListenerState, "attacker", "rds01", "tcp", 3389).truth, "UNKNOWN", "missing listener evidence is unknown");

// No topology path is a provable false under declared topology.
const disconnected = structuredClone(scenario);
disconnected.connections = [];
const disconnectedState = createInitialEngineState(disconnected);
eq(queryReachability(disconnected, disconnectedState, "attacker", "rds01", "tcp", 3389).truth, "FALSE", "declared disconnected topology is false");

// An alternate direct path remains reachable despite a firewall-denied path.
const bypassScenario = structuredClone(scenario);
bypassScenario.connections.push({ id: "bypass", kind: "network", from: { resource: "attacker" }, to: { resource: "rds01" }, properties: {} });
const bypassBase = createInitialEngineState(bypassScenario);
const bypassDenied = applyOperation(bypassBase, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(bypassDenied.ok, "bypass setup deny applied");
if (!bypassDenied.ok) process.exit(1);
const bypassReach = queryReachability(bypassScenario, bypassDenied.state, "attacker", "rds01", "tcp", 3389);
eq(bypassReach.truth, "TRUE", "alternate path prevents false claim of isolation");
eq(bypassReach.value?.path, ["attacker", "rds01"], "short deterministic bypass path selected");

// Unsafe/malformed operation paths are rejected and batch application is atomic.
const badPath = applyOperation(initial, { op: "set", target: "rds01", path: "properties.__proto__.polluted", value: true });
ok(!badPath.ok, "prototype-polluting path rejected");
eq(badPath.state, initial, "failed operation returns original state");
const batch = applyOperations(initial, [
  { op: "set", target: "rds01", path: "properties.nla", value: true },
  { op: "set", target: "missing", path: "properties.x", value: true },
]);
ok(!batch.ok, "batch fails on invalid target");
eq(batch.state.stateRevision, 0, "failed batch is atomic");
eq(batch.state.resources.rds01.properties.nla, false, "atomic batch rolls back prior operation");

// Identity Foundation scenario.
const identityScenario = {
  formatId: "infrastructure-cyber-lab.scenario",
  schemaVersion: "0.1.0",
  scenarioId: "identity_foundation",
  sourceHash: "b".repeat(64),
  metadata: { title: "Identity", description: "", language: "sv", authors: [], tags: [], briefing: "" },
  minimumEngineVersion: "0.2.0",
  capabilityLocks: [{ id: "core.identity", version: "1.0.0" }],
  profileLocks: [],
  zones: [],
  resources: [
    { id: "alice", type: "identity.user", label: "Alice", interfaces: [], properties: { memberOf: ["ops"], mfaEnabled: false } },
    { id: "ops", type: "identity.group", label: "Ops", interfaces: [], properties: { memberOf: ["admins"], members: ["alice"] } },
    { id: "admins", type: "identity.group", label: "Admins", interfaces: [], properties: { memberOf: [], members: ["ops"] } },
    { id: "finance", type: "identity.group", label: "Finance", interfaces: [], properties: { memberOf: [], members: [] } },
    { id: "srv01", type: "server.generic", label: "Server", interfaces: [], properties: {
      permissions: [{ subject: "admins", permission: "admin", effect: "allow" }],
      authentication: { enabled: true, allowedGroups: ["admins"], mfaRequired: true },
    } },
  ],
  connections: [],
  tests: [
    { id: "auth", type: "identity.authentication_test", label: "Auth", params: { subject: "alice", target: "srv01" }, expectedInitial: "FALSE" },
    { id: "priv", type: "identity.privilege_path", label: "Privilege", params: { subject: "alice", resource: "srv01", permission: "admin" }, expectedInitial: "TRUE" },
  ],
  findings: [],
  objectives: [{ id: "mfa", title: "MFA enabled", category: "identity", required: true, condition: { op: "equals", target: "alice", path: "properties.mfaEnabled", value: true } }],
  completion: { op: "equals", target: "alice", path: "properties.mfaEnabled", value: true },
  hints: [],
};
const identityState = createInitialEngineState(identityScenario);
const member = queryMembership(identityState, "alice", "admins");
eq(member.truth, "TRUE", "transitive membership true");
eq(member.value?.path, ["alice", "ops", "admins"], "membership path explained");
eq(queryMembership(identityState, "alice", "finance").truth, "FALSE", "complete membership graph proves non-membership");
const permission = queryPermission(identityState, "alice", "srv01", "admin");
eq(permission.truth, "TRUE", "effective permission via group");
eq(permission.value?.via, "admins", "permission grant source reported");
eq(queryAuthentication(identityState, "alice", "srv01").truth, "FALSE", "MFA requirement blocks authentication when disabled");
const enableMfa = applyOperation(identityState, { op: "set", target: "alice", path: "properties.mfaEnabled", value: true });
ok(enableMfa.ok, "MFA operation succeeds");
if (!enableMfa.ok) process.exit(1);
eq(queryAuthentication(enableMfa.state, "alice", "srv01").truth, "TRUE", "MFA-enabled identity authenticates");
const unknownPermScenario = structuredClone(identityScenario);
unknownPermScenario.resources.find((r) => r.id === "srv01").properties = { authentication: { enabled: true, allowedGroups: ["admins"] } };
const unknownPermState = createInitialEngineState(unknownPermScenario);
eq(queryPermission(unknownPermState, "alice", "srv01", "admin").truth, "UNKNOWN", "missing permissions evidence remains unknown");

// Rule engine three-valued semantics and test-result references.
const ruleContext = { scenario, state: initial, testResults: {} };
eq(evaluateRule({ op: "equals", target: "rds01", path: "properties.nla", value: false }, ruleContext).truth, "TRUE", "equals rule true");
eq(evaluateRule({ op: "equals", target: "rds01", path: "properties.missing", value: false }, ruleContext).truth, "UNKNOWN", "missing equals path unknown");
eq(evaluateRule({ op: "not", rule: { op: "equals", target: "rds01", path: "properties.missing", value: false } }, ruleContext).truth, "UNKNOWN", "not unknown remains unknown");
eq(evaluateRule({ op: "all", rules: [
  { op: "equals", target: "rds01", path: "properties.nla", value: false },
  { op: "equals", target: "rds01", path: "properties.missing", value: false },
] }, ruleContext).truth, "UNKNOWN", "all propagates unknown");
eq(evaluateRule({ op: "test_result", test: "direct_rdp", expected: "TRUE" }, ruleContext).truth, "UNKNOWN", "unevaluated test_result unknown");
eq(evaluateRule({ op: "test_result", test: "direct_rdp", expected: "TRUE" }, { ...ruleContext, testResults: { direct_rdp: "TRUE" } }).truth, "TRUE", "test_result compares evaluated result");

// Full deterministic evaluation: tests -> findings -> objectives -> completion.
const initialEval = evaluateEngine(scenario, initial);
eq(initialEval.tests.length, 2, "two tests evaluated");
eq(initialEval.tests[0].outcome, "TRUE", "test outcome true initially");
eq(initialEval.tests[0].matchesExpectedInitial, "TRUE", "initial expectation matches");
eq(initialEval.tests[1].outcome, "TRUE", "management path works initially");
eq(initialEval.tests[1].matchesExpectedInitial, "TRUE", "management path initial expectation matches");
eq(initialEval.findings[0].state, "TRUE", "finding active initially");
eq(initialEval.objectives[0].state, "FALSE", "objective unmet initially");
eq(initialEval.completion.truth, "FALSE", "completion false initially");
eq(initialEval.evidence[0].sequence, 1, "evidence sequence deterministic");
eq(initialEval.evidence[0].testId, "direct_rdp", "evidence links test");
const solvedEval = evaluateEngine(scenario, denied.state);
eq(solvedEval.tests[0].outcome, "FALSE", "reachability test false after deny");
eq(solvedEval.tests[0].matchesExpectedInitial, "FALSE", "solved state no longer matches initial-fault expectation");
eq(solvedEval.tests[1].outcome, "TRUE", "management path survives canonical remediation");
eq(solvedEval.findings[0].state, "FALSE", "finding resolved");
eq(solvedEval.objectives[0].state, "TRUE", "objective satisfied");
eq(solvedEval.completion.truth, "TRUE", "completion true");

// Identity tests and completion evaluation.
const identityEval = evaluateEngine(identityScenario, identityState);
eq(identityEval.tests.find((t) => t.id === "auth")?.outcome, "FALSE", "auth test false before MFA");
eq(identityEval.tests.find((t) => t.id === "priv")?.outcome, "TRUE", "privilege test true");
eq(identityEval.objectives[0].state, "FALSE", "identity objective unmet");
const identitySolvedEval = evaluateEngine(identityScenario, enableMfa.state);
eq(identitySolvedEval.tests.find((t) => t.id === "auth")?.outcome, "TRUE", "auth test true after MFA");
eq(identitySolvedEval.objectives[0].state, "TRUE", "identity objective met");
eq(identitySolvedEval.completion.truth, "TRUE", "identity completion true");


// Phase 32: remaining named Foundation declarative tests.
const foundationDomainScenario = structuredClone(scenario);
foundationDomainScenario.resources.push(
  { id: "user01", type: "identity.user", label: "User 01", asset: { id: "actor.user", version: "1.0.0" }, interfaces: [], properties: { passwordPolicy: { compliant: false } } },
  { id: "siem01", type: "security.siem", label: "SIEM", asset: { id: "security.siem", version: "1.0.0" }, interfaces: [], properties: { logging: { visible: true, alerting: false } } },
  { id: "backup01", type: "security.backup", label: "Backup", asset: { id: "security.backup", version: "1.0.0" }, interfaces: [], properties: { backup: { restoreTested: true } } },
);
const domainState = createInitialEngineState(foundationDomainScenario);
const portScan = evaluateTest(foundationDomainScenario, domainState, { id: "scan", type: "network.port_scan", label: "scan", params: { from: "attacker", to: "rds01", protocol: "tcp", ports: [22, 3389] } });
eq(portScan.outcome, "TRUE", "port scan true when at least one declared port is reachable");
ok(portScan.explanation.some((line) => line.includes("TCP/3389: TRUE")), "port scan explanation names reachable port");
const closedScan = evaluateTest(foundationDomainScenario, domainState, { id: "scan2", type: "network.port_scan", label: "scan2", params: { from: "attacker", to: "rds01", protocol: "tcp", ports: [22, 443] } });
eq(closedScan.outcome, "FALSE", "port scan false when all requested ports are proven unreachable");
const passwordAudit = evaluateTest(foundationDomainScenario, domainState, { id: "pwd", type: "identity.password_audit", label: "pwd", params: { target: "user01" } });
eq(passwordAudit.outcome, "FALSE", "password audit uses standard compliant path");
const passwordWeakExpected = evaluateTest(foundationDomainScenario, domainState, { id: "pwd2", type: "identity.password_audit", label: "pwd2", params: { target: "user01", equals: false } });
eq(passwordWeakExpected.outcome, "TRUE", "password audit supports explicit expected boolean");
const managementExposure = evaluateTest(foundationDomainScenario, domainState, { id: "mgmt", type: "virtualization.management_exposure", label: "mgmt", params: { from: "attacker", to: "rds01", protocol: "tcp", port: 3389 } });
eq(managementExposure.outcome, "TRUE", "management exposure reuses deterministic reachability semantics");
const visibility = evaluateTest(foundationDomainScenario, domainState, { id: "vis", type: "logging.visibility_test", label: "vis", params: { target: "siem01" } });
eq(visibility.outcome, "TRUE", "logging visibility standard path true");
const alert = evaluateTest(foundationDomainScenario, domainState, { id: "alert", type: "logging.alert_test", label: "alert", params: { target: "siem01" } });
eq(alert.outcome, "FALSE", "logging alert standard path false");
const restore = evaluateTest(foundationDomainScenario, domainState, { id: "restore", type: "backup.restore_test", label: "restore", params: { target: "backup01" } });
eq(restore.outcome, "TRUE", "backup restore standard path true");
const visibilityOverride = evaluateTest(foundationDomainScenario, domainState, { id: "vis2", type: "logging.visibility_test", label: "vis2", params: { target: "siem01", path: "properties.logging.alerting", equals: false } });
eq(visibilityOverride.outcome, "TRUE", "boolean audit tests allow explicit schema-defined path override");


// Phase 33: declared routes, VLANs, and ACLs participate in reachability.
const routedScenario = structuredClone(scenario);
routedScenario.resources.find((r) => r.id === "firewall01").properties.routes = [
  { id: "to-rds", destination: "rds01", via: "rds01", action: "forward" },
];
const routedState = createInitialEngineState(routedScenario);
eq(queryReachability(routedScenario, routedState, "attacker", "rds01", "tcp", 3389).truth, "TRUE", "declared matching route preserves reachable path");
const routeTraceScenario = structuredClone(routedScenario);
routeTraceScenario.resources.find((r) => r.id === "firewall01").properties.routes = [
  { id: "disabled-specific", destination: "rds01", via: "admin01", action: "forward", enabled: false },
  { id: "other-host", destination: "admin01", via: "admin01", action: "forward" },
  { id: "to-rds", destination: "rds01", via: "rds01", interface: "wan0", action: "forward", metric: 20, preference: 100 },
];
routeTraceScenario.resources.find((r) => r.id === "firewall01").interfaces.push({ id: "wan0", label: "WAN", addresses: [] });
const routeTrace = queryReachability(routeTraceScenario, createInitialEngineState(routeTraceScenario), "attacker", "rds01", "tcp", 3389).value?.routeDecisions?.[0];
eq(routeTrace?.resourceId, "firewall01", "route trace identifies the evaluating resource");
eq(routeTrace?.destinationId, "rds01", "route trace binds the requested destination");
eq(routeTrace?.selectedRouteId, "to-rds", "route trace exposes the exact Engine-selected winner");
eq(routeTrace?.outgoingInterface, "wan0", "route trace exposes the selected modeled egress interface");
eq(routeTrace?.candidates.map((candidate) => candidate.disposition), ["DISABLED", "NO_MATCH", "MATCH"], "route trace preserves every row and Engine match state in declaration order");
eq(routeTrace?.candidates.map((candidate) => candidate.selected), [false, false, true], "only the Engine winner is marked selected");
eq(routeTrace?.candidates[2]?.declaredMetric, 20, "declared metric is exposed without UI inference");
eq(routeTrace?.candidates[2]?.declaredPreference, 100, "declared preference is exposed without UI inference");
const routeComparisonScenario = structuredClone(routeTraceScenario);
const routeComparisonFirewall = routeComparisonScenario.resources.find((r) => r.id === "firewall01");
routeComparisonFirewall.interfaces.push({ id: "lan0", label: "LAN", addresses: [] });
routeComparisonFirewall.properties.routes.push({ id: "to-attacker", destination: "attacker", via: "attacker", interface: "lan0", action: "forward", metric: 10, preference: 100 });
const routeComparison = queryReachability(routeComparisonScenario, createInitialEngineState(routeComparisonScenario), "attacker", "rds01", "tcp", 3389).value?.pathComparison;
const firewallInterfaceComparison = routeComparison?.interfaceComparisons.find((row) => row.resourceId === "firewall01");
eq(firewallInterfaceComparison?.forwardOutgoingInterface, "wan0", "path comparison binds forward selected route interface");
eq(firewallInterfaceComparison?.returnOutgoingInterface, "lan0", "path comparison binds return selected route interface");
eq(firewallInterfaceComparison?.differs, true, "path comparison explicitly marks different forward/return egress interfaces");
const neighborScenario = structuredClone(routeTraceScenario);
neighborScenario.resources.find((r) => r.id === "rds01").interfaces.push({ id: "eth0", label: "Ethernet", addresses: ["10.20.0.10/24"], mac: "02:00:00:00:20:10" });
neighborScenario.resources.find((r) => r.id === "firewall01").properties.neighbors = [
  { id: "admin-neighbor", targetResourceId: "admin01", protocol: "ARP", address: "10.20.0.20", mac: "02:00:00:00:20:20", interface: "wan0", state: "STALE" },
  { id: "rds-neighbor", targetResourceId: "rds01", protocol: "ARP", address: "10.20.0.10", mac: "02:00:00:00:20:10", interface: "wan0", state: "REACHABLE" },
];
const neighborReachability = queryReachability(neighborScenario, createInitialEngineState(neighborScenario), "attacker", "rds01", "tcp", 3389);
eq(neighborReachability.truth, "TRUE", "modeled REACHABLE neighbor preserves reachability");
const neighborTrace = neighborReachability.value?.neighborDecisions?.[0];
eq(neighborTrace?.resourceId, "firewall01", "neighbor trace identifies the resolving resource");
eq(neighborTrace?.selectedEntryId, "rds-neighbor", "neighbor trace exposes the exact Engine-selected entry");
eq(neighborTrace?.selectedProtocol, "ARP", "neighbor trace exposes modeled ARP protocol");
eq(neighborTrace?.selectedAddress, "10.20.0.10", "neighbor trace preserves modeled neighbor address");
eq(neighborTrace?.selectedMac, "02:00:00:00:20:10", "neighbor trace preserves modeled MAC without fabrication");
eq(neighborTrace?.outgoingInterface, "wan0", "neighbor trace exposes modeled interface");
eq(neighborTrace?.selectedState, "REACHABLE", "neighbor trace exposes modeled NUD state");
eq(neighborTrace?.candidates.map((candidate) => candidate.disposition), ["NO_MATCH", "MATCH"], "neighbor trace preserves every table row and Engine match state");
eq(neighborTrace?.candidates.map((candidate) => candidate.selected), [false, true], "only the Engine-selected neighbor row is marked selected");
const staleNeighbor = structuredClone(neighborScenario);
staleNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors[1].state = "STALE";
eq(queryReachability(staleNeighbor, createInitialEngineState(staleNeighbor), "attacker", "rds01", "tcp", 3389).truth, "TRUE", "modeled STALE neighbor remains usable");
const incompleteNeighbor = structuredClone(neighborScenario);
incompleteNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors[1].state = "INCOMPLETE";
const incompleteResult = queryReachability(incompleteNeighbor, createInitialEngineState(incompleteNeighbor), "attacker", "rds01", "tcp", 3389);
eq(incompleteResult.truth, "UNKNOWN", "modeled INCOMPLETE resolution remains unknown");
eq(incompleteResult.value?.blockingPoint, "firewall01", "INCOMPLETE resolution stops proven motion at resolver");
const failedNeighbor = structuredClone(neighborScenario);
failedNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors[1].state = "FAILED";
eq(queryReachability(failedNeighbor, createInitialEngineState(failedNeighbor), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "modeled FAILED neighbor blocks the path");
const ndNeighbor = structuredClone(neighborScenario);
ndNeighbor.resources.find((r) => r.id === "rds01").interfaces[0].addresses = ["2001:db8:20::10/64"];
ndNeighbor.resources.find((r) => r.id === "firewall01").properties.neighbors = [
  { id: "rds-nd", targetResourceId: "rds01", protocol: "ND", address: "2001:db8:20::10", mac: "02:00:00:00:20:10", interface: "wan0", state: "REACHABLE" },
];
eq(queryReachability(ndNeighbor, createInitialEngineState(ndNeighbor), "attacker", "rds01", "tcp", 3389).value?.neighborDecisions?.[0]?.selectedProtocol, "ND", "IPv6 neighbor discovery is traced only when explicitly modeled");
const blackholeScenario = structuredClone(routedScenario);
blackholeScenario.resources.find((r) => r.id === "firewall01").properties.routes[0].action = "blackhole";
eq(queryReachability(blackholeScenario, createInitialEngineState(blackholeScenario), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "blackhole route blocks path");
const wrongHopScenario = structuredClone(routedScenario);
wrongHopScenario.resources.find((r) => r.id === "firewall01").properties.routes[0].via = "admin01";
eq(queryReachability(wrongHopScenario, createInitialEngineState(wrongHopScenario), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "route via different next hop invalidates topology path");
const noRouteScenario = structuredClone(scenario);
noRouteScenario.resources.find((r) => r.id === "firewall01").properties.routes = [{ destination: "admin01", via: "admin01" }];
eq(queryReachability(noRouteScenario, createInitialEngineState(noRouteScenario), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "authoritative route table with no destination route blocks path");

const vlanScenario = structuredClone(scenario);
vlanScenario.connections[0].properties.vlan = 10;
vlanScenario.resources.find((r) => r.id === "attacker").properties.vlans = [10];
vlanScenario.resources.find((r) => r.id === "firewall01").properties.vlans = [10];
eq(queryReachability(vlanScenario, createInitialEngineState(vlanScenario), "attacker", "rds01", "tcp", 3389).truth, "TRUE", "compatible declared VLAN membership preserves path");
const vlanMismatch = structuredClone(vlanScenario);
vlanMismatch.resources.find((r) => r.id === "attacker").properties.vlans = [20];
eq(queryReachability(vlanMismatch, createInitialEngineState(vlanMismatch), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "VLAN membership mismatch blocks segment");

const aclScenario = structuredClone(scenario);
aclScenario.resources.find((r) => r.id === "rds01").properties.acls = [
  { id: "allow-rdp", source: "attacker", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" },
];
eq(queryReachability(aclScenario, createInitialEngineState(aclScenario), "attacker", "rds01", "tcp", 3389).truth, "TRUE", "destination ACL allow preserves path");
const aclDeny = structuredClone(aclScenario);
aclDeny.resources.find((r) => r.id === "rds01").properties.acls[0].action = "deny";
eq(queryReachability(aclDeny, createInitialEngineState(aclDeny), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "destination ACL deny blocks path");


// Phase 34: bounded DNAT/port-forward-aware reachability.
const natScenario = structuredClone(scenario);
const natFirewall = natScenario.resources.find((r) => r.id === "firewall01");
natFirewall.properties.rules[0].port = 8443;
natFirewall.properties.natPolicy = "required";
natFirewall.properties.natRules = [
  { id: "rdp-forward", type: "dnat", source: "attacker", destination: "rds01", protocol: "tcp", externalPort: 8443, translatedPort: 3389 },
];
const natResult = queryReachability(natScenario, createInitialEngineState(natScenario), "attacker", "rds01", "tcp", 8443);
eq(natResult.truth, "TRUE", "DNAT can map external port to declared internal listener");
eq(natResult.value?.translatedPort, 3389, "reachability details expose translated destination port");
ok(natResult.explanation.some((line) => line.includes("rdp-forward")), "DNAT explanation names matched rule");
eq(natResult.value?.natDecisions?.length, 1, "DNAT reachability carries one Engine-owned NAT decision trace");
eq(natResult.value?.natDecisions?.[0]?.kind, "DNAT", "DNAT trace declares its transformation kind");
eq(natResult.value?.natDecisions?.[0]?.selectedRuleId, "rdp-forward", "DNAT trace binds the exact selected rule");
eq(natResult.value?.natDecisions?.[0]?.inputPort, 8443, "DNAT trace preserves external input port");
eq(natResult.value?.natDecisions?.[0]?.outputPort, 3389, "DNAT trace preserves translated listener port");
eq(natResult.value?.natDecisions?.[0]?.transformation, "TRANSLATED", "DNAT trace explicitly classifies port translation");
eq(natResult.value?.natDecisions?.[0]?.rules[0]?.disposition, "MATCH", "DNAT trace marks the selected ordered rule as MATCH");

const natRequiredNoMatch = structuredClone(natScenario);
natRequiredNoMatch.resources.find((r) => r.id === "firewall01").properties.natRules[0].externalPort = 9443;
const natRequiredNoMatchResult = queryReachability(natRequiredNoMatch, createInitialEngineState(natRequiredNoMatch), "attacker", "rds01", "tcp", 8443);
eq(natRequiredNoMatchResult.truth, "FALSE", "required NAT policy blocks when no DNAT rule matches");
eq(natRequiredNoMatchResult.value?.natDecisions?.[0]?.transformation, "BLOCKED", "required no-match DNAT trace records policy block without inventing a translation");
eq(natRequiredNoMatchResult.value?.natDecisions?.[0]?.rules[0]?.disposition, "NO_MATCH", "required no-match DNAT trace preserves ordered rule miss");

const natBlock = structuredClone(natScenario);
natBlock.resources.find((r) => r.id === "firewall01").properties.natRules[0].action = "block";
eq(queryReachability(natBlock, createInitialEngineState(natBlock), "attacker", "rds01", "tcp", 8443).truth, "FALSE", "blocking DNAT rule blocks path");

// Phase 35: bounded IPv4 SNAT and downstream source-aware CIDR policy.
const snatScenario = structuredClone(scenario);
snatScenario.resources.find((r) => r.id === "attacker").interfaces = [
  { id: "uplink", addresses: ["10.42.0.10/24"] },
];
const snatGateway = snatScenario.resources.find((r) => r.id === "firewall01");
snatGateway.properties.snatPolicy = "required";
snatGateway.properties.natRules = [
  { id: "egress-snat", type: "snat", source: "attacker", destination: "rds01", protocol: "tcp", port: 3389, translatedSource: "198.51.100.44" },
];
snatGateway.properties.acls = [
  { source: "10.42.0.0/16", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" },
];
snatGateway.properties.aclDefaultAction = "deny";
const snatDestination = snatScenario.resources.find((r) => r.id === "rds01");
snatDestination.properties.acls = [
  { source: "198.51.100.0/24", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" },
];
snatDestination.properties.aclDefaultAction = "deny";
const snatResult = queryReachability(snatScenario, createInitialEngineState(snatScenario), "attacker", "rds01", "tcp", 3389);
eq(snatResult.truth, "TRUE", "SNAT translates declared IPv4 source for downstream CIDR ACL");
eq(snatResult.value?.translatedSource, "198.51.100.44", "result includes translated source address");
eq(snatResult.value?.matchedSnatRule, "egress-snat", "result identifies the exact matched SNAT rule");
const snatTrace = snatResult.value?.natDecisions?.find((decision) => decision.kind === "SNAT");
eq(snatTrace?.selectedRuleId, "egress-snat", "SNAT trace binds the exact selected rule");
eq(snatTrace?.inputSource, "10.42.0.10", "SNAT trace preserves original source address");
eq(snatTrace?.outputSource, "198.51.100.44", "SNAT trace preserves translated source address");
eq(snatTrace?.transformation, "TRANSLATED", "SNAT trace explicitly classifies source translation");
eq(snatTrace?.rules[0]?.sourceMatch, "TRUE", "SNAT trace preserves Engine source selector truth");
eq(snatResult.value?.pathComparison?.natStateImplication, "RETURN_TUPLE_REQUIRED", "forward NAT marks reverse tuple/state as required instead of fabricating reverse NAT truth");
ok(snatResult.explanation.some((line) => line.includes("10.42.0.10 -> 198.51.100.44")), "SNAT explanation traces forward-path rewrite");
const snatGatewayAclTrace = snatResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "firewall01");
const snatDestinationAclTrace = snatResult.value?.policyDecisions?.find((decision) => decision.kind === "ACL" && decision.resourceId === "rds01");
eq(snatGatewayAclTrace?.observedSource, "10.42.0.10", "upstream ACL trace binds the source address observed before SNAT on that resource");
eq(snatDestinationAclTrace?.observedSource, "198.51.100.44", "downstream ACL trace binds the translated source actually evaluated by Engine");
eq(snatDestinationAclTrace?.rules[0]?.sourceMatch, "TRUE", "downstream policy X-Ray preserves Engine CIDR source match truth after SNAT");

const snatIntoStatefulFirewall = structuredClone(snatScenario);
delete snatIntoStatefulFirewall.resources.find((r) => r.id === "rds01").properties.acls;
delete snatIntoStatefulFirewall.resources.find((r) => r.id === "rds01").properties.aclDefaultAction;
snatIntoStatefulFirewall.resources.push({
  id: "firewall02",
  type: "network.firewall",
  label: "Downstream stateful firewall",
  interfaces: [],
  asset: { id: "network.firewall", version: "1.0.0" },
  properties: {
    conntrack: { complete: true, entries: [{ id: "ct-after-snat", source: "198.51.100.44", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" }] },
    rules: [{ id: "allow-established-after-snat", source: "any", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "ESTABLISHED", action: "allow" }],
    defaultAction: "deny",
  },
});
snatIntoStatefulFirewall.connections = [
  { id: "wan_fw", kind: "network", from: { resource: "attacker" }, to: { resource: "firewall01" }, properties: {} },
  { id: "fw_fw2", kind: "network", from: { resource: "firewall01" }, to: { resource: "firewall02" }, properties: {} },
  { id: "fw2_rds", kind: "network", from: { resource: "firewall02" }, to: { resource: "rds01" }, properties: {} },
];
const snatIntoStatefulResult = queryReachability(snatIntoStatefulFirewall, createInitialEngineState(snatIntoStatefulFirewall), "attacker", "rds01", "tcp", 3389);
eq(snatIntoStatefulResult.truth, "TRUE", "downstream stateful firewall can consume conntrack state for the Engine-observed source after SNAT");
const downstreamConntrackAfterSnat = snatIntoStatefulResult.value?.conntrackDecisions?.find((decision) => decision.resourceId === "firewall02");
eq(downstreamConntrackAfterSnat?.observedSource, "198.51.100.44", "downstream conntrack lookup binds the translated source observed after SNAT");
eq(downstreamConntrackAfterSnat?.selectedEntryId, "ct-after-snat", "downstream conntrack lookup selects the translated-source session entry");
eq(downstreamConntrackAfterSnat?.connectionState, "ESTABLISHED", "downstream stateful policy consumes the modeled ESTABLISHED state after SNAT");
const downstreamStatefulPolicyAfterSnat = snatIntoStatefulResult.value?.policyDecisions?.find((decision) => decision.kind === "FIREWALL" && decision.resourceId === "firewall02");
eq(downstreamStatefulPolicyAfterSnat?.rules[0]?.connectionStateMatch, "TRUE", "stateful firewall X-Ray proves the conntrack state match after source translation");
const noSnat = structuredClone(snatScenario);
delete noSnat.resources.find((r) => r.id === "firewall01").properties.snatPolicy;
delete noSnat.resources.find((r) => r.id === "firewall01").properties.natRules;
eq(queryReachability(noSnat, createInitialEngineState(noSnat), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "downstream ACL cannot match translated CIDR without SNAT");
const optionalNoSnat = structuredClone(noSnat);
optionalNoSnat.resources.find((r) => r.id === "firewall01").properties.snatPolicy = "optional";
optionalNoSnat.resources.find((r) => r.id === "rds01").properties.acls[0].source = "10.42.0.0/16";
const optionalNoSnatResult = queryReachability(optionalNoSnat, createInitialEngineState(optionalNoSnat), "attacker", "rds01", "tcp", 3389);
eq(optionalNoSnatResult.truth, "TRUE", "optional no-match SNAT preserves original IPv4 source");
eq(optionalNoSnatResult.value?.natDecisions?.[0]?.kind, "SNAT", "optional SNAT policy emits an explicit transformation decision");
eq(optionalNoSnatResult.value?.natDecisions?.[0]?.transformation, "PASSTHROUGH", "optional no-match SNAT is explicit passthrough rather than an invented rewrite");
const requiredSnatNoMatch = structuredClone(snatScenario);
requiredSnatNoMatch.resources.find((r) => r.id === "firewall01").properties.natRules[0].port = 22;
eq(queryReachability(requiredSnatNoMatch, createInitialEngineState(requiredSnatNoMatch), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "required SNAT blocks when no rule matches");
const blockedSnat = structuredClone(snatScenario);
blockedSnat.resources.find((r) => r.id === "firewall01").properties.natRules[0].action = "deny";
eq(queryReachability(blockedSnat, createInitialEngineState(blockedSnat), "attacker", "rds01", "tcp", 3389).truth, "FALSE", "explicit matching SNAT deny blocks forward flow");

// DNAT and SNAT must compose in the same declared forwarding gateway.
const dualNat = structuredClone(natScenario);
dualNat.resources.find((r) => r.id === "attacker").interfaces = [{ id: "wan", addresses: ["10.42.0.10/24"] }];
const dualGateway = dualNat.resources.find((r) => r.id === "firewall01");
dualGateway.properties.snatPolicy = "required";
dualGateway.properties.natRules.push(
  { id: "outbound-snat", type: "snat", source: "attacker", destination: "rds01", protocol: "tcp", port: 3389, translatedSource: "198.51.100.44" },
);
const dualResult = queryReachability(dualNat, createInitialEngineState(dualNat), "attacker", "rds01", "tcp", 8443);
eq(dualResult.truth, "TRUE", "declared DNAT and SNAT compose on the same forwarding path");
eq(dualResult.value?.translatedPort, 3389, "composed NAT preserves translated listener port");
eq(dualResult.value?.translatedSource, "198.51.100.44", "composed NAT records translated egress source");
eq(dualResult.value?.natDecisions?.map((decision) => decision.kind), ["DNAT", "SNAT"], "combined NAT trace preserves Engine DNAT-then-SNAT evaluation order");
eq(dualResult.value?.natDecisions?.[0]?.outputPort, 3389, "combined NAT trace carries DNAT output into SNAT input port");
eq(dualResult.value?.natDecisions?.[1]?.inputPort, 3389, "SNAT trace observes the already-translated destination port");



// Phase 84 MAC/CAM engine-owned forwarding trace.
function switchingScenario() {
  const doc = structuredClone(scenario);
  const attacker = doc.resources.find((r) => r.id === "attacker");
  const rds = doc.resources.find((r) => r.id === "rds01");
  attacker.type = "linux.workstation";
  attacker.interfaces = [{ id: "eth0", label: "eth0", addresses: ["10.20.0.11/24"], mac: "02:00:00:00:20:11" }];
  rds.interfaces = [{ id: "eth0", label: "eth0", addresses: ["10.20.0.10/24"], mac: "02:00:00:00:20:10" }];
  doc.resources.push({ id: "sw01", type: "network.switch", label: "SW01", interfaces: [
    { id: "p1", label: "p1", addresses: [] }, { id: "p2", label: "p2", addresses: [] }, { id: "p3", label: "p3", addresses: [] },
  ], properties: { macTable: [
    { id: "src", mac: "02:00:00:00:20:11", interface: "p1" },
    { id: "dst", mac: "02:00:00:00:20:10", interface: "p2" },
  ] }, asset: { id: "network.switch", version: "1.0.0" } });
  doc.resources.push({ id: "observer", type: "linux.host", label: "Observer", interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.20.0.12/24"], mac: "02:00:00:00:20:12" }], properties: {} });
  doc.connections = [
    { id: "client_sw", kind: "network", from: { resource: "attacker", port: "eth0" }, to: { resource: "sw01", port: "p1" }, properties: {} },
    { id: "sw_rds", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "rds01", port: "eth0" }, properties: {} },
    { id: "sw_observer", kind: "network", from: { resource: "sw01", port: "p3" }, to: { resource: "observer", port: "eth0" }, properties: {} },
  ];
  return doc;
}
const macKnownScenario = switchingScenario();
const macKnown = queryReachability(macKnownScenario, createInitialEngineState(macKnownScenario), "attacker", "rds01", "tcp", 3389);
eq(macKnown.truth, "TRUE", "known-unicast MAC table permits modeled switch path");
const macKnownTrace = macKnown.value?.macDecisions?.[0];
eq(macKnownTrace?.learning, "REFRESHED", "source MAC on ingress is refreshed");
eq(macKnownTrace?.forwarding, "UNICAST", "destination FDB hit is known unicast");
eq(macKnownTrace?.selectedEntryId, "dst", "Engine selects destination FDB row");
eq(macKnownTrace?.selectedEgressInterface, "p2", "Engine exposes selected egress interface");
const macFloodScenario = switchingScenario();
macFloodScenario.resources.find((r) => r.id === "sw01").properties.macTable = [{ id: "src", mac: "02:00:00:00:20:11", interface: "p1" }];
const macFlood = queryReachability(macFloodScenario, createInitialEngineState(macFloodScenario), "attacker", "rds01", "tcp", 3389);
eq(macFlood.truth, "TRUE", "unknown unicast reaches expected modeled egress by deterministic flood");
eq(macFlood.value?.macDecisions?.[0]?.forwarding, "FLOOD", "unknown destination emits flood decision");
eq(macFlood.value?.macDecisions?.[0]?.floodInterfaces, ["p2", "p3"], "flood set is derived from modeled connected switch ports only");
const macLearnScenario = switchingScenario();
macLearnScenario.resources.find((r) => r.id === "sw01").properties.macTable = [{ id: "dst", mac: "02:00:00:00:20:10", interface: "p2" }];
const macLearn = queryReachability(macLearnScenario, createInitialEngineState(macLearnScenario), "attacker", "rds01", "tcp", 3389);
eq(macLearn.truth, "TRUE", "source MAC absence does not invent a pre-existing entry and known destination still forwards");
eq(macLearn.value?.macDecisions?.[0]?.learning, "LEARNED", "source MAC absent from modeled table emits deterministic learn decision");
const macFilteredScenario = switchingScenario();
macFilteredScenario.resources.find((r) => r.id === "sw01").properties.macTable.find((entry) => entry.id === "dst").interface = "p1";
const macFiltered = queryReachability(macFilteredScenario, createInitialEngineState(macFilteredScenario), "attacker", "rds01", "tcp", 3389);
eq(macFiltered.truth, "FALSE", "destination learned on ingress port is filtered rather than forwarded");
eq(macFiltered.value?.macDecisions?.[0]?.forwarding, "FILTERED", "ingress-port destination hit is explicit in MAC trace");
const macMoveScenario = switchingScenario();
macMoveScenario.resources.find((r) => r.id === "sw01").properties.macTable[0].interface = "p3";
const macMove = queryReachability(macMoveScenario, createInitialEngineState(macMoveScenario), "attacker", "rds01", "tcp", 3389);
eq(macMove.value?.macDecisions?.[0]?.learning, "MOVED", "source MAC on another modeled port emits deterministic move");



// Phase 85 VLAN/access/trunk Engine-owned decision trace.
function phase85AccessScenario() {
  const doc = switchingScenario();
  const sw = doc.resources.find((r) => r.id === "sw01");
  delete sw.properties.macTable;
  sw.interfaces.find((i) => i.id === "p1").switchport = { mode: "access", accessVlan: 10 };
  sw.interfaces.find((i) => i.id === "p2").switchport = { mode: "access", accessVlan: 10 };
  sw.interfaces.find((i) => i.id === "p3").switchport = { mode: "access", accessVlan: 20 };
  return doc;
}
const vlanAccess = phase85AccessScenario();
const vlanAccessResult = queryReachability(vlanAccess, createInitialEngineState(vlanAccess), "attacker", "rds01", "tcp", 3389);
eq(vlanAccessResult.truth, "TRUE", "same-VLAN access ports permit the modeled path");
eq(vlanAccessResult.value?.vlanDecisions?.length, 1, "access path emits one VLAN decision");
eq(vlanAccessResult.value?.vlanDecisions?.[0]?.vlan, 10, "access ingress classifies untagged frame into access VLAN");
eq(vlanAccessResult.value?.vlanDecisions?.[0]?.ingressMode, "ACCESS", "VLAN trace owns ingress access mode");
eq(vlanAccessResult.value?.vlanDecisions?.[0]?.egressMode, "ACCESS", "VLAN trace owns egress access mode");
eq(vlanAccessResult.value?.vlanDecisions?.[0]?.rewrite, "PRESERVE_UNTAGGED", "access-to-access preserves untagged wire state");
eq(vlanAccessResult.value?.vlanDecisions?.[0]?.ports.find((p) => p.interfaceId === "p3")?.disposition, "BLOCKED", "VLAN trace marks other-VLAN access port blocked");

const vlanAccessMismatch = phase85AccessScenario();
vlanAccessMismatch.resources.find((r) => r.id === "sw01").interfaces.find((i) => i.id === "p2").switchport.accessVlan = 20;
const vlanAccessMismatchResult = queryReachability(vlanAccessMismatch, createInitialEngineState(vlanAccessMismatch), "attacker", "rds01", "tcp", 3389);
eq(vlanAccessMismatchResult.truth, "FALSE", "access VLAN mismatch blocks egress");
eq(vlanAccessMismatchResult.value?.vlanDecisions?.[0]?.vlan, 10, "blocked access trace preserves classified VLAN evidence");

const vlanAccessToTrunk = phase85AccessScenario();
const vlanAccessToTrunkSw = vlanAccessToTrunk.resources.find((r) => r.id === "sw01");
vlanAccessToTrunkSw.interfaces.find((i) => i.id === "p2").switchport = { mode: "trunk", allowedVlans: [10, 20] };
const vlanAccessToTrunkResult = queryReachability(vlanAccessToTrunk, createInitialEngineState(vlanAccessToTrunk), "attacker", "rds01", "tcp", 3389);
eq(vlanAccessToTrunkResult.truth, "TRUE", "access-to-trunk allowed VLAN permits path");
eq(vlanAccessToTrunkResult.value?.vlanDecisions?.[0]?.rewrite, "ADD_TAG", "access-to-trunk adds 802.1Q tag");
eq(vlanAccessToTrunkResult.value?.vlanDecisions?.[0]?.egressTag, "TAGGED", "trunk egress exposes tagged wire state");

const vlanNativeTrunk = phase85AccessScenario();
const vlanNativeSw = vlanNativeTrunk.resources.find((r) => r.id === "sw01");
vlanNativeSw.interfaces.find((i) => i.id === "p2").switchport = { mode: "trunk", allowedVlans: [10, 20], nativeVlan: 10 };
const vlanNativeResult = queryReachability(vlanNativeTrunk, createInitialEngineState(vlanNativeTrunk), "attacker", "rds01", "tcp", 3389);
eq(vlanNativeResult.truth, "TRUE", "native VLAN trunk carries allowed native VLAN");
eq(vlanNativeResult.value?.vlanDecisions?.[0]?.egressTag, "UNTAGGED", "native VLAN leaves trunk untagged");
eq(vlanNativeResult.value?.vlanDecisions?.[0]?.rewrite, "PRESERVE_UNTAGGED", "access-to-native-trunk preserves untagged frame");

function phase85TwoSwitchScenario(native = false) {
  const doc = phase85AccessScenario();
  const sw1 = doc.resources.find((r) => r.id === "sw01");
  sw1.interfaces.find((i) => i.id === "p2").switchport = { mode: "trunk", allowedVlans: [10, 20], ...(native ? { nativeVlan: 10 } : {}) };
  doc.resources.push({
    id: "sw02", type: "network.switch", label: "SW02",
    interfaces: [
      { id: "p1", label: "p1", addresses: [], switchport: { mode: "trunk", allowedVlans: [10, 20], ...(native ? { nativeVlan: 10 } : {}) } },
      { id: "p2", label: "p2", addresses: [], switchport: { mode: "access", accessVlan: 10 } },
    ],
    properties: {}, asset: { id: "network.switch", version: "1.0.0" },
  });
  doc.connections = [
    { id: "client_sw1", kind: "network", from: { resource: "attacker", port: "eth0" }, to: { resource: "sw01", port: "p1" }, properties: {} },
    { id: "sw1_sw2", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "sw02", port: "p1" }, properties: {} },
    { id: "sw2_rds", kind: "network", from: { resource: "sw02", port: "p2" }, to: { resource: "rds01", port: "eth0" }, properties: {} },
  ];
  return doc;
}
const vlanTwoSwitch = phase85TwoSwitchScenario(false);
const vlanTwoSwitchResult = queryReachability(vlanTwoSwitch, createInitialEngineState(vlanTwoSwitch), "attacker", "rds01", "tcp", 3389);
eq(vlanTwoSwitchResult.truth, "TRUE", "Engine carries VLAN frame truth across adjacent modeled switches");
eq(vlanTwoSwitchResult.value?.vlanDecisions?.map((d) => d.resourceId), ["sw01", "sw02"], "two-switch path emits decisions in path order");
eq(vlanTwoSwitchResult.value?.vlanDecisions?.map((d) => d.rewrite), ["ADD_TAG", "REMOVE_TAG"], "access-trunk-access path adds then removes tag deterministically");
eq(vlanTwoSwitchResult.value?.vlanDecisions?.[1]?.ingressTag, "TAGGED", "second switch consumes Engine-carried tagged frame state");

const vlanTwoSwitchNative = phase85TwoSwitchScenario(true);
const vlanTwoSwitchNativeResult = queryReachability(vlanTwoSwitchNative, createInitialEngineState(vlanTwoSwitchNative), "attacker", "rds01", "tcp", 3389);
eq(vlanTwoSwitchNativeResult.truth, "TRUE", "native VLAN remains valid across two modeled trunks");
eq(vlanTwoSwitchNativeResult.value?.vlanDecisions?.map((d) => d.rewrite), ["PRESERVE_UNTAGGED", "PRESERVE_UNTAGGED"], "native trunk keeps native VLAN untagged end-to-end");

const vlanFloodScenario = switchingScenario();
const vlanFloodSw = vlanFloodScenario.resources.find((r) => r.id === "sw01");
vlanFloodSw.interfaces.find((i) => i.id === "p1").switchport = { mode: "access", accessVlan: 10 };
vlanFloodSw.interfaces.find((i) => i.id === "p2").switchport = { mode: "access", accessVlan: 10 };
vlanFloodSw.interfaces.find((i) => i.id === "p3").switchport = { mode: "access", accessVlan: 20 };
vlanFloodSw.properties.macTable = [{ id: "src", mac: "02:00:00:00:20:11", interface: "p1", vlan: 10 }];
const vlanFloodResult = queryReachability(vlanFloodScenario, createInitialEngineState(vlanFloodScenario), "attacker", "rds01", "tcp", 3389);
eq(vlanFloodResult.truth, "TRUE", "unknown unicast can flood within Engine-classified VLAN");
eq(vlanFloodResult.value?.macDecisions?.[0]?.vlan, 10, "MAC trace consumes Engine VLAN classification");
eq(vlanFloodResult.value?.macDecisions?.[0]?.floodInterfaces, ["p2"], "unknown-unicast flood excludes access ports in another VLAN");

// Phase 86 STP/BPDU Engine-owned forwarding state.
function phase86StpScenario() {
  const doc = switchingScenario();
  const sw = doc.resources.find((r) => r.id === "sw01");
  sw.properties.stp = { protocol: "RSTP", bridgeId: "32768.020000000001", rootBridgeId: "32768.020000000099", rootPathCost: 4 };
  sw.properties.stpPorts = [
    { interface: "p1", role: "ROOT", state: "FORWARDING", bpdu: "RECEIVE" },
    { interface: "p2", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
    { interface: "p3", role: "ALTERNATE", state: "DISCARDING", bpdu: "RECEIVE" },
  ];
  return doc;
}
const stpForwarding = phase86StpScenario();
const stpForwardingResult = queryReachability(stpForwarding, createInitialEngineState(stpForwarding), "attacker", "rds01", "tcp", 3389);
eq(stpForwardingResult.truth, "TRUE", "STP forwarding ingress and egress permit the modeled switch path");
const stpForwardingTrace = stpForwardingResult.value?.stpDecisions?.[0];
eq(stpForwardingTrace?.protocol, "RSTP", "STP trace preserves modeled protocol");
eq(stpForwardingTrace?.rootBridgeId, "32768.020000000099", "STP trace preserves Engine root identity");
eq(stpForwardingTrace?.isRootBridge, false, "Engine exposes root-bridge comparison without UI inference");
eq(stpForwardingTrace?.ports.find((p) => p.interfaceId === "p3")?.state, "DISCARDING", "STP trace exposes alternate discarded port");
eq(stpForwardingTrace?.ports.find((p) => p.interfaceId === "p2")?.bpdu, "SEND", "STP trace exposes explicit BPDU direction");

const stpBlocked = phase86StpScenario();
stpBlocked.resources.find((r) => r.id === "sw01").properties.stpPorts.find((p) => p.interface === "p2").state = "BLOCKING";
stpBlocked.resources.find((r) => r.id === "sw01").properties.acls = [{ id: "would_allow", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" }];
const stpBlockedResult = queryReachability(stpBlocked, createInitialEngineState(stpBlocked), "attacker", "rds01", "tcp", 3389);
eq(stpBlockedResult.truth, "FALSE", "STP blocking egress stops the modeled data path");
eq(stpBlockedResult.value?.blockingPoint, "sw01", "STP block is localized to the switching decision");
eq(stpBlockedResult.value?.stpDecisions?.[0]?.truth, "FALSE", "STP blocking decision is explicit in Engine trace");
eq(stpBlockedResult.value?.policyDecisions, undefined, "later ACL allow is not evaluated after STP already blocks the data path");
eq(stpBlockedResult.value?.matchedPolicy, "sw01.stpPorts", "STP remains the authoritative blocking policy before Phase D policy evaluation");

const stpBlocksDownstreamNat = phase86StpScenario();
stpBlocksDownstreamNat.resources.find((r) => r.id === "sw01").properties.stpPorts.find((p) => p.interface === "p2").state = "BLOCKING";
const downstreamNatFirewall = stpBlocksDownstreamNat.resources.find((r) => r.id === "firewall01");
downstreamNatFirewall.properties.natPolicy = "required";
downstreamNatFirewall.properties.natRules = [
  { id: "downstream-dnat", type: "dnat", source: "attacker", destination: "rds01", protocol: "tcp", externalPort: 8443, translatedPort: 3389 },
];
stpBlocksDownstreamNat.connections = [
  { id: "client_sw", kind: "network", from: { resource: "attacker", port: "eth0" }, to: { resource: "sw01", port: "p1" }, properties: {} },
  { id: "sw_fw", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "firewall01" }, properties: {} },
  { id: "fw_rds", kind: "network", from: { resource: "firewall01" }, to: { resource: "rds01", port: "eth0" }, properties: {} },
];
const stpBlocksDownstreamNatResult = queryReachability(stpBlocksDownstreamNat, createInitialEngineState(stpBlocksDownstreamNat), "attacker", "rds01", "tcp", 8443);
eq(stpBlocksDownstreamNatResult.truth, "FALSE", "upstream STP block remains authoritative before a downstream NAT resource is reached");
eq(stpBlocksDownstreamNatResult.value?.natDecisions, undefined, "Engine emits no downstream NAT trace for a resource the flow never reaches");

const stpBlocksDownstreamConntrack = phase86StpScenario();
stpBlocksDownstreamConntrack.resources.find((r) => r.id === "sw01").properties.stpPorts.find((p) => p.interface === "p2").state = "BLOCKING";
const downstreamStatefulFirewall = stpBlocksDownstreamConntrack.resources.find((r) => r.id === "firewall01");
downstreamStatefulFirewall.properties.conntrack = {
  complete: true,
  entries: [{ id: "ct-rdp", source: "10.20.0.11", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" }],
};
downstreamStatefulFirewall.properties.rules = [
  { id: "allow-established", source: "any", destination: "rds01", protocol: "tcp", port: 3389, connectionState: "ESTABLISHED", action: "allow" },
];
stpBlocksDownstreamConntrack.connections = [
  { id: "client_sw", kind: "network", from: { resource: "attacker", port: "eth0" }, to: { resource: "sw01", port: "p1" }, properties: {} },
  { id: "sw_fw", kind: "network", from: { resource: "sw01", port: "p2" }, to: { resource: "firewall01" }, properties: {} },
  { id: "fw_rds", kind: "network", from: { resource: "firewall01" }, to: { resource: "rds01", port: "eth0" }, properties: {} },
];
const stpBlocksDownstreamConntrackResult = queryReachability(stpBlocksDownstreamConntrack, createInitialEngineState(stpBlocksDownstreamConntrack), "attacker", "rds01", "tcp", 3389);
eq(stpBlocksDownstreamConntrackResult.truth, "FALSE", "upstream STP block remains authoritative before downstream conntrack/session state is reached");
eq(stpBlocksDownstreamConntrackResult.value?.conntrackDecisions, undefined, "Engine emits no downstream conntrack trace for a firewall the flow never reaches");
eq(stpBlocksDownstreamConntrackResult.value?.policyDecisions, undefined, "Engine emits no downstream stateful firewall policy trace after the upstream STP block");

const stpFlood = phase86StpScenario();
stpFlood.resources.find((r) => r.id === "sw01").properties.macTable = [{ id: "src", mac: "02:00:00:00:20:11", interface: "p1" }];
const stpFloodResult = queryReachability(stpFlood, createInitialEngineState(stpFlood), "attacker", "rds01", "tcp", 3389);
eq(stpFloodResult.truth, "TRUE", "unknown unicast remains reachable on an STP-forwarding egress");
eq(stpFloodResult.value?.macDecisions?.[0]?.floodInterfaces, ["p2"], "Engine flood set excludes STP-discarding port");


// Phase 92: Host Stack microscope projects explicit process/socket/service ownership without inventing missing metadata.
const serviceOnlyHostStack = reachable.value?.hostStackDecision;
eq(serviceOnlyHostStack?.model, "SERVICE_DECLARATIONS", "legacy service declarations project as service-only host-stack evidence");
eq(serviceOnlyHostStack?.complete, false, "service-only host-stack evidence never claims process/socket completeness");
eq(serviceOnlyHostStack?.selectedServiceNames, ["rdp"], "service-only host-stack trace binds the selected RDP service");
eq(serviceOnlyHostStack?.processes, [], "service-only host-stack trace does not invent a process");
eq(serviceOnlyHostStack?.sockets, [], "service-only host-stack trace does not invent a socket");

const explicitHostScenario = structuredClone(scenario);
const explicitRds = explicitHostScenario.resources.find((r) => r.id === "rds01");
explicitRds.properties.hostStack = {
  complete: true,
  processes: [{ id: "proc-rdp", name: "svchost.exe", pid: 1160, service: "rdp" }],
  sockets: [{ id: "sock-rdp", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "LISTEN", processId: "proc-rdp", service: "rdp" }],
};
const explicitHostState = createInitialEngineState(explicitHostScenario);
const explicitHostView = queryHostStackView(explicitHostState, "rds01", "tcp", 3389);
eq(explicitHostView.truth, "TRUE", "explicit host stack view is valid Engine evidence");
eq(explicitHostView.value?.model, "EXPLICIT_HOST_STACK", "Engine distinguishes explicit host-stack snapshot from service-only fallback");
eq(explicitHostView.value?.complete, true, "explicit complete host-stack snapshot preserves completeness");
eq(explicitHostView.value?.processes[0]?.name, "svchost.exe", "Engine preserves modeled process name");
eq(explicitHostView.value?.processes[0]?.pid, 1160, "Engine preserves modeled PID without synthesis");
eq(explicitHostView.value?.sockets[0]?.bindScope, "WILDCARD", "0.0.0.0 socket is deterministically classified as wildcard bind");
eq(explicitHostView.value?.sockets[0]?.state, "LISTEN", "TCP listener preserves modeled LISTEN state");
eq(explicitHostView.value?.services[0]?.owningProcessIds, ["proc-rdp"], "service view binds owning process by explicit service reference");
eq(explicitHostView.value?.services[0]?.socketIds, ["sock-rdp"], "service view binds explicit listener socket");
eq(explicitHostView.value?.selectedSocketIds, ["sock-rdp"], "requested TCP/3389 highlights exact listener socket");
eq(explicitHostView.value?.listenerConsistency, "CONSISTENT", "explicit listener agrees with declared enabled RDP service");
const explicitReachability = queryReachability(explicitHostScenario, explicitHostState, "attacker", "rds01", "tcp", 3389);
eq(explicitReachability.truth, "TRUE", "host-stack microscope does not replace existing reachability/listener semantics");
eq(explicitReachability.value?.hostStackDecision?.selectedSocketIds, ["sock-rdp"], "reachability carries Engine-owned host-stack listener evidence");



// Phase 93: Engine-owned DNS chain trace reuses modeled resolver/network/service/record truth.
const dnsScenario = structuredClone(scenario);
dnsScenario.resources = [
  { id: "dns-client", type: "windows.workstation", label: "DNS Client", asset: { id: "windows.workstation", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.10/24"] }], properties: { dnsServers: ["10.10.0.53"] } },
  { id: "dns1", type: "network.dns_server", label: "DNS", asset: { id: "network.dns_server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.53/24"] }], properties: { dns: { enabled: true, records: [{ name: "App.Lab.Test.", address: "10.10.0.80" }] } } },
  { id: "app", type: "linux.server", label: "App", asset: { id: "linux.server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.10.0.80/24"] }], properties: {} },
];
dnsScenario.connections = [
  { id: "client-dns", kind: "network", from: { resource: "dns-client", port: "eth0" }, to: { resource: "dns1", port: "eth0" }, properties: {} },
];
const dnsState = createInitialEngineState(dnsScenario);
const dnsHealthy = queryDnsChain(dnsScenario, dnsState, "dns-client", "APP.LAB.TEST.");
eq(dnsHealthy.truth, "TRUE", "DNS chain resolves through the Engine-owned resolver chain");
eq(dnsHealthy.value?.queryName, "app.lab.test", "DNS chain canonicalizes the query name");
eq(dnsHealthy.value?.configuredResolversState, "KNOWN", "DNS chain proves configured resolver state");
eq(dnsHealthy.value?.resolverAddresses, ["10.10.0.53"], "DNS chain preserves resolver order");
eq(dnsHealthy.value?.attempts[0]?.disposition, "RESOLVED", "DNS resolver attempt records successful disposition");
eq(dnsHealthy.value?.attempts[0]?.selectedResourceId, "dns1", "DNS resolver address maps to exact DNS resource");
eq(dnsHealthy.value?.attempts[0]?.networkTruth, "TRUE", "DNS resolver network reachability is explicit in trace");
eq(dnsHealthy.value?.resolvedAddress, "10.10.0.80", "DNS answer address is Engine-owned evidence");
eq(dnsHealthy.value?.resolvedResourceIds, ["app"], "DNS answer maps to declared resource without inventing reachability to that answer");

const dnsBlockedScenario = structuredClone(dnsScenario);
dnsBlockedScenario.resources.splice(1, 0, {
  id: "dns-fw",
  type: "network.firewall",
  label: "DNS Firewall",
  asset: { id: "network.firewall", version: "1.0.0" },
  interfaces: [],
  properties: {
    rules: [{ id: "deny-dns", source: "any", destination: "dns1", protocol: "any", action: "deny" }],
    defaultAction: "allow",
  },
});
dnsBlockedScenario.connections = [
  { id: "client-fw", kind: "network", from: { resource: "dns-client" }, to: { resource: "dns-fw" }, properties: {} },
  { id: "fw-dns", kind: "network", from: { resource: "dns-fw" }, to: { resource: "dns1" }, properties: {} },
];
const dnsBlocked = queryDnsChain(dnsBlockedScenario, createInitialEngineState(dnsBlockedScenario), "dns-client", "app.lab.test");
eq(dnsBlocked.truth, "FALSE", "network policy block is a conclusive DNS resolver failure");
eq(dnsBlocked.value?.attempts[0]?.disposition, "NETWORK_BLOCKED", "DNS chain stops at the network block stage");
eq(dnsBlocked.value?.attempts[0]?.networkBlockingPoint, "dns-fw", "DNS chain preserves the authoritative network blocking point");
eq(dnsBlocked.value?.attempts[0]?.serviceState, undefined, "DNS chain does not inspect resolver service after a network block");
eq(dnsBlocked.value?.attempts[0]?.recordsState, undefined, "DNS chain does not inspect records after a network block");
eq(dnsBlocked.value?.resolvedAddress, undefined, "DNS chain never fabricates an answer after a network block");

const dnsDisabledScenario = structuredClone(dnsScenario);
dnsDisabledScenario.resources.find((r) => r.id === "dns1").properties.dns.enabled = false;
const dnsDisabled = queryDnsChain(dnsDisabledScenario, createInitialEngineState(dnsDisabledScenario), "dns-client", "app.lab.test");
eq(dnsDisabled.truth, "FALSE", "disabled DNS service is a conclusive DNS failure");
eq(dnsDisabled.value?.attempts[0]?.disposition, "SERVICE_DISABLED", "DNS chain exposes disabled service stage");

const dnsNxScenario = structuredClone(dnsScenario);
dnsNxScenario.resources.find((r) => r.id === "dns1").properties.dns.records = [];
const dnsNx = queryDnsChain(dnsNxScenario, createInitialEngineState(dnsNxScenario), "dns-client", "missing.lab.test");
eq(dnsNx.truth, "FALSE", "known resolver with no matching record is conclusive modeled NXDOMAIN/no-record");
eq(dnsNx.value?.attempts[0]?.disposition, "NO_RECORD", "DNS chain exposes no-record disposition");


// Phase 94: Engine-owned modeled DHCP DORA uses local L2 truth and explicit server offers.
const dhcpScenario = structuredClone(scenario);
dhcpScenario.resources = [
  { id: "dhcp-client", type: "windows.workstation", label: "DHCP Client", asset: { id: "windows.workstation", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: [] }], properties: { dhcp: { enabled: true } } },
  { id: "sw1", type: "network.switch", label: "Switch", asset: { id: "network.switch", version: "1.0.0" }, interfaces: [], properties: {} },
  { id: "dhcp1", type: "network.dhcp_server", label: "DHCP", asset: { id: "network.dhcp_server", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: ["10.20.0.2/24"] }], properties: { dhcp: { enabled: true, availableLeases: 5, offers: [{ client: "dhcp-client", address: "10.20.0.100" }], gateway: "10.20.0.1", dnsServers: ["10.20.0.53"], prefixLength: 24 } } },
];
dhcpScenario.connections = [
  { id: "client-sw", kind: "network", from: { resource: "dhcp-client" }, to: { resource: "sw1" }, properties: {} },
  { id: "sw-dhcp", kind: "network", from: { resource: "sw1" }, to: { resource: "dhcp1" }, properties: {} },
];
const dhcpState = createInitialEngineState(dhcpScenario);
const dhcpHealthy = queryDhcpDora(dhcpScenario, dhcpState, "dhcp-client");
eq(dhcpHealthy.truth, "TRUE", "DHCP DORA completes when one local server has a unique modeled offer");
eq(dhcpHealthy.value?.selectedServerResourceId, "dhcp1", "DHCP DORA selects the unique modeled offering server");
eq(dhcpHealthy.value?.offeredAddress, "10.20.0.100", "DHCP DORA exposes the explicit offered lease address");
eq(dhcpHealthy.value?.prefixLength, 24, "DHCP DORA carries modeled prefix option");
eq(dhcpHealthy.value?.gateway, "10.20.0.1", "DHCP DORA carries modeled gateway option");
eq(dhcpHealthy.value?.dnsServers, ["10.20.0.53"], "DHCP DORA carries modeled DNS options");
eq(dhcpHealthy.value?.stages.map((x) => [x.stage, x.truth]), [["DISCOVER","TRUE"],["OFFER","TRUE"],["REQUEST","TRUE"],["ACK","TRUE"]], "DHCP DORA exposes four successful stages");
eq(dhcpHealthy.value?.attempts[0]?.discoverPath, ["dhcp-client","sw1","dhcp1"], "DHCP Discover path uses local L2 topology rather than routed reachability");
eq(dhcpHealthy.value?.attempts[0]?.offerReturnPath, ["dhcp1","sw1","dhcp-client"], "DHCP Offer return path is proven independently on L2 topology");

const dhcpExhaustedScenario = structuredClone(dhcpScenario);
dhcpExhaustedScenario.resources.find((r) => r.id === "dhcp1").properties.dhcp.availableLeases = 0;
const dhcpExhausted = queryDhcpDora(dhcpExhaustedScenario, createInitialEngineState(dhcpExhaustedScenario), "dhcp-client");
eq(dhcpExhausted.truth, "FALSE", "exhausted DHCP pool is a conclusive DORA failure");
eq(dhcpExhausted.value?.attempts[0]?.disposition, "POOL_EXHAUSTED", "DHCP trace exposes pool exhaustion");

const dhcpMultipleScenario = structuredClone(dhcpScenario);
dhcpMultipleScenario.resources.push({ id: "dhcp2", type: "network.dhcp_server", label: "DHCP2", asset: { id: "network.dhcp_server", version: "1.0.0" }, interfaces: [], properties: { dhcp: { enabled: true, availableLeases: 3, offers: [{ client: "dhcp-client", address: "10.20.0.101" }], prefixLength: 24 } } });
dhcpMultipleScenario.connections.push({ id: "sw-dhcp2", kind: "network", from: { resource: "sw1" }, to: { resource: "dhcp2" }, properties: {} });
const dhcpMultiple = queryDhcpDora(dhcpMultipleScenario, createInitialEngineState(dhcpMultipleScenario), "dhcp-client");
eq(dhcpMultiple.truth, "UNKNOWN", "multiple valid Offers remain UNKNOWN because client offer selection/timing is not modeled");
eq(dhcpMultiple.value?.stages[2]?.truth, "UNKNOWN", "multiple Offers stop deterministic truth at REQUEST");

const dhcpStpBlockedScenario = structuredClone(dhcpScenario);
const dhcpStpSwitch = dhcpStpBlockedScenario.resources.find((r) => r.id === "sw1");
dhcpStpSwitch.interfaces = [{ id: "p1", label: "p1", addresses: [] }, { id: "p2", label: "p2", addresses: [] }];
dhcpStpSwitch.properties.stp = { protocol: "RSTP", bridgeId: "32768.020000000010", rootBridgeId: "32768.020000000010", rootPathCost: 0 };
dhcpStpSwitch.properties.stpPorts = [
  { interface: "p1", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
  { interface: "p2", role: "ALTERNATE", state: "BLOCKING", bpdu: "RECEIVE" },
];
dhcpStpBlockedScenario.connections = [
  { id: "client-sw", kind: "network", from: { resource: "dhcp-client", port: "eth0" }, to: { resource: "sw1", port: "p1" }, properties: {} },
  { id: "sw-dhcp", kind: "network", from: { resource: "sw1", port: "p2" }, to: { resource: "dhcp1", port: "eth0" }, properties: {} },
];
const dhcpStpBlocked = queryDhcpDora(dhcpStpBlockedScenario, createInitialEngineState(dhcpStpBlockedScenario), "dhcp-client");
eq(dhcpStpBlocked.truth, "FALSE", "upstream STP block prevents DHCP DORA before server state is inspected");
eq(dhcpStpBlocked.value?.attempts[0]?.disposition, "L2_BLOCKED", "DHCP candidate exposes L2 block rather than fabricated Offer state");
eq(dhcpStpBlocked.value?.attempts[0]?.serverEnabled, undefined, "DHCP server enabled state is not consumed after STP already blocks Discover");
eq(dhcpStpBlocked.value?.attempts[0]?.availableLeases, undefined, "DHCP pool state is not consumed after STP already blocks Discover");
eq(dhcpStpBlocked.value?.attempts[0]?.offeredAddress, undefined, "DHCP offer is not consumed or fabricated after STP already blocks Discover");


// Phase 95: explicit Host Stack sockets become authoritative listener evidence while service state remains separately visible.
const listenerScenario = structuredClone(scenario);
listenerScenario.resources = [
  {
    id: "svc-host",
    type: "linux.server",
    label: "Service Host",
    asset: { id: "linux.server", version: "1.0.0" },
    interfaces: [],
    properties: {
      services: [{ name: "http", enabled: true, port: 8080, protocol: "tcp" }],
      hostStack: {
        complete: true,
        processes: [{ id: "proc-http", name: "httpd", pid: 4242, service: "http" }],
        sockets: [{ id: "sock-http", protocol: "tcp", localAddress: "0.0.0.0", localPort: 8080, state: "LISTEN", processId: "proc-http", service: "http" }],
      },
    },
  },
];
listenerScenario.connections = [];
const listenerState = createInitialEngineState(listenerScenario);
const listenerHealthy = queryListenerServiceState(listenerState, "svc-host", "tcp", 8080);
eq(listenerHealthy.truth, "TRUE", "explicit LISTEN socket proves destination listener truth");
eq(listenerHealthy.value?.model, "EXPLICIT_HOST_STACK", "listener decision identifies explicit host-stack model");
eq(listenerHealthy.value?.listenerState, "LISTENING", "listener decision exposes LISTENING state");
eq(listenerHealthy.value?.serviceState, "ENABLED", "listener decision keeps service enabled state separate");
eq(listenerHealthy.value?.selectedSocketIds, ["sock-http"], "listener decision binds the exact selected listening socket");
eq(listenerHealthy.value?.selectedServiceNames, ["http"], "listener decision binds the exact matching service declaration");

const enabledNoListenerScenario = structuredClone(listenerScenario);
enabledNoListenerScenario.resources[0].properties.hostStack.sockets = [];
const enabledNoListener = queryListenerServiceState(createInitialEngineState(enabledNoListenerScenario), "svc-host", "tcp", 8080);
eq(enabledNoListener.truth, "FALSE", "complete host stack proves no listener even when service declaration is enabled");
eq(enabledNoListener.value?.serviceState, "ENABLED", "enabled service state remains visible when listener is absent");
eq(enabledNoListener.value?.listenerState, "NOT_LISTENING", "complete socket absence becomes explicit NOT_LISTENING");
eq(enabledNoListener.value?.disposition, "NO_LISTENER", "service-enabled/no-socket is classified as NO_LISTENER rather than guessed listening");
eq(enabledNoListener.value?.listenerConsistency, "MISMATCH", "service/listener disagreement remains explicit evidence");

const partialNoListenerScenario = structuredClone(listenerScenario);
partialNoListenerScenario.resources[0].properties.hostStack.complete = false;
partialNoListenerScenario.resources[0].properties.hostStack.sockets = [];
const partialNoListener = queryListenerServiceState(createInitialEngineState(partialNoListenerScenario), "svc-host", "tcp", 8080);
eq(partialNoListener.truth, "UNKNOWN", "partial host stack cannot prove listener absence");
eq(partialNoListener.value?.disposition, "SNAPSHOT_INCOMPLETE", "partial listener absence is labeled SNAPSHOT_INCOMPLETE");

const declarationOnlyScenario = structuredClone(listenerScenario);
delete declarationOnlyScenario.resources[0].properties.hostStack;
const declarationOnly = queryListenerServiceState(createInitialEngineState(declarationOnlyScenario), "svc-host", "tcp", 8080);
eq(declarationOnly.truth, "TRUE", "legacy service-only scenario preserves declared enabled-listener behavior");
eq(declarationOnly.value?.model, "SERVICE_DECLARATIONS", "legacy listener truth is explicitly declaration-only");
eq(declarationOnly.value?.selectedSocketIds, [], "service-only compatibility never fabricates a socket id");



// Phase 96: bounded Engine-owned TCP state-machine view over explicit Host Stack state.
const tcpStateScenario = structuredClone(listenerScenario);
tcpStateScenario.resources.unshift({
  id: "tcp-client",
  type: "endpoint.client",
  label: "TCP Client",
  asset: { id: "linux.client", version: "1.0.0" },
  interfaces: [{ id: "eth0", label: "eth0", addresses: ["198.51.100.10/24"] }],
  properties: {},
});
tcpStateScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets = [
  { id: "sock-http-listen", protocol: "tcp", localAddress: "0.0.0.0", localPort: 8080, state: "LISTEN", processId: "proc-http", service: "http" },
  { id: "sock-http-session", protocol: "tcp", localAddress: "10.0.0.20", localPort: 8080, remoteAddress: "198.51.100.10", remotePort: 49152, state: "ESTABLISHED", processId: "proc-http", service: "http" },
];
const tcpState = queryTcpStateMachine(createInitialEngineState(tcpStateScenario), "tcp-client", "svc-host", 8080);
eq(tcpState.truth, "TRUE", "explicit source-bound TCP session produces a provable TCP state-machine view");
eq(tcpState.value?.disposition, "SESSION_OBSERVED", "matching remoteAddress selects an explicit TCP session");
eq(tcpState.value?.selectedSocketIds, ["sock-http-session"], "TCP state machine selects the exact source-bound session socket");
eq(tcpState.value?.currentStates, ["ESTABLISHED"], "TCP state machine exposes the current modeled ESTABLISHED state");
eq(tcpState.value?.sequenceAckTimeline, "NOT_MODELED", "TCP sequence/ack timeline is never fabricated without explicit telemetry");
eq(tcpState.value?.retransmissionMarkers, "NOT_MODELED", "TCP retransmission markers remain explicitly not modeled");
ok(tcpState.value?.canonicalTransitions.some((row) => row.from === "LISTEN" && row.to === "SYN_RECEIVED"), "canonical TCP state machine contains LISTEN to SYN_RECEIVED transition");
ok(tcpState.value?.canonicalTransitions.some((row) => row.from === "ESTABLISHED" && row.to === "CLOSE_WAIT"), "canonical TCP state machine contains passive-close transition");

const listenOnlyTcpScenario = structuredClone(tcpStateScenario);
listenOnlyTcpScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets = [
  { id: "sock-http-listen", protocol: "tcp", localAddress: "0.0.0.0", localPort: 8080, state: "LISTEN", processId: "proc-http", service: "http" },
];
const listenOnlyTcp = queryTcpStateMachine(createInitialEngineState(listenOnlyTcpScenario), "tcp-client", "svc-host", 8080);
eq(listenOnlyTcp.truth, "TRUE", "explicit LISTEN socket produces a valid TCP state-machine view");
eq(listenOnlyTcp.value?.disposition, "LISTENING", "listener-only snapshot is classified as LISTENING");
eq(listenOnlyTcp.value?.currentStates, ["LISTEN"], "listener-only snapshot highlights LISTEN state");
eq(listenOnlyTcp.value?.socketRows[0]?.allowedNextStates, ["SYN_RECEIVED"], "LISTEN state exposes only modeled common-path SYN_RECEIVED next state");

const refusedTcpScenario = structuredClone(tcpStateScenario);
refusedTcpScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets = [];
const refusedTcp = queryTcpStateMachine(createInitialEngineState(refusedTcpScenario), "tcp-client", "svc-host", 8080);
eq(refusedTcp.truth, "FALSE", "complete Host Stack with no listener produces false TCP connection-attempt truth");
eq(refusedTcp.value?.disposition, "CONNECTION_REFUSED", "reached host with proven no-listener is classified connection refused at bounded abstraction");
eq(refusedTcp.value?.selectedSocketIds, [], "connection-refused trace fabricates no RST/session socket identity");

const tcpLifecycleScenario = structuredClone(tcpStateScenario);
tcpLifecycleScenario.resources.find((r) => r.id === "svc-host").properties.hostStack.sockets[1].state = "TIME_WAIT";
const timeWaitView = queryHostStackView(createInitialEngineState(tcpLifecycleScenario), "svc-host", "tcp", 8080);
eq(timeWaitView.truth, "TRUE", "expanded TCP lifecycle state TIME_WAIT is accepted by Host Stack");
eq(timeWaitView.value?.sockets.find((row) => row.socketId === "sock-http-session")?.state, "TIME_WAIT", "Host Stack preserves exact TIME_WAIT state");

// Reachability carries the Engine-owned TCP state trace only after destination listener evaluation is reached.
const explicitTcpTrace = explicitListenerReachability.value?.tcpStateMachineDecision;
eq(explicitTcpTrace?.disposition, "LISTENING", "TCP reachability transcript carries listener TCP state-machine evidence");
eq(enabledNoListenerScenario.resources[0].id, "svc-host", "listener fixture remains stable for TCP state tests");

await import("./run_udp_icmp_failure_tests.mjs");
console.log(`PASS engine suite: ${checks} assertions.`);
