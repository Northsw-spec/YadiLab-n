import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { renderServiceWorker } from "../../scripts/pwa-cache-lib.mjs";
import { renderBrowserIndex } from "../../scripts/browser-index-template.mjs";
import { markApplicationReady, markApplicationStopped } from "../../ui/src/browser/runtime-readiness.mjs";

let functional=0, adversarial=0;
const check=(test,description,negative=false)=>{assert.ok(test,description);if(negative)adversarial++;else functional++;};
const sha=(txt)=>crypto.createHash("sha256").update(txt).digest("hex");
const scope="https://lab.local/app/";
const content=(revision)=>new Map([
 ["./",`index ${revision}`],
 ["./index.html",`index ${revision}`],
 ["./manifest.webmanifest","manifest"],
 ["./assets/app.js","bundle"],
]);
const assets=(revision)=>[...content(revision)].map(([path,body])=>({path,sha256:sha(body)}));
const one=renderServiceWorker("browser",assets(1));
const two=renderServiceWorker("browser",assets(2));
check(one===renderServiceWorker("browser",[...assets(1)].reverse()),"deterministic regardless of asset order");
check(one!==two,"asset changes yield distinct cache names");
check(one.includes("PWA_HASH_MISMATCH")&&one.includes("crypto.subtle.digest"),"byte-level SHA-256 enforced by worker");
check(one.includes("ALLOWED_PATHS")&&one.includes("LEGACY_CACHES"),"static allowlist and owned cleanup retained");
check(!one.slice(one.indexOf('self.addEventListener("fetch"')).includes("cache.put("),"fetch path never caches dynamic content",true);
for (const invalid of [
 ()=>renderServiceWorker("bad",assets(1)),
 ()=>renderServiceWorker("browser",[]),
 ()=>renderServiceWorker("browser",[...assets(1),assets(1)[0]]),
 ()=>renderServiceWorker("browser",[{path:"./../escape",sha256:sha("x")},...assets(1)]),
 ()=>renderServiceWorker("browser",[{path:"https://outside/a",sha256:sha("x")},...assets(1)]),
 ()=>renderServiceWorker("browser",[{path:"./bad",sha256:"not-a-sha"},...assets(1)]),
 ()=>renderServiceWorker("browser",assets(1).filter(x=>x.path!=="./index.html")),
 ()=>renderServiceWorker("browser",assets(1).map(x=>x.path==="./"?{...x,sha256:sha("different index")}:x)),
 ()=>renderServiceWorker("browser",[...assets(1),{path:"./assets/./app.js",sha256:sha("bundle")}]),
 ]){assert.throws(invalid);adversarial++;}

// The harness runs the GENERATED service worker as JS and verifies actual
// Response bytes using Node's native Request/Response and WebCrypto. It is not
// a browser/Parrot claim; Chromium acceptance remains a separate target gate.
const storage=new Map([["foreign-app-cache",new Map()], ["app-shell-v1",new Map()]]);
const base=(revision)=>content(revision);
const href=(p)=>new URL(p,scope).href;
function asResponse(body,url,{redirected=false,status=200,type="basic",headers={}}={}){
 const decorate=response=>{
  Object.defineProperties(response,{url:{value:url},redirected:{value:redirected},type:{value:type}});
  const originalClone=response.clone.bind(response);
  Object.defineProperty(response,"clone",{value:()=>decorate(originalClone())});
  return response;
 };
 return decorate(new Response(body,{status,headers}));
}
function worker(source,networkContent,{alter={},failFetch=false,failFetchAt=0,failPut=false,failPutAt=0}={}){
 const handlers={};
 let requests=0, writes=0;
 const caches={
  open:async(name)=>{
   if(!storage.has(name))storage.set(name,new Map());
   const values=storage.get(name);
   return {
    match:async(request)=>values.get(typeof request==="string"?request:request.url)?.clone(),
    put:async(key,response)=>{
      writes++;
      if(failPut||(failPutAt>0&&writes===failPutAt))throw Error("disk failure");
      values.set(key,response.clone());
    },
   };
  },
  keys:async()=>[...storage.keys()],
  delete:async(name)=>storage.delete(name),
 };
 const fetch=async(request)=>{
  requests++;
  if(failFetch||(failFetchAt>0&&requests===failFetchAt))throw Error("offline");
  const uri=new URL(request.url);
  const path=[...networkContent.keys()].find(p=>href(p)===uri.href);
  if(!path)throw Error("unlisted");
  const payload=alter[path]??{};
  const bytes=payload.body??networkContent.get(path);
  return asResponse(bytes,payload.url??uri.href,payload);
 };
 vm.runInNewContext(source,{self:{location:{origin:"https://lab.local"},registration:{scope},addEventListener:(type,fn)=>handlers[type]=fn},URL,Request,Response,crypto:crypto.webcrypto,caches,fetch,Uint8Array,Array,Error},{timeout:2000});
 return {
  get requests(){return requests;},
  async dispatch(type,request){
    let waiting,responded;
    handlers[type]({request,waitUntil(p){waiting=p;},respondWith(p){responded=p;}});
    if(waiting)await waiting;
    return responded?await responded:null;
  },
 };
}
const v1=worker(one,base(1));
await v1.dispatch("install"); functional++;
check(v1.requests===assets(1).length,"install fetches each allowlisted asset before caching");
await v1.dispatch("activate");functional++;
check(storage.has("foreign-app-cache"),"foreign cache retained");
check(!storage.has("app-shell-v1"),"legacy owned cache deleted only on activate");
const first=[...storage.keys()].find(k=>k.startsWith("infra-lab-pwa-browser-"));
check(Boolean(first),"content-hash release cache persisted");
const initial=await v1.dispatch("fetch",{method:"GET",url:href("./assets/app.js")});
check(await initial.text()==="bundle"&&v1.requests===assets(1).length,"unmodified cache is served fully offline");
for(const req of [
 {method:"POST",url:href("./assets/app.js")},
 {method:"GET",url:"https://outside.invalid/app/assets/app.js"},
 {method:"GET",url:href("./api/private")},
 {method:"GET",url:href("./assets/app.js")+"?v=123"},
 ])check(await v1.dispatch("fetch",req)===null,`request not intercepted: ${req.url}`,true);

