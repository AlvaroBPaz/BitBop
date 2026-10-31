/**
 * ============================================================================
 * MÓDULO: NAVEGADOR SUBCONSCIENTE DE DUPLO ESTÁGIO (SubconsciousNavigator)
 * Arquivo: js/memory/subconscious_navigator.js
 * ============================================================================
 * 
 * Responsabilidades (Parte 3 da Arquitetura Cognitiva em 4 Partes):
 * 1. Simular o comportamento cognitivo humano de "parar para pensar":
 *    Quando o Álvaro faz uma pergunta sobre o dia, o passado, projetos,
 *    estudos ou conhecimentos guardados, o BitBop:
 *    - Faz uma triagem ultrarrápida (~200ms) no Estágio 1 (Groq LPU / Gemini).
 *    - Seleciona quais arquivos .md abrir do cofre do Obsidian.
 *    - Se needs_deep_recall === true, ativa postura [THINKING], toca synth e
 *      produz filler vocal humanizado ("Hmm, deixa eu puxar na memória...").
 *    - Lê todos os arquivos primários e segue conexões associativas ([[Wikilinks]])
 *      em profundidade 1 através do BrainCatalog.
 *    - Monta o Dossiê Completo de Memórias Abertas e o Super-Prompt para o Estágio 2.
 * 2. Regra de Segurança Determinística:
 *    Se a chamada do Estágio 1 falhar, exceder 1200ms ou estiver offline,
 *    garante SEMPRE a abertura do diário de hoje (05_Diario/AAAA-MM-DD.md)
 *    e das notas modificadas hoje no Obsidian.
 */

