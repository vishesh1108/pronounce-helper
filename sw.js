const CACHE_NAME = 'pronounce-helper-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './syllables.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  // CDN Core scripts
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap'
];

// Install: Cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Only handle http/https requests (ignore chrome-extension, data URIs, etc.)
  if (!event.request.url.startsWith('http')) return;

  // Ignore non-GET requests (e.g. POST, PUT, DELETE)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Check if this is a request to our app's own origin
  const isLocalRequest = url.origin === self.location.origin;

  // CDN assets we want to cache
  const isCDN = url.hostname.includes('cdn.jsdelivr.net') || 
                url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('unpkg.com');

  // ONLY intercept if it's a local request or a recognized CDN
  // Do NOT intercept external APIs, Vercel backend, or custom API endpoints
  if ((!isLocalRequest && !isCDN) || url.pathname.includes('/api/')) {
    return; // Bypass service worker completely
  }

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200 && event.request.url.startsWith('http')) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return networkResponse;
        });
      })
    );
  } else {
    // For local assets, use Stale-While-Revalidate so updates show on next load, but loading is instant.
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200 && event.request.url.startsWith('http')) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Network fetch failed, offline fallback.', err);
          // Return a fallback response so we don't throw TypeError: Failed to convert value to 'Response'
          return cachedResponse || new Response('Offline fallback unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });
        
        return cachedResponse || fetchPromise;
      })
    );
  }
});
