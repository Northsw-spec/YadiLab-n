import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function packageDir(nodeModules, name) {
  return path.join(nodeModules, ...name.split("/"));
}

export function validateDependencyContract(root) {
  const diagnostics = [];
  const pkg = readJson(path.join(root, "package.json"));
  const policy = readJson(path.join(root, "dependencies/browser-runtime.policy.json"));
  const compareSet = (kind, actual = {}, expected = {}) => {
    const aKeys = Object.keys(actual).sort();
    const eKeys = Object.keys(expected).sort();
    if (JSON.stringify(aKeys) !== JSON.stringify(eKeys)) {
      diagnostics.push({ code: `DEPENDENCY_${kind.toUpperCase()}_SET_MISMATCH`, message: `${kind} dependency set differs from policy.`, actual: aKeys, expected: eKeys });
    }
    for (const name of eKeys) {
      const version = actual[name];
      if (version !== expected[name]) diagnostics.push({ code: "DEPENDENCY_VERSION_MISMATCH", package: name, actual: version, expected: expected[name] });
      if (typeof version !== "string" || !EXACT_VERSION.test(version)) diagnostics.push({ code: "DEPENDENCY_NOT_EXACT", package: name, version });
    }
  };
  compareSet("runtime", pkg.dependencies, policy.runtimeDependencies);
  compareSet("development", pkg.devDependencies, policy.developmentDependencies);

  const direct = { ...(policy.runtimeDependencies ?? {}), ...(policy.developmentDependencies ?? {}) };
  const targetTable = policy.targetOptionalDependencies ?? {};
  if (typeof targetTable !== "object" || Array.isArray(targetTable)) {
    diagnostics.push({ code: "DEPENDENCY_TARGET_OPTIONAL_TABLE_INVALID" });
  } else {
    for (const [target, rules] of Object.entries(targetTable)) {
      if (!/^[-A-Za-z0-9_]+$/.test(target) || !Array.isArray(rules)) {
        diagnostics.push({ code: "DEPENDENCY_TARGET_OPTIONAL_RULE_INVALID", target });
        continue;
      }
      for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
            typeof rule.from !== "string" || typeof rule.package !== "string" || typeof rule.version !== "string") {
          diagnostics.push({ code: "DEPENDENCY_TARGET_OPTIONAL_RULE_INVALID", target, rule });
          continue;
        }
        if (!Object.hasOwn(direct, rule.from)) diagnostics.push({ code: "DEPENDENCY_TARGET_OPTIONAL_SOURCE_UNKNOWN", target, from: rule.from });
        if (!EXACT_VERSION.test(rule.version)) diagnostics.push({ code: "DEPENDENCY_TARGET_OPTIONAL_VERSION_NOT_EXACT", target, package: rule.package, version: rule.version });
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, packageJson: pkg, policy };
}

