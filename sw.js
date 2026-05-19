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
  let data = { title: 'For my Loveyy \ud83d\udc95', body: '', type: 'message' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : '';
  }

  const isCall = data.type === 'call';

  const options = {
    body:               data.body || '',
    icon:               '/img/cover-art.png',
    badge:              '/img/cover-art.png',
    tag:                isCall ? 'loveyy-call' : (data.tag || 'loveyy-msg'),
    renotify:           true,
    silent:             false,
    requireInteraction: isCall,   // call stays until dismissed
    data: {
      url:       data.url       || '/',
      type:      data.type      || 'message',
      callDocId: data.callDocId || null,
      caller:    data.caller    || null,
    },
    vibrate: isCall ? [500, 200, 500, 200, 500, 200, 500] : [200, 100, 200],
    actions: isCall
      ? [
          { action: 'answer',  title: '\ud83d\udcde Answer' },
          { action: 'decline', title: '\ud83d\udcf5 Decline' },
        ]
      : [
          { action: 'open',    title: '\ud83d\udc95 Open' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'For my Loveyy \ud83d\udc95', options)
  );
});

// ── NOTIFICATION CLICK ────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const action    = event.action;

  // ── Call actions ──────────────────────────
  if (notifData.type === 'call') {
    if (action === 'decline') {
      // Tell all clients to decline this call
      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          clients.forEach(c => c.postMessage({ type: 'CALL_DECLINE', callDocId: notifData.callDocId }));
          if (clients.length === 0) self.clients.openWindow('/');
        })
      );
      return;
    }
    // 'answer' or tap on notification body — open app and answer
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin)) {
            client.focus();
            client.postMessage({ type: 'CALL_ANSWER', callDocId: notifData.callDocId, caller: notifData.caller });
            return;
          }
        }
        return self.clients.openWindow('/?call=' + encodeURIComponent(notifData.callDocId || '') + '&caller=' + encodeURIComponent(notifData.caller || ''));
      })
    );
    return;
  }

  // ── Message / other notifications ─────────
  if (action === 'dismiss') return;

  const targetUrl = notifData.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', url: targetUrl });
          return;
        }
      }
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
