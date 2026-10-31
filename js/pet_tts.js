    // =========================================================================
    // 9. STREAMING DE VOZ NEURAL + LIP-SYNC REAL + INTERRUPÇÃO INSTANTÂNEA (BARGE-IN)
    // =========================================================================
    let playbackAudioCtx = null;
    let currentAudioEl = null;
    let currentFinishAudio = null;
    let activeStreamAbort = null;
    const audioPreloadCache = new Map();

    function prefetchSentenceAudio(text) {
      const clean = (text || '').trim();
      if (!clean || audioPreloadCache.has(clean) || (prefs && !prefs.voiceEnabled)) return;
      const ttsUrl = `http://127.0.0.1:8086/tts?preset=${encodeURIComponent(prefs.voice)}&text=${encodeURIComponent(clean)}`;
      
      const p = fetch(ttsUrl)
        .then((r) => (r.ok && r.status === 200 ? r.blob() : null))
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null);

      audioPreloadCache.set(clean, p);
      if (audioPreloadCache.size > 24) {
        const oldest = audioPreloadCache.keys().next().value;
        const oldP = audioPreloadCache.get(oldest);
        if (oldP && typeof oldP.then === 'function') {
          oldP.then((url) => { if (url) try { URL.revokeObjectURL(url); } catch {} });
        }
        audioPreloadCache.delete(oldest);
      }
    }

    function stopCurrentSpeech() {
      state.speechSessionId++;
      if (activeStreamAbort) {
        const abortFn = activeStreamAbort;
        activeStreamAbort = null;
        try { abortFn(); } catch {}
      }
      if (currentAudioEl) {
        try {
          currentAudioEl.pause();
          currentAudioEl.currentTime = 0;
          currentAudioEl.src = '';
          currentAudioEl.load();
        } catch {}
        currentAudioEl = null;
      }
      if (currentFinishAudio) {
        const fn = currentFinishAudio;
        currentFinishAudio = null;
        fn();
      }
      if (window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      for (const [k, p] of audioPreloadCache.entries()) {
        if (p && typeof p.then === 'function') {
          p.then((url) => { if (url) try { URL.revokeObjectURL(url); } catch {} });
        }
      }
      audioPreloadCache.clear();
      state.isSpeaking = false;
      state.isThinking = false;
      state.isScanningScreen = false;
      state.mouthOpen = 0;
      if (!prefs.bubbleEnabled) {
        if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
        speechBubble.classList.remove('visible');
      }
    }

    function isRoboticVoice(voiceKey) {
      return ['cyber_bot', 'mecha_chan', 'retro_robot', 'jarvis'].includes(voiceKey);
    }

    function playSingleSentenceStream(sentence, sessionId, forceAudio = false) {
      const clean = (sentence || '').trim();
      if (!/[A-Za-zÀ-ÿ0-9]/.test(clean) || sessionId !== state.speechSessionId) {
        return Promise.resolve();
      }

      if (!prefs.voiceEnabled && !forceAudio) {
        // MODO SEM VOZ (Apenas Caixa de Diálogo):
        // Simula o tempo de leitura humana suave (~48ms/char, min 1400ms, max 6500ms)
        // com animação fofa da boquinha no visor OLED enquanto o usuário lê o balão!
        return new Promise((resolve) => {
          state.isSpeaking = true;
          const readingMs = Math.max(1400, Math.min(6500, clean.length * 48));
          const t0 = performance.now();
          let animId = null;

          const finish = () => {
            if (animId) cancelAnimationFrame(animId);
            state.mouthOpen = 0;
            if (currentFinishAudio === finish) currentFinishAudio = null;
            resolve();
          };
          currentFinishAudio = finish;

          function updateSilentSpeech() {
            if (!state.isSpeaking || sessionId !== state.speechSessionId) {
              finish();
              return;
            }
            const elapsed = performance.now() - t0;
            if (elapsed >= readingMs) {
              finish();
              return;
            }
            // Movimento suave e expressivo da boquinha no OLED durante a fala silenciosa
            const cycle = elapsed * 0.016;
            state.mouthOpen = Math.max(0, Math.sin(cycle) * Math.cos(cycle * 0.45) * 0.48);
            animId = requestAnimationFrame(updateSilentSpeech);
          }
          animId = requestAnimationFrame(updateSilentSpeech);
        });
      }

      const ttsUrl = `http://127.0.0.1:8086/tts?preset=${encodeURIComponent(prefs.voice)}&text=${encodeURIComponent(clean)}`;

      return new Promise(async (resolve) => {
        let resolvedSrc = ttsUrl;
        if (audioPreloadCache.has(clean)) {
          try {
            const cachedBlobUrl = await audioPreloadCache.get(clean);
            if (cachedBlobUrl) resolvedSrc = cachedBlobUrl;
            audioPreloadCache.delete(clean);
          } catch {}
        }

        if (sessionId !== state.speechSessionId) {
          resolve();
          return;
        }

        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        currentAudioEl = audio;

        if (!playbackAudioCtx) {
          playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (playbackAudioCtx.state === 'suspended') {
          playbackAudioCtx.resume().catch(() => {});
        }

        let sourceNode = null;
        let analyser = null;
        let animId = null;

        try {
          sourceNode = playbackAudioCtx.createMediaElementSource(audio);
          analyser = playbackAudioCtx.createAnalyser();
          analyser.fftSize = 256;

          sourceNode.connect(analyser);
          analyser.connect(playbackAudioCtx.destination);
        } catch {}

        const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

        function updateMouthFromAudio() {
          if (!state.isSpeaking || !analyser || !dataArray) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          const count = Math.min(40, dataArray.length);
          for (let i = 2; i < count; i++) sum += dataArray[i];
          state.mouthOpen = Math.min(1, (sum / (count - 2)) / 100);
          animId = requestAnimationFrame(updateMouthFromAudio);
        }

        let finished = false;
        let safetyTimer = null;

        const resetSafety = () => {
          if (safetyTimer) clearTimeout(safetyTimer);
          safetyTimer = setTimeout(() => finish(), 14000);
        };

        const finish = () => {
          if (finished) return;
          finished = true;
          if (safetyTimer) clearTimeout(safetyTimer);
          if (animId) cancelAnimationFrame(animId);
          try { if (sourceNode) sourceNode.disconnect(); } catch {}
          try { if (analyser) analyser.disconnect(); } catch {}
          state.mouthOpen = 0;
          if (currentAudioEl === audio) currentAudioEl = null;
          if (currentFinishAudio === finish) currentFinishAudio = null;
          if (resolvedSrc && resolvedSrc.startsWith('blob:')) {
            try { URL.revokeObjectURL(resolvedSrc); } catch {}
          }
          resolve();
        };

        currentFinishAudio = finish;
        resetSafety();

        audio.onplay = () => {
          resetSafety();
          state.isSpeaking = true;
          updateMouthFromAudio();
        };
        audio.ontimeupdate = resetSafety;
        audio.onended = finish;
        audio.onerror = () => finish();

        audio.src = resolvedSrc;
        audio.play().catch(() => finish());
      });
    }

    async function speakText(text, targetEmotion = 'HAPPY', forceAudio = false, forceBubble = false) {
      stopCurrentSpeech();
      const sessionId = state.speechSessionId;
      state.isSpeaking = true;
      setEmotion(targetEmotion, 6000);
      if (forceBubble) {
        showBubble('BitBop', text, 7000, false, true);
      }
      await playSingleSentenceStream(text, sessionId, forceAudio);
      if (sessionId === state.speechSessionId) {
        state.isSpeaking = false;
        state.cooldownUntil = Date.now() + 380;
        if (!state.isUserSpeaking && typeof clearPreRoll === 'function') clearPreRoll();
        if (!forceBubble) {
          showBubble('BitBop', text, 4500);
        }
      }
    }


// Globais exportadas para window
window.speakText = speakText;
window.stopCurrentSpeech = stopCurrentSpeech;
window.prefetchSentenceAudio = prefetchSentenceAudio;
window.stopSpeech = stopCurrentSpeech;
window.bargeIn = typeof bargeIn !== 'undefined' ? bargeIn : stopCurrentSpeech;
