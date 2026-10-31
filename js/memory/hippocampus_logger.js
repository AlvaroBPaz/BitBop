/**
 * ============================================================================
 * MÓDULO: HIPOCAMPO EM TEMPO REAL (HippocampusLogger)
 * Arquivo: js/memory/hippocampus_logger.js
 * ============================================================================
 * 
 * Responsabilidades (Parte 1 da Arquitetura Cognitiva em 4 Partes):
 * 1. Garantir que o Diário do dia (05_Diario/AAAA-MM-DD.md) seja inicializado
 *    assim que o BitBop acordar, com frontmatter YAML completo e seção Linha do Tempo Viva.
 * 2. Gravar em tempo real e de forma assíncrona (sem bloquear o TTS nem a UI)
 *    todos os acontecimentos relevantes em 05_Diario/AAAA-MM-DD.md:
 *    - Conversas com o Álvaro (resumidas em 1-2 frases).
 *    - Marcos de foco de tela (>= 3 min no VS Code, Arena Breakout, Docs).
 *    - Notas do Google Keep e eventos da Google Agenda.
 *    - Resumos e revisões do Perfil de Estudo.
 * 3. Identificar fatos novos, ideias, problemas técnicos, estudos ou decisões
 *    importantes e criar/atualizar imediatamente notas dedicadas em:
 *    - 01_Memorias/ (fatos episódicos, pessoais, decisões e marcos).
 *    - 03_Conhecimento/ (conceitos técnicos, ferramentas, estudos).
 *    - Conectar bidirecionalmente via [[Wikilinks]] com o Diário do dia.
 * 4. Imprimir no pet-debug.log:
 *    [HIPOCAMPO] Evento gravado em 05_Diario/AAAA-MM-DD.md: <titulo>
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const instance = factory();
    if (typeof window !== 'undefined') window.HippocampusLogger = instance;
    if (typeof globalThis !== 'undefined') globalThis.HippocampusLogger = instance;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  // Localização base da aplicação
  const BASE_DIR = (function () {
    if (nodePath && typeof __dirname !== 'undefined' && __dirname) {
      if (__dirname.endsWith('memory')) return nodePath.resolve(__dirname, '..', '..');
      if (__dirname.endsWith('js')) return nodePath.resolve(__dirname, '..');
      if (__dirname.endsWith('desktop-pet')) return __dirname;
    }
    return 'C:\\Stack-Chan\\desktop-pet';
  })();

  const VAULT_DIR = nodePath ? nodePath.join(BASE_DIR, 'BitBop-Cerebro') : 'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro';
  const LOG_FILE = nodePath ? nodePath.join(BASE_DIR, 'pet-debug.log') : 'C:\\Stack-Chan\\desktop-pet\\pet-debug.log';

  // Subpastas requeridas pela nova arquitetura
  const DIR_DIARIO = nodePath ? nodePath.join(VAULT_DIR, '05_Diario') : VAULT_DIR + '\\05_Diario';
  const DIR_MEMORIAS = nodePath ? nodePath.join(VAULT_DIR, '01_Memorias') : VAULT_DIR + '\\01_Memorias';
  const DIR_CONHECIMENTO = nodePath ? nodePath.join(VAULT_DIR, '03_Conhecimento') : VAULT_DIR + '\\03_Conhecimento';

  // Categorias permitidas conforme especificação
  const VALID_CATEGORIES = new Set([
    'CONVERSA',
    'ESTUDO',
    'TRABALHO_DEV',
    'JOGO',
    'AGENDA_KEEP',
    'OBSERVACAO_TELA'
  ]);

  // Estado interno em memória
  let isInitialized = false;
  let activeTrackingState = {
    app: '',
    title: '',
    startTime: 0,
    logged3Min: false,
    lastLoggedImmediate: ''
  };

  /**
   * Escreve log de confirmação no arquivo pet-debug.log e no console
   */
  function writeDebugLog(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${message}\n`;
    try {
      if (nodeFs) {
        nodeFs.appendFileSync(LOG_FILE, formatted, 'utf8');
      }
    } catch (err) {
      // Ignora erro de lock no log
    }
    console.log(message);
  }

  /**
   * Garante a existência de um diretório de forma recursiva
   */
  function ensureDirSync(dirPath) {
    if (!nodeFs) return;
    try {
      if (!nodeFs.existsSync(dirPath)) {
        nodeFs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (err) {
      console.warn(`[HippocampusLogger] Falha ao criar pasta ${dirPath}:`, err.message);
    }
  }

  /**
   * Sanitiza títulos para nomes de arquivos válidos no Windows
   */
  function sanitizeFilename(title) {
    if (!title || typeof title !== 'string') return `Nota_${Date.now()}`;
    return title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  /**
   * Retorna a data local atual no formato AAAA-MM-DD
   */
  function getTodayDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Retorna a hora local atual no formato HH:MM
   */
  function getCurrentTimeString(d = new Date()) {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Garante que o arquivo do dia 05_Diario/AAAA-MM-DD.md exista com frontmatter e Linha do Tempo Viva
   */
  function ensureDailyFile(dateStr = getTodayDateString()) {
    if (!nodeFs) return null;
    ensureDirSync(DIR_DIARIO);
    const filePath = nodePath ? nodePath.join(DIR_DIARIO, `${dateStr}.md`) : `${DIR_DIARIO}\\${dateStr}.md`;

    try {
      if (!nodeFs.existsSync(filePath)) {
        const initialContent = `---
data: ${dateStr}
humor_predominante: Normal
tags: [diario, rotina]
resumo_curto: Registro diário contínuo do BitBop
---

# Diário Vivo — ${dateStr}

## Linha do Tempo Viva
`;
        nodeFs.writeFileSync(filePath, initialContent, 'utf8');
        writeDebugLog(`[HIPOCAMPO] Diário do dia inicializado: 05_Diario/${dateStr}.md`);
      } else {
        // Se já existe, garante que possui a seção "## Linha do Tempo Viva"
        let content = nodeFs.readFileSync(filePath, 'utf8');
        if (!content.includes('## Linha do Tempo Viva')) {
          content = content.trimEnd() + '\n\n## Linha do Tempo Viva\n';
          nodeFs.writeFileSync(filePath, content, 'utf8');
        }
      }
      return filePath;
    } catch (err) {
      console.error(`[HippocampusLogger] Erro ao inicializar 05_Diario/${dateStr}.md:`, err);
      return null;
    }
  }

  /**
   * Formata os links para inserção na linha do tempo
   */
  function formatConnectionsString(links) {
    if (!links) return '';
    let arr = [];
    if (Array.isArray(links)) {
      arr = links.filter(Boolean);
    } else if (typeof links === 'string' && links.trim()) {
      arr = [links.trim()];
    }

    if (arr.length === 0) return '';

    const formattedLinks = arr.map(link => {
      let str = String(link).trim();
      if (!str.startsWith('[[')) str = `[[${str}`;
      if (!str.endsWith(']]')) str = `${str}]]`;
      return str;
    }).join(', ');

    return ` (Conexões: ${formattedLinks})`;
  }

  /**
   * 1. GRAVA EVENTO EM TEMPO REAL NO DIÁRIO DO DIA
   * recordDailyEvent({ hora, categoria, emocao, titulo, detalhes, links, appAtivo, dateStr })
   */
  async function recordDailyEvent({
    hora = getCurrentTimeString(),
    categoria = 'CONVERSA',
    emocao = 'NORMAL',
    titulo = 'Registro',
    detalhes = '',
    links = [],
    appAtivo = 'Desktop',
    dateStr = getTodayDateString()
  } = {}) {
    if (!nodeFs) return { ok: false, error: 'Node.js FS indisponível' };

    // Sanitiza e valida categoria
    const catUpper = String(categoria).toUpperCase();
    const finalCategory = VALID_CATEGORIES.has(catUpper) ? catUpper : 'CONVERSA';
    const finalEmotion = String(emocao || 'NORMAL').toUpperCase();
    const finalApp = String(appAtivo || 'Desktop').trim() || 'Desktop';
    const finalHora = String(hora || getCurrentTimeString()).slice(0, 5);
    const finalTitulo = String(titulo || 'Acontecimento').trim();
    const cleanDetalhes = String(detalhes || '').replace(/\r?\n+/g, ' ').trim();
    const conexoesStr = formatConnectionsString(links);

    // Formato obrigatório:
    // - **[HH:MM] [CATEGORIA] [EMOÇÃO]** (**App:** `appAtivo`) — **titulo**: detalhes (Conexões: [[Link1]], [[Link2]])
    const eventLine = `- **[${finalHora}] [${finalCategory}] [${finalEmotion}]** (**App:** \`${finalApp}\`) — **${finalTitulo}**: ${cleanDetalhes}${conexoesStr}\n`;

    const dailyPath = ensureDailyFile(dateStr);
    if (!dailyPath) return { ok: false, error: 'Falha ao acessar diário' };

    try {
      let content = nodeFs.readFileSync(dailyPath, 'utf8');

      // Localiza a seção "## Linha do Tempo Viva"
      const sectionHeader = '## Linha do Tempo Viva';
      const sectionIdx = content.indexOf(sectionHeader);

      if (sectionIdx !== -1) {
        // Encontra o próximo cabeçalho Markdown nível 2 ("## ") se houver
        const afterSection = content.substring(sectionIdx + sectionHeader.length);
        const nextHeaderMatch = afterSection.match(/\n##\s+/);

        if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
          const insertIdx = sectionIdx + sectionHeader.length + nextHeaderMatch.index;
          content = content.slice(0, insertIdx) + '\n' + eventLine + content.slice(insertIdx);
        } else {
          // Anexa no final da seção / do arquivo
          content = content.trimEnd() + '\n' + eventLine;
        }
      } else {
        // Se por algum motivo não havia a seção, anexa ao final
        content = content.trimEnd() + `\n\n${sectionHeader}\n` + eventLine;
      }

      nodeFs.writeFileSync(dailyPath, content, 'utf8');

      // Log de confirmação obrigatório
      writeDebugLog(`[HIPOCAMPO] Evento gravado em 05_Diario/${dateStr}.md: ${finalTitulo}`);

      return { ok: true, line: eventLine.trim(), path: dailyPath };
    } catch (err) {
      console.error(`[HippocampusLogger] Erro ao gravar evento em 05_Diario/${dateStr}.md:`, err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * 2. CRIA OU ATUALIZA NOTA DEDICADA EM 01_Memorias/ OU 03_Conhecimento/
   * recordKnowledgeOrMemory({ tipo, titulo, conteudo, categoria, resumo_curto, tags, links })
   */
  async function recordKnowledgeOrMemory({
    tipo = 'memoria',
    titulo = '',
    conteudo = '',
    categoria = 'Geral',
    resumo_curto = '',
    tags = [],
    links = []
  } = {}) {
    if (!nodeFs) return { ok: false, error: 'Node.js FS indisponível' };
    if (!titulo || !titulo.trim()) return { ok: false, error: 'Título obrigatório' };

    const today = getTodayDateString();
    const cleanTitle = titulo.trim();
    const filename = `${sanitizeFilename(cleanTitle)}.md`;

    // Roteia para 01_Memorias ou 03_Conhecimento
    const isKnowledge = tipo === 'conhecimento' || /conceito|tecnologia|estudo|codigo|framework|linguagem|algoritmo/i.test(tipo + ' ' + categoria);
    const targetDir = isKnowledge ? DIR_CONHECIMENTO : DIR_MEMORIAS;
    const targetFolderRelative = isKnowledge ? '03_Conhecimento' : '01_Memorias';

    ensureDirSync(targetDir);
    const filePath = nodePath ? nodePath.join(targetDir, filename) : `${targetDir}\\${filename}`;

    const cleanCategory = String(categoria || (isKnowledge ? 'Conhecimento Técnico' : 'Memória')).trim();
    const cleanResumo = String(resumo_curto || cleanTitle).trim();

    // Normaliza tags
    let tagList = ['bitbop', isKnowledge ? 'conhecimento' : 'memoria'];
    if (Array.isArray(tags)) {
      tagList = Array.from(new Set([...tagList, ...tags.map(t => String(t).trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean)]));
    }

    // Normaliza links com conexão ao Diário do dia
    const diaryWikilink = `[[05_Diario/${today}|Diário ${today}]]`;
    let linkList = [`[[05_Diario/${today}]]`];
    if (Array.isArray(links)) {
      linkList = Array.from(new Set([...linkList, ...links.filter(Boolean)]));
    }

    try {
      let createdDate = today;
      let existingBody = '';

      if (nodeFs.existsSync(filePath)) {
        const raw = nodeFs.readFileSync(filePath, 'utf8');
        const matchCreated = raw.match(/criado:\s*["']?([0-9\-]+)["']?/);
        if (matchCreated) createdDate = matchCreated[1];

        // Extrai corpo após o frontmatter
        const parts = raw.split(/^---\s*$/m);
        if (parts.length >= 3) {
          existingBody = parts.slice(2).join('---').trim();
        } else {
          existingBody = raw.trim();
        }
      }

      // Monta novo corpo preservando histórico se nota já existia
      let newBodyContent = conteudo.trim();
      if (existingBody && existingBody !== newBodyContent) {
        newBodyContent = `${existingBody}\n\n### Atualização em ${today}\n${newBodyContent}`;
      }

      const fileContent = `---
criado: ${createdDate}
atualizado: ${today}
categoria: "${cleanCategory}"
resumo_curto: "${cleanResumo.replace(/"/g, "'")}"
tags: [${tagList.join(', ')}]
links: [${linkList.map(l => `"${l}"`).join(', ')}]
---

# ${cleanTitle}

${newBodyContent}

## Conexões
- **Diário de Origem:** ${diaryWikilink}
- **Última Atualização:** ${today}
`;

      nodeFs.writeFileSync(filePath, fileContent, 'utf8');
      writeDebugLog(`[HIPOCAMPO] Nota dedicada salva em ${targetFolderRelative}/${filename}: ${cleanTitle}`);

      return {
        ok: true,
        path: filePath,
        wikilink: cleanTitle,
        folder: targetFolderRelative
      };
    } catch (err) {
      console.error(`[HippocampusLogger] Erro ao gravar nota em ${targetDir}:`, err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Analisa heuristicamente o turno de conversa e identifica se traz
   * fatos novos, ideias, problemas técnicos, estudos ou decisões importantes.
   */
  function analyzeTurnHeuristics(userText, botReply) {
    const combined = `${userText} ${botReply}`;
    let isImportant = false;
    let tipo = 'memoria';
    let categoria = 'CONVERSA';
    let titulo = '';
    let detalhes = '';
    let tags = [];

    // 1. Decisão ou Marco importante
    const matchDecisao = userText.match(/\b(?:decidi|vamos usar|escolhi|definir|mudar para|adotei|fechado|combinado)\s+(.+)/i);
    if (matchDecisao) {
      isImportant = true;
      tipo = 'memoria';
      categoria = 'Decisão';
      titulo = `Decisão: ${matchDecisao[1].slice(0, 50).trim()}`;
      detalhes = `Álvaro decidiu: "${matchDecisao[1].trim()}". BitBop alinhou: "${botReply.slice(0, 100)}"`;
      tags = ['decisao', 'planejamento'];
    }

    // 2. Ideia ou Projeto
    const matchIdeia = userText.match(/\b(?:ideia|pensei em|projeto|funcionalidade|arquitetura|criar um|montar um)\s+(.+)/i);
    if (!isImportant && matchIdeia) {
      isImportant = true;
      tipo = 'conhecimento';
      categoria = 'Ideias e Projetos';
      titulo = `Ideia: ${matchIdeia[1].slice(0, 50).trim()}`;
      detalhes = `Álvaro teve a ideia de: "${matchIdeia[1].trim()}".`;
      tags = ['ideia', 'projeto'];
    }

    // 3. Problema Técnico, Bug ou Erro
    const matchBug = combined.match(/\b(?:bug|erro|falha|exception|rate limit|quota|429|crash|travou|deu pau)\b/i);
    if (!isImportant && matchBug) {
      isImportant = true;
      tipo = 'conhecimento';
      categoria = 'Problema Técnico';
      titulo = `Problema Técnico: ${userText.slice(0, 50).trim()}`;
      detalhes = `Discussão sobre erro/bug: "${userText.slice(0, 120)}". Solução/Diagnóstico: "${botReply.slice(0, 120)}"`;
      tags = ['bug', 'diagnostico'];
    }

    // 4. Fato pessoal, Preferência ou Aprendizado sobre o Álvaro
    const matchFato = userText.match(/\b(?:meu nome|prefiro|gosto de|não gosto|lembre que|sou|trabalho com|minha rotina)\s+(.+)/i);
    if (!isImportant && matchFato) {
      isImportant = true;
      tipo = 'memoria';
      categoria = 'Perfil Álvaro';
      titulo = `Fato sobre Álvaro: ${matchFato[0].slice(0, 50).trim()}`;
      detalhes = `Álvaro informou: "${matchFato[0].trim()}".`;
      tags = ['perfil', 'preferencias'];
    }

    // 5. Estudo ou Conceito
    const matchEstudo = combined.match(/\b(?:estudo|estudando|aprendi|conceito|artigo|livro|aula|prova|matéria)\b/i);
    if (!isImportant && matchEstudo) {
      isImportant = true;
      tipo = 'conhecimento';
      categoria = 'Estudo';
      titulo = `Estudo: ${userText.slice(0, 50).trim()}`;
      detalhes = `Tópico de estudo abordado: "${userText.slice(0, 120)}"`;
      tags = ['estudo', 'aprendizado'];
    }

    return {
      isImportant,
      tipo,
      categoria,
      titulo,
      detalhes,
      tags
    };
  }

  /**
   * Conecta associativamente notas que foram co-consultadas em reflexão profunda,
   * gerando novas arestas no Obsidian Graph View (Ctrl + G).
   */
  async function crossLinkAssociatedNotes(openedFilesList = [], today = getTodayDateString()) {
    if (!nodeFs || !Array.isArray(openedFilesList) || openedFilesList.length < 2) return;

    // Filtra notas elegíveis para auto-linkagem (somente 01_Memorias e 03_Conhecimento)
    const eligibleNotes = [];
    for (const rawPath of openedFilesList) {
      if (!rawPath) continue;
      const normalized = rawPath.replace(/\\/g, '/');
      if (normalized.startsWith('01_Memorias/') || normalized.startsWith('03_Conhecimento/')) {
        const fullPath = nodePath ? nodePath.join(VAULT_DIR, normalized) : `${VAULT_DIR}\\${normalized}`;
        if (nodeFs.existsSync(fullPath)) {
          const baseName = nodePath ? nodePath.basename(normalized, '.md') : normalized.split('/').pop().replace(/\.md$/, '');
          eligibleNotes.push({ relPath: normalized, fullPath, title: baseName });
        }
      }
    }

    if (eligibleNotes.length < 2) return;

    // Conecta pares de notas (máximo 3 pares para evitar sobrecarga)
    const pairsToLink = [];
    for (let i = 0; i < eligibleNotes.length - 1 && pairsToLink.length < 3; i++) {
      for (let j = i + 1; j < eligibleNotes.length && pairsToLink.length < 3; j++) {
        pairsToLink.push([eligibleNotes[i], eligibleNotes[j]]);
      }
    }

    for (const [noteA, noteB] of pairsToLink) {
      try {
        let contentA = nodeFs.readFileSync(noteA.fullPath, 'utf8');
        const linkBPattern = new RegExp(`\\[\\[(?:0[13]_[^|/]+\\/)?${noteB.title}(?:\\|[^\]]+)?\\]\\]`, 'i');

        if (!linkBPattern.test(contentA)) {
          const linkLine = `- **Conexão Associativa:** [[${noteB.title}]] (co-consultados em reflexão profunda de ${today})`;
          if (contentA.includes('## Conexões')) {
            contentA = contentA.replace('## Conexões', `## Conexões\n${linkLine}`);
          } else {
            contentA = contentA.trimEnd() + `\n\n## Conexões\n${linkLine}\n`;
          }
          nodeFs.writeFileSync(noteA.fullPath, contentA, 'utf8');
          writeDebugLog(`[HIPOCAMPO] Nova sinapse associativa criada no grafo: [[${noteA.title}]] -> [[${noteB.title}]]`);
        }

        // Bidirecional: conecta noteB -> noteA se ainda não tiver
        let contentB = nodeFs.readFileSync(noteB.fullPath, 'utf8');
        const linkAPattern = new RegExp(`\\[\\[(?:0[13]_[^|/]+\\/)?${noteA.title}(?:\\|[^\]]+)?\\]\\]`, 'i');

        if (!linkAPattern.test(contentB)) {
          const linkLine = `- **Conexão Associativa:** [[${noteA.title}]] (co-consultados em reflexão profunda de ${today})`;
          if (contentB.includes('## Conexões')) {
            contentB = contentB.replace('## Conexões', `## Conexões\n${linkLine}`);
          } else {
            contentB = contentB.trimEnd() + `\n\n## Conexões\n${linkLine}\n`;
          }
          nodeFs.writeFileSync(noteB.fullPath, contentB, 'utf8');
          writeDebugLog(`[HIPOCAMPO] Nova sinapse associativa criada no grafo: [[${noteB.title}]] -> [[${noteA.title}]]`);
        }
      } catch (linkErr) {
        console.warn(`[HippocampusLogger] Erro ao criar sinapse entre ${noteA.title} e ${noteB.title}:`, linkErr.message);
      }
    }
  }

  /**
   * 3. REGISTRA TURNO DE CONVERSA EM SEGUNDO PLANO (Touchpoint 1: pet_brain.js)
   * Chamado assim que a resposta termina de ser gerada, sem travar o TTS nem a fala.
   * Suporta o novo cognitiveContext da Parte 4 para reflexão pós-resposta e auto-linkagem.
   */
  async function recordConversationTurn({
    userText = '',
    botReply = '',
    emotion = 'NORMAL',
    appAtivo = 'Desktop',
    cognitiveContext = null
  } = {}) {
    if (!userText.trim() && !botReply.trim()) return;

    const uClean = userText.trim().replace(/\r?\n+/g, ' ');
    const bClean = botReply.trim().replace(/\r?\n+/g, ' ');
    const today = getTodayDateString();

    // Resumo conciso em 1 a 2 frases para a Linha do Tempo Viva
    const uPreview = uClean.length > 90 ? uClean.slice(0, 87) + '...' : uClean;
    const bPreview = bClean.length > 110 ? bClean.slice(0, 107) + '...' : bClean;
    const tituloTurno = uClean.length > 55 ? uClean.slice(0, 52) + '...' : uClean;
    const detalhesTurno = `Álvaro: "${uPreview}" | BitBop: "${bPreview}"`;

    let connections = ['Conversa'];

    // Se houve consulta profunda ao Obsidian (Parte 4: Reflexão Pós-Resposta e Auto-Linkagem)
    if (cognitiveContext && (cognitiveContext.filesReadCount >= 2 || cognitiveContext.needs_deep_recall)) {
      const openedFiles = Array.isArray(cognitiveContext.primaryFiles) ? cognitiveContext.primaryFiles : (cognitiveContext.files_to_open || []);
      const synapses = Array.isArray(cognitiveContext.synapsesFollowed) ? cognitiveContext.synapsesFollowed : [];

      // Extrai os títulos das notas para os [[Wikilinks]] do Diário
      for (const p of openedFiles) {
        const base = p.split('/').pop().replace(/\.md$/, '');
        if (base && !connections.includes(base)) connections.push(base);
      }
      for (const s of synapses) {
        const clean = String(s).replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
        if (clean && !connections.includes(clean)) connections.push(clean);
      }

      // 1. Auto-linkagem associativa no cofre entre notas consultadas conjuntamente
      crossLinkAssociatedNotes(openedFiles, today).catch(() => {});

      // 2. Se for análise ampla ou reflexão profunda com 3+ arquivos, registra marco de síntese
      if (cognitiveContext.isBroadAnalysis || cognitiveContext.filesReadCount >= 3) {
        recordDailyEvent({
          hora: getCurrentTimeString(),
          categoria: 'CONVERSA',
          emocao: 'CURIOUS',
          titulo: `Reflexão / Síntese do Cofre: ${uClean.slice(0, 45)}`,
          detalhes: `BitBop cruzou ${openedFiles.length} notas do cérebro e ${synapses.length} sinapses para responder: "${bPreview}"`,
          links: connections.slice(1, 6),
          appAtivo: appAtivo || 'Desktop'
        }).catch(() => {});
      }
    }

    // Avalia se há fato novo, ideia, problema técnico ou decisão importante
    const turnAnalysis = analyzeTurnHeuristics(uClean, bClean);

    if (turnAnalysis.isImportant && turnAnalysis.titulo) {
      try {
        const dedicatedNote = await recordKnowledgeOrMemory({
          tipo: turnAnalysis.tipo,
          titulo: turnAnalysis.titulo,
          conteudo: `### Contexto da Conversa\n- **Álvaro:** ${uClean}\n- **BitBop:** ${bClean}\n\n### Detalhes Sintetizados\n${turnAnalysis.detalhes}`,
          categoria: turnAnalysis.categoria,
          resumo_curto: turnAnalysis.detalhes.slice(0, 120),
          tags: turnAnalysis.tags,
          links: ['[[Perfil_Alvaro]]']
        });

        if (dedicatedNote && dedicatedNote.wikilink) {
          connections.push(dedicatedNote.wikilink);
        }
      } catch (err) {
        console.warn('[HippocampusLogger] Falha ao criar nota dedicada da conversa:', err);
      }
    }

    // Grava imediatamente o evento na Linha do Tempo Viva do Diário de Hoje
    return recordDailyEvent({
      hora: getCurrentTimeString(),
      categoria: 'CONVERSA',
      emocao: emotion,
      titulo: `Conversa: ${tituloTurno}`,
      detalhes: detalhesTurno,
      links: connections,
      appAtivo: appAtivo || 'Desktop'
    });
  }

  /**
   * 4. OBSERVAÇÃO DE MUDANÇA DE CONTEXTO E TELA (Touchpoint 2: desktop_tracker / ScreenObserver)
   * Monitora quando o Álvaro entra em um jogo, projeto no VS Code, documento ou fica >= 3 min focado.
   */
  function onDesktopStateChanged(dState) {
    if (!dState) return;

    const activeApp = String(dState.activeApp || '').trim();
    const activeTitle = String(dState.activeTitle || '').trim();
    if (!activeApp && !activeTitle) return;

    const now = Date.now();
    const isSameWindow = (activeTrackingState.app === activeApp && activeTrackingState.title === activeTitle);

    if (isSameWindow) {
      // Já está rastreando esta janela: avalia se atingiu o marco de 3 minutos de foco contínuo
      const durationMs = now - activeTrackingState.startTime;
      const THREE_MIN_MS = 3 * 60 * 1000;

      if (durationMs >= THREE_MIN_MS && !activeTrackingState.logged3Min) {
        activeTrackingState.logged3Min = true;
        const durationMin = Math.round(durationMs / 60000);

        // Identifica categoria de trabalho
        const isDev = /(?:code(?:\.exe)?|cursor|antigravity|visual\s*studio|sublime|pycharm|webstorm|intellij)/i.test(activeApp);
        const isGame = /(?:arena\s*breakout|steam|valorant|cs2|csgo|riot|epic|minecraft|cyberpunk)/i.test(activeApp + ' ' + activeTitle);
        const isStudy = /(?:pdf|estudo|notion|artigo|livro|edital|processo|tcc)/i.test(activeTitle);

        let categoria = 'OBSERVACAO_TELA';
        let titulo = `Sessão de Foco em ${activeApp || 'App'}`;
        let emocao = 'FOCUSED';
        let links = [activeApp || 'Desktop'];

        if (isDev) {
          categoria = 'TRABALHO_DEV';
          titulo = `Foco em Desenvolvimento (${activeApp})`;
          links = ['Engenharia de Software', activeApp];
        } else if (isGame) {
          categoria = 'JOGO';
          titulo = `Partida / Sessão de Jogo (${activeApp})`;
          emocao = 'EXCITED';
          links = ['Arena Breakout', activeApp];
        } else if (isStudy) {
          categoria = 'ESTUDO';
          titulo = `Leitura / Estudo Contínuo`;
          links = ['Estudo', activeApp];
        }

        recordDailyEvent({
          hora: getCurrentTimeString(),
          categoria,
          emocao,
          titulo,
          detalhes: `Álvaro permaneceu focado por mais de ${durationMin} minutos contínuos na janela "${activeTitle.slice(0, 90)}".`,
          links,
          appAtivo: activeApp
        }).catch(() => {});
      }
    } else {
      // Mudança de janela/app
      const prevApp = activeTrackingState.app;
      const prevTitle = activeTrackingState.title;

      activeTrackingState.app = activeApp;
      activeTrackingState.title = activeTitle;
      activeTrackingState.startTime = now;
      activeTrackingState.logged3Min = false;

      // Detecta entrada imediata em jogos (ex: Arena Breakout) ou documentos críticos
      const isGameLaunch = /(?:arena\s*breakout|valorant|cs2|csgo|cyberpunk)/i.test(activeApp + ' ' + activeTitle);
      const isCriticalDoc = /(?:edital|processo|contrato|tcc|monografia|relatorio|censo)/i.test(activeTitle);

      const immediateKey = `${activeApp}::${activeTitle}`;
      if (isGameLaunch && activeTrackingState.lastLoggedImmediate !== immediateKey) {
        activeTrackingState.lastLoggedImmediate = immediateKey;
        recordDailyEvent({
          hora: getCurrentTimeString(),
          categoria: 'JOGO',
          emocao: 'EXCITED',
          titulo: `Início de Jogo: ${activeApp}`,
          detalhes: `Álvaro iniciou sessão em: "${activeTitle.slice(0, 80)}". Protocolo de vigia e silêncio tático ativado.`,
          links: ['Jogos', activeApp],
          appAtivo: activeApp
        }).catch(() => {});
      } else if (isCriticalDoc && activeTrackingState.lastLoggedImmediate !== immediateKey) {
        activeTrackingState.lastLoggedImmediate = immediateKey;
        recordDailyEvent({
          hora: getCurrentTimeString(),
          categoria: 'ESTUDO',
          emocao: 'CURIOUS',
          titulo: `Documento Aberto: ${activeTitle.slice(0, 50)}`,
          detalhes: `Abertura de documento para leitura/análise: "${activeTitle.slice(0, 90)}".`,
          links: ['Documentos', activeApp],
          appAtivo: activeApp
        }).catch(() => {});
      }
    }
  }

  /**
   * 5. INICIALIZAÇÃO E INTEGRAÇÃO COM AS FERRAMENTAS DO SISTEMA
   */
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Garante pastas e diário inicial
    ensureDirSync(DIR_DIARIO);
    ensureDirSync(DIR_MEMORIAS);
    ensureDirSync(DIR_CONHECIMENTO);
    ensureDailyFile();

    // 2. Escuta eventos do Modo Estudo (study_mode.js) sem alterar seu código protegido
    if (typeof window !== 'undefined') {
      window.addEventListener('study-mode:change', (e) => {
        const isActive = Boolean(e && e.detail && e.detail.active);
        recordDailyEvent({
          hora: getCurrentTimeString(),
          categoria: 'ESTUDO',
          emocao: isActive ? 'FOCUSED' : 'HAPPY',
          titulo: isActive ? 'Início do Perfil de Estudo' : 'Encerramento do Perfil de Estudo',
          detalhes: isActive ? 'Modo de estudo ativado. BitBop em postura atenta e silenciosa.' : 'Modo de estudo encerrado.',
          links: ['Modo_Estudo'],
          appAtivo: 'Modo Estudo'
        }).catch(() => {});
      });

      // Intercepta e escuta salvamento de resumos de estudo no MemoryStore
      if (window.MemoryStore && typeof window.MemoryStore.saveStudySummary === 'function') {
        const origSaveStudySummary = window.MemoryStore.saveStudySummary.bind(window.MemoryStore);
        window.MemoryStore.saveStudySummary = function (data) {
          const res = origSaveStudySummary(data);
          try {
            if (data && data.titulo) {
              recordDailyEvent({
                hora: getCurrentTimeString(),
                categoria: 'ESTUDO',
                emocao: 'FOCUSED',
                titulo: `Resumo de Estudo: ${data.titulo}`,
                detalhes: String(data.resumoMarkdown || '').slice(0, 160).replace(/\r?\n+/g, ' '),
                links: [data.titulo, data.materia || 'Estudo'],
                appAtivo: 'Modo Estudo'
              }).catch(() => {});

              recordKnowledgeOrMemory({
                tipo: 'conhecimento',
                titulo: `Estudo: ${data.titulo}`,
                conteudo: `# ${data.titulo}\n\n**Matéria:** ${data.materia || 'Geral'}\n\n${data.resumoMarkdown || ''}\n\n${data.questoesRevisao ? '## Questões de Revisão\n' + data.questoesRevisao : ''}`,
                categoria: data.materia || 'Estudo',
                resumo_curto: String(data.resumoMarkdown || '').slice(0, 120),
                tags: ['estudo', (data.materia || 'geral').toLowerCase().replace(/\s+/g, '_')],
                links: [`[[05_Diario/${getTodayDateString()}]]`]
              }).catch(() => {});
            }
          } catch (err) {
            console.warn('[HippocampusLogger] Erro ao registrar resumo de estudo:', err);
          }
          return res;
        };
      }
    }

    writeDebugLog(`[HIPOCAMPO] Módulo inicializado com sucesso em ${VAULT_DIR}`);
  }

  // Auto-inicialização imediata
  try {
    init();
  } catch (err) {
    console.warn('[HippocampusLogger] Erro na auto-inicialização:', err);
  }

  return {
    init,
    ensureDailyFile,
    recordDailyEvent,
    recordKnowledgeOrMemory,
    recordConversationTurn,
    crossLinkAssociatedNotes,
    onDesktopStateChanged,
    getTodayDateString,
    getCurrentTimeString
  };
});
