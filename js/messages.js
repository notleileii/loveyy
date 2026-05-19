/* ═══════════════════════════════════════
   MESSAGES MODULE — PWA version
   Firebase Firestore + Web Push (VAPID)
   Works on iOS 16.4+ when added to home screen
   ═══════════════════════════════════════ */

'use strict';

// ── FIREBASE CONFIG ───────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBHh87Al44astKNd9IcX-LzUcUyr56F33o",
  authDomain:        "formyloveyy-47f5d.firebaseapp.com",
  projectId:         "formyloveyy-47f5d",
  storageBucket:     "formyloveyy-47f5d.firebasestorage.app",
  messagingSenderId: "448507621130",
  appId:             "1:448507621130:web:PUT_YOUR_WEB_APP_ID_HERE"
  // ⚠️ Replace appId above with your Web App ID from Firebase console
  // Go to: Project Settings → General → Your apps → Web app → App ID
};

// ── VAPID PUBLIC KEY ──────────────────────
// ⚠️ Generate your VAPID keys:
//   npx web-push generate-vapid-keys
// Then paste the PUBLIC key here and the PRIVATE key in your Cloud Function
const VAPID_PUBLIC_KEY = 'PUT_YOUR_VAPID_PUBLIC_KEY_HERE';

// ── IDENTITIES ────────────────────────────
const IDENTITY_A = 'Fayy';
const IDENTITY_B = 'Leilei';

function getOtherUser(me) {
  return me === IDENTITY_A ? IDENTITY_B : IDENTITY_A;
}

// ── STATE ─────────────────────────────────
const MsgState = {
  db:          null,
  storage:     null,
  collection:  'messages',
  unsubscribe: null,
  messages:    {},
  replyToId:   null,
  editingId:   null,
  isOnline:    true,
  currentUser: localStorage.getItem('msg_identity') || null,
  swRegistration: null,
};

// ── IDENTITY PICKER ───────────────────────
function showIdentityPicker(onPicked) {
  var existing = document.getElementById('identity-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'identity-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,8,6,0.92);display:flex;align-items:center;justify-content:center;';

  function renderPicker(pendingName) {
    if (!pendingName) {
      modal.innerHTML =
        '<div style="background:var(--surface,#252018);border:1px solid var(--border2,#4a4035);border-radius:16px;padding:32px 28px;max-width:300px;width:90%;text-align:center;">'
        + '<div style="font-size:28px;margin-bottom:8px;">💕</div>'
        + '<h2 style="color:var(--accent,#fff);font-size:18px;margin-bottom:6px;">Who are you?</h2>'
        + '<p style="color:var(--ink3,#6a5e4e);font-size:12px;margin-bottom:24px;">Choose carefully — this locks to this device permanently.</p>'
        + '<button id="pick-a" style="display:block;width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:1px solid var(--border2,#4a4035);background:var(--surface2,#2e281f);color:var(--accent,#fff);font-size:16px;font-weight:600;cursor:pointer;">' + IDENTITY_A + '</button>'
        + '<button id="pick-b" style="display:block;width:100%;padding:12px;border-radius:10px;border:1px solid var(--border2,#4a4035);background:var(--surface2,#2e281f);color:var(--accent,#fff);font-size:16px;font-weight:600;cursor:pointer;">' + IDENTITY_B + '</button>'
        + '</div>';
      modal.querySelector('#pick-a').onclick = function() { renderPicker(IDENTITY_A); };
      modal.querySelector('#pick-b').onclick = function() { renderPicker(IDENTITY_B); };
    } else {
      modal.innerHTML =
        '<div style="background:var(--surface,#252018);border:1px solid var(--border2,#4a4035);border-radius:16px;padding:32px 28px;max-width:300px;width:90%;text-align:center;">'
        + '<div style="font-size:36px;margin-bottom:12px;">🔒</div>'
        + '<h2 style="color:var(--accent,#fff);font-size:18px;margin-bottom:8px;">Lock as ' + pendingName + '?</h2>'
        + '<p style="color:var(--ink3,#6a5e4e);font-size:12px;margin-bottom:28px;">This cannot be undone easily. Make sure you\'re on the right device.</p>'
        + '<button id="confirm-pick" style="display:block;width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:none;background:#b5895a;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Yes, I\'m ' + pendingName + '</button>'
        + '<button id="back-pick" style="display:block;width:100%;padding:10px;border-radius:10px;border:1px solid var(--border2,#4a4035);background:transparent;color:var(--ink3,#6a5e4e);font-size:13px;cursor:pointer;">Go back</button>'
        + '</div>';
      modal.querySelector('#confirm-pick').onclick = function() {
        localStorage.setItem('msg_identity', pendingName);
        MsgState.currentUser = pendingName;
        modal.remove();
        onPicked(pendingName);
      };
      modal.querySelector('#back-pick').onclick = function() { renderPicker(null); };
    }
  }

  renderPicker(null);
  document.body.appendChild(modal);
}

