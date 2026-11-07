import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

// Compare the actual generated shell SW release manifest against the exact
// local bytes shipped by shell generation. This is NOT a full browser-bundle
// or target service-worker execution claim.
const source=fs.readFileSync("ui/public/sw.js","utf8");
const parsed=source.match(/const CORE_ASSETS=(\[[^;]+\]);/);
assert.ok(parsed,"generated SW publishes immutable release asset entries");
const entries=JSON.parse(parsed[1]);
assert.ok(entries.length>=4,"core offline files are complete");
let count=2;
const seen=new Set();
for(const {path:entry,sha256} of entries){
 assert.ok(entry.startsWith("./")&&!entry.includes(".."),`local asset: ${entry}`);count++;
 const file=entry==="./"?"index.html":entry.slice(2);
 const normalized=path.normalize(file);
 assert.ok(normalized!=="."&&!normalized.startsWith(".."),"safe mapped relative path");count++;
 assert.ok(!seen.has(entry),`no duplicate release asset: ${entry}`);count++;
 seen.add(entry);
 const absolute=path.join("ui/public",normalized);
 assert.ok(fs.statSync(absolute).isFile(),`exists: ${absolute}`);count++;
 const actual=crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
 assert.equal(sha256,actual,`correct release hash: ${entry}`);count++;
}
assert.equal(entries.find(x=>x.path==="./").sha256,entries.find(x=>x.path==="./index.html").sha256);count++;
assert.ok(source.includes("crypto.subtle.digest")&&source.includes("PWA_HASH_MISMATCH"));count++;
console.log(`PASS generated shell actual-byte precache contract: ${count} assertions across ${entries.length} local assets.`);
