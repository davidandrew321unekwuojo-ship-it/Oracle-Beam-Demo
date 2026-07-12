// Oracle Beam service worker
// Required for PWA installability. Currently a simple pass-through —
// no offline caching yet, since the app needs live network access to call.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
