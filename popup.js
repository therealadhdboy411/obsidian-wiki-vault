// ─── WhatsApp PTT — popup.js ──────────────────────────────────────────────────

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Dictate panel ─────────────────────────────────────────────────────────────
const apikeyInput = document.getElementById('apikey');
const toggleBtn   = document.getElementById('toggle-key');
const saveKeyBtn  = document.getElementById('save-key');
const testKeyBtn  = document.getElementById('test-key');
const fbKey       = document.getElementById('fb-key');
const sttQuality  = document.getElementById('stt-quality');
const phoneModeChk= document.getElementById('phone-mode');

// VAD Tuning Elements
const vadThresholdSlider = document.getElementById('vad-threshold');
const vadThresholdLabel  = document.getElementById('vad-thresh-label');
const vadSilenceSlider   = document.getElementById('vad-silence');
const vadSilenceLabel     = document.getElementById('vad-silence-label');

chrome.storage.local.get(
  ['mistral_api_key', 'stt_quality', 'phone_mode', 'vad_threshold', 'vad_silence_ms'], 
  ({ mistral_api_key, stt_quality, phone_mode, vad_threshold, vad_silence_ms }) => {
    if (mistral_api_key) apikeyInput.value = mistral_api_key;
    if (stt_quality) sttQuality.value = stt_quality;
    if (phone_mode) phoneModeChk.checked = true;
    
    if (vad_threshold != null) {
      vadThresholdSlider.value = vad_threshold;
      vadThresholdLabel.textContent = vad_threshold;
    }
    if (vad_silence_ms != null) {
      vadSilenceSlider.value = vad_silence_ms;
      vadSilenceLabel.textContent = vad_silence_ms + 'ms';
    }
  }
);

sttQuality.addEventListener('change', () => {
  chrome.storage.local.set({ stt_quality: sttQuality.value });
});

phoneModeChk.addEventListener('change', () => {
  chrome.storage.local.set({ phone_mode: phoneModeChk.checked });
});

// VAD Slider Listeners
vadThresholdSlider.addEventListener('input', () => {
  const val = vadThresholdSlider.value;
  vadThresholdLabel.textContent = val;
  chrome.storage.local.set({ vad_threshold: parseFloat(val) });
});

vadSilenceSlider.addEventListener('input', () => {
  const val = vadSilenceSlider.value;
  vadSilenceLabel.textContent = val + 'ms';
  chrome.storage.local.set({ vad_silence_ms: parseInt(val) });
});

saveKeyBtn.addEventListener('click', () => {
  const key = apikeyInput.value.trim();
  if (!key) { showFb(fbKey, 'Enter a key first.', 'error'); return; }
  chrome.storage.local.set({ mistral_api_key: key }, () => showFb(fbKey, 'Saved ✓'));
});

toggleBtn.addEventListener('click', () => {
  const hidden = apikeyInput.type === 'password';
  apikeyInput.type = hidden ? 'text' : 'password';
  toggleBtn.textContent = hidden ? 'Hide' : 'Show';
});

testKeyBtn.addEventListener('click', async () => {
  const key = apikeyInput.value.trim();
  if (!key) { showFb(fbKey, 'Enter a key first.', 'error'); return; }

  testKeyBtn.textContent = 'Testing…';
  testKeyBtn.disabled    = true;

  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.ok)            showFb(fbKey, 'API key works ✓');
    else if (res.status === 401) showFb(fbKey, 'Invalid key ✗', 'error');
    else                         showFb(fbKey, `Error ${res.status} ✗`, 'error');
  } catch {
    showFb(fbKey, 'Network error ✗', 'error');
  } finally {
    testKeyBtn.textContent = 'Test Key';
    testKeyBtn.disabled    = false;
  }
});

// ── Voice panel ───────────────────────────────────────────────────────────────
const autoReadChk  = document.getElementById('auto-read');
const volumeSlider = document.getElementById('volume');
const volLabel     = document.getElementById('vol-label');
const voiceIdInput = document.getElementById('voice-id');
const voiceListSel = document.getElementById('voice-list');
const fetchVoiceBtn= document.getElementById('fetch-voices');
const recRefBtn    = document.getElementById('rec-ref');
const uploadRefBtn = document.getElementById('upload-ref');
const fileRefInput = document.getElementById('file-ref');
const clearRefBtn  = document.getElementById('clear-ref');
const recStatus    = document.getElementById('rec-status');
const voiceConflictWarn = document.getElementById('voice-conflict-warn');
const saveVoiceBtn = document.getElementById('save-voice');
const testTtsBtn   = document.getElementById('test-tts');
const fbVoice      = document.getElementById('fb-voice');