// ── INIT ──────────────────────────────────
function initMessages() {
  if (!MsgState.currentUser) {
    showIdentityPicker(function() { bootFirebase(); });
  } else {
    bootFirebase();
  }
}

function bootFirebase() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    MsgState.db      = firebase.firestore();
    MsgState.storage = firebase.storage();

    var authReady = (typeof firebase.auth === 'function')
      ? firebase.auth().signInAnonymously()
          .then(function() { console.log('[Auth] Signed in as:', MsgState.currentUser); })
          .catch(function(err) { console.warn('[Auth] Skipped:', err.message); })
      : Promise.resolve();

    var persistenceReady = authReady.then(function() {
      return MsgState.db.enablePersistence({ synchronizeTabs: false })
        .then(function() { console.log('[DB] Offline persistence enabled'); })
        .catch(function(err) {
          var reason = err.code === 'failed-precondition' ? 'multiple tabs open'
                     : err.code === 'unimplemented' ? 'not supported' : err.message;
          console.warn('[DB] Persistence skipped:', reason);
        });
    });

    persistenceReady.then(function() {
      listenMessages();
      initWebPush();
      initCallListener();
    });

  } catch (e) {
    console.error('[Firebase] Init failed:', e);
    MsgState.db = null;
    renderOfflineMessages();
  }
}

// ══════════════════════════════════════════
//  WEB PUSH — iOS 16.4+ PWA + Chrome/Firefox
// ══════════════════════════════════════════

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function initWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Web Push not supported on this browser/context');
    // Show iOS install banner if needed
    showInstallBannerIfNeeded();
    return;
  }

  try {
    // Get the SW registration
    MsgState.swRegistration = await navigator.serviceWorker.ready;

    // Check current permission
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('[Push] Notification permission denied');
      showToast('Enable notifications in Settings for messages 🔔');
      return;
    }

    // If VAPID key is not configured yet, skip subscription silently
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith('PUT_YOUR')) {
      console.warn('[Push] VAPID key not configured. See README for setup.');
      return;
    }

    // Subscribe or reuse existing subscription
    let subscription = await MsgState.swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await MsgState.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('[Push] New subscription created');
    }

    // Save subscription to Firestore so Cloud Function can send pushes
    await saveWebPushSubscription(subscription);

  } catch (err) {
    console.warn('[Push] Init failed:', err.message);
  }
}

