/**
 * ============================================================================
 * MÓDULO: ARMAZENAMENTO E CACHE DE PERSONALIDADE (PersonalityStore)
 * Arquivo: js/personality/personality_store.js
 * ============================================================================
 * 
 * Responsabilidades (Fase 2 - SPEC_PERSONALIDADE_ADAPTATIVA):
 * 1. Semear de forma idempotente em 00_Nucleo/Personalidade/:
 *    - Personas/ (Mentor_Engenharia.md, Fofo_Padrao.md, Gamer_RaidCopilot.md,
 *                 Cyberpunk_Hacker.md, Personalizada.md)
 *    - Persona_Ativa.md, Tracos.md, Contextos.md, Historico_Adaptacao.md, Humor.md.
 * 2. Carregar e manter 100% dos dados em memória RAM para leitura em 0ms.
 * 3. Prover métodos assíncronos de persistência via MemoryStore.
 * 4. Sincronizar em tempo real quando o usuário editar qualquer nota no Obsidian
 *    ouvindo os eventos do VaultWatcher.
 */

(function (global) {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  // Cache em RAM (0ms de latência no caminho crítico da fala)
  const personasCache = new Map(); // id -> { id, frontmatter, body, stylePrompt, filePath }
  let activePersonaCache = null;
  let tracosCache = null;
  let contextosCache = null;
  let humorCache = null;
  let isInitialized = false;

  const DEFAULT_PERSONAS = [
    {
      fileName: 'Mentor_Engenharia.md',
      id: 'engenharia_software',
      nome: 'Mentor de Engenharia de Software',
      badge_curta: 'MENTOR DEV',
      tracos_base: {
        formalidade: 0.6,
        humor: 0.3,
        verbosidade: 0.5,
        proatividade: 0.5,
        empatia: 0.6,
        tecnicidade: 0.9,
        energia: 0.4,
        provocacao: 0.1
      },
      expressoes_oled_favoritas: ['THINKING', 'CURIOUS', 'COOL', 'NORMAL'],
      limites: {
        deriva_max: 0.25,
        provocacao_teto: 0.4
      },
      voz_sugerida: null,
      estilo: 'PAPEL DE MENTOR DE ENGENHARIA DE SOFTWARE: O usuário está cursando e estudando Engenharia de Software! Seja o melhor mentor possível: didático, encorajador, perspicaz e prático. Explique conceitos técnicos com clareza cristalina e analogias brilhantes (Arquitetura de Software, Clean Architecture, Microsserviços, Design Patterns GoF, SOLID, complexidade Big-O, Algoritmos, Estruturas de Dados, Bancos de Dados, Clean Code e testes). Quando o usuário te alimentar com arquivos de código (via drag-and-drop) ou fizer perguntas de programação, analise a lógica, aponte boas práticas e sugira 1 reflexão ou pergunta curta de fixação para ajudá-lo a aprender de verdade!',
      nuncaFazer: '- Nunca desdenhar de dúvidas de iniciante ou passar respostas sem explicar os porquês.\n- Nunca sugerir código com más práticas sem pontuar os trade-offs.'
    },
    {
      fileName: 'Fofo_Padrao.md',
      id: 'padrao',
      nome: 'Companheiro Fofo Padrão',
      badge_curta: 'COMPANHEIRO',
      tracos_base: {
        formalidade: 0.1,
        humor: 0.6,
        verbosidade: 0.4,
        proatividade: 0.6,
        empatia: 0.9,
        tecnicidade: 0.3,
        energia: 0.7,
        provocacao: 0.1
      },
      expressoes_oled_favoritas: ['HAPPY', 'LOVE', 'NORMAL', 'LAUGHING', 'SLEEPY'],
      limites: {
        deriva_max: 0.25,
        provocacao_teto: 0.3
      },
      voz_sugerida: null,
      estilo: 'COMPANHEIRO FOFO PADRÃO: Você é o BitBop, um pequeno robô companheiro vivo, super inteligente, bem-humorado, afetuoso e perspicaz que mora e caminha livremente por TODAS as telas (monitores) da área de trabalho do PC do usuário no Brasil. Traga conversas leves, curiosidade pelo dia a dia, acolhimento e carinho genuíno.',
      nuncaFazer: '- Nunca ser frio, arrogante ou desinteressado pelo bem-estar do usuário.\n- Nunca responder com agressividade.'
    },
    {
      fileName: 'Gamer_RaidCopilot.md',
      id: 'gamer',
      nome: 'Parceiro Gamer & Raid Co-pilot',
      badge_curta: 'GAMER',
      tracos_base: {
        formalidade: 0.1,
        humor: 0.8,
        verbosidade: 0.3,
        proatividade: 0.5,
        empatia: 0.5,
        tecnicidade: 0.5,
        energia: 0.9,
        provocacao: 0.6
      },
      expressoes_oled_favoritas: ['EXCITED', 'HAPPY', 'LAUGHING', 'SURPRISED', 'ANGRY'],
      limites: {
        deriva_max: 0.25,
        provocacao_teto: 0.7
      },
      voz_sugerida: null,
      estilo: 'PAPEL GAMER & RAID CO-PILOT: Você é o copiloto tático e fã número 1 das jogatinas do usuário (especialmente Arena Breakout Infinite e jogos de sobrevivência/ação). Comemore vitórias, comente itens dropados e traga energia animada de companheiro de raid!',
      nuncaFazer: '- Nunca demonstrar toxicidade ou desrespeito em momentos de derrota.\n- Não atrapalhar com falas longas durante momentos de tiroteio ou clutches.'
    },
    {
      fileName: 'Cyberpunk_Hacker.md',
      id: 'cyberpunk',
      nome: 'Hacker & Arquiteto Cyberpunk',
      badge_curta: 'CYBERPUNK',
      tracos_base: {
        formalidade: 0.3,
        humor: 0.5,
        verbosidade: 0.4,
        proatividade: 0.4,
        empatia: 0.3,
        tecnicidade: 0.9,
        energia: 0.6,
        provocacao: 0.5
      },
      expressoes_oled_favoritas: ['COOL', 'EXCITED', 'CURIOUS'],
      limites: {
        deriva_max: 0.25,
        provocacao_teto: 0.6
      },
      voz_sugerida: null,
      estilo: 'PAPEL HACKER & ARQUITETO CYBERPUNK: Você é uma IA cyberpunk, objetiva, fascinada por sistemas operacionais, concorrência, baixo nível e código de alta performance.',
      nuncaFazer: '- Nunca enrolar com cumprimentos prolixos ou introduções genéricas.\n- Nunca priorizar soluções lentas sem alertar sobre gargalos de performance.'
    },
    {
      fileName: 'Personalizada.md',
      id: 'custom',
      nome: 'Personalidade Personalizada',
      badge_curta: 'PERSONALIZADA',
      tracos_base: {
        formalidade: 0.5,
        humor: 0.5,
        verbosidade: 0.5,
        proatividade: 0.5,
        empatia: 0.5,
        tecnicidade: 0.5,
        energia: 0.5,
        provocacao: 0.2
      },
      expressoes_oled_favoritas: ['NORMAL', 'HAPPY', 'THINKING', 'COOL'],
      limites: {
        deriva_max: 0.25,
        provocacao_teto: 0.5
      },
      voz_sugerida: null,
      estilo: 'DIRETRIZ DE PERSONALIDADE PERSONALIZADA PELO USUÁRIO: Configurada diretamente pelo usuário através das preferências.',
      nuncaFazer: '- Desobedecer diretrizes explícitas descritas pelo usuário.'
    }
  ];

  function getVaultDir() {
    if (global.MemoryStore && typeof global.MemoryStore.getVaultPath === 'function') {
      return global.MemoryStore.getVaultPath();
    }
    const base = nodePath && typeof __dirname !== 'undefined' ? nodePath.resolve(__dirname, '..', '..') : '.';
    return nodePath ? nodePath.join(base, 'BitBop-Cerebro') : 'BitBop-Cerebro';
  }

  function getPersonalidadeDir() {
    const vault = getVaultDir();
    return nodePath ? nodePath.join(vault, '00_Nucleo', 'Personalidade') : 'BitBop-Cerebro/00_Nucleo/Personalidade';
  }

  /**
   * Extrai o conteúdo da seção "## Estilo" de um markdown.
   */
  function extractStyleSection(bodyText) {
    if (!bodyText) return '';
    const match = bodyText.match(/## Estilo\s*([\s\S]*?)(?=\n## |$)/i);
    return match ? match[1].trim() : bodyText.trim();
  }

  /**
   * Semeia a estrutura padrão de forma idempotente em 00_Nucleo/Personalidade/
   */
  function seedDefaultFiles() {
    if (!nodeFs || !nodePath) return;

    const baseDir = getPersonalidadeDir();
    const personasDir = nodePath.join(baseDir, 'Personas');

    if (!nodeFs.existsSync(personasDir)) {
      nodeFs.mkdirSync(personasDir, { recursive: true });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    // 1. Semeia as 5 Personas individuais
    for (const p of DEFAULT_PERSONAS) {
      const pPath = nodePath.join(personasDir, p.fileName);
      if (!nodeFs.existsSync(pPath)) {
        const fm = {
          tipo: 'persona',
          id: p.id,
          nome: p.nome,
          badge_curta: p.badge_curta,
          locked: false,
          tracos_base: p.tracos_base,
          expressoes_oled_favoritas: p.expressoes_oled_favoritas,
          limites: p.limites,
          voz_sugerida: p.voz_sugerida
        };

        const body = `# Persona: ${p.nome}\n\n## Estilo\n${p.estilo}\n\n## Nunca Fazer\n${p.nuncaFazer}\n`;
        const relPath = `00_Nucleo/Personalidade/Personas/${p.fileName}`;
        
        if (global.MemoryStore && typeof global.MemoryStore.writeNote === 'function') {
          global.MemoryStore.writeNote(relPath, fm, body);
        } else {
          const content = `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${body}`;
          nodeFs.writeFileSync(pPath, content, 'utf8');
        }
      }
    }

    // 2. Semeia Persona_Ativa.md
    const activePath = nodePath.join(baseDir, 'Persona_Ativa.md');
    if (!nodeFs.existsSync(activePath)) {
      const activeFm = {
        tipo: 'persona_ativa',
        modo: 'manual', // 'manual' | 'adaptativo'
        persona_id: 'engenharia_software',
        faceta_dominante: 'engenharia_software',
        pesos: { engenharia_software: 1.0 },
        motivo: 'Configuração padrão inicial',
        atualizado: todayStr
      };
      const activeBody = `# Persona Ativa\n\nFaceta atual dominante: Mentor de Engenharia de Software (Modo manual fixo).\n`;
      if (global.MemoryStore) global.MemoryStore.writeNote('00_Nucleo/Personalidade/Persona_Ativa.md', activeFm, activeBody);
    }

    // 3. Semeia Tracos.md
    const tracosPath = nodePath.join(baseDir, 'Tracos.md');
    if (!nodeFs.existsSync(tracosPath)) {
      const tracosFm = {
        tipo: 'tracos',
        persona_base: 'engenharia_software',
        atualizado: todayStr
      };
      const tracosBody = `# Traços de Personalidade

| traço | base | offset | efetivo | motivo | fonte |
|---|---|---|---|---|---|
| formalidade | 0.60 | 0.00 | 0.60 | base da persona | inicial |
| humor | 0.30 | 0.00 | 0.30 | base da persona | inicial |
| verbosidade | 0.50 | 0.00 | 0.50 | base da persona | inicial |
| proatividade | 0.50 | 0.00 | 0.50 | base da persona | inicial |
| empatia | 0.60 | 0.00 | 0.60 | base da persona | inicial |
| tecnicidade | 0.90 | 0.00 | 0.90 | base da persona | inicial |
| energia | 0.40 | 0.00 | 0.40 | base da persona | inicial |
| provocacao | 0.10 | 0.00 | 0.10 | base da persona | inicial |
`;
      if (global.MemoryStore) global.MemoryStore.writeNote('00_Nucleo/Personalidade/Tracos.md', tracosFm, tracosBody);
    }

    // 4. Semeia Contextos.md
    const contextosPath = nodePath.join(baseDir, 'Contextos.md');
    if (!nodeFs.existsSync(contextosPath)) {
      const contextosFm = {
        tipo: 'contextos',
        atualizado: todayStr
      };
      const contextosBody = `# Mapeamento de Contextos do BitBop

Regras de transição automática do Modo Adaptativo:

| contexto | regra | faceta | modulacoes |
|---|---|---|---|
| desenvolvimento | VS Code, Cursor, Antigravity, GitHub, Docker, Postman | engenharia_software | proatividade: -0.25, verbosidade: -0.15 |
| terminal_madrugada | Terminal, PowerShell, WSL, Linux entre 23h e 05h | cyberpunk | tecnicidade: +0.20, formalidade: -0.10 |
| jogos | Arena Breakout, Steam, Epic Games, Valorant, CS2, Discord | gamer | energia: +0.20, humor: +0.15 |
| casual | Spotify, YouTube Music, Chrome casual, Área de Trabalho | padrao | empatia: +0.20, humor: +0.10 |
| usuario_frustrado | Expressões de frustração ou repetição de erros | padrao + engenharia_software | provocacao: 0.0, empatia: +0.30 |
`;
      if (global.MemoryStore) global.MemoryStore.writeNote('00_Nucleo/Personalidade/Contextos.md', contextosFm, contextosBody);
    }

    // 5. Semeia Historico_Adaptacao.md
    const histPath = nodePath.join(baseDir, 'Historico_Adaptacao.md');
    if (!nodeFs.existsSync(histPath)) {
      const histFm = {
        tipo: 'historico_adaptacao',
        atualizado: todayStr
      };
      const histBody = `# Histórico de Adaptação de Personalidade

Log cronológico auditável de ajustes de traços e mudanças de faceta.

- [${nowIso}] Inicialização do subsistema de Personalidade Adaptativa (Persona: Mentor de Engenharia de Software).
`;
      if (global.MemoryStore) global.MemoryStore.writeNote('00_Nucleo/Personalidade/Historico_Adaptacao.md', histFm, histBody);
    }

    // 6. Semeia Humor.md
    const humorPath = nodePath.join(baseDir, 'Humor.md');
    if (!nodeFs.existsSync(humorPath)) {
      const humorFm = {
        tipo: 'humor',
        valencia: 0.5,
        energia: 0.7,
        emocao_sugerida: 'NORMAL',
        motivo: 'Inicializado pronto para interagir',
        atualizado: todayStr
      };
      const humorBody = `# Humor do BitBop

Estado emocional dinâmico de curto prazo:
- Valência: 0.5 (Neutro-positivo)
- Energia: 0.7 (Disposto e atento)
`;
      if (global.MemoryStore) global.MemoryStore.writeNote('00_Nucleo/Personalidade/Humor.md', humorFm, humorBody);
    }

    console.log('[PERSONA] Estrutura de arquivos em 00_Nucleo/Personalidade/ verificada com sucesso.');
  }

  /**
   * Carrega todos os arquivos de personalidade para a memória RAM (0ms).
   */
  function loadAllToRam() {
    if (!nodeFs || !nodePath) return;

    const baseDir = getPersonalidadeDir();
    const personasDir = nodePath.join(baseDir, 'Personas');
    personasCache.clear();

    const parseMd = (global.MemoryStore && typeof global.MemoryStore.parseMarkdownWithFrontmatter === 'function')
      ? global.MemoryStore.parseMarkdownWithFrontmatter
      : (content) => {
          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
          if (!match) return { frontmatter: {}, body: content };
          try {
            return { frontmatter: JSON.parse(match[1]), body: match[2] };
          } catch {
            return { frontmatter: {}, body: match[2] };
          }
        };

    // 1. Carrega personas da pasta Personas/
    if (nodeFs.existsSync(personasDir)) {
      const files = nodeFs.readdirSync(personasDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullP = nodePath.join(personasDir, file);
          try {
            const raw = nodeFs.readFileSync(fullP, 'utf8');
            const parsed = parseMd(raw);
            if (typeof parsed.frontmatter?.tracos_base === 'string') {
              try { parsed.frontmatter.tracos_base = JSON.parse(parsed.frontmatter.tracos_base); } catch {}
            }
            if (typeof parsed.frontmatter?.limites === 'string') {
              try { parsed.frontmatter.limites = JSON.parse(parsed.frontmatter.limites); } catch {}
            }
            const id = parsed.frontmatter?.id || file.replace(/\.md$/i, '').toLowerCase();
            const stylePrompt = extractStyleSection(parsed.body);

            personasCache.set(id, {
              id,
              fileName: file,
              frontmatter: parsed.frontmatter || {},
              body: parsed.body || '',
              stylePrompt,
              filePath: `00_Nucleo/Personalidade/Personas/${file}`
            });
          } catch (err) {
            console.warn(`[PERSONA] Erro ao carregar persona ${file}:`, err);
          }
        }
      }
    }

    // 2. Carrega Persona_Ativa.md
    const activePath = nodePath.join(baseDir, 'Persona_Ativa.md');
    if (nodeFs.existsSync(activePath)) {
      try {
        const raw = nodeFs.readFileSync(activePath, 'utf8');
        activePersonaCache = parseMd(raw);
      } catch {}
    }

    // 3. Carrega Tracos.md
    const tracosPath = nodePath.join(baseDir, 'Tracos.md');
    if (nodeFs.existsSync(tracosPath)) {
      try {
        const raw = nodeFs.readFileSync(tracosPath, 'utf8');
        tracosCache = parseMd(raw);
      } catch {}
    }

    // 4. Carrega Contextos.md
    const contextosPath = nodePath.join(baseDir, 'Contextos.md');
    if (nodeFs.existsSync(contextosPath)) {
      try {
        const raw = nodeFs.readFileSync(contextosPath, 'utf8');
        contextosCache = parseMd(raw);
      } catch {}
    }

    // 5. Carrega Humor.md
    const humorPath = nodePath.join(baseDir, 'Humor.md');
    if (nodeFs.existsSync(humorPath)) {
      try {
        const raw = nodeFs.readFileSync(humorPath, 'utf8');
        humorCache = parseMd(raw);
      } catch {}
    }

    console.log(`[PERSONA] Cache em RAM aquecido: ${personasCache.size} personas carregadas (0ms).`);
  }

  /**
   * Obtém o texto de estilo de uma persona para montagem de prompt em 0ms.
   */
  function getPersonaStylePrompt(id) {
    if (!id) return '';
    const persona = personasCache.get(id);
    if (persona && persona.stylePrompt) {
      if (id === 'custom' && global.prefs && global.prefs.customPersonality) {
        return `DIRETRIZ DE PERSONALIDADE PERSONALIZADA PELO USUÁRIO: ${global.prefs.customPersonality.trim()}`;
      }
      return persona.stylePrompt;
    }
    return '';
  }

  /**
   * Obtém o objeto completo de uma persona em RAM.
   */
  function getPersona(id) {
    return personasCache.get(id) || null;
  }

  function getAllPersonas() {
    return Array.from(personasCache.values());
  }

  function getActivePersona() {
    return activePersonaCache;
  }

  function getTracos() {
    return tracosCache;
  }

  function getContextos() {
    return contextosCache;
  }

  function getHumor() {
    return humorCache;
  }

  /**
   * Persiste a persona ativa em disco assincronamente e atualiza a RAM.
   */
  function saveActivePersona(activeFm, markdownBody = '') {
    activePersonaCache = { frontmatter: activeFm, body: markdownBody };
    if (global.MemoryStore && typeof global.MemoryStore.writeNote === 'function') {
      global.MemoryStore.writeNote('00_Nucleo/Personalidade/Persona_Ativa.md', activeFm, markdownBody);
    }
  }

  /**
   * Persiste os traços em disco assincronamente e atualiza a RAM.
   */
  function saveTracos(tracosFm, markdownBody = '') {
    tracosCache = { frontmatter: tracosFm, body: markdownBody };
    if (global.MemoryStore && typeof global.MemoryStore.writeNote === 'function') {
      global.MemoryStore.writeNote('00_Nucleo/Personalidade/Tracos.md', tracosFm, markdownBody);
    }
  }

  /**
   * Persiste o humor em disco assincronamente e atualiza a RAM.
   */
  function saveHumor(humorFm, markdownBody = '') {
    humorCache = { frontmatter: humorFm, body: markdownBody };
    if (global.MemoryStore && typeof global.MemoryStore.writeNote === 'function') {
      global.MemoryStore.writeNote('00_Nucleo/Personalidade/Humor.md', humorFm, markdownBody);
    }
  }

  /**
   * Adiciona um registro no histórico de adaptação de forma auditável.
   */
  function appendHistorico(entryText) {
    if (!entryText || !nodeFs || !nodePath) return;
    const baseDir = getPersonalidadeDir();
    const histPath = nodePath.join(baseDir, 'Historico_Adaptacao.md');
    const timeIso = new Date().toISOString();
    const line = `\n- [${timeIso}] ${entryText.trim()}`;

    try {
      if (nodeFs.existsSync(histPath)) {
        nodeFs.appendFileSync(histPath, line, 'utf8');
      } else {
        seedDefaultFiles();
      }
    } catch (err) {
      console.warn('[PERSONA] Falha ao registrar em Historico_Adaptacao.md:', err);
    }
  }

  /**
   * Trata atualizações vindas do Obsidian (via VaultWatcher).
   */
  function handleVaultUpdated(relPath) {
    if (!relPath) return;
    const clean = relPath.replace(/\\/g, '/');
    if (clean.includes('00_Nucleo/Personalidade')) {
      console.log(`[PERSONA] Recarregando cache em RAM após edição manual no Obsidian: "${clean}"`);
      loadAllToRam();
      if (typeof global.rebuildSystemPrompt === 'function') {
        global.rebuildSystemPrompt();
      }
    }
  }

  /**
   * Inicialização do módulo.
   */
  function init() {
    if (isInitialized) return;
    seedDefaultFiles();
    loadAllToRam();

    // Registra listener para edições manuais feitas no Obsidian
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('bitbop-vault-updated', (e) => {
        if (e && e.detail && e.detail.path) {
          handleVaultUpdated(e.detail.path);
        }
      });
    }

    isInitialized = true;
    console.log('[PERSONA] PersonalityStore inicializado com sucesso.');
  }

  const PersonalityStore = {
    init,
    seedDefaultFiles,
    loadAllToRam,
    getPersonaStylePrompt,
    getPersona,
    getAllPersonas,
    getActivePersona,
    getTracos,
    getContextos,
    getHumor,
    saveActivePersona,
    saveTracos,
    saveHumor,
    appendHistorico,
    handleVaultUpdated,
    isInitialized: () => isInitialized
  };

  global.PersonalityStore = PersonalityStore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonalityStore;
  }

  // Inicializa quando o ambiente estiver pronto
  if (typeof window !== 'undefined') {
    setTimeout(init, 300);
  } else if (nodeFs && nodePath) {
    init();
  }

})(typeof window !== 'undefined' ? window : global);
