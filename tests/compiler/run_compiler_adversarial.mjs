import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compileScenario } from "../../dist-compiler-test/compiler/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const base = read("tests/fixtures/valid/scenario-source.json");
const profileBase = read("tests/fixtures/valid/scenario-source-profile.json");
const catalogFile = read("catalog/builtin-catalog.json");
const schemaPass = () => ({ valid: true, diagnostics: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const contextFor = (catalog = catalogFile, engineBaselineVersion = "0.2.0") => ({
  validateSource: schemaPass,
  validateNormalized: schemaPass,
  catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets },
  engineBaselineVersion,
});

let assertions = 0;
async function expectCode(source, code, context = contextFor()) {
  const result = await compileScenario(source, context);
  assert.equal(result.ok, false, `expected rejection with ${code}`);
  assert.ok(result.diagnostics.some((d) => d.code === code), `missing ${code}; got ${JSON.stringify(result.diagnostics)}`);
  assertions += 2;
}

{
  const s = clone(base);
  s.connections[0].from.port = "ghostif";
  await expectCode(s, "UNKNOWN_INTERFACE_REFERENCE");
}
{
  const s = clone(base);
  s.findings[0].evidenceTests = ["ghosttest"];
  await expectCode(s, "UNKNOWN_TEST_REFERENCE");
}
{
  const s = clone(base);
  s.canonicalSolution.operations[0].target = "ghost";
  await expectCode(s, "UNKNOWN_SOLUTION_TARGET");
}
{
  const s = clone(base);
  s.layoutHints.push({ target: "ghost", rank: 9 });
  await expectCode(s, "UNKNOWN_LAYOUT_TARGET");
}
{
  const s = clone(base);
  s.requires.capabilities.push({ id: "core.network", version: "1.x" });
  await expectCode(s, "DUPLICATE_REQUIREMENT_ID");
}
{
  const s = clone(base);
  s.requires.capabilities[0].version = "not-a-range";
  await expectCode(s, "VERSION_RANGE_INVALID");
}
{
  const s = clone(base);
  s.requires.capabilities.push({ id: "core.ghost", version: "1.x" });
  await expectCode(s, "CAPABILITY_UNAVAILABLE");
}
{
  const s = clone(base);
  s.requires.profiles = [{ id: "vendor.ghost", version: "1.x" }];
  await expectCode(s, "PROFILE_UNAVAILABLE");
}
{
  const s = clone(profileBase);
  s.requires.profiles = [];
  await expectCode(s, "PROFILE_NOT_DECLARED");
}
{
  const c = clone(catalogFile);
  c.capabilities.push({
    id: "core.alt_network",
    version: "1.0.0",
    minimumEngineVersion: "0.2.0",
    claims: { resourceTypePrefixes: ["network."], testTypePrefixes: ["network."], connectionKinds: ["network"], ruleOps: ["reachable"] },
  });
  await expectCode(base, "CAPABILITY_CLAIM_AMBIGUOUS", contextFor(c));
}
{
  const c = clone(catalogFile);
  c.capabilities.push(clone(c.capabilities[0]));
  await expectCode(base, "CATALOG_DUPLICATE_DEFINITION", contextFor(c));
}
{
  const c = clone(catalogFile);
  c.capabilities[0].version = "banana";
  await expectCode(base, "CATALOG_VERSION_INVALID", contextFor(c));
}
{
  await expectCode(base, "ENGINE_BASELINE_VERSION_INVALID", contextFor(catalogFile, "bad"));
}

// Verify minimumEngineVersion is the maximum of baseline + exact resolved definitions + trusted semantic requirements.
{
  const c = clone(catalogFile);
  c.profiles.find((p) => p.id === "vendor.proxmox").minimumEngineVersion = "0.4.0";
  const result = await compileScenario(base, contextFor(c));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.minimumEngineVersion, "0.8.0");
  assertions += 2;
}

// Verify explicit source values override profile defaults while unspecified nested defaults remain.
{
  const s = clone(profileBase);
  s.resources[0].properties.management.port = 8443;
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.resources[0].properties.management, {
    protocol: "https",
    port: 8443,
    bind: "10.0.0.10",
  });
  assertions += 2;
}


