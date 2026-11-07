import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { listSourceCheckoutFiles } from "../../scripts/source-checkout-identity.mjs";
import { validateDependencyContract } from "../../scripts/dependency-contract-lib.mjs";
import { writeOfflineDependencySnapshotManifest } from "../../scripts/offline-dependency-snapshot-lib.mjs";
import {
  activateSnapshotTrustKey,
  keyIdForPublicKey,
  onboardSnapshotTrustKey,
  signSnapshotProvenance,
} from "../../scripts/offline-snapshot-provenance-lib.mjs";

function copyControlledSource(originalRoot, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const item of listSourceCheckoutFiles(originalRoot)) {
    const src = path.join(originalRoot, ...item.path.split("/"));
    const dst = path.join(target, ...item.path.split("/"));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dst, item.mode);
  }
}

export function createTrustedTestSource(originalRoot) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-provenance-source-"));
  const sourceRoot = path.join(base, "source");
  copyControlledSource(originalRoot, sourceRoot);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = keyIdForPublicKey(publicKey);
  onboardSnapshotTrustKey(sourceRoot, publicKey.export({ type: "spki", format: "pem" }), keyId, "ephemeral-test-producer");
  activateSnapshotTrustKey(sourceRoot, keyId, privateKey);
  return { base, sourceRoot, privateKey, publicKey, keyId };
}

export function lockFixture(sourceRoot) {
  const contract = validateDependencyContract(sourceRoot);
  if (!contract.ok) throw new Error(`test source dependency contract invalid: ${JSON.stringify(contract.diagnostics)}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
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

export function createUnsignedTestSnapshot(sourceRoot, base = null) {
  const owner = base ?? fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-provenance-snapshot-"));
  const dir = base ? path.join(base, "snapshot") : path.join(owner, "snapshot");
  fs.mkdirSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb"), { recursive: true });
  fs.mkdirSync(path.join(dir, "npm-cache/_cacache/index-v5/cc/dd"), { recursive: true });
  fs.writeFileSync(path.join(dir, "npm-cache/_cacache/content-v2/sha512/aa/bb/payload"), "fixture-cache-bytes\n");
  fs.writeFileSync(path.join(dir, "npm-cache/_cacache/index-v5/cc/dd/index"), "fixture-index-bytes\n");
  const lockBytes = `${JSON.stringify(lockFixture(sourceRoot), null, 2)}\n`;
  fs.writeFileSync(path.join(dir, "package-lock.json"), lockBytes);
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${crypto.createHash("sha256").update(lockBytes).digest("hex")}  package-lock.json\n`);
  fs.writeFileSync(path.join(dir, "development-platform.json"), '{"node":"v22.16.0","npm":"10.9.2","platform":"linux","arch":"x86_64","kernel":"6.12.0-test"}\n');
  writeOfflineDependencySnapshotManifest(sourceRoot, dir, { node: "v22.16.0", npm: "10.9.2" });
  return { owner, dir };
}

export function signTestSnapshot(sourceRoot, snapshotDir, privateKey) {
  return signSnapshotProvenance(sourceRoot, snapshotDir, privateKey);
}

export function createSignedTestSnapshot(sourceRoot, privateKey, base = null) {
  const snapshot = createUnsignedTestSnapshot(sourceRoot, base);
  const provenance = signTestSnapshot(sourceRoot, snapshot.dir, privateKey);
  return { ...snapshot, provenance };
}
