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
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function lockFixture() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const all = { ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies };
  const integrity = `sha512-${Buffer.alloc(64, 29).toString("base64")}`;
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

function makeSnapshot(platform = { node: "v22.16.0", npm: "10.9.2", platform: "linux", arch: "x86_64", kernel: "6.12.0-test" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-platform-adversarial-"));
  fs.mkdirSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb"), { recursive: true });
  fs.writeFileSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb/payload"), "cache\n");
  const lockBytes = `${JSON.stringify(lockFixture(), null, 2)}\n`;
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockBytes);
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${sha(Buffer.from(lockBytes))}  package-lock.json\n`);
  fs.writeFileSync(path.join(dir, "development-platform.json"), `${JSON.stringify(platform)}\n`);
  return dir;
}

for (const [field, value, code] of [
  ["platform", "win32", "SNAPSHOT_PLATFORM_METADATA_PLATFORM_INVALID"],
  ["arch", "arm64", "SNAPSHOT_PLATFORM_METADATA_ARCH_INVALID"],
  ["node", "22.16", "SNAPSHOT_PLATFORM_METADATA_NODE_INVALID"],
  ["npm", "latest", "SNAPSHOT_PLATFORM_METADATA_NPM_INVALID"],
  ["kernel", "bad\nvalue", "SNAPSHOT_PLATFORM_METADATA_KERNEL_INVALID"],
]) {
  const candidate = { node: "v22.16.0", npm: "10.9.2", platform: "linux", arch: "x86_64", kernel: "6.12.0-test", [field]: value };
  const result = validateDevelopmentPlatformMetadata(candidate);
  ok(!result.ok, `${field} mutation rejected`);
  ok(result.diagnostics.some((x) => x.code === code), `${field} mutation emits ${code}`);
}

for (const [field, value] of [["platform", "win32"], ["arch", "arm64"], ["kernel", ""]]) {
  const platform = { node: "v22.16.0", npm: "10.9.2", platform: "linux", arch: "x86_64", kernel: "6.12.0-test", [field]: value };
  const dir = makeSnapshot(platform);
  try {
    let failed = false;
    try { writeOfflineDependencySnapshotManifest(root, dir, { node: platform.node, npm: platform.npm }); } catch { failed = true; }
    ok(failed, `manifest creation refuses invalid producer ${field}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const [field, explicit] of [["node", "v22.17.0"], ["npm", "10.9.3"]]) {
  const dir = makeSnapshot();
  try {
    let failed = false;
    try {
      writeOfflineDependencySnapshotManifest(root, dir, field === "node" ? { node: explicit, npm: "10.9.2" } : { node: "v22.16.0", npm: explicit });
    } catch { failed = true; }
    ok(failed, `explicit ${field} identity cannot disagree with development-platform.json`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const [field, value, code] of [
  ["node", "v99.0.0", "SNAPSHOT_PREPARED_NODE_MISMATCH"],
  ["npm", "99.0.0", "SNAPSHOT_PREPARED_NPM_MISMATCH"],
]) {
  const dir = makeSnapshot();
  try {
    writeOfflineDependencySnapshotManifest(root, dir, { node: "v22.16.0", npm: "10.9.2" });
    const manifestPath = path.join(dir, "snapshot-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.preparedWith[field] = value;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = verifyOfflineDependencySnapshot(root, dir, { requireProvenance: false });
    ok(!result.ok, `forged manifest preparedWith.${field} rejected`);
    ok(result.diagnostics.some((x) => x.code === code), `forged ${field} emits ${code}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

{
  const dir = makeSnapshot();
  try {
    writeOfflineDependencySnapshotManifest(root, dir, { node: "v22.16.0", npm: "10.9.2" });
    fs.writeFileSync(path.join(dir, "development-platform.json"), "{broken-json\n");
    const result = verifyOfflineDependencySnapshot(root, dir, { requireProvenance: false });
    ok(!result.ok, "malformed producer metadata rejected during verification");
    ok(result.diagnostics.some((x) => x.code === "SNAPSHOT_PLATFORM_METADATA_INVALID_JSON"), "malformed producer metadata diagnostic emitted");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log(`PASS snapshot producer-platform adversarial suite: ${checks} assertions.`);
