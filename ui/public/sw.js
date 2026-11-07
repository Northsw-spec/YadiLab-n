// Generated, release-scoped, hash-VERIFIED offline assets. Never cache user data.
const CACHE_NAME="infra-lab-pwa-shell-d235d978ba6c3119044cb2a2";
const OWNED_CACHE_PREFIX="infra-lab-pwa-";
const LEGACY_CACHES=["app-shell-v1","app-browser-v1"];
const CORE_ASSETS=[{"path":"./","sha256":"17b156fa6a8892b3596e1793dae972c646862a5d9e769e2273ecb45233286551"},{"path":"./app-shell.js","sha256":"7a524b5af78aa1200c332f972bff03977a8c6645b8e59068b48cfed53aa92df6"},{"path":"./browser-build-manifest.json","sha256":"62b8f811138514d096b75ca094dbefe07fc263c0503c413f829dead43e55dc20"},{"path":"./index.html","sha256":"17b156fa6a8892b3596e1793dae972c646862a5d9e769e2273ecb45233286551"},{"path":"./manifest.webmanifest","sha256":"457d6045b9d1bae2edc56b0fc936d64e34c19da2f51e428f69eb72ba867e89e9"}];
const EXPECTED=new Map(CORE_ASSETS.map(a=>[new URL(a.path,self.registration.scope).pathname,a.sha256]));
const ALLOWED_PATHS=new Set(EXPECTED.keys());
const MAX_ASSET_BYTES=32*1024*1024;
// Only byte-identical, non-redirected, same-origin 200 responses can be served.
async function verifiedResponse(response,href,expected){
 if(!response || response.status!==200 || response.type==="opaque" || response.redirected || !response.url || response.url!==href)throw Error("PWA_RESPONSE_UNTRUSTED");
 const length=response.headers.get("content-length");
 if(length!==null && (!/^\d+$/.test(length)||Number(length)>MAX_ASSET_BYTES))throw Error("PWA_OVERSIZE");
 const bytes=await response.clone().arrayBuffer();
 if(bytes.byteLength>MAX_ASSET_BYTES)throw Error("PWA_OVERSIZE");
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 if(actual!==expected)throw Error("PWA_HASH_MISMATCH");
 return response;
}
async function validatedFetch(path,expected){
 const href=new URL(path,self.registration.scope).href;
 const request=new Request(href,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"});
 return verifiedResponse(await fetch(request),href,expected);
}
self.addEventListener("install",event=>{event.waitUntil((async()=>{
 const prior=await caches.keys();
 // An already-active cache with this exact release name must never be
 // partially overwritten. Validate all its contents instead of rewriting it.
 if(prior.includes(CACHE_NAME)){
  const existing=await caches.open(CACHE_NAME);
  for(const entry of CORE_ASSETS){
   const href=new URL(entry.path,self.registration.scope).href;
   const hit=await existing.match(href);
   await verifiedResponse(hit,href,entry.sha256);
  }
  return;
 }
 // Fetch and verify *every* response before writing any new cache entries.
 const verified=[];
 for(const entry of CORE_ASSETS)verified.push([entry,await validatedFetch(entry.path,entry.sha256)]);
 try{
  const cache=await caches.open(CACHE_NAME);
  for(const [entry,response] of verified)await cache.put(new URL(entry.path,self.registration.scope).href,response);
 }catch(error){await caches.delete(CACHE_NAME);throw error;}
})());});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&(k.startsWith(OWNED_CACHE_PREFIX)||LEGACY_CACHES.includes(k))).map(k=>caches.delete(k)))));});
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET")return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||url.search||url.hash||!ALLOWED_PATHS.has(url.pathname))return;
 event.respondWith((async()=>{
  const expected=EXPECTED.get(url.pathname);
  const hit=await (await caches.open(CACHE_NAME)).match(event.request);
  if(hit){try{return await verifiedResponse(hit,url.href,expected);}catch(_e){/* Refuse corrupt cache and verify replacement. */}}
  try{return await validatedFetch(url.href,expected);}catch(_e){return Response.error();}
 })());
});