async function saveWebPushSubscription(subscription) {
  if (!MsgState.db || !MsgState.currentUser) return;
  const subJson = subscription.toJSON();
  try {
    await MsgState.db.collection('web_push_subscriptions').doc(MsgState.currentUser).set({
      subscription: subJson,
      userAgent:    navigator.userAgent,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('[Push] Subscription saved for', MsgState.currentUser);
  } catch (err) {
    console.error('[Push] Save subscription error:', err);
  }
}

// Trigger a push via Firestore queue (Cloud Function handles actual FCM/Web Push dispatch)
function sendPushNotification(title, body) {
  if (!MsgState.db) return;
  const to = getOtherUser(MsgState.currentUser);
  MsgState.db.collection('push_queue').add({
    to, title, body,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.warn('[Push] Queue error:', err));
}

// ── iOS INSTALL BANNER ────────────────────
// iOS shows Web Push only when added to home screen
function showInstallBannerIfNeeded() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('install_banner_dismissed');

  if (isIOS && !isInStandalone && !dismissed) {
    let banner = document.getElementById('ios-install-banner');
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'ios-install-banner';
    banner.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;z-index:8500;
      background:var(--surface2);border-top:1px solid var(--border2);
      padding:14px 16px;display:flex;align-items:center;gap:12px;
      box-shadow:0 -4px 20px rgba(0,0,0,0.5);
    `;
    banner.innerHTML = `
      <div style="font-size:28px;flex-shrink:0;">💕</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;color:var(--cream);font-weight:600;margin-bottom:3px;">Add to Home Screen</div>
        <div style="font-size:11px;color:var(--ink3);line-height:1.4;">
          Tap <strong style="color:var(--ink)">Share ⬆</strong> then 
          <strong style="color:var(--ink)">Add to Home Screen</strong> to get notifications
        </div>
      </div>
      <button onclick="document.getElementById('ios-install-banner').remove();localStorage.setItem('install_banner_dismissed','1')"
        style="font-size:18px;color:var(--ink3);padding:4px 6px;flex-shrink:0;">✕</button>
    `;
    document.body.appendChild(banner);
  }
}

// ── IN-APP BANNER ─────────────────────────
function showInAppBanner(title, body) {
  let banner = document.getElementById('notif-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'notif-banner';
    banner.className = 'notif-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <div class="notif-banner-icon">💕</div>
    <div class="notif-banner-text">
      <div class="notif-banner-title">${escapeHTML(title)}</div>
      ${body ? `<div class="notif-banner-body">${escapeHTML(body)}</div>` : ''}
    </div>
    <button class="notif-banner-close" onclick="event.stopPropagation();this.parentElement.classList.remove('show')">✕</button>
  `;
  banner.classList.add('show');
  banner.onclick = function(e) {
    if (e.target.classList.contains('notif-banner-close')) return;
    banner.classList.remove('show');
    navigate('messages');
  };
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove('show'), 5000);
}

// ══════════════════════════════════════════
//  LISTEN MESSAGES
// ══════════════════════════════════════════

function listenMessages() {
  if (MsgState.unsubscribe) MsgState.unsubscribe();

  const q = MsgState.db.collection(MsgState.collection)
    .orderBy('createdAt', 'asc')
    .limitToLast(100);

  let initialLoad  = true;
  let lastSeenSecs = Math.floor(Date.now() / 1000);

  MsgState.unsubscribe = q.onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        if (change.type === 'added' || change.type === 'modified') {
          MsgState.messages[data.id] = data;
          if (!initialLoad && change.type === 'added' && data.sender !== MsgState.currentUser) {
            const msgSecs = data.createdAt?.seconds || 0;
            if (msgSecs >= lastSeenSecs - 5) triggerMessageNotification(data);
          }
        } else if (change.type === 'removed') {
          delete MsgState.messages[data.id];
        }
      });

      if (initialLoad) {
        initialLoad  = false;
        lastSeenSecs = Math.floor(Date.now() / 1000);
      }
      renderMessages();
    },
    (err) => {
      console.error('[DB] Snapshot error:', err);
      renderOfflineMessages();
    }
  );
}

function triggerMessageNotification(msg) {
  const sender = msg.sender || 'Loveyy';
  let title, body;

  if (msg.voiceUrl) {
    title = `${sender} SENT A VM.`;
    body  = '🎙️ Voice message';
  } else if (msg.imageUrl) {
    title = `${sender} SENT A PHOTO.`;
    body  = '📷';
  } else if (msg.replyTo) {
    const ref        = MsgState.messages[msg.replyTo];
    const refPreview = ref
      ? (ref.imageUrl ? 'photo' : ref.voiceUrl ? 'voice message' : truncate(ref.text || '', 30))
      : 'your message';
    title = `${sender} REPLIED TO YOUR "${refPreview}":`;
    body  = `"${truncate(msg.text || '', 60)}"`;
  } else {
    title = `${sender} MESSAGED YOU:`;
    body  = truncate(msg.text || '', 100);
  }

  showInAppBanner(title, body);
  sendPushNotification(title, body);
}

// ── RENDER ────────────────────────────────
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const sorted = Object.values(MsgState.messages).sort((a, b) =>
    (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
  );

  container.innerHTML = '';
  if (sorted.length === 0) {
    container.innerHTML = '<div class="chat-loading" style="color:var(--ink3);font-style:italic;text-align:center;padding:32px 16px;">No messages yet. Say something sweet! 🌸</div>';
    return;
  }

  sorted.forEach(msg => container.appendChild(createBubble(msg)));
  container.scrollTop = container.scrollHeight;
}

