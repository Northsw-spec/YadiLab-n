import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
assert.equal(fs.existsSync(packageJsonPath), true, "package.json must be present");
assert.equal(fs.existsSync(lockPath), true, "package-lock.json must be present");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
assert.equal(lock.lockfileVersion, 3, "lockfileVersion must remain 3");
assert.equal(lock.packages[""].name, packageJson.name, "lock root name must match package manifest");
assert.equal(lock.packages[""].version, packageJson.version, "lock root version must match package manifest");
for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "overrides", "resolutions"]) {
  assert.deepEqual(lock.packages[""][field] ?? undefined, packageJson[field] ?? undefined, `${field} specification must match package manifest`);
}
console.log("PASS source checkpoint package-lock contract: package.json/package-lock.json present, parseable and root-compatible");
