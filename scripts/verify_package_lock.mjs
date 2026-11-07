import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, validateDependencyContract, validatePackageLockClosure } from "./dependency-contract-lib.mjs";
const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
try {
  const contract = validateDependencyContract(root);
  const lock = readJson(path.join(root, "package-lock.json"));
  const closure = validatePackageLockClosure(lock, contract.policy);
  const issues = [...contract.diagnostics, ...closure.diagnostics];
  if (!closure.ok || !contract.ok) {
    console.error(JSON.stringify({ status: "FAIL", issues }, null, 2));
    process.exit(78);
  }
  console.log(JSON.stringify({ status: "PASS", requiredPackageCount: closure.requiredPaths.length }));
} catch (error) {
  console.error(JSON.stringify({ status: "BLOCKED", reason: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(77);
}
