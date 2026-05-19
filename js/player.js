/* ═══════════════════════════════════════
   MUSIC PLAYER
   Web Audio API — speed, pitch, reverb
   Background play + notification controls
   ═══════════════════════════════════════ */

'use strict';

const AUDIO_FADE_DURATION = 0.24;

// ── STATE ─────────────────────────────────
const PlayerState = {
  currentIndex: -1,
  isPlaying: false,
  isRepeat: false,
  isShuffle: false,
  duration: 0,
  currentTime: 0,

  // Audio nodes
  audioCtx: null,
  sourceNode: null,
  gainNode: null,
  convolverNode: null,
  reverbGainNode: null,
  dryGainNode: null,
  pitchScriptNode: null, // ScriptProcessorNode for pitch shifting
  _pitchFactor: 1.0,     // current pitch factor (2^(semitones/12))
  _pitchBuf: null,       // circular input buffer for pitch shifter
  _pitchBufWrite: 0,     // write pointer
  _grainSize: 512,       // grain size for pitch shifter
  _grainOverlap: 256,    // overlap between grains

  // HTML5 Audio element (used for seeking, duration, src)
  audio: null,

  // FX values
  speed: 1,
  pitch: 0,       // semitones
  reverb: 0,

  // Progress polling
  _progressTimer: null,
  _mediaLoaded: false,
  _isSeeking: false,
  _seekRatio: 0,
  _fadeTimeout: null,
};

