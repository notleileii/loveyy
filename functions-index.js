/**
 * Firebase Cloud Functions — Push Notifications
 * Supports: FCM tokens (Android) + Web Push VAPID subscriptions (iOS PWA)
 *
 * Deploy:
 *   npm install -g firebase-tools
 *   firebase login
 *   firebase init functions
 *   npm install web-push   (inside functions/)
 *   firebase deploy --only functions
 *
 * VAPID Keys — generate once:
 *   npx web-push generate-vapid-keys
 * Then set as environment config:
 *   firebase functions:config:set vapid.public_key="..." vapid.private_key="..." vapid.email="mailto:you@example.com"
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp }   = require('firebase-admin/app');
const { getFirestore }    = require('firebase-admin/firestore');
const { getMessaging }    = require('firebase-admin/messaging');
const webpush             = require('web-push');
const functions           = require('firebase-functions');

initializeApp();
const db = getFirestore();

// ── VAPID config (set via firebase functions:config:set) ──────────
const VAPID_PUBLIC_KEY  = functions.config().vapid?.public_key  || process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = functions.config().vapid?.private_key || process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = functions.config().vapid?.email       || process.env.VAPID_EMAIL || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[VAPID] Configured');
} else {
  console.warn('[VAPID] Keys not configured — Web Push will be skipped');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Get the FCM token for a given identity (saved by Cordova/Android app) */
async function getFCMToken(identity) {
  const snap = await db.collection('Tokens').doc(identity).get();
  return snap.exists ? snap.data().fcmToken : null;
}

/** Get the Web Push subscription for a given identity (saved by PWA) */
async function getWebPushSubscription(identity) {
  const snap = await db.collection('web_push_subscriptions').doc(identity).get();
  return snap.exists ? snap.data().subscription : null;
}

/** Send an FCM push (Android / old Cordova) */
async function sendFCMPush(token, title, body) {
  if (!token) return;
  const message = {
    token,
    notification: { title, body },
    android: { priority: 'high', notification: { channelId: 'loveyy_notifs', sound: 'default', priority: 'high' } },
    apns: { payload: { aps: { alert: { title, body }, sound: 'default', badge: 1 } } },
  };
  try {
    const res = await getMessaging().send(message);
    console.log('[FCM] Sent:', res);
  } catch (err) {
    console.error('[FCM] Error:', err.message);
  }
}

/** Send a Web Push notification (iOS PWA / Chrome / Firefox) */
async function sendWebPush(subscription, title, body) {
  if (!subscription || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const payload = JSON.stringify({ title, body, tag: 'loveyy-msg', url: '/' });
  try {
    await webpush.sendNotification(subscription, payload);
    console.log('[WebPush] Sent to subscription');
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — clean up
      console.warn('[WebPush] Subscription expired, removing');
      // Find and delete by subscription endpoint
      const snap = await db.collection('web_push_subscriptions')
        .where('subscription.endpoint', '==', subscription.endpoint).get();
      snap.forEach(doc => doc.ref.delete());
    } else {
      console.error('[WebPush] Error:', err.message);
    }
  }
}

/** Send to a recipient via all available channels */
async function notifyRecipient(recipient, title, body) {
  const [fcmToken, webSub] = await Promise.all([
    getFCMToken(recipient),
    getWebPushSubscription(recipient),
  ]);
  await Promise.all([
    sendFCMPush(fcmToken, title, body),
    sendWebPush(webSub, title, body),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 1: New chat message → notify the OTHER person
// ─────────────────────────────────────────────────────────────────────────────
exports.onNewMessage = onDocumentCreated('messages/{msgId}', async (event) => {
  const data   = event.data.data();
  const sender = data.sender;

  const IDENTITY_A = 'Fayy';
  const IDENTITY_B = 'Leilei';
  const recipient  = sender === IDENTITY_A ? IDENTITY_B : IDENTITY_A;

  let title, body;
  if (data.imageUrl && !data.text) {
    title = `${sender.toUpperCase()} SENT A PHOTO 📷`;
    body  = 'Tap to view the photo';
  } else if (data.voiceUrl) {
    title = `${sender.toUpperCase()} SENT A VM. 🎙️`;
    body  = 'Voice message';
  } else if (data.replyTo) {
    const replyToText = data.replyToText || 'a message';
    const snippet     = (data.text || '').slice(0, 80);
    title = `${sender.toUpperCase()} REPLIED TO YOUR "${replyToText}"`;
    body  = `"${snippet}"`;
  } else {
    title = `${sender.toUpperCase()} MESSAGED YOU`;
    body  = (data.text || '').slice(0, 120);
  }

  await notifyRecipient(recipient, title, body);
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 2: Push queue (app calls sendPushNotification() → Firestore doc)
// The app writes to push_queue/{id} with { to, title, body }
// ─────────────────────────────────────────────────────────────────────────────
exports.onPushQueue = onDocumentCreated('push_queue/{id}', async (event) => {
  const data = event.data.data();
  const { to, title, body } = data;
  if (!to || !title) return;
  await notifyRecipient(to, title, body);
  // Clean up queue doc
  await event.data.ref.delete().catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 3: Sticky note created → notify the OTHER person
// ─────────────────────────────────────────────────────────────────────────────
exports.onNoteCreated = onDocumentCreated('Notes/{docId}', async (event) => {
  await notifyNoteChange(event.data.data());
});

exports.onNoteUpdated = onDocumentUpdated('Notes/{docId}', async (event) => {
  await notifyNoteChange(event.data.after.data());
});

async function notifyNoteChange(data) {
  const owner = data.owner;
  const text  = (data.text || '').trim();
  if (!text) return;

  const IDENTITY_A = 'Fayy';
  const IDENTITY_B = 'Leilei';
  const recipient  = owner === IDENTITY_A ? IDENTITY_B : IDENTITY_A;

  const snippet = text.slice(0, 100);
  const title   = `NEW REMINDER FROM ${owner.toUpperCase()} 📝`;
  await notifyRecipient(recipient, title, snippet);
}
