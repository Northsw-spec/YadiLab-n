import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { compileScenario } from "../../dist-compiler-test/compiler/src/index.js";
import { createInitialEngineState, evaluateEngine } from "../../dist-engine-test/engine/src/index.js";
import { createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixturePath = path.join(root, "tests/fixtures/qualification/enterprise-100-node-stress.source.json");
const bytes = fs.readFileSync(fixturePath);
const fixture = JSON.parse(bytes);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const schemaPass = () => ({ valid: true, diagnostics: [] });
const context = {
  validateSource: schemaPass,
  validateNormalized: schemaPass,
  catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets },
  engineBaselineVersion: "0.2.0",
};

assert.equal(fixture.resources.length, 100);
assert.equal(new Set(fixture.resources.map((item) => item.id)).size, 100);
assert.equal(new Set(fixture.connections.map((item) => item.id)).size, fixture.connections.length);
const compiled = await compileScenario(fixture, context);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const model = compiled.model;
const first = evaluateEngine(model, createInitialEngineState(model));
const outcomes = Object.fromEntries(first.tests.map((test) => [test.id, test.outcome]));
assert.equal(outcomes.user_to_db, "TRUE");
assert.equal(outcomes.guest_to_db, "FALSE");
const firstSemantic = JSON.stringify(first);
let divergent = 0;
for (let run = 0; run < 1000; run += 1) {
  const result = evaluateEngine(model, createInitialEngineState(model));
  if (JSON.stringify(result) !== firstSemantic) divergent += 1;
}
assert.equal(divergent, 0);
const replay = evaluateEngine(model, createInitialEngineState(model));
assert.deepEqual(replay, first);
const builder = { ...createBuilderWorkspace(fixture), compile: { status: "valid", model, diagnostics: [] } };
const runtime = previewRuntime(builder);
assert.equal(runtime.ok, true);
console.log(JSON.stringify({
  fixturePath,
  fixtureSha256: sha256,
  nodes: fixture.resources.length,
  links: fixture.connections.length,
  zones: fixture.zones.length,
  interfaces: fixture.resources.reduce((sum, resource) => sum + (resource.interfaces?.length ?? 0), 0),
  flows: fixture.tests.length,
  services: fixture.resources.reduce((sum, resource) => sum + (resource.properties?.services?.length ?? 0), 0),
  faultDefinitions: 0,
  validator: "PASS (schema checked separately)",
  compiler: "PASS",
  engine: "PASS",
  executions: 1001,
  replayDeterminism: "PASS",
  runtimeWorkspace: "PASS",
}, null, 2));
