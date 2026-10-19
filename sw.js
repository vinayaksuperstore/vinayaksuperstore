self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

// Deliberately network-only: the catalogue and API responses must not go stale.
self.addEventListener("fetch", () => {});
