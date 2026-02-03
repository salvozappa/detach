const CACHE_NAME = 'detach-v13';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dist/app.js',
  '/dist/xterm.css',
  '/dist/highlight.css',
  '/dist/diff2html.css',
  '/styles.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for assets, network-only for WebSocket
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket requests
  if (url.pathname === '/ws' || event.request.url.startsWith('ws://') || event.request.url.startsWith('wss://')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Don't cache non-ok responses or non-GET requests
        if (!response.ok || event.request.method !== 'GET') {
          return response;
        }
        // Cache the new resource
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      });
    })
  );
});

// Push: handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[SW:PUSH] Push event received');

  if (!event.data) {
    console.log('[SW:PUSH] No data in push event');
    return;
  }

  let data;
  try {
    data = event.data.json();
    console.log('[SW:PUSH] Parsed data:', JSON.stringify(data));
  } catch (e) {
    console.error('[SW:PUSH] Failed to parse push data:', e);
    return;
  }

  const title = data.title || 'Detach.it';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      url: '/',
      hookType: data.hookType
    }
  };

  event.waitUntil(
    // Check if any PWA window is currently visible
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const clientStates = clientList.map(c => ({ url: c.url, visibility: c.visibilityState }));
      console.log('[SW:PUSH] Clients:', JSON.stringify(clientStates));

      const hasVisibleClient = clientList.some(client => client.visibilityState === 'visible');
      console.log('[SW:PUSH] hasVisibleClient:', hasVisibleClient);

      if (!hasVisibleClient) {
        console.log('[SW:PUSH] Showing notification:', title);
        return self.registration.showNotification(title, options);
      }
      console.log('[SW:PUSH] Suppressing notification - PWA is active');
    }).catch((err) => {
      console.error('[SW:PUSH] Error in push handler:', err);
      // Fallback: show notification anyway on error
      return self.registration.showNotification(title, options);
    })
  );
});

// Notification click: open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/');
      }
    })
  );
});
