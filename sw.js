/* ═══════════════════════════════════════
   SERVICE WORKER — For my Loveyy PWA
   Handles: Push notifications, caching, offline
   ═══════════════════════════════════════ */

'use strict';

const CACHE_NAME = 'loveyy-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/songs.js',
  '/js/player.js',
  '/js/messages.js',
  '/js/app.js',
  '/img/cover-art.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Lato:wght@300;400&display=swap',
];

// ── INSTALL: cache shell ─────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS.filter(u => !u.startsWith('https://fonts')))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ───────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for shell, network-first for Firebase ──
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // Let Firebase, fonts, and audio files go through network
  if (url.includes('googleapis.com') || url.includes('firebaseapp.com') ||
      url.includes('gstatic.com') || url.includes('audio/')) {
    return; // browser default
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ───────────────────
// iOS 16.4+ supports Web Push when added to home screen
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');
  let data = { title: 'For my Loveyy 💕', body: '' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : '';
  }

  const options = {
    body:    data.body || '',
    icon:    '/img/cover-art.png',
    badge:   '/img/cover-art.png',
    tag:     data.tag || 'loveyy-msg',
    renotify: true,
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open',    title: '💕 Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'For my Loveyy 💕', options)
  );
});

// ── NOTIFICATION CLICK ────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', url: targetUrl });
          return;
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── BACKGROUND SYNC (message queue) ──────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  // App handles its own Firestore sync; this is a no-op placeholder
  console.log('[SW] Background sync triggered');
}
