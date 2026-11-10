import assert from "node:assert/strict";
import { buildNetworkOverviewProjection } from "../../dist-browser-test/ui/src/canvas/network-overview.js";

const resources = [
  { id: "core_01", label: "Core 01", type: "network.core" },
  { id: "core_02", label: "Core 02", type: "network.core" },
  ...Array.from({ length: 32 }, (_, index) => ({ id: `dist_${String(index + 1).padStart(2, "0")}`, type: "network.distribution" })),
  ...Array.from({ length: 256 }, (_, index) => ({ id: `access_${String(index + 1).padStart(3, "0")}`, type: "network.access" })),
  ...Array.from({ length: 9710 }, (_, index) => ({ id: `client_${String(index + 1).padStart(5, "0")}`, type: "endpoint.windows" })),
];
const connections = Array.from({ length: 10000 }, (_, index) => ({
  id: `link_${String(index + 1).padStart(5, "0")}`,
  from: { resource: index < 32 ? "core_01" : index < 288 ? `dist_${String((index % 32) + 1).padStart(2, "0")}` : `access_${String(((index - 288) % 256) + 1).padStart(3, "0")}` },
  to: { resource: index < 32 ? `dist_${String((index % 32) + 1).padStart(2, "0")}` : index < 288 ? `access_${String(((index - 32) % 256) + 1).padStart(3, "0")}` : `client_${String(((index - 288) % 9710) + 1).padStart(5, "0")}` },
}));

const overview = buildNetworkOverviewProjection({ scenarioId: "project087", resources, connections });
assert.equal(overview.overview, true);
assert.equal(overview.strategy, "documented-role-bands");
assert.equal(overview.canonicalNodes, 10000);
assert.equal(overview.canonicalLinks, 10000);
assert.equal(overview.groups.length, 4);
assert.ok(overview.nodes.length < 20, "overview must not render the full canonical graph");
assert.equal(overview.groups.reduce((sum, group) => sum + group.members.length, 0), 10000);
assert.deepEqual(overview.groups.map((group) => group.label), ["CORE", "DISTRIBUTION", "ACCESS", "CLIENTS"]);
for (const group of overview.groups) assert.ok(group.members.every((id) => resources.some((resource) => resource.id === id)));
for (const node of overview.nodes) {
  assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
  assert.ok(node.width > 0 && node.height > 0);
  assert.equal(node.data.overviewGroup, true);
}
for (let i = 1; i < overview.nodes.length; i++) assert.ok(overview.nodes[i].position.y >= overview.nodes[i - 1].position.y, "role bands are deterministic top-to-bottom");
assert.ok(overview.edges.every((edge) => edge.data.properties.summaryOnly === true));
assert.ok(overview.edges.every((edge) => String(edge.data.visual.accessibleLabel).includes("not a physical link")));
assert.equal(JSON.stringify(overview), JSON.stringify(buildNetworkOverviewProjection({ scenarioId: "project087", resources, connections })));

const neutral = buildNetworkOverviewProjection({
  scenarioId: "legacy",
  resources: Array.from({ length: 47 }, (_, index) => ({ id: `node_${index + 1}`, type: index < 35 ? "network.switch" : "server.generic" })),
  connections: Array.from({ length: 46 }, (_, index) => ({ id: `link_${index + 1}`, from: { resource: `node_${index + 1}` }, to: { resource: `node_${index + 2}` } })),
});
assert.equal(neutral.strategy, "neutral-type-bands");
assert.ok(neutral.groups.every((group) => group.documentedHierarchy === false));
assert.equal(neutral.canonicalNodes, 47);
assert.equal(neutral.canonicalLinks, 46);
console.log("PASS PROJECT-087 overview: bounded role bands, neutral legacy view, deterministic summaries and preserved canonical counts");
