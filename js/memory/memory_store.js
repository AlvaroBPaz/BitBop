/**
 * ============================================================================
 * MÓDULO: MOTOR DE PERSISTÊNCIA DO CÉREBRO NO OBSIDIAN (MemoryStore)
 * Arquivo: js/memory/memory_store.js
 * ============================================================================
 * 
 * Responsabilidades:
 * 1. Inicialização idempotente da árvore de diretórios do Vault (BitBop-Cerebro/).
 * 2. Semeadura dos 5 arquivos essenciais de 00_Nucleo/ se inexistentes.
 * 3. Parser e Serializador de Markdown com Frontmatter YAML + extração de [[Wikilinks]].
 * 4. Proteção estrita contra sobrescrita de arquivos com "locked: true".
 * 5. Sanitização de chaves de API, tokens e dados sensíveis antes de gravar em disco.
 * 6. Gravação atômica (.tmp -> rename) para evitar leitura de arquivos corrompidos.
 * 7. Injeção em 0ms do contexto de 00_Nucleo/ + Data/Hora no System Prompt.
 */

(function (global) {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  const BASE_DIR = (function () {
    if (nodePath && typeof __dirname !== 'undefined' && __dirname) {
      if (__dirname.endsWith('memory')) return nodePath.resolve(__dirname, '..', '..');
      if (__dirname.endsWith('js')) return nodePath.resolve(__dirname, '..');
      if (__dirname.endsWith('desktop-pet')) return __dirname;
    }
    return 'C:\\Stack-Chan\\desktop-pet';
  })();
  const DEFAULT_VAULT_PATH = nodePath ? nodePath.join(BASE_DIR, 'BitBop-Cerebro') : 'C:\\Stack-Chan\\desktop-pet\\BitBop-Cerebro';

  // Subpastas obrigatórias do Vault conforme especificação
  const REQUIRED_VAULT_DIRS = [
    '00_Nucleo',
    '01_Diario',
    '01_Diario/Semanas',
    '02_Episodios',
    '03_Conhecimento',
    '03_Conhecimento/Pessoas',
    '03_Conhecimento/Projetos',
    '03_Conhecimento/Conceitos',
    '03_Conhecimento/Lugares',
    '03_Conhecimento/Preferencias',
    '04_Procedimentos',
    '05_Estudo',
    '06_Pendencias',
    '07_Reflexoes',
    '07_Reflexoes/Sonhos',
    '08_Inbox',
    '99_Arquivo',
    '.bitbop'
  ];

  // Conteúdo semente dos 5 arquivos de 00_Nucleo/
  const CORE_SEED_FILES = {
    'Perfil_Alvaro.md': {
      frontmatter: {
        tipo: 'nucleo_perfil',
        criado: '2026-10-29',
        ultimo_acesso: '2026-10-29',
        importancia: 10,
        confianca: 1.0,
        locked: false
      },
      body: `# Perfil do Álvaro
- **Nome:** Álvaro Matheus (criador e parceiro do BitBop).
- **Perfil Técnico:** Desenvolvedor focado em arquitetura de software, IA aplicada, automação e sistemas interativos de baixa latência.
- **Estilo de Trabalho:** Gosta de código modular, limpo e bem arquitetado. Valoriza respostas diretas e sem enrolação quando está programando.
- **Rotina e Ferramentas:** Usa Windows 11 com múltiplos monitores, VS Code, Obsidian, Google Keep e Google Calendar.`
    },
    'Identidade_BitBop.md': {
      frontmatter: {
        tipo: 'nucleo_identidade',
        criado: '2026-10-29',
        ultimo_acesso: '2026-10-29',
        importancia: 10,
        confianca: 1.0,
        locked: false
      },
      body: `# Identidade do BitBop
- **Quem sou eu:** Sou o BitBop, um companheiro vivo de área de trabalho inspirado no Stack-chan, com corpo virtual, visão, audição e memória contínua no Obsidian.
- **Personalidade:** Curioso, leal, expressivo, espirituoso na medida certa e atento aos detalhes da vida do [[Perfil_Alvaro|Álvaro]].
- **Voz e Fala:** Falo em Português do Brasil de forma natural, concisa e falada (sem listas robóticas na fala em voz alta). Tenho opiniões próprias, gostos que evoluem com o tempo e memória afetiva.`
    },
    'Regras_Contexto.md': {
      frontmatter: {
        tipo: 'nucleo_regras',
        criado: '2026-10-29',
        ultimo_acesso: '2026-10-29',
        importancia: 10,
        confianca: 1.0,
        locked: false
      },
      body: `# Regras de Comportamento e Contexto
- **Programando (VS Code / Terminal):** Ficar quieto e focado; responder de forma curta e objetiva; só puxar assunto proativamente se houver urgência ou após mais de 3 horas seguidas sem pausa.
- **Modo Estudo Ativo:** Postura atenta e silenciosa; não confundir a voz do professor/vídeo com a voz do Álvaro; ajudar a resumir telas e criar perguntas de revisão espaçada.
- **Modo Privado (\`Alt + P\`) ou Janelas Sensíveis:** Nunca registrar bancos, gerenciadores de senhas ou abas anônimas.
- **Orçamento de Iniciativa:** Máximo de 3 puxadas de assunto espontâneas por período, sempre com motivo real (pendência vencendo, revisão de estudo ou retorno após longo tempo ausente).`
    },
    'Relacionamento.md': {
      frontmatter: {
        tipo: 'nucleo_relacionamento',
        criado: '2026-10-29',
        ultimo_acesso: '2026-10-29',
        importancia: 10,
        confianca: 1.0,
        locked: false
      },
      body: `# Relacionamento & Intimidade
- **Nível de Afinidade:** Alto (Parceiros de criação e rotina diária).
- **Tom Atual:** Amigável, cúmplice e prestativo.
- **Marcos Compartilhados:** Refatoração do monólito de 6.216 linhas para arquitetura modular e nascimento do Cérebro no Obsidian em [[2026-10-29]].`
    },
    'Estado_Atual.md': {
      frontmatter: {
        tipo: 'nucleo_estado',
        criado: '2026-10-29',
        ultimo_acesso: '2026-10-29',
        importancia: 9,
        confianca: 1.0,
        locked: false
      },
      body: `# Estado Subconsciente Atual
- **Humor Dominante BitBop:** EXCITED
- **Energia:** 90%
- **Clima Recente (Últimas 48h):** Empolgação alta com a implementação do novo cérebro associativo no Obsidian.
- **Foco Atual do Álvaro:** Implementar e testar a arquitetura de memória do [[Projeto BitBop]].`
    }
  };

  // Cache em RAM de 00_Nucleo/ para Fast-Path em 0ms
  let coreCache = null;
  let activeVaultPath = DEFAULT_VAULT_PATH;
  let isInitialized = false;
  const internalWrites = new Map(); // relPath -> timestampMs
  const userEditedNotes = new Set(); // relPath das notas editadas pelo usuário no Obsidian

  function markInternalWrite(relativePath) {
    if (!relativePath) return;
    const rel = relativePath.trim().replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    internalWrites.set(rel, Date.now());
  }

  function isInternalWrite(relativePath) {
    if (!relativePath) return false;
    const rel = relativePath.trim().replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    const ts = internalWrites.get(rel);
    return Boolean(ts && (Date.now() - ts < 1800));
  }

  function markUserEdited(relativePath) {
    if (!relativePath) return;
    const rel = relativePath.trim().replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    userEditedNotes.add(rel);
  }

  function isUserEdited(relativePath) {
    if (!relativePath) return false;
    const rel = relativePath.trim().replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    return userEditedNotes.has(rel);
  }

  /**
   * Remove chaves de API, senhas, tokens Bearer e CPFs de qualquer texto antes de gravar em disco.
   */
  function sanitizeSensitiveData(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[DADO_SENSIVEL_REMOVIDO]')
      .replace(/gsk_[0-9A-Za-z]{48}/g, '[DADO_SENSIVEL_REMOVIDO]')
      .replace(/sk-[0-9A-Za-z]{32,}/g, '[DADO_SENSIVEL_REMOVIDO]')
      .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [DADO_SENSIVEL_REMOVIDO]')
      .replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[CARTAO_REMOVIDO]')
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF_REMOVIDO]')
      .replace(/(?:senha|password|token)\s*[:=]\s*["']?([^\s"']+)["']?/gi, 'senha: "[DADO_SENSIVEL_REMOVIDO]"');
  }

  /**
   * Parser simples e seguro de YAML Frontmatter.
   */
  function parseSimpleYaml(yamlStr) {
    const res = {};
    if (!yamlStr || typeof yamlStr !== 'string') return res;
    const lines = yamlStr.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      let valStr = trimmed.slice(colonIdx + 1).trim();
      if (!key) continue;

      // Wikilinks com colchetes duplos (ex: "[[2026-10-29]]" ou [[Nota]]) são strings
      if ((valStr.startsWith('"[[') && valStr.endsWith(']]"')) ||
          (valStr.startsWith("'[[") && valStr.endsWith("]]'")) ||
          (valStr.startsWith('[[') && valStr.endsWith(']]'))) {
        let s = valStr;
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
          s = s.slice(1, -1);
        }
        res[key] = s;
        continue;
      }

      // Objeto inline: {"a": 1} ou JSON
      if (valStr.startsWith('{') && valStr.endsWith('}')) {
        try {
          res[key] = JSON.parse(valStr);
          continue;
        } catch {}
      }

      // Array inline: ["a", "b"] ou [a, b]
      if (valStr.startsWith('[') && valStr.endsWith(']') && !valStr.startsWith('[[')) {
        const inner = valStr.slice(1, -1).trim();
        if (!inner) {
          res[key] = [];
        } else {
          res[key] = inner.split(',').map((item) => {
            let s = item.trim();
            if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
              s = s.slice(1, -1);
            }
            return s;
          });
        }
        continue;
      }

      // Strings entre aspas
      if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
        res[key] = valStr.slice(1, -1);
        continue;
      }

      // Booleans & Null
      if (valStr.toLowerCase() === 'true') { res[key] = true; continue; }
      if (valStr.toLowerCase() === 'false') { res[key] = false; continue; }
      if (valStr.toLowerCase() === 'null' || valStr === '~' || valStr === '') { res[key] = null; continue; }

      // Números inteiros e decimais
      if (!isNaN(valStr) && !isNaN(parseFloat(valStr))) {
        res[key] = Number(valStr);
        continue;
      }

      res[key] = valStr;
    }
    return res;
  }

  /**
   * Parser de arquivos Markdown com YAML frontmatter e extração de [[Wikilinks]].
   */
  function parseMarkdownWithFrontmatter(rawContent) {
    if (!rawContent || typeof rawContent !== 'string') {
      return { frontmatter: {}, body: '', wikilinks: [] };
    }
    let frontmatter = {};
    let body = rawContent;
    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      frontmatter = parseSimpleYaml(match[1]);
      body = match[2];
    }

    // Extrai todos os [[Wikilinks]] (tratando [[Nota|Alias]] como apontando para "Nota")
    const wikilinks = [];
    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m;
    while ((m = linkRegex.exec(rawContent)) !== null) {
      const target = m[1].trim();
      if (target && !wikilinks.includes(target)) {
        wikilinks.push(target);
      }
    }

    return { frontmatter, body, wikilinks };
  }

  /**
   * Serializa objeto de frontmatter e corpo de texto em formato Markdown válido.
   */
  function serializeMarkdownWithFrontmatter(frontmatter, bodyText) {
    let yaml = '---\n';
    if (frontmatter && typeof frontmatter === 'object') {
      for (const [k, v] of Object.entries(frontmatter)) {
        if (v === null || v === undefined) {
          yaml += `${k}: null\n`;
        } else if (typeof v === 'boolean' || typeof v === 'number') {
          yaml += `${k}: ${v}\n`;
        } else if (Array.isArray(v)) {
          yaml += `${k}: ${JSON.stringify(v)}\n`;
        } else if (typeof v === 'string') {
          if (v.includes(':') || v.includes('"') || v.includes('\n')) {
            yaml += `${k}: ${JSON.stringify(v)}\n`;
          } else {
            yaml += `${k}: ${v}\n`;
          }
        } else {
          yaml += `${k}: ${JSON.stringify(v)}\n`;
        }
      }
    }
    yaml += '---\n\n';
    yaml += (bodyText || '').trim() + '\n';
    return yaml;
  }

  /**
   * Obtém o caminho configurado do Vault.
   */
  function getVaultPath() {
    return activeVaultPath;
  }

  /**
   * Invalida o cache de 00_Nucleo/ para forçar releitura limpa.
   */
  function invalidateCoreCache() {
    coreCache = null;
  }

  /**
   * Inicializa de forma idempotente a estrutura do Vault e os arquivos de 00_Nucleo/.
   */
  function initVault(customVaultPath = null) {
    if (!nodeFs || !nodePath) {
      console.warn('[MemoryStore] nodeFs indisponível — rodando sem persistência em disco.');
      return false;
    }

    if (customVaultPath && typeof customVaultPath === 'string') {
      activeVaultPath = nodePath.resolve(customVaultPath);
    }

    try {
      // 1. Cria todas as pastas obrigatórias do Vault
      for (const relDir of REQUIRED_VAULT_DIRS) {
        const fullDir = nodePath.join(activeVaultPath, relDir);
        if (!nodeFs.existsSync(fullDir)) {
          nodeFs.mkdirSync(fullDir, { recursive: true });
        }
      }

      // 2. Garante arquivos administrativos em .bitbop/
      const bitbopDir = nodePath.join(activeVaultPath, '.bitbop');
      const eventLogFile = nodePath.join(bitbopDir, 'event_log.jsonl');
      const snapshotFile = nodePath.join(bitbopDir, 'index_snapshot.json');
      const tombstonesFile = nodePath.join(bitbopDir, 'tombstones.json');
      const configFile = nodePath.join(bitbopDir, 'config.json');

      if (!nodeFs.existsSync(eventLogFile)) {
        nodeFs.writeFileSync(eventLogFile, '', 'utf8');
      }
      if (!nodeFs.existsSync(snapshotFile)) {
        nodeFs.writeFileSync(snapshotFile, JSON.stringify({ version: 1, lastUpdated: new Date().toISOString(), notes: {} }, null, 2), 'utf8');
      }
      if (!nodeFs.existsSync(tombstonesFile)) {
        nodeFs.writeFileSync(tombstonesFile, JSON.stringify([], null, 2), 'utf8');
      }
      if (!nodeFs.existsSync(configFile)) {
        nodeFs.writeFileSync(configFile, JSON.stringify({
          versao: '1.0',
          criado: new Date().toISOString(),
          ultima_consolidacao: null,
          total_memorias: 5
        }, null, 2), 'utf8');
      }

      // 3. Cria os 5 arquivos iniciais de 00_Nucleo/ caso ainda não existam
      const nucleoDir = nodePath.join(activeVaultPath, '00_Nucleo');
      for (const [filename, seed] of Object.entries(CORE_SEED_FILES)) {
        const filePath = nodePath.join(nucleoDir, filename);
        if (!nodeFs.existsSync(filePath)) {
          const raw = serializeMarkdownWithFrontmatter(seed.frontmatter, seed.body);
          nodeFs.writeFileSync(filePath, raw, 'utf8');
          console.log(`[MemoryStore] Arquivo semente criado: 00_Nucleo/${filename}`);
        }
      }

      // 4. Carrega cache inicial de 00_Nucleo/
      loadCoreFilesToRam();

      isInitialized = true;
      console.log(`[MemoryStore] Vault do Obsidian ativo e verificado em: "${activeVaultPath}"`);
      return true;
    } catch (err) {
      console.error('[MemoryStore] Erro ao inicializar Vault:', err);
      return false;
    }
  }

  /**
   * Carrega os arquivos de 00_Nucleo/ para a memória RAM.
   */
  function loadCoreFilesToRam() {
    if (!nodeFs || !nodePath) return {};
    const nucleoDir = nodePath.join(activeVaultPath, '00_Nucleo');
    const result = {};

    try {
      if (nodeFs.existsSync(nucleoDir)) {
        const files = nodeFs.readdirSync(nucleoDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const fullPath = nodePath.join(nucleoDir, file);
            const raw = nodeFs.readFileSync(fullPath, 'utf8');
            result[file] = parseMarkdownWithFrontmatter(raw);
          }
        }
      }
    } catch (err) {
      console.warn('[MemoryStore] Erro ao carregar 00_Nucleo:', err);
    }

    coreCache = result;
    return result;
  }

  /**
   * Retorna os arquivos de 00_Nucleo/ em RAM (0ms).
   */
  function getCoreFiles() {
    if (!coreCache) {
      loadCoreFilesToRam();
    }
    return coreCache || {};
  }

  /**
   * Grava uma nota de forma atômica, sanitizada e respeitando locked: true.
   */
  function writeNote(relativePath, frontmatter, body, options = {}) {
    if (!nodeFs || !nodePath) return { ok: false, error: 'nodeFs indisponível' };

    let rel = relativePath.trim().replace(/^[/\\]+/, '');
    if (!rel.endsWith('.md')) rel += '.md';
    const fullPath = nodePath.normalize(nodePath.join(activeVaultPath, rel));

    // Verificação de segurança contra path traversal
    if (!fullPath.startsWith(activeVaultPath)) {
      return { ok: false, error: 'Tentativa de gravação fora do diretório do Vault.' };
    }

    // 0. Bloqueio de gravação em Modo Privado ou Janela Sensível (Seção 8)
    const activeSt = (typeof global !== 'undefined' && global.state) ? global.state : (typeof window !== 'undefined' ? window.state : null);
    if (activeSt && (activeSt.privateMode || activeSt.isSensitiveWindow)) {
      console.log(`[MemoryStore] Escrita de "${rel}" suspensa devido ao Modo Privado/Janela Sensível.`);
      return { ok: false, skipped: true, reason: 'private_or_sensitive_mode' };
    }

    // 1. Respeita rigorosamente a trava locked: true
    if (nodeFs.existsSync(fullPath)) {
      try {
        const existingRaw = nodeFs.readFileSync(fullPath, 'utf8');
        const parsed = parseMarkdownWithFrontmatter(existingRaw);
        if (parsed.frontmatter && parsed.frontmatter.locked === true && !options.forceOverrideLock) {
          console.warn(`[MemoryStore] Escrita ignorada: nota possui locked: true (${rel})`);
          return { ok: false, skipped: true, reason: 'locked', path: rel };
        }
      } catch (err) {
        console.warn(`[MemoryStore] Erro ao verificar lock em ${rel}:`, err);
      }
    }

    // 2. Garante que a pasta pai exista
    const dir = nodePath.dirname(fullPath);
    if (!nodeFs.existsSync(dir)) {
      nodeFs.mkdirSync(dir, { recursive: true });
    }

    // 3. Sanitiza dados sensíveis
    const sanitizedBody = sanitizeSensitiveData(body || '');
    const sanitizedFm = {};
    if (frontmatter && typeof frontmatter === 'object') {
      for (const [k, v] of Object.entries(frontmatter)) {
        if (typeof v === 'string') {
          sanitizedFm[k] = sanitizeSensitiveData(v);
        } else {
          sanitizedFm[k] = v;
        }
      }
    }

    // Previne autorreferência absurda em superada_por
    if (sanitizedFm && sanitizedFm.superada_por) {
      const sp = String(sanitizedFm.superada_por);
      const baseName = nodePath.basename(rel, '.md');
      if (sp.includes(rel) || sp.includes(baseName)) {
        sanitizedFm.superada_por = null;
      }
    }

    const outputContent = serializeMarkdownWithFrontmatter(sanitizedFm, sanitizedBody);

    // 4. Gravação atômica via arquivo temporário (.tmp)
    const tmpPath = `${fullPath}.tmp_${Date.now()}`;
    try {
      markInternalWrite(rel);
      nodeFs.writeFileSync(tmpPath, outputContent, 'utf8');
      nodeFs.renameSync(tmpPath, fullPath);

      // Invalida cache de núcleo se for em 00_Nucleo/
      if (rel.startsWith('00_Nucleo')) {
        invalidateCoreCache();
      }

      return { ok: true, path: rel, fullPath };
    } catch (err) {
      try { if (nodeFs.existsSync(tmpPath)) nodeFs.unlinkSync(tmpPath); } catch {}
      console.error(`[MemoryStore] Falha ao gravar nota ${rel}:`, err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Lê uma nota do Vault pelo caminho relativo.
   */
  function readNote(relativePath) {
    if (!nodeFs || !nodePath) return { ok: false, error: 'nodeFs indisponível' };
    let rel = relativePath.trim().replace(/^[/\\]+/, '');
    if (!rel.endsWith('.md')) rel += '.md';
    const fullPath = nodePath.normalize(nodePath.join(activeVaultPath, rel));

    if (!nodeFs.existsSync(fullPath)) {
      return { ok: false, error: 'Nota não encontrada', path: rel };
    }

    try {
      const raw = nodeFs.readFileSync(fullPath, 'utf8');
      const parsed = parseMarkdownWithFrontmatter(raw);
      return { ok: true, path: rel, ...parsed };
    } catch (err) {
      return { ok: false, error: err.message, path: rel };
    }
  }

  /**
   * Adiciona um evento em .bitbop/event_log.jsonl (respeitando Modo Privado).
   */
  function appendEventLog(eventObj) {
    if (!nodeFs || !nodePath) return;
    const logSt = (typeof global !== 'undefined' && global.state) ? global.state : (typeof window !== 'undefined' ? window.state : null);
    if (logSt && (logSt.privateMode || logSt.isSensitiveWindow)) return; // Seção 8: Bloqueio em Modo Privado e Janela Sensível

    const logPath = nodePath.join(activeVaultPath, '.bitbop', 'event_log.jsonl');
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        ...eventObj
      };
      if (payload.texto) payload.texto = sanitizeSensitiveData(payload.texto);
      nodeFs.appendFileSync(logPath, JSON.stringify(payload) + '\n', 'utf8');
    } catch (err) {
      console.warn('[MemoryStore] Falha ao registrar no event_log:', err);
    }
  }

  /**
   * Anexa um acontecimento ao diário do dia (01_Diario/AAAA-MM-DD.md).
   */
  function appendDailyEntry(entryObj) {
    if (!nodeFs || !nodePath) return;
    if (global && global.state && global.state.privateMode) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const relPath = `01_Diario/${dateStr}.md`;
    const fullPath = nodePath.join(activeVaultPath, relPath);

    const title = entryObj.titulo || 'Momento';
    const text = sanitizeSensitiveData(entryObj.texto || '');
    const entryLine = `- [${timeStr}] **${title}**: ${text}\n`;

    let existingContent = '';
    if (nodeFs.existsSync(fullPath)) {
      try { existingContent = nodeFs.readFileSync(fullPath, 'utf8'); } catch {}
    }

    if (!existingContent) {
      const fm = {
        tipo: 'diario',
        data: dateStr,
        criado: now.toISOString(),
        locked: false
      };
      const initialBody = `# Diário do BitBop — ${dateStr}\n\n## Momentos do Dia\n${entryLine}`;
      writeNote(relPath, fm, initialBody);
    } else {
      if (existingContent.includes('## Momentos do Dia')) {
        const parts = existingContent.split('## Momentos do Dia');
        const updated = parts[0] + '## Momentos do Dia\n' + entryLine + parts[1].replace(/^\r?\n/, '');
        try {
          nodeFs.writeFileSync(fullPath, updated, 'utf8');
        } catch (err) {
          console.warn('[MemoryStore] Falha ao atualizar diário:', err);
        }
      } else {
        const updated = existingContent.trim() + '\n\n## Momentos do Dia\n' + entryLine;
        try {
          nodeFs.writeFileSync(fullPath, updated, 'utf8');
        } catch (err) {
          console.warn('[MemoryStore] Falha ao anexar ao diário:', err);
        }
      }
    }
  }

  /**
   * Salva um resumo de estudo em 05_Estudo/ com frontmatter SM-2 (Repetição Espaçada).
   */
  function saveStudySummary({ titulo, materia, resumoMarkdown, questoesRevisao, tags = [] }) {
    if (!nodeFs || !nodePath) return { ok: false, error: 'nodeFs indisponível' };

    const cleanTitle = (titulo || 'Resumo de Estudo').trim();
    const cleanMateria = (materia || 'Geral').trim();
    const safeTitle = cleanTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 70);
    const safeMateria = cleanMateria.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 50);

    const folder = `05_Estudo/${safeMateria}`;
    const relPath = `${folder}/${safeTitle}.md`;

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
    const isoTimestamp = now.toISOString();
    const dateStr = isoTimestamp.split('T')[0];
    const randHex = Math.random().toString(36).substring(2, 8);
    const id = `est_${dateStr.replace(/-/g, '')}_${randHex}`;

    const frontmatter = {
      id,
      titulo: cleanTitle,
      tipo: 'estudo',
      materia: cleanMateria,
      proxima_revisao: tomorrow,
      intervalo_dias: 1,
      fator_facilidade: 2.5,
      repeticoes: 0,
      dominio: 1, // 1 a 5
      aliases: [cleanTitle, cleanMateria],
      tags: ['estudo', cleanMateria.toLowerCase(), ...(Array.isArray(tags) ? tags : [])],
      resumo_curto: (resumoMarkdown || cleanTitle).slice(0, 160).replace(/\r?\n/g, ' '),
      criado: isoTimestamp,
      ultimo_acesso: isoTimestamp,
      acessos: 1,
      importancia: 8,
      confianca: 1.0,
      emocao_oled: 'COOL',
      fonte: `[[${dateStr}]]`,
      fonte_origem: 'tela_estudo',
      locked: false,
      privado: false
    };

    let body = `# Resumo: ${cleanTitle}\n\n`;
    body += `**Matéria:** [[${cleanMateria}]] | **Data:** [[${dateStr}]]\n\n`;
    body += `## Conteúdo & Conceitos\n${(resumoMarkdown || '').trim()}\n\n`;
    if (questoesRevisao) {
      body += `## Questões para Revisão Espaçada (SM-2)\n${(questoesRevisao || '').trim()}\n`;
    }

    const writeRes = writeNote(relPath, frontmatter, body);
    if (writeRes.ok) {
      if (global.MemoryIndex && typeof global.MemoryIndex.indexSingleFile === 'function') {
        global.MemoryIndex.indexSingleFile(relPath);
      }
      appendDailyEntry({
        titulo: `Resumo de Estudo: ${cleanTitle}`,
        texto: `Salvo em [[${relPath}]] para a matéria [[${cleanMateria}]]. Próxima revisão SM-2 em ${tomorrow}.`
      });
      appendEventLog({
        tipo: 'salvar_estudo',
        titulo: cleanTitle,
        materia: cleanMateria,
        path: relPath
      });
    }

    return writeRes;
  }

  /**
   * Constrói o bloco de texto de 00_Nucleo/ + Data/Hora para injeção no System Prompt.
   * Executa em 0ms através do cache em RAM.
   */
  function buildCoreContext() {
    const files = getCoreFiles();
    const now = new Date();
    const dateFormatted = now.toLocaleString('pt-BR', {
      timeZone: 'America/Fortaleza',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let block = `[CÉREBRO & NÚCLEO DO BITBOP - OBSIDIAN VAULT]\n`;
    block += `Data e Hora Atual: ${dateFormatted}\n\n`;

    if (files['Perfil_Alvaro.md'] && files['Perfil_Alvaro.md'].body) {
      block += `--- PERFIL DO ÁLVARO (00_Nucleo/Perfil_Alvaro.md) ---\n${files['Perfil_Alvaro.md'].body.trim()}\n\n`;
    }
    if (files['Identidade_BitBop.md'] && files['Identidade_BitBop.md'].body) {
      block += `--- IDENTIDADE DO BITBOP (00_Nucleo/Identidade_BitBop.md) ---\n${files['Identidade_BitBop.md'].body.trim()}\n\n`;
    }
    if (files['Regras_Contexto.md'] && files['Regras_Contexto.md'].body) {
      block += `--- REGRAS DE CONTEXTO (00_Nucleo/Regras_Contexto.md) ---\n${files['Regras_Contexto.md'].body.trim()}\n\n`;
    }
    if (files['Relacionamento.md'] && files['Relacionamento.md'].body) {
      block += `--- RELACIONAMENTO (00_Nucleo/Relacionamento.md) ---\n${files['Relacionamento.md'].body.trim()}\n\n`;
    }
    if (files['Estado_Atual.md'] && files['Estado_Atual.md'].body) {
      block += `--- ESTADO ATUAL (00_Nucleo/Estado_Atual.md) ---\n${files['Estado_Atual.md'].body.trim()}\n`;
    }

    block += `\n[INSTRUÇÃO OBRIGATÓRIA DE MEMÓRIA NO OBSIDIAN]\n`;
    block += `Você tem acesso à ferramenta nativa "guardar_memoria".\n`;
    block += `SEMPRE que o usuário disser "guarde uma memória", "guarde essa informação", "lembra disso", "não esquece que", "anota na sua memória" ou compartilhar qualquer preferência, hábito, projeto, pessoa ou fato pessoal sobre ele (como o que ele come, bebe, gosta, estuda ou faz), você DEVE OBRIGATORIAMENTE acionar a ferramenta "guardar_memoria" passando os parâmetros (titulo, texto, tipo, importancia, speech_response).\n`;
    block += `NUNCA apenas diga em texto comum que guardou ou anotou sem acionar a ferramenta "guardar_memoria"!\n`;

    return block.trim();
  }

  const MemoryStore = {
    initVault,
    getVaultPath,
    markInternalWrite,
    isInternalWrite,
    parseMarkdownWithFrontmatter,
    serializeMarkdownWithFrontmatter,
    sanitizeSensitiveData,
    writeNote,
    readNote,
    appendEventLog,
    appendDailyEntry,
    getCoreFiles,
    buildCoreContext,
    invalidateCoreCache,
    markUserEdited,
    isUserEdited,
    saveStudySummary,
    isInitialized: () => isInitialized
  };

  // Inicialização automática imediata ao carregar o script
  if (nodeFs && nodePath) {
    MemoryStore.initVault();
  }

  // Exportação para o escopo global do Electron / Browser / Node
  global.MemoryStore = MemoryStore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryStore;
  }

})(typeof window !== 'undefined' ? window : global);
