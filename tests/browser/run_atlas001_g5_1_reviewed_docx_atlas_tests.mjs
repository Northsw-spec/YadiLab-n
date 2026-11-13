import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// G5.1 contract: the reviewed DOCX path exposes a staged, source-bound
// replacement approval step and the canonical Atlas activation marker.
const mainSource = readFileSync("ui/app/main.mjs", "utf8");
const panelSource = readFileSync("ui/app/office-reviewed-builder-panel.mjs", "utf8");

assert.match(mainSource, /data-atlas-activation-mode/);
assert.match(mainSource, /data-review-office-g5-1/);
assert.match(mainSource, /officeReviewedAtlasOpen \? e\(OfficeReviewedBuilderPanel/);
assert.match(mainSource, /setAtlasOpenRequest/);
assert.match(mainSource, /yadilab\.office-reviewed-provenance/,
  "G5.1 provenance sidecar format missing");
assert.match(mainSource, /ATLAS_G5_1_SOURCE_CHANGED/,
  "G5.1 source-change guard missing");
assert.match(panelSource, /data-office-p1b-confirm/);
assert.match(panelSource, /data-office-g5-1-approval/,
  "G5.1 approval selector missing");
assert.match(panelSource, /data-office-g5-1-summary/,
  "G5.1 canonical summary selector missing");
assert.match(panelSource, /ATLAS_G5_1_DOCX_ONLY/,
  "G5.1 DOCX-only guard missing");

console.log("PASS ATLAS-001 G5.1 reviewed DOCX approval and Atlas activation contract");
