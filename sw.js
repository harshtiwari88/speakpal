const CACHE = "speakpal-v1";
const SHELL = [
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/api.js",
  "./js/store.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Network-first for API calls, cache-first for shell
  if (e.request.url.includes("/api/")) return; // bypass cache for backend
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
