import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const POLICY_FORMAT = "infrastructure-cyber-lab.license-inventory-policy";
const INVENTORY_FORMAT = "infrastructure-cyber-lab.third-party-inventory";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function sha256Text(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function key(entry) { return `${entry.scope}:${entry.name}`; }

export function validateLicensePolicy(root) {
  const dependencyPolicy = readJson(path.join(root, "dependencies/browser-runtime.policy.json"));
  const licensePolicy = readJson(path.join(root, "dependencies/license-inventory.policy.json"));
  const diagnostics = [];
  if (licensePolicy.formatId !== POLICY_FORMAT) diagnostics.push({ code: "LICENSE_POLICY_FORMAT_INVALID", message: `Unexpected license policy formatId '${licensePolicy.formatId ?? "missing"}'.` });
  if (licensePolicy.schemaVersion !== "1.0.0") diagnostics.push({ code: "LICENSE_POLICY_SCHEMA_UNSUPPORTED", message: `Unsupported license policy schema '${licensePolicy.schemaVersion ?? "missing"}'.` });
  if (!Array.isArray(licensePolicy.entries)) diagnostics.push({ code: "LICENSE_POLICY_ENTRIES_INVALID", message: "License policy entries must be an array." });

  const expected = new Map();
  for (const [name, version] of Object.entries(dependencyPolicy.runtimeDependencies ?? {})) expected.set(`runtime:${name}`, { name, version, scope: "runtime" });
  for (const [name, version] of Object.entries(dependencyPolicy.developmentDependencies ?? {})) expected.set(`development:${name}`, { name, version, scope: "development" });
  const seen = new Set();
  for (const entry of Array.isArray(licensePolicy.entries) ? licensePolicy.entries : []) {
    if (!entry || typeof entry !== "object") { diagnostics.push({ code: "LICENSE_POLICY_ENTRY_INVALID", message: "License entry must be an object." }); continue; }
    const k = key(entry);
    if (seen.has(k)) diagnostics.push({ code: "LICENSE_POLICY_DUPLICATE", package: entry.name, message: `Duplicate license entry '${k}'.` });
    seen.add(k);
    const exp = expected.get(k);
    if (!exp) diagnostics.push({ code: "LICENSE_POLICY_UNEXPECTED_PACKAGE", package: entry.name, message: `License policy contains unexpected ${k}.` });
    else if (entry.version !== exp.version) diagnostics.push({ code: "LICENSE_POLICY_VERSION_MISMATCH", package: entry.name, message: `${entry.name} license policy version '${entry.version}' does not match dependency pin '${exp.version}'.` });
    if (typeof entry.license !== "string" || !entry.license.trim()) diagnostics.push({ code: "LICENSE_POLICY_LICENSE_MISSING", package: entry.name, message: `License metadata missing for '${entry.name}'.` });
    if (typeof entry.purpose !== "string" || !entry.purpose.trim()) diagnostics.push({ code: "LICENSE_POLICY_PURPOSE_MISSING", package: entry.name, message: `Purpose missing for '${entry.name}'.` });
  }
  for (const [k, exp] of expected) if (!seen.has(k)) diagnostics.push({ code: "LICENSE_POLICY_PACKAGE_MISSING", package: exp.name, message: `License policy missing ${k}@${exp.version}.` });
  return { ok: diagnostics.length === 0, diagnostics, dependencyPolicy, licensePolicy };
}

function sortedEntries(entries) { return [...entries].sort((a, b) => a.scope.localeCompare(b.scope, "en") || a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en")); }

export function buildDeclaredInventory(root) {
  const checked = validateLicensePolicy(root);
  if (!checked.ok) throw new Error(`License policy invalid: ${checked.diagnostics.map((x) => `${x.code}:${x.message}`).join(" | ")}`);
  const policyHash = sha256Text(canonical(checked.licensePolicy));
  return {
    formatId: INVENTORY_FORMAT,
    schemaVersion: "1.0.0",
    status: "declared-direct-baseline",
    completeResolvedBundleInventory: false,
    sourcePolicySha256: policyHash,
    entries: sortedEntries(checked.licensePolicy.entries).map((entry) => ({ ...entry })),
    releaseGate: "A dependency-resolved production browser build must replace this baseline with bundle-resolved inventory before VERIFIED RELEASE.",
  };
}

function findPackageMetadata(root, inputFile) {
  let current = path.resolve(root, inputFile);
  if (!fs.existsSync(current)) return undefined;
  current = fs.statSync(current).isDirectory() ? current : path.dirname(current);
  const stop = path.resolve(root);
  while (current.startsWith(stop)) {
    const packageFile = path.join(current, "package.json");
    if (fs.existsSync(packageFile) && current.split(path.sep).includes("node_modules")) {
      const pkg = readJson(packageFile);
      if (typeof pkg.name === "string" && typeof pkg.version === "string") {
        const license = typeof pkg.license === "string" ? pkg.license : Array.isArray(pkg.licenses) ? pkg.licenses.map((x) => x?.type).filter(Boolean).join(" OR ") : undefined;
        if (!license) throw new Error(`Bundled package '${pkg.name}@${pkg.version}' has no machine-readable license field.`);
        return { name: pkg.name, version: pkg.version, license, packageRoot: path.relative(root, current).replaceAll(path.sep, "/") };
      }
    }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return undefined;
}

export function buildResolvedBundleInventory(root, metafile) {
  const checked = validateLicensePolicy(root);
  if (!checked.ok) throw new Error(`License policy invalid: ${checked.diagnostics.map((x) => `${x.code}:${x.message}`).join(" | ")}`);
  const packages = new Map();
  for (const input of Object.keys(metafile?.inputs ?? {})) {
    if (!input.includes("node_modules")) continue;
    const metadata = findPackageMetadata(root, input);
    if (!metadata) throw new Error(`Unable to resolve package metadata for bundled input '${input}'.`);
    const k = `${metadata.name}@${metadata.version}`;
    const existing = packages.get(k);
    if (existing && existing.license !== metadata.license) throw new Error(`Conflicting license metadata for '${k}'.`);
    packages.set(k, metadata);
  }
  const bundled = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
  if (!bundled.length) throw new Error("Resolved browser bundle inventory is empty; refusing to claim dependency-resolved notices.");
  return {
    formatId: INVENTORY_FORMAT,
    schemaVersion: "1.0.0",
    status: "bundle-resolved",
    completeResolvedBundleInventory: true,
    sourcePolicySha256: sha256Text(canonical(checked.licensePolicy)),
    bundledRuntimeComponents: bundled,
    directDependencyPolicy: sortedEntries(checked.licensePolicy.entries).map((entry) => ({ ...entry })),
  };
}

export function renderThirdPartyNotices(inventory) {
  const lines = ["# Third-party notices", "", `Inventory status: **${inventory.status}**.`, ""];
  if (inventory.status === "declared-direct-baseline") {
    lines.push("This deterministic baseline is generated from the exact direct dependency/license policies. It is not a claim that transitive bundle resolution has run in this environment.", "");
    for (const scope of ["runtime", "development"]) {
      lines.push(scope === "runtime" ? "## Declared runtime dependencies" : "## Development-only tools", "");
      for (const entry of inventory.entries.filter((x) => x.scope === scope)) lines.push(`- ${entry.name} ${entry.version} — ${entry.license} — ${entry.purpose}`);
      lines.push("");
    }
    lines.push("Release gate: a dependency-resolved production browser build must regenerate this inventory from the actual esbuild bundle and installed package metadata before VERIFIED RELEASE.", "");
  } else {
    lines.push("## Bundled runtime components", "");
    for (const entry of inventory.bundledRuntimeComponents) lines.push(`- ${entry.name} ${entry.version} — ${entry.license}`);
    lines.push("", "## Direct dependency policy", "");
    for (const entry of inventory.directDependencyPolicy) lines.push(`- ${entry.name} ${entry.version} — ${entry.license} — ${entry.scope}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeInventoryArtifacts(root, inventory, destinations = {}) {
  const inventoryPath = destinations.inventoryPath ?? path.join(root, "dependencies/third-party-inventory.json");
  const noticesPath = destinations.noticesPath ?? path.join(root, "THIRD_PARTY_NOTICES.md");
  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  fs.mkdirSync(path.dirname(noticesPath), { recursive: true });
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  fs.writeFileSync(noticesPath, renderThirdPartyNotices(inventory));
  // These are tracked/generated source artifacts and source identity includes Unix mode.
  // Enforce canonical non-executable modes after every write so umask cannot drift identity.
  fs.chmodSync(inventoryPath, 0o644);
  fs.chmodSync(noticesPath, 0o644);
  return { inventoryPath, noticesPath };
}
