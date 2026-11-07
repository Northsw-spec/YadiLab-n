import fs from "node:fs";
import path from "node:path";
import { validateSnapshotConsumerEnvironment } from "./offline-dependency-snapshot-lib.mjs";

if (process.argv.length !== 3) {
  console.error("Usage: node scripts/check_offline_snapshot_consumer_environment.mjs /path/to/snapshot");
  process.exit(2);
}
const snapshot = path.resolve(process.argv[2]);
const manifestPath = path.join(snapshot, "snapshot-manifest.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`BLOCKED snapshot consumer environment: cannot read snapshot manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(77);
}
const result = validateSnapshotConsumerEnvironment(manifest, {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  npm: process.env.YADILAB_CONSUMER_NPM_VERSION ?? null,
});
if (!result.ok) {
  console.error(`BLOCKED snapshot consumer environment: ${JSON.stringify(result.diagnostics)}`);
  process.exit(77);
}
console.log(`PASS snapshot consumer environment: ${manifest.preparedWith.node} / npm ${manifest.preparedWith.npm} / linux x86_64.`);
