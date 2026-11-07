import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-browser-test/package-io/src/index.js";
import { openRuntimePackage } from "../../dist-browser-test/ui/src/browser/index.js";
import { CapabilityPackRegistry } from "../../dist-browser-test/capability-packs/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseScenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
const baseLayout = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/layout.json"), "utf8"));
const manifestValidator = () => ({ valid: true });
const normalizedValidator = (input) => ({ valid: input?.formatId === "infrastructure-cyber-lab.scenario", diagnostics: ["normalized schema rejected"] });
const layoutValidator = (input) => ({ valid: input?.formatId === "infrastructure-cyber-lab.layout", diagnostics: ["layout schema rejected"] });
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

async function makePackage(scenario, options = {}) {
  const io = new SafePackageIO(new MemoryArchiveBackend(), manifestValidator);
  const blob = await io.write(scenario, { distribution: options.distribution ?? "student", ...(options.layout !== undefined ? { layout: options.layout } : {}) });
  return { io, blob };
}

let built = await makePackage(baseScenario, { distribution: "author", layout: baseLayout });
let result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "author package denied by default student runtime policy");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_AUTHOR_PACKAGE_NOT_ALLOWED"), "author denial is explicit");

const tooNew = structuredClone(baseScenario);
tooNew.minimumEngineVersion = "99.0.0";
built = await makePackage(tooNew, { layout: { ...baseLayout, scenarioId: tooNew.scenarioId } });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "future Engine requirement rejected");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_ENGINE_TOO_OLD"), "engine compatibility failure named");

const badScenario = structuredClone(baseScenario);
badScenario.formatId = "not-a-scenario";
built = await makePackage(badScenario, { layout: baseLayout });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "normalized schema rejection blocks Runtime");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_SCENARIO_SCHEMA_INVALID"), "normalized schema diagnostic surfaced");

built = await makePackage(baseScenario, { layout: { ...baseLayout, formatId: "bad-layout" } });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "layout schema rejection blocks Runtime");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_LAYOUT_SCHEMA_INVALID"), "layout schema diagnostic surfaced");

built = await makePackage(baseScenario, { layout: { ...baseLayout, scenarioId: "another_scenario" } });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "layout/scenario identity mismatch rejected");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_LAYOUT_SCENARIO_MISMATCH"), "layout mismatch diagnostic surfaced");

const emptyIO = new SafePackageIO(new MemoryArchiveBackend([]), manifestValidator);
result = await openRuntimePackage(new Blob(["missing"]), { packageIO: emptyIO, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "PackageIO safety/read failure remains fatal");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "PACKAGE_MANIFEST_MISSING"), "PackageIO diagnostic code preserved to browser boundary");

const rejectingLayout = () => ({ valid: false, diagnostics: ["deliberate layout rejection"] });
built = await makePackage(baseScenario, { layout: baseLayout });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: rejectingLayout });
eq(result.ok, false, "injected authoritative layout validator cannot be bypassed");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.message === "deliberate layout rejection"), "validator explanation preserved");


const networkOnlyRegistry = new CapabilityPackRegistry([{ id: "core.network", version: "1.0.0", execution: "engine" }]);
built = await makePackage(baseScenario, { layout: baseLayout });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator, capabilityRegistry: networkOnlyRegistry });
eq(result.ok, false, "Runtime refuses package when an exact required capability pack is not installed");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_CAPABILITY_PACK_UNAVAILABLE" && x.objectId === "core.windows"), "missing capability pack is named before play");

const wrongNetworkVersion = new CapabilityPackRegistry([
  { id: "core.network", version: "2.0.0", execution: "engine" },
  { id: "core.windows", version: "1.0.0", execution: "declarative" },
]);
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator, capabilityRegistry: wrongNetworkVersion });
eq(result.ok, false, "Runtime refuses package when only a different capability version is installed");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_CAPABILITY_PACK_VERSION_UNAVAILABLE" && x.objectId === "core.network"), "capability version mismatch is explicit before play");


const futureSchema = structuredClone(baseScenario);
futureSchema.schemaVersion = "0.2.0";
built = await makePackage(futureSchema, { layout: { ...baseLayout, scenarioId: futureSchema.scenarioId } });
result = await openRuntimePackage(built.blob, { packageIO: built.io, validateNormalized: normalizedValidator, validateLayout: layoutValidator });
eq(result.ok, false, "Runtime refuses structurally valid but unsupported future scenario schema");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_SCHEMA_VERSION_UNSUPPORTED"), "package schema version failure requires explicit migration");

console.log(`PASS browser package-session adversarial suite: ${checks} assertions.`);
