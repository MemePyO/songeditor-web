// Service worker: offline support for the ProPresenter 7 Song Editor (Web)
// - Caches the app shell
// - Pre-caches the Python modules / data used by Pyodide
// - Runtime-caches the Pyodide CDN so the app works offline after first load

const APP_CACHE = "songeditor-shell-v7";
const DATA_CACHE = "songeditor-data-v3";
const RUNTIME_CACHE = "songeditor-runtime-v3";
const ALL_CACHES = [APP_CACHE, DATA_CACHE, RUNTIME_CACHE];

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js?v=10",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Pyodide loader is loaded via a <script> tag (no-cors) so it can't be
// runtime-cached by response.ok checks — pre-cache it explicitly.
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const RUNTIME_PRECACHE = [PYODIDE_BASE + "pyodide.js"];

const DATA = [
  "./presentation_pb2.py",
  "./action_pb2.py",
  "./alignmentGuide_pb2.py",
  "./background_pb2.py",
  "./basicTypes_pb2.py",
  "./cue_pb2.py",
  "./digitalAudio_pb2.py",
  "./effects_pb2.py",
  "./graphicsData_pb2.py",
  "./groups_pb2.py",
  "./hotKey_pb2.py",
  "./input_pb2.py",
  "./layers_pb2.py",
  "./messages_pb2.py",
  "./presentationSlide_pb2.py",
  "./propSlide_pb2.py",
  "./rvtimestamp_pb2.py",
  "./slide_pb2.py",
  "./stage_pb2.py",
  "./templateIdentification_pb2.py",
  "./timers_pb2.py",
  "./SongEditorPro7Generic.py",
  "./single_export.py",
  "./web_bridge.py",
  "./Template.pro",
  "./GroupNames.txt",
  "./protobuf-4.24.4-cp312-cp312-pyodide_2024_0_wasm32.whl",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(APP_CACHE);
      await Promise.all(SHELL.map((url) => shell.add(url).catch(() => {})));
      const data = await caches.open(DATA_CACHE);
      await Promise.all(DATA.map((url) => data.add(url).catch(() => {})));
      const runtime = await caches.open(RUNTIME_CACHE);
      await Promise.all(
        RUNTIME_PRECACHE.map((url) => runtime.add(url).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isPyodide(url) {
  if (url.hostname === "cdn.jsdelivr.net") {
    return url.pathname.includes("/pyodide/");
  }
  if (url.hostname === "unpkg.com") {
    return url.pathname.toLowerCase().includes("pyodide");
  }
  return false;
}

function isDataFile(url) {
  return (
    url.pathname.endsWith(".py") ||
    url.pathname.endsWith(".pro") ||
    url.pathname.endsWith(".txt") ||
    url.pathname.endsWith(".whl")
  );
}

function isImage(url) {
  return (
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".svg")
  );
}

// Cache-first with background refresh (stale-while-revalidate)
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) cache.put(request, resp.clone());
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

// Cache-first (used for Pyodide runtime and images)
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        if (resp && resp.ok) cache.put(request, resp.clone());
        return resp;
      });
    })
  );
}

// Network-first with cache fallback (used for app shell so updates land)
function networkFirst(request, cacheName, fallbackUrl) {
  return fetch(request)
    .then((resp) => {
      if (resp && resp.ok) {
        const clone = resp.clone();
        caches.open(cacheName).then((c) => c.put(request, clone));
      }
      return resp;
    })
    .catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return cached;
        if (fallbackUrl) return caches.match(fallbackUrl);
        return Response.error();
      })
    );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Pyodide runtime from CDN — cache-first, fills after first successful load
  if (isPyodide(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Python modules + data — serve from cache instantly, refresh in background
  if (url.origin === self.location.origin && isDataFile(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Images — cache-first
  if (url.origin === self.location.origin && isImage(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // App shell (HTML/JS/CSS/manifest) — network-first, offline fallback
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, APP_CACHE, "./index.html"));
    return;
  }

  // Everything else — default network
});
