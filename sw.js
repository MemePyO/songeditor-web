const CACHE = "songeditor-web-v1";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
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
  const url = new URL(e.request.url);
  // Network-first for Python files and Template.pro (may update)
  if (url.pathname.endsWith(".py") || url.pathname.endsWith(".pro") || url.pathname.endsWith(".txt")) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
