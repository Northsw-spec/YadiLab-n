import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import {
  buildVisualJourneyFromActiveProbe,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  previewRuntime,
  runRuntimeActiveProbe,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { verifiedDeliveryProbePresets, verifiedDeliveryScenarios } from "../../ui/app/verified-delivery-scenarios.mjs";

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false, validateSchema: true });
const validateSource = ajv.compile(sourceSchema);
const validateNormalized = ajv.compile(normalizedSchema);
const compilerOptions = {
  compilerContext: {
    validateSource: (data) => ({ valid: Boolean(validateSource(data)), diagnostics: (validateSource.errors ?? []).map((error) => `${error.instancePath || "$"}: ${error.message ?? error.keyword}`) }),
    validateNormalized: (data) => ({ valid: Boolean(validateNormalized(data)), diagnostics: (validateNormalized.errors ?? []).map((error) => `${error.instancePath || "$"}: ${error.message ?? error.keyword}`) }),
    catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets },
    engineBaselineVersion: ENGINE_VERSION,
  },
};

const expected = {
  "success-https": { truth: "TRUE", marker: "success", anchor: "web01" },
  "drop-https": { truth: "FALSE", marker: "drop", anchor: "drop-server" },
  "mixed-allow": { truth: "TRUE", marker: "success", anchor: "allowed-server" },
  "mixed-drop": { truth: "FALSE", marker: "drop", anchor: "blocked-server" },
};

let assertions = 0;
for (const source of verifiedDeliveryScenarios) {
  assert.equal(Boolean(validateSource(source)), true, `${source.scenarioId} passes the real source schema validator`); assertions += 1;
  let builder = createBuilderWorkspace(structuredClone(source));
  builder = await compileBuilderWorkspace(builder, compilerOptions);
  assert.equal(builder.compile.status, "valid", `${source.scenarioId} compiles through the real browser compiler`); assertions += 1;
  const runtime = previewRuntime(builder);
  assert.equal(runtime.ok, true, `${source.scenarioId} previews into Engine runtime`); assertions += 1;
  if (!runtime.ok) continue;
  for (const preset of verifiedDeliveryProbePresets[source.scenarioId]) {
    const result = runRuntimeActiveProbe(runtime.workspace, { sourceId: preset.sourceId, probeId: preset.probeId, destinationId: preset.destinationId, port: preset.port });
    const expectedResult = expected[preset.id] ?? expected.success;
    assert.equal(result.ok, true, `${source.scenarioId}/${preset.id} active probe runs`); assertions += 1;
    assert.equal(result.transcript?.truth, expectedResult.truth, `${source.scenarioId}/${preset.id} keeps Engine truth`); assertions += 1;
    const visual = result.transcript ? buildVisualJourneyFromActiveProbe(runtime.workspace.scenario, result.transcript) : { ok: false };
    assert.equal(visual.ok, true, `${source.scenarioId}/${preset.id} projects the Engine transcript to Visual Journey`); assertions += 1;
    if (visual.ok && visual.model) {
      assert.equal(visual.model.outcome.marker, expectedResult.marker, `${source.scenarioId}/${preset.id} exposes only the Engine-owned marker`); assertions += 1;
      assert.equal(visual.model.outcome.anchorResourceId, expectedResult.anchor, `${source.scenarioId}/${preset.id} anchors at the exact Engine endpoint`); assertions += 1;
    }
  }
}

console.log(`PASS Dev11 verified delivery real Validator → Compiler → Engine → Active Probe → Visual Journey: ${assertions} assertions`);
