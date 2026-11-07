import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-browser-test/package-io/src/index.js";
import { buildBuilderPackageExport, compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: "0.8.0" } };
const manifestValidator = () => ({ valid: true });
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

function certifiedLayout(model) {
  return {
    formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId: model.scenarioId, engine: "elk.layered",
    nodes: [
      ...model.zones.map((zone, i) => ({ id: zone.id, x: i * 700, y: 0, width: 660, height: 500, ...(zone.parent ? { parent: zone.parent } : {}) })),
      ...model.resources.map((resource, i) => ({ id: resource.id, x: 40 + (i % 2) * 220, y: 80 + Math.floor(i / 2) * 140, width: 180, height: 90, ...(resource.zone ? { parent: resource.zone } : {}) })),
    ],
  };
}

const io = new SafePackageIO(new MemoryArchiveBackend(), manifestValidator);
let idle = createBuilderWorkspace(source);
let result = await buildBuilderPackageExport(idle, { packageIO: io, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "uncompiled Builder cannot export package");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_COMPILE_REQUIRED"), "compile requirement named");

let ws = await compileBuilderWorkspace(idle, options);
if (ws.compile.status !== "valid") process.exit(1);
result = await buildBuilderPackageExport(ws, { packageIO: io, distribution: "student", scenarioExtension: "../bad" });
eq(result.ok, false, "unsafe extension rejected");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_EXTENSION_INVALID"), "extension failure named");

result = await buildBuilderPackageExport(ws, { packageIO: io, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "verified export requires a layout");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "BROWSER_PACKAGE_CERT_LAYOUT_REQUIRED"), "missing certification layout named");

const completeLayout = certifiedLayout(ws.compile.model);
ws = { ...ws, layout: { ...completeLayout, nodes: completeLayout.nodes.slice(1) } };
result = await buildBuilderPackageExport(ws, { packageIO: io, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "incomplete stale layout rejected by certification");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_LAYOUT_NODE_MISSING"), "missing semantic layout node named by certification");

ws = { ...ws, layout: { ...completeLayout, nodes: [...completeLayout.nodes, { id: "ghost", x: 0, y: 0, width: 10, height: 10 }] } };
result = await buildBuilderPackageExport(ws, { packageIO: io, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "orphan layout node rejected by certification");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_LAYOUT_UNKNOWN_NODE"), "orphan layout diagnostic named by certification");

ws = { ...ws, layout: completeLayout };
const brokenModel = structuredClone(ws.compile.model);
brokenModel.canonicalSolution.operations[0].value = "allow";
const brokenWs = { ...ws, compile: { ...ws.compile, model: brokenModel } };
result = await buildBuilderPackageExport(brokenWs, { packageIO: io, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "broken canonical solution blocks export");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_REGRESSION_FAILED"), "canonical regression failure named before packaging");

const writeFailIO = { async write() { throw new Error("write exploded"); }, async read() { throw new Error("not reached"); } };
result = await buildBuilderPackageExport(ws, { packageIO: writeFailIO, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "backend write exception blocks export");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_PACKAGE_WRITE_FAILED"), "write failure normalized by certification boundary");

const model = ws.compile.model;
const { canonicalSolution: _solution, ...scenarioWithoutSolution } = model;
const mismatchReadIO = {
  async write() { return new Blob(["x"]); },
  async read() { return { manifest: { distribution: "author" }, scenario: scenarioWithoutSolution, files: new Map(), layout: completeLayout }; },
};
result = await buildBuilderPackageExport(ws, { packageIO: mismatchReadIO, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "readback distribution mismatch blocks delivery");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_PACKAGE_DISTRIBUTION_MISMATCH"), "distribution certification diagnostic named");

const leakIO = {
  async write() { return new Blob(["x"]); },
  async read() { return { manifest: { distribution: "student" }, scenario: scenarioWithoutSolution, files: new Map(), solution: { operations: [] }, layout: completeLayout }; },
};
result = await buildBuilderPackageExport(ws, { packageIO: leakIO, distribution: "student", scenarioExtension: ".yadilab" });
eq(result.ok, false, "student solution leak detected during certification readback");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_STUDENT_SOLUTION_LEAK"), "solution leak certification diagnostic named");

const authorMissingIO = {
  async write() { return new Blob(["x"]); },
  async read() { return { manifest: { distribution: "author" }, scenario: scenarioWithoutSolution, files: new Map(), layout: completeLayout }; },
};
result = await buildBuilderPackageExport(ws, { packageIO: authorMissingIO, distribution: "author", scenarioExtension: ".yadilab" });
eq(result.ok, false, "author solution loss detected during certification readback");
if (result.ok) process.exit(1);
ok(result.diagnostics.some((x) => x.code === "CERT_AUTHOR_SOLUTION_MISSING"), "author solution certification diagnostic named");

console.log(`PASS browser package-export adversarial suite: ${checks} assertions.`);
