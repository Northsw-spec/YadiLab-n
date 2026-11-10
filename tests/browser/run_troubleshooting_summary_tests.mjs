import assert from "node:assert/strict";
import {
  addRuntimeTroubleshootingNote,
  buildTroubleshootingSummary,
  captureRuntimeActiveProbeEvidence,
  commitRuntimeTypedRemediation,
  createBuilderWorkspace,
  previewRuntime,
  previewRuntimeTypedRemediation,
  runRuntimeActiveProbe,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { applyRuntimeOperationWithHistory } from "../../dist-browser-test/ui/src/browser/runtime-history.js";

let pass = 0;
const check = async (name, fn) => { await fn(); pass += 1; console.log(`PASS ${name}`); };

const source = {
  formatId: "infrastructure-cyber-lab.scenario-source",
  schemaVersion: "0.1.0",
  scenarioId: "summary_lab",
  metadata: { title: "Windows Gateway", description: "Routing problem", language: "sv", authors: [], tags: [], briefing: "Klienten når inte servern över nätet." },
  requires: { capabilities: [], profiles: [] },
  zones: [],
  resources: [
    { id: "client1", type: "windows.workstation", label: "Windows client", interfaces: [{ id: "eth0", label: "Ethernet", addresses: ["10.78.1.20/24"] }], properties: { defaultGateway: "10.78.1.254", dnsServers: [], aclDefaultAction: "allow", networkProfile: "private" } },
    { id: "r1", type: "network.router", label: "Router", interfaces: [{ id: "lan", label: "LAN", addresses: ["10.78.1.1/24", "10.78.101.1/24"] }], properties: { routes: [{ id: "to-server", destination: "server1", via: "server1", action: "forward", enabled: true }] } },
    { id: "server1", type: "windows.server", label: "Windows server", interfaces: [{ id: "eth0", label: "Ethernet", addresses: ["10.78.101.80/24"] }], properties: { defaultGateway: "10.78.101.1", aclDefaultAction: "allow" } },
  ],
  connections: [{ id: "client_r1", kind: "network", from: { resource: "client1" }, to: { resource: "r1" }, properties: {} }, { id: "r1_server", kind: "network", from: { resource: "r1" }, to: { resource: "server1" }, properties: {} }],
  tests: [], findings: [], objectives: [], completion: { op: "all", rules: [] }, hints: [],
};
const normalized = { ...source, formatId: "infrastructure-cyber-lab.scenario", sourceHash: "8".repeat(64), minimumEngineVersion: "0.8.0", capabilityLocks: [], profileLocks: [], assetLocks: [], resources: source.resources.map((resource) => ({ ...resource, asset: { mode: "auto" } })) };
const builder = { ...createBuilderWorkspace(source), compile: { status: "valid", model: normalized, diagnostics: [] } };
let runtime = previewRuntime(builder).workspace;
let notebook;

await check("empty report is explicit and does not invent success", async () => {
  const result = await buildTroubleshootingSummary(runtime);
  assert.equal(result.ok, true);
  assert.equal(result.summary.status, "INSUFFICIENT_EVIDENCE");
  assert.match(result.summary.uncertainty, /Ingen observation|inte tillräckligt dokumenterat/i);
  assert.ok(!result.summary.markdown.includes("canonicalSolution"));
});

await check("saved failed probe is reported without an action", async () => {
  const probe = runRuntimeActiveProbe(runtime, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  assert.equal(probe.ok, true);
  assert.equal(probe.transcript.truth, "FALSE");
  notebook = (await captureRuntimeActiveProbeEvidence(runtime, undefined, probe.transcript)).notebook;
  const result = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(result.summary.status, "INVESTIGATION_IN_PROGRESS");
  assert.match(result.summary.markdown, /ping server1.*FALSE/);
  assert.match(result.summary.markdown, /Ingen åtgärd/);
});

await check("action without retest is never called verified", async () => {
  notebook = (await addRuntimeTroubleshootingNote(runtime, notebook, "hypothesis", "Gatewayen kan vara felaktig.")).notebook;
  const request = { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.1.1" } };
  const preview = await previewRuntimeTypedRemediation(runtime, notebook, request);
  const committed = await commitRuntimeTypedRemediation(runtime, notebook, request, preview.preview.token, "Byter gateway enligt min hypotes.");
  runtime = committed.workspace;
  notebook = committed.notebook;
  const result = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(result.summary.status, "ACTION_RECORDED_NO_RETEST");
  assert.match(result.summary.uncertainty, /omtest saknas/i);
  assert.equal(result.summary.verification.pairs.length, 0);
});

await check("matched before and after evidence produces a truthful report", async () => {
  const probe = runRuntimeActiveProbe(runtime, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  notebook = (await captureRuntimeActiveProbeEvidence(runtime, notebook, probe.transcript)).notebook;
  const result = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(result.summary.status, "VERIFIED_IMPROVEMENT");
  assert.equal(result.summary.verification.pairs[0].before, "FALSE");
  assert.equal(result.summary.verification.pairs[0].after, "TRUE");
  assert.match(result.summary.markdown, /FALSE → TRUE/);
  assert.match(result.summary.markdown, /Användarens hypotes/);
});

await check("a later Runtime revision downgrades historical verification", async () => {
  const changed = applyRuntimeOperationWithHistory(runtime, { op: "set", target: "client1", path: "properties.networkProfile", value: "public" });
  assert.equal(changed.ok, true);
  runtime = changed.workspace;
  const result = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(result.summary.status, "HISTORICAL_VERIFIED_NEEDS_RECHECK");
  assert.match(result.summary.uncertainty, /Ny verifiering behövs/);
  assert.equal(result.summary.verification.historical, true);
});

console.log(`PASS Troubleshooting Summary logic: ${pass}/5 assertions.`);
