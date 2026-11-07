import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  generateSnapshotOperatorKeyBundle,
  verifySnapshotOperatorKeyBundle,
  OPERATOR_KEY_PRIVATE,
  OPERATOR_KEY_PUBLIC,
  OPERATOR_KEY_FINGERPRINT,
  OPERATOR_KEY_RECORD,
} from "../../scripts/snapshot-operator-key-lib.mjs";
import { computeSourceCheckoutIdentity } from "../../scripts/source-checkout-identity.mjs";
import { keyIdForPublicKey } from "../../scripts/offline-snapshot-provenance-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-operator-key-functional-"));
let assertions = 0;
function ok(condition, message) { if (!condition) throw new Error(message); assertions += 1; }
try {
  const immediateParentProbe = path.join(path.dirname(root), `operator-key-parent-probe-${process.pid}`);
  const probe = generateSnapshotOperatorKeyBundle(root, immediateParentProbe, "parent-probe");
  ok(probe.ok === true, "immediate parent path must count as outside the source checkout");
  fs.rmSync(immediateParentProbe, { recursive: true, force: true });

  const target = path.join(base, "producer-key");
  const result = generateSnapshotOperatorKeyBundle(root, target, "primary-producer");
  ok(result.ok === true, "generated bundle must verify");
  ok(fs.statSync(path.join(target, OPERATOR_KEY_PRIVATE)).mode % 0o1000 === 0o600, "private key mode must be 0600");
  ok(fs.statSync(path.join(target, OPERATOR_KEY_PUBLIC)).mode % 0o1000 === 0o644, "public key mode must be 0644");
  ok(fs.statSync(path.join(target, OPERATOR_KEY_FINGERPRINT)).mode % 0o1000 === 0o644, "fingerprint mode must be 0644");
  ok(fs.statSync(path.join(target, OPERATOR_KEY_RECORD)).mode % 0o1000 === 0o644, "record mode must be 0644");
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(target, OPERATOR_KEY_PRIVATE)));
  const publicKey = crypto.createPublicKey(fs.readFileSync(path.join(target, OPERATOR_KEY_PUBLIC)));
  ok(privateKey.asymmetricKeyType === "ed25519" && publicKey.asymmetricKeyType === "ed25519", "bundle keys must be Ed25519");
  const keyId = keyIdForPublicKey(publicKey);
  ok(result.keyId === keyId, "returned keyId must match public key");
  ok(fs.readFileSync(path.join(target, OPERATOR_KEY_FINGERPRINT), "utf8") === `${keyId}\n`, "fingerprint file must exactly match keyId");
  const record = JSON.parse(fs.readFileSync(path.join(target, OPERATOR_KEY_RECORD), "utf8"));
  ok(record.keyId === keyId && record.label === "primary-producer", "ceremony record must bind key and label");
  const current = computeSourceCheckoutIdentity(root);
  ok(record.generatedFromSource.sha256 === current.sha256, "ceremony record must bind current source identity");
  ok(record.generatedFromSource.fileCount === current.fileCount && record.generatedFromSource.totalBytes === current.totalBytes, "ceremony record must bind source count and bytes");
  const verification = verifySnapshotOperatorKeyBundle(root, target, { requireCurrentSource: true });
  ok(verification.keyId === keyId, "explicit verification must return same keyId");
  const publicText = fs.readFileSync(path.join(target, OPERATOR_KEY_PUBLIC), "utf8");
  const recordText = fs.readFileSync(path.join(target, OPERATOR_KEY_RECORD), "utf8");
  ok(!publicText.includes("PRIVATE KEY") && !recordText.includes("PRIVATE KEY"), "public ceremony artifacts must not contain private-key PEM material");
  console.log(`PASS snapshot operator key ceremony functional: ${assertions} assertions`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
