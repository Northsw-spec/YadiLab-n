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
  publicKeySpkiBase64,
  readSnapshotTrustStore,
  revokeSnapshotTrustKey,
} from "../../scripts/offline-snapshot-provenance-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

function copySource() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trust-life-"));
  const source = path.join(base, "source");
  fs.mkdirSync(source, { recursive: true });
  for (const item of listSourceCheckoutFiles(root)) {
    const src = path.join(root, ...item.path.split("/"));
    const dst = path.join(source, ...item.path.split("/"));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, item.mode);
  }
  fs.writeFileSync(path.join(source, "dependencies/offline-snapshot-trust.json"), canonicalTrustStoreBytes({ keys: [] }));
  return { base, source };
}

const tmp = copySource();
try {
  const pair = crypto.generateKeyPairSync("ed25519");
  const keyId = keyIdForPublicKey(pair.publicKey);
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
  let trust = readSnapshotTrustStore(tmp.source);
  ok(trust.ok, "empty v1.2 trust store is valid");
  eq(trust.keys.size, 0, "empty trust store has no active producer keys");
  eq(trust.pendingKeys.size, 0, "empty trust store has no pending producer keys");

  let result = onboardSnapshotTrustKey(tmp.source, publicPem, keyId, "primary-producer");
  ok(result.changed, "first onboarding stages trust key");
  eq(result.status, "pending", "new trust key is pending until proof of possession");
  trust = readSnapshotTrustStore(tmp.source);
  ok(trust.ok && trust.pendingKeys.has(keyId), "staged key is pending");
  ok(!trust.keys.has(keyId), "staged key is not trusted for snapshot signing");
  eq(trust.value.keys[0].publicKeySpkiBase64, publicKeySpkiBase64(pair.publicKey), "staging stores canonical SPKI bytes");
  eq(trust.value.keys[0].activationProof, null, "pending key has no activation proof");

  result = onboardSnapshotTrustKey(tmp.source, publicPem, keyId, "primary-producer");
  ok(!result.changed && result.status === "pending", "repeat identical staging is idempotent");

  result = activateSnapshotTrustKey(tmp.source, keyId, pair.privateKey);
  ok(result.changed, "matching private key activates staged key");
  eq(result.status, "active", "activation returns active status");
  trust = readSnapshotTrustStore(tmp.source);
  ok(trust.ok && trust.keys.has(keyId), "activated key is trusted");
  ok(!trust.pendingKeys.has(keyId), "activated key is no longer pending");
  ok(typeof trust.value.keys[0].activationProof?.signatureBase64 === "string", "active key stores cryptographic activation proof");

  result = activateSnapshotTrustKey(tmp.source, keyId, pair.privateKey);
  ok(!result.changed && result.status === "active", "repeat matching activation is idempotent");

  result = revokeSnapshotTrustKey(tmp.source, keyId);
  ok(result.changed, "first revocation changes trust store");
  trust = readSnapshotTrustStore(tmp.source);
  ok(trust.ok, "trust store remains valid after revocation");
  ok(!trust.keys.has(keyId), "revoked key is removed from active trust map");
  ok(trust.revokedKeys.has(keyId), "revoked key remains explicitly recorded");
  ok(typeof trust.value.keys[0].activationProof?.signatureBase64 === "string", "revocation retains proof-of-possession history");

  result = revokeSnapshotTrustKey(tmp.source, keyId);
  ok(!result.changed, "repeat revocation is idempotent");
} finally {
  fs.rmSync(tmp.base, { recursive: true, force: true });
}
console.log(`PASS snapshot trust lifecycle suite: ${checks} assertions.`);
