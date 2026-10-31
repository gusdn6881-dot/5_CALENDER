const CACHE_NAME = 'couple-cal-v33';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=33',
  './push-config.js?v=33',
  './push-reminders.js?v=33',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('우리하루', {
    body: '약속 시간이 되었어요. 우리하루에서 확인해 주세요.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { appUrl: self.registration.scope }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const appUrl = new URL('./', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const appWindow = windows.find((client) => client.url.startsWith(appUrl));
    if (appWindow) return appWindow.focus();
    return self.clients.openWindow(appUrl);
  }));
});

