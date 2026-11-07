const zones = [
  { id: "wan", label: "WAN / Internet edge", kind: "wan" },
  { id: "dmz", label: "DMZ", kind: "dmz" },
  { id: "server", label: "Server zone", kind: "server" },
  { id: "users", label: "User LAN · VLAN 10", kind: "lan" },
  { id: "management", label: "Management · VLAN 30", kind: "management" },
  { id: "guest", label: "Guest / Wi-Fi · VLAN 50", kind: "guest" },
  { id: "infra", label: "Infrastructure", kind: "custom" },
];

const resources = [
  ["internet", "network.router", "Internet edge", "wan"],
  ["wan-rtr01", "network.router", "WAN-RTR-01", "wan"],
  ["fw01", "network.firewall", "EDGE-FW-01", "dmz"],
  ["fw02", "network.firewall", "EDGE-FW-02", "dmz"],
  ["dmz-web01", "linux.server", "DMZ-WEB-01", "dmz"],
  ["dmz-web02", "linux.server", "DMZ-WEB-02", "dmz"],
  ["core01", "network.switch", "CORE-SW-01", "infra"],
  ["core02", "network.switch", "CORE-SW-02", "infra"],
  ["access01", "network.switch", "ACCESS-SW-01", "users"],
  ["access02", "network.switch", "ACCESS-SW-02", "users"],
  ["access03", "network.switch", "ACCESS-SW-03", "users"],
  ["access04", "network.switch", "ACCESS-SW-04", "users"],
  ["ap01", "network.router", "WIFI-AP-01", "guest"],
  ["ap02", "network.router", "WIFI-AP-02", "guest"],
  ["ad-dns01", "windows.server", "AD/DNS-01", "infra"],
  ["ad-dns02", "windows.server", "AD/DNS-02", "infra"],
  ["dhcp01", "linux.server", "DHCP-01", "infra"],
  ["file01", "windows.server", "FILE-01", "server"],
  ["app01", "linux.server", "APP-01", "server"],
  ["db01", "linux.server", "DB-01", "server"],
  ["backup01", "linux.server", "BACKUP-01", "server"],
  ["jump01", "windows.workstation", "MGMT-JUMP-01", "management"],
  ["siem01", "linux.server", "SIEM-01", "management"],
  ["monitor01", "linux.server", "MONITOR-01", "management"],
  ["prox01", "virtualization.proxmox", "PROXMOX-01", "server"],
  ["win01", "windows.workstation", "WIN-USER-01", "users"],
  ["win02", "windows.workstation", "WIN-USER-02", "users"],
  ["win03", "windows.workstation", "WIN-USER-03", "users"],
  ["win04", "windows.workstation", "WIN-USER-04", "users"],
  ["linux01", "linux.workstation", "LINUX-USER-01", "users"],
  ["linux02", "linux.workstation", "LINUX-USER-02", "users"],
  ["printer01", "resource.generic", "PRINTER-01", "users"],
  ["iot01", "resource.generic", "IOT-SENSOR-01", "guest"],
  ["guest01", "windows.workstation", "GUEST-CLIENT-01", "guest"],
  ["guest02", "linux.workstation", "GUEST-CLIENT-02", "guest"],
].map(([id, type, label, zone]) => ({ id, type, label, zone, properties: {} }));

// Enterprise flows use the existing modeled L2/L3 truth. Give every declared
// resource one explicit interface on the deterministic lab subnet; this is
// state, not a new engine shortcut. The graph and policy engines remain the
// sole authorities for reachability and drops.
resources.forEach((resource, index) => {
  resource.interfaces = [{ id: "eth0", label: "Ethernet", addresses: [`10.24.0.${index + 10}/24`] }];
});

