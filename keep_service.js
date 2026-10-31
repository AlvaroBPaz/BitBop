/**
 * ============================================================================
 * MÓDULO: INTEGRAÇÃO BIDIRECIONAL COM GOOGLE KEEP (GoogleKeepService)
 * Arquivo: keep_service.js
 * ============================================================================
 * 
 * Funcionalidades:
 * 1. Ferramentas (Tool Calling) oficiais para gemini-3.1-flash-lite:
 *    - criar_nota_keep(title, content, is_list, speech_response)
 *    - ler_notas_keep(search_query, limit, speech_response)
 *    - adicionar_em_nota_keep(search_query, new_content, speech_response)
 * 2. Cache Local com Leitura Instantânea (0ms):
 *    - Persistência síncrona/imediata em keep_notes_sync.json e keep_notes_cache.json.
 *    - Injeção das notas mais recentes no System Prompt para o Gemini ter memória contextual.
 * 3. Sincronização em Nuvem em Background (Assíncrona sem travar 60 FPS):
 *    - Envio via Webhook Google Apps Script (GOOGLE_KEEP_WEBHOOK_URL ou GOOGLE_CALENDAR_WEBHOOK_URL).
 *    - Ponte opcional com gkeepapi (Python) via Master Token se configurado no .env.
 * 4. 100% resiliente: funciona offline ou online sem apresentar erros na interface.
 */

