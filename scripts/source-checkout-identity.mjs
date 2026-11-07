import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SOURCE_CHECKOUT_ID_SCHEMA_VERSION = "1.0.0";

// Generated/developer-local state is deliberately excluded. Everything else in
// the release checkout is part of the source identity, including scripts,
// application code, tests, docs, policies, schemas and checked-in assets.
function isExcluded(relative, entryName, isDirectory) {
  const parts = relative ? relative.split("/") : [];
  const top = parts[0] ?? entryName;
  if (top === ".git" || top === "node_modules" || top === "distribution") return true;
  if (top === "ui" && parts[1] === "dist") return true;
  if (top === "ui" && parts[1] === "dist-shell") return true;
  if (parts.includes("node_modules") || parts.includes(".git")) return true;
  if (!isDirectory && relative === "package-lock.json") return true;
  if (!isDirectory && ["launcher-smoke.log", "launcher-smoke-index.out", "parrot-acceptance-report.json", "parrot-acceptance-report.txt"].includes(relative)) return true;
  if (isDirectory && parts.length === 1 && /^dist-[A-Za-z0-9._-]+-test$/.test(top)) return true;
  if (isDirectory && top === "distribution" && /^\.linux-x86_64-(?:stage|previous)-/.test(parts[1] ?? "")) return true;
  return false;
}

function compareNames(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(root, relative = "") {
  const dir = path.join(root, relative);
  const rows = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareNames(a.name, b.name));
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(root, ...rel.split("/"));
    const stat = fs.lstatSync(full);
    if (isExcluded(rel, entry.name, entry.isDirectory())) continue;
    if (stat.isSymbolicLink()) throw new Error(`Source checkout symlink is forbidden: ${rel}`);
    if (entry.isDirectory()) rows.push(...walk(root, rel));
    else if (entry.isFile()) {
      rows.push({
        path: rel,
        size: stat.size,
        mode: stat.mode & 0o777,
        sha256: sha256File(full),
      });
    } else throw new Error(`Unsupported source checkout filesystem entry: ${rel}`);
  }
  return rows;
}

export function listSourceCheckoutFiles(sourceRoot) {
  const root = path.resolve(sourceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Source checkout root must be a directory.");
  return walk(root);
}

export function computeSourceCheckoutIdentity(sourceRoot) {
  const files = listSourceCheckoutFiles(sourceRoot);
  const h = crypto.createHash("sha256");
  h.update(`yadilab-source-checkout\0${SOURCE_CHECKOUT_ID_SCHEMA_VERSION}\0`, "utf8");
  let totalBytes = 0;
  for (const item of files) {
    totalBytes += item.size;
    h.update(item.path, "utf8"); h.update("\0");
    h.update(String(item.size), "ascii"); h.update("\0");
    h.update(item.mode.toString(8).padStart(3, "0"), "ascii"); h.update("\0");
    h.update(item.sha256, "ascii"); h.update("\n");
  }
  return {
    schemaVersion: SOURCE_CHECKOUT_ID_SCHEMA_VERSION,
    sha256: h.digest("hex"),
    fileCount: files.length,
    totalBytes,
  };
}