function createBubble(msg) {
  const wrap   = document.createElement('div');
  const isSent = msg.sender === MsgState.currentUser;
  wrap.className = `msg-bubble-wrap ${isSent ? 'sent' : 'received'}`;
  wrap.dataset.id = msg.id;

  let inner = '';
  if (msg.replyTo) {
    const ref     = MsgState.messages[msg.replyTo];
    const refText = ref
      ? (ref.voiceUrl ? '🎙️ Voice message' : ref.imageUrl ? '📷 Image' : truncate(ref.text || '', 50))
      : 'Deleted message';
    inner += `<div class="msg-reply-ref">↩ ${escapeHTML(refText)}</div>`;
  }
  if (msg.voiceUrl) {
    inner += buildVoiceBubble(msg.id);
  } else if (msg.imageUrl) {
    inner += `<img src="${escapeHTML(msg.imageUrl)}" alt="image" loading="lazy" />`;
  }
  if (msg.text) inner += `<span class="msg-text">${escapeHTML(msg.text)}</span>`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = inner;
  wrap.appendChild(bubble);
  if (msg.voiceUrl) setTimeout(() => wireVoicePlayer(msg.id, msg.voiceUrl), 0);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  const time = document.createElement('span');
  time.className   = 'msg-time';
  time.textContent = formatMsgTime(msg.createdAt);
  meta.appendChild(time);

  if (msg.edited) {
    const ed = document.createElement('span');
    ed.className   = 'msg-edited';
    ed.textContent = '(edited)';
    meta.appendChild(ed);
  }

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn'; replyBtn.textContent = '↩'; replyBtn.title = 'Reply';
  replyBtn.onclick = () => startReply(msg.id);
  actions.appendChild(replyBtn);

  if (isSent && msg.text && !msg.voiceUrl) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn'; editBtn.textContent = '✎'; editBtn.title = 'Edit';
    editBtn.onclick = () => startEdit(msg.id);
    actions.appendChild(editBtn);
  }

  if (isSent) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn'; delBtn.textContent = '✕'; delBtn.title = 'Delete';
    delBtn.onclick = () => deleteMessage(msg.id);
    actions.appendChild(delBtn);
  }

  meta.appendChild(actions);
  wrap.appendChild(meta);
  return wrap;
}

// ── VOICE MESSAGE BUBBLE ──────────────────
function buildVoiceBubble(msgId) {
  const bars = Array.from({ length: 24 }, (_, i) => {
    const h = 6 + Math.abs(Math.sin(i * 0.8) * 10) + (i % 3 === 0 ? 6 : 0);
    return `<div class="vm-bar" style="height:${h}px"></div>`;
  }).join('');
  return `<div class="vm-bubble" data-id="${msgId}">
    <button class="vm-play-btn" id="vm-play-${msgId}">▶</button>
    <div class="vm-waveform" id="vm-wave-${msgId}">${bars}</div>
    <span class="vm-duration" id="vm-dur-${msgId}">0:00</span>
  </div>`;
}

const _vmAudios = {};

function wireVoicePlayer(msgId, url) {
  const playBtn = document.getElementById(`vm-play-${msgId}`);
  const durEl   = document.getElementById(`vm-dur-${msgId}`);
  const waveEl  = document.getElementById(`vm-wave-${msgId}`);
  if (!playBtn) return;

  if (!_vmAudios[msgId]) _vmAudios[msgId] = new Audio(url);
  const audio = _vmAudios[msgId];

  audio.onloadedmetadata = () => { durEl.textContent = fmtDuration(audio.duration); };
  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    durEl.textContent = fmtDuration(audio.currentTime);
    const progress = audio.currentTime / audio.duration;
    const bars = waveEl.querySelectorAll('.vm-bar');
    const activeCount = Math.floor(progress * bars.length);
    bars.forEach((b, i) => b.classList.toggle('active', i < activeCount));
  };
  audio.onended = () => {
    playBtn.textContent = '▶'; playBtn.classList.remove('playing');
    if (audio.duration) durEl.textContent = fmtDuration(audio.duration);
    waveEl.querySelectorAll('.vm-bar').forEach(b => b.classList.remove('active'));
  };
  playBtn.onclick = () => {
    Object.entries(_vmAudios).forEach(([id, a]) => {
      if (id !== msgId && !a.paused) {
        a.pause();
        const ob = document.getElementById(`vm-play-${id}`);
        if (ob) { ob.textContent = '▶'; ob.classList.remove('playing'); }
      }
    });
    if (audio.paused) {
      audio.play().catch(console.error);
      playBtn.textContent = '⏸'; playBtn.classList.add('playing');
    } else {
      audio.pause();
      playBtn.textContent = '▶'; playBtn.classList.remove('playing');
    }
  };
}

function fmtDuration(secs) {
  if (!isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── VOICE RECORDING ───────────────────────
const VoiceRec = { mediaRecorder: null, chunks: [], stream: null, timerInterval: null };

function startVoiceRecording() {
  if (VoiceRec.mediaRecorder) return;
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
  })
  .then(stream => {
    VoiceRec.stream = stream;
    VoiceRec.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'  // iOS Safari
      : '';
    VoiceRec.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {});
    VoiceRec.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) VoiceRec.chunks.push(e.data); };
    VoiceRec.mediaRecorder.onstop = () => {
      const blob = new Blob(VoiceRec.chunks, { type: VoiceRec.mediaRecorder.mimeType || 'audio/webm' });
      uploadVoiceMessage(blob);
      stopVoiceRecordingUI();
    };
    VoiceRec.mediaRecorder.start(100);
    startVoiceRecordingUI();
  })
  .catch(err => { console.error('[VoiceRec]', err); showToast('Microphone not available'); });
}

