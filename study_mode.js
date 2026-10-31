/**
 * ============================================================================
 * MÓDULO: PERFIL DE ESTUDO FOCADO & MULTIMODAL (StudyModeModule)
 * ============================================================================
 * - Ativável por comando de voz, botão na interface (📚 / Configurações) ou atalho (Alt+S).
 * - Pausa falas espontâneas, piadas, passeios aleatórios e animações distraídas em background.
 * - Mantém o BitBop em estado visual calmo/focado.
 * - Aplica o System Prompt rígido [MODO ESTUDO ATIVO] e ativa captura multimodal da tela.
 */
(function () {
  'use strict';

  const STUDY_MODE_SYSTEM_PROMPT = `[MODO ESTUDO ATIVO]
Você é um assistente acadêmico e técnico direto ao ponto. Siga estas regras absolutas:
1. NÃO SEJA FALASTRÃO: Zero saudações, zero introduções ("Claro!", "Vamos ver isso", "Ótima dúvida") e zero enrolação. Comece a resposta diretamente no conteúdo técnico ou na resposta.
2. PROIBIDO FAZER PERGUNTAS: NUNCA faça perguntas ao usuário no final ou no meio da resposta (são proibidas frases como "Ficou claro?", "Quer um exemplo?", "Posso ajudar em algo mais?"). Apenas entregue a explicação e encerre.
3. EXPLICAÇÃO CONTEXTUAL DA TELA: Ao receber uma imagem da tela junto com a voz/texto do usuário, analise diretamente o que está visível (código, diagrama, PDF, slide, questão de prova ou texto acadêmico). Se o usuário fizer uma pergunta, responda com base na tela. Se o usuário apenas pedir para explicar ou resolver a tela, resuma os conceitos-chave em tópicos diretos ou resolva a questão mostrada passo a passo sem rodeios.
4. CONCISÃO: Em dúvidas rápidas de voz, responda em 2 a 3 frases diretas. Em explicações de conteúdo denso na tela, use bullet points técnicos e enxutos.
5. RESUMO DE TELA NO GOOGLE KEEP E OBSIDIAN: Se o usuário pedir para salvar um resumo, guardar notas ou anotar o que está na tela (ex: "Salva um resumo dessa tela", "Anota no Keep e no meu cérebro o que tá aqui"), analise os conceitos da tela, extraia tópicos diretos em bullet points e acione a ferramenta "criar_nota_keep" com título conciso (ex: "Resumo: [Assunto da Tela]"), conteúdo formatado e speech_response objetiva (ex: "Resumo da tela salvo no Keep e Obsidian: [Assunto]."). O sistema espelha automaticamente uma cópia em 05_Estudo/ no Obsidian com agendamento de revisão espaçada SM-2.`;

  let ctx = null;
  let active = false;
  let savedPrefsSnapshot = null;

  function emitChange() {
    try {
      window.dispatchEvent(
        new CustomEvent('study-mode:change', { detail: { active } })
      );
    } catch {}
  }

  function enable(opts = {}) {
    if (!ctx) return false;
    if (active) return true;

    // Se o modo de dança silenciosa estiver ativo, desativa primeiro para restaurar microfone/estado base
    if (window.SilentRoamDance && typeof window.SilentRoamDance.isActive === 'function' && window.SilentRoamDance.isActive()) {
      window.SilentRoamDance.disable();
    }

    const { state, prefs, chkRoam, chkProximityChat, chkAutoCurious } = ctx;

    savedPrefsSnapshot = {
      roamEnabled: prefs.roamEnabled,
      proximityChat: prefs.proximityChat,
      autoCurious: prefs.autoCurious,
    };

    active = true;
    state.studyMode = true;
    prefs.studyMode = true;

    // Desativa comportamentos e animações distraídas em background
    prefs.roamEnabled = false;
    prefs.proximityChat = false;
    prefs.autoCurious = false;

    if (chkRoam) chkRoam.checked = false;
    if (chkProximityChat) chkProximityChat.checked = false;
    if (chkAutoCurious) chkAutoCurious.checked = false;

    // Garante que o microfone esteja ativo para ouvir dúvidas e comandos no modo estudo
    if (!prefs.micEnabled) {
      prefs.micEnabled = true;
      if (typeof ctx.updateMicVisuals === 'function') ctx.updateMicVisuals();
    }

    // Coloca o BitBop em postura calma e focada
    state.trick = null;
    state.commandedWalk = null;
    state.walkTargetX = null;
    state.followMouseUntil = 0;
    state.vx = 0;
    state.aiAction = 'SIT';

    if (typeof ctx.setEmotion === 'function') {
      ctx.setEmotion('NORMAL', 0);
    }

    if (typeof ctx.rebuildSystemPrompt === 'function') {
      ctx.rebuildSystemPrompt();
    }

    if (typeof ctx.saveAiConfigToDisk === 'function') {
      ctx.saveAiConfigToDisk();
    }

    if (!opts.silent) {
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('📚', 0, 8);
      if (typeof ctx.showBubble === 'function') {
        ctx.showBubble(
          'Modo Estudo Ativo 📚',
          'Foco total ativado. Sem distrações e com leitura multimodal da tela.',
          4000,
          true,
          true
        );
      }
    }

    console.log('[StudyMode] ATIVADO — Postura focada, zero distrações e System Prompt acadêmico em vigor.');
    emitChange();
    return true;
  }

  function disable(opts = {}) {
    if (!ctx) return false;
    if (!active) return true;

    const { state, prefs, chkRoam, chkProximityChat, chkAutoCurious } = ctx;

    active = false;
    state.studyMode = false;
    prefs.studyMode = false;

    if (savedPrefsSnapshot) {
      prefs.roamEnabled = savedPrefsSnapshot.roamEnabled;
      prefs.proximityChat = savedPrefsSnapshot.proximityChat;
      prefs.autoCurious = savedPrefsSnapshot.autoCurious;
      savedPrefsSnapshot = null;
    } else {
      prefs.roamEnabled = localStorage.getItem('sc_roam') !== 'false';
      prefs.proximityChat = localStorage.getItem('sc_proximity_chat') !== 'false';
      prefs.autoCurious = localStorage.getItem('sc_curious') !== 'false';
    }

    if (chkRoam) chkRoam.checked = prefs.roamEnabled;
    if (chkProximityChat) chkProximityChat.checked = prefs.proximityChat;
    if (chkAutoCurious) chkAutoCurious.checked = prefs.autoCurious;

    state.aiAction = 'IDLE';
    state.walkTargetX = null;
    state.nextAiDecisionAt = 0;
    if (typeof ctx.setEmotion === 'function') {
      ctx.setEmotion('HAPPY', 3500);
    }

    if (typeof ctx.rebuildSystemPrompt === 'function') {
      ctx.rebuildSystemPrompt();
    }

    if (typeof ctx.saveAiConfigToDisk === 'function') {
      ctx.saveAiConfigToDisk();
    }

    if (!opts.silent) {
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('✨', 0, 8);
      if (typeof ctx.showBubble === 'function') {
        ctx.showBubble(
          'Modo Estudo Desativado',
          'Voltando ao modo companheiro normal!',
          3800,
          false,
          true
        );
      }
    }

    console.log('[StudyMode] DESATIVADO — Comportamento companheiro padrão restaurado.');
    emitChange();
    return true;
  }

  function toggle(opts = {}) {
    return active ? disable(opts) : enable(opts);
  }

  const StudyModeModule = {
    STUDY_MODE_SYSTEM_PROMPT,
    init(petContext) {
      ctx = petContext;
      if (ctx && ctx.prefs && ctx.prefs.studyMode) {
        enable({ silent: true });
      }
      console.log('[StudyMode] Módulo conectado (Atalho: Alt+S | Botão: 📚 | Voz: "Ativar modo estudo").');
    },
    enable,
    disable,
    toggle,
    isActive() {
      return active;
    },
    getSystemPrompt() {
      return STUDY_MODE_SYSTEM_PROMPT;
    },
    saveStudySummary(data) {
      if (typeof window !== 'undefined' && window.MemoryStore && typeof window.MemoryStore.saveStudySummary === 'function') {
        return window.MemoryStore.saveStudySummary(data);
      }
      return { ok: false, error: 'MemoryStore indisponível' };
    },
  };

  window.StudyModeModule = StudyModeModule;
})();
