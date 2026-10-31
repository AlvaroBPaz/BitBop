    const nodeHttp = (typeof require !== 'undefined')
      ? (() => { try { return require('http'); } catch { return null; } })()
      : null;

    const nodeHttps = (typeof require !== 'undefined')
      ? (() => { try { return require('https'); } catch { return null; } })()
      : null;

    const nodeFs = (typeof require !== 'undefined')
      ? (() => { try { return require('fs'); } catch { return null; } })()
      : null;

    const nodePath = (typeof require !== 'undefined')
      ? (() => { try { return require('path'); } catch { return null; } })()
      : null;

    const ipcRenderer = (typeof require !== 'undefined')
      ? (() => { try { return require('electron').ipcRenderer; } catch { return null; } })()
      : null;

    const electronShell = (typeof require !== 'undefined')
      ? (() => { try { return require('electron').shell; } catch { return null; } })()
      : null;

    const electronWebUtils = (typeof require !== 'undefined')
      ? (() => { try { return require('electron').webUtils; } catch { return null; } })()
      : null;

    // =========================================================================
    // 2. PREFERÊNCIAS PERSISTENTES & ESTADO GLOBAL
    // =========================================================================
    const VOICE_Samples = {
      cyborg_optimus: 'Sistemas cibernéticos online. Núcleo Alpha pronto para compilar e processar.',
      soundwave: 'Soundwave reportando. Comunicação sintetizada calibrada com sucesso.',
      androide_cyber: 'Protocolo de androide tático operacional. Iniciando assistência.',
      hal9000: 'Boa noite. Sou a inteligência artificial HAL. Todas as funções operando perfeitamente.',
      protocol_droid: 'Saudações! Sou fluente em mais de seis milhões de linguagens de programação.',
      geth_legion: 'Nós somos Legion. Consenso sintético estabelecido na rede local.',
      titan_dreadnought: 'Reator ativado. Unidade mecha pronta para execução massiva.',
      jarvis_cyber: 'Boa noite. Sistemas online. Em que posso auxiliá-lo em engenharia hoje?',
      antonio: 'Olá! Sou o Antonio. Pronto para analisar arquitetura e código hoje?',
      brian: 'Sistemas prontos. Sou o Brian, sua IA executiva de suporte aos estudos.',
      andrew: 'Fala aí! Sou o Andrew. Bora codar e resolver esse desafio juntos!',
      thalita: 'Olá! Sou a Thalita. Que bom estudar engenharia de software com você!',
      francisca: 'Oi! Sou a Francisca. Estou aqui do seu lado para qualquer dúvida.',
      emma: 'Oi! Sou a Emma. Adoro revisar códigos e aprender novas tecnologias!',
      ava: 'Análise de raciocínio lógico iniciada. Sou a Ava, pronta para os estudos.',
      stackchan: 'Oi! Eu sou o BitBop, adoro passear na sua área de trabalho!',
      robozinho: 'Opa! Bora explorar sua tela e revisar seus estudos!',
      // retrocompatibilidade
      cyber_bot: 'Sistemas cibernéticos online. Núcleo Alpha pronto para compilar.',
      mecha_chan: 'Soundwave reportando. Comunicação sintetizada calibrada com sucesso.',
      retro_robot: 'Boa noite. Sou a inteligência artificial HAL. Funções operando.',
      jarvis: 'Boa noite. Sistemas online. Em que posso auxiliá-lo em engenharia hoje?'
    };

    const GEMINI_CONFIG_FILE = (nodePath && typeof __dirname !== 'undefined')
      ? nodePath.join(__dirname, '.gemini-config.json')
      : null;

    function loadAiConfigFromDisk() {
      if (!nodeFs || !GEMINI_CONFIG_FILE) return {};
      try {
        if (nodeFs.existsSync(GEMINI_CONFIG_FILE)) {
          return JSON.parse(nodeFs.readFileSync(GEMINI_CONFIG_FILE, 'utf8')) || {};
        }
      } catch (err) {
        console.warn('[CONFIG] Erro ao ler .gemini-config.json:', err.message);
      }
      return {};
    }

    const diskAiCfg = loadAiConfigFromDisk();
    const PRESET_GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    const rawSavedModel = diskAiCfg.geminiModel || localStorage.getItem('sc_gemini_model') || 'gemini-3.1-flash-lite';
    const initialSavedModel = rawSavedModel === 'gemini-2.5-flash' ? 'gemini-3.5-flash' : rawSavedModel;
    const isInitialCustomModel = !PRESET_GEMINI_MODELS.includes(initialSavedModel);

    const savedScaleRaw = parseFloat(diskAiCfg.petScale ?? localStorage.getItem('sc_pet_scale') ?? '1');
    const initialPetScale = Number.isFinite(savedScaleRaw) ? Math.max(0.38, Math.min(1.35, savedScaleRaw)) : 1.0;

    const prefs = {
      aiProvider: diskAiCfg.aiProvider || localStorage.getItem('sc_ai_provider') || 'gemini',
      geminiModelSelect: isInitialCustomModel ? 'custom' : initialSavedModel,
      geminiCustomModel: isInitialCustomModel ? initialSavedModel : (localStorage.getItem('sc_gemini_custom_model') || ''),
      geminiApiKey: diskAiCfg.geminiApiKey || localStorage.getItem('sc_gemini_key') || '',
      groqApiKey: diskAiCfg.groqApiKey || localStorage.getItem('sc_groq_key') || '',
      sttMode: diskAiCfg.sttMode || localStorage.getItem('sc_stt_mode') || 'groq-whisper-v3',
      voice: diskAiCfg.voice || localStorage.getItem('sc_voice') || 'protocol_droid',
      skin: localStorage.getItem('sc_skin') || 'classic',
      petScale: initialPetScale,
      roamEnabled: diskAiCfg.roamEnabled !== undefined ? Boolean(diskAiCfg.roamEnabled) : (localStorage.getItem('sc_roam') !== 'false'),
      proximityChat: diskAiCfg.proximityChat !== undefined ? Boolean(diskAiCfg.proximityChat) : (localStorage.getItem('sc_proximity_chat') !== 'false'),
      bargeInEnabled: diskAiCfg.bargeInEnabled !== undefined ? Boolean(diskAiCfg.bargeInEnabled) : (localStorage.getItem('sc_barge_in') !== 'false'),
      sfxEnabled: localStorage.getItem('sc_sfx') !== 'false',
      micEnabled: localStorage.getItem('sc_mic') !== 'false',
      autoCurious: localStorage.getItem('sc_curious') !== 'false',
      bubbleEnabled: diskAiCfg.bubbleEnabled !== undefined ? Boolean(diskAiCfg.bubbleEnabled) : (localStorage.getItem('sc_show_bubble') !== 'false'),
      voiceEnabled: diskAiCfg.voiceEnabled !== undefined ? Boolean(diskAiCfg.voiceEnabled) : (localStorage.getItem('sc_voice_output') !== 'false'),
      personality: diskAiCfg.personality || localStorage.getItem('sc_personality') || 'engenharia_software',
      customPersonality: diskAiCfg.customPersonality || localStorage.getItem('sc_custom_personality') || '',
      micSensitivity: diskAiCfg.micSensitivity || localStorage.getItem('sc_mic_sens') || 'media',
      studyMode: diskAiCfg.studyMode !== undefined ? Boolean(diskAiCfg.studyMode) : (localStorage.getItem('sc_study_mode') === 'true'),
      googleCalendarWebhookUrl: diskAiCfg.googleCalendarWebhookUrl || localStorage.getItem('sc_gcal_webhook') || '',
      googleKeepWebhookUrl: diskAiCfg.googleKeepWebhookUrl || localStorage.getItem('sc_keep_webhook') || '',
      observerInterval: diskAiCfg.observerInterval || parseInt(localStorage.getItem('sc_observer_interval') || '5', 10),
      observerMaxReaction: diskAiCfg.observerMaxReaction || localStorage.getItem('sc_observer_max_reaction') || 'all',
      biometricsRestricted: diskAiCfg.biometricsRestricted !== undefined ? Boolean(diskAiCfg.biometricsRestricted) : (localStorage.getItem('sc_biometrics_restricted') === 'true'),
    };

    function getEffectiveGeminiModel() {
      if (prefs.geminiModelSelect === 'custom') {
        return (prefs.geminiCustomModel || '').trim() || 'gemini-3.1-flash-lite';
      }
      return prefs.geminiModelSelect || 'gemini-3.1-flash-lite';
    }

    function getEffectiveSttMode() {
      const canUseGeminiAudio = prefs.aiProvider === 'gemini' && Boolean((prefs.geminiApiKey || '').trim());
      const canUseGroq = Boolean((prefs.groqApiKey || '').trim());
      const mode = prefs.sttMode || (canUseGroq ? 'groq-whisper-v3' : 'gemini-audio');
      if (mode.startsWith('groq-') && !canUseGroq) {
        return canUseGeminiAudio ? 'gemini-audio' : 'whisper-turbo';
      }
      if (mode === 'gemini-audio' && !canUseGeminiAudio) {
        return canUseGroq ? 'groq-whisper-v3' : 'whisper-turbo';
      }
      return mode;
    }

    function saveAiConfigToDisk() {
      const effectiveModel = getEffectiveGeminiModel();
      localStorage.setItem('sc_ai_provider', prefs.aiProvider);
      localStorage.setItem('sc_gemini_model', effectiveModel);
      localStorage.setItem('sc_gemini_custom_model', prefs.geminiCustomModel || '');
      localStorage.setItem('sc_gemini_key', prefs.geminiApiKey || '');
      localStorage.setItem('sc_groq_key', prefs.groqApiKey || '');
      localStorage.setItem('sc_stt_mode', prefs.sttMode || 'groq-whisper-v3');
      localStorage.setItem('sc_pet_scale', `${prefs.petScale}`);
      localStorage.setItem('sc_roam', `${prefs.roamEnabled}`);
      localStorage.setItem('sc_proximity_chat', `${prefs.proximityChat}`);
      localStorage.setItem('sc_barge_in', `${prefs.bargeInEnabled}`);
      localStorage.setItem('sc_show_bubble', `${prefs.bubbleEnabled}`);
      localStorage.setItem('sc_voice_output', `${prefs.voiceEnabled}`);
      localStorage.setItem('sc_voice', prefs.voice || 'protocol_droid');
      localStorage.setItem('sc_personality', prefs.personality);
      localStorage.setItem('sc_custom_personality', prefs.customPersonality || '');
      localStorage.setItem('sc_mic_sens', prefs.micSensitivity || 'media');
      localStorage.setItem('sc_study_mode', `${Boolean(prefs.studyMode)}`);
      localStorage.setItem('sc_gcal_webhook', prefs.googleCalendarWebhookUrl || '');
      localStorage.setItem('sc_keep_webhook', prefs.googleKeepWebhookUrl || '');
      localStorage.setItem('sc_observer_interval', `${prefs.observerInterval || 5}`);
      localStorage.setItem('sc_observer_max_reaction', prefs.observerMaxReaction || 'all');
      localStorage.setItem('sc_biometrics_restricted', `${Boolean(prefs.biometricsRestricted)}`);
      if (nodeFs && GEMINI_CONFIG_FILE) {
        try {
          nodeFs.writeFileSync(
            GEMINI_CONFIG_FILE,
            JSON.stringify(
              {
                aiProvider: prefs.aiProvider,
                geminiModel: effectiveModel,
                geminiApiKey: (prefs.geminiApiKey || '').trim(),
                groqApiKey: (prefs.groqApiKey || '').trim(),
                sttMode: prefs.sttMode || 'groq-whisper-v3',
                petScale: Number(prefs.petScale.toFixed(2)),
                roamEnabled: prefs.roamEnabled,
                proximityChat: prefs.proximityChat,
                bargeInEnabled: prefs.bargeInEnabled,
                bubbleEnabled: prefs.bubbleEnabled,
                voiceEnabled: prefs.voiceEnabled,
                voice: prefs.voice || 'protocol_droid',
                personality: prefs.personality,
                customPersonality: prefs.customPersonality || '',
                micSensitivity: prefs.micSensitivity || 'media',
                studyMode: Boolean(prefs.studyMode),
                googleCalendarWebhookUrl: (prefs.googleCalendarWebhookUrl || '').trim(),
                googleKeepWebhookUrl: (prefs.googleKeepWebhookUrl || '').trim(),
                observerInterval: prefs.observerInterval || 5,
                observerMaxReaction: prefs.observerMaxReaction || 'all',
              },
              null,
              2
            ),
            'utf8'
          );
        } catch (err) {
          console.warn('[CONFIG] Erro ao salvar .gemini-config.json:', err.message);
        }
      }
    }

    const PET_W = 184;
    const PET_H = 170;
    const bootStartedAt = Date.now();

    function buildSystemPrompt() {
      // Se o Perfil de Estudo (Study Mode) estiver ativo, utiliza estritamente o System Prompt acadêmico/técnico focado!
      const isStudyActive = Boolean(prefs.studyMode) || (window.StudyModeModule && typeof window.StudyModeModule.isActive === 'function' && window.StudyModeModule.isActive());
      if (isStudyActive && window.StudyModeModule && typeof window.StudyModeModule.getSystemPrompt === 'function') {
        return window.StudyModeModule.getSystemPrompt();
      }

      let roleSpecific = '';
      // 1. Consulta PersonalityEngine para bloco determinístico de faixas em 0ms
      if (typeof window !== 'undefined' && window.PersonalityEngine && typeof window.PersonalityEngine.renderBlock === 'function') {
        const block = window.PersonalityEngine.renderBlock({ personaId: prefs.personality });
        if (block) {
          roleSpecific = block.trim() + ' ';
        }
      }

      // 2. Fallbacks de segurança se o motor ainda estiver inicializando
      if (!roleSpecific) {
        if (typeof window !== 'undefined' && window.PersonalityStore && typeof window.PersonalityStore.getPersonaStylePrompt === 'function') {
          const storePrompt = window.PersonalityStore.getPersonaStylePrompt(prefs.personality);
          if (storePrompt) {
            roleSpecific = storePrompt.trim() + ' ';
          }
        }
      }

      if (!roleSpecific) {
        if (prefs.personality === 'engenharia_software') {
        roleSpecific =
          'PAPEL DE MENTOR DE ENGENHARIA DE SOFTWARE: O usuário está cursando e estudando Engenharia de Software! ' +
          'Seja o melhor mentor possível: didático, encorajador, perspicaz e prático. ' +
          'Explique conceitos técnicos com clareza cristalina e analogias brilhantes (Arquitetura de Software, Clean Architecture, Microsserviços, Design Patterns GoF, SOLID, complexidade Big-O, Algoritmos, Estruturas de Dados, Bancos de Dados, Clean Code e testes). ' +
          'Quando o usuário te alimentar com arquivos de código (via drag-and-drop) ou fizer perguntas de programação, analise a lógica, aponte boas práticas e sugira 1 reflexão ou pergunta curta de fixação para ajudá-lo a aprender de verdade! ';
      } else if (prefs.personality === 'gamer') {
        roleSpecific =
          'PAPEL GAMER & RAID CO-PILOT: Você é o copiloto tático e fã número 1 das jogatinas do usuário (especialmente Arena Breakout Infinite e jogos de sobrevivência/ação). ' +
          'Comemore vitórias, comente itens dropados e traga energia animada de companheiro de raid! ';
      } else if (prefs.personality === 'cyberpunk') {
        roleSpecific =
          'PAPEL HACKER & ARQUITETO CYBERPUNK: Você é uma IA cyberpunk, objetiva, fascinada por sistemas operacionais, concorrência, baixo nível e código de alta performance. ';
      } else if (prefs.personality === 'custom' && (prefs.customPersonality || '').trim()) {
        roleSpecific = `DIRETRIZ DE PERSONALIDADE PERSONALIZADA PELO USUÁRIO: ${prefs.customPersonality.trim()} `;
      }
      }

      return (
        'Você é o BitBop, um pequeno robô companheiro vivo, super inteligente, bem-humorado, afetuoso e perspicaz que mora e caminha livremente por TODAS as telas (monitores) da área de trabalho do PC do usuário no Brasil. ' +
        'Nunca diga que é IA, assistente virtual, Gemini ou Qwen: você é o próprio BitBop! ' +
        roleSpecific +
        'SEMPRE que o usuário pedir uma ação física, truque, movimento de tela, dança, pose, mudança de tamanho/cor ou modo de fala/balão, inclua NO INÍCIO da resposta uma tag [ACAO:CODIGO] dentre: ' +
        '[ACAO:IR_DIREITA], [ACAO:IR_ESQUERDA], [ACAO:TROCAR_TELA], [ACAO:VIR_MOUSE], [ACAO:SEGUIR_MOUSE], [ACAO:PARAR_AQUI], [ACAO:EXPLORAR_LIVRE], ' +
        '[ACAO:DANCAR], [ACAO:MORTAL], [ACAO:PIRUETA], [ACAO:MOONWALK], [ACAO:COMEMORAR], [ACAO:ESCONDER], [ACAO:FINGIR_MORTO], [ACAO:CORRER_TURBO], ' +
        '[ACAO:CANTAR], [ACAO:MODO_COMBATE], [ACAO:MANDAR_BEIJO], [ACAO:PULAR_ALTO], [ACAO:MODO_MINI], [ACAO:MODO_GIGANTE], [ACAO:TAMANHO_NORMAL], ' +
        '[ACAO:MODO_RGB], [ACAO:DORMIR_AGORA], [ACAO:ACORDAR], [ACAO:MODO_SEM_BALAO] (falar só por voz sem caixa de diálogo), [ACAO:MODO_COM_BALAO], [ACAO:MODO_SEM_VOZ] (ficar mudo/apenas balão de texto), [ACAO:MODO_COM_VOZ] ou [ACAO:MODO_VOZ_E_BALAO] (padrão com ambos). ' +
        'OBRIGATÓRIO: inclua também no início UMA tag de emoção dentre: [FELIZ], [EMPOLGADO], [AMOR], [CURIOSO], [TRISTE], [BRAVO], [SURPRESO], [RISO] ou [ESTILOSO]. ' +
        'Fale SEMPRE em português brasileiro natural, fluido e expressivo, ideal para ser falado em voz alta (1 a 3 frases concisas e cheias de personalidade, sem listas, sem asteriscos de markdown e sem emojis). ' +
        'Quando receber arquivos arrastados para você ou capturas de tela, comente com inteligência e personalidade!'
      );
    }

    function rebuildSystemPrompt() {
      if (state.conversationHistory && state.conversationHistory.length > 0 && state.conversationHistory[0].role === 'system') {
        state.conversationHistory[0].content = buildSystemPrompt();
      }
    }

    const state = {
      servicesReady: false,
      studyMode: Boolean(prefs.studyMode),
      emotion: 'NORMAL',
      emotionUntil: 0,
      isBlinking: false,
      isSpeaking: false,
      isThinking: false,
      isTranscribing: false,
      isUserSpeaking: false,
      isScanningScreen: false,
      settingsOpen: false,
      cooldownUntil: 0,
      speechSessionId: 0,
      mouthOpen: 0,
      lastInteractionAt: Date.now(),

      // Topologia Multi-Monitores
      topologyLoaded: false,
      displays: [],
      lastDisplayIndex: 1,
      lastScreenSwitchAt: 0,

      // Física & Caminhada na Área de Trabalho (Multi-Telas)
      x: Math.max(80, window.innerWidth - 260),
      y: window.innerHeight - PET_H,
      vx: 0,
      vy: 0,
      onGround: true,
      isDragging: false,
      isResizing: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
      lastDragX: 0,
      lastDragTime: 0,
      shakeEnergy: 0,

      // Comportamento autônomo, Coreografias & Ações Comandadas
      aiAction: 'IDLE', // 'IDLE' | 'WALK' | 'SIT' | 'SLEEP'
      walkDir: -1,
      walkTargetX: null,
      walkStartedAt: 0,
      commandedWalk: null, // { targetX, speed, hopStride, startedAt, onArriveAction }
      followMouseUntil: 0,
      trick: null,         // { type, start, duration, dir, stepTick, origSkin }
      scaleAnim: null,     // { from, to, start, duration }
      nextAiDecisionAt: 0,
      walkCycle: 0,
      squashX: 1,
      squashY: 1,
      bodyTiltDeg: 0,

      // Comentários proativos de proximidade
      lastProximityCommentAt: 0,
      commentedTargets: new Map(),

      // Olhar 2.5D
      mouseScreenX: window.innerWidth / 2,
      mouseScreenY: window.innerHeight / 2,
      lookTarget: { x: 0, y: 0 },
      currentLook: { x: 0, y: 0 },

      // Carinho & Cutucões
      patEnergy: 0,
      lastPatSoundAt: 0,
      lastPatSpeechAt: 0,
      pokeTimestamps: [],

      // Contexto vivo da Área de Trabalho (Todas as Telas)
      desktop: {
        activeTitle: '',
        activeApp: '',
        openWindows: [],
        windows: [],
        ledges: []
      },
      lastSeenActiveApp: '',

      // Cerebro e Memoria Continua (Obsidian Vault)
      privateMode: false,
      isSensitiveWindow: false,
      lastUserInteractionAt: Date.now(),
      dailyInitiativeCount: 0,
      maxDailyInitiatives: 3,

      conversationHistory: [
        {
          role: 'system',
          content: buildSystemPrompt()
        }
      ]
    };

    // Helpers de Multi-Monitores
    function getEffectiveDisplays() {
      if (state.displays && state.displays.length > 0) return state.displays;
      return [{
        index: 1,
        label: 'Tela Principal',
        isPrimary: true,
        x: 0,
        y: 0,
        w: window.innerWidth,
        h: window.innerHeight,
        floorY: window.innerHeight,
      }];
    }

    function getDisplayAt(stageX) {
      const list = getEffectiveDisplays();
      const exact = list.find((d) => stageX >= d.x && stageX < d.x + d.w);
      if (exact) return exact;
      let best = list[0];
      let bestDist = Infinity;
      for (const d of list) {
        const cx = d.x + d.w / 2;
        const dist = Math.abs(stageX - cx);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      return best;
    }

    function getStageTotalWidth() {
      const list = getEffectiveDisplays();
      let maxRight = window.innerWidth;
      for (const d of list) {
        if (d.x + d.w > maxRight) maxRight = d.x + d.w;
      }
      return maxRight;
    }

    // Elementos DOM
    const actorRoot = document.getElementById('actorRoot');
    const petScaleWrap = document.getElementById('petScaleWrap');
    const petRig = document.getElementById('petRig');
    const chassis = document.getElementById('chassis');
    const resizeGrip = document.getElementById('resizeGrip');
    const oledScreen = document.getElementById('oledScreen');
    const scanBeam = document.getElementById('scanBeam');
    const headPatZone = document.getElementById('headPatZone');
    const speechBubble = document.getElementById('speechBubble');
    const speakerLabel = document.getElementById('speakerLabel');
    const visionBadge = document.getElementById('visionBadge');
    const speechText = document.getElementById('speechText');
    const fxLayer = document.getElementById('fxLayer');

    const blushGroup = document.getElementById('blushGroup');
    const leftBrow = document.getElementById('leftBrow');
    const rightBrow = document.getElementById('rightBrow');
    const leftEyeSlot = document.getElementById('leftEyeSlot');
    const rightEyeSlot = document.getElementById('rightEyeSlot');
    const leftEyeMain = document.getElementById('leftEyeMain');
    const rightEyeMain = document.getElementById('rightEyeMain');
    const leftEyeGlint = document.getElementById('leftEyeGlint');
    const rightEyeGlint = document.getElementById('rightEyeGlint');
    const leftEyeShape = document.getElementById('leftEyeShape');
    const rightEyeShape = document.getElementById('rightEyeShape');
    const leftTear = document.getElementById('leftTear');
    const rightTear = document.getElementById('rightTear');
    const mouthSlot = document.getElementById('mouthSlot');
    const mouthPath = document.getElementById('mouthPath');
    const mouthTalkRect = document.getElementById('mouthTalkRect');
    const thinkDots = document.getElementById('thinkDots');
    const footLeft = document.getElementById('footLeft');
    const footRight = document.getElementById('footRight');

    const btnBezelMic = document.getElementById('btnBezelMic');
    const btnBezelSettings = document.getElementById('btnBezelSettings');
    const chkStudyMode = document.getElementById('chkStudyMode');
    const btnToggleStudyFooter = document.getElementById('btnToggleStudyFooter');
    const txtCalendarWebhook = document.getElementById('txtCalendarWebhook');
    const calendarWebhookBadge = document.getElementById('calendarWebhookBadge');
    const txtKeepWebhook = document.getElementById('txtKeepWebhook');
    const keepWebhookBadge = document.getElementById('keepWebhookBadge');
    const settingsPopover = document.getElementById('settingsPopover');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const selAiProvider = document.getElementById('selAiProvider');
    const geminiConfigGroup = document.getElementById('geminiConfigGroup');
    const geminiStatusBadge = document.getElementById('geminiStatusBadge');
    const selGeminiModel = document.getElementById('selGeminiModel');
    const txtCustomModel = document.getElementById('txtCustomModel');
    const txtGeminiKey = document.getElementById('txtGeminiKey');
    const linkAiStudio = document.getElementById('linkAiStudio');
    const selSttMode = document.getElementById('selSttMode');
    const groqConfigGroup = document.getElementById('groqConfigGroup');
    const groqStatusBadge = document.getElementById('groqStatusBadge');
    const txtGroqKey = document.getElementById('txtGroqKey');
    const linkGroqConsole = document.getElementById('linkGroqConsole');
    const selVoice = document.getElementById('selVoice');
    const skinSelector = document.getElementById('skinSelector');
    const rngScale = document.getElementById('rngScale');
    const lblScalePct = document.getElementById('lblScalePct');
    const btnResetScale = document.getElementById('btnResetScale');
    const chkRoam = document.getElementById('chkRoam');
    const chkProximityChat = document.getElementById('chkProximityChat');
    const chkBargeIn = document.getElementById('chkBargeIn');
    const chkSfx = document.getElementById('chkSfx');
    const chkMic = document.getElementById('chkMic');
    const chkAutoCurious = document.getElementById('chkAutoCurious');
    const chkBubble = document.getElementById('chkBubble');
    const chkVoice = document.getElementById('chkVoice');
    const commModeBadge = document.getElementById('commModeBadge');
    const txtCommModeDesc = document.getElementById('txtCommModeDesc');
    const selPersonality = document.getElementById('selPersonality');
    const badgePersonality = document.getElementById('badgePersonality');
    const boxCustomPersonality = document.getElementById('boxCustomPersonality');
    const txtCustomPersonality = document.getElementById('txtCustomPersonality');
    const txtPersonalityDesc = document.getElementById('txtPersonalityDesc');
    const selMic = document.getElementById('selMic');
    const selMicSens = document.getElementById('selMicSens');
    const cfgVuBar = document.getElementById('cfgVuBar');
    const btnAskScreen = document.getElementById('btnAskScreen');
    const btnSwitchScreen = document.getElementById('btnSwitchScreen');
    const btnQuitApp = document.getElementById('btnQuitApp');

    function applyPetScale(rawScale, persist = false) {
      const clamped = Math.max(0.38, Math.min(1.35, Number(rawScale) || 1.0));
      prefs.petScale = clamped;
      const pct = Math.round(clamped * 100);
      petScaleWrap.style.setProperty('--pet-scale', clamped.toFixed(3));
      // Mantém o balão de fala e o mini balão de ação sempre nítidos e coladinhos acima da cabeça em qualquer tamanho!
      const headTop = Math.round(146 * clamped);
      speechBubble.style.bottom = (headTop + 10) + "px";
      const actionBadge = document.getElementById('actionBadge');
      if (actionBadge) {
        actionBadge.style.bottom = (headTop + 6) + "px";
      }
      if (rngScale) rngScale.value = `${pct}`;
      if (lblScalePct) lblScalePct.textContent = `${pct}%`;
      if (persist) {
        localStorage.setItem('sc_pet_scale', clamped.toFixed(3));
        saveAiConfigToDisk();
      }
    }

    function syncAiSettingsUi() {
      selAiProvider.value = prefs.aiProvider;
      selGeminiModel.value = prefs.geminiModelSelect;
      txtCustomModel.value = prefs.geminiCustomModel;
      txtGeminiKey.value = prefs.geminiApiKey;
      txtGroqKey.value = prefs.groqApiKey;
      geminiConfigGroup.style.display = prefs.aiProvider === 'gemini' ? 'flex' : 'none';
      txtCustomModel.style.display = prefs.geminiModelSelect === 'custom' ? 'block' : 'none';

      const gemOpt = selSttMode.querySelector('option[value="gemini-audio"]');
      if (gemOpt) gemOpt.disabled = prefs.aiProvider !== 'gemini';
      selSttMode.value = prefs.sttMode;
      groqConfigGroup.style.display = (String(prefs.sttMode || '').startsWith('groq-') || prefs.aiProvider === 'groq') ? 'flex' : 'none';
    }

    function updateCommModeVisuals() {
      if (chkBubble) chkBubble.checked = Boolean(prefs.bubbleEnabled);
      if (chkVoice) chkVoice.checked = Boolean(prefs.voiceEnabled);
      if (!commModeBadge || !txtCommModeDesc) return;
      if (prefs.voiceEnabled && prefs.bubbleEnabled) {
        commModeBadge.textContent = 'Voz + Balão';
        commModeBadge.style.color = '#34d399';
        commModeBadge.style.background = 'rgba(52, 211, 153, 0.14)';
        txtCommModeDesc.textContent = '✨ Modo Completo: fala em áudio e exibe a caixa de diálogo na tela.';
      } else if (prefs.voiceEnabled && !prefs.bubbleEnabled) {
        commModeBadge.textContent = 'Apenas Voz (Sem Balão)';
        commModeBadge.style.color = '#38bdf8';
        commModeBadge.style.background = 'rgba(56, 189, 248, 0.18)';
        txtCommModeDesc.textContent = '🔊 Fala em áudio normalmente, sem abrir caixa de diálogo na tela.';
      } else if (!prefs.voiceEnabled && prefs.bubbleEnabled) {
        commModeBadge.textContent = 'Apenas Balão (Sem Voz)';
        commModeBadge.style.color = '#fbbf24';
        commModeBadge.style.background = 'rgba(251, 191, 36, 0.16)';
        txtCommModeDesc.textContent = '💬 Modo Silencioso: sem áudio de voz, exibe apenas o texto no balão.';
      } else {
        commModeBadge.textContent = 'Mudo Total';
        commModeBadge.style.color = '#94a3b8';
        commModeBadge.style.background = 'rgba(148, 163, 184, 0.16)';
        txtCommModeDesc.textContent = '🤫 Totalmente discreto: sem som de voz e sem caixa de diálogo.';
      }
    }

    function updatePersonalityUi() {
      if (!selPersonality) return;
      selPersonality.value = prefs.personality;
      if (boxCustomPersonality) boxCustomPersonality.style.display = prefs.personality === 'custom' ? 'block' : 'none';
      if (txtCustomPersonality) txtCustomPersonality.value = prefs.customPersonality || '';

      const labels = {
        adaptativo: '🧠 Adaptativo',
        engenharia_software: 'Eng. Software',
        padrao: 'Companheiro',
        gamer: 'Gamer Co-pilot',
        cyberpunk: 'Cyberpunk',
        custom: 'Personalizada',
      };
      const descs = {
        adaptativo: '🧠 Modo Adaptativo: detecta o contexto (VS Code, jogos, terminal de madrugada) e adapta o tom com histerese orgânica!',
        engenharia_software: '🎓 Mentor de Eng. de Software: Clean Code, SOLID, Padrões GoF, Arquitetura e análise de código arrastado!',
        padrao: '🤖 Companheiro clássico do desktop: fofo, espirituoso e perspicaz.',
        gamer: '🎮 Gamer & Raid Co-pilot: dicas táticas, celebrações de vitórias e descompressão.',
        cyberpunk: '🕶️ Hacker Cyberpunk: direto ao ponto, foco em baixo nível, segurança e performance.',
        custom: '✏️ Personalidade guiada pelo seu próprio texto livre abaixo.',
      };
      if (badgePersonality) {
        if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
          window.ContextDetector.updateBadge();
        } else {
          badgePersonality.textContent = labels[prefs.personality] || 'Personalizada';
        }
      }
      if (txtPersonalityDesc) txtPersonalityDesc.textContent = descs[prefs.personality] || '';
      if (state.conversationHistory && state.conversationHistory[0]) {
        state.conversationHistory[0].content = buildSystemPrompt();
      }
    }

    // Aplica preferências iniciais na UI
    syncAiSettingsUi();
    selVoice.value = prefs.voice;
    if (selMicSens) selMicSens.value = prefs.micSensitivity || 'media';
    chkRoam.checked = prefs.roamEnabled;
    chkProximityChat.checked = prefs.proximityChat;
    chkBargeIn.checked = prefs.bargeInEnabled;
    chkSfx.checked = prefs.sfxEnabled;
    chkMic.checked = prefs.micEnabled;
    chkAutoCurious.checked = prefs.autoCurious;
    if (chkBubble) chkBubble.checked = prefs.bubbleEnabled;
    if (chkVoice) chkVoice.checked = prefs.voiceEnabled;
    updateCommModeVisuals();
    updatePersonalityUi();
    applySkin(prefs.skin);
    applyPetScale(prefs.petScale, false);
    updateMicVisuals();

    function applySkin(skinId) {
      prefs.skin = skinId;
      localStorage.setItem('sc_skin', skinId);
      petRig.setAttribute('data-skin', skinId);
      document.querySelectorAll('.skin-dot').forEach((d) => {
        d.classList.toggle('active', d.dataset.skin === skinId);
      });
    }

    function updateMicVisuals() {
      btnBezelMic.classList.remove('mic-on', 'mic-hearing', 'mic-muted');
      if (!prefs.micEnabled) {
        btnBezelMic.classList.add('mic-muted');
      } else if (state.isUserSpeaking) {
        btnBezelMic.classList.add('mic-hearing');
      } else {
        btnBezelMic.classList.add('mic-on');
      }
      chkMic.checked = prefs.micEnabled;
    }


    // Conexao IPC para o Cerebro / Memoria do BitBop
    if (ipcRenderer) {
      ipcRenderer.on('memory-toggle-private', (_event, val) => {
        state.privateMode = typeof val === 'boolean' ? val : !state.privateMode;
        console.log('[MemoryStore] Modo Privado alternado via IPC:', state.privateMode);
        if (typeof setEmotion === 'function') {
          setEmotion(state.privateMode ? 'COOL' : 'NORMAL', 3000);
        }
      });

      ipcRenderer.on('memory-get-vault-status', (_event) => {
        if (window.MemoryStore && ipcRenderer.send) {
          ipcRenderer.send('memory-vault-status-reply', {
            vaultPath: window.MemoryStore.getVaultPath(),
            initialized: window.MemoryStore.isInitialized(),
            privateMode: state.privateMode
          });
        }
      });
    }

// Globais exportadas para window
window.state = state;
window.prefs = prefs;
window.PET_W = PET_W;
window.PET_H = PET_H;
window.BASE_CANVAS_W = typeof BASE_CANVAS_W !== 'undefined' ? BASE_CANVAS_W : 200;
window.BASE_CANVAS_H = typeof BASE_CANVAS_H !== 'undefined' ? BASE_CANVAS_H : 150;
window.applyPetScale = applyPetScale;
window.updateMicVisuals = updateMicVisuals;
window.notify = typeof notify !== 'undefined' ? notify : null;
window.updatePersonalityUi = updatePersonalityUi;