function stopVoiceRecording() {
  if (!VoiceRec.mediaRecorder) return;
  VoiceRec.mediaRecorder.stop();
  VoiceRec.stream?.getTracks().forEach(t => t.stop());
  VoiceRec.mediaRecorder = null; VoiceRec.stream = null;
}

function cancelVoiceRecording() {
  if (!VoiceRec.mediaRecorder) return;
  VoiceRec.mediaRecorder.ondataavailable = null;
  VoiceRec.mediaRecorder.onstop = null;
  try { VoiceRec.mediaRecorder.stop(); } catch(e) {}
  VoiceRec.stream?.getTracks().forEach(t => t.stop());
  VoiceRec.mediaRecorder = null; VoiceRec.stream = null; VoiceRec.chunks = [];
  stopVoiceRecordingUI();
  showToast('Recording cancelled');
}

function startVoiceRecordingUI() {
  const micBtn  = document.getElementById('mic-btn');
  const recBar  = document.getElementById('voice-rec-bar');
  const recTime = document.getElementById('voice-rec-time');
  if (micBtn) { micBtn.classList.add('recording'); micBtn.innerHTML = '⏹'; }
  if (recBar) recBar.classList.remove('hidden');
  let elapsed = 0;
  VoiceRec.timerInterval = setInterval(() => {
    elapsed++;
    if (recTime) recTime.textContent = fmtDuration(elapsed);
    if (elapsed >= 120) stopVoiceRecording();
  }, 1000);
}

function stopVoiceRecordingUI() {
  const micBtn = document.getElementById('mic-btn');
  const recBar = document.getElementById('voice-rec-bar');
  if (micBtn) { micBtn.classList.remove('recording'); micBtn.innerHTML = '🎙'; }
  if (recBar) recBar.classList.add('hidden');
  clearInterval(VoiceRec.timerInterval);
}

function toggleVoiceRecording() {
  if (VoiceRec.mediaRecorder) { stopVoiceRecording(); } else { startVoiceRecording(); }
}

function uploadVoiceMessage(blob) {
  if (!MsgState.storage || !MsgState.db) { showToast('Not available offline'); return; }
  showToast('Sending voice message...');
  const ext      = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  const filename = `voice/${Date.now()}.${ext}`;
  const ref      = MsgState.storage.ref().child(filename);
  ref.put(blob, { contentType: blob.type })
    .then(snap => snap.ref.getDownloadURL())
    .then(url => MsgState.db.collection(MsgState.collection).add({
      text: '', voiceUrl: url, voiceType: blob.type,
      sender: MsgState.currentUser, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      edited: false, replyTo: MsgState.replyToId || null,
    }))
    .then(() => {
      cancelReply();
      showToast('Voice message sent 🎙️');
      sendPushNotification(`${MsgState.currentUser} SENT A VM.`, '🎙️ Voice message');
    })
    .catch(err => { console.error('[VoiceUpload]', err); showToast('Voice send failed'); });
}

// ── SEND TEXT MESSAGE ─────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  const replyTo = MsgState.replyToId || null;
  cancelReply();

  if (!MsgState.db) {
    const fakeId = 'local_' + Date.now();
    MsgState.messages[fakeId] = {
      id: fakeId, text, sender: MsgState.currentUser,
      createdAt: { seconds: Date.now() / 1000 }, edited: false, replyTo,
    };
    renderMessages();
    showToast('Saved locally — will sync when online');
    return;
  }

  const tempId = 'temp_' + Date.now();
  MsgState.messages[tempId] = {
    id: tempId, text, sender: MsgState.currentUser,
    createdAt: { seconds: Date.now() / 1000 }, edited: false, replyTo,
  };
  renderMessages();

  MsgState.db.collection(MsgState.collection).add({
    text, sender: MsgState.currentUser,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    edited: false, replyTo,
  })
  .then(() => {
    delete MsgState.messages[tempId];
    let title, body;
    if (replyTo) {
      const ref        = MsgState.messages[replyTo];
      const refPreview = ref ? (ref.imageUrl ? 'photo' : ref.voiceUrl ? 'voice message' : truncate(ref.text || '', 30)) : 'your message';
      title = `${MsgState.currentUser} REPLIED TO YOUR "${refPreview}":`;
      body  = `"${truncate(text, 80)}"`;
    } else {
      title = `${MsgState.currentUser} MESSAGED YOU:`;
      body  = truncate(text, 100);
    }
    sendPushNotification(title, body);
  })
  .catch(err => {
    console.error('[DB] Send error:', err.code, err.message);
    delete MsgState.messages[tempId];
    renderMessages();
    showToast('Send failed: ' + (err.code || err.message));
  });
}

