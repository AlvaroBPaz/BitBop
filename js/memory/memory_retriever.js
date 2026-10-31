/**
 * ============================================================================
 * MÓDULO: RECUPERADOR COGNITIVO FAST-PATH (< 30ms) (MemoryRetriever)
 * Arquivo: js/memory/memory_retriever.js
 * ============================================================================
 * 
 * Responsabilidades:
 * 1. Executar recuperação associativa ultrarrápida antes de cada chamada ao Gemini.
 * 2. Aplicar a fórmula matemática de pontuação híbrida:
 *    S_relevancia = min(1.0, 0.65 * S_bm25 + 0.35 * S_alias)
 *    S_recencia = exp(-delta_dias / E)
 *    S_importancia = importancia / 10.0
 *    S_contexto = 0.15 se ativo na janela atual, senao 0.0
 *    S_final = 0.50 * S_relevancia + 0.20 * S_recencia + 0.20 * S_importancia + S_contexto + 0.10 * confianca
 * 3. Expansão associativa de 1 salto (Spreading Activation) pelos [[Wikilinks]].
 * 4. Curva de Ebbinghaus: atualiza acessos e estabilidade da memória.
 * 5. Orçamento de tokens rigoroso (~300 tokens) para não inflar o contexto.
 */

(function (global) {
  'use strict';

  /**
   * Calcula o score híbrido e seleciona as memórias mais relevantes.
   */
  function retrieveMemories(queryText, activeWindowTitle = '', isStudyMode = false, options = {}) {
    const memoryIndex = global.MemoryIndex;
    if (!memoryIndex || !memoryIndex.isReady()) {
      return { topNotes: [], neighbors: [], elapsedMs: 0 };
    }

    const t0 = performance.now();
    const threshold = options.threshold || 0.28;
    const topK = options.topK || 4;

    // 1. Busca textual BM25 e correspondência de Aliases
    const bm25Map = memoryIndex.searchBM25(queryText, 20);
    const aliasMap = memoryIndex.findAliasMatches(queryText);

    // Conjunto de candidatos únicos
    const candidateIds = new Set([...bm25Map.keys(), ...aliasMap.keys()]);
    if (candidateIds.size === 0) {
      return { topNotes: [], neighbors: [], elapsedMs: performance.now() - t0 };
    }

    const now = Date.now();
    const normActiveWindow = memoryIndex.normalizeText(activeWindowTitle || '');
    const scoredCandidates = [];

    // 2. Aplicação da fórmula matemática rigorosa
    for (const noteId of candidateIds) {
      const meta = memoryIndex.getNoteMetadata(noteId);
      if (!meta) continue;

      // Filtra notas privadas e memórias superadas por OUTRA nota diferente
      if (meta.privado) continue;
      if (meta.superada_por) {
        const cleanSp = String(meta.superada_por).replace(/[\[\]]/g, '').trim();
        const baseName = meta.path ? meta.path.replace(/^.*[\\\/]/, '').replace(/\.md$/, '') : '';
        if (cleanSp !== meta.path && cleanSp !== meta.id && cleanSp !== baseName && !cleanSp.endsWith('/' + baseName)) {
          continue; // Superada de fato por outra nota
        }
      }

      const sBm25 = bm25Map.get(noteId) || 0;
      const sAlias = aliasMap.get(noteId) || 0;

      // S_relevancia
      const sRelevancia = Math.min(1.0, 0.65 * sBm25 + 0.35 * sAlias);

      // S_recencia: exp(-delta_dias / E)
      const lastAccessMs = meta.ultimo_acesso ? new Date(meta.ultimo_acesso).getTime() : now;
      const deltaDias = Math.max(0, (now - lastAccessMs) / (1000 * 86400));
      const estabilidade = typeof meta.estabilidade === 'number' && meta.estabilidade > 0 ? meta.estabilidade : 7.0;
      const sRecencia = Math.exp(-deltaDias / estabilidade);

      // S_importancia
      const sImportancia = Math.min(1.0, Math.max(0.1, (meta.importancia || 7) / 10.0));

      // S_contexto (+0.15 se a janela ativa mencionar aliases ou tags da nota)
      let sContexto = 0.0;
      if (normActiveWindow) {
        const terms = [meta.titulo, ...(meta.aliases || []), ...(meta.tags || [])];
        for (const t of terms) {
          const normTerm = memoryIndex.normalizeText(t);
          if (normTerm && normTerm.length >= 3 && normActiveWindow.includes(normTerm)) {
            sContexto = 0.15;
            break;
          }
        }
      }

      // Confiança
      const confianca = typeof meta.confianca === 'number' ? meta.confianca : 1.0;

      // Diários do dia a dia têm menos peso em consultas factuais genéricas (a menos que a busca pergunte de rotina/hoje/diário)
      let sTipo = 1.0;
      if (meta.tipo === 'diario') {
        const isDiaryQuery = /hoje|dia|di[aá]rio|rotina|aconteceu|fizemos/i.test(queryText);
        sTipo = isDiaryQuery ? 1.0 : 0.35;
      }

      // S_final
      const sFinal = (0.50 * sRelevancia + 0.20 * sRecencia + 0.20 * sImportancia + sContexto + 0.10 * confianca) * sTipo;

      if (sFinal >= threshold) {
        scoredCandidates.push({
          meta,
          scoreFinal: sFinal,
          sRelevancia,
          sRecencia,
          sImportancia
        });
      }
    }

    // 3. Ordenação decrescente por score final
    scoredCandidates.sort((a, b) => b.scoreFinal - a.scoreFinal);
    const topNotes = scoredCandidates.slice(0, topK);

    // 4. Expansão associativa de 1 salto (Spreading Activation por [[Wikilinks]])
    const selectedIds = new Set(topNotes.map((n) => n.meta.id));
    const neighbors = [];

    const topForExpansion = topNotes.slice(0, 3);
    for (const item of topForExpansion) {
      const neighborList = memoryIndex.getOneHopNeighbors(item.meta.id, 2);
      for (const n of neighborList) {
        if (!selectedIds.has(n.id)) {
          selectedIds.add(n.id);
          neighbors.push(n);
          if (neighbors.length >= 3) break;
        }
      }
      if (neighbors.length >= 3) break;
    }

    // 5. Atualização de Curva de Ebbinghaus (reforço de memória por acesso)
    for (const item of topNotes) {
      item.meta.acessos = (item.meta.acessos || 0) + 1;
      item.meta.ultimo_acesso = new Date().toISOString();
      const currentE = item.meta.estabilidade || 7.0;
      item.meta.estabilidade = Math.min(365, currentE * (1 + 0.25 * item.sImportancia));
    }

    const elapsedMs = performance.now() - t0;
    return { topNotes, neighbors, elapsedMs };
  }

  /**
   * Constrói o bloco de texto formatado para injeção no System Prompt do Gemini.
   * Se nenhuma memória passar no limiar, retorna string vazia sem consumir tokens.
   */
  function buildFastPathBlock(queryText, activeWindowTitle = '', isStudyMode = false) {
    if (!queryText || typeof queryText !== 'string' || queryText.trim().length < 3) {
      return '';
    }

    const { topNotes, neighbors, elapsedMs } = retrieveMemories(queryText, activeWindowTitle, isStudyMode);
    if (topNotes.length === 0) {
      return '';
    }

    let block = `[MEMÓRIAS RELEVANTES DO OBSIDIAN (VERDADE CANÔNICA DO COFRE - PRIORIDADE TOTAL SOBRE O HISTÓRICO - ATIVADAS EM ${elapsedMs.toFixed(1)}ms)]\n`;
    for (const item of topNotes) {
      const m = item.meta;
      const cleanSummary = (m.resumo_curto || '').replace(/\r?\n/g, ' ').slice(0, 150);
      block += `- [${m.tipo.toUpperCase()}] "${m.titulo}": ${cleanSummary}\n`;
    }

    if (neighbors.length > 0) {
      block += `\n[CONEXÕES ASSOCIATIVAS (1 SALTO NO GRAFO)]\n`;
      for (const n of neighbors) {
        const cleanSummary = (n.resumo_curto || '').replace(/\r?\n/g, ' ').slice(0, 120);
        block += `- [[${n.titulo}]]: ${cleanSummary}\n`;
      }
    }

    return block.trim();
  }

  const MemoryRetriever = {
    retrieveMemories,
    buildFastPathBlock
  };

  global.MemoryRetriever = MemoryRetriever;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryRetriever;
  }

})(typeof window !== 'undefined' ? window : global);
