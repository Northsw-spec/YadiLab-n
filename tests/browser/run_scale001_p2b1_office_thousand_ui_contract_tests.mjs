import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";

// P2b1 source-wire oracle FROZEN before any new UI product implementation.
// Real 1,000/999 original-file and actual Chromium assertions are a separate
// required gate: this test is NOT itself graphical acceptance.
const panelPath="ui/app/scaled-office-thousand-builder-panel.mjs";
assert.ok(existsSync(panelPath),"P2b1 needs an independent 1,000-node reviewed original Office UI panel");
const panel=readFileSync(panelPath,"utf8");
const main=readFileSync("ui/app/main.mjs","utf8");
for(const tag of [
 "data-scale-p2b1-panel","data-scale-p2b1-file","data-scale-p2b1-summary",
 "data-scale-p2b1-selection-count","data-scale-p2b1-node-table",
 "data-scale-p2b1-link-table","data-scale-p2b1-node-id",
 "data-scale-p2b1-node-role","data-scale-p2b1-link-from",
 "data-scale-p2b1-link-to","data-scale-p2b1-source-port",
 "data-scale-p2b1-target-port","data-scale-p2b1-approve-model",
 "data-scale-p2b1-confirm","data-scale-p2b1-cancel",
]){
 assert.ok(panel.includes(tag),"Missing explicit source-consent control "+tag);
}
assert.match(panel,/map\s*\(/,"P2b1 must display independent original row ranges");
assert.match(main,/data-review-scaled-office-thousand-builder/,
 "P2b1 must be independently selected, not quietly expand P2a");
assert.match(main,/ScaledOfficeThousandBuilderPanel/,"P2b1 true separate live panel");
assert.match(main,/mapReviewedOfficeBatchesToSource/,"P2b1 canonical exact SHA/port truth required");
assert.match(main,/compileBuilderWorkspace/,"P2b1 must compile original full source");
assert.match(main,/data-scale-p2b1-focus-page/,"P2b1 must provide bounded source-row focus navigation");
assert.match(main,/data-review-scaled-office-builder/,
 "P2a real 100/99 original Office flow must remain unchanged");
console.log("PASS SCALE-001 P2b1 source-only UI contract; independent genuine 1000/999 Chromium remains mandatory.");