// ── DELETE / ATTACH / REPLY / EDIT ────────
function deleteMessage(msgId) {
  if (!MsgState.db) return;
  MsgState.db.collection(MsgState.collection).doc(msgId).delete()
    .catch(err => { console.error('[DB] Delete error:', err); showToast('Delete failed'); });
}

function attachImage() {
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'image/*';
  fi.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onImageSelected(ev.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  };
  fi.click();
}

function onImageSelected(base64Data) {
  if (!MsgState.storage || !MsgState.db) { showToast('Storage not available offline'); return; }
  showToast('Uploading image...');
  MsgState.storage.ref().child(`images/${Date.now()}.jpg`)
    .putString(base64Data, 'base64', { contentType: 'image/jpeg' })
    .then(snap => snap.ref.getDownloadURL())
    .then(url => MsgState.db.collection(MsgState.collection).add({
      text: '', imageUrl: url, sender: MsgState.currentUser,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      edited: false, replyTo: MsgState.replyToId || null,
    }))
    .then(() => {
      cancelReply();
      showToast('Image sent! 📷');
      sendPushNotification(`${MsgState.currentUser} SENT A PHOTO.`, '📷');
    })
    .catch(err => { console.error('[Storage]', err); showToast('Image upload failed'); });
}

function startReply(msgId) {
  MsgState.replyToId = msgId;
  const msg = MsgState.messages[msgId];
  const preview = msg ? (msg.voiceUrl ? '🎙️ Voice message' : msg.imageUrl ? '📷 Image' : truncate(msg.text || '', 60)) : 'Message';
  const previewEl = document.getElementById('reply-preview');
  const textEl    = document.getElementById('reply-text-preview');
  if (previewEl) previewEl.classList.remove('hidden');
  if (textEl)    textEl.textContent = preview;
  document.getElementById('msg-input')?.focus();
}

function cancelReply() {
  MsgState.replyToId = null;
  document.getElementById('reply-preview')?.classList.add('hidden');
}

function startEdit(msgId) {
  const msg = MsgState.messages[msgId]; if (!msg) return;
  MsgState.editingId = msgId;
  document.getElementById('original-text-view').textContent = msg.originalText || msg.text || '';
  document.getElementById('edit-textarea').value            = msg.text || '';
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  MsgState.editingId = null;
  document.getElementById('edit-modal')?.classList.add('hidden');
}

function confirmEdit() {
  const editArea = document.getElementById('edit-textarea');
  const newText  = (editArea?.value || '').trim();
  if (!newText || !MsgState.editingId) return;
  const msgId  = MsgState.editingId;
  const oldMsg = MsgState.messages[msgId];
  closeEditModal();
  if (!MsgState.db) {
    if (oldMsg) {
      MsgState.messages[msgId] = { ...oldMsg, text: newText, originalText: oldMsg.originalText || oldMsg.text, edited: true };
      renderMessages();
    }
    return;
  }
  MsgState.db.collection(MsgState.collection).doc(msgId).update({
    text: newText, originalText: oldMsg?.originalText || oldMsg?.text || '',
    edited: true, editedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => { console.error('[DB] Edit error:', err); showToast('Edit failed'); });
}

// ══════════════════════════════════════════
//  VOICE CALL — WebRTC + Firestore Signaling
// ══════════════════════════════════════════
const CallState = {
  pc: null, localStream: null, callDocId: null,
  unsubAnswer: null, unsubIce: null,
  isCaller: false, isMuted: false, isSpeaker: false,
  callStart: null, durationTimer: null,
};
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

function initCallListener() {
  if (!MsgState.db || !MsgState.currentUser) return;
  MsgState.db.collection('calls')
    .where('callee', '==', MsgState.currentUser)
    .where('status', '==', 'ringing')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.caller !== MsgState.currentUser) showIncomingCallUI(change.doc.id, data.caller);
        }
      });
    });
}

function showIncomingCallUI(callDocId, callerName) {
  const overlay = document.getElementById('call-overlay');
  if (!overlay) return;
  document.getElementById('call-name').textContent   = callerName;
  document.getElementById('call-status').textContent = 'Incoming call 💕';
  document.getElementById('call-actions').innerHTML = `
    <button class="call-action-btn accept" onclick="answerCall('${callDocId}')">📞</button>
    <button class="call-action-btn decline" onclick="declineCall('${callDocId}')">📵</button>
  `;
  overlay.classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate([500,200,500,200,500]);
}

