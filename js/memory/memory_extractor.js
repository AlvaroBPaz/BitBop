/**
 * ============================================================================
 * MÓDULO: EXTRATOR COGNITIVO ASSÍNCRONO / CAMINHO LENTO (MemoryExtractor)
 * Arquivo: js/memory/memory_extractor.js
 * ============================================================================
 * 
 * Responsabilidades:
 * 1. Operar 100% de forma assíncrona no Caminho Lento (Slow-Path), NUNCA competindo
 *    com a resposta do Gemini nem com o início da fala do BitBop.
 * 2. Enfileirar turnos de diálogo e registrá-los no barramento .bitbop/event_log.jsonl.
 * 3. Disparar a extração SOMENTE após o pet_tts.js terminar de falar, após 90s de silêncio
 *    ou a cada 3 turnos acumulados.
 * 4. Filtro Anti-Alucinação para áudio de terceiros (videoaulas, YouTube, etc.).
 * 5. Extração estruturada JSON via Gemini (gemini-3.1-flash-lite / gemini-3.5-flash-lite).
 * 6. Portão de escrita rigoroso:
 *    - Portão de Importância: descarta fatos com importancia < 4.
 *    - Verificação de Tombstones (.bitbop/tombstones.json).
 *    - Roteamento de Baixa Confiança (< 0.65) para 08_Inbox/.
 *    - Deduplicação inteligente e fusão com notas existentes.
 *    - Resolução de Contradições (superada_por).
 *    - Criação de Procedimentos em 04_Procedimentos/.
 *    - Criação e Fechamento de Pendências em 06_Pendencias/.
 *    - Atualização do Estado Atual em 00_Nucleo/Estado_Atual.md.
 *    - Anotação de Momentos do Dia no Diário (01_Diario/AAAA-MM-DD.md).
 */

