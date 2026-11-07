import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

// Frozen source-wire oracle BEFORE real Chromium and production UI changes.
// A string-only mock passing this file is NOT sufficient: the independent
// Playwright test also asserts the actual compiled and drawn source graph.
const main=readFileSync("ui/app/main.mjs","utf8");
const path="ui/app/scaled-office-builder-panel.mjs";
assert.ok(existsSync(path),"SCALE P2a separate large-office reviewed panel must exist");
const panel=readFileSync(path,"utf8");
assert.match(main,/data-review-scaled-office-builder/,"distinct P2a opt-in menu action");
assert.match(main,/ScaledOfficeBuilderPanel/,"actual new modal wired in main app");
assert.match(main,/mapReviewedOfficeBatchesToSource/,"live original source mapper, not a fake graph");
assert.match(main,/autoLayoutBuilder/,"canonical Builder layout still used");
assert.match(main,/compileBuilderWorkspace/,"real Builder compile remains required");
assert.match(panel,/data-scale-p2a-panel/,"real original Office review panel");
assert.match(panel,/data-scale-p2a-file/,"original local DOCX\/ODT File picker");
assert.match(panel,/data-scale-p2a-confirm/,"independent final approval");
assert.match(panel,/data-scale-p2a-approve-range/,"source row range separate approval");
assert.match(panel,/data-scale-p2a-approve-model/,"separate model replacement consent");
assert.match(panel,/data-scale-p2a-node-table/,"declared Nodes table selection");
assert.match(panel,/data-scale-p2a-link-table/,"declared Links table selection");
for(const field of ["node-id","node-role","link-from","link-to","source-port","target-port"]) {
 assert.ok(panel.includes("data-scale-p2a-"+field),
   "P2a explicit source column ordinal selector "+field);
}
assert.match(main,/data-review-office-builder/,"P10 old reviewed Office entrypoint retained");
console.log("PASS SCALE-001 P2a SOURCE-ONLY UI integration contract, real original Chromium required separately.");