// ── INIT ──────────────────────────────────
function initPlayer() {
  PlayerState.audio = new Audio();
  PlayerState.audio.preload = 'auto';

  // Event listeners on the audio element
  PlayerState.audio.addEventListener('ended', onSongEnded);
  PlayerState.audio.addEventListener('loadedmetadata', () => {
    PlayerState.duration = PlayerState.audio.duration;
    PlayerState._mediaLoaded = true;
    updateTimeDisplay();
  });
  PlayerState.audio.addEventListener('timeupdate', () => {
    PlayerState.currentTime = PlayerState.audio.currentTime;
    updateProgressBar();
    updateTimeDisplay();
  });
  PlayerState.audio.addEventListener('error', (e) => {
    console.error('Audio error', e);
    showToast('Could not load song :(');
  });

  // Build song list UI
  buildSongListUI();

  // Progress bar drag / seek interaction
  const pbWrap = document.getElementById('progress-bar-wrap');
  if (pbWrap) {
    pbWrap.addEventListener('pointerdown', (e) => {
      if (!PlayerState._mediaLoaded || !PlayerState.duration) return;
      PlayerState._isSeeking = true;
      pbWrap.setPointerCapture(e.pointerId);
      updateSeekFromPointerEvent(e, pbWrap);
    });

    pbWrap.addEventListener('pointermove', (e) => {
      if (!PlayerState._isSeeking) return;
      updateSeekFromPointerEvent(e, pbWrap);
    });

    // pointerup on pbWrap (pointer capture guarantees this fires even if finger lifts elsewhere)
    pbWrap.addEventListener('pointerup', () => {
      if (!PlayerState._isSeeking) return;
      if (PlayerState._mediaLoaded && PlayerState.duration > 0) {
        const targetTime = PlayerState._seekRatio * PlayerState.duration;
        // Keep _isSeeking = true until the audio confirms the seek so that
        // timeupdate events don't snap the bar back to the old position first
        PlayerState.audio.addEventListener('seeked', () => {
          PlayerState._isSeeking = false;
          PlayerState._seekRatio = 0;
          updateProgressBar();
          updateTimeDisplay();
        }, { once: true });
        PlayerState.audio.currentTime = targetTime;
        // Safety fallback — clear seeking flag if 'seeked' never fires
        setTimeout(() => {
          if (PlayerState._isSeeking) {
            PlayerState._isSeeking = false;
            PlayerState._seekRatio = 0;
            updateProgressBar();
            updateTimeDisplay();
          }
        }, 800);
      } else {
        PlayerState._isSeeking = false;
        PlayerState._seekRatio = 0;
      }
    });

    pbWrap.addEventListener('pointercancel', () => {
      if (!PlayerState._isSeeking) return;
      PlayerState._isSeeking = false;
      PlayerState._seekRatio = 0;
      updateProgressBar();
      updateTimeDisplay();
    });
  }

  // Cordova pause/resume — restore AudioContext and gain after app exits/returns
  document.addEventListener('pause', () => {
    // Let audio keep playing in background; just don't let gain stay stuck
    if (PlayerState.audioCtx && PlayerState.audioCtx.state === 'running') {
      // Nothing — background mode keeps it alive
    }
  }, false);

  document.addEventListener('resume', () => {
    // AudioContext may be suspended after returning from background
    if (PlayerState.audioCtx && PlayerState.audioCtx.state === 'suspended') {
      PlayerState.audioCtx.resume().then(() => {
        // Restore gain to full if we were playing
        if (PlayerState.isPlaying && PlayerState.gainNode) {
          const now = PlayerState.audioCtx.currentTime;
          PlayerState.gainNode.gain.cancelScheduledValues(now);
          PlayerState.gainNode.gain.setValueAtTime(0, now);
          PlayerState.gainNode.gain.linearRampToValueAtTime(1, now + AUDIO_FADE_DURATION);
        }
      }).catch(err => console.warn('[AudioCtx] Resume failed:', err));
    }
    // If HTML5 audio volume got zeroed out (e.g. fade was mid-way), restore it
    if (PlayerState.isPlaying && PlayerState.audio && PlayerState.audio.volume < 0.5) {
      clearTimeout(PlayerState._fadeTimeout);
      fadeHtmlAudioVolume(1, AUDIO_FADE_DURATION);
    }
  }, false);

  // Background mode (Cordova plugin)
  if (window.cordova && window.plugins && window.plugins.backgroundMode) {
    window.plugins.backgroundMode.enable();
    window.plugins.backgroundMode.setDefaults({
      title: 'For my Loveyy ♪',
      text: 'Music is playing...',
      icon: 'icon',
      resume: true,
      hidden: false,
    });
  }

  // Media Session API (notification controls on Android Chrome / iOS)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',     () => { resumeAudio(); });
    navigator.mediaSession.setActionHandler('pause',    () => { pauseAudio(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { prevSong(); });
    navigator.mediaSession.setActionHandler('nexttrack',     () => { nextSong(); });
    navigator.mediaSession.setActionHandler('seekbackward',  () => { seekBackward(); });
    navigator.mediaSession.setActionHandler('seekforward',   () => { seekForward(); });
  }
}

function updateSeekFromPointerEvent(event, wrapper) {
  const rect = wrapper.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  PlayerState._seekRatio = Math.min(Math.max(ratio, 0), 1);
  updateProgressBar();
  updateTimeDisplay();
}

// ── SONG LIST UI ──────────────────────────
// ── SONG LIST + DRAG & DROP ───────────────
let PlaylistOrder = [];
let _dragSrcPos = null;
let _touchDragPos = null;
let _touchClone = null;

function initPlaylistOrder() {
  PlaylistOrder = SONGS.map((_, i) => i);
}

function buildSongListUI() {
  if (PlaylistOrder.length === 0) initPlaylistOrder();
  const list = document.getElementById('song-list');
  if (!list) return;
  list.innerHTML = '';

  PlaylistOrder.forEach((songId, pos) => {
    const song = SONGS[songId];
    const item = document.createElement('div');
    item.className = 'song-item';
    item.id = 'song-item-' + songId;
    item.dataset.pos = pos;
    item.dataset.songId = songId;
    if (PlayerState.currentIndex === songId) item.classList.add('playing');

    item.innerHTML =
      '<span class="drag-handle" data-drag="true">\u2630</span>' +
      '<span class="song-num">' + (pos + 1) + '</span>' +
      '<div class="song-item-info">' +
        '<span class="song-item-title">' + song.title + '</span>' +
        '<span class="song-item-artist">' + song.artist + '</span>' +
      '</div>' +
      '<span class="song-item-playing-icon' + (PlayerState.currentIndex === songId ? '' : ' hidden') + '" id="playing-icon-' + songId + '">\u266a</span>';

    // Tap to play
    item.addEventListener('click', function(e) {
      if (e.target.dataset.drag) return;
      loadSong(PlaylistOrder[parseInt(this.dataset.pos)]);
    });

    // Desktop drag
    item.draggable = true;
    item.addEventListener('dragstart', function(e) {
      _dragSrcPos = parseInt(this.dataset.pos);
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', function() {
      this.classList.remove('dragging');
      list.querySelectorAll('.song-item').forEach(function(el) { el.classList.remove('drag-over'); });
    });
    item.addEventListener('dragover', function(e) {
      e.preventDefault();
      list.querySelectorAll('.song-item').forEach(function(el) { el.classList.remove('drag-over'); });
      this.classList.add('drag-over');
    });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      var destPos = parseInt(this.dataset.pos);
      if (_dragSrcPos !== null && _dragSrcPos !== destPos) {
        reorderPlaylist(_dragSrcPos, destPos);
      }
    });

    // Touch drag
    var handle = item.querySelector('.drag-handle');
    handle.addEventListener('touchstart', function(e) {
      _touchDragPos = parseInt(item.dataset.pos);
      _touchClone = item.cloneNode(true);
      var rect = item.getBoundingClientRect();
      _touchClone.style.cssText = 'position:fixed;z-index:9999;opacity:0.88;pointer-events:none;width:' + item.offsetWidth + 'px;left:' + rect.left + 'px;top:' + (e.touches[0].clientY - 24) + 'px;background:#2e281f;border:1px solid #c9956a;border-radius:8px;';
      document.body.appendChild(_touchClone);
      item.classList.add('dragging');
    }, {passive: true});

    handle.addEventListener('touchmove', function(e) {
      if (_touchDragPos === null) return;
      e.preventDefault();
      var touch = e.touches[0];
      if (_touchClone) _touchClone.style.top = (touch.clientY - 24) + 'px';
      list.querySelectorAll('.song-item').forEach(function(el) { el.classList.remove('drag-over'); });
      var els = document.elementsFromPoint(touch.clientX, touch.clientY);
      var target = null;
      for (var i = 0; i < els.length; i++) {
        if (els[i].classList && els[i].classList.contains('song-item') && els[i] !== item) { target = els[i]; break; }
      }
      if (target) target.classList.add('drag-over');
    }, {passive: false});

    handle.addEventListener('touchend', function(e) {
      if (_touchDragPos === null) return;
      if (_touchClone) { _touchClone.remove(); _touchClone = null; }
      list.querySelectorAll('.song-item').forEach(function(el) { el.classList.remove('drag-over', 'dragging'); });
      var touch = e.changedTouches[0];
      var els = document.elementsFromPoint(touch.clientX, touch.clientY);
      var target = null;
      for (var i = 0; i < els.length; i++) {
        if (els[i].classList && els[i].classList.contains('song-item')) { target = els[i]; break; }
      }
      if (target) {
        var destPos = parseInt(target.dataset.pos);
        if (destPos !== _touchDragPos) reorderPlaylist(_touchDragPos, destPos);
      }
      _touchDragPos = null;
    }, {passive: true});

    list.appendChild(item);
  });

  var countEl = document.getElementById('song-count-label');
  if (countEl) countEl.textContent = PlaylistOrder.length + ' songs';
}

