import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSnapshotOperatorKeyBundle, verifySnapshotOperatorKeyBundle } from "./snapshot-operator-key-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error("Usage:");
  console.error("  node scripts/manage_snapshot_operator_key.mjs generate OUTPUT_DIR LABEL");
  console.error("  node scripts/manage_snapshot_operator_key.mjs verify BUNDLE_DIR");
}

try {
  const command = process.argv[2];
  if (command === "generate") {
    if (process.argv.length !== 5) { usage(); process.exit(2); }
    const result = generateSnapshotOperatorKeyBundle(root, process.argv[3], process.argv[4]);
    console.log(`PASS operator key bundle generated: ${result.bundle}`);
    console.log(`keyId=${result.keyId}`);
    console.log(`publicKey=${result.publicKeyPath}`);
    console.log(`fingerprint=${result.fingerprintPath}`);
    console.log("Keep the private key external and protected; do not copy it into the application source checkout.");
  } else if (command === "verify") {
    if (process.argv.length !== 4) { usage(); process.exit(2); }
    const result = verifySnapshotOperatorKeyBundle(root, process.argv[3], { requireCurrentSource: true });
    console.log(`PASS operator key bundle verified: ${result.keyId}`);
  } else {
    usage(); process.exit(2);
  }
} catch (error) {
  console.error(`BLOCKED operator key ceremony: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(77);
}
