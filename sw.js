// Keeps the app working with no signal in the field: every file is
// cached on first visit, and updates are picked up the next time it
// opens online.
//
// The version comes from index.html (APP_VERSION), which registers this
// file as "sw.js?v=<version>": a new version is a new service worker with
// a fresh cache. Nothing to bump here.

const CACHE = `splice-planner-v${new URL(location).searchParams.get("v") || "0"}`;
const FILES = [
  "./", "index.html", "styles.css", "planindex.js", "ui.js", "users.js", "catalog.js", "app.js", "pan.js", "fold.js", "table.js", "grid.js", "phases.js", "areas.js", "paths.js", "equipment.js", "import.js", "counts.js", "files.js",
  "splices.js", "connect.js", "edits.js", "check.js", "print.js", "xlsx.js", "features.js", "features-equipment.js", "field.js", "trace.js", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png",
  "assets/logo.png", "assets/logo-light.png", "assets/mark.png",
];

self.addEventListener("install", (e) => {
  // Straight from the server, never a copy the browser kept.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first so updates arrive (checked with the server, not the
// browser's own copy); the cache answers when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
