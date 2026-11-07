import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branding = JSON.parse(fs.readFileSync(path.join(root, "app-config/branding.json"), "utf8"));
const forbidden = [branding.displayName, branding.shortName].filter(Boolean);
const allowedRoots = new Set(["app-config", "docs", "distribution"]);
const allowedFiles = new Set(["README.md"]);
const checkedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html"]);
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name) || entry.name.startsWith("dist-")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    const first = rel.split(path.sep)[0];
    if (entry.isDirectory()) { walk(full); continue; }
    if (allowedRoots.has(first) || allowedFiles.has(rel) || rel === path.join("ui", "public", "index.html") || rel.includes(`${path.sep}fixtures${path.sep}`)) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const brand of forbidden) {
      if (brand && text.includes(brand)) hits.push(`${rel}: contains hardcoded display brand '${brand}'`);
    }
  }
}
walk(root);
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log(`PASS branding guard: no hardcoded display brand in protected source paths.`);
