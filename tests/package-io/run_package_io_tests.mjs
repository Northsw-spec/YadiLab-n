import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PACKAGE_LIMITS,
  MemoryArchiveBackend,
  SafePackageIO,
  decodeJson,
  validatePackagePath,
} from "../../dist-packageio-test/package-io/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

function manifestValidator(value) {
  const valid = value && typeof value === "object" && !Array.isArray(value)
    && value.formatId === "infrastructure-cyber-lab.package"
    && (value.distribution === "author" || value.distribution === "student")
    && value.entrypoint === "scenario.json"
    && value.integrityAlgorithm === "sha256"
    && Array.isArray(value.files);
  return { valid: Boolean(valid), diagnostics: valid ? [] : ["shape rejection"] };
}

validatePackagePath("scenario.json");
validatePackagePath("assets/icon.png");
validatePackagePath("docs/readme.md");
checks += 3;

const backend = new MemoryArchiveBackend();
const io = new SafePackageIO(backend, manifestValidator);
const assetBytes = new Uint8Array(fs.readFileSync(path.join(root, "tests/fixtures/media/safe.png")));
const docBytes = new TextEncoder().encode("# Offline documentation\n");
const layout = { formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId: scenario.scenarioId, nodes: [] };

const studentBlob = await io.write(scenario, {
  distribution: "student",
  layout,
  assets: [{ path: "assets/icon.png", bytes: assetBytes, mime: "image/png" }],
  docs: [{ path: "docs/readme.md", bytes: docBytes, mime: "text/markdown" }],
});
const student = await io.read(studentBlob, DEFAULT_PACKAGE_LIMITS);
eq(student.manifest.distribution, "student", "student manifest distribution");
eq(student.manifest.scenarioId, scenario.scenarioId, "scenario ID round-trip");
eq(student.manifest.scenarioHash, scenario.sourceHash, "scenario hash round-trip");
eq(student.manifest.capabilityLocks, scenario.capabilityLocks, "capability locks round-trip");
eq(student.manifest.profileLocks, scenario.profileLocks, "profile locks round-trip");
ok(!student.files.has("solution.json"), "student package strips solution.json");
ok(!Object.hasOwn(student.scenario, "canonicalSolution"), "student scenario strips embedded canonical solution");
eq(student.layout, layout, "layout round-trip");
eq([...student.files.keys()].sort(), ["assets/icon.png", "docs/readme.md", "layout.json", "scenario.json"], "student file set is exact");
eq(student.files.get("assets/icon.png")?.bytes, assetBytes, "asset bytes round-trip");
eq(new TextDecoder().decode(student.files.get("docs/readme.md")?.bytes), "# Offline documentation\n", "doc bytes round-trip");
ok(student.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), "all manifest hashes are SHA-256 hex");

const safeSvgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#334155"/><path d="M16 32 L48 32" stroke="#fff" stroke-width="4"/></svg>';
const safeSvgBytes = new TextEncoder().encode(safeSvgText);
const svgBlob = await io.write(scenario, { distribution: "student", assets: [{ path: "assets/custom.svg", bytes: safeSvgBytes, mime: "image/svg+xml" }] });
const svgRead = await io.read(svgBlob, DEFAULT_PACKAGE_LIMITS);
eq(new TextDecoder().decode(svgRead.files.get("assets/custom.svg")?.bytes), safeSvgText, "strict-passive custom SVG round-trips byte-identically after sanitizer gate");
eq(svgRead.files.get("assets/custom.svg")?.mime, "image/svg+xml", "custom SVG MIME retained after sanitizer gate");

const authorBlob = await io.write(scenario, { distribution: "author" });
const author = await io.read(authorBlob, DEFAULT_PACKAGE_LIMITS);
eq(author.manifest.distribution, "author", "author distribution");
ok(author.files.has("solution.json"), "author package contains solution.json");
eq(author.solution, scenario.canonicalSolution, "author solution round-trip");
ok(!Object.hasOwn(author.scenario, "canonicalSolution"), "author scenario keeps solution separated");

// Manifest is written first and never hashes itself.
const session = await backend.open(authorBlob);
try {
  eq(session.entries[0]?.path, "manifest.json", "manifest is first archive entry");
  const manifest = decodeJson(await session.entries[0].read(), "manifest.json");
  ok(!manifest.files.some((f) => f.path === "manifest.json"), "manifest does not self-reference");
} finally {
  await session.close();
}

// Repeated writes produce semantically identical manifests/files with the deterministic memory backend.
const authorBlob2 = await io.write(scenario, { distribution: "author" });
const a1 = await io.read(authorBlob, DEFAULT_PACKAGE_LIMITS);
const a2 = await io.read(authorBlob2, DEFAULT_PACKAGE_LIMITS);
eq(a2.manifest, a1.manifest, "repeated package manifests are deterministic");
eq([...a2.files].map(([p, f]) => [p, [...f.bytes]]), [...a1.files].map(([p, f]) => [p, [...f.bytes]]), "repeated package semantic bytes are deterministic");

console.log(`PASS PackageIO suite: ${checks} assertions.`);
