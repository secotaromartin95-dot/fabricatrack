// FabriTrack - Service Worker v8 (Backup, trazabilidad con hora y papelera)
const CACHE_NAME = 'fabricatrack-v8';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Dejar pasar peticiones a Google y Firebase directo
  if (
    url.origin.includes('firebase') ||
    url.origin.includes('googleapis') ||
    url.origin.includes('gstatic') ||
    url.origin.includes('google.com')
  ) {
    return;
  }

  // Network First: Intentar descargar la versión más reciente siempre que haya red
  e.respondWith(
    fetch(e.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        // Si no hay internet, usar la versión guardada en caché
        return caches.match(e.request).then(cached => cached || caches.match('/'));
      })
  );
});
