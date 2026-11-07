import { recoverOfflineBuildTransaction } from "./offline-build-transaction-lib.mjs";
if (process.argv.length !== 3) {
  console.error("Usage: node scripts/recover_offline_browser_build_transaction.mjs SOURCE_ROOT");
  process.exit(2);
}
try {
  const result = recoverOfflineBuildTransaction(process.argv[2]);
  console.log(result.recovered ? "PASS recovered interrupted offline-build transaction." : "PASS no interrupted offline-build transaction present.");
} catch (error) {
  console.error(`BLOCKED offline-build transaction recovery: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(77);
}
