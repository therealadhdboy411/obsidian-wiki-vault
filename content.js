(function () {
  if (document.getElementById('__wa_ptt_root__')) return;

  // ── Voice Activity Detection (VAD) ────────────────────────────────────────
  let vadAudioCtx   = null;
  let vadAnalyser   = null;
  let vadDataArray  = null;
  let vadInterval   = null;
  let vadSilenceStart = 0;

  async function updateVadState() {
    if (_phoneMode) {
      if (vadInterval) return;
      
      const ok = await ensureMicStream();
      if (!ok) return;

      try {
        if (!vadAudioCtx) {
          vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source = vadAudioCtx.createMediaStreamSource(micStream);
          vadAnalyser = vadAudioCtx.createAnalyser();
          vadAnalyser.fftSize = 256;
          source.connect(vadAnalyser);
          vadDataArray = new Uint8Array(vadAnalyser.frequencyBinCount);
        }
        if (vadAudioCtx.state === 'suspended') {
          await vadAudioCtx.resume();
        }

        // Show listening state on mic button
        setListeningState();

        vadInterval = setInterval(() => {
          // Mute VAD while extension is reading TTS so we dont transcribe ourselves
          if (_currentAudio && !_currentAudio.paused) return; 
          
          vadAnalyser.getByteFrequencyData(vadDataArray);
          let sum = 0;
          for (let i = 0; i < vadDataArray.length; i++) {
            sum += vadDataArray[i];
          }
          const avg = sum / vadDataArray.length;

          // Use configurable threshold
          const threshold = _vadThreshold;
          
          if (avg > threshold) {
            // Speech detected
            vadSilenceStart = 0;
            // Dont start recording if we're actively transcribing/sending the last bit
            const btnClass = document.getElementById('__wa_ptt_btn__')?.classList;
            const busy = btnClass?.contains('transcribing') || btnClass?.contains('countdown');
            if (!isRecording && !busy) {
              startRecording().catch(console.error);
            }
          } else {
            // Silence detected
            if (isRecording) {
              if (vadSilenceStart === 0) {
                vadSilenceStart = Date.now();
              } else if (Date.now() - vadSilenceStart > _vadSilenceMs) {
                // Silence for long enough — send
                vadSilenceStart = 0;
                finishAndSend().catch(console.error);
              }
            }
          }
        }, 100);

      } catch (err) {
        console.error('VAD init error', err);
      }
    } else {
      if (vadInterval) {
        clearInterval(vadInterval);
        vadInterval = null;
      }
      if (vadAudioCtx) {
        vadAudioCtx.close().catch(() => {});
        vadAudioCtx = null;
        vadAnalyser = null;
        vadDataArray = null; // Fix: Clear typed array reference
      }
      if (!isRecording && micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
      }
      // Return mic button to idle if we just turned off phone mode
      if (!isRecording) resetMicBtn();
    }
  }

  function setListeningState() {
    if (_phoneMode && !isRecording) {
      const btn = document.getElementById('__wa_ptt_btn__');
      if (btn && !btn.classList.contains('transcribing') && !btn.classList.contains('recording')) {
        btn.className = 'wa-ptt-btn listening';
        btn.innerHTML = micSVG();
      }
      setStatus('👂 Listening…');
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let mediaRecorder  = null;
  let audioChunks    = [];
  let micStream      = null;      // kept alive — avoid re-requesting getUserMedia
  let isRecording    = false;

  // Settings — loaded once, watched for changes
  let _cachedKey     = null;      // Mistral API key
  let _cachedVoiceId = '';        // saved Mistral voice ID (optional)
  let _cachedRefAudio = null;     // base64 reference audio clip (optional fallback)
  let _autoRead      = false;     // auto-read incoming messages
  let _sttQuality    = 'fast';    // STT quality: 'fast' or 'accurate'
  let _phoneMode     = false;     // VAD hands-free dictation
  let _vadThreshold  = 8;         // amplitude threshold 0–255 for speech detection
  let _vadSilenceMs  = 1500;      // ms of silence after speech before sending
  let _volume        = 1.0;       // TTS playback volume 0–1

  // TTS runtime
  let _currentAudio  = null;      // active HTMLAudioElement
  let _currentAudioUrl = null;    // Fix: Keep track of current object URL for cleanup
  let _isTtsLoading  = false;
  const _ttsCache    = new Map(); // cacheKey → base64 mp3, LRU
  const TTS_CACHE_MAX = 10;

  // Auto-read dedup
  let _lastAutoReadId = null;
  let _autoReadReady  = false;   // suppressed until initial messages finish loading

  // ── Settings loader ───────────────────────────────────────────────────────
  function loadSettings() {
    try {
      chrome.storage.local.get(
        ['mistral_api_key', 'tts_voice_id', 'tts_ref_audio', 'tts_auto_read', 'tts_volume', 'stt_quality', 'phone_mode', 'vad_threshold', 'vad_silence_ms'],
        (items) => {
          _cachedKey      = items.mistral_api_key || null;
          _cachedVoiceId  = items.tts_voice_id  || '';
          _cachedRefAudio = items.tts_ref_audio || null;
          _autoRead       = !!items.tts_auto_read;
          _sttQuality     = items.stt_quality || 'fast';
          _phoneMode      = !!items.phone_mode;
          _vadThreshold   = items.vad_threshold  != null ? parseFloat(items.vad_threshold)  : 8;
          _vadSilenceMs   = items.vad_silence_ms != null ? parseInt(items.vad_silence_ms)   : 1500;
          _volume         = items.tts_volume != null ? parseFloat(items.tts_volume) : 1.0;
          // Reflect auto-read state on speaker button if root already mounted
          if (document.getElementById('__wa_spk_btn__')) refreshSpkBtnBase();
          updateVadState();
        }
      );
      chrome.storage.onChanged.addListener((changes) => {
        if ('mistral_api_key' in changes) _cachedKey      = changes.mistral_api_key.newValue   || null;
        if ('tts_voice_id'    in changes) _cachedVoiceId  = changes.tts_voice_id.newValue      || '';
        if ('tts_ref_audio'   in changes) _cachedRefAudio = changes.tts_ref_audio.newValue     || null;
        if ('tts_auto_read'   in changes) { _autoRead = !!changes.tts_auto_read.newValue; refreshSpkBtnBase(); }
        if ('stt_quality'     in changes) _sttQuality     = changes.stt_quality.newValue       || 'fast';
        if ('phone_mode'      in changes) { _phoneMode    = !!changes.phone_mode.newValue; updateVadState(); }
        if ('vad_threshold'   in changes) _vadThreshold   = parseFloat(changes.vad_threshold.newValue)  || 8;
        if ('vad_silence_ms'  in changes) _vadSilenceMs   = parseInt(changes.vad_silence_ms.newValue)   || 1500;
        if ('tts_volume'      in changes) _volume         = parseFloat(changes.tts_volume.newValue)   || 1.0;
        // Clear TTS audio cache when voice source changes so new voice takes effect
        if ('tts_voice_id' in changes || 'tts_ref_audio' in changes) _ttsCache.clear();
      });
    } catch { /* extension context gone */ }
  }
  loadSettings();

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* ── Root container ── inline bar above the footer ── */
    #__wa_ptt_root__ {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 4px 12px;
      background: #111b21;
      border-top: 1px solid #1f2c33;
      font-family: -apple-system, 'Segoe UI', sans-serif;
      user-select: none;
      min-height: 36px;
    }
    #__wa_ptt_status__ {
      font-size: 11px;
      color: #8696a0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      line-height: 14px;
    }

    /* ── Shared button base ── */
    .wa-ptt-btn {
      pointer-events: all;
      border-radius: 50%;
      background: #1f2c33;
      border: 1.5px solid #2a3942;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s, color 0.15s;
      flex-shrink: 0;
    }
    .wa-ptt-btn:hover  { background: #2a3942; transform: scale(1.06); }
    .wa-ptt-btn:active { transform: scale(0.94); }

    /* ── Mic button ── */
    #__wa_ptt_btn__ {
      width: 30px; height: 30px;
      color: #00a884;
    }
    #__wa_ptt_btn__ svg { width: 14px; height: 14px; }

    #__wa_ptt_btn__.recording {
      background: #c0392b;
      border-color: #e74c3c;
      color: #fff;
      animation: __ptt_mic_pulse__ 1.2s ease-in-out infinite;
    }
    #__wa_ptt_btn__.transcribing {
      background: #1a3a4a;
      border-color: #2980b9;
      color: #5dade2;
      cursor: default;
      pointer-events: none;
    }
    #__wa_ptt_btn__.listening {
      border-color: #005c4b;
      color: #00a884;
      animation: __ptt_ear_pulse__ 2.5s ease-in-out infinite;
    }
    @keyframes __ptt_ear_pulse__ {
      0%,100% { box-shadow: 0 0 0 0   rgba(0,168,132,0.35); }
      50%      { box-shadow: 0 0 0 6px rgba(0,168,132,0);   }
    }

    /* ── Speaker button ── */
    #__wa_spk_btn__ {
      width: 30px; height: 30px;
      color: #8696a0;
    }
    #__wa_spk_btn__ svg { width: 14px; height: 14px; }

    #__wa_spk_btn__.auto-on {
      border-color: #005c4b;
      color: #00a884;
    }
    #__wa_spk_btn__.loading {
      background: #1a3a4a;
      border-color: #2980b9;
      color: #5dade2;
      cursor: default;
      pointer-events: none;
    }
    #__wa_spk_btn__.playing {
      background: #0a2a24;
      border-color: #00a884;
      color: #00a884;
      animation: __ptt_spk_pulse__ 1.8s ease-in-out infinite;
    }
    #__wa_spk_btn__.playing.auto-on {
      border-color: #00cf9f;
    }

    /* ── Keyframes ── */
    @keyframes __ptt_mic_pulse__ {
      0%,100% { box-shadow: 0 0 0 0   rgba(231,76,60,0.55); }
      50%      { box-shadow: 0 0 0 6px rgba(231,76,60,0);   }
    }
    @keyframes __ptt_spk_pulse__ {
      0%,100% { box-shadow: 0 0 0 0   rgba(0,168,132,0.45); }
      50%      { box-shadow: 0 0 0 6px rgba(0,168,132,0);   }
    }
    @keyframes __ptt_spin__ { to { transform: rotate(360deg); } }

    /* ── Per-message buttons ── */
    .wa-msg-spk {
      position: absolute;
      right: -34px;
      top: 50%;
      transform: translateY(-50%);
      width: 26px; height: 26px;
      border-radius: 50%;
      background: #1f2c33;
      border: 1px solid #2a3942;
      color: #8696a0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s, transform 0.1s, background 0.15s;
      z-index: 10;
    }
    [data-wa-spk-host]:hover .wa-msg-spk { opacity: 0.8; }
    .wa-msg-spk:hover { opacity: 1 !important; color: #00a884; transform: translateY(-50%) scale(1.1); }
    .wa-msg-spk.playing {
      opacity: 1 !important;
      color: #00a884;
      background: #0a2a24;
      border-color: #00a884;
      animation: __ptt_spk_pulse__ 1.8s ease-in-out infinite;
    }
    .wa-msg-spk svg { width: 12px; height: 12px; }

    /* ── Utils ── */
    .wa-ptt-spinner { animation: __ptt_spin__ 0.8s linear infinite; }
  `;
  document.head.appendChild(style);

  // ── SVGs ──────────────────────────────────────────────────────────────────
  const micSVG = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  const stopSVG = () => `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  const speakerSVG = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  const speakerSmallSVG = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  const spinnerSVG = () => `<svg class="wa-ptt-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

  // ── UI Components ─────────────────────────────────────────────────────────
  const root   = document.createElement('div');
  root.id      = '__wa_ptt_root__';

  const status = document.createElement('div');
  status.id    = '__wa_ptt_status__';
  root.appendChild(status);

  const spkBtn = document.createElement('div');
  spkBtn.id    = '__wa_spk_btn__';
  spkBtn.className = 'wa-ptt-btn';
  spkBtn.title = 'Stop playback / Right-click to toggle Auto-read';
  spkBtn.innerHTML = speakerSVG();
  root.appendChild(spkBtn);

  const micBtn = document.createElement('div');
  micBtn.id    = '__wa_ptt_btn__';
  micBtn.className = 'wa-ptt-btn';
  micBtn.title = 'Hold to record / Click to cancel';
  micBtn.innerHTML = micSVG();
  root.appendChild(micBtn);

  // ── UI Logic ──────────────────────────────────────────────────────────────
  let statusTimeout = null;
  function setStatus(text, duration = 0) {
    if (statusTimeout) clearTimeout(statusTimeout);
    status.textContent = text;
    if (duration > 0) {
      statusTimeout = setTimeout(() => { status.textContent = ''; }, duration);
    }
  }

  // ── Event Handlers ────────────────────────────────────────────────────────
  // Manual recording: Hold to record
  micBtn.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (_phoneMode) return; // phone mode is automatic
    startRecording().catch(console.error);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (isRecording && !_phoneMode) {
      finishAndSend().catch(console.error);
    }
  });

  // Cancel/Stop
  micBtn.addEventListener('click', (e) => {
    if (_sendCountdown) {
      _sendCountdown(true); // cancel pending send
    } else if (isRecording || _transcriptionAbort) {
      cancelAllTranscriptions();
    }
  });

  // Speaker button: Stop audio / Toggle auto-read
  spkBtn.addEventListener('click', () => {
    if (_currentAudio || _isTtsLoading) {
      stopAudio();
      _isTtsLoading = false;
      resetSpkBtn();
    } else {
      // If nothing playing, toggle auto-read as a shortcut
      _autoRead = !_autoRead;
      chrome.storage.local.set({ tts_auto_read: _autoRead });
      setStatus(_autoRead ? 'Auto-read: ON' : 'Auto-read: OFF', 2000);
    }
  });

  spkBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _autoRead = !_autoRead;
    chrome.storage.local.set({ tts_auto_read: _autoRead });
    setStatus(_autoRead ? 'Auto-read: ON' : 'Auto-read: OFF', 2000);
  });

  // ── WhatsApp Integration ──────────────────────────────────────────────────
  function getInputElement() {
    return document.querySelector('[data-testid="conversation-compose-box-input"]') || 
           document.querySelector('div[contenteditable="true"]');
  }

  function getSendButton() {
    return document.querySelector('[data-testid="compose-btn-send"]') || 
           document.querySelector('button span[data-testid="send"]')?.parentElement;
  }

  function getIncomingMsgEls() {
    // Optimization: Use a more specific selector to avoid scanning the entire DOM
    const container = document.querySelector('div#main');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.message-in, [class*="message-in"]'));
  }

  function extractMsgText(msgEl) {
    // Find the text container. WhatsApp often uses .selectable-text
    const textNode = msgEl.querySelector('.selectable-text span');
    if (textNode) return textNode.textContent;
    
    // Fallback: look for any span with text that isn't a timestamp
    const spans = msgEl.querySelectorAll('span[dir="ltr"]');
    for (const s of spans) {
      if (s.textContent.length > 1 && !/^\d{1,2}:\d{2}/.test(s.textContent)) {
        return s.textContent;
      }
    }
    return null;
  }

  function injectAndSend(text) {
    const input = getInputElement();
    if (!input) { setStatus('⚠ Could not find WhatsApp input'); return; }

    input.focus();
    // Use execCommand for reliable insertion in WhatsApp's Draft.js/React input
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    
    // Trigger React/Draft.js change events
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Auto-send after a brief confirmation delay
    startSendCountdown(text);
  }

  let _sendCountdown = null;
  function cancelPendingSend(shouldClear = false) {
    if (_sendCountdown) {
      _sendCountdown(shouldClear);
      _sendCountdown = null;
    }
  }

  function startSendCountdown(text) {
    cancelPendingSend();
    const input = getInputElement();
    let timeLeft = 3;
    let cancelled = false;

    // Convert mic button to a Cancel button temporarily
    micBtn.className = 'wa-ptt-btn countdown';
    micBtn.innerHTML = stopSVG();
    micBtn.style.color = '#e74c3c';

    const cancelFn = (shouldClear = false) => {
      cancelled = true;
      cleanup();
      setStatus('Auto-send cancelled', 3000);
      if (shouldClear && input) {
        input.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, '');
      }
    };

    const micClickInterceptor = (e) => {
      e.preventDefault(); e.stopPropagation();
      cancelFn(true);
    };
    micBtn.addEventListener('click', micClickInterceptor);

    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        cancelled = true;
        cleanup();
        setStatus('');
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        cancelFn(true);
      } else {
        // Any other keypress (Esc, typng) cancels without clearing text
        cancelFn(false);
      }
    };
    input.addEventListener('keydown', keyHandler);

    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      micBtn.removeEventListener('click', micClickInterceptor);
      input.removeEventListener('keydown', keyHandler);
      micBtn.style.color = '';
      resetMicBtn();
      _sendCountdown = null;
    };
    
    _sendCountdown = cancelFn;

    const tick = () => {
      if (cancelled) return;
      if (timeLeft > 0) {
        setStatus(`Sending in ${timeLeft}s (Type to edit)`, 1000);
        timeLeft--;
        timer = setTimeout(tick, 1000);
      } else {
        cleanup();
        setStatus('Sent', 2000);
        const sendBtn = getSendButton();
        if (sendBtn) {
          sendBtn.click();
        } else {
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
        }
      }
    };

    tick();
    return true;
  }

  // ── Recording (STT / Voxtral) ─────────────────────────────────────────────
  //
  // micStream is kept alive between recordings to avoid repeated getUserMedia
  // prompts and to allow background-triggered recordings without a user gesture.

  async function ensureMicStream() {
    if (micStream && micStream.active) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 }
      });
      return true;
    } catch (err) {
      setStatus(err.name === 'NotAllowedError'
        ? '⚠ Mic denied — allow mic for this site'
        : '⚠ Mic unavailable');
      return false;
    }
  }

  async function startRecording() {
    if (isRecording) return;
    if (!_cachedKey) { setStatus('⚠ Set API key (click extension icon)'); return; }

    _transcriptionToken++;
    if (_transcriptionAbort) {
      _transcriptionAbort.abort();
      _transcriptionAbort = null;
    }
    cancelPendingSend(true);

    const ok = await ensureMicStream();
    if (!ok) return;

    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(micStream, { mimeType, audioBitsPerSecond: 256000 });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(100);
    isRecording = true;

    micBtn.className = 'wa-ptt-btn recording';
    setStatus('');
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return Promise.resolve(null);
    isRecording = false;

    return new Promise(resolve => {
      mediaRecorder.onstop = () => {
        const mimeUsed = mediaRecorder.mimeType || 'audio/webm';
        resolve(new Blob(audioChunks, { type: mimeUsed }));
        // Release mic stream after each manual recording, unless Phone Mode keeps it alive
      if (!_phoneMode && micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      };
      // Fix: Handle race condition where recorder might be inactive
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      } else {
        // If already inactive, onstop might not fire, so resolve immediately
        const mimeUsed = mediaRecorder.mimeType || 'audio/webm';
        resolve(new Blob(audioChunks, { type: mimeUsed }));
      }
    });
  }

  let _transcriptionAbort = null;

  async function transcribe(blob) {
    if (!_cachedKey) { setStatus('⚠ Set API key'); return null; }

    if (_transcriptionAbort) _transcriptionAbort.abort();
    _transcriptionAbort = new AbortController();
    const signal = _transcriptionAbort.signal;

    try {
      if (_sttQuality === 'accurate') {
        setStatus('Transcribing (accurate mode)…');
        // Convert blob to base64
        const base64Audio = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });

        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          signal,
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${_cachedKey}` 
          },
          body: JSON.stringify({
            model: 'mistral-medium-latest',
            messages: [{
              role: 'user',
              content: [
                { type: 'input_audio', input_audio: base64Audio },
                { type: 'text', text: 'Listen to this audio and transcribe it exactly as spoken in English. Do not translate from other languages. If you hear silence, Russian, Japanese, Chinese, or gibberish, ignore it and return nothing. Provide ONLY the final transcription without conversational filler or quotes.' }
              ]
            }]
          })
        });

        if (!res.ok) {
          setStatus(`⚠ STT ${res.status}`);
          return null;
        }

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content?.trim() || null;
        // Fix: Remove quotes if the model added them
        if (text && text.startsWith('"') && text.endsWith('"')) {
          text = text.slice(1, -1).trim();
        }
        return text;

      } else {
        // Fast mode (default)
        const ext = (blob.type || 'audio/webm').split('/')[1]?.split(';')[0] || 'webm';
        const form = new FormData();
        form.append('model', 'voxtral-mini-latest');
        form.append('file', blob, `audio.${ext}`);
        form.append('language', 'en');
        form.append('prompt', 'Please transcribe exactly. Ignore silence, noise, Japanese, Russian, or Chinese. Provide only English speech.');

        const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${_cachedKey}` },
          body: form,
        });

        if (!res.ok) {
          setStatus(`⚠ STT ${res.status}`);
          return null;
        }

        const data = await res.json();
        return data.text?.trim() || null;
      }
    } catch (e) {
      if (e.name === 'AbortError') return null;
      setStatus('⚠ Network error');
      return null;
    }
  }

  // ── Security: URL stripper + cache key hash ─────────────────────────────
  /** Strip URLs from text before sending to external API */
  function stripUrls(text) {
    return text.replace(/https?:\/\/\S+/gi, '[link]');
  }

  /** Simple FNV-1a hash for cache keys — avoids storing raw message text */
  function hashKey(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // ── Slang normaliser ──────────────────────────────────────────────────────
  const _SLANG_MAP = [
    [/\blmfao+\b/gi,                     'laughing my fucking ass off'],
    [/\blma+o+\b/gi,                     'laughing my ass off'],
    [/\blo+l+\b/gi,                      'laughing out loud'],
    [/\bro+fl+\b/gi,                     'rolling on the floor laughing'],
    [/\bhaha+\b/gi,                      'haha'],
    [/\bhehe+\b/gi,                      'hehe'],
    [/\bomfg\b/gi,                       'oh my fucking god'],
    [/\bomg+\b/gi,                       'oh my god'],
    [/\bwtf\b/gi,                        'what the fuck'],
    [/\bwth\b/gi,                        'what the hell'],
    [/\bngl\b/gi,                        'not gonna lie'],
    [/\btbh\b/gi,                        'to be honest'],
    [/\bsmh\b/gi,                        'shaking my head'],
    [/\bfml\b/gi,                        'fuck my life'],
    [/\bidfk\b/gi,                       "I don't fucking know"],
    [/\bidk\b/gi,                        "I don't know"],
    [/\bidc\b/gi,                        "I don't care"],
    [/\bimho\b/gi,                       'in my honest opinion'],
    [/\bimo\b/gi,                        'in my opinion'],
    [/\bfyi\b/gi,                        'for your information'],
    [/\bnbd\b/gi,                        'no big deal'],
    [/\biykyk\b/gi,                      'if you know you know'],
    [/\bfomo\b/gi,                       'fear of missing out'],
    [/\bgoat\b/gi,                       'greatest of all time'],
    [/\bfr\s*fr\b/gi,                    'for real for real'],
    [/\bfr\b/gi,                         'for real'],
    [/\bnvm\b/gi,                        'never mind'],
    [/\bfs\b/gi,                         'for sure'],
    [/\bobv\b/gi,                        'obviously'],
    [/\babs\b/gi,                        'absolutely'],
    [/\byass+\b/gi,                      'yes'],
    [/\byas+\b/gi,                       'yes'],
    [/\bbtw\b/gi,                        'by the way'],
    [/\bbrb\b/gi,                        'be right back'],
    [/\bttyl\b/gi,                       'talk to you later'],
    [/\bttys\b/gi,                       'talk to you soon'],
    [/\bigtg\b/gi,                       'I got to go'],
    [/\bgtg\b/gi,                        'got to go'],
    [/\bg2g\b/gi,                        'got to go'],
    [/\brn\b/gi,                         'right now'],
    [/\birl\b/gi,                        'in real life'],
    [/\bhmu\b/gi,                        'hit me up'],
    [/\basap\b/gi,                       'as soon as possible'],
    [/\bnsfw\b/gi,                       'not safe for work'],
    [/\bsmth\b/gi,                       'something'],
    [/\baf\b/gi,                         'as fuck'],
    [/\bgg\b/gi,                         'good game'],
    [/\bwyd\b/gi,                        'what are you doing'],
    [/\bwdym\b/gi,                       'what do you mean'],
    [/\bwbu\b/gi,                        'what about you'],
    [/\bhbu\b/gi,                        'how about you'],
    [/\bwym\b/gi,                        'what you mean'],
    [/\bwya\b/gi,                        'where you at'],
    [/\bthx\b/gi,                        'thanks'],
    [/\bthnx\b/gi,                       'thanks'],
    [/\bty\b/gi,                         'thank you'],
    [/\byw\b/gi,                         "you're welcome"],
    [/\bnp\b/gi,                         'no problem'],
    [/\byk\b/gi,                         'you know'],
    [/\bbc\b/gi,                         'because'],
    [/\bcuz\b/gi,                        'because'],
    [/\bcause\b/gi,                      'because'],
    [/\btho\b/gi,                        'though'],
    [/\btbf\b/gi,                        'to be fair'],
    [/\bpov\b/gi,                        'point of view'],
    [/\bslay+\b/gi,                      'slay'],
    [/\bno\s*cap\b/gi,                   'no cap'],
    [/\bperiod+t*\b/gi,                  'period'],
    [/\bbussing\b/gi,                    'really good'],
    [/\bsus\b/gi,                        'suspicious'],
    [/\blit\b/gi,                        'lit'],
    [/\bflex\b/gi,                       'flex'],
    [/\bvibe\b/gi,                       'vibe'],
  ];

  function normalizeSlang(text) {
    if (!text) return text;
    let t = text.replace(/(.)\1{2,}/g, '$1$1');
    for (const [pattern, replacement] of _SLANG_MAP) {
      t = t.replace(pattern, replacement);
    }
    return t;
  }

  // ── Emoji → spoken text ────────────────────────────────────────────────────
  const EMOJI_MAP = {
    '😀':'grinning face','😃':'smiley face','😄':'happy face','😁':'beaming face',
    '😆':'laughing face','😅':'sweat smile','🤣':'rolling on the floor laughing',
    '😂':'tears of joy','🙂':'slightly smiling','🙃':'upside down face',
    '😉':'winking face','😊':'blushing smiley','😇':'angel face','🥰':'smiling with hearts',
    '😍':'heart eyes','🤩':'star struck','😘':'blowing a kiss','😗':'kissing face',
    '😚':'kissing face with closed eyes','😙':'kissing face with smiling eyes',
    '🥲':'smiling with tear','😋':'yummy face','😛':'tongue out','😜':'winking tongue',
    '🤪':'zany face','😝':'squinting tongue','🤑':'money mouth','🤗':'hugging face',
    '🤭':'hand over mouth','🤫':'shushing face','🤔':'thinking face','🤐':'zipper mouth',
    '🤨':'raised eyebrow','😐':'neutral face','😑':'expressionless','😶':'no mouth',
    '😏':'smirking face','😒':'unamused face','🙄':'eye roll','😬':'grimacing face',
    '🤥':'lying face','😌':'relieved face','😔':'pensive face','😪':'sleepy face',
    '🤤':'drooling face','😴':'sleeping face','😷':'mask face','🤒':'sick face',
    '🤕':'injured face','🤢':'nauseated face','🤮':'vomiting face','🥵':'hot face',
    '🥶':'cold face','🥴':'woozy face','😵':'dizzy face','🤯':'exploding head',
    '🤠':'cowboy face','🥳':'party face','🥸':'disguised face','😎':'sunglasses face',
    '🤓':'nerd face','🧐':'monocle face','😕':'confused face','😟':'worried face',
    '🙁':'slightly frowning','😮':'open mouth','😯':'hushed face','😲':'astonished face',
    '😳':'flushed face','🥺':'pleading face','😦':'frowning open mouth',
    '😧':'anguished face','😨':'fearful face','😰':'anxious face','😥':'sad but relieved',
    '😢':'crying face','😭':'sobbing','😱':'screaming face','😖':'confounded face',
    '😣':'persevering face','😞':'disappointed face','😓':'downcast with sweat',
    '😩':'weary face','😫':'tired face','🥱':'yawning face','😤':'huffing face',
    '😡':'angry face','😠':'pouting face','🤬':'swearing face','💀':'skull',
    '☠️':'skull and crossbones','💩':'poop','🤡':'clown face','👹':'ogre','👺':'goblin',
    '👻':'ghost','👽':'alien','👾':'alien monster','🤖':'robot','💋':'kiss mark',
    '❤️':'red heart','🧡':'orange heart','💛':'yellow heart','💚':'green heart',
    '💙':'blue heart','💜':'purple heart','🖤':'black heart','🤍':'white heart',
    '🤎':'brown heart','💔':'broken heart','❤️‍🔥':'heart on fire','💯':'hundred points',
    '💢':'anger symbol','💥':'collision','💫':'dizzy','💦':'sweat droplets',
    '💨':'dashing away','🕳️':'hole','💤':'zzz','👋':'waving hand','🤚':'raised back of hand',
    '✋':'raised hand','🖖':'vulcan salute','👌':'OK hand','🤌':'pinched fingers',
    '🤏':'pinching hand','✌️':'victory hand','🤞':'crossed fingers','🤟':'love you gesture',
    '🤘':'sign of the horns','🤙':'call me hand','👈':'pointing left','👉':'pointing right',
    '👆':'pointing up','👇':'pointing down','☝️':'index pointing up','👍':'thumbs up',
    '👎':'thumbs down','✊':'raised fist','👊':'fist bump','🤛':'left fist bump',
    '🤜':'right fist bump','👏':'clapping hands','🙌':'raising hands','👐':'open hands',
    '🤲':'palms up together','🤝':'handshake','🙏':'folded hands',
    '🔥':'fire','⭐':'star','🌟':'glowing star','✨':'sparkles','💪':'flexed biceps',
    '🎉':'party popper','🎊':'confetti ball','🎁':'wrapped gift','🏆':'trophy',
    '🎯':'bullseye','✅':'check mark','❌':'cross mark','⚠️':'warning',
    '💡':'light bulb','💰':'money bag','📱':'mobile phone','💻':'laptop',
    '🌍':'globe','🌈':'rainbow','☀️':'sun','🌙':'crescent moon','⛅':'sun behind cloud',
    '🍕':'pizza','🍔':'hamburger','🍟':'french fries',' taco':'taco','🍩':'donut',
    '🍦':'ice cream','☕':'coffee','🍺':'beer','🍷':'wine glass',
    '🐶':'dog face','🐱':'cat face','🐻':'bear','🦁':'lion','🐸':'frog',
    '🐵':'monkey face','🐔':'chicken','🦄':'unicorn','🐝':'bee','🦋':'butterfly',
  };

  const _emojiPattern = new RegExp(
    Object.keys(EMOJI_MAP)
      .sort((a, b) => b.length - a.length)
      .map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g'
  );

  function emojiToText(text) {
    return text.replace(_emojiPattern, (match) => ` ${EMOJI_MAP[match]} `);
  }

  // ── TTS / Voxtral ─────────────────────────────────────────────────────────
  function ttsVoicePayload() {
    if (_cachedVoiceId)  return { voice_id:  _cachedVoiceId  };
    if (_cachedRefAudio) return { ref_audio: _cachedRefAudio };
    return null;
  }

  function cacheEvict() {
    if (_ttsCache.size >= TTS_CACHE_MAX) {
      const firstKey = _ttsCache.keys().next().value;
      _ttsCache.delete(firstKey);
    }
  }

  async function speakText(text, msgBtn = null) {
    if (!text?.trim()) { setStatus('⚠ No text to read'); return; }
    if (!_cachedKey)   { setStatus('⚠ Set API key (click extension icon)'); return; }

    const voicePayload = ttsVoicePayload();
    if (!voicePayload) {
      setStatus('⚠ Set a voice in extension settings');
      return;
    }

    stopAudio();

    const cacheKey = hashKey(text.slice(0, 300));

    if (_ttsCache.has(cacheKey)) {
      playAudio(_ttsCache.get(cacheKey), msgBtn);
      return;
    }

    _isTtsLoading = true;
    setSpkBtnLoading();
    if (msgBtn) { msgBtn.innerHTML = spinnerSVG(); msgBtn.style.opacity = '1'; }
    setStatus('Loading voice…');

    const spokenText = stripUrls(emojiToText(normalizeSlang(text)));
    const body = {
      model:           'voxtral-mini-tts-2603',
      input:           spokenText.slice(0, 500),
      ...voicePayload,
    };

    try {
      const res = await fetch('https://api.mistral.ai/v1/audio/speech', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${_cachedKey}`,
        },
        body: JSON.stringify(body),
      });

      _isTtsLoading = false;

      if (!res.ok) {
        setStatus(`⚠ TTS ${res.status}`);
        resetSpkBtn();
        if (msgBtn) resetMsgBtn(msgBtn);
        return;
      }

      const data = await res.json();
      const b64  = data.audio_data;

      if (!b64) {
        setStatus('⚠ TTS: empty response');
        resetSpkBtn();
        if (msgBtn) resetMsgBtn(msgBtn);
        return;
      }

      cacheEvict();
      _ttsCache.set(cacheKey, b64);
      playAudio(b64, msgBtn);

    } catch (e) {
      _isTtsLoading = false;
      setStatus('⚠ TTS network error');
      resetSpkBtn();
      if (msgBtn) resetMsgBtn(msgBtn);
    }
  }

  function playAudio(base64mp3, msgBtn = null) {
    const bin   = atob(base64mp3);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url  = URL.createObjectURL(blob);
    _currentAudioUrl = url;

    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, _volume));
    _currentAudio = audio;

    setSpkBtnPlaying();
    if (msgBtn) { msgBtn.innerHTML = stopSVG(); msgBtn.classList.add('playing'); }
    setStatus('');

    const cleanup = () => {
      if (_currentAudioUrl) {
        URL.revokeObjectURL(_currentAudioUrl);
        _currentAudioUrl = null;
      }
      _currentAudio = null;
      resetSpkBtn();
      if (msgBtn) resetMsgBtn(msgBtn);
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;

    audio.play().catch(() => {
      cleanup();
    });
  }

  function stopAudio() {
    if (_currentAudio) {
      _currentAudio.pause();
      // Fix: Ensure cleanup is called when pausing
      if (_currentAudioUrl) {
        URL.revokeObjectURL(_currentAudioUrl);
        _currentAudioUrl = null;
      }
      _currentAudio = null;
      resetSpkBtn();
      document.querySelectorAll('.wa-msg-spk.playing').forEach(b => resetMsgBtn(b));
    }
  }

  // ── Speaker button state helpers ──────────────────────────────────────────
  function autoClass() { return _autoRead ? ' auto-on' : ''; }

  function refreshSpkBtnBase() {
    if (_currentAudio) return;
    if (_isTtsLoading) return;
    spkBtn.className = 'wa-ptt-btn' + autoClass();
    spkBtn.innerHTML = speakerSVG();
  }

  function setSpkBtnLoading() {
    spkBtn.className = 'wa-ptt-btn loading';
    spkBtn.innerHTML = spinnerSVG();
  }

  function setSpkBtnPlaying() {
    spkBtn.className = 'wa-ptt-btn playing' + autoClass();
    spkBtn.innerHTML = stopSVG();
  }

  function resetSpkBtn() {
    _isTtsLoading    = false;
    spkBtn.className = 'wa-ptt-btn' + autoClass();
    spkBtn.innerHTML = speakerSVG();
  }

  function resetMsgBtn(btn) {
    if (!btn) return;
    btn.innerHTML = speakerSmallSVG();
    btn.classList.remove('playing');
    btn.style.opacity = '';
  }

  // ── Per-message speaker buttons ───────────────────────────────────────────
  function injectMsgSpeakerBtn(msgEl) {
    if (!msgEl || msgEl.dataset.waSpkHost) return;

    const text = extractMsgText(msgEl);
    if (!text) return;

    msgEl.dataset.waSpkHost = '1';

    const bubble =
      msgEl.querySelector('[class*="bubble"]') ||
      msgEl.querySelector('[class*="copyable"]') ||
      msgEl.querySelector('div > div') ||
      msgEl;

    const pos = window.getComputedStyle(bubble).position;
    if (pos === 'static') bubble.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className   = 'wa-msg-spk';
    btn.innerHTML   = speakerSmallSVG();
    btn.title       = 'Read aloud';
    btn.type        = 'button';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (_currentAudio) {
        stopAudio();
        return;
      }
      speakText(text, btn).catch(console.error);
    });

    bubble.appendChild(btn);
  }

  // ── MutationObserver: watch for new messages ──────────────────────────────
  let _msgObserver = null;

  function setupMessageObserver() {
    if (_msgObserver) return;

    const target = document.querySelector('div#main') || document.body;

    _msgObserver = new MutationObserver((mutations) => {
      // Fix: Optimization - Only run if something meaningful changed
      let hasAddedMessages = false;
      for (const mut of mutations) {
        if (mut.addedNodes.length > 0) {
          hasAddedMessages = true;
          break;
        }
      }
      if (!hasAddedMessages) return;

      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;

          const incoming = [];
          if (node.classList?.contains('message-in') || node.className?.includes?.('message-in')) {
            incoming.push(node);
          } else {
            node.querySelectorAll?.('.message-in, [class*="message-in"]')
              .forEach(el => incoming.push(el));
          }

          for (const msgEl of incoming) {
            injectMsgSpeakerBtn(msgEl);

            if (!_autoRead || !_autoReadReady || _currentAudio || _isTtsLoading) continue;

            // Fix: Improved "new message" detection using DOM position instead of list length
            // Genuine new messages are appended at the bottom.
            const rect = msgEl.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            // If message is in the top half of the screen when it "appears", it's likely from scroll-up loading
            if (rect.top < viewportHeight / 2) continue;

            const msgId  = msgEl.closest('[data-id]')?.dataset?.id;
            if (msgId && msgId === _lastAutoReadId) continue;
            _lastAutoReadId = msgId || Date.now().toString();

            const text = extractMsgText(msgEl);
            if (text) {
              setTimeout(() => speakText(text).catch(console.error), 350);
            }
          }
        }
      }
    });

    _msgObserver.observe(target, { childList: true, subtree: true });
  }

  function injectAllVisibleMsgBtns() {
    _autoReadReady = false;
    getIncomingMsgEls().forEach(el => injectMsgSpeakerBtn(el));
    setTimeout(() => { _autoReadReady = true; }, 3000);
  }

  let _transcriptionToken = 0;
  let _lastFinishTime = 0;

  function cancelAllTranscriptions() {
    _transcriptionToken++;
    if (_transcriptionAbort) {
      _transcriptionAbort.abort();
      _transcriptionAbort = null;
    }
    cancelPendingSend(true);
    if (isRecording) {
      stopRecording().catch(()=>{});
    }
    resetMicBtn();
    setStatus('Cancelled', 2000);
  }

  // ── PTT main flow ─────────────────────────────────────────────────────────
  async function finishAndSend() {
    const now = Date.now();
    if (now - _lastFinishTime < 500) {
      cancelAllTranscriptions();
      _lastFinishTime = 0;
      return;
    }
    _lastFinishTime = now;

    const myToken = ++_transcriptionToken;

    micBtn.className = 'wa-ptt-btn transcribing';
    micBtn.innerHTML = spinnerSVG();
    setStatus('Transcribing…');

    const blob = await stopRecording();

    if (!blob || blob.size < 800) {
      resetMicBtn(); setStatus(''); return;
    }

    const text = await transcribe(blob);

    if (myToken !== _transcriptionToken) return;

    resetMicBtn();

    // Fix: Handle empty/nothing transcriptions
    if (!text || text.trim() === '' || /^nothing|null|none|silence|\[silence\]$/i.test(text.trim())) {
      setStatus('Silence detected', 2000);
      return;
    }

    const preview = text.length > 44 ? text.slice(0, 42) + '…' : text;
    setStatus(preview, 3000);
    injectAndSend(text);
  }

  function resetMicBtn() {
    if (_phoneMode) {
      micBtn.className = 'wa-ptt-btn listening';
      micBtn.innerHTML = micSVG();
      setStatus('👂 Listening…');
    } else {
      micBtn.className = 'wa-ptt-btn';
      micBtn.innerHTML = micSVG();
    }
  }

  // ── Initialisation ──────────────────────────────────────────────────────
  function mountInline() {
    const footer =
      document.querySelector('footer') ||
      document.querySelector('[data-testid="conversation-compose-box-input"]')?.closest('div[class]')?.parentElement ||
      document.querySelector('div#main footer');

    if (footer && footer.parentElement) {
      if (root.parentElement !== footer.parentElement) {
        footer.parentElement.insertBefore(root, footer);
      }
    } else {
      // Fallback
      if (!root.parentElement) {
        root.style.position = 'fixed';
        root.style.bottom   = '0';
        root.style.left     = '0';
        root.style.right    = '0';
        root.style.zIndex   = '9999';
        document.body.appendChild(root);
      }
    }
  }

  // Fix: Optimized chatObserver - only re-inject when chat changes, not on every app mutation
  let _lastChatId = null;
  const chatObserver = new MutationObserver(() => {
    const main = document.querySelector('div#main');
    if (!main) {
      _lastChatId = null;
      return;
    }
    
    // Check for a unique chat identifier
    const chatHeader = main.querySelector('header [title]');
    const chatId = chatHeader ? chatHeader.getAttribute('title') : 'unknown';
    
    if (chatId !== _lastChatId) {
      _lastChatId = chatId;
      mountInline();
      injectAllVisibleMsgBtns();
      setupMessageObserver();
    }
  });

  chatObserver.observe(document.body, { childList: true, subtree: true });

  // Listen for background commands
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PTT_START') startRecording().catch(console.error);
    if (msg.type === 'PTT_STOP')  finishAndSend().catch(console.error);
    if (msg.type === 'PTT_LISTEN') {
      _phoneMode = !_phoneMode;
      chrome.storage.local.set({ phone_mode: _phoneMode });
      updateVadState();
    }
  });

})();
