const output = document.querySelector("#acceptance-output");

function write(status, result) {
  document.documentElement.dataset.acceptance = status;
  document.body.dataset.acceptance = status;
  if (output) output.textContent = JSON.stringify(result);
}

async function probeIndexedDb() {
  if (!("indexedDB" in globalThis)) return false;
  const name = "__app_acceptance_probe__";
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("probe")) db.createObjectStore("probe");
    };
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("probe", "readwrite");
      tx.objectStore("probe").put("ok", "status");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
    };
  });
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  return true;
}

async function probeCacheStorage() {
  if (!("caches" in globalThis)) return false;
  const name = "__app_acceptance_probe__";
  const cache = await caches.open(name);
  await cache.put("./__acceptance_cache_item__", new Response("ok", { headers: { "Content-Type": "text/plain" } }));
  const hit = await cache.match("./__acceptance_cache_item__");
  const text = hit ? await hit.text() : "";
  await caches.delete(name);
  return text === "ok";
}

async function probeServiceWorker() {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 4000)),
  ]);
  return Boolean(registration);
}

(async () => {
  const result = {
    secureContext: globalThis.isSecureContext === true,
    indexedDB: false,
    cacheStorage: false,
    serviceWorker: false,
    origin: location.origin,
  };
  try {
    result.indexedDB = await probeIndexedDb();
    result.cacheStorage = await probeCacheStorage();
    result.serviceWorker = await probeServiceWorker();
    const pass = result.secureContext && result.indexedDB && result.cacheStorage && result.serviceWorker;
    write(pass ? "pass" : "fail", result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    write("fail", result);
  }
})();
