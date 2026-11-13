import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("tests/acceptance/run_atlas001_real_browser.py", "utf8");
assert.match(source, /data-atlas-layout-quality.*PASS/, "G3 acceptance must require final PASS quality");
assert.doesNotMatch(source, /data-atlas-layout-status=\"PENDING\".*data-atlas-layout-quality/, "G3 acceptance must not accept PENDING as a final layout");

console.log("ATLAS-001 G3 acceptance contract: PASS");
