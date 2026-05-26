const CACHE_NAME = 'pronounce-helper-v11';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './scanner_warper.js',
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

// Install: Cache core assets robustly
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      // Using allSettled so if any single file fails or CDN is slow, it doesn't break PWA setup
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(asset => 
          cache.add(asset).catch(err => console.error(`[Service Worker] Failed to cache: ${asset}`, err))
        )
      );
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

// Safe cache put helper — prevents errors from unsupported schemes (chrome-extension, etc.)
function safeCachePut(request, response) {
  try {
    if (!request.url.startsWith('http')) return;
    caches.open(CACHE_NAME).then((cache) => {
      cache.put(request, response).catch(() => {
        // Silently ignore cache put failures (unsupported schemes, quota exceeded, etc.)
      });
    });
  } catch (e) {
    // Ignore synchronous errors
  }
}

// Fetch: Serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Only handle http/https requests (ignore chrome-extension, data URIs, etc.)
  if (!event.request.url.startsWith('http')) return;

  // Ignore non-GET requests (e.g. POST, PUT, DELETE)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // CRITICAL: NEVER intercept any API calls or health checks
  if (url.pathname.includes('/api/') || url.pathname.includes('/health')) {
    return; // Bypass service worker completely
  }

  // Check if this is a request to our app's own origin
  const isLocalRequest = url.origin === self.location.origin;

  // CDN assets we want to cache
  const isCDN = url.hostname.includes('cdn.jsdelivr.net') || 
                url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('unpkg.com');

  // ONLY intercept if it's a local request or a recognized CDN
  if (!isLocalRequest && !isCDN) {
    return; // Bypass service worker completely
  }

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            safeCachePut(event.request, networkResponse.clone());
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
          if (networkResponse.status === 200) {
            safeCachePut(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Network failed — return cached version or a proper offline fallback Response
          if (cachedResponse) return cachedResponse;
          return new Response('Offline fallback unavailable', {
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
