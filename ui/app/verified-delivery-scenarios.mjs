const capabilityRequirements = [
  { id: "core.network", version: "^1.0.0" },
  { id: "core.windows", version: "1.x" },
  { id: "core.linux", version: "1.x" },
];

const zones = [
  { id: "clients", label: "Clients", kind: "lan" },
  { id: "transit", label: "Transit", kind: "custom" },
  { id: "services", label: "Services", kind: "server" },
];

function workstation(id, label, address, gateway) {
  return {
    id,
    type: "windows.workstation",
    label,
    zone: "clients",
    interfaces: [{ id: "eth0", label: "Ethernet", addresses: [address] }],
    properties: { defaultGateway: gateway, aclDefaultAction: "allow" },
  };
}

function router(id, label, clientAddress, serviceAddress, routes) {
  return {
    id,
    type: "network.router",
    label,
    zone: "transit",
    interfaces: [
      { id: "lan", label: "Client LAN", addresses: [clientAddress] },
      { id: "services", label: "Service LAN", addresses: [serviceAddress] },
    ],
    properties: { routes },
  };
}

function serviceServer(id, label, address, aclDefaultAction = "allow") {
  return {
    id,
    type: "linux.server",
    label,
    zone: "services",
    interfaces: [{ id: "eth0", label: "Ethernet", addresses: [address] }],
    properties: {
      ...(aclDefaultAction !== "allow" ? { isFirewall: true } : {}),
      aclDefaultAction,
      services: [{ name: "https", enabled: true, protocol: "tcp", port: 443 }],
    },
  };
}

function connection(id, from, to) {
  return { id, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} };
}

function baseScenario(scenarioId, title, briefing, resources, connections, test, objectiveTitle) {
  return {
    formatId: "infrastructure-cyber-lab.scenario-source",
    schemaVersion: "0.1.0",
    scenarioId,
    metadata: {
      title,
      language: "sv",
      tags: ["dev11", "acceptance", "deterministic", "active-probe"],
      briefing,
    },
    requires: { capabilities: capabilityRequirements, profiles: [] },
    zones,
    resources,
    connections,
    tests: [{ id: test.id, type: "network.reachability", label: test.label, params: test.params, expectedInitial: test.expected, expectedSolved: test.expected }],
    findings: [],
    objectives: [{ id: `${scenarioId}-objective`, title: objectiveTitle, category: "network", required: true, condition: { op: "test_result", test: test.id, expected: test.expected } }],
    troubleshootingObjectives: [{
      id: `${scenarioId}-probe-objective`,
      title: objectiveTitle,
      description: "Kör den föreslagna aktiva proben och läs Engine-verdictet; UI:t skapar inte resultatet.",
      required: true,
      evidenceOrder: "unordered",
      requirements: [{
        id: `${scenarioId}-active-probe`,
        label: test.label,
        kind: "active_probe",
        category: "connectivity",
        sourceId: test.params.from,
        destinationId: test.params.to,
        protocol: test.params.protocol,
        port: test.params.port,
        truth: test.expected,
      }],
    }],
    completion: { op: "test_result", test: test.id, expected: test.expected },
    hints: [],
    layoutHints: resources.map((resource, index) => ({ target: resource.id, rank: index + 1 })),
  };
}

const successClient = workstation("client01", "Verified client", "10.90.10.10/24", "10.90.10.1");
const successRouter = router("router01", "Verified router", "10.90.10.1/24", "10.90.20.1/24", [
  { id: "route-web", destination: "web01", via: "web01", action: "forward", enabled: true },
  { id: "route-client", destination: "client01", via: "client01", action: "forward", enabled: true },
]);
const successServer = serviceServer("web01", "Verified web server", "10.90.20.80/24");

export const verifiedDeliverySuccess = baseScenario(
  "verified_delivery_success",
  "Verified Delivery — Success",
  "En liten, helt modellerad TCP/443-väg. Engine kan bevisa route, policy och aktiv listener.",
  [successClient, successRouter, successServer],
  [connection("success-client-router", "client01", "router01"), connection("success-router-server", "router01", "web01")],
  { id: "verified-success", label: "Client → Web server · TCP/443", params: { from: "client01", to: "web01", protocol: "tcp", port: 443 }, expected: "TRUE" },
  "Verifiera leverans till den deklarerade HTTPS-listenern",
);

const dropClient = workstation("client01", "Verified client", "10.91.10.10/24", "10.91.10.1");
const dropRouter = router("router01", "Verified router", "10.91.10.1/24", "10.91.20.1/24", [
  { id: "route-drop", destination: "drop-server", via: "drop-server", action: "forward", enabled: true },
  { id: "route-client", destination: "client01", via: "client01", action: "forward", enabled: true },
]);
const dropServer = serviceServer("drop-server", "Policy-blocked server", "10.91.20.80/24", "deny");

export const verifiedDeliveryDrop = baseScenario(
  "verified_delivery_drop",
  "Verified Delivery — Drop",
  "Samma lilla väg, men destinationens modellerade host-firewall nekar TCP/443 med aclDefaultAction=deny.",
  [dropClient, dropRouter, dropServer],
  [connection("drop-client-router", "client01", "router01"), connection("drop-router-server", "router01", "drop-server")],
  { id: "verified-drop", label: "Client → blocked server · TCP/443", params: { from: "client01", to: "drop-server", protocol: "tcp", port: 443 }, expected: "FALSE" },
  "Verifiera deterministiskt policy-drop vid den modellerade destinationen",
);

