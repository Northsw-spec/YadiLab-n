import assert from "node:assert/strict";
import fs from "node:fs";
import {
  addRuntimeTroubleshootingNote,
  buildGuidedTroubleshootingWorkflow,
  buildNextBestCheck,
  buildTroubleshootingSummary,
  captureRuntimeActiveProbeEvidence,
  captureRuntimeObservationEvidence,
  commitRuntimeTypedRemediation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  previewRuntime,
  previewRuntimeTypedRemediation,
  runRuntimeActiveProbe,
  runRuntimeObservation,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { createRuntimeCheckpoint, restoreRuntimeCheckpoint, undoRuntime } from "../../dist-browser-test/ui/src/browser/runtime-history.js";

const source = JSON.parse(fs.readFileSync("curriculum/builtin/wave1/linux-layered-ssh.json", "utf8"));
const catalog = JSON.parse(fs.readFileSync("catalog/builtin-catalog.json", "utf8"));
const compilerOptions = { compilerContext: { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: "0.8.0" } };
const compiledBuilder = await compileBuilderWorkspace(createBuilderWorkspace(source), compilerOptions);
assert.equal(compiledBuilder.compile.status, "valid");
const freshRuntime = () => previewRuntime(compiledBuilder).workspace;
const probe = (runtime, probeId, extra = {}) => runRuntimeActiveProbe(runtime, { sourceId: "client1", probeId, destinationId: "server1", ...extra });
const saveProbe = async (runtime, notebook, transcript) => (await captureRuntimeActiveProbeEvidence(runtime, notebook, transcript)).notebook;
const saveObservation = async (runtime, notebook, transcript) => (await captureRuntimeObservationEvidence(runtime, notebook, transcript)).notebook;
const applyAction = async (runtime, notebook, request) => {
  const preview = await previewRuntimeTypedRemediation(runtime, notebook, request);
  assert.equal(preview.ok, true);
  const committed = await commitRuntimeTypedRemediation(runtime, notebook, request, preview.preview.token, "PROJECT-085 learner hypothesis test.");
  assert.equal(committed.ok, true);
  return committed;
};

async function collectBaseline(runtime) {
  let notebook;
  const route = runRuntimeObservation(runtime, "client1", "linux.ip_route");
  assert.equal(route.ok, true);
  notebook = await saveObservation(runtime, notebook, route.transcript);
  const ping = probe(runtime, "linux.ping");
  const tcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  assert.equal(ping.transcript.truth, "FALSE");
  assert.equal(tcp.transcript.truth, "FALSE");
  notebook = await saveProbe(runtime, notebook, ping.transcript);
  const service = runRuntimeObservation(runtime, "server1", "linux.systemctl_status");
  assert.equal(service.ok, true);
  notebook = await saveObservation(runtime, notebook, service.transcript);
  notebook = await saveProbe(runtime, notebook, tcp.transcript);
  return notebook;
}

async function addHypothesis(runtime, notebook, text) {
  const result = await addRuntimeTroubleshootingNote(runtime, notebook, "hypothesis", text);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.notebook;
}

let checks = 0;
const check = async (name, fn) => { await fn(); checks += 1; console.log(`PASS ${name}`); };

await check("Engine starts with independent ICMP and TCP/22 failures", async () => {
  const runtime = freshRuntime();
  const ping = probe(runtime, "linux.ping");
  const tcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  assert.equal(ping.transcript.truth, "FALSE");
  assert.equal(tcp.transcript.truth, "FALSE");
});

await check("gateway-first remediation restores ICMP but not SSH", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  notebook = await addHypothesis(runtime, notebook, "Nätvägen kan ha fel gateway.");
  const gateway = await applyAction(runtime, notebook, { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.5.1" } });
  runtime = gateway.workspace; notebook = gateway.notebook;
  const ping = probe(runtime, "linux.ping");
  const tcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  assert.equal(ping.transcript.truth, "TRUE");
  assert.equal(tcp.transcript.truth, "FALSE");
  notebook = await saveProbe(runtime, notebook, ping.transcript);
  notebook = await saveProbe(runtime, notebook, tcp.transcript);
  const summary = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(summary.summary.completion, "FALSE");
  assert.equal(summary.summary.status, "VERIFIED_IMPROVEMENT");
  const next = await buildNextBestCheck(runtime, notebook);
  assert.equal(next.nextCheck.kind, "repeat_active_probe");
  assert.equal(next.nextCheck.preparation.probeId, "linux.nc_tcp");
  assert.match(next.nextCheck.title, /Fortsätt/);
  const guided = await buildGuidedTroubleshootingWorkflow(runtime, notebook);
  assert.equal(guided.workflow.phase, "CONTINUE_INVESTIGATION");
});

await check("SSH-first remediation remains incomplete until gateway is repaired", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  notebook = await addHypothesis(runtime, notebook, "SSH-tjänsten kan vara avstängd.");
  const ssh = await applyAction(runtime, notebook, { actionId: "set_service_enabled", targetId: "server1", parameters: { service: "ssh", enabled: true } });
  runtime = ssh.workspace; notebook = ssh.notebook;
  const tcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  const ping = probe(runtime, "linux.ping");
  assert.equal(tcp.transcript.truth, "FALSE");
  assert.equal(ping.transcript.truth, "FALSE");
  notebook = await saveProbe(runtime, notebook, tcp.transcript);
  notebook = await saveProbe(runtime, notebook, ping.transcript);
  const interfaceObservation = runRuntimeObservation(runtime, "client1", "linux.ip_addr");
  assert.equal(interfaceObservation.ok, true);
  notebook = await saveObservation(runtime, notebook, interfaceObservation.transcript);
  const partial = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(partial.summary.completion, "FALSE");
  assert.equal((await buildGuidedTroubleshootingWorkflow(runtime, notebook)).workflow.phase, "CONTINUE_INVESTIGATION");
  notebook = await addHypothesis(runtime, notebook, "Efter tjänstekontrollen kvarstår ett separat gatewayfel.");
  const gateway = await applyAction(runtime, notebook, { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.5.1" } });
  runtime = gateway.workspace; notebook = gateway.notebook;
  const finalTcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  const finalPing = probe(runtime, "linux.ping");
  assert.equal(finalTcp.transcript.truth, "TRUE");
  assert.equal(finalPing.transcript.truth, "TRUE");
  notebook = await saveProbe(runtime, notebook, finalTcp.transcript);
  notebook = await saveProbe(runtime, notebook, finalPing.transcript);
  const complete = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(complete.summary.completion, "TRUE");
  assert.equal(complete.summary.actions.length, 2);
  assert.equal(complete.summary.verifications.length, 2);
  assert.equal(complete.summary.actions[0].target, "server1");
  assert.equal(complete.summary.actions[1].target, "client1");
  assert.match(complete.summary.markdown, /Enable or disable service/);
  assert.match(complete.summary.markdown, /Change default gateway/);
  assert.match(complete.summary.markdown, /FALSE → TRUE/);
  assert.ok(complete.summary.evidence.length > 8);
  assert.match(complete.summary.markdown, /ip route show/);
  assert.match(complete.summary.markdown, /nc -vz server1 22/);
  assert.equal((await buildGuidedTroubleshootingWorkflow(runtime, notebook)).workflow.phase, "VERIFICATION_COMPLETE");
});

await check("completion alone cannot replace the final current ICMP probe", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  notebook = await addHypothesis(runtime, notebook, "Gatewayen behöver korrigeras.");
  const gateway = await applyAction(runtime, notebook, { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.5.1" } });
  runtime = gateway.workspace; notebook = gateway.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  notebook = await addHypothesis(runtime, notebook, "SSH behöver aktiveras.");
  const ssh = await applyAction(runtime, notebook, { actionId: "set_service_enabled", targetId: "server1", parameters: { service: "ssh", enabled: true } });
  runtime = ssh.workspace; notebook = ssh.notebook;
  const finalTcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  assert.equal(finalTcp.transcript.truth, "TRUE");
  notebook = await saveProbe(runtime, notebook, finalTcp.transcript);
  assert.equal(runtime.evaluation.completion.truth, "TRUE");
  const incomplete = await buildGuidedTroubleshootingWorkflow(runtime, notebook);
  assert.notEqual(incomplete.workflow.phase, "VERIFICATION_COMPLETE");
  const next = await buildNextBestCheck(runtime, notebook);
  assert.equal(next.nextCheck.title, "Verifiera återstående funktion");
  assert.equal(next.nextCheck.preparation.probeId, "linux.ping");
  assert.equal(next.nextCheck.preparation.destinationId, "server1");
  const partialSummary = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(partialSummary.summary.fullRecoveryVerified, false);
  assert.equal(partialSummary.summary.finalVerification.missing.length, 1);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  const complete = await buildGuidedTroubleshootingWorkflow(runtime, notebook);
  assert.equal(complete.workflow.phase, "VERIFICATION_COMPLETE");
  const finalSummary = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(finalSummary.summary.fullRecoveryVerified, true);
  assert.equal(finalSummary.summary.finalVerification.missing.length, 0);
});

await check("an irrelevant remediation is not reported as an improvement", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  notebook = await addHypothesis(runtime, notebook, "DNS kan påverka klienten, men detta måste verifieras.");
  const irrelevant = await applyAction(runtime, notebook, { actionId: "change_dns_servers", targetId: "client1", parameters: { servers: ["10.78.5.53"] } });
  runtime = irrelevant.workspace; notebook = irrelevant.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  const summary = await buildTroubleshootingSummary(runtime, notebook);
  assert.equal(summary.summary.status, "NO_VERIFIED_IMPROVEMENT");
  assert.equal(summary.summary.completion, "FALSE");
});

await check("checkpoint restore invalidates the full layered recovery", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  const checkpoint = createRuntimeCheckpoint(runtime, "Layered incident baseline");
  assert.equal(checkpoint.ok, true);
  runtime = checkpoint.workspace;
  notebook = await addHypothesis(runtime, notebook, "Gatewayen behöver korrigeras först.");
  const gateway = await applyAction(runtime, notebook, { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.5.1" } });
  runtime = gateway.workspace; notebook = gateway.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  notebook = await addHypothesis(runtime, notebook, "SSH-tjänsten behöver också verifieras.");
  const ssh = await applyAction(runtime, notebook, { actionId: "set_service_enabled", targetId: "server1", parameters: { service: "ssh", enabled: true } });
  runtime = ssh.workspace; notebook = ssh.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  assert.equal((await buildTroubleshootingSummary(runtime, notebook)).summary.completion, "TRUE");
  const restored = restoreRuntimeCheckpoint(runtime, checkpoint.workspace.history.checkpoints[0].id);
  assert.equal(restored.ok, true);
  assert.equal(restored.workspace.engineState.stateRevision, 0);
  assert.equal((await buildTroubleshootingSummary(restored.workspace, notebook)).summary.completion, "FALSE");
});

await check("undoing both repairs returns the real broken matrix", async () => {
  let runtime = freshRuntime();
  let notebook = await collectBaseline(runtime);
  notebook = await addHypothesis(runtime, notebook, "Gatewayen behöver korrigeras.");
  const gateway = await applyAction(runtime, notebook, { actionId: "change_default_gateway", targetId: "client1", parameters: { gateway: "10.78.5.1" } });
  runtime = gateway.workspace; notebook = gateway.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  notebook = await addHypothesis(runtime, notebook, "Nu återstår SSH-tjänsten.");
  const ssh = await applyAction(runtime, notebook, { actionId: "set_service_enabled", targetId: "server1", parameters: { service: "ssh", enabled: true } });
  runtime = ssh.workspace; notebook = ssh.notebook;
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.nc_tcp", { port: 22 }).transcript);
  notebook = await saveProbe(runtime, notebook, probe(runtime, "linux.ping").transcript);
  assert.equal((await buildTroubleshootingSummary(runtime, notebook)).summary.completion, "TRUE");
  runtime = undoRuntime(runtime).workspace;
  assert.equal(runtime.engineState.stateRevision, 1);
  assert.equal((await buildTroubleshootingSummary(runtime, notebook)).summary.completion, "FALSE");
  runtime = undoRuntime(runtime).workspace;
  assert.equal(runtime.engineState.stateRevision, 0);
  assert.equal(runtime.engineState.resources.client1.properties.defaultGateway, "10.78.5.254");
  assert.equal(runtime.engineState.resources.server1.properties.ssh.enabled, false);
  const ping = probe(runtime, "linux.ping");
  const tcp = probe(runtime, "linux.nc_tcp", { port: 22 });
  assert.equal(ping.transcript.truth, "FALSE");
  assert.equal(tcp.transcript.truth, "FALSE");
});

console.log(`PASS PROJECT-085 layered incident logic: ${checks}/7 assertions.`);
