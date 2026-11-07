import assert from "node:assert/strict";
import { enterpriseOfficeScenarios } from "../../ui/app/enterprise-office-scenario.mjs";
import catalogFile from "../../catalog/builtin-catalog.json" with { type: "json" };
import { compileScenario } from "../../dist-compiler-test/compiler/src/index.js";
import { createInitialEngineState, evaluateEngine } from "../../dist-engine-test/engine/src/index.js";
import { createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";
import { buildFaultDefinitionViews, injectFaultIntoRuntime, previewFaultUi, rollbackRuntimeFaultUi } from "../../dist-browser-test/ui/src/browser/fault-injection.js";
import faultPack from "../../fault-packs/builtin/network-core.json" with { type: "json" };

assert.deepEqual(enterpriseOfficeScenarios.map((scenario) => scenario.resources.length), [30, 35, 50, 70, 80], "enterprise selector exposes the five requested size classes");
assert.equal(new Set(enterpriseOfficeScenarios.map((scenario) => scenario.scenarioId)).size, enterpriseOfficeScenarios.length, "enterprise scenario IDs are unique");
assert.equal(new Set(enterpriseOfficeScenarios.map((scenario) => JSON.stringify(scenario.resources.map((item) => [item.id, item.type, item.label])))).size, enterpriseOfficeScenarios.length, "enterprise scenarios have distinct semantic resource sets");
const baseline = enterpriseOfficeScenarios.find((scenario) => scenario.scenarioId === "enterprise_office_35") ?? enterpriseOfficeScenarios[1];
assert.ok(baseline.resources.length >= 30, "canonical enterprise scenario has at least 30 resources");
assert.equal(new Set(baseline.resources.map((item) => item.id)).size, baseline.resources.length, "resource IDs are unique");
assert.equal(new Set(baseline.connections.map((item) => item.id)).size, baseline.connections.length, "connection IDs are unique");
const resourceIds = new Set(baseline.resources.map((item) => item.id));
for (const connection of baseline.connections) {
  assert.ok(resourceIds.has(connection.from.resource), `connection source exists: ${connection.from.resource}`);
  assert.ok(resourceIds.has(connection.to.resource), `connection target exists: ${connection.to.resource}`);
}
const degrees = new Map(baseline.resources.map((item) => [item.id, 0]));
for (const connection of baseline.connections) {
  degrees.set(connection.from.resource, degrees.get(connection.from.resource) + 1);
  degrees.set(connection.to.resource, degrees.get(connection.to.resource) + 1);
}
assert.deepEqual([...degrees.entries()].filter(([, degree]) => degree === 0), [], "no enterprise resource is accidentally isolated");
assert.equal(new Set(baseline.zones.map((zone) => zone.id)).size, baseline.zones.length, "zone IDs are unique");
assert.deepEqual(baseline.tests.map((test) => test.id), ["user_to_db", "user_to_dns", "user_to_dmz", "guest_to_db", "management_to_server"], "enterprise flows are deterministic and cover success/drop paths");
assert.ok(baseline.tests.some((test) => test.expectedInitial === "FALSE"), "enterprise baseline includes a verified drop/block flow");
assert.ok(baseline.layoutHints.length >= baseline.resources.length, "every enterprise resource has a deterministic layout hint");
const context = {
  validateSource: () => ({ valid: true, diagnostics: [] }),
  validateNormalized: () => ({ valid: true, diagnostics: [] }),
  catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets },
  engineBaselineVersion: "0.2.0",
};
const compiled = await compileScenario(baseline, context);
assert.equal(compiled.ok, true, "enterprise baseline compiles through the product compiler");
if (compiled.ok) {
  const evaluation = evaluateEngine(compiled.model, createInitialEngineState(compiled.model));
  const outcomes = Object.fromEntries(evaluation.tests.map((test) => [test.id, test.outcome]));
  assert.equal(outcomes.user_to_db, "TRUE", "user_to_db is an Engine-verified success");
  assert.equal(outcomes.user_to_dns, "TRUE", "user_to_dns is an Engine-verified success");
  assert.equal(outcomes.user_to_dmz, "TRUE", "user_to_dmz is an Engine-verified success");
  assert.equal(outcomes.guest_to_db, "FALSE", "guest_to_db is an Engine-verified block");
  assert.equal(outcomes.management_to_server, "TRUE", "management_to_server is an Engine-verified success");
  assert.ok(evaluation.tests.every((test) => test.matchesExpectedInitial === "TRUE"), "all five expectedInitial values match Engine truth");
}
for (const scenario of enterpriseOfficeScenarios) {
  const result = await compileScenario(scenario, context);
  assert.equal(result.ok, true, `${scenario.scenarioId} compiles through the product compiler`);
  if (!result.ok) continue;
  const evaluation = evaluateEngine(result.model, createInitialEngineState(result.model));
  const outcomes = Object.fromEntries(evaluation.tests.map((test) => [test.id, test.outcome]));
  assert.equal(outcomes.user_to_db, "TRUE", `${scenario.scenarioId} retains a verified success flow`);
  assert.equal(outcomes.guest_to_db, "FALSE", `${scenario.scenarioId} retains a verified drop flow`);
  assert.ok(evaluation.tests.every((test) => test.matchesExpectedInitial === "TRUE"), `${scenario.scenarioId} expectedInitial values match Engine truth`);

  const builder = { ...createBuilderWorkspace(scenario), compile: { status: "valid", model: result.model, diagnostics: [] } };
  const runtimeResult = previewRuntime(builder);
  assert.equal(runtimeResult.ok, true, `${scenario.scenarioId} creates a runtime workspace for fault injection`);
  if (!runtimeResult.ok) continue;
  const fault = buildFaultDefinitionViews(faultPack, result.model).find((item) => item.faultId === "firewall.force_default_deny");
  assert.ok(fault?.bindings[0]?.options.some((option) => option.resourceId === "fw01"), `${scenario.scenarioId} exposes the shared firewall fault target`);
  const preview = await previewFaultUi({ scenario: result.model, state: runtimeResult.workspace.engineState, pack: faultPack, faultId: "firewall.force_default_deny", bindings: { target: "fw01" }, seed: 2600, mode: "RUNTIME_INJECTION" });
  assert.equal(preview.ok, true, `${scenario.scenarioId} fault preview is valid`);
  if (!preview.ok) continue;
  const injected = await injectFaultIntoRuntime({ workspace: runtimeResult.workspace, pack: faultPack, faultId: "firewall.force_default_deny", bindings: { target: "fw01" }, seed: 2600, previewToken: preview.token });
  assert.equal(injected.ok, true, `${scenario.scenarioId} fault injection is valid`);
  if (!injected.ok) continue;
  const rolledBack = await rollbackRuntimeFaultUi({ workspace: injected.value.workspace, overlay: injected.value.overlay });
  assert.equal(rolledBack.ok, true, `${scenario.scenarioId} fault rollback is valid`);
}
console.log("PASS enterprise scale + compiler/runtime truth + fault matrix: 30/35/50/70/80 resources, deterministic topology, verified success/drop flows and firewall preview/inject/rollback");
