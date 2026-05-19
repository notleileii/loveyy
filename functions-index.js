/* ═══════════════════════════════════════
   APP.JS — PWA Main coordinator
   No Cordova. Service Worker + Web APIs.
   ═══════════════════════════════════════ */

'use strict';

// ── QUOTES ────────────────────────────────
const QUOTES = [
  "you're my favorite notification",
  "missing you is my cardio",
  "you make my heart do weird things",
  "forever and always, just us",
  "my person, my peace, my everything",
  "you're the song stuck in my head",
  "woke up thinking of you... again",
  "every love song makes sense now",
  "you're my favorite what-if that came true",
  "softest feelings, loudest heart",
  "loving you is the easiest thing i do",
  "you're home, wherever you are",
  "i could pick you out of any crowd",
  "gravity works differently when you're near",
  "the world is quieter when i'm with you",
];

// ── SERVICE WORKER REGISTRATION ───────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Not supported');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[SW] Registered, scope:', reg.scope);

    // Handle SW messages (notification click, call answer/decline from lock screen)
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'NOTIF_CLICK') {
        navigate('messages');
      }
      // CALL_ANSWER / CALL_DECLINE are handled in messages.js initCallListener()
      // because that module owns the call state — nothing else needed here
    });
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

// ── NAVIGATION ────────────────────────────
let _currentPage = 'dashboard';

function navigate(page) {
  if (_currentPage === page) return;
  document.querySelector('.page.active')?.classList.remove('active');
  document.querySelector('.nav-btn.active')?.classList.remove('active');

  const pageEl = document.getElementById(`page-${page}`);
  const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  const titles = { dashboard: 'For my Loveyy', music: 'Music Player', messages: 'Messages' };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[page] || page;

  _currentPage = page;

  if (page === 'music' && !PlayerState.audioCtx) {
    initAudioContext();
  }
}

// ── DASHBOARD ─────────────────────────────
let _clockTimer = null;

function updateDashClock() {
  const dateEl = document.getElementById('dash-date');
  if (!dateEl) return;
  const now = new Date();
  const datePart = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timePart = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  dateEl.textContent = `${datePart}, ${timePart}`;
}

function initDashboard() {
  updateDashClock();
  clearInterval(_clockTimer);
  _clockTimer = setInterval(updateDashClock, 1000);
  const quoteEl = document.getElementById('dash-quote');
  if (quoteEl) {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    quoteEl.textContent = `"${q}"`;
  }
}

// ── TOAST ────────────────────────────────
let _toastTimer = null;
function showToast(msg, duration = 2200) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── NOTIFICATIONS ─────────────────────────
function initNotifications() {
  // Handled by messages.js initWebPush() — nothing else needed
  console.log('[App] Notifications managed by Web Push in messages.js');
}

// ── STICKY NOTE — Firebase "Notes" collection ─────────────────
const STICKY_KEY = 'loveyy_sticky_note';
let _stickyTimer = null;

function getStickyDocId() {
  const user = (typeof MsgState !== 'undefined' && MsgState.currentUser)
    ? MsgState.currentUser
    : (localStorage.getItem('msg_identity') || 'shared');
  return 'note_' + user;
}

function getStickyDb() {
  if (typeof MsgState !== 'undefined' && MsgState.db) return MsgState.db;
  try { return firebase.apps.length ? firebase.firestore() : null; } catch (e) { return null; }
}

