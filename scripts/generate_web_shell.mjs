import fs from "node:fs";
import crypto from "node:crypto";
import { renderServiceWorker } from "./pwa-cache-lib.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branding = JSON.parse(fs.readFileSync(path.join(root, "app-config/branding.json"), "utf8"));
const html = `<!doctype html>\n<html lang="sv" data-app-runtime="shell">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="theme-color" content="#0b1220">\n<link rel="manifest" href="./manifest.webmanifest">\n<title>${branding.displayName}</title>\n</head>\n<body data-app-runtime="shell">\n<main id="app" data-app-shell="ready">\n<h1>${branding.displayName}</h1>\n<p>${branding.tagline}</p>\n<p id="delivery-status">Local offline application delivery shell. Full dependency-resolved browser bundle is not present in this checkpoint.</p>\n</main>\n<script type="module" src="./app-shell.js"></script>\n</body>\n</html>\n`;
const manifest = {
  formatId: "infrastructure-cyber-lab.browser-build",
  schemaVersion: "1.0.0",
  status: "shell-only",
  reason: "dependency-resolved browser bundle not built",
};
fs.mkdirSync(path.join(root, "ui/public"), { recursive: true });
fs.writeFileSync(path.join(root, "ui/public/index.html"), html);
fs.writeFileSync(path.join(root, "ui/public/browser-build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const publicDir = path.join(root, "ui/public");
const coreAssets = ["./", "./index.html", "./app-shell.js", "./manifest.webmanifest", "./browser-build-manifest.json"];
const coreEntries = coreAssets.map((entry) => {
  const file = entry === "./" ? "index.html" : entry.slice(2);
  return { path: entry, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(publicDir, file))).digest("hex") };
});
fs.writeFileSync(path.join(publicDir, "sw.js"), renderServiceWorker("shell", coreEntries));
