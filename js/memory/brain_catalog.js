/**
 * ============================================================================
 * MÓDULO: MAPA MENTAL DO COFRE (BrainCatalog)
 * Arquivo: js/memory/brain_catalog.js
 * ============================================================================
 * 
 * Responsabilidades (Parte 2 da Arquitetura Cognitiva em 4 Partes):
 * 1. Manter em RAM (e em cache em BitBop-Cerebro/.bitbop/brain_catalog.json)
 *    um catálogo estruturado e sempre atualizado de TODOS os arquivos .md
 *    nas pastas do cofre (00_Nucleo até 08_Inbox).
 * 2. Atualizar em tempo real quando o vault_watcher.js detectar criação,
 *    edição ou exclusão de notas no Obsidian.
 * 3. Gerar o mapa mental compacto para a IA (getCompactBrainMapForLLM),
 *    organizado por categorias e ordenado pelos arquivos modificados mais
 *    recentemente, informando data relativa (hoje, ontem), resumo e links.
 * 4. Executar leitura associativa por sinapses (readFilesWithSynapses),
 *    abrindo os arquivos primários e automaticamente anexando as notas
 *    conectadas via [[Wikilinks]] (memória associativa em profundidade 1),
 *    formatando o "Dossiê de Memórias Abertas" pronto para o prompt do LLM.
 */

