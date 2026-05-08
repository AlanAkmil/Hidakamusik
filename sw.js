const CACHE_NAME = 'hidaka-music-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install - cache static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', e => {
  // Skip non-GET and API calls
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;
  if (e.request.url.includes('youtube.com')) return;
  if (e.request.url.includes('lrclib.net')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});
