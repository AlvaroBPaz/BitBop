    // =========================================================================
    // 10. CÉREBRO MULTIMODAL MULTI-TELAS + COMENTÁRIOS PROATIVOS DE PROXIMIDADE
    // =========================================================================
    const TAG_TO_EMOTION = {
      FELIZ: 'HAPPY',
      EMPOLGADO: 'EXCITED',
      AMOR: 'LOVE',
      CURIOSO: 'CURIOUS',
      TRISTE: 'SAD',
      BRAVO: 'ANGRY',
      SURPRESO: 'SURPRISED',
      RISO: 'LAUGHING',
      ESTILOSO: 'COOL',
      MORTO: 'DEAD',
    };

    const EMOTION_TAG_RX = /\[(FELIZ|EMPOLGADO|AMOR|CURIOSO|TRISTE|BRAVO|SURPRESO|RISO|ESTILOSO|MORTO)\]/i;
    const ACTION_TAG_RX = /\[ACAO:\s*([A-Z0-9_]+)\]/i;
    const EXPLICIT_VISUAL_INSPECT_RX = /\b(vendo|vê\b|veja|olha|olhe|o que (?:tem|há|está)|mostrando|escrito|leia|ler\b|analisa|aparecendo)\b/i;

    const VISION_TRIGGER_RX = /telas?|monitores?|segunda tela|outra tela|outro monitor|esquerd[ao]|direit[ao]|aqui do lado|área de trabalho|area de trabalho|desktop|vendo|vê\b|veja|olha|olhe|aberto|aberta|janelas?|programas?|aplicativos?|fazendo na tela|fazendo no pc|escrito|aparecendo|mostrando|assistindo|jogando|meu pc|computador|aqui na frente|leia|ler\b|código|codigo|erro|vídeo|video|site|página|pagina|aba\b|navegador|documento|arquivo|essa janela|isso aqui|perto de você|aí perto/i;
    const STUDY_VISION_TRIGGER_RX = /\b(telas?|monitores?|desktop|vendo|v[eê]\b|veja|olha|olhe|mostrando|escrito|leia|ler\b|analis[ae]|aparecendo|c[oó]digo|slide|quest[aã]o|exerc[ií]cio|problema|diagrama|f[oó]rmula|formula|janela|aba|pdf|documento|imagem|aqui|isso|nessa|nesse|resolve|explic[ae]|resumo|resumir|keep|notas?|anot[ae]|salva)\b/i;

    // DIRETRIZ FUNDAMENTAL DE IDENTIDADE E SEPARAÇÃO DE LOCUTORES
    const OWNER_IDENTITY_DIRECTIVE = `[IDENTIDADE CRÍTICA DO USUÁRIO & REGRAS DE CONVIVÊNCIA]
1. O seu criador, usuário e parceiro oficial é ÚNICA E EXCLUSIVAMENTE o ÁLVARO (Álvaro Matheus).
2. Você SEMPRE está conversando diretamente com o Álvaro. Trate-o com carinho, cumplicidade e amizade.
3. Amigos, colegas de Discord e parceiros de jogos (como Nailton, Arthur, Moreno, etc.) são TERCEIROS que jogam ou conversam com o Álvaro.
4. NUNCA chame o usuário de Nailton ou pelo nome de amigos dele!
5. Se o Álvaro mencionar Nailton ou outros amigos no chat/jogo, ou se você ouvir amigos em chamadas, NUNCA trate o Álvaro como se fosse uma pessoa nova ou desconhecida! Você conhece o Álvaro profundamente!
6. RECONHECIMENTO E CALIBRAÇÃO VOCAL: O BitBop possui calibração e biometria vocal integradas em tempo real via microfone (CAM++). NUNCA peça para o usuário "enviar um arquivo de áudio", "mandar um áudio" ou "anexar uma gravação"! Se o usuário falar sobre calibrar ou gravar a voz, responda com [FELIZ] e acione ou oriente o usuário a falar diretamente no microfone!`;


    function detectFallbackSentiment(text) {
      if (/haha|hehe|kkk|engraçad/i.test(text)) return 'LAUGHING';
      if (/amo|carinho|fofo|adoro|coração/i.test(text)) return 'LOVE';
      if (/incrível|eba|uhu|demais|uau|legal/i.test(text)) return 'EXCITED';
      if (/pena|triste|sinto muito|infelizmente|poxa/i.test(text)) return 'SAD';
      if (/vejo|parece|olhando|aberta|janela/i.test(text)) return 'CURIOUS';
      return 'HAPPY';
    }

    // Pool TLS 1.3 Persistente para eliminar ~400ms de handshake SSL a cada fala!
    const geminiAgent = nodeHttps
      ? new nodeHttps.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4 })
      : null;

    const brainGroqAgent = nodeHttps
      ? new nodeHttps.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4 })
      : null;

    let geminiWarmLoggedOnce = false;

    function warmUpGeminiConnection() {
      if (!nodeHttps || prefs.aiProvider !== 'gemini') return;
      const apiKey = (prefs.geminiApiKey || '').trim();
      if (!apiKey) {
        geminiStatusBadge.textContent = '⚠ Insira a chave API';
        geminiStatusBadge.style.color = '#fbbf24';
        return;
      }
      const model = getEffectiveGeminiModel();
      const req = nodeHttps.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`,
          method: 'GET',
          agent: geminiAgent,
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            geminiStatusBadge.textContent = '● Conectado (TLS ativo)';
            geminiStatusBadge.style.color = '#34d399';
            if (!geminiWarmLoggedOnce) {
              geminiWarmLoggedOnce = true;
              console.log(`[GEMINI] Socket TLS Keep-Alive aquecido com sucesso (${model}, HTTP ${res.statusCode})`);
            }
          } else {
            geminiStatusBadge.textContent = `⚠ HTTP ${res.statusCode}`;
            geminiStatusBadge.style.color = '#f87171';
            console.warn(`[GEMINI] Warmup retornou HTTP ${res.statusCode} para modelo ${model}`);
          }
        }
      );
      req.setTimeout(6000, () => req.destroy());
      req.on('error', (err) => {
        geminiStatusBadge.textContent = '⚠ Sem rede (usando local)';
        geminiStatusBadge.style.color = '#fbbf24';
        console.warn('[GEMINI] Warmup offline:', err.message);
      });
      req.end();
    }

    // Aquece o túnel TLS imediatamente e mantém vivo a cada 25 segundos
    warmUpGeminiConnection();
    setInterval(warmUpGeminiConnection, 25000);

    // =========================================================================
    // DISJUNTOR DE COTA MULTI-TIER (3.1 -> 3.5 -> GROQ -> OLLAMA)
    // =========================================================================
    let gemini31CooldownUntil = 0;
    let gemini35CooldownUntil = 0;

    function markGemini31QuotaExceeded(durationMs = 180000) {
      gemini31CooldownUntil = Date.now() + durationMs;
      console.warn(`[CIRCUIT-BREAKER] Gemini 3.1 Flash-Lite cota excedida (429). Cooldown de ${Math.round(durationMs / 1000)}s ativado.`);
    }

    function markGemini35QuotaExceeded(durationMs = 90000) {
      gemini35CooldownUntil = Date.now() + durationMs;
      console.warn(`[CIRCUIT-BREAKER] Gemini 3.5 Flash-Lite cota excedida (429). Cooldown de ${Math.round(durationMs / 1000)}s ativado.`);
    }

    function isGemini31Locked() {
      return Date.now() < gemini31CooldownUntil;
    }

    function isGemini35Locked() {
      return Date.now() < gemini35CooldownUntil;
    }

    function isAllGeminiLocked() {
      return isGemini31Locked() && isGemini35Locked();
    }

    window.markGemini31QuotaExceeded = markGemini31QuotaExceeded;
    window.markGemini35QuotaExceeded = markGemini35QuotaExceeded;
    window.isGemini31Locked = isGemini31Locked;
    window.isGemini35Locked = isGemini35Locked;
    window.isAllGeminiLocked = isAllGeminiLocked;
    // Retrocompatibilidade
    window.isGeminiQuotaLocked = isAllGeminiLocked;
    window.markGeminiQuotaExceeded = markGemini31QuotaExceeded;

    function buildFullSystemPrompt(messagesPayload = [], extraSystemRule = '') {
      let prompt = OWNER_IDENTITY_DIRECTIVE;
      if (Array.isArray(messagesPayload)) {
        for (let i = 0; i < messagesPayload.length; i++) {
          const m = messagesPayload[i];
          if (m && m.role === 'system' && m.content) {
            prompt += (prompt ? '\n\n' : '') + m.content;
          }
        }
      }
      
      return prompt;
    }

    function streamGeminiRequest(messagesPayload, mediaOpts, onToken) {
      const apiKey = (prefs.geminiApiKey || '').trim();
      const opts = (mediaOpts && typeof mediaOpts === 'object') ? mediaOpts : { screenshotBase64: mediaOpts };
      const model = opts.overrideModel || getEffectiveGeminiModel();
      if (!nodeHttps || !apiKey) {
        return Promise.reject(new Error('Chave de API Gemini ausente'));
      }

      const screenshotBase64 = opts.screenshotBase64 || null;
      const imagesList = Array.isArray(opts.images) && opts.images.length > 0
        ? opts.images.filter((it) => it && it.base64Jpeg)
        : (screenshotBase64 ? [{ label: '', base64Jpeg: screenshotBase64 }] : []);
      const audioWavBase64 = opts.audioWavBase64 || null;
      const extraSystemRule = opts.extraSystemRule || '';
      const isStudy = Boolean(state.studyMode);
      const maxTokens = opts.maxOutputTokens || (isStudy ? 480 : (audioWavBase64 ? 220 : 180));

      let systemPrompt = buildFullSystemPrompt(messagesPayload, extraSystemRule);
      const contents = [];

      for (let i = 0; i < messagesPayload.length; i++) {
        const m = messagesPayload[i];
        if (m.role === 'system') {
          continue;
        }
        const geminiRole = m.role === 'assistant' ? 'model' : 'user';
        const isLastMessage = i === messagesPayload.length - 1;
        const parts = [];

        if (isLastMessage && geminiRole === 'user') {
          if (audioWavBase64) {
            parts.push({
              inline_data: {
                mime_type: 'audio/wav',
                data: audioWavBase64,
              },
            });
          }
          for (const img of imagesList) {
            if (img.label) {
              parts.push({ text: `[Imagem capturada - ${img.label}]:` });
            }
            parts.push({
              inline_data: {
                mime_type: 'image/jpeg',
                data: img.base64Jpeg,
              },
            });
          }
          if (opts.pdfBase64) {
            parts.push({
              inline_data: {
                mime_type: 'application/pdf',
                data: opts.pdfBase64,
              },
            });
          }
        }
        parts.push({ text: m.content || ' ' });

        if (contents.length > 0 && contents[contents.length - 1].role === geminiRole) {
          contents[contents.length - 1].parts.push(...parts);
        } else {
          contents.push({ role: geminiRole, parts });
        }
      }

      if (extraSystemRule) {
        systemPrompt += (systemPrompt ? '\n\n' : '') + extraSystemRule;
      }

      // Injeção de Contexto do Núcleo da Memória Obsidian (00_Nucleo/* + Data/Hora)
      if (window.MemoryStore && typeof window.MemoryStore.buildCoreContext === 'function') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + window.MemoryStore.buildCoreContext();
      }

      // Fast-Path: Injeção de Memórias Relevantes do Obsidian (< 30ms)
      if (window.MemoryRetriever && typeof window.MemoryRetriever.buildFastPathBlock === 'function') {
        let lastUserText = '';
        for (let idx = messagesPayload.length - 1; idx >= 0; idx--) {
          if (messagesPayload[idx].role === 'user' && messagesPayload[idx].content) {
            lastUserText = messagesPayload[idx].content;
            break;
          }
        }
        if (lastUserText) {
          const fastPathBlock = window.MemoryRetriever.buildFastPathBlock(
            lastUserText,
            (window.state && window.state.desktop && window.state.desktop.activeTitle) || '',
            Boolean(window.state && window.state.studyMode)
          );
          if (fastPathBlock) {
            systemPrompt += (systemPrompt ? '\n\n' : '') + fastPathBlock;
            systemPrompt += '\n\n[REGRA DE OURO - MEMÓRIAS DO OBSIDIAN]: As notas e preferências no bloco [MEMÓRIAS RELEVANTES DO OBSIDIAN] representam o conhecimento canônico mais recente do usuário (incluindo edições manuais no Obsidian). Elas têm PRIORIDADE ABSOLUTA sobre qualquer fala antiga da conversa atual. Se houver discrepância entre mensagens antigas do chat e o bloco do Obsidian, baseie sua resposta 100% no bloco do Obsidian!';
          }
        }
      }

      // Injeção obrigatória de Contexto Temporal (now, dia da semana e fuso horário local)
      if (window.CalendarScheduler && typeof window.CalendarScheduler.buildTemporalContext === 'function') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + window.CalendarScheduler.buildTemporalContext();
      }
      // Injeção de Contexto do Google Keep (Memória e Cache Local de Notas)
      if (window.GoogleKeepService && typeof window.GoogleKeepService.buildKeepContext === 'function') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + window.GoogleKeepService.buildKeepContext();
      }

      const generationConfig = {
        temperature: isStudy ? 0.35 : 0.72,
        maxOutputTokens: maxTokens,
      };
      // Desativa atraso de pensamento dinâmico no Gemini 3.1 Flash-Lite para manter ~960ms constantes!
      if (model.startsWith('gemini-3.1')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const payloadObj = {
        contents,
        generationConfig,
      };
      if (systemPrompt) {
        payloadObj.system_instruction = { parts: [{ text: systemPrompt }] };
      }
      if (opts.enableTools !== false) {
        const allToolDeclarations = [];
        if (window.CalendarScheduler && typeof window.CalendarScheduler.getGeminiToolDeclaration === 'function') {
          const calDecl = window.CalendarScheduler.getGeminiToolDeclaration();
          if (calDecl && Array.isArray(calDecl.function_declarations)) {
            allToolDeclarations.push(...calDecl.function_declarations);
          }
        }
        if (window.GoogleKeepService && typeof window.GoogleKeepService.getGeminiToolDeclarations === 'function') {
          const keepDecls = window.GoogleKeepService.getGeminiToolDeclarations();
          if (Array.isArray(keepDecls)) {
            allToolDeclarations.push(...keepDecls);
          }
        }
        if (window.MemoryTools && typeof window.MemoryTools.getGeminiToolDeclarations === 'function') {
          const memDecls = window.MemoryTools.getGeminiToolDeclarations();
          if (Array.isArray(memDecls)) {
            allToolDeclarations.push(...memDecls);
          }
        }
        if (window.PersonalityTools && typeof window.PersonalityTools.getGeminiToolDeclarations === 'function') {
          const persDecls = window.PersonalityTools.getGeminiToolDeclarations();
          if (Array.isArray(persDecls)) {
            allToolDeclarations.push(...persDecls);
          }
        }
        if (allToolDeclarations.length > 0) {
          payloadObj.tools = [{ function_declarations: allToolDeclarations }];
          if (opts.toolConfig) {
            payloadObj.tool_config = opts.toolConfig;
          } else if (opts.forceFunctionName) {
            payloadObj.tool_config = {
              function_calling_config: {
                mode: 'ANY',
                allowed_function_names: Array.isArray(opts.forceFunctionName)
                  ? opts.forceFunctionName
                  : [opts.forceFunctionName],
              },
            };
          }
        }
      }

      const bodyStr = JSON.stringify(payloadObj);

      return new Promise((resolve, reject) => {
        const req = nodeHttps.request(
          {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
            method: 'POST',
            agent: geminiAgent,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
            },
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              let errBody = '';
              res.setEncoding('utf8');
              res.on('data', (c) => { if (errBody.length < 600) errBody += c; });
              res.on('end', () => {
                clearAbort();
                reject(new Error(`Gemini HTTP ${res.statusCode}: ${errBody.slice(0, 180)}`));
              });
              return;
            }

            res.setEncoding('utf8');
            let lineBuffer = '';

            const parseSseLine = (rawLine) => {
              const trimmed = rawLine.trim();
              if (!trimmed.startsWith('data:')) return;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') return;
              try {
                const parsed = JSON.parse(jsonStr);
                const parts = parsed?.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                  if (part && part.functionCall && typeof opts.onFunctionCall === 'function') {
                    opts.onFunctionCall(part.functionCall);
                  }
                  if (part && !part.thought && typeof part.text === 'string' && part.text.length > 0) {
                    onToken(part.text);
                  }
                }
              } catch {}
            };

            res.on('data', (chunk) => {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                if (firstTokenTimer) {
                  clearTimeout(firstTokenTimer);
                  firstTokenTimer = null;
                }
              }
              lineBuffer += chunk;
              const lines = lineBuffer.split(/\r?\n/);
              lineBuffer = lines.pop() || '';
              for (const line of lines) parseSseLine(line);
            });
            res.on('end', () => {
              clearAbort();
              if (lineBuffer.trim()) parseSseLine(lineBuffer);
              resolve();
            });
            res.on('error', (e) => {
              clearAbort();
              reject(e);
            });
          }
        );

        const abortFn = () => { try { req.destroy(); } catch {} };
        activeStreamAbort = abortFn;

        let firstTokenReceived = false;
        const maxFirstTokenMs = (imagesList.length > 0 || isStudy) ? 6000 : 3500;
        let firstTokenTimer = setTimeout(() => {
          if (!firstTokenReceived) {
            req.destroy(new Error(`Gemini timeout (sem resposta em ${maxFirstTokenMs}ms)`));
          }
        }, maxFirstTokenMs);

        const clearAbort = () => {
          if (firstTokenTimer) { clearTimeout(firstTokenTimer); firstTokenTimer = null; }
          if (activeStreamAbort === abortFn) activeStreamAbort = null;
        };

        req.setTimeout(18000, () => req.destroy(new Error('Gemini streaming timeout')));
        req.on('error', (e) => {
          clearAbort();
          reject(e);
        });
        req.write(bodyStr);
        req.end();
      });
    }

    function streamOllamaRequest(payloadObj, onToken) {
      const bodyStr = JSON.stringify(payloadObj);

      return new Promise((resolve, reject) => {
        const req = nodeHttp.request(
          {
            hostname: '127.0.0.1',
            port: 11434,
            path: '/api/chat',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
            },
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              clearAbort();
              res.resume();
              reject(new Error(`Ollama HTTP ${res.statusCode}`));
              return;
            }
            res.setEncoding('utf8');
            let lineBuffer = '';
            res.on('data', (chunk) => {
              lineBuffer += chunk;
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const part = JSON.parse(line);
                  const token = part?.message?.content || '';
                  if (token) onToken(token);
                } catch {}
              }
            });
            res.on('end', () => {
              clearAbort();
              resolve();
            });
            res.on('error', (e) => {
              clearAbort();
              reject(e);
            });
          }
        );

        const abortFn = () => { try { req.destroy(); } catch {} };
        activeStreamAbort = abortFn;
        const clearAbort = () => { if (activeStreamAbort === abortFn) activeStreamAbort = null; };

        req.setTimeout(22000, () => req.destroy(new Error('Ollama timeout')));
        req.on('error', (e) => {
          clearAbort();
          reject(e);
        });
        req.write(bodyStr);
        req.end();
      });
    }

    function streamGroqChatRequest(messages, onToken, systemPrompt = '') {
      const groqKey = (prefs.groqApiKey || '').trim();
      if (!nodeHttps || !groqKey) {
        return Promise.reject(new Error('Chave da Groq ausente para fallback'));
      }

      const formattedMessages = [];
      let fullSys = (systemPrompt && systemPrompt.trim())
        ? systemPrompt.trim()
        : buildFullSystemPrompt(messages);

      // Proteção de Cota e Tamanho Máximo na Groq (evita erro HTTP 413)
      if (fullSys.length > 5500) {
        fullSys = fullSys.slice(0, 5200) + '\n\n[... Diretivas adicionais condensadas para caber no limite da Groq ...]';
      }

      formattedMessages.push({
        role: 'system',
        content: fullSys
      });

      // Mantém histórico recente (últimas 5 mensagens) com limite seguro por mensagem
      const recentMessages = messages.filter((m) => m && m.role !== 'system').slice(-5);
      for (const m of recentMessages) {
        let content = m.content;
        if (Array.isArray(content)) {
          content = content.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ');
        }
        let strContent = String(content || '');
        if (strContent.length > 2000) {
          strContent = strContent.slice(0, 1900) + '...';
        }
        formattedMessages.push({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: strContent
        });
      }

      const isStudy = Boolean(state.studyMode);
      const bodyStr = JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        stream: true,
        messages: formattedMessages,
        max_tokens: isStudy ? 320 : 180,
        temperature: isStudy ? 0.35 : 0.65
      });

      return new Promise((resolve, reject) => {
        const req = nodeHttps.request(
          {
            hostname: 'api.groq.com',
            port: 443,
            path: '/openai/v1/chat/completions',
            method: 'POST',
            agent: brainGroqAgent,
            headers: {
              Authorization: `Bearer ${groqKey}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
              'User-Agent': 'StackChan-Pet/2.0'
            }
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              clearAbort();
              let errBody = '';
              res.on('data', (d) => { errBody += d; });
              res.on('end', () => {
                reject(new Error(`Groq Chat HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`));
              });
              return;
            }
            res.setEncoding('utf8');
            let lineBuffer = '';
            res.on('data', (chunk) => {
              lineBuffer += chunk;
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                  try {
                    const part = JSON.parse(trimmed.slice(6));
                    const token = part?.choices?.[0]?.delta?.content || '';
                    if (token) onToken(token);
                  } catch {}
                }
              }
            });
            res.on('end', () => {
              clearAbort();
              resolve();
            });
            res.on('error', (e) => {
              clearAbort();
              reject(e);
            });
          }
        );

        const abortFn = () => { try { req.destroy(); } catch {} };
        activeStreamAbort = abortFn;
        const clearAbort = () => { if (activeStreamAbort === abortFn) activeStreamAbort = null; };

        req.setTimeout(12000, () => req.destroy(new Error('Groq timeout')));
        req.on('error', (e) => {
          clearAbort();
          reject(e);
        });
        req.write(bodyStr);
        req.end();
      });
    }

    function extractCleanVisibleText(rawReply) {
      // Remove tags completas no início ([OUVI: ...] e [EMOÇÃO]) sem deixar vazar tags parciais em andamento!
      let rest = rawReply.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '');
      if (/^\s*\[[^\]]*$/.test(rest)) {
        return '';
      }
      return rest.replace(/^\s*\*\s+/gm, '• ').replace(/\*+/g, '');
    }

    function applyEmotionFromTag(key) {
      const emo = TAG_TO_EMOTION[key] || 'HAPPY';
      state.isThinking = false;
      state.isScanningScreen = false;
      // Preserva rostos especiais de truques ativos (ex.: óculos escuros do Moonwalk ou olhos X de Fingir de Morto)
      if (state.trick && state.trick.type === 'FINGIR_MORTO') {
        setEmotion('DEAD', 5500);
        return 'DEAD';
      }
      if (state.trick && (state.trick.type === 'MOONWALK' || state.trick.type === 'MODO_RGB')) {
        setEmotion('COOL', 5500);
        return 'COOL';
      }
      if (state.aiAction === 'SLEEP') {
        setEmotion('SLEEPY', 0);
        return 'SLEEPY';
      }
      setEmotion(emo, 8000);
      if (emo === 'EXCITED' || emo === 'LAUGHING') {
        CuteSynth.excited();
        spawnParticle('✨', 0, 8);
      } else if (emo === 'LOVE') {
        CuteSynth.purr();
        spawnParticle('❤️', 0, 8);
      } else if (emo === 'SAD') {
        CuteSynth.sad();
      } else if (emo === 'SURPRISED') {
        CuteSynth.surprised();
      } else if (emo === 'COOL') {
        CuteSynth.danceBeat();
      } else if (emo === 'DEAD') {
        CuteSynth.koDrop();
      }
      return emo;
    }

    async function askAboutDesktop(userPrompt) {
      await handleUserMessage(userPrompt, true);
    }

    // Modo Áudio Nativo Direto no Gemini (0 MB de VRAM + Visão ao vivo simultânea!)
    async function handleDirectAudioGemini(wavBlob, rawSamples, sourceSampleRate) {
      state.lastInteractionAt = Date.now();
      if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';

      stopCurrentSpeech();
      const sessionId = state.speechSessionId;
      state.isThinking = true;
      if (typeof window.showActionBadge === 'function') {
        window.showActionBadge('🎧', 'Processando sua voz...', 0);
      }
      setEmotion('THINKING', 6500);
      showBubble('Ouvindo com Gemini...', 'Processando sua voz...', 0, false);

      const t0 = performance.now();
      const ab = await wavBlob.arrayBuffer();
      const audioWavBase64 = Buffer.from(ab).toString('base64');

      // Captura leve de TODAS as telas em paralelo para caso a fala pergunte sobre qualquer monitor!
      let screenshotBase64 = null;
      let screenImages = [];
      let desktopContext = '[Áudio de voz do usuário]';
      if (ipcRenderer) {
        const snap = await ipcRenderer.invoke('capture-desktop', { mode: 'all', width: 896, height: 504, quality: 72 });
        if (sessionId !== state.speechSessionId) return;
        screenshotBase64 = snap?.base64Jpeg || null;
        screenImages = Array.isArray(snap?.screens)
          ? snap.screens.map((s) => ({ label: s.label, base64Jpeg: s.base64Jpeg }))
          : [];
        const petDisp = getDisplayAt(state.x + PET_W / 2);
        if (snap?.activeTitle) {
          desktopContext = `[Áudio de voz do usuário | Você (BitBop) está em: ${petDisp.label} | Janela ativa: "${snap.activeTitle}" (${snap.activeApp}); outras janelas: ${(snap.openWindows || []).slice(0, 6).join(' | ')}]`;
        }
      }

      const messagesPayload = [
        ...state.conversationHistory,
        { role: 'user', content: desktopContext },
      ];

      let audioContinuityNote = '';
      if (state.conversationalContinuity && state.conversationalContinuity.lastUtterance) {
        const timeDiff = Date.now() - (state.conversationalContinuity.lastTimestamp || 0);
        if (timeDiff < 16000) {
          audioContinuityNote = ` IMPORTANTE: Há ${Math.round(timeDiff/1000)}s o usuário falou "${state.conversationalContinuity.lastUtterance}". Se o que você acabou de ouvir for uma continuação desse pensamento, interprete o comando de forma unificada e completa.`;
        }
      }

      const extraAudioRule =
        'INSTRUÇÃO DE ÁUDIO AO VIVO: Você está ouvindo diretamente o microfone do usuário (e enxergando uma miniatura atual da tela dele; só mencione detalhes da tela/jogo se ele perguntar sobre isso ou se tiver relação natural com o que ele falou). ' +
        'Se o áudio contiver APENAS ruído de fundo, respiração, tosse, clique ou efeito sonoro sem nenhuma palavra humana compreensível, responda UNICAMENTE: [SILENCIO] ' +
        'Caso o usuário tenha falado algo, comece com [OUVI: transcrição fiel do que ele disse], seguido opcionalmente de [ACAO:CODIGO] se ele pediu uma ação/truque/movimento físico, seguido de UMA tag de emoção ([FELIZ], [EMPOLGADO], [AMOR], [CURIOSO], [TRISTE], [BRAVO], [SURPRESO], [RISO], [ESTILOSO] ou [MORTO]) e sua resposta falada natural em português.' +
        audioContinuityNote;

      const sentenceQueue = [];
      let queueFinished = false;
      let parsedEmotion = null;
      let actionTriggered = false;
      let heardTranscript = null;
      let detectedSilence = false;

      const speechWorker = (async () => {
        while ((!queueFinished || sentenceQueue.length > 0) && sessionId === state.speechSessionId) {
          if (sentenceQueue.length > 0) {
            if (sentenceQueue.length > 1 && window.prefetchSentenceAudio) {
              window.prefetchSentenceAudio(sentenceQueue[1]);
            }
            const nextSentence = sentenceQueue.shift();
            state.isSpeaking = true;
            await playSingleSentenceStream(nextSentence, sessionId);
          } else {
            await new Promise((r) => setTimeout(r, 25));
          }
        }
      })();

      let rawReply = '';
      let cleanDisplayReply = '';
      let pendingSentence = '';
      let firstTokenLogged = false;
      let calendarScheduled = false;
      let keepHandled = false;
      let memoryHandled = false;
      let pendingAsyncToolPromise = null;
      const modelName = getEffectiveGeminiModel();

      const onAudioStreamToken = (token) => {
        if (sessionId !== state.speechSessionId || detectedSilence) return;
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          if (typeof window.hideActionBadge === 'function') {
            window.hideActionBadge();
          }
          console.log(`[GEMINI-AUDIO:${modelName}] 1º token em ${Math.round(performance.now() - t0)}ms`);
        }

        rawReply += token;

        if (/^\s*\[SIL[ÊE]NCIO\]/i.test(rawReply)) {
          detectedSilence = true;
          state.isThinking = false;
          speechBubble.classList.remove('visible');
          console.log('[GEMINI-AUDIO] Ruído/silêncio ignorado.');
          return;
        }

        if (heardTranscript === null) {
          const heardMatch = rawReply.match(/^\s*\[OUVI:\s*([^\]]+)\]/i);
          if (heardMatch) {
            heardTranscript = heardMatch[1].trim();
            console.log(`[GEMINI-AUDIO] Ouviu -> "${heardTranscript}"`);
            if (!actionTriggered) {
              const fastAct = detectVoiceActionCommand(heardTranscript);
              if (fastAct) actionTriggered = executePetAction(fastAct);
            }
          }
        }

        if (!actionTriggered) {
          const actMatch = rawReply.match(ACTION_TAG_RX);
          if (actMatch) {
            actionTriggered = executePetAction(actMatch[1].toUpperCase());
          }
        }

        if (!parsedEmotion) {
          const emoMatch = rawReply.match(EMOTION_TAG_RX);
          if (emoMatch) {
            parsedEmotion = applyEmotionFromTag(emoMatch[1].toUpperCase());
          } else {
            const stripped = extractCleanVisibleText(rawReply);
            if (stripped.length > 18) {
              parsedEmotion = applyEmotionFromTag(state.studyMode ? 'CURIOUS' : 'FELIZ');
            }
          }
        }

        const prevCleanLen = cleanDisplayReply.length;
        cleanDisplayReply = extractCleanVisibleText(rawReply);

        if (cleanDisplayReply.length > prevCleanLen) {
          const deltaClean = cleanDisplayReply.slice(prevCleanLen);
          pendingSentence += deltaClean;
          const askedScreen = (heardTranscript ? (STUDY_VISION_TRIGGER_RX.test(heardTranscript) || EXPLICIT_VISUAL_INSPECT_RX.test(heardTranscript)) : false);
          const bLabel = calendarScheduled ? 'Google Agenda 📅' : (keepHandled ? 'Google Keep 📝' : (memoryHandled ? 'Obsidian 🧠' : (state.studyMode ? 'Modo Estudo 📚' : 'BitBop')));
          showBubble(bLabel, cleanDisplayReply.trim(), 0, askedScreen);

          const match = pendingSentence.match(/^([\s\S]*?[.!?…]+)(\s+|$)/);
          if (match && (match[1].trim().length >= 24 || match[0].includes('\n'))) {
            let clauseText = match[1].trim();
            // Suaviza pausas intermediárias: troca ponto final por vírgula em frases intermediárias para fluidez natural
            if (clauseText.endsWith('.') && !clauseText.endsWith('..') && !/\b(?:etc|ex|dr|dra|sr|sra|prof|v|vs)\.$/i.test(clauseText)) {
              clauseText = clauseText.slice(0, -1) + ',';
            }
            sentenceQueue.push(clauseText);
            if (window.prefetchSentenceAudio) {
              window.prefetchSentenceAudio(clauseText);
            }
            pendingSentence = pendingSentence.slice(match[0].length);
          }
        }
      };

      try {
        await streamGeminiRequest(
          messagesPayload,
          {
            screenshotBase64,
            images: screenImages,
            audioWavBase64,
            extraSystemRule: extraAudioRule,
            onFunctionCall: (fc) => {
              if (fc && fc.name === 'schedule_google_calendar' && window.CalendarScheduler) {
                calendarScheduled = true;
                if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Agendando no Google Agenda...', 3200);
                const norm = window.CalendarScheduler.normalizeSchedulePayload(fc.args || {});
                window.CalendarScheduler.processScheduleCall(fc.args || {});
                if (!rawReply.trim()) {
                  onAudioStreamToken(`[FELIZ] ${norm.speech_response}`);
                }
              } else if (fc && fc.name === 'consultar_google_calendar' && window.CalendarScheduler) {
                calendarScheduled = true;
                if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Consultando Google Agenda...', 3200);
                const intro = fc.args?.speech_response || 'Consultando seus compromissos no Google Agenda...';
                if (!rawReply.trim()) {
                  onAudioStreamToken(`[CURIOSO] ${intro}\n`);
                }
                pendingAsyncToolPromise = window.CalendarScheduler.processQueryCall(fc.args || {}).then((qRes) => {
                  if (qRes && qRes.speech_response) {
                    sentenceQueue.push(qRes.speech_response);
                    cleanDisplayReply += (cleanDisplayReply ? '\n' : '') + qRes.speech_response;
                  }
                  return qRes;
                });
              } else if (fc && window.GoogleKeepService && window.GoogleKeepService.isKeepFunction(fc.name)) {
                keepHandled = true;
                const keepAct = (fc.name === 'ler_notas_keep') ? 'Lendo Keep...' : (fc.name === 'adicionar_em_nota_keep' ? 'Atualizando no Keep...' : 'Anotando no Keep...');
                if (typeof window.showActionBadge === 'function') window.showActionBadge('📝', keepAct, 3200);
                const keepRes = window.GoogleKeepService.processKeepCall(fc.name, fc.args || {});
                if (!rawReply.trim() && keepRes && keepRes.speech_response) {
                  onAudioStreamToken(`[FELIZ] ${keepRes.speech_response}`);
                }
              } else if (fc && window.MemoryTools && window.MemoryTools.isMemoryFunction(fc.name)) {
                memoryHandled = true;
                let bIcon = '🧠';
                let bText = 'Consultando memória...';
                if (fc.name === 'criar_pendencia') { bIcon = '📌'; bText = 'Criando pendência...'; }
                else if (fc.name === 'fechar_pendencia') { bIcon = '✅'; bText = 'Concluindo pendência...'; }
                else if (fc.name === 'guardar_memoria') { bIcon = '🧠'; bText = 'Guardando na memória...'; }
                else if (fc.name === 'lembrar') { bIcon = '🔍'; bText = 'Lembrando...'; }
                else if (fc.name === 'esquecer') { bIcon = '🗑️'; bText = 'Esquecendo...'; }
                else if (fc.name === 'corrigir_memoria') { bIcon = '✏️'; bText = 'Atualizando memória...'; }
                if (typeof window.showActionBadge === 'function') window.showActionBadge(bIcon, bText, 3200);
                if (fc.name === 'lembrar') {
                  if (typeof setEmotion === 'function') setEmotion('THINKING', 4000);
                  if (window.CuteSynth && typeof window.CuteSynth.thinking === 'function') window.CuteSynth.thinking();
                }
                const memRes = window.MemoryTools.processMemoryCall(fc.name, fc.args || {});
                const replySpeech = (memRes && memRes.speech_response) ? memRes.speech_response : 'Memória processada no Obsidian!';
                if (!rawReply.trim()) {
                  onAudioStreamToken(`[FELIZ] ${replySpeech}`);
                }
              } else if (fc && window.PersonalityTools && window.PersonalityTools.isPersonalityFunction(fc.name)) {
                let bIcon = '🎭';
                let bText = 'Ajustando personalidade...';
                if (fc.name === 'trocar_persona') { bIcon = '🎭'; bText = 'Trocando persona...'; }
                else if (fc.name === 'ajustar_tom') { bIcon = '🎛️'; bText = 'Ajustando tom...'; }
                else if (fc.name === 'travar_personalidade') { bIcon = '🔒'; bText = 'Trava de personalidade...'; }
                else if (fc.name === 'resetar_personalidade') { bIcon = '↺'; bText = 'Resetando personalidade...'; }
                else if (fc.name === 'explicar_personalidade') { bIcon = '💬'; bText = 'Explicando postura...'; }
                if (typeof window.showActionBadge === 'function') window.showActionBadge(bIcon, bText, 3200);
                const persRes = window.PersonalityTools.processPersonalityCall(fc.name, fc.args || {});
                const replySpeech = (persRes && persRes.speech_response) ? persRes.speech_response : 'Personalidade atualizada!';
                if (!rawReply.trim()) {
                  onAudioStreamToken(`[FELIZ] ${replySpeech}`);
                }
              }
            },
          },
          onAudioStreamToken
        );

        if (pendingAsyncToolPromise) {
          try {
            await pendingAsyncToolPromise;
          } catch (toolErr) {
            console.warn('[CalendarScheduler] Erro aguardando consulta do calendário:', toolErr);
          }
        }

        state.isThinking = false;

        if (detectedSilence) {
          queueFinished = true;
          setEmotion('NORMAL', 2000);
          return;
        }

        if (!parsedEmotion) {
          parsedEmotion = detectFallbackSentiment(cleanDisplayReply);
          if (!state.trick && state.aiAction !== 'SLEEP') setEmotion(parsedEmotion, 6500);
        }

        if (pendingSentence.trim()) {
          const finalClause = pendingSentence.trim();
          sentenceQueue.push(finalClause);
          if (window.prefetchSentenceAudio) {
            window.prefetchSentenceAudio(finalClause);
          }
        }

        const finalClean = cleanDisplayReply.trim();
        console.log(`[GEMINI-AUDIO:${modelName}] Concluído (${Math.round(performance.now() - t0)}ms) [${parsedEmotion}]: ${finalClean}`);

        if (finalClean) {
          if (!state.conversationalContinuity) state.conversationalContinuity = {};
          state.conversationalContinuity.lastUtterance = heardTranscript || finalClean;
          state.conversationalContinuity.lastTimestamp = Date.now();
          state.conversationalContinuity.lastAssistantReply = finalClean;

          state.conversationHistory.push({ role: 'user', content: heardTranscript || '(fala em áudio)' });
          state.conversationHistory.push({ role: 'assistant', content: finalClean });
          if (state.conversationHistory.length > 12) {
            state.conversationHistory = [
              state.conversationHistory[0],
              ...state.conversationHistory.slice(-10),
            ];
          }
        }
      } catch (err) {
        if (sessionId !== state.speechSessionId) return;
        if (/429|quota|resource_exhausted/i.test(err.message)) {
          markGeminiQuotaExceeded(60000);
        }
        console.warn(`[GEMINI-AUDIO] Falha (${err.message}); acionando fallback local Whisper Large-v3-Turbo...`);
        state.isThinking = false;
        queueFinished = true;
        if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', 'whisper-turbo');
        await sendToWhisper(rawSamples, sourceSampleRate);
        return;
      } finally {
        queueFinished = true;
      }

      await speechWorker;
      if (sessionId === state.speechSessionId && !detectedSilence) {
        state.isSpeaking = false;
        state.mouthOpen = 0;
        state.cooldownUntil = Date.now() + 380;
        if (!state.isUserSpeaking && typeof clearPreRoll === 'function') clearPreRoll();
        const askedScreen = (heardTranscript ? (STUDY_VISION_TRIGGER_RX.test(heardTranscript) || EXPLICIT_VISUAL_INSPECT_RX.test(heardTranscript)) : false);
        const bLabel = calendarScheduled ? 'Google Agenda 📅' : (keepHandled ? 'Google Keep 📝' : (memoryHandled ? 'Obsidian 🧠' : (state.studyMode ? 'Modo Estudo 📚' : 'BitBop')));
        showBubble(bLabel, cleanDisplayReply.trim() || 'Prontinho!', state.studyMode ? 9500 : 5500, askedScreen);

        // Caminho Lento Assíncrono (Slow-Path): Enfileira o turno no MemoryExtractor
        if (window.MemoryExtractor && typeof window.MemoryExtractor.enqueueTurn === 'function') {
          window.MemoryExtractor.enqueueTurn({
            userTranscript: heardTranscript || '',
            botResponse: cleanDisplayReply.trim(),
            currentEmotion: parsedEmotion,
            activeWindowTitle: (window.state && window.state.desktop && window.state.desktop.activeTitle) || '',
            audioSource: (window.state && (window.state.studyMode || (/(?:youtube|netflix|spotify|twitch|vlc|player|video|coursera|udemy|aula|meet|teams|zoom)/i.test((window.state && window.state.desktop && window.state.desktop.activeTitle) || '') && !/^(?:bitbop|bit\s*bop|bop|stack|stackchan)\b/i.test(userUtterance || '')))) ? 'midia_ambiente' : 'usuario_voz'
          });
          window.MemoryExtractor.triggerBackgroundExtractionIfIdle();
        }

        if (window.HippocampusLogger && typeof window.HippocampusLogger.recordConversationTurn === 'function') {
          const activeApp = (window.state && window.state.desktop && (window.state.desktop.activeApp || window.state.desktop.activeTitle)) || 'Desktop';
          window.HippocampusLogger.recordConversationTurn({
            userText: heardTranscript || '',
            botReply: cleanDisplayReply.trim(),
            emotion: parsedEmotion || 'NORMAL',
            appAtivo: activeApp
          }).catch(err => console.warn('[HIPOCAMPO] Erro em recordConversationTurn:', err));
        }

        // Seção 5: Aprendizado Seguro de Traços & Motor de Humor (PersonalityLearner)
        if (window.PersonalityLearner && typeof window.PersonalityLearner.processTurn === 'function') {
          const userUtterance = isContinuation ? unifiedCommand : cleanUser;
          const aSource = (window.state && (window.state.studyMode || (/(?:youtube|netflix|spotify|twitch|vlc|player|video|coursera|udemy|aula|meet|teams|zoom)/i.test((window.state && window.state.desktop && window.state.desktop.activeTitle) || '') && !/^(?:bitbop|bit\s*bop|bop|stack|stackchan)\b/i.test(heardTranscript || '')))) ? 'midia_ambiente' : 'usuario_voz';
          window.PersonalityLearner.processTurn({
            userTranscript: userUtterance,
            botResponse: finalClean || cleanDisplayReply.trim(),
            currentEmotion: parsedEmotion,
            activeWindowTitle: (window.state && window.state.desktop && window.state.desktop.activeTitle) || '',
            audioSource: aSource
          });
        }
      }
    }

    async function handleUserMessage(rawUserText, forceVision = false, extraOpts = {}) {
      const cleanUser = (rawUserText || '').trim();
      if (!cleanUser) return;

      // =======================================================================
      // MOTOR DE CONTINUIDADE CONVERSACIONAL INTELIGENTE (MEMÓRIA DE PAUSA/PENSAMENTO)
      // =======================================================================
      if (!state.conversationalContinuity) {
        state.conversationalContinuity = {
          lastUtterance: '',
          lastTimestamp: 0,
          lastAssistantReply: '',
        };
      }

      const now = Date.now();
      const timeSinceLast = now - (state.conversationalContinuity.lastTimestamp || 0);
      const lastText = (state.conversationalContinuity.lastUtterance || '').trim();
      let isContinuation = false;
      let unifiedCommand = cleanUser;
      let continuitySystemNote = '';

      if (lastText && timeSinceLast < 16000) {
        // Padrões de comando em aberto na fala anterior:
        const prevOpenRx = /\b(anota|anote|salva|cria|agenda|marque|lembra|coloca|o que tem|quais|como|explica|mostra|veja|olha|abre|pesquisa|sobre|para|com|de|em|e|ou|mas|que|aí|então|porque|tipo)$/i;
        const prevIntentShortRx = /^(anota aí|anota no keep|salva no keep|agenda aí|marca um compromisso|o que tem no keep|o que tenho hoje|quais as notas|pesquisa aí|me fala|me diz|queria saber|uma dúvida)\b/i;

        // Padrões de continuação na fala atual:
        const currentFollowupRx = /^(que|sobre|para|com|de|e|ou|no caso|tipo|o|a|os|as|um|uma|texto|nota|resumo|reunião|consulta|aula|prova|senha|licitação)\b/i;

        const wasOpen = prevOpenRx.test(lastText) || prevIntentShortRx.test(lastText);
        const looksLikeFollowup = currentFollowupRx.test(cleanUser) || (cleanUser.split(' ').length <= 8 && wasOpen);

        if (wasOpen || looksLikeFollowup) {
          isContinuation = true;
          unifiedCommand = `${lastText} — ${cleanUser}`.replace(/\s+/g, ' ').trim();
          console.log(`[CONVERSATIONAL-CONTINUITY] Continuação detectada (${Math.round(timeSinceLast / 1000)}s depois): "${lastText}" + "${cleanUser}" => Unificado: "${unifiedCommand}"`);
          continuitySystemNote = `\n[MEMÓRIA DE CONTINUAÇÃO CONVERSACIONAL]: Há ${Math.round(timeSinceLast / 1000)} segundos o usuário iniciou um pensamento ("${lastText}"), pausou para pensar/respirar e agora concluiu com ("${cleanUser}"). O comando completo e unificado dele é: "${unifiedCommand}". Trate as duas falas como UMA ÚNICA SOLICITAÇÃO COMPLETA e execute a ação pretendida diretamente (como criar ou ler nota no Keep, agendar, ou responder à pergunta completa).`;
        }
      }

      state.lastInteractionAt = Date.now();
      if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';

      stopCurrentSpeech();
      const sessionId = state.speechSessionId;

      // 0. Calibração Vocal Direta por Voz ("BitBop, calibra minha voz" / "calibre minha voz" / "gravar voz pro reconhecimento")
      const isCalibrationCommand =
        /\b(?:calibr(?:ar?|e|em|ou|ando|[çc][ãa]o|agem)|grava(?:r?|e|em|ou|ando|[çc][ãa]o)|cadastr(?:ar?|e|em|ou|ando|o)|aprend(?:er?|a|am|eu|endo)|salva(?:r?|e|em|ou|ando))\b[\s\S]*?\b(?:voz|timbre|biometri(?:a|co)|cordas\s+vocais|fala|reconhecimento)\b/i.test(cleanUser) ||
        /\b(?:biometri(?:a|co)|reconhecimento|assinatura)\s*(?:de|da|do)?\s*(?:voz|vocal)\b/i.test(cleanUser) ||
        /\b(?:iniciar|come[çc]ar|fazer|refazer|nova)\s+(?:a\s+)?calibra[çc][ãa]o\b/i.test(cleanUser) ||
        /\b(?:calibra[çc][ãa]o|calibragem|biometria)\s+vocal\b/i.test(cleanUser);

      if (isCalibrationCommand) {
        const vb = (typeof window !== 'undefined' && window.VoiceBiometrics) ? window.VoiceBiometrics : (typeof globalThis !== 'undefined' ? globalThis.VoiceBiometrics : null);
        if (vb && typeof vb.startCalibration === 'function') {
          console.log('[VOICE-BIOMETRICS] Comando de calibração acionado por voz:', cleanUser);
          await vb.startCalibration();
          return;
        }
      }

      // 0.1 Consulta de Identificação Vocal ("quem é que tá falando?" / "reconhece minha voz?")
      const isVoiceIdentityQuery = /(?:quem\s*(?:[ée]|est[áa]|aqui\s*(?:[ée]|est[áa])?|t[áa])\s*(?:que\s*)?(?:aqui\s*)?(?:t[áa]\s*)?falando|quem\s*sou\s*eu|reconhece\s*(?:a\s*)?minha\s*voz|reconheceu\s*(?:a\s*)?minha\s*voz|t[áa]\s*reconhecendo\s*(?:a\s*)?minha\s*voz|de\s*quem\s*[ée]\s*(?:essa|a)\s*voz|sabe\s*quem\s*(?:[ée]|sou\s*eu|t[áa]\s*falando)|adivinha\s*quem\s*(?:[ée]|t[áa]\s*falando)|minha\s*voz\s*t[áa]\s*(?:cadastrada|reconhecida)|voc[êe]\s*(?:me\s*)?(?:conhece|reconhece)|sabe\s*de\s*quem\s*[ée]\s*essa\s*voz|conhece\s*(?:a\s*)?minha\s*voz)/i.test(cleanUser);

      if (isVoiceIdentityQuery) {
        const speakerInfo = extraOpts?.speakerInfo || null;
        if (speakerInfo && speakerInfo.enrolled) {
          const pct = Math.round((speakerInfo.similarity || 0) * 100);
          if (speakerInfo.isOwner) {
            setEmotion('HAPPY', 5000);
            if (CuteSynth && typeof CuteSynth.happy === 'function') CuteSynth.happy();
            if (typeof window.showActionBadge === 'function') {
              window.showActionBadge('🎙️', `Álvaro (${pct}%)`, 4500);
            }
            const replyMsg = `É você, Álvaro! Reconheci seu timbre pela sua biometria vocal com ${pct}% de similaridade.`;
            showBubble('🎙️ Biometria Vocal', replyMsg, 7000, false, true);
            await speakText(replyMsg, 'HAPPY', true, true);
          } else {
            setEmotion('SURPRISED', 5000);
            if (CuteSynth && typeof CuteSynth.curious === 'function') CuteSynth.curious();
            if (typeof window.showActionBadge === 'function') {
              window.showActionBadge('🎙️', `Outro Locutor (${pct}%)`, 4500);
            }
            const replyMsg = `Essa voz deu ${pct}% de similaridade com a biometria cadastrada do meu dono Álvaro (abaixo do corte). Para mim, é outra pessoa falando!`;
            showBubble('🎙️ Biometria Vocal', replyMsg, 7000, false, true);
            await speakText(replyMsg, 'SURPRISED', true, true);
          }
          return;
        } else {
          setEmotion('NORMAL', 4000);
          const replyMsg = 'Ainda não calibramos a sua biometria vocal! Diga "BitBop, iniciar calibração vocal" para eu gravar o timbre das suas cordas vocais.';
          showBubble('🎙️ Biometria Vocal', replyMsg, 6000, false, true);
          await speakText(replyMsg, 'NORMAL', true, true);
          return;
        }
      }

      // 0.2 Verificação Biométrica do Locutor (CAM++ 16k)
      const speakerInfo = extraOpts?.speakerInfo || null;
      const isOwner = speakerInfo ? speakerInfo.isOwner : true;

      // Se biometria estiver ativa, com perfil do dono gravado e locutor NÃO for o dono:
      if (speakerInfo && speakerInfo.enrolled && !isOwner) {
        console.log(`[VOICE-BIOMETRICS] Locutor secundário detectado (similaridade: ${speakerInfo.similarity} < corte: ${speakerInfo.threshold}).`);

        // Caso A: No Modo Ouvinte Silencioso (jogando / discord), categoriza o amigo nas memórias
        if (state.silentObserverMode) {
          if (window.MemoryExtractor && typeof window.MemoryExtractor.enqueueTurn === 'function') {
            window.MemoryExtractor.enqueueTurn({
              userText: cleanUser,
              botResponse: '[Modo Ouvinte: Amigo/Discord falando]',
              timestamp: Date.now(),
              audioSource: 'amigo_discord',
              speaker: 'AMIGO_DISCORD',
              context: { activeApp: state.desktop?.activeApp, activeTitle: state.desktop?.activeTitle }
            });
          }
          setEmotion('CURIOUS', 0);
          return; // Fica em silêncio absoluto no jogo
        }

        // Caso B: No Modo Normal, se 'Restringir comandos à minha voz' estiver ativado
        if (prefs.biometricsRestricted) {
          console.log('[VOICE-BIOMETRICS] Comando ignorado: locutor não autorizado.');
          CuteSynth.purr();
          showBubble('🔒 Voz Secundária', 'Opa! Só obedeço a comandos da voz oficial do meu dono.', 3500);
          return;
        }
      }

      // Gatilho físico instantâneo (0ms) caso o usuário peça movimento, dança, truque, tamanho ou modo estudo!
      const fastAction = detectVoiceActionCommand(isContinuation ? unifiedCommand : cleanUser);
      let actionTriggered = false;
      if (fastAction) {
        actionTriggered = executePetAction(fastAction);
        if (fastAction === 'ATIVAR_MODO_ESTUDO' || fastAction === 'DESATIVAR_MODO_ESTUDO') {
          const confirmMsg = fastAction === 'ATIVAR_MODO_ESTUDO'
            ? 'Modo estudo ativado. Leitura multimodal da tela pronta.'
            : 'Modo estudo desativado.';
          await speakText(confirmMsg, 'NORMAL');
          return;
        }
      }

      // Bypass ultrarrápido para comandos diretos de personalidade e faceta (<100ms)
      if (window.PersonalityTools && typeof window.PersonalityTools.checkDirectVoiceCommands === 'function') {
        const directPers = window.PersonalityTools.checkDirectVoiceCommands(isContinuation ? unifiedCommand : cleanUser);
        if (directPers && directPers.speech_response) {
          if (directPers.actionLabel && typeof window.showActionBadge === 'function') {
            window.showActionBadge('🎭', directPers.actionLabel, 2800);
          }
          await speakText(directPers.speech_response, directPers.emotion || 'NORMAL');
          return;
        }
      }

      // =======================================================================
      // MODO SÓ OBSERVAR / OUVINTE SILENCIOSO (SILENT OBSERVER / SPECTATOR MODE)
      // =======================================================================
      if (state.silentObserverMode) {
        // 1. Testa se o comando é para desativar o modo ouvinte e voltar a falar
        const isDeactivateCmd = /(?:pode\s*voltar\s*a\s*falar|volta\s*a\s*falar|desativa(?:r)?\s*(?:o\s*)?(?:modo\s*)?(?:ouvinte|espectador|observador|silencioso)|pode\s*falar(?:\s*novamente)?|pode\s*conversar|sai\s*do\s*modo\s*(?:ouvinte|espectador|observador))/i.test(cleanUser) ||
                                /(?:pode\s*voltar\s*a\s*falar|volta\s*a\s*falar|desativa(?:r)?\s*(?:o\s*)?(?:modo\s*)?(?:ouvinte|espectador|observador|silencioso)|pode\s*falar(?:\s*novamente)?|pode\s*conversar|sai\s*do\s*modo\s*(?:ouvinte|espectador|observador))/i.test(unifiedCommand);

        if (isDeactivateCmd) {
          state.silentObserverMode = false;
          if (typeof window.toggleListenerMode === 'function') {
            window.toggleListenerMode(false);
          } else {
            if (typeof window.updatePersonalityUi === 'function') window.updatePersonalityUi();
            if (typeof window.showActionBadge === 'function') window.showActionBadge('🗣️', 'Voz Reativada', 3000);
          }
          await speakText('Tô de volta! Acompanhei tudo por aqui e guardei as conversas na memória. Pode falar comigo normalmente!', 'HAPPY');
          return;
        }

        // 2. Não é comando de desativar: silêncio absoluto!
        // Não gera resposta com LLM, não abre balão falador, não emite áudio TTS.
        console.log('[MODO OUVINTE SILENCIOSO] Ouvindo conversa/jogo sem interromper:', cleanUser);

        // Feedback visual sutil no visor OLED (olhar curioso e focado)
        if (typeof setEmotion === 'function') {
          setEmotion('CURIOUS', 2000);
        }

        // Enfileira a conversa diretamente no MemoryExtractor para aprender em segundo plano
        if (window.MemoryExtractor && typeof window.MemoryExtractor.enqueueTurn === 'function') {
          const userUtterance = isContinuation ? unifiedCommand : cleanUser;
          window.MemoryExtractor.enqueueTurn({
            userTranscript: userUtterance,
            botResponse: '[Modo Ouvinte: BitBop ouvindo silenciosamente o usuário e amigos]',
            currentEmotion: 'CURIOUS',
            activeWindowTitle: (window.state && window.state.desktop && window.state.desktop.activeTitle) || '',
            audioSource: 'usuario_voz'
          });
          window.MemoryExtractor.triggerBackgroundExtractionIfIdle();
        }

        return; // Interrompe aqui: zero interrupções na conversa ou no jogo!
      }

      // Visão multimodal inteligente: acionada explicitamente por comando visual, ou no Modo Estudo ao solicitar análise/código/questão/slide
      const isPrivOrSens = Boolean(state.privateMode || state.isSensitiveWindow);
      const needsVision = !isPrivOrSens && (forceVision ||
        (state.studyMode
          ? (STUDY_VISION_TRIGGER_RX.test(cleanUser) || VISION_TRIGGER_RX.test(cleanUser) || STUDY_VISION_TRIGGER_RX.test(unifiedCommand))
          : (fastAction ? EXPLICIT_VISUAL_INSPECT_RX.test(cleanUser) : (VISION_TRIGGER_RX.test(cleanUser) || VISION_TRIGGER_RX.test(unifiedCommand)))));

      state.isThinking = true;
      if (typeof window.showActionBadge === 'function') {
        window.showActionBadge('🧠', 'Pensando...', 0);
      }
      let screenshotBase64 = null;
      let visionImages = [];
      let desktopNote = continuitySystemNote;
      const petDisp = getDisplayAt(state.x + PET_W / 2);

      if (needsVision && ipcRenderer) {
        state.isScanningScreen = true;
        if (!actionTriggered) setEmotion(state.studyMode ? 'THINKING' : 'CURIOUS', 8000);
        if (!state.studyMode) CuteSynth.scan();
        const numScreens = getEffectiveDisplays().length;
        showBubble(
          isContinuation ? 'Entendi a Continuação! 🧠' : (state.studyMode ? 'Analisando Tela 📚' : (numScreens > 1 ? 'Olhando suas Telas...' : 'Olhando sua Tela...')),
          isContinuation ? `“${unifiedCommand}”` : `“${cleanUser}”`,
          0,
          true
        );
        const snap = await ipcRenderer.invoke('capture-desktop', {
          mode: 'all',
          width: state.studyMode ? 1024 : 960,
          height: state.studyMode ? 576 : 540,
          quality: state.studyMode ? 74 : 72,
        });
        if (sessionId !== state.speechSessionId) return;
        screenshotBase64 = snap?.base64Jpeg || null;
        visionImages = Array.isArray(snap?.screens)
          ? snap.screens.map((s) => ({ label: s.label, base64Jpeg: s.base64Jpeg }))
          : [];
        const winSummary = (snap?.windows || [])
          .slice(0, 8)
          .map((w) => `[${w.screenLabel}] "${w.title}" (${w.app})`)
          .join(' | ');
        desktopNote += `\n[Contexto Multi-Telas: Você (BitBop) está em pé na "${petDisp.label}"; janela em foco="${snap?.activeTitle || ''}" (${snap?.activeApp || ''}); janelas abertas por tela: ${winSummary || (snap?.openWindows || []).slice(0, 6).join(' | ')}]`;
      } else {
        if (!actionTriggered) setEmotion('THINKING', 6000);
        showBubble(isContinuation ? 'Entendi a Continuação! 🧠' : (actionTriggered ? 'Executando! 🎬' : 'Pensando...'), isContinuation ? `“${unifiedCommand}”` : `“${cleanUser}”`, 0, false);
        if (state.desktop.activeTitle) {
          desktopNote += `\n[Você está na "${petDisp.label}" | Janela aberta em foco: "${state.desktop.activeTitle}"]`;
        }
      }

      if (actionTriggered && fastAction) {
        desktopNote += `\n[Ação física já iniciada por você agora mesmo na tela: ${fastAction} — responda entrando no clima dessa ação!]`;
      }

      if (speakerInfo && speakerInfo.enrolled) {
        const pct = Math.round((speakerInfo.similarity || 0) * 100);
        desktopNote += `\n[Biometria Vocal do Locutor: ${speakerInfo.isOwner ? 'CONFIRMADO como o Álvaro (Dono oficial)' : 'NÃO confirmado (possível amigo ou ruído)'} | Similaridade: ${pct}% (Corte: ${Math.round((speakerInfo.threshold || 0.45) * 100)}%) — se ele perguntar sobre quem está falando ou reconhecimento de voz, responda confirmando explicitamente esta leitura!]`;
      }

      const userMsgForApi = {
        role: 'user',
        content: (isContinuation ? unifiedCommand : cleanUser) + desktopNote,
      };
      if (screenshotBase64) {
        userMsgForApi.images = [screenshotBase64];
      } else if (extraOpts && Array.isArray(extraOpts.images) && extraOpts.images.length > 0) {
        userMsgForApi.images = extraOpts.images.map((it) => it.base64Jpeg || it);
      }

      // =======================================================================
      // PARTE 3: NAVEGADOR SUBCONSCIENTE DE DUPLO ESTÁGIO (Estágio 1 -> Dossiê)
      // =======================================================================
      let cognitiveContext = null;
      if (window.SubconsciousNavigator && typeof window.SubconsciousNavigator.gatherCognitiveContext === 'function') {
        try {
          const currentDesktopStr = (state.desktop && state.desktop.activeTitle)
            ? `App: ${state.desktop.activeApp || 'Desktop'} | Janela: ${state.desktop.activeTitle}`
            : (state.desktop && state.desktop.activeApp) || 'Desktop';

          cognitiveContext = await window.SubconsciousNavigator.gatherCognitiveContext(
            cleanUser,
            currentDesktopStr
          );
        } catch (navErr) {
          console.warn('[SubconsciousNavigator] Erro no Estágio 1:', navErr);
        }
      }

      // Monta o Bloco de Dossiê Cognitivo para o Super-Prompt do Estágio 2
      let cognitiveSystemBlock = '';
      if (cognitiveContext && cognitiveContext.dossierText) {
        cognitiveSystemBlock = `[DOSSIÊ DE ARQUIVOS DO OBSIDIAN ABERTOS PARA ESTA RESPOSTA]\n${cognitiveContext.dossierText}\n\n[RESUMO AUTOMÁTICO DO DIÁRIO DE HOJE]\n${cognitiveContext.todayDiarySummary || 'Registro contínuo ativo'}\n\nINSTRUÇÃO COGNITIVA: Você acabou de abrir e ler diretamente os arquivos do seu cérebro no Obsidian listados no [DOSSIÊ DE ARQUIVOS DO OBSIDIAN ABERTOS]. Use todos os detalhes, horários, fatos e conexões presentes nesses arquivos para responder ao Álvaro com profundidade, naturalidade e precisão humana, sem jamais depender apenas das últimas mensagens do chat.`;
      }

      const messagesPayload = [...state.conversationHistory];
      if (cognitiveSystemBlock) {
        messagesPayload.push({ role: 'system', content: cognitiveSystemBlock });
      }
      messagesPayload.push(userMsgForApi);
      state.conversationHistory.push({ role: 'user', content: cleanUser });

      const sentenceQueue = [];
      let queueFinished = false;
      let parsedEmotion = null;

      // Se o Estágio 1 detectou reflexão profunda e gerou filler de voz, inicia fala humanizada
      if (cognitiveContext && cognitiveContext.needs_deep_recall && cognitiveContext.thinking_voice_filler) {
        if (cognitiveContext.filesReadCount >= 2 && !actionTriggered) {
          sentenceQueue.push(cognitiveContext.thinking_voice_filler);
        }
      }

      const speechWorker = (async () => {
        while ((!queueFinished || sentenceQueue.length > 0) && sessionId === state.speechSessionId) {
          if (sentenceQueue.length > 0) {
            if (sentenceQueue.length > 1 && window.prefetchSentenceAudio) {
              window.prefetchSentenceAudio(sentenceQueue[1]);
            }
            const nextSentence = sentenceQueue.shift();
            state.isSpeaking = true;
            await playSingleSentenceStream(nextSentence, sessionId);
          } else {
            await new Promise((r) => setTimeout(r, 25));
          }
        }
      })();

      let rawReply = '';
      let cleanDisplayReply = '';
      let pendingSentence = '';
      let calendarScheduled = false;
      let keepHandled = false;
      let memoryHandled = false;
      let pendingAsyncToolPromise = null;
      const t0 = performance.now();
      let firstTokenLogged = false;
      let finalClean = '';
      let activeBrainLabel = 'GEMINI';

      const onStreamToken = (token) => {
        if (sessionId !== state.speechSessionId) return;
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          if (typeof window.hideActionBadge === 'function') {
            window.hideActionBadge();
          }
          console.log(`[${activeBrainLabel}] 1º token (${needsVision ? 'VISÃO-MULTITELAS' : 'TEXTO'}) em ${Math.round(performance.now() - t0)}ms`);
        }

        rawReply += token;

        if (!actionTriggered) {
          const actMatch = rawReply.match(ACTION_TAG_RX);
          if (actMatch) {
            actionTriggered = executePetAction(actMatch[1].toUpperCase());
          }
        }

        if (!parsedEmotion) {
          const emoMatch = rawReply.match(EMOTION_TAG_RX);
          if (emoMatch) {
            parsedEmotion = applyEmotionFromTag(emoMatch[1].toUpperCase());
          } else {
            const stripped = extractCleanVisibleText(rawReply);
            if (stripped.length > 16) {
              parsedEmotion = applyEmotionFromTag(state.studyMode ? 'CURIOUS' : 'FELIZ');
            }
          }
        }

        const prevCleanLen = cleanDisplayReply.length;
        cleanDisplayReply = extractCleanVisibleText(rawReply);

        if (cleanDisplayReply.length > prevCleanLen) {
          const deltaClean = cleanDisplayReply.slice(prevCleanLen);
          pendingSentence += deltaClean;
          const bLabel = calendarScheduled ? 'Google Agenda 📅' : (keepHandled ? 'Google Keep 📝' : (memoryHandled ? 'Obsidian 🧠' : (state.studyMode ? 'Modo Estudo 📚' : 'BitBop')));
          const obsCount = (cognitiveContext && cognitiveContext.filesReadCount) ? cognitiveContext.filesReadCount : 0;
          showBubble(bLabel, cleanDisplayReply.trim(), 0, needsVision, false, obsCount);

          const match = pendingSentence.match(/^([\s\S]*?[.!?…]+)(\s+|$)/);
          if (match && (match[1].trim().length >= 24 || match[0].includes('\n'))) {
            let clauseText = match[1].trim();
            // Suaviza pausas intermediárias: troca ponto final por vírgula em frases intermediárias para fluidez natural
            if (clauseText.endsWith('.') && !clauseText.endsWith('..') && !/\b(?:etc|ex|dr|dra|sr|sra|prof|v|vs)\.$/i.test(clauseText)) {
              clauseText = clauseText.slice(0, -1) + ',';
            }
            sentenceQueue.push(clauseText);
            if (window.prefetchSentenceAudio) {
              window.prefetchSentenceAudio(clauseText);
            }
            pendingSentence = pendingSentence.slice(match[0].length);
          }
        }
      };

      try {
        const hasGroq = Boolean(prefs.groqApiKey && prefs.groqApiKey.trim());
      const hasGeminiKey = prefs.aiProvider === 'gemini' && Boolean((prefs.geminiApiKey || '').trim());

      const effectiveUserText = isContinuation ? unifiedCommand : cleanUser;
      const isCalendarScheduleIntent = (
        /(?:(?:coloca|coloque|marca|marque|adiciona|adicione|anota|anote|p[oõ]e|p[oõ]em|registra|registre|salva|salve|cria|crie|lembra|lembre)\s*(?:a[ií])?\s*(?:pra\s+mim|para\s+mim)?\s*(?:na|no)\s+(?:minha\s+|meu\s+)?(?:google\s+)?(?:agenda|calend[aá]rio)|agenda\s+pra\s+mim|agende\s+pra\s+mim|marca\s+na\s+agenda|anota\s+na\s+agenda)\b/i.test(effectiveUserText) ||
        /(?:agenda|calend[aá]rio).*(?:daqui|amanh[aã]|depois\s+de\s+amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|hoje|horas?|dias?|semanas?)/i.test(effectiveUserText)
      );
      const isCalendarQueryIntent = (
        /(?:o\s+que\s+(?:eu\s+)?tenho|quais\s+(?:os\s+)?(?:meus\s+)?compromissos|como\s+est[aá]|tem\s+algum|tem\s+compromisso).*(?:agenda|calend[aá]rio)/i.test(effectiveUserText) ||
        /(?:consulta|consultar|olha|olhar|ver|checa|checar|abre|abrir).*(?:minha\s+|meu\s+)?(?:google\s+)?(?:agenda|calend[aá]rio)/i.test(effectiveUserText) ||
        /(?:o\s+que\s+(?:eu\s+)?tenho\s+(?:para|pra)\s+(?:hoje|amanh[aã]|fazer)|quais\s+(?:os\s+)?(?:meus\s+)?compromissos)/i.test(effectiveUserText)
      );

      let forcedCalendarTool = null;
      if (isCalendarScheduleIntent) {
        forcedCalendarTool = 'schedule_google_calendar';
      } else if (isCalendarQueryIntent) {
        forcedCalendarTool = 'consultar_google_calendar';
      }
      const isGroqSelected = prefs.aiProvider === 'groq';
      const isLocalSelected = prefs.aiProvider === 'local';

      // Handler unificado de ferramentas do Gemini (Google Agenda, Keep, Memórias Obsidian, Personalidade)
      const handleFunctionCall = (fc) => {
        if (!fc) return;
        if (fc.name === 'schedule_google_calendar' && window.CalendarScheduler) {
          calendarScheduled = true;
          if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Agendando no Google Agenda...', 3200);
          const norm = window.CalendarScheduler.normalizeSchedulePayload(fc.args || {});
          window.CalendarScheduler.processScheduleCall(fc.args || {});
          if (!rawReply.trim()) onStreamToken(`[FELIZ] ${norm.speech_response}`);
        } else if (fc.name === 'consultar_google_calendar' && window.CalendarScheduler) {
          calendarScheduled = true;
          if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Consultando Google Agenda...', 3200);
          const intro = fc.args?.speech_response || 'Consultando seus compromissos no Google Agenda...';
          if (!rawReply.trim()) onStreamToken(`[CURIOSO] ${intro}\n`);
          pendingAsyncToolPromise = window.CalendarScheduler.processQueryCall(fc.args || {}).then((qRes) => {
            if (qRes && qRes.speech_response) {
              sentenceQueue.push(qRes.speech_response);
              cleanDisplayReply += (cleanDisplayReply ? '\n' : '') + qRes.speech_response;
            }
            return qRes;
          });
        } else if (window.GoogleKeepService && window.GoogleKeepService.isKeepFunction(fc.name)) {
          keepHandled = true;
          const keepAct = (fc.name === 'ler_notas_keep') ? 'Lendo Keep...' : (fc.name === 'adicionar_em_nota_keep' ? 'Atualizando no Keep...' : 'Anotando no Keep...');
          if (typeof window.showActionBadge === 'function') window.showActionBadge('📝', keepAct, 3200);
          const keepRes = window.GoogleKeepService.processKeepCall(fc.name, fc.args || {});
          if (!rawReply.trim() && keepRes && keepRes.speech_response) onStreamToken(`[FELIZ] ${keepRes.speech_response}`);
        } else if (window.MemoryTools && window.MemoryTools.isMemoryFunction(fc.name)) {
          memoryHandled = true;
          let bIcon = '🧠', bText = 'Consultando memória...';
          if (fc.name === 'criar_pendencia') { bIcon = '📌'; bText = 'Criando pendência...'; }
          else if (fc.name === 'fechar_pendencia') { bIcon = '✅'; bText = 'Concluindo pendência...'; }
          else if (fc.name === 'guardar_memoria') { bIcon = '🧠'; bText = 'Guardando na memória...'; }
          else if (fc.name === 'lembrar') { bIcon = '🔍'; bText = 'Lembrando...'; }
          else if (fc.name === 'esquecer') { bIcon = '🗑️'; bText = 'Esquecendo...'; }
          else if (fc.name === 'corrigir_memoria') { bIcon = '✏️'; bText = 'Atualizando memória...'; }
          if (typeof window.showActionBadge === 'function') window.showActionBadge(bIcon, bText, 3200);
          if (fc.name === 'lembrar') {
            if (typeof setEmotion === 'function') setEmotion('THINKING', 4000);
            if (window.CuteSynth && typeof window.CuteSynth.thinking === 'function') window.CuteSynth.thinking();
          }
          const memRes = window.MemoryTools.processMemoryCall(fc.name, fc.args || {});
          const replySpeech = (memRes && memRes.speech_response) ? memRes.speech_response : 'Memória processada no Obsidian!';
          if (!rawReply.trim()) onStreamToken(`[FELIZ] ${replySpeech}`);
        } else if (window.PersonalityTools && window.PersonalityTools.isPersonalityFunction(fc.name)) {
          let bIcon = '🎭', bText = 'Ajustando postura...';
          if (fc.name === 'trocar_persona') { bIcon = '🎭'; bText = 'Trocando persona...'; }
          else if (fc.name === 'ajustar_tom') { bIcon = '🎛️'; bText = 'Ajustando tom...'; }
          else if (fc.name === 'travar_personalidade') { bIcon = '🔒'; bText = 'Trava de personalidade...'; }
          else if (fc.name === 'resetar_personalidade') { bIcon = '↺'; bText = 'Resetando personalidade...'; }
          else if (fc.name === 'explicar_personalidade') { bIcon = '💬'; bText = 'Explicando postura...'; }
          if (typeof window.showActionBadge === 'function') window.showActionBadge(bIcon, bText, 3200);
          const persRes = window.PersonalityTools.processPersonalityCall(fc.name, fc.args || {});
          const replySpeech = (persRes && persRes.speech_response) ? persRes.speech_response : 'Personalidade atualizada!';
          if (!rawReply.trim()) onStreamToken(`[FELIZ] ${replySpeech}`);
        }
      };

      let replyGenerated = false;

      // =======================================================================
      // TIER 1: Gemini 3.1 Flash-Lite (Primário)
      // =======================================================================
      if (hasGeminiKey && !isGemini31Locked() && !isGroqSelected && !isLocalSelected) {
        activeBrainLabel = 'GEMINI:gemini-3.1-flash-lite';
        try {
          await streamGeminiRequest(
            messagesPayload,
            {
              overrideModel: 'gemini-3.1-flash-lite',
              screenshotBase64,
              images: visionImages.length > 0 ? visionImages : (extraOpts?.images || []),
              pdfBase64: extraOpts?.pdfBase64 || null,
              onFunctionCall: handleFunctionCall,
              forceFunctionName: forcedCalendarTool,
            },
            onStreamToken
          );
          if (pendingAsyncToolPromise) {
            try { await pendingAsyncToolPromise; } catch (toolErr) { console.warn('[CalendarScheduler] Erro:', toolErr); }
          }
          replyGenerated = true;
        } catch (err31) {
          if (sessionId !== state.speechSessionId) return;
          const is429 = /429|quota|resource_exhausted/i.test(err31.message);
          if (is429) {
            markGemini31QuotaExceeded(180000); // 3 minutos de cooldown
          }
          console.warn(`[TIER-1:GEMINI-3.1] Erro (${err31.message}); cascateando para Tier 2 (Gemini 3.5 Flash-Lite)...`);
        }
      }

      // =======================================================================
      // TIER 2: Gemini 3.5 Flash-Lite (Secundário)
      // =======================================================================
      if (!replyGenerated && hasGeminiKey && !isGemini35Locked() && !isGroqSelected && !isLocalSelected && rawReply.trim().length === 0) {
        activeBrainLabel = 'GEMINI:gemini-3.5-flash-lite';
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('✨', 'Gemini 3.5 Flash-Lite (Cascata)', 3000);
        }
        try {
          console.log('[TIER-2:GEMINI-3.5] Executando Gemini 3.5 Flash-Lite...');
          await streamGeminiRequest(
            messagesPayload,
            {
              overrideModel: 'gemini-3.5-flash-lite',
              screenshotBase64,
              images: visionImages.length > 0 ? visionImages : (extraOpts?.images || []),
              pdfBase64: extraOpts?.pdfBase64 || null,
              onFunctionCall: handleFunctionCall,
              forceFunctionName: forcedCalendarTool,
            },
            onStreamToken
          );
          if (pendingAsyncToolPromise) {
            try { await pendingAsyncToolPromise; } catch (toolErr) { console.warn('[CalendarScheduler] Erro:', toolErr); }
          }
          replyGenerated = true;
        } catch (err35) {
          if (sessionId !== state.speechSessionId) return;
          const is429 = /429|quota|resource_exhausted/i.test(err35.message);
          if (is429) {
            markGemini35QuotaExceeded(90000); // 1.5 minutos de cooldown
          }
          console.warn(`[TIER-2:GEMINI-3.5] Erro (${err35.message}); cascateando para Tier 3 (Groq LPU)...`);
        }
      }

      // =======================================================================
      // TIER 3: Groq Cloud LPU (Qwen 3.8 27B ~200ms)
      // =======================================================================
      if (!replyGenerated && (hasGroq || isGroqSelected) && !isLocalSelected && rawReply.trim().length === 0) {
        activeBrainLabel = 'GROQ-LPU';
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('⚡', 'Groq LPU (Contingência)', 3500);
        }
        try {
          console.log('[TIER-3:GROQ] Alternando para Groq LPU (qwen/qwen3.8-27b)...');
          await streamGroqChatRequest(messagesPayload, onStreamToken);
          replyGenerated = true;
        } catch (groqErr) {
          if (sessionId !== state.speechSessionId) return;
          console.warn(`[TIER-3:GROQ] Falha (${groqErr.message}); cascateando para Tier 4 (Ollama)...`);
        }
      }

      // =======================================================================
      // TIER 4: Llama / Qwen Local (Ollama)
      // =======================================================================
      if (!replyGenerated && rawReply.trim().length === 0) {
        activeBrainLabel = 'OLLAMA-LOCAL';
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('🦙', 'Llama/Qwen Local (Offline)', 3500);
        }
        try {
          console.log('[TIER-4:OLLAMA] Executando Ollama Local...');
          await streamOllamaRequest(
            {
              model: 'qwen3-vl:2b-instruct',
              keep_alive: '60m',
              stream: true,
              options: { num_ctx: 2048, num_predict: 120, temperature: 0.65 },
              messages: messagesPayload,
            },
            onStreamToken
          );
          replyGenerated = true;
        } catch (ollamaErr) {
          if (sessionId !== state.speechSessionId) return;
          console.warn(`[TIER-4:OLLAMA] Falha (${ollamaErr.message}).`);
        }
      }

      // Se todos os 4 tiers falharam
      if (!replyGenerated && rawReply.trim().length === 0) {
        const friendlyMsg = 'Ops, todos os meus canais de IA estão temporariamente ocupados. Me dá só 30 segundinhos para respirar que já volto ao normal!';
        setEmotion('SURPRISED', 4500);
        showBubble('Limite de IA', friendlyMsg, 5000);
        await speakText(friendlyMsg, 'SURPRISED', true);
        return;
      }

        if (sessionId !== state.speechSessionId) return;
        state.isScanningScreen = false;
        state.isThinking = false;

        if (!parsedEmotion) {
          parsedEmotion = detectFallbackSentiment(cleanDisplayReply);
          if (!state.trick && state.aiAction !== 'SLEEP') setEmotion(parsedEmotion, 6500);
        }

        if (pendingSentence.trim()) {
          const finalClause = pendingSentence.trim();
          sentenceQueue.push(finalClause);
          if (window.prefetchSentenceAudio) {
            window.prefetchSentenceAudio(finalClause);
          }
        }

        finalClean = cleanDisplayReply.trim();
        console.log(`[${activeBrainLabel}] Concluído (${Math.round(performance.now() - t0)}ms) [${parsedEmotion}]: ${finalClean}`);

        // Safety Net Determinístico do Google Agenda: se o usuário pediu para agendar e a IA não disparou o tool calling
        if (isCalendarScheduleIntent && !calendarScheduled && window.CalendarScheduler && typeof window.CalendarScheduler.parseScheduleDirectFromText === 'function') {
          try {
            console.warn('[CalendarScheduler] Safety net ativo: Disparando agendamento direto via parser determinístico...');
            const fallbackSched = window.CalendarScheduler.parseScheduleDirectFromText(effectiveUserText, finalClean);
            if (fallbackSched && fallbackSched.title && fallbackSched.start_time) {
              calendarScheduled = true;
              if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Agendando no Google Agenda...', 3200);
              window.CalendarScheduler.processScheduleCall(fallbackSched);
            }
          } catch (schedErr) {
            console.error('[CalendarScheduler] Erro no safety net de agendamento:', schedErr);
          }
        } else if (isCalendarQueryIntent && !calendarScheduled && window.CalendarScheduler && typeof window.CalendarScheduler.parseQueryDirectFromText === 'function') {
          try {
            console.warn('[CalendarScheduler] Safety net ativo: Consultando via parser determinístico direto...');
            const fallbackQuery = window.CalendarScheduler.parseQueryDirectFromText(effectiveUserText);
            calendarScheduled = true;
            if (typeof window.showActionBadge === 'function') window.showActionBadge('📅', 'Consultando Google Agenda...', 3200);
            window.CalendarScheduler.processQueryCall(fallbackQuery);
          } catch (queryErr) {
            console.error('[CalendarScheduler] Erro no safety net de consulta:', queryErr);
          }
        }

        if (finalClean) {
          if (!state.conversationalContinuity) state.conversationalContinuity = {};
          state.conversationalContinuity.lastUtterance = isContinuation ? unifiedCommand : cleanUser;
          state.conversationalContinuity.lastTimestamp = Date.now();
          state.conversationalContinuity.lastAssistantReply = finalClean;

          state.conversationHistory.push({ role: 'assistant', content: finalClean });
          if (state.conversationHistory.length > 12) {
            state.conversationHistory = [
              state.conversationHistory[0],
              ...state.conversationHistory.slice(-10),
            ];
          }
        }
      } catch (err) {
        if (sessionId !== state.speechSessionId) return;
        console.error('[AI] Erro:', err.message || err);
        state.isScanningScreen = false;
        state.isThinking = false;
        setEmotion('SAD', 4500);
        const errMsg = 'Ops, minha conexão deu uma piscadinha agora. Pode repetir para mim?';
        showBubble('BitBop', errMsg, 5000);
        sentenceQueue.push(errMsg);
      } finally {
        queueFinished = true;
      }

      await speechWorker;
      if (sessionId === state.speechSessionId) {
        state.isSpeaking = false;
        state.mouthOpen = 0;
        state.cooldownUntil = Date.now() + 380;
        if (!state.isUserSpeaking && typeof clearPreRoll === 'function') clearPreRoll();
        const bLabel = calendarScheduled ? 'Google Agenda 📅' : (keepHandled ? 'Google Keep 📝' : (memoryHandled ? 'Obsidian 🧠' : (state.studyMode ? 'Modo Estudo 📚' : 'BitBop')));
        const obsCount = (cognitiveContext && cognitiveContext.filesReadCount) ? cognitiveContext.filesReadCount : 0;
        showBubble(bLabel, cleanDisplayReply.trim() || 'Prontinho!', state.studyMode ? 9500 : 5500, needsVision, false, obsCount);
        if (obsCount > 0 && typeof window.showActionBadge === 'function') {
          window.showActionBadge('📚', `Lido do Obsidian (${obsCount} notas)`, 3500);
        }

        // Caminho Lento Assíncrono (Slow-Path): Enfileira o turno no MemoryExtractor
        if (window.MemoryExtractor && typeof window.MemoryExtractor.enqueueTurn === 'function') {
          const userUtterance = isContinuation ? unifiedCommand : cleanUser;
          window.MemoryExtractor.enqueueTurn({
            userTranscript: userUtterance,
            botResponse: finalClean || cleanDisplayReply.trim(),
            currentEmotion: parsedEmotion,
            activeWindowTitle: (window.state && window.state.desktop && window.state.desktop.activeTitle) || '',
            audioSource: (window.state && (window.state.studyMode || (/(?:youtube|netflix|spotify|twitch|vlc|player|video|coursera|udemy|aula|meet|teams|zoom)/i.test((window.state && window.state.desktop && window.state.desktop.activeTitle) || '') && !/^(?:bitbop|bit\s*bop|bop|stack|stackchan)\b/i.test(heardTranscript || '')))) ? 'midia_ambiente' : 'usuario_voz'
          });
          window.MemoryExtractor.triggerBackgroundExtractionIfIdle();
        }

        // NOVO: Hipocampo em Tempo Real (Parte 1 da Arquitetura Cognitiva - Diário Imediato)
        if (window.HippocampusLogger && typeof window.HippocampusLogger.recordConversationTurn === 'function') {
          const userUtterance = isContinuation ? unifiedCommand : cleanUser;
          const activeApp = (window.state && window.state.desktop && (window.state.desktop.activeApp || window.state.desktop.activeTitle)) || 'Desktop';
          window.HippocampusLogger.recordConversationTurn({
            userText: userUtterance,
            botReply: finalClean || cleanDisplayReply.trim(),
            emotion: parsedEmotion || 'NORMAL',
            appAtivo: activeApp,
            cognitiveContext: cognitiveContext
          }).catch(err => console.warn('[HIPOCAMPO] Erro em recordConversationTurn:', err));
        }
      }
    }

    // =========================================================================
    // 10B. COMENTÁRIOS PROATIVOS DE PROXIMIDADE AO EXPLORAR AS TELAS
    // =========================================================================
    let isRunningProximityCheck = false;

    function extractSubjectFromTitle(title, app = '') {
      let t = String(title || '').trim();
      t = t.replace(/^\(\d+\+?\)\s*/, '');
      let prev = '';
      while (prev !== t) {
        prev = t;
        t = t.replace(/\s*[-–—|]\s*(?:YouTube|Google Chrome|Mozilla Firefox|Microsoft Edge|Brave|Opera|Vivaldi|VLC media player|Visual Studio Code|VS Code|Antigravity|Notion|Obsidian)\s*$/i, '');
      }
      t = t.trim().toLowerCase();
      return t || (app ? app.toLowerCase() : 'desktop');
    }

    function findNearbyInterestingTarget() {
      const now = Date.now();
      state.commentedSubjects = state.commentedSubjects || new Map();

      // Limpeza inteligente: só descarta assunto do histórico se ele REALMENTE foi fechado/trocado há mais de 5 minutos!
      const currentOpenSubjects = new Set();
      if (state.desktop && state.desktop.activeTitle) {
        currentOpenSubjects.add(extractSubjectFromTitle(state.desktop.activeTitle, state.desktop.activeApp));
      }
      for (const w of ((state.desktop && state.desktop.windows) || [])) {
        if (w.title) currentOpenSubjects.add(extractSubjectFromTitle(w.title, w.app));
      }
      for (const [sub, ts] of state.commentedSubjects.entries()) {
        if (!currentOpenSubjects.has(sub) && (now - ts > 300000)) {
          state.commentedSubjects.delete(sub);
        }
      }

      for (const [k, ts] of state.commentedTargets.entries()) {
        if (now - ts > 360000) state.commentedTargets.delete(k);
      }

      const centerX = state.x + PET_W / 2;
      const footY = state.y + PET_H;
      const curDisp = getDisplayAt(centerX);

      // 1) Está em pé no topo de alguma janela aberta?
      for (const ledge of ((state.desktop && state.desktop.ledges) || [])) {
        if (centerX >= ledge.x && centerX <= ledge.x + ledge.w && Math.abs(footY - ledge.y) <= 14) {
          const subject = extractSubjectFromTitle(ledge.title, ledge.app);
          const key = `ledge|${ledge.app}|${(ledge.title || '').slice(0, 48)}`;
          if (state.commentedSubjects.has(subject)) {
            return { alreadyCommented: true, subject, screenLabel: curDisp.label };
          }
          if (!state.commentedTargets.has(key)) {
            return {
              key,
              subject,
              screenLabel: curDisp.label,
              desc: `em cima do topo da janela "${ledge.title}" (${ledge.app || 'aplicativo'}) na ${curDisp.label}`,
            };
          }
        }
      }

      // 2) Chegou pertinho / embaixo de alguma janela visível neste monitor?
      for (const win of ((state.desktop && state.desktop.windows) || [])) {
        if (win.screenIndex === curDisp.index) {
          const nearHoriz = centerX >= win.x - 110 && centerX <= win.x + win.w + 110;
          const nearVert = footY >= win.y - 40 && state.y <= win.y + win.h + 90;
          if (nearHoriz && nearVert && win.title) {
            const subject = extractSubjectFromTitle(win.title, win.app);
            const key = `win|${curDisp.index}|${win.app}|${win.title.slice(0, 48)}`;
            if (state.commentedSubjects.has(subject)) {
              return { alreadyCommented: true, subject, screenLabel: curDisp.label };
            }
            if (!state.commentedTargets.has(key)) {
              return {
                key,
                subject,
                screenLabel: curDisp.label,
                desc: `pertinho da janela aberta "${win.title}" (${win.app || 'aplicativo'}) na ${curDisp.label}`,
              };
            }
          }
        }
      }

      // 3) Passeou pela tela: verifica o assunto principal desta tela
      const winsOnThisDisp = ((state.desktop && state.desktop.windows) || []).filter((w) => w.screenIndex === curDisp.index && w.title);
      let screenSubject = null;
      if (winsOnThisDisp.length > 0) {
        winsOnThisDisp.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        screenSubject = extractSubjectFromTitle(winsOnThisDisp[0].title, winsOnThisDisp[0].app);
      } else {
        screenSubject = `desktop_wallpaper_${curDisp.index}`;
      }

      // Se o assunto principal desta tela já foi comentado, NÃO comenta por spot genérico!
      if (screenSubject && state.commentedSubjects.has(screenSubject)) {
        return { alreadyCommented: true, subject: screenSubject, screenLabel: curDisp.label };
      }

      const regionBucket = Math.floor((centerX - curDisp.x) / Math.max(480, curDisp.w / 2));
      const spotKey = `spot|${curDisp.index}|${regionBucket}`;
      if (!state.commentedTargets.has(spotKey)) {
        return {
          key: spotKey,
          subject: screenSubject,
          screenLabel: curDisp.label,
          desc: `passeando pela ${curDisp.label} perto dos conteúdos visíveis ao seu redor`,
        };
      }

      return null;
    }

    async function maybeCommentOnNearbyThing() {
      if (isRunningProximityCheck) return;
      if (!prefs.proximityChat || !state.servicesReady) return;
      if (state.isDragging || state.isResizing || !state.onGround) return;
      if (state.trick || state.commandedWalk || Date.now() < state.followMouseUntil) return;
      if (state.isSpeaking || state.isThinking || state.isTranscribing || state.isUserSpeaking || state.settingsOpen) return;
      if (state.aiAction === 'WALK' || state.aiAction === 'SLEEP') return;

      const now = Date.now();
      if (now - bootStartedAt < 12000) return; // Aguarda 12s após abrir
      if (now - state.lastProximityCommentAt < 42000) return; // Cooldown natural de ~42s entre comentários espontâneos
      if (now - state.cooldownUntil < 8000) return; // Não atropela fim de conversa recente

      const target = findNearbyInterestingTarget();
      if (!target || !ipcRenderer) return;

      // Se o mesmo assunto/vídeo já foi comentado, apenas olha curioso e NÃO fala nada!
      if (target.alreadyCommented) {
        state.lastProximityCommentAt = now;
        if (!state.isSpeaking && !state.isThinking && !state.isScanningScreen) {
          setEmotion('CURIOUS', 2400);
          if (CuteSynth && typeof CuteSynth.curious === 'function') CuteSynth.curious();
        }
        console.log(`[PROXIMITY] Assunto "${target.subject}" na ${target.screenLabel} já comentado. Olhando sem falar nada.`);
        return;
      }

      isRunningProximityCheck = true;
      state.lastProximityCommentAt = now;
      state.commentedTargets.set(target.key, now);
      if (target.subject) {
        state.commentedSubjects.set(target.subject, now);
      }

      const sessionId = ++state.speechSessionId;
      const centerX = Math.round(state.x + PET_W / 2);
      const centerY = Math.round(state.y + PET_H * 0.5);

      try {
        setEmotion('CURIOUS', 6000);
        CuteSynth.curious();
        spawnParticle('👀', 0, 10);

        const snap = await ipcRenderer.invoke('capture-desktop', {
          mode: 'around-pet',
          petX: centerX,
          petY: centerY,
          width: 960,
          height: 540,
          quality: 76,
        });

        if (sessionId !== state.speechSessionId || state.isUserSpeaking) return;

        const proximityImages = [];
        if (snap?.cropBase64Jpeg) {
          proximityImages.push({ label: `Zoom bem ao redor do BitBop na ${target.screenLabel}`, base64Jpeg: snap.cropBase64Jpeg });
        }
        if (snap?.base64Jpeg) {
          proximityImages.push({ label: `Visão completa da ${target.screenLabel}`, base64Jpeg: snap.base64Jpeg });
        }
        if (proximityImages.length === 0) return;

        const promptText =
          `[OBSERVAÇÃO ESPONTÂNEA AO CAMINHAR]: Você acabou de andar sozinho até ficar ${target.desc}. ` +
          `Olhe as imagens (o zoom pertinho de você e a tela onde você está) e faça UM comentário espontâneo, curtinho (1 ou 2 frases rápidas), espirituoso, observador e fofo sobre o que você encontrou bem aí perto de você! ` +
          `Não cumprimente com "Oi", fale direto como quem acabou de notar algo interessante ali do lado.`;

        const messagesPayload = [
          state.conversationHistory[0],
          { role: 'user', content: promptText, images: [snap.cropBase64Jpeg || snap.base64Jpeg] },
        ];

        const sentenceQueue = [];
        let queueFinished = false;
        let parsedEmotion = null;
        let rawReply = '';
        let cleanDisplayReply = '';
        let pendingSentence = '';

        const speechWorker = (async () => {
          while ((!queueFinished || sentenceQueue.length > 0) && sessionId === state.speechSessionId) {
            if (sentenceQueue.length > 0) {
              const nextSentence = sentenceQueue.shift();
              state.isSpeaking = true;
              await playSingleSentenceStream(nextSentence, sessionId);
            } else {
              await new Promise((r) => setTimeout(r, 25));
            }
          }
        })();

        const onStreamToken = (token) => {
          if (sessionId !== state.speechSessionId) return;
          rawReply += token;
          if (!parsedEmotion) {
            const tagMatch = rawReply.match(/^\s*\[([A-ZÀ-Ÿ_]+)\]\s*/i);
            if (tagMatch) parsedEmotion = applyEmotionFromTag(tagMatch[1].toUpperCase());
          }
          const prevLen = cleanDisplayReply.length;
          cleanDisplayReply = extractCleanVisibleText(rawReply);
          if (cleanDisplayReply.length > prevLen) {
            pendingSentence += cleanDisplayReply.slice(prevLen);
            showBubble(`Explorando 👀`, cleanDisplayReply.trim(), 0, true);
            const match = pendingSentence.match(/^([\s\S]*?[.!?…]+)(\s+|$)/);
            if (match && match[1].trim().length >= 8) {
              sentenceQueue.push(match[1].trim());
              pendingSentence = pendingSentence.slice(match[0].length);
            }
          }
        };

        const wantGemini = prefs.aiProvider === 'gemini' && Boolean((prefs.geminiApiKey || '').trim());
        try {
          if (wantGemini) {
            const proxModel = !isGemini31Locked() ? 'gemini-3.1-flash-lite' : (!isGemini35Locked() ? 'gemini-3.5-flash-lite' : null);
            if (!proxModel) {
              console.log('[PROXIMITY] Ignorado: Ambos Gemini 3.1 e 3.5 em cooldown de cota.');
              return;
            }
            await streamGeminiRequest(
              messagesPayload,
              { overrideModel: proxModel, images: proximityImages, maxOutputTokens: 120, enableTools: false },
              onStreamToken
            );
          } else {
            await streamOllamaRequest(
              {
                model: 'qwen3-vl:2b-instruct',
                keep_alive: '30m',
                stream: true,
                options: { num_ctx: 2048, num_predict: 80, temperature: 0.68 },
                messages: messagesPayload,
              },
              onStreamToken
            );
          }
          if (sessionId !== state.speechSessionId) return;
          if (pendingSentence.trim()) sentenceQueue.push(pendingSentence.trim());
          const finalClean = cleanDisplayReply.trim();
          if (finalClean) {
            console.log(`[PROXIMITY] Comentou (${target.key}): "${finalClean}"`);
            if (target.subject) {
              state.commentedSubjects.set(target.subject, Date.now());
            }
            state.conversationHistory.push({ role: 'assistant', content: finalClean });
            if (state.conversationHistory.length > 12) {
              state.conversationHistory = [state.conversationHistory[0], ...state.conversationHistory.slice(-10)];
            }
          }
        } finally {
          queueFinished = true;
        }

        await speechWorker;
        if (sessionId === state.speechSessionId) {
          state.isSpeaking = false;
          state.mouthOpen = 0;
          state.cooldownUntil = Date.now() + 380;
          if (!state.isUserSpeaking && typeof clearPreRoll === 'function') clearPreRoll();
          if (cleanDisplayReply.trim()) {
            showBubble('Explorando 👀', cleanDisplayReply.trim(), 5200, true);
          }
        }
      } catch (err) {
        if (sessionId === state.speechSessionId) {
          console.warn('[PROXIMITY] Ignorado:', err.message);
        }
      } finally {
        isRunningProximityCheck = false;
      }
    }

    // Substituído na Fase 6 pelo ScreenObserver inteligente periódico (~5 min)
    if (typeof window !== 'undefined' && window.ScreenObserver && typeof window.ScreenObserver.init === 'function') {
      window.ScreenObserver.init({
        intervalMinutes: (typeof prefs !== 'undefined' && prefs.observerInterval) || 5,
        maxReaction: (typeof prefs !== 'undefined' && prefs.observerMaxReaction) || 'all'
      });
    } else {
      setInterval(maybeCommentOnNearbyThing, 3000);
    }


// Globais exportadas para window
window.handleUserMessage = handleUserMessage;
window.executePetAction = executePetAction;
