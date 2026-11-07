import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  validateDevelopmentPlatformMetadata,
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
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const all = { ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies };
  const integrity = `sha512-${Buffer.alloc(64, 23).toString("base64")}`;
  const entries = Object.fromEntries(Object.entries(all).map(([name, version]) => [
    `node_modules/${name}`, { version, integrity, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz` },
  ]));
  for (const rule of contract.policy.targetOptionalDependencies?.["linux-x86_64"] ?? []) {
    entries[`node_modules/${rule.from}`].optionalDependencies = { [rule.package]: rule.version };
    entries[`node_modules/${rule.package}`] = {
      version: rule.version,
      integrity,
      resolved: `https://registry.npmjs.org/${rule.package}/-/${rule.package.split("/").at(-1)}-${rule.version}.tgz`,
      optional: true,
    };
  }
  return {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { dependencies: contract.policy.runtimeDependencies, devDependencies: contract.policy.developmentDependencies },
      ...entries,
    },
  };
}

function makeSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-platform-snapshot-"));
  fs.mkdirSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb"), { recursive: true });
  fs.writeFileSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb/payload"), "cache\n");
  const lockBytes = `${JSON.stringify(lockFixture(), null, 2)}\n`;
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockBytes);
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${sha(Buffer.from(lockBytes))}  package-lock.json\n`);
  const platform = { node: "v22.16.0", npm: "10.9.2", platform: "linux", arch: "x86_64", kernel: "6.12.0-test" };
  fs.writeFileSync(path.join(dir, "development-platform.json"), `${JSON.stringify(platform)}\n`);
  return { dir, platform };
}

const valid = { node: "v22.16.0", npm: "10.9.2", platform: "linux", arch: "x86_64", kernel: "6.12.0-test" };
const metadata = validateDevelopmentPlatformMetadata(valid);
ok(metadata.ok, `valid producer metadata accepted: ${JSON.stringify(metadata.diagnostics)}`);
eq(metadata.diagnostics, [], "valid producer metadata has no diagnostics");

const snap = makeSnapshot();
try {
  const manifest = writeOfflineDependencySnapshotManifest(root, snap.dir, { node: snap.platform.node, npm: snap.platform.npm });
  eq(manifest.target, { platform: "linux", arch: "x86_64" }, "manifest target is derived from producer metadata");
  eq(manifest.preparedWith, { node: "v22.16.0", npm: "10.9.2" }, "manifest tool identity is derived from producer metadata");
  const result = verifyOfflineDependencySnapshot(root, snap.dir, { requireProvenance: false });
  ok(result.ok, `coherent producer metadata verifies: ${JSON.stringify(result.diagnostics)}`);
  eq(result.manifest.preparedWith.node, snap.platform.node, "verified Node identity remains bound");
  eq(result.manifest.preparedWith.npm, snap.platform.npm, "verified npm identity remains bound");
  ok(result.manifest.files.some((x) => x.path === "development-platform.json"), "producer metadata file is hash-inventoried");
} finally {
  fs.rmSync(snap.dir, { recursive: true, force: true });
}

console.log(`PASS snapshot producer-platform suite: ${checks} assertions.`);