const links = [
  ["internet", "wan-rtr01"], ["wan-rtr01", "fw01"], ["wan-rtr01", "fw02"],
  ["fw01", "fw02"], ["fw01", "dmz-web01"], ["fw02", "dmz-web02"],
  ["fw01", "core01"], ["fw02", "core02"], ["core01", "core02"],
  ["core01", "access01"], ["core01", "access02"], ["core02", "access03"], ["core02", "access04"],
  ["core01", "ap01"], ["core02", "ap02"], ["core01", "ad-dns01"], ["core02", "ad-dns02"],
  ["core01", "dhcp01"], ["core01", "file01"], ["core02", "app01"], ["core02", "db01"],
  ["core01", "backup01"], ["core02", "prox01"], ["core01", "jump01"], ["core02", "siem01"],
  ["core02", "monitor01"], ["access01", "win01"], ["access01", "win02"], ["access02", "win03"],
  ["access02", "win04"], ["access03", "linux01"], ["access04", "linux02"], ["access01", "printer01"],
  ["ap01", "iot01"], ["ap02", "guest01"], ["ap02", "guest02"], ["ad-dns01", "ad-dns02"],
  ["file01", "backup01"], ["app01", "db01"], ["jump01", "siem01"], ["monitor01", "siem01"],
].map(([from, to], index) => ({ id: `enterprise-link-${String(index + 1).padStart(2, "0")}`, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} }));

const firewallRule = (source, destination, action, port = 443) => ({ source, destination, protocol: "tcp", port, action });
resources.find((r) => r.id === "fw01").properties = { defaultAction: "deny", rules: [firewallRule("users", "dmz-web01", "allow"), firewallRule("wan", "dmz-web01", "allow"), firewallRule("guest", "db01", "deny", 5432)] };
resources.find((r) => r.id === "fw02").properties = { rules: [firewallRule("wan", "dmz-web02", "allow")] };

const service = (name, protocol, port) => ({ name, enabled: true, protocol, port });
resources.find((r) => r.id === "db01").properties = { isFirewall: true, defaultAction: "allow", rules: [firewallRule("guest", "db01", "deny", 5432)], services: [service("https", "tcp", 443), service("postgres", "tcp", 5432)] };
resources.find((r) => r.id === "ad-dns01").properties.services = [service("dns", "udp", 53)];
resources.find((r) => r.id === "dmz-web01").properties.services = [service("https", "tcp", 443)];
resources.find((r) => r.id === "file01").properties.services = [service("https", "tcp", 443)];

export const enterpriseOfficeHealthy = {
  formatId: "infrastructure-cyber-lab.scenario-source",
  schemaVersion: "0.1.0",
  scenarioId: "enterprise_office_healthy",
  metadata: { title: "Enterprise Office — Healthy Baseline", language: "sv", briefing: "Utforska ett deterministiskt företagsnät med WAN, DMZ, server-, användar-, gäst- och managementzoner.", tags: ["enterprise", "baseline", "30-plus-nodes"] },
  requires: { capabilities: [{ id: "core.network", version: "^1.0.0" }, { id: "core.windows", version: "1.x" }, { id: "core.linux", version: "1.x" }, { id: "core.virtualization", version: "1.x" }], profiles: [{ id: "vendor.proxmox", version: "1.x" }] },
  zones, resources, connections: links,
  tests: [
    { id: "user_to_db", type: "network.reachability", params: { from: "win01", to: "db01", protocol: "tcp", port: 443 }, expectedInitial: "TRUE", expectedSolved: "TRUE" },
    { id: "user_to_dns", type: "network.reachability", params: { from: "win01", to: "ad-dns01", protocol: "udp", port: 53 }, expectedInitial: "TRUE", expectedSolved: "TRUE" },
    { id: "user_to_dmz", type: "network.reachability", params: { from: "win01", to: "dmz-web01", protocol: "tcp", port: 443 }, expectedInitial: "TRUE", expectedSolved: "TRUE" },
    { id: "guest_to_db", type: "network.reachability", params: { from: "guest01", to: "db01", protocol: "tcp", port: 5432 }, expectedInitial: "FALSE", expectedSolved: "FALSE" },
    { id: "management_to_server", type: "network.reachability", params: { from: "jump01", to: "file01", protocol: "tcp", port: 443 }, expectedInitial: "TRUE", expectedSolved: "TRUE" },
  ],
  findings: [],
  objectives: [{ id: "enterprise_baseline_ready", title: "Verifiera enterprise-baselinen", category: "network", required: true, condition: { op: "reachable", from: "win01", to: "db01", protocol: "tcp", port: 443 } }],
  completion: { op: "reachable", from: "win01", to: "db01", protocol: "tcp", port: 443 },
  layoutHints: resources.map((resource, index) => ({ target: resource.id, rank: Math.floor(index / 6) + 1 })),
};

