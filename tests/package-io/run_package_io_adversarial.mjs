import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PACKAGE_LIMITS,
  MemoryArchiveBackend,
  PackageIOError,
  SafePackageIO,
  encodeJson,
  sha256Hex,
  validateMimeForPath,
  validatePackagePath,
} from "../../dist-packageio-test/package-io/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const base = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }
async function rejectsCode(fn, code, message) {
  try { await fn(); }
  catch (error) {
    ok(error instanceof PackageIOError, `${message}: PackageIOError`);
    eq(error.code, code, `${message}: code`);
    return;
  }
  assert.fail(`${message}: expected rejection`);
}
function manifestValidator(value) {
  const valid = value && typeof value === "object" && value.formatId === "infrastructure-cyber-lab.package" && Array.isArray(value.files);
  return { valid: Boolean(valid), diagnostics: valid ? [] : ["bad manifest"] };
}

for (const [bad, code] of [
  ["../evil.json", "PACKAGE_PATH_TRAVERSAL"],
  ["/evil.json", "PACKAGE_PATH_ABSOLUTE"],
  ["C:/evil.json", "PACKAGE_PATH_ABSOLUTE"],
  ["assets\\evil.png", "PACKAGE_PATH_BACKSLASH"],
  ["assets/%2e%2e/evil.png", "PACKAGE_PATH_ENCODED_TRAVERSAL"],
  ["random.bin", "PACKAGE_PATH_ROOT_NOT_ALLOWED"],
]) {
  try { validatePackagePath(bad); assert.fail(`expected ${bad} rejection`); }
  catch (error) { ok(error instanceof PackageIOError, `${bad} error type`); eq(error.code, code, `${bad} code`); }
}

validateMimeForPath("assets/a.svg", "image/svg+xml"); checks += 1;
for (const [p, mime, code] of [
  ["assets/a.png", "text/plain", "PACKAGE_MIME_NOT_ALLOWED"],
  ["docs/a.png", "image/png", "PACKAGE_DOC_MIME_INVALID"],
]) {
  try { validateMimeForPath(p, mime); assert.fail(`expected MIME rejection ${p}`); }
  catch (error) { ok(error instanceof PackageIOError, `${p} MIME error type`); eq(error.code, code, `${p} MIME code`); }
}

const scenario = structuredClone(base);
delete scenario.canonicalSolution;
const scenarioBytes = encodeJson(scenario);

async function manifestFor(files, distribution = "student", overrides = {}) {
  const entries = [];
  for (const file of files) entries.push({ path: file.path, size: file.bytes.byteLength, sha256: await sha256Hex(file.bytes), mime: file.mime });
  return {
    formatId: "infrastructure-cyber-lab.package", packageVersion: "0.1.0", distribution,
    scenarioId: scenario.scenarioId, scenarioHash: scenario.sourceHash, schemaVersion: scenario.schemaVersion,
    minimumEngineVersion: scenario.minimumEngineVersion, entrypoint: "scenario.json", integrityAlgorithm: "sha256",
    capabilityLocks: scenario.capabilityLocks, profileLocks: scenario.profileLocks, assetLocks: scenario.assetLocks.map((x) => ({ id: x.id, version: x.version })), files: entries, ...overrides,
  };
}

async function recordsFor(files, distribution = "student", overrides = {}) {
  const manifest = await manifestFor(files, distribution, overrides);
  return [{ path: "manifest.json", bytes: encodeJson(manifest) }, ...files.map((f) => ({ path: f.path, bytes: f.bytes }))];
}

const goodFiles = [{ path: "scenario.json", bytes: scenarioBytes, mime: "application/json" }];