(function (global) {
  'use strict';

  const nodeHttps = typeof require !== 'undefined' ? (() => { try { return require('https'); } catch { return null; } })() : null;
  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  // Estado interno do extrator
  const turnQueue = [];
  let isExtracting = false;
  let idleSilenceTimer = null;
  let lastUserInteractionAt = Date.now();

  const IDLE_SILENCE_DELAY_MS = 180 * 1000; // 3 minutos de silêncio (em vez de 90s) para economizar 70% de quota
  const BATCH_SIZE_TRIGGER = 8;             // Agrupa em lotes de 8 turnos (em vez de 3)
  let rateLimitCooldownUntil = 0;           // Cooldown de segurança para evitar rajadas de HTTP 429

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
   * Obtém a chave de API e modelo configurado do Gemini.
   */
  function getGeminiConfig() {
    let apiKey = '';
    let model = 'gemini-3.1-flash-lite';

    // 1. Tenta pegar do global.prefs
    if (global.prefs) {
      apiKey = (global.prefs.geminiApiKey || '').trim();
      if (global.prefs.geminiModel) model = global.prefs.geminiModel;
    }

    // 2. Tenta pegar do arquivo .gemini-config.json se disponível
    if (!apiKey && nodeFs && nodePath) {
      try {
        const configPath = nodePath.resolve(__dirname, '..', '..', '.gemini-config.json');
        if (nodeFs.existsSync(configPath)) {
          const cfg = JSON.parse(nodeFs.readFileSync(configPath, 'utf8'));
          if (cfg.geminiApiKey) apiKey = cfg.geminiApiKey.trim();
          if (cfg.geminiModel) model = cfg.geminiModel;
        }
      } catch {}
    }

    // 3. Fallback para localStorage
    if (!apiKey && typeof localStorage !== 'undefined') {
      apiKey = (localStorage.getItem('sc_gemini_key') || '').trim();
    }

    return { apiKey, model };
  }

  /**
   * Lê a lista de memórias que o usuário mandou esquecer (Tombstones).
   */
  function getTombstones() {
    if (!nodeFs || !nodePath || !global.MemoryStore) return [];
    try {
      const vaultPath = global.MemoryStore.getVaultPath();
      const tombstonesFile = nodePath.join(vaultPath, '.bitbop', 'tombstones.json');
      if (nodeFs.existsSync(tombstonesFile)) {
        return JSON.parse(nodeFs.readFileSync(tombstonesFile, 'utf8')) || [];
      }
    } catch {}
    return [];
  }

  /**
   * Reseta o timer de silêncio de 90 segundos.
   */
  function resetIdleSilenceTimer() {
    if (idleSilenceTimer) {
      clearTimeout(idleSilenceTimer);
      idleSilenceTimer = null;
    }

    idleSilenceTimer = setTimeout(() => {
      console.log('[MemoryExtractor] Timer de silêncio (90s) atingido. Verificando extração em background...');
      triggerBackgroundExtractionIfIdle();
    }, IDLE_SILENCE_DELAY_MS);
  }

  /**
   * Notifica que o usuário interagiu (fala, clique, comando).
   */
  function notifyUserInteraction() {
    lastUserInteractionAt = Date.now();
    if (global.state) {
      global.state.lastUserInteractionAt = lastUserInteractionAt;
    }
    resetIdleSilenceTimer();
  }

  /**
   * Enfileira um novo turno de conversa no barramento.
   */
  function enqueueTurn(turnData) {
    if (!turnData) return;

    // Respeito ao Modo Privado: se ativo, não registra nada
    if (global.state && global.state.privateMode) {
      console.log('[MemoryExtractor] Modo Privado ativo — turno ignorado.');
      return;
    }

    const userTranscript = String(turnData.userTranscript || '').trim();
    const botResponse = String(turnData.botResponse || '').trim();
    const currentEmotion = String(turnData.currentEmotion || 'NORMAL').trim();
    const activeWindowTitle = String(turnData.activeWindowTitle || '').trim();
    let audioSource = String(turnData.audioSource || 'usuario_voz').trim();

    // Filtro Anti-Alucinação para terceiros / videoaulas
    const isStudyActive = Boolean(global.state && global.state.studyMode);
    const isMediaWindow = /YouTube|Udemy|Alura|VLC|Netflix|Spotify|Twitch|Coursera/i.test(activeWindowTitle);
    const hasVocative = /(\bbitbop\b|\bei\b|\bbop\b|\bbit\b)/i.test(userTranscript);

    if ((isStudyActive || isMediaWindow) && !hasVocative) {
      audioSource = 'midia_ambiente';
    }

    const payload = {
      timestamp: new Date().toISOString(),
      userTranscript,
      botResponse,
      currentEmotion,
      activeWindowTitle,
      audioSource
    };

    // 1. Registra no barramento permanente .bitbop/event_log.jsonl
    if (global.MemoryStore && typeof global.MemoryStore.appendEventLog === 'function') {
      global.MemoryStore.appendEventLog({
        tipo: 'dialogo',
        ...payload
      });
    }

    // Só enfileira para extração se houver fala do usuário ou do bot relevante
    if (userTranscript.length >= 2 || botResponse.length >= 4) {
      turnQueue.push(payload);
    }

    notifyUserInteraction();

    // Se acumulou 3 turnos, agenda extração assim que o TTS terminar
    if (turnQueue.length >= BATCH_SIZE_TRIGGER) {
      triggerBackgroundExtractionIfIdle();
    }
  }

  /**
   * Dispara a extração assíncrona em background se o robô estiver ocioso.
   */
  function triggerBackgroundExtractionIfIdle() {
    if (isExtracting) return;

    // Se estiver em Modo Privado, esvazia a fila e encerra
    if (global.state && global.state.privateMode) {
      turnQueue.length = 0;
      return;
    }

    // Não extrai enquanto o robô ou o usuário estiverem falando
    if (global.state && (global.state.isSpeaking || global.state.isUserSpeaking)) {
      return;
    }

    if (turnQueue.length === 0) return;

    // Aguarda um pequeno respiro (600ms) após o término do áudio para não interferir
    setTimeout(() => {
      if (global.state && (global.state.isSpeaking || global.state.isUserSpeaking)) return;
      processQueueAsync();
    }, 600);
  }

  /**
   * Constrói o prompt para o Gemini 3.1 Flash Lite extrair entidades e fatos em JSON.
   */
  function buildExtractionPrompt(turns) {
    const memoryIndex = global.MemoryIndex;
    const existingTitles = memoryIndex ? memoryIndex.getAllNotes().slice(0, 40).map((n) => n.titulo) : [];

    let prompt = `Você é o subsistema de consolidação e extração de memória do BitBop (um robô assistente de desktop).\\n`;
    prompt += `Analise os diálogos recentes entre o Álvaro (usuário) e o BitBop para identificar APENAS fatos duradouros, preferências reais, regras de comportamento ou pendências futuras.\\n\\n`;

    prompt += `[REGRAS FUNDAMENTAIS]\\n`;
    prompt += `1. FILTRO DE ÁUDIO DE TERCEIROS: Se a fonte de áudio for 'midia_ambiente', NUNCA extraia preferências ou fatos pessoais sobre o Álvaro! Trata-se de vídeo ou aula tocando ao fundo.\\n`;
    prompt += `2. PORTÃO DE IMPORTÂNCIA (1 a 10): Trivialidades ("bom dia", "tudo bem", piadas sem contexto) devem ter importancia < 4 ou não ser extraídas. Fatos relevantes (como ele toma café, o que está programando, gostos, amigos, hábitos) recebem importancia >= 5.\\n`;
    prompt += `3. CONTRADIÇÕES: Se o Álvaro disser que mudou de ideia ou retificar algo anterior, aponte em 'contradiz_nota_titulo' o título da nota antiga a ser superada.\\n`;
    prompt += `4. REGRAS PROCEDURAIS: Se o usuário pedir para o BitBop se comportar de certa forma em determinado app (ex: silêncio no VS Code), extraia em 'regras_procedurais'.\\n`;
    prompt += `5. PENDÊNCIAS E TAREFAS:\\n- REGRA CRÍTICA DE DATAS: NUNCA invente datas ou assuma 'amanhã' se o Álvaro NÃO tiver especificado um dia ou prazo explicitamente!\\n  * Se o usuário disser "amanhã preciso fazer X", use a data de amanhã em 'gatilho_valor' (AAAA-MM-DD).\\n  * Se o usuário NÃO disser data (ex: "quero comprar óculos novos", "preciso organizar minhas pastas", "lembre-me de ver X"), use obrigatoriamente "gatilho_tipo": "sem_prazo" e "gatilho_valor": null!\\n- DESEJOS E PREFERÊNCIAS: Expressões como "quero comprar X", "gostaria de ter Y", "minha meta é Z" devem ser extraídas como 'fatos_novos' (tipo: 'preferencia', pasta: '03_Conhecimento/Preferencias'). Só use 'pendencias_novas' se for uma ação/tarefa prática a ser executada.\\n- 'pendencias_resolvidas_titulos': DEIXE VAZIO [] a menos que o Álvaro TENHA AFIRMADO EXPLICITAMENTE NO DIÁLOGO QUE JÁ CONCLUIU A AÇÃO NO MUNDO REAL (ex: "já terminei a pintura", "já entreguei o relatório"). NUNCA marque uma tarefa como resolvida só porque o BitBop confirmou que guardou ou anotou!\\n`;
    prompt += `6. WIKILINKS: Use colchetes duplos [[Nome da Nota]] no corpo para conectar com conceitos existentes.\\n\\n`;

    if (existingTitles.length > 0) {
      prompt += `[NOTAS JÁ EXISTENTES NO VAULT]:\\n${existingTitles.map((t) => `- [[${t}]]`).join('\\n')}\\n\\n`;
    }

    prompt += `[DIÁLOGOS A PROCESSAR]:\\n`;
    for (const t of turns) {
      prompt += `- [${t.audioSource}] [Janela: ${t.activeWindowTitle || 'Desktop'}]\\n`;
      prompt += `  Álvaro: "${t.userTranscript}"\\n`;
      prompt += `  BitBop: "${t.botResponse}"\\n`;
    }

    prompt += `\\nResponda ESTRITAMENTE em formato JSON compatível com este schema:\\n`;
    prompt += `{
  "fatos_novos": [
    {
      "titulo": "String curta",
      "pasta_destino": "03_Conhecimento/Preferencias | 03_Conhecimento/Projetos | 03_Conhecimento/Pessoas | 03_Conhecimento/Conceitos | 03_Conhecimento/Lugares | 02_Episodios",
      "tipo": "preferencia | fato | pessoa | projeto | conceito | lugar | episodio",
      "resumo_curto": "Máximo de 160 caracteres",
      "corpo_markdown": "Texto em 3ª pessoa com [[Wikilinks]]",
      "aliases": ["alias1"],
      "tags": ["tag1"],
      "importancia": 7,
      "confianca": 0.9,
      "emocao_oled": "HAPPY",
      "contradiz_nota_titulo": null
    }
  ],
  "regras_procedurais": [
    {
      "titulo": "Regra",
      "regra": "Descrição da regra",
      "contexto_janela": "NomeDoApp.exe",
      "importancia": 8
    }
  ],
  "pendencias_novas": [
    {
      "titulo": "Tarefa ou Ação",
      "descricao": "O que fazer",
      "gatilho_tipo": "sem_prazo | data_ou_boot | abrir_janela",
      "gatilho_valor": null
    }
  ],
  "pendencias_resolvidas_titulos": [],
  "atualizacao_estado_atual": {
    "humor_bitbop": "EXCITED",
    "clima_recente": "Focado em..."
  },
  "resumo_diario_momento": "Frase curta sobre o que aconteceu para o diário"
}`;

    return prompt;
  }

  /**
   * Envia a requisição de extração JSON ao Gemini de forma assíncrona.
   */
  function callGroqForExtraction(promptText) {
    const groqKey = (global.prefs && global.prefs.groqApiKey) || '';
    if (!groqKey || !nodeHttps) return Promise.resolve(null);

    const bodyStr = JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Você é um extrator cognitivo. Retorne APENAS um objeto JSON válido.' },
        { role: 'user', content: promptText }
      ],
      max_tokens: 600,
      temperature: 0.2
    });

    return new Promise((resolve) => {
      const req = nodeHttps.request(
        {
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'User-Agent': 'StackChan-Pet/2.0'
          }
        },
        (res) => {
          let body = '';
          res.on('data', (d) => { body += d; });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                console.warn(`[MemoryExtractor] Groq fallback HTTP ${res.statusCode}:`, body.slice(0, 160));
                return resolve(null);
              }
              const parsed = JSON.parse(body);
              const content = parsed?.choices?.[0]?.message?.content;
              if (!content) return resolve(null);
              console.log('[MemoryExtractor] Extração realizada com sucesso via Groq Fallback!');
              resolve(JSON.parse(content));
            } catch (e) {
              console.warn('[MemoryExtractor] Falha parseando JSON Groq:', e);
              resolve(null);
            }
          });
        }
      );
      req.setTimeout(12000, () => req.destroy());
      req.on('error', () => resolve(null));
      req.write(bodyStr);
      req.end();
    });
  }

  async function callGeminiForExtraction(promptText) {
    const { apiKey, model } = getGeminiConfig();
    if (!apiKey) {
      console.warn('[MemoryExtractor] Chave de API do Gemini não configurada — extração ignorada.');
      return null;
    }

    const payload = JSON.stringify({
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    return new Promise((resolve) => {
      if (!nodeHttps) {
        // Fallback para fetch no navegador
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        })
          .then((res) => res.json())
          .then((data) => {
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve(raw ? JSON.parse(raw) : null);
          })
          .catch((err) => {
            console.warn('[MemoryExtractor] Erro na chamada fetch ao Gemini:', err);
            resolve(null);
          });
        return;
      }

      const req = nodeHttps.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', async () => {
            try {
              if (res.statusCode === 429) {
                console.warn('[MemoryExtractor] Cota do Gemini atingida (HTTP 429). Acionando Groq Fallback...');
                rateLimitCooldownUntil = Date.now() + 65 * 1000;
                const groqRes = await callGroqForExtraction(promptText);
                return resolve(groqRes);
              }
              if (res.statusCode !== 200) {
                console.warn(`[MemoryExtractor] Gemini respondeu HTTP ${res.statusCode}:`, body.slice(0, 200));
                const groqRes = await callGroqForExtraction(promptText);
                return resolve(groqRes);
              }
              const jsonResp = JSON.parse(body);
              const text = jsonResp?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (!text) return resolve(null);
              resolve(JSON.parse(text));
            } catch (err) {
              console.warn('[MemoryExtractor] Falha ao processar JSON do Gemini:', err);
              resolve(null);
            }
          });
        }
      );

      req.on('error', (err) => {
        console.warn('[MemoryExtractor] Erro de rede com Gemini:', err.message);
        resolve(null);
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Aplica o resultado da extração com todos os portões de escrita e deduplicação.
   */
  function applyExtractionResult(result, turnsToProcess = []) {
    if (!result || typeof result !== 'object') return;

    const memoryStore = global.MemoryStore;
    const memoryIndex = global.MemoryIndex;
    if (!memoryStore) return;

    const tombstones = getTombstones();
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const dateStr = isoTimestamp.split('T')[0];

    // ------------------------------------------------------------------------
    // 1. FATOS NOVOS
    // ------------------------------------------------------------------------
    const fatos = Array.isArray(result.fatos_novos) ? result.fatos_novos : [];
    for (const fato of fatos) {
      const importancia = typeof fato.importancia === 'number' ? fato.importancia : 5;

      // Portão 1: Importância < 4 é descartada
      if (importancia < 4) {
        continue;
      }

      const titulo = (fato.titulo || '').trim();
      if (!titulo) continue;

      // Portão 2: Verificação de Tombstone
      const isTombstoned = tombstones.some((t) => {
        const termStr = String((t && typeof t === 'object') ? (t.termo || t.titulo || '') : (t || '')).toLowerCase().trim();
        if (!termStr) return false;
        return titulo.toLowerCase().includes(termStr) || termStr.includes(titulo.toLowerCase());
      });
      if (isTombstoned) {
        console.log(`[MemoryExtractor] Fato ignorado por estar em tombstones: "${titulo}"`);
        continue;
      }

      // Portão 3: Roteamento de Baixa Confiança (< 0.65) para 08_Inbox/
      const confianca = typeof fato.confianca === 'number' ? fato.confianca : 0.9;
      let targetFolder = fato.pasta_destino || '03_Conhecimento/Preferencias';
      if (confianca < 0.65) {
        targetFolder = '08_Inbox';
      }

      const safeName = sanitizeFilename(titulo);
      const relativePath = `${targetFolder}/${safeName}.md`;

      // Portão 4 & 5: Deduplicação e Resolução de Contradições
      let existingNote = null;
      if (memoryIndex) {
        const aliasMatches = memoryIndex.findAliasMatches(titulo);
        const bm25Matches = memoryIndex.searchBM25(titulo, 1);
        const candidates = [...aliasMatches.keys(), ...bm25Matches.keys()];
        if (candidates.length > 0) {
          existingNote = memoryIndex.getNoteMetadata(candidates[0]);
        }
      }

      // Se for contradição declarada
      if (fato.contradiz_nota_titulo && memoryIndex) {
        const oldMatches = memoryIndex.findAliasMatches(fato.contradiz_nota_titulo);
        if (oldMatches.size > 0) {
          const oldId = oldMatches.keys().next().value;
          const oldMeta = memoryIndex.getNoteMetadata(oldId);
          if (oldMeta && !oldMeta.locked && oldMeta.path !== relativePath) {
            const oldRead = memoryStore.readNote(oldMeta.path);
            if (oldRead.ok) {
              const updatedFm = { ...oldRead.frontmatter, superada_por: `[[${relativePath}]]` };
              memoryStore.writeNote(oldMeta.path, updatedFm, oldRead.body);
              console.log(`[MemoryExtractor] Nota antiga superada: "${oldMeta.path}" -> [[${relativePath}]]`);
            }
          }
        }
      } else if (existingNote && !fato.contradiz_nota_titulo) {
        // Se já existe e NÃO é contradição: DEDUPLICA e incrementa acessos/importância
        const readExisting = memoryStore.readNote(existingNote.path);
        if (readExisting.ok && !readExisting.frontmatter.locked) {
          const fm = { ...readExisting.frontmatter };
          fm.acessos = (fm.acessos || 1) + 1;
          fm.importancia = Math.min(10, (fm.importancia || 7) + 1);
          fm.ultimo_acesso = isoTimestamp;

          // Se tiver conteúdo novo no corpo, anexa ao final
          let body = readExisting.body || '';
          const newText = (fato.corpo_markdown || fato.resumo_curto || '').trim();
          if (newText && !body.includes(newText)) {
            body += `\n\n- [[${dateStr}]]: ${newText}`;
          }

          memoryStore.writeNote(existingNote.path, fm, body);
          if (memoryIndex) memoryIndex.indexSingleFile(existingNote.path);
          console.log(`[MemoryExtractor] Nota existente reforçada e atualizada: "${existingNote.path}"`);
          continue;
        }
      }

      // Cria a nota atômica nova
      const randHex = Math.random().toString(36).substring(2, 8);
      const id = `mem_${dateStr.replace(/-/g, '')}_${randHex}`;
      const frontmatter = {
        id,
        titulo,
        tipo: fato.tipo || 'preferencia',
        aliases: Array.isArray(fato.aliases) ? fato.aliases : [titulo],
        tags: Array.isArray(fato.tags) ? fato.tags : [],
        resumo_curto: (fato.resumo_curto || titulo).slice(0, 160).replace(/\r?\n/g, ' '),
        criado: isoTimestamp,
        ultimo_acesso: isoTimestamp,
        acessos: 1,
        importancia,
        estabilidade: 7.0,
        confianca,
        emocao_oled: fato.emocao_oled || 'HAPPY',
        fonte: `[[${dateStr}]]`,
        fonte_origem: 'usuario_voz',
        superada_por: null,
        locked: false,
        privado: false
      };

      const bodyText = fato.corpo_markdown || fato.resumo_curto || titulo;
      const writeRes = memoryStore.writeNote(relativePath, frontmatter, bodyText);
      if (writeRes.ok) {
        if (memoryIndex) memoryIndex.indexSingleFile(relativePath);
        console.log(`[MemoryExtractor] Nova memória extraída e gravada: "${relativePath}" (${titulo})`);
      }
    }

    // ------------------------------------------------------------------------
    // 2. REGRAS PROCEDURAIS (04_Procedimentos/)
    // ------------------------------------------------------------------------
    const procedimentos = Array.isArray(result.regras_procedurais) ? result.regras_procedurais : [];
    for (const proc of procedimentos) {
      if ((proc.importancia || 7) < 4) continue;
      const titulo = (proc.titulo || 'Regra de Contexto').trim();
      const safeName = sanitizeFilename(titulo);
      const relativePath = `04_Procedimentos/${safeName}.md`;

      const randHex = Math.random().toString(36).substring(2, 8);
      const id = `proc_${dateStr.replace(/-/g, '')}_${randHex}`;
      const frontmatter = {
        id,
        titulo,
        tipo: 'procedimento',
        contexto_janela: proc.contexto_janela || 'Geral',
        importancia: proc.importancia || 8,
        confianca: 1.0,
        criado: isoTimestamp,
        ultimo_acesso: isoTimestamp,
        acessos: 1,
        fonte: `[[${dateStr}]]`,
        locked: false
      };

      const body = `# Procedimento: ${titulo}\n\n**Contexto:** \`${proc.contexto_janela || 'Geral'}\`\n\n## Regra\n${proc.regra || titulo}\n`;
      const writeRes = memoryStore.writeNote(relativePath, frontmatter, body);
      if (writeRes.ok && memoryIndex) {
        memoryIndex.indexSingleFile(relativePath);
        console.log(`[MemoryExtractor] Procedimento salvo em: "${relativePath}"`);
      }
    }

    // ------------------------------------------------------------------------
    // 3. PENDÊNCIAS NOVAS (06_Pendencias/)
    // ------------------------------------------------------------------------
    const pendencias = Array.isArray(result.pendencias_novas) ? result.pendencias_novas : [];
    for (const p of pendencias) {
      const titulo = (p.titulo || 'Nova Tarefa').trim();
      const safeName = sanitizeFilename(titulo);
      const relativePath = `06_Pendencias/${safeName}.md`;

      const randHex = Math.random().toString(36).substring(2, 8);
      const id = `pen_${dateStr.replace(/-/g, '')}_${randHex}`;
      const rawGatilhoValor = (p.gatilho_valor && typeof p.gatilho_valor === 'string' && p.gatilho_valor.trim() !== 'null') ? p.gatilho_valor.trim() : null;
      const gatilhoTipo = p.gatilho_tipo || (rawGatilhoValor ? 'data_ou_boot' : 'sem_prazo');
      const desc = p.descricao || titulo;
      const resumo = rawGatilhoValor 
        ? `${desc.slice(0, 130)} (Prazo: ${rawGatilhoValor})` 
        : `${desc.slice(0, 130)} (Sem prazo definido)`;

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
        locked: false
      };

      const body = `# Pendência: ${titulo}\n\n**Gatilho:** \`${gatilhoTipo}\` (${rawGatilhoValor || 'Sem data definida'})\n**Registrada em:** [[${dateStr}]]\n\n## Descrição\n${desc}\n`;
      const writeRes = memoryStore.writeNote(relativePath, frontmatter, body);
      if (writeRes.ok && memoryIndex) {
        memoryIndex.indexSingleFile(relativePath);
        console.log(`[MemoryExtractor] Pendência salva em: "${relativePath}" (Gatilho: ${gatilhoTipo} / ${rawGatilhoValor})`);
      }
    }

    // ------------------------------------------------------------------------
    // 4. PENDÊNCIAS RESOLVIDAS (COM PROTEÇÃO CONTRA FECHAMENTO PRECOCE)
    // ------------------------------------------------------------------------
    const resolvidas = Array.isArray(result.pendencias_resolvidas_titulos) ? result.pendencias_resolvidas_titulos : [];
    const todayStr = isoTimestamp.split('T')[0];
    const userUtterances = turnsToProcess.map((t) => t.userTranscript || '').join(' ');
    const explicitCompletionRx = /\b(terminei|conclui|concluí|já fiz|ja fiz|já acabei|ja acabei|já pintei|ja pintei|já resolvi|ja resolvi|está feito|esta feito|está pronto|esta pronto)\b/i;

    for (const t of resolvidas) {
      const term = String((t && typeof t === 'object') ? (t.titulo || t.termo || '') : (t || '')).trim();
      if (!term) continue;

      // Localiza a pendência no Vault/Índice para checar gatilho e data
      let targetNote = null;
      if (memoryIndex) {
        const allNotes = memoryIndex.getAllNotes();
        for (const n of allNotes) {
          if (n.path && n.path.startsWith('06_Pendencias') && !n.superada_por) {
            const normTitle = memoryIndex.normalizeText(n.titulo);
            const normQ = memoryIndex.normalizeText(term);
            if (normTitle.includes(normQ) || normQ.includes(normTitle)) {
              targetNote = n;
              break;
            }
          }
        }
      }

      if (targetNote) {
        // Guarda 1: Se a pendência possui gatilho no futuro (ex: amanhã), nunca fechar automaticamente hoje
        if (targetNote.gatilho_valor && typeof targetNote.gatilho_valor === 'string') {
          if (/^\d{4}-\d{2}-\d{2}$/.test(targetNote.gatilho_valor) && targetNote.gatilho_valor > todayStr) {
            console.log(`[MemoryExtractor] Bloqueado fechamento de "${term}": gatilho futuro (${targetNote.gatilho_valor} > ${todayStr}).`);
            continue;
          }
        }

        // Guarda 2: Se foi criada há menos de 30 minutos, só fecha se houver confirmação explícita de conclusão no diálogo
        const createdAt = targetNote.criado ? new Date(targetNote.criado).getTime() : 0;
        const ageMinutes = (Date.now() - createdAt) / 60000;
        if (ageMinutes < 30 && !explicitCompletionRx.test(userUtterances)) {
          console.log(`[MemoryExtractor] Bloqueado fechamento precoce de "${term}" (criada há ${Math.round(ageMinutes)}min) sem confirmação explícita de conclusão.`);
          continue;
        }
      }

      if (global.MemoryTools && typeof global.MemoryTools.processMemoryCall === 'function') {
        global.MemoryTools.processMemoryCall('fechar_pendencia', {
          consulta_pendencia: term,
          desfecho: 'Concluído conforme diálogo recente'
        });
      }
    }

    // ------------------------------------------------------------------------
    // 5. ATUALIZAÇÃO DO ESTADO ATUAL (00_Nucleo/Estado_Atual.md)
    // ------------------------------------------------------------------------
    if (result.atualizacao_estado_atual && typeof result.atualizacao_estado_atual === 'object') {
      const { humor_bitbop, clima_recente } = result.atualizacao_estado_atual;
      if (humor_bitbop || clima_recente) {
        const readEstado = memoryStore.readNote('00_Nucleo/Estado_Atual.md');
        if (readEstado.ok) {
          const fm = { ...readEstado.frontmatter, ultimo_acesso: isoTimestamp };
          let body = readEstado.body || '';
          if (humor_bitbop) {
            body = body.replace(/- \*\*Humor Dominante BitBop:\*\* .*/g, `- **Humor Dominante BitBop:** ${humor_bitbop}`);
          }
          if (clima_recente) {
            body = body.replace(/- \*\*Clima Recente.*:\*\* .*/g, `- **Clima Recente (Últimas 48h):** ${clima_recente}`);
          }
          memoryStore.writeNote('00_Nucleo/Estado_Atual.md', fm, body, { forceOverrideLock: true });
          memoryStore.invalidateCoreCache();
        }
      }
    }

    // ------------------------------------------------------------------------
    // 6. RESUMO DIÁRIO DO MOMENTO (01_Diario/AAAA-MM-DD.md)
    // ------------------------------------------------------------------------
    if (result.resumo_diario_momento && typeof result.resumo_diario_momento === 'string') {
      const cleanMomento = result.resumo_diario_momento.trim();
      if (cleanMomento.length > 5) {
        memoryStore.appendDailyEntry({
          titulo: 'Interação Relevante',
          texto: cleanMomento
        });
      }
    }
  }

  /**
   * Processa a fila de turnos em segundo plano de forma assíncrona.
   */
  async function processQueueAsync() {
    if (turnQueue.length === 0 || isExtracting) return;
    if (Date.now() < rateLimitCooldownUntil) {
      console.log(`[MemoryExtractor] Em cooldown de rate-limit por mais ${Math.round((rateLimitCooldownUntil - Date.now()) / 1000)}s. Turnos preservados na fila.`);
      return;
    }
    isExtracting = true;

    const turnsToProcess = turnQueue.splice(0, turnQueue.length);
    console.log(`[MemoryExtractor] Iniciando extração assíncrona para ${turnsToProcess.length} turno(s)...`);

    try {
      const prompt = buildExtractionPrompt(turnsToProcess);
      const result = await callGeminiForExtraction(prompt);
      if (result) {
        applyExtractionResult(result, turnsToProcess);
        console.log('[MemoryExtractor] Extração e consolidação concluídas com sucesso.');
      } else {
        // Preserva os turnos para não perder memórias
        turnQueue.unshift(...turnsToProcess);
      }
    } catch (err) {
      console.warn('[MemoryExtractor] Falha na execução da extração:', err);
      turnQueue.unshift(...turnsToProcess);
    } finally {
      isExtracting = false;
      // Se novos turnos chegaram durante a extração, reavalia
      if (turnQueue.length >= BATCH_SIZE_TRIGGER) {
        triggerBackgroundExtractionIfIdle();
      }
    }
  }

  const MemoryExtractor = {
    enqueueTurn,
    notifyUserInteraction,
    triggerBackgroundExtractionIfIdle,
    processQueueAsync,
    isExtracting: () => isExtracting,
    getQueueLength: () => turnQueue.length
  };

  global.MemoryExtractor = MemoryExtractor;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryExtractor;
  }

})(typeof window !== 'undefined' ? window : global);