// Phase 32: statically validate the new named Foundation declarative tests.
{
  const s = clone(base);
  s.tests[0] = { id: "scan", type: "network.port_scan", label: "scan", params: { from: "attacker", to: "rds01", ports: [0, 70000] } };
  await expectCode(s, "TEST_PARAM_REQUIRED");
}
{
  const s = clone(base);
  s.tests[0] = { id: "scan", type: "network.port_scan", label: "scan", params: { from: "ghost", to: "rds01", ports: [3389] } };
  await expectCode(s, "UNKNOWN_RESOURCE_REFERENCE");
}
{
  const s = clone(base);
  s.requires.capabilities.push({ id: "core.backup", version: "1.x" });
  s.tests[0] = { id: "restore", type: "backup.restore_test", label: "restore", params: { target: "rds01", equals: "yes" } };
  await expectCode(s, "TEST_PARAM_INVALID");
}


{
  const s = clone(base);
  s.tests[0] = { id: "future", type: "network.future_test", label: "future", params: {} };
  await expectCode(s, "TEST_TYPE_UNIMPLEMENTED");
}
{
  const s = clone(base);
  s.tests[0] = { id: "direct_rdp", type: "network.port_scan", label: "scan", params: { from: "attacker", to: "rds01", ports: [3389] } };
  const result = await compileScenario(s, contextFor(catalogFile, "0.2.0"));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.minimumEngineVersion, "0.8.0", "network.port_scan semantics force Engine 0.8.0 minimum");
  assertions += 2;
}

// Phase 35: static SNAT validation (runtime still checks mutable state after editing).
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.snatPolicy = "magic";
  await expectCode(s, "SNAT_POLICY_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.snatPolicy = "required";
  await expectCode(s, "SNAT_RULES_REQUIRED");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.natRules = [{ type: "snat", translatedSource: "999.1.1.1", source: "attacker", destination: "rds01" }];
  await expectCode(s, "SNAT_TRANSLATED_SOURCE_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.natRules = [{ type: "snat", translatedSource: "198.51.100.7", translatedPort: 45678 }];
  await expectCode(s, "SNAT_PORT_TRANSLATION_UNSUPPORTED");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.natRules = [{ type: "snat", translatedSource: "198.51.100.7", source: "10.42.0.0/33" }];
  await expectCode(s, "SNAT_SELECTOR_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.natRules = [{ type: "snat", translatedSource: "198.51.100.7", source: "attacker", destination: "rds01", protocol: "tcp" }];
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assertions += 1;
}


// Phase 90: explicit local-host vs network-firewall classification.
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.isFirewall = true;
  host.properties.rules = [{ id: "local-allow", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "allow" }];
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assertions += 1;
}
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.rules = [{ id: "local-deny", source: "any", destination: "rds01", protocol: "tcp", port: 3389, action: "deny" }];
  await expectCode(s, "LOCAL_FIREWALL_MARKER_REQUIRED");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.isFirewall = false;
  await expectCode(s, "NETWORK_FIREWALL_MARKER_CONTRADICTION");
}

