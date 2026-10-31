/**
 * ============================================================================
 * MÓDULO: AGENDAMENTO NO GOOGLE AGENDA POR COMANDO DE VOZ (CalendarScheduler)
 * ============================================================================
 * - Injeção de Contexto Temporal (now, dia da semana, data/hora exata e fuso horário).
 * - Extração Estruturada / Tool Calling nativa para o modelo gemini-3.1-flash-lite.
 * - Envio assíncrono via HTTP POST para GOOGLE_CALENDAR_WEBHOOK_URL (Google Apps Script)
 *   com suporte automático a redirecionamentos 302 do Google.
 */
(function () {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;
  const nodeHttps = typeof require !== 'undefined' ? (() => { try { return require('https'); } catch { return null; } })() : null;
  const nodeHttp = typeof require !== 'undefined' ? (() => { try { return require('http'); } catch { return null; } })() : null;

  const ENV_PATHS = [];
  if (nodePath && typeof __dirname !== 'undefined') {
    ENV_PATHS.push(nodePath.join(__dirname, '.env'));
    ENV_PATHS.push(nodePath.join(__dirname, '..', '.env'));
  }

  let ctx = null;
  let cachedWebhookUrl = '';

  function readWebhookUrlFromEnv() {
    if (typeof process !== 'undefined' && process.env && process.env.GOOGLE_CALENDAR_WEBHOOK_URL) {
      return String(process.env.GOOGLE_CALENDAR_WEBHOOK_URL).trim();
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
            const match = trimmed.match(/^GOOGLE_CALENDAR_WEBHOOK_URL\s*=\s*(.*)$/);
            if (match) {
              const rawVal = match[1].trim().replace(/^["']|["']$/g, '');
              if (rawVal) return rawVal;
            }
          }
        }
      } catch (err) {
        console.warn('[CalendarScheduler] Erro ao ler .env:', err.message);
      }
    }
    return '';
  }

  function saveWebhookUrlToEnv(newUrl) {
    const cleanUrl = String(newUrl || '').trim();
    cachedWebhookUrl = cleanUrl;
    if (!nodeFs || ENV_PATHS.length === 0) return;

    const primaryEnvPath = ENV_PATHS[0];
    try {
      let content = '';
      if (nodeFs.existsSync(primaryEnvPath)) {
        content = nodeFs.readFileSync(primaryEnvPath, 'utf8');
      }
      if (/^GOOGLE_CALENDAR_WEBHOOK_URL\s*=/m.test(content)) {
        content = content.replace(
          /^GOOGLE_CALENDAR_WEBHOOK_URL\s*=.*$/m,
          `GOOGLE_CALENDAR_WEBHOOK_URL=${cleanUrl}`
        );
      } else {
        const prefix = content && !content.endsWith('\n') ? '\n' : '';
        content += `${prefix}GOOGLE_CALENDAR_WEBHOOK_URL=${cleanUrl}\n`;
      }
      nodeFs.writeFileSync(primaryEnvPath, content, 'utf8');
    } catch (err) {
      console.warn('[CalendarScheduler] Não foi possível atualizar .env:', err.message);
    }
  }

  function getWebhookUrl() {
    const fromEnv = readWebhookUrlFromEnv();
    if (fromEnv) {
      cachedWebhookUrl = fromEnv;
      return fromEnv;
    }
    if (ctx && ctx.prefs && ctx.prefs.googleCalendarWebhookUrl) {
      return String(ctx.prefs.googleCalendarWebhookUrl).trim();
    }
    return cachedWebhookUrl || '';
  }

  function setWebhookUrl(url) {
    const clean = String(url || '').trim();
    cachedWebhookUrl = clean;
    if (ctx && ctx.prefs) {
      ctx.prefs.googleCalendarWebhookUrl = clean;
    }
    saveWebhookUrlToEnv(clean);
  }

  function formatLocalIso8601(dateObj) {
    const d = dateObj instanceof Date && !isNaN(dateObj.getTime()) ? dateObj : new Date();
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const tzOffset = `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
    const localMs = d.getTime() - d.getTimezoneOffset() * 60000;
    return new Date(localMs).toISOString().slice(0, 19) + tzOffset;
  }

  /**
   * 1. INJEÇÃO DE CONTEXTO TEMPORAL:
   * Retorna data, hora exata, dia da semana e fuso horário local do sistema (now)
   * para que o gemini-3.1-flash-lite converta termos relativos em ISO 8601 exato.
   */
  function buildTemporalContext() {
    const now = new Date();
    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const tzOffset = `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
    const nowIso = formatLocalIso8601(now);

    const diasSemana = [
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
    ];
    const diaSemana = diasSemana[now.getDay()];
    const dataBr = now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const horaBr = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return (
      `\n[CONTEXTO TEMPORAL DO SISTEMA (NOW)]\n` +
      `- Data/Hora exata atual (ISO 8601): ${nowIso}\n` +
      `- Data local: ${dataBr} (${diaSemana})\n` +
      `- Hora local: ${horaBr}\n` +
      `- Fuso horário local: ${tzName} (UTC${tzOffset})\n` +
      `INSTRUÇÃO DE AGENDAMENTO: Sempre que o usuário pedir para marcar, agendar, anotar na agenda ou lembrar de um compromisso/evento/prova/reunião, invoque a ferramenta "schedule_google_calendar" convertendo referências relativas ("amanhã às 15h", "sexta que vem", "daqui a 2 horas") para datas exatas ISO 8601 com o fuso ${tzOffset}. Se o usuário não informar a duração, defina end_time exatamente 1 hora após start_time.\n` +
      `INSTRUÇÃO DE CONSULTA: Sempre que o usuário perguntar o que tem agendado, quais os compromissos dele hoje, amanhã ou em qualquer data ("o que tenho hoje?", "o que tem no meu calendário para amanhã?", "quais meus compromissos de sexta?"), invoque a ferramenta "consultar_google_calendar" definindo time_min e time_max com as datas ISO 8601 correspondentes ao período solicitado (ex: para "hoje", de 00:00:00 até 23:59:59 de hoje com o fuso ${tzOffset}; para "amanhã", de 00:00:00 até 23:59:59 de amanhã).`
    );
  }

  /**
   * 2. EXTRAÇÃO ESTRUTURADA / TOOL CALLING:
   * Declaração de funções oficiais para a API do Gemini (gemini-3.1-flash-lite).
   */
  function getGeminiToolDeclaration() {
    return {
      function_declarations: [
        {
          name: 'schedule_google_calendar',
          description:
            'Agenda um compromisso, evento, prova, reunião ou lembrete no Google Agenda quando o usuário pedir por voz para marcar, agendar ou lembrar de um compromisso.',
          parameters: {
            type: 'OBJECT',
            properties: {
              title: {
                type: 'STRING',
                description: 'Título objetivo do compromisso.',
              },
              start_time: {
                type: 'STRING',
                description: 'Data e hora exatas de início no formato ISO 8601 (ex: 2026-10-30T15:00:00-03:00).',
              },
              end_time: {
                type: 'STRING',
                description:
                  'Data e hora exatas de término no formato ISO 8601 (se o usuário não especificar a duração na fala, defina 1 hora após start_time por padrão).',
              },
              description: {
                type: 'STRING',
                description: 'Detalhes adicionais falados pelo usuário.',
              },
              speech_response: {
                type: 'STRING',
                description:
                  'Frase curta confirmando o agendamento para exibir no balão de fala (ex: "Agendado: Prova de Engenharia sexta às 19h.").',
              },
            },
            required: ['title', 'start_time', 'end_time', 'description', 'speech_response'],
          },
        },
        {
          name: 'consultar_google_calendar',
          description:
            'Consulta compromissos e eventos já agendados no Google Agenda quando o usuário perguntar o que tem para fazer (ex: "o que tenho hoje?", "quais meus compromissos de amanhã?", "o que tem no meu calendário para sexta?").',
          parameters: {
            type: 'OBJECT',
            properties: {
              time_min: {
                type: 'STRING',
                description: 'Início do período em ISO 8601 (ex: hoje às 00:00:00 com fuso local: 2026-10-29T00:00:00-03:00).',
              },
              time_max: {
                type: 'STRING',
                description: 'Fim do período em ISO 8601 (ex: hoje às 23:59:59 com fuso local: 2026-10-29T23:59:59-03:00).',
              },
              query_date_label: {
                type: 'STRING',
                description: 'Rótulo do período mencionado pelo usuário (ex: "hoje", "amanhã", "nesta sexta-feira").',
              },
              speech_response: {
                type: 'STRING',
                description: 'Frase curta introdutória antes de listar os eventos (ex: "Consultando seus compromissos para hoje...").',
              },
            },
            required: ['time_min', 'time_max'],
          },
        },
      ],
    };
  }

  function normalizeSchedulePayload(rawArgs = {}) {
    const title = String(rawArgs.title || 'Compromisso').trim();
    const startStr = String(rawArgs.start_time || '').trim();
    const parsedStart = startStr ? new Date(startStr) : new Date(Date.now() + 3600000);
    const validStart = !isNaN(parsedStart.getTime()) ? parsedStart : new Date(Date.now() + 3600000);

    let validEnd = null;
    if (rawArgs.end_time) {
      const parsedEnd = new Date(String(rawArgs.end_time).trim());
      if (!isNaN(parsedEnd.getTime()) && parsedEnd > validStart) {
        validEnd = parsedEnd;
      }
    }
    if (!validEnd) {
      validEnd = new Date(validStart.getTime() + 60 * 60 * 1000); // Padrão: +1 hora
    }

    const start_time = startStr && !isNaN(parsedStart.getTime()) ? startStr : formatLocalIso8601(validStart);
    const end_time =
      rawArgs.end_time && !isNaN(new Date(String(rawArgs.end_time).trim()).getTime()) && new Date(String(rawArgs.end_time).trim()) > validStart
        ? String(rawArgs.end_time).trim()
        : formatLocalIso8601(validEnd);

    const description = String(rawArgs.description || '').trim();
    const speech_response =
      String(rawArgs.speech_response || '').trim() || `Agendado: ${title}.`;

    return {
      title,
      start_time,
      end_time,
      description,
      speech_response,
    };
  }

  /**
   * 3. CONEXÃO SIMPLIFICADA VIA WEBHOOK (GOOGLE APPS SCRIPT):
   * Envia o JSON via HTTP POST assíncrono para GOOGLE_CALENDAR_WEBHOOK_URL,
   * seguindo redirecionamentos HTTP 302 do Google Apps Script sem travar a UI.
   */
  function postToWebhookUrl(targetUrl, jsonString, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        return reject(new Error('Limite de redirecionamentos atingido no Webhook.'));
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        return reject(new Error('GOOGLE_CALENDAR_WEBHOOK_URL inválida.'));
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? nodeHttps : nodeHttp;
      if (!transport) {
        // Fallback para fetch do navegador caso Node transport não esteja disponível
        fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonString,
        })
          .then((r) => r.text())
          .then((txt) => {
            try { resolve(JSON.parse(txt)); } catch { resolve({ ok: true, raw: txt }); }
          })
          .catch(reject);
        return;
      }

      const isRedirectGet = redirectCount > 0;
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: isRedirectGet ? 'GET' : 'POST',
        headers: isRedirectGet
          ? { Accept: 'application/json' }
          : {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': Buffer.byteLength(jsonString, 'utf8'),
              Accept: 'application/json',
            },
      };

      const req = transport.request(reqOptions, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers && (res.headers.location || res.headers.Location);

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          const nextUrl = new URL(location, parsedUrl).toString();
          postToWebhookUrl(nextUrl, jsonString, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (responseBody.length < 8192) responseBody += chunk;
        });
        res.on('end', () => {
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(responseBody));
            } catch {
              resolve({ ok: true, raw: responseBody });
            }
          } else {
            reject(new Error(`Webhook HTTP ${status}: ${responseBody.slice(0, 180)}`));
          }
        });
      });

      req.setTimeout(15000, () => {
        req.destroy(new Error('Timeout ao conectar ao Google Calendar Webhook'));
      });
      req.on('error', (err) => reject(err));

      if (!isRedirectGet) {
        req.write(jsonString);
      }
      req.end();
    });
  }

  async function processScheduleCall(rawArgs) {
    const payload = normalizeSchedulePayload(rawArgs);
    const webhookUrl = getWebhookUrl();

    console.log('[CalendarScheduler] Intenção de agendamento extraída:', JSON.stringify(payload));

    if (ctx) {
      if (typeof ctx.setEmotion === 'function') ctx.setEmotion('HAPPY', 6000);
      if (ctx.CuteSynth && typeof ctx.CuteSynth.excited === 'function') ctx.CuteSynth.excited();
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('📅', 0, 8);
      if (typeof ctx.showActionBadge === 'function') ctx.showActionBadge('📅', 'Agendando no Google Agenda...', 3200);
    }

    if (!webhookUrl) {
      console.warn('[CalendarScheduler] GOOGLE_CALENDAR_WEBHOOK_URL ainda não configurada no .env/config.');
      if (ctx && typeof ctx.showBubble === 'function') {
        ctx.showBubble(
          'Google Agenda 📅 (Sem URL)',
          `${payload.speech_response}\n⚠️ Configure GOOGLE_CALENDAR_WEBHOOK_URL no .env ou na aba Cérebro para gravar na sua agenda.`,
          7500,
          false,
          true
        );
      }
      return { ok: false, reason: 'missing_webhook_url', payload };
    }

    // NOVO: Hipocampo em Tempo Real (Parte 1 da Arquitetura Cognitiva)
    const hippoCal = (typeof window !== 'undefined' && window.HippocampusLogger) || (typeof global !== 'undefined' && global.HippocampusLogger);
    if (hippoCal && typeof hippoCal.recordDailyEvent === 'function') {
      try {
        hippoCal.recordDailyEvent({
          categoria: 'AGENDA_KEEP',
          emocao: 'EXCITED',
          titulo: `Compromisso na Google Agenda: ${payload.title}`,
          detalhes: `Início: ${payload.start_time} | Fim: ${payload.end_time}. ${payload.description || ''}`,
          links: [payload.title],
          appAtivo: 'Google Calendar'
        }).catch(() => {});

        hippoCal.recordKnowledgeOrMemory({
          tipo: 'memoria',
          titulo: `Agenda - ${payload.title}`,
          conteudo: `### Compromisso Agendado\n- **Título:** ${payload.title}\n- **Início:** ${payload.start_time}\n- **Fim:** ${payload.end_time}\n- **Descrição:** ${payload.description || 'Sem descrição'}\n- **Criado em:** ${new Date().toISOString()}`,
          categoria: 'Compromissos',
          resumo_curto: `Compromisso agendado: ${payload.title} em ${payload.start_time}`,
          tags: ['agenda', 'compromisso', 'rotina'],
          links: []
        }).catch(() => {});
      } catch (hErr) {
        console.warn('[CalendarScheduler] Erro ao notificar Hipocampo:', hErr);
      }
    }

    // Dispara POST assíncrono sem bloquear a thread de áudio/animação
    postToWebhookUrl(webhookUrl, JSON.stringify(payload))
      .then((res) => {
        console.log('[CalendarScheduler] Evento registrado no Google Agenda com sucesso:', JSON.stringify(res));
        if (ctx && typeof ctx.spawnParticle === 'function') {
          ctx.spawnParticle('✅', 18, 6);
        }
      })
      .catch((err) => {
        console.error('[CalendarScheduler] Falha ao enviar para o Webhook:', err.message || err);
        if (ctx && typeof ctx.showBubble === 'function') {
          ctx.showBubble(
            'Google Agenda ⚠️',
            `Extraí "${payload.title}", mas houve erro no Webhook: ${err.message}`,
            6500,
            false,
            true
          );
        }
      });

    return { ok: true, payload };
  }

  async function processQueryCall(rawArgs = {}) {
    const webhookUrl = getWebhookUrl();
    const queryDateLabel = String(rawArgs.query_date_label || 'hoje').trim();
    const timeMin = String(rawArgs.time_min || new Date().toISOString()).trim();
    const timeMax = String(rawArgs.time_max || new Date(Date.now() + 86400000).toISOString()).trim();

    console.log('[CalendarScheduler] Consulta de agenda:', { timeMin, timeMax, queryDateLabel });

    if (ctx) {
      if (typeof ctx.setEmotion === 'function') ctx.setEmotion('CURIOUS', 4000);
      if (ctx.CuteSynth && typeof ctx.CuteSynth.curious === 'function') ctx.CuteSynth.curious();
      if (typeof ctx.spawnParticle === 'function') ctx.spawnParticle('📅', 0, 8);
      if (typeof ctx.showActionBadge === 'function') ctx.showActionBadge('📅', 'Consultando Google Agenda...', 3200);
    }

    if (!webhookUrl) {
      const msg = 'Configure a URL do Webhook do Google Agenda no .env ou nas configurações para eu poder consultar sua agenda.';
      if (ctx && typeof ctx.showBubble === 'function') {
        ctx.showBubble('Google Agenda 📅', msg, 6000, false, true);
      }
      return { ok: false, speech_response: msg };
    }

    try {
      const payload = {
        action: 'read_calendar',
        time_min: timeMin,
        time_max: timeMax,
        query_date_label: queryDateLabel,
      };

      const resText = await postToWebhookUrl(webhookUrl, JSON.stringify(payload));
      let res;
      try {
        res = typeof resText === 'string' ? JSON.parse(resText) : resText;
      } catch {
        res = { events: [] };
      }

      const events = Array.isArray(res?.events) ? res.events : [];
      let speechResponse = '';

      if (events.length === 0) {
        speechResponse = `Você não tem nenhum compromisso agendado para ${queryDateLabel} no seu Google Agenda.`;
        if (ctx && typeof ctx.showBubble === 'function') {
          ctx.showBubble('Google Agenda 📅', `Nenhum compromisso marcado para ${queryDateLabel}. Dia livre!`, 5500, false, true);
        }
      } else if (events.length === 1) {
        const ev = events[0];
        speechResponse = `Para ${queryDateLabel}, você tem 1 compromisso no Google Agenda: ${ev.title} (${ev.time_label}).`;
        if (ctx && typeof ctx.showBubble === 'function') {
          ctx.showBubble('Google Agenda 📅', `📌 ${ev.title}\n⏰ ${ev.time_label}`, 6500, false, true);
        }
      } else {
        const summary = events.map((ev, i) => `${i + 1}. ${ev.title} (${ev.time_label})`).join(', ');
        speechResponse = `Para ${queryDateLabel}, você tem ${events.length} compromissos no Google Agenda: ${summary}.`;
        if (ctx && typeof ctx.showBubble === 'function') {
          const body = events.map((ev) => `• ${ev.title} (${ev.time_label})`).join('\n');
          ctx.showBubble('Google Agenda 📅', `Compromissos para ${queryDateLabel}:\n${body}`, 7500, false, true);
        }
      }

      if (ctx && typeof ctx.CuteSynth?.happy === 'function') ctx.CuteSynth.happy();
      return { ok: true, events, speech_response: speechResponse };
    } catch (err) {
      console.warn('[CalendarScheduler] Erro ao consultar Webhook:', err.message);
      const errMsg = `Tive uma dificuldade para consultar seu Google Agenda agora (${err.message}).`;
      if (ctx && typeof ctx.showBubble === 'function') {
        ctx.showBubble('Google Agenda ⚠️', errMsg, 6000, false, true);
      }
      return { ok: false, speech_response: errMsg };
    }
  }

  function cleanScheduleTitle(text) {
    let s = String(text || '').trim();
    // Remove invocação inicial e comandos
    s = s.replace(/^(?:bitbop|bit\s*bop|bop|por\s+favor|ei|ol[aá]|oi)[,\s]*/i, '');
    s = s.replace(/^(?:coloca|coloque|marca|marque|bote|bota|agenda|agende|adiciona|adicione|anota|anote|salva|salve|cria|crie|lembra|lembre)\s*(?:a[ií])?\s*(?:pra\s+mim|para\s+mim)?\s*(?:um\s+compromisso\s+|uma\s+reuni[aã]o\s+|um\s+evento\s+|um\s+lembrete\s+)?(?:na\s+|no\s+)?(?:meu\s+|minha\s+)?(?:google\s+)?(?:agenda|calend[aá]rio)\s*/i, '');
    s = s.replace(/^(?:agenda|agende|marca|marque|anota|anote)\s+(?:pra\s+mim|para\s+mim)\s*/i, '');
    
    // Remove termos temporais repetidos no corpo (sem \b para suportar acentos UTF-8)
    s = s.replace(/(?:^|\s)(?:depois\s+de\s+amanh[aã]|amanh[aã]|hoje|daqui\s+a\s+[\wÀ-ÿ]+\s+(?:dias?|horas?))(?=\s|$|[.,!])/gi, ' ');
    s = s.replace(/(?:^|\s)(?:n?este\s+|n?esta\s+|pr[oó]xim[oa]\s+)?(?:segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?(?:\s+que\s+vem)?(?=\s|$|[.,!])/gi, ' ');
    s = s.replace(/(?:^|\s)(?:[aà]s|as)\s+\d{1,2}(?:[h:](?:(\d{2})|horas?)?)?(?=\s|$|[.,!])/gi, ' ');
    
    // Remove verbos e conectivos introdutórios
    s = s.replace(/^\s*(?:que\s+|pra\s+|para\s+)?(?:eu\s+)?(?:preciso|tenho\s+que|vou)\s+/i, '');
    s = s.replace(/^\s*(?:que|pra|para|de|com)\s+/i, '');
    
    // Limpa espaços duplos e pontuação
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^[,\-–—.:;]+\s*/, '').trim();

    if (s.length > 0) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return 'Compromisso agendado por voz';
  }

  function parseScheduleDirectFromText(userText, assistantText = '') {
    const clean = String(userText || '').trim();
    const now = new Date();
    
    let targetDate = new Date(now.getTime());
    let targetHour = 9;
    let targetMin = 0;
    let durationMinutes = 60;
    
    // 1. Extração de Dias Relativos e Semanas
    const relDaysMatch = clean.match(/(?:^|\s)daqui\s+a\s+(\d+|um|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+dias?/i);
    const relHoursMatch = clean.match(/(?:^|\s)daqui\s+a\s+(\d+|uma?|duas?|tr[eê]s|quatro|cinco)\s+horas?/i);
    
    if (relDaysMatch) {
      const wordMap = { 'um': 1, 'dois': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10 };
      const days = parseInt(relDaysMatch[1], 10) || wordMap[relDaysMatch[1].toLowerCase()] || 1;
      targetDate.setDate(targetDate.getDate() + days);
    } else if (relHoursMatch) {
      const wordMap = { 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5 };
      const hrs = parseInt(relHoursMatch[1], 10) || wordMap[relHoursMatch[1].toLowerCase()] || 1;
      targetDate.setHours(targetDate.getHours() + hrs);
      targetHour = targetDate.getHours();
      targetMin = targetDate.getMinutes();
    } else if (/depois\s+de\s+amanh[aã]/i.test(clean)) {
      targetDate.setDate(targetDate.getDate() + 2);
    } else if (/amanh[aã]/i.test(clean)) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (/(?:^|\s)hoje(?:\s|$|[.,!])/i.test(clean)) {
      targetHour = Math.min(23, now.getHours() + 1);
    } else {
      // Dias da semana
      const diasSemana = [
        { regex: /domingo/i, day: 0 },
        { regex: /segunda(?:-feira)?/i, day: 1 },
        { regex: /ter[cç]a(?:-feira)?/i, day: 2 },
        { regex: /quarta(?:-feira)?/i, day: 3 },
        { regex: /quinta(?:-feira)?/i, day: 4 },
        { regex: /sexta(?:-feira)?/i, day: 5 },
        { regex: /s[aá]bado/i, day: 6 }
      ];
      for (const d of diasSemana) {
        if (d.regex.test(clean)) {
          let diff = (d.day - now.getDay() + 7) % 7;
          if (diff === 0) diff = 7; // Próxima semana se for hoje
          targetDate.setDate(targetDate.getDate() + diff);
          break;
        }
      }
    }

    // 2. Extração de Hora
    const hourMatch = clean.match(/(?:^|\s)(?:[aà]s|as)\s+(\d{1,2})(?:[h:](?:(\d{2})|horas?)?)?/i);
    if (hourMatch) {
      targetHour = parseInt(hourMatch[1], 10);
      targetMin = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;
    }

    targetDate.setHours(targetHour, targetMin, 0, 0);

    // 3. Extração e Limpeza do Título
    let title = cleanScheduleTitle(clean);

    if (assistantText && title.length < 8) {
      const assistMatch = assistantText.match(/(?:falar\s+com\s+[^.,]+|reuni[aã]o\s+[^.,]+|prova\s+[^.,]+)/i);
      if (assistMatch) {
        title = assistMatch[0].trim();
      }
    }

    const offsetMin = -targetDate.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const tzOffset = sign + pad(offsetMin / 60) + ':' + pad(offsetMin % 60);
    const localMs = targetDate.getTime() - targetDate.getTimezoneOffset() * 60000;
    const start_time = new Date(localMs).toISOString().slice(0, 19) + tzOffset;
    
    const endDate = new Date(targetDate.getTime() + durationMinutes * 60 * 1000);
    const endLocalMs = endDate.getTime() - endDate.getTimezoneOffset() * 60000;
    const end_time = new Date(endLocalMs).toISOString().slice(0, 19) + tzOffset;

    return {
      title,
      start_time,
      end_time,
      description: `Agendado via voz pelo BitBop: "${clean}"`,
      speech_response: `Agendado no seu Google Agenda: ${title} para o dia ${targetDate.toLocaleDateString('pt-BR')}.`
    };
  }

  function parseQueryDirectFromText(userText) {
    const clean = String(userText || '').trim();
    const now = new Date();
    let targetDate = new Date(now.getTime());
    let label = 'hoje';

    if (/amanh[aã]/i.test(clean)) {
      targetDate.setDate(targetDate.getDate() + 1);
      label = 'amanhã';
    } else if (/depois\s+de\s+amanh[aã]/i.test(clean)) {
      targetDate.setDate(targetDate.getDate() + 2);
      label = 'depois de amanhã';
    } else {
      const diasSemana = [
        { regex: /domingo/i, day: 0, name: 'domingo' },
        { regex: /segunda(?:-feira)?/i, day: 1, name: 'segunda-feira' },
        { regex: /ter[cç]a(?:-feira)?/i, day: 2, name: 'terça-feira' },
        { regex: /quarta(?:-feira)?/i, day: 3, name: 'quarta-feira' },
        { regex: /quinta(?:-feira)?/i, day: 4, name: 'quinta-feira' },
        { regex: /sexta(?:-feira)?/i, day: 5, name: 'sexta-feira' },
        { regex: /s[aá]bado/i, day: 6, name: 'sábado' }
      ];
      for (const d of diasSemana) {
        if (d.regex.test(clean)) {
          let diff = (d.day - now.getDay() + 7) % 7;
          if (diff === 0 && !/hoje/i.test(clean)) diff = 7;
          targetDate.setDate(targetDate.getDate() + diff);
          label = d.name;
          break;
        }
      }
    }

    const offsetMin = -targetDate.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const tzOffset = sign + pad(offsetMin / 60) + ':' + pad(offsetMin % 60);

    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

    const startMs = startOfDay.getTime() - startOfDay.getTimezoneOffset() * 60000;
    const endMs = endOfDay.getTime() - endOfDay.getTimezoneOffset() * 60000;

    return {
      time_min: new Date(startMs).toISOString().slice(0, 19) + tzOffset,
      time_max: new Date(endMs).toISOString().slice(0, 19) + tzOffset,
      query_date_label: label,
      speech_response: `Consultando seus compromissos para ${label}...`
    };
  }

  const CalendarScheduler = {
    init(petContext) {
      ctx = petContext;
      const envUrl = readWebhookUrlFromEnv();
      if (envUrl) {
        cachedWebhookUrl = envUrl;
        if (ctx && ctx.prefs) {
          ctx.prefs.googleCalendarWebhookUrl = envUrl;
        }
      } else if (ctx && ctx.prefs && ctx.prefs.googleCalendarWebhookUrl) {
        cachedWebhookUrl = ctx.prefs.googleCalendarWebhookUrl;
      }
      console.log(
        `[CalendarScheduler] Inicializado. Webhook configurado: ${ cachedWebhookUrl ? 'SIM' : 'NÃO (aguardando GOOGLE_CALENDAR_WEBHOOK_URL)' }`
      );
    },
    getWebhookUrl,
    setWebhookUrl,
    buildTemporalContext,
    getGeminiToolDeclaration,
    normalizeSchedulePayload,
    processScheduleCall,
    processQueryCall,
    cleanScheduleTitle,
    parseScheduleDirectFromText,
    parseQueryDirectFromText,
  };

  if (typeof window !== 'undefined') {
    window.CalendarScheduler = CalendarScheduler;
  }
  if (typeof global !== 'undefined') {
    global.CalendarScheduler = CalendarScheduler;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalendarScheduler;
  }
})();
