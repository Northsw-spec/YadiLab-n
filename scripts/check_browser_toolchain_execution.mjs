import path from "node:path";
import { fileURLToPath } from "node:url";
import { attestInstalledBrowserToolchain } from "./browser-toolchain-attestation-node.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, ".."));
const checked = await attestInstalledBrowserToolchain(root);
if (checked.status === "BLOCKED") {
  console.error(JSON.stringify({ status: "BLOCKED", reason: "dependency-readiness", blockers: checked.readiness.blockers }, null, 2));
  process.exit(77);
}
if (checked.status === "FAIL") {
  console.error(JSON.stringify({ status: "FAIL", reason: "browser-toolchain-execution", passed: checked.result.passed, failures: checked.result.failures }, null, 2));
  process.exit(1);
}
console.log(`PASS browser toolchain execution: ${checked.result.passed.join(", ")}`);
