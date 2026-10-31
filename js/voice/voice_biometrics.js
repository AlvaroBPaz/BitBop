// js/voice/voice_biometrics.js - Módulo de Biometria Vocal & Reconhecimento do Dono (CAM++)
(function (root, factory) {
  const instance = factory();
  if (typeof root !== 'undefined') {
    root.VoiceBiometrics = instance;
  }
  if (typeof window !== 'undefined') {
    window.VoiceBiometrics = instance;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.VoiceBiometrics = instance;
  }
  if (typeof module === 'object' && module && module.exports) {
    module.exports = instance;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function getAppWindow() {
    return (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  }

  function getAppState() {
    const win = getAppWindow();
    return win.state || (typeof globalThis !== 'undefined' ? globalThis.state : {}) || {};
  }

  function safeSetEmotion(emo, dur) {
    const win = getAppWindow();
    if (typeof win.setEmotion === 'function') win.setEmotion(emo, dur);
  }

  function safeCuteSynth(action) {
    const win = getAppWindow();
    if (win.CuteSynth && typeof win.CuteSynth[action] === 'function') {
      try { win.CuteSynth[action](); } catch {}
    }
  }

  function safeShowBubble(title, text, dur, isVision, stayOpen) {
    const win = getAppWindow();
    if (typeof win.showBubble === 'function') {
      win.showBubble(title, text, dur, isVision, stayOpen);
    }
  }

  async function safeSpeakText(text, emo, forceAudio = true) {
    const win = getAppWindow();
    if (typeof win.speakText === 'function') {
      try {
        await win.speakText(text, emo, forceAudio);
      } catch (err) {
        console.warn('[VOICE-BIOMETRICS] Erro ao sintetizar fala:', err);
      }
    }
  }

  let sherpa = null;
  let extractor = null;
  let manager = null;
  let isModelLoaded = false;
  let ownerProfile = null;
  let isCalibrating = false;
  let lastOwnerRecognitionAt = 0;
  let lastOwnerSimilarity = 0;

  const DEFAULT_THRESHOLD = 0.45;
  const SAMPLE_RATE = 16000;

  // Resolução de caminhos
  function getModelPath() {
    try {
      const path = require('path');
      const fs = require('fs');
      const candidates = [
        path.join(__dirname, '..', '..', 'models', 'campplus.onnx'),
        path.join(__dirname, '..', 'models', 'campplus.onnx'),
        path.join(process.cwd(), 'models', 'campplus.onnx'),
        'C:\\Stack-Chan\\desktop-pet\\models\\campplus.onnx'
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    return 'C:\\Stack-Chan\\desktop-pet\\models\\campplus.onnx';
  }

  function getVoiceprintPath() {
    try {
      const path = require('path');
      const candidates = [
        path.join(__dirname, '..', '..', 'BitBop-Cerebro', '00_Nucleo', 'Voiceprint_Dono.json'),
        path.join(process.cwd(), 'BitBop-Cerebro', '00_Nucleo', 'Voiceprint_Dono.json'),
        'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro\\00_Nucleo\\Voiceprint_Dono.json'
      ];
      for (const p of candidates) {
        const dir = path.dirname(p);
        const fs = require('fs');
        if (fs.existsSync(dir)) return p;
      }
    } catch {}
    return 'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro\\00_Nucleo\\Voiceprint_Dono.json';
  }

  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom ? dot / denom : 0;
  }

  function loadOwnerProfileFromDisk() {
    try {
      const fs = require('fs');
      const p = getVoiceprintPath();
      let raw = null;
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf8');
      } else {
        const backupPath = 'C:\\Stack-Chan\\desktop-pet\\models\\Voiceprint_Dono.json';
        if (fs.existsSync(backupPath)) {
          raw = fs.readFileSync(backupPath, 'utf8');
          try { fs.writeFileSync(p, raw, 'utf8'); } catch {}
        }
      }
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.embedding)) {
          ownerProfile = {
            user: data.user || 'Álvaro',
            embedding: new Float32Array(data.embedding),
            exemplars: [new Float32Array(data.embedding)],
            enrolledAt: data.enrolledAt || new Date().toISOString(),
            threshold: (Number(data.threshold) && Number(data.threshold) <= 0.52) ? Number(data.threshold) : DEFAULT_THRESHOLD
          };

          if (manager && extractor) {
            try {
              if (manager.contains('dono')) manager.remove('dono');
              manager.add({ name: 'dono', v: ownerProfile.embedding });
            } catch (err) {
              console.warn('[VOICE-BIOMETRICS] Erro ao registrar perfil no manager:', err.message);
            }
          }
          console.log(`[VOICE-BIOMETRICS] Perfil do Dono carregado (${ownerProfile.user}, ${ownerProfile.embedding.length} dims).`);
          updateUi();
          return true;
        }
      }
    } catch (e) {
      console.warn('[VOICE-BIOMETRICS] Falha ao ler Voiceprint_Dono.json:', e.message);
    }
    ownerProfile = null;
    updateUi();
    return false;
  }

  function init() {
    try {
      if (typeof require !== 'function') {
        console.warn('[VOICE-BIOMETRICS] Ambiente sem suporte a require Node.js.');
        return false;
      }

      sherpa = require('sherpa-onnx-node');
      const modelPath = getModelPath();
      const fs = require('fs');

      if (!fs.existsSync(modelPath)) {
        console.warn(`[VOICE-BIOMETRICS] Modelo não encontrado em: ${modelPath}`);
        return false;
      }

      const t0 = performance.now();
      extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: modelPath,
        numThreads: 2,
        debug: false,
        provider: 'cpu'
      });

      manager = new sherpa.SpeakerEmbeddingManager(extractor.dim);
      isModelLoaded = true;
      console.log(`[VOICE-BIOMETRICS] CAM++ inicializado em ${Math.round(performance.now() - t0)}ms (Dim: ${extractor.dim}).`);

      loadOwnerProfileFromDisk();
      return true;
    } catch (err) {
      console.error('[VOICE-BIOMETRICS] Erro ao carregar motor biométrico:', err.message || err);
      return false;
    }
  }

  function computeEmbedding(samples16k) {
    if (!extractor || !samples16k || samples16k.length < 4000) return null;
    try {
      // Cria cópia segura alocada na heap do Node/V8 para evitar erro "External buffers are not allowed"
      const cleanSamples = new Float32Array(samples16k.length);
      cleanSamples.set(samples16k);

      const stream = extractor.createStream();
      stream.acceptWaveform({ samples: cleanSamples, sampleRate: SAMPLE_RATE });
      stream.inputFinished();
      if (extractor.isReady(stream)) {
        // enableExternalBuffer = false é mandatório no Electron para alocar na heap interna do JS
        return extractor.compute(stream, false);
      }
    } catch (err) {
      console.error('[VOICE-BIOMETRICS] Erro computando embedding:', err.message);
    }
    return null;
  }

  /**
   * Verifica um trecho de áudio em relação ao dono cadastrado (executa em ~30ms)
   */
  async function verifySamples(samples16k) {
    if (!isModelLoaded || !ownerProfile || !ownerProfile.embedding) {
      return {
        enrolled: false,
        isOwner: true,
        similarity: 1.0,
        threshold: DEFAULT_THRESHOLD,
        speaker: 'DONO',
        reason: 'uncalibrated'
      };
    }

    const t0 = performance.now();
    const emb = computeEmbedding(samples16k);
    if (!emb) {
      return {
        enrolled: true,
        isOwner: true,
        similarity: 0.70,
        threshold: ownerProfile.threshold,
        speaker: 'DONO',
        reason: 'short_audio'
      };
    }

    const durationSec = samples16k.length / SAMPLE_RATE;

    // Similaridade multi-vetorial (compara com âncora e exemplares recentes de alta confiança)
    let sim = cosineSimilarity(emb, ownerProfile.embedding);
    if (Array.isArray(ownerProfile.exemplars)) {
      for (const ex of ownerProfile.exemplars) {
        const s = cosineSimilarity(emb, ex);
        if (s > sim) sim = s;
      }
    }

    // Corte dinâmico baseado na duração da fala (frases curtas têm naturalmente menor corte em ambiente aberto)
    let threshold = ownerProfile.threshold || DEFAULT_THRESHOLD;
    if (durationSec < 1.4) {
      threshold = Math.min(threshold, 0.34);
    } else if (durationSec < 2.2) {
      threshold = Math.min(threshold, 0.40);
    }

    let isOwner = sim >= threshold;

    // Regra de Continuidade Biométrica (Context Window de 35s):
    const now = Date.now();
    const timeSinceLastOwner = now - lastOwnerRecognitionAt;
    const inRecentOwnerWindow = (timeSinceLastOwner < 35000) && (lastOwnerSimilarity >= 0.45);

    if (!isOwner && inRecentOwnerWindow && sim >= 0.28) {
      isOwner = true;
      console.log(`[VOICE-BIOMETRICS] Continuidade vocal aplicada (fala anterior do dono há ${Math.round(timeSinceLastOwner/1000)}s | sim=${sim.toFixed(4)} >= 0.28).`);
    }

    if (isOwner) {
      lastOwnerRecognitionAt = now;
      lastOwnerSimilarity = sim;
      // Adaptação online: armazena nova fala de alta confiança (>= 0.58) como exemplar adicional
      if (sim >= 0.58 && durationSec >= 1.2 && Array.isArray(ownerProfile.exemplars)) {
        if (ownerProfile.exemplars.length >= 6) {
          ownerProfile.exemplars.splice(1, 1);
        }
        ownerProfile.exemplars.push(emb);
      }
    }

    const elapsed = Math.round(performance.now() - t0);
    console.log(`[VOICE-BIOMETRICS] (${elapsed}ms) Locutor: ${isOwner ? 'DONO' : 'OUTRO'} | Similaridade: ${sim.toFixed(4)} (Corte: ${threshold})`);

    return {
      enrolled: true,
      isOwner,
      similarity: Number(sim.toFixed(4)),
      threshold,
      speaker: isOwner ? 'DONO' : 'OUTRO',
      elapsedMs: elapsed
    };
  }

  /**
   * Inicia o fluxo interativo de calibração
   */
  async function startCalibration() {
    const s = getAppState();
    const win = getAppWindow();

    // Garante que não capture o áudio da própria fala do BitBop durante a instrução!
    s.isCalibratingVoice = false;
    isCalibrating = false;
    if (win.state) win.state.isCalibratingVoice = false;
    if (win.state) win.state.isCalibratingVoice = false;

    safeSetEmotion('HAPPY', 4000);
    safeCuteSynth('excited');

    const phrase = 'Iniciando calibração vocal! Assim que eu terminar de falar, diga uma frase natural de 4 a 6 segundos, por exemplo: "BitBop, esta é a minha voz oficial". Pode se preparar!';
    safeShowBubble('🎙️ Calibração Vocal', phrase, 7000, false, true);
    await safeSpeakText(phrase, 'HAPPY', true);

    // Intervalo de segurança para dissipar eco das caixas/fones
    await new Promise(r => setTimeout(r, 450));
    if (win && typeof win.clearPreRoll === 'function') {
      win.clearPreRoll();
    }

    // Agora sim ativa a escuta biométrica!
    s.isCalibratingVoice = true;
    isCalibrating = true;
    if (win.state) win.state.isCalibratingVoice = true;

    safeSetEmotion('LISTENING', 12000);
    safeCuteSynth('curious');

    const goPhrase = 'Pode falar agora! Estou ouvindo você...';
    safeShowBubble('🎙️ Gravando Voz...', goPhrase, 9000, false, true);
  }

  /**
   * Grava a voz do dono a partir do áudio capturado
   */
  async function enrollOwner(samples16k, userName = 'Álvaro') {
    const s = getAppState();
    const win = getAppWindow();

    if (!extractor) {
      init();
    }

    if (!extractor) {
      s.isCalibratingVoice = false;
      isCalibrating = false;
      if (win.state) win.state.isCalibratingVoice = false;
      const err = 'Motor biométrico CAM++ não disponível.';
      safeShowBubble('Erro', err, 4000);
      return { ok: false, error: err };
    }

    const durationSec = (samples16k.length / SAMPLE_RATE);

    // Oculta imediatamente a badge "Processando..." para nunca travar a UI
    if (typeof globalThis.hideActionBadge === 'function') globalThis.hideActionBadge();
    if (win && typeof win.hideActionBadge === 'function') win.hideActionBadge();

    // Se a fala foi muito curta (< 1.5s), NÃO cancela a calibração! Pede para continuar falando.
    if (durationSec < 1.5) {
      console.log(`[VOICE-BIOMETRICS] Amostra capturada curta (${durationSec.toFixed(1)}s). Mantendo calibração ativa para frase completa...`);
      safeSetEmotion('CURIOUS', 4000);
      safeCuteSynth('thinking');
      if (globalThis.showBubble) {
        globalThis.showBubble('🎙️ Fale mais um pouco...', `Áudio de ${durationSec.toFixed(1)}s foi rápido. Fale uma frase de 3 a 5 segundos para eu analisar seu timbre...`, 5000, false, true);
      }
      return { ok: false, error: 'audio_too_short', retry: true };
    }

    // Fala válida (>= 1.5s): desativa modo calibração e extrai a assinatura
    s.isCalibratingVoice = false;
    isCalibrating = false;
    if (win.state) win.state.isCalibratingVoice = false;

    const emb = computeEmbedding(samples16k);
    if (!emb) {
      const err = 'Não foi possível extrair a assinatura da voz. Tente falar um pouco mais alto ou perto do microfone.';
      safeSetEmotion('SAD', 4500);
      safeCuteSynth('purr');
      if (globalThis.showBubble) globalThis.showBubble('🎙️ Ajuste de Microfone', err, 5000, false, true);
      return { ok: false, error: err };
    }

    const record = {
      version: '1.0',
      user: userName,
      model: 'CAM++ 16k (sherpa-onnx)',
      enrolledAt: new Date().toISOString(),
      durationSeconds: Number(durationSec.toFixed(2)),
      threshold: DEFAULT_THRESHOLD,
      embeddingDim: emb.length,
      embedding: Array.from(emb)
    };

    try {
      const fs = require('fs');
      const p = getVoiceprintPath();
      fs.writeFileSync(p, JSON.stringify(record, null, 2), 'utf8');

      // Backup automático em models/Voiceprint_Dono.json
      try {
        const backupPath = 'C:\\Stack-Chan\\desktop-pet\\models\\Voiceprint_Dono.json';
        fs.writeFileSync(backupPath, JSON.stringify(record, null, 2), 'utf8');
      } catch {}

      ownerProfile = {
        user: userName,
        embedding: emb,
        exemplars: [emb],
        enrolledAt: record.enrolledAt,
        threshold: DEFAULT_THRESHOLD
      };

      if (manager) {
        if (manager.contains('dono')) manager.remove('dono');
        manager.add({ name: 'dono', v: emb });
      }

      console.log(`[VOICE-BIOMETRICS] Dono "${userName}" cadastrado com sucesso em ${p}!`);
      updateUi();

      safeSetEmotion('LOVE', 4000);
      safeCuteSynth('happy');

      const successMsg = `Prontinho, Álvaro! Sua assinatura de voz foi gravada com sucesso. A partir de agora reconheço o seu timbre e sei exatamente quando é você falando!`;
      safeShowBubble('✅ Voz Cadastrada!', successMsg, 6000, false, true);
      await safeSpeakText(successMsg, 'HAPPY', true);

      return { ok: true, path: p, user: userName };
    } catch (err) {
      console.error('[VOICE-BIOMETRICS] Erro salvando voiceprint:', err);
      return { ok: false, error: err.message };
    }
  }

  function resetBiometrics() {
    try {
      const fs = require('fs');
      const p = getVoiceprintPath();
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
      ownerProfile = null;
      if (manager && manager.contains('dono')) {
        manager.remove('dono');
      }
      console.log('[VOICE-BIOMETRICS] Biometria resetada. Robô em modo aberto.');
      updateUi();
      if (globalThis.CuteSynth && typeof globalThis.CuteSynth.purr === 'function') {
        globalThis.CuteSynth.purr();
      }
      if (globalThis.showBubble) {
        globalThis.showBubble('Biometria Resetada', 'Assinatura vocal removida. Qualquer pessoa pode interagir.', 3500);
      }
      return true;
    } catch (e) {
      console.warn('[VOICE-BIOMETRICS] Erro ao resetar:', e.message);
      return false;
    }
  }

  function updateUi() {
    try {
      const badge = document.getElementById('badgeBiometrics');
      const btnCalibrate = document.getElementById('btnCalibrateVoice');
      const btnReset = document.getElementById('btnResetBiometrics');

      if (badge) {
        if (ownerProfile && ownerProfile.embedding) {
          badge.textContent = `● Voz Cadastrada (${ownerProfile.user})`;
          badge.style.color = '#34d399';
        } else {
          badge.textContent = '○ Não Calibrada (Aberto)';
          badge.style.color = '#fbbf24';
        }
      }

      if (btnReset) {
        btnReset.style.display = ownerProfile ? 'inline-block' : 'none';
      }
    } catch {}
  }

  // Auto-inicialização na carga
  try {
    init();
  } catch {}

  return {
    init,
    isReady: () => isModelLoaded,
    isEnrolled: () => Boolean(ownerProfile && ownerProfile.embedding),
    isCalibrating: () => isCalibrating,
    getOwnerProfile: () => ownerProfile,
    verifySamples,
    startCalibration,
    enrollOwner,
    resetBiometrics,
    updateUi,
    cosineSimilarity
  };
});
