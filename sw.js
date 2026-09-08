/* Service worker de Raccoon Finances.
 * Sube el número de versión (CACHE) cada vez que cambies archivos del "shell". */
const CACHE = 'raccoon-v11';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './icons/brand-mark.png',
  './icons/raccoon-dance.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Nunca interceptar tráfico de Firebase / Google APIs: el SDK maneja su propio
  // caché y su propia cola de escrituras offline.
  if (/(^|\.)googleapis\.com$|(^|\.)firebaseio\.com$|(^|\.)firebase\.com$|(^|\.)gstatic\.com$/.test(url.hostname)
      && url.hostname !== 'fonts.gstatic.com') {
    return;
  }

  // Fuentes de Google: usa lo cacheado y actualiza en segundo plano.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Mismo origen.
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
      return;
    }
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
      })
    );
  }
});
