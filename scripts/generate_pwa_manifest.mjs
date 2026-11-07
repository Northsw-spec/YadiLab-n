import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branding = JSON.parse(fs.readFileSync(path.join(root, "app-config/branding.json"), "utf8"));
const manifest = {
  name: branding.displayName,
  short_name: branding.shortName,
  description: branding.tagline,
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#0b1220",
  theme_color: "#0b1220",
};
fs.mkdirSync(path.join(root, "ui/public"), { recursive: true });
fs.writeFileSync(path.join(root, "ui/public/manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
