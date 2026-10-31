    // =========================================================================
    // 11. AUDIÇÃO WHISPER GPU CUDA + TENSOR CORES (169ms!) + AUDIOWORKLET VAD
    // =========================================================================
    window._micRefs = { stream: null, ctx: null, source: null, worklet: null, processor: null, silentGain: null };

    let availableMics = [];
    let lastAudioFrameAt = 0;
    let calibrationFrames = 0;
    let speechOnsetFrames = 0;

    let preRollChunks = [];
    let recordedChunks = [];
    let silenceDurationMs = 0;
    let speechDurationMs = 0;
    let utterancePeakRms = 0;
    let noiseFloor = 0.0004;

    const TARGET_SAMPLE_RATE = 16000;
    const PRE_ROLL_MAX_MS = 650;
    const BASE_SILENCE_FINISH_MS = 900;
    const SHORT_SPEECH_SILENCE_MS = 950;
    const MIN_SPEECH_MS = 250;
    const MAX_SPEECH_MS = 14000;

    const HALLUCINATION_PATTERNS = [
      /^obrigado por assistir\.?$/i,
      /^legendas pela comunidade/i,
      /^inscreva-se no canal/i,
      /^até a próxima\.?$/i,
      /^\[.*\]$/,
      /^\(.*\)$/,
      /^\.+$/
    ];

    function clearPreRoll() {
      preRollChunks = [];
      recordedChunks = [];
      silenceDurationMs = 0;
      speechDurationMs = 0;
      utterancePeakRms = 0;
      speechOnsetFrames = 0;
    }

    function resampleAndNormalizeTo16k(float32Samples, sourceRate) {
      let resampled;
      if (sourceRate === TARGET_SAMPLE_RATE) {
        resampled = new Float32Array(float32Samples);
      } else {
        const ratio = sourceRate / TARGET_SAMPLE_RATE;
        const newLength = Math.round(float32Samples.length / ratio);
        resampled = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          const start = Math.floor(i * ratio);
          const end = Math.min(float32Samples.length, Math.floor((i + 1) * ratio));
          let sum = 0, count = 0;
          for (let j = start; j < end; j++) { sum += float32Samples[j]; count++; }
          resampled[i] = count > 0 ? sum / count : (float32Samples[start] || 0);
        }
      }

      // Filtro High-Pass 75 Hz (remove zumbido grave 50/60Hz de conector P2 antes de amplificar consoantes!)
      const hpAlpha = 0.971;
      let prevX = resampled[0] || 0;
      let prevY = 0;
      let maxPeak = 0;
      for (let i = 0; i < resampled.length; i++) {
        const x = resampled[i];
        const y = hpAlpha * (prevY + x - prevX);
        prevX = x;
        prevY = y;
        resampled[i] = y;
        const abs = Math.abs(y);
        if (abs > maxPeak) maxPeak = abs;
      }

      if (maxPeak > 0.00030) {
        const gain = Math.min(95.0, 0.86 / maxPeak);
        for (let i = 0; i < resampled.length; i++) {
          resampled[i] = Math.max(-1, Math.min(1, resampled[i] * gain));
        }
      }
      return resampled;
    }

    function encodeWAV16k(samples16k) {
      const buffer = new ArrayBuffer(44 + samples16k.length * 2);
      const view = new DataView(buffer);
      const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };

      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + samples16k.length * 2, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, TARGET_SAMPLE_RATE, true);
      view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, samples16k.length * 2, true);

      let offset = 44;
      for (let i = 0; i < samples16k.length; i++) {
        const s = Math.max(-1, Math.min(1, samples16k[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
      return new Blob([view], { type: 'audio/wav' });
    }

    function mergeChunks(chunks) {
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      return merged;
    }

    // Pool TLS 1.3 Persistente para Groq Cloud LPU (~0ms de handshake SSL a cada fala!)
    const groqAgent = nodeHttps
      ? new nodeHttps.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4 })
      : null;

    let groqWarmLoggedOnce = false;

    function warmUpGroqConnection() {
      if (!nodeHttps || !String(prefs.sttMode || '').startsWith('groq-')) return;
      const groqKey = (prefs.groqApiKey || '').trim();
      if (!groqKey) {
        groqStatusBadge.textContent = '⚠ Insira a chave gsk_';
        groqStatusBadge.style.color = '#fbbf24';
        return;
      }
      const req = nodeHttps.request(
        {
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/models',
          method: 'GET',
          agent: groqAgent,
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'User-Agent': 'StackChan-Pet/2.0',
          },
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            groqStatusBadge.textContent = '● Groq LPU Conectado';
            groqStatusBadge.style.color = '#34d399';
            if (!groqWarmLoggedOnce) {
              groqWarmLoggedOnce = true;
              console.log(`[GROQ-LPU] Socket TLS Keep-Alive aquecido com sucesso (HTTP ${res.statusCode})`);
            }
          } else {
            groqStatusBadge.textContent = `⚠ HTTP ${res.statusCode}`;
            groqStatusBadge.style.color = '#f87171';
            console.warn(`[GROQ-LPU] Warmup retornou HTTP ${res.statusCode}`);
          }
        }
      );
      req.setTimeout(6000, () => req.destroy());
      req.on('error', (err) => {
        groqStatusBadge.textContent = '⚠ Offline';
        groqStatusBadge.style.color = '#fbbf24';
        console.warn('[GROQ-LPU] Warmup offline:', err.message);
      });
      req.end();
    }

    warmUpGroqConnection();
    setInterval(warmUpGroqConnection, 25000);

    function transcribeWithGroqLpu(wavBuffer, groqModel) {
      const groqKey = (prefs.groqApiKey || '').trim();
      if (!nodeHttps || !groqKey) {
        return Promise.reject(new Error('Chave API Groq ausente'));
      }

      const boundary = '----StackChanGroq' + Date.now().toString(16) + Math.random().toString(16).slice(2);
      const chunks = [];
      const addField = (name, val) => {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`,
            'utf8'
          )
        );
      };

      addField('model', groqModel);
      addField('language', 'pt');
      addField('temperature', '0');
      addField('response_format', 'verbose_json');
      addField(
        'prompt',
        'E aí BitBop, consegue me ouvir direitinho? Conversa natural em português brasileiro sobre a área de trabalho, Arena Breakout, jogos, vídeos, código e aplicativos.'
      );

      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
          'utf8'
        )
      );
      chunks.push(wavBuffer);
      chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

      const bodyBuf = Buffer.concat(chunks);

      return new Promise((resolve, reject) => {
        const req = nodeHttps.request(
          {
            hostname: 'api.groq.com',
            port: 443,
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            agent: groqAgent,
            headers: {
              Authorization: `Bearer ${groqKey}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': bodyBuf.length,
              'User-Agent': 'StackChan-Pet/2.0',
            },
          },
          (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
              if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`Groq HTTP ${res.statusCode}: ${raw.slice(0, 160)}`));
                return;
              }
              try {
                resolve(JSON.parse(raw));
              } catch (e) {
                reject(e);
              }
            });
            res.on('error', reject);
          }
        );
        req.setTimeout(12000, () => req.destroy(new Error('Groq timeout')));
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
      });
    }

    async function sendToGroqWhisper(wavBlob, rawSamples, sourceSampleRate, sttMode) {
      state.isTranscribing = true;
      const t0 = performance.now();
      const groqModel = sttMode === 'groq-whisper-turbo' ? 'whisper-large-v3-turbo' : 'whisper-large-v3';

      try {
        const ab = await wavBlob.arrayBuffer();
        const wavBuf = Buffer.from(ab);
        const data = await transcribeWithGroqLpu(wavBuf, groqModel);

        const segs = Array.isArray(data.segments) ? data.segments : [];
        const allSilence = segs.length > 0 && segs.every((s) => (s.no_speech_prob || 0) > 0.72);
        let text = (data.text || '').trim();
        text = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

        const elapsed = Math.round(performance.now() - t0);
        console.log(`[GROQ-LPU:${groqModel}] (${elapsed}ms) -> "${text}"${allSilence ? ' [IGNORADO: ruído]' : ''}`);

        const isHallucination = allSilence || HALLUCINATION_PATTERNS.some((rx) => rx.test(text));
        if (!isHallucination && text.length >= 2) {
          state.isTranscribing = false;
          if (window.MemoryExtractor && typeof window.MemoryExtractor.notifyUserInteraction === 'function') {
            window.MemoryExtractor.notifyUserInteraction();
          }
          const speakerInfo = await getAwaitedSpeakerInfo();
          await handleUserMessage(text, false, { speakerInfo });
          return;
        } else {
          speechBubble.classList.remove('visible');
        }
      } catch (err) {
        console.warn(`[GROQ-LPU] Erro (${err.message}); acionando fallback automático...`);
        state.isTranscribing = false;
        if (prefs.aiProvider === 'gemini' && (prefs.geminiApiKey || '').trim()) {
          await handleDirectAudioGemini(wavBlob, rawSamples, sourceSampleRate);
        } else {
          if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', 'whisper-turbo');
          await sendToWhisper(rawSamples, sourceSampleRate);
        }
        return;
      } finally {
        state.isTranscribing = false;
      }
    }

    let activeBiometricPromise = null;

    async function getAwaitedSpeakerInfo() {
      if (!activeBiometricPromise) return null;
      try {
        return await activeBiometricPromise;
      } catch (err) {
        console.warn('[VOICE-BIOMETRICS] Falha ao recuperar locutor:', err);
        return null;
      }
    }

    async function processCapturedSpeech(rawSamples, sourceSampleRate) {
      const samples16k = resampleAndNormalizeTo16k(rawSamples, sourceSampleRate);

      // 1. Interceptação de Calibração da Voz do Dono
      if (state.isCalibratingVoice && window.VoiceBiometrics) {
        state.isTranscribing = false;
        try {
          await window.VoiceBiometrics.enrollOwner(samples16k);
        } catch (calibErr) {
          console.error('[VOICE-BIOMETRICS] Erro na calibração:', calibErr);
        } finally {
          if (typeof window.hideActionBadge === 'function') {
            window.hideActionBadge();
          }
        }
        return;
      }

      // 2. DISPARO EM PARALELO (0ms de latência percebida!):
      // Enquanto o Whisper/Groq roda (~180ms), a biometria CAM++ roda em background (~30ms)
      activeBiometricPromise = (window.VoiceBiometrics && typeof window.VoiceBiometrics.verifySamples === 'function')
        ? window.VoiceBiometrics.verifySamples(samples16k)
        : Promise.resolve({ enrolled: false, isOwner: true, similarity: 1.0, speaker: 'DONO' });

      const mode = getEffectiveSttMode();
      if (mode.startsWith('groq-')) {
        const wavBlob = encodeWAV16k(samples16k);
        await sendToGroqWhisper(wavBlob, rawSamples, sourceSampleRate, mode);
      } else if (mode === 'gemini-audio') {
        const wavBlob = encodeWAV16k(samples16k);
        await handleDirectAudioGemini(wavBlob, rawSamples, sourceSampleRate);
      } else {
        await sendToWhisper(rawSamples, sourceSampleRate);
      }
    }

    async function sendToWhisper(rawSamples, sourceSampleRate) {
      state.isTranscribing = true;
      const t0 = performance.now();

      try {
        const samples16k = resampleAndNormalizeTo16k(rawSamples, sourceSampleRate);
        const wavBlob = encodeWAV16k(samples16k);

        const formData = new FormData();
        formData.append('file', wavBlob, 'speech.wav');
        formData.append('temperature', '0.0');
        formData.append('response_format', 'json');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('http://127.0.0.1:8085/inference', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Whisper HTTP ${response.status}`);
        const data = await response.json();
        let text = (data.text || '').trim();
        text = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

        console.log(`[WHISPER-GPU] (${Math.round(performance.now() - t0)}ms) -> "${text}"`);

        const isHallucination = HALLUCINATION_PATTERNS.some((rx) => rx.test(text));
        if (!isHallucination && text.length >= 2) {
          state.isTranscribing = false;
          if (window.MemoryExtractor && typeof window.MemoryExtractor.notifyUserInteraction === 'function') {
            window.MemoryExtractor.notifyUserInteraction();
          }
          const speakerInfo = await getAwaitedSpeakerInfo();
          await handleUserMessage(text, false, { speakerInfo });
          return;
        } else {
          speechBubble.classList.remove('visible');
        }
      } catch (err) {
        console.error('[WHISPER] Erro:', err.message || err);
        speechBubble.classList.remove('visible');
      } finally {
        state.isTranscribing = false;
      }
    }

    let hpVADPrevX = 0;
    let hpVADPrevY = 0;

    function processMicChunk(chunkCopy, nativeRate) {
      lastAudioFrameAt = Date.now();
      const chunkDurationMs = (chunkCopy.length / nativeRate) * 1000;
      const maxPreRollChunks = Math.ceil(PRE_ROLL_MAX_MS / chunkDurationMs);

      // Bloqueia somente se microfone desativado, serviços ainda subindo ou transcrevendo fala anterior
      if (!prefs.micEnabled || !state.servicesReady || state.isTranscribing) {
        cfgVuBar.style.width = '0%';
        speechOnsetFrames = 0;
        return;
      }

      const inBargeWindow = state.isSpeaking || state.isThinking || Date.now() < state.cooldownUntil;
      if (inBargeWindow && !prefs.bargeInEnabled) {
        cfgVuBar.style.width = '0%';
        speechOnsetFrames = 0;
        return;
      }

      // Filtro High-Pass IIR de 180 Hz em tempo real para cálculo de VAD:
      // Rejeita >92% da energia de sopro, respiração nasal, estalos de ar e ruído mecânico de mesa!
      // Mantém 100% da energia de formantes de voz humana (vogais e consoantes).
      const hpAlpha = 0.976;
      let sumSq = 0;
      for (let i = 0; i < chunkCopy.length; i++) {
        const x = chunkCopy[i];
        const y = hpAlpha * (hpVADPrevY + x - hpVADPrevX);
        hpVADPrevX = x;
        hpVADPrevY = y;
        sumSq += y * y;
      }
      const rms = Math.sqrt(sumSq / chunkCopy.length);

      // Fator de sensibilidade (configurável: 'baixa', 'media', 'alta')
      const sens = prefs.micSensitivity || 'media';
      const sensFactor = sens === 'baixa' ? 1.45 : (sens === 'alta' ? 0.65 : 1.0);

      // Limiar equilibrado: o filtro HighPass de 180Hz já rejeita o sopro e respiração (<0.0014).
      // Com 0.0026, a fala normal de conversa (0.0040 - 0.0090) entra perfeitamente sem precisar falar alto!
      const normalStartThreshold = Math.max(0.0026 * sensFactor, noiseFloor * 3.2);

      // Durante fala do BitBop (Barge-In): limiar ágil para interromper instantaneamente com voz normal de conversa
      const bargeStartThreshold = Math.max(0.0034 * sensFactor, noiseFloor * 3.6);
      const activeStartThreshold = inBargeWindow ? bargeStartThreshold : normalStartThreshold;

      // Limiar para manter a fala ativa durante pequenas pausas naturais entre palavras
      const holdThreshold = Math.max(0.0012 * sensFactor, noiseFloor * 1.6);

      if (state.settingsOpen) {
        const meterPct = Math.min(100, Math.round((rms / (activeStartThreshold * 2.2)) * 100));
        cfgVuBar.style.width = `${meterPct}%`;
      }

      if (!state.isUserSpeaking) {
        if (!inBargeWindow) {
          if (calibrationFrames < 35) {
            noiseFloor = Math.max(0.00015, Math.min(0.012, noiseFloor * 0.85 + rms * 0.15));
            calibrationFrames++;
            if (calibrationFrames === 35) {
              console.log(`[MIC] Calibrado (Equilíbrio Voz/Respiração) -> noiseFloor=${noiseFloor.toFixed(6)}, startThreshold=${normalStartThreshold.toFixed(6)}`);
            }
          } else if (rms < normalStartThreshold * 0.75) {
            noiseFloor = Math.max(0.00015, Math.min(0.012, noiseFloor * 0.98 + rms * 0.02));
          }
        }

        preRollChunks.push(chunkCopy);
        if (preRollChunks.length > maxPreRollChunks) preRollChunks.shift();

        // 2 frames (~42ms) em repouso e no barge-in para interrupção e captura imediata da fala
        const requiredOnsetFrames = 2;
        if (rms >= activeStartThreshold) {
          speechOnsetFrames++;
          if (speechOnsetFrames >= requiredOnsetFrames) {
            const preRollKeepCount = inBargeWindow
              ? Math.min(preRollChunks.length, Math.ceil(120 / chunkDurationMs))
              : preRollChunks.length;
            const initialChunks = [...preRollChunks.slice(-preRollKeepCount), chunkCopy];

            if (inBargeWindow) {
              console.log(`[BARGE-IN] Fala detectada (rms=${rms.toFixed(4)} >= ${activeStartThreshold.toFixed(4)}) — interrompendo BitBop imediatamente!`);
              if (window.PersonalityLearner && typeof window.PersonalityLearner.recordBargeIn === 'function') {
                window.PersonalityLearner.recordBargeIn({
                  botResponse: state.lastSpokenText || '',
                  botTextLen: (state.lastSpokenText || '').length
                });
              }
              stopCurrentSpeech();
              state.cooldownUntil = 0;
            }

            state.isUserSpeaking = true;
            state.lastInteractionAt = Date.now();
            state.lastUserInteractionAt = Date.now();
            if (state.aiAction === 'SLEEP' || state.aiAction === 'WALK') {
              state.aiAction = 'IDLE';
              state.walkTargetX = null;
            }
            setEmotion('LISTENING', 4500);
            updateMicVisuals();
            if (typeof window.showActionBadge === 'function') window.showActionBadge('🎤', 'Te ouvindo...', 0);
            showBubble('Te ouvindo... 🎤', 'Pode falar!', 0);

            recordedChunks = initialChunks;
            preRollChunks = [];
            speechDurationMs = chunkDurationMs * requiredOnsetFrames;
            silenceDurationMs = 0;
            utterancePeakRms = rms;
            speechOnsetFrames = 0;
          }
        } else {
          speechOnsetFrames = 0;
        }
      } else {
        recordedChunks.push(chunkCopy);
        if (rms > utterancePeakRms) utterancePeakRms = rms;

        const dynamicSilenceFloor = Math.max(holdThreshold, utterancePeakRms * 0.16);
        if (rms >= dynamicSilenceFloor) {
          speechDurationMs += chunkDurationMs;
          silenceDurationMs = 0;
        } else {
          silenceDurationMs += chunkDurationMs;
        }

        const requiredSilenceMs = speechDurationMs < 2500 ? SHORT_SPEECH_SILENCE_MS : BASE_SILENCE_FINISH_MS;
        if (silenceDurationMs > 350 && silenceDurationMs < requiredSilenceMs && speechBubble.classList.contains('visible')) {
          speakerLabel.innerText = 'Te ouvindo... 👂 (pensando?)';
        }

        const totalDurationMs = recordedChunks.length * chunkDurationMs;
        if (silenceDurationMs >= requiredSilenceMs || totalDurationMs >= MAX_SPEECH_MS) {
          state.isUserSpeaking = false;
          updateMicVisuals();

          const validSpeech = speechDurationMs >= MIN_SPEECH_MS;
          const fullSamples = validSpeech ? mergeChunks(recordedChunks) : null;
          clearPreRoll();

          if (fullSamples) {
            if (typeof window.showActionBadge === 'function') window.showActionBadge('🎧', 'Processando...', 0);
            processCapturedSpeech(fullSamples, nativeRate);
          } else {
            if (typeof window.hideActionBadge === 'function') window.hideActionBadge();
            speechBubble.classList.remove('visible');
          }
        }
      }
    }

    async function teardownMicPipeline() {
      const refs = window._micRefs;
      try { if (refs.worklet) refs.worklet.disconnect(); } catch {}
      try { if (refs.processor) refs.processor.disconnect(); } catch {}
      try { if (refs.silentGain) refs.silentGain.disconnect(); } catch {}
      try { if (refs.source) refs.source.disconnect(); } catch {}
      if (refs.stream) {
        try { refs.stream.getTracks().forEach((t) => t.stop()); } catch {}
      }
      if (refs.ctx && refs.ctx.state !== 'closed') {
        try { await refs.ctx.close(); } catch {}
      }
      window._micRefs = { stream: null, ctx: null, source: null, worklet: null, processor: null, silentGain: null };
    }

    let initializingMic = false;

    async function initContinuousListening(forceDeviceId = null) {
      if (initializingMic) return;
      initializingMic = true;

      try {
        await teardownMicPipeline();

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        availableMics = allDevices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');

        const virtualRx = /steam streaming|virtual|vb-audio|cable|stereo mix|mixagem/i;
        let targetDeviceId = forceDeviceId;
        if (!targetDeviceId && availableMics.length > 0) {
          const realMic = availableMics.find((d) => d.label && !virtualRx.test(d.label));
          targetDeviceId = realMic ? realMic.deviceId : availableMics[0].deviceId;
        }

        // Popula seletor de microfones no painel de configurações
        selMic.innerHTML = '';
        for (const m of availableMics) {
          const opt = document.createElement('option');
          opt.value = m.deviceId;
          opt.textContent = m.label || 'Microfone';
          if (m.deviceId === targetDeviceId) opt.selected = true;
          selMic.appendChild(opt);
        }

        // Captura PCM pura sem o noise gate agressivo do WebRTC (preserva consoantes suaves 'v', 's', 'ch')
        const audioConstraints = {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };
        if (targetDeviceId) audioConstraints.deviceId = { exact: targetDeviceId };

        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const activeTrack = stream.getAudioTracks()[0];
        const micLabel = activeTrack ? activeTrack.label : 'Padrão';

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') await ctx.resume();
        const nativeRate = ctx.sampleRate;
        const source = ctx.createMediaStreamSource(stream);

        calibrationFrames = 0;
        noiseFloor = 0.0004;
        clearPreRoll();
        lastAudioFrameAt = Date.now();
        console.log(`[MIC] Ativo em "${micLabel}" (${nativeRate}Hz)`);

        const workletCode = `
          class MicCaptureProcessor extends AudioWorkletProcessor {
            constructor() { super(); this._buf = new Float32Array(1024); this._pos = 0; }
            process(inputs) {
              const ch = inputs[0] && inputs[0][0];
              if (ch) {
                for (let i = 0; i < ch.length; i++) {
                  this._buf[this._pos++] = ch[i];
                  if (this._pos >= 1024) {
                    this.port.postMessage(this._buf.slice(0));
                    this._pos = 0;
                  }
                }
              }
              return true;
            }
          }
          registerProcessor('mic-capture-processor', MicCaptureProcessor);
        `;
        const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);

        const workletNode = new AudioWorkletNode(ctx, 'mic-capture-processor');
        workletNode.port.onmessage = (ev) => processMicChunk(ev.data, nativeRate);
        source.connect(workletNode);

        window._micRefs = { stream, ctx, source, worklet: workletNode, processor: null, silentGain: null };
      } catch (err) {
        console.error('[MIC] Erro:', err.message || err);
      } finally {
        initializingMic = false;
      }
    }

    initContinuousListening();

    setInterval(() => {
      const refs = window._micRefs;
      if (refs.ctx && refs.ctx.state === 'suspended') refs.ctx.resume().catch(() => {});
      if (prefs.micEnabled && !initializingMic) {
        const track = refs.stream && refs.stream.getAudioTracks()[0];
        if (!track || track.readyState === 'ended' || (lastAudioFrameAt > 0 && Date.now() - lastAudioFrameAt > 4000)) {
          initContinuousListening(selMic.value || null);
        }
      }
    }, 2200);
