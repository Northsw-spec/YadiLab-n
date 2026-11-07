import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyOfflineDependencySnapshot } from "../../scripts/offline-dependency-snapshot-lib.mjs";
import { readSnapshotTrustStore, verifySnapshotProvenance } from "../../scripts/offline-snapshot-provenance-lib.mjs";
import { createTrustedTestSource, createSignedTestSnapshot } from "./snapshot-signing-test-helper.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const rootTrust = readSnapshotTrustStore(root);
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

ok(rootTrust.ok, `release trust store contract is valid: ${JSON.stringify(rootTrust.diagnostics)}`);
eq(rootTrust.keys.size, 1, "product release pins exactly one active snapshot producer public key");
eq(rootTrust.pendingKeys.size, 0, "product release has no pending snapshot producer key");
eq(rootTrust.revokedKeys.size, 0, "product release has no revoked snapshot producer key");
ok(rootTrust.value.keys.every((entry) => entry.label === "v1.0.0-release-producer"), "release trust anchor is the reviewed v1.0.0 producer identity");

const source = createTrustedTestSource(root);
try {
  const trust = readSnapshotTrustStore(source.sourceRoot);
  ok(trust.ok, `ephemeral trust store accepted: ${JSON.stringify(trust.diagnostics)}`);
  ok(trust.keys.has(source.keyId), "ephemeral signing public key is pinned by derived key id");

  const snap = createSignedTestSnapshot(source.sourceRoot, source.privateKey);
  try {
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(result.ok, `signed snapshot accepted: ${JSON.stringify(result.diagnostics)}`);
    eq(result.provenance.keyId, source.keyId, "accepted provenance identifies the exact trusted Ed25519 key");
    eq(result.provenance.snapshotManifestSha256, sha(fs.readFileSync(path.join(snap.dir, "snapshot-manifest.json"))), "provenance binds exact snapshot-manifest bytes");
    eq(result.provenance.sourceCheckoutSha256, result.manifest.sourceContract.sourceCheckout.sha256, "provenance repeats the sealed source-checkout identity");
    const direct = verifySnapshotProvenance(source.sourceRoot, snap.dir, result.manifest);
    ok(direct.ok, `direct provenance verification succeeds: ${JSON.stringify(direct.diagnostics)}`);
    eq(result.provenance.algorithm, "ed25519", "provenance algorithm is explicitly Ed25519");
    const snap2 = createSignedTestSnapshot(source.sourceRoot, source.privateKey);
    try {
      eq(fs.readFileSync(path.join(snap.dir, "snapshot-provenance.json")), fs.readFileSync(path.join(snap2.dir, "snapshot-provenance.json")), "same source/manifest/key produces byte-identical provenance JSON");
      eq(fs.readFileSync(path.join(snap.dir, "snapshot-provenance.sig")), fs.readFileSync(path.join(snap2.dir, "snapshot-provenance.sig")), "Ed25519 provenance signature is reproducible for identical input");
    } finally { fs.rmSync(snap2.owner, { recursive: true, force: true }); }
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }
} finally { fs.rmSync(source.base, { recursive: true, force: true }); }

console.log(`PASS snapshot provenance suite: ${checks} assertions.`);
