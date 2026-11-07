import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signSnapshotProvenance } from "./offline-snapshot-provenance-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 4) {
  console.error("Usage: node scripts/sign_offline_dependency_snapshot.mjs SNAPSHOT_DIR PRIVATE_KEY.pem");
  process.exit(2);
}
const snapshot = path.resolve(process.argv[2]);
const privateKeyPath = path.resolve(process.argv[3]);
try {
  if (privateKeyPath === root || privateKeyPath.startsWith(`${root}${path.sep}`)) throw new Error("private key must live outside the application source checkout");
  if (!fs.existsSync(privateKeyPath) || !fs.statSync(privateKeyPath).isFile()) throw new Error("private key file not found");
  const privateMode = fs.statSync(privateKeyPath).mode & 0o777;
  if (![0o400, 0o600].includes(privateMode)) throw new Error(`private key permissions must be 0400 or 0600, got 0${privateMode.toString(8)}`);
  const provenance = signSnapshotProvenance(root, snapshot, fs.readFileSync(privateKeyPath));
  console.log(`PASS signed dependency snapshot provenance: ${provenance.keyId}`);
} catch (error) {
  console.error(`BLOCKED dependency snapshot provenance signing: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(77);
}
