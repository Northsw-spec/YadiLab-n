import path from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseContract, assertBundledRelease } from "./release-contract.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const release = readReleaseContract(root);
  const directory = path.resolve(process.argv[2] ?? path.join(root, "ui/dist"));
  assertBundledRelease(directory, release);
  console.log(`PASS release identity: v${release.version} ${release.checkpoint} Git ${release.sourceCommit} / tree ${release.sourceTree}`);
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  process.exitCode = 77;
}