await rejectsCode(async () => {
  const io = new SafePackageIO(new MemoryArchiveBackend([{ path: "scenario.json", bytes: scenarioBytes }]), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_MANIFEST_MISSING", "missing manifest");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  const io = new SafePackageIO(new MemoryArchiveBackend(records), () => ({ valid: false, diagnostics: ["synthetic"] }));
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_MANIFEST_SCHEMA_INVALID", "manifest schema rejection");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  records.push({ path: "docs/unlisted.md", bytes: new TextEncoder().encode("x") });
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_FILE_SET_MISMATCH", "unlisted archive file");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  const manifest = JSON.parse(new TextDecoder().decode(records[0].bytes));
  manifest.files[0].sha256 = "0".repeat(64);
  records[0] = { path: "manifest.json", bytes: encodeJson(manifest) };
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_FILE_HASH_MISMATCH", "hash mismatch");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  const manifest = JSON.parse(new TextDecoder().decode(records[0].bytes));
  manifest.files[0].size += 1;
  records[0] = { path: "manifest.json", bytes: encodeJson(manifest) };
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_FILE_SIZE_MISMATCH", "size mismatch");

await rejectsCode(async () => {
  const solution = { operations: [{ op: "set", target: "x", path: "properties.x", value: true }] };
  const files = [...goodFiles, { path: "solution.json", bytes: encodeJson(solution), mime: "application/json" }];
  const records = await recordsFor(files, "student");
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_STUDENT_SOLUTION_FORBIDDEN", "student solution leak");

await rejectsCode(async () => {
  const embedded = structuredClone(scenario); embedded.canonicalSolution = base.canonicalSolution;
  const files = [{ path: "scenario.json", bytes: encodeJson(embedded), mime: "application/json" }];
  const records = await recordsFor(files, "author");
  // Cross-ref hash must match embedded scenario for this test to reach embedded-solution gate.
  const manifest = JSON.parse(new TextDecoder().decode(records[0].bytes));
  manifest.scenarioHash = embedded.sourceHash;
  records[0] = { path: "manifest.json", bytes: encodeJson(manifest) };
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_EMBEDDED_SOLUTION_FORBIDDEN", "embedded solution forbidden");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles, "student", { scenarioId: "other" });
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_SCENARIO_ID_MISMATCH", "manifest scenario ID mismatch");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  // Force a cross-platform case collision using otherwise allowed paths.
  records.push({ path: "assets/icon.png", bytes: new Uint8Array([1]) });
  records.push({ path: "assets/Icon.png", bytes: new Uint8Array([2]) });
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_CASE_COLLISION", "case-collision rejection");

await rejectsCode(async () => {
  const records = [{ path: "manifest.json", bytes: new Uint8Array([1]), compressedSize: 1, uncompressedSize: 1000 }];
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), { ...DEFAULT_PACKAGE_LIMITS, maxCompressionRatio: 10 });
}, "PACKAGE_COMPRESSION_RATIO_LIMIT", "compression ratio limit");

await rejectsCode(async () => {
  const records = await recordsFor(goodFiles);
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["this input is larger than five bytes"]), { ...DEFAULT_PACKAGE_LIMITS, maxCompressedBytes: 5 });
}, "PACKAGE_COMPRESSED_SIZE_LIMIT", "compressed package size limit");

const unsafeSvgCases = [
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><script>evil()</script></svg>", "PACKAGE_SVG_TAG_NOT_ALLOWED", "script element"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"evil()\"></svg>", "PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED", "event handler"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><rect style=\"fill:red\" x=\"1\" y=\"1\" width=\"2\" height=\"2\"/></svg>", "PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED", "style attribute"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><rect fill=\"url(http://evil.example/a)\" x=\"1\" y=\"1\" width=\"2\" height=\"2\"/></svg>", "PACKAGE_SVG_EXTERNAL_REFERENCE", "remote URL"],
  ["<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg xmlns=\"http://www.w3.org/2000/svg\"><text>&x;</text></svg>", "PACKAGE_SVG_UNSAFE_MARKUP", "DOCTYPE/entity"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><foreignObject/></svg>", "PACKAGE_SVG_TAG_NOT_ALLOWED", "foreignObject"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><use href=\"#x\"/></svg>", "PACKAGE_SVG_TAG_NOT_ALLOWED", "use element"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"data:image/png;base64,AAAA\"/></svg>", "PACKAGE_SVG_TAG_NOT_ALLOWED", "image/data reference"],
  ["<svg xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"2\" height=\"2\"></svg>", "PACKAGE_SVG_NOT_WELL_FORMED", "mismatched tags"],
];
for (const [svg, code, label] of unsafeSvgCases) {
  await rejectsCode(async () => {
    const io = new SafePackageIO(new MemoryArchiveBackend(), manifestValidator);
    await io.write(base, { distribution: "student", assets: [{ path: "assets/x.svg", bytes: new TextEncoder().encode(svg), mime: "image/svg+xml" }] });
  }, code, `writer rejects unsafe SVG: ${label}`);
}

await rejectsCode(async () => {
  const dangerous = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>');
  const files = [...goodFiles, { path: "assets/attacker.svg", bytes: dangerous, mime: "image/svg+xml" }];
  const records = await recordsFor(files);
  const io = new SafePackageIO(new MemoryArchiveBackend(records), manifestValidator);
  await io.read(new Blob(["x"]), DEFAULT_PACKAGE_LIMITS);
}, "PACKAGE_SVG_TAG_NOT_ALLOWED", "reader rejects attacker-built correctly hashed active SVG");

console.log(`PASS PackageIO adversarial suite: ${checks} assertions.`);
