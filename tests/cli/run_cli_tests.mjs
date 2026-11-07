import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { executeCli, inspectDocument, createFoundationCliServices } from "../../dist-cli-test/cli/src/index.js";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-cli-test/package-io/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", rel), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const catalog = { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets };
const schemaPass = () => ({ valid: true, diagnostics: [] });
const context = { validateSource: schemaPass, validateNormalized: schemaPass, catalog, engineBaselineVersion: "0.2.0" };
const services = createFoundationCliServices({ compilerContext: context });
const packageBackend = new MemoryArchiveBackend();
const packageIO = new SafePackageIO(packageBackend, () => ({ valid: true, diagnostics: [] }));
const packageServices = createFoundationCliServices({
  compilerContext: context,
  packageRuntime: { packageIO, validateNormalized: schemaPass, validateLayout: schemaPass },
});

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

function memoryIo(initial = {}) {
  const files = new Map(Object.entries(initial));
  const stdout = [];
  const stderr = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    files, stdout, stderr,
    io: {
      async readText(p) {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
        const value = files.get(p);
        return value instanceof Uint8Array ? decoder.decode(value) : value;
      },
      async writeText(p, content) { files.set(p, content); },
      async readBytes(p) {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
        const value = files.get(p);
        return value instanceof Uint8Array ? new Uint8Array(value) : encoder.encode(value);
      },
      async writeBytes(p, content) { files.set(p, new Uint8Array(content)); },
      stdout(text) { stdout.push(text); },
      stderr(text) { stderr.push(text); },
    },
  };
}

const source = fixture("valid/scenario-source.json");
const normalized = fixture("valid/scenario-normalized.json");
const manifest = fixture("valid/package-manifest.json");

// Help and strict argument parsing.
{
  const m = memoryIo();
  const r = await executeCli(["help"], m.io, services);
  eq(r.exitCode, 0, "help exits zero");
  ok(m.stdout[0].includes("app validate"), "help prints usage");
}
{
  const m = memoryIo();
  const r = await executeCli(["bogus"], m.io, services);
  eq(r.exitCode, 2, "unknown command is usage error");
  ok(m.stderr.some((line) => line.includes("Unknown command")), "unknown command explained");
}
{
  const m = memoryIo();
  const r = await executeCli(["compile"], m.io, services);
  eq(r.exitCode, 2, "missing input is usage error");
  ok(m.stderr.some((line) => line.includes("requires --input")), "missing input explained");
}
{
  const m = memoryIo({ "bad.json": "{not-json" });
  const r = await executeCli(["inspect", "--input", "bad.json"], m.io, services);
  eq(r.exitCode, 2, "invalid JSON is IO/input error");
  ok(m.stderr.some((line) => line.includes("Invalid JSON")), "invalid JSON explained");
}

// validate delegates to the authoritative injected source validator.
{
  const m = memoryIo({ "source.json": JSON.stringify(source) });
  const r = await executeCli(["validate", "--input", "source.json"], m.io, services);
  eq(r.exitCode, 0, "valid source exits zero");
  eq(JSON.parse(m.stdout[0]).valid, true, "validation result emitted");
}
{
  const rejecting = {
    ...services,
    validateSource: () => ({ valid: false, diagnostics: [{ severity: "error", code: "SCHEMA_TEST", path: "$", message: "synthetic rejection" }] }),
  };
  const m = memoryIo({ "source.json": JSON.stringify(source) });
  const r = await executeCli(["validate", "--input", "source.json", "--output", "validation.json"], m.io, rejecting);
  eq(r.exitCode, 1, "schema rejection exits one");
  eq(JSON.parse(m.files.get("validation.json")).valid, false, "validation report written to output");
}

// compile is actual Phase 2 compiler integration, not a CLI mock.
{
  const m = memoryIo({ "source.json": JSON.stringify(source) });
  const r = await executeCli(["compile", "--input", "source.json", "--output", "scenario.json"], m.io, services);
  eq(r.exitCode, 0, "compile exits zero");
  const model = JSON.parse(m.files.get("scenario.json"));
  eq(model.formatId, "infrastructure-cyber-lab.scenario", "compile emits normalized scenario");
  eq(model.scenarioId, source.scenarioId, "compile preserves scenario id");
  ok(m.stdout.some((line) => line.includes('"ok": true')), "compile summary emitted when writing file");
}
{
  const invalid = fixture("invalid/compiler-unknown-resource.json");
  const m = memoryIo({ "source.json": JSON.stringify(invalid) });
  const r = await executeCli(["compile", "--input", "source.json"], m.io, services);
  eq(r.exitCode, 1, "semantic compiler failure exits one");
  ok(JSON.parse(m.stdout[0]).diagnostics.some((d) => d.code === "UNKNOWN_RESOURCE_REFERENCE"), "compiler diagnostic preserved");
}