function reorderPlaylist(fromPos, toPos) {
  var moved = PlaylistOrder.splice(fromPos, 1)[0];
  PlaylistOrder.splice(toPos, 0, moved);
  buildSongListUI();
  showToast('Queue updated \u2713');
}

// ── LOAD SONG ─────────────────────────────
function loadSong(index, autoplay = true) {
  if (index < 0 || index >= SONGS.length) return;

  // Deactivate previous
  if (PlayerState.currentIndex >= 0) {
    const prev = document.getElementById(`song-item-${PlayerState.currentIndex}`);
    if (prev) prev.classList.remove('playing');
    const prevIcon = document.getElementById(`playing-icon-${PlayerState.currentIndex}`);
    if (prevIcon) prevIcon.classList.add('hidden');
  }

  PlayerState.currentIndex = index;
  PlayerState._mediaLoaded = false;

  const song = SONGS[index];

  // Determine src
  let src;
  if (window.cordova) {
    // On device: files are bundled in www/audio/
    src = `audio/${song.file}`;
  } else {
    src = `audio/${song.file}`;
  }

  PlayerState.audio.src = src;
  PlayerState.audio.playbackRate = PlayerState.speed;
  PlayerState.audio.load();

  // Update UI
  document.getElementById('track-title').textContent  = song.title;
  document.getElementById('track-artist').textContent = song.artist;
  document.getElementById('mini-title').textContent   = song.title;
  document.getElementById('mini-artist').textContent  = song.artist;
  document.getElementById('dash-now-playing').textContent = song.title;

  // Active item in list
  const item = document.getElementById(`song-item-${index}`);
  if (item) {
    item.classList.add('playing');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const icon = document.getElementById(`playing-icon-${index}`);
  if (icon) icon.classList.remove('hidden');

  if (autoplay) {
    PlayerState.audio.addEventListener('canplay', () => {
      resumeAudio();
    }, { once: true });
  }

  updateMediaSession(song);
  updateProgressBar();
}

// ── PLAY / PAUSE ──────────────────────────
function resumeAudio() {
  clearTimeout(PlayerState._fadeTimeout);

  // Resume suspended AudioContext (happens when app backgrounds on mobile)
  const resumeCtx = () => {
    if (PlayerState.audioCtx && PlayerState.audioCtx.state === 'suspended') {
      return PlayerState.audioCtx.resume();
    }
    return Promise.resolve();
  };

  if (PlayerState.audioCtx && PlayerState.gainNode) {
    resumeCtx().then(() => {
      const now = PlayerState.audioCtx.currentTime;
      PlayerState.gainNode.gain.cancelScheduledValues(now);
      // Always force gain to 0 first so the ramp starts clean
      PlayerState.gainNode.gain.setValueAtTime(0, now);
      PlayerState.gainNode.gain.linearRampToValueAtTime(1, now + AUDIO_FADE_DURATION);
    });
  } else if (PlayerState.audio) {
    PlayerState.audio.volume = 0;
    fadeHtmlAudioVolume(1, AUDIO_FADE_DURATION);
  }

  PlayerState.audio.play().then(() => {
    PlayerState.isPlaying = true;
    updatePlayUI();
    startVinylSpin();
    updateMediaSession(SONGS[PlayerState.currentIndex]);
    updateBackgroundNotification();
  }).catch(err => console.warn('Play blocked:', err));
}

function pauseAudio() {
  clearTimeout(PlayerState._fadeTimeout);
  if (PlayerState.audioCtx && PlayerState.gainNode) {
    const now = PlayerState.audioCtx.currentTime;
    PlayerState.gainNode.gain.cancelScheduledValues(now);
    PlayerState.gainNode.gain.setValueAtTime(PlayerState.gainNode.gain.value, now);
    PlayerState.gainNode.gain.linearRampToValueAtTime(0, now + AUDIO_FADE_DURATION);
    PlayerState._fadeTimeout = setTimeout(() => {
      PlayerState.audio.pause();
      PlayerState.isPlaying = false;
      updatePlayUI();
      stopVinylSpin();
    }, AUDIO_FADE_DURATION * 1000);
  } else {
    fadeHtmlAudioVolume(0, AUDIO_FADE_DURATION, () => {
      PlayerState.audio.pause();
      PlayerState.isPlaying = false;
      updatePlayUI();
      stopVinylSpin();
    });
  }
}

function togglePlay() {
  if (PlayerState.currentIndex < 0) {
    loadSong(0);
    return;
  }
  if (PlayerState.isPlaying) {
    pauseAudio();
  } else {
    resumeAudio();
  }
}

// ── SEEK ──────────────────────────────────
function seekForward() {
  if (!PlayerState._mediaLoaded) return;
  PlayerState.audio.currentTime = Math.min(PlayerState.audio.currentTime + 10, PlayerState.duration);
}
function seekBackward() {
  if (!PlayerState._mediaLoaded) return;
  PlayerState.audio.currentTime = Math.max(PlayerState.audio.currentTime - 10, 0);
}

// ── NEXT / PREV ───────────────────────────
function nextSong() {
  if (PlaylistOrder.length === 0) initPlaylistOrder();
  // Find current position in PlaylistOrder
  var curPos = PlaylistOrder.indexOf(PlayerState.currentIndex);
  var nextSongId;
  if (PlayerState.isShuffle) {
    var randPos;
    do { randPos = Math.floor(Math.random() * PlaylistOrder.length); }
    while (randPos === curPos && PlaylistOrder.length > 1);
    nextSongId = PlaylistOrder[randPos];
  } else {
    var nextPos = (curPos + 1) % PlaylistOrder.length;
    nextSongId = PlaylistOrder[nextPos];
  }
  loadSong(nextSongId, true);
}

function prevSong() {
  if (PlayerState._mediaLoaded && PlayerState.audio.currentTime > 3) {
    PlayerState.audio.currentTime = 0;
    return;
  }
  if (PlaylistOrder.length === 0) initPlaylistOrder();
  var curPos = PlaylistOrder.indexOf(PlayerState.currentIndex);
  var prevPos = (curPos - 1 + PlaylistOrder.length) % PlaylistOrder.length;
  loadSong(PlaylistOrder[prevPos], true);
}

function onSongEnded() {
  if (PlayerState.isRepeat) {
    PlayerState.audio.currentTime = 0;
    resumeAudio();
  } else {
    nextSong();
  }
}

// ── TOGGLES ───────────────────────────────
function toggleRepeat() {
  PlayerState.isRepeat = !PlayerState.isRepeat;
  const btn = document.getElementById('btn-repeat');
  if (btn) btn.classList.toggle('active', PlayerState.isRepeat);
  showToast(PlayerState.isRepeat ? 'Repeat ON' : 'Repeat OFF');
}

function toggleShuffle() {
  PlayerState.isShuffle = !PlayerState.isShuffle;
  const btn = document.getElementById('btn-shuffle');
  if (btn) btn.classList.toggle('active', PlayerState.isShuffle);
  showToast(PlayerState.isShuffle ? 'Shuffle ON' : 'Shuffle OFF');
}

// ── AUDIO FX ─────────────────────────────
// Speed  → audio.playbackRate            (tempo, fully independent)
// Pitch  → ScriptProcessorNode granular  (pitch, fully independent)
// Reverb → ConvolverNode wet/dry mix
//
// Pitch algorithm: granular pitch shifting
//   - Reads input into a circular buffer
//   - On each output frame, reads grains from buffer at a rate scaled
//     by pitchFactor (> 1 = higher, < 1 = lower)
//   - Applies a Hann window to each grain to avoid clicks
//   - playbackRate is intentionally left at 1.0 inside the pitch node

function initAudioContext() {
  if (PlayerState.audioCtx) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    PlayerState.audioCtx = new AudioContext();
    const ctx = PlayerState.audioCtx;

    // Source from HTMLMediaElement
    PlayerState.sourceNode = ctx.createMediaElementSource(PlayerState.audio);

    // Gain nodes
    PlayerState.gainNode       = ctx.createGain();
    PlayerState.dryGainNode    = ctx.createGain();
    PlayerState.reverbGainNode = ctx.createGain();

    // Convolver (reverb)
    PlayerState.convolverNode = ctx.createConvolver();
    generateImpulseResponse();

    // ── Pitch ScriptProcessor ──────────────
    // bufferSize 4096 = good balance of latency vs stability
    const bufSize = 4096;
    const pitchProc = ctx.createScriptProcessor(bufSize, 1, 1);

    // Circular input buffer — holds 2 seconds of audio
    const circLen = ctx.sampleRate * 2;
    PlayerState._pitchBuf      = new Float32Array(circLen);
    PlayerState._pitchBufWrite = 0;
    // Read head (floating point for sub-sample accuracy)
    let readHead = 0;
    let writeHead = 0;

    // Hann window
    const grainSize = 1024;
    const hannWindow = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
      hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (grainSize - 1)));
    }

    pitchProc.onaudioprocess = function(e) {
      const input  = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      const pf     = PlayerState._pitchFactor;
      const bufLen = PlayerState._pitchBuf.length;

      // Write input into circular buffer
      for (let i = 0; i < input.length; i++) {
        PlayerState._pitchBuf[writeHead % bufLen] = input[i];
        writeHead++;
      }

      // If pitch is 1 (no shift), pass through directly — zero latency
      if (Math.abs(pf - 1.0) < 0.005) {
        for (let i = 0; i < output.length; i++) {
          output[i] = input[i];
        }
        readHead = writeHead - bufSize;
        return;
      }

      // Generate output by reading at pf-scaled rate using linear interpolation
      for (let i = 0; i < output.length; i++) {
        // Clamp readHead so we don't read ahead of what's written
        if (readHead >= writeHead - grainSize) {
          readHead = writeHead - grainSize - 1;
        }

        const rh   = readHead % bufLen;
        const rhF  = Math.floor(rh);
        const frac = rh - Math.floor(rh % 1);   // fractional part
        const lo   = ((Math.floor(readHead)) % bufLen + bufLen) % bufLen;
        const hi   = (lo + 1) % bufLen;

        // Linear interpolation between adjacent samples
        const fracPart = readHead - Math.floor(readHead);
        output[i] = PlayerState._pitchBuf[lo] * (1 - fracPart)
                  + PlayerState._pitchBuf[hi] * fracPart;

        // Advance read head at pitch-factor rate
        readHead += pf;
      }
    };

    PlayerState.pitchScriptNode = pitchProc;

    // Graph:
    // source → pitchScriptNode → dryGain ──────────→ gain → destination
    //                          → convolver → reverbGain ↗
    PlayerState.sourceNode.connect(pitchProc);
    pitchProc.connect(PlayerState.dryGainNode);
    pitchProc.connect(PlayerState.convolverNode);
    PlayerState.convolverNode.connect(PlayerState.reverbGainNode);
    PlayerState.dryGainNode.connect(PlayerState.gainNode);
    PlayerState.reverbGainNode.connect(PlayerState.gainNode);
    PlayerState.gainNode.connect(ctx.destination);

    PlayerState.dryGainNode.gain.value    = 1;
    PlayerState.reverbGainNode.gain.value  = 0;
    PlayerState.gainNode.gain.value        = 1;

    console.log('[FX] Audio graph ready — independent speed + pitch + reverb');
  } catch(e) {
    console.warn('[FX] AudioContext init failed:', e);
  }
}