// An npm v3 root-only lock is NOT evidence of a reproducible install.
// Resolve required nested dependencies through the same ancestor node_modules
// search shape as Node/npm, but never execute arbitrary package code here.
const LOCK_PATH = /^(?:node_modules\/(?:@[-\w.]+\/)?[-\w.]+)(?:\/node_modules\/(?:@[-\w.]+\/)?[-\w.]+)*$/;
const SHA512_INTEGRITY = /^sha512-([A-Za-z0-9+/]{85,86}={0,2})(?:\s+sha512-[A-Za-z0-9+/=]+)*$/;
const SAFE_REGISTRY_URL = /^https:\/\/registry\.npmjs\.org\/[^?#\s]+$/;

function hasSha512Integrity(integrity) {
  if (typeof integrity !== "string" || !SHA512_INTEGRITY.test(integrity)) return false;
  const first = integrity.split(/\s+/)[0].slice(7);
  return Buffer.from(first, "base64").length === 64;
}

function resolveLockDependency(packages, fromPath, name) {
  let dir = fromPath;
  while (dir) {
    if (path.posix.basename(dir) !== "node_modules") {
      const nested = `${dir}/node_modules/${name}`;
      if (Object.hasOwn(packages, nested)) return nested;
    }
    const parent = path.posix.dirname(dir);
    dir = parent === dir || parent === "." ? "" : parent;
  }
  const top = `node_modules/${name}`;
  return Object.hasOwn(packages, top) ? top : null;
}

export function validatePackageLockClosure(lock, policy, target = "linux-x86_64") {
  const diagnostics = [];
  if (!lock || lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    return { ok: false, diagnostics: [{ code: "PACKAGE_LOCK_STRUCTURE_INVALID" }], requiredPaths: [] };
  }
  const packages = lock.packages;
  const allDirect = { ...policy.runtimeDependencies, ...policy.developmentDependencies };
  const required = new Set();
  for (const [name, expected] of Object.entries(allDirect)) {
    const key = `node_modules/${name}`;
    if (!Object.hasOwn(packages, key)) {
      diagnostics.push({ code: "PACKAGE_LOCK_ENTRY_MISSING", package: name, path: key });
      continue;
    }
    if (packages[key]?.version !== expected) {
      diagnostics.push({ code: "PACKAGE_LOCK_ENTRY_VERSION_MISMATCH", package: name, expected, actual: packages[key]?.version });
    }
    required.add(key);
  }
  const targetOptionalRequired = new Set();
  const targetRules = policy.targetOptionalDependencies?.[target] ?? [];
  if (!Array.isArray(targetRules)) {
    diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_POLICY_INVALID", target });
  } else {
    for (const rule of targetRules) {
      if (!rule || typeof rule !== "object" || typeof rule.from !== "string" || typeof rule.package !== "string" || !EXACT_VERSION.test(rule.version ?? "")) {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_POLICY_INVALID", target, rule });
        continue;
      }
      const parentKey = `node_modules/${rule.from}`;
      const parent = packages[parentKey];
      if (!parent || typeof parent !== "object") {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_SOURCE_MISSING", target, from: rule.from, path: parentKey });
        continue;
      }
      const optional = parent.optionalDependencies;
      if (!optional || typeof optional !== "object" || Array.isArray(optional)) {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_TABLE_MISSING", target, from: rule.from, path: parentKey });
        continue;
      }
      if (!Object.hasOwn(optional, rule.package)) {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_DECLARATION_MISSING", target, from: rule.from, package: rule.package });
        continue;
      }
      const resolved = resolveLockDependency(packages, parentKey, rule.package);
      if (!resolved) {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_ENTRY_MISSING", target, from: rule.from, package: rule.package });
        continue;
      }
      if (packages[resolved]?.version !== rule.version) {
        diagnostics.push({ code: "PACKAGE_LOCK_TARGET_OPTIONAL_VERSION_MISMATCH", target, package: rule.package, expected: rule.version, actual: packages[resolved]?.version, path: resolved });
      }
      targetOptionalRequired.add(resolved);
      required.add(resolved);
    }
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue;
    if (!LOCK_PATH.test(key) || key.includes("..") || !entry || typeof entry !== "object" || entry.link) {
      diagnostics.push({ code: "PACKAGE_LOCK_ENTRY_PATH_INVALID", path: key });
      continue;
    }
    if (!EXACT_VERSION.test(entry.version ?? "")) diagnostics.push({ code: "PACKAGE_LOCK_PACKAGE_VERSION_INVALID", path: key, version: entry.version });
    if (!hasSha512Integrity(entry.integrity)) diagnostics.push({ code: "PACKAGE_LOCK_ENTRY_INTEGRITY_MISSING", path: key });
    if (!SAFE_REGISTRY_URL.test(entry.resolved ?? "")) diagnostics.push({ code: "PACKAGE_LOCK_ENTRY_RESOLVED_UNSAFE", path: key });
  }
  const visited = new Set();
  const stack = [...required];
  while (stack.length) {
    const key = stack.pop();
    if (visited.has(key) || !packages[key]) continue;
    visited.add(key);
    const deps = packages[key].dependencies ?? {};
    if (typeof deps !== "object" || Array.isArray(deps)) {
      diagnostics.push({ code: "PACKAGE_LOCK_DEPENDENCY_TABLE_INVALID", path: key });
      continue;
    }
    for (const name of Object.keys(deps)) {
      const resolved = resolveLockDependency(packages, key, name);
      if (!resolved) diagnostics.push({ code: "PACKAGE_LOCK_DEPENDENCY_UNRESOLVED", path: key, package: name });
      else stack.push(resolved);
    }
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    requiredPaths: [...visited].sort(),
    targetOptionalRequiredPaths: [...targetOptionalRequired].sort(),
    target,
  };
}

function validateInstalledLock(root, projectLock, requiredPaths, blockers) {
  const hiddenFile = path.join(root, "node_modules/.package-lock.json");
  if (!fs.existsSync(hiddenFile)) {
    blockers.push({ code: "INSTALLED_LOCK_MISSING", message: "Install with npm ci; do not substitute manually created node_modules directories." });
    return;
  }
  let installedLock;
  try { installedLock = readJson(hiddenFile); }
  catch (error) {
    blockers.push({ code: "INSTALLED_LOCK_INVALID", message: String(error) });
    return;
  }
  if (installedLock.lockfileVersion !== 3 || !installedLock.packages || typeof installedLock.packages !== "object") {
    blockers.push({ code: "INSTALLED_LOCK_INVALID_STRUCTURE" });
    return;
  }
  for (const key of requiredPaths) {
    if (!installedLock.packages[key]) blockers.push({ code: "INSTALLED_LOCK_ENTRY_MISSING", path: key });
  }
  for (const [key, meta] of Object.entries(installedLock.packages)) {
    const declared = projectLock.packages[key];
    if (!declared) {
      blockers.push({ code: "INSTALLED_LOCK_ENTRY_UNDECLARED", path: key });
      continue;
    }
    if (meta?.version !== declared.version) blockers.push({ code: "INSTALLED_LOCK_ENTRY_VERSION_MISMATCH", path: key, expected: declared.version, actual: meta?.version });
    if (meta?.integrity !== declared.integrity) blockers.push({ code: "INSTALLED_LOCK_ENTRY_INTEGRITY_MISMATCH", path: key });
    if (meta?.resolved !== declared.resolved) blockers.push({ code: "INSTALLED_LOCK_ENTRY_RESOLVED_MISMATCH", path: key });
    const packageJson = path.join(root, ...key.split("/"), "package.json");
    if (!fs.existsSync(packageJson)) {
      blockers.push({ code: "INSTALLED_PACKAGE_METADATA_MISSING", path: key });
      continue;
    }
    try {
      const installed = readJson(packageJson);
      const nameSegments = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length).split("/");
      const declaredName = nameSegments.length > 1 && nameSegments[0]?.startsWith("@") ? nameSegments.slice(0, 2).join("/") : nameSegments[0];
      if (installed.name !== declaredName || installed.version !== declared.version) blockers.push({ code: "INSTALLED_PACKAGE_METADATA_MISMATCH", path: key });
    } catch (error) { blockers.push({ code: "INSTALLED_PACKAGE_METADATA_INVALID", path: key, message: String(error) }); }
  }
}

