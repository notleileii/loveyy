# 💕 For my Loveyy — PWA Version

A Progressive Web App version of the personal app.  
Works on **iOS 16.4+** (added to Home Screen) and any modern browser.

---

## 📂 File Structure

```
pwa/
├── index.html              ← App shell
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker (offline + push)
├── functions-index.js      ← Firebase Cloud Functions (deploy as index.js)
├── css/
│   └── app.css             ← Same styles as Cordova version
├── js/
│   ├── songs.js            ← Song list (unchanged)
│   ├── player.js           ← Music player (unchanged — uses MediaSession API)
│   ├── messages.js         ← Messages + Web Push subscription
│   └── app.js              ← App coordinator (no Cordova)
├── img/
│   └── cover-art.png       ← App icon (512×512)
└── audio/
    └── (copy your MP3s here)
```

---

## 🚀 Setup

### 1. Firebase Web App ID

In `js/messages.js`, update the `appId` in `FIREBASE_CONFIG`:

```js
appId: "1:448507621130:web:YOUR_WEB_APP_ID"
```

To find it:
1. Firebase Console → Project Settings → Your Apps
2. Click **Add app** → Web (</>) if you haven't added one
3. Copy the `appId` value

### 2. VAPID Keys (for Web Push / iOS notifications)

Generate once:
```bash
npx web-push generate-vapid-keys
```

**Public key** → paste into `js/messages.js`:
```js
const VAPID_PUBLIC_KEY = 'your_public_key_here';
```

**Private key + email** → set as Firebase config:
```bash
firebase functions:config:set \
  vapid.public_key="your_public_key" \
  vapid.private_key="your_private_key" \
  vapid.email="mailto:you@example.com"
```

### 3. Update Cloud Function

Replace your existing `functions/index.js` with `functions-index.js` from this folder.

Install the `web-push` package in your functions:
```bash
cd functions
npm install web-push
```

Then deploy:
```bash
firebase deploy --only functions
```

### 4. Copy MP3 files

```bash
cp Songs/*.mp3 audio/
```

### 5. Deploy / Serve

**Option A — Firebase Hosting (recommended):**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # set public dir to "pwa"
firebase deploy
```

**Option B — Any HTTPS server:**  
The app must be served over HTTPS for Service Workers and Web Push to work.

```bash
# Quick local test with SSL (requires mkcert):
npx serve pwa --ssl
# or
python3 -m http.server 8080  # no SW/push, but UI works
```

---

## 📱 iOS Setup (Add to Home Screen)

Push notifications on iOS **require** the app to be added to the Home Screen:

1. Open the PWA URL in **Safari** on iPhone/iPad
2. Tap the **Share ⬆** button
3. Tap **Add to Home Screen**
4. Open the app from the Home Screen icon
5. Grant notification permission when prompted

> ⚠️ Push notifications are **NOT supported in Safari browser tabs** on iOS.  
> They only work when the app is opened from the Home Screen (standalone mode).  
> Requires iOS 16.4 or later.

---

## 🔔 How Notifications Work

```
User sends message
      ↓
Firestore document written
      ↓
Cloud Function triggers
      ↓
  ┌──────────────┬───────────────────────┐
  │              │                       │
FCM token    Web Push subscription    (fallback)
(Android)   (iOS PWA / Chrome)
  │              │
notification  notification
shown on      shown on iOS
Android       Home Screen app
```

### Notification channels:
- **iOS PWA (added to home screen)** — Web Push VAPID via `web_push_subscriptions` Firestore collection
- **Android / Chrome** — FCM token via existing `Tokens` Firestore collection
- **In-app** — Real-time Firestore listener shows banner while app is open

---

## 🎵 Music — Background & Notification Controls

The Music Player uses the **MediaSession API** which is natively supported by iOS Safari and Chrome.  
When a song plays, the lock screen / notification centre shows:
- Track title & artist
- Play / Pause, Next, Previous buttons
- Seek forward/back

No extra setup needed — it works automatically.

**Note:** MP3 files must be hosted with the app (in `audio/`) or on a CORS-enabled CDN. They cannot be streamed from a different origin without proper CORS headers.

---

## 🔧 Key Differences from Cordova Version

| Feature | Cordova | PWA |
|---|---|---|
| Push notifications | Firebase Plugin (FCM) | Web Push VAPID + SW |
| iOS notification setup | `UIBackgroundModes` in config.xml | Add to Home Screen |
| Background audio | Background mode plugin | MediaSession API |
| File picker | Camera plugin | `<input type="file">` |
| App distribution | App Store / APK | URL (any HTTPS host) |
| Install | App Store / APK | "Add to Home Screen" |

---

## 🔐 Firestore Rules

Make sure these collections allow read/write:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /messages/{msg} { allow read, write: if true; }
    match /web_push_subscriptions/{user} { allow read, write: if true; }
    match /push_queue/{id} { allow read, write: if true; }
    match /Notes/{doc} { allow read, write: if true; }
    match /Tokens/{user} { allow read, write: if true; }
    match /calls/{call} { allow read, write: if true; }
  }
}
```

---

## 🆘 Troubleshooting

**Push not working on iOS:**
- Must be iOS 16.4+
- Must be added to Home Screen (not Safari browser tab)
- VAPID keys must be configured in both `messages.js` and Cloud Functions

**`sw.js` not registering:**
- Must be served over HTTPS (or localhost)
- `sw.js` must be at the root path `/sw.js`

**Songs not playing:**
- MP3s must be in `audio/` before deploying
- Filenames must match `songs.js` exactly