function expansionResource(index) {
  const number = String(index + 1).padStart(2, "0");
  const roles = [
    ["network.switch", `DISTRIBUTION-SW-${number}`, "infra"],
    ["network.switch", `ACCESS-SW-${number}`, "users"],
    ["windows.workstation", `WIN-BRANCH-${number}`, "users"],
    ["linux.workstation", `LINUX-BRANCH-${number}`, "users"],
    ["windows.server", `BRANCH-FILE-${number}`, "server"],
    ["linux.server", `BRANCH-APP-${number}`, "server"],
    ["resource.generic", `IOT-BRANCH-${number}`, "guest"],
    ["linux.server", `MGMT-COLLECTOR-${number}`, "management"],
  ];
  const [type, label, zone] = roles[index % roles.length];
  return { id: `enterprise-expansion-${number}`, type, label, zone, properties: {}, interfaces: [{ id: "eth0", label: "Ethernet", addresses: [`10.24.${Math.floor(index / 200) + 1}.${index + 20}/24`] }] };
}

function scaledEnterpriseScenario(targetCount, scenarioId, title, briefing) {
  const scenario = structuredClone(enterpriseOfficeHealthy);
  if (targetCount < scenario.resources.length) {
    const remove = new Set(["printer01", "iot01", "guest02", "linux02", "monitor01"].slice(0, scenario.resources.length - targetCount));
    scenario.resources = scenario.resources.filter((resource) => !remove.has(resource.id));
    scenario.connections = scenario.connections.filter((connection) => !remove.has(connection.from.resource) && !remove.has(connection.to.resource));
  }
  const additions = Math.max(0, targetCount - scenario.resources.length);
  for (let index = 0; index < additions; index += 1) {
    const resource = expansionResource(index + scenario.resources.length);
    scenario.resources.push(resource);
    const parent = resource.zone === "users" || resource.zone === "guest" ? (index % 2 ? "access01" : "access02") : index % 2 ? "core01" : "core02";
    scenario.connections.push({
      id: `enterprise-expansion-link-${String(index + 1).padStart(2, "0")}`,
      kind: "network",
      from: { resource: parent },
      to: { resource: resource.id },
      properties: {},
    });
  }
  scenario.scenarioId = scenarioId;
  scenario.metadata = { ...scenario.metadata, title, briefing, tags: [...scenario.metadata.tags, "scaled-enterprise"] };
  scenario.layoutHints = scenario.resources.map((resource, index) => ({ target: resource.id, rank: Math.floor(index / 6) + 1 }));
  return scenario;
}

export const enterpriseOffice30 = scaledEnterpriseScenario(30, "enterprise_office_30", "Enterprise Office — Compact 30", "En kompakt företagsmiljö med samma Engine-modell och verifierbara success/drop-flöden.");
export const enterpriseOffice50 = scaledEnterpriseScenario(50, "enterprise_office_50", "Enterprise Campus — 50", "Ett utbyggt campus med filialnät, distributionslager och separata server- och managementroller.");
export const enterpriseOffice70 = scaledEnterpriseScenario(70, "enterprise_office_70", "Enterprise Campus — 70", "Ett större campus med flera accesslager, filialklienter och drift-/övervakningsresurser.");
export const enterpriseOffice80 = scaledEnterpriseScenario(80, "enterprise_office_80", "Enterprise Campus — 80", "En stor deterministisk enterprise-topologi för översikt, zoom/pan och fault-injection-verifiering.");

// Fault overlays for routing/VLAN/STP are not semantically declared by this
// source. Do not present labels that promise truth the current model cannot
// express; the existing Fault Injection surface remains the truthful path.
export const enterpriseOfficeScenarios = [enterpriseOffice30, enterpriseOfficeHealthy, enterpriseOffice50, enterpriseOffice70, enterpriseOffice80];

export const enterpriseScenarioById = new Map(enterpriseOfficeScenarios.map((scenario) => [scenario.scenarioId, scenario]));
