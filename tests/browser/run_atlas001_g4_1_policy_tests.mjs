import assert from "node:assert/strict";
import { evaluateBoundedAtlasEligibility, ATLAS_BOUNDED_MAX_RESOURCES } from "../../ui/app/atlas-activation-policy.mjs";

function candidate({ resources = 500, connections = 500, filename = "independent.xlsx", scenarioId = "independent_source", profile = "standard", unmapped = 0, conflict = undefined } = {}) {
  const sourceResources = Array.from({ length: resources }, (_, index) => ({
    id: `device_${index + 1}`,
    interfaces: [{ id: "left" }, { id: "right" }],
  }));
  const sourceConnections = Array.from({ length: connections }, (_, index) => ({
    id: `link_${index + 1}`,
    from: { resource: `device_${(index % Math.max(1, resources - 1)) + 1}`, port: "right" },
    to: { resource: `device_${((index + 1) % Math.max(1, resources - 1)) + 1}`, port: "left" },
  }));
  return {
    ok: true, filename, workbookProfile: profile, source: { scenarioId, resources: sourceResources, connections: sourceConnections, zones: [] },
    devices: resources, links: connections, unmappedColumnCount: unmapped, linkSourceConflict: conflict,
    sheets: ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"], diagnostics: [],
  };
}

const a = evaluateBoundedAtlasEligibility(candidate({ filename: "a-completely-different-name.xlsx", scenarioId: "source_a", resources: 501, connections: 501 }));
const b = evaluateBoundedAtlasEligibility(candidate({ filename: "b-other-name.xlsx", scenarioId: "source_b", resources: 503, connections: 507 }));
assert.equal(a.eligible, true);
assert.equal(b.eligible, true);
assert.equal(a.reason, "validated-bounded-xlsx");
assert.equal(b.reason, "validated-bounded-xlsx");

assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 200, connections: 199 })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: ATLAS_BOUNDED_MAX_RESOURCES + 1 })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 501, filename: "source.csv" })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 501, unmapped: 1 })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 501, conflict: { kind: "CONFLICT" } })).eligible, false);
assert.equal(evaluateBoundedAtlasEligibility(candidate({ resources: 501, profile: "legacy-src-22" })).eligible, false);

const badEndpoint = candidate({ resources: 501 });
badEndpoint.source.connections[0].to.resource = "not-declared";
assert.equal(evaluateBoundedAtlasEligibility(badEndpoint).eligible, false);

console.log("ATLAS-001 G4.1 generic eligibility policy: PASS (A/B accepted; bounds and negative gates fail closed)");
