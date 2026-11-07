import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("ui/app/main.mjs", "utf8");
for (const marker of [
  "data-intent-create",
  "data-intent-create-multi",
  "data-intent-preview",
  "data-intent-run",
  "data-intent-export",
  "data-intent-run-export",
  "data-intent-preview-summary",
  "data-intent-run-summary",
  "data-intent-case",
  "Expected",
  "Actual",
  "Engine run",
  "No Engine truth is claimed until Run Intent",
]) assert.ok(source.includes(marker), `missing Dev2 UI contract marker: ${marker}`);
assert.ok(!/IntentRun[\s\S]{0,500}(score|ranking|best|grade)/i.test(source));
assert.ok(!source.includes("previewNetworkIntent({"), "Dev2 run UI must use the IntentRun pipeline");
console.log("v18 dev2 UI contract tests: PASS (13 assertions)");
