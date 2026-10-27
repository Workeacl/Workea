/* Workea · service worker
   - Workea Sueldo funciona sin conexión (calcula todo en el navegador).
   - Bitácora necesita internet (guarda en tu cuenta): sin conexión se muestra un aviso.
   - Todo lo demás (API, cuenta, análisis) va directo a la red: no se guarda nada de eso. */
const VERSION = 'workea-v1';
const PRECACHE = ['/sueldo.html', '/offline.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname.startsWith('/api/')) return;

  // Sueldo: primero la red (siempre la versión nueva); sin conexión, la copia guardada
  if(url.pathname === '/sueldo.html'){
    e.respondWith(
      fetch(req).then(res => {
        if(res.ok){ const copia = res.clone(); caches.open(VERSION).then(c => c.put('/sueldo.html', copia)); }
        return res;
      }).catch(() => caches.match('/sueldo.html'))
    );
    return;
  }
  // Bitácora: solo con conexión; si no hay, un aviso claro
  if(req.mode === 'navigate' && url.pathname === '/bitacora.html'){
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  // Íconos: de la copia guardada si existe
  if(url.pathname.indexOf('/icon-') === 0){
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
  }
});
