// Service Worker for Personal OS PWA
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `bhaskar-kotakonda-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `bhaskar-kotakonda-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `bhaskar-kotakonda-runtime-${CACHE_VERSION}`;

// Shell assets - cached on install
const SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
];

// Static asset patterns (cache-first)
const STATIC_PATTERNS = [
  /\.(js|css|woff2?|ttf|eot|ico|svg|png|jpg|jpeg|gif|webp)$/,
  /^\/_astro\//,
];

// API patterns (network-first)
const API_PATTERNS = [
  /^\/api\//,
  /\/auth\//,
];

// ─────────────────────────────────────────────────────────────
// Install - Cache shell assets
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log('[SW] Caching shell assets');
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─────────────────────────────────────────────────────────────
// Activate - Clean old caches
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const currentCaches = [SHELL_CACHE, STATIC_CACHE, RUNTIME_CACHE];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('bhaskar-kotakonda-') && !currentCaches.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// ─────────────────────────────────────────────────────────────
// Fetch - Routing strategies
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls - Network first
  if (API_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Static assets - Cache first
  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML pages - Network first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOffline(request));
    return;
  }

  // Default - Network first
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ─────────────────────────────────────────────────────────────
// Caching strategies
// ─────────────────────────────────────────────────────────────

// Cache first - for static assets
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

// Network first - for API and dynamic content
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Network first with offline page fallback
async function networkFirstWithOffline(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Return offline page
    const offlinePage = await caches.match('/offline.html');
    if (offlinePage) return offlinePage;
    
    return new Response('Offline', { status: 503 });
  }
}

// ─────────────────────────────────────────────────────────────
// Background Sync
// ─────────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}

// ─────────────────────────────────────────────────────────────
// Message handling
// ─────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CACHE_URLS':
      if (payload?.urls) {
        caches.open(RUNTIME_CACHE).then((cache) => cache.addAll(payload.urls));
      }
      break;
    case 'CLEAR_CACHE':
      caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
      break;
  }
});

// ─────────────────────────────────────────────────────────────
// Push notifications (placeholder)
// ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Personal OS', body: 'New update' };
  
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'default',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
