// Offline support: the whole app (including the 7.5 MB math engine) is cached after the first visit.
const VERSION = 'notes-v1.1.0';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/icons.js', 'js/db.js', 'js/store.js', 'js/editor.js', 'js/pdfimport.js',
  'js/solve.js', 'js/gemini.js', 'js/backup.js', 'js/engine.js', 'js/engine-worker.js', 'js/mathengine.js',
  'vendor/pf/perfect-freehand.js', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'vendor/giac/giac.glue.js', 'vendor/giac/giac.wasm',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Gemini calls go straight to the network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
