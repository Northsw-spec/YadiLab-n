import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateBoundedAtlasEligibility } from "../../ui/app/atlas-activation-policy.mjs";

// Regression contract after the G4.1 red reproduction: the product no longer
// contains a fixture-bound eligibility predicate.
const source = readFileSync("ui/app/main.mjs", "utf8");
assert.doesNotMatch(source, /atlasG4SyntheticProfile/);
assert.doesNotMatch(source, /atlas001-g4-500\.xlsx/);
assert.doesNotMatch(source, /atlas_g4_synthetic_500/);

const renamedCandidate = {
  ok: true,
  filename: "atlas001-g4-b-500.xlsx",
  workbookProfile: "standard",
  source: {
    scenarioId: "atlas_g4_b_synthetic_500",
    resources: Array.from({ length: 500 }, (_, i) => ({ id: `b4_device_${String(i + 1).padStart(3, "0")}`, interfaces: [{ id: "left" }, { id: "right" }] })),
    connections: Array.from({ length: 500 }, (_, i) => ({ id: `b4_link_${String(i + 1).padStart(3, "0")}`, from: { resource: `b4_device_${String((i % 499) + 1).padStart(3, "0")}`, port: "right" }, to: { resource: `b4_device_${String(((i + 1) % 499) + 1).padStart(3, "0")}`, port: "left" } })),
    zones: Array.from({ length: 4 }, (_, i) => ({ id: `b4_zone_${i + 1}` })),
  },
  devices: 500,
  links: 500,
  unmappedColumnCount: 0,
  linkSourceConflict: undefined,
  sheets: ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"],
  diagnostics: [],
};
const legacyPredicate = candidate => Boolean(candidate?.ok &&
  candidate.filename === "atlas001-g4-500.xlsx" &&
  (candidate.workbookProfile === "standard" || candidate.workbookProfile === "legacy-six") &&
  candidate.source?.scenarioId === "atlas_g4_synthetic_500" &&
  candidate.devices === 500 && candidate.links === 499 &&
  candidate.source.resources.length === 500 &&
  candidate.source.connections.length === 499 &&
  candidate.source.zones.length === 10 && candidate.unmappedColumnCount === 0 &&
  !candidate.linkSourceConflict &&
  candidate.source.resources.every(resource => /^g4_node_[0-9]{3}$/.test(resource.id)) &&
  candidate.source.connections.every(connection => /^g4_link_[0-9]{3}$/.test(connection.id)));

assert.equal(legacyPredicate(renamedCandidate), false,
  "historical G4.1 reproducer: renamed workbook was rejected by the old rule");
assert.equal(evaluateBoundedAtlasEligibility(renamedCandidate).eligible, true,
  "G4.1 regression: renamed, structurally different workbook must use the generic bounded rule");
console.log("atlas001 G4.1 hardcoded-rule regression: PASS (generic policy accepts workbook B)");