// A malicious server must not be permitted to fill an old release cache with
// wrong bytes and then trigger deletion of the known-good prior cache.
for(const bad of [
 {alter:{"./assets/app.js":{body:"tampered"}}},
 {alter:{"./assets/app.js":{body:"tampered",url:"https://lab.local/app/assets/app.js"}}},
 {alter:{"./assets/app.js":{body:"bundle",redirected:true}}},
 {alter:{"./assets/app.js":{body:"bundle",url:"https://evil.invalid/fake.js"}}},
 {alter:{"./assets/app.js":{body:"bundle",type:"opaque"}}},
 {alter:{"./assets/app.js":{body:"bundle",status:206}}},
 {alter:{"./assets/app.js":{body:"bundle",headers:{"content-length":"34000000"}}}},
 {alter:{"./assets/app.js":{body:"bundle",headers:{"content-length":"infinite"}}}},
 {failFetch:true},
 {failFetchAt:3},
 ]){
   const badVersion=renderServiceWorker("browser",assets(3));
   const attack=worker(badVersion,base(3),bad);
   await assert.rejects(()=>attack.dispatch("install"));adversarial++;
   check(storage.has(first),"failed hash/network/redirect install preserves last working release",true);
 }
const diskFailure=worker(two,base(2),{failPutAt:2});
await assert.rejects(()=>diskFailure.dispatch("install")); adversarial++;
check(storage.has(first),"storage error does not delete active cache",true);
check([...storage.keys()].filter(k=>k.startsWith("infra-lab-pwa-")).length===1,"partial release cache removed on failure",true);

// Verify a corrupt *cached* JS file can never be returned to the browser.
const goodCache=storage.get(first);
goodCache.set(href("./assets/app.js"),asResponse("poisoned",href("./assets/app.js")));
const offlineWorker=worker(one,base(1),{failFetch:true});
const denied=await offlineWorker.dispatch("fetch",{method:"GET",url:href("./assets/app.js")});
check(denied.type==="error","tampered cached application script fails closed offline",true);
await assert.rejects(()=>offlineWorker.dispatch("install"));adversarial++;
check(storage.has(first),"reinstallation refuses corrupted cache without rewriting it",true);
const repairedWorker=worker(one,base(1));
const repaired=await repairedWorker.dispatch("fetch",{method:"GET",url:href("./assets/app.js")});
check(await repaired.text()==="bundle","cache miss/corruption falls back only to freshly verified release bytes");
// Restore trusted content so the installed release can be validated unchanged.
goodCache.set(href("./assets/app.js"),asResponse("bundle",href("./assets/app.js")));
const reinstall=worker(one,base(1),{failFetch:true});
await reinstall.dispatch("install"); functional++;
check(reinstall.requests===0,"existing matching release verified offline, never rewritten");

const v2=worker(two,base(2));
await v2.dispatch("install");functional++;
check(storage.has(first),"old version remains until new verified install activates");
await v2.dispatch("activate");functional++;
check(!storage.has(first),"old cache only cleared after successful verified update");
check(storage.has("foreign-app-cache"),"unrelated application cache preserved");
const fresh=[...storage.keys()].find(k=>k.startsWith("infra-lab-pwa-browser-"));
check(Boolean(fresh)&&fresh!==first,"new hash-derived cache is active");

const doc={documentElement:{dataset:{appRuntime:"booting"}},body:{dataset:{appRuntime:"booting"}},getElementById:()=>null};
check(markApplicationReady(doc)===false&&doc.body.dataset.appRuntime==="booting","static HTML cannot attest React",true);
const views=new Set(['.app-frame[data-app-runtime="ready"]','nav[aria-label="Application actions"]','.workspace-grid']);
doc.getElementById=()=>({querySelector:selector=>views.has(selector)?{}:null});
views.delete('.workspace-grid');
check(markApplicationReady(doc)===false,"partial DOM cannot attest React",true);
views.add('.workspace-grid');
check(markApplicationReady(doc)===true&&doc.body.dataset.appRuntime==="ready","mounted app may attest readiness");
markApplicationStopped(doc);check(doc.body.dataset.appRuntime==="stopped","unmount revokes readiness");
const generatedIndex=renderBrowserIndex({title:"Fixture App",cssExists:false});
const parrot=fs.readFileSync("scripts/run_parrot_acceptance.sh","utf8");
check(generatedIndex.includes('data-app-runtime="booting"')&&!generatedIndex.includes('data-app-runtime="ready"'),"generated browser shell cannot self-attest",true);
check(parrot.includes('chromium_real_react_builder_mount')&&parrot.includes('.app-frame[data-app-runtime="ready"]')&&parrot.includes('label.file-button')&&parrot.includes('application/zip'),"target acceptance checks mounted Builder and packaged-lab file input");
console.log(`PASS Phase 41 PWA verified precache: ${functional} functional + ${adversarial} adversarial assertions.`);
