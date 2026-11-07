import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { renderServiceWorker } from "./pwa-cache-lib.mjs";
import { verifyBrowserRelease } from "./browser-release-verifier.mjs";
import { fileURLToPath } from "node:url";
import { evaluateBuildReadiness, scanRemoteRuntimeReferences } from "./dependency-contract-lib.mjs";
import { buildResolvedBundleInventory, writeInventoryArtifacts } from "./third-party-notices-lib.mjs";
import { attestInstalledBrowserToolchain } from "./browser-toolchain-attestation-node.mjs";
import { renderBrowserIndex } from "./browser-index-template.mjs";
import { readReleaseContract, assertBundledRelease, assertGitBundleInputs } from "./release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = readReleaseContract(root);
const readiness = evaluateBuildReadiness(root);
if (!readiness.ready) {
  console.error(JSON.stringify({ status: "BLOCKED", reason: "dependency-readiness", blockers: readiness.blockers }, null, 2));
  process.exit(77);
}
const toolchain = await attestInstalledBrowserToolchain(root, readiness);
if (toolchain.status !== "PASS") {
  console.error(JSON.stringify({ status: "FAIL", reason: "browser-toolchain-execution", passed: toolchain.result?.passed ?? [], failures: toolchain.result?.failures ?? [] }, null, 2));
  process.exit(1);
}

const esbuild = await import("esbuild");
const out = path.join(root, "ui/dist");
const temp = path.join(root, "ui/.dist-browser-tmp");
fs.rmSync(temp, { recursive: true, force: true });
fs.mkdirSync(path.join(temp, "assets"), { recursive: true });
fs.cpSync(path.join(root, "asset-library/builtin"), path.join(temp, "assets/builtin"), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, "ui/app/main.mjs")],
  outfile: path.join(temp, "assets/app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  metafile: true,
  legalComments: "external",
  define: { "process.env.NODE_ENV": '"production"', "__YADILAB_SOURCE_COMMIT__": JSON.stringify(release.sourceCommit) },
  loader: { ".json": "json" },
});

// Check actual esbuild dependency graph: local source is tracked in this checkout.
assertGitBundleInputs(root, result.metafile);
const resolvedInventory = buildResolvedBundleInventory(root, result.metafile);
writeInventoryArtifacts(root, resolvedInventory, {
  inventoryPath: path.join(temp, "third-party-inventory.json"),
  noticesPath: path.join(temp, "THIRD_PARTY_NOTICES.md"),
});

const publicFiles = ["acceptance.html", "acceptance-probe.js", "manifest.webmanifest", "app-shell.js"];
for (const file of publicFiles) fs.copyFileSync(path.join(root, "ui/public", file), path.join(temp, file));
fs.writeFileSync(path.join(temp, "build-marker.json"), `${JSON.stringify({
  formatId: "yadilab.browser-build-marker",
  version: release.version,
  marker: `yadilab-v${release.version}`,
  checkpoint: release.checkpoint,
  sourceCommit: release.sourceCommit,
  sourceTree: release.sourceTree,
}, null, 2)}\n`);
const branding = JSON.parse(fs.readFileSync(path.join(root, "app-config/branding.json"), "utf8"));
const cssExists = fs.existsSync(path.join(temp, "assets/app.css"));
const index = renderBrowserIndex({ title: branding.displayName, cssExists });
fs.writeFileSync(path.join(temp, "index.html"), index);

function filesRecursively(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesRecursively(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
let files = filesRecursively(temp).map((file) => path.relative(temp, file).replaceAll(path.sep, "/")).sort();
const cacheFiles = files.filter((file) => file !== "acceptance.html" && file !== "acceptance-probe.js");
const cachePaths = ["./", ...cacheFiles.map((x) => `./${x}`)];
const cacheEntries = cachePaths.map((entry) => ({
  path: entry,
  sha256: hash(path.join(temp, entry === "./" ? "index.html" : entry.slice(2))),
}));
const sw = renderServiceWorker("browser", cacheEntries);
fs.writeFileSync(path.join(temp, "sw.js"), sw);
files = filesRecursively(temp).map((file) => path.relative(temp, file).replaceAll(path.sep, "/")).sort();
const manifest = {
  formatId: "infrastructure-cyber-lab.browser-build",
  schemaVersion: "1.0.0",
  status: "ready",
  buildTool: { name: "esbuild", version: readiness.installed.find((x) => x.name === "esbuild")?.version ?? "unknown" },
  dependencyPins: JSON.parse(fs.readFileSync(path.join(root, "dependencies/browser-runtime.policy.json"), "utf8")).runtimeDependencies,
  files: files.map((name) => ({ name, sha256: hash(path.join(temp, name)), size: fs.statSync(path.join(temp, name)).size })),
};
fs.writeFileSync(path.join(temp, "browser-build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const remote = scanRemoteRuntimeReferences(root, [path.relative(root, temp)]);
if (remote.length) {
  console.error(JSON.stringify({ status: "FAIL", reason: "remote-runtime-reference", findings: remote }, null, 2));
  process.exit(1);
}
assertBundledRelease(temp, release);
const releasePreflight = verifyBrowserRelease(temp);
if (!releasePreflight.ok) {
  console.error(JSON.stringify({ status: "FAIL", reason: "browser-release-preflight", diagnostics: releasePreflight.errors }, null, 2));
  process.exit(1);
}
const previous = path.join(root, "ui/.dist-browser-previous");
if (fs.existsSync(previous)) throw new Error("Stale previous browser distribution; refusing unsafe promotion.");
if (fs.existsSync(out)) fs.renameSync(out, previous);
try { fs.renameSync(temp, out); }
catch (cause) {
  if (fs.existsSync(previous) && !fs.existsSync(out)) fs.renameSync(previous, out);
  throw cause;
}
if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
fs.copyFileSync(path.join(out, "THIRD_PARTY_NOTICES.md"), path.join(root, "THIRD_PARTY_NOTICES.md"));
fs.copyFileSync(path.join(out, "third-party-inventory.json"), path.join(root, "dependencies/third-party-inventory.json"));
console.log(`PASS browser application bundle: ${manifest.files.length} hashed local files; esbuild metafile outputs=${Object.keys(result.metafile?.outputs ?? {}).length}; resolved third-party inventory=${resolvedInventory.bundledRuntimeComponents.length} packages.`);