async function startCall() {
  const other = getOtherUser(MsgState.currentUser);
  if (!MsgState.db) { showToast('Not connected'); return; }
  try {
    CallState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    CallState.isCaller    = true;
    CallState.pc          = new RTCPeerConnection(ICE_SERVERS);
    CallState.localStream.getTracks().forEach(t => CallState.pc.addTrack(t, CallState.localStream));
    const callDoc = MsgState.db.collection('calls').doc();
    CallState.callDocId = callDoc.id;
    CallState.pc.onicecandidate = e => { if (e.candidate) callDoc.collection('callerCandidates').add(e.candidate.toJSON()); };
    const remoteStream = new MediaStream();
    CallState.pc.ontrack = e => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); playRemoteAudio(remoteStream); };
    const offer = await CallState.pc.createOffer();
    await CallState.pc.setLocalDescription(offer);
    await callDoc.set({
      caller: MsgState.currentUser, callee: other, status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showActiveCallUI('Calling ' + other + '…');
    CallState.unsubAnswer = callDoc.onSnapshot(async snap => {
      const data = snap.data(); if (!data) return;
      if (data.answer && !CallState.pc.currentRemoteDescription)
        await CallState.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      if (data.status === 'accepted') { updateCallStatus('Connected 💕'); startCallTimer(); }
      else if (data.status === 'declined' || data.status === 'ended') endCall();
    });
    CallState.unsubIce = callDoc.collection('calleeCandidates').onSnapshot(snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === 'added') await CallState.pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(console.error);
      });
    });
    sendPushNotification(`${MsgState.currentUser} is calling you 📞`, 'Open the app to answer');
  } catch (err) { console.error('[Call] Start error:', err); showToast('Could not start call'); endCall(); }
}

async function answerCall(callDocId) {
  if (!MsgState.db) return;
  try {
    CallState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    CallState.isCaller    = false;
    CallState.callDocId   = callDocId;
    CallState.pc          = new RTCPeerConnection(ICE_SERVERS);
    CallState.localStream.getTracks().forEach(t => CallState.pc.addTrack(t, CallState.localStream));
    const callDoc = MsgState.db.collection('calls').doc(callDocId);
    CallState.pc.onicecandidate = e => { if (e.candidate) callDoc.collection('calleeCandidates').add(e.candidate.toJSON()); };
    const remoteStream = new MediaStream();
    CallState.pc.ontrack = e => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); playRemoteAudio(remoteStream); };
    const callData = (await callDoc.get()).data();
    await CallState.pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answer = await CallState.pc.createAnswer();
    await CallState.pc.setLocalDescription(answer);
    await callDoc.update({ answer: { type: answer.type, sdp: answer.sdp }, status: 'accepted' });
    CallState.unsubIce = callDoc.collection('callerCandidates').onSnapshot(snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === 'added') await CallState.pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(console.error);
      });
    });
    CallState.unsubAnswer = callDoc.onSnapshot(snap => { if (snap.data()?.status === 'ended') endCall(); });
    showActiveCallUI('Connected 💕');
    startCallTimer();
  } catch (err) { console.error('[Call] Answer error:', err); showToast('Could not answer call'); endCall(); }
}

function declineCall(callDocId) {
  MsgState.db?.collection('calls').doc(callDocId).update({ status: 'declined' }).catch(console.error);
  document.getElementById('call-overlay')?.classList.add('hidden');
}

function endCall() {
  if (MsgState.db && CallState.callDocId)
    MsgState.db.collection('calls').doc(CallState.callDocId).update({ status: 'ended' }).catch(() => {});
  CallState.pc?.close();
  CallState.localStream?.getTracks().forEach(t => t.stop());
  CallState.unsubAnswer?.(); CallState.unsubIce?.();
  clearInterval(CallState.durationTimer);
  const audioEl = document.getElementById('remote-audio');
  if (audioEl) audioEl.srcObject = null;
  Object.assign(CallState, { pc: null, localStream: null, callDocId: null, unsubAnswer: null, unsubIce: null, isCaller: false, isMuted: false, isSpeaker: false, callStart: null, durationTimer: null });
  document.getElementById('call-overlay')?.classList.add('hidden');
}

function toggleMute() {
  if (!CallState.localStream) return;
  CallState.isMuted = !CallState.isMuted;
  CallState.localStream.getAudioTracks().forEach(t => { t.enabled = !CallState.isMuted; });
  const btn = document.getElementById('btn-mute');
  if (btn) { btn.textContent = CallState.isMuted ? '🔇' : '🎤'; btn.classList.toggle('active', CallState.isMuted); }
  showToast(CallState.isMuted ? 'Muted 🔇' : 'Unmuted 🎤');
}

