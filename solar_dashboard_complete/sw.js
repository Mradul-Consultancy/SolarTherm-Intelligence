const CACHE = 'solartherm-intelligence-v4';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './demo_data.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network-first for Firebase API calls (always want live data)
  if (e.request.url.includes('firebaseio.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Prefer deployed assets, while keeping a cached copy available offline.
  e.respondWith((async () => {
    try {
      const response = await fetch(e.request);
      if (response.ok && new URL(e.request.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        await cache.put(e.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
