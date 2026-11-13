import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// RED reproduction for G4.1: before the generic policy exists, a structurally
// valid second workbook is rejected because the product predicate binds
// eligibility to the first fixture's filename, scenario and ID prefixes.
const source = readFileSync("ui/app/main.mjs", "utf8");
assert.match(source, /atlasG4SyntheticProfile/);
assert.match(source, /atlas001-g4-500\.xlsx/);
assert.match(source, /atlas_g4_synthetic_500/);

const renamedCandidate = {
  ok: true,
  filename: "atlas001-g4-b-500.xlsx",
  workbookProfile: "standard",
  source: {
    scenarioId: "atlas_g4_b_synthetic_500",
    resources: Array.from({ length: 500 }, (_, i) => ({ id: `b4_device_${String(i + 1).padStart(3, "0")}` })),
    connections: Array.from({ length: 500 }, (_, i) => ({ id: `b4_link_${String(i + 1).padStart(3, "0")}` })),
    zones: Array.from({ length: 4 }, (_, i) => ({ id: `b4_zone_${i + 1}` })),
  },
  devices: 500,
  links: 500,
  unmappedColumnCount: 0,
  linkSourceConflict: undefined,
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
  "G4.1 red test: renamed, structurally different workbook is rejected by the old rule");
console.log("atlas001 G4.1 RED reproduction: PASS (old hardcoded rule rejects workbook B)");
