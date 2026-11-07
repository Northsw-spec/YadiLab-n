import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("ui/app/main.mjs", "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");
for (const marker of ["data-intent-matrix", "data-intent-matrix-cell", "data-intent-matrix-result-filter", "data-intent-matrix-source-filter", "data-intent-matrix-destination-filter", "data-intent-matrix-flow-filter", "data-intent-matrix-rule-filter", "data-intent-matrix-drilldown", "data-intent-open-engine-run", "data-intent-open-evidence", "Expected", "Actual", "MIXED", "STALE / HISTORICAL"]) assert.ok(main.includes(marker), `missing Dev3 matrix UI marker: ${marker}`);
assert.ok(css.includes(".intent-matrix-grid"));
assert.ok(css.includes(".intent-matrix-cell.state-mixed"));
assert.ok(!/Intent Result Matrix[\s\S]{0,1400}(score|ranking|best|secure|compliant)/i.test(main));
console.log("v18 dev3 matrix UI contract tests: PASS (13 assertions)");
