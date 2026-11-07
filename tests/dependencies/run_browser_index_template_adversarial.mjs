import assert from "node:assert/strict";
import { renderBrowserIndex } from "../../scripts/browser-index-template.mjs";

let assertions = 0;
function eq(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function ok(value, message) { assert.ok(value, message); assertions += 1; }

const html = renderBrowserIndex({ title: '<script src="https://evil.invalid/x.js"></script>&', cssExists: false });
eq((html.match(/\.\/app-shell\.js/g) ?? []).length, 1, "bootstrap appears exactly once");
eq((html.match(/\.\/assets\/app\.js/g) ?? []).length, 1, "app bundle appears exactly once");
ok(!html.includes('href="./assets/app.css"'), "CSS omitted when no CSS bundle exists");
ok(!html.includes('<title><script'), "title cannot inject markup");
ok(html.includes('&lt;script src="https://evil.invalid/x.js"&gt;&lt;/script&gt;&amp;'), "title is HTML-text escaped");
// The escaped title may contain URL-looking text as inert text; runtime references are only script/link/src/href URLs.
ok(!/<script[^>]+src="https?:\/\//i.test(html), "title cannot inject a remote script reference");
console.log(`PASS browser index template adversarial suite: ${assertions} assertions.`);
