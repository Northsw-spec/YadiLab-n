import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBrowserIndex } from "../../scripts/browser-index-template.mjs";

let assertions = 0;
function ok(value, message) { assert.ok(value, message); assertions += 1; }

const html = renderBrowserIndex({ title: "Fixture App", cssExists: true });
const shell = '<script type="module" src="./app-shell.js"></script>';
const app = '<script type="module" src="./assets/app.js"></script>';
ok(html.includes('data-app-runtime="booting"'), "full browser index starts booting");
ok(!html.includes('data-app-runtime="ready"'), "static index never claims runtime ready");
ok(html.includes(shell), "full browser index loads packaged service-worker bootstrap");
ok(html.includes(app), "full browser index loads app bundle");
ok(html.indexOf(shell) < html.indexOf(app), "service-worker bootstrap precedes app bundle");
ok(html.includes('href="./assets/app.css"'), "CSS linked when bundle emitted it");
ok(html.includes('href="./manifest.webmanifest"'), "manifest remains local");
ok(!/https?:\/\//i.test(html), "generated index has no remote runtime reference");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildSource = fs.readFileSync(path.join(root, "scripts/build_browser_app.mjs"), "utf8");
ok(buildSource.includes('import { renderBrowserIndex } from "./browser-index-template.mjs";'), "full browser build imports the tested index renderer");
ok(buildSource.includes('renderBrowserIndex({ title: branding.displayName, cssExists })'), "full browser build invokes the tested index renderer");
console.log(`PASS browser index template suite: ${assertions} assertions.`);
