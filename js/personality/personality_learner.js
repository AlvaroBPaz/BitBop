/**
 * personality_learner.js — BitBop Desktop AI Companion
 * Aprendizado Seguro de Traços & Motor de Humor (Seção 5 de SPEC_PERSONALIDADE_ADAPTATIVA.md)
 *
 * Responsabilidades:
 * 1. REGRA MANDATÓRIA: Processa APENAS áudios legítimos do usuário (audioSource === 'usuario_voz')
 *    ou interação física direta. Áudios de mídia (YouTube, Netflix, etc.) e leituras de tela são 100% ignorados.
 * 2. SINAIS EXPLÍCITOS ("fala menos", "mais curto", "sem zoeira", etc.):
 *    Aplica ajuste imediato no PersonalityEngine (até ±0.15) e registra no Historico_Adaptacao.md.
 * 3. REGRAS PROCEDURAIS: Grava notas em 04_Procedimentos/ (ex.: silêncio no código).
 * 4. SINAIS IMPLÍCITOS: Monitora barge-ins frequentes e gera propostas de confirmação em 08_Inbox/.
 * 5. MOTOR DE HUMOR: Gerencia valência e energia [-1, 1] com decaimento suave e sincronização
 *    com 00_Nucleo/Personalidade/Humor.md e 00_Nucleo/Estado_Atual.md.
 * 6. PAUSA DE SEGURANÇA: Congela totalmente quando state.studyMode === true.
 *
 * Padrão: IIFE Universal (Browser / Electron / Node CommonJS)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(global);
  } else {
    root.PersonalityLearner = factory(root);
  }
})(typeof window !== 'undefined' ? window : global, function (global) {
  'use strict';

  // Regexes para Detecção de Sinais Explícitos do Usuário
  const RX_SHORTER = /(?:fala(?:r)?\s*(?:menos|mais\s*curto|mais\s*direto|pouco|mais\s*breve)|seja\s*(?:mais\s*)?direto|menos\s*papo|fale\s*(?:menos|mais\s*curto)|respostas?\s*(?:mais\s*)?curtas?)/i;
  const RX_LONGER = /(?:fala(?:r)?\s*(?:mais|bastante|mais\s*longo)|explica\s*(?:melhor|com\s*mais\s*detalhes)|seja\s*(?:mais\s*)?detalhado|respostas?\s*(?:mais\s*)?longas?)/i;
  const RX_MORE_HUMOR = /(?:pode\s*ser\s*|seja\s*|fique\s*)?mais\s*(?:engra[çc]ado|divertido|bem[- ]humorado)|conta\s*(?:mais\s*)?piadas?/i;
  const RX_NO_TEASING = /(?:sem\s*zoeira|para\s*de\s*zoar|chega\s*de\s*piada|sem\s*brincadeira|n[ãa]o\s*fica\s*zoando)/i;
  const RX_SILENCE_DEV = /(?:para(?:r)?\s*de\s*comentar\s*(?:enquanto|quando)\s*eu\s*(?:codo|programo)|sil[êe]ncio\s*(?:no\s*c[óo]digo|enquanto\s*eu\s*(?:programo|codo))|n[ãa]o\s*comente\s*(?:no\s*c[óo]digo|quando\s*eu\s*estiver\s*programando))/i;
  const RX_PRAISE_HUMOR = /(?:gostei\s*d(?:isso|essa)|boa\s*piada|muito\s*bo[am]|haha(?:ha)?|kkk(?:k)?)/i;

  // Estado interno do Motor de Humor
  let humorState = {
    valence: 0.5, // [-1.0, 1.0] (-1: muito triste/chateado, 1: radiante/feliz)
    energy: 0.7,  // [-1.0, 1.0] (-1: sonolento/exausto, 1: hiperativo)
    lastUpdated: Date.now(),
    lastDecayAt: Date.now(),
    reason: 'Inicializado pronto para interagir'
  };

  // Histórico de sinais implícitos (em RAM)
  const implicitSignals = {
    bargeIns: [], // Array de { timestamp, botTextLen, dateStr }
    dismissedBubbles: [] // Array de { timestamp, dateStr }
  };

  /**
   * Verifica se o Modo Estudo está ativo
   */
  function isStudyActive() {
    const s = global.state || {};
    const p = global.prefs || {};
    if (Boolean(s.studyMode) || Boolean(p.studyMode)) return true;
    if (global.StudyModeModule && typeof global.StudyModeModule.isActive === 'function') {
      return Boolean(global.StudyModeModule.isActive());
    }
    return false;
  }

  /**
   * Processa o turno de diálogo vindo do áudio/chat
   */
  function processTurn(turnEvent) {
    if (!turnEvent) return { ignored: true, reason: 'evento_vazio' };

    // 1. REGRA MANDATÓRIA: Pausa total se estiver em Modo Estudo
    if (isStudyActive()) {
      return { ignored: true, reason: 'modo_estudo_ativo' };
    }

    // 2. REGRA MANDATÓRIA: Apenas falas autênticas do usuário podem mudar traços
    // Textos de vídeos de YouTube/Netflix ou áudio de terceiros são estritamente bloqueados!
    if (turnEvent.audioSource !== 'usuario_voz') {
      return { ignored: true, reason: 'origem_audio_invalida' };
    }

    const text = String(turnEvent.userTranscript || '').trim();
    if (!text) return { ignored: true, reason: 'texto_vazio' };

    const engine = global.PersonalityEngine;
    const store = global.PersonalityStore;
    const memory = global.MemoryStore;

    let adjusted = false;
    const results = [];

    // --- SINAIS EXPLÍCITOS ---

    // A. "Fala menos" / "mais curto" -> Verbosidade -0.15
    if (RX_SHORTER.test(text)) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('verbosidade', -0.15, true, 'Comando explícito: usuário pediu fala mais curta', 'usuario_voz');
        results.push({ trait: 'verbosidade', delta: -0.15, res });
        adjusted = true;
      }
    }
    // B. "Fala mais" / "mais detalhado" -> Verbosidade +0.15
    else if (RX_LONGER.test(text)) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('verbosidade', 0.15, true, 'Comando explícito: usuário pediu fala mais detalhada', 'usuario_voz');
        results.push({ trait: 'verbosidade', delta: 0.15, res });
        adjusted = true;
      }
    }

    // C. "Pode ser mais engraçado" -> Humor +0.15
    if (RX_MORE_HUMOR.test(text)) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('humor', 0.15, true, 'Comando explícito: usuário pediu mais humor', 'usuario_voz');
        results.push({ trait: 'humor', delta: 0.15, res });
        adjusted = true;
      }
    }

    // D. "Sem zoeira agora" -> Provocação -0.20
    if (RX_NO_TEASING.test(text)) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('provocacao', -0.20, true, 'Comando explícito: usuário pediu sem zoeira', 'usuario_voz');
        results.push({ trait: 'provocacao', delta: -0.20, res });
        adjusted = true;
      }
    }

    // E. "Para de comentar enquanto eu codo" -> Proatividade -0.15 + Regra Procedural
    if (RX_SILENCE_DEV.test(text)) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('proatividade', -0.15, true, 'Comando explícito: silêncio durante programação', 'usuario_voz');
        results.push({ trait: 'proatividade', delta: -0.15, res });
        adjusted = true;
      }
      createSilenceInDevProcedure(memory);
    }

    // F. Reforço positivo leve (elogio ou risada após piada) -> Humor +0.03
    if (RX_PRAISE_HUMOR.test(text) && !adjusted) {
      if (engine && typeof engine.adjustTrait === 'function') {
        const res = engine.adjustTrait('humor', 0.03, false, 'Reforço positivo: risada ou elogio do usuário', 'usuario_voz');
        results.push({ trait: 'humor', delta: 0.03, res });
        adjusted = true;
      }
      // Eleva o humor do próprio BitBop
      recordHumorPraise();
    }

    // Se o usuário demonstrou raiva explícita, reflete no humor
    if (turnEvent.currentEmotion === 'ANGRY' || /estou\s*(?:bravo|irritado|chateado|com\s*raiva)/i.test(text)) {
      recordHumorFrustration();
    }

    return {
      processed: true,
      adjusted,
      results
    };
  }

  /**
   * Grava regra procedural permanente em 04_Procedimentos/ quando o usuário pede silêncio no código
   */
  function createSilenceInDevProcedure(memoryStore) {
    const mem = memoryStore || global.MemoryStore;
    if (!mem || typeof mem.writeNote !== 'function') return;

    const today = new Date().toISOString().split('T')[0];
    const fm = {
      tipo: 'procedimento',
      gatilho: 'foco em desenvolvimento / VS Code',
      criado: today,
      origem: 'comando explícito do usuário'
    };
    const body = `# Regra Procedural: Silêncio Durante Programação

Quando o usuário estiver com ambiente de desenvolvimento aberto (VS Code, Cursor, Antigravity, etc.):
- O BitBop **não deve emitir comentários proativos ou de proximidade espontâneos**.
- Falar apenas quando for chamado diretamente pelo nome (*"BitBop"*) ou acionado por atalho.
- Respostas devem ser estritamente analíticas, concisas e focadas na resolução de código.
`;

    mem.writeNote('04_Procedimentos/Regra_Silencio_Codigo.md', fm, body);
    console.log('[PersonalityLearner] Regra gravada: 04_Procedimentos/Regra_Silencio_Codigo.md');
  }

  /**
   * Registra um evento de interrupção imediata (Barge-In)
   */
  function recordBargeIn(details = {}) {
    if (isStudyActive()) return;

    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];
    const textLen = Number(details.botTextLen) || (details.botResponse ? details.botResponse.length : 0);

    // Registra barge-in se o bot estava falando algo longo (> 80 caracteres)
    if (textLen >= 80) {
      implicitSignals.bargeIns.push({
        timestamp: now,
        botTextLen: textLen,
        dateStr: todayStr
      });

      console.log(`[PersonalityLearner] Barge-in registrado em fala longa (${textLen} chars). Total acumulado: ${implicitSignals.bargeIns.length}`);
      checkBargeInThreshold();
    }
  }

  /**
   * Avalia se os barge-ins acumulados atingiram o limiar para gerar sugestão no Inbox
   */
  function checkBargeInThreshold() {
    const dates = new Set(implicitSignals.bargeIns.map(b => b.dateStr));
    
    // Limiar: pelo menos 2 dias diferentes ou mais de 3 ocorrências no total
    if (dates.size >= 2 || implicitSignals.bargeIns.length >= 4) {
      createInboxSuggestion(
        '08_Inbox/Sugestao_Verbosidade.md',
        'Sugestão de Personalidade: Verbosidade Mais Curta',
        'verbosidade',
        -0.15,
        'Percebi que você me interrompeu frequentemente quando eu falava respostas mais longas.\nQuer que eu ajuste minha personalidade para ser mais direto e conciso no dia a dia?'
      );
    }
  }

  /**
   * Cria uma proposta no Inbox (Portão de Confirmação)
   */
  function createInboxSuggestion(relPath, title, traitKey, proposedDelta, question) {
    const mem = global.MemoryStore;
    if (!mem || typeof mem.writeNote !== 'function') return;

    const today = new Date().toISOString().split('T')[0];
    const fm = {
      tipo: 'inbox_sugestao',
      traço: traitKey,
      proposta_delta: proposedDelta,
      criado: today,
      status: 'pendente'
    };
    const body = `# ${title}

${question}

### Escolha do Usuário:
- [ ] Sim, aplicar ajuste de ${proposedDelta > 0 ? '+' : ''}${proposedDelta} em ${traitKey}
- [ ] Não, manter como está
`;

    mem.writeNote(relPath, fm, body);
    console.log(`[PersonalityLearner] Portão de confirmação gerado: ${relPath}`);
  }

  // =========================================================================
  // MOTOR DE HUMOR DO BITBOP
  // =========================================================================

  /**
   * Reação a carinho na cabeça (patEnergy)
   */
  function recordCarinho() {
    if (isStudyActive()) return;

    humorState.valence = Math.min(1.0, Number((humorState.valence + 0.15).toFixed(2)));
    humorState.energy = Math.min(1.0, Number((humorState.energy + 0.10).toFixed(2)));
    humorState.lastUpdated = Date.now();
    humorState.reason = 'Recebeu carinho afetuoso na cabeça';

    syncHumorToVault();
  }

  /**
   * Reação a reforço positivo ou risadas do usuário
   */
  function recordHumorPraise() {
    if (isStudyActive()) return;

    humorState.valence = Math.min(1.0, Number((humorState.valence + 0.10).toFixed(2)));
    humorState.energy = Math.min(1.0, Number((humorState.energy + 0.05).toFixed(2)));
    humorState.lastUpdated = Date.now();
    humorState.reason = 'Usuário riu ou elogiou a interação';

    syncHumorToVault();
  }

  /**
   * Reação a frustração do usuário
   */
  function recordHumorFrustration() {
    if (isStudyActive()) return;

    humorState.valence = Math.max(-0.8, Number((humorState.valence - 0.25).toFixed(2)));
    humorState.energy = Math.max(-0.5, Number((humorState.energy - 0.10).toFixed(2)));
    humorState.lastUpdated = Date.now();
    humorState.reason = 'Usuário demonstrou frustração';

    syncHumorToVault();
  }

  /**
   * Decaimento natural do humor em direção ao baseline de repouso (valência 0.2, energia 0.5)
   */
  function decayHumor(nowTimestamp) {
    const now = typeof nowTimestamp === 'number' ? nowTimestamp : Date.now();
    const elapsedHours = (now - humorState.lastDecayAt) / (1000 * 3600);
    if (elapsedHours < 0.25) return; // Checa a cada ~15 minutos

    const BASE_VALENCE = 0.2;
    const BASE_ENERGY = 0.5;
    const decayFactor = Math.min(1.0, elapsedHours * 0.15);

    humorState.valence = Number((humorState.valence + (BASE_VALENCE - humorState.valence) * decayFactor).toFixed(2));
    humorState.energy = Number((humorState.energy + (BASE_ENERGY - humorState.energy) * decayFactor).toFixed(2));
    humorState.lastDecayAt = now;
  }

  /**
   * Retorna a emoção sugerida para o visor OLED com base no humor atual
   */
  function getSuggestedOledEmotion() {
    decayHumor(Date.now());
    const v = humorState.valence;
    const e = humorState.energy;

    if (v >= 0.5 && e >= 0.5) return 'EXCITED';
    if (v >= 0.2 && e >= 0.2) return 'HAPPY';
    if (v < -0.2) return 'SAD';
    if (e <= -0.2) return 'SLEEPY';
    return 'NORMAL';
  }

  /**
   * Sincroniza o Humor no Vault do Obsidian
   */
  function syncHumorToVault() {
    const store = global.PersonalityStore;
    if (!store || typeof store.saveFile !== 'function') return;

    const today = new Date().toISOString().split('T')[0];
    const emotion = getSuggestedOledEmotion();

    const content = [
      '---',
      'tipo: humor',
      `valencia: ${humorState.valence}`,
      `energia: ${humorState.energy}`,
      `emocao_sugerida: ${emotion}`,
      `motivo: "${humorState.reason}"`,
      `atualizado: ${today}`,
      '---',
      '',
      '# Humor do BitBop',
      '',
      'Estado emocional dinâmico de curto prazo:',
      `- Valência: ${humorState.valence} (${humorState.valence >= 0.2 ? 'Positivo' : 'Neutro/Baixo'})`,
      `- Energia: ${humorState.energy} (${humorState.energy >= 0.4 ? 'Atento e disposto' : 'Calmo/Sonolento'})`,
      `- Expressão sugerida: \`${emotion}\``,
      `- Último evento: *${humorState.reason}*`
    ].join('\n');

    store.saveFile('Humor.md', content);
  }

  return {
    processTurn,
    recordBargeIn,
    recordCarinho,
    recordHumorPraise,
    recordHumorFrustration,
    getHumor: () => ({ ...humorState, suggestedEmotion: getSuggestedOledEmotion() }),
    getSuggestedOledEmotion,
    isStudyActive,
    _getImplicitSignals: () => implicitSignals,
    _setHumor: (v, e, reason = '') => {
      humorState.valence = Math.max(-1.0, Math.min(1.0, v));
      humorState.energy = Math.max(-1.0, Math.min(1.0, e));
      if (reason) humorState.reason = reason;
      humorState.lastUpdated = Date.now();
    }
  };
});
