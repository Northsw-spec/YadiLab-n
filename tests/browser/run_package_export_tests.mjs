import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO, DEFAULT_PACKAGE_LIMITS } from "../../dist-browser-test/package-io/src/index.js";
import { buildBuilderPackageExport, compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const compilerOptions = {
  compilerContext: {
    validateSource: schemaPass,
    validateNormalized: schemaPass,
    catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets },
    engineBaselineVersion: "0.8.0",
  },
};
const manifestValidator = () => ({ valid: true });
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

function certifiedLayout(model) {
  return {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: "0.1.0",
    scenarioId: model.scenarioId,
    engine: "elk.layered",
    nodes: [
      ...model.zones.map((zone, index) => ({ id: zone.id, x: index * 700, y: 0, width: 660, height: 500, ...(zone.parent ? { parent: zone.parent } : {}) })),
      ...model.resources.map((resource, index) => ({ id: resource.id, x: 40 + (index % 2) * 220, y: 80 + Math.floor(index / 2) * 140, width: 180, height: 90, ...(resource.zone ? { parent: resource.zone } : {}) })),
    ],
  };
}

let workspace = createBuilderWorkspace(source);
workspace = await compileBuilderWorkspace(workspace, compilerOptions);
eq(workspace.compile.status, "valid", "Builder is compiled before package export");
if (workspace.compile.status !== "valid") process.exit(1);
workspace = { ...workspace, layout: certifiedLayout(workspace.compile.model) };
const originalWorkspace = JSON.stringify(workspace);
const io = new SafePackageIO(new MemoryArchiveBackend(), manifestValidator);

const student = await buildBuilderPackageExport(workspace, {
  packageIO: io,
  distribution: "student",
  scenarioExtension: ".yadilab",
  packageVersion: "0.1.0",
});
ok(student.ok, "student package export succeeds only after full certification");
if (!student.ok) process.exit(1);
eq(student.descriptor.filename, `${workspace.compile.model.scenarioId}.yadilab`, "filename uses central extension supplied by caller");
eq(student.descriptor.mime, "application/zip", "package download MIME is application/zip");
eq(student.descriptor.distribution, "student", "student distribution recorded");
eq(student.descriptor.selfVerified, true, "export is fully certified before delivery");
eq(student.descriptor.certification.passed, true, "certification certificate records PASS");
eq(student.descriptor.certification.gates.length, 5, "certificate carries all five certification gates");
eq(student.descriptor.scenarioHash, workspace.compile.model.sourceHash, "download descriptor carries source hash");
ok(student.descriptor.blob.size > 0, "package blob is non-empty");
const studentRead = await io.read(student.descriptor.blob, DEFAULT_PACKAGE_LIMITS);
eq(studentRead.manifest.distribution, "student", "readback manifest is student");
eq(studentRead.scenario.scenarioId, workspace.compile.model.scenarioId, "readback scenario identity preserved");
eq(studentRead.layout?.scenarioId, workspace.compile.model.scenarioId, "Builder layout included in package");
eq(studentRead.solution, undefined, "student package contains no canonical solution");

const author = await buildBuilderPackageExport(workspace, {
  packageIO: io,
  distribution: "author",
  scenarioExtension: ".yadilab",
});
ok(author.ok, "author package export succeeds after full certification");
if (!author.ok) process.exit(1);
eq(author.descriptor.certification.passed, true, "author export carries certification certificate");
const authorRead = await io.read(author.descriptor.blob, DEFAULT_PACKAGE_LIMITS);
eq(authorRead.manifest.distribution, "author", "author distribution retained");
ok(authorRead.solution !== undefined, "author build retains canonical solution when compiled model has one");
ok(!Object.hasOwn(authorRead.scenario, "canonicalSolution"), "scenario.json never embeds canonical solution");
eq(JSON.stringify(workspace), originalWorkspace, "package certification/export does not mutate Builder workspace");

console.log(`PASS browser package-export suite: ${checks} assertions.`);
