import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyOfflineDependencySnapshot } from "./offline-dependency-snapshot-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preSigning = process.argv[2] === "--pre-signing";
const snapshotArg = preSigning ? process.argv[3] : process.argv[2];
if ((preSigning && process.argv.length !== 4) || (!preSigning && process.argv.length !== 3)) {
  console.error("Usage: node scripts/verify_offline_dependency_snapshot.mjs [--pre-signing] /path/to/snapshot");
  process.exit(2);
}
const result = verifyOfflineDependencySnapshot(root, path.resolve(snapshotArg), { requireProvenance: !preSigning });
if (!result.ok) {
  console.error(JSON.stringify({ status: "BLOCKED", reason: "offline-dependency-snapshot", diagnostics: result.diagnostics }, null, 2));
  process.exit(77);
}
console.log(`PASS offline dependency snapshot: ${result.manifest.fileCount} files, ${result.manifest.requiredLockPackageCount} required lock packages.`);
