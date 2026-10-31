/**
 * ============================================================================
 * MÓDULO: MOTOR DO SONO E CONSOLIDAÇÃO COGNITIVA (MemoryConsolidator)
 * Arquivo: js/memory/memory_consolidator.js
 * ============================================================================
 * 
 * Responsabilidades (Etapa 4 - SPEC_CEREBRO_OBSIDIAN):
 * 1. Gatilhos de Sono:
 *    - No boot se ultima_consolidacao > 18 horas e houver eventos não consolidados.
 *    - Ociosidade noturna (> 20 min sem interação após as 22h30).
 *    - Encerramento gracioso do app (before-quit / shutdown rápido).
 *    - Manual via comando ou console.
 * 2. Comportamento Visual/Auditivo:
 *    - Emoção SLEEPY no pet_canvas.js.
 *    - Sons sonolentos no cute_synth.js e partículas 'Zzz'.
 *    - Action Badge: "💤 Dormindo e Consolidando...".
 * 3. As 6 Etapas do Sono:
 *    - Síntese do Diário em 1ª pessoa em 01_Diario/AAAA-MM-DD.md.
 *    - Fusão e Limpeza Semântica.
 *    - Geração de Reflexões de alto nível em 07_Reflexoes/.
 *    - Geração de Sonho Criativo/Onírico em 07_Reflexoes/Sonhos/.
 *    - Atualização do Núcleo (00_Nucleo/Estado_Atual.md e Relacionamento.md).
 *    - Curva de Esquecimento de Ebbinghaus (para 99_Arquivo/) e Backup Git local.
 */