(function (root, factory) {
  const instance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof window !== 'undefined') window.BrainCatalog = instance;
  if (typeof globalThis !== 'undefined') globalThis.BrainCatalog = instance;
  if (typeof global !== 'undefined') global.BrainCatalog = instance;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  // Localização base e pastas do cofre
  const BASE_DIR = (function () {
    if (nodePath && typeof __dirname !== 'undefined' && __dirname) {
      if (__dirname.endsWith('memory')) return nodePath.resolve(__dirname, '..', '..');
      if (__dirname.endsWith('js')) return nodePath.resolve(__dirname, '..');
      if (__dirname.endsWith('desktop-pet')) return __dirname;
    }
    return 'C:\\Stack-Chan\\desktop-pet';
  })();

  const VAULT_DIR = nodePath ? nodePath.join(BASE_DIR, 'BitBop-Cerebro') : 'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro';
  const BITBOP_DIR = nodePath ? nodePath.join(VAULT_DIR, '.bitbop') : `${VAULT_DIR}\\.bitbop`;
  const CACHE_FILE = nodePath ? nodePath.join(BITBOP_DIR, 'brain_catalog.json') : `${BITBOP_DIR}\\brain_catalog.json`;
  const LOG_FILE = nodePath ? nodePath.join(BASE_DIR, 'pet-debug.log') : `${BASE_DIR}\\pet-debug.log`;

  // Pastas a ignorar na varredura
  const IGNORED_DIRS = new Set(['.git', '.obsidian', '.bitbop', '.trash', '99_Arquivo']);

  // Nomes amigáveis para exibição de categorias
  const FOLDER_DISPLAY_NAMES = {
    '00_Nucleo': '00_Nucleo (Identidade e Regras Fundamentais)',
    '01_Memorias': '01_Memorias (Fatos, Marcos e Decisões)',
    '01_Diario': '01_Diario (Histórico de Diários)',
    '02_Rotinas': '02_Rotinas (Hábitos e Processos Contínuos)',
    '02_Episodios': '02_Episodios (Momentos e Histórias Marcantes)',
    '03_Conhecimento': '03_Conhecimento (Conceitos, Projetos e Tecnologias)',
    '04_Procedimentos': '04_Procedimentos (Guias de Execução Passo a Passo)',
    '05_Diario': '05_Diario (Diário Vivo em Tempo Real)',
    '05_Estudo': '05_Estudo (Resumos Acadêmicos e Revisões SM-2)',
    '06_Pendencias': '06_Pendencias (Tarefas, Lembretes e Prazos)',
    '07_Reflexoes': '07_Reflexoes (Pensamentos, Sonhos e Ideias Livres)',
    '08_Inbox': '08_Inbox (Notas Rápidas para Curadoria)'
  };

  // Estado em RAM do catálogo: Map<relativePath, CatalogEntry>
  const catalogMap = new Map();
  let isScanning = false;
  let saveCacheDebounceTimer = null;
  let isInitialized = false;

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
   * Garante a criação de pastas
   */
  function ensureDirSync(dirPath) {
    if (!nodeFs) return;
    try {
      if (!nodeFs.existsSync(dirPath)) {
        nodeFs.mkdirSync(dirPath, { recursive: true });
      }
    } catch {}
  }

  /**
   * Formata data para YYYY-MM-DD HH:mm
   */
  function formatDateTime(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return '';
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const h = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
  }

  /**
   * Normaliza separadores de caminho para forward slash
   */
  function normalizeRelPath(relPath) {
    return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  /**
   * Retorna 'hoje' e 'ontem' no formato YYYY-MM-DD
   */
  function getTodayAndYesterday() {
    const now = new Date();
    const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    return { today: fmt(now), yesterday: fmt(yest) };
  }

  /**
   * Formata uma data completa para representação relativa (hoje HH:mm, ontem HH:mm, ou YYYY-MM-DD)
   */
  function formatRelativeDate(dateTimeStr, todayStr, yesterdayStr) {
    if (!dateTimeStr) return '';
    const [datePart, timePart] = dateTimeStr.split(' ');
    if (datePart === todayStr) {
      return timePart ? `hoje ${timePart}` : 'hoje';
    }
    if (datePart === yesterdayStr) {
      return timePart ? `ontem ${timePart}` : 'ontem';
    }
    return datePart;
  }

  /**
   * Parser rápido e resiliente de Frontmatter YAML
   */
  function parseFrontmatterAndBody(fileContent) {
    if (!fileContent.startsWith('---')) {
      return { frontmatter: {}, body: fileContent };
    }

    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, body: fileContent };
    }

    const yamlText = match[1];
    const bodyText = match[2];
    const frontmatter = {};

    const lines = yamlText.split(/\r?\n/);
    let currentKey = null;
    let isArray = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Lista YAML indentada: "  - item"
      const arrayItemMatch = line.match(/^\s*-\s+(.*)$/);
      if (arrayItemMatch && currentKey && isArray) {
        let val = arrayItemMatch[1].trim().replace(/^["']|["']$/g, '');
        if (val) frontmatter[currentKey].push(val);
        continue;
      }

      // Par chave: valor
      const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1].trim();
        const rawVal = kvMatch[2].trim();

        if (rawVal === '' || rawVal === '[]') {
          frontmatter[currentKey] = [];
          isArray = true;
        } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          // Lista inline: [a, b, c]
          const items = rawVal
            .slice(1, -1)
            .split(',')
            .map(x => x.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
          frontmatter[currentKey] = items;
          isArray = false;
        } else {
          // Valor escalar
          frontmatter[currentKey] = rawVal.replace(/^["']|["']$/g, '');
          isArray = false;
        }
      }
    }

    return { frontmatter, body: bodyText };
  }

  /**
   * Extrai todos os [[Wikilinks]] de um texto
   */
  function extractWikilinks(text) {
    if (!text || typeof text !== 'string') return [];
    const links = new Set();
    const rx = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const cleanTarget = m[1].trim();
      if (cleanTarget) links.add(cleanTarget);
    }
    return Array.from(links);
  }

  /**
   * Extrai tags do frontmatter e do corpo (#tag)
   */
  function extractTags(frontmatter, body) {
    const tagSet = new Set();

    // 1. Tags do Frontmatter
    if (frontmatter.tags) {
      if (Array.isArray(frontmatter.tags)) {
        frontmatter.tags.forEach(t => {
          if (t) tagSet.add(String(t).trim().toLowerCase().replace(/^#/, ''));
        });
      } else if (typeof frontmatter.tags === 'string') {
        frontmatter.tags.split(',').forEach(t => {
          if (t.trim()) tagSet.add(t.trim().toLowerCase().replace(/^#/, ''));
        });
      }
    }

    // 2. Hashtags no corpo (excluindo cabeçalhos Markdown "# ")
    if (body) {
      const bodyTagRx = /(?:^|\s)#([a-zA-Z0-9_\-À-ÿ]+)(?!\w)/g;
      let m;
      while ((m = bodyTagRx.exec(body)) !== null) {
        const t = m[1].trim().toLowerCase();
        // Ignora números puros ou marcadores comuns
        if (t && isNaN(Number(t))) {
          tagSet.add(t);
        }
      }
    }

    return Array.from(tagSet);
  }

  /**
   * Extrai o título da nota
   */
  function extractTitle(frontmatter, body, filename) {
    if (frontmatter.titulo) return String(frontmatter.titulo).trim();
    if (frontmatter.title) return String(frontmatter.title).trim();

    // Procura primeiro # Título no corpo
    const headerMatch = body.match(/^#\s+(.+)$/m);
    if (headerMatch && headerMatch[1].trim()) {
      return headerMatch[1].trim();
    }

    // Fallback: nome do arquivo sem .md
    return filename.replace(/\.md$/i, '').replace(/_/g, ' ');
  }

  /**
   * Extrai resumo curto da nota (resumo_curto ou primeiras 2 linhas úteis, máx 180 chars)
   */
  function extractShortSummary(frontmatter, body) {
    if (frontmatter.resumo_curto && typeof frontmatter.resumo_curto === 'string' && frontmatter.resumo_curto.trim()) {
      return frontmatter.resumo_curto.trim().replace(/\r?\n+/g, ' ').slice(0, 180);
    }

    // Varre as primeiras linhas úteis do corpo
    const lines = body.split(/\r?\n/);
    const usefulLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('```') || trimmed.startsWith('![')) {
        continue;
      }
      // Remove marcações markdown simples
      const cleanLine = trimmed
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
      usefulLines.push(cleanLine);
      if (usefulLines.length >= 2) break;
    }

    const summary = usefulLines.join(' ').replace(/\s+/g, ' ').trim();
    return summary ? summary.slice(0, 180) : 'Sem resumo disponível';
  }

  /**
   * Extrai datas de criação e modificação
   */
  function extractDates(frontmatter, stat) {
    let dateCreated = '';
    let lastModified = '';

    // Data de Criação
    if (frontmatter.criado) {
      const d = new Date(frontmatter.criado);
      if (!isNaN(d.getTime())) dateCreated = formatDateTime(d);
    }
    if (!dateCreated && stat && stat.birthtime) {
      dateCreated = formatDateTime(stat.birthtime);
    }
    if (!dateCreated && stat && stat.ctime) {
      dateCreated = formatDateTime(stat.ctime);
    }

    // Data de Última Modificação
    if (frontmatter.atualizado) {
      const d = new Date(frontmatter.atualizado);
      if (!isNaN(d.getTime())) lastModified = formatDateTime(d);
    } else if (frontmatter.ultimo_acesso) {
      const d = new Date(frontmatter.ultimo_acesso);
      if (!isNaN(d.getTime())) lastModified = formatDateTime(d);
    }
    if (!lastModified && stat && stat.mtime) {
      lastModified = formatDateTime(stat.mtime);
    }

    // Se ainda vazio, usa data de criação
    if (!lastModified) lastModified = dateCreated;
    if (!dateCreated) dateCreated = lastModified;

    return { dateCreated, lastModified };
  }

  /**
   * Analisa um arquivo markdown e gera sua entrada estruturada de catálogo
   */
  function indexMarkdownFile(fullPath, relPath) {
    if (!nodeFs) return null;

    try {
      const stat = nodeFs.statSync(fullPath);
      const rawContent = nodeFs.readFileSync(fullPath, 'utf8');
      const filename = nodePath ? nodePath.basename(fullPath) : relPath.split('/').pop();

      const { frontmatter, body } = parseFrontmatterAndBody(rawContent);
      const title = extractTitle(frontmatter, body, filename);
      const tags = extractTags(frontmatter, body);
      const wikilinks = extractWikilinks(rawContent);
      const shortSummary = extractShortSummary(frontmatter, body);
      const { dateCreated, lastModified } = extractDates(frontmatter, stat);

      // Determina pasta de origem
      const parts = normalizeRelPath(relPath).split('/');
      const folder = parts.length > 1 ? parts[0] : 'Raiz';

      const entry = {
        relativePath: normalizeRelPath(relPath),
        title,
        folder,
        dateCreated,
        lastModified,
        tags,
        wikilinks,
        shortSummary,
        sizeBytes: stat.size
      };

      catalogMap.set(entry.relativePath, entry);
      return entry;
    } catch (err) {
      console.warn(`[BrainCatalog] Falha ao catalogar ${relPath}:`, err.message);
      return null;
    }
  }

  /**
   * Salva o catálogo em cache (BitBop-Cerebro/.bitbop/brain_catalog.json) com debounce
   */
  function scheduleSaveCache() {
    if (saveCacheDebounceTimer) clearTimeout(saveCacheDebounceTimer);
    saveCacheDebounceTimer = setTimeout(() => {
      saveCacheNow();
    }, 1200);
  }

  /**
   * Grava imediatamente o catálogo em disco
   */
  function saveCacheNow() {
    if (!nodeFs) return;
    ensureDirSync(BITBOP_DIR);

    const filesArray = Array.from(catalogMap.values());
    const payload = {
      version: 1,
      last_scan: new Date().toISOString(),
      total_files: filesArray.length,
      files: filesArray
    };

    try {
      nodeFs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('[BrainCatalog] Falha ao salvar cache brain_catalog.json:', err.message);
    }
  }

  /**
   * Carrega o catálogo do cache em disco se disponível
   */
  function loadCacheIfAvailable() {
    if (!nodeFs || !nodeFs.existsSync(CACHE_FILE)) return false;

    try {
      const raw = nodeFs.readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.files)) {
        catalogMap.clear();
        for (const item of data.files) {
          if (item && item.relativePath) {
            catalogMap.set(item.relativePath, item);
          }
        }
        return true;
      }
    } catch (err) {
      console.warn('[BrainCatalog] Erro ao carregar cache do catálogo:', err.message);
    }
    return false;
  }

  /**
   * Varredura recursiva de todos os arquivos .md em BitBop-Cerebro/
   */
  function scanVaultRecursive(dir = VAULT_DIR, baseRel = '') {
    if (!nodeFs || !nodeFs.existsSync(dir)) return;

    const entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;

      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;
        const subDir = nodePath ? nodePath.join(dir, name) : `${dir}\\${name}`;
        const subRel = baseRel ? `${baseRel}/${name}` : name;
        scanVaultRecursive(subDir, subRel);
      } else if (ent.isFile() && name.endsWith('.md')) {
        const full = nodePath ? nodePath.join(dir, name) : `${dir}\\${name}`;
        const rel = baseRel ? `${baseRel}/${name}` : name;
        indexMarkdownFile(full, rel);
      }
    }
  }

  /**
   * Executa varredura completa do cofre e atualiza RAM e cache
   */
  function refreshEntireCatalog() {
    if (!nodeFs || isScanning) return;
    isScanning = true;

    try {
      const startTime = Date.now();
      scanVaultRecursive();
      saveCacheNow();
      const elapsed = Date.now() - startTime;
      writeDebugLog(`[HIPOCAMPO] Catálogo do cérebro indexado: ${catalogMap.size} arquivos em ${elapsed}ms`);
    } catch (err) {
      console.error('[BrainCatalog] Erro na varredura completa:', err);
    } finally {
      isScanning = false;
    }
  }

  /**
   * Chamado em tempo real pelo VaultWatcher ao criar, editar ou excluir nota
   */
  function onVaultFileChanged(relPath) {
    if (!relPath || !nodeFs) return;
    const cleanRel = normalizeRelPath(relPath);

    // Ignora pastas internas do sistema
    for (const ig of IGNORED_DIRS) {
      if (cleanRel.startsWith(ig + '/') || cleanRel === ig) return;
    }
    if (!cleanRel.endsWith('.md')) return;

    const fullPath = nodePath ? nodePath.join(VAULT_DIR, cleanRel) : `${VAULT_DIR}\\${cleanRel}`;

    if (!nodeFs.existsSync(fullPath)) {
      // Arquivo foi excluído
      if (catalogMap.has(cleanRel)) {
        catalogMap.delete(cleanRel);
        scheduleSaveCache();
        writeDebugLog(`[HIPOCAMPO] Nota removida do catálogo: ${cleanRel}`);
      }
      return;
    }

    // Arquivo criado ou modificado: reindexa apenas esta nota
    const entry = indexMarkdownFile(fullPath, cleanRel);
    if (entry) {
      scheduleSaveCache();
    }
  }

  /**
   * 2. GERA MAPA MENTAL COMPACTO PARA O PROMPT DO LLM
   * getCompactBrainMapForLLM()
   */
  function getCompactBrainMapForLLM(options = {}) {
    const { today, yesterday } = getTodayAndYesterday();
    const filesArray = Array.from(catalogMap.values());
    const maxSummaryLen = options.maxSummaryLen || 75;

    // Agrupa por pasta
    const byFolder = new Map();
    for (const f of filesArray) {
      const folderKey = f.folder || 'Geral';
      if (!byFolder.has(folderKey)) {
        byFolder.set(folderKey, []);
      }
      byFolder.get(folderKey).push(f);
    }

    // Ordena arquivos dentro de cada pasta: modificados mais recentemente no topo
    for (const [folderKey, list] of byFolder.entries()) {
      list.sort((a, b) => {
        const timeA = a.lastModified || a.dateCreated || '';
        const timeB = b.lastModified || b.dateCreated || '';
        return timeB.localeCompare(timeA);
      });
    }

    // Ordem prioritária de exibição das pastas
    const folderPriority = [
      '05_Diario',
      '01_Memorias',
      '00_Nucleo',
      '03_Conhecimento',
      '06_Pendencias',
      '05_Estudo',
      '04_Procedimentos',
      '07_Reflexoes',
      '02_Rotinas',
      '02_Episodios',
      '01_Diario',
      '08_Inbox'
    ];

    const sortedFolderKeys = Array.from(byFolder.keys()).sort((a, b) => {
      const idxA = folderPriority.indexOf(a);
      const idxB = folderPriority.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    let lines = [];
    lines.push('=== MAPA COMPLETO DE ARQUIVOS DO CÉREBRO OBSIDIAN ===');
    lines.push(`[HOJE: ${today} | ONTEM: ${yesterday}]`);

    const maxPerFolder = options.maxPerFolder || 5;

    for (const folderKey of sortedFolderKeys) {
      const allFiles = byFolder.get(folderKey);
      if (!allFiles || allFiles.length === 0) continue;

      // Prioriza arquivos de hoje/ontem e limita aos mais recentes
      const files = allFiles.slice(0, maxPerFolder);

      const folderLabel = FOLDER_DISPLAY_NAMES[folderKey] || folderKey;
      lines.push('');
      lines.push(`📁 ${folderLabel}:`);

      for (const item of files) {
        const relDate = formatRelativeDate(item.lastModified || item.dateCreated, today, yesterday);
        const dateTag = relDate ? `(Modificado: ${relDate})` : `(Data: ${item.dateCreated || 'N/A'})`;

        const cleanSummary = String(item.shortSummary || item.title || '').replace(/\s+/g, ' ').slice(0, maxSummaryLen);
        let line = `- [${item.relativePath}] ${dateTag} | Resumo: ${cleanSummary}`;

        if (item.wikilinks && item.wikilinks.length > 0) {
          const linksFormatted = item.wikilinks.slice(0, 3).map(l => `[[${l}]]`).join(', ');
          line += ` | Links: ${linksFormatted}`;
        }

        if (item.tags && item.tags.length > 0) {
          const tagsFormatted = item.tags.slice(0, 3).map(t => `#${t}`).join(', ');
          line += ` | Tags: ${tagsFormatted}`;
        }

        lines.push(line);
      }
    }

    return lines.join('\n');
  }

  /**
   * Localiza um arquivo no catálogo a partir de um nome ou wikilink
   */
  function resolveFileInCatalog(query) {
    if (!query) return null;
    let clean = query.trim().replace(/^\[\[|\]\]$/g, '').replace(/\\/g, '/');
    if (clean.includes('|')) clean = clean.split('|')[0].trim();

    // 1. Busca exata por relativePath
    if (catalogMap.has(clean)) return catalogMap.get(clean);
    if (catalogMap.has(clean + '.md')) return catalogMap.get(clean + '.md');

    // 2. Busca case-insensitive por relativePath
    const lowerClean = clean.toLowerCase();
    for (const [rel, entry] of catalogMap.entries()) {
      if (rel.toLowerCase() === lowerClean || rel.toLowerCase() === lowerClean + '.md') {
        return entry;
      }
    }

    // 3. Busca por título exato ou nome base do arquivo
    for (const entry of catalogMap.values()) {
      if (entry.title && entry.title.toLowerCase() === lowerClean) return entry;
      const baseName = nodePath ? nodePath.basename(entry.relativePath, '.md') : entry.relativePath.split('/').pop().replace(/\.md$/, '');
      if (baseName.toLowerCase() === lowerClean) return entry;
    }

    return null;
  }

  /**
   * 3. LEITURA ASSOCIATIVA POR SINAPSES
   * readFilesWithSynapses(filePathsArray, options = { followLinksDepth: 1, maxTotalChars: 18000 })
   */
  function readFilesWithSynapses(filePathsArray = [], options = {}) {
    if (!nodeFs) return 'Erro: Ambiente sem suporte a leitura de arquivos.';
    const followLinksDepth = options.followLinksDepth !== undefined ? options.followLinksDepth : 1;
    const maxTotalChars = options.maxTotalChars || 9500;

    const primaryList = Array.isArray(filePathsArray) ? filePathsArray : [filePathsArray];
    const loadedFiles = new Map(); // relativePath -> { entry, content, fullPath }
    const synapsesFound = new Set(); // targetNames
    let currentTotalChars = 0;

    // ETAPA 1: Leitura de todos os arquivos primários solicitados
    for (const rawPath of primaryList) {
      if (!rawPath) continue;
      const entry = resolveFileInCatalog(rawPath);
      const relPath = entry ? entry.relativePath : normalizeRelPath(rawPath);
      const fullPath = nodePath ? nodePath.join(VAULT_DIR, relPath) : `${VAULT_DIR}\\${relPath}`;

      if (nodeFs.existsSync(fullPath)) {
        try {
          const content = nodeFs.readFileSync(fullPath, 'utf8');
          loadedFiles.set(relPath, {
            entry: entry || { relativePath: relPath, title: relPath },
            content,
            fullPath
          });
          currentTotalChars += content.length;

          // Se habilitado followLinksDepth, coleta os wikilinks citados nesta nota
          if (followLinksDepth >= 1) {
            const links = extractWikilinks(content);
            links.forEach(l => synapsesFound.add(l));
          }
        } catch (readErr) {
          console.warn(`[BrainCatalog] Erro ao ler nota primária ${relPath}:`, readErr.message);
        }
      }
    }

    // ETAPA 2: Leitura associativa das sinapses conectadas (Profundidade 1)
    const connectedSynapses = [];
    if (followLinksDepth >= 1 && synapsesFound.size > 0) {
      for (const synTarget of synapsesFound) {
        // Ignora se o arquivo conectado já foi lido como primário
        const resolvedSyn = resolveFileInCatalog(synTarget);
        if (resolvedSyn && !loadedFiles.has(resolvedSyn.relativePath)) {
          const synFullPath = nodePath ? nodePath.join(VAULT_DIR, resolvedSyn.relativePath) : `${VAULT_DIR}\\${resolvedSyn.relativePath}`;
          if (nodeFs.existsSync(synFullPath)) {
            try {
              const synRaw = nodeFs.readFileSync(synFullPath, 'utf8');
              const { frontmatter, body } = parseFrontmatterAndBody(synRaw);

              // Extrai conteúdo contextual completo da nota conectada
              const cleanBody = body.trim();
              const synSnippet = cleanBody.length <= 800
                ? cleanBody
                : ((resolvedSyn.shortSummary && resolvedSyn.shortSummary.length > 30)
                    ? resolvedSyn.shortSummary + ' — ' + cleanBody.replace(/\r?\n+/g, ' ').slice(0, 1000)
                    : cleanBody.replace(/\r?\n+/g, ' ').slice(0, 600) + '...');

              connectedSynapses.push({
                target: synTarget,
                relativePath: resolvedSyn.relativePath,
                title: resolvedSyn.title,
                snippet: synSnippet,
                lastModified: resolvedSyn.lastModified
              });
            } catch {}
          }
        }
      }
    }

    // ETAPA 3: Montagem do Dossiê Estruturado de Memórias Abertas
    let out = [];
    out.push('=== DOSSIÊ DE MEMÓRIAS ABERTAS (SINAPSES ATIVAS) ===');
    out.push(`Arquivos Primários Lidos: ${loadedFiles.size} | Sinapses Associadas: ${connectedSynapses.length}`);
    out.push('');

    // Adiciona arquivos primários completos
    for (const [relPath, item] of loadedFiles.entries()) {
      out.push('='.repeat(80));
      out.push(`📄 ARQUIVO PRIMÁRIO: ${relPath}`);
      out.push(`Título: ${item.entry.title || relPath} | Modificado: ${item.entry.lastModified || 'N/A'}`);
      out.push('='.repeat(80));
      out.push(item.content.trim());
      out.push('');
    }

    // Anexa as sinapses conectadas
    if (connectedSynapses.length > 0) {
      out.push('-'.repeat(80));
      out.push('🔗 SINAPSES ASSOCIATIVAS CONECTADAS (Profundidade 1):');
      out.push('-'.repeat(80));

      for (const syn of connectedSynapses) {
        out.push(`⚡ [[${syn.title || syn.target}]] (Arquivo: ${syn.relativePath}):`);
        out.push(`   Resumo Associativo: ${syn.snippet}`);
        out.push('');
      }
    }

    let dossier = out.join('\n');

    // Respeita teto rígido de caracteres
    if (dossier.length > maxTotalChars) {
      dossier = dossier.slice(0, maxTotalChars - 120) + '\n\n[... Dossiê sintetizado para respeitar o limite máximo de tokens do modelo ...]';
    }

    // Retorna objeto String com metadados de sinapses anexados
    const dossierObj = new String(dossier);
    dossierObj.primaryFiles = Array.from(loadedFiles.keys());
    dossierObj.synapsesFollowed = connectedSynapses.map(s => s.title || s.target);
    dossierObj.connectedSynapses = connectedSynapses;
    dossierObj.totalChars = dossier.length;

    return dossierObj;
  }


  /**
   * 4. BUSCA SINÁPTICA PROFUNDA EM RAM (Zero Latência com Compreensão Semântica)
   * findRelevantFilesBySynapticSearch(userMessage, currentDesktopStr, options)
   */
  function normalizeTextForSearch(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const SYNONYM_CONCEPT_MAP = {
    'banco': ['postgresql', 'postgres', 'banco de dados', 'sql', 'bd', 'migracao'],
    'bd': ['postgresql', 'postgres', 'banco de dados', 'sql'],
    'dados': ['postgresql', 'postgres', 'banco de dados'],
    'postgres': ['postgresql', 'banco de dados', 'migracao'],
    'postgresql': ['postgres', 'banco de dados', 'migracao'],
    'senai': ['senai', 'chamados', 'triagem', 'atividade senai'],
    'chamado': ['chamados', 'triagem', 'senai'],
    'chamados': ['chamado', 'triagem', 'senai'],
    'triagem': ['triagem de chamados', 'senai'],
    'arena': ['arena breakout', 'breakout', 'abobora', 'aboboras', 'extracao'],
    'breakout': ['arena breakout', 'abobora', 'extracao'],
    'abobora': ['aboboras', 'arena breakout', 'extracao', 'arena'],
    'aboboras': ['abobora', 'arena breakout', 'extracao'],
    'minukeyp': ['minukeyp', 'comprar item', 'teclado', 'keyp'],
    'oculos': ['oculos novos', 'comprar oculos', 'desejo de compra'],
    'comprar': ['comprar', 'desejo de compra', '06_pendencias', 'compras'],
    'compra': ['comprar', 'desejo de compra', '06_pendencias'],
    'estudo': ['estudo', '05_estudo', 'arquitetura hexagonal', 'engenharia'],
    'estudos': ['estudo', '05_estudo', 'arquitetura hexagonal', 'engenharia'],
    'software': ['engenharia de software', 'arquitetura', 'hexagonal'],
    'hexagonal': ['arquitetura hexagonal', 'ports and adapters', 'software'],
    'arquitetura': ['arquitetura hexagonal', 'hexagonal', 'software', 'observador'],
    'perfil': ['perfil alvaro', 'alvaro', 'nailton', 'dono'],
    'alvaro': ['perfil alvaro', 'nailton', 'dono'],
    'nailton': ['perfil alvaro', 'nailton'],
    'identidade': ['identidade bitbop', 'bitbop', 'regras'],
    'biometria': ['calibracao biometria', 'biometria vocal', 'voiceprint'],
    'voz': ['calibracao biometria', 'biometria vocal', 'voiceprint'],
    'tarefa': ['06_pendencias', 'pendencia', 'afazer'],
    'tarefas': ['06_pendencias', 'pendencia', 'afazer'],
    'pendencia': ['06_pendencias', 'pendencias', 'tarefa'],
    'pendencias': ['06_pendencias', 'pendencia', 'tarefa'],
    'rotina': ['02_rotinas', 'habito', 'dia a dia'],
    'rotinas': ['02_rotinas', 'habito', 'dia a dia'],
    'hoje': ['05_diario', 'diario do bitbop', 'hoje'],
    'semana': ['01_diario/semanas', 'resumo semanal'],
    'ontem': ['01_diario', '05_diario']
  };

  function findRelevantFilesBySynapticSearch(userMessage = '', currentDesktopStr = '', options = {}) {
    const today = options.today || new Date().toISOString().slice(0, 10);
    const norm = normalizeTextForSearch(userMessage);
    const tokens = norm.split(' ').filter(t => t.length >= 3);

    const isBroad = /(?:o\s*que\s*aconteceu|resumo|semana|como\s*est[aã]o|pend[eê]ncias?|tarefas?|estudos?|projeto|balan[cç]o|me\s*conta|geral|evolucao|panorama)/i.test(userMessage);
    const mentionsToday = /(?:hoje|agora|dia|neste\s*dia|aconteceu\s*hoje)/i.test(userMessage);

    const expanded = new Set();
    for (const t of tokens) {
      if (SYNONYM_CONCEPT_MAP[t]) {
        SYNONYM_CONCEPT_MAP[t].forEach(s => expanded.add(s));
      }
    }

    const scored = Array.from(catalogMap.values()).map(note => {
      let score = 0;
      const relNorm = normalizeTextForSearch(note.relativePath);
      const titleNorm = normalizeTextForSearch(note.title);
      const summaryNorm = normalizeTextForSearch(note.shortSummary);
      const tagsNorm = (note.tags || []).map(normalizeTextForSearch).join(' ');
      const linksNorm = (note.wikilinks || []).map(normalizeTextForSearch).join(' ');

      // 1. Pontuação direta de tokens da fala
      for (const token of tokens) {
        if (token.length < 3) continue;
        if (titleNorm.includes(token)) score += 45;
        if (relNorm.includes(token)) score += 35;
        if (tagsNorm.includes(token)) score += 30;
        if (summaryNorm.includes(token)) score += 20;
        if (linksNorm.includes(token)) score += 20;
      }

      // 2. Pontuação por expansão semântica de sinônimos/entidades
      for (const exp of expanded) {
        const expNorm = normalizeTextForSearch(exp);
        if (titleNorm.includes(expNorm)) score += 40;
        if (relNorm.includes(expNorm)) score += 35;
        if (summaryNorm.includes(expNorm)) score += 25;
        if (tagsNorm.includes(expNorm)) score += 25;
      }

      // 3. Bônus temporal
      if (note.lastModified && note.lastModified.startsWith(today)) {
        score += 30;
      }

      // 4. Prioridade para Diário de Hoje
      if (mentionsToday && relNorm.includes('05_diario') && relNorm.includes(today)) {
        score += 160;
      }

      // 5. Contexto do Desktop ativo
      if (currentDesktopStr) {
        const dNorm = normalizeTextForSearch(currentDesktopStr);
        if (dNorm.includes('arena') && relNorm.includes('arena')) score += 35;
        if (dNorm.includes('code') && (relNorm.includes('estudo') || relNorm.includes('memorias'))) score += 20;
      }

      return { note, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const topCandidates = scored.filter(s => s.score >= 35).slice(0, 4);
    const files = new Set(topCandidates.map(t => t.note.relativePath));

    if (mentionsToday || isBroad) {
      files.add(`05_Diario/${today}.md`);
    }

    const topScore = topCandidates.length > 0 ? topCandidates[0].score : 0;
    const confidence = topScore >= 65 ? 'high' : (topScore >= 35 ? 'medium' : 'low');

    return {
      files: Array.from(files),
      topScore,
      confidence,
      isBroad,
      needsDeepRecall: topScore >= 35 || mentionsToday || isBroad,
      reasoning: `Busca sináptica em RAM concluída com confiança ${confidence} (top score: ${topScore}).`
    };
  }

  /**
   * Inicialização do módulo BrainCatalog
   */
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    ensureDirSync(BITBOP_DIR);

    // 1. Tenta carregar cache rápido de 0ms
    loadCacheIfAvailable();

    // 2. Realiza varredura completa em segundo plano
    setTimeout(() => {
      refreshEntireCatalog();
    }, 150);

    // 3. Escuta evento bitbop-vault-updated do VaultWatcher se no Electron/Browser
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('bitbop-vault-updated', (e) => {
        if (e && e.detail && e.detail.path) {
          onVaultFileChanged(e.detail.path);
        }
      });
    }

    // 4. Integra diretamente com o VaultWatcher se disponível no mesmo escopo
    if (typeof global !== 'undefined' && global.VaultWatcher) {
      // Já integrado via evento e chamada direta
    }
  }

  // Auto-inicialização
  try {
    init();
  } catch (err) {
    console.warn('[BrainCatalog] Erro na auto-inicialização:', err);
  }

  return {
    init,
    refreshEntireCatalog,
    onVaultFileChanged,
    getCompactBrainMapForLLM,
    readFilesWithSynapses,
    resolveFileInCatalog,
    findRelevantFilesBySynapticSearch,
    getCatalogMap: () => catalogMap,
    getCatalogArray: () => Array.from(catalogMap.values()),
    getTotalFiles: () => catalogMap.size
  };
});
