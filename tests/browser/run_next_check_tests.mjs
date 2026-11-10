import assert from "node:assert/strict";
import gatewaySource from "../../curriculum/builtin/wave1/windows-gateway.json" with { type: "json" };
import dnsSource from "../../curriculum/builtin/wave1/windows-dns.json" with { type: "json" };
import linuxSource from "../../curriculum/builtin/wave1/linux-ssh.json" with { type: "json" };
import {
  addRuntimeTroubleshootingNote,
  buildNextBestCheck,
  buildGuidedTroubleshootingWorkflow,
  captureRuntimeActiveProbeEvidence,
  captureRuntimeObservationEvidence,
  commitRuntimeTypedRemediation,
  createBuilderWorkspace,
  previewRuntime,
  previewRuntimeTypedRemediation,
  runRuntimeActiveProbe,
  runRuntimeObservation,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { applyRuntimeOperationWithHistory, undoRuntime } from "../../dist-browser-test/ui/src/browser/runtime-history.js";

let pass = 0;
const check = async (name, fn) => { await fn(); pass += 1; console.log(`PASS ${name}`); };

function normalized(source, hash = "8".repeat(64)) {
  return {
    ...source,
    formatId: "infrastructure-cyber-lab.scenario",
    sourceHash: hash,
    minimumEngineVersion: "0.8.0",
    capabilityLocks: [],
    profileLocks: [],
    assetLocks: [],
    resources: source.resources.map((resource) => ({ ...resource, asset: { mode: "auto" } })),
  };
}

function runtimeFor(source, hash) {
  const model = normalized(source, hash);
  const builder = { ...createBuilderWorkspace(source), compile: { status: "valid", model, diagnostics: [] } };
  return previewRuntime(builder).workspace;
}

let runtime = runtimeFor(gatewaySource);
let notebook;

await check("gateway begins with the visible routing requirement", async () => {
  const result = await buildNextBestCheck(runtime);
  assert.equal(result.ok, true);
  assert.equal(result.nextCheck.kind, "observation");
  assert.match(result.nextCheck.title, /routing/i);
  assert.equal(result.nextCheck.preparation.tool, "observations");
  assert.equal(result.nextCheck.preparation.targetId, "client1");
  assert.equal(result.nextCheck.preparation.commandId, "windows.route_print");
  assert.equal(JSON.stringify(result.nextCheck).includes('"truth":"FALSE"'), false);
});

await check("saving routing evidence moves next check to the ICMP requirement", async () => {
  const observation = runRuntimeObservation(runtime, "client1", "windows.route_print");
  assert.equal(observation.ok, true);
  notebook = (await captureRuntimeObservationEvidence(runtime, undefined, observation.transcript)).notebook;
  const result = await buildNextBestCheck(runtime, notebook);
  assert.equal(result.nextCheck.kind, "active_probe");
  assert.equal(result.nextCheck.preparation.sourceId, "client1");
  assert.equal(result.nextCheck.preparation.destinationId, "server1");
  assert.equal(result.nextCheck.preparation.probeId, "windows.ping");
});

await check("a saved hypothesis leads to Typed Remediation review", async () => {
  const probe = runRuntimeActiveProbe(runtime, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  notebook = (await captureRuntimeActiveProbeEvidence(runtime, notebook, probe.transcript)).notebook;
  notebook = (await addRuntimeTroubleshootingNote(runtime, notebook, "hypothesis", "Gatewayen kan vara felaktig.")).notebook;
  const result = await buildNextBestCheck(runtime, notebook);
  assert.equal(result.nextCheck.title, "Granska hypotes och eventuell åtgärd");
  assert.equal(result.nextCheck.tool, "remediation");
  assert.equal(result.nextCheck.actionLabel, "Öppna Typed Remediation");
  assert.equal(JSON.stringify(result.nextCheck).includes("canonicalSolution"), false);
});

await check("current verified improvement leads to the summary instead of a generic fallback", async () => {
  let current = runtimeFor(gatewaySource, "e".repeat(64));
  const before = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  let currentNotebook = (await captureRuntimeActiveProbeEvidence(current, undefined, before.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "Gatewayen kan vara felaktig.")).notebook;
  const request = { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.1.1" } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa gatewayen.");
  current = committed.workspace;
  currentNotebook = committed.notebook;
  const after = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  currentNotebook = (await captureRuntimeActiveProbeEvidence(current, currentNotebook, after.transcript)).notebook;
  const result = await buildNextBestCheck(current, currentNotebook);
  assert.equal(result.nextCheck.title, "Granska verifieringsresultatet");
  assert.equal(result.nextCheck.tool, "summary");
  assert.equal(result.nextCheck.actionLabel, "Visa felsökningssammanfattning");
});

await check("out-of-order evidence remains visible and is not promoted to complete", async () => {
  const fresh = runtimeFor(gatewaySource, "9".repeat(64));
  const probe = runRuntimeActiveProbe(fresh, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  let outOfOrder = (await captureRuntimeActiveProbeEvidence(fresh, undefined, probe.transcript)).notebook;
  const observation = runRuntimeObservation(fresh, "client1", "windows.route_print");
  outOfOrder = (await captureRuntimeObservationEvidence(fresh, outOfOrder, observation.transcript)).notebook;
  const result = await buildNextBestCheck(fresh, outOfOrder);
  assert.equal(result.nextCheck.requirementStatus, "OUT_OF_ORDER");
  assert.equal(result.nextCheck.progress.completed, 1);
  assert.match(result.nextCheck.reason, /observation|konfiguration/i);
});

await check("a missing compatible command is explained without fabricating a tool", async () => {
  const source = structuredClone(gatewaySource);
  source.troubleshootingObjectives[0].requirements[0].command = "not-a-real-command";
  const missing = runtimeFor(source, "a".repeat(64));
  const result = await buildNextBestCheck(missing);
  assert.equal(result.nextCheck.preparation, undefined);
  assert.match(result.nextCheck.reason, /saknar ett kompatibelt/i);
});

await check("scenario mismatch is fail-closed", async () => {
  const other = runtimeFor(gatewaySource, "b".repeat(64));
  const result = await buildNextBestCheck(other, notebook);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "NEXT_CHECK_SCENARIO_MISMATCH");
});

await check("DNS UNKNOWN remains an observation, not a hidden diagnosis", async () => {
  const dnsRuntime = runtimeFor(dnsSource, "d".repeat(64));
  const first = await buildNextBestCheck(dnsRuntime);
  assert.equal(first.nextCheck.preparation.targetId, "client1");
  const observation = runRuntimeObservation(dnsRuntime, "client1", "windows.ipconfig_all");
  const dnsNotebook = (await captureRuntimeObservationEvidence(dnsRuntime, undefined, observation.transcript)).notebook;
  const next = await buildNextBestCheck(dnsRuntime, dnsNotebook);
  assert.equal(next.nextCheck.preparation.probeId, "windows.resolve_dnsname");
  const probe = runRuntimeActiveProbe(dnsRuntime, { sourceId: "client1", probeId: "windows.resolve_dnsname", queryName: "app.lab.test" });
  assert.equal(probe.transcript.truth, "UNKNOWN");
  assert.equal(JSON.stringify(next.nextCheck).includes("10.78.1.1"), false);
});

await check("a same-revision history branch cannot retain an old verified recommendation", async () => {
  let current = runtimeFor(gatewaySource, "c".repeat(64));
  const before = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  let currentNotebook = (await captureRuntimeActiveProbeEvidence(current, undefined, before.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "Gatewayen kan behöva undersökas.")).notebook;
  const request = { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.1.1" } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa gatewayen.");
  current = committed.workspace;
  currentNotebook = committed.notebook;
  const after = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  currentNotebook = (await captureRuntimeActiveProbeEvidence(current, currentNotebook, after.transcript)).notebook;
  const guidedVerified = await buildGuidedTroubleshootingWorkflow(current, currentNotebook);
  assert.equal(guidedVerified.workflow.phase, "VERIFICATION_COMPLETE");
  const undone = undoRuntime(current).workspace;
  const guidedAfterUndo = await buildGuidedTroubleshootingWorkflow(undone, currentNotebook);
  assert.equal(guidedAfterUndo.workflow.phase, "COLLECT_AFTER_EVIDENCE");
  assert.notEqual(guidedAfterUndo.workflow.steps.find((step) => step.stepId === "verify_remediation").status, "COMPLETE");
  assert.match(guidedAfterUndo.workflow.steps.find((step) => step.stepId === "verify_remediation").detail, /historical|current Runtime/i);
  const branched = applyRuntimeOperationWithHistory(undone, { op: "set", target: "client1", path: "properties.networkProfile", value: "public" }).workspace;
  const result = await buildNextBestCheck(branched, currentNotebook);
  assert.equal(result.nextCheck.title, "Ny verifiering behövs");
  assert.equal(result.nextCheck.preparation, undefined);
});

await check("a later routing observation does not hide the earlier comparable ping", async () => {
  let current = runtimeFor(gatewaySource, "f".repeat(64));
  const before = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.ping", destinationId: "server1" });
  let currentNotebook = (await captureRuntimeActiveProbeEvidence(current, undefined, before.transcript)).notebook;
  const route = runRuntimeObservation(current, "client1", "windows.route_print");
  currentNotebook = (await captureRuntimeObservationEvidence(current, currentNotebook, route.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "Gatewayen kan vara felaktig.")).notebook;
  const request = { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.1.1" } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa gatewayen.");
  const result = await buildNextBestCheck(committed.workspace, committed.notebook);
  assert.equal(result.nextCheck.actionLabel, "Förbered samma ping igen");
  assert.equal(result.nextCheck.preparation.probeId, "windows.ping");
  assert.equal(result.nextCheck.preparation.destinationId, "server1");
});

await check("TCP remediation retest preserves TCP/22", async () => {
  let current = runtimeFor(linuxSource, "1".repeat(64));
  const service = runRuntimeObservation(current, "server1", "linux.systemctl_status");
  let currentNotebook = (await captureRuntimeObservationEvidence(current, undefined, service.transcript)).notebook;
  const before = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "linux.nc_tcp", destinationId: "server1", port: 22 });
  currentNotebook = (await captureRuntimeActiveProbeEvidence(current, currentNotebook, before.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "SSH-tjänsten behöver undersökas.")).notebook;
  const request = { actionId: "set_service_enabled", targetId: "server1", parameters: { service: "ssh", enabled: true } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa tjänsten.");
  const result = await buildNextBestCheck(committed.workspace, committed.notebook);
  assert.equal(result.nextCheck.actionLabel, "Förbered samma TCP-test igen");
  assert.equal(result.nextCheck.preparation.probeId, "linux.nc_tcp");
  assert.equal(result.nextCheck.preparation.port, 22);
});

await check("DNS remediation retest preserves the DNS question", async () => {
  let current = runtimeFor(dnsSource, "2".repeat(64));
  const observation = runRuntimeObservation(current, "client1", "windows.ipconfig_all");
  let currentNotebook = (await captureRuntimeObservationEvidence(current, undefined, observation.transcript)).notebook;
  const before = runRuntimeActiveProbe(current, { sourceId: "client1", probeId: "windows.resolve_dnsname", queryName: "app.lab.test" });
  currentNotebook = (await captureRuntimeActiveProbeEvidence(current, currentNotebook, before.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "Resolvern behöver undersökas vidare.")).notebook;
  const request = { actionId: "change_dns_servers", targetId: "client1", parameters: { servers: ["10.78.102.53"] } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa resolvern.");
  const result = await buildNextBestCheck(committed.workspace, committed.notebook);
  assert.equal(result.nextCheck.actionLabel, "Förbered samma DNS-fråga igen");
  assert.equal(result.nextCheck.preparation.probeId, "windows.resolve_dnsname");
  assert.equal(result.nextCheck.preparation.queryName, "app.lab.test");
});

await check("a remediation without a comparable probe stays explicitly unverified", async () => {
  let current = runtimeFor(gatewaySource, "3".repeat(64));
  const observation = runRuntimeObservation(current, "client1", "windows.route_print");
  let currentNotebook = (await captureRuntimeObservationEvidence(current, undefined, observation.transcript)).notebook;
  currentNotebook = (await addRuntimeTroubleshootingNote(current, currentNotebook, "hypothesis", "Gatewayen kan vara felaktig.")).notebook;
  const request = { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.1.1" } };
  const preview = await previewRuntimeTypedRemediation(current, currentNotebook, request);
  const committed = await commitRuntimeTypedRemediation(current, currentNotebook, request, preview.preview.token, "Testa gatewayen.");
  const result = await buildNextBestCheck(committed.workspace, committed.notebook);
  assert.equal(result.nextCheck.title, "Jämförbart omtest saknas");
  assert.equal(result.nextCheck.preparation, undefined);
  assert.match(result.nextCheck.reason, /ingen giltig, jämförbar sparad probe/i);
});

console.log(`PASS Next Best Check logic: ${pass}/13 assertions.`);
