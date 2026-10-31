    // =========================================================================
    // 3. CONTROLE CLICK-THROUGH DA ÁREA DE TRABALHO (ZERO INTERFERÊNCIA & ANTI-LAG)
    // =========================================================================
    let currentlyIgnoringMouse = true;
    let hitTestPending = false;
    let lastHitTestX = 0;
    let lastHitTestY = 0;

    function doHitTest(clientX, clientY) {
      if (!ipcRenderer) return;
      if (state.isDragging || state.isResizing) {
        if (currentlyIgnoringMouse) {
          currentlyIgnoringMouse = false;
          ipcRenderer.send('set-ignore-mouse', false);
        }
        return;
      }

      let overInteractiveZone = false;
      if (petRig) {
        const r = petRig.getBoundingClientRect();
        if (clientX >= r.left - 18 && clientX <= r.right + 18 &&
            clientY >= r.top - 18 && clientY <= r.bottom + 18) {
          overInteractiveZone = true;
        }
      }
      if (!overInteractiveZone && speechBubble && speechBubble.classList.contains('visible')) {
        const r = speechBubble.getBoundingClientRect();
        if (clientX >= r.left - 6 && clientX <= r.right + 6 &&
            clientY >= r.top - 6 && clientY <= r.bottom + 6) {
          overInteractiveZone = true;
        }
      }
      if (!overInteractiveZone && state.settingsOpen && settingsPopover) {
        const r = settingsPopover.getBoundingClientRect();
        if (clientX >= r.left - 8 && clientX <= r.right + 8 &&
            clientY >= r.top - 8 && clientY <= r.bottom + 8) {
          overInteractiveZone = true;
        }
      }
      const shouldIgnore = !overInteractiveZone;
      if (shouldIgnore !== currentlyIgnoringMouse) {
        currentlyIgnoringMouse = shouldIgnore;
        ipcRenderer.send('set-ignore-mouse', shouldIgnore);
      }
    }

    function updateClickThroughHitTest(clientX, clientY) {
      lastHitTestX = clientX;
      lastHitTestY = clientY;
      if (!hitTestPending) {
        hitTestPending = true;
        requestAnimationFrame(() => {
          hitTestPending = false;
          doHitTest(lastHitTestX, lastHitTestY);
        });
      }
    }

    window.addEventListener('mousemove', (e) => {
      state.mouseScreenX = e.clientX;
      state.mouseScreenY = e.clientY;
      state.lastUserInteractionAt = Date.now();
      updateClickThroughHitTest(e.clientX, e.clientY);

      // Atualiza alvo do olhar 2.5D em direção ao cursor
      const petCenterX = state.x + PET_W / 2;
      const petCenterY = state.y + 75;
      const dx = (e.clientX - petCenterX) / 280;
      const dy = (e.clientY - petCenterY) / 240;
      if (!state.isThinking && state.aiAction !== 'SLEEP') {
        state.lookTarget.x = Math.max(-14, Math.min(14, dx * 12));
        state.lookTarget.y = Math.max(-10, Math.min(10, dy * 9));
      }
    });

    // =========================================================================
    // 7. INTERAÇÕES TÁTEIS: CARINHO, CLIQUE, ARRASTAR E REDIMENSIONAR (⤡ / SCROLL)
    // =========================================================================
    const PAT_PHRASES = [
      'Hehe, eu adoro quando você faz cafuné em mim!',
      'Ahhh, que carinho gostoso! Meus circuitos ficam quentinhos!',
      'Hihi, pode fazer mais carinho, eu gosto muito de você!',
      'Nossa, assim eu fico o robozinho mais feliz do mundo!'
    ];

    const CLICK_PHRASES = [
      'Oi! Precisa de mim? É só falar!',
      'Hehe, estou aqui de olho na sua tela!',
      'Opa! Quer bater um papo comigo?',
      'Bip bup! Tudo certinho por aí?'
    ];

    const POKE_PHRASES = [
      'Ei! Para de me cutucar, isso faz cócegas nos meus sensores!',
      'Ai ai, quantos cutucões! Vou ficar bravo de brincadeirinha!',
      'Hehe, você está muito brincalhão hoje!'
    ];

    // Redimensionamento direto pela alça ⤡ no canto superior direito ou Ctrl/Alt + Roda do Mouse
    let resizeStartMouse = null;
    let resizeStartScale = 1.0;

    resizeGrip.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      state.isResizing = true;
      state.lastInteractionAt = Date.now();
      resizeStartMouse = { x: e.clientX, y: e.clientY };
      resizeStartScale = prefs.petScale;
      resizeGrip.classList.add('dragging');
      CuteSynth.curious();
    });

    resizeGrip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyPetScale(1.0, true);
      CuteSynth.happy();
      showBubble('Tamanho', 'Tamanho padrão (100%) restaurado!', 2400);
    });

    petRig.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        applyPetScale(prefs.petScale + step, true);
        showBubble('Tamanho', `BitBop em ${Math.round(prefs.petScale * 100)}%`, 1600);
      }
    }, { passive: false });

    // Carinho ao passar o mouse na cabecinha
    let lastPatMouseX = null;
    headPatZone.addEventListener('mousemove', (e) => {
      if (state.isDragging || state.isResizing) return;
      if (lastPatMouseX !== null) {
        const delta = Math.abs(e.clientX - lastPatMouseX);
        if (delta > 2) {
          state.lastInteractionAt = Date.now();
          if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';
          state.patEnergy = Math.min(140, state.patEnergy + delta * 0.65);

          if (state.patEnergy > 22) {
            if (window.PersonalityLearner && typeof window.PersonalityLearner.recordCarinho === 'function') {
              window.PersonalityLearner.recordCarinho();
            }
            setEmotion('LOVE', 3000);
            state.squashX = 1.06;
            state.squashY = 0.95;

            const now = Date.now();
            if (now - state.lastPatSoundAt > 360) {
              state.lastPatSoundAt = now;
              CuteSynth.purr();
              spawnParticle(Math.random() < 0.75 ? '❤️' : '✨', 0, 6);
            }

            if (state.patEnergy >= 115 && !state.studyMode && !state.isSpeaking && !state.isThinking && now - state.lastPatSpeechAt > 9000) {
              state.lastPatSpeechAt = now;
              state.patEnergy = 30;
              const phrase = PAT_PHRASES[Math.floor(Math.random() * PAT_PHRASES.length)];
              showBubble('Carinho ❤️', phrase, 5000);
              speakText(phrase, 'LOVE');
            }
          }
        }
      }
      lastPatMouseX = e.clientX;
    });
    headPatZone.addEventListener('mouseleave', () => {
      lastPatMouseX = null;
      state.patEnergy = Math.max(0, state.patEnergy - 30);
    });

    // Arrastar, Levantar, Chacoalhar e Clicar
    let pointerDownPos = null;
    let draggedMoved = false;

    function onDragStart(e) {
      if (e.button !== 0) return;
      if (e.target.closest('.bezel-controls') || e.target.closest('.resize-grip') || e.target.closest('#settingsPopover')) return;
      state.lastInteractionAt = Date.now();
      if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';
      if (state.trick) {
        if (state.trick.type === 'MODO_RGB' && state.trick.origSkin) {
          petRig.setAttribute('data-skin', state.trick.origSkin);
        }
        state.trick = null;
      }
      state.commandedWalk = null;

      pointerDownPos = { x: e.clientX, y: e.clientY };
      draggedMoved = false;
      state.isDragging = true;
      state.walkTargetX = null;
      state.dragOffsetX = e.clientX - state.x;
      state.dragOffsetY = e.clientY - state.y;
      state.lastDragX = e.clientX;
      state.lastDragTime = performance.now();
      state.shakeEnergy = 0;

      if (currentlyIgnoringMouse) {
        currentlyIgnoringMouse = false;
        if (ipcRenderer) ipcRenderer.send('set-ignore-mouse', false);
      }
    }

    chassis.addEventListener('mousedown', onDragStart);
    headPatZone.addEventListener('mousedown', onDragStart);
    if (petRig) petRig.addEventListener('mousedown', onDragStart);

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        doHitTest(e.clientX, e.clientY);
      }
    }, { capture: true });

    window.addEventListener('mousemove', (e) => {
      if (state.isResizing && resizeStartMouse) {
        // Arrastar para cima/direita aumenta; arrastar para baixo/esquerda diminui!
        const dx = e.clientX - resizeStartMouse.x;
        const dy = resizeStartMouse.y - e.clientY;
        const deltaScale = (dx + dy) / 210;
        applyPetScale(resizeStartScale + deltaScale, false);
        showBubble('Tamanho', `BitBop: ${Math.round(prefs.petScale * 100)}%`, 1200);
        if (state.settingsOpen) positionSettingsPopover();
        return;
      }

      if (!state.isDragging) return;
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6 && !draggedMoved) {
        draggedMoved = true;
        setEmotion('SURPRISED', 2000);
        CuteSynth.surprised();
      }
      if (draggedMoved) {
        const now = performance.now();
        const dt = Math.max(8, now - state.lastDragTime);
        const dx = e.clientX - state.lastDragX;
        state.vx = Math.max(-14, Math.min(14, (dx / dt) * 12));

        // Detecta chacoalhão rápido no ar!
        if (Math.abs(dx) > 18) {
          state.shakeEnergy += Math.abs(dx) * 0.4;
          if (state.shakeEnergy > 180 && state.emotion !== 'DIZZY') {
            setEmotion('DIZZY', 4000);
            CuteSynth.dizzy();
            spawnParticle('💫', 0, 5);
            if (!state.isSpeaking && !state.isThinking) {
              const msg = 'Uouuu! Está tudo girando aqui!';
              showBubble('Tonto 😵', msg, 4000);
              speakText(msg, 'DIZZY');
            }
          }
        } else {
          state.shakeEnergy = Math.max(0, state.shakeEnergy - 4);
        }

        state.x = e.clientX - state.dragOffsetX;
        state.y = e.clientY - state.dragOffsetY;
        state.lastDragX = e.clientX;
        state.lastDragTime = now;

        if (state.settingsOpen) positionSettingsPopover();
      }
    });

    window.addEventListener('mouseup', () => {
      if (state.isResizing) {
        state.isResizing = false;
        resizeStartMouse = null;
        resizeGrip.classList.remove('dragging');
        applyPetScale(prefs.petScale, true);
        CuteSynth.happy();
        return;
      }

      if (!state.isDragging) return;
      state.isDragging = false;

      if (!draggedMoved) {
        // Foi um clique / toque carinhoso no Stack-chan!
        const now = Date.now();
        state.pokeTimestamps = state.pokeTimestamps.filter(t => now - t < 2600);
        state.pokeTimestamps.push(now);

        state.vy = -5.5;
        state.onGround = false;
        state.squashX = 0.90;
        state.squashY = 1.12;

        if (state.pokeTimestamps.length >= 5) {
          state.pokeTimestamps = [];
          setEmotion('ANGRY', 3800);
          CuteSynth.angry();
          spawnParticle('💢', 24, 8);
          if (!state.isSpeaking && !state.isThinking) {
            const p = POKE_PHRASES[Math.floor(Math.random() * POKE_PHRASES.length)];
            showBubble('BitBop 😠', p, 4500);
            speakText(p, 'ANGRY');
          }
        } else {
          setEmotion('HAPPY', 2800);
          CuteSynth.happy();
          spawnParticle('♪', 0, 10);
          if (!state.studyMode && !state.isSpeaking && !state.isThinking && Math.random() < 0.42) {
            const p = CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)];
            showBubble('BitBop', p, 4200);
            speakText(p, 'HAPPY');
          }
        }
      } else {
        // Soltou o Stack-chan em algum lugar novo (ou outra tela!) -> observa o que tem perto ao pousar!
        scheduleProximityInspect(900);
      }
      if (lastHitTestX !== 0 || lastHitTestY !== 0) {
        doHitTest(lastHitTestX, lastHitTestY);
      }
    });

    // =========================================================================
    // 7B. SMART DRAG-AND-DROP DROPZONE (ALIMENTAR O STACK-CHAN COM ARQUIVOS/CÓDIGO)
    // =========================================================================
    let isHoveringDropzone = false;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      updateClickThroughHitTest(e.clientX, e.clientY);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const overPet = !!(el && el.closest('#petRig, #actorRoot, #headPatZone, #chassis'));

      if (overPet) {
        if (!isHoveringDropzone) {
          isHoveringDropzone = true;
          state.mouthOpen = 0.95;
          state.lookTarget.y = -14;
          setEmotion('EXCITED', 2000);
        }
        e.dataTransfer.dropEffect = 'copy';
      } else {
        if (isHoveringDropzone) {
          isHoveringDropzone = false;
          state.mouthOpen = 0;
          state.lookTarget.y = 0;
        }
        e.dataTransfer.dropEffect = 'none';
      }
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        isHoveringDropzone = false;
        state.mouthOpen = 0;
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      isHoveringDropzone = false;
      state.mouthOpen = 0;

      const petCenterX = state.x + PET_W / 2;
      const petCenterY = state.y + PET_H / 2;
      const dist = Math.hypot(e.clientX - petCenterX, e.clientY - petCenterY);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const overPet = !!(el && el.closest('#petRig, #actorRoot, #headPatZone, #chassis, #speechBubble')) || (dist <= Math.max(160, (PET_W * (prefs.petScale || 1)) * 1.1));

      if (overPet && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        await handleDroppedFile(file);
      }
    });

    async function handleDroppedFile(file) {
      if (!file) return;

      // 1. Resolução resiliente do nome e extensão
      let realPath = file.path || '';
      if (!realPath && electronWebUtils && typeof electronWebUtils.getPathForFile === 'function') {
        try { realPath = electronWebUtils.getPathForFile(file); } catch (_) {}
      }
      const rawName = file.name || (realPath && nodePath ? nodePath.basename(realPath) : 'arquivo');
      const fileName = rawName.trim() || 'arquivo';
      const ext = (fileName.includes('.') ? '.' + fileName.split('.').pop() : (realPath && nodePath ? nodePath.extname(realPath) : '')).toLowerCase();
      const fileSizeKb = Math.round((file.size || 0) / 1024);

      state.lastInteractionAt = Date.now();
      if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';

      stopCurrentSpeech();

      // Animação e som de mastigar / engolir o arquivo
      state.squashY = 0.74;
      state.squashX = 1.26;
      CuteSynth.swallowCrunch();
      spawnParticle('📥', 0, -12);
      spawnParticle('✨', 0, 10);
      setEmotion('EXCITED', 4000);
      showBubble('Mastigando...', `Nhac! Recebi “${fileName}”! Analisando...`, 0, true);

      state.isScanningScreen = true;
      state.isThinking = true;

      // Funções de leitura segura em memória (Chromium Blob / FileReader)
      // Garantem 100% de sucesso mesmo com restrições de permissão do Windows fs!
      const readTextSafe = async (f) => {
        if (typeof f.text === 'function') {
          return await f.text();
        }
        if (realPath && nodeFs) {
          try { return await nodeFs.promises.readFile(realPath, 'utf8'); } catch (_) {}
        }
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result || '');
          reader.onerror = () => reject(new Error('Falha no FileReader'));
          reader.readAsText(f, 'utf-8');
        });
      };

      const readBase64Safe = async (f) => {
        if (typeof f.arrayBuffer === 'function') {
          const ab = await f.arrayBuffer();
          if (typeof Buffer !== 'undefined') {
            return Buffer.from(ab).toString('base64');
          }
        }
        if (realPath && nodeFs) {
          try {
            const buf = await nodeFs.promises.readFile(realPath);
            return buf.toString('base64');
          } catch (_) {}
        }
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result || '';
            const idx = res.indexOf('base64,');
            resolve(idx !== -1 ? res.slice(idx + 7) : res);
          };
          reader.onerror = () => reject(new Error('Falha no FileReader Base64'));
          reader.readAsDataURL(f);
        });
      };

      try {
        const isImage = /\.(png|jpe?g|webp|bmp|gif)$/i.test(ext);
        const isCode = /\.(js|ts|jsx|tsx|py|html|css|json|java|c|cpp|h|hpp|cs|sql|rs|go|php|kt|dart|sh|bat|ps1|rb|vue|svelte|xml|gradle)$/i.test(ext);
        const isTextOrLog = /\.(txt|md|log|csv|xml|env|ya?ml|ini|conf|properties)$/i.test(ext);
        const isPdf = /\.pdf$/i.test(ext);

        let userPrompt = '';
        let extraOpts = {};

        if (isImage) {
          const base64Jpeg = await readBase64Safe(file);
          extraOpts = {
            images: [{ label: `Imagem enviada: "${fileName}"`, base64Jpeg }]
          };
          userPrompt =
            `[ARQUIVO DE IMAGEM RECEBIDO]: O usuário acabou de arrastar e soltar em você a imagem "${fileName}". ` +
            `Analise o conteúdo visual (diagrama, arquitetura, interface ou print de código/erro) sob a perspectiva de Engenharia de Software e estudos, e faça um comentário perspicaz e didático!`;
        } else if (isPdf) {
          const base64Pdf = await readBase64Safe(file);
          extraOpts = {
            pdfBase64: base64Pdf
          };
          userPrompt =
            `[DOCUMENTO PDF RECEBIDO]: O usuário acabou de arrastar o arquivo PDF "${fileName}" (${fileSizeKb} KB) para você estudar com ele. ` +
            `Sintetize os tópicos centrais com foco nos conceitos de Engenharia de Software de forma didática e concisa!`;
        } else if (isCode || isTextOrLog) {
          let textContent = await readTextSafe(file);
          if (textContent.length > 25000) {
            textContent = textContent.slice(0, 18000) + '\n\n... [código intermediário omitido] ...\n\n' + textContent.slice(-4000);
          }
          userPrompt = state.studyMode
            ? `[ARQUIVO DE CÓDIGO/TEXTO RECEBIDO]: "${fileName}" (${fileSizeKb} KB).\n\n=== CONTEÚDO DO ARQUIVO ===\n${textContent}\n=== FIM DO ARQUIVO ===\n\nAnalise tecnicamente o código (arquitetura, lógica, Clean Code e SOLID) em bullet points diretos e concisos. Não faça perguntas.`
            : `[ARQUIVO DE CÓDIGO/TEXTO RECEBIDO]: O usuário acabou de te alimentar com o arquivo "${fileName}" (${fileSizeKb} KB).\n\n` +
              `=== CONTEÚDO DO ARQUIVO ===\n${textContent}\n=== FIM DO ARQUIVO ===\n\n` +
              `Como Mentor de Engenharia de Software dele, analise o código com didática: ` +
              `1. Diga em 1 frase clara o que o código faz. ` +
              `2. Aponte um ponto forte ou oportunidade de melhoria prática (Clean Code, SOLID, tratamento de erros ou eficiência). ` +
              `3. Faça uma pergunta instigante de fixação para os estudos dele! ` +
              `Mantenha a resposta viva e conversacional.`;
        } else {
          let snippet = '';
          try {
            const raw = await readTextSafe(file);
            if (raw && !/[\x00-\x08\x0E-\x1F]/.test(raw.slice(0, 500))) {
              snippet = `\nTrecho do arquivo:\n${raw.slice(0, 2000)}`;
            }
          } catch (_) {}

          userPrompt =
            `[ARQUIVO RECEBIDO]: O usuário acabou de te alimentar com o arquivo "${fileName}" (${fileSizeKb} KB, tipo "${ext || 'desconhecido'}").${snippet}\n` +
            `Reconheça o arquivo de forma simpática, inteligente e prestativa!`;
        }

        await handleUserMessage(userPrompt, false, extraOpts);
      } catch (err) {
        console.error('[DROPZONE] Erro ao ler arquivo:', err);
        state.isScanningScreen = false;
        state.isThinking = false;
        setEmotion('SAD', 4500);
        CuteSynth.sad();
        const msg = `Puxa, tive uma dificuldade para ler o arquivo "${fileName}". Pode tentar arrastar novamente?`;
        showBubble('BitBop ⚠️', msg, 5000);
        speakText(msg, 'SAD');
      }
    }

    // =========================================================================
    // 8. PAINEL DE CONFIGURAÇÕES E CONTROLES DA MOLDURA
    // =========================================================================
    function positionSettingsPopover() {
      const popW = 286;
      const popH = Math.min(560, settingsPopover.offsetHeight || 500);
      const centerX = state.x + PET_W / 2;
      const disp = getDisplayAt(centerX);
      const halfVisW = (PET_W * prefs.petScale) / 2;

      let left = Math.round(centerX - halfVisW - popW - 14);
      if (left < disp.x + 12) left = Math.round(centerX + halfVisW + 14);
      left = Math.max(disp.x + 12, Math.min(disp.x + disp.w - popW - 12, left));

      let top = state.y + PET_H - popH;
      top = Math.max(disp.y + 12, Math.min(disp.y + disp.h - popH - 12, top));

      settingsPopover.style.left = `${Math.round(left)}px`;
      settingsPopover.style.top = `${Math.round(top)}px`;
    }

    function toggleSettings(forceState = null) {
      state.settingsOpen = forceState !== null ? forceState : !state.settingsOpen;
      if (state.settingsOpen) {
        positionSettingsPopover();
        settingsPopover.classList.add('open');
        CuteSynth.curious();
        if (window.VoiceBiometrics && typeof window.VoiceBiometrics.updateUi === 'function') {
          window.VoiceBiometrics.updateUi();
        }
      } else {
        settingsPopover.classList.remove('open');
      }
      updateClickThroughHitTest(state.mouseScreenX, state.mouseScreenY);
    }

    
    function togglePrivateMode(forceState) {
      const next = typeof forceState === 'boolean' ? forceState : !state.privateMode;
      state.privateMode = next;
      if (state.privateMode) {
        setEmotion('COOL', 0);
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('🕶️', 'Modo Privado Ativo', 4000);
        }
        if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
          window.ContextDetector.updateBadge();
        }
        if (window.CuteSynth && typeof window.CuteSynth.happy === 'function') {
          window.CuteSynth.happy();
        }
        console.log('[ModoPrivado] Ativado (Alt+P): anotações no Obsidian e visão multimodal desativadas.');
      } else {
        setEmotion('NORMAL', 2500);
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('👁️', 'Modo Privado Desativado', 3000);
        }
        if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
          window.ContextDetector.updateBadge();
        }
        console.log('[ModoPrivado] Desativado: rotinas normais reativadas.');
      }
    }
    window.togglePrivateMode = togglePrivateMode;

    function toggleListenerMode(forceState) {
      const next = typeof forceState === 'boolean' ? forceState : !state.silentObserverMode;
      state.silentObserverMode = next;
      const btnListener = document.getElementById('btnToggleListenerMode');
      if (state.silentObserverMode) {
        setEmotion('CURIOUS', 0);
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('🎧', 'Modo Ouvinte (Só Observar)', 4000);
        }
        if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
          window.ContextDetector.updateBadge();
        }
        if (window.CuteSynth && typeof window.CuteSynth.curious === 'function') {
          window.CuteSynth.curious();
        }
        if (btnListener) {
          btnListener.style.background = 'rgba(45, 212, 191, 0.45)';
          btnListener.style.borderColor = '#2dd4bf';
          btnListener.textContent = '🎧 Ouvinte (Ativo)';
        }
        console.log('[ModoOuvinte] Ativado (Alt+O): BitBop em silêncio absoluto, absorvendo telas e conversas para o Obsidian.');
      } else {
        setEmotion('NORMAL', 2500);
        if (typeof window.showActionBadge === 'function') {
          window.showActionBadge('🗣️', 'Modo Ouvinte Desativado', 3000);
        }
        if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
          window.ContextDetector.updateBadge();
        }
        if (window.CuteSynth && typeof window.CuteSynth.happy === 'function') {
          window.CuteSynth.happy();
        }
        if (btnListener) {
          btnListener.style.background = 'rgba(45, 212, 191, 0.2)';
          btnListener.style.borderColor = 'rgba(45, 212, 191, 0.4)';
          btnListener.textContent = '🎧 Ouvinte';
        }
        console.log('[ModoOuvinte] Desativado: BitBop pode falar e interagir normalmente.');
      }
    }
    window.toggleListenerMode = toggleListenerMode;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.settingsOpen) {
        toggleSettings(false);
      }
      if (e.altKey && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        togglePrivateMode();
        return;
      }
      if (e.altKey && (e.key === 'o' || e.key === 'O' || e.code === 'KeyO')) {
        e.preventDefault();
        toggleListenerMode();
        return;
      }
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (window.StudyModeModule) {
          window.StudyModeModule.toggle();
        }
      }
    });

    rngScale.addEventListener('input', () => {
      applyPetScale(Number(rngScale.value) / 100, false);
    });
    rngScale.addEventListener('change', () => {
      applyPetScale(Number(rngScale.value) / 100, true);
      CuteSynth.happy();
    });
    btnResetScale.addEventListener('click', () => {
      applyPetScale(1.0, true);
      CuteSynth.happy();
    });

    selAiProvider.addEventListener('change', async () => {
      prefs.aiProvider = selAiProvider.value;
      syncAiSettingsUi();
      saveAiConfigToDisk();
      positionSettingsPopover();
      if (prefs.aiProvider === 'gemini') warmUpGeminiConnection();
      if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', getEffectiveSttMode());
    });

    selSttMode.addEventListener('change', async () => {
      prefs.sttMode = selSttMode.value;
      syncAiSettingsUi();
      saveAiConfigToDisk();
      positionSettingsPopover();
      const eff = getEffectiveSttMode();
      if (eff.startsWith('groq-')) {
        if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', eff);
        warmUpGroqConnection();
        CuteSynth.excited();
        const gLabel = eff === 'groq-whisper-v3' ? 'Groq Whisper Large-v3 Completo' : 'Groq Whisper Large-v3-Turbo';
        showBubble('Groq LPU Ativo!', `${gLabel} ativado na nuvem (~200ms, 0 MB de VRAM)!`, 4200);
      } else if (eff === 'gemini-audio') {
        if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', 'gemini-audio');
        CuteSynth.happy();
        showBubble('Audição Gemini', 'Áudio nativo direto no Gemini ativado! Zero uso de placa de vídeo!', 4000);
      } else {
        const label = eff === 'whisper-turbo' ? 'Whisper Large-v3-Turbo' : 'Whisper Small';
        showBubble('Carregando GPU...', `Ativando ${label} nos Tensor Cores...`, 0);
        if (ipcRenderer) await ipcRenderer.invoke('switch-stt-mode', eff);
        CuteSynth.excited();
        showBubble('Audição GPU Pronta!', `${label} ativo localmente na sua RTX 2060!`, 4200);
      }
    });

    const handleGroqKeyUpdate = () => {
      prefs.groqApiKey = txtGroqKey.value.trim();
      saveAiConfigToDisk();
      warmUpGroqConnection();
    };
    txtGroqKey.addEventListener('change', handleGroqKeyUpdate);
    txtGroqKey.addEventListener('input', handleGroqKeyUpdate);

    linkGroqConsole.addEventListener('click', (e) => {
      e.preventDefault();
      if (electronShell) electronShell.openExternal('https://console.groq.com/keys');
    });

    selGeminiModel.addEventListener('change', () => {
      prefs.geminiModelSelect = selGeminiModel.value;
      syncAiSettingsUi();
      saveAiConfigToDisk();
      positionSettingsPopover();
      warmUpGeminiConnection();
    });

    const handleCustomModelUpdate = () => {
      prefs.geminiCustomModel = txtCustomModel.value.trim();
      saveAiConfigToDisk();
      warmUpGeminiConnection();
    };
    txtCustomModel.addEventListener('change', handleCustomModelUpdate);
    txtCustomModel.addEventListener('input', handleCustomModelUpdate);

    const handleGeminiKeyUpdate = () => {
      prefs.geminiApiKey = txtGeminiKey.value.trim();
      saveAiConfigToDisk();
      warmUpGeminiConnection();
    };
    txtGeminiKey.addEventListener('change', handleGeminiKeyUpdate);
    txtGeminiKey.addEventListener('input', handleGeminiKeyUpdate);

    linkAiStudio.addEventListener('click', (e) => {
      e.preventDefault();
      if (electronShell) electronShell.openExternal('https://aistudio.google.com/apikey');
    });

    btnBezelSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSettings();
    });
    btnCloseSettings.addEventListener('click', () => toggleSettings(false));

    // Alternador das Abas de Ferramentas
    document.querySelectorAll('.cfg-tab-btn').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const targetId = tabBtn.dataset.tab;
        document.querySelectorAll('.cfg-tab-btn').forEach((b) => b.classList.toggle('active', b === tabBtn));
        document.querySelectorAll('.cfg-tab-content').forEach((c) => {
          c.classList.toggle('active', c.id === targetId);
        });
      });
    });

    btnBezelMic.addEventListener('click', (e) => {
      e.stopPropagation();
      prefs.micEnabled = !prefs.micEnabled;
      localStorage.setItem('sc_mic', `${prefs.micEnabled}`);
      if (typeof clearPreRoll === 'function') clearPreRoll();
      updateMicVisuals();
      CuteSynth.happy();
      showBubble('Microfone', prefs.micEnabled ? 'Estou te ouvindo novamente!' : 'Microfone pausado.', 3000);
    });

    if (btnToggleStudyFooter) {
      btnToggleStudyFooter.addEventListener('click', () => {
        if (window.StudyModeModule) {
          window.StudyModeModule.toggle();
        }
      });
    }

    const btnToggleListenerMode = document.getElementById('btnToggleListenerMode');
    if (btnToggleListenerMode) {
      btnToggleListenerMode.addEventListener('click', () => {
        toggleListenerMode();
      });
    }

    btnSwitchScreen.addEventListener('click', () => {
      toggleSettings(false);
      sendPetToOtherScreen();
    });

    btnQuitApp.addEventListener('click', async () => {
      if (window.MemoryConsolidator && typeof window.MemoryConsolidator.runSleepConsolidation === 'function') {
        try {
          await window.MemoryConsolidator.runSleepConsolidation({ isQuick: true });
        } catch {}
      }
      if (ipcRenderer) ipcRenderer.send('window-close');
      else window.close();
    });

    selVoice.addEventListener('change', async () => {
      prefs.voice = selVoice.value;
      localStorage.setItem('sc_voice', prefs.voice);
      const sample = VOICE_Samples[prefs.voice] || 'Oi! Gostou dessa voz?';
      showBubble('Nova Voz', sample, 4500, false, true);
      await speakText(sample, 'HAPPY', true);
    });

    selMicSens.addEventListener('change', () => {
      prefs.micSensitivity = selMicSens.value;
      saveAiConfigToDisk();
      CuteSynth.happy();
      showBubble('Sensibilidade Mic', `Modo "${selMicSens.options[selMicSens.selectedIndex].text}" ativado!`, 3000, false, true);
    });

    selPersonality.addEventListener('change', () => {
      prefs.personality = selPersonality.value;
      updatePersonalityUi();
      if (window.ContextDetector && typeof window.ContextDetector.evaluateContext === 'function') {
        window.ContextDetector.evaluateContext(state, prefs, Date.now());
      }
      saveAiConfigToDisk();
      CuteSynth.excited();
      showBubble('Personalidade', `Modo "${selPersonality.options[selPersonality.selectedIndex].text}" ativado!`, 3500, false, true);
      if (typeof window.renderPersonalityDetails === 'function') {
        window.renderPersonalityDetails();
      }
    });

    txtCustomPersonality.addEventListener('input', () => {
      prefs.customPersonality = txtCustomPersonality.value;
      saveAiConfigToDisk();
      if (state.conversationHistory && state.conversationHistory[0]) {
        state.conversationHistory[0].content = buildSystemPrompt();
      }
    });

    skinSelector.addEventListener('click', (e) => {
      const dot = e.target.closest('.skin-dot');
      if (!dot) return;
      applySkin(dot.dataset.skin);
      CuteSynth.happy();
      spawnParticle('✨', 0, 12);
    });

    chkBubble.addEventListener('change', () => {
      prefs.bubbleEnabled = chkBubble.checked;
      saveAiConfigToDisk();
      updateCommModeVisuals();
      if (!prefs.bubbleEnabled) {
        if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
        speechBubble.classList.remove('visible');
      } else {
        showBubble('Balão Ativado', 'Caixa de diálogo visível!', 2600);
      }
    });

    chkVoice.addEventListener('change', () => {
      prefs.voiceEnabled = chkVoice.checked;
      saveAiConfigToDisk();
      updateCommModeVisuals();
      if (prefs.voiceEnabled) {
        CuteSynth.happy();
        speakText('Voz ativada!', 'HAPPY', true);
      } else {
        CuteSynth.purr();
        showBubble('Sem Voz', 'Modo silencioso ativado (apenas balão de texto)!', 3500, false, true);
      }
    });

    chkRoam.addEventListener('change', () => {
      prefs.roamEnabled = chkRoam.checked;
      localStorage.setItem('sc_roam', `${prefs.roamEnabled}`);
      state.aiAction = 'IDLE';
      state.walkTargetX = null;
      if (prefs.roamEnabled) {
        state.nextAiDecisionAt = 0;
      }
      saveAiConfigToDisk();
    });

    chkProximityChat.addEventListener('change', () => {
      prefs.proximityChat = chkProximityChat.checked;
      saveAiConfigToDisk();
      if (prefs.proximityChat) {
        CuteSynth.curious();
        scheduleProximityInspect(400);
      }
    });

    chkBargeIn.addEventListener('change', () => {
      prefs.bargeInEnabled = chkBargeIn.checked;
      saveAiConfigToDisk();
      if (prefs.bargeInEnabled) CuteSynth.happy();
    });

    chkSfx.addEventListener('change', () => {
      prefs.sfxEnabled = chkSfx.checked;
      localStorage.setItem('sc_sfx', `${prefs.sfxEnabled}`);
      if (prefs.sfxEnabled) CuteSynth.happy();
    });

    chkMic.addEventListener('change', () => {
      prefs.micEnabled = chkMic.checked;
      localStorage.setItem('sc_mic', `${prefs.micEnabled}`);
      if (typeof clearPreRoll === 'function') clearPreRoll();
      updateMicVisuals();
    });

    chkAutoCurious.addEventListener('change', () => {
      prefs.autoCurious = chkAutoCurious.checked;
      localStorage.setItem('sc_curious', `${prefs.autoCurious}`);
      if (prefs.autoCurious) {
        CuteSynth.happy();
        scheduleProximityInspect(400);
      }
    });

    const chkBiometricsRestricted = document.getElementById('chkBiometricsRestricted');
    if (chkBiometricsRestricted) {
      chkBiometricsRestricted.checked = Boolean(prefs.biometricsRestricted);
      chkBiometricsRestricted.addEventListener('change', () => {
        prefs.biometricsRestricted = chkBiometricsRestricted.checked;
        saveAiConfigToDisk();
        if (prefs.biometricsRestricted) CuteSynth.happy();
      });
    }

    const btnCalibrateVoice = document.getElementById('btnCalibrateVoice');
    if (btnCalibrateVoice) {
      btnCalibrateVoice.addEventListener('click', () => {
        const vb = (typeof window !== 'undefined' && window.VoiceBiometrics) ? window.VoiceBiometrics : (typeof globalThis !== 'undefined' ? globalThis.VoiceBiometrics : null);
        if (vb && typeof vb.startCalibration === 'function') {
          vb.startCalibration();
        }
      });
    }

    const btnResetBiometrics = document.getElementById('btnResetBiometrics');
    if (btnResetBiometrics) {
      btnResetBiometrics.addEventListener('click', () => {
        const vb = (typeof window !== 'undefined' && window.VoiceBiometrics) ? window.VoiceBiometrics : (typeof globalThis !== 'undefined' ? globalThis.VoiceBiometrics : null);
        if (vb && typeof vb.resetBiometrics === 'function') {
          vb.resetBiometrics();
        }
      });
    }

    selMic.addEventListener('change', () => {
      if (selMic.value) initContinuousListening(selMic.value);
    });

    document.querySelectorAll('.mood-btn[data-mood]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mood = btn.dataset.mood;
        if (!mood) return;
        setEmotion(mood, 5000);
        if (mood === 'HAPPY') CuteSynth.happy();
        else if (mood === 'EXCITED' || mood === 'LAUGHING') { CuteSynth.excited(); spawnParticle('✨', 0, 8); }
        else if (mood === 'LOVE') { CuteSynth.purr(); spawnParticle('❤️', 0, 8); }
        else if (mood === 'SAD') CuteSynth.sad();
        else if (mood === 'ANGRY') { CuteSynth.angry(); spawnParticle('💢', 20, 8); }
        else if (mood === 'SURPRISED') CuteSynth.surprised();
        else if (mood === 'DIZZY') CuteSynth.dizzy();
      });
    });

    document.querySelectorAll('.trick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.action;
        toggleSettings(false);
        executePetAction(act, { fromUiClick: true });
      });
    });

    // IPC Eventos do Sistema, Multi-Telas e Bandeja (Tray)
    if (ipcRenderer) {
      ipcRenderer.on('stage-topology', (_e, topo) => {
        if (topo && Array.isArray(topo.displays) && topo.displays.length > 0) {
          const firstLoad = !state.topologyLoaded;
          state.topologyLoaded = true;
          state.displays = topo.displays;
          console.log(`[STAGE] Topologia recebida: ${topo.displays.map((d) => `${d.label} [${d.x}..${d.x + d.w}]`).join(' | ')}`);
          if (firstLoad) {
            const prim = topo.displays.find((d) => d.isPrimary) || topo.displays[0];
            state.x = Math.max(prim.x + 80, prim.x + prim.w - 260);
            state.y = prim.floorY - PET_H;
            state.lastDisplayIndex = prim.index;
          }
        }
      });

      ipcRenderer.on('services-loading', (_e, msg) => {
        showBubble('Iniciando GPU...', msg, 0);
      });

      ipcRenderer.on('services-ready', (_e, status) => {
        const wasReady = state.servicesReady;
        state.servicesReady = true;
        if (!wasReady) {
          console.log('[IPC] services-ready:', JSON.stringify(status));
          CuteSynth.excited();
          setEmotion('HAPPY', 4000);
          const aiName = prefs.aiProvider === 'gemini' ? `Gemini (${getEffectiveGeminiModel()})` : (prefs.aiProvider === 'groq' ? 'Groq LPU (Qwen 3.8 27B)' : 'Qwen Local');
          const numScreens = getEffectiveDisplays().length;
          const screensInfo = numScreens > 1 ? `pelas suas ${numScreens} telas` : 'pela sua tela';
          showBubble('BitBop Pronto!', `Cérebro ${aiName} ativo! Agora passeio ${screensInfo}, comento o que encontrar e te ouço mesmo se eu estiver falando!`, 7000);
        }
      });

      ipcRenderer.on('desktop-state', (_e, dState) => {
        state.desktop = dState;
        if (window.ContextDetector && typeof window.ContextDetector.onDesktopStateChanged === 'function') {
          window.ContextDetector.onDesktopStateChanged(dState);
        }

        // NOVO: Hipocampo em Tempo Real (Rastreamento de marcos de foco e entrada em jogos/apps)
        if (!state.isSensitiveWindow && window.HippocampusLogger && typeof window.HippocampusLogger.onDesktopStateChanged === 'function') {
          window.HippocampusLogger.onDesktopStateChanged(dState);
        }

        // Seção 8: Detecção em tempo real de janelas sensíveis (Bancos, Senhas, Navegação Anônima)
        const SENSITIVE_WINDOW_RX = /(?:1password|bitwarden|keepass|inprivate|an[oô]nima|incognito|internet\s*banking|nubank|ita[uú]|bradesco|inter|caixa|santander|banco\s*do\s*brasil|sicredi|btg|binance|metamask|senha|login|auth)/i;
        const activeWinTitle = (dState && dState.activeTitle) || '';
        const wasSensitive = state.isSensitiveWindow;
        state.isSensitiveWindow = SENSITIVE_WINDOW_RX.test(activeWinTitle);
        if (state.isSensitiveWindow && !wasSensitive) {
          console.log(`[Seguranca] Janela sensível detectada ("${activeWinTitle}"). Visão de tela e memórias suspensas.`);
        }
        // Reação silenciosa fofa de curiosidade quando você abre um app novo
        if (
          prefs.autoCurious &&
          dState.activeApp &&
          dState.activeApp !== state.lastSeenActiveApp &&
          !state.isSpeaking &&
          !state.isThinking
        ) {
          state.lastSeenActiveApp = dState.activeApp;
          if (Math.random() < 0.35) {
            setEmotion('CURIOUS', 2500);
          }
        }
      });

      ipcRenderer.on('tray-action', (_e, action) => {
        if (action === 'summon') {
          const displays = getEffectiveDisplays();
          const prim = displays.find((d) => d.isPrimary) || displays[0];
          const targetX = (state.mouseScreenX > 10 && state.mouseScreenX < getStageTotalWidth() - 10)
            ? state.mouseScreenX - PET_W / 2
            : prim.x + Math.round(prim.w / 2 - PET_W / 2);
          const disp = getDisplayAt(targetX + PET_W / 2);
          state.x = Math.round(targetX);
          state.y = Math.round(disp.y + disp.h * 0.45);
          state.vy = -4;
          state.walkTargetX = null;
          state.onGround = false;
          setEmotion('EXCITED', 3500);
          CuteSynth.excited();
          showBubble('BitBop', 'Cheguei! Me chamou?', 4000);
        } else if (action === 'switch-screen') {
          sendPetToOtherScreen();
        } else if (action === 'look-screen') {
          askAboutDesktop('O que você está vendo nas minhas telas agora?');
        } else if (action === 'open-settings') {
          toggleSettings(true);
        } else if (action === 'toggle-mic') {
          btnBezelMic.click();
        } else if (action === 'toggle-bubble') {
          prefs.bubbleEnabled = !prefs.bubbleEnabled;
          if (chkBubble) chkBubble.checked = prefs.bubbleEnabled;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          if (!prefs.bubbleEnabled) {
            if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
            speechBubble.classList.remove('visible');
          } else {
            showBubble('Balão Ativado', 'Caixa de diálogo visível!', 2800);
          }
        } else if (action === 'toggle-voice') {
          prefs.voiceEnabled = !prefs.voiceEnabled;
          if (chkVoice) chkVoice.checked = prefs.voiceEnabled;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          if (prefs.voiceEnabled) {
            CuteSynth.happy();
            speakText('Voz ativada!', 'HAPPY', true);
          } else {
            CuteSynth.purr();
            showBubble('Sem Voz', 'Modo silencioso: falas apenas no balão de texto!', 3500, false, true);
          }
        } else if (action === 'toggle-silent-dance') {
          if (window.SilentRoamDance) {
            window.SilentRoamDance.toggle();
          }
        } else if (action === 'toggle-study-mode') {
          if (window.StudyModeModule) {
            window.StudyModeModule.toggle();
          }
        } else if (action === 'toggle-private-mode') {
          togglePrivateMode();
        } else if (action === 'toggle-listener-mode') {
          toggleListenerMode();
        } else if (action === 'sleep-consolidate') {
          if (window.MemoryConsolidator && typeof window.MemoryConsolidator.runSleepConsolidation === 'function') {
            window.MemoryConsolidator.runSleepConsolidation({ force: true });
          }
        }
      });
    } else {
      state.servicesReady = true;
    }

    // Inicialização do Módulo de Agendamento no Google Agenda (Voz + Webhook)
    function updateCalendarWebhookBadge() {
      if (!calendarWebhookBadge) return;
      const url = window.CalendarScheduler ? window.CalendarScheduler.getWebhookUrl() : (prefs.googleCalendarWebhookUrl || '');
      if (url && /^https?:\/\//i.test(url)) {
        calendarWebhookBadge.textContent = '● Webhook Ativo';
        calendarWebhookBadge.style.color = '#34d399';
      } else {
        calendarWebhookBadge.textContent = '⚠ Cole a URL .gs';
        calendarWebhookBadge.style.color = '#fbbf24';
      }
    }

    if (window.CalendarScheduler) {
      window.CalendarScheduler.init({
        state,
        prefs,
        CuteSynth,
        showBubble,
        setEmotion,
        spawnParticle,
      });
      if (txtCalendarWebhook) {
        txtCalendarWebhook.value = window.CalendarScheduler.getWebhookUrl() || prefs.googleCalendarWebhookUrl || '';
        const handleCalendarWebhookUpdate = (showFeedback = false) => {
          const val = txtCalendarWebhook.value.trim();
          window.CalendarScheduler.setWebhookUrl(val);
          prefs.googleCalendarWebhookUrl = val;
          saveAiConfigToDisk();
          updateCalendarWebhookBadge();
          if (showFeedback) {
            CuteSynth.happy();
            showBubble('Google Agenda 📅', val ? 'URL do Webhook do Google Agenda salva!' : 'URL do Webhook removida.', 3200);
          }
        };
        txtCalendarWebhook.addEventListener('change', () => handleCalendarWebhookUpdate(true));
        txtCalendarWebhook.addEventListener('input', () => handleCalendarWebhookUpdate(false));
      }
      updateCalendarWebhookBadge();
    }

    // Inicialização do Módulo de Notas do Google Keep (Cache Local 0ms + Webhook)
    function updateKeepWebhookBadge() {
      if (!keepWebhookBadge) return;
      const url = window.GoogleKeepService ? window.GoogleKeepService.getWebhookUrl() : (prefs.googleKeepWebhookUrl || prefs.googleCalendarWebhookUrl || '');
      if (url && /^https?:\/\//i.test(url)) {
        keepWebhookBadge.textContent = '● Nuvem Ativa';
        keepWebhookBadge.style.color = '#34d399';
      } else {
        keepWebhookBadge.textContent = '● Cache Local (0ms)';
        keepWebhookBadge.style.color = '#fbbf24';
      }
    }

    if (window.GoogleKeepService) {
      window.GoogleKeepService.init({
        state,
        prefs,
        CuteSynth,
        showBubble,
        setEmotion,
        spawnParticle,
        saveAiConfigToDisk,
      });
      if (txtKeepWebhook) {
        txtKeepWebhook.value = window.GoogleKeepService.getWebhookUrl() || prefs.googleKeepWebhookUrl || '';
        const handleKeepWebhookUpdate = (showFeedback = false) => {
          const val = txtKeepWebhook.value.trim();
          window.GoogleKeepService.setWebhookUrl(val);
          prefs.googleKeepWebhookUrl = val;
          saveAiConfigToDisk();
          updateKeepWebhookBadge();
          if (showFeedback) {
            CuteSynth.happy();
            showBubble('Google Keep 📝', val ? 'URL do Webhook do Google Keep salva!' : 'Modo Cache Local ativo (0ms).', 3200);
          }
        };
        txtKeepWebhook.addEventListener('change', () => handleKeepWebhookUpdate(true));
        txtKeepWebhook.addEventListener('input', () => handleKeepWebhookUpdate(false));
      }
      updateKeepWebhookBadge();
    }

    // Inicialização do Módulo de Perfil de Estudo (Study Mode)
    function updateStudyModeUi(isActive) {
      if (chkStudyMode) chkStudyMode.checked = Boolean(isActive);
      if (window.ContextDetector && typeof window.ContextDetector.updateBadge === 'function') {
        window.ContextDetector.updateBadge();
      }
      if (btnToggleStudyFooter) {
        btnToggleStudyFooter.style.background = isActive ? 'rgba(56, 189, 248, 0.42)' : 'rgba(56, 189, 248, 0.2)';
        btnToggleStudyFooter.style.borderColor = isActive ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
        btnToggleStudyFooter.textContent = isActive ? '📚 Estudo (Ativo)' : '📚 Modo Estudo';
      }
    }

    if (window.StudyModeModule) {
      window.StudyModeModule.init({
        state,
        prefs,
        chkRoam,
        chkProximityChat,
        chkAutoCurious,
        CuteSynth,
        showBubble,
        setEmotion,
        spawnParticle,
        updateMicVisuals,
        rebuildSystemPrompt,
        saveAiConfigToDisk,
      });
      updateStudyModeUi(window.StudyModeModule.isActive());

      if (chkStudyMode) {
        chkStudyMode.addEventListener('change', () => {
          if (chkStudyMode.checked) {
            window.StudyModeModule.enable();
          } else {
            window.StudyModeModule.disable();
          }
        });
      }

      window.addEventListener('study-mode:change', (e) => {
        updateStudyModeUi(Boolean(e.detail?.active));
      });
    }

    if (window.ContextDetector && typeof window.ContextDetector.init === 'function') {
      window.ContextDetector.init();
    }

    // =========================================================================
    // PAINEL EXPANSÍVEL: COMO ESTOU AGORA & TRAÇOS DE PERSONALIDADE
    // =========================================================================
    const btnTogglePersonalityDetails = document.getElementById('btnTogglePersonalityDetails');
    const boxPersonalityDetails = document.getElementById('boxPersonalityDetails');
    const iconTogglePersonalityDetails = document.getElementById('iconTogglePersonalityDetails');
    const txtPersonalityDetailReason = document.getElementById('txtPersonalityDetailReason');
    const containerTraitBars = document.getElementById('containerTraitBars');
    const btnLockPersonality = document.getElementById('btnLockPersonality');
    const btnResetTraits = document.getElementById('btnResetTraits');
    const btnViewPersonalityHistory = document.getElementById('btnViewPersonalityHistory');

    const TRAIT_LABELS = {
      formalidade: 'Formalidade',
      humor: 'Humor',
      verbosidade: 'Verbosidade',
      proatividade: 'Proatividade',
      empatia: 'Empatia',
      tecnicidade: 'Tecnicidade',
      energia: 'Energia',
      provocacao: 'Provocação'
    };

    function renderPersonalityDetails() {
      if (!containerTraitBars) return;
      const engine = window.PersonalityEngine;
      const detector = window.ContextDetector;

      const effective = engine && typeof engine.getEffectiveTraits === 'function' ? engine.getEffectiveTraits() : {};
      const base = engine && typeof engine.getBaseTraits === 'function' ? engine.getBaseTraits() : {};
      const isLocked = engine && typeof engine.isLocked === 'function' && engine.isLocked();

      const facet = detector && typeof detector.getCurrentFacet === 'function' ? detector.getCurrentFacet() : prefs.personality;
      const facetNames = {
        engenharia_software: 'Mentor Dev',
        padrao: 'Companheiro Fofo',
        gamer: 'Gamer Co-pilot',
        cyberpunk: 'Cyberpunk Hacker',
        custom: 'Personalizada',
        adaptativo: 'Adaptativo'
      };
      const contextName = detector && typeof detector.getActiveContextName === 'function' ? detector.getActiveContextName() : 'Geral';
      const ctxStatus = detector && typeof detector.getContextStatus === 'function' ? detector.getContextStatus() : null;
      const reason = ctxStatus ? ctxStatus.reason : '';

      if (txtPersonalityDetailReason) {
        txtPersonalityDetailReason.textContent = `Faceta ativa: ${facetNames[facet] || facet} • Contexto: ${contextName}${reason ? ` (${reason})` : ''}${isLocked ? ' • 🔒 TRAVADO' : ''}`;
      }

      if (btnLockPersonality) {
        btnLockPersonality.textContent = isLocked ? '🔓 Destravar' : '🔒 Travar';
        btnLockPersonality.style.borderColor = isLocked ? '#f59e0b' : 'rgba(56, 189, 248, 0.35)';
        btnLockPersonality.style.color = isLocked ? '#fbbf24' : '#7dd3fc';
      }

      const traitKeys = ['formalidade', 'humor', 'verbosidade', 'proatividade', 'empatia', 'tecnicidade', 'energia', 'provocacao'];
      let barsHtml = '';

      for (const k of traitKeys) {
        const effVal = typeof effective[k] === 'number' ? effective[k] : 0.5;
        const baseVal = typeof base[k] === 'number' ? base[k] : 0.5;
        const effPct = Math.round(effVal * 100);
        const basePct = Math.round(baseVal * 100);
        const label = TRAIT_LABELS[k] || k;
        const diff = effVal - baseVal;
        const diffStr = diff > 0.01 ? ` (+${Math.round(diff * 100)}%)` : (diff < -0.01 ? ` (${Math.round(diff * 100)}%)` : '');

        barsHtml += `
          <div style="margin-bottom: 3px;">
            <div style="display: flex; justify-content: space-between; font-size: 8.5px; color: #cbd5e1; margin-bottom: 1px;">
              <span>${label}</span>
              <span style="color: ${diff > 0.01 ? '#34d399' : (diff < -0.01 ? '#f87171' : '#94a3b8')};">${effPct}%${diffStr}</span>
            </div>
            <div style="background: rgba(255, 255, 255, 0.08); height: 5px; border-radius: 3px; position: relative; overflow: hidden;">
              <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${effPct}%; background: linear-gradient(90deg, #a855f7, #38bdf8); border-radius: 3px;"></div>
              <div style="position: absolute; left: ${basePct}%; top: 0; height: 100%; width: 2px; background: #ffffff; opacity: 0.8;" title="Base: ${basePct}%"></div>
            </div>
          </div>
        `;
      }

      containerTraitBars.innerHTML = barsHtml;
    }

    window.renderPersonalityDetails = renderPersonalityDetails;

    if (btnTogglePersonalityDetails && boxPersonalityDetails) {
      btnTogglePersonalityDetails.addEventListener('click', () => {
        const isHidden = boxPersonalityDetails.style.display === 'none';
        boxPersonalityDetails.style.display = isHidden ? 'block' : 'none';
        if (iconTogglePersonalityDetails) {
          iconTogglePersonalityDetails.textContent = isHidden ? '▴' : '▾';
        }
        if (isHidden) {
          renderPersonalityDetails();
        }
      });
    }

    if (btnLockPersonality) {
      btnLockPersonality.addEventListener('click', () => {
        const engine = window.PersonalityEngine;
        if (!engine) return;
        const isLocked = engine.isLocked && engine.isLocked();
        engine.setLocked(!isLocked);
        renderPersonalityDetails();
        CuteSynth.happy();
        showBubble('Personalidade', !isLocked ? 'Personalidade travada! Sem adaptações automáticas.' : 'Personalidade destravada! Adaptação viva ativa.', 2800, false, true);
      });
    }

    if (btnResetTraits) {
      btnResetTraits.addEventListener('click', () => {
        const engine = window.PersonalityEngine;
        if (!engine) return;
        engine.resetTraits('tracos');
        renderPersonalityDetails();
        CuteSynth.happy();
        showBubble('Personalidade', 'Traços resetados de volta aos valores originais da persona!', 2800, false, true);
      });
    }

    if (btnViewPersonalityHistory) {
      btnViewPersonalityHistory.addEventListener('click', () => {
        const mem = window.MemoryStore;
        if (!mem) return;
        const vaultPath = mem.getVaultPath();
        if (vaultPath) {
          const histPath = nodePath ? nodePath.join(vaultPath, '00_Nucleo', 'Personalidade', 'Historico_Adaptacao.md') : `${vaultPath}/00_Nucleo/Personalidade/Historico_Adaptacao.md`;
          if (electronShell && typeof electronShell.openPath === 'function') {
            electronShell.openPath(histPath);
            showBubble('Obsidian', 'Abrindo Historico_Adaptacao.md...', 2500, false, true);
          }
        }
      });
    }

    // =========================================================================
    // CONTROLES DO OBSERVADOR DE TELA (~5 MIN)
    // =========================================================================
    const selObserverInterval = document.getElementById('selObserverInterval');
    const selObserverMaxReaction = document.getElementById('selObserverMaxReaction');

    if (selObserverInterval) {
      selObserverInterval.value = `${prefs.observerInterval || 5}`;
      selObserverInterval.addEventListener('change', () => {
        const mins = parseInt(selObserverInterval.value, 10) || 5;
        prefs.observerInterval = mins;
        if (window.ScreenObserver && typeof window.ScreenObserver.setIntervalMinutes === 'function') {
          window.ScreenObserver.setIntervalMinutes(mins);
        }
        saveAiConfigToDisk();
        CuteSynth.happy();
        showBubble('Observador', `Intervalo de observação: ${mins} minutos!`, 2500, false, true);
      });
    }

    if (selObserverMaxReaction) {
      selObserverMaxReaction.value = prefs.observerMaxReaction || 'all';
      selObserverMaxReaction.addEventListener('change', () => {
        const mode = selObserverMaxReaction.value;
        prefs.observerMaxReaction = mode;
        if (window.ScreenObserver && typeof window.ScreenObserver.setMaxReaction === 'function') {
          window.ScreenObserver.setMaxReaction(mode);
        }
        saveAiConfigToDisk();
        CuteSynth.happy();
        const reactionLabels = {
          all: 'Voz + Balão',
          balloon: 'Só Balão Silencioso',
          silent: 'Apenas Memória'
        };
        showBubble('Observador', `Reação máxima: ${reactionLabels[mode] || mode}!`, 2500, false, true);
      });
    }

    const chkSilentDance = document.getElementById('chkSilentDance');
    if (window.SilentRoamDance) {
      window.SilentRoamDance.init({
        state,
        prefs,
        chkRoam,
        speechBubble,
        CuteSynth,
        stopCurrentSpeech,
        executePetAction,
        setEmotion,
        spawnParticle,
        applySkin,
        applyPetScale,
        animatePetScaleTo,
        updateMicVisuals,
        updateCommModeVisuals,
      });

      if (chkSilentDance) {
        chkSilentDance.addEventListener('change', () => {
          if (chkSilentDance.checked) {
            window.SilentRoamDance.enable();
          } else {
            window.SilentRoamDance.disable();
          }
        });
      }

      window.addEventListener('silent-roam-dance:change', (e) => {
        if (chkSilentDance) chkSilentDance.checked = Boolean(e.detail?.active);
      });
    }

