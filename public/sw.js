// Catania service worker: installable app shell with offline launch.
// Bun copies this file into dist/ verbatim, so it stays plain JavaScript.
// Bump VERSION to push refreshed shell assets and public/ files to clients.
const VERSION = "catania-v1";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS") return;
  event.waitUntil(
    Promise.all(
      event.data.urls.map((url) =>
        fetch(url)
          .then((response) => {
            if (!response.ok) return;
            return caches.open(VERSION).then((cache) => cache.put(url, response));
          })
          .catch(() => undefined),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    // Network-first keeps deployed updates prompt; the cached shell answers offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          cacheResponse(url, response.clone());
          return response;
        })
        .catch(() => caches.match(url).then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }

  // Content-hashed build assets and public/ files are immutable per VERSION: cache-first.
  event.respondWith(
    caches.match(url).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          cacheResponse(url, response.clone());
          return response;
        }),
    ),
  );
});

function cacheResponse(url, response) {
  if (!response.ok) return;
  caches.open(VERSION).then((cache) => cache.put(url, response));
}
