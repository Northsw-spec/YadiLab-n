import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  evaluateBuildReadiness,
  scanRemoteRuntimeReferences,
  validateDependencyContract,
  validatePackageLockClosure,
} from "../../scripts/dependency-contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const basePolicy = JSON.parse(fs.readFileSync(path.join(root, "dependencies/browser-runtime.policy.json"), "utf8"));
const basePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

function fixture(mutator = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-dependency-adversarial-"));
  fs.mkdirSync(path.join(tmp, "dependencies"), { recursive: true });
  const policy = structuredClone(basePolicy);
  const pkg = { name: "fixture", version: "1.0.0", dependencies: structuredClone(policy.runtimeDependencies), devDependencies: structuredClone(policy.developmentDependencies) };
  const lock = { name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { dependencies: structuredClone(policy.runtimeDependencies), devDependencies: structuredClone(policy.developmentDependencies) } } };
  const state = { tmp, policy, pkg, lock };
  mutator(state);
  fs.writeFileSync(path.join(tmp, "dependencies/browser-runtime.policy.json"), JSON.stringify(policy, null, 2));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
  if (lock) fs.writeFileSync(path.join(tmp, "package-lock.json"), JSON.stringify(lock, null, 2));
  return state;
}

let f = fixture(({ pkg }) => { pkg.dependencies.react = "^19.3.0"; });
try {
  const result = validateDependencyContract(f.tmp);
  ok(!result.ok, "semver range rejected");
  ok(result.diagnostics.some((x) => x.code === "DEPENDENCY_VERSION_MISMATCH" || x.code === "DEPENDENCY_NOT_EXACT"), "range produces exact-pin diagnostic");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture(({ pkg }) => { pkg.dependencies["unapproved-runtime"] = "1.0.0"; });
try {
  const result = validateDependencyContract(f.tmp);
  ok(!result.ok, "unexpected direct runtime dependency rejected");
  ok(result.diagnostics.some((x) => x.code === "DEPENDENCY_RUNTIME_SET_MISMATCH"), "unexpected package changes direct dependency set");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture(({ lock }) => { lock.packages[""].dependencies.react = "19.2.0"; });
try {
  const result = evaluateBuildReadiness(f.tmp);
  ok(!result.ready, "lock root mismatch blocks build");
  ok(result.blockers.some((x) => x.code === "PACKAGE_LOCK_ROOT_VERSION_MISMATCH" && x.package === "react"), "lock mismatch named");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture();
try {
  const all = { ...f.policy.runtimeDependencies, ...f.policy.developmentDependencies };
  for (const [name, version] of Object.entries(all)) {
    const dir = path.join(f.tmp, "node_modules", ...name.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: name === "elkjs" ? "0.11.0" : version }));
  }
  const result = evaluateBuildReadiness(f.tmp);
  ok(!result.ready, "installed version mismatch blocks browser build");
  ok(result.blockers.some((x) => x.code === "INSTALLED_PACKAGE_VERSION_MISMATCH" && x.package === "elkjs"), "installed mismatch named");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture();
try {
  fs.mkdirSync(path.join(f.tmp, "ui/app"), { recursive: true });
  fs.writeFileSync(path.join(f.tmp, "ui/app/bad.mjs"), 'import "https://example.invalid/runtime.js";\n');
  const findings = scanRemoteRuntimeReferences(f.tmp, ["ui/app"]);
  ok(findings.length === 1, "remote runtime import detected");
  ok(findings[0].file === "ui/app/bad.mjs", "remote finding names exact file");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture();
try {
  fs.mkdirSync(path.join(f.tmp, "ui/public"), { recursive: true });
  fs.writeFileSync(path.join(f.tmp, "ui/public/bad.css"), '.x{background:url("https://cdn.invalid/a.png")}\n');
  const findings = scanRemoteRuntimeReferences(f.tmp, ["ui/public"]);
  ok(findings.length === 1, "remote CSS URL detected");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

f = fixture();
try {
  fs.mkdirSync(path.join(f.tmp, "ui/app"), { recursive: true });
  fs.writeFileSync(path.join(f.tmp, "ui/app/bad-fetch.mjs"), 'fetch("https://api.invalid/runtime.json");\n');
  const findings = scanRemoteRuntimeReferences(f.tmp, ["ui/app"]);
  ok(findings.length === 1, "remote runtime fetch detected");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }

// No package-lock can ever be considered ready even if node_modules happens to exist.
f = fixture();
try {
  fs.rmSync(path.join(f.tmp, "package-lock.json"));
  const all = { ...f.policy.runtimeDependencies, ...f.policy.developmentDependencies };
  for (const [name, version] of Object.entries(all)) {
    const dir = path.join(f.tmp, "node_modules", ...name.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
  }
  const result = evaluateBuildReadiness(f.tmp);
  ok(!result.ready, "installed modules without lock remain blocked");
  ok(result.blockers.some((x) => x.code === "PACKAGE_LOCK_MISSING"), "missing lock remains explicit blocker");
} finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }


// Phase 37: lock closure + installed npm metadata must agree, not merely root pins.
const validIntegrity = `sha512-${Buffer.alloc(64, 13).toString("base64")}`;
function installCompleteFixture(f) {
  const entries = {};
  for (const [name, version] of Object.entries({ ...f.policy.runtimeDependencies, ...f.policy.developmentDependencies })) {
    const key = `node_modules/${name}`;
    entries[key] = { version, integrity: validIntegrity, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz` };
    const dir = path.join(f.tmp, "node_modules", ...name.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
  }
  for (const rule of f.policy.targetOptionalDependencies?.["linux-x86_64"] ?? []) {
    const parentKey = `node_modules/${rule.from}`;
    entries[parentKey].optionalDependencies = { ...(entries[parentKey].optionalDependencies ?? {}), [rule.package]: rule.version };
    const key = `node_modules/${rule.package}`;
    entries[key] = { version: rule.version, integrity: validIntegrity, resolved: `https://registry.npmjs.org/${rule.package}/-/${rule.package.split("/").at(-1)}-${rule.version}.tgz`, optional: true };
    const dir = path.join(f.tmp, "node_modules", ...rule.package.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: rule.package, version: rule.version }));
  }
  f.lock.packages = { ...f.lock.packages, ...entries };
  fs.writeFileSync(path.join(f.tmp, "package-lock.json"), JSON.stringify(f.lock));
  fs.writeFileSync(path.join(f.tmp, "node_modules/.package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: entries }));
  return entries;
}
function mutateFixture(mutation, expectedCode) {
  const f = fixture();
  try {
    installCompleteFixture(f);
    mutation(f);
    const result = evaluateBuildReadiness(f.tmp);
    ok(!result.ready, `${expectedCode} blocks release readiness`);
    ok(result.blockers.some((x) => x.code === expectedCode), `${expectedCode} diagnostic retained`);
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
}
function updateJson(file, transform) {
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  transform(obj);
  fs.writeFileSync(file, JSON.stringify(obj));
}
mutateFixture(({tmp})=>updateJson(path.join(tmp,"package-lock.json"), lock=>{
  delete lock.packages["node_modules/react"];
}), "PACKAGE_LOCK_ENTRY_MISSING");
mutateFixture(({tmp})=>updateJson(path.join(tmp,"package-lock.json"), lock=>{
  delete lock.packages["node_modules/react"].integrity;
}), "PACKAGE_LOCK_ENTRY_INTEGRITY_MISSING");
mutateFixture(({tmp})=>updateJson(path.join(tmp,"package-lock.json"), lock=>{
  lock.packages["node_modules/react"].resolved="https://attacker.invalid/react.tgz";
}), "PACKAGE_LOCK_ENTRY_RESOLVED_UNSAFE");
mutateFixture(({tmp})=>updateJson(path.join(tmp,"package-lock.json"), lock=>{
  lock.packages["node_modules/react"].dependencies={"missing-required-transitive":"1.0.0"};
}), "PACKAGE_LOCK_DEPENDENCY_UNRESOLVED");
mutateFixture(({tmp})=>fs.rmSync(path.join(tmp,"node_modules/.package-lock.json")), "INSTALLED_LOCK_MISSING");
mutateFixture(({tmp})=>updateJson(path.join(tmp,"node_modules/.package-lock.json"), lock=>{
  lock.packages["node_modules/react"].integrity=`sha512-${Buffer.alloc(64,98).toString("base64")}`;
}), "INSTALLED_LOCK_ENTRY_INTEGRITY_MISMATCH");
mutateFixture(({tmp})=>updateJson(path.join(tmp,"node_modules/.package-lock.json"), lock=>{
  lock.packages["node_modules/unauthorized"]={version:"1.0.0",integrity:validIntegrity,resolved:"https://registry.npmjs.org/unauthorized/-/unauthorized-1.0.0.tgz"};
}), "INSTALLED_LOCK_ENTRY_UNDECLARED");
mutateFixture(({tmp})=>fs.writeFileSync(path.join(tmp,"node_modules/react/package.json"),JSON.stringify({name:"react",version:"17.0.0"})), "INSTALLED_PACKAGE_METADATA_MISMATCH");

const nested = fixture();
try {
  const entries = installCompleteFixture(nested);
  entries["node_modules/react"].dependencies={"fixture-transitive":"1.0.0"};
  entries["node_modules/fixture-transitive"]={version:"1.0.0",integrity:validIntegrity,resolved:"https://registry.npmjs.org/fixture-transitive/-/fixture-transitive-1.0.0.tgz"};
  nested.lock.packages={...nested.lock.packages,...entries};
  fs.writeFileSync(path.join(nested.tmp,"package-lock.json"),JSON.stringify(nested.lock));
  const closure=validatePackageLockClosure(nested.lock,nested.policy);
  ok(closure.ok,"nested dependency resolves in project lock");
  ok(closure.requiredPaths.includes("node_modules/fixture-transitive"),"closure traverses transitive requirement");
  const readiness=evaluateBuildReadiness(nested.tmp);
  ok(readiness.blockers.some(x=>x.code==="INSTALLED_LOCK_ENTRY_MISSING"&&x.path==="node_modules/fixture-transitive"),"missing installed transitive blocked");
  // Add the transitive package to the npm-installed metadata and physical tree:
  // a complete nested closure must then be accepted, not permanently blocked.
  updateJson(path.join(nested.tmp,"node_modules/.package-lock.json"), installed=>{
    installed.packages["node_modules/fixture-transitive"]=entries["node_modules/fixture-transitive"];
  });
  const transitiveDir=path.join(nested.tmp,"node_modules/fixture-transitive");
  fs.mkdirSync(transitiveDir,{recursive:true});
  fs.writeFileSync(path.join(transitiveDir,"package.json"),JSON.stringify({name:"fixture-transitive",version:"1.0.0"}));
  const valid=evaluateBuildReadiness(nested.tmp);
  ok(valid.ready,`complete transitive closure passes readiness: ${JSON.stringify(valid.blockers)}`);
  ok(valid.blockers.length===0,"complete transitive closure has no blockers");
} finally { fs.rmSync(nested.tmp,{recursive:true,force:true}); }

console.log(`PASS dependency/browser-build adversarial suite: ${checks} assertions.`);
