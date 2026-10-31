/**
 * context_detector.js — BitBop Desktop AI Companion
 * Detector de Contexto & Modo Adaptativo com Histerese (Seção 4 de SPEC_PERSONALIDADE_ADAPTATIVA.md)
 *
 * Responsabilidades:
 * 1. Monitora em segundo plano state.desktop (activeApp, activeTitle), horário e estado emocional.
 * 2. Aplica MODULAÇÕES CONTEXTUAIS imediatas em 0ms (silêncio em código, provocação cravada em 0 se frustrado).
 * 3. Aplica HISTERESE de ~3 minutos (180.000 ms) para troca da faceta dominante no modo "adaptativo".
 * 4. No modo manual/fixo, NUNCA troca a persona-base automaticamente.
 * 5. Gerencia e atualiza dinamicamente a badge #badgePersonality (AUTO: MENTOR DEV, AUTO: GAMER, ESTUDO ATIVO, PRIVADO).
 * 6. Congela adaptações quando state.studyMode === true.
 *
 * Padrão: IIFE Universal (Browser / Electron / Node CommonJS)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(global);
  } else {
    root.ContextDetector = factory(root);
  }
})(typeof window !== 'undefined' ? window : global, function (global) {
  'use strict';

  // Histerese padrão: 3 minutos (180.000 ms) para transição de faceta dominante
  const DEFAULT_HYSTERESIS_MS = 180 * 1000;

  // Regexes de detecção de contexto
  const DEV_APP_RX = /(?:code(?:\.exe)?|cursor(?:\.exe)?|antigravity|devenv(?:\.exe)?|visual\s*studio|github|docker|postman|vscode|intellij|pycharm|webstorm|sublime|neovim|vim|git)/i;
  const DEV_TITLE_RX = /\b(?:vscode|\.tsx?|\.jsx?|\.py|\.rs|\.go|\.cpp|\.c|\.cs|\.html|\.css|\.json|\.md|\.sql|git|pull\s*request|commit|branch|repository)\b/i;
  
  const TERMINAL_APP_RX = /(?:powershell|cmd(?:\.exe)?|terminal|bash|wsl|ubuntu|zsh|putty|ssh|mintty|hyper|alacritty|wezterm|conhost)/i;
  
  const GAMER_APP_RX = /(?:arena\s*breakout|steam(?:\.exe)?|epic\s*games|riot|valorant|cs2|csgo|minecraft|retroarch|discord(?:\.exe)?|league\s*of\s*legends|gta|cyberpunk2077|overwatch)/i;
  
  const CASUAL_APP_RX = /(?:spotify|youtube|netflix|twitch|chrome|edge|firefox|vlc|music)/i;

  // Mapeamento de badges curtas por faceta
  const FACET_BADGES = {
    engenharia_software: 'MENTOR DEV',
    padrao: 'FOFO',
    gamer: 'GAMER',
    cyberpunk: 'CYBERPUNK',
    custom: 'PERSONALIZADA'
  };

  // Estado interno em RAM (0ms)
  let currentFacet = 'engenharia_software';
  let pendingFacet = null;
  let pendingSince = 0;
  let hysteresisMs = DEFAULT_HYSTERESIS_MS;
  let activeContextName = 'casual';
  let contextModulations = {};
  let isUserFrustrated = false;
  let lastEvaluationTime = 0;
  let heartbeatTimer = null;

  /**
   * Verifica se o Perfil de Estudo (Study Mode) está ativo
   */
  function isStudyModeActive(stateObj, prefsObj) {
    const s = stateObj || global.state || {};
    const p = prefsObj || global.prefs || {};
    if (Boolean(s.studyMode) || Boolean(p.studyMode)) return true;
    if (global.StudyModeModule && typeof global.StudyModeModule.isActive === 'function') {
      return Boolean(global.StudyModeModule.isActive());
    }
    return false;
  }

  /**
   * Verifica se o Modo Privado ou Janela Sensível está ativa
   */
  function isPrivateModeActive(stateObj) {
    const s = stateObj || global.state || {};
    return Boolean(s.privateMode || s.isSensitiveWindow);
  }

  /**
   * Classifica o contexto atual com base nas variáveis do sistema
   */
  function detectContext(stateObj, prefsObj, nowTimestamp) {
    const s = stateObj || global.state || {};
    const d = s.desktop || {};
    const activeApp = String(d.activeApp || '');
    const activeTitle = String(d.activeTitle || '');
    const now = typeof nowTimestamp === 'number' ? nowTimestamp : Date.now();
    const currentHour = new Date(now).getHours();
    const isNight = currentHour >= 23 || currentHour < 5;

    // 1. Detecção de Frustração do Usuário
    const frustrated = Boolean(
      s.emotion === 'ANGRY' ||
      s.frustrationDetected ||
      (s.userFrustratedUntil && now < s.userFrustratedUntil)
    );

    if (frustrated) {
      return {
        contextName: 'usuario_frustrado',
        candidateFacet: 'padrao', // Apoio acolhedor e resolutivo
        modulations: {
          provocacao: -0.70, // Cravado em 0
          empatia: +0.30,
          energia: -0.10
        },
        isFrustrated: true,
        reason: 'Sinais de frustração detectados — zoeira desligada e empatia máxima'
      };
    }

    // 2. Detecção de Desenvolvimento / Engenharia de Software
    const isDev = DEV_APP_RX.test(activeApp) || DEV_APP_RX.test(activeTitle) || DEV_TITLE_RX.test(activeTitle);
    if (isDev) {
      return {
        contextName: 'desenvolvimento',
        candidateFacet: 'engenharia_software',
        modulations: {
          proatividade: -0.25, // Respeita tempo de foco e silêncio
          verbosidade: -0.15,  // Respostas analíticas e diretas
          tecnicidade: +0.10
        },
        isFrustrated: false,
        reason: `Ambiente de desenvolvimento ativo: ${activeApp || activeTitle || 'IDE'}`
      };
    }

    // 3. Detecção de Terminal / Hacker na Madrugada (23h–05h)
    const isTerminal = TERMINAL_APP_RX.test(activeApp) || TERMINAL_APP_RX.test(activeTitle);
    if (isNight && isTerminal) {
      return {
        contextName: 'terminal_madrugada',
        candidateFacet: 'cyberpunk',
        modulations: {
          tecnicidade: +0.20,
          formalidade: -0.10,
          energia: +0.10
        },
        isFrustrated: false,
        reason: 'Madrugada com terminal ativo: vibe cyberpunk hacker'
      };
    }

    // 4. Detecção de Jogos / Discord em Call
    const isGaming = GAMER_APP_RX.test(activeApp) || GAMER_APP_RX.test(activeTitle);
    if (isGaming) {
      return {
        contextName: 'jogos',
        candidateFacet: 'gamer',
        modulations: {
          energia: +0.20,
          humor: +0.15,
          provocacao: +0.10
        },
        isFrustrated: false,
        reason: `Sessão de jogos ou Discord em foco: ${activeApp || activeTitle || 'Game'}`
      };
    }

    // 5. Madrugada Casual / Cansaço
    if (isNight) {
      return {
        contextName: 'madrugada_cansaco',
        candidateFacet: 'padrao',
        modulations: {
          energia: -0.20,
          formalidade: -0.10,
          verbosidade: -0.10
        },
        isFrustrated: false,
        reason: 'Madrugada calma: energia baixa e tom suave'
      };
    }

    // 6. Casual / Desktop Livre / Navegação / Música (Default)
    return {
      contextName: 'casual',
      candidateFacet: 'padrao',
      modulations: {
        empatia: +0.15,
        humor: +0.10
      },
      isFrustrated: false,
      reason: 'Área de trabalho livre ou navegação casual'
    };
  }

  /**
   * Avalia o contexto e executa as regras de Histerese e Modulação em 0ms
   */
  function evaluateContext(stateObj, prefsObj, nowTimestamp) {
    const s = stateObj || global.state || {};
    const p = prefsObj || global.prefs || {};
    const now = typeof nowTimestamp === 'number' ? nowTimestamp : Date.now();
    lastEvaluationTime = now;

    const detected = detectContext(s, p, now);
    activeContextName = detected.contextName;
    contextModulations = detected.modulations;
    isUserFrustrated = detected.isFrustrated;

    // Regra 1: Se o Modo Estudo estiver ativo, congela qualquer transição de personalidade
    if (isStudyModeActive(s, p)) {
      updateBadge();
      return {
        frozen: true,
        reason: 'study_mode_active',
        currentFacet,
        activeContextName,
        contextModulations: {}
      };
    }

    const currentModePref = p.personality || 'engenharia_software';

    // Regra 2: Modo Manual Fixo — A persona-base NUNCA troca sozinha!
    if (currentModePref !== 'adaptativo') {
      currentFacet = currentModePref;
      pendingFacet = null;
      pendingSince = 0;
      updateBadge();
      return {
        mode: 'fixed',
        currentFacet,
        activeContextName,
        contextModulations, // Modulações temporárias em 0ms ainda auxiliam dentro de ±0.25
        hysterisisActive: false
      };
    }

    // Regra 3: Modo Adaptativo — Histerese de ~3 minutos para troca de faceta dominante
    const candidate = detected.candidateFacet;

    if (candidate === currentFacet) {
      // Já estamos na faceta ideal para este contexto
      pendingFacet = null;
      pendingSince = 0;
    } else {
      // Candidato difere da faceta dominante atual
      if (candidate !== pendingFacet) {
        // Primeiro instante em que o novo contexto foi detectado
        pendingFacet = candidate;
        pendingSince = now;
      } else {
        // Contexto persiste: verifica se ultrapassou a janela de histerese
        const elapsed = now - pendingSince;
        if (elapsed >= hysteresisMs) {
          // Promoção da nova faceta dominante!
          const oldFacet = currentFacet;
          currentFacet = pendingFacet;
          pendingFacet = null;
          pendingSince = 0;

          console.log(`[ContextDetector] Histerese concluída (${(elapsed / 1000).toFixed(0)}s): Faceta alterada de "${oldFacet}" para "${currentFacet}"`);
          persistActivePersona(currentFacet, detected.reason);
        }
      }
    }

    updateBadge();

    return {
      mode: 'adaptativo',
      currentFacet,
      pendingFacet,
      pendingElapsedMs: pendingSince ? (now - pendingSince) : 0,
      activeContextName,
      contextModulations,
      isFrustrated: isUserFrustrated
    };
  }

  /**
   * Força uma faceta dominante imediatamente (ex.: comando de voz "modo gamer agora")
   */
  function forceFacet(facetId, reason = 'comando_direto') {
    if (!FACET_BADGES[facetId]) return false;
    currentFacet = facetId;
    pendingFacet = null;
    pendingSince = 0;
    console.log(`[ContextDetector] Faceta forçada diretamente: "${facetId}" (${reason})`);
    persistActivePersona(facetId, reason);
    updateBadge();
    return true;
  }

  /**
   * Atualiza a badge visual #badgePersonality no DOM
   */
  function updateBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('badgePersonality');
    if (!badge) return;

    // 0. Modo Ouvinte Silencioso (Só Observar)
    const s = global.state || {};
    if (s.silentObserverMode) {
      badge.textContent = '🎧 SÓ OBSERVANDO';
      badge.style.color = '#2dd4bf';
      badge.style.background = 'rgba(45, 212, 191, 0.2)';
      badge.setAttribute('title', 'Modo Ouvinte Silencioso ativo: só observando e ouvindo sem falar (Alt+O)');
      return;
    }

    // 1. Estudo Ativo tem prioridade máxima visual
    if (isStudyModeActive()) {
      badge.textContent = 'ESTUDO ATIVO';
      badge.style.color = '#38bdf8';
      badge.style.background = 'rgba(56, 189, 248, 0.16)';
      badge.setAttribute('title', 'Perfil de Estudo ativo (Alt+S)');
      return;
    }

    // 2. Modo Privado ativo
    if (isPrivateModeActive()) {
      badge.textContent = 'PRIVADO';
      badge.style.color = '#94a3b8';
      badge.style.background = 'rgba(148, 163, 184, 0.2)';
      badge.setAttribute('title', 'Modo Privado ativo (Alt+P)');
      return;
    }

    const p = global.prefs || {};
    const isAdaptive = p.personality === 'adaptativo';
    const facetName = currentFacet || 'engenharia_software';
    const shortLabel = FACET_BADGES[facetName] || facetName.toUpperCase();

    if (isAdaptive) {
      badge.textContent = `AUTO: ${shortLabel}`;
      badge.style.color = '#c084fc';
      badge.style.background = 'rgba(168, 85, 247, 0.16)';
      badge.setAttribute('title', `Modo Adaptativo ativo (Contexto: ${activeContextName})`);
    } else {
      badge.textContent = shortLabel;
      badge.style.color = '#c084fc';
      badge.style.background = 'rgba(168, 85, 247, 0.16)';
      badge.setAttribute('title', `Persona Fixa: ${shortLabel}`);
    }
  }

  /**
   * Persiste a persona ativa em 00_Nucleo/Personalidade/Persona_Ativa.md de forma assíncrona
   */
  function persistActivePersona(facetId, reason = '') {
    const store = global.PersonalityStore;
    if (!store || typeof store.saveFile !== 'function') return;

    const p = global.prefs || {};
    const mode = p.personality === 'adaptativo' ? 'adaptativo' : 'manual';
    const today = new Date().toISOString().split('T')[0];
    const facetBadge = FACET_BADGES[facetId] || facetId;

    const content = [
      '---',
      'tipo: persona_ativa',
      `modo: ${mode}`,
      `persona_id: ${p.personality || facetId}`,
      `faceta_dominante: ${facetId}`,
      `badge: "${facetBadge}"`,
      `motivo: "${reason || 'Adaptação contextual'}"`,
      `atualizado: ${today}`,
      '---',
      '',
      '# Persona Ativa',
      '',
      `Faceta atual dominante: **${facetBadge}** (Modo ${mode}).`,
      `Contexto detectado: \`${activeContextName}\`.`
    ].join('\n');

    store.saveFile('Persona_Ativa.md', content);
  }

  /**
   * Hook disparado quando um novo estado da área de trabalho chega pelo Electron IPC
   */
  function onDesktopStateChanged(dState) {
    if (global.state) {
      global.state.desktop = dState;
    }
    evaluateContext(global.state, global.prefs, Date.now());
  }

  /**
   * Inicializa o ContextDetector
   */
  function init() {
    // Carrega faceta inicial se disponível no PersonalityStore
    if (global.PersonalityStore && typeof global.PersonalityStore.getPersonaAtiva === 'function') {
      const active = global.PersonalityStore.getPersonaAtiva();
      if (active && active.frontmatter && active.frontmatter.faceta_dominante) {
        currentFacet = active.frontmatter.faceta_dominante;
      }
    }

    // Avaliação inicial
    evaluateContext(global.state, global.prefs, Date.now());
    updateBadge();

    // Heartbeat periódico (a cada 5s) para garantir que a histerese de 3 min seja avaliada
    // mesmo se o usuário não alternar de janela
    if (!heartbeatTimer && typeof setInterval !== 'undefined') {
      heartbeatTimer = setInterval(() => {
        evaluateContext(global.state, global.prefs, Date.now());
      }, 5000);
    }
  }

  return {
    init,
    detectContext,
    evaluateContext,
    forceFacet,
    updateBadge,
    onDesktopStateChanged,
    getCurrentFacet: () => currentFacet,
    getCurrentModulations: () => ({ ...contextModulations }),
    getActiveContextName: () => activeContextName,
    isFrustrated: () => isUserFrustrated,
    getPendingFacet: () => pendingFacet,
    getHysteresisStatus: (nowTimestamp) => {
      const now = typeof nowTimestamp === 'number' ? nowTimestamp : Date.now();
      const elapsed = pendingSince ? Math.max(0, now - pendingSince) : 0;
      return {
        currentFacet,
        pendingFacet,
        elapsedMs: elapsed,
        requiredMs: hysteresisMs,
        remainingMs: pendingFacet ? Math.max(0, hysteresisMs - elapsed) : 0
      };
    },
    setHysteresisMs: (ms) => {
      hysteresisMs = Math.max(0, Number(ms) || DEFAULT_HYSTERESIS_MS);
    },
    resetHysteresis: () => {
      pendingFacet = null;
      pendingSince = 0;
    }
  };
});
