import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyOfflineDependencySnapshot } from "../../scripts/offline-dependency-snapshot-lib.mjs";
import { keyIdForPublicKey, publicKeySpkiBase64, readSnapshotTrustStore, signSnapshotProvenance } from "../../scripts/offline-snapshot-provenance-lib.mjs";
import { createTrustedTestSource, createSignedTestSnapshot, createUnsignedTestSnapshot } from "./snapshot-signing-test-helper.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

function has(result, code) { return result.diagnostics.some((x) => x.code === code); }
function mutateJson(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, "utf8")); mutate(value); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function signedCase(source) { return createSignedTestSnapshot(source.sourceRoot, source.privateKey); }

const source = createTrustedTestSource(root);
try {
  let snap = createUnsignedTestSnapshot(source.sourceRoot);
  try {
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok, "unsigned snapshot rejected");
    ok(has(result, "SNAPSHOT_PROVENANCE_MISSING") && has(result, "SNAPSHOT_PROVENANCE_SIGNATURE_MISSING"), "unsigned snapshot names both missing provenance controls");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    fs.rmSync(path.join(snap.dir, "snapshot-provenance.sig"));
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_SIGNATURE_MISSING"), "missing detached signature rejected");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    fs.appendFileSync(path.join(snap.dir, "snapshot-manifest.json"), " ");
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_MANIFEST_HASH_MISMATCH"), "manifest byte tamper rejected by provenance hash binding");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    mutateJson(path.join(snap.dir, "snapshot-provenance.json"), (p) => { p.preparedWith.npm = "0.0.0"; });
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_PREPARED_WITH_MISMATCH"), "provenance semantic tamper rejected");
    ok(has(result, "SNAPSHOT_PROVENANCE_SIGNATURE_MISMATCH"), "provenance byte tamper also breaks Ed25519 signature");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    const sig = path.join(snap.dir, "snapshot-provenance.sig");
    const raw = Buffer.from(fs.readFileSync(sig, "utf8").trim(), "base64"); raw[0] ^= 0x80; fs.writeFileSync(sig, `${raw.toString("base64")}\n`);
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_SIGNATURE_MISMATCH"), "signature bit flip rejected");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    fs.appendFileSync(path.join(snap.dir, "snapshot-provenance.sig"), "junk\n");
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_SIGNATURE_INVALID_ENCODING"), "non-canonical signature encoding rejected");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = signedCase(source);
  try {
    mutateJson(path.join(snap.dir, "snapshot-provenance.json"), (p) => { p.keyId = `ed25519-sha256:${"0".repeat(64)}`; });
    const result = verifyOfflineDependencySnapshot(source.sourceRoot, snap.dir);
    ok(!result.ok && has(result, "SNAPSHOT_PROVENANCE_UNTRUSTED_KEY"), "unknown provenance key id rejected");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = createUnsignedTestSnapshot(source.sourceRoot);
  try {
    const other = crypto.generateKeyPairSync("ed25519");
    let failed = false;
    try { signSnapshotProvenance(source.sourceRoot, snap.dir, other.privateKey); } catch { failed = true; }
    ok(failed, "signing refuses an Ed25519 private key whose public key is not pinned in source trust store");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  snap = createUnsignedTestSnapshot(source.sourceRoot);
  try {
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    let failed = false;
    try { signSnapshotProvenance(source.sourceRoot, snap.dir, rsa.privateKey); } catch { failed = true; }
    ok(failed, "non-Ed25519 signing key rejected");
  } finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  const trustFile = path.join(source.sourceRoot, "dependencies/offline-snapshot-trust.json");
  const originalTrust = fs.readFileSync(trustFile);
  try {
    const trust = JSON.parse(originalTrust.toString("utf8")); trust.keys[0].keyId = `ed25519-sha256:${"f".repeat(64)}`; fs.writeFileSync(trustFile, `${JSON.stringify(trust, null, 2)}\n`);
    const result = readSnapshotTrustStore(source.sourceRoot);
    ok(!result.ok && result.diagnostics.some((x) => x.code === "SNAPSHOT_TRUST_KEY_ID_MISMATCH"), "trust store cannot lie about public-key-derived key id");
  } finally { fs.writeFileSync(trustFile, originalTrust); }

  try {
    const trust = JSON.parse(originalTrust.toString("utf8")); trust.keys.push(structuredClone(trust.keys[0])); fs.writeFileSync(trustFile, `${JSON.stringify(trust, null, 2)}\n`);
    const result = readSnapshotTrustStore(source.sourceRoot);
    ok(!result.ok && result.diagnostics.some((x) => x.code === "SNAPSHOT_TRUST_DUPLICATE_KEY_ID"), "duplicate trust key id rejected");
  } finally { fs.writeFileSync(trustFile, originalTrust); }

  try {
    const trust = JSON.parse(originalTrust.toString("utf8")); trust.keys[0].publicKeySpkiBase64 = Buffer.from("not-a-key").toString("base64"); fs.writeFileSync(trustFile, `${JSON.stringify(trust, null, 2)}\n`);
    const result = readSnapshotTrustStore(source.sourceRoot);
    ok(!result.ok && result.diagnostics.some((x) => x.code === "SNAPSHOT_TRUST_PUBLIC_KEY_INVALID"), "malformed pinned public key rejected");
  } finally { fs.writeFileSync(trustFile, originalTrust); }

  try {
    fs.writeFileSync(trustFile, '{"formatId":"wrong","schemaVersion":"1.1.0","keys":[]}\n');
    const result = readSnapshotTrustStore(source.sourceRoot);
    ok(!result.ok && result.diagnostics.some((x) => x.code === "SNAPSHOT_TRUST_STORE_CONTRACT_INVALID"), "wrong trust-store format id rejected");
  } finally { fs.writeFileSync(trustFile, originalTrust); }

  const emptySource = createTrustedTestSource(root);
  try {
    fs.writeFileSync(path.join(emptySource.sourceRoot, "dependencies/offline-snapshot-trust.json"), '{"formatId":"infrastructure-cyber-lab.offline-snapshot-trust","schemaVersion":"1.1.0","keys":[]}\n');
    const unsigned = createUnsignedTestSnapshot(emptySource.sourceRoot);
    try {
      let failed = false;
      try { signSnapshotProvenance(emptySource.sourceRoot, unsigned.dir, emptySource.privateKey); } catch { failed = true; }
      ok(failed, "empty production-style trust store cannot authorize a signer implicitly");
    } finally { fs.rmSync(unsigned.owner, { recursive: true, force: true }); }
  } finally { fs.rmSync(emptySource.base, { recursive: true, force: true }); }
} finally { fs.rmSync(source.base, { recursive: true, force: true }); }

console.log(`PASS snapshot provenance adversarial suite: ${checks} assertions.`);