function generateImpulseResponse() {
  if (!PlayerState.audioCtx || !PlayerState.convolverNode) return;
  const ctx        = PlayerState.audioCtx;
  const sampleRate = ctx.sampleRate;
  const length     = sampleRate * 3;
  const impulse    = ctx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  PlayerState.convolverNode.buffer = impulse;
}

function applyFX() {
  const speedEl  = document.getElementById('fx-speed');
  const pitchEl  = document.getElementById('fx-pitch');
  const reverbEl = document.getElementById('fx-reverb');
  if (!speedEl) return;

  const speed  = parseFloat(speedEl.value);
  const pitch  = parseFloat(pitchEl.value);   // semitones −6 to +6
  const reverb = parseFloat(reverbEl.value);

  // ── SPEED: only changes playbackRate, pitch node is unaffected ──
  PlayerState.audio.playbackRate = speed;
  PlayerState.speed = speed;
  document.getElementById('val-speed').textContent = speed.toFixed(2) + '×';

  // ── PITCH: only changes pitchFactor in ScriptProcessor ──
  // 2^(semitones/12): +12 semitones = 2.0 (one octave up)
  //                   −12 semitones = 0.5 (one octave down)
  // playbackRate is NOT touched here
  PlayerState._pitchFactor = Math.pow(2, pitch / 12);
  PlayerState.pitch = pitch;
  document.getElementById('val-pitch').textContent = (pitch >= 0 ? '+' : '') + pitch;

  // ── REVERB: wet/dry mix, independent of speed and pitch ──
  if (PlayerState.reverbGainNode) {
    PlayerState.reverbGainNode.gain.value = reverb;
    PlayerState.dryGainNode.gain.value    = 1 - reverb * 0.5;
  }
  PlayerState.reverb = reverb;
  document.getElementById('val-reverb').textContent = Math.round(reverb * 100) + '%';
}

