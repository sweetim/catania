/**
 * PWA setup: head links for the manifest and icons, plus service-worker registration
 * so the installed app launches offline. The links are injected here instead of
 * index.html because Bun's bundler cannot resolve the public/ URLs from src/.
 * Registration is skipped in development so cached assets never shadow hot reloading.
 */
export function setupPwa() {
  installHeadLinks();
  registerServiceWorker();
}

function installHeadLinks() {
  const links = [
    { rel: "manifest", href: "/manifest.webmanifest" },
    { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  ];
  for (const { rel, href, type, sizes } of links) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    if (type) link.type = type;
    if (sizes) link.sizes = sizes;
    document.head.append(link);
  }
}

function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) =>
        navigator.serviceWorker.ready.then(() => {
          // The first page load bypassed the worker; hand it the loaded asset URLs to cache.
          const urls = [window.location.href, ...performance.getEntriesByType("resource").map((entry) => entry.name)]
            .map((url) => new URL(url, window.location.href))
            .filter((url) => url.origin === window.location.origin && !url.pathname.startsWith("/api/"))
            .map((url) => url.href);
          registration.active?.postMessage({ type: "CACHE_URLS", urls });
        }),
      )
      .catch((error) => console.error("Service worker registration failed:", error));
  });
}
