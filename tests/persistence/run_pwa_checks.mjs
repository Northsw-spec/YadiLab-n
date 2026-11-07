import fs from "node:fs";
import assert from "node:assert/strict";

const branding = JSON.parse(fs.readFileSync("app-config/branding.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("ui/public/manifest.webmanifest", "utf8"));
const sw = fs.readFileSync("ui/public/sw.js", "utf8");
const html = fs.readFileSync("ui/public/index.html", "utf8");
const shell = fs.readFileSync("ui/public/app-shell.js", "utf8");
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

eq(manifest.name, branding.displayName, "PWA name generated from centralized branding");
eq(manifest.short_name, branding.shortName, "PWA short name generated from centralized branding");
eq(manifest.description, branding.tagline, "PWA description generated from centralized branding");
eq(manifest.start_url, "./", "PWA start URL is local relative origin");
eq(manifest.scope, "./", "PWA scope is local relative origin");
eq(manifest.display, "standalone", "PWA display mode declared");
ok(!/https?:\/\//i.test(JSON.stringify(manifest)), "manifest contains no remote runtime URL");
ok(!/https?:\/\//i.test(sw), "service worker contains no hardcoded remote runtime URL");
ok(/url\.origin\s*!==\s*self\.location\.origin/.test(sw), "service worker refuses cross-origin caching");
ok(/event\.request\.method\s*!==\s*"GET"/.test(sw), "service worker does not intercept non-GET requests");
ok(sw.includes('"./manifest.webmanifest"'), "service worker core assets are local relative paths");
ok(sw.includes('"./index.html"') && sw.includes('"./app-shell.js"'), "service worker precaches generated local shell assets");
ok(sw.includes("crypto.subtle.digest") && sw.includes("PWA_HASH_MISMATCH"), "service worker verifies actual cached bytes against immutable release hashes");
ok(!sw.includes("cache.addAll"), "service worker never trusts unchecked bulk precache responses");
ok(html.includes(`<title>${branding.displayName}</title>`), "generated HTML title comes from centralized branding");
ok(!/https?:\/\//i.test(html + shell), "generated web shell contains no remote runtime URL");
ok(shell.includes('serviceWorker.register("./sw.js"'), "web shell registers only local service worker");
console.log(`PASS PWA static contract: ${checks} assertions.`);