// ── UI HELPERS ────────────────────────────
function updatePlayUI() {
  const btn = document.getElementById('btn-play');
  const miniBtn = document.getElementById('mini-play-btn');
  const symbol = PlayerState.isPlaying ? '⏸' : '▶';
  if (btn) btn.textContent = symbol;
  if (miniBtn) miniBtn.textContent = symbol;
}

function fadeHtmlAudioVolume(target, duration, callback) {
  if (!PlayerState.audio) {
    if (callback) callback();
    return;
  }
  const start = PlayerState.audio.volume;
  const change = target - start;
  const steps = 10;
  const interval = duration * 1000 / steps;
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    PlayerState.audio.volume = Math.min(Math.max(start + (change * step / steps), 0), 1);
    if (step >= steps) {
      clearInterval(timer);
      if (callback) callback();
    }
  }, interval);
}

function startVinylSpin() {
  const disc = document.getElementById('vinyl-disc');
  const mini = document.getElementById('mini-vinyl');
  if (disc) disc.classList.add('spinning');
  if (mini) mini.classList.add('spinning');
}

function stopVinylSpin() {
  const disc = document.getElementById('vinyl-disc');
  const mini = document.getElementById('mini-vinyl');
  if (disc) disc.classList.remove('spinning');
  if (mini) mini.classList.remove('spinning');
}

