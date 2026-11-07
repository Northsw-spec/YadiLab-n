import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import {
  buildRuntimeViewModel,
  buildVisualJourneyFromActiveProbe,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  previewRuntime,
  runRuntimeActiveProbe,
  visualJourneyFrame,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { projectScenarioToCanvas } from "../../dist-browser-test/ui/src/canvas/projection.js";
import { createTopologyViewportLifecycle } from "../../dist-browser-test/ui/src/canvas/topology-viewport-lifecycle.js";
import { verifiedDeliveryProbePresets, verifiedDeliveryScenarios } from "../../ui/app/verified-delivery-scenarios.mjs";

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false, validateSchema: true });
const validateSource = ajv.compile(sourceSchema);
const validateNormalized = ajv.compile(normalizedSchema);
const compilerOptions = {
  compilerContext: {
    validateSource: (data) => ({ valid: Boolean(validateSource(data)), diagnostics: (validateSource.errors ?? []).map((error) => error.message ?? error.keyword) }),
    validateNormalized: (data) => ({ valid: Boolean(validateNormalized(data)), diagnostics: (validateNormalized.errors ?? []).map((error) => error.message ?? error.keyword) }),
    catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets },
    engineBaselineVersion: ENGINE_VERSION,
  },
};

let assertions = 0;
const check = (condition, message) => { assert.equal(Boolean(condition), true, message); assertions += 1; };

const mixed = verifiedDeliveryScenarios.find((scenario) => scenario.scenarioId === "verified_delivery_mixed");
assert.ok(mixed);
let builder = await compileBuilderWorkspace(createBuilderWorkspace(structuredClone(mixed)), compilerOptions);
const runtime = previewRuntime(builder);
check(runtime.ok, "Mixed scenario previews into runtime");
if (runtime.ok) {
  const canvas = buildRuntimeViewModel(runtime.workspace).canvas;
  const canvasEdgeIds = canvas.edges.map((edge) => edge.id).sort((a, b) => a.localeCompare(b, "en"));
  const projectedEdgeIds = projectScenarioToCanvas(runtime.workspace.scenario, runtime.workspace.layout).edges.map((edge) => edge.id).sort((a, b) => a.localeCompare(b, "en"));
  assert.deepEqual(canvasEdgeIds, projectedEdgeIds, "UI canvas edge identity is projected from canonical topology"); assertions += 1;
  assert.deepEqual(canvasEdgeIds, [
    "mixed-allowed-client-router",
    "mixed-blocked-client-router",
    "mixed-router-allowed",
    "mixed-router-blocked",
  ], "Mixed topology keeps all four canonical network links"); assertions += 1;

const expected = {
    "mixed-allow": {
      path: ["client-allowed", "router01", "allowed-server"],
      segmentConnections: ["mixed-allowed-client-router", "mixed-router-allowed"],
    },
    "mixed-drop": {
      path: ["client-blocked", "router01", "blocked-server"],
      segmentConnections: ["mixed-blocked-client-router", "mixed-router-blocked"],
    },
  };
  assert.equal(verifiedDeliveryProbePresets.verified_delivery_mixed[0]?.id, "mixed-allow", "Mixed documents Allowed flow as its deterministic default preset"); assertions += 1;
  assert.equal(verifiedDeliveryProbePresets.verified_delivery_mixed[1]?.id, "mixed-drop", "Mixed exposes Blocked flow as a separate explicit preset"); assertions += 1;
  for (const preset of verifiedDeliveryProbePresets.verified_delivery_mixed) {
    const probe = runRuntimeActiveProbe(runtime.workspace, { sourceId: preset.sourceId, probeId: preset.probeId, destinationId: preset.destinationId, port: preset.port });
    check(probe.ok, `${preset.id} Engine probe runs`);
    const journey = buildVisualJourneyFromActiveProbe(runtime.workspace.scenario, probe.transcript);
    check(journey.ok, `${preset.id} Engine transcript projects to Visual Journey`);
    if (!journey.ok || !journey.model) continue;
    const expectedPreset = expected[preset.id];
    assert.deepEqual(journey.model.path, expectedPreset.path, `${preset.id} preserves the authoritative Engine path`); assertions += 1;
    const renderedSegments = journey.model.events.filter((event) => event.kind === "flow.segment").map((event) => ({ connectionId: event.connectionId, from: event.resourceId, to: event.targetResourceId }));
    assert.deepEqual(renderedSegments, expectedPreset.segmentConnections.map((connectionId, index) => ({ connectionId, from: expectedPreset.path[index], to: expectedPreset.path[index + 1] })), `${preset.id} renders exactly the Engine hop sequence`); assertions += 1;
    for (const segment of journey.model.events.filter((event) => event.kind === "flow.segment")) {
      const frame = visualJourneyFrame(journey.model, segment.sequence - 1);
      assert.deepEqual(frame.activeConnectionIds, [segment.connectionId], `${preset.id} activates only the authoritative connection at sequence ${segment.sequence}`); assertions += 1;
      assert.deepEqual(frame.activeDirection, { from: segment.resourceId, to: segment.targetResourceId }, `${preset.id} packet direction follows the authoritative hop at sequence ${segment.sequence}`); assertions += 1;
    }
  }
}

const lifecycle = createTopologyViewportLifecycle(["mixed-router-blocked", "mixed-allowed-client-router", "mixed-router-blocked"]);
const normal = lifecycle.observe({ width: 587, height: 520 });
check(normal.phase === "valid" && normal.edgeCount === 2 && normal.rebuildVisualGeometry === false, "valid viewport establishes canonical geometry without a rebuild request");
const minimized = lifecycle.observe({ width: 0, height: 0 });
check(minimized.phase === "transient-zero-size" && minimized.preserveCanonicalGeometry, "zero-size viewport preserves the last valid topology geometry");
check(minimized.lastValidSize?.width === 587 && minimized.lastValidSize?.height === 520, "zero-size viewport retains the last meaningful dimensions");
const restored = lifecycle.observe({ width: 587, height: 520 });
check(restored.phase === "valid" && restored.rebuildVisualGeometry, "restored valid viewport requests visual geometry reconstruction");
assert.deepEqual(restored.edgeIds, ["mixed-allowed-client-router", "mixed-router-blocked"], "restore retains deterministic edge identity without duplicates"); assertions += 1;
const resized = lifecycle.observe({ width: 920, height: 700 });
check(resized.phase === "valid" && resized.edgeCount === 2, "normal resize keeps the canonical edge set");
assert.deepEqual(resized.edgeIds, restored.edgeIds, "larger viewport keeps the same endpoint identity"); assertions += 1;

console.log(`PASS Dev11 Mixed hop + topology viewport lifecycle regression: ${assertions} assertions`);