(function (global) {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;
  const nodeHttps = typeof require !== 'undefined' ? (() => { try { return require('https'); } catch { return null; } })() : null;
  const nodeHttp = typeof require !== 'undefined' ? (() => { try { return require('http'); } catch { return null; } })() : null;
  const nodeChildProcess = typeof require !== 'undefined' ? (() => { try { return require('child_process'); } catch { return null; } })() : null;

  const BASE_DIR = nodePath && typeof __dirname !== 'undefined' ? __dirname : '.';
  const SYNC_FILE_PATH = nodePath ? nodePath.join(BASE_DIR, 'keep_notes_sync.json') : 'keep_notes_sync.json';
  const CACHE_FILE_PATH = nodePath ? nodePath.join(BASE_DIR, 'keep_notes_cache.json') : 'keep_notes_cache.json';
  const ENV_PATHS = [];
  if (nodePath) {
    ENV_PATHS.push(nodePath.join(BASE_DIR, '.env'));
    ENV_PATHS.push(nodePath.join(BASE_DIR, '..', '.env'));
  }

  let ctx = null;
  let cachedWebhookUrl = '';
  let inMemoryStore = {
    version: 1,
    updated_at: new Date().toISOString(),
    notes: [],
  };

  /**
   * Lê variáveis do arquivo .env
   */
  function readEnvVar(varName) {
    if (typeof process !== 'undefined' && process.env && process.env[varName]) {
      return String(process.env[varName]).trim();
    }
    if (!nodeFs) return '';
    for (const p of ENV_PATHS) {
      try {
        if (nodeFs.existsSync(p)) {
          const content = nodeFs.readFileSync(p, 'utf8');
          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const match = trimmed.match(new RegExp(`^${varName}\\s*=\\s*(.*)$`));
            if (match) {
              const rawVal = match[1].trim().replace(/^["']|["']$/g, '');
              if (rawVal) return rawVal;
            }
          }
        }
      } catch (err) {
        console.warn(`[GoogleKeepService] Erro ao ler ${varName} do .env:`, err.message);
      }
    }
    return '';
  }

  function saveEnvVar(varName, value) {
    if (!nodeFs || ENV_PATHS.length === 0) return;
    const cleanVal = String(value || '').trim();
    const primaryEnvPath = ENV_PATHS[0];
    try {
      let content = '';
      if (nodeFs.existsSync(primaryEnvPath)) {
        content = nodeFs.readFileSync(primaryEnvPath, 'utf8');
      }
      const rx = new RegExp(`^${varName}\\s*=.*$`, 'm');
      if (rx.test(content)) {
        content = content.replace(rx, `${varName}=${cleanVal}`);
      } else {
        const prefix = content && !content.endsWith('\n') ? '\n' : '';
        content += `${prefix}${varName}=${cleanVal}\n`;
      }
      nodeFs.writeFileSync(primaryEnvPath, content, 'utf8');
    } catch (err) {
      console.warn(`[GoogleKeepService] Não foi possível salvar ${varName} no .env:`, err.message);
    }
  }

  /**
   * Obtém a URL do Webhook do Google Apps Script (Keep dedicado ou Calendar compartilhado)
   */
  function getWebhookUrl() {
    const keepUrl = readEnvVar('GOOGLE_KEEP_WEBHOOK_URL');
    if (keepUrl) {
      cachedWebhookUrl = keepUrl;
      return keepUrl;
    }
    if (ctx && ctx.prefs && ctx.prefs.googleKeepWebhookUrl) {
      return String(ctx.prefs.googleKeepWebhookUrl).trim();
    }
    // Fallback para o webhook de Agenda existente (que agora também suporta Keep!)
    const calUrl = readEnvVar('GOOGLE_CALENDAR_WEBHOOK_URL');
    if (calUrl) return calUrl;
    if (ctx && ctx.prefs && ctx.prefs.googleCalendarWebhookUrl) {
      return String(ctx.prefs.googleCalendarWebhookUrl).trim();
    }
    return cachedWebhookUrl || '';
  }

  function setWebhookUrl(url) {
    const clean = String(url || '').trim();
    cachedWebhookUrl = clean;
    if (ctx && ctx.prefs) {
      ctx.prefs.googleKeepWebhookUrl = clean;
    }
    saveEnvVar('GOOGLE_KEEP_WEBHOOK_URL', clean);
  }

  /**
   * Carrega notas salvas no cache local em disco (0ms)
   */
  function loadLocalNotes() {
    if (!nodeFs) return inMemoryStore.notes;
    try {
      // 1. Prioridade máxima: se o KeepDesktop local possui as notas sincronizadas da conta do usuário
      const keepDesktopPath = nodePath && process.env.APPDATA ? nodePath.join(process.env.APPDATA, 'KeepDesktop', 'notes.json') : null;
      if (keepDesktopPath && nodeFs.existsSync(keepDesktopPath)) {
        try {
          const kdRaw = nodeFs.readFileSync(keepDesktopPath, 'utf8');
          const kdObj = JSON.parse(kdRaw);
          if (kdObj && typeof kdObj === 'object') {
            const kdNotes = Object.values(kdObj).map((it) => ({
              id: it.id,
              title: it.title || 'Sem Título',
              content: it.text || it.content || '',
              is_list: Boolean(it.is_list),
              updated_at: it.timestamps || new Date().toISOString(),
            }));
            if (kdNotes.length > 0) {
              inMemoryStore = {
                version: 1,
                updated_at: new Date().toISOString(),
                notes: kdNotes,
              };
              return inMemoryStore.notes;
            }
          }
        } catch (e) {
          console.warn('[GoogleKeepService] Falha lendo KeepDesktop/notes.json:', e.message);
        }
      }

      // 2. Arquivo de sincronização oficial do BitBop (gerado via gkeepapi bridge)
      let content = '';
      if (nodeFs.existsSync(SYNC_FILE_PATH)) {
        content = nodeFs.readFileSync(SYNC_FILE_PATH, 'utf8');
      } else if (nodeFs.existsSync(CACHE_FILE_PATH)) {
        content = nodeFs.readFileSync(CACHE_FILE_PATH, 'utf8');
      }

      if (content) {
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.notes) && parsed.notes.length > 0) {
          inMemoryStore = parsed;
          return inMemoryStore.notes;
        }
      }
    } catch (err) {
      console.warn('[GoogleKeepService] Falha ao ler cache local de notas:', err.message);
    }

    return inMemoryStore.notes;
  }

  /**
   * Persiste as notas síncrona e imediatamente no disco
   */
  function persistLocalNotes() {
    inMemoryStore.updated_at = new Date().toISOString();
    const jsonStr = JSON.stringify(inMemoryStore, null, 2);

    if (nodeFs) {
      try {
        nodeFs.writeFileSync(SYNC_FILE_PATH, jsonStr, 'utf8');
      } catch (err) {
        console.warn('[GoogleKeepService] Erro ao gravar keep_notes_sync.json:', err.message);
      }
      try {
        nodeFs.writeFileSync(CACHE_FILE_PATH, jsonStr, 'utf8');
      } catch {}
    }

    try {
      localStorage.setItem('sc_keep_notes_cache', jsonStr);
    } catch {}
  }

  /**
   * Normalização de busca (sem acentos e minúsculo)
   */
  function normalizeText(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /**
   * 1. FERRAMENTAS DO GOOGLE KEEP PARA GEMINI (Tool Calling)
   */
  function getGeminiToolDeclarations() {
    return [
      {
        name: 'criar_nota_keep',
        description:
          'Cria uma nova nota de texto ou lista no Google Keep quando o usuário pedir por voz ("Anota no Keep...", "Salva uma nota no Google Keep sobre...", "Cria uma lista no Keep com...").',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: {
              type: 'STRING',
              description: 'Título objetivo e curto da nota no Google Keep (ex: "Lista de Compras", "Resumo de Algoritmos", "Ideias de Projeto").',
            },
            content: {
              type: 'STRING',
              description: 'Conteúdo textual completo da nota ou itens da lista separados por quebras de linha ou tópicos.',
            },
            is_list: {
              type: 'BOOLEAN',
              description: 'True se for uma lista de tarefas/itens marcáveis (checklist), False se for uma nota de texto livre.',
            },
            speech_response: {
              type: 'STRING',
              description: 'Frase curta e direta confirmando o salvamento para ser falada pelo companion (ex: "Anotei no seu Keep: Lista de Compras.").',
            },
          },
          required: ['title', 'content', 'is_list', 'speech_response'],
        },
      },
      {
        name: 'ler_notas_keep',
        description:
          'Busca e lê notas salvas no Google Keep quando o usuário perguntar ("Lê minhas notas do Keep", "O que eu anotei no Keep sobre X?", "Pega minha última nota do Keep").',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_query: {
              type: 'STRING',
              description: 'Palavra-chave, título ou assunto da nota a buscar. Envie vazio ("") para buscar as notas mais recentes.',
            },
            limit: {
              type: 'INTEGER',
              description: 'Quantidade máxima de notas a recuperar (padrão: 3).',
            },
            speech_response: {
              type: 'STRING',
              description: 'Frase introdutória curta para o balão de fala antes da leitura.',
            },
          },
          required: ['search_query'],
        },
      },
      {
        name: 'adicionar_em_nota_keep',
        description:
          'Acrescenta novo item ou parágrafo no final de uma nota já existente no Google Keep ("Adiciona X na minha nota de Y lá no Keep").',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_query: {
              type: 'STRING',
              description: 'Título, nome ou termo que identifique a nota existente onde adicionar o item.',
            },
            new_content: {
              type: 'STRING',
              description: 'Novo texto, parágrafo ou item de checklist a ser inserido na nota.',
            },
            speech_response: {
              type: 'STRING',
              description: 'Frase curta confirmando a adição (ex: "Adicionei Pão na sua nota de Compras no Keep.").',
            },
          },
          required: ['search_query', 'new_content', 'speech_response'],
        },
      },
    ];
  }

  function isKeepFunction(name) {
    return (
      name === 'criar_nota_keep' ||
      name === 'ler_notas_keep' ||
      name === 'adicionar_em_nota_keep'
    );
  }

  /**
   * Constrói contexto de notas recentes para injeção no System Prompt do Gemini
   */
  function buildKeepContext() {
    const notes = loadLocalNotes();
    if (!notes || notes.length === 0) {
      return (
        `\n[GOOGLE KEEP (NOTAS & LISTAS)]\n` +
        `- Nenhuma nota salva recentemente no momento.\n` +
        `INSTRUÇÕES: Use "criar_nota_keep" quando o usuário pedir para anotar, criar nota ou lista no Keep. Use "ler_notas_keep" quando ele perguntar o que anotou ou pedir para ler notas.`
      );
    }

    const itemsText = notes.slice(0, 8)
      .map((n) => {
        const typeStr = n.is_list ? 'Lista' : 'Nota';
        const cleanContent = (n.content || '').replace(/\s+/g, ' ').slice(0, 160);
        return `- [${typeStr}] "${n.title}": ${cleanContent}`;
      })
      .join('\n');

    return (
      `\n[GOOGLE KEEP (MEMÓRIA DE NOTAS REAIS DO USUÁRIO)]\n` +
      `${itemsText}\n` +
      `DIRETRIZES MANDATÓRIAS KEEP:\n` +
      `1. Se o usuário perguntar o que tem no Keep, quais as notas dele, ou pedir para ler qualquer nota ("o que tem no Keep?", "lê a nota da ata de educação infantil", "quais minhas senhas?", "quais os números das licitações?"), invoque "ler_notas_keep" passando search_query com o assunto ou título da nota, ou leia diretamente os dados listados acima com concisão e precisão.\n` +
      `2. Se o usuário pedir para criar, anotar ou salvar algo novo no Keep ("Anota no Keep...", "Salva uma nota..."), chame "criar_nota_keep".\n` +
      `3. Se o usuário pedir para adicionar algo em nota existente ("Adiciona X na nota Y"), chame "adicionar_em_nota_keep".`
    );
  }

  /**
   * Busca notas no cache local (0ms)
   */
  function searchNotes(query = '', limit = 3) {
    const notes = loadLocalNotes();
    const max = Math.max(1, Math.min(10, Number(limit) || 3));
    const cleanQ = normalizeText(query);

    if (!cleanQ || cleanQ === '*' || cleanQ === 'todas') {
      return notes.slice(-max).reverse();
    }

    const matched = notes.filter((n) => {
      const matchTitle = normalizeText(n.title).includes(cleanQ);
      const matchContent = normalizeText(n.content).includes(cleanQ);
      return matchTitle || matchContent;
    });

    return matched.slice(-max).reverse();
  }

  /**
   * Cria uma nova nota localmente e agenda sincronização na nuvem
   */
  function createNote(args = {}) {
    const title = String(args.title || 'Nova Nota').trim();
    const content = String(args.content || '').trim();
    const is_list = Boolean(args.is_list);
    const speech_response = String(args.speech_response || `Anotei no seu Keep: ${title}.`).trim();

    const newNote = {
      id: `keep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      content,
      is_list,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: false,
    };

    loadLocalNotes();
    inMemoryStore.notes.push(newNote);
    persistLocalNotes();

    // Feedback visual imediato na tela
    if (ctx) {
      if (typeof ctx.CuteSynth?.happy === 'function') ctx.CuteSynth.happy();
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('📝', 0, 10);
      if (typeof ctx.showActionBadge === 'function') ctx.showActionBadge('📝', 'Anotando no Keep...', 3200);
      if (typeof ctx.showBubble === 'function') {
        const preview = content.length > 80 ? content.slice(0, 77) + '...' : content;
        ctx.showBubble('Google Keep 📝', `📌 ${title}\n${preview}`, 4500, false, true);
      }
    }

    // Se o Modo Estudo estiver ativo (ou se for nota de resumo/estudo), espelha em 05_Estudo/ no Obsidian com repetição espaçada SM-2
    if (typeof window !== 'undefined' && window.MemoryStore && typeof window.MemoryStore.saveStudySummary === 'function') {
      const isStudy = Boolean(window.state && window.state.studyMode) || title.toLowerCase().includes('resumo') || title.toLowerCase().includes('estudo');
      if (isStudy) {
        try {
          window.MemoryStore.saveStudySummary({
            titulo: title,
            materia: (window.state && window.state.currentSubject) || 'Engenharia de Software',
            resumoMarkdown: content,
            questoesRevisao: ''
          });
          console.log(`[GoogleKeepService] Cópia sincronizada em 05_Estudo/ no Obsidian: "${title}"`);
        } catch (obsErr) {
          console.warn('[GoogleKeepService] Falha ao espelhar resumo no Obsidian:', obsErr);
        }
      }
    }

    // NOVO: Hipocampo em Tempo Real (Parte 1 da Arquitetura Cognitiva)
    const hippo = (typeof window !== 'undefined' && window.HippocampusLogger) || (typeof global !== 'undefined' && global.HippocampusLogger);
    if (hippo && typeof hippo.recordDailyEvent === 'function') {
      try {
        hippo.recordDailyEvent({
          categoria: 'AGENDA_KEEP',
          emocao: 'HAPPY',
          titulo: `Nota criada no Google Keep: ${title}`,
          detalhes: content,
          links: [title],
          appAtivo: 'Google Keep'
        }).catch(() => {});

        if (content && content.length > 25) {
          const isKnowledge = /conceito|tecnologia|estudo|codigo|dev|arquitetura|projeto|padrao/i.test(title + ' ' + content);
          hippo.recordKnowledgeOrMemory({
            tipo: isKnowledge ? 'conhecimento' : 'memoria',
            titulo: `Keep: ${title}`,
            conteudo: `### Nota do Google Keep\n**Título:** ${title}\n**Criada em:** ${new Date().toISOString()}\n\n${content}`,
            categoria: isKnowledge ? 'Conhecimento' : 'Google Keep',
            resumo_curto: content.slice(0, 100),
            tags: ['keep', isKnowledge ? 'conhecimento' : 'nota'],
            links: []
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[GoogleKeepService] Falha ao notificar Hipocampo:', err);
      }
    }

    // Sincronização assíncrona na nuvem (sem travar 60 FPS)
    dispatchCloudSync('create_note', newNote).catch(() => {});

    return {
      ok: true,
      note: newNote,
      speech_response,
    };
  }

  /**
   * Adiciona conteúdo em nota existente
   */
  function appendToNote(args = {}) {
    const query = String(args.search_query || '').trim();
    const newContent = String(args.new_content || '').trim();
    const rawSpeech = String(args.speech_response || '').trim();

    loadLocalNotes();
    const cleanQ = normalizeText(query);
    let targetNote = null;

    // Busca primeiro por correspondência exata ou parcial no título
    for (let i = inMemoryStore.notes.length - 1; i >= 0; i--) {
      const n = inMemoryStore.notes[i];
      if (normalizeText(n.title).includes(cleanQ) || normalizeText(n.content).includes(cleanQ)) {
        targetNote = n;
        break;
      }
    }

    if (!targetNote) {
      // Se a nota não existia, cria-a como nova!
      return createNote({
        title: query || 'Anotações',
        content: newContent,
        is_list: newContent.includes('\n') || newContent.includes(','),
        speech_response: rawSpeech || `Criei uma nova nota no Keep chamada "${query || 'Anotações'}" com esse item.`,
      });
    }

    // Concatena de acordo com o tipo
    if (targetNote.is_list) {
      targetNote.content = (targetNote.content ? targetNote.content + '\n' : '') + newContent;
    } else {
      targetNote.content = (targetNote.content ? targetNote.content + '\n\n' : '') + newContent;
    }
    targetNote.updated_at = new Date().toISOString();
    targetNote.synced = false;
    persistLocalNotes();

    const speech_response = rawSpeech || `Adicionei na sua nota "${targetNote.title}" no Keep.`;

    if (ctx) {
      if (typeof ctx.CuteSynth?.happy === 'function') ctx.CuteSynth.happy();
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('✨', 0, 10);
      if (typeof ctx.showActionBadge === 'function') ctx.showActionBadge('📝', 'Atualizando no Keep...', 3200);
      if (typeof ctx.showBubble === 'function') {
        ctx.showBubble('Google Keep 📝', `Atualizado "${targetNote.title}":\n+ ${newContent}`, 4200, false, true);
      }
    }

    // NOVO: Hipocampo em Tempo Real (Parte 1 da Arquitetura Cognitiva)
    const hippoAppend = (typeof window !== 'undefined' && window.HippocampusLogger) || (typeof global !== 'undefined' && global.HippocampusLogger);
    if (hippoAppend && typeof hippoAppend.recordDailyEvent === 'function') {
      hippoAppend.recordDailyEvent({
        categoria: 'AGENDA_KEEP',
        emocao: 'HAPPY',
        titulo: `Nota atualizada no Google Keep: ${targetNote.title}`,
        detalhes: `Novo conteúdo adicionado: ${newContent}`,
        links: [targetNote.title],
        appAtivo: 'Google Keep'
      }).catch(() => {});
    }

    dispatchCloudSync('append_note', {
      id: targetNote.id,
      title: targetNote.title,
      content: targetNote.content,
      new_content: newContent,
      search_query: query,
    }).catch(() => {});

    return {
      ok: true,
      note: targetNote,
      speech_response,
    };
  }

  /**
   * Formata as notas para leitura em voz e exibição
   */
  function formatNotesSpeech(notes, introSpeech = '') {
    if (!notes || notes.length === 0) {
      return 'Não encontrei nenhuma nota no seu Google Keep sobre esse assunto.';
    }

    if (notes.length === 1) {
      const n = notes[0];
      const intro = introSpeech ? `${introSpeech} ` : '';
      return `${intro}Na sua nota "${n.title}": ${n.content.replace(/\n+/g, ', ')}.`;
    }

    const lines = notes.map((n, idx) => `${idx + 1}. "${n.title}": ${n.content.replace(/\n+/g, ', ')}`);
    const intro = introSpeech || 'Aqui estão suas notas do Google Keep:';
    return `${intro} ${lines.join(' | ')}`;
  }

  /**
   * Roteador de execução chamado pelo Gemini
   */
  function processKeepCall(functionName, args = {}) {
    switch (functionName) {
      case 'criar_nota_keep':
        return createNote(args);

      case 'adicionar_em_nota_keep':
        return appendToNote(args);

      case 'ler_notas_keep': {
        const query = String(args.search_query || '').trim();
        const limit = Number(args.limit) || 3;
        const found = searchNotes(query, limit);
        const speech_response = formatNotesSpeech(found, args.speech_response);

        if (ctx) {
          if (typeof ctx.CuteSynth?.happy === 'function') ctx.CuteSynth.happy();
          if (typeof ctx.showActionBadge === 'function') ctx.showActionBadge('📝', 'Lendo Keep...', 3200);
          if (typeof ctx.showBubble === 'function') {
            const body = found.length > 0
              ? found.map((n) => `📌 <b>${n.title}</b>:\n${n.content}`).join('\n\n')
              : 'Nenhuma nota correspondente.';
            ctx.showBubble('Google Keep 📝', body, 7000, false, true);
          }
        }

        return {
          ok: true,
          notes: found,
          speech_response,
        };
      }

      default:
        return { ok: false, error: `Função Keep desconhecida: ${functionName}` };
    }
  }

  /**
   * Sincronização em nuvem via HTTP POST com suporte a redirects (Google Apps Script)
   */
  function postJsonToUrl(targetUrl, jsonString, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) return reject(new Error('Limite de redirecionamentos atingido.'));
      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        return reject(new Error(`URL inválida: ${targetUrl}`));
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? nodeHttps : nodeHttp;
      if (!client) return reject(new Error('Módulos HTTP/HTTPS do Node indisponíveis.'));

      const postData = Buffer.from(jsonString, 'utf8');
      const req = client.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': postData.length,
          },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).toString();
            // Google Apps Script redireciona POST para GET com resultado JSON
            return getFromUrl(redirectUrl, redirectCount + 1)
              .then(resolve)
              .catch(reject);
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 160)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(12000, () => req.destroy(new Error('Timeout de sincronização do Keep (12s).')));
      req.write(postData);
      req.end();
    });
  }

  function getFromUrl(targetUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) return reject(new Error('Limite de redirecionamentos atingido.'));
      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        return reject(new Error(`URL inválida: ${targetUrl}`));
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? nodeHttps : nodeHttp;
      if (!client) return reject(new Error('Módulos HTTP indisponíveis.'));

      client
        .get(targetUrl, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            return getFromUrl(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
  }

  /**
   * Dispara sincronização em nuvem de forma totalmente assíncrona (Background)
   */
  async function dispatchCloudSync(action, payload) {
    const webhookUrl = getWebhookUrl();
    const keepEmail = readEnvVar('GOOGLE_KEEP_EMAIL');
    const keepToken = readEnvVar('GOOGLE_KEEP_MASTER_TOKEN');

    // 1. Tenta sincronização oficial via Python gkeepapi caso o usuário tenha configurado credenciais
    if (keepEmail && keepToken && nodeChildProcess && nodePath) {
      try {
        const bridgeScript = nodePath.join(BASE_DIR, 'keep_sync_bridge.py');
        if (nodeFs && nodeFs.existsSync(bridgeScript)) {
          const pyExe = (nodeFs && nodeFs.existsSync('C:\\Python315\\python.exe')) ? 'C:\\Python315\\python.exe' : 'python';
          const pyProc = nodeChildProcess.spawn(
            pyExe,
            [
              bridgeScript,
              action,
              '--payload',
              JSON.stringify(payload),
            ],
            { cwd: BASE_DIR, windowsHide: true }
          );
          pyProc.on('close', (code) => {
            if (code === 0) {
              console.log(`[GoogleKeepService] Sincronização via gkeepapi concluída com sucesso (${action}).`);
              loadLocalNotes();
            }
          });
        }
      } catch (err) {
        console.warn('[GoogleKeepService] Erro ao invocar keep_sync_bridge.py:', err.message);
      }
    }

    // 2. Sincronização em nuvem universal via Webhook do Google Apps Script
    if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
      try {
        const bodyObj = {
          action,
          service: 'google_keep',
          timestamp: new Date().toISOString(),
          ...payload,
        };
        const resText = await postJsonToUrl(webhookUrl, JSON.stringify(bodyObj));
        console.log(`[GoogleKeepService] Webhook Keep sincronizado:`, resText.slice(0, 100));
      } catch (err) {
        console.warn(`[GoogleKeepService] Falha assíncrona no Webhook (${err.message}). O dado permanece seguro no cache local.`);
      }
    }
  }

  /**
   * Exporta a API pública do módulo GoogleKeepService
   */
  const GoogleKeepService = {
    init(petContext) {
      ctx = petContext;
      loadLocalNotes();
      console.log(`[GoogleKeepService] Inicializado com sucesso. ${inMemoryStore.notes.length} notas carregadas do Google Keep.`);
      // Sincronização em segundo plano na inicialização
      dispatchCloudSync('sync', {}).catch(() => {});
      // Sincronização periódica a cada 5 minutos
      setInterval(() => {
        dispatchCloudSync('sync', {}).catch(() => {});
      }, 5 * 60 * 1000);
      return this;
    },
    getWebhookUrl,
    setWebhookUrl,
    getGeminiToolDeclarations,
    isKeepFunction,
    buildKeepContext,
    searchNotes,
    createNote,
    appendToNote,
    formatNotesSpeech,
    processKeepCall,
    getAllNotes() {
      return loadLocalNotes();
    },
  };

  if (typeof window !== 'undefined') {
    window.GoogleKeepService = GoogleKeepService;
  }
  if (typeof global !== 'undefined') {
    global.GoogleKeepService = GoogleKeepService;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleKeepService;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