// Phase 89: explicit conntrack/session snapshot semantic validation.
{
  const s = clone(base);
  const fw = s.resources.find((r) => r.id === "firewall01");
  fw.properties.conntrack = { complete: true, entries: [{ id: "ct-rdp", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" }] };
  fw.properties.rules[0].connectionState = "ESTABLISHED";
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assertions += 1;
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.rules[0].connectionState = "ESTABLISHED";
  await expectCode(s, "FIREWALL_CONNTRACK_REQUIRED");
}
{
  const s = clone(base);
  const fw = s.resources.find((r) => r.id === "firewall01");
  fw.properties.conntrack = { complete: true, entries: [] };
  fw.properties.rules[0].connectionState = "CLOSED";
  await expectCode(s, "FIREWALL_CONNECTION_STATE_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: true, entries: [{ id: "ct", source: "not-an-ip", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" }] };
  await expectCode(s, "CONNTRACK_SOURCE_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: true, entries: [
    { id: "ct", source: "198.51.100.10", destination: "rds01", protocol: "tcp", port: 3389, state: "ESTABLISHED" },
    { id: "ct", source: "198.51.100.11", destination: "rds01", protocol: "tcp", port: 3389, state: "NEW" },
  ] };
  await expectCode(s, "CONNTRACK_ENTRY_ID_DUPLICATE");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: true, entries: [{ id: "ct", source: "198.51.100.10", destination: "rds01", protocol: "icmp", port: 7, state: "NEW" }] };
  await expectCode(s, "CONNTRACK_PORT_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: true, entries: [{ id: "ct", source: "198.51.100.10", destination: "ghost", protocol: "tcp", port: 3389, state: "ESTABLISHED" }] };
  await expectCode(s, "CONNTRACK_DESTINATION_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "firewall01").properties.conntrack = { complete: true, entries: [{ id: "ct", source: "198.51.100.10", destination: "rds01", protocol: "udp", state: "RELATED" }] };
  await expectCode(s, "CONNTRACK_PORT_INVALID");
}

// Phase 92: Host Stack semantic references and bounded socket semantics.
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.hostStack = {
    complete: true,
    processes: [{ id: "proc-rdp", name: "svchost.exe", pid: 1160, service: "rdp" }],
    sockets: [{ id: "sock-rdp", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "LISTEN", processId: "proc-rdp", service: "rdp" }],
  };
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assertions += 1;
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "rds01").properties.hostStack = { complete: true, processes: [{ id: "dup", name: "one" }, { id: "dup", name: "two" }], sockets: [] };
  await expectCode(s, "HOST_STACK_PROCESS_ID_DUPLICATE");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "rds01").properties.hostStack = { complete: true, processes: [{ id: "proc", name: "worker", service: "ghost" }], sockets: [] };
  await expectCode(s, "HOST_STACK_PROCESS_SERVICE_UNKNOWN");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "rds01").properties.hostStack = { complete: true, processes: [], sockets: [{ id: "sock", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "LISTEN", processId: "ghost", service: "rdp" }] };
  await expectCode(s, "HOST_STACK_SOCKET_PROCESS_UNKNOWN");
}
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.http = { enabled: true, port: 80, protocol: "tcp" };
  host.properties.hostStack = { complete: true, processes: [{ id: "proc", name: "worker", service: "rdp" }], sockets: [{ id: "sock", protocol: "tcp", localAddress: "127.0.0.1", localPort: 80, state: "LISTEN", processId: "proc", service: "http" }] };
  await expectCode(s, "HOST_STACK_SERVICE_BINDING_MISMATCH");
}
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.dns = { enabled: true, port: 53, protocol: "udp" };
  host.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "dns", protocol: "udp", localAddress: "0.0.0.0", localPort: 53, state: "LISTEN", service: "dns" }] };
  await expectCode(s, "HOST_STACK_UDP_LISTEN_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "rds01").properties.hostStack = { complete: true, processes: [], sockets: [{ id: "sock", protocol: "tcp", localAddress: "0.0.0.0", localPort: 3389, state: "BOUND", service: "rdp" }] };
  await expectCode(s, "HOST_STACK_TCP_BOUND_INVALID");
}



// Phase 96: expanded TCP lifecycle states stay protocol-bounded at authoring time.
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "tcp-syn", protocol: "tcp", localAddress: "10.0.0.20", localPort: 3389, remoteAddress: "198.51.100.10", remotePort: 50000, state: "SYN_RECEIVED", service: "rdp" }] };
  const result = await compileScenario(s, contextFor());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assertions += 1;
}
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "tcp-half", protocol: "tcp", localAddress: "10.0.0.20", localPort: 3389, state: "SYN_RECEIVED", service: "rdp" }] };
  await expectCode(s, "HOST_STACK_TCP_PEER_REQUIRED");
}
{
  const s = clone(base);
  const host = s.resources.find((r) => r.id === "rds01");
  host.properties.dns = { enabled: true, port: 53, protocol: "udp" };
  host.properties.hostStack = { complete: true, processes: [], sockets: [{ id: "bad-udp-state", protocol: "udp", localAddress: "0.0.0.0", localPort: 53, state: "TIME_WAIT", service: "dns" }] };
  await expectCode(s, "HOST_STACK_UDP_STATE_INVALID");
}

