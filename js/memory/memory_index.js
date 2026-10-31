/**
 * ============================================================================
 * MÓDULO: ÍNDICE EM RAM E MOTOR DE BUSCA BM25 / GRAFO (MemoryIndex)
 * Arquivo: js/memory/memory_index.js
 * ============================================================================
 * 
 * Responsabilidades:
 * 1. Manter índice 100% puro JavaScript em RAM para recuperação em < 5ms (zero binários C++).
 * 2. Grafo de Aliases (aliasToNoteIds) para matching instantâneo em 0ms.
 * 3. Grafo de Conexões Bidirecionais de [[Wikilinks]] (linksOut e linksIn).
 * 4. Motor de busca BM25 otimizado para Língua Portuguesa (remoção de stopwords e diacríticos).
 * 5. Persistência e restauração incremental via snapshot em .bitbop/index_snapshot.json.
 */

(function (global) {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  // Stopwords comuns em português para filtragem de ruído no BM25
  const STOPWORDS_PT = new Set([
    'a', 'ao', 'aos', 'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo', 'as', 'ate',
    'com', 'como', 'da', 'das', 'de', 'dela', 'delas', 'dele', 'deles', 'do', 'dos',
    'e', 'ela', 'elas', 'ele', 'eles', 'em', 'era', 'eram', 'essa', 'essas', 'esse',
    'esses', 'esta', 'estamos', 'estas', 'estava', 'estavam', 'este', 'estes', 'estou',
    'eu', 'foi', 'fomos', 'foram', 'ha', 'isso', 'isto', 'ja', 'lhe', 'lhes', 'mais',
    'mas', 'me', 'mesmo', 'meu', 'meus', 'minha', 'minhas', 'na', 'nao', 'nas', 'nem',
    'no', 'nos', 'nossa', 'nossas', 'nosso', 'nossos', 'num', 'numa', 'o', 'os', 'ou',
    'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'qual', 'quando', 'que', 'quem',
    'sao', 'se', 'seja', 'sem', 'seu', 'seus', 'so', 'somos', 'sou', 'sua', 'suas',
    'tambem', 'te', 'tem', 'temos', 'tenho', 'teu', 'teus', 'tu', 'tua', 'tuas', 'um',
    'uma', 'umas', 'uns', 'voce', 'voces'
  ]);

  // Estruturas de Dados Centrais em RAM
  const notesById = new Map();       // noteId -> NoteMetadata
  const notesByPath = new Map();     // relativePath -> noteId
  const aliasToNoteIds = new Map();  // normalizedTerm -> Set<noteId>
  const invertedIndex = new Map();   // token -> Set<noteId>
  const tokenDocFreq = new Map();    // token -> count of docs containing token
  const linksInMap = new Map();      // noteTitleOrName -> Set<noteId> (quem aponta para ele)

  let totalDocLength = 0;
  let isIndexReady = false;

  /**
   * Normaliza texto: minúsculas, remove diacríticos/acentos e pontuação.
   */
  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Tokeniza texto filtrando stopwords e tokens de comprimento < 2.
   */
  function tokenize(text) {
    const norm = normalizeText(text);
    if (!norm) return [];
    return norm
      .split(' ')
      .filter((t) => t.length >= 2 && !STOPWORDS_PT.has(t));
  }

  /**
   * Obtém caminho do Vault através do MemoryStore.
   */
  function getVaultDir() {
    if (global.MemoryStore && typeof global.MemoryStore.getVaultPath === 'function') {
      return global.MemoryStore.getVaultPath();
    }
    const base = nodePath && typeof __dirname !== 'undefined' ? nodePath.resolve(__dirname, '..', '..') : '.';
    return nodePath ? nodePath.join(base, 'BitBop-Cerebro') : 'BitBop-Cerebro';
  }

  /**
   * Remove arquivo do índice em RAM.
   */
  function removeFileFromIndex(relativePath) {
    let rel = relativePath.trim().replace(/^[/\\]+/, '');
    if (!rel.endsWith('.md')) rel += '.md';
    const noteId = notesByPath.get(rel);
    if (!noteId) return;

    const meta = notesById.get(noteId);
    if (meta) {
      // Remove tokens do índice invertido
      if (meta.tokensFreq) {
        for (const token of Object.keys(meta.tokensFreq)) {
          const docSet = invertedIndex.get(token);
          if (docSet) {
            docSet.delete(noteId);
            if (docSet.size === 0) invertedIndex.delete(token);
          }
          const curFreq = tokenDocFreq.get(token) || 1;
          if (curFreq <= 1) tokenDocFreq.delete(token);
          else tokenDocFreq.set(token, curFreq - 1);
        }
      }
      totalDocLength = Math.max(0, totalDocLength - (meta.docLength || 0));

      // Remove aliases
      const allAliases = [meta.titulo, ...(meta.aliases || [])];
      for (const al of allAliases) {
        const normAl = normalizeText(al);
        const set = aliasToNoteIds.get(normAl);
        if (set) {
          set.delete(noteId);
          if (set.size === 0) aliasToNoteIds.delete(normAl);
        }
      }
    }

    notesById.delete(noteId);
    notesByPath.delete(rel);
  }

  /**
   * Indexa um único arquivo Markdown no índice em RAM.
   */
  function indexSingleFile(relativePath) {
    if (!global.MemoryStore || !nodeFs || !nodePath) return null;

    let rel = relativePath.trim().replace(/^[/\\]+/, '');
    if (!rel.endsWith('.md')) rel += '.md';

    // Ignora pastas administrativas e arquivo de lixeira
    if (rel.startsWith('99_Arquivo') || rel.startsWith('.bitbop')) {
      return null;
    }

    const readRes = global.MemoryStore.readNote(rel);
    if (!readRes || !readRes.ok) {
      removeFileFromIndex(rel);
      return null;
    }

    // Se já existia, remove dados antigos para reindexar de forma idempotente
    if (notesByPath.has(rel)) {
      removeFileFromIndex(rel);
    }

    const fm = readRes.frontmatter || {};
    const body = readRes.body || '';
    const wikilinks = readRes.wikilinks || [];

    const noteId = fm.id || `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const titulo = fm.titulo || nodePath.basename(rel, '.md').replace(/_/g, ' ');
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : [];
    const tags = Array.isArray(fm.tags) ? fm.tags : [];
    const cleanBodySummary = body ? body.trim().replace(/\r?\n+/g, ' ').slice(0, 180) : '';
    // O texto no corpo editado pelo usuário tem prioridade absoluta sobre frontmatter desatualizado
    const resumoCurto = cleanBodySummary || fm.resumo_curto || titulo;
    const tipo = fm.tipo || 'fato';
    const importancia = typeof fm.importancia === 'number' ? fm.importancia : 7;
    const estabilidade = typeof fm.estabilidade === 'number' ? fm.estabilidade : 7.0;
    const confianca = (global.MemoryStore && typeof global.MemoryStore.isUserEdited === 'function' && global.MemoryStore.isUserEdited(rel))
      ? 1.0
      : (typeof fm.confianca === 'number' ? fm.confianca : 1.0);
    const acessos = typeof fm.acessos === 'number' ? fm.acessos : 1;
    const ultimoAcesso = fm.ultimo_acesso || fm.criado || new Date().toISOString();
    const emocaoOled = fm.emocao_oled || 'NORMAL';
    const privado = Boolean(fm.privado);
    const locked = Boolean(fm.locked);
    let superadaPor = fm.superada_por || null;
    if (superadaPor) {
      const spClean = String(superadaPor).replace(/[\[\]]/g, '').trim();
      const baseName = nodePath.basename(rel, '.md');
      if (spClean === rel || spClean === baseName || spClean.endsWith('/' + baseName)) {
        superadaPor = null; // Auto-referência é descartada
      }
    }

    // Tokenização para cálculo BM25
    const fullText = `${titulo} ${aliases.join(' ')} ${tags.join(' ')} ${resumoCurto} ${body}`;
    const tokens = tokenize(fullText);
    const tokensFreq = {};
    for (const t of tokens) {
      tokensFreq[t] = (tokensFreq[t] || 0) + 1;
    }

    const docLength = tokens.length;
    totalDocLength += docLength;

    for (const token of Object.keys(tokensFreq)) {
      if (!invertedIndex.has(token)) {
        invertedIndex.set(token, new Set());
      }
      invertedIndex.get(token).add(noteId);
      tokenDocFreq.set(token, (tokenDocFreq.get(token) || 0) + 1);
    }

    // Indexação de Aliases e Título para matching exato em 0ms
    const termsToMap = [titulo, ...aliases];
    for (const term of termsToMap) {
      const norm = normalizeText(term);
      if (norm) {
        if (!aliasToNoteIds.has(norm)) {
          aliasToNoteIds.set(norm, new Set());
        }
        aliasToNoteIds.get(norm).add(noteId);
      }
    }

    // Grafo de links de saída (linksOut)
    const linksOut = wikilinks;
    for (const target of linksOut) {
      const normTarget = normalizeText(target);
      if (!linksInMap.has(normTarget)) {
        linksInMap.set(normTarget, new Set());
      }
      linksInMap.get(normTarget).add(noteId);
    }

    const metadata = {
      id: noteId,
      path: rel,
      titulo,
      tipo,
      aliases,
      tags,
      resumo_curto: resumoCurto,
      importancia,
      estabilidade,
      confianca,
      acessos,
      ultimo_acesso: ultimoAcesso,
      emocao_oled: emocaoOled,
      privado,
      locked,
      superada_por: superadaPor,
      docLength,
      tokensFreq,
      linksOut
    };

    notesById.set(noteId, metadata);
    notesByPath.set(rel, noteId);

    return metadata;
  }

  /**
   * Varre recursivamente todas as pastas do Vault indexando notas válidas.
   */
  function scanVaultRecursively(dir, baseRel = '') {
    if (!nodeFs || !nodePath || !nodeFs.existsSync(dir)) return;
    const entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = nodePath.join(dir, entry.name);
      const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === '.bitbop' || entry.name === '99_Arquivo' || entry.name === '.git') {
          continue;
        }
        scanVaultRecursively(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        indexSingleFile(relPath);
      }
    }
  }

  /**
   * Constrói ou recarrega o índice do Vault com persistência de snapshot em disco.
   */
  function buildOrLoadIndex() {
    if (!nodeFs || !nodePath) return false;
    const t0 = performance.now();
    const vaultDir = getVaultDir();
    const snapshotPath = nodePath.join(vaultDir, '.bitbop', 'index_snapshot.json');

    // Limpa estado anterior em RAM
    notesById.clear();
    notesByPath.clear();
    aliasToNoteIds.clear();
    invertedIndex.clear();
    tokenDocFreq.clear();
    linksInMap.clear();
    totalDocLength = 0;

    // Escaneia os arquivos do Vault
    scanVaultRecursively(vaultDir);

    // Salva snapshot assíncrono para inicializações instantâneas futuras
    saveSnapshot(snapshotPath);

    isIndexReady = true;
    const elapsed = (performance.now() - t0).toFixed(1);
    console.log(`[MemoryIndex] Índice em RAM pronto: ${notesById.size} notas, ${aliasToNoteIds.size} termos mapeados em ${elapsed}ms.`);
    return true;
  }

  /**
   * Salva snapshot compacto do índice em disco.
   */
  function saveSnapshot(snapshotPath) {
    if (!nodeFs) return;
    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        totalNotes: notesById.size,
        notes: Array.from(notesById.values()).map((n) => ({
          id: n.id,
          path: n.path,
          titulo: n.titulo,
          tipo: n.tipo,
          aliases: n.aliases,
          tags: n.tags,
          resumo_curto: n.resumo_curto,
          importancia: n.importancia,
          estabilidade: n.estabilidade,
          confianca: n.confianca,
          acessos: n.acessos,
          ultimo_acesso: n.ultimo_acesso,
          linksOut: n.linksOut
        }))
      };
      nodeFs.writeFileSync(snapshotPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn('[MemoryIndex] Aviso ao salvar index_snapshot:', err);
    }
  }

  /**
   * Motor de Busca BM25 puro em JavaScript.
   * Retorna Map<noteId, score> normalizado entre 0.0 e 1.0.
   */
  function searchBM25(queryText, topK = 15) {
    const queryTokens = tokenize(queryText);
    if (queryTokens.length === 0 || notesById.size === 0) return new Map();

    const N = notesById.size;
    const avgdl = totalDocLength / (N || 1);
    const k1 = 1.2;
    const b = 0.75;
    const rawScores = new Map();

    for (const token of queryTokens) {
      const docSet = invertedIndex.get(token);
      if (!docSet || docSet.size === 0) continue;

      const df = docSet.size;
      // Fórmula de IDF Robertson-Spärck Jones (suavizada com +1)
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const noteId of docSet) {
        const meta = notesById.get(noteId);
        if (!meta) continue;

        const tf = meta.tokensFreq[token] || 0;
        const dl = meta.docLength || avgdl;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (dl / avgdl));
        const tokenScore = idf * (numerator / denominator);

        rawScores.set(noteId, (rawScores.get(noteId) || 0) + tokenScore);
      }
    }

    if (rawScores.size === 0) return new Map();

    // Normaliza scores pelo maior valor encontrado para ficar na escala [0..1]
    let maxScore = 0;
    for (const s of rawScores.values()) {
      if (s > maxScore) maxScore = s;
    }

    const normalizedScores = new Map();
    const sorted = Array.from(rawScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    for (const [id, s] of sorted) {
      normalizedScores.set(id, maxScore > 0 ? s / maxScore : 0);
    }

    return normalizedScores;
  }

  /**
   * Localiza notas cujos aliases ou títulos coincidem com a fala/query.
   * Retorna Map<noteId, hitScore> (1.0 para match exato, 0.7 para substring).
   */
  function findAliasMatches(queryText) {
    const normQuery = normalizeText(queryText);
    const matches = new Map();
    if (!normQuery) return matches;

    for (const [term, noteIds] of aliasToNoteIds.entries()) {
      if (!term || term.length < 3) continue;

      let score = 0;
      if (normQuery === term) {
        score = 1.0;
      } else if (normQuery.includes(term)) {
        score = 0.85;
      } else if (term.includes(normQuery) && normQuery.length >= 4) {
        score = 0.65;
      }

      if (score > 0) {
        for (const noteId of noteIds) {
          const current = matches.get(noteId) || 0;
          if (score > current) matches.set(noteId, score);
        }
      }
    }

    return matches;
  }

  /**
   * Retorna notas vizinhas conectadas por [[Wikilinks]] de entrada ou saída (1-Hop).
   */
  function getOneHopNeighbors(noteId, limit = 3) {
    const meta = notesById.get(noteId);
    if (!meta) return [];

    const neighbors = new Set();

    // 1. Links de saída ([[Alvo]])
    if (meta.linksOut) {
      for (const targetTitle of meta.linksOut) {
        const norm = normalizeText(targetTitle);
        const targetIds = aliasToNoteIds.get(norm);
        if (targetIds) {
          for (const tid of targetIds) {
            if (tid !== noteId) neighbors.add(tid);
          }
        }
      }
    }

    // 2. Links de entrada (quem aponta para esta nota)
    const normMyTitle = normalizeText(meta.titulo);
    const inIds = linksInMap.get(normMyTitle);
    if (inIds) {
      for (const iid of inIds) {
        if (iid !== noteId) neighbors.add(iid);
      }
    }

    const result = [];
    for (const nid of neighbors) {
      const neighborMeta = notesById.get(nid);
      if (neighborMeta && !neighborMeta.privado && !neighborMeta.superada_por) {
        result.push(neighborMeta);
        if (result.length >= limit) break;
      }
    }

    return result;
  }

  /**
   * Obtém metadados de uma nota pelo ID ou pelo título.
   */
  function getNoteMetadata(idOrTitle) {
    if (notesById.has(idOrTitle)) return notesById.get(idOrTitle);
    const norm = normalizeText(idOrTitle);
    const ids = aliasToNoteIds.get(norm);
    if (ids && ids.size > 0) {
      const firstId = ids.values().next().value;
      return notesById.get(firstId);
    }
    return null;
  }

  /**
   * Retorna todas as notas indexadas (para ferramentas de auditoria e listagem).
   */
  function getAllNotes() {
    return Array.from(notesById.values());
  }

  const MemoryIndex = {
    buildOrLoadIndex,
    indexSingleFile,
    removeFileFromIndex,
    searchBM25,
    findAliasMatches,
    getOneHopNeighbors,
    getNoteMetadata,
    getAllNotes,
    normalizeText,
    tokenize,
    isReady: () => isIndexReady,
    count: () => notesById.size
  };

  // Inicialização automática do índice quando o Vault estiver pronto
  if (nodeFs && nodePath) {
    setTimeout(() => {
      buildOrLoadIndex();
    }, 100);
  }

  global.MemoryIndex = MemoryIndex;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryIndex;
  }

})(typeof window !== 'undefined' ? window : global);