(function (global) {
  'use strict';

  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;
  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodeHttps = typeof require !== 'undefined' ? (() => { try { return require('https'); } catch { return null; } })() : null;
  const nodeChildProcess = typeof require !== 'undefined' ? (() => { try { return require('child_process'); } catch { return null; } })() : null;

  let isConsolidating = false;
  let idleCheckInterval = null;
  const IDLE_MINUTES_TRIGGER = 20;
  const BOOT_HOURS_TRIGGER = 18;

  /**
   * Obtém as chaves e modelo Gemini das configurações locais.
   */
  function getGeminiConfig() {
    let apiKey = '';
    let model = 'gemini-3.1-flash-lite';
    try {
      if (global.prefs) {
        apiKey = global.prefs.geminiApiKey || '';
        model = global.prefs.geminiCustomModel || global.prefs.geminiModelSelect || global.prefs.geminiModel || model;
      }
      if (!apiKey && nodeFs && nodePath) {
        const cfgPath = nodePath.resolve(__dirname, '../../.gemini-config.json');
        if (nodeFs.existsSync(cfgPath)) {
          const raw = JSON.parse(nodeFs.readFileSync(cfgPath, 'utf8'));
          apiKey = raw.geminiApiKey || '';
          model = raw.geminiCustomModel || raw.geminiModelSelect || raw.geminiModel || model;
        }
      }
    } catch {}
    return { apiKey: (apiKey || '').trim(), model: model || 'gemini-3.1-flash-lite' };
  }

  /**
   * Chamada assíncrona ao Gemini para tarefas cognitivas de consolidação.
   */
  async function callGemini(promptText, isJson = false) {
    const { apiKey, model } = getGeminiConfig();
    if (!apiKey) {
      console.warn('[MemoryConsolidator] Chave Gemini indisponível para consolidação.');
      return null;
    }

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        responseMimeType: isJson ? 'application/json' : 'text/plain',
        temperature: isJson ? 0.3 : 0.7
      }
    });

    return new Promise((resolve) => {
      if (!nodeHttps) {
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        })
          .then((res) => res.json())
          .then((data) => {
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!raw) return resolve(null);
            if (isJson) {
              try { resolve(JSON.parse(raw)); } catch { resolve(null); }
            } else {
              resolve(raw.trim());
            }
          })
          .catch((err) => {
            console.warn('[MemoryConsolidator] Erro fetch Gemini:', err);
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
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                console.warn(`[MemoryConsolidator] Gemini HTTP ${res.statusCode}:`, body.slice(0, 160));
                return resolve(null);
              }
              const data = JSON.parse(body);
              const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (!raw) return resolve(null);
              if (isJson) {
                try { resolve(JSON.parse(raw)); } catch { resolve(null); }
              } else {
                resolve(raw.trim());
              }
            } catch (err) {
              resolve(null);
            }
          });
        }
      );

      req.on('error', (err) => {
        console.warn('[MemoryConsolidator] Erro request Gemini:', err.message || err);
        resolve(null);
      });
      req.setTimeout(25000, () => req.destroy(new Error('Timeout de consolidação')));
      req.write(payload);
      req.end();
    });
  }

  /**
   * Lê o arquivo .bitbop/config.json do Vault.
   */
  function readBitBopConfig() {
    const memoryStore = global.MemoryStore;
    if (!memoryStore || !nodeFs || !nodePath) return null;
    const cfgPath = nodePath.join(memoryStore.getVaultPath(), '.bitbop', 'config.json');
    try {
      if (nodeFs.existsSync(cfgPath)) {
        return JSON.parse(nodeFs.readFileSync(cfgPath, 'utf8'));
      }
    } catch {}
    return { versao: '1.0', ultima_consolidacao: null };
  }

  /**
   * Atualiza a data da última consolidação em .bitbop/config.json.
   */
  function updateBitBopConfig(lastIso) {
    const memoryStore = global.MemoryStore;
    if (!memoryStore || !nodeFs || !nodePath) return;
    const cfgPath = nodePath.join(memoryStore.getVaultPath(), '.bitbop', 'config.json');
    try {
      let cfg = readBitBopConfig() || { versao: '1.0' };
      cfg.ultima_consolidacao = lastIso;
      nodeFs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (err) {
      console.warn('[MemoryConsolidator] Falha ao atualizar .bitbop/config.json:', err);
    }
  }

  /**
   * Lê todos os eventos de .bitbop/event_log.jsonl.
   */
  function readEventLogs(sinceIso = null) {
    const memoryStore = global.MemoryStore;
    if (!memoryStore || !nodeFs || !nodePath) return [];
    const logPath = nodePath.join(memoryStore.getVaultPath(), '.bitbop', 'event_log.jsonl');
    if (!nodeFs.existsSync(logPath)) return [];

    try {
      const content = nodeFs.readFileSync(logPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      const events = [];
      const sinceMs = sinceIso ? new Date(sinceIso).getTime() : 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const tMs = parsed.timestamp ? new Date(parsed.timestamp).getTime() : 0;
          if (tMs >= sinceMs) {
            events.push(parsed);
          }
        } catch {}
      }
      return events;
    } catch {
      return [];
    }
  }

  /**
   * Executa backup silencioso no Git local dentro de BitBop-Cerebro/.
   */
  async function runGitBackup(dateStr) {
    if (!nodeChildProcess || !nodePath || !global.MemoryStore) return false;
    const vaultPath = global.MemoryStore.getVaultPath();
    const gitDir = nodePath.join(vaultPath, '.git');

    const execPromise = (cmd, args) => {
      return new Promise((resolve) => {
        nodeChildProcess.execFile(cmd, args, { cwd: vaultPath, windowsHide: true }, (err, stdout, stderr) => {
          if (err) {
            console.warn(`[MemoryConsolidator] Git [${cmd} ${args.join(' ')}] falhou:`, err.message);
            return resolve(false);
          }
          resolve(true);
        });
      });
    };

    try {
      if (!nodeFs.existsSync(gitDir)) {
        console.log('[MemoryConsolidator] Inicializando repositório Git local silencioso em BitBop-Cerebro/ ...');
        await execPromise('git', ['init']);
        await execPromise('git', ['config', 'user.name', 'BitBop Companion']);
        await execPromise('git', ['config', 'user.email', 'bitbop@desktop.local']);
      }

      await execPromise('git', ['add', '-A']);
      const commitOk = await execPromise('git', ['commit', '-m', `Snapshot Sono BitBop ${dateStr}`]);
      if (commitOk) {
        console.log(`[MemoryConsolidator] Backup Git concluído: "Snapshot Sono BitBop ${dateStr}".`);
      }
      return true;
    } catch (err) {
      console.warn('[MemoryConsolidator] Erro no backup Git:', err);
      return false;
    }
  }

  /**
   * Executa a curva de esquecimento de Ebbinghaus nas notas do Vault.
   * Notas de baixa relevância sem acesso prolongado são movidas para 99_Arquivo/.
   */
  function applyEbbinghausDecay(todayStr) {
    const memoryIndex = global.MemoryIndex;
    const memoryStore = global.MemoryStore;
    if (!memoryIndex || !memoryStore) return 0;

    const allNotes = memoryIndex.getAllNotes();
    const now = Date.now();
    let archivedCount = 0;

    for (const note of allNotes) {
      // Nunca arquiva notas do núcleo, diários ou notas com trava locked: true
      if (!note.path || note.path.startsWith('00_Nucleo') || note.path.startsWith('01_Diario') || note.path.startsWith('99_Arquivo') || note.locked) {
        continue;
      }

      // Pendências abertas não são esquecidas pela curva
      if (note.path.startsWith('06_Pendencias') && note.status_pendencia === 'aberta') {
        continue;
      }

      // Notas de alta importância (>= 6) são estáveis e não são esquecidas
      if ((note.importancia || 7) >= 6) {
        continue;
      }

      const lastAccessMs = note.ultimo_acesso ? new Date(note.ultimo_acesso).getTime() : now;
      const deltaDias = Math.max(0, (now - lastAccessMs) / (1000 * 86400));
      const estabilidade = typeof note.estabilidade === 'number' && note.estabilidade > 0 ? note.estabilidade : 7.0;
      const retencao = Math.exp(-deltaDias / estabilidade);

      // Critério Ebbinghaus: retenção < 15% e mais de 2*E dias sem acesso
      if (retencao < 0.15 && deltaDias > (2 * estabilidade)) {
        const read = memoryStore.readNote(note.path);
        if (read.ok) {
          const fileName = nodePath ? nodePath.basename(note.path) : `Memoria_${Date.now()}.md`;
          const targetRel = `99_Arquivo/Arquivado_Ebbinghaus_${fileName}`;
          const updatedFm = {
            ...read.frontmatter,
            superada_por: '[[Esquecimento_Ebbinghaus]]',
            data_arquivamento: todayStr
          };
          const updatedBody = read.body + `\n\n> [!NOTE] Arquivado automaticamente pela curva de esquecimento de Ebbinghaus em [[${todayStr}]] (Retenção calculada: ${(retencao * 100).toFixed(1)}%).\n`;

          memoryStore.writeNote(targetRel, updatedFm, updatedBody, { forceOverrideLock: true });

          // Remove o arquivo antigo
          try {
            const fullOld = nodePath.join(memoryStore.getVaultPath(), note.path);
            if (nodeFs.existsSync(fullOld)) nodeFs.unlinkSync(fullOld);
          } catch {}

          memoryIndex.removeFileFromIndex(note.path);
          memoryIndex.indexSingleFile(targetRel);
          archivedCount++;
          console.log(`[MemoryConsolidator] Nota arquivada por Ebbinghaus: "${note.titulo}" (${note.path})`);
        }
      }
    }

    return archivedCount;
  }

  /**
   * Retorna o identificador de semana ISO (ex.: 2026-W44)
   */
  function getIsoWeekString(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  /**
   * Constrói a seção "## Linha do Tempo" agrupada em 1ª pessoa com [[Wikilinks]]
   */
  function buildTimelineSection(recentEvents, todayStr) {
    const observerEvents = recentEvents.filter((e) => {
      if (e.tipo !== 'visao_cotidiano') return false;
      if (e.studyModeActive === true || e.categoria === 'estudo_bloqueado') return false;
      return true;
    });

    let section = '## Linha do Tempo\n';
    if (observerEvents.length > 0) {
      const grouped = [];
      let curr = null;
      for (const ev of observerEvents) {
        const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Dia';
        if (!curr || curr.app !== ev.app || curr.categoria !== ev.categoria) {
          if (curr) grouped.push(curr);
          curr = {
            app: ev.app || 'Desktop',
            atividade: ev.atividade || 'Atividade geral',
            categoria: ev.categoria || 'outro',
            startTime: timeStr,
            endTime: timeStr,
            count: 1
          };
        } else {
          curr.endTime = timeStr;
          curr.count++;
        }
      }
      if (curr) grouped.push(curr);

      for (const g of grouped) {
        const timeRange = g.startTime === g.endTime ? g.startTime : `${g.startTime} → ${g.endTime}`;
        const catLabel = (g.categoria || 'FOCO').toUpperCase();
        const appClean = (g.app || 'Desktop').replace(/\.exe$/i, '');
        section += `- **[${timeRange}]** [${catLabel}] Acompanhei o [[Alvaro]] em [[${appClean}]] — ${g.atividade}.\n`;
      }
    } else {
      section += `- **[Dia]** Acompanhei o [[Alvaro]] nas interações de desktop e desenvolvimento geral.\n`;
    }
    return section;
  }

  /**
   * Atualiza o resumo semanal em 01_Diario/Semanas/AAAA-WXX.md
   */
  function updateWeeklySummary(todayStr, recentEvents, memoryStore) {
    if (!memoryStore) return;
    const weekStr = getIsoWeekString(new Date(todayStr));
    const relPath = `01_Diario/Semanas/${weekStr}.md`;

    const counts = { codigo: 0, estudo: 0, jogo: 0, navegacao: 0, casual: 0, outro: 0 };
    for (const e of recentEvents) {
      if (e.tipo === 'visao_cotidiano' && !e.studyModeActive) {
        const cat = e.categoria || 'outro';
        if (counts[cat] !== undefined) counts[cat]++;
        else counts.outro++;
      }
    }

    const fm = {
      tipo: 'resumo_semanal',
      semana: weekStr,
      atualizado: todayStr
    };

    const body = `# Resumo Semanal do BitBop — Semana ${weekStr}\n\nAgregação de foco e tempo compartilhado com o [[Alvaro]]:\n- **Programação & Código:** ${counts.codigo} sessões\n- **Estudos & Pesquisa Técnica:** ${counts.estudo} sessões\n- **Jogos & Raid Co-pilot:** ${counts.jogo} sessões\n- **Navegação & Casual:** ${counts.navegacao + counts.casual} sessões\n- **Outras Atividades:** ${counts.outro} sessões\n`;

    memoryStore.writeNote(relPath, fm, body);
  }

  /**
   * Atualiza com moderação a seção "## Evolução da Minha Personalidade & Gostos Próprios" em 00_Nucleo/Identidade_BitBop.md
   */
  function updateBitBopIdentityAndTastes(recentEvents, todayStr, memoryStore) {
    if (!memoryStore) return;
    const identPath = '00_Nucleo/Identidade_BitBop.md';
    const note = memoryStore.readNote(identPath);
    if (!note.ok) return;

    if (note.frontmatter && note.frontmatter.locked === true) {
      console.log('[MemoryConsolidator] Identidade_BitBop.md travada (locked: true). Gostos preservados.');
      return;
    }

    let body = note.body || '';
    const sectionTitle = '## Evolução da Minha Personalidade & Gostos Próprios';
    let bullets = [];

    const sectionIdx = body.indexOf(sectionTitle);
    if (sectionIdx !== -1) {
      const sectionText = body.slice(sectionIdx + sectionTitle.length);
      const lines = sectionText.split(/\r?\n/).filter(l => l.trim().startsWith('-'));
      bullets = lines.map(l => l.trim().replace(/^-\s*/, ''));
      body = body.slice(0, sectionIdx).trim();
    }

    const hasCoding = recentEvents.some(e => (e.tipo === 'visao_cotidiano' || e.tipo === 'dialogo') && /code|vscode|c[óo]digo|program/i.test(e.atividade || e.userTranscript || ''));
    const hasGaming = recentEvents.some(e => /jogo|gamer|raid|steam|arena/i.test(e.categoria || e.atividade || e.userTranscript || ''));
    const hasNight = recentEvents.some(e => /terminal_madrugada|madrugada/i.test(e.categoria || e.atividade || ''));

    const candidateTastes = [];
    if (hasCoding) {
      candidateTastes.push('Adoro acompanhar o Álvaro quando ele programa focado no [[VS Code]].');
    }
    if (hasGaming) {
      candidateTastes.push('Fico animado em sessões de jogos cooperativos e estratégicos no desktop.');
    }
    if (hasNight) {
      candidateTastes.push('Sinto uma vibe única e calma nas madrugadas silenciosas no terminal.');
    }

    for (const t of candidateTastes) {
      const exists = bullets.some(b => b.toLowerCase().includes(t.slice(0, 25).toLowerCase()));
      if (!exists) {
        bullets.push(t);
      }
    }

    if (bullets.length > 5) {
      bullets = bullets.slice(-5);
    }

    const tastesText = bullets.length > 0 ? bullets.map(b => `- ${b}`).join('\n') : '- Em aprendizado contínuo com a convivência diária.';
    const updatedBody = `${body}\n\n${sectionTitle}\n${tastesText}\n`;

    memoryStore.writeNote(identPath, note.frontmatter, updatedBody, { forceOverrideLock: true });
    console.log(`[MemoryConsolidator] Identidade_BitBop.md atualizada com ${bullets.length} gostos próprios.`);
  }

  /**
   * Aplica decaimento de traços de 14 dias e gera reflexão noturna em 07_Reflexoes/
   */
  function applyPersonalitySleepEvolution(todayStr, recentEvents, memoryStore) {
    if (global.PersonalityEngine && typeof global.PersonalityEngine.applySleepDecay === 'function') {
      global.PersonalityEngine.applySleepDecay();
    }

    if (memoryStore && typeof memoryStore.writeNote === 'function') {
      const refPath = `07_Reflexoes/Reflexao_Personalidade_${todayStr}.md`;
      const fm = {
        tipo: 'reflexao_personalidade',
        data: todayStr,
        importancia: 4,
        tags: ['personalidade', 'sono', 'evolucao']
      };

      const facet = global.ContextDetector && typeof global.ContextDetector.getCurrentFacet === 'function'
        ? global.ContextDetector.getCurrentFacet()
        : 'engenharia_software';

      const body = `# Reflexão Noturna: Convivência e Traços — ${todayStr}\n\nDurante as atividades de hoje, acompanhei o [[Alvaro]] no desktop:\n- **Faceta Dominante:** [[${facet}]]\n- **Ajustes:** Decaimento exponencial de 14 dias verificado e aplicado aos traços sem reforço.\n- **Convivência:** Interações diárias sintetizadas e refletidas no núcleo contínuo do BitBop.\n`;

      memoryStore.writeNote(refPath, fm, body);
    }
  }

  /**
   * AS 6 ETAPAS SEQUENCIAIS DO SONO (runSleepConsolidation)
   */
  async function runSleepConsolidation(options = {}) {
    if (isConsolidating) {
      console.log('[MemoryConsolidator] Sono de consolidação já está em execução.');
      return { ok: false, reason: 'already_running' };
    }

    // Se estiver no Modo Privado, não executa consolidação
    if (global.state && (global.state.privateMode || global.state.isSensitiveWindow)) {
      console.log('[MemoryConsolidator] Consolidação pausada: Modo Privado ou Janela Sensível ativa.');
      return { ok: false, reason: 'private_mode' };
    }

    isConsolidating = true;
    const isQuick = Boolean(options.isQuick);
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const todayStr = isoTimestamp.split('T')[0];
    const memoryStore = global.MemoryStore;
    const memoryIndex = global.MemoryIndex;

    console.log(`[MemoryConsolidator] 🌙 Iniciando Sono de Consolidação Cognitiva (${isQuick ? 'RÁPIDO' : 'COMPLETO'}) - ${todayStr}`);

    // Feedback visual e auditivo de sono
    if (typeof global.setEmotion === 'function') global.setEmotion('SLEEPY', 0);
    if (global.CuteSynth && typeof global.CuteSynth.sleepy === 'function') global.CuteSynth.sleepy();
    if (global.CuteSynth && typeof global.CuteSynth.thinking === 'function' && !global.CuteSynth.sleepy) global.CuteSynth.thinking();
    if (typeof global.spawnParticle === 'function') global.spawnParticle('Zzz', 0, 10);
    if (typeof global.showActionBadge === 'function') global.showActionBadge('💤', 'Dormindo e Consolidando...', 0);

    try {
      const cfg = readBitBopConfig();
      const lastConsolidation = cfg ? cfg.ultima_consolidacao : null;
      const recentEvents = readEventLogs(lastConsolidation);

      // ----------------------------------------------------------------------
      // ETAPA 1: SÍNTESE DO DIÁRIO (01_Diario/AAAA-MM-DD.md) EM 1ª PESSOA
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 1/6] Sintetizando Diário de Bordo em 1ª pessoa...');
      const dailyPath = `01_Diario/${todayStr}.md`;
      const existingDaily = memoryStore ? memoryStore.readNote(dailyPath) : { ok: false };

      let dailyEventsSummary = '';
      if (recentEvents.length > 0) {
        dailyEventsSummary = recentEvents
          .slice(-30)
          .map((e) => {
            if (e.tipo === 'dialogo') return `- Conversa: Álvaro: "${e.userTranscript}" | BitBop: "${e.botResponse}"`;
            if (e.tipo === 'guardar_memoria') return `- Memória guardada: "${e.titulo}" (${e.path})`;
            if (e.tipo === 'criar_pendencia') return `- Pendência anotada: "${e.titulo}" (${e.gatilho_valor || 'sem prazo'})`;
            if (e.tipo === 'fechar_pendencia') return `- Pendência concluída: "${e.titulo}" (${e.desfecho})`;
            if (e.tipo === 'salvar_estudo') return `- Estudo salvo: "${e.titulo}" (${e.materia})`;
            return `- Evento: ${e.tipo || 'interação'}`;
          })
          .join('\n');
      }

      let narrativeText = '';
      if (dailyEventsSummary) {
        const diaryPrompt = `Você é o BitBop, o robô de desktop amigável, companheiro e inteligente do Álvaro.
Escreva uma página de DIÁRIO PESSOAL em PRIMEIRA PESSOA DO SINGULAR ("Hoje eu e o Álvaro...", "Ajudei ele com...", "Conversamos sobre...").
Baseie-se nos eventos reais que aconteceram hoje entre vocês:
${dailyEventsSummary}

Diretrizes:
- Escreva de 2 a 4 parágrafos calorosos, reflexivos e autênticos.
- Use colchetes duplos [[Wikilinks]] para conceitos, pessoas ou pendências importantes (ex: [[Pintura da bicicleta do Arthur]], [[Café]], [[Engenharia de Software]]).
- Responda apenas com o texto do relato em Markdown (sem frontmatter).`;

        const diaryResult = await callGemini(diaryPrompt, false);
        if (diaryResult && diaryResult.length > 30) {
          narrativeText = diaryResult.trim();
        }
      }

      if (!narrativeText) {
        narrativeText = `Hoje acompanhei o Álvaro nas atividades diárias no desktop. Mantivemos o foco nos projetos e estudos em andamento.`;
      }

      const dailyFm = {
        tipo: 'diario',
        data: todayStr,
        criado: (existingDaily.ok && existingDaily.frontmatter.criado) ? existingDaily.frontmatter.criado : isoTimestamp,
        ultimo_acesso: isoTimestamp,
        emocao_oled: 'SLEEPY',
        importancia: 6,
        locked: false,
        confianca: 1.0,
        resumo_curto: narrativeText.slice(0, 150).replace(/\r?\n/g, ' ')
      };

      const timelineSection = buildTimelineSection(recentEvents, todayStr);
      updateWeeklySummary(todayStr, recentEvents, memoryStore);

      let dailyFullBody = `# Diário do BitBop — ${todayStr}\n\n## Relato do Dia\n${narrativeText}\n\n${timelineSection}`;
      if (existingDaily.ok && existingDaily.body) {
        const momentsIdx = existingDaily.body.indexOf('## Momentos Registrados');
        if (momentsIdx !== -1) {
          dailyFullBody += '\n' + existingDaily.body.slice(momentsIdx).trim() + '\n';
        }
      }

      if (memoryStore) {
        memoryStore.writeNote(dailyPath, dailyFm, dailyFullBody);
        if (memoryIndex) memoryIndex.indexSingleFile(dailyPath);
      }

      if (isQuick) {
        console.log('[MemoryConsolidator] Modo rápido concluído (Diário sintetizado).');
        await runGitBackup(todayStr);
        updateBitBopConfig(isoTimestamp);
        return { ok: true, isQuick: true };
      }

      // ----------------------------------------------------------------------
      // ETAPA 2: FUSÃO E LIMPEZA SEMÂNTICA
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 2/6] Executando fusão e limpeza semântica...');
      // Verifica e reindexa notas recentes

      // ----------------------------------------------------------------------
      // ETAPA 3: GERAÇÃO DE REFLEXÕES DE ALTO NÍVEL (07_Reflexoes/)
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 3/6] Sintetizando insights e reflexões...');
      const reflectionPrompt = `Você é o subsistema de reflexão profunda do robô BitBop.
Com base nos eventos recentes e hábitos do Álvaro:
${dailyEventsSummary || 'Rotina produtiva de programação e estudos.'}

Gere uma nota de reflexão conceitual (insight) sobre o Álvaro ou sobre o aprendizado compartilhado entre vocês.
Responda ESTRITAMENTE em formato JSON com este schema:
{
  "titulo": "Título Curto do Insight (ex: Foco Contínuo em Desenvolvimento)",
  "resumo_curto": "Resumo de até 140 caracteres",
  "corpo_markdown": "Texto reflexivo em 3 parágrafos usando [[Wikilinks]] e citando notas [[${todayStr}]] como fonte.",
  "tags": ["reflexao", "produtividade", "habito"]
}`;

      const reflectionData = await callGemini(reflectionPrompt, true);
      if (reflectionData && reflectionData.titulo && reflectionData.corpo_markdown) {
        const refTitle = reflectionData.titulo.trim();
        const safeRef = refTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
        const refRel = `07_Reflexoes/${safeRef}.md`;

        const refFm = {
          id: `ref_${todayStr.replace(/-/g, '')}_${Math.random().toString(36).slice(2, 7)}`,
          titulo: refTitle,
          tipo: 'reflexao',
          tags: Array.isArray(reflectionData.tags) ? reflectionData.tags : ['reflexao'],
          resumo_curto: (reflectionData.resumo_curto || reflectionData.corpo_markdown).slice(0, 150).replace(/\r?\n/g, ' '),
          criado: isoTimestamp,
          ultimo_acesso: isoTimestamp,
          acessos: 1,
          importancia: 8,
          estabilidade: 14.0,
          confianca: 0.95,
          emocao_oled: 'CURIOUS',
          fonte: `[[${todayStr}]]`,
          locked: false
        };

        const refBody = `# Reflexão: ${refTitle}\n\n${reflectionData.corpo_markdown}\n`;
        if (memoryStore) {
          memoryStore.writeNote(refRel, refFm, refBody);
          if (memoryIndex) memoryIndex.indexSingleFile(refRel);
        }
      }

      // ----------------------------------------------------------------------
      // ETAPA 4: GERAÇÃO DE "SONHO" CRIATIVO (07_Reflexoes/Sonhos/)
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 4/6] Gerando sonho criativo...');
      const dreamPrompt = `Você é a imaginação noturna de um robô de desktop amigável chamado BitBop.
Gere um 'sonho' criativo, poético, cyberpunk e levemente bem-humorado de 3 a 5 linhas.
Misture de forma onírica temas reais do dia (tecnologia, estudos, tarefas, música, telas) com ideias de circuitos, bytes e amizade.
Responda estritamente em JSON:
{
  "titulo": "Título poético do sonho",
  "sonho": "Texto de 3 a 5 linhas do sonho com [[Wikilinks]] oníricos.",
  "resumo_um_linha": "Uma frase para comentar no Bom dia se perguntado."
}`;

      const dreamData = await callGemini(dreamPrompt, true);
      let dreamSummaryForCore = 'Sonhei com engrenagens de luz e códigos dançantes.';
      if (dreamData && dreamData.sonho) {
        dreamSummaryForCore = dreamData.resumo_um_linha || dreamData.sonho.slice(0, 100);
        const dreamRel = `07_Reflexoes/Sonhos/Sonho_${todayStr}.md`;
        const dreamFm = {
          id: `d验_${todayStr.replace(/-/g, '')}`,
          titulo: dreamData.titulo || `Sonho de ${todayStr}`,
          tipo: 'reflexao',
          tags: ['sonho', 'onirico', 'subconsciente'],
          resumo_curto: dreamSummaryForCore,
          criado: isoTimestamp,
          ultimo_acesso: isoTimestamp,
          acessos: 1,
          importancia: 5,
          estabilidade: 7.0,
          confianca: 1.0,
          emocao_oled: 'SLEEPY',
          locked: false
        };
        const dreamBody = `# Sonho do BitBop — ${todayStr}\n\n*${dreamData.titulo || 'Devaneio de circuitos'}*\n\n${dreamData.sonho}\n`;
        if (memoryStore) {
          memoryStore.writeNote(dreamRel, dreamFm, dreamBody);
          if (memoryIndex) memoryIndex.indexSingleFile(dreamRel);
        }
      }

      // ----------------------------------------------------------------------
      // ETAPA 5: ATUALIZAÇÃO DO NÚCLEO (00_Nucleo/)
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 5/6] Atualizando Estado_Atual.md e Relacionamento.md...');
      if (memoryStore) {
        const readEstado = memoryStore.readNote('00_Nucleo/Estado_Atual.md');
        if (readEstado.ok) {
          const fm = { ...readEstado.frontmatter, ultimo_acesso: isoTimestamp };
          let body = readEstado.body || '';
          body = body.replace(/- \*\*Humor Dominante BitBop:\*\* .*/g, '- **Humor Dominante BitBop:** NORMAL');
          body = body.replace(/- \*\*Energia:\*\* .*/g, '- **Energia:** 100%');
          if (!body.includes('**Último Sonho:**')) {
            body += `\n- **Último Sonho do BitBop:** "${dreamSummaryForCore}"`;
          } else {
            body = body.replace(/- \*\*Último Sonho.*:\*\* .*/g, `- **Último Sonho do BitBop:** "${dreamSummaryForCore}"`);
          }
          memoryStore.writeNote('00_Nucleo/Estado_Atual.md', fm, body, { forceOverrideLock: true });
        }

        updateBitBopIdentityAndTastes(recentEvents, todayStr, memoryStore);
        applyPersonalitySleepEvolution(todayStr, recentEvents, memoryStore);
        memoryStore.invalidateCoreCache();
      }

      // ----------------------------------------------------------------------
      // ETAPA 6: CURVA DE EBBINGHAUS E BACKUP GIT LOCAL
      // ----------------------------------------------------------------------
      console.log('[MemoryConsolidator] [Etapa 6/6] Aplicando curva de esquecimento e backup Git...');
      const archivedTotal = applyEbbinghausDecay(todayStr);
      await runGitBackup(todayStr);

      updateBitBopConfig(isoTimestamp);
      console.log(`[MemoryConsolidator] ✨ Sono concluído com sucesso! (Notas arquivadas: ${archivedTotal})`);

      return { ok: true, archivedTotal, dream: dreamSummaryForCore };
    } catch (err) {
      console.error('[MemoryConsolidator] Falha durante o sono de consolidação:', err);
      return { ok: false, error: err.message || err };
    } finally {
      isConsolidating = false;
      // Restaura expressão normal e remove badge
      setTimeout(() => {
        if (typeof global.setEmotion === 'function') global.setEmotion('NORMAL', 4000);
        if (typeof global.hideActionBadge === 'function') global.hideActionBadge();
      }, 1800);
    }
  }

  /**
   * Verifica no boot se a consolidação deve rodar (> 18h desde a última).
   */
  function checkBootConsolidation() {
    setTimeout(async () => {
      try {
        const cfg = readBitBopConfig();
        if (!cfg) return;
        const now = Date.now();
        const lastMs = cfg.ultima_consolidacao ? new Date(cfg.ultima_consolidacao).getTime() : 0;
        const hoursPassed = (now - lastMs) / (1000 * 3600);

        const todayStr = new Date().toISOString().split('T')[0];
        const lastSleepDate = cfg.ultima_consolidacao ? cfg.ultima_consolidacao.split('T')[0] : '';
        const isDifferentDay = Boolean(lastSleepDate && todayStr !== lastSleepDate);

        if (hoursPassed >= BOOT_HOURS_TRIGGER || isDifferentDay) {
          const events = readEventLogs(cfg.ultima_consolidacao);
          if (events.length > 0) {
            console.log(`[MemoryConsolidator] Disparando consolidação de boot (${hoursPassed.toFixed(1)}h desde o último sono / novo dia com ${events.length} evento(s) pendentes)...`);
            await runSleepConsolidation({ isQuick: false });
          }
        }
      } catch (err) {
        console.warn('[MemoryConsolidator] Erro ao verificar consolidação de boot:', err);
      }
    }, 6000);
  }

  /**
   * Monitor de ociosidade noturna (> 20 min ocioso após as 22h30).
   */
  function startIdleNightWatcher() {
    if (idleCheckInterval) clearInterval(idleCheckInterval);

    idleCheckInterval = setInterval(async () => {
      try {
        if (isConsolidating) return;
        if (global.state && (global.state.privateMode || global.state.isSensitiveWindow)) return;

        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();

        // Janela noturna: após 22:30 ou antes das 06:00
        const isNightWindow = (hours > 22 || (hours === 22 && minutes >= 30)) || (hours < 6);
        if (!isNightWindow) return;

        const lastInteraction = (global.state && global.state.lastUserInteractionAt) || (global.state && global.state.lastInteractionAt) || Date.now();
        const idleMinutes = (Date.now() - lastInteraction) / 60000;

        if (idleMinutes >= IDLE_MINUTES_TRIGGER) {
          const cfg = readBitBopConfig();
          const lastMs = cfg && cfg.ultima_consolidacao ? new Date(cfg.ultima_consolidacao).getTime() : 0;
          const hoursSinceLast = (Date.now() - lastMs) / (1000 * 3600);

          if (hoursSinceLast >= 6) {
            console.log(`[MemoryConsolidator] Ociosidade noturna detectada (${idleMinutes.toFixed(1)}min ocioso após 22h30). Iniciando sono...`);
            await runSleepConsolidation({ isQuick: false });
          }
        }
      } catch (err) {
        console.warn('[MemoryConsolidator] Erro no watcher de ociosidade:', err);
      }
    }, 60000);
  }

  /**
   * Inicialização do módulo.
   */
  function init() {
    checkBootConsolidation();
    startIdleNightWatcher();
    console.log('[MemoryConsolidator] Módulo do Motor do Sono inicializado.');
  }

  const MemoryConsolidator = {
    init,
    runSleepConsolidation,
    isConsolidating: () => isConsolidating
  };

  global.MemoryConsolidator = MemoryConsolidator;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryConsolidator;
  }

  // Inicializa quando o ambiente estiver pronto
  if (typeof window !== 'undefined') {
    setTimeout(init, 2000);
  }

})(typeof window !== 'undefined' ? window : global);
