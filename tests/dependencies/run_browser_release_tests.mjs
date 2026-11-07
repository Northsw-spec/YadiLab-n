import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderServiceWorker } from "../../scripts/pwa-cache-lib.mjs";
import { verifyBrowserRelease } from "../../scripts/browser-release-verifier.mjs";
import { renderBrowserIndex } from "../../scripts/browser-index-template.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "dependencies/browser-runtime.policy.json"), "utf8"));
let assertions = 0;
function check(actual, message) { assert.ok(actual, message); assertions++; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function sha(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-browser-release-"));
const dist = path.join(tmp, "ui/dist");
function write(rel, content) { const full=path.join(dist,rel);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,content); }
function files() {
  function walk(dir, rel="") {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name),rel?rel+"/"+x.name:x.name):[(rel?rel+"/":"")+x.name]);
  }
  return walk(dist).filter(x=>x!=="browser-build-manifest.json").sort();
}
function make() {
  fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
  write("index.html", renderBrowserIndex({ title: "Fixture Browser Release", cssExists: true }));
  write("app-shell.js", 'if ("serviceWorker" in navigator) { window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined)); }');
  write("assets/app.js", "/* synthetic only: integrity preflight must NOT imply React boot */ console.log('synthetic');");
  write("assets/app.css", ".app{display:block}");
  write("manifest.webmanifest",'{"name":"test"}');
  write("THIRD_PARTY_NOTICES.md","Inventory status: **bundle-resolved**");
  write("third-party-inventory.json",JSON.stringify({status:"bundle-resolved",bundledRuntimeComponents:[]}));
  write("acceptance.html","test");write("acceptance-probe.js","test");
  const cache = files().filter(x=>!["acceptance.html", "acceptance-probe.js"].includes(x));
  const entries=[{path:"./",sha256:sha(fs.readFileSync(path.join(dist,"index.html")))},...cache.map(name=>({path:`./${name}`,sha256:sha(fs.readFileSync(path.join(dist,name)))}))];
  write("sw.js",renderServiceWorker("browser",entries));
  const manifest={formatId:"infrastructure-cyber-lab.browser-build",schemaVersion:"1.0.0",status:"ready",buildTool:{name:"esbuild",version:"0.28.2"},dependencyPins:policy.runtimeDependencies,files:files().map(name=>({name,sha256:sha(fs.readFileSync(path.join(dist,name))),size:fs.statSync(path.join(dist,name)).size}))};
  write("browser-build-manifest.json",JSON.stringify(manifest));return manifest;
}
function has(code) {const r=verifyBrowserRelease(dist);check(!r.ok,`must reject ${code}`);check(r.errors.some(x=>x.code===code),`named diagnostic ${code}: ${JSON.stringify(r.errors)}`);}
try {
  make();let r=verifyBrowserRelease(dist);check(r.ok,`complete synthetic artifact structure accepted: ${JSON.stringify(r.errors)}`);eq(r.filesVerified,files().length,"every manifest file was validated");
  const linkedDir=path.join(tmp,"symlinked-dist");fs.symlinkSync(dist,linkedDir,"dir");check(!verifyBrowserRelease(linkedDir).ok,"top-level linked bundle directory rejected");fs.unlinkSync(linkedDir);
  make();fs.appendFileSync(path.join(dist,"assets/app.js"),"tampered");has("BROWSER_RELEASE_SIZE_MISMATCH");
  make();fs.writeFileSync(path.join(dist,"assets/app.js"),Buffer.from("x".repeat(fs.statSync(path.join(dist,"assets/app.js")).size)));has("BROWSER_RELEASE_HASH_MISMATCH");
  make();write("unlisted.js","remote?");has("BROWSER_RELEASE_UNLISTED_FILE");
  make();fs.unlinkSync(path.join(dist,"assets/app.js"));has("BROWSER_RELEASE_LISTED_FILE_MISSING");
  make();write("outside.txt","outside");fs.symlinkSync(path.join(dist,"outside.txt"),path.join(dist,"assets/evil.js"));has("BROWSER_RELEASE_SYMLINK");
  make();let m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.push({...m.files[0]});write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_DUPLICATE_FILE");
  make();m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files[0].name="../escape";write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_FILE_ENTRY_INVALID");
  make();m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.status="shell-only";write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_MANIFEST_CONTRACT");
  make();m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.dependencyPins.react="0.0.0";write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_DEPENDENCY_PINS_MISMATCH");
  make();write("third-party-inventory.json",JSON.stringify({status:"declared-direct-baseline",bundledRuntimeComponents:[]}));m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="third-party-inventory.json").sha256=sha(fs.readFileSync(path.join(dist,"third-party-inventory.json")));m.files.find(x=>x.name==="third-party-inventory.json").size=fs.statSync(path.join(dist,"third-party-inventory.json")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_INVENTORY_NOT_RESOLVED");
  make();write("sw.js",fs.readFileSync(path.join(dist,"sw.js"),"utf8").replace(/(const CORE_ASSETS=\[[^;]*?)"sha256":"[0-9a-f]{64}"/, (_, prefix) => prefix + '"sha256":"' + "0".repeat(64) + '"'));m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="sw.js").sha256=sha(fs.readFileSync(path.join(dist,"sw.js")));m.files.find(x=>x.name==="sw.js").size=fs.statSync(path.join(dist,"sw.js")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_SW_ASSET_MISMATCH");
  make();write("index.html",fs.readFileSync(path.join(dist,"index.html"),"utf8").replace('data-app-runtime="booting"','data-app-runtime="ready"'));m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="index.html").sha256=sha(fs.readFileSync(path.join(dist,"index.html")));m.files.find(x=>x.name==="index.html").size=fs.statSync(path.join(dist,"index.html")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_BOOTSTRAP_INVALID");
  make();fs.unlinkSync(path.join(dist,"app-shell.js"));has("BROWSER_RELEASE_LISTED_FILE_MISSING");
  make();write("app-shell.js",'navigator.serviceWorker.register("https://example.invalid/sw.js")');m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="app-shell.js").sha256=sha(fs.readFileSync(path.join(dist,"app-shell.js")));m.files.find(x=>x.name==="app-shell.js").size=fs.statSync(path.join(dist,"app-shell.js")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_SW_BOOTSTRAP_INVALID");
  make();write("index.html",fs.readFileSync(path.join(dist,"index.html"),"utf8").replace('<script type="module" src="./app-shell.js"></script>',''));m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="index.html").sha256=sha(fs.readFileSync(path.join(dist,"index.html")));m.files.find(x=>x.name==="index.html").size=fs.statSync(path.join(dist,"index.html")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_BOOTSTRAP_INVALID");
  make();write("index.html",fs.readFileSync(path.join(dist,"index.html"),"utf8").replace(/<script type="module" src="\.\/app-shell\.js"><\/script>\s*<script type="module" src="\.\/assets\/app\.js"><\/script>/,'<script type="module" src="./assets/app.js"></script>\n<script type="module" src="./app-shell.js"></script>'));m=JSON.parse(fs.readFileSync(path.join(dist,"browser-build-manifest.json")));m.files.find(x=>x.name==="index.html").sha256=sha(fs.readFileSync(path.join(dist,"index.html")));m.files.find(x=>x.name==="index.html").size=fs.statSync(path.join(dist,"index.html")).size;write("browser-build-manifest.json",JSON.stringify(m));has("BROWSER_RELEASE_BOOTSTRAP_INVALID");
  // End-to-end safety: malformed ui/dist must not replace an existing distribution.
  const fakeRoot=path.join(tmp,"standalone");for(const d of ["scripts","dependencies","distribution/linux-x86_64","ui/dist"])fs.mkdirSync(path.join(fakeRoot,d),{recursive:true});
  for(const name of ["verify_browser_release.mjs","browser-release-verifier.mjs","build_loopback_distribution.sh"])fs.copyFileSync(path.join(root,"scripts",name),path.join(fakeRoot,"scripts",name));
  fs.copyFileSync(path.join(root,"dependencies/browser-runtime.policy.json"),path.join(fakeRoot,"dependencies/browser-runtime.policy.json"));
  fs.writeFileSync(path.join(fakeRoot,"distribution/linux-x86_64/SHA256SUMS.txt"),"previous-good-distribution\n");
  fs.writeFileSync(path.join(fakeRoot,"ui/dist/browser-build-manifest.json"),JSON.stringify({status:"ready"}));
  const processResult=spawnSync("bash",[path.join(fakeRoot,"scripts/build_loopback_distribution.sh")],{encoding:"utf8"});
  check(processResult.status!==0,"invalid release rejected before touching old distribution");
  eq(fs.readFileSync(path.join(fakeRoot,"distribution/linux-x86_64/SHA256SUMS.txt"),"utf8"),"previous-good-distribution\n","previous distribution untouched on rejected promotion");
  check(!fs.readdirSync(path.join(fakeRoot,"distribution")).some(x=>x.startsWith(".linux-x86_64-stage")),"no staging directory created before validation");
  console.log(`PASS browser release promotion integrity suite: ${assertions} assertions.`);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
