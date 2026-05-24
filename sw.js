const CACHE_NAME = 'pronounce-helper-v2';
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
  // Ignore non-GET requests (e.g. chrome-extension, etc.)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Caching strategy:
  // For Tesseract CDN assets, font files, and FontAwesome webfonts, use Cache First.
  // This is because these files are heavy and immutable.
  const isCDN = url.hostname.includes('cdn.jsdelivr.net') || 
                url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.gstatic.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('unpkg.com');

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
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
          if (networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Network fetch failed, offline fallback.');
        });
        
        return cachedResponse || fetchPromise;
      })
    );
  }
});