function initStickyNote() {
  const textarea   = document.getElementById('sticky-textarea');
  const charCount  = document.getElementById('sticky-char-count');
  const savedBadge = document.getElementById('sticky-saved-indicator');
  const clearBtn   = document.getElementById('sticky-clear-btn');
  if (!textarea) return;

  function loadNote() {
    const db = getStickyDb();
    if (db) {
      db.collection('Notes').doc(getStickyDocId()).get()
        .then(doc => {
          textarea.value = doc.exists ? (doc.data().text || '') : (localStorage.getItem(STICKY_KEY) || '');
          updateStickyMeta(); autoGrowSticky();
        })
        .catch(() => { textarea.value = localStorage.getItem(STICKY_KEY) || ''; updateStickyMeta(); autoGrowSticky(); });
    } else {
      setTimeout(() => {
        const db2 = getStickyDb();
        if (db2) {
          db2.collection('Notes').doc(getStickyDocId()).get()
            .then(doc => { textarea.value = (doc.exists ? doc.data().text : null) ?? localStorage.getItem(STICKY_KEY) ?? ''; updateStickyMeta(); autoGrowSticky(); })
            .catch(() => { textarea.value = localStorage.getItem(STICKY_KEY) || ''; updateStickyMeta(); autoGrowSticky(); });
        } else { textarea.value = localStorage.getItem(STICKY_KEY) || ''; updateStickyMeta(); autoGrowSticky(); }
      }, 2000);
    }
  }

  loadNote();

  textarea.addEventListener('input', () => {
    updateStickyMeta(); autoGrowSticky();
    savedBadge.classList.remove('visible');
    localStorage.setItem(STICKY_KEY, textarea.value);
    clearTimeout(_stickyTimer);
    _stickyTimer = setTimeout(() => {
      const noteText = textarea.value;
      saveNote(noteText, () => {
        savedBadge.classList.add('visible');
        setTimeout(() => savedBadge.classList.remove('visible'), 1800);
        if (noteText.trim() && typeof sendPushNotification === 'function') {
          const sender  = (typeof MsgState !== 'undefined' && MsgState.currentUser) || 'Loveyy';
          const preview = noteText.trim().slice(0, 80);
          sendPushNotification(`NEW REMINDER FROM ${sender.toUpperCase()}:`, preview);
        }
      });
    }, 700);
  });

  clearBtn.addEventListener('click', () => {
    if (textarea.value.trim() === '') return;
    textarea.value = '';
    updateStickyMeta(); autoGrowSticky();
    localStorage.removeItem(STICKY_KEY);
    deleteNote();
    showToast('Note cleared 🌙');
  });

  function updateStickyMeta() { charCount.textContent = `${textarea.value.length} / 500`; }
  function autoGrowSticky() { textarea.style.height = 'auto'; textarea.style.height = Math.max(90, textarea.scrollHeight) + 'px'; }
}

function saveNote(text, onSuccess) {
  const db = getStickyDb();
  if (!db) { if (onSuccess) onSuccess(); return; }
  const docId = getStickyDocId();
  const owner = (typeof MsgState !== 'undefined' && MsgState.currentUser) ? MsgState.currentUser : (localStorage.getItem('msg_identity') || 'shared');
  db.collection('Notes').doc(docId).set({
    text, owner, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), notifyOther: true, notifType: 'reminder',
  }, { merge: true })
  .then(() => { if (onSuccess) onSuccess(); })
  .catch(err => { console.error('[Sticky] Save error:', err.message); });
}

function deleteNote() {
  const db = getStickyDb(); if (!db) return;
  db.collection('Notes').doc(getStickyDocId()).delete().catch(console.error);
}

// ── BOOT ─────────────────────────────────
async function onAppReady() {
  console.log('[App] PWA ready');

  // Register Service Worker first
  await registerServiceWorker();

  // Fade in
  const splash = document.getElementById('splash-screen');
  const app    = document.getElementById('app');
  setTimeout(() => {
    if (splash) splash.classList.add('fade-out');
    if (app)    app.classList.remove('hidden');
    setTimeout(() => splash?.remove(), 700);
  }, 1600);

  // Init modules
  initDashboard();
  initStickyNote();
  initPlayer();
  initMessages();
  initNetworkListener();
  initMessageInput();
  initSenderToggle();

  // Browser back button (PWA)
  window.addEventListener('popstate', () => {
    if (_currentPage !== 'dashboard') navigate('dashboard');
  });

  // Prevent body scroll bounce on iOS
  document.addEventListener('touchmove', (e) => {
    if (e.target === document.body) e.preventDefault();
  }, { passive: false });

  // iOS standalone: tweak viewport for safe areas
  if (window.navigator.standalone) {
    document.documentElement.style.setProperty('--safe-top', 'env(safe-area-inset-top, 44px)');
    document.documentElement.style.setProperty('--safe-bot', 'env(safe-area-inset-bottom, 34px)');
  }
}

// Boot on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onAppReady);
} else {
  onAppReady();
}
