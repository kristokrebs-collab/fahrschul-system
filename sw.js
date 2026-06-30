/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · Service Worker
   App-Shell-Caching für Offline-Fähigkeit (Cache-first für Statics,
   Network-falling-back-to-cache für Navigation).
   ════════════════════════════════════════════════════════════════════════ */
const CACHE = 'cockpit-v3';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/admin.js',
  './assets/js/store.js',
  './assets/js/engine.js',
  './assets/js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // Fonts etc. dem Netz überlassen

  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match(request).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
      return resp;
    }).catch(() => cached))
  );
});
