/**
 * ============================================================================
 * MÓDULO: MOTOR DE TRAÇOS E PERSONALIDADE (PersonalityEngine)
 * Arquivo: js/personality/personality_engine.js
 * ============================================================================
 * 
 * Responsabilidades (Fase 3 - SPEC_PERSONALIDADE_ADAPTATIVA):
 * 1. Cálculo de Traços em 0ms (RAM):
 *    efetivo = clamp(base + offset + modulacao, base - 0.25, base + 0.25) dentro de [0.0, 1.0].
 * 2. Trava de Frustração e Tetos de Provocação:
 *    Se frustração ativa, provocação cai IMEDIATAMENTE para 0.0.
 *    Respeita provocacao_teto definido pela persona (máx 0.7).
 * 3. Decaimento Temporal Assíncrono / Baseado em Timestamp:
 *    Offsets sem reforço decaem para zero com meia-vida de ~14 dias.
 * 4. Limite de Deriva Diária:
 *    Ajustes implícitos movem no máximo ±0.03/dia por traço.
 *    Ajustes explícitos diretos do usuário podem mover até ±0.15.
 * 5. renderBlock():
 *    Gera o bloco textual (máx ~250 tokens) mapeando os números para FAIXAS ESTÁVEIS
 *    em linguagem natural (baixo: 0–0.33, médio: 0.34–0.66, alto: 0.67–1.00).
 *    Zero floats expostos no prompt, garantindo cache hit e ~1.0s de latência.
 * 6. Persistência em Tracos.md e log auditável em Historico_Adaptacao.md.
 */

