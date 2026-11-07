import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";

// SCALE-001 P2b2B: independent frozen UI acceptance oracle.
// Source-only wiring assertions do NOT substitute for actual Chromium testing.
const panelPath="ui/app/scaled-office-declared-site-review-panel.mjs";
assert.ok(existsSync(panelPath),"P2b2B needs a separately authored user declaration panel");
const panel=readFileSync(panelPath,"utf8");
const main=readFileSync("ui/app/main.mjs","utf8");
for(const tag of [
 "data-scale-p2b2-panel","data-scale-p2b2-site-id","data-scale-p2b2-site-label",
 "data-scale-p2b2-add-site","data-scale-p2b2-building-id",
 "data-scale-p2b2-building-label","data-scale-p2b2-building-site",
 "data-scale-p2b2-add-building","data-scale-p2b2-floor-id",
 "data-scale-p2b2-floor-label","data-scale-p2b2-floor-building",
 "data-scale-p2b2-add-floor","data-scale-p2b2-device-id",
 "data-scale-p2b2-device-floor","data-scale-p2b2-add-assignment",
 "data-scale-p2b2-approve-definition","data-scale-p2b2-approve-assignment",
 "data-scale-p2b2-ack-definition","data-scale-p2b2-ack-assignment",
 "data-scale-p2b2-confirm","data-scale-p2b2-cancel"
]){
 assert.ok(panel.includes(tag),"Missing individual P2b2B consent control: "+tag);
}
assert.match(main,/validateDeclaredOfficeSiteHierarchy\s*\(/,
 "Actual approved hierarchy must use P2b2A validated original node IDs + port-linked evidence");
assert.match(main,/sourceOriginalSha256/, "No hierarchy without trusted original Office SHA");
assert.match(main,/sourceModelHash/, "No hierarchy without independently recalculated Builder SHA");
assert.match(main,/data-scale-p2b2-open/, "UI must be opt-in, not inferred from names/subnets");
assert.match(main,/data-scale-p2b2-summary/, "Unassigned originals and cross-site links need distinct audit counts");
assert.match(main,/data-scale-p2b1-focus-page/, "P2b1 original row focus must remain independently usable");
assert.doesNotMatch(panel,/eval\s*\(|innerHTML\s*=|dangerouslySetInnerHTML/,
 "Untrusted site labels may only enter safe React text nodes");
console.log("PASS SCALE-001 P2b2B frozen source UI contract; real Chromium prerequisite remains separate.");
