// One-time cleanup for clients that installed Flutter's former offline worker.
// The current web build uses network/cache headers instead of a PWA cache so
// users receive new releases immediately.
const flutterCacheNames = new Set([
  'flutter-app-cache',
  'flutter-app-manifest',
  'flutter-temp-cache',
]);

const isFlutterCache = (cacheName) =>
  flutterCacheNames.has(cacheName) || cacheName.startsWith('flutter-');

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isFlutterCache).map((key) => caches.delete(key)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      await self.registration.unregister();
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    })(),
  );
});
