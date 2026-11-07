import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enterpriseOffice80 } from "../../ui/app/enterprise-office-scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const output = path.join(root, "tests/fixtures/qualification/enterprise-100-node-stress.source.json");

const scenario = structuredClone(enterpriseOffice80);
scenario.scenarioId = "qualification_enterprise_100_node_stress";
scenario.metadata = {
  ...scenario.metadata,
  title: "Qualification — canonical 100-node stress fixture",
  briefing: "Test-only deterministic scale fixture; not a built-in teaching scenario or product support promise.",
  tags: [...scenario.metadata.tags, "qualification", "stress-fixture"],
};

const roles = [
  ["network.switch", "DISTRIBUTION-SW", "infra"],
  ["network.switch", "ACCESS-SW", "users"],
  ["windows.workstation", "WIN-BRANCH", "users"],
  ["linux.workstation", "LINUX-BRANCH", "users"],
  ["windows.server", "BRANCH-FILE", "server"],
  ["linux.server", "BRANCH-APP", "server"],
  ["resource.generic", "IOT-BRANCH", "guest"],
  ["linux.server", "MGMT-COLLECTOR", "management"],
];

for (let index = 0; index < 20; index += 1) {
  const number = String(81 + index).padStart(3, "0");
  const [type, labelPrefix, zone] = roles[index % roles.length];
  const id = `qualification-expansion-${number}`;
  scenario.resources.push({
    id,
    type,
    label: `${labelPrefix}-${number}`,
    zone,
    properties: {},
    interfaces: [{ id: "eth0", label: "Ethernet", addresses: [`10.25.0.${20 + index}/24`] }],
  });
  const parent = zone === "users" || zone === "guest" ? (index % 2 ? "access01" : "access02") : (index % 2 ? "core01" : "core02");
  scenario.connections.push({
    id: `qualification-expansion-link-${String(index + 1).padStart(2, "0")}`,
    kind: "network",
    from: { resource: parent },
    to: { resource: id },
    properties: {},
  });
}

scenario.layoutHints = scenario.resources.map((resource, index) => ({ target: resource.id, rank: Math.floor(index / 6) + 1 }));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(scenario, null, 2)}\n`);
console.log(JSON.stringify({ output, nodes: scenario.resources.length, links: scenario.connections.length, zones: scenario.zones.length, flows: scenario.tests.length }, null, 2));