(function (root, factory) {
  const instance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof window !== 'undefined') window.SubconsciousNavigator = instance;
  if (typeof globalThis !== 'undefined') globalThis.SubconsciousNavigator = instance;
  if (typeof global !== 'undefined') global.SubconsciousNavigator = instance;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;
  const nodeHttps = typeof require !== 'undefined' ? (() => { try { return require('https'); } catch { return null; } })() : null;

  const BASE_DIR = (function () {
    if (nodePath && typeof __dirname !== 'undefined' && __dirname) {
      if (__dirname.endsWith('memory')) return nodePath.resolve(__dirname, '..', '..');
      if (__dirname.endsWith('js')) return nodePath.resolve(__dirname, '..');
      if (__dirname.endsWith('desktop-pet')) return __dirname;
    }
    return 'C:\\Stack-Chan\\desktop-pet';
  })();

  const VAULT_DIR = nodePath ? nodePath.join(BASE_DIR, 'BitBop-Cerebro') : 'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro';
  const LOG_FILE = nodePath ? nodePath.join(BASE_DIR, 'pet-debug.log') : `${BASE_DIR}\\pet-debug.log`;

  const STAGE1_TIMEOUT_MS = 1500; // Timeout máximo de 1.2s para o planejamento subconsciente

  /**
   * Obtém a instância ativa do BrainCatalog
   */
  function getCatalog() {
    if (typeof window !== 'undefined' && window.BrainCatalog) return window.BrainCatalog;
    if (typeof globalThis !== 'undefined' && globalThis.BrainCatalog) return globalThis.BrainCatalog;
    if (typeof global !== 'undefined' && global.BrainCatalog) return global.BrainCatalog;
    try {
      return require('./brain_catalog.js');
    } catch {}
    return null;
  }

  /**
   * Escreve log de confirmação no pet-debug.log e no console
   */
  function writeDebugLog(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${message}\n`;
    try {
      if (nodeFs) {
        nodeFs.appendFileSync(LOG_FILE, formatted, 'utf8');
      }
    } catch {}
    console.log(message);
  }

  /**
   * Retorna a data local de hoje no formato YYYY-MM-DD
   */
  function getTodayDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Obtém credenciais de API ativas (Groq e Gemini)
   */
  function getApiCredentials() {
    let groqKey = '';
    let geminiKey = '';
    let geminiModel = 'gemini-3.5-flash-lite';

    // 1. Tenta pegar de prefs globais
    const p = (typeof window !== 'undefined' && window.prefs) || (typeof global !== 'undefined' && global.prefs) || {};
    if (p.groqApiKey) groqKey = String(p.groqApiKey).trim();
    if (p.geminiApiKey) geminiKey = String(p.geminiApiKey).trim();
    if (p.geminiModel) geminiModel = p.geminiModel;

    // 2. Tenta ler de .gemini-config.json
    if ((!groqKey || !geminiKey) && nodeFs && nodePath) {
      try {
        const configPath = nodePath.join(BASE_DIR, '.gemini-config.json');
        if (nodeFs.existsSync(configPath)) {
          const cfg = JSON.parse(nodeFs.readFileSync(configPath, 'utf8'));
          if (!groqKey && cfg.groqApiKey) groqKey = String(cfg.groqApiKey).trim();
          if (!geminiKey && cfg.geminiApiKey) geminiKey = String(cfg.geminiApiKey).trim();
          if (cfg.geminiModel) geminiModel = cfg.geminiModel;
        }
      } catch {}
    }

    // 3. Fallback para localStorage
    if (typeof localStorage !== 'undefined') {
      if (!groqKey) groqKey = (localStorage.getItem('sc_groq_key') || '').trim();
      if (!geminiKey) geminiKey = (localStorage.getItem('sc_gemini_key') || '').trim();
    }

    return { groqKey, geminiKey, geminiModel };
  }

  /**
   * Chamada rápida do Estágio 1 na Groq Cloud LPU (~200ms)
   */
  function callStage1Groq(groqKey, systemPrompt, userContent) {
    if (!nodeHttps || !groqKey) {
      return Promise.reject(new Error('Groq indisponível'));
    }

    const payload = JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 280,
      temperature: 0.1
    });

    return new Promise((resolve, reject) => {
      const req = nodeHttps.request(
        {
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': 'BitBop-Subconscious/2.0'
          }
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (d) => { body += d; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(body);
                const rawJson = parsed?.choices?.[0]?.message?.content || '{}';
                resolve(JSON.parse(rawJson));
              } catch (e) {
                reject(new Error('Falha ao decodificar JSON da Groq: ' + e.message));
              }
            } else {
              reject(new Error(`Groq HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(STAGE1_TIMEOUT_MS, () => {
        req.destroy(new Error('Timeout Groq'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Chamada de fallback do Estágio 1 no Gemini Flash-Lite
   */
  function callStage1Gemini(geminiKey, geminiModel, systemPrompt, userContent) {
    if (!nodeHttps || !geminiKey) {
      return Promise.reject(new Error('Gemini indisponível'));
    }

    const combinedText = `${systemPrompt}\n\n${userContent}`;
    const payload = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: combinedText }] }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        maxOutputTokens: 280,
        temperature: 0.1
      }
    });

    return new Promise((resolve, reject) => {
      const req = nodeHttps.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (d) => { body += d; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(body);
                const rawJson = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                resolve(JSON.parse(rawJson));
              } catch (e) {
                reject(new Error('Falha ao decodificar JSON do Gemini: ' + e.message));
              }
            } else {
              reject(new Error(`Gemini HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(STAGE1_TIMEOUT_MS, () => {
        req.destroy(new Error('Timeout Gemini'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Executa a Triagem Cognitiva do Estágio 1 (Groq com fallback para Gemini e Timeout de 1200ms)
   */
  async function runStage1PlanningCall(userMessage, currentDesktopStr, compactBrainMap) {
    const { groqKey, geminiKey, geminiModel } = getApiCredentials();

    const systemPrompt = `Você é o Navegador Subconsciente do cérebro Obsidian do BitBop (companheiro de desktop do Álvaro).
Sua missão é rápida e crucial (~200ms): analisar o que o Álvaro disse e selecionar com precisão cirúrgica quais arquivos .md do Obsidian o BitBop deve abrir e ler para responder como um ser humano com memória contínua.

REGRAS COGNITIVAS OBRIGATÓRIAS:
1. "needs_deep_recall": true se a pergunta depender de acontecimentos do dia, memórias passadas, projetos, fatos pessoais, estudos, rotina ou contexto histórico. (Se for apenas saudação rasa como "oi", "boa tarde" sem perguntas, pode ser false).
2. "files_to_open": lista de caminhos relativos de arquivos a abrir (ex: ["05_Diario/2026-10-30.md", "00_Nucleo/Perfil_Alvaro.md"]). Escolha de 1 a 4 arquivos mais relevantes do mapa.
3. Se o Álvaro perguntar sobre o que fez hoje, o dia, resumo ou o que aconteceu, inclua SEMPRE o diário de hoje ("05_Diario/AAAA-MM-DD.md").
4. "follow_wikilinks": true se for importante puxar as notas conectadas por [[Wikilinks]] presentes nesses arquivos.
5. "thinking_voice_filler": uma frase falada natural, humana e curta (máx 6 palavras) que o BitBop pode dizer enquanto puxa a memória (ex: "Hmm, deixa eu lembrar...", "Deixa eu ver no meu diário...", "Puxando na memória aqui..."), ou vazio "" se for conversa casual rápida.
6. "reasoning": 1 frase curta explicando o motivo da escolha.

Responda ESTRITAMENTE em formato JSON:
{
  "needs_deep_recall": true,
  "thinking_voice_filler": "Hmm, deixa eu puxar na memória...",
  "files_to_open": [
    "05_Diario/2026-10-30.md"
  ],
  "follow_wikilinks": true,
  "reasoning": "Motivo da escolha"
}`;

    const userContent = `MENSAGEM DO ÁLVARO: "${userMessage}"
CONTEXTO ATUAL DO DESKTOP: ${currentDesktopStr}

MAPA DE ARQUIVOS DO CÉREBRO OBSIDIAN:
${compactBrainMap}`;

    // Tenta Groq LPU primeiro por ser ultrarrápida (~200ms)
    if (groqKey) {
      try {
        const groqResult = await callStage1Groq(groqKey, systemPrompt, userContent);
        if (groqResult && Array.isArray(groqResult.files_to_open)) {
          return groqResult;
        }
      } catch (groqErr) {
        console.warn('[SubconsciousNavigator] Groq Estágio 1 falhou, tentando Gemini:', groqErr.message);
      }
    }

    // Fallback para Gemini Flash-Lite
    if (geminiKey) {
      try {
        const geminiResult = await callStage1Gemini(geminiKey, geminiModel, systemPrompt, userContent);
        if (geminiResult && Array.isArray(geminiResult.files_to_open)) {
          return geminiResult;
        }
      } catch (geminiErr) {
        console.warn('[SubconsciousNavigator] Gemini Estágio 1 falhou:', geminiErr.message);
      }
    }

    throw new Error('Todos os provedores do Estágio 1 falharam ou expiraram.');
  }

  /**
   * Fallback Determinístico de Segurança (0ms)
   * Garante SEMPRE a inclusão do diário de hoje e das notas recentes se houver menção temporal ou falha.
   */
  function buildDeterministicSafetyFallback(userMessage, today) {
    const catalog = getCatalog();
    const catalogFiles = catalog ? catalog.getCatalogArray() : [];

    const filesToOpen = new Set();
    const todayDiaryRel = `05_Diario/${today}.md`;
    filesToOpen.add(todayDiaryRel);

    // Adiciona notas modificadas ou criadas hoje
    for (const f of catalogFiles) {
      if (f.lastModified && f.lastModified.startsWith(today)) {
        filesToOpen.add(f.relativePath);
        if (filesToOpen.size >= 4) break;
      }
    }

    // Se o usuário perguntar sobre perfil, identidade ou regras
    if (/(?:quem\s*(?:sou|é|e)|meu\s*nome|[aá]lvaro|nailton|perfil|voc[eê]|identidade|regra)/i.test(userMessage)) {
      filesToOpen.add('00_Nucleo/Perfil_Alvaro.md');
      filesToOpen.add('00_Nucleo/Identidade_BitBop.md');
    }

    // Se perguntar sobre código ou arquitetura
    if (/(?:c[oó]digo|desenvolvimento|bug|erro|postgres|banco|api|rate\s*limit|arquitetura)/i.test(userMessage)) {
      filesToOpen.add('01_Memorias/Decisao_de_Arquitetura_Cognitiva.md');
      filesToOpen.add('01_Memorias/Decisao_que_vamos_migrar_o_banco_de_dados_para_PostgreSQL.md');
    }

    const mentionsMemoryOrTime = /(?:hoje|ontem|dia|rotina|lembra|mem[oó]ria|esqueceu|resumo|o\s*que\s*fiz|oq\s*fiz|estudo|projeto|quem|nailton|alvaro|[aá]lvaro|postgres|banco|keep|agenda|tarefa)/i.test(userMessage);

    return {
      needs_deep_recall: mentionsMemoryOrTime || filesToOpen.size >= 2,
      thinking_voice_filler: mentionsMemoryOrTime ? 'Hmm, deixa eu ver o que temos aqui...' : '',
      files_to_open: Array.from(filesToOpen).slice(0, 4),
      follow_wikilinks: true,
      reasoning: 'Fallback determinístico ativado: consultando diário de hoje e memórias recentes.'
    };
  }

  /**
   * Lê o resumo do diário de hoje para incluir no baseline
   */
  function readTodayDiaryDigest(today) {
    if (!nodeFs) return 'Diário em acompanhamento contínuo.';
    const diaryPath = nodePath ? nodePath.join(VAULT_DIR, '05_Diario', `${today}.md`) : `${VAULT_DIR}\\05_Diario\\${today}.md`;

    if (!nodeFs.existsSync(diaryPath)) {
      return 'Nenhum acontecimento registrado ainda no diário de hoje.';
    }

    try {
      const raw = nodeFs.readFileSync(diaryPath, 'utf8');
      const idx = raw.indexOf('## Linha do Tempo Viva');
      if (idx !== -1) {
        const eventsSection = raw.substring(idx + '## Linha do Tempo Viva'.length).trim();
        const lines = eventsSection.split(/\r?\n/).filter(l => l.trim().startsWith('-'));
        if (lines.length > 0) {
          return lines.slice(-8).join('\n'); // Últimos 8 eventos
        }
      }
      return raw.slice(0, 300);
    } catch {
      return 'Diário ativo e monitorado.';
    }
  }

  /**
   * FUNÇÃO PRINCIPAL: COORDENA A COLETA DO CONTEXTO COGNITIVO
   * gatherCognitiveContext(userMessage, currentDesktopContext)
   * 
   * Refinamentos da Parte 4:
   * 1. Detecção de Análise Ampla (Travessia de Grafo Multi-Salto).
   * 2. Incorporação automática de 06_Pendencias/ e 02_Rotinas/.
   * 3. Travessia profunda de sinapses [[Wikilinks]] citadas no diário de hoje.
   * 4. Auditoria visual detalhada:
   *    [CÉREBRO-OBSIDIAN] Pensamento concluído em Xms | Arquivos abertos e lidos: [...] | Sinapses [[links]] seguidas: [...] | Total de caracteres: Y
   */
  async function gatherCognitiveContext(userMessage = '', currentDesktopContext = '') {
    const t0 = Date.now();
    const today = getTodayDateString();
    const catalog = getCatalog();

    const desktopStr = typeof currentDesktopContext === 'object'
      ? `App: ${currentDesktopContext.activeApp || 'Desktop'} | Janela: ${currentDesktopContext.activeTitle || 'Geral'}`
      : String(currentDesktopContext || 'Desktop');

    // 1. Detecção de análise ampla ou consulta complexa
    const isBroadAnalysis = /(?:o\s*que\s*aconteceu|resumo|semana|como\s*est[aã]o|pend[eê]ncias?|tarefas?|estudos?|projeto|analise|an[aá]lise|panorama|status|balan[cç]o|me\s*conta|me\s*diz|o\s*que\s*fiz|oq\s*fiz|acontecimentos?)/i.test(userMessage);

    const compactBrainMap = catalog ? catalog.getCompactBrainMapForLLM() : 'Catálogo ainda não inicializado.';

    let stage1Result = null;

    // ETAPA 1: Busca Sináptica Profunda em RAM (Executa em ~15ms com indexação semântica)
    let ramSearch = null;
    if (catalog && typeof catalog.findRelevantFilesBySynapticSearch === 'function') {
      try {
        ramSearch = catalog.findRelevantFilesBySynapticSearch(userMessage, desktopStr, { today });
      } catch (ramErr) {
        console.warn('[SubconsciousNavigator] Erro na busca sináptica em RAM:', ramErr.message);
      }
    }

    // Regra de Folga de Segurança (Garantia de Não Deixar Memórias Passarem):
    // - Se a confiança em RAM for alta (>= 65) e a consulta for focada/direta: usa a seleção imediata da RAM (~15ms)!
    // - Se a consulta for ampla, reflexiva ou de confiança moderada: aciona a folga confortável com a IA remota (Groq/Gemini)
    //   e faz a UNIÃO dos arquivos de ambas as fontes para nunca deixar nada para trás!
    const shouldUseFastRam = ramSearch && ramSearch.confidence === 'high' && !isBroadAnalysis && ramSearch.files.length > 0;

    if (shouldUseFastRam) {
      stage1Result = {
        needs_deep_recall: ramSearch.needsDeepRecall,
        thinking_voice_filler: '',
        files_to_open: ramSearch.files,
        follow_wikilinks: true,
        reasoning: `RAM Synaptic Search direta (${ramSearch.files.length} arquivos com alta precisão).`
      };
    } else {
      // Ativa postura e folga de reflexão profunda
      try {
        stage1Result = await runStage1PlanningCall(userMessage, desktopStr, compactBrainMap);
      } catch (err) {
        console.warn('[SubconsciousNavigator] Estágio 1 recorrendo ao Fallback com RAM:', err.message);
        stage1Result = buildDeterministicSafetyFallback(userMessage, today);
      }

      // União com as descobertas da busca em RAM para garantir máxima cobertura de memórias
      if (ramSearch && ramSearch.files && ramSearch.files.length > 0) {
        const merged = new Set([...(stage1Result.files_to_open || []), ...ramSearch.files]);
        stage1Result.files_to_open = Array.from(merged);
        stage1Result.needs_deep_recall = true;
      }
    }

    if (!stage1Result || !Array.isArray(stage1Result.files_to_open) || stage1Result.files_to_open.length === 0) {
      stage1Result = buildDeterministicSafetyFallback(userMessage, today);
    }

    let needsDeepRecall = Boolean(stage1Result.needs_deep_recall);
    let followWikilinks = Boolean(stage1Result.follow_wikilinks);
    const thinkingVoiceFiller = String(stage1Result.thinking_voice_filler || '').trim();
    const reasoning = String(stage1Result.reasoning || '').trim();

    const filesToOpenSet = new Set(stage1Result.files_to_open || []);

    // Se for análise ampla, garante busca profunda em 06_Pendencias/, 02_Rotinas/ e diário de hoje
    if (isBroadAnalysis) {
      needsDeepRecall = true;
      followWikilinks = true;

      // Diário de hoje obrigatório para contextualização
      filesToOpenSet.add(`05_Diario/${today}.md`);

      if (catalog && typeof catalog.getCatalogArray === 'function') {
        const catArray = catalog.getCatalogArray();

        // Puxa as notas mais recentes de 06_Pendencias/
        const pendencias = catArray
          .filter(f => f.folder === '06_Pendencias' || (f.relativePath && f.relativePath.startsWith('06_Pendencias/')))
          .sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || '')));
        for (const p of pendencias.slice(0, 2)) {
          filesToOpenSet.add(p.relativePath);
        }

        // Puxa a rotina/episódio mais relevante de 02_Rotinas/ ou 02_Episodios/
        const rotinas = catArray
          .filter(f => f.folder === '02_Rotinas' || f.folder === '02_Episodios' || (f.relativePath && (f.relativePath.startsWith('02_Rotinas/') || f.relativePath.startsWith('02_Episodios/'))))
          .sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || '')));
        for (const r of rotinas.slice(0, 1)) {
          filesToOpenSet.add(r.relativePath);
        }
      }
    }

    const finalFilesToOpen = Array.from(filesToOpenSet);

    // ETAPA 2: Comportamento Humano de "Pensar" se for reflexão profunda
    if (needsDeepRecall || finalFilesToOpen.length >= 2) {
      // 1. Expressão OLED
      if (typeof window !== 'undefined' && typeof window.setEmotion === 'function') {
        window.setEmotion('THINKING', 6000);
      }

      // 2. Chime CuteSynth
      const synth = (typeof window !== 'undefined' && window.CuteSynth) || (typeof global !== 'undefined' && global.CuteSynth);
      if (synth && typeof synth.thinking === 'function') {
        synth.thinking();
      }

      // 3. Indicador de Ação / Balão
      if (typeof window !== 'undefined') {
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('🧠', `Acessando memórias no Obsidian (${finalFilesToOpen.length} arquivos)...`, 2800);
        } else if (typeof window.showBubble === 'function' && window.prefs && window.prefs.bubbleEnabled) {
          window.showBubble('BitBop 🧠', `Lendo ${finalFilesToOpen.length} notas no cofre...`, 2400, false);
        }
      }
    }

    // ETAPA 3: Leitura e Montagem do Dossiê Completo por Sinapses (Travessia Multi-Salto)
    let dossierText = '';
    if (catalog && typeof catalog.readFilesWithSynapses === 'function') {
      dossierText = catalog.readFilesWithSynapses(finalFilesToOpen, {
        followLinksDepth: followWikilinks ? 1 : 0,
        maxTotalChars: isBroadAnalysis ? 24000 : 18000
      });
    }

    // Digest rápido do diário de hoje
    const todayDiarySummary = readTodayDiaryDigest(today);

    // ETAPA 4: Auditoria Visual e Log do Pensamento Concluído
    const thinkingMs = Date.now() - t0;
    const primaryFiles = (dossierText && dossierText.primaryFiles) ? dossierText.primaryFiles : finalFilesToOpen;
    const synapsesFollowed = (dossierText && dossierText.synapsesFollowed) ? dossierText.synapsesFollowed : [];
    const totalChars = (dossierText && dossierText.totalChars) ? dossierText.totalChars : (typeof dossierText === 'string' ? dossierText.length : 0);

    const auditMessage = `[CÉREBRO-OBSIDIAN] Pensamento concluído em ${thinkingMs}ms | Arquivos abertos e lidos: [${primaryFiles.join(', ')}] | Sinapses [[links]] seguidas: [${synapsesFollowed.join(', ')}] | Total de caracteres injetados no prompt: ${totalChars}`;
    writeDebugLog(auditMessage);

    return {
      needs_deep_recall: needsDeepRecall,
      thinking_voice_filler: thinkingVoiceFiller,
      files_to_open: primaryFiles,
      primaryFiles,
      follow_wikilinks: followWikilinks,
      reasoning,
      dossierText: String(dossierText),
      todayDiarySummary,
      filesReadCount: primaryFiles.length,
      synapsesFollowed,
      thinkingMs,
      totalChars,
      isBroadAnalysis
    };
  }

  return {
    gatherCognitiveContext,
    buildDeterministicSafetyFallback,
    readTodayDiaryDigest
  };
});
