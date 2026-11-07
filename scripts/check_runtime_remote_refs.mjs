import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRemoteRuntimeReferences } from "./dependency-contract-lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, ".."));
const findings = scanRemoteRuntimeReferences(root);
if (findings.length) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}
console.log("PASS runtime remote-reference guard: all scanned browser assets are local-only.");
