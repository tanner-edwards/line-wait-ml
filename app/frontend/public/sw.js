// Service worker for Club 32 PWA push notifications.
//
// Two responsibilities:
//   1. push   — render an OS notification when the scanner sends one
//   2. notificationclick — open / focus the PWA when the user taps it
//
// Payload shape (sent by scanner.js as JSON):
//   { title, body, rideId, type, badge }

self.addEventListener('install', () => {
  // Activate immediately on first install so the first push doesn't have
  // to wait for a tab refresh.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Take control of any already-open tabs without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // Fall back to text if the payload isn't valid JSON for any reason.
    data = { title: 'Club 32', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Club 32';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { rideId: data.rideId, type: data.type, badge: data.badge },
    // Tag collapses repeat notifications for the same ride+type into one
    // visible card (the latest replaces the previous on the lockscreen).
    tag: data.rideId ? `${data.type || 'club32'}-${data.rideId}` : 'club32',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin)) {
        return client.focus();
      }
    }
    return self.clients.openWindow('/');
  })());
});
