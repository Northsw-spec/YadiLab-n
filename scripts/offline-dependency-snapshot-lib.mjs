import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateDependencyContract, validatePackageLockClosure } from "./dependency-contract-lib.mjs";
import { computeSourceCheckoutIdentity, SOURCE_CHECKOUT_ID_SCHEMA_VERSION } from "./source-checkout-identity.mjs";
import { PROVENANCE_JSON, PROVENANCE_SIGNATURE, verifySnapshotProvenance } from "./offline-snapshot-provenance-lib.mjs";

export const SNAPSHOT_FORMAT_ID = "infrastructure-cyber-lab.offline-dependency-snapshot";
export const SNAPSHOT_SCHEMA_VERSION = "1.2.0";
const SHA256 = /^[0-9a-f]{64}$/;
const NODE_VERSION = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const NPM_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const KERNEL_VALUE = /^[^\0\r\n]{1,256}$/;

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function relPathSafe(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !value.startsWith("/") && !value.startsWith("\\") && !value.includes("\\") &&
    !value.includes("\0") && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function walkFiles(root, relative = "") {
  const dir = path.join(root, relative);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Snapshot symlink is forbidden: ${rel}`);
    if (entry.isDirectory()) out.push(...walkFiles(root, rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`Unsupported snapshot filesystem entry: ${rel}`);
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function add(diags, code, fields = {}) {
  diags.push({ code, ...fields });
}

export function validateDevelopmentPlatformMetadata(value) {
  const diagnostics = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, diagnostics: [{ code: "SNAPSHOT_PLATFORM_METADATA_NOT_OBJECT" }] };
  }
  if (value.platform !== "linux") add(diagnostics, "SNAPSHOT_PLATFORM_METADATA_PLATFORM_INVALID", { actual: value.platform });
  if (value.arch !== "x86_64") add(diagnostics, "SNAPSHOT_PLATFORM_METADATA_ARCH_INVALID", { actual: value.arch });
  if (!NODE_VERSION.test(value.node ?? "")) add(diagnostics, "SNAPSHOT_PLATFORM_METADATA_NODE_INVALID", { actual: value.node });
  if (!NPM_VERSION.test(value.npm ?? "")) add(diagnostics, "SNAPSHOT_PLATFORM_METADATA_NPM_INVALID", { actual: value.npm });
  if (!KERNEL_VALUE.test(value.kernel ?? "")) add(diagnostics, "SNAPSHOT_PLATFORM_METADATA_KERNEL_INVALID", { actual: value.kernel });
  return { ok: diagnostics.length === 0, diagnostics };
}


export function validateSnapshotConsumerEnvironment(manifest, runtime = {}) {
  const diagnostics = [];
  const expectedTarget = manifest?.target ?? {};
  const expectedPrepared = manifest?.preparedWith ?? {};
  const actualPlatform = runtime.platform ?? process.platform;
  const actualArchRaw = runtime.arch ?? process.arch;
  const actualArch = actualArchRaw === "x64" ? "x86_64" : actualArchRaw;
  const actualNode = runtime.node ?? process.version;
  const actualNpm = runtime.npm ?? null;

  if (expectedTarget.platform !== "linux" || expectedTarget.arch !== "x86_64") {
    add(diagnostics, "SNAPSHOT_CONSUMER_TARGET_METADATA_INVALID", { target: expectedTarget });
  }
  if (actualPlatform !== expectedTarget.platform) {
    add(diagnostics, "SNAPSHOT_CONSUMER_PLATFORM_MISMATCH", { expected: expectedTarget.platform, actual: actualPlatform });
  }
  if (actualArch !== expectedTarget.arch) {
    add(diagnostics, "SNAPSHOT_CONSUMER_ARCH_MISMATCH", { expected: expectedTarget.arch, actual: actualArch });
  }
  if (!NODE_VERSION.test(expectedPrepared.node ?? "")) {
    add(diagnostics, "SNAPSHOT_CONSUMER_PREPARED_NODE_INVALID", { expected: expectedPrepared.node });
  } else if (actualNode !== expectedPrepared.node) {
    add(diagnostics, "SNAPSHOT_CONSUMER_NODE_MISMATCH", { expected: expectedPrepared.node, actual: actualNode });
  }
  if (!NPM_VERSION.test(expectedPrepared.npm ?? "")) {
    add(diagnostics, "SNAPSHOT_CONSUMER_PREPARED_NPM_INVALID", { expected: expectedPrepared.npm });
  } else if (actualNpm !== expectedPrepared.npm) {
    add(diagnostics, "SNAPSHOT_CONSUMER_NPM_MISMATCH", { expected: expectedPrepared.npm, actual: actualNpm });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

function readDevelopmentPlatform(snapshot) {
  const file = path.join(snapshot, "development-platform.json");
  if (!fs.existsSync(file)) return { ok: false, diagnostics: [{ code: "SNAPSHOT_PLATFORM_METADATA_MISSING" }] };
  let value;
  try { value = readJson(file); }
  catch (error) { return { ok: false, diagnostics: [{ code: "SNAPSHOT_PLATFORM_METADATA_INVALID_JSON", message: String(error) }] }; }
  const result = validateDevelopmentPlatformMetadata(value);
  return { ...result, value };
}

export function buildOfflineDependencySnapshotManifest(sourceRoot, snapshotRoot, platform = {}) {
  const source = path.resolve(sourceRoot);
  const snapshot = path.resolve(snapshotRoot);
  const required = ["package-lock.json", "SHA256SUMS.txt", "development-platform.json"];
  for (const rel of required) {
    if (!fs.existsSync(path.join(snapshot, rel))) throw new Error(`Missing snapshot file: ${rel}`);
  }
  if (!fs.existsSync(path.join(snapshot, "npm-cache")) || !fs.statSync(path.join(snapshot, "npm-cache")).isDirectory()) {
    throw new Error("Missing snapshot npm-cache directory.");
  }
  const contract = validateDependencyContract(source);
  if (!contract.ok) throw new Error(`Source dependency contract invalid: ${JSON.stringify(contract.diagnostics)}`);
  const developmentPlatform = readDevelopmentPlatform(snapshot);
  if (!developmentPlatform.ok) throw new Error(`Snapshot development platform invalid: ${JSON.stringify(developmentPlatform.diagnostics)}`);
  if (platform.node != null && platform.node !== developmentPlatform.value.node) {
    throw new Error(`Snapshot preparation Node mismatch: expected ${platform.node}, metadata ${developmentPlatform.value.node}`);
  }
  if (platform.npm != null && platform.npm !== developmentPlatform.value.npm) {
    throw new Error(`Snapshot preparation npm mismatch: expected ${platform.npm}, metadata ${developmentPlatform.value.npm}`);
  }
  const lock = readJson(path.join(snapshot, "package-lock.json"));
  const closure = validatePackageLockClosure(lock, contract.policy);
  if (!closure.ok) throw new Error(`Snapshot package-lock invalid: ${JSON.stringify(closure.diagnostics)}`);

  const all = walkFiles(snapshot).filter((rel) => rel !== "snapshot-manifest.json" && rel !== PROVENANCE_JSON && rel !== PROVENANCE_SIGNATURE).sort((a, b) => a.localeCompare(b));
  if (!all.some((rel) => rel.startsWith("npm-cache/"))) throw new Error("Snapshot npm-cache is empty.");
  const files = all.map((rel) => {
    const full = path.join(snapshot, rel);
    return { path: rel, size: fs.statSync(full).size, sha256: sha256File(full) };
  });
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  const manifest = {
    formatId: SNAPSHOT_FORMAT_ID,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    target: { platform: developmentPlatform.value.platform, arch: developmentPlatform.value.arch },
    preparedWith: {
      node: developmentPlatform.value.node,
      npm: developmentPlatform.value.npm,
    },
    sourceContract: {
      packageJsonSha256: sha256File(path.join(source, "package.json")),
      dependencyPolicySha256: sha256File(path.join(source, "dependencies/browser-runtime.policy.json")),
      packageLockSha256: sha256File(path.join(snapshot, "package-lock.json")),
      sourceCheckout: computeSourceCheckoutIdentity(source),
    },
    requiredLockPackageCount: closure.requiredPaths.length,
    fileCount: files.length,
    totalBytes,
    files,
  };
  return manifest;
}

export function writeOfflineDependencySnapshotManifest(sourceRoot, snapshotRoot, platform = {}) {
  const manifest = buildOfflineDependencySnapshotManifest(sourceRoot, snapshotRoot, platform);
  fs.writeFileSync(path.join(snapshotRoot, "snapshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyOfflineDependencySnapshot(sourceRoot, snapshotRoot, options = {}) {
  const requireProvenance = options.requireProvenance !== false;
  const source = path.resolve(sourceRoot);
  const snapshot = path.resolve(snapshotRoot);
  const diagnostics = [];
  const manifestPath = path.join(snapshot, "snapshot-manifest.json");
  if (!fs.existsSync(manifestPath)) return { ok: false, diagnostics: [{ code: "SNAPSHOT_MANIFEST_MISSING" }] };
  let manifest;
  try { manifest = readJson(manifestPath); }
  catch (error) { return { ok: false, diagnostics: [{ code: "SNAPSHOT_MANIFEST_INVALID_JSON", message: String(error) }] }; }

  if (manifest?.formatId !== SNAPSHOT_FORMAT_ID || manifest?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    add(diagnostics, "SNAPSHOT_MANIFEST_CONTRACT_INVALID");
  }
  if (manifest?.target?.platform !== "linux" || manifest?.target?.arch !== "x86_64") {
    add(diagnostics, "SNAPSHOT_TARGET_INVALID", { target: manifest?.target });
  }
  const developmentPlatform = readDevelopmentPlatform(snapshot);
  if (!developmentPlatform.ok) diagnostics.push(...developmentPlatform.diagnostics);
  else {
    if (manifest?.target?.platform !== developmentPlatform.value.platform || manifest?.target?.arch !== developmentPlatform.value.arch) {
      add(diagnostics, "SNAPSHOT_TARGET_PLATFORM_METADATA_MISMATCH", { target: manifest?.target, metadata: { platform: developmentPlatform.value.platform, arch: developmentPlatform.value.arch } });
    }
    if (manifest?.preparedWith?.node !== developmentPlatform.value.node) {
      add(diagnostics, "SNAPSHOT_PREPARED_NODE_MISMATCH", { expected: developmentPlatform.value.node, actual: manifest?.preparedWith?.node });
    }
    if (manifest?.preparedWith?.npm !== developmentPlatform.value.npm) {
      add(diagnostics, "SNAPSHOT_PREPARED_NPM_MISMATCH", { expected: developmentPlatform.value.npm, actual: manifest?.preparedWith?.npm });
    }
  }
  if (!Array.isArray(manifest?.files) || !Number.isSafeInteger(manifest?.fileCount) || !Number.isSafeInteger(manifest?.totalBytes)) {
    add(diagnostics, "SNAPSHOT_FILE_TABLE_INVALID");
    return { ok: false, diagnostics, manifest };
  }

  let contract;
  try { contract = validateDependencyContract(source); }
  catch (error) { add(diagnostics, "SNAPSHOT_SOURCE_CONTRACT_READ_FAILED", { message: String(error) }); }
  if (contract && !contract.ok) add(diagnostics, "SNAPSHOT_SOURCE_DEPENDENCY_CONTRACT_INVALID", { issues: contract.diagnostics });

  const entries = manifest.files;
  const seen = new Set();
  let previous = "";
  let declaredBytes = 0;
  for (const item of entries) {
    if (!item || !relPathSafe(item.path) || !Number.isSafeInteger(item.size) || item.size < 0 || !SHA256.test(item.sha256 ?? "")) {
      add(diagnostics, "SNAPSHOT_FILE_ENTRY_INVALID", { entry: item });
      continue;
    }
    if (seen.has(item.path)) add(diagnostics, "SNAPSHOT_DUPLICATE_FILE", { path: item.path });
    seen.add(item.path);
    if (previous && item.path.localeCompare(previous) < 0) add(diagnostics, "SNAPSHOT_FILE_TABLE_NOT_SORTED", { path: item.path, previous });
    previous = item.path;
    declaredBytes += item.size;
    const full = path.join(snapshot, ...item.path.split("/"));
    let stat;
    try { stat = fs.lstatSync(full); }
    catch { add(diagnostics, "SNAPSHOT_LISTED_FILE_MISSING", { path: item.path }); continue; }
    if (stat.isSymbolicLink()) { add(diagnostics, "SNAPSHOT_SYMLINK", { path: item.path }); continue; }
    if (!stat.isFile()) { add(diagnostics, "SNAPSHOT_LISTED_ENTRY_NOT_FILE", { path: item.path }); continue; }
    if (stat.size !== item.size) add(diagnostics, "SNAPSHOT_FILE_SIZE_MISMATCH", { path: item.path, expected: item.size, actual: stat.size });
    const actualHash = sha256File(full);
    if (actualHash !== item.sha256) add(diagnostics, "SNAPSHOT_FILE_HASH_MISMATCH", { path: item.path, expected: item.sha256, actual: actualHash });
  }
  if (manifest.fileCount !== entries.length) add(diagnostics, "SNAPSHOT_FILE_COUNT_MISMATCH", { expected: manifest.fileCount, actual: entries.length });
  if (manifest.totalBytes !== declaredBytes) add(diagnostics, "SNAPSHOT_TOTAL_BYTES_MISMATCH", { expected: manifest.totalBytes, actual: declaredBytes });

  let actualFiles = [];
  try { actualFiles = walkFiles(snapshot).filter((rel) => rel !== "snapshot-manifest.json" && rel !== PROVENANCE_JSON && rel !== PROVENANCE_SIGNATURE).sort((a, b) => a.localeCompare(b)); }
  catch (error) { add(diagnostics, "SNAPSHOT_FILESYSTEM_INVALID", { message: String(error) }); }
  for (const rel of actualFiles) if (!seen.has(rel)) add(diagnostics, "SNAPSHOT_UNLISTED_FILE", { path: rel });
  const actualFileSet = new Set(actualFiles);
  for (const rel of seen) if (!actualFileSet.has(rel)) add(diagnostics, "SNAPSHOT_LISTED_FILE_MISSING", { path: rel });
  if (!seen.has("package-lock.json")) add(diagnostics, "SNAPSHOT_PACKAGE_LOCK_NOT_LISTED");
  if (!seen.has("SHA256SUMS.txt")) add(diagnostics, "SNAPSHOT_LEGACY_CHECKSUM_NOT_LISTED");
  if (!seen.has("development-platform.json")) add(diagnostics, "SNAPSHOT_PLATFORM_FILE_NOT_LISTED");
  if (![...seen].some((rel) => rel.startsWith("npm-cache/"))) add(diagnostics, "SNAPSHOT_NPM_CACHE_EMPTY");

  const sourceContract = manifest.sourceContract ?? {};
  const packageJson = path.join(source, "package.json");
  const policy = path.join(source, "dependencies/browser-runtime.policy.json");
  const lockPath = path.join(snapshot, "package-lock.json");
  if (!SHA256.test(sourceContract.packageJsonSha256 ?? "") || !fs.existsSync(packageJson) || sourceContract.packageJsonSha256 !== sha256File(packageJson)) {
    add(diagnostics, "SNAPSHOT_SOURCE_PACKAGE_JSON_MISMATCH");
  }
  if (!SHA256.test(sourceContract.dependencyPolicySha256 ?? "") || !fs.existsSync(policy) || sourceContract.dependencyPolicySha256 !== sha256File(policy)) {
    add(diagnostics, "SNAPSHOT_SOURCE_POLICY_MISMATCH");
  }
  if (!SHA256.test(sourceContract.packageLockSha256 ?? "") || !fs.existsSync(lockPath) || sourceContract.packageLockSha256 !== sha256File(lockPath)) {
    add(diagnostics, "SNAPSHOT_PACKAGE_LOCK_HASH_MISMATCH");
  }
  const declaredCheckout = sourceContract.sourceCheckout;
  let actualCheckout = null;
  try { actualCheckout = computeSourceCheckoutIdentity(source); }
  catch (error) { add(diagnostics, "SNAPSHOT_SOURCE_CHECKOUT_READ_FAILED", { message: String(error) }); }
  if (!declaredCheckout || declaredCheckout.schemaVersion !== SOURCE_CHECKOUT_ID_SCHEMA_VERSION ||
      !SHA256.test(declaredCheckout.sha256 ?? "") || !Number.isSafeInteger(declaredCheckout.fileCount) || declaredCheckout.fileCount < 1 ||
      !Number.isSafeInteger(declaredCheckout.totalBytes) || declaredCheckout.totalBytes < 1) {
    add(diagnostics, "SNAPSHOT_SOURCE_CHECKOUT_IDENTITY_INVALID", { actual: declaredCheckout });
  } else if (actualCheckout && (declaredCheckout.sha256 !== actualCheckout.sha256 ||
      declaredCheckout.fileCount !== actualCheckout.fileCount || declaredCheckout.totalBytes !== actualCheckout.totalBytes)) {
    add(diagnostics, "SNAPSHOT_SOURCE_CHECKOUT_MISMATCH", { expected: declaredCheckout, actual: actualCheckout });
  }

  if (fs.existsSync(lockPath) && contract) {
    try {
      const lock = readJson(lockPath);
      const closure = validatePackageLockClosure(lock, contract.policy);
      if (!closure.ok) add(diagnostics, "SNAPSHOT_PACKAGE_LOCK_INVALID", { issues: closure.diagnostics });
      else if (manifest.requiredLockPackageCount !== closure.requiredPaths.length) add(diagnostics, "SNAPSHOT_LOCK_PACKAGE_COUNT_MISMATCH", { expected: manifest.requiredLockPackageCount, actual: closure.requiredPaths.length });
    } catch (error) { add(diagnostics, "SNAPSHOT_PACKAGE_LOCK_INVALID_JSON", { message: String(error) }); }
  }

  let provenance = { ok: true, diagnostics: [], provenance: null };
  if (requireProvenance) {
    provenance = verifySnapshotProvenance(source, snapshot, manifest);
    if (!provenance.ok) diagnostics.push(...provenance.diagnostics);
  }

  return { ok: diagnostics.length === 0, diagnostics, manifest, provenance: provenance.provenance };
}
