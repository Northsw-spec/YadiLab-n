import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activateSnapshotTrustKey,
  onboardSnapshotTrustKey,
  revokeSnapshotTrustKey,
} from "./offline-snapshot-provenance-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function outsideSource(file) {
  const abs = path.resolve(file);
  const rel = path.relative(root, abs);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." ? false : true;
}

function externalRegularFile(file, label) {
  const requested = path.resolve(file);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) throw new Error(`${label} file not found`);
  const real = fs.realpathSync(requested);
  if (!outsideSource(real)) throw new Error(`${label} input must resolve outside the application source checkout`);
  return real;
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/manage_offline_snapshot_trust.mjs stage PUBLIC_KEY.pem EXPECTED_KEY_ID LABEL");
  console.error("  node scripts/manage_offline_snapshot_trust.mjs onboard PUBLIC_KEY.pem EXPECTED_KEY_ID LABEL  # alias for stage");
  console.error("  node scripts/manage_offline_snapshot_trust.mjs activate KEY_ID PRIVATE_KEY.pem");
  console.error("  node scripts/manage_offline_snapshot_trust.mjs revoke KEY_ID");
}

try {
  const command = process.argv[2];
  if (command === "stage" || command === "onboard") {
    if (process.argv.length !== 6) { usage(); process.exit(2); }
    const publicKeyRealPath = externalRegularFile(process.argv[3], "public key onboarding");
    const expectedKeyId = process.argv[4];
    const label = process.argv[5];
    const result = onboardSnapshotTrustKey(root, fs.readFileSync(publicKeyRealPath), expectedKeyId, label);
    console.log(`${result.changed ? "PASS staged" : `PASS already ${result.status}`} snapshot producer trust key: ${result.keyId}`);
  } else if (command === "activate") {
    if (process.argv.length !== 5) { usage(); process.exit(2); }
    const keyId = process.argv[3];
    const privateKeyRealPath = externalRegularFile(process.argv[4], "private key activation");
    const privateMode = fs.statSync(privateKeyRealPath).mode & 0o777;
    if (![0o400, 0o600].includes(privateMode)) throw new Error(`private key activation permissions must be 0400 or 0600, got 0${privateMode.toString(8)}`);
    const result = activateSnapshotTrustKey(root, keyId, fs.readFileSync(privateKeyRealPath));
    console.log(`${result.changed ? "PASS activated" : "PASS already active"} snapshot producer trust key: ${result.keyId}`);
  } else if (command === "revoke") {
    if (process.argv.length !== 4) { usage(); process.exit(2); }
    const result = revokeSnapshotTrustKey(root, process.argv[3]);
    console.log(`${result.changed ? "PASS revoked" : "PASS already revoked"} snapshot producer trust key: ${result.keyId}`);
  } else {
    usage(); process.exit(2);
  }
} catch (error) {
  console.error(`BLOCKED snapshot trust lifecycle change: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(77);
}
