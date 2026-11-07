/** Strict, dependency-free integrity preflight for a dependency-resolved browser
 * distribution. This proves artifact completeness, NOT that React booted (the
 * separate real-Chromium acceptance gate remains mandatory).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;
const FORMAT = "infrastructure-cyber-lab.browser-build";
const REQUIRED = ["index.html", "sw.js", "manifest.webmanifest", "app-shell.js", "assets/app.js", "THIRD_PARTY_NOTICES.md", "third-party-inventory.json"];
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fail(code, message) { return { code, message }; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

export function verifyBrowserRelease(dir) {
  const errors = [];
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory()) return { ok: false, errors: [fail("BROWSER_RELEASE_DIR_MISSING", "A built browser directory is required.")] };
  const mf = path.join(dir, "browser-build-manifest.json");
  if (!fs.existsSync(mf) || !fs.lstatSync(mf).isFile()) return { ok: false, errors: [fail("BROWSER_RELEASE_MANIFEST_MISSING", "No browser-build-manifest.json.")] };
  let manifest;
  try { manifest = readJson(mf); } catch { return { ok: false, errors: [fail("BROWSER_RELEASE_MANIFEST_INVALID", "The browser manifest is invalid JSON.")] }; }
  if (manifest?.formatId !== FORMAT || manifest?.schemaVersion !== "1.0.0" || manifest?.status !== "ready" || manifest?.buildTool?.name !== "esbuild" || typeof manifest?.buildTool?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.buildTool.version) || !manifest?.dependencyPins || typeof manifest.dependencyPins !== "object" || Array.isArray(manifest.dependencyPins) || !Array.isArray(manifest.files)) {
    return { ok: false, errors: [fail("BROWSER_RELEASE_MANIFEST_CONTRACT", "Unrecognized or incomplete ready browser manifest.")] };
  }
  const listed = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.name !== "string" || !SAFE_PATH.test(entry.name) || entry.name === "browser-build-manifest.json" || !SHA.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 128 * 1024 * 1024) {
      errors.push(fail("BROWSER_RELEASE_FILE_ENTRY_INVALID", `Invalid release file entry '${entry?.name ?? "?"}'.`));
      continue;
    }
    if (listed.has(entry.name)) {
      errors.push(fail("BROWSER_RELEASE_DUPLICATE_FILE", `Repeated manifest file '${entry.name}'.`));
      continue;
    }
    listed.set(entry.name, entry);
  }
  for (const name of REQUIRED) if (!listed.has(name)) errors.push(fail("BROWSER_RELEASE_REQUIRED_FILE_MISSING", `Required file '${name}' is not listed.`));
  const disk = new Set();
  function walk(base, rel = "") {
    for (const item of fs.readdirSync(base, { withFileTypes: true })) {
      const name = rel ? `${rel}/${item.name}` : item.name;
      if (!SAFE_PATH.test(name)) { errors.push(fail("BROWSER_RELEASE_UNSAFE_DISK_PATH", `Unsafe disk path '${name}'.`)); continue; }
      const full = path.join(base, item.name);
      if (item.isSymbolicLink()) { errors.push(fail("BROWSER_RELEASE_SYMLINK", `Symlink '${name}' forbidden.`)); continue; }
      if (item.isDirectory()) walk(full, name);
      else if (item.isFile()) {
        disk.add(name);
        if (name === "browser-build-manifest.json") continue;
        const entry = listed.get(name);
        if (!entry) { errors.push(fail("BROWSER_RELEASE_UNLISTED_FILE", `Unlisted file '${name}'.`)); continue; }
        const size = fs.statSync(full).size;
        if (size !== entry.size) { errors.push(fail("BROWSER_RELEASE_SIZE_MISMATCH", `Size differs for '${name}'.`)); continue; }
        if (hash(fs.readFileSync(full)) !== entry.sha256) errors.push(fail("BROWSER_RELEASE_HASH_MISMATCH", `Hash differs for '${name}'.`));
      } else errors.push(fail("BROWSER_RELEASE_UNEXPECTED_ENTRY", `Unexpected filesystem entry '${name}'.`));
    }
  }
  walk(dir);
  for (const name of listed.keys()) if (!disk.has(name)) errors.push(fail("BROWSER_RELEASE_LISTED_FILE_MISSING", `Manifest file '${name}' is absent.`));
  if (errors.length) return { ok: false, errors };
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const shellTag = '<script type="module" src="./app-shell.js"></script>';
  const appTag = '<script type="module" src="./assets/app.js"></script>';
  const shellPos = html.indexOf(shellTag);
  const appPos = html.indexOf(appTag);
  if (!html.includes('data-app-runtime="booting"') || html.includes('data-app-runtime="ready"') ||
      shellPos < 0 || appPos < 0 || shellPos > appPos) {
    errors.push(fail("BROWSER_RELEASE_BOOTSTRAP_INVALID", "Index must load the local service-worker bootstrap before the local app bundle, and never claim runtime ready from static HTML."));
  }
  const bootstrap = fs.readFileSync(path.join(dir, "app-shell.js"), "utf8");
  if (!bootstrap.includes('serviceWorker.register("./sw.js"') || /https?:\/\//i.test(bootstrap)) {
    errors.push(fail("BROWSER_RELEASE_SW_BOOTSTRAP_INVALID", "Ready browser release must register only the packaged local ./sw.js service worker."));
  }
  if (listed.has("assets/app.css") && !html.includes('href="./assets/app.css"')) errors.push(fail("BROWSER_RELEASE_CSS_NOT_LINKED", "Bundled stylesheet is not linked."));
  const app = fs.readFileSync(path.join(dir, "assets/app.js"));
  if (!app.length) errors.push(fail("BROWSER_RELEASE_JS_EMPTY", "JS bundle must not be empty."));
  const notices = fs.readFileSync(path.join(dir, "THIRD_PARTY_NOTICES.md"), "utf8");
  let inventory;
  try { inventory = readJson(path.join(dir, "third-party-inventory.json")); }
  catch { errors.push(fail("BROWSER_RELEASE_INVENTORY_INVALID", "Unparseable license inventory.")); }
  if (!notices.trim() || inventory?.status !== "bundle-resolved" || !Array.isArray(inventory.bundledRuntimeComponents)) {
    errors.push(fail("BROWSER_RELEASE_INVENTORY_NOT_RESOLVED", "Only bundle-resolved license inventory may ship with a ready browser bundle."));
  }
  // Fail if a ready manifest omits a runtime pin. This is not a substitute for
  // the independent npm lock + installed-metadata dependency readiness gate.
  const policyFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dependencies/browser-runtime.policy.json");
  const policy = readJson(policyFile);
  if (JSON.stringify(Object.entries(manifest.dependencyPins).sort()) !== JSON.stringify(Object.entries(policy.runtimeDependencies).sort())) {
    errors.push(fail("BROWSER_RELEASE_DEPENDENCY_PINS_MISMATCH", "Built manifest's runtime pins differ from the locked runtime policy."));
  }
  // The service worker must describe the exact distributed files it precaches;
  // otherwise an integrity-named cache can still carry stale/missing assets.
  const sw = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  const match = sw.match(/const CORE_ASSETS=(\[[^;]+\]);/);
  if (!sw.includes("PWA_HASH_MISMATCH") || !sw.includes("infra-lab-pwa-browser-") || !match) {
    errors.push(fail("BROWSER_RELEASE_SW_INVALID", "Release-scoped, hash-verifying browser service worker required."));
  } else {
    try {
      const entries = JSON.parse(match[1]);
      const expected = new Map();
      for (const [name, entry] of listed) {
        if (!["sw.js", "acceptance.html", "acceptance-probe.js"].includes(name)) expected.set(`./${name}`, entry.sha256);
      }
      expected.set("./", listed.get("index.html")?.sha256);
      if (!Array.isArray(entries) || entries.length !== expected.size || entries.some(e => expected.get(e.path) !== e.sha256) || new Set(entries.map(e=>e.path)).size !== entries.length) {
        errors.push(fail("BROWSER_RELEASE_SW_ASSET_MISMATCH", "SW precache hashes do not match complete release files."));
      }
    } catch { errors.push(fail("BROWSER_RELEASE_SW_ASSET_INVALID", "Could not parse SW asset inventory.")); }
  }
  return { ok: errors.length === 0, errors, filesVerified: listed.size };
}
