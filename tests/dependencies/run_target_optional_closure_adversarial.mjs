import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateBuildReadiness, validateDependencyContract, validatePackageLockClosure } from "../../scripts/dependency-contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseContract = validateDependencyContract(root);
assert.equal(baseContract.ok, true, JSON.stringify(baseContract.diagnostics));
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const integrity = `sha512-${Buffer.alloc(64, 50).toString("base64")}`;
const targetRule = baseContract.policy.targetOptionalDependencies["linux-x86_64"][0];

function url(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
}
function makeLock() {
  const entries = {};
  for (const [name, version] of Object.entries({ ...baseContract.policy.runtimeDependencies, ...baseContract.policy.developmentDependencies })) {
    entries[`node_modules/${name}`] = { version, integrity, resolved: url(name, version) };
  }
  entries[`node_modules/${targetRule.from}`].optionalDependencies = { [targetRule.package]: targetRule.version };
  entries[`node_modules/${targetRule.package}`] = { version: targetRule.version, integrity, resolved: url(targetRule.package, targetRule.version), optional: true };
  return {
    name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { dependencies: baseContract.policy.runtimeDependencies, devDependencies: baseContract.policy.developmentDependencies }, ...entries },
  };
}
function expectClosureMutation(mutator, code, message) {
  const lock = makeLock();
  mutator(lock);
  const result = validatePackageLockClosure(lock, baseContract.policy);
  ok(!result.ok, `${message} is rejected`);
  ok(result.diagnostics.some((x) => x.code === code), `${message} emits ${code}`);
}

expectClosureMutation((lock) => { delete lock.packages["node_modules/esbuild"].optionalDependencies; }, "PACKAGE_LOCK_TARGET_OPTIONAL_TABLE_MISSING", "missing optional dependency table");
expectClosureMutation((lock) => { lock.packages["node_modules/esbuild"].optionalDependencies = {}; }, "PACKAGE_LOCK_TARGET_OPTIONAL_DECLARATION_MISSING", "missing target-native declaration");
expectClosureMutation((lock) => { delete lock.packages["node_modules/@esbuild/linux-x64"]; }, "PACKAGE_LOCK_TARGET_OPTIONAL_ENTRY_MISSING", "missing target-native package entry");
expectClosureMutation((lock) => { lock.packages["node_modules/@esbuild/linux-x64"].version = "0.28.1"; }, "PACKAGE_LOCK_TARGET_OPTIONAL_VERSION_MISMATCH", "wrong target-native package version");

function installedFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-target-installed-"));
  fs.mkdirSync(path.join(tmp, "dependencies"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dependencies/browser-runtime.policy.json"), JSON.stringify(baseContract.policy, null, 2));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
    name: "fixture", version: "1.0.0",
    dependencies: baseContract.policy.runtimeDependencies,
    devDependencies: baseContract.policy.developmentDependencies,
  }, null, 2));
  const lock = makeLock();
  fs.writeFileSync(path.join(tmp, "package-lock.json"), JSON.stringify(lock, null, 2));
  const installed = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    installed[key] = structuredClone(entry);
    const dir = path.join(tmp, ...key.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    const nameSegments = key.slice(key.lastIndexOf("node_modules/") + 13).split("/");
    const name = nameSegments[0].startsWith("@") ? nameSegments.slice(0, 2).join("/") : nameSegments[0];
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: entry.version }));
  }
  fs.writeFileSync(path.join(tmp, "node_modules/.package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: installed }, null, 2));
  return tmp;
}

let tmp = installedFixture();
try {
  const hidden = JSON.parse(fs.readFileSync(path.join(tmp, "node_modules/.package-lock.json"), "utf8"));
  delete hidden.packages["node_modules/@esbuild/linux-x64"];
  fs.writeFileSync(path.join(tmp, "node_modules/.package-lock.json"), JSON.stringify(hidden));
  const result = evaluateBuildReadiness(tmp);
  ok(!result.ready, "installed metadata without target-native lock entry is blocked");
  ok(result.blockers.some((x) => x.code === "INSTALLED_LOCK_ENTRY_MISSING" && x.path === "node_modules/@esbuild/linux-x64"), "missing installed native lock path is named");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

tmp = installedFixture();
try {
  fs.rmSync(path.join(tmp, "node_modules/@esbuild/linux-x64/package.json"));
  const result = evaluateBuildReadiness(tmp);
  ok(!result.ready, "installed metadata without target-native package metadata is blocked");
  ok(result.blockers.some((x) => x.code === "INSTALLED_PACKAGE_METADATA_MISSING" && x.path === "node_modules/@esbuild/linux-x64"), "missing native package metadata is named");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

function policyFixture(mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-target-policy-"));
  fs.mkdirSync(path.join(tmp, "dependencies"), { recursive: true });
  const policy = structuredClone(baseContract.policy);
  mutator(policy);
  fs.writeFileSync(path.join(tmp, "dependencies/browser-runtime.policy.json"), JSON.stringify(policy));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
    name: "fixture", version: "1.0.0",
    dependencies: policy.runtimeDependencies,
    devDependencies: policy.developmentDependencies,
  }));
  return tmp;
}

tmp = policyFixture((policy) => { policy.targetOptionalDependencies["linux-x86_64"][0].from = "unknown-builder"; });
try {
  const result = validateDependencyContract(tmp);
  ok(!result.ok, "target optional source must be a direct policy dependency");
  ok(result.diagnostics.some((x) => x.code === "DEPENDENCY_TARGET_OPTIONAL_SOURCE_UNKNOWN"), "unknown source diagnostic emitted");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

tmp = policyFixture((policy) => { policy.targetOptionalDependencies["linux-x86_64"][0].version = "^0.28.2"; });
try {
  const result = validateDependencyContract(tmp);
  ok(!result.ok, "target optional version ranges are forbidden");
  ok(result.diagnostics.some((x) => x.code === "DEPENDENCY_TARGET_OPTIONAL_VERSION_NOT_EXACT"), "non-exact target optional diagnostic emitted");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`PASS target optional dependency closure adversarial suite: ${checks} assertions.`);
