import assert from "node:assert/strict";
import fs from "node:fs";

const mainPath = process.argv[2] ?? "ui/app/main.mjs";
const runtimePath = process.argv[3] ?? "ui/src/browser/runtime.ts";
const typesPath = process.argv[4] ?? "ui/src/browser/types.ts";
const main = fs.readFileSync(mainPath, "utf8");
const runtime = fs.readFileSync(runtimePath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");

assert.match(types, /interface RuntimeWorkspace[\s\S]*readonly source\?: ScenarioSource/);
assert.match(runtime, /mode: "runtime",\s*source: workspace\.source,/);
assert.match(main, /const source = workspace\.mode === "runtime" \? workspace\.source \?\? welcomeScenario : workspace\.source/);
assert.doesNotMatch(main, /setWorkspace\(createBuilderWorkspace\(workspace\.mode === "runtime" \? welcomeScenario/);
assert.match(main, /workspace\.source \?\? welcomeScenario/);

console.log(`PASS Dev9 Builder-return lifecycle contract: canonical Runtime source is restored, with welcome fallback only when Runtime has no editable source (${mainPath})`);
