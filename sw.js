// Keeps the app working with no signal in the field: every file is
// cached on first visit, and updates are picked up the next time it
// opens online.

const CACHE = "splice-planner-v41";
const FILES = [
  "./", "index.html", "styles.css", "ui.js", "users.js", "catalog.js", "app.js", "pan.js", "fold.js", "table.js", "grid.js", "phases.js", "paths.js", "equipment.js", "import.js", "counts.js", "files.js",
  "splices.js", "connect.js", "edits.js", "check.js", "print.js", "features.js", "features-equipment.js", "field.js", "trace.js", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png",
  "assets/logo.png", "assets/logo-light.png", "assets/mark.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
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
