import { promoteOfflineBuild } from "./offline-build-transaction-lib.mjs";
if (process.argv.length !== 4) {
  console.error("Usage: node scripts/promote_offline_browser_build.mjs SOURCE_ROOT STAGED_SOURCE_ROOT");
  process.exit(2);
}
try {
  const result = promoteOfflineBuild(process.argv[2], process.argv[3]);
  console.log(`PASS offline browser build transactional promotion: ${result.promoted.join(", ")}.`);
} catch (error) {
  console.error(`FAIL offline browser build transactional promotion: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
