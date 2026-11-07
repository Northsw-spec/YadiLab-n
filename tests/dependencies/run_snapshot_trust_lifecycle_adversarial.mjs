import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { listSourceCheckoutFiles } from "../../scripts/source-checkout-identity.mjs";
import {
  activateSnapshotTrustKey,
  canonicalTrustStoreBytes,
  keyIdForPublicKey,
  onboardSnapshotTrustKey,
  readSnapshotTrustStore,
  revokeSnapshotTrustKey,
  signSnapshotProvenance,
} from "../../scripts/offline-snapshot-provenance-lib.mjs";
import { createSignedTestSnapshot, createUnsignedTestSnapshot } from "./snapshot-signing-test-helper.mjs";
import { verifyOfflineDependencySnapshot } from "../../scripts/offline-dependency-snapshot-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
function copySource() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trust-life-adv-"));
  const source = path.join(base, "source");
  fs.mkdirSync(source, { recursive: true });
  for (const item of listSourceCheckoutFiles(root)) {
    const src = path.join(root, ...item.path.split("/"));
    const dst = path.join(source, ...item.path.split("/"));
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); fs.chmodSync(dst, item.mode);
  }
  return { base, source };
}
function blocked(fn) { try { fn(); return false; } catch { return true; } }

const tmp = copySource();
try {
  const pair = crypto.generateKeyPairSync("ed25519");
  const other = crypto.generateKeyPairSync("ed25519");
  const keyId = keyIdForPublicKey(pair.publicKey);
  const pem = pair.publicKey.export({ type: "spki", format: "pem" });
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, pem, keyIdForPublicKey(other.publicKey), "producer")), "fingerprint mismatch blocks staging");
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, privatePem, keyId, "producer")), "private key material is rejected by staging");
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, pem, "bad", "producer")), "malformed expected fingerprint rejected");
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, pem, keyId, "bad/label")), "invalid label rejected");
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, rsa.publicKey.export({ type: "spki", format: "pem" }), keyId, "producer")), "non-Ed25519 public key rejected");

  onboardSnapshotTrustKey(tmp.source, pem, keyId, "producer");
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, pem, keyId, "different-label")), "staged key metadata cannot silently change");
  ok(blocked(() => activateSnapshotTrustKey(tmp.source, keyId, other.privateKey)), "wrong private key cannot activate staged public key");
  const unsigned = createUnsignedTestSnapshot(tmp.source);
  try { ok(blocked(() => signSnapshotProvenance(tmp.source, unsigned.dir, pair.privateKey)), "pending key cannot sign snapshot provenance"); }
  finally { fs.rmSync(unsigned.owner, { recursive: true, force: true }); }

  const trustFile = path.join(tmp.source, "dependencies/offline-snapshot-trust.json");
  let canonical = fs.readFileSync(trustFile);
  try {
    const parsed = JSON.parse(canonical.toString("utf8"));
    parsed.keys[0].status = "active";
    parsed.keys[0].activationProof = null;
    fs.writeFileSync(trustFile, `${JSON.stringify(parsed, null, 2)}\n`);
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_KEY_ENTRY_INVALID"), "manual pending-to-active edit without proof is rejected");
  } finally { fs.writeFileSync(trustFile, canonical); }

  activateSnapshotTrustKey(tmp.source, keyId, pair.privateKey);
  canonical = fs.readFileSync(trustFile);
  try {
    const parsed = JSON.parse(canonical.toString("utf8"));
    const sig = Buffer.from(parsed.keys[0].activationProof.signatureBase64, "base64");
    sig[0] ^= 1;
    parsed.keys[0].activationProof.signatureBase64 = sig.toString("base64");
    fs.writeFileSync(trustFile, `${JSON.stringify(parsed, null, 2)}\n`);
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_ACTIVATION_PROOF_MISMATCH"), "tampered activation proof is rejected");
  } finally { fs.writeFileSync(trustFile, canonical); }

  ok(blocked(() => revokeSnapshotTrustKey(tmp.source, keyIdForPublicKey(other.publicKey))), "unknown key cannot be revoked");
  const previouslySigned = createSignedTestSnapshot(tmp.source, pair.privateKey);
  revokeSnapshotTrustKey(tmp.source, keyId);
  try {
    const verified = verifyOfflineDependencySnapshot(tmp.source, previouslySigned.dir);
    ok(!verified.ok && verified.diagnostics.some((d) => d.code === "SNAPSHOT_PROVENANCE_REVOKED_KEY"), "snapshot signed by a now-revoked key is explicitly rejected as revoked");
  } finally { fs.rmSync(previouslySigned.owner, { recursive: true, force: true }); }
  ok(blocked(() => onboardSnapshotTrustKey(tmp.source, pem, keyId, "producer")), "revoked key cannot be restaged");
  ok(blocked(() => activateSnapshotTrustKey(tmp.source, keyId, pair.privateKey)), "revoked key cannot be reactivated");
  const snap = createUnsignedTestSnapshot(tmp.source);
  try { ok(blocked(() => signSnapshotProvenance(tmp.source, snap.dir, pair.privateKey)), "revoked key cannot sign new snapshot provenance"); }
  finally { fs.rmSync(snap.owner, { recursive: true, force: true }); }

  canonical = fs.readFileSync(trustFile);
  try {
    const parsed = JSON.parse(canonical.toString("utf8"));
    fs.writeFileSync(trustFile, JSON.stringify(parsed));
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_STORE_NON_CANONICAL"), "non-canonical trust store bytes rejected");
  } finally { fs.writeFileSync(trustFile, canonical); }
  try {
    const parsed = JSON.parse(canonical.toString("utf8")); parsed.keys[0].hidden = "forbidden";
    fs.writeFileSync(trustFile, `${JSON.stringify(parsed, null, 2)}\n`);
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_KEY_ENTRY_INVALID"), "unknown serialized trust-entry field rejected");
  } finally { fs.writeFileSync(trustFile, canonical); }
  try {
    const parsed = JSON.parse(canonical.toString("utf8")); parsed.keys[0].status = "active"; parsed.keys.push({ ...parsed.keys[0] });
    fs.writeFileSync(trustFile, `${JSON.stringify(parsed, null, 2)}\n`);
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_DUPLICATE_KEY_ID"), "same fingerprint cannot exist twice across lifecycle state");
  } finally { fs.writeFileSync(trustFile, canonical); }
  try {
    const parsed = JSON.parse(canonical.toString("utf8"));
    parsed.keys[0].activationProof.hidden = "forbidden";
    fs.writeFileSync(trustFile, `${JSON.stringify(parsed, null, 2)}\n`);
    const trust = readSnapshotTrustStore(tmp.source);
    ok(!trust.ok && trust.diagnostics.some((d) => d.code === "SNAPSHOT_TRUST_KEY_ENTRY_INVALID"), "unknown activation-proof field rejected");
  } finally { fs.writeFileSync(trustFile, canonical); }
} finally { fs.rmSync(tmp.base, { recursive: true, force: true }); }
console.log(`PASS snapshot trust lifecycle adversarial suite: ${checks} assertions.`);
