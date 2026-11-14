import assert from "node:assert/strict";
import {
  ATLAS_ACTIVATION_KINDS,
  ATLAS_BOUNDED_MAX_CONNECTIONS,
  ATLAS_BOUNDED_MAX_RESOURCES,
  classifyNetworkImportActivation,
  evaluateBoundedAtlasEligibility,
} from "../../ui/app/atlas-activation-policy.mjs";

function candidate({ resources = 500, connections = Math.max(0, resources - 1), sheets, authoritativeSheets } = {}) {
  const sourceResources = Array.from({ length: resources }, (_, index) => ({
    id: `capacity_node_${index + 1}`,
    interfaces: [{ id: "left" }, { id: "right" }],
  }));
  const sourceConnections = Array.from({ length: connections }, (_, index) => ({
    id: `capacity_link_${index + 1}`,
    from: { resource: `capacity_node_${(index % Math.max(1, resources - 1)) + 1}`, port: "right" },
    to: { resource: `capacity_node_${((index + 1) % Math.max(1, resources - 1)) + 1}`, port: "left" },
  }));
  return {
    ok: true,
    filename: "capacity.xlsx",
    workbookProfile: "standard",
    sheets: sheets ?? ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"],
    authoritativeSheets: authoritativeSheets ?? ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"],
    source: { scenarioId: "atlas001_capacity", resources: sourceResources, connections: sourceConnections, zones: [] },
    devices: resources,
    links: connections,
    unmappedColumnCount: 0,
    diagnostics: [],
  };
}

// This is the regression reproducer for the source-validated lowercase-sheet
// path. Compatibility already exposes the six canonical identities, but the
// pre-fix policy only compared raw producer casing.
const lowercase = candidate({ sheets: ["metadata", "zones", "nodes", "interfaces", "links", "layout"] });
const lowercaseDecision = evaluateBoundedAtlasEligibility(lowercase);
assert.equal(lowercaseDecision.eligible, true, `canonical lowercase sheet names were rejected: ${lowercaseDecision.reason}`);

for (const [resources, connections, expected] of [
  [200, 199, ATLAS_ACTIVATION_KINDS.NORMAL],
  [201, 200, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [300, 299, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [500, 499, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [1000, 999, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [1001, 1000, ATLAS_ACTIVATION_KINDS.BLOCKED],
]) {
  const input = candidate({ resources, connections });
  const bounded = evaluateBoundedAtlasEligibility(input);
  const actual = classifyNetworkImportActivation(input, { boundedDecision: bounded });
  assert.equal(actual.kind, expected, `${resources}/${connections} activation category`);
}

assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 1000, connections: ATLAS_BOUNDED_MAX_CONNECTIONS + 1 })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: ATLAS_BOUNDED_MAX_RESOURCES + 1 })).eligible, false);

console.log("PASS ATLAS-001 capacity policy matrix and canonical sheet compatibility");
