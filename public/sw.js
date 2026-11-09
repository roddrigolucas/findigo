/* FinNexus service worker — casca offline.
   Regra central: NADA de /api/ é armazenado em cache.
   Dados financeiros e sessão sempre vêm da rede. */

const VERSION = 'finnexus-v10';
const SHELL = [
  '/', '/index.html', '/app.css', '/app.js', '/parsers.js', '/openfinance.js',
  '/manifest.json', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fontes, terceiros
  if (url.pathname.startsWith('/api/')) return;      // sempre rede, nunca cache

  // Navegação: rede primeiro, casca em cache como reserva offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then(r => r || Response.error()))
    );
    return;
  }

  // Estáticos: cache primeiro, revalidando em segundo plano
  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached || Response.error());
      return cached || fresh;
    })
  );
});
