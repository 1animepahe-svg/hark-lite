/* sw.js — service worker: offline shell + install support (cache-first for app files) */
const CACHE_NAME = "hark-lite-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./ai.js",
  "./tools.js",
  "./storage.js",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  /* AI traffic always goes to the network — never cached */
  if (url.hostname.endsWith("pollinations.ai")) return;

  if (event.request.method !== "GET" || !url.origin.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) =>
      hit ??
      fetch(event.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