// Phase 93: DNS authoring semantics are explicit while runtime ambiguity remains Engine-owned.
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dnsServers = "10.0.0.53";
  await expectCode(s, "DNS_SERVERS_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dnsServers = ["10.0.0.53", "10.0.0.53"];
  await expectCode(s, "DNS_SERVERS_DUPLICATE");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dnsServers = ["not-an-ip"];
  await expectCode(s, "DNS_SERVER_ADDRESS_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dns = { enabled: "yes", records: [] };
  await expectCode(s, "DNS_SERVICE_ENABLED_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dns = { enabled: true, records: "app.lab" };
  await expectCode(s, "DNS_RECORDS_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dns = { enabled: true, records: [{ address: "10.0.0.80" }] };
  await expectCode(s, "DNS_RECORD_NAME_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dns = { enabled: true, records: [{ name: "app.lab", address: "not-an-ip" }] };
  await expectCode(s, "DNS_RECORD_ADDRESS_INVALID");
}


// Phase 94: DHCP DORA authoring state is literal and bounded; offer-selection ambiguity remains runtime-owned.
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dhcp = "enabled";
  await expectCode(s, "DHCP_STATE_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dhcp = { enabled: "yes" };
  await expectCode(s, "DHCP_ENABLED_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dhcp = { enabled: true, prefixLength: 99 };
  await expectCode(s, "DHCP_PREFIX_INVALID");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dhcp = { enabled: true, dnsServers: ["10.0.0.53", "10.0.0.53"] };
  await expectCode(s, "DHCP_DNS_SERVER_DUPLICATE");
}
{
  const s = clone(base);
  s.resources.find((r) => r.id === "admin01").properties.dhcp = { enabled: true, offers: [{ client: "admin01", address: "10.0.0.10" }] };
  await expectCode(s, "DHCP_OFFERS_SERVER_ONLY");
}
{
  const s = clone(base);
  const server = clone(s.resources.find((r) => r.id === "firewall01"));
  server.id = "dhcp01"; server.type = "network.dhcp_server"; server.properties = { dhcp: { enabled: true, availableLeases: -1, offers: [] } };
  s.resources.push(server);
  await expectCode(s, "DHCP_AVAILABLE_LEASES_INVALID");
}
{
  const s = clone(base);
  const server = clone(s.resources.find((r) => r.id === "firewall01"));
  server.id = "dhcp01"; server.type = "network.dhcp_server"; server.properties = { dhcp: { enabled: true, availableLeases: 1, offers: [{ client: "ghost", address: "10.0.0.10" }], prefixLength: 24 } };
  s.resources.push(server);
  await expectCode(s, "DHCP_OFFER_CLIENT_INVALID");
}
{
  const s = clone(base);
  const server = clone(s.resources.find((r) => r.id === "firewall01"));
  server.id = "dhcp01"; server.type = "network.dhcp_server"; server.properties = { dhcp: { enabled: true, availableLeases: 1, offers: [{ client: "admin01", address: "bad" }], prefixLength: 24 } };
  s.resources.push(server);
  await expectCode(s, "DHCP_OFFER_ADDRESS_INVALID");
}

// Phase 74: troubleshooting objective semantic references and matcher specificity fail closed.
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:"review", title:"Review", required:true, evidenceOrder:"ordered", requirements:[{ id:"empty", label:"Empty", kind:"observation" }] }];
  await expectCode(s, "TROUBLESHOOTING_REQUIREMENT_EMPTY");
}
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:"review", title:"Review", required:true, evidenceOrder:"ordered", requirements:[{ id:"x", label:"One", kind:"observation", targetId:"admin01" },{ id:"x", label:"Two", kind:"observation", category:"interface" }] }];
  await expectCode(s, "DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID");
}
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:"review", title:"Review", required:true, evidenceOrder:"unordered", requirements:[{ id:"obs", label:"Unknown", kind:"observation", targetId:"ghost" }] }];
  await expectCode(s, "UNKNOWN_TROUBLESHOOTING_TARGET");
}
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:"review", title:"Review", required:true, evidenceOrder:"unordered", requirements:[{ id:"probe", label:"Unknown source", kind:"active_probe", sourceId:"ghost", truth:"TRUE" }] }];
  await expectCode(s, "UNKNOWN_TROUBLESHOOTING_SOURCE");
}
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:"review", title:"Review", required:true, evidenceOrder:"unordered", requirements:[{ id:"probe", label:"Unknown destination", kind:"active_probe", sourceId:"admin01", destinationId:"ghost" }] }];
  await expectCode(s, "UNKNOWN_TROUBLESHOOTING_DESTINATION");
}
{
  const s = clone(base);
  s.troubleshootingObjectives = [{ id:s.objectives[0].id, title:"Collision", required:true, evidenceOrder:"unordered", requirements:[{ id:"obs", label:"Interface", kind:"observation", category:"interface" }] }];
  await expectCode(s, "DUPLICATE_GLOBAL_ID");
}

console.log(`PASS compiler adversarial suite: ${assertions} assertions.`);