// Load saved voice settings
chrome.storage.local.get(
  ['tts_voice_id', 'tts_ref_audio', 'tts_auto_read', 'tts_volume'],
  ({ tts_voice_id, tts_ref_audio, tts_auto_read, tts_volume }) => {
    if (tts_voice_id)   voiceIdInput.value  = tts_voice_id;
    if (tts_auto_read)  autoReadChk.checked  = true;
    if (tts_volume != null) {
      const pct = Math.round(parseFloat(tts_volume) * 100);
      volumeSlider.value = pct;
      volLabel.textContent = pct + '%';
    }
    if (tts_ref_audio) {
      recStatus.textContent = 'Reference clip saved ✓';
      recStatus.className   = 'feedback';
    }
    updateVoiceConflictWarning();
  }
);

volumeSlider.addEventListener('input', () => {
  volLabel.textContent = volumeSlider.value + '%';
});

// Watch for storage changes to update conflict warning
chrome.storage.onChanged.addListener((changes) => {
  if (changes.tts_voice_id || changes.tts_ref_audio) {
    updateVoiceConflictWarning();
  }
});

// ── Voice conflict detection ──────────────────────────────────────────────────
function updateVoiceConflictWarning() {
  chrome.storage.local.get(['tts_voice_id', 'tts_ref_audio'], ({ tts_voice_id, tts_ref_audio }) => {
    const hasVoiceId = tts_voice_id && tts_voice_id.trim();
    const hasRefAudio = !!tts_ref_audio;
    voiceConflictWarn.style.display = (hasVoiceId && hasRefAudio) ? 'block' : 'none';
  });
}

voiceIdInput.addEventListener('input', updateVoiceConflictWarning);

// ── Fetch voices from Mistral API ─────────────────────────────────────────────
fetchVoiceBtn.addEventListener('click', async () => {
  const key = await getKey();
  if (!key) { showFb(fbVoice, 'Save your API key first.', 'error'); return; }

  fetchVoiceBtn.textContent = '…';
  fetchVoiceBtn.disabled    = true;

  try {
    const res = await fetch('https://api.mistral.ai/v1/audio/voices', {
      headers: { Authorization: `Bearer ${key}` }
    });

    if (!res.ok) {
      showFb(fbVoice, `Could not list voices (${res.status}).`, 'warn');
      return;
    }

    const data  = await res.json();
    const items = data.items || data.voices || [];

    if (!items.length) {
      showFb(fbVoice,
        'No voices found. Create one at console.mistral.ai/voices.',
        'warn');
      return;
    }

    // Populate dropdown
    voiceListSel.innerHTML = '<option value="">— select a voice —</option>';
    items.forEach(v => {
      const opt   = document.createElement('option');
      opt.value   = v.id;
      opt.textContent = v.name ? `${v.name}  (${v.id.slice(0, 8)}…)` : v.id;
      voiceListSel.appendChild(opt);
    });

    voiceListSel.style.display = 'block';
    showFb(fbVoice, `${items.length} voice${items.length !== 1 ? 's' : ''} loaded ✓`);

  } catch {
    showFb(fbVoice, 'Network error fetching voices.', 'error');
  } finally {
    fetchVoiceBtn.textContent = 'List';
    fetchVoiceBtn.disabled    = false;
  }
});

// Populate voice ID field when user picks from dropdown
voiceListSel.addEventListener('change', () => {
  if (voiceListSel.value) {
    voiceIdInput.value = voiceListSel.value;
    updateVoiceConflictWarning();
  }
});

// ── Record reference clip ─────────────────────────────────────────────────────
let _recStream     = null;
let _recRecorder   = null;
let _recChunks     = [];
let _recCountdown  = null;
let _recActive     = false;

recRefBtn.addEventListener('click', async () => {
  if (_recActive) {
    stopRefRecording(true); // user cancelled
    return;
  }
  await startRefRecording();
});

// ── Upload reference clip ─────────────────────────────────────────────────────
uploadRefBtn.addEventListener('click', () => {
  fileRefInput.click();
});

fileRefInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('audio/')) {
    recStatus.textContent = '⚠ Please select an audio file';
    recStatus.className   = 'feedback error';
    return;
  }

  if (file.size > 5 * 1024 * 1024) { // 5 MB limit
    recStatus.textContent = '⚠ File too large (max 5 MB)';
    recStatus.className   = 'feedback error';
    return;
  }

  recStatus.textContent = 'Processing…';
  recStatus.className   = 'feedback';

  try {
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result.split(',')[1];
      chrome.storage.local.set({ tts_ref_audio: b64 }, () => {
        recStatus.textContent = 'Reference clip uploaded ✓';
        recStatus.className   = 'feedback';
        updateVoiceConflictWarning();
        setTimeout(() => { recStatus.textContent = ''; }, 2000);
      });
    };
    reader.readAsDataURL(file);
  } catch (err) {
    recStatus.textContent = '⚠ Upload failed';
    recStatus.className   = 'feedback error';
  }

  // Reset file input
  fileRefInput.value = '';
});

