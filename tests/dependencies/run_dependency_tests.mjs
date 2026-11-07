import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateBuildReadiness,
  scanRemoteRuntimeReferences,
  validateDependencyContract,
  validatePackageLockClosure,
} from "../../scripts/dependency-contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const contract = validateDependencyContract(root);
ok(contract.ok, `repository dependency contract valid: ${JSON.stringify(contract.diagnostics)}`);
eq(contract.policy.runtimeDependencies.react, "19.3.0", "React exact pin");
eq(contract.policy.runtimeDependencies["@xyflow/react"], "12.11.6", "React Flow exact pin");
eq(contract.policy.runtimeDependencies.elkjs, "0.12.0", "ELK exact pin");
eq(contract.policy.runtimeDependencies.ajv, "8.17.1", "Ajv exact pin");
eq(contract.policy.runtimeDependencies["@zip.js/zip.js"], "2.18.2", "zip.js exact pin");
eq(contract.policy.developmentDependencies.typescript, "5.9.2", "TypeScript exact pin");
eq(contract.policy.developmentDependencies.esbuild, "0.28.2", "esbuild exact pin");
ok(contract.policy.rules.localRuntimeAssetsOnly, "local runtime assets are mandatory");
ok(contract.policy.rules.packageLockRequiredForBrowserBuild, "package-lock required for browser build");
ok(contract.policy.rules.endUserNodeRuntimeForbidden, "end-user Node runtime forbidden");

eq(scanRemoteRuntimeReferences(root).length, 0, "no remote runtime references in protected browser paths");
execFileSync(process.execPath, ["--check", path.join(root, "ui/app/main.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync(process.execPath, ["--check", path.join(root, "scripts/build_browser_app.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync(process.execPath, ["--check", path.join(root, "scripts/verify_package_lock.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync(process.execPath, ["--check", path.join(root, "scripts/offline-dependency-snapshot-lib.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync(process.execPath, ["--check", path.join(root, "scripts/create_offline_dependency_snapshot_manifest.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync(process.execPath, ["--check", path.join(root, "scripts/verify_offline_dependency_snapshot.mjs")], { stdio: "pipe" }); checks += 1;
execFileSync("bash", ["-n", path.join(root, "scripts/prepare_offline_browser_cache.sh"), path.join(root, "scripts/install_offline_browser_dependencies.sh")], { stdio: "pipe" }); checks += 1;

const current = evaluateBuildReadiness(root);
eq(current.ready, true, `release checkout has a genuine exact lock/install closure: ${JSON.stringify(current.blockers)}`);
eq(current.blockers, [], "release checkout has zero dependency-readiness blockers");
eq(current.installed.length, Object.keys({ ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies }).length, "every direct pinned release dependency is installed");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-dependency-ready-"));
try {
  fs.mkdirSync(path.join(tmp, "dependencies"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dependencies/browser-runtime.policy.json"), JSON.stringify(contract.policy, null, 2));
  const packageJson = {
    name: "fixture",
    version: "1.0.0",
    dependencies: contract.policy.runtimeDependencies,
    devDependencies: contract.policy.developmentDependencies,
  };
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(packageJson, null, 2));
  const integrity = `sha512-${Buffer.alloc(64, 42).toString("base64")}`;
  const all = { ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies };
  const packageEntries = Object.fromEntries(Object.entries(all).map(([name, version]) => [
    `node_modules/${name}`, { version, integrity, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz` },
  ]));
  for (const rule of contract.policy.targetOptionalDependencies?.["linux-x86_64"] ?? []) {
    packageEntries[`node_modules/${rule.from}`].optionalDependencies = {
      ...(packageEntries[`node_modules/${rule.from}`].optionalDependencies ?? {}),
      [rule.package]: rule.version,
    };
    packageEntries[`node_modules/${rule.package}`] = {
      version: rule.version, integrity, resolved: `https://registry.npmjs.org/${rule.package}/-/${rule.package.split("/").at(-1)}-${rule.version}.tgz`, optional: true,
    };
  }
  const projectLock = {
    name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { dependencies: contract.policy.runtimeDependencies, devDependencies: contract.policy.developmentDependencies }, ...packageEntries },
  };
  fs.writeFileSync(path.join(tmp, "package-lock.json"), JSON.stringify(projectLock, null, 2));
  eq(validatePackageLockClosure(projectLock, contract.policy).ok, true, "complete lock closure is accepted");
  execFileSync(process.execPath, [path.join(root, "scripts/verify_package_lock.mjs"), tmp], { stdio: "pipe" }); checks += 1;
  for (const [name, version] of Object.entries(all)) {
    const dir = path.join(tmp, "node_modules", ...name.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
  }
  for (const rule of contract.policy.targetOptionalDependencies?.["linux-x86_64"] ?? []) {
    const dir = path.join(tmp, "node_modules", ...rule.package.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: rule.package, version: rule.version }));
  }
  fs.writeFileSync(path.join(tmp, "node_modules/.package-lock.json"), JSON.stringify({
    name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: packageEntries,
  }, null, 2));
  const ready = evaluateBuildReadiness(tmp);
  ok(ready.ready, `complete exact fixture is build-ready: ${JSON.stringify(ready.blockers)}`);
  eq(ready.blockers.length, 0, "ready fixture has zero blockers");
  eq(ready.installed.length, Object.keys(all).length, "every direct pinned package recorded in readiness snapshot");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

execFileSync(process.execPath, [path.join(root, "scripts/generate_web_shell.mjs")], { cwd: root, stdio: "pipe" }); checks += 1;
const shellHtml = fs.readFileSync(path.join(root, "ui/public/index.html"), "utf8");
const shellManifest = JSON.parse(fs.readFileSync(path.join(root, "ui/public/browser-build-manifest.json"), "utf8"));
ok(shellHtml.includes('data-app-runtime="shell"'), "fallback delivery shell is explicitly marked non-runtime");
eq(shellManifest.status, "shell-only", "fallback browser build manifest cannot claim ready");

console.log(`PASS dependency/browser-build gate suite: ${checks} assertions.`);
