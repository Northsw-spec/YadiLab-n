import assert from "node:assert/strict";
import fs from "node:fs";
import { buildVisualJourneyFromActiveProbe, visualJourneyFrame, VISUAL_JOURNEY_OUTCOME_MARKER_MS } from "../../dist-browser-test/ui/src/browser/visual-journey.js";
import { enterpriseOfficeScenarios } from "../../ui/app/enterprise-office-scenario.mjs";
import { verifiedDeliveryProbePresets, verifiedDeliveryScenarios } from "../../ui/app/verified-delivery-scenarios.mjs";

const main = fs.readFileSync("ui/app/main.mjs", "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");
const visualState = fs.readFileSync("ui/src/browser/visual-state.ts", "utf8");
const viewportLifecycle = fs.readFileSync("ui/src/canvas/topology-viewport-lifecycle.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const curriculum = JSON.parse(fs.readFileSync("curriculum/builtin/wave1-manifest.json", "utf8"));

let assertions = 0;
const check = (value, message) => { assertions += 1; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };

check(/^1\.8\.0-dev\.\d+$/.test(packageJson.version) && /^VERSION-\d+$/.test(packageJson.yadilabRelease.checkpoint), "version and checkpoint are source-defined");
check(main.includes('data-yadilab-build-version": releaseIdentity.version') && main.includes('"data-source-commit": releaseIdentity.sourceCommit') && main.includes('`v${releaseIdentity.version} · ${releaseIdentity.sourceCommit.slice(0,12)}`'), "Visible app version and exact Git source identity are derived from release contract");

// Interaction contracts: topology stays first, right-button pan is explicit,
// blank left-drag remains selection-only in Builder, and context menus cannot
// steal the gesture from the topology surface.
check(main.includes('data-topology-pan-button": "right"'), "topology advertises right-button pan");
check(main.includes("panOnDrag: [2]"), "React Flow pan is restricted to the right mouse button");
check(main.includes("selectionOnDrag: workspace.mode === \"builder\""), "blank left-drag remains Builder selection semantics");
check(main.includes("onPaneContextMenu: (event) => event.preventDefault()"), "topology suppresses the browser context menu during pan");

// Visible outcome contracts: the Engine-owned marker is anchored to the
// terminal node and counter-scales against React Flow's viewport transform.
check(main.includes("ViewportPortal") && main.includes("journeyOutcomeMarkerScale") && main.includes('"--journey-marker-scale": String(journeyOutcomeMarkerScale)'), "terminal marker uses a dedicated viewport overlay with compensation scale");
check(main.includes("zIndex: node.type === \"resource\" && visibleJourneyOutcome"), "terminal outcome node is raised above topology edges");
check(css.includes("scale: var(--journey-marker-scale, 1)") && css.includes("journey-outcome-overlay") && css.includes("react-flow__viewport-portal"), "marker CSS keeps the overlay above the topology without clipping");
check(css.includes(".journey-node-badge.outcome-success") && css.includes(".journey-node-badge.outcome-drop"), "success and drop markers have explicit styles");
check(main.includes('data-outcome-marker-created-at') && main.includes('data-outcome-marker-expires-at') && main.includes('durationMs + 650'), "terminal marker timing is recorded after arrival and loop waits for marker lifetime");
check(main.includes('data-loop-control') && main.includes('"aria-label": "Loop animation"') && main.includes('"data-playback-source": "recorded-engine-journey"'), "loop control is visible and explicitly visual-only");
check(main.includes('getInternalNode') && main.includes('positionAbsolute') && main.includes('data-outcome-flow-position'), "nested terminal overlays use React Flow absolute node coordinates");
check(main.includes('activeJourney.scenarioHash === workspace.scenario.sourceHash') && main.includes('activeJourney.stateRevision === workspace.engineState.stateRevision'), "stale journeys cannot render after scenario or Engine revision changes");
check(main.includes('data-runtime-scenario-id') && main.includes('data-observation-scenario-id') && main.includes('data-active-probe-scenario-id'), "observation and active-probe UI expose the current Engine scenario identity");
check(main.includes('data-verified-delivery-preset') && main.includes('verifiedDeliveryExplanation') && main.includes('Validator → Compiler → Engine → Active Probe'), "verified delivery presets remain an existing Active Probe input path with a collapsed teaching explanation");
check(main.includes('verifiedDeliveryLoadKey') && main.includes('scenarioLoadKey') && main.includes('Mixed startar deterministiskt med Allowed flow'), "verified delivery reloads explicitly reset the Mixed probe selection to its documented deterministic default");
check(main.includes("data-journey-packet-geometry") && main.includes("requestAnimationFrame") && main.includes("journeyGeometryReady") && main.includes(".9 / Number(journey?.speed || 1)"), "packet overlays wait for resolved React Flow geometry and fit the authoritative playback step window");
check(viewportLifecycle.includes("transient-zero-size") && viewportLifecycle.includes("preserveCanonicalGeometry") && viewportLifecycle.includes("rebuildVisualGeometry"), "topology viewport lifecycle preserves last valid geometry through transient zero-size states");
check(main.includes("ResizeObserver") && main.includes('"visibilitychange"') && main.includes('"pageshow"') && main.includes("updateNodeInternals"), "topology restore listens to browser lifecycle and explicitly rebuilds node/link geometry");
check(main.includes('data-topology-edge-count') && main.includes('data-topology-edge-ids') && main.includes('data-topology-last-valid-size'), "topology exposes deterministic edge identity and last-valid viewport evidence");
check(main.includes("buildModeledObservationTopologyVisual") && visualState.includes('actionClass: "B"') && visualState.includes('source: "ENGINE_STATE_PROJECTION"'), "modeled observation is projected as a real Engine state visual, not a fake packet");
check(main.includes('data-mission-disclosure') && main.includes('e("summary", null, "Uppdrag")'), "Uppdrag is a closed-by-default disclosure");
check(css.includes(".device-proxmox") && css.includes("#42c9ff"), "Proxmox nodes have a dedicated cyan/blue visual role");

// Interaction affordances and disclosure controls are one global contract so
// nested details cannot drift into mixed glyph directions.
check(css.includes("button:not(:disabled):hover") && css.includes("button:not(:disabled):active") && css.includes("button:focus-visible"), "buttons expose hover, pressed and keyboard-focus feedback");
check(css.includes("details > summary::after") && css.includes('content: "▸"') && css.includes("details[open] > summary::after"), "closed/open chevrons use one CSS contract");

// Scenario switching must be cancellable and error-safe; assertions below are
// intentionally tied to the lifecycle implementation, not only to a marker.
check(main.includes("scenarioTransitionRef") && main.includes("beginScenarioTransition"), "scenario transitions have a cancellation token");
check(main.includes("CURRICULUM_LAB_SWITCH_FAILED") && main.includes("ENTERPRISE_SCENARIO_SWITCH_FAILED"), "scenario switch errors become diagnostics");
check(main.includes("releaseMedia();") && main.includes("setNotebook(null);"), "scenario switches atomically release media and notebook state");
const readiness = fs.readFileSync("ui/src/browser/runtime-readiness.mjs", "utf8");
check(readiness.includes('nav[aria-label="Application actions"]') && readiness.includes('section[aria-label="Main actions"]'), "runtime readiness accepts the Dev11 Main Actions surface");

// Real Engine-projected playback regression: both visible marker classes must
// originate from exact terminal outcomes, never from UI-side inference.
const resources = [
  { id: "client", type: "windows.workstation", label: "Client", interfaces: [{ id: "c0", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "access", type: "network.switch", label: "Access", interfaces: [{ id: "a0", kind: "ethernet", addresses: [] }, { id: "a1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "core", type: "network.router", label: "Core", interfaces: [{ id: "r0", kind: "ethernet", addresses: [] }, { id: "r1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "fw", type: "network.firewall", label: "Firewall", interfaces: [{ id: "f0", kind: "ethernet", addresses: [] }, { id: "f1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "server", type: "linux.server", label: "Server", interfaces: [{ id: "s0", kind: "ethernet", addresses: [] }], properties: {} },
];
const scenario = {
  scenarioId: "dev11-ui-regression",
  sourceHash: "dev11-ui-hash",
  resources,
  zones: [],
  connections: [
    { id: "c-access", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "access", port: "a0" }, properties: { direction: "forward" } },
    { id: "access-core", kind: "network", from: { resource: "access", port: "a1" }, to: { resource: "core", port: "r0" }, properties: { direction: "forward" } },
    { id: "core-fw", kind: "network", from: { resource: "core", port: "r1" }, to: { resource: "fw", port: "f0" }, properties: { direction: "forward" } },
    { id: "fw-server", kind: "network", from: { resource: "fw", port: "f1" }, to: { resource: "server", port: "s0" }, properties: { direction: "forward" } },
  ],
};
const transcript = (overrides = {}) => ({
  engineId: "foundation.observation",
  engineVersion: "1",
  modeled: true,
  boundary: "NO_GUEST_COMMAND_EXECUTION",
  probeMode: "ACTIVE_MODELED_PROBE",
  scenarioId: scenario.scenarioId,
  scenarioHash: scenario.sourceHash,
  stateRevision: 11,
  sourceId: "client",
  sourceLabel: "Client",
  sourceType: "windows.workstation",
  probeId: "dev11.regression",
  command: "modeled probe",
  category: "connectivity",
  truth: "TRUE",
  destinationId: "server",
  destinationLabel: "Server",
  protocol: "icmp",
  path: ["client", "access", "core", "fw", "server"],
  lines: [],
  evidence: [{ kind: "engine_query", subject: "engine.queryReachability", state: "TRUE", value: { path: ["client", "access", "core", "fw", "server"] } }],
  ...overrides,
});

const success = buildVisualJourneyFromActiveProbe(scenario, transcript());
equal(success.ok, true, "Engine success transcript projects to a visual journey");
equal(success.model.outcome.kind, "destination_reached", "success outcome is terminal destination reached");
equal(success.model.outcome.marker, "success", "success outcome exposes a green marker contract");
equal(success.model.outcome.markerDurationMs, VISUAL_JOURNEY_OUTCOME_MARKER_MS, "success marker duration is canonical");
equal(success.model.outcome.anchorResourceId, "server", "success marker anchors to the exact destination resource");
equal(visualJourneyFrame(success.model, 999).currentResourceId, "server", "playback terminal frame reaches the destination node");

const drop = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", blockingPoint: "fw" }));
equal(drop.ok, true, "Engine drop transcript projects to a visual journey");
equal(drop.model.outcome.kind, "dropped", "drop outcome is terminal dropped");
equal(drop.model.outcome.marker, "drop", "drop outcome exposes a red marker contract");
equal(drop.model.outcome.anchorResourceId, "fw", "drop marker anchors to the exact Engine blocking point");
equal(drop.model.outcome.anchorRole, "DROP_POINT", "drop marker role remains semantic");
equal(drop.model.events.some((event) => event.connectionId === "fw-server"), false, "drop playback never animates beyond the proven blocking point");

// Inventory contract used by the coverage matrix.
equal(enterpriseOfficeScenarios.length, 5, "built-in enterprise inventory contains five scenarios");
equal(enterpriseOfficeScenarios.map((item) => item.resources.length).join(","), "30,35,50,70,80", "enterprise inventory preserves 30/35/50/70/80 topology classes");
equal(verifiedDeliveryScenarios.length, 3, "Dev11 adds exactly three separate verified delivery acceptance scenarios");
equal(verifiedDeliveryScenarios.map((item) => item.scenarioId).join(","), "verified_delivery_success,verified_delivery_drop,verified_delivery_mixed", "verified delivery scenario IDs are deterministic and separate from enterprise scale inventory");
equal(verifiedDeliveryProbePresets.verified_delivery_mixed.length, 2, "mixed acceptance scenario exposes both allow and drop presets without a scenario reload");
equal(curriculum.labs.length, 8, "guided inventory contains eight scenarios");
check(curriculum.labs.every((lab) => ["routing", "dns", "firewall", "service"].includes(lab.focus)), "guided inventory uses explicit modeled probe focus categories");

console.log(`PASS Dev11 UI interaction + runtime contract: ${assertions} assertions`);
