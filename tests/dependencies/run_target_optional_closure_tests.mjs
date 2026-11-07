import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateBuildReadiness, validateDependencyContract, validatePackageLockClosure } from "../../scripts/dependency-contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = validateDependencyContract(root);
assert.equal(contract.ok, true, JSON.stringify(contract.diagnostics));
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };
const integrity = `sha512-${Buffer.alloc(64, 49).toString("base64")}`;

function url(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
}

function completeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-target-optional-"));
  fs.mkdirSync(path.join(tmp, "dependencies"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dependencies/browser-runtime.policy.json"), JSON.stringify(contract.policy, null, 2));
  const pkg = {
    name: "fixture",
    version: "1.0.0",
    dependencies: structuredClone(contract.policy.runtimeDependencies),
    devDependencies: structuredClone(contract.policy.developmentDependencies),
  };
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
  const entries = {};
  for (const [name, version] of Object.entries({ ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies })) {
    entries[`node_modules/${name}`] = { version, integrity, resolved: url(name, version) };
  }
  for (const rule of contract.policy.targetOptionalDependencies["linux-x86_64"]) {
    const parent = entries[`node_modules/${rule.from}`];
    parent.optionalDependencies = { ...(parent.optionalDependencies ?? {}), [rule.package]: rule.version };
    entries[`node_modules/${rule.package}`] = { version: rule.version, integrity, resolved: url(rule.package, rule.version), optional: true };
  }
  const lock = {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, ...entries },
  };
  fs.writeFileSync(path.join(tmp, "package-lock.json"), JSON.stringify(lock, null, 2));
  for (const [key, entry] of Object.entries(entries)) {
    const dir = path.join(tmp, ...key.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    const nameSegments = key.slice(key.lastIndexOf("node_modules/") + 13).split("/");
    const name = nameSegments[0].startsWith("@") ? nameSegments.slice(0, 2).join("/") : nameSegments[0];
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: entry.version }));
  }
  fs.writeFileSync(path.join(tmp, "node_modules/.package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: entries }, null, 2));
  return { tmp, lock, entries };
}

const targetRules = contract.policy.targetOptionalDependencies?.["linux-x86_64"];
ok(Array.isArray(targetRules), "Linux x86-64 target optional dependency rules are explicit");
eq(targetRules.length, 1, "exactly one current target-native optional dependency is required");
eq(targetRules[0], { from: "esbuild", package: "@esbuild/linux-x64", version: "0.28.2" }, "esbuild Linux-x64 native package is policy-bound");

const f = completeFixture();
try {
  const closure = validatePackageLockClosure(f.lock, contract.policy);
  ok(closure.ok, `complete target-aware closure accepted: ${JSON.stringify(closure.diagnostics)}`);
  eq(closure.target, "linux-x86_64", "closure is evaluated for mandatory Linux x86-64 target");
  ok(closure.requiredPaths.includes("node_modules/@esbuild/linux-x64"), "native esbuild package is part of required closure");
  eq(closure.targetOptionalRequiredPaths, ["node_modules/@esbuild/linux-x64"], "target-native closure paths are reported separately");
  const ready = evaluateBuildReadiness(f.tmp);
  ok(ready.ready, `installed target-native closure is build-ready: ${JSON.stringify(ready.blockers)}`);
  eq(ready.blockers.length, 0, "target-native complete fixture has zero readiness blockers");
} finally {
  fs.rmSync(f.tmp, { recursive: true, force: true });
}

console.log(`PASS target optional dependency closure suite: ${checks} assertions.`);
