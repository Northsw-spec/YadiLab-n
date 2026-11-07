import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeOfflineDependencySnapshotManifest } from "./offline-dependency-snapshot-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 3) {
  console.error("Usage: node scripts/create_offline_dependency_snapshot_manifest.mjs /path/to/snapshot");
  process.exit(2);
}
const snapshot = path.resolve(process.argv[2]);
try {
  const manifest = writeOfflineDependencySnapshotManifest(root, snapshot, {
    node: process.version,
    npm: process.env.YADILAB_PREPARED_NPM_VERSION ?? null,
  });
  console.log(`PASS dependency snapshot manifest: ${manifest.fileCount} files, ${manifest.totalBytes} bytes.`);
} catch (error) {
  console.error(`FAIL dependency snapshot manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