clearRefBtn.addEventListener('click', () => {
  chrome.storage.local.remove('tts_ref_audio');
  recStatus.textContent = 'Reference clip cleared.';
  recStatus.className   = 'feedback warn';
  updateVoiceConflictWarning();
  setTimeout(() => { recStatus.textContent = ''; }, 2000);
});

async function startRefRecording() {
  try {
    _recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recStatus.textContent = '⚠ Mic access denied';
    recStatus.className   = 'feedback error';
    return;
  }

  _recChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';

  _recRecorder = new MediaRecorder(_recStream, { mimeType: mime });
  _recRecorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
  _recRecorder.start(100);
  _recActive = true;

  recRefBtn.textContent = '■ Stop';
  recRefBtn.style.background = '#c0392b';
  recRefBtn.style.color      = '#fff';

  // 5-second countdown
  let secs = 5;
  recStatus.innerHTML = `<span class="rec-indicator"></span>Recording… ${secs}s`;
  recStatus.className = 'feedback';

  _recCountdown = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(_recCountdown);
      stopRefRecording(false);
    } else {
      recStatus.innerHTML = `<span class="rec-indicator"></span>Recording… ${secs}s`;
    }
  }, 1000);
}

function stopRefRecording(cancelled) {
  clearInterval(_recCountdown);
  if (!_recRecorder || !_recActive) return;
  _recActive = false;

  recRefBtn.textContent        = 'Record (5s)';
  recRefBtn.style.background   = '';
  recRefBtn.style.color        = '';

  _recRecorder.onstop = async () => {
    if (_recStream) { _recStream.getTracks().forEach(t => t.stop()); _recStream = null; }
    if (cancelled) { recStatus.textContent = 'Cancelled.'; recStatus.className = 'feedback warn'; return; }

    const blob = new Blob(_recChunks, { type: _recRecorder.mimeType || 'audio/webm' });
    
    // Convert blob to base64 for storage
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result.split(',')[1];
      chrome.storage.local.set({ tts_ref_audio: b64 }, () => {
        recStatus.textContent = 'Reference clip saved ✓';
        recStatus.className   = 'feedback';
        updateVoiceConflictWarning();
        setTimeout(() => { recStatus.textContent = ''; }, 2000);
      });
    };
    reader.readAsDataURL(blob);
  };

  _recRecorder.stop();
}

// ── Save Voice Settings ───────────────────────────────────────────────────────
saveVoiceBtn.addEventListener('click', () => {
  const voiceId = voiceIdInput.value.trim();
  const autoRead = autoReadChk.checked;
  const volume   = parseFloat(volumeSlider.value) / 100;

  chrome.storage.local.set({
    tts_voice_id:  voiceId,
    tts_auto_read: autoRead,
    tts_volume:    volume
  }, () => {
    showFb(fbVoice, 'Settings saved ✓');
  });
});

// ── Test TTS ──────────────────────────────────────────────────────────────────
testTtsBtn.addEventListener('click', async () => {
  const key = await getKey();
  if (!key) { showFb(fbVoice, 'Save your API key first.', 'error'); return; }

  const voiceId  = voiceIdInput.value.trim();
  const refAudio = await getRefAudio();

  if (!voiceId && !refAudio) {
    showFb(fbVoice, 'Set a voice ID or record a reference clip first.', 'warn');
    return;
  }

  testTtsBtn.textContent = 'Generating…';
  testTtsBtn.disabled    = true;

  const payload = voiceId ? { voice_id: voiceId } : { ref_audio: refAudio };

  try {
    const res = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'voxtral-mini-tts-2603',
        input: 'Hello! This is a test of your custom voice in WhatsApp.',
        ...payload
      })
    });

    if (!res.ok) {
      showFb(fbVoice, `TTS Error: ${res.status}`, 'error');
      return;
    }

    const data = await res.json();
    if (!data.audio_data) {
      showFb(fbVoice, 'TTS Error: empty response', 'error');
      return;
    }

    // Play it
    const bin = atob(data.audio_data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = parseFloat(volumeSlider.value) / 100;
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);

    showFb(fbVoice, 'Playing test audio…');

  } catch {
    showFb(fbVoice, 'Network error testing TTS.', 'error');
  } finally {
    testTtsBtn.textContent = 'Test TTS';
    testTtsBtn.disabled    = false;
  }
});

// ── Shortcuts ─────────────────────────────────────────────────────────────────
document.getElementById('shortcutsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('mistral_api_key', ({ mistral_api_key }) => {
      resolve(mistral_api_key || null);
    });
  });
}

function getRefAudio() {
  return new Promise(resolve => {
    chrome.storage.local.get('tts_ref_audio', ({ tts_ref_audio }) => {
      resolve(tts_ref_audio || null);
    });
  });
}

function showFb(el, text, type = 'success') {
  el.textContent = text;
  el.className   = 'feedback ' + (type !== 'success' ? type : '');
  setTimeout(() => {
    if (el.textContent === text) el.textContent = '';
  }, 4000);
}