// test accepts normalized input and source input. Source passes through compiler first.
{
  const m = memoryIo({ "scenario.json": JSON.stringify(normalized) });
  const r = await executeCli(["test", "--input", "scenario.json"], m.io, services);
  eq(r.exitCode, 0, "normalized regression exits zero");
  const report = JSON.parse(m.stdout[0]);
  eq(report.passed, true, "normalized regression passes");
  eq(report.solutionApplied, true, "canonical solution was replayed");
}
{
  const m = memoryIo({ "source.json": JSON.stringify(source) });
  const r = await executeCli(["test", "--input", "source.json", "--output", "report.json"], m.io, services);
  eq(r.exitCode, 0, "source compile+regression exits zero");
  const report = JSON.parse(m.files.get("report.json"));
  eq(report.passed, true, "compiled source regression passes");
  ok(report.checks.length > 0, "regression checks emitted");
}
{
  const broken = structuredClone(normalized);
  broken.canonicalSolution.operations[0].value = "allow";
  const m = memoryIo({ "scenario.json": JSON.stringify(broken) });
  const r = await executeCli(["test", "--input", "scenario.json"], m.io, services);
  eq(r.exitCode, 1, "ineffective canonical solution exits one");
  eq(JSON.parse(m.stdout[0]).passed, false, "failing regression report emitted");
}
{
  const invalid = fixture("invalid/compiler-unknown-resource.json");
  const m = memoryIo({ "source.json": JSON.stringify(invalid) });
  const r = await executeCli(["test", "--input", "source.json"], m.io, services);
  eq(r.exitCode, 1, "test source compiler failure exits one");
  eq(JSON.parse(m.stdout[0]).phase, "compile", "test reports compile phase failure");
}


{
  const future = structuredClone(normalized); future.schemaVersion = "0.2.0";
  const m = memoryIo({ "future.json": JSON.stringify(future) });
  const r = await executeCli(["test", "--input", "future.json"], m.io, services);
  eq(r.exitCode, 1, "normalized future schema test is blocked before Engine regression");
  ok(JSON.parse(m.stdout[0]).diagnostics.some((d) => d.code === "SCHEMA_VERSION_UNSUPPORTED"), "normalized test version diagnostic named");
}


// render uses the real normalized model + explicit layout and writes deterministic local SVG.
{
  const renderLayout = {
    formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId: normalized.scenarioId, engine: "fixture",
    nodes: [
      ...normalized.zones.map((z, i) => ({ id: z.id, x: i * 760, y: 0, width: 720, height: 520, ...(z.parent ? { parent: z.parent } : {}) })),
      ...normalized.resources.map((x, i) => ({ id: x.id, x: 40 + (i % 2) * 230, y: 70 + Math.floor(i / 2) * 150, width: 180, height: 96, ...(x.zone ? { parent: x.zone } : {}) })),
    ],
  };
  const m = memoryIo({ "scenario.json": JSON.stringify(normalized), "layout.json": JSON.stringify(renderLayout) });
  const r = await executeCli(["render", "--input", "scenario.json", "--layout", "layout.json", "--output", "preview.svg"], m.io, services);
  eq(r.exitCode, 0, "headless render exits zero");
  ok(m.files.get("preview.svg").startsWith('<?xml version="1.0"'), "render writes SVG bytes");
  ok(m.files.get("preview.svg").includes('data-id="firewall01"'), "rendered preview contains semantic resource");
  ok(!m.files.get("preview.svg").includes("<script"), "rendered preview contains no script");
}

// inspect is side-effect free and summarizes the three supported contracts.
{
  const s = inspectDocument(source);
  eq(s.kind, "source", "source recognized");
  eq(s.resourceCount, source.resources.length, "source resource count");
  eq(s.hasCanonicalSolution, true, "source solution presence reported");
}
{
  const s = inspectDocument(normalized);
  eq(s.kind, "normalized", "normalized recognized");
  eq(s.capabilityCount, normalized.capabilityLocks.length, "normalized lock count");
}
{
  const s = inspectDocument(manifest);
  eq(s.kind, "package-manifest", "manifest recognized");
  eq(s.fileCount, manifest.files.length, "manifest file count");
}
{
  const m = memoryIo({ "manifest.json": JSON.stringify(manifest) });
  const r = await executeCli(["inspect", "--input", "manifest.json", "--output", "summary.json"], m.io, services);
  eq(r.exitCode, 0, "inspect writes summary");
  eq(JSON.parse(m.files.get("summary.json")).kind, "package-manifest", "inspect summary correct");
}