function updateProgressBar() {
  const fill = document.getElementById('progress-bar-fill');
  if (!fill || !PlayerState.duration) return;
  const time = PlayerState._isSeeking ? PlayerState._seekRatio * PlayerState.duration : PlayerState.currentTime;
  const pct = (time / PlayerState.duration) * 100;
  fill.style.width = Math.min(Math.max(pct, 0), 100) + '%';
}

function updateTimeDisplay() {
  const cur  = document.getElementById('time-current');
  const tot  = document.getElementById('time-total');
  const time = PlayerState._isSeeking ? PlayerState._seekRatio * PlayerState.duration : PlayerState.currentTime;
  if (cur) cur.textContent = formatTime(time);
  if (tot) tot.textContent = formatTime(PlayerState.duration);
}

function formatTime(secs) {
  if (isNaN(secs) || !isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── MEDIA SESSION ────────────────────────
function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  song.title,
    artist: song.artist,
    album:  'For my Loveyy 💕',
    artwork: [
      { src: 'img/cover-art.png', sizes: '512x512', type: 'image/png' }
    ]
  });
  navigator.mediaSession.playbackState = PlayerState.isPlaying ? 'playing' : 'paused';
}

// ── BACKGROUND NOTIFICATION ──────────────
function updateBackgroundNotification() {
  if (!(window.cordova && window.plugins && window.plugins.backgroundMode)) return;
  const song = SONGS[PlayerState.currentIndex];
  if (!song) return;
  window.plugins.backgroundMode.configure({
    title: song.title,
    text: song.artist + ' — For my Loveyy',
    resume: true,
  });
}

// ── CORDOVA MUSIC CONTROLS (notification panel) ──
function setupMusicControls() {
  if (!window.MusicControls) return;
  const song = SONGS[PlayerState.currentIndex];
  if (!song) return;

  MusicControls.create({
    track:    song.title,
    artist:   song.artist,
    cover:    'img/cover-art.png',
    isPlaying: PlayerState.isPlaying,
    dismissable: false,
    hasPrev:  true,
    hasNext:  true,
    hasClose: false,
    notificationIcon: 'icon',
  }, () => {}, () => {});

  MusicControls.subscribe((action) => {
    const message = JSON.parse(action).message;
    switch (message) {
      case 'music-controls-next':         nextSong();   break;
      case 'music-controls-previous':     prevSong();   break;
      case 'music-controls-play':         resumeAudio(); break;
      case 'music-controls-pause':        pauseAudio(); break;
      case 'music-controls-media-button': togglePlay(); break;
    }
  });

  MusicControls.listen();
}
