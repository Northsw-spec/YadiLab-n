import assert from "node:assert/strict";
import {
  ATLAS_ACTIVATION_KINDS,
  classifyNetworkImportActivation,
  evaluateBoundedAtlasEligibility,
} from "../../ui/app/atlas-activation-policy.mjs";

function candidate({ resources = 500, connections = 499, filename = "source.xlsx", profile = "standard" } = {}) {
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
    ok: true,
    filename,
    workbookProfile: profile,
    source: { scenarioId: "g4_2_policy", resources: sourceResources, connections: sourceConnections, zones: [] },
    devices: resources,
    links: connections,
    unmappedColumnCount: 0,
    linkSourceConflict: undefined,
    sheets: ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"],
    diagnostics: [],
  };
}

const cases = [
  [200, 199, ATLAS_ACTIVATION_KINDS.NORMAL],
  [201, 200, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [500, 499, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [500, 2000, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [500, 2001, ATLAS_ACTIVATION_KINDS.BLOCKED],
  [1000, 999, ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS],
  [1001, 1000, ATLAS_ACTIVATION_KINDS.BLOCKED],
  [1200, 1200, ATLAS_ACTIVATION_KINDS.BLOCKED],
  [4999, 4999, ATLAS_ACTIVATION_KINDS.BLOCKED],
];

for (const [resources, connections, expected] of cases) {
  const input = candidate({ resources, connections });
  const bounded = evaluateBoundedAtlasEligibility(input);
  const actual = classifyNetworkImportActivation(input, { boundedDecision: bounded });
  assert.equal(actual.kind, expected, `${resources}/${connections} activation category`);
}

const scaleCandidate = candidate({ resources: 10000, connections: 10000 });
assert.equal(
  classifyNetworkImportActivation(scaleCandidate, { verifiedScaleProfile: true }).kind,
  ATLAS_ACTIVATION_KINDS.EXISTING_VERIFIED_SCALE_PROFILE,
  "verified existing scale profile remains a separate bounded path",
);

assert.equal(
  classifyNetworkImportActivation(candidate({ resources: 100, connections: 5000 }), { largeSource: true }).kind,
  ATLAS_ACTIVATION_KINDS.BLOCKED,
  "large unprofiled source cannot fall through to normal layout because its resource count is small",
);

// The normal renderer has no independent, documented link cap.  This is an
// explicit contract test: a caller may supply one only when a future verified
// normal-render budget exists; G4.2 itself does not invent that limit.
const normalWithExplicitVerifiedLinkBudget = candidate({ resources: 200, connections: 250 });
assert.equal(
  classifyNetworkImportActivation(normalWithExplicitVerifiedLinkBudget, { normalConnectionBudget: 250 }).kind,
  ATLAS_ACTIVATION_KINDS.NORMAL,
  "normal path honors an explicitly supplied verified link budget",
);

assert.equal(
  classifyNetworkImportActivation(candidate({ resources: 1200, connections: 1200 }), { verifiedScaleProfile: false }).reason,
  "resource-bound-exceeded",
  "unprofiled 1200-resource source is fail-closed",
);

console.log("ATLAS-001 G4.2 activation matrix: PASS (NORMAL, bounded, existing-scale and fail-closed categories are deterministic)");