function toggleSpeaker() {
  CallState.isSpeaker = !CallState.isSpeaker;
  const audioEl = document.getElementById('remote-audio');
  if (audioEl?.setSinkId) audioEl.setSinkId(CallState.isSpeaker ? 'default' : '').catch(console.error);
  const btn = document.getElementById('btn-speaker');
  if (btn) { btn.textContent = CallState.isSpeaker ? '🔊' : '🔈'; btn.classList.toggle('active', CallState.isSpeaker); }
  showToast(CallState.isSpeaker ? 'Speaker on 🔊' : 'Earpiece 🔈');
}

function playRemoteAudio(stream) {
  let audioEl = document.getElementById('remote-audio');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'remote-audio'; audioEl.autoplay = true; audioEl.playsInline = true;
    document.body.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
}

function showActiveCallUI(statusText) {
  const overlay = document.getElementById('call-overlay'); if (!overlay) return;
  document.getElementById('call-name').textContent   = getOtherUser(MsgState.currentUser);
  document.getElementById('call-status').textContent = statusText;
  document.getElementById('call-actions').innerHTML = `
    <button class="call-action-btn" id="btn-mute"    onclick="toggleMute()">🎤</button>
    <button class="call-action-btn" id="btn-speaker" onclick="toggleSpeaker()">🔈</button>
    <button class="call-action-btn end"              onclick="endCall()">📵</button>
  `;
  overlay.classList.remove('hidden');
}

function updateCallStatus(text) { const el = document.getElementById('call-status'); if (el) el.textContent = text; }

function startCallTimer() {
  CallState.callStart = Date.now();
  const durationEl = document.getElementById('call-duration');
  CallState.durationTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - CallState.callStart) / 1000);
    if (durationEl) durationEl.textContent = fmtDuration(secs);
  }, 1000);
}

// ── NETWORK LISTENER ─────────────────────
function initNetworkListener() {
  function setOnline(online) {
    MsgState.isOnline = online;
    const indicator = document.getElementById('online-indicator');
    if (indicator) { indicator.classList.toggle('offline', !online); indicator.title = online ? 'Online' : 'Offline'; }
    if (online) { showToast('Back online ✓'); if (!MsgState.unsubscribe) listenMessages(); }
    else { showToast('Offline mode'); renderOfflineMessages(); }
  }
  window.addEventListener('online',  () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  setOnline(navigator.onLine);
}

function renderOfflineMessages() {
  const container = document.getElementById('chat-messages'); if (!container) return;
  const sorted = Object.values(MsgState.messages).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  if (sorted.length > 0) { renderMessages(); showToast('Offline — showing cached messages'); }
  else {
    container.innerHTML = `<div class="chat-loading" style="text-align:center;padding:32px 16px;">
      <div style="font-size:24px;margin-bottom:8px;">📵</div>
      <div style="color:var(--ink2);font-size:13px;">You're offline</div>
      <div style="color:var(--ink3);font-size:11px;margin-top:4px;">Messages will appear when you reconnect</div>
    </div>`;
  }
}

// ── DEV: SENDER TOGGLE ────────────────────
function initSenderToggle() {
  const area = document.querySelector('.chat-input-area'); if (!area) return;
  const label = document.createElement('span');
  label.id = 'dev-sender-label';
  label.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--border2);background:var(--surface2);color:var(--ink3);white-space:nowrap;flex-shrink:0;user-select:none;cursor:default;';
  label.title = 'Identity locked. Tap 7x to reset.';
  label.textContent = 'as: ' + (MsgState.currentUser || '?');
  let _tapCount = 0, _tapTimer = null;
  label.addEventListener('click', () => {
    _tapCount++; clearTimeout(_tapTimer);
    if (_tapCount >= 7) {
      _tapCount = 0;
      localStorage.removeItem('msg_identity');
      MsgState.currentUser = null;
      label.remove();
      showIdentityPicker(function() { bootFirebase(); initSenderToggle(); });
    } else {
      _tapTimer = setTimeout(() => { _tapCount = 0; }, 1200);
    }
  });
  const input = document.getElementById('msg-input');
  if (input) area.insertBefore(label, input);
}

// ── ENTER TO SEND ────────────────────────
function initMessageInput() {
  const input = document.getElementById('msg-input'); if (!input) return;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
}

// ── HELPERS ───────────────────────────────
function formatMsgTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const now  = new Date();
  const diff = now - date;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }
