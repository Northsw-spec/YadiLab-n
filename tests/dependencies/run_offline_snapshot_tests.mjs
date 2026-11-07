import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  buildOfflineDependencySnapshotManifest,
  writeOfflineDependencySnapshotManifest,
  verifyOfflineDependencySnapshot,
} from "../../scripts/offline-dependency-snapshot-lib.mjs";
import { validateDependencyContract } from "../../scripts/dependency-contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = validateDependencyContract(root);
assert.equal(contract.ok, true);
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function lockFixture() {
  const all = { ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies };
  const integrity = `sha512-${Buffer.alloc(64, 17).toString("base64")}`;
  const entries = Object.fromEntries(Object.entries(all).map(([name, version]) => [
    `node_modules/${name}`, { version, integrity, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz` },
  ]));
  for (const rule of contract.policy.targetOptionalDependencies?.["linux-x86_64"] ?? []) {
    entries[`node_modules/${rule.from}`].optionalDependencies = {
      ...(entries[`node_modules/${rule.from}`].optionalDependencies ?? {}),
      [rule.package]: rule.version,
    };
    entries[`node_modules/${rule.package}`] = {
      version: rule.version, integrity, resolved: `https://registry.npmjs.org/${rule.package}/-/${rule.package.split("/").at(-1)}-${rule.version}.tgz`, optional: true,
    };
  }
  return {
    name: "visual-infrastructure-lab-app",
    version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { dependencies: contract.policy.runtimeDependencies, devDependencies: contract.policy.developmentDependencies },
      ...entries,
    },
  };
}

function makeSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-offline-snapshot-"));
  fs.mkdirSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb"), { recursive: true });
  fs.writeFileSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb/payload"), "fixture-cache-bytes");
  const lockBytes = `${JSON.stringify(lockFixture(), null, 2)}\n`;
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockBytes);
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${sha(Buffer.from(lockBytes))}  package-lock.json\n`);
  fs.writeFileSync(path.join(dir, "development-platform.json"), '{"node":"v22.16.0","npm":"10.9.2","platform":"linux","arch":"x86_64","kernel":"6.12.0-test"}\n');
  const manifest = writeOfflineDependencySnapshotManifest(root, dir, { node: "v22.16.0", npm: "10.9.2" });
  return { dir, manifest };
}

let snap = makeSnapshot();
try {
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(result.ok, `valid snapshot accepted: ${JSON.stringify(result.diagnostics)}`);
  eq(result.manifest.formatId, "infrastructure-cyber-lab.offline-dependency-snapshot", "format id is explicit");
  eq(result.manifest.schemaVersion, "1.2.0", "snapshot schema version is explicit");
  ok(/^[0-9a-f]{64}$/.test(result.manifest.sourceContract.sourceCheckout.sha256), "source checkout identity recorded");
  ok(result.manifest.sourceContract.sourceCheckout.fileCount > 0, "source checkout file count recorded");
  eq(result.manifest.target, { platform: "linux", arch: "x86_64" }, "snapshot target is Linux x86-64");
  eq(result.manifest.preparedWith.npm, "10.9.2", "preparation npm version recorded");
  ok(result.manifest.files.some((x) => x.path.startsWith("npm-cache/")), "cache content is hash-inventoried");
  eq(result.manifest.fileCount, result.manifest.files.length, "file count is exact");
  eq(result.manifest.totalBytes, result.manifest.files.reduce((n, x) => n + x.size, 0), "byte total is exact");
  ok(result.manifest.requiredLockPackageCount >= Object.keys(contract.policy.runtimeDependencies).length, "lock closure count recorded");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  fs.appendFileSync(path.join(snap.dir, "npm-cache/_cacache/content-v2/sha512/aa/bb/payload"), "tamper");
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "modified cache byte rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_FILE_SIZE_MISMATCH" || x.code === "SNAPSHOT_FILE_HASH_MISMATCH"), "cache mutation named");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  fs.writeFileSync(path.join(snap.dir, "npm-cache/unlisted"), "x");
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "unlisted transferred file rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_UNLISTED_FILE"), "unlisted file diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const victim = snap.manifest.files.find((x) => x.path.startsWith("npm-cache/"));
  fs.rmSync(path.join(snap.dir, victim.path));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "missing listed cache file rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_LISTED_FILE_MISSING"), "missing file diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  fs.symlinkSync("package-lock.json", path.join(snap.dir, "evil-link"));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "snapshot symlink rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_FILESYSTEM_INVALID"), "symlink diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const m = JSON.parse(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"), "utf8"));
  m.files[0].path = "../escape";
  fs.writeFileSync(path.join(snap.dir, "snapshot-manifest.json"), JSON.stringify(m));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "traversal manifest entry rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_FILE_ENTRY_INVALID"), "traversal entry diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const m = JSON.parse(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"), "utf8"));
  m.files.push(structuredClone(m.files[0]));
  m.fileCount++;
  m.totalBytes += m.files[0].size;
  fs.writeFileSync(path.join(snap.dir, "snapshot-manifest.json"), JSON.stringify(m));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "duplicate manifest file rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_DUPLICATE_FILE"), "duplicate diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const m = JSON.parse(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"), "utf8"));
  m.files.reverse();
  fs.writeFileSync(path.join(snap.dir, "snapshot-manifest.json"), JSON.stringify(m));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "non-canonical file table rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_FILE_TABLE_NOT_SORTED"), "sort diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const m = JSON.parse(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"), "utf8"));
  m.requiredLockPackageCount += 1;
  fs.writeFileSync(path.join(snap.dir, "snapshot-manifest.json"), JSON.stringify(m));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "forged lock closure count rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_LOCK_PACKAGE_COUNT_MISMATCH"), "lock count diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const fakeSource = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-offline-source-"));
  fs.mkdirSync(path.join(fakeSource, "dependencies"), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  pkg.description = "changed-source-contract";
  fs.writeFileSync(path.join(fakeSource, "package.json"), JSON.stringify(pkg));
  fs.copyFileSync(path.join(root, "dependencies/browser-runtime.policy.json"), path.join(fakeSource, "dependencies/browser-runtime.policy.json"));
  const result = verifyOfflineDependencySnapshot(fakeSource, snap.dir, { requireProvenance: false });
  ok(!result.ok, "snapshot bound to exact package.json bytes");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_SOURCE_PACKAGE_JSON_MISMATCH"), "source contract mismatch named");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_SOURCE_CHECKOUT_MISMATCH"), "whole source checkout mismatch named");
  fs.rmSync(fakeSource, { recursive: true, force: true });
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

snap = makeSnapshot();
try {
  const m = JSON.parse(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"), "utf8"));
  m.sourceContract.sourceCheckout.sha256 = "0".repeat(64);
  fs.writeFileSync(path.join(snap.dir, "snapshot-manifest.json"), JSON.stringify(m));
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(!result.ok, "forged source checkout identity rejected");
  ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_SOURCE_CHECKOUT_MISMATCH"), "forged checkout digest diagnostic emitted");
} finally { fs.rmSync(snap.dir, { recursive: true, force: true }); }

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-offline-empty-"));
try {
  fs.mkdirSync(path.join(empty, "npm-cache"));
  const lockBytes = `${JSON.stringify(lockFixture())}\n`;
  fs.writeFileSync(path.join(empty, "package-lock.json"), lockBytes);
  fs.writeFileSync(path.join(empty, "SHA256SUMS.txt"), `${sha(Buffer.from(lockBytes))}  package-lock.json\n`);
  fs.writeFileSync(path.join(empty, "development-platform.json"), "{}\n");
  let failed = false;
  try { buildOfflineDependencySnapshotManifest(root, empty); } catch { failed = true; }
  ok(failed, "manifest creation refuses empty npm cache");
} finally { fs.rmSync(empty, { recursive: true, force: true }); }

console.log(`PASS offline dependency snapshot suite: ${checks} assertions.`);
