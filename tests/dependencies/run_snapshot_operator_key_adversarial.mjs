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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-operator-key-adversarial-"));
let assertions = 0;
function blocked(fn, pattern, message) {
  try { fn(); throw new Error(`expected block: ${message}`); }
  catch (error) {
    if (String(error.message).startsWith("expected block:")) throw error;
    if (pattern && !pattern.test(String(error.message))) throw new Error(`${message}: unexpected error ${error.message}`);
    assertions += 1;
  }
}
function clone(src, name) {
  const dest = path.join(base, name);
  fs.cpSync(src, dest, { recursive: true, preserveTimestamps: true });
  return dest;
}
try {
  const original = path.join(base, "original");
  generateSnapshotOperatorKeyBundle(root, original, "adversarial-producer");

  const inside = path.join(root, "dist-operator-key-test");
  blocked(() => generateSnapshotOperatorKeyBundle(root, inside, "inside"), /outside/, "inside-checkout generation must block");
  fs.rmSync(inside, { recursive: true, force: true });

  blocked(() => generateSnapshotOperatorKeyBundle(root, original, "duplicate"), /already exists/, "existing target must not be overwritten");
  blocked(() => generateSnapshotOperatorKeyBundle(root, path.join(base, "bad-label"), " bad"), /label/, "invalid label must block");

  const linkParent = path.join(base, "source-link");
  fs.symlinkSync(root, linkParent, "dir");
  blocked(() => generateSnapshotOperatorKeyBundle(root, path.join(linkParent, "secret"), "linked"), /outside/, "symlinked parent into source must block");

  const badPrivateMode = clone(original, "bad-private-mode");
  fs.chmodSync(path.join(badPrivateMode, OPERATOR_KEY_PRIVATE), 0o644);
  blocked(() => verifySnapshotOperatorKeyBundle(root, badPrivateMode), /0600/, "insecure private key mode must block");

  const extra = clone(original, "extra-file");
  fs.writeFileSync(path.join(extra, "unexpected.txt"), "x");
  blocked(() => verifySnapshotOperatorKeyBundle(root, extra), /exactly/, "unexpected bundle file must block");

  const badFingerprint = clone(original, "bad-fingerprint");
  fs.writeFileSync(path.join(badFingerprint, OPERATOR_KEY_FINGERPRINT), "ed25519-sha256:" + "0".repeat(64) + "\n");
  blocked(() => verifySnapshotOperatorKeyBundle(root, badFingerprint), /fingerprint/, "fingerprint mismatch must block");

  const badRecord = clone(original, "bad-record");
  const recordPath = path.join(badRecord, OPERATOR_KEY_RECORD);
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  record.label = "tampered";
  fs.writeFileSync(recordPath, JSON.stringify(record));
  fs.chmodSync(recordPath, 0o644);
  blocked(() => verifySnapshotOperatorKeyBundle(root, badRecord), /canonical|record/, "tampered/noncanonical ceremony record must block");

  const sourceMismatch = clone(original, "source-mismatch");
  const sourceRecordPath = path.join(sourceMismatch, OPERATOR_KEY_RECORD);
  const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8"));
  sourceRecord.generatedFromSource.sha256 = "f".repeat(64);
  fs.writeFileSync(sourceRecordPath, `${JSON.stringify(sourceRecord, null, 2)}\n`);
  fs.chmodSync(sourceRecordPath, 0o644);
  blocked(() => verifySnapshotOperatorKeyBundle(root, sourceMismatch), /source-checkout identity/, "wrong source identity must block");

  const wrongPrivate = clone(original, "wrong-private");
  const foreign = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(path.join(wrongPrivate, OPERATOR_KEY_PRIVATE), foreign.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.chmodSync(path.join(wrongPrivate, OPERATOR_KEY_PRIVATE), 0o600);
  blocked(() => verifySnapshotOperatorKeyBundle(root, wrongPrivate), /pair mismatch/, "mismatched private key must block");

  const wrongPublic = clone(original, "wrong-public");
  fs.writeFileSync(path.join(wrongPublic, OPERATOR_KEY_PUBLIC), foreign.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
  fs.chmodSync(path.join(wrongPublic, OPERATOR_KEY_PUBLIC), 0o644);
  blocked(() => verifySnapshotOperatorKeyBundle(root, wrongPublic), /pair mismatch/, "mismatched public key must block");

  const symlinkFile = clone(original, "symlink-file");
  const publicPath = path.join(symlinkFile, OPERATOR_KEY_PUBLIC);
  const saved = fs.readFileSync(publicPath);
  fs.unlinkSync(publicPath);
  const elsewhere = path.join(base, "elsewhere-public.pem");
  fs.writeFileSync(elsewhere, saved, { mode: 0o644 });
  fs.symlinkSync(elsewhere, publicPath);
  blocked(() => verifySnapshotOperatorKeyBundle(root, symlinkFile), /non-symlink/, "symlinked bundle file must block");

  const bundleLink = path.join(base, "bundle-link");
  fs.symlinkSync(original, bundleLink, "dir");
  blocked(() => verifySnapshotOperatorKeyBundle(root, bundleLink), /may not be a symlink/, "symlinked bundle directory must block");

  console.log(`PASS snapshot operator key ceremony adversarial: ${assertions} assertions`);
} finally {
  fs.rmSync(path.join(root, "dist-operator-key-test"), { recursive: true, force: true });
  fs.rmSync(base, { recursive: true, force: true });
}