// migrate is explicit and deterministic. Current version is a validated no-op; unknown versions fail elsewhere.
{
  const m = memoryIo({ "source.json": JSON.stringify(source) });
  const r = await executeCli(["migrate", "--input", "source.json", "--output", "migrated.json"], m.io, services);
  eq(r.exitCode, 0, "current schema migrate exits zero");
  eq(JSON.parse(m.files.get("migrated.json")), source, "current schema migration preserves exact document semantics");
  const summary = JSON.parse(m.stdout[0]);
  eq(summary.changed, false, "current migration reports no synthetic change");
  eq(summary.path, ["0.1.0"], "migration summary records explicit path");
}
{
  const legacy = structuredClone(source); legacy.schemaVersion = "0.0.9";
  const m = memoryIo({ "legacy.json": JSON.stringify(legacy) });
  const r = await executeCli(["migrate", "--input", "legacy.json"], m.io, services);
  eq(r.exitCode, 1, "schema without registered migration path fails closed");
  ok(JSON.parse(m.stdout[0]).diagnostics.some((d) => d.code === "MIGRATION_PATH_UNAVAILABLE"), "missing migration path diagnostic emitted");
}


// Package-aware commands use the same SafePackageIO boundary; MemoryArchiveBackend exercises command semantics without claiming zip.js runtime execution.
{
  const renderLayout = {
    formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId: normalized.scenarioId, engine: "fixture",
    nodes: [
      ...normalized.zones.map((z, i) => ({ id: z.id, x: i * 760, y: 0, width: 720, height: 520, ...(z.parent ? { parent: z.parent } : {}) })),
      ...normalized.resources.map((x, i) => ({ id: x.id, x: 40 + (i % 2) * 230, y: 70 + Math.floor(i / 2) * 150, width: 180, height: 96, ...(x.zone ? { parent: x.zone } : {}) })),
    ],
  };
  const studentBlob = await packageIO.write(normalized, { distribution: "student", layout: renderLayout });
  const studentBytes = new Uint8Array(await studentBlob.arrayBuffer());
  const m = memoryIo({ "lab.yadilab": studentBytes });

  let r = await executeCli(["inspect", "--input", "lab.yadilab"], m.io, packageServices);
  eq(r.exitCode, 0, "package inspect exits zero");
  const packageSummary = JSON.parse(m.stdout.at(-1));
  eq(packageSummary.kind, "scenario-package", "package inspect identifies package");
  eq(packageSummary.distribution, "student", "package inspect reports student distribution");
  eq(packageSummary.hasLayout, true, "package inspect reports embedded layout");

  r = await executeCli(["test", "--input", "lab.yadilab"], m.io, packageServices);
  eq(r.exitCode, 0, "student package initial-state test exits zero");
  const studentReport = JSON.parse(m.stdout.at(-1));
  eq(studentReport.mode, "student-initial-state", "student package test does not pretend canonical solution exists");
  eq(studentReport.passed, true, "student package initial assertions pass");

  r = await executeCli(["render", "--input", "lab.yadilab", "--output", "package-preview.svg"], m.io, packageServices);
  eq(r.exitCode, 0, "package render uses embedded layout");
  ok(m.files.get("package-preview.svg").includes('data-id="firewall01"'), "package render output contains semantic resource");

  r = await executeCli(["unpack", "--input", "lab.yadilab", "--output", "out"], m.io, packageServices);
  eq(r.exitCode, 0, "safe package unpack exits zero");
  ok(m.files.get("out/manifest.json") instanceof Uint8Array, "unpack preserves raw manifest bytes");
  ok(m.files.get("out/scenario.json") instanceof Uint8Array, "unpack writes scenario bytes");
  ok(m.files.get("out/layout.json") instanceof Uint8Array, "unpack writes layout bytes");

  r = await executeCli(["migrate", "--input", "lab.yadilab", "--output", "migrated.yadilab"], m.io, packageServices);
  eq(r.exitCode, 0, "current package migration exits zero");
  eq([...m.files.get("migrated.yadilab")], [...studentBytes], "current package migration is byte-identical no-op");
  eq(JSON.parse(m.stdout.at(-1)).byteIdentical, true, "package migration reports byte identity");
}
{
  const renderLayout = {
    formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId: normalized.scenarioId, engine: "fixture",
    nodes: [
      ...normalized.zones.map((z, i) => ({ id: z.id, x: i * 760, y: 0, width: 720, height: 520, ...(z.parent ? { parent: z.parent } : {}) })),
      ...normalized.resources.map((x, i) => ({ id: x.id, x: 40 + (i % 2) * 230, y: 70 + Math.floor(i / 2) * 150, width: 180, height: 96, ...(x.zone ? { parent: x.zone } : {}) })),
    ],
  };
  const authorBlob = await packageIO.write(normalized, { distribution: "author", layout: renderLayout });
  const authorBytes = new Uint8Array(await authorBlob.arrayBuffer());
  const m = memoryIo({ "author.yadilab": authorBytes });
  const r = await executeCli(["test", "--input", "author.yadilab"], m.io, packageServices);
  eq(r.exitCode, 0, "author package runs full regression");
  const report = JSON.parse(m.stdout.at(-1));
  eq(report.mode, "author-regression", "author package test mode explicit");
  eq(report.solutionApplied, true, "author package canonical solution replayed");
}

console.log(`PASS CLI suite: ${checks} assertions.`);