const mixedClientAllowed = workstation("client-allowed", "Allowed client", "10.92.10.10/24", "10.92.10.1");
const mixedClientBlocked = workstation("client-blocked", "Blocked client", "10.92.10.11/24", "10.92.10.1");
const mixedRouter = router("router01", "Mixed-flow router", "10.92.10.1/24", "10.92.20.1/24", [
  { id: "route-allowed", destination: "allowed-server", via: "allowed-server", action: "forward", enabled: true },
  { id: "route-blocked", destination: "blocked-server", via: "blocked-server", action: "forward", enabled: true },
  { id: "route-allowed-client", destination: "client-allowed", via: "client-allowed", action: "forward", enabled: true },
  { id: "route-blocked-client", destination: "client-blocked", via: "client-blocked", action: "forward", enabled: true },
]);
const mixedAllowedServer = serviceServer("allowed-server", "Allowed HTTPS server", "10.92.20.80/24");
const mixedBlockedServer = serviceServer("blocked-server", "Blocked HTTPS server", "10.92.20.81/24", "deny");

export const verifiedDeliveryMixed = {
  ...baseScenario(
    "verified_delivery_mixed",
    "Delivery — Mixed (Choose Success or Dropped in Probes Section.)",
    "Två valbara flöden delar samma kompakte topology: ett Engine-bevisat allow och ett Engine-bevisat policy-drop.",
    [mixedClientAllowed, mixedClientBlocked, mixedRouter, mixedAllowedServer, mixedBlockedServer],
    [
      connection("mixed-allowed-client-router", "client-allowed", "router01"),
      connection("mixed-blocked-client-router", "client-blocked", "router01"),
      connection("mixed-router-allowed", "router01", "allowed-server"),
      connection("mixed-router-blocked", "router01", "blocked-server"),
    ],
    { id: "verified-mixed-allowed", label: "Allowed client → allowed server · TCP/443", params: { from: "client-allowed", to: "allowed-server", protocol: "tcp", port: 443 }, expected: "TRUE" },
    "Kör både ett bevisat allow- och ett bevisat drop-flöde utan scenario-byte",
  ),
  tests: [
    { id: "verified-mixed-allowed", type: "network.reachability", label: "Allowed client → allowed server · TCP/443", params: { from: "client-allowed", to: "allowed-server", protocol: "tcp", port: 443 }, expectedInitial: "TRUE", expectedSolved: "TRUE" },
    { id: "verified-mixed-blocked", type: "network.reachability", label: "Blocked client → blocked server · TCP/443", params: { from: "client-blocked", to: "blocked-server", protocol: "tcp", port: 443 }, expectedInitial: "FALSE", expectedSolved: "FALSE" },
  ],
  objectives: [{ id: "verified_delivery_mixed-objective", title: "Verifiera båda Engine-verdicts", category: "network", required: true, condition: { op: "all", rules: [
    { op: "test_result", test: "verified-mixed-allowed", expected: "TRUE" },
    { op: "test_result", test: "verified-mixed-blocked", expected: "FALSE" },
  ] } }],
  troubleshootingObjectives: [{
    id: "verified_delivery_mixed-probe-objective",
    title: "Jämför allow och drop",
    description: "Byt endast preset i Active Probe-panelen. Båda körs mot samma aktuella Engine-state.",
    required: true,
    evidenceOrder: "unordered",
    requirements: [
      { id: "verified-mixed-allow-probe", label: "Allowed flow", kind: "active_probe", category: "connectivity", sourceId: "client-allowed", destinationId: "allowed-server", protocol: "tcp", port: 443, truth: "TRUE" },
      { id: "verified-mixed-drop-probe", label: "Blocked flow", kind: "active_probe", category: "connectivity", sourceId: "client-blocked", destinationId: "blocked-server", protocol: "tcp", port: 443, truth: "FALSE" },
    ],
  }],
  completion: { op: "all", rules: [
    { op: "test_result", test: "verified-mixed-allowed", expected: "TRUE" },
    { op: "test_result", test: "verified-mixed-blocked", expected: "FALSE" },
  ] },
};

export const verifiedDeliveryScenarios = [verifiedDeliverySuccess, verifiedDeliveryDrop, verifiedDeliveryMixed];
export const verifiedDeliveryScenarioById = new Map(verifiedDeliveryScenarios.map((scenario) => [scenario.scenarioId, scenario]));

export const verifiedDeliveryProbePresets = {
  verified_delivery_success: [
    { id: "success-https", label: "Verified client → Web server · TCP/443", sourceId: "client01", probeId: "windows.test_netconnection", destinationId: "web01", port: 443 },
  ],
  verified_delivery_drop: [
    { id: "drop-https", label: "Verified client → blocked server · TCP/443", sourceId: "client01", probeId: "windows.test_netconnection", destinationId: "drop-server", port: 443 },
  ],
  verified_delivery_mixed: [
    { id: "mixed-allow", label: "Allowed client → allowed server · TCP/443", sourceId: "client-allowed", probeId: "windows.test_netconnection", destinationId: "allowed-server", port: 443 },
    { id: "mixed-drop", label: "Blocked client → blocked server · TCP/443", sourceId: "client-blocked", probeId: "windows.test_netconnection", destinationId: "blocked-server", port: 443 },
  ],
};

export const verifiedDeliveryExplanation = "Dessa tre små labbar kör den befintliga Validator → Compiler → Engine → Active Probe → Visual Journey-kedjan. Grönt/rött är Engine-verdicts; UNKNOWN betyder att just den frågan saknar tillräcklig modellerad sanning och är inte ett misslyckande.";