export function evaluateBuildReadiness(root) {
  const contract = validateDependencyContract(root);
  const blockers = [...contract.diagnostics];
  const lockFile = path.join(root, "package-lock.json");
  let projectLock = null;
  let requiredPaths = [];
  if (!fs.existsSync(lockFile)) {
    blockers.push({ code: "PACKAGE_LOCK_MISSING", message: "package-lock.json from npm install is required before a dependency-resolved browser build can be certified." });
  } else {
    try {
      projectLock = readJson(lockFile);
      if (projectLock.lockfileVersion !== 3) blockers.push({ code: "PACKAGE_LOCK_VERSION_UNSUPPORTED", value: projectLock.lockfileVersion });
      const rootPackage = projectLock.packages?.[""] ?? {};
      for (const [name, version] of Object.entries({ ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies })) {
        const actual = rootPackage.dependencies?.[name] ?? rootPackage.devDependencies?.[name];
        if (actual !== version) blockers.push({ code: "PACKAGE_LOCK_ROOT_VERSION_MISMATCH", package: name, expected: version, actual });
      }
      const closure = validatePackageLockClosure(projectLock, contract.policy);
      blockers.push(...closure.diagnostics);
      requiredPaths = closure.requiredPaths;
    } catch (error) {
      blockers.push({ code: "PACKAGE_LOCK_INVALID", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (projectLock) validateInstalledLock(root, projectLock, requiredPaths, blockers);

  const nodeModules = path.join(root, "node_modules");
  const all = { ...contract.policy.runtimeDependencies, ...contract.policy.developmentDependencies };
  const installed = [];
  for (const [name, expected] of Object.entries(all).sort(([a], [b]) => a.localeCompare(b))) {
    const packageJson = path.join(packageDir(nodeModules, name), "package.json");
    if (!fs.existsSync(packageJson)) {
      blockers.push({ code: "DEPENDENCY_NOT_INSTALLED", package: name, expected });
      continue;
    }
    try {
      const meta = readJson(packageJson);
      if (meta.name !== name) blockers.push({ code: "INSTALLED_PACKAGE_NAME_MISMATCH", package: name, actual: meta.name });
      if (meta.version !== expected) blockers.push({ code: "INSTALLED_PACKAGE_VERSION_MISMATCH", package: name, expected, actual: meta.version });
      installed.push({ name, version: meta.version, packageJsonSha256: sha256File(packageJson) });
    } catch (error) {
      blockers.push({ code: "INSTALLED_PACKAGE_METADATA_INVALID", package: name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ready: blockers.length === 0, blockers, installed };
}

const RUNTIME_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".ts", ".tsx"]);
const REMOTE_PATTERNS_BY_EXT = {
  ".html": [/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i],
  ".css": [/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i, /url\(\s*["']?(?:https?:)?\/\//i],
  ".js": [
    /\b(?:import|from)\s*(?:\(|)\s*["']https?:\/\//i,
    /\b(?:fetch|importScripts|Worker|SharedWorker)\s*\(\s*["']https?:\/\//i,
    /\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i,
  ],
  ".json": [/["'](?:src|href|start_url)["']\s*:\s*["'](?:https?:)?\/\//i],
};
REMOTE_PATTERNS_BY_EXT[".mjs"] = REMOTE_PATTERNS_BY_EXT[".js"];
REMOTE_PATTERNS_BY_EXT[".ts"] = REMOTE_PATTERNS_BY_EXT[".js"];
REMOTE_PATTERNS_BY_EXT[".tsx"] = REMOTE_PATTERNS_BY_EXT[".js"];
REMOTE_PATTERNS_BY_EXT[".webmanifest"] = REMOTE_PATTERNS_BY_EXT[".json"];

export function scanRemoteRuntimeReferences(root, relativeRoots = ["ui/public", "ui/src", "ui/app", "distribution/linux-x86_64/web"]) {
  const findings = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && RUNTIME_EXT.has(path.extname(entry.name))) {
        const text = fs.readFileSync(full, "utf8");
        const patterns = REMOTE_PATTERNS_BY_EXT[path.extname(entry.name)] ?? [];
        text.split(/\r?\n/).forEach((line, i) => {
          if (patterns.some((pattern) => pattern.test(line))) {
            findings.push({ file: path.relative(root, full), line: i + 1, text: line.trim().slice(0, 240) });
          }
        });
      }
    }
  };
  for (const rel of relativeRoots) walk(path.join(root, rel));
  return findings;
}
