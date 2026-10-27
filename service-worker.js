const CACHE_PREFIX = "nabil-fx-pwa-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const APP_SHELL = [
  "/nabil-fx/",
  "/nabil-fx/index.html",
  "/nabil-fx/manifest.json",
  "/nabil-fx/app-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(APP_SHELL); } catch (e) { /* Keep install resilient on GitHub Pages. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Network-first for page navigations: deployed website updates appear on the next open/refresh.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        return (await caches.match(req)) || (await caches.match("/nabil-fx/index.html")) || Response.error();
      }
    })());
    return;
  }

  // Network-first for scripts/styles/images so updated assets can be retrieved.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      return (await caches.match(req)) || Response.error();
    }
  })());
});
