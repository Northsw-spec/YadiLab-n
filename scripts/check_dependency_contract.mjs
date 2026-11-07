import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDependencyContract, scanRemoteRuntimeReferences } from "./dependency-contract-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, ".."));
const result = validateDependencyContract(root);
const remote = scanRemoteRuntimeReferences(root);
if (remote.length) result.diagnostics.push({ code: "REMOTE_RUNTIME_REFERENCE", findings: remote });
if (result.diagnostics.length) {
  console.error(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
  process.exit(1);
}
console.log("PASS dependency contract: exact direct pins + no remote runtime references.");
