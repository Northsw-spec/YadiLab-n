import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBrowserRelease } from "./browser-release-verifier.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = verifyBrowserRelease(process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "ui/dist"));
if (!result.ok) {
  console.error(JSON.stringify({ status: "BLOCKED", reason: "browser-release-integrity", diagnostics: result.errors }, null, 2));
  process.exit(77);
}
console.log(`PASS browser release integrity: ${result.filesVerified} exact local files.`);
