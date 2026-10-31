/**
 * ============================================================================
 * MÓDULO: FERRAMENTAS DO CÉREBRO NO OBSIDIAN (MemoryTools)
 * Arquivo: js/memory/memory_tools.js
 * ============================================================================
 * 
 * Etapa 2: Implementação completa das 5 ferramentas cognitivas:
 * 1. guardar_memoria({ titulo, texto, tipo, importancia, aliases, tags, speech_response })
 * 2. lembrar({ consulta, tipo, incluir_arquivo, speech_response })
 * 3. esquecer({ consulta, speech_response })
 * 4. corrigir_memoria({ consulta_antiga, novo_fato, speech_response })
 * 5. o_que_voce_sabe_sobre({ assunto, speech_response })
 */

(function (global) {
  'use strict';

  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;
  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;

  // Declarações oficiais das 5 ferramentas para o Gemini (Function Calling)
  const MEMORY_TOOL_DECLARATIONS = [
    {
      name: 'guardar_memoria',
      description: 'Grava uma memória permanente, preferência, projeto, pessoa, fato ou aprendizado relevante diretamente no cérebro contínuo do Obsidian (Vault BitBop-Cerebro). Use sempre que o usuário pedir para lembrar, guardar, registrar ou expressar um gosto, decisão ou hábito pessoal.',
      parameters: {
        type: 'OBJECT',
        properties: {
          titulo: {
            type: 'STRING',
            description: 'Título curto, limpo e descritivo da memória (ex: "Café com Adoçante", "Preferência por Respostas Curtas")'
          },
          texto: {
            type: 'STRING',
            description: 'Conteúdo detalhado da memória em Markdown, utilizando [[Wikilinks]] para interligar com conceitos conhecidos'
          },
          tipo: {
            type: 'STRING',
            enum: [
              'preferencia',
              'fato',
              'pessoa',
              'projeto',
              'conceito',
              'lugar',
              'episodio',
              'procedimento',
              'estudo',
              'pendencia',
              'reflexao'
            ],
            description: 'Categoria conceitual da memória'
          },
          importancia: {
            type: 'INTEGER',
            description: 'Grau de relevância de 1 a 10 (onde 10 é vital e 1 é trivial). Padrão: 8'
          },
          aliases: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Sinônimos, apelidos ou palavras-chave associadas para busca rápida'
          },
          tags: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Marcadores temáticos sem o símbolo #'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase curta e falada em 1ª pessoa confirmando que o BitBop guardou a informação no seu cérebro'
          }
        },
        required: ['titulo', 'texto', 'tipo']
      }
    },
    {
      name: 'lembrar',
      description: 'Busca aprofundada no cérebro contínuo do Obsidian por memórias, hábitos, fatos ou preferências salvas anteriormente. Use sempre que o usuário perguntar o que você lembra sobre algo, se você se recorda de um hábito dele ou pedir para consultar o cérebro.',
      parameters: {
        type: 'OBJECT',
        properties: {
          consulta: {
            type: 'STRING',
            description: 'Termo ou pergunta-chave para buscar na memória (ex: "café", "adoçante", "estilo de código")'
          },
          tipo: {
            type: 'STRING',
            description: 'Filtro opcional por tipo (preferencia, fato, pessoa, projeto, etc.)'
          },
          incluir_arquivo: {
            type: 'BOOLEAN',
            description: 'True para pesquisar também em arquivos antigos ou diários passados'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase curta e carinhosa em 1ª pessoa dizendo o que lembrou'
          }
        },
        required: ['consulta']
      }
    },
    {
      name: 'esquecer',
      description: 'Remove ou arquiva uma memória do Obsidian e a adiciona à lista de coisas a nunca mais lembrar (tombstones). Use quando o usuário pedir expressamente para esquecer, apagar ou desconsiderar algo gravado.',
      parameters: {
        type: 'OBJECT',
        properties: {
          consulta: {
            type: 'STRING',
            description: 'Assunto, termo ou título da memória que deve ser esquecida/apagada'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase confirmando o esquecimento da memória'
          }
        },
        required: ['consulta']
      }
    },
    {
      name: 'corrigir_memoria',
      description: 'Atualiza ou substitui uma memória anterior que mudou ou ficou desatualizada. Marca a nota antiga como superada e cria a nova versão corrigida no Obsidian.',
      parameters: {
        type: 'OBJECT',
        properties: {
          consulta_antiga: {
            type: 'STRING',
            description: 'Título ou assunto da memória antiga a ser retificada'
          },
          novo_fato: {
            type: 'STRING',
            description: 'A informação nova, correta e atualizada'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase falada pelo BitBop confirmando que a memória foi corrigida'
          }
        },
        required: ['consulta_antiga', 'novo_fato']
      }
    },
    {
      name: 'o_que_voce_sabe_sobre',
      description: 'Auditoria de conhecimento e transparência: lista todas as memórias e aprendizados que o BitBop tem registrados sobre determinado assunto, pessoa ou projeto.',
      parameters: {
        type: 'OBJECT',
        properties: {
          assunto: {
            type: 'STRING',
            description: 'Assunto a auditar (ex: "Álvaro", "café", "tudo")'
          },
          speech_response: {
            type: 'STRING',
            description: 'Resumo falado das memórias encontradas'
          }
        },
        required: ['assunto']
      }
    },
    {
      name: 'criar_pendencia',
      description: 'Registra uma tarefa, pendência ou loop aberto em 06_Pendencias/ no Obsidian para acompanhamento e lembrete futuro pelo BitBop.',
      parameters: {
        type: 'OBJECT',
        properties: {
          titulo: {
            type: 'STRING',
            description: 'Título curto e direto da pendência'
          },
          descricao: {
            type: 'STRING',
            description: 'Detalhes da pendência e o que precisa ser feito ou lembrado'
          },
          gatilho_valor: {
            type: 'STRING',
            description: 'Data no formato AAAA-MM-DD. Deixe NULO/VAZIO a menos que o usuário tenha falado explicitamente uma data ou momento específico (ex: "amanhã", "segunda-feira"). NUNCA invente uma data!'
          },
          gatilho_tipo: {
            type: 'STRING',
            description: 'Tipo de gatilho: data_ou_boot (se houver data explícita), sem_prazo (padrão se não houver data informada), abrir_janela ou retorno_ausencia'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase falada pelo BitBop confirmando que anotou a pendência'
          }
        },
        required: ['titulo']
      }
    },
    {
      name: 'fechar_pendencia',
      description: 'Marca uma pendência aberta em 06_Pendencias/ como concluída, arquiva em 99_Arquivo/ e registra no diário de bordo.',
      parameters: {
        type: 'OBJECT',
        properties: {
          consulta_pendencia: {
            type: 'STRING',
            description: 'Título ou assunto da pendência a fechar/concluir'
          },
          desfecho: {
            type: 'STRING',
            description: 'Como a pendência foi concluída ou resultado alcançado'
          },
          speech_response: {
            type: 'STRING',
            description: 'Frase falada pelo BitBop comemorando ou confirmando a conclusão'
          }
        },
        required: ['consulta_pendencia']
      }
    }
  ];

  /**
   * Sanitiza títulos para nomes de arquivos válidos no Windows.
   */
  function sanitizeFilename(title) {
    if (!title || typeof title !== 'string') return `Memoria_${Date.now()}`;
    return title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 70);
  }

  /**
   * Mapeia o tipo para a subpasta correspondente dentro do Vault.
   */
  function getDestinationFolderForType(tipo) {
    const map = {
      preferencia: '03_Conhecimento/Preferencias',
      projeto: '03_Conhecimento/Projetos',
      pessoa: '03_Conhecimento/Pessoas',
      conceito: '03_Conhecimento/Conceitos',
      lugar: '03_Conhecimento/Lugares',
      episodio: '02_Episodios',
      procedimento: '04_Procedimentos',
      estudo: '05_Estudo',
      pendencia: '06_Pendencias',
      reflexao: '07_Reflexoes',
      fato: '03_Conhecimento/Preferencias'
    };
    return map[tipo] || '03_Conhecimento/Preferencias';
  }

  /**
   * Retorna todas as declarações de ferramentas de memória para o Gemini.
   */
  function getGeminiToolDeclarations() {
    return MEMORY_TOOL_DECLARATIONS;
  }

  /**
   * Verifica se o nome da função pertence ao módulo de ferramentas de memória.
   */
  function isMemoryFunction(functionName) {
    return [
      'guardar_memoria',
      'lembrar',
      'esquecer',
      'corrigir_memoria',
      'o_que_voce_sabe_sobre',
      'criar_pendencia',
      'fechar_pendencia'
    ].includes(functionName);
  }

  /**
   * Executa a chamada da ferramenta correspondente.
   */
  function processMemoryCall(name, args = {}) {
    const memoryStore = global.MemoryStore || (typeof require !== 'undefined' ? (() => {
      try { return require('./memory_store.js'); } catch { return null; }
    })() : null);

    const memoryIndex = global.MemoryIndex || (typeof require !== 'undefined' ? (() => {
      try { return require('./memory_index.js'); } catch { return null; }
    })() : null);

    if (!memoryStore) {
      console.warn('[MemoryTools] MemoryStore indisponível.');
      return { ok: false, error: 'MemoryStore indisponível' };
    }

    switch (name) {
      // ----------------------------------------------------------------------
      // 1. GUARDAR MEMÓRIA
      // ----------------------------------------------------------------------
      case 'guardar_memoria': {
        const titulo = (args.titulo || '').trim() || 'Nova Memória';
        const texto = (args.texto || '').trim() || titulo;
        const tipo = (args.tipo || 'fato').toLowerCase();
        const importancia = typeof args.importancia === 'number' ? Math.max(1, Math.min(10, args.importancia)) : 8;
        const aliases = Array.isArray(args.aliases) ? args.aliases : [];
        const tags = Array.isArray(args.tags) ? args.tags : [];

        const now = new Date();
        const isoTimestamp = now.toISOString();
        const dateStr = isoTimestamp.split('T')[0];
        const randHex = Math.random().toString(36).substring(2, 8);
        const id = `mem_${dateStr.replace(/-/g, '')}_${randHex}`;

        const folder = getDestinationFolderForType(tipo);
        const safeName = sanitizeFilename(titulo);
        const relativePath = `${folder}/${safeName}.md`;

        const frontmatter = {
          id,
          titulo,
          tipo,
          aliases,
          tags,
          resumo_curto: texto.slice(0, 160).replace(/\r?\n/g, ' '),
          criado: isoTimestamp,
          ultimo_acesso: isoTimestamp,
          acessos: 1,
          importancia,
          estabilidade: 7.0,
          confianca: 1.0,
          emocao_oled: 'HAPPY',
          fonte: `[[${dateStr}]]`,
          fonte_origem: 'usuario_explicito',
          superada_por: null,
          locked: false,
          privado: false
        };

        const writeRes = memoryStore.writeNote(relativePath, frontmatter, texto);
        if (!writeRes.ok) {
          return {
            ok: false,
            skipped: writeRes.skipped,
            speech_response: writeRes.skipped ? `A nota "${titulo}" está travada no Obsidian e não foi alterada.` : `Tive um problema ao gravar a nota "${titulo}".`
          };
        }

        // Reindexa em RAM
        if (memoryIndex && typeof memoryIndex.indexSingleFile === 'function') {
          memoryIndex.indexSingleFile(relativePath);
        }

        memoryStore.appendDailyEntry({
          titulo: `Guardou memória: ${titulo}`,
          texto: `Registrada em [[${safeName}]] (${tipo}) com importância ${importancia}/10.`
        });

        memoryStore.appendEventLog({
          tipo: 'guardar_memoria',
          titulo,
          path: relativePath,
          importancia
        });

        if (typeof global.setEmotion === 'function') global.setEmotion('HAPPY', 3500);
        if (global.CuteSynth) {
          if (typeof global.CuteSynth.powerUp === 'function') global.CuteSynth.powerUp();
          else if (typeof global.CuteSynth.curious === 'function') global.CuteSynth.curious();
        }
        if (typeof global.showActionBadge === 'function') global.showActionBadge('🧠', 'Guardando na memória...', 3200);

        const defaultSpeech = `Guardei isso na minha memória: ${titulo}.`;
        const speechResponse = (args.speech_response || '').trim() || defaultSpeech;

        console.log(`[MemoryTools] Memória gravada com sucesso em: "${relativePath}"`);
        return { ok: true, path: relativePath, id, speech_response: speechResponse };
      }

      // ----------------------------------------------------------------------
      // 2. LEMBRAR (BUSCA PROFUNDA + REAÇÃO VISUAL/SONORA)
      // ----------------------------------------------------------------------
      case 'lembrar': {
        const query = String(args.consulta || '').trim();
        console.log(`[MemoryTools] Executando 'lembrar' para: "${query}"`);

        // Reação tátil e auditiva imediata
        if (typeof global.setEmotion === 'function') {
          global.setEmotion('THINKING', 4000);
        }
        if (global.CuteSynth && typeof global.CuteSynth.thinking === 'function') {
          global.CuteSynth.thinking();
        } else if (global.CuteSynth && typeof global.CuteSynth.curious === 'function') {
          global.CuteSynth.curious();
        }

        if (!memoryIndex) {
          return { ok: false, error: 'MemoryIndex indisponível' };
        }

        const bm25Map = memoryIndex.searchBM25(query, 6);
        const aliasMap = memoryIndex.findAliasMatches(query);
        const candidateIds = new Set([...bm25Map.keys(), ...aliasMap.keys()]);

        const scored = [];
        for (const nid of candidateIds) {
          const meta = memoryIndex.getNoteMetadata(nid);
          if (!meta || meta.privado || meta.superada_por) continue;
          const score = (bm25Map.get(nid) || 0) * 0.65 + (aliasMap.get(nid) || 0) * 0.35;
          scored.push({ meta, score });
        }
        scored.sort((a, b) => b.score - a.score);

        const top3 = scored.slice(0, 3);
        if (top3.length === 0) {
          const defaultEmpty = `Procurei no meu cérebro do Obsidian, mas não encontrei nenhuma memória sobre "${query}".`;
          return {
            ok: true,
            encontrados: 0,
            speech_response: (args.speech_response || '').trim() || defaultEmpty
          };
        }

        // Lê o corpo completo das notas encontradas
        const detailed = [];
        for (const item of top3) {
          const read = memoryStore.readNote(item.meta.path);
          detailed.push({
            titulo: item.meta.titulo,
            tipo: item.meta.tipo,
            resumo: item.meta.resumo_curto,
            conteudo: read.ok ? read.body.trim() : item.meta.resumo_curto,
            fonte: item.meta.path
          });
        }

        let speechResponse = (args.speech_response || '').trim();
        if (!speechResponse) {
          const best = detailed[0];
          speechResponse = `Lembrei! ${best.titulo}: ${best.resumo}`;
        }

        // Exibe no balão de fala
        if (typeof global.showBubble === 'function') {
          const bubbleText = detailed.map((d) => `🧠 <b>${d.titulo}</b>:\n${d.resumo}`).join('\n\n');
          global.showBubble('Obsidian 🧠', bubbleText, 8000, false, true);
        }

        return {
          ok: true,
          encontrados: detailed.length,
          speech_response: speechResponse,
          memorias: detailed
        };
      }

      // ----------------------------------------------------------------------
      // 3. ESQUECER (ARQUIVAMENTO + TOMBSTONES)
      // ----------------------------------------------------------------------
      case 'esquecer': {
        const query = String(args.consulta || '').trim();
        console.log(`[MemoryTools] Executando 'esquecer' para: "${query}"`);

        if (!memoryIndex || !nodeFs || !nodePath) {
          return { ok: false, error: 'Dependências indisponíveis' };
        }

        // Localiza a nota correspondente
        const aliasMap = memoryIndex.findAliasMatches(query);
        const bm25Map = memoryIndex.searchBM25(query, 3);
        const candidates = [...aliasMap.keys(), ...bm25Map.keys()];

        if (candidates.length === 0) {
          return {
            ok: false,
            speech_response: `Não encontrei nenhuma memória correspondente a "${query}" para esquecer.`
          };
        }

        const targetId = candidates[0];
        const meta = memoryIndex.getNoteMetadata(targetId);
        if (!meta) {
          return { ok: false, speech_response: 'Nota não encontrada no índice.' };
        }

        const vaultDir = memoryStore.getVaultPath();
        const oldFullPath = nodePath.join(vaultDir, meta.path);
        const archiveDir = nodePath.join(vaultDir, '99_Arquivo');
        if (!nodeFs.existsSync(archiveDir)) nodeFs.mkdirSync(archiveDir, { recursive: true });

        const baseName = nodePath.basename(meta.path);
        const newRelPath = `99_Arquivo/Esquecido_${baseName}`;
        const newFullPath = nodePath.join(vaultDir, newRelPath);

        try {
          if (nodeFs.existsSync(oldFullPath)) {
            memoryStore.markInternalWrite(meta.path);
            memoryStore.markInternalWrite(newRelPath);
            nodeFs.renameSync(oldFullPath, newFullPath);
          }
        } catch (err) {
          console.error('[MemoryTools] Erro ao mover nota para 99_Arquivo:', err);
        }

        // Remove do índice em RAM
        memoryIndex.removeFileFromIndex(meta.path);

        // Adiciona aos tombstones para nunca mais reextrair
        const tombstonesPath = nodePath.join(vaultDir, '.bitbop', 'tombstones.json');
        try {
          let tombstones = [];
          if (nodeFs.existsSync(tombstonesPath)) {
            tombstones = JSON.parse(nodeFs.readFileSync(tombstonesPath, 'utf8') || '[]');
          }
          tombstones.push({
            termo: query,
            titulo: meta.titulo,
            esquecidoEm: new Date().toISOString()
          });
          nodeFs.writeFileSync(tombstonesPath, JSON.stringify(tombstones, null, 2), 'utf8');
        } catch (err) {
          console.warn('[MemoryTools] Aviso ao registrar tombstone:', err);
        }

        memoryStore.appendDailyEntry({
          titulo: `Esqueceu memória: ${meta.titulo}`,
          texto: `Nota arquivada em [[${newRelPath}]] e termo registrado em tombstones.`
        });

        if (typeof global.setEmotion === 'function') global.setEmotion('SAD', 3000);
        if (global.CuteSynth && typeof global.CuteSynth.sad === 'function') global.CuteSynth.sad();

        const defaultSpeech = `Pronto, esqueci e arquivei a memória sobre "${meta.titulo}".`;
        return {
          ok: true,
          speech_response: (args.speech_response || '').trim() || defaultSpeech
        };
      }

      // ----------------------------------------------------------------------
      // 4. CORRIGIR MEMÓRIA (SUPERAÇÃO SEMÂNTICA)
      // ----------------------------------------------------------------------
      case 'corrigir_memoria': {
        const queryAntiga = String(args.consulta_antiga || '').trim();
        const novoFato = String(args.novo_fato || '').trim();
        console.log(`[MemoryTools] Corrigindo memória: "${queryAntiga}" -> "${novoFato}"`);

        if (!memoryIndex) return { ok: false, error: 'MemoryIndex indisponível' };

        // Localiza nota antiga
        const aliasMap = memoryIndex.findAliasMatches(queryAntiga);
        const bm25Map = memoryIndex.searchBM25(queryAntiga, 3);
        const candidates = [...aliasMap.keys(), ...bm25Map.keys()];

        let oldMeta = null;
        if (candidates.length > 0) {
          oldMeta = memoryIndex.getNoteMetadata(candidates[0]);
        }

        const titulo = oldMeta ? oldMeta.titulo : (queryAntiga.slice(0, 40) || 'Memoria Corrigida');
        const tipo = oldMeta ? oldMeta.tipo : 'preferencia';

        // Grava a nova nota
        const saveRes = processMemoryCall('guardar_memoria', {
          titulo,
          texto: novoFato,
          tipo,
          importancia: oldMeta ? oldMeta.importancia : 8,
          speech_response: args.speech_response
        });

        // Se encontrou a nota antiga em OUTRO caminho e ela não estiver com locked: true,
        // marca a antiga como superada_por apontando para a nova nota diferente.
        // Se for o mesmo arquivo, jamais aponta para si mesma!
        if (oldMeta && !oldMeta.locked && saveRes.ok && saveRes.path && saveRes.path !== oldMeta.path) {
          const oldRead = memoryStore.readNote(oldMeta.path);
          if (oldRead.ok) {
            const updatedFm = { ...oldRead.frontmatter, superada_por: `[[${saveRes.path}]]` };
            memoryStore.writeNote(oldMeta.path, updatedFm, oldRead.body);
          }
        }

        const defaultSpeech = `Entendido! Atualizei a memória sobre "${titulo}" com as informações novas.`;
        return {
          ok: true,
          speech_response: (args.speech_response || '').trim() || defaultSpeech,
          novaNota: saveRes.path
        };
      }

      // ----------------------------------------------------------------------
      // 5. O QUE VOCÊ SABE SOBRE (AUDITORIA E TRANSPARÊNCIA)
      // ----------------------------------------------------------------------
      case 'o_que_voce_sabe_sobre': {
        const assunto = String(args.assunto || '').trim();
        console.log(`[MemoryTools] Auditando conhecimento sobre: "${assunto}"`);

        if (!memoryIndex) return { ok: false, error: 'MemoryIndex indisponível' };

        let list = [];
        if (!assunto || assunto.toLowerCase() === 'tudo' || assunto.toLowerCase() === 'alvaro' || assunto.toLowerCase() === 'mim') {
          list = memoryIndex.getAllNotes().filter((n) => !n.privado && !n.superada_por);
        } else {
          const bm25Map = memoryIndex.searchBM25(assunto, 10);
          const aliasMap = memoryIndex.findAliasMatches(assunto);
          const ids = new Set([...bm25Map.keys(), ...aliasMap.keys()]);
          for (const id of ids) {
            const m = memoryIndex.getNoteMetadata(id);
            if (m && !m.privado && !m.superada_por) list.push(m);
          }
        }

        if (typeof global.setEmotion === 'function') global.setEmotion('HAPPY', 3500);
        if (global.CuteSynth && typeof global.CuteSynth.scan === 'function') global.CuteSynth.scan();

        if (list.length === 0) {
          const defaultEmpty = `Ainda não tenho registros gravados no meu cérebro sobre "${assunto}".`;
          return {
            ok: true,
            total: 0,
            speech_response: (args.speech_response || '').trim() || defaultEmpty
          };
        }

        const titles = list.slice(0, 4).map((n) => n.titulo).join(', ');
        const defaultSpeech = `No meu cérebro do Obsidian, guardo memórias sobre: ${titles}.`;

        if (typeof global.showBubble === 'function') {
          const bubbleText = list.slice(0, 6).map((n) => `📌 <b>${n.titulo}</b> (${n.tipo}):\n${n.resumo_curto}`).join('\n\n');
          global.showBubble('Obsidian 🧠', bubbleText, 8000, false, true);
        }

        return {
          ok: true,
          total: list.length,
          speech_response: (args.speech_response || '').trim() || defaultSpeech,
          memorias: list.slice(0, 6).map((n) => ({
            titulo: n.titulo,
            tipo: n.tipo,
            resumo: n.resumo_curto,
            confianca: n.confianca,
            fonte: n.path
          }))
        };
      }

      // ----------------------------------------------------------------------
      // 6. CRIAR PENDÊNCIA (LOOPS ABERTOS)
      // ----------------------------------------------------------------------
      case 'criar_pendencia': {
        const titulo = (args.titulo || '').trim() || 'Nova Pendência';
        const descricao = (args.descricao || '').trim() || titulo;
        const rawGatilhoValor = (args.gatilho_valor && typeof args.gatilho_valor === 'string' && args.gatilho_valor.trim() !== 'null') ? args.gatilho_valor.trim() : null;
        const gatilhoTipo = args.gatilho_tipo ? args.gatilho_tipo.toLowerCase() : (rawGatilhoValor ? 'data_ou_boot' : 'sem_prazo');
        const now = new Date();
        const isoTimestamp = now.toISOString();
        const dateStr = isoTimestamp.split('T')[0];
        const randHex = Math.random().toString(36).substring(2, 8);
        const id = `pen_${dateStr.replace(/-/g, '')}_${randHex}`;

        const safeName = sanitizeFilename(titulo);
        const relativePath = `06_Pendencias/${safeName}.md`;

        const resumo = rawGatilhoValor 
          ? `${descricao.slice(0, 130)} (Prazo: ${rawGatilhoValor})` 
          : `${descricao.slice(0, 130)} (Sem prazo definido)`;

        const frontmatter = {
          id,
          titulo,
          tipo: 'pendencia',
          status_pendencia: 'aberta',
          gatilho_tipo: gatilhoTipo,
          gatilho_valor: rawGatilhoValor,
          tentativas_acompanhamento: 0,
          aliases: [titulo],
          tags: ['pendencia', 'loop_aberto', gatilhoTipo],
          resumo_curto: resumo,
          criado: isoTimestamp,
          ultimo_acesso: isoTimestamp,
          acessos: 1,
          importancia: 8,
          estabilidade: 7.0,
          confianca: 1.0,
          emocao_oled: 'EXCITED',
          fonte: `[[${dateStr}]]`,
          fonte_origem: 'usuario_explicito',
          superada_por: null,
          locked: false,
          privado: false
        };

        const body = `# Pendência: ${titulo}\n\n**Gatilho:** \`${gatilhoTipo}\` (${rawGatilhoValor || 'Sem data definida'})\n**Registrada em:** [[${dateStr}]]\n\n## Descrição\n${descricao}\n`;

        const writeRes = memoryStore.writeNote(relativePath, frontmatter, body);
        if (!writeRes.ok) {
          return {
            ok: false,
            speech_response: `Não consegui salvar a pendência "${titulo}".`
          };
        }

        if (memoryIndex && typeof memoryIndex.indexSingleFile === 'function') {
          memoryIndex.indexSingleFile(relativePath);
        }

        memoryStore.appendDailyEntry({
          titulo: `Criou pendência: ${titulo}`,
          texto: `Anotada em [[${relativePath}]] com gatilho ${gatilhoTipo} (${gatilhoValor}).`
        });

        memoryStore.appendEventLog({
          tipo: 'criar_pendencia',
          titulo,
          path: relativePath,
          gatilho_valor: gatilhoValor
        });

        if (typeof global.setEmotion === 'function') global.setEmotion('EXCITED', 3500);
        if (global.CuteSynth) {
          if (typeof global.CuteSynth.powerUp === 'function') global.CuteSynth.powerUp();
          else if (typeof global.CuteSynth.happy === 'function') global.CuteSynth.happy();
        }

        if (typeof global.showActionBadge === 'function') global.showActionBadge('📌', 'Criando pendência...', 3200);
        if (typeof global.showBubble === 'function') {
          global.showBubble('Pendência 📌', `📌 <b>${titulo}</b>\n${descricao}`, 4500, false, true);
        }

        const defaultSpeech = `Anotado! Criei a pendência sobre "${titulo}" para te lembrar depois.`;
        return {
          ok: true,
          path: relativePath,
          speech_response: (args.speech_response || '').trim() || defaultSpeech
        };
      }

      // ----------------------------------------------------------------------
      // 7. FECHAR PENDÊNCIA (CONCLUIR LOOP ABERTO)
      // ----------------------------------------------------------------------
      case 'fechar_pendencia': {
        const queryPendencia = String(args.consulta_pendencia || '').trim();
        const desfecho = String(args.desfecho || 'Concluída com sucesso').trim();
        console.log(`[MemoryTools] Fechando pendência: "${queryPendencia}" -> "${desfecho}"`);

        if (!memoryIndex) return { ok: false, error: 'MemoryIndex indisponível' };

        // Localiza a pendência em 06_Pendencias/
        let targetRel = null;
        let targetMeta = null;

        const allNotes = memoryIndex.getAllNotes();
        for (const n of allNotes) {
          if (n.path && n.path.startsWith('06_Pendencias') && !n.superada_por) {
            const normTitle = memoryIndex.normalizeText(n.titulo);
            const normQ = memoryIndex.normalizeText(queryPendencia);
            if (normTitle.includes(normQ) || normQ.includes(normTitle)) {
              targetRel = n.path;
              targetMeta = n;
              break;
            }
          }
        }

        if (!targetRel) {
          const defaultNotFound = `Não encontrei nenhuma pendência aberta correspondente a "${queryPendencia}".`;
          return {
            ok: false,
            speech_response: (args.speech_response || '').trim() || defaultNotFound
          };
        }

        const readRes = memoryStore.readNote(targetRel);
        if (!readRes.ok) {
          return { ok: false, error: 'Erro ao ler arquivo da pendência' };
        }

        const now = new Date();
        const isoTimestamp = now.toISOString();
        const dateStr = isoTimestamp.split('T')[0];

        const updatedFm = {
          ...readRes.frontmatter,
          status_pendencia: 'concluida',
          concluido_em: isoTimestamp,
          desfecho
        };

        const baseName = targetRel.replace(/^.*[\\\/]/, '');
        const newRelPath = `99_Arquivo/Concluido_${baseName}`;

        let updatedBody = readRes.body || '';
        updatedBody += `\n\n---\n**Concluída em:** [[${dateStr}]]\n**Desfecho:** ${desfecho}\n`;

        // Grava no arquivo concluído em 99_Arquivo/
        memoryStore.writeNote(newRelPath, updatedFm, updatedBody);

        // Remove o arquivo antigo de 06_Pendencias/
        try {
          const vaultDir = memoryStore.getVaultPath();
          const nodePath = typeof require !== 'undefined' ? require('path') : null;
          const nodeFs = typeof require !== 'undefined' ? require('fs') : null;
          if (nodePath && nodeFs) {
            const oldFull = nodePath.join(vaultDir, targetRel);
            if (nodeFs.existsSync(oldFull)) nodeFs.unlinkSync(oldFull);
          }
        } catch (delErr) {
          console.warn('[MemoryTools] Aviso ao remover pendência antiga:', delErr);
        }

        // Atualiza o índice
        memoryIndex.removeFileFromIndex(targetRel);
        memoryIndex.indexSingleFile(newRelPath);

        memoryStore.appendDailyEntry({
          titulo: `Pendência Concluída: ${targetMeta.titulo}`,
          texto: `Concluída e arquivada em [[${newRelPath}]]. Desfecho: ${desfecho}`
        });

        memoryStore.appendEventLog({
          tipo: 'fechar_pendencia',
          titulo: targetMeta.titulo,
          desfecho,
          path: newRelPath
        });

        if (typeof global.setEmotion === 'function') global.setEmotion('HAPPY', 3500);
        if (global.CuteSynth) {
          if (typeof global.CuteSynth.happy === 'function') global.CuteSynth.happy();
          else if (typeof global.CuteSynth.powerUp === 'function') global.CuteSynth.powerUp();
        }

        if (typeof global.showActionBadge === 'function') global.showActionBadge('✅', 'Concluindo pendência...', 3200);
        if (typeof global.showBubble === 'function') {
          global.showBubble('Pendência Concluída! ✅', `🎉 <b>${targetMeta.titulo}</b>\n${desfecho}`, 5000, false, true);
        }

        const defaultSpeech = `Show! Marquei a pendência "${targetMeta.titulo}" como concluída.`;
        return {
          ok: true,
          path: newRelPath,
          speech_response: (args.speech_response || '').trim() || defaultSpeech
        };
      }

      default:
        return { ok: false, error: `Função de memória desconhecida: ${name}` };
    }
  }

  const MemoryTools = {
    getGeminiToolDeclarations,
    isMemoryFunction,
    processMemoryCall
  };

  global.MemoryTools = MemoryTools;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryTools;
  }

})(typeof window !== 'undefined' ? window : global);
