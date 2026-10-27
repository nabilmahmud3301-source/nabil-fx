const CACHE_NAME = "nabil-fx-pwa-v2";
const SHELL = ["/nabil-fx/", "/nabil-fx/index.html", "/nabil-fx/manifest.json", "/nabil-fx/app-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("nabil-fx-pwa-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) (await caches.open(CACHE_NAME)).put(req, res.clone());
      return res;
    } catch {
      return (await caches.match(req)) || (req.mode === "navigate" ? await caches.match("/nabil-fx/index.html") : Response.error());
    }
  })());
});
