import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-browser-test/package-io/src/index.js";
import { openRuntimePackage, applyRuntimeOperation } from "../../dist-browser-test/ui/src/browser/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
const layout = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/layout.json"), "utf8"));
const enc = new TextEncoder();
const pngFixture = new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/media/safe.png")));
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

const manifestValidator = () => ({ valid: true });
const normalizedValidator = (input) => ({ valid: input?.formatId === "infrastructure-cyber-lab.scenario", diagnostics: ["normalized format invalid"] });
const layoutValidator = (input) => ({ valid: input?.formatId === "infrastructure-cyber-lab.layout", diagnostics: ["layout format invalid"] });

const backend = new MemoryArchiveBackend();
const io = new SafePackageIO(backend, manifestValidator);
const studentBlob = await io.write(scenario, {
  distribution: "student",
  layout,
  assets: [{ path: "assets/topology.png", mime: "image/png", bytes: pngFixture }],
  docs: [{ path: "docs/mission.md", mime: "text/markdown", bytes: enc.encode("# Mission\n") }],
});
const opened = await openRuntimePackage(studentBlob, { packageIO: io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
ok(opened.ok, "student package opens into runtime");
if (!opened.ok) process.exit(1);
eq(opened.workspace.mode, "runtime", "package starts Runtime mode directly");
eq(opened.workspace.scenario.scenarioId, scenario.scenarioId, "runtime scenario comes from package");
eq(opened.workspace.engineState.stateRevision, 0, "runtime package starts at engine revision zero");
eq(opened.workspace.layout?.scenarioId, scenario.scenarioId, "validated package layout attached to runtime");
eq(opened.packageInfo.distribution, "student", "student distribution retained");
eq(opened.packageInfo.authorSolutionPresent, false, "student runtime reports no author solution");
eq(opened.packageInfo.capabilityPacks.map(({ id, version }) => ({ id, version })), scenario.capabilityLocks, "Runtime exposes exact resolved capability packs in lock order");
ok(opened.packageInfo.capabilityPacks.every((x) => x.execution === "engine" || x.execution === "declarative"), "resolved capability packs use trusted execution modes");
eq(opened.packageInfo.assets, [{ path: "assets/topology.png", mime: "image/png", size: pngFixture.byteLength }], "asset metadata exposed without semantic mutation");
eq(opened.packageInfo.docs, [{ path: "docs/mission.md", mime: "text/markdown", size: 10 }], "doc metadata exposed without executing content");
ok(!Object.hasOwn(opened.workspace.scenario, "canonicalSolution"), "canonical solution stripped from runtime scenario");
eq(opened.workspace.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "TRUE", "initial Engine evaluation runs after package open");

const op = applyRuntimeOperation(opened.workspace, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(op.ok, "package-opened runtime accepts normal deterministic Engine operation");
if (!op.ok) process.exit(1);
eq(op.workspace.engineState.stateRevision, 1, "operation increments packaged runtime state revision");
eq(op.workspace.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "FALSE", "package runtime reevaluates after remediation");

const authorBlob = await io.write(scenario, { distribution: "author", layout });
const authorOpened = await openRuntimePackage(authorBlob, { packageIO: io, validateNormalized: normalizedValidator, validateLayout: layoutValidator, allowAuthorPackage: true });
ok(authorOpened.ok, "explicit instructor authorization can open author package");
if (!authorOpened.ok) process.exit(1);
eq(authorOpened.packageInfo.distribution, "author", "author package identity retained");
eq(authorOpened.packageInfo.authorSolutionPresent, true, "author package solution presence reported explicitly");
ok(!Object.hasOwn(authorOpened.workspace.scenario, "canonicalSolution"), "author solution never injected into Runtime scenario state");

console.log(`PASS browser package-session suite: ${checks} assertions.`);