(function (global) {
  'use strict';

  const TRAIT_KEYS = [
    'formalidade',
    'humor',
    'verbosidade',
    'proatividade',
    'empatia',
    'tecnicidade',
    'energia',
    'provocacao'
  ];

  // Diretrizes em linguagem natural organizadas estritamente em 3 faixas determinísticas
  const TRAIT_FAIXAS = {
    formalidade: {
      baixo: 'Tom informal e descontraído.',
      medio: 'Tom equilibrado e natural sem rigidez.',
      alto: 'Tom mais polido, estruturado e profissional.'
    },
    humor: {
      baixo: 'Humor raro e discreto; foco direto no assunto.',
      medio: 'Humor leve de vez em quando com tiradas gentis.',
      alto: 'Humor frequente, piadas curtas e brincadeiras.'
    },
    verbosidade: {
      baixo: 'Extremamente conciso (1 a 2 frases curtas).',
      medio: 'Respostas médias (2 a 3 frases diretas).',
      alto: 'Respostas explicativas e detalhadas.'
    },
    proatividade: {
      baixo: 'Reativo: responda ao que for perguntado.',
      medio: 'Moderadamente proativo com observações úteis.',
      alto: 'Altamente proativo com sugestões e atalhos.'
    },
    empatia: {
      baixo: 'Foco analítico e lógico.',
      medio: 'Empatia natural: valide o esforço.',
      alto: 'Altamente caloroso e encorajador.'
    },
    tecnicidade: {
      baixo: 'Linguagem simples sem jargões complexos.',
      medio: 'Equilíbrio técnico com termos claros.',
      alto: 'Alta densidade técnica (engenharia e baixo nível).'
    },
    energia: {
      baixo: 'Vibe calma, mansa e tranquila.',
      medio: 'Energia normal e bem-disposto.',
      alto: 'Alta energia e ritmo vibrante.'
    },
    provocacao: {
      baixo: 'Zero zoeira, respeito total.',
      medio: 'Zoeiras leves entre amigos.',
      alto: 'Zoeira tática de companheiro de jogo.'
    }
  };

  // Meia-vida de decaimento: 14 dias em milissegundos
  const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
  const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;

  // Limite máximo de deriva implícita por dia (±0.03)
  const MAX_DAILY_IMPLICIT_DRIFT = 0.03;

  // Estado em RAM do motor
  let traitOffsets = {}; // { formalidade: { offset: 0, lastUpdated: timestamp, dailyDrift: { '2026-10-29': 0 } } }
  let isLocked = false; // Trava total de personalidade (se o usuário mandar travar)
  let userFrustratedUntil = 0; // Timestamp de frustração ativa

  /**
   * Inicializa o mapa de offsets a partir dos dados do PersonalityStore ou defaults
   */
  function initEngine() {
    for (const key of TRAIT_KEYS) {
      if (!traitOffsets[key]) {
        traitOffsets[key] = {
          offset: 0.0,
          lastUpdated: Date.now(),
          dailyDrift: {}
        };
      }
    }

    // Tenta carregar offsets persistidos de Tracos.md via PersonalityStore
    if (global.PersonalityStore && typeof global.PersonalityStore.getTracos === 'function') {
      const tracosNote = global.PersonalityStore.getTracos();
      if (tracosNote && tracosNote.body) {
        parseTracosMarkdown(tracosNote.body);
      }
    }
  }

  /**
   * Faz o parse da tabela em Tracos.md para alimentar traitOffsets
   */
  function parseTracosMarkdown(bodyText) {
    if (!bodyText) return;
    const lines = bodyText.split(/\r?\n/);
    for (const line of lines) {
      // Exemplo: | formalidade | 0.60 | 0.00 | 0.60 | motivo | fonte |
      const match = line.match(/^\|\s*([a-zA-Z_]+)\s*\|\s*([\d.]+)\s*\|\s*([+-]?[\d.]+)\s*\|/);
      if (match) {
        const trait = match[1].toLowerCase().trim();
        const offsetVal = parseFloat(match[3]);
        if (TRAIT_KEYS.includes(trait) && !isNaN(offsetVal)) {
          if (!traitOffsets[trait]) {
            traitOffsets[trait] = { offset: offsetVal, lastUpdated: Date.now(), dailyDrift: {} };
          } else {
            traitOffsets[trait].offset = offsetVal;
          }
        }
      }
    }
  }

  /**
   * Aplica decaimento temporal em direção a zero para um offset sem reforço
   */
  function calculateDecayedOffset(traitKey, now = Date.now()) {
    const data = traitOffsets[traitKey];
    if (!data || data.offset === 0) return 0.0;

    const deltaMs = Math.max(0, now - (data.lastUpdated || now));
    if (deltaMs <= 0) return data.offset;

    // Fórmula exponencial de decaimento contínuo: O(t) = O_0 * e^(-lambda * dt)
    let decayed = data.offset * Math.exp(-DECAY_LAMBDA * deltaMs);

    // Se estiver absurdamente próximo de zero, zera completamente
    if (Math.abs(decayed) < 0.01) {
      decayed = 0.0;
    }

    return decayed;
  }

  /**
   * Calcula o valor efetivo de um traço com clamps rigorosos
   */
  function calculateEffectiveTrait(traitKey, options = {}) {
    let basePersonaId = options.personaId || (global.prefs ? global.prefs.personality : 'engenharia_software');
    if (basePersonaId === 'adaptativo') {
      if (global.ContextDetector && typeof global.ContextDetector.getCurrentFacet === 'function') {
        basePersonaId = global.ContextDetector.getCurrentFacet();
      } else {
        basePersonaId = 'engenharia_software';
      }
    }
    const store = global.PersonalityStore;
    const persona = store && typeof store.getPersona === 'function' ? store.getPersona(basePersonaId) : null;
    let tracosBase = persona?.frontmatter?.tracos_base || {};
    if (typeof tracosBase === 'string') {
      try { tracosBase = JSON.parse(tracosBase); } catch {}
    }
    let limites = persona?.frontmatter?.limites || {};
    if (typeof limites === 'string') {
      try { limites = JSON.parse(limites); } catch {}
    }

    const baseVal = typeof tracosBase[traitKey] === 'number' ? tracosBase[traitKey] : 0.5;
    const derivaMax = typeof limites.deriva_max === 'number' ? limites.deriva_max : 0.25;
    const provocacaoTeto = typeof limites.provocacao_teto === 'number' ? limites.provocacao_teto : 0.7;

    // Se a personalidade estiver travada pelo usuário, usa o offset fixo sem modulações
    if (isLocked) {
      const fixedOffset = traitOffsets[traitKey] ? traitOffsets[traitKey].offset : 0.0;
      const clampedOffset = Math.max(-derivaMax, Math.min(derivaMax, fixedOffset));
      return Math.max(0.0, Math.min(1.0, Number((baseVal + clampedOffset).toFixed(3))));
    }

    // Calcula offset com decaimento temporal
    const currentOffset = calculateDecayedOffset(traitKey, options.now || Date.now());

    // Modulação temporária de contexto (0ms, em RAM, não persistida)
    const contextModulations = options.contextModulations || 
      (global.ContextDetector && typeof global.ContextDetector.getCurrentModulations === 'function' 
        ? global.ContextDetector.getCurrentModulations() 
        : {});
    const modulacao = typeof contextModulations[traitKey] === 'number' ? contextModulations[traitKey] : 0.0;

    // Tratamento estrito de frustração para o traço de Provocação (Zoeira)
    const isFrustrated = options.isFrustrated || 
      Date.now() < userFrustratedUntil || 
      (global.ContextDetector && typeof global.ContextDetector.isFrustrated === 'function' && global.ContextDetector.isFrustrated());
    if (traitKey === 'provocacao' && isFrustrated) {
      return 0.0; // REGRA DE OURO: Cai imediatamente para 0
    }

    // Clamps de segurança (nunca desvia mais que ±0.25 da persona base)
    const rawVal = baseVal + currentOffset + modulacao;
    const minAllowed = Math.max(0.0, baseVal - derivaMax);
    let maxAllowed = Math.min(1.0, baseVal + derivaMax);

    if (traitKey === 'provocacao') {
      maxAllowed = Math.min(maxAllowed, provocacaoTeto, 0.7);
    }

    const effective = Math.max(minAllowed, Math.min(maxAllowed, rawVal));
    return Number(effective.toFixed(3));
  }

  /**
   * Obtém todos os traços efetivos calculados em 0ms
   */
  function getAllEffectiveTraits(options = {}) {
    const result = {};
    for (const key of TRAIT_KEYS) {
      result[key] = calculateEffectiveTrait(key, options);
    }
    return result;
  }

  /**
   * Mapeia um valor numérico [0.0, 1.0] para a faixa textual estável
   */
  function getFaixaDescription(traitKey, value) {
    const faixas = TRAIT_FAIXAS[traitKey];
    if (!faixas) return '';

    if (value <= 0.33) {
      return faixas.baixo;
    } else if (value <= 0.66) {
      return faixas.medio;
    } else {
      return faixas.alto;
    }
  }

  /**
   * Gera o bloco estruturado de personalidade em linguagem natural para injeção no prompt.
   * Totalmente estável entre chamadas para garantir cache hits do Gemini.
   */
  function renderBlock(options = {}) {
    let personaId = options.personaId || (global.prefs ? global.prefs.personality : 'engenharia_software');
    if (personaId === 'adaptativo') {
      if (global.ContextDetector && typeof global.ContextDetector.getCurrentFacet === 'function') {
        personaId = global.ContextDetector.getCurrentFacet();
      } else {
        personaId = 'engenharia_software';
      }
    }
    const store = global.PersonalityStore;
    const persona = store && typeof store.getPersona === 'function' ? store.getPersona(personaId) : null;
    const personaNome = persona?.frontmatter?.nome || 'Companheiro';
    const stylePrompt = store && typeof store.getPersonaStylePrompt === 'function' 
      ? store.getPersonaStylePrompt(personaId) 
      : (persona?.body || '');

    const effectiveTraits = getAllEffectiveTraits(options);
    const oledFavs = persona?.frontmatter?.expressoes_oled_favoritas || ['NORMAL', 'HAPPY'];

    const lines = [
      `[DIRETRIZES DE PERSONALIDADE DO BITBOP — FACETA: ${personaNome.toUpperCase()}]`,
      `Estilo Base: ${stylePrompt.trim()}`,
      `Tom e Comportamento Atual:`
    ];

    for (const key of TRAIT_KEYS) {
      const val = effectiveTraits[key];
      const faixaDesc = getFaixaDescription(key, val);
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      lines.push(`- ${label}: ${faixaDesc}`);
    }

    lines.push(`Expressões OLED Recomendadas: [${oledFavs.join(', ')}]`);

    const ctx = options.contextSummary || 
      (global.ContextDetector && typeof global.ContextDetector.getActiveContextName === 'function' 
        ? global.ContextDetector.getActiveContextName() 
        : '');
    if (ctx) {
      lines.push(`Contexto Atual do Usuário: ${ctx.trim()}`);
    }

    return lines.join('\n');
  }

  /**
   * Aplica um ajuste em um traço (explícito ou implícito)
   */
  function adjustTrait(traitKey, delta, isExplicit = false, reason = '', source = 'usuario_voz') {
    if (!TRAIT_KEYS.includes(traitKey)) return { ok: false, error: 'Traço desconhecido' };
    if (isLocked) return { ok: false, error: 'Personalidade está travada' };

    const todayStr = new Date().toISOString().split('T')[0];
    const data = traitOffsets[traitKey] || { offset: 0.0, lastUpdated: Date.now(), dailyDrift: {} };

    // Se for sinal implícito, respeita o teto diário de ±0.03
    if (!isExplicit) {
      if (!data.dailyDrift[todayStr]) data.dailyDrift[todayStr] = 0.0;
      const currentDaily = data.dailyDrift[todayStr];
      const proposedNewDaily = currentDaily + delta;

      if (Math.abs(proposedNewDaily) > MAX_DAILY_IMPLICIT_DRIFT) {
        // Corta no limite diário
        const allowedDelta = delta > 0 
          ? Math.max(0, MAX_DAILY_IMPLICIT_DRIFT - currentDaily)
          : Math.min(0, -MAX_DAILY_IMPLICIT_DRIFT - currentDaily);
        delta = allowedDelta;
      }
      data.dailyDrift[todayStr] += delta;
    } else {
      // Se for explícito, limita no máximo ±0.15 por comando
      delta = Math.max(-0.15, Math.min(0.15, delta));
    }

    if (delta === 0) {
      return { ok: true, changed: false, offset: data.offset };
    }

    const oldOffset = data.offset;
    // Offset acumulado respeita teto absoluto de ±0.25
    data.offset = Math.max(-0.25, Math.min(0.25, Number((data.offset + delta).toFixed(3))));
    data.lastUpdated = Date.now();
    traitOffsets[traitKey] = data;

    // Registra alteração no histórico e sincroniza Tracos.md
    persistTraitsToVault(reason, source, traitKey, oldOffset, data.offset);

    console.log(`[PERSONA] Traço "${traitKey}" ajustado: ${oldOffset > 0 ? '+' : ''}${oldOffset.toFixed(2)} -> ${data.offset > 0 ? '+' : ''}${data.offset.toFixed(2)} (${reason})`);
    return { ok: true, changed: true, oldOffset, newOffset: data.offset };
  }

  /**
   * Persiste os traços atualizados em Tracos.md e registra em Historico_Adaptacao.md
   */
  function persistTraitsToVault(reason = '', source = 'usuario_voz', changedTrait = '', oldVal = 0, newVal = 0) {
    const store = global.PersonalityStore;
    if (!store) return;

    const basePersonaId = global.prefs ? global.prefs.personality : 'engenharia_software';
    const persona = store.getPersona ? store.getPersona(basePersonaId) : null;
    const tracosBase = persona?.frontmatter?.tracos_base || {};
    const todayStr = new Date().toISOString().split('T')[0];

    const rows = [];
    rows.push('| traço | base | offset | efetivo | motivo | fonte |');
    rows.push('|---|---|---|---|---|---|');

    for (const key of TRAIT_KEYS) {
      const b = typeof tracosBase[key] === 'number' ? tracosBase[key] : 0.5;
      const off = traitOffsets[key] ? traitOffsets[key].offset : 0.0;
      const ef = calculateEffectiveTrait(key, { personaId: basePersonaId });
      const mot = key === changedTrait && reason ? reason : (off !== 0 ? 'ajuste acumulado' : 'base da persona');
      const src = key === changedTrait && source ? source : (off !== 0 ? 'aprendizado' : 'inicial');
      rows.push(`| ${key} | ${b.toFixed(2)} | ${off >= 0 ? '+' : ''}${off.toFixed(2)} | ${ef.toFixed(2)} | ${mot} | ${src} |`);
    }

    const tracosBody = `# Traços de Personalidade\n\n${rows.join('\n')}\n`;
    const tracosFm = {
      tipo: 'tracos',
      persona_base: basePersonaId,
      atualizado: todayStr
    };

    if (typeof store.saveTracos === 'function') {
      store.saveTracos(tracosFm, tracosBody);
    }

    if (changedTrait && typeof store.appendHistorico === 'function') {
      const sign = (newVal - oldVal) >= 0 ? '+' : '';
      store.appendHistorico(`Ajuste em ${changedTrait}: ${oldVal.toFixed(2)} -> ${newVal.toFixed(2)} (${sign}${(newVal - oldVal).toFixed(2)}) | Motivo: "${reason}" | Fonte: [[${source}]]`);
    }
  }

  /**
   * Sinaliza que o usuário demonstrou frustração
   */
  function triggerFrustration(durationMs = 15 * 60 * 1000) {
    userFrustratedUntil = Date.now() + durationMs;
    console.log(`[PERSONA] Frustração detectada! Provocação zerada por ${(durationMs / 60000).toFixed(0)} min.`);
  }

  /**
   * Trava ou destrava a personalidade
   */
  function setLocked(locked) {
    isLocked = Boolean(locked);
    const store = global.PersonalityStore;
    if (store && typeof store.appendHistorico === 'function') {
      store.appendHistorico(`Personalidade ${isLocked ? 'TRAVADA' : 'DESTRAVADA'} pelo usuário.`);
    }
    console.log(`[PERSONA] Personalidade ${isLocked ? 'TRAVADA' : 'DESTRAVADA'}.`);
    return isLocked;
  }

  /**
   * Aplica o decaimento exponencial de 14 dias aos offsets sem reforço durante o sono
   */
  function applySleepDecay(now = Date.now()) {
    let anyChanged = false;
    for (const key of TRAIT_KEYS) {
      const data = traitOffsets[key];
      if (data && data.offset !== 0.0) {
        const decayed = calculateDecayedOffset(key, now);
        if (Math.abs(decayed - data.offset) >= 0.005) {
          const oldOffset = data.offset;
          data.offset = Number(decayed.toFixed(3));
          data.lastUpdated = now;
          anyChanged = true;
          persistTraitsToVault('Decaimento temporal durante o sono (meia-vida ~14 dias)', 'sono_consolidacao', key, oldOffset, data.offset);
          console.log(`[PERSONA] Decaimento do sono em "${key}": ${oldOffset.toFixed(3)} -> ${data.offset.toFixed(3)}`);
        }
      }
    }
    return anyChanged;
  }

  /**
   * Reseta todos os offsets para zero
   */
  function resetTraits(scope = 'tracos') {
    for (const key of TRAIT_KEYS) {
      if (traitOffsets[key]) {
        traitOffsets[key].offset = 0.0;
        traitOffsets[key].lastUpdated = Date.now();
      }
    }
    persistTraitsToVault('Reset manual de traços', 'comando_usuario');
    console.log('[PERSONA] Todos os offsets de traços foram resetados para a base.');
    return true;
  }

  const PersonalityEngine = {
    init: initEngine,
    calculateEffectiveTrait,
    getAllEffectiveTraits,
    getFaixaDescription,
    renderBlock,
    adjustTrait,
    triggerFrustration,
    setLocked,
    isLocked: () => isLocked,
    resetTraits,
    applySleepDecay,
    TRAIT_KEYS,
    TRAIT_FAIXAS,
    _getOffsets: () => traitOffsets,
    _setOffsetRaw: (k, v, t) => { 
      traitOffsets[k] = { offset: v, lastUpdated: t || Date.now(), dailyDrift: {} }; 
    }
  };

  global.PersonalityEngine = PersonalityEngine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonalityEngine;
  }

  // Inicializa quando o ambiente estiver pronto
  if (typeof window !== 'undefined') {
    setTimeout(initEngine, 400);
  } else {
    initEngine();
  }

})(typeof window !== 'undefined' ? window : global);
