/**
 * personality_tools.js — BitBop Desktop AI Companion
 * Ferramentas de Voz e Function Calling de Personalidade (Seção 10 de SPEC_PERSONALIDADE_ADAPTATIVA.md)
 *
 * Responsabilidades:
 * 1. Declara as 5 ferramentas para o Gemini Function Calling:
 *    - ajustar_tom({ traco, direcao, duracao, speech_response })
 *    - trocar_persona({ persona, speech_response })
 *    - travar_personalidade({ ativo, speech_response })
 *    - resetar_personalidade({ escopo, speech_response })
 *    - explicar_personalidade({ speech_response })
 * 2. Processa as chamadas e reflete em tempo real no PersonalityEngine, ContextDetector e Obsidian.
 * 3. Provê analisador de comandos diretos de voz em português para execução ultrarrápida (<100ms).
 *
 * Padrão: IIFE Universal (Browser / Electron / Node CommonJS)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(global);
  } else {
    root.PersonalityTools = factory(root);
  }
})(typeof window !== 'undefined' ? window : global, function (global) {
  'use strict';

  // Declarações oficiais das 5 ferramentas para o Gemini (Function Calling)
  const PERSONALITY_TOOL_DECLARATIONS = [
    {
      name: 'ajustar_tom',
      description: 'Ajusta a intensidade de um dos 8 traços de personalidade do BitBop (formalidade, humor, verbosidade, proatividade, empatia, tecnicidade, energia ou provocacao). Use quando o usuário pedir para falar menos, falar mais curto, ser mais ou menos engraçado, parar de zoeira, etc.',
      parameters: {
        type: 'OBJECT',
        properties: {
          traco: {
            type: 'STRING',
            enum: ['formalidade', 'humor', 'verbosidade', 'proatividade', 'empatia', 'tecnicidade', 'energia', 'provocacao'],
            description: 'Nome do traço a ajustar'
          },
          direcao: {
            type: 'STRING',
            enum: ['aumentar', 'diminuir'],
            description: 'Direção do ajuste'
          },
          duracao: {
            type: 'STRING',
            enum: ['agora', 'sempre'],
            description: 'Duração: "agora" para modulação momentânea, "sempre" para offset persistente'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resposta falada curta, natural e espirituosa de confirmação ao usuário'
          }
        },
        required: ['traco', 'direcao']
      }
    },
    {
      name: 'trocar_persona',
      description: 'Troca a faceta ou persona ativa do BitBop. Pode ativar o modo Adaptativo ou selecionar uma faceta fixa (engenharia_software, padrao, gamer, cyberpunk, custom). Use quando o usuário pedir "modo gamer", "modo cyberpunk", "modo mentor", "modo fofo" ou "modo adaptativo".',
      parameters: {
        type: 'OBJECT',
        properties: {
          persona: {
            type: 'STRING',
            enum: ['adaptativo', 'engenharia_software', 'padrao', 'gamer', 'cyberpunk', 'custom'],
            description: 'Identificador da persona desejada'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resposta falada curta e expressiva confirmando a troca'
          }
        },
        required: ['persona']
      }
    },
    {
      name: 'travar_personalidade',
      description: 'Trava ou destrava a personalidade do BitBop. Quando travada, nenhuma adaptação automática, decaimento ou modulação de contexto altera os traços. Use quando o usuário pedir "fica assim", "trava a personalidade" ou "destrava".',
      parameters: {
        type: 'OBJECT',
        properties: {
          ativo: {
            type: 'BOOLEAN',
            description: 'True para travar, False para destravar'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resposta falada curta de confirmação'
          }
        },
        required: ['ativo']
      }
    },
    {
      name: 'resetar_personalidade',
      description: 'Reseta os traços aprendidos e offsets acumulados de volta aos valores-base originais da persona. Use quando o usuário pedir "volta ao normal", "reseta sua personalidade" ou "reinicia os traços".',
      parameters: {
        type: 'OBJECT',
        properties: {
          escopo: {
            type: 'STRING',
            enum: ['tracos', 'tudo'],
            description: '"tracos" para zerar apenas offsets, "tudo" para voltar à persona padrão'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resposta falada curta de confirmação'
          }
        }
      }
    },
    {
      name: 'explicar_personalidade',
      description: 'Lê o histórico de adaptação recente em Historico_Adaptacao.md e o contexto ativo em Contextos.md para explicar ao usuário por que o BitBop está falando daquele jeito ou em qual faceta se encontra. Use quando o usuário perguntar "por que você tá mais quieto?", "por que você tá diferente?", "o que mudou em você?" ou "em qual modo você tá?".',
      parameters: {
        type: 'OBJECT',
        properties: {
          speech_response: {
            type: 'STRING',
            description: 'Explicação detalhada e sincera em 1ª pessoa sobre o motivo da postura atual'
          }
        }
      }
    },
    {
      name: 'modo_ouvinte',
      description: 'Ativa ou desativa o Modo Ouvinte Silencioso (Só Observar). Quando ativo, o BitBop fica 100% em silêncio (sem falar e sem responder à conversa), mas continua ouvindo você e seus amigos jogando/conversando para extrair memórias, aprender sobre pessoas e preferências e registrar no Obsidian. Use quando o usuário pedir "só fica observando", "modo ouvinte", "fica só olhando", "não fala nada", "fica em silêncio e só observa" ou "pode voltar a falar".',
      parameters: {
        type: 'OBJECT',
        properties: {
          ativo: {
            type: 'BOOLEAN',
            description: 'True para ativar o modo ouvinte silencioso, False para desativar e voltar a falar normalmente'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resposta falada curta de confirmação antes de entrar em silêncio absoluto'
          }
        },
        required: ['ativo']
      }
    }
  ];

  /**
   * Verifica se o nome pertence às ferramentas de personalidade
   */
  function isPersonalityFunction(name) {
    return [
      'ajustar_tom',
      'trocar_persona',
      'travar_personalidade',
      'resetar_personalidade',
      'explicar_personalidade',
      'modo_ouvinte'
    ].includes(name);
  }

  /**
   * Processa uma chamada de ferramenta do Gemini Function Calling
   */
  function processPersonalityCall(name, args = {}) {
    const engine = global.PersonalityEngine;
    const detector = global.ContextDetector;
    const store = global.PersonalityStore;
    const memory = global.MemoryStore;
    const p = global.prefs || {};

    switch (name) {
      case 'ajustar_tom': {
        const traco = String(args.traco || 'verbosidade').toLowerCase();
        const direcao = String(args.direcao || 'diminuir').toLowerCase();
        const delta = (direcao === 'aumentar' ? 0.15 : -0.15);
        const reason = `Comando de voz: ajustar ${traco} (${direcao})`;

        if (engine && typeof engine.adjustTrait === 'function') {
          engine.adjustTrait(traco, delta, true, reason, 'usuario_voz');
        }

        const speech = args.speech_response || (direcao === 'diminuir' 
          ? `Perfeito, reduzi minha ${traco}!` 
          : `Combinado, aumentei minha ${traco}!`);
        
        return { ok: true, action: 'ajustar_tom', traco, delta, speech_response: speech };
      }

      case 'trocar_persona': {
        const persona = String(args.persona || 'adaptativo').toLowerCase();
        p.personality = persona;

        if (persona === 'adaptativo') {
          if (detector && typeof detector.evaluateContext === 'function') {
            detector.evaluateContext(global.state, p, Date.now());
          }
        } else {
          if (detector && typeof detector.forceFacet === 'function') {
            detector.forceFacet(persona, 'comando_voz_persona');
          }
        }

        if (typeof global.updatePersonalityUi === 'function') {
          global.updatePersonalityUi();
        }
        if (typeof global.saveAiConfigToDisk === 'function') {
          global.saveAiConfigToDisk();
        }

        const labels = {
          adaptativo: 'Modo Adaptativo',
          engenharia_software: 'Mentor de Engenharia',
          gamer: 'Gamer e Raid Co-pilot',
          cyberpunk: 'Cyberpunk Hacker',
          padrao: 'Companheiro Fofo'
        };

        const speech = args.speech_response || `Modo ${labels[persona] || persona} ativado!`;
        return { ok: true, action: 'trocar_persona', persona, speech_response: speech };
      }

      case 'travar_personalidade': {
        const ativo = Boolean(args.ativo);
        if (engine && typeof engine.setLocked === 'function') {
          engine.setLocked(ativo);
        }
        const speech = args.speech_response || (ativo 
          ? 'Personalidade travada exatamente como está agora!' 
          : 'Personalidade destravada, adaptação automática ativa.');
        return { ok: true, action: 'travar_personalidade', ativo, speech_response: speech };
      }

      case 'resetar_personalidade': {
        const escopo = args.escopo || 'tracos';
        if (engine && typeof engine.resetTraits === 'function') {
          engine.resetTraits(escopo);
        }
        if (escopo === 'tudo') {
          p.personality = 'adaptativo';
          if (typeof global.updatePersonalityUi === 'function') global.updatePersonalityUi();
        }
        const speech = args.speech_response || 'Personalidade resetada para os valores de fábrica!';
        return { ok: true, action: 'resetar_personalidade', escopo, speech_response: speech };
      }

      case 'explicar_personalidade': {
        let motivo = 'Estou no meu modo padrão de convivência.';
        let recentAdjustments = [];

        // Lê histórico recente em Historico_Adaptacao.md
        if (memory && typeof memory.readNote === 'function') {
          const hist = memory.readNote('00_Nucleo/Personalidade/Historico_Adaptacao.md');
          if (hist.ok && hist.body) {
            const lines = hist.body.split(/\r?\n/).filter(l => l.trim().startsWith('- ['));
            recentAdjustments = lines.slice(-3);
          }
        }

        const facet = detector && typeof detector.getCurrentFacet === 'function'
          ? detector.getCurrentFacet()
          : (p.personality || 'engenharia_software');
        
        const contextName = detector && typeof detector.getActiveContextName === 'function'
          ? detector.getActiveContextName()
          : 'desenvolvimento';

        let speech = '';
        if (args.speech_response) {
          speech = args.speech_response;
        } else {
          let extra = '';
          if (recentAdjustments.length > 0) {
            const lastAdj = recentAdjustments[recentAdjustments.length - 1];
            if (lastAdj.includes('verbosidade') && lastAdj.includes('-')) {
              extra = ' e você me pediu para falar mais curto recentemente';
            } else if (lastAdj.includes('sem zoeira') || lastAdj.includes('provocacao')) {
              extra = ' e você me pediu foco sem zoeira';
            } else if (lastAdj.includes('silêncio durante programação')) {
              extra = ' e você me pediu silêncio enquanto programa';
            }
          }
          speech = `Estou na faceta ${facet.replace('_', ' ')} porque detectei o contexto de ${contextName}${extra}!`;
        }

        return { ok: true, action: 'explicar_personalidade', facet, speech_response: speech };
      }

      case 'modo_ouvinte': {
        const ativo = Boolean(args.ativo);
        const s = global.state || {};
        s.silentObserverMode = ativo;

        if (typeof global.toggleListenerMode === 'function') {
          global.toggleListenerMode(ativo);
        } else {
          if (typeof global.updatePersonalityUi === 'function') global.updatePersonalityUi();
          if (typeof global.showActionBadge === 'function') {
            global.showActionBadge(ativo ? '🎧' : '🗣️', ativo ? 'Modo Ouvinte Ativo' : 'Voz Reativada', 3200);
          }
        }

        const speech = args.speech_response || (ativo
          ? 'Entendido! Entrando no Modo Ouvinte. Vou ficar só acompanhando a conversa e o jogo de vocês e guardando as memórias. Quando quiser que eu volte a falar, é só me dizer: BitBop, pode voltar a falar!'
          : 'Tô de volta! Acompanhei o jogo e guardei tudo o que conversamos na memória. Pode falar comigo normalmente!');

        return { ok: true, action: 'modo_ouvinte', ativo, speech_response: speech };
      }

      default:
        return { ok: false, error: 'Ferramenta de personalidade não encontrada' };
    }
  }

  /**
   * Analisador de comandos diretos de voz em Português para execução ultrarrápida (<100ms)
   */
  function checkDirectVoiceCommands(transcript) {
    if (!transcript || typeof transcript !== 'string') return null;
    const text = transcript.trim().toLowerCase();

    // 1. Troca de Personas
    if (/(?:modo|persona)\s*(?:gamer|jogos?|raid)/i.test(text)) {
      const res = processPersonalityCall('trocar_persona', { persona: 'gamer' });
      return { ...res, emotion: 'EXCITED', actionLabel: 'Modo Gamer' };
    }
    if (/(?:modo|persona)\s*(?:cyberpunk|hacker|netrunner)/i.test(text)) {
      const res = processPersonalityCall('trocar_persona', { persona: 'cyberpunk' });
      return { ...res, emotion: 'COOL', actionLabel: 'Modo Cyberpunk' };
    }
    if (/(?:modo|persona)\s*(?:mentor|engenharia|dev)/i.test(text)) {
      const res = processPersonalityCall('trocar_persona', { persona: 'engenharia_software' });
      return { ...res, emotion: 'THINKING', actionLabel: 'Mentor Dev' };
    }
    if (/(?:modo|persona)\s*(?:fofo|padr[ãa]o|companheiro)/i.test(text)) {
      const res = processPersonalityCall('trocar_persona', { persona: 'padrao' });
      return { ...res, emotion: 'HAPPY', actionLabel: 'Modo Fofo' };
    }
    if (/(?:modo|persona)\s*(?:adaptativo|autom[áa]tico|cerebro)/i.test(text)) {
      const res = processPersonalityCall('trocar_persona', { persona: 'adaptativo' });
      return { ...res, emotion: 'CURIOUS', actionLabel: 'Modo Adaptativo' };
    }

    // 2. Travar / Destravar (verifica destravar primeiro para evitar colisão de substring)
    if (/(?:destrava(?:r)?\s*(?:a\s*)?personalidade|pode\s*adaptar|volta\s*a\s*adaptar)/i.test(text)) {
      const res = processPersonalityCall('travar_personalidade', { ativo: false });
      return { ...res, emotion: 'HAPPY', actionLabel: 'Destravar' };
    }
    if (/(?<!des)(?:trava(?:r)?\s*(?:a\s*)?personalidade|fica\s*assim|congela\s*(?:o\s*)?tom)/i.test(text)) {
      const res = processPersonalityCall('travar_personalidade', { ativo: true });
      return { ...res, emotion: 'COOL', actionLabel: 'Travar Personalidade' };
    }

    // 3. Resetar
    if (/(?:reseta(?:r)?\s*(?:a\s*)?personalidade|volta\s*(?:ao|pro)\s*normal|reinicia(?:r)?\s*tra[çc]os)/i.test(text)) {
      const res = processPersonalityCall('resetar_personalidade', { escopo: 'tracos' });
      return { ...res, emotion: 'NORMAL', actionLabel: 'Resetar Traços' };
    }

    // 4. Explicar por que mudou / por que tá quieto
    if (/(?:por\s*que\s*voc[êe]\s*t[áa]\s*(?:mais\s*)?(?:quiet(?:o|inho)|diferente|assim|mudad(?:o|inho))|o\s*que\s*mudou\s*em\s*voc[êe]|em\s*qual\s*modo\s*voc[êe]\s*t[áa])/i.test(text)) {
      const res = processPersonalityCall('explicar_personalidade', {});
      return { ...res, emotion: 'CURIOUS', actionLabel: 'Explicar Tom' };
    }

    // 5. Modo Ouvinte Silencioso / Só Observar (Jogos e Conversas com amigos)
    // Para DESATIVAR (avaliado antes para evitar falso-positivo com 'desativa o modo ouvinte'):
    if (/(?:pode\s*voltar\s*a\s*falar|volta\s*a\s*falar|desativa(?:r)?\s*(?:o\s*)?(?:modo\s*)?(?:ouvinte|espectador|observador|silencioso)|pode\s*falar(?:\s*novamente)?|pode\s*conversar|sai\s*do\s*modo\s*(?:ouvinte|espectador|observador))/i.test(text)) {
      const res = processPersonalityCall('modo_ouvinte', { ativo: false });
      return { ...res, emotion: 'HAPPY', actionLabel: 'Voz Reativada' };
    }

    // Para ATIVAR:
    if (/(?:s[óo]\s*(?:fica|fique)\s*observando|fica\s*s[óo]\s*olhando|(?<!desativ[ae]r?\s*(?:o\s*)?|sai\s*do\s*)modo\s*(?:ouvinte|espectador)|s[óo]\s*escuta|n[ãa]o\s*fala\s*nada(?:\s*at[ée]\s*eu\s*mandar)?|fica\s*em\s*sil[êe]ncio\s*(?:e\s*s[óo]\s*observa)?|sil[êe]ncio\s*total|s[óo]\s*observa\s*(?:o\s*jogo)?)/i.test(text)) {
      const res = processPersonalityCall('modo_ouvinte', { ativo: true });
      return { ...res, emotion: 'CURIOUS', actionLabel: 'Modo Ouvinte Silencioso' };
    }

    return null;
  }

  return {
    getGeminiToolDeclarations: () => PERSONALITY_TOOL_DECLARATIONS,
    isPersonalityFunction,
    processPersonalityCall,
    checkDirectVoiceCommands
  };
});
