/**
 * Service Worker.
 *
 * Bewusst konservativ: nur die Anwendungshuelle wird zwischengespeichert.
 * API-Antworten werden NIE gecacht - eine veraltete Freigabekarte oder ein
 * veralteter Rechtestatus waere gefaehrlicher als eine Fehlermeldung.
 */
const SHELL_CACHE = 'fk-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/ui.js',
  '/views.js',
  '/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Alles unter /api/ geht immer ans Netz. Keine Ausnahme.
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && SHELL_FILES.includes(url.pathname)) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const shell = await caches.match('/index.html');
        if (shell) return shell;
        return new Response('Offline und keine zwischengespeicherte Fassung vorhanden.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
