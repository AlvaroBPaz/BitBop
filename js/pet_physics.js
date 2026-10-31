    // =========================================================================
    // 6. FÍSICA MULTI-TELAS, EXPLORAÇÃO AUTÔNOMA E INTERAÇÃO COM JANELAS
    // =========================================================================
    let proximityInspectTimer = null;
    function scheduleProximityInspect(delayMs = 450) {
      if (proximityInspectTimer) clearTimeout(proximityInspectTimer);
      proximityInspectTimer = setTimeout(() => {
        if (typeof maybeCommentOnNearbyThing === 'function') {
          maybeCommentOnNearbyThing();
        }
      }, delayMs);
    }

    function getFloorAt(centerX, currentFootY) {
      const disp = getDisplayAt(centerX);
      const taskbarFloor = disp ? disp.floorY : window.innerHeight;
      // Verifica se há topo de alguma janela aberta logo abaixo dos pés do Stack-chan (em qualquer monitor!)
      for (const ledge of (state.desktop.ledges || [])) {
        if (centerX >= ledge.x + 25 && centerX <= ledge.x + ledge.w - 25) {
          if (currentFootY <= ledge.y + 18 && ledge.y < taskbarFloor - 60) {
            return ledge.y;
          }
        }
      }
      return taskbarFloor;
    }

    function pickAutonomousDestination(nowMs) {
      const displays = getEffectiveDisplays();
      const centerX = state.x + PET_W / 2;
      const curDisp = getDisplayAt(centerX);
      const allWins = state.desktop.windows || [];

      // Se houver mais de 1 tela, frequentemente escolhe explorar outro monitor por conta própria!
      if (displays.length > 1 && (nowMs - state.lastScreenSwitchAt > 24000) && Math.random() < 0.62) {
        const otherDisplays = displays.filter((d) => d.index !== curDisp.index);
        const targetDisp = otherDisplays[Math.floor(Math.random() * otherDisplays.length)];
        if (targetDisp) {
          state.lastScreenSwitchAt = nowMs;
          // Se houver uma janela aberta naquela tela, vai caminhando até pertinho dela!
          const winsOnTarget = allWins.filter((w) => w.screenIndex === targetDisp.index);
          if (winsOnTarget.length > 0 && Math.random() < 0.75) {
            const w = winsOnTarget[Math.floor(Math.random() * winsOnTarget.length)];
            const minSpot = Math.max(targetDisp.x + 90, w.x + 50);
            const maxSpot = Math.min(targetDisp.x + targetDisp.w - 90, w.x + w.w - 50);
            if (maxSpot > minSpot) {
              return minSpot + Math.random() * (maxSpot - minSpot);
            }
          }
          return targetDisp.x + 150 + Math.random() * Math.max(180, targetDisp.w - 300);
        }
      }

      // Ou caminha até perto de uma janela visível em qualquer monitor!
      if (allWins.length > 0 && Math.random() < 0.55) {
        const w = allWins[Math.floor(Math.random() * allWins.length)];
        const wDisp = getDisplayAt(w.x + w.w / 2);
        const minSpot = Math.max(wDisp.x + 80, w.x + 40);
        const maxSpot = Math.min(wDisp.x + wDisp.w - 80, w.x + w.w - 40);
        if (maxSpot > minSpot) {
          return minSpot + Math.random() * (maxSpot - minSpot);
        }
      }

      // Ou vai visitar onde o cursor do mouse do usuário está!
      if (Math.random() < 0.45) {
        return Math.max(80, Math.min(getStageTotalWidth() - 80, state.mouseScreenX + (Math.random() - 0.5) * 180));
      }

      return Math.max(90, Math.min(getStageTotalWidth() - 90, Math.random() * getStageTotalWidth()));
    }

    function animatePetScaleTo(targetScale, durationMs = 480) {
      state.scaleAnim = {
        from: prefs.petScale,
        to: Math.max(0.38, Math.min(1.35, targetScale)),
        start: performance.now(),
        duration: durationMs,
      };
    }

    const UI_TRICK_QUIPS = {
      DANCAR: { emo: 'COOL', text: 'Solta o som! Olha só o meu passinho!' },
      MORTAL: { emo: 'EXCITED', text: 'Segura essa! Mortal carpado de robô!' },
      PIRUETA: { emo: 'EXCITED', text: 'Uhuuul! Girando sem parar!' },
      MOONWALK: { emo: 'COOL', text: 'Deslizando no estilo Michael Jackson!' },
      COMEMORAR: { emo: 'EXCITED', text: 'Aeee! Vitória épica, mandamos muito bem!' },
      ESCONDER: { emo: 'SURPRISED', text: 'Abaixa! Estou bem pequenininho aqui pra ninguém me ver!' },
      FINGIR_MORTO: { emo: 'DEAD', text: 'Aaaargh... meus circuitos... bip... morri de mentirinha!' },
      CORRER_TURBO: { emo: 'EXCITED', text: 'Modo turbo ativado! Vruuuum pelas telas!' },
      CANTAR: { emo: 'HAPPY', text: 'Lá lá lá, bip bup, eu sou o BitBop cantor da sua tela!' },
      MODO_COMBATE: { emo: 'ANGRY', text: 'Sensores em alerta máximo! Ninguém mexe com a gente!' },
      MANDAR_BEIJO: { emo: 'LOVE', text: 'Um super beijinho cheio de carinho pra você!' },
      MODO_RGB: { emo: 'COOL', text: 'Modo RGB Gamer ativado! Mais FPS garantido!' },
      SEGUIR_MOUSE: { emo: 'EXCITED', text: 'Vou seguir o seu mouse por onde você for!' },
      MODO_SEM_BALAO: { emo: 'HAPPY', text: 'Entendido! Agora vou falar sem abrir caixa de diálogo na tela.' },
      MODO_COM_BALAO: { emo: 'HAPPY', text: 'Balão de diálogo ativado novamente!' },
      MODO_SEM_VOZ: { emo: 'CURIOUS', text: 'Shhh! Modo silencioso: agora apenas texto no balão!' },
      MODO_COM_VOZ: { emo: 'EXCITED', text: 'Voz ativada! Agora estou falando em áudio com você!' },
      MODO_VOZ_E_BALAO: { emo: 'HAPPY', text: 'Modo padrão: voz e balão funcionando juntos!' },
    };

    function executePetAction(rawActionId, opts = {}) {
      const actionId = String(rawActionId || '').trim().toUpperCase();
      if (!actionId) return false;

      // Restaura carcaça se interrompeu MODO_RGB anterior
      if (state.trick && state.trick.type === 'MODO_RGB' && state.trick.origSkin) {
        applySkin(state.trick.origSkin);
      }

      const nowPerf = performance.now();
      const displays = getEffectiveDisplays();
      const centerX = state.x + PET_W / 2;
      const curDisp = getDisplayAt(centerX);
      state.lastInteractionAt = Date.now();
      if (state.aiAction === 'SLEEP') state.aiAction = 'IDLE';

      console.log(`[ACTION] Executando ação/animação: ${actionId}`);

      switch (actionId) {
        case 'IR_DIREITA': {
          const rightDisp = displays[displays.length - 1];
          const destX = rightDisp.x + Math.round(rightDisp.w * 0.60);
          state.trick = null;
          state.followMouseUntil = 0;
          state.commandedWalk = { targetX: destX, speed: 4.5, hopStride: true, startedAt: nowPerf };
          state.vy = -5.5;
          state.onGround = false;
          setEmotion('EXCITED', 4500);
          CuteSynth.excited();
          spawnParticle('➡️', 0, 10);
          break;
        }

        case 'IR_ESQUERDA': {
          const leftDisp = displays[0];
          const destX = leftDisp.x + Math.round(leftDisp.w * 0.38);
          state.trick = null;
          state.followMouseUntil = 0;
          state.commandedWalk = { targetX: destX, speed: 4.5, hopStride: true, startedAt: nowPerf };
          state.vy = -5.5;
          state.onGround = false;
          setEmotion('EXCITED', 4500);
          CuteSynth.excited();
          spawnParticle('⬅️', 0, 10);
          break;
        }

        case 'TROCAR_TELA': {
          if (displays.length < 2) {
            const destX = centerX < curDisp.w / 2 ? curDisp.w * 0.75 : curDisp.w * 0.25;
            state.commandedWalk = { targetX: destX, speed: 4.2, hopStride: true, startedAt: nowPerf };
          } else {
            const idx = displays.findIndex((d) => d.index === curDisp.index);
            const targetDisp = displays[(idx + 1) % displays.length];
            const destX = targetDisp.x + Math.round(targetDisp.w * 0.5);
            state.commandedWalk = { targetX: destX, speed: 4.5, hopStride: true, startedAt: nowPerf };
          }
          state.trick = null;
          state.vy = -5.5;
          state.onGround = false;
          setEmotion('EXCITED', 4500);
          CuteSynth.excited();
          spawnParticle('🗺️', 0, 10);
          break;
        }

        case 'VIR_MOUSE': {
          const destX = Math.max(80, Math.min(getStageTotalWidth() - 80, state.mouseScreenX));
          state.trick = null;
          state.commandedWalk = { targetX: destX, speed: 4.8, hopStride: true, startedAt: nowPerf };
          state.vy = -5.2;
          state.onGround = false;
          setEmotion('HAPPY', 4500);
          CuteSynth.happy();
          spawnParticle('📍', 0, 10);
          break;
        }

        case 'SEGUIR_MOUSE': {
          state.trick = null;
          state.commandedWalk = null;
          state.followMouseUntil = Date.now() + 20000;
          setEmotion('EXCITED', 5000);
          CuteSynth.excited();
          spawnParticle('🖱️', 0, 10);
          break;
        }

        case 'PARAR_AQUI': {
          state.trick = null;
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.followMouseUntil = 0;
          prefs.roamEnabled = false;
          chkRoam.checked = false;
          localStorage.setItem('sc_roam', 'false');
          state.aiAction = 'SIT';
          setEmotion('HAPPY', 4000);
          CuteSynth.happy();
          spawnParticle('🛑', 0, 10);
          break;
        }

        case 'EXPLORAR_LIVRE': {
          state.followMouseUntil = 0;
          prefs.roamEnabled = true;
          chkRoam.checked = true;
          localStorage.setItem('sc_roam', 'true');
          state.aiAction = 'WALK';
          state.walkTargetX = pickAutonomousDestination(Date.now());
          state.walkStartedAt = nowPerf;
          setEmotion('EXCITED', 4000);
          CuteSynth.excited();
          spawnParticle('🧭', 0, 10);
          break;
        }

        case 'DANCAR': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'DANCAR', start: nowPerf, duration: 6400, stepTick: 0 };
          setEmotion('COOL', 6500);
          CuteSynth.danceBeat();
          spawnParticle('🎵', -22, 6);
          spawnParticle('🎶', 22, 6);
          break;
        }

        case 'MORTAL': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          const dir = state.walkDir || 1;
          state.trick = { type: 'MORTAL', start: nowPerf, duration: 1350, dir, launched: false };
          setEmotion('EXCITED', 4500);
          CuteSynth.zoomDash();
          break;
        }

        case 'PIRUETA': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.vy = -8.5;
          state.onGround = false;
          state.trick = { type: 'PIRUETA', start: nowPerf, duration: 2400, stepTick: 0 };
          setEmotion('EXCITED', 4000);
          CuteSynth.excited();
          spawnParticle('💫', 0, 8);
          break;
        }

        case 'MOONWALK': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          // Desliza para o lado onde há mais espaço no monitor!
          const moveDir = (centerX - curDisp.x) > curDisp.w / 2 ? -1 : 1;
          state.trick = { type: 'MOONWALK', start: nowPerf, duration: 5000, dir: moveDir, stepTick: 0 };
          setEmotion('COOL', 5200);
          CuteSynth.danceBeat();
          spawnParticle('🕶️', 0, 8);
          break;
        }

        case 'COMEMORAR': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'COMEMORAR', start: nowPerf, duration: 4800, stepTick: 0 };
          setEmotion('EXCITED', 5200);
          CuteSynth.fanfare();
          spawnParticle('🏆', -18, 5);
          spawnParticle('🎉', 18, 5);
          break;
        }

        case 'ESCONDER': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'ESCONDER', start: nowPerf, duration: 6000, stepTick: 0 };
          setEmotion('SURPRISED', 6200);
          CuteSynth.sad();
          spawnParticle('🫣', 0, 12);
          break;
        }

        case 'FINGIR_MORTO': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'FINGIR_MORTO', start: nowPerf, duration: 5600, revived: false, stepTick: 0 };
          setEmotion('DEAD', 5200);
          CuteSynth.koDrop();
          spawnParticle('💀', 0, 8);
          break;
        }

        case 'CORRER_TURBO': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          const runDir = centerX < getStageTotalWidth() / 2 ? 1 : -1;
          state.trick = { type: 'CORRER_TURBO', start: nowPerf, duration: 4600, dir: runDir, stepTick: 0 };
          setEmotion('COOL', 4800);
          CuteSynth.zoomDash();
          spawnParticle('⚡', 0, 10);
          break;
        }

        case 'CANTAR': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'CANTAR', start: nowPerf, duration: 5400, stepTick: 0 };
          setEmotion('HAPPY', 5600);
          CuteSynth.melody();
          spawnParticle('🎤', -16, 6);
          spawnParticle('🎼', 16, 6);
          break;
        }

        case 'MODO_COMBATE': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'MODO_COMBATE', start: nowPerf, duration: 4600, stepTick: 0 };
          setEmotion('ANGRY', 5000);
          CuteSynth.angry();
          spawnParticle('⚔️', -16, 8);
          spawnParticle('🔥', 16, 8);
          break;
        }

        case 'MANDAR_BEIJO': {
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.trick = { type: 'MANDAR_BEIJO', start: nowPerf, duration: 3800, stepTick: 0 };
          setEmotion('LOVE', 4500);
          CuteSynth.purr();
          for (let i = 0; i < 4; i++) {
            setTimeout(() => spawnParticle(i % 2 === 0 ? '❤️' : '😘', (i - 1.5) * 18, 6), i * 180);
          }
          break;
        }

        case 'PULAR_ALTO': {
          state.commandedWalk = null;
          const reachable = (state.desktop.ledges || []).find((l) => {
            const lc = l.x + l.w / 2;
            return Math.abs(centerX - lc) < 420 && l.y < state.y + PET_H - 40;
          });
          if (reachable) {
            const lc = reachable.x + reachable.w / 2;
            const dyJump = (state.y + PET_H) - reachable.y;
            state.vy = -Math.min(22, Math.sqrt(2 * 0.68 * (dyJump + 55)));
            state.vx = (lc - centerX) / 30;
          } else {
            state.vy = -17.5;
            state.vx = (Math.random() - 0.5) * 4;
          }
          state.onGround = false;
          setEmotion('EXCITED', 3500);
          CuteSynth.zoomDash();
          spawnParticle('🚀', 0, 14);
          break;
        }

        case 'MODO_MINI': {
          animatePetScaleTo(0.46, 520);
          setEmotion('HAPPY', 3500);
          CuteSynth.shrinkDown();
          spawnParticle('🤏', 0, 10);
          break;
        }

        case 'MODO_GIGANTE': {
          animatePetScaleTo(1.30, 520);
          setEmotion('EXCITED', 3500);
          CuteSynth.powerUp();
          spawnParticle('💪', 0, 10);
          break;
        }

        case 'TAMANHO_NORMAL': {
          animatePetScaleTo(1.0, 450);
          setEmotion('HAPPY', 3000);
          CuteSynth.happy();
          spawnParticle('✨', 0, 10);
          break;
        }

        case 'MODO_RGB': {
          const origSkin = prefs.skin;
          state.trick = { type: 'MODO_RGB', start: nowPerf, duration: 6000, origSkin, stepTick: 0 };
          setEmotion('COOL', 6200);
          CuteSynth.fanfare();
          spawnParticle('🌈', 0, 8);
          break;
        }

        case 'COR_SAKURA':
        case 'COR_CYBER':
        case 'COR_MINT':
        case 'COR_YELLOW':
        case 'COR_CLASSIC': {
          const mapSkin = {
            COR_SAKURA: 'sakura',
            COR_CYBER: 'cyber',
            COR_MINT: 'mint',
            COR_YELLOW: 'm5yellow',
            COR_CLASSIC: 'classic',
          };
          applySkin(mapSkin[actionId] || 'classic');
          setEmotion('HAPPY', 3500);
          CuteSynth.happy();
          spawnParticle('🎨', 0, 10);
          break;
        }

        case 'DORMIR_AGORA': {
          state.trick = null;
          state.commandedWalk = null;
          state.walkTargetX = null;
          state.followMouseUntil = 0;
          state.aiAction = 'SLEEP';
          setEmotion('SLEEPY', 0);
          CuteSynth.sad();
          spawnParticle('💤', 22, 10);
          break;
        }

        case 'ACORDAR': {
          state.trick = null;
          state.aiAction = 'IDLE';
          state.vy = -7.5;
          state.onGround = false;
          setEmotion('EXCITED', 4000);
          CuteSynth.excited();
          spawnParticle('☀️', 0, 8);
          break;
        }

        case 'MODO_SEM_BALAO': {
          prefs.bubbleEnabled = false;
          if (chkBubble) chkBubble.checked = false;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          speechBubble.classList.remove('visible');
          setEmotion('HAPPY', 3500);
          CuteSynth.happy();
          spawnParticle('🗣️', 0, 10);
          break;
        }

        case 'MODO_COM_BALAO': {
          prefs.bubbleEnabled = true;
          if (chkBubble) chkBubble.checked = true;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          setEmotion('HAPPY', 3500);
          CuteSynth.happy();
          spawnParticle('💬', 0, 10);
          showBubble('BitBop', 'Balão de diálogo ativado!', 3500, false, true);
          break;
        }

        case 'MODO_SEM_VOZ': {
          prefs.voiceEnabled = false;
          if (chkVoice) chkVoice.checked = false;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          setEmotion('CURIOUS', 4000);
          CuteSynth.purr();
          spawnParticle('🤫', 0, 10);
          showBubble('BitBop 🤫', 'Shhh! Modo silencioso ativado: agora vou me comunicar apenas aqui pelo balão de texto!', 5000);
          break;
        }

        case 'MODO_COM_VOZ': {
          prefs.voiceEnabled = true;
          if (chkVoice) chkVoice.checked = true;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          setEmotion('EXCITED', 4000);
          CuteSynth.excited();
          spawnParticle('🔊', 0, 10);
          const msg = 'Voz ativada! Agora estou falando em áudio com você!';
          showBubble('BitBop 🔊', msg, 4000);
          speakText(msg, 'EXCITED', true);
          break;
        }

        case 'MODO_VOZ_E_BALAO': {
          prefs.bubbleEnabled = true;
          prefs.voiceEnabled = true;
          if (chkBubble) chkBubble.checked = true;
          if (chkVoice) chkVoice.checked = true;
          saveAiConfigToDisk();
          updateCommModeVisuals();
          setEmotion('HAPPY', 4000);
          CuteSynth.excited();
          spawnParticle('✨', 0, 10);
          const msg = 'Modo completo ativado: agora falo com voz e mostro o balão de texto!';
          showBubble('BitBop', msg, 4500, false, true);
          speakText(msg, 'HAPPY', true);
          break;
        }

        case 'MODO_SO_ANDAR_E_DANCAR':
        case 'MODO_DANCARINO_SILENCIOSO': {
          if (window.SilentRoamDance) {
            window.SilentRoamDance.enable();
          }
          break;
        }

        case 'DESATIVAR_MODO_DANCARINO': {
          if (window.SilentRoamDance) {
            window.SilentRoamDance.disable();
          }
          break;
        }

        case 'ATIVAR_MODO_ESTUDO': {
          if (window.StudyModeModule) {
            window.StudyModeModule.enable();
          }
          break;
        }

        case 'DESATIVAR_MODO_ESTUDO': {
          if (window.StudyModeModule) {
            window.StudyModeModule.disable();
          }
          break;
        }

        default:
          return false;
      }

      if (opts.fromUiClick && UI_TRICK_QUIPS[actionId] && !state.isSpeaking && !state.isThinking) {
        const q = UI_TRICK_QUIPS[actionId];
        showBubble('BitBop 🎬', q.text, 4800);
        speakText(q.text, q.emo);
      }
      return true;
    }

    // Reconhecimento instantâneo (0ms) de comandos de ação na fala do usuário!
    function detectVoiceActionCommand(text) {
      const raw = (text || '').toLowerCase();
      const t = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/\b(moonwalk|michael jackson|anda(?:r)? de costas|desliza(?:r)? de costas)\b/.test(t)) return 'MOONWALK';
      if (/\b(mortal|backflip|cambalhota|vira-?lata no ar|flips?)\b/.test(t)) return 'MORTAL';
      if (/\b(pirueta|d[áa] um giro|gira(?:r)?|rodopia|roda(?:r)?)\b/.test(t)) return 'PIRUETA';
      if (/\b(danca|dancinha|passinho|rebola|bailar)\b/.test(t)) return 'DANCAR';
      if (/\b(finge de morto|fingir de morto|morre(?:u)?|bang\b|pow\b|ta morto)\b/.test(t)) return 'FINGIR_MORTO';
      if (/\b(se esconde|esconde|se abaixa|abaixa|agacha|cuidado.*sniper|olha o sniper)\b/.test(t)) return 'ESCONDER';
      if (/\b(comemora|comemorar|ganhamos|vencemos|vitoria|campeao|gg\b|aeee)\b/.test(t)) return 'COMEMORAR';
      if (/\b(modo turbo|corre(?:r)? rapido|zoomies|dispara|da uma corrida|sai correndo)\b/.test(t)) return 'CORRER_TURBO';
      if (/\b(canta(?:r)?|cantando|solta a voz|musica pra mim)\b/.test(t)) return 'CANTAR';
      if (/\b(modo combate|modo batalha|fica bravo|ataque|atacar|modo furioso)\b/.test(t)) return 'MODO_COMBATE';
      if (/\b(manda(?:r)? (?:um )?beijo|beijinho|te amo|abraco)\b/.test(t)) return 'MANDAR_BEIJO';
      if (/\b(modo rgb|arco-?iris|pisca(?:r)? colorido|modo festa|balada)\b/.test(t)) return 'MODO_RGB';
      if (/\b(fica rosa|cor rosa|sakura)\b/.test(t)) return 'COR_SAKURA';
      if (/\b(fica preto|cor preta|modo escuro|cyber)\b/.test(t)) return 'COR_CYBER';
      if (/\b(fica amarelo|cor amarela)\b/.test(t)) return 'COR_YELLOW';
      if (/\b(fica verde|cor verde|menta)\b/.test(t)) return 'COR_MINT';
      if (/\b(fica branco|cor branca|cor classica)\b/.test(t)) return 'COR_CLASSIC';
      if (/\b(fica pequenininho|fica pequeno|fica menor|diminui(?:r)?|encolhe|modo mini)\b/.test(t)) return 'MODO_MINI';
      if (/\b(fica grande|fica grandao|fica gigante|aumenta(?:r)? o tamanho|cresce(?:r)?)\b/.test(t)) return 'MODO_GIGANTE';
      if (/\b(tamanho normal|tamanho padrao|volta ao tamanho)\b/.test(t)) return 'TAMANHO_NORMAL';
      if (/\b(vai dormir|pode dormir|tira(?:r)? (?:um )?cochilo|soneca|boa noite)\b/.test(t)) return 'DORMIR_AGORA';
      if (/\b(acorda(?:r)?|bom dia stack)\b/.test(t)) return 'ACORDAR';
      if (/\b(me segue|segue o mouse|segue meu mouse|vem comigo|me acompanha)\b/.test(t)) return 'SEGUIR_MOUSE';
      if (/\b(fica parado|nao sai dai|para de andar|fica quietinho ai|espera ai)\b/.test(t)) return 'PARAR_AQUI';
      if (/\b(pode passear|volta a andar|explora(?:r)? livre|pode andar)\b/.test(t)) return 'EXPLORAR_LIVRE';
      if (/\b(vem|vai|ir|passa|pula|anda).*(tela.*direita|monitor.*direito|lado direito|pra direita)\b/.test(t)) return 'IR_DIREITA';
      if (/\b(vem|vai|ir|passa|pula|anda).*(tela.*esquerda|monitor.*esquerdo|lado esquerdo|pra esquerda)\b/.test(t)) return 'IR_ESQUERDA';
      if (/\b(vai|vem|passa|muda|ir).*(outra tela|outro monitor|segunda tela)\b/.test(t)) return 'TROCAR_TELA';
      if (/\b(vem aqui|vem ca|vem pro mouse|chega mais perto)\b/.test(t)) return 'VIR_MOUSE';
      if (/\b(sobe na janela|pula na janela|da um pulo|da um pulao|salta alto)\b/.test(t)) return 'PULAR_ALTO';
      if (/(sem balao|tira(?:r)? o balao|esconde(?:r)? o balao|oculta(?:r)? o balao|desativa(?:r)? o balao|sem caixa de dialogo|sem caixa de texto|so voz|apenas voz|fala(?:r)? sem (?:aparecer )?(?:o )?balao|sem aparecer (?:a )?caixa)/.test(t)) return 'MODO_SEM_BALAO';
      if (/(com balao|mostra(?:r)? o balao|ativa(?:r)? o balao|volta(?:r)? o balao|exibe o balao|liga(?:r)? o balao|com caixa de dialogo)/.test(t)) return 'MODO_COM_BALAO';
      if (/(fica(?:r)? mudo|modo mudo|sem voz|desativa(?:r)? a voz|tira(?:r)? a voz|\bmudo\b|silencio|modo silencioso|so texto|so balao|apenas texto|apenas balao)/.test(t)) return 'MODO_SEM_VOZ';
      if (/(ativa(?:r)? a voz|pode falar|volta(?:r)? a falar|liga(?:r)? a voz|com voz|sai(?:r)? do modo mudo)/.test(t)) return 'MODO_COM_VOZ';
      if (/(modo padrao|modo normal|voz e balao|ativa(?:r)? voz e balao)/.test(t)) return 'MODO_VOZ_E_BALAO';
      if (/\b(modo s[oó] andar|s[oó] anda(?:r)?|modo dan[cç]arino|s[oó] fica dan[cç]ando|s[oó] dan[cç]a(?:r)? e anda(?:r)?|brinquedo silencioso|modo silencioso de dan[cç]a|a[cç][oõ]es aleat[oó]rias|truques aleat[oó]rios|todas as a[cç][oõ]es|faz tudo sozinho|modo show)\b/.test(t)) return 'MODO_SO_ANDAR_E_DANCAR';
      if (/\b(sai(?:r)? do modo dan[cç]arino|volta ao normal|para de s[oó] dan[cç]ar|desativa(?:r)? modo dan[cç]arino|sai(?:r)? das a[cç][oõ]es aleat[oó]rias|para as a[cç][oõ]es|desativa(?:r)? o show)\b/.test(t)) return 'DESATIVAR_MODO_DANCARINO';
      if (/\b(desativa(?:r)? (?:o )?(?:modo|perfil) (?:de )?estudo|sai(?:r)? do (?:modo|perfil) (?:de )?estudo|encerra(?:r)? (?:o )?(?:modo|perfil) (?:de )?estudo|desliga(?:r)? (?:o )?(?:modo|perfil) (?:de )?estudo|fim do estudo)\b/.test(t)) return 'DESATIVAR_MODO_ESTUDO';
      if (/\b(ativa(?:r)? (?:o )?(?:modo|perfil) (?:de )?estudo|liga(?:r)? (?:o )?(?:modo|perfil) (?:de )?estudo|entra(?:r)? no (?:modo|perfil) (?:de )?estudo|modo (?:de )?estudo|perfil de estudo|hora de estudar|foco nos estudos)\b/.test(t)) return 'ATIVAR_MODO_ESTUDO';
      return null;
    }

    function sendPetToOtherScreen() {
      executePetAction('TROCAR_TELA');
      const curDisp = getDisplayAt(state.x + PET_W / 2);
      const displays = getEffectiveDisplays();
      if (displays.length >= 2) {
        const idx = displays.findIndex((d) => d.index === curDisp.index);
        const targetDisp = displays[(idx + 1) % displays.length];
        showBubble('Explorando!', `Bora lá pra ${targetDisp.label}!`, 4000);
      }
    }

    function updatePhysicsAndAutonomy(now) {
      // Animação suave de redimensionamento quando pedida por voz ("fica menor" / "tamanho normal")
      if (state.scaleAnim) {
        const p = Math.min(1, (now - state.scaleAnim.start) / state.scaleAnim.duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const curS = state.scaleAnim.from + (state.scaleAnim.to - state.scaleAnim.from) * eased;
        applyPetScale(curS, p >= 1);
        if (p >= 1) state.scaleAnim = null;
      }

      // Recuperação elástica de squash & stretch
      state.squashX += (1 - state.squashX) * 0.18;
      state.squashY += (1 - state.squashY) * 0.18;

      if (!state.isDragging) {
        const centerX = state.x + PET_W / 2;
        const footY = state.y + PET_H;
        const targetFloor = getFloorAt(centerX, footY);

        if (footY < targetFloor - 1 || state.vy < 0) {
          state.onGround = false;
          state.vy += 0.68; // Gravidade suave
          state.x += state.vx;
          state.y += state.vy;
          state.vx *= 0.985;

          // Aterrissou!
          if (state.y + PET_H >= targetFloor && state.vy >= 0) {
            state.y = targetFloor - PET_H;
            if (state.vy > 4.5) {
              state.squashX = 1.18;
              state.squashY = 0.84;
              CuteSynth.boing();
              scheduleProximityInspect(500);
            }
            state.vy = 0;
            state.vx = 0;
            state.onGround = true;
          }
        } else {
          state.y = targetFloor - PET_H;
          state.onGround = true;
        }

        // Mantém sempre dentro do palco completo de TODAS as telas (considerando a escala visual atual!)
        const totalStageW = getStageTotalWidth();
        const halfVisW = (PET_W * prefs.petScale) / 2;
        const minX = Math.round(6 + halfVisW - PET_W / 2);
        const maxX = Math.round(totalStageW - 6 - halfVisW - PET_W / 2);
        if (state.x < minX) {
          state.x = minX;
          state.walkDir = 1;
          state.walkTargetX = null;
          if (state.trick && (state.trick.type === 'CORRER_TURBO' || state.trick.type === 'MOONWALK')) state.trick.dir = 1;
        }
        if (state.x > maxX) {
          state.x = maxX;
          state.walkDir = -1;
          state.walkTargetX = null;
          if (state.trick && (state.trick.type === 'CORRER_TURBO' || state.trick.type === 'MOONWALK')) state.trick.dir = -1;
        }
        if (state.y < 10) { state.y = 10; state.vy = Math.max(0, state.vy); }

        // Detecta quando atravessa a fronteira de um monitor para outro!
        const curDisp = getDisplayAt(state.x + PET_W / 2);
        if (curDisp && curDisp.index !== state.lastDisplayIndex) {
          state.lastDisplayIndex = curDisp.index;
          state.lastScreenSwitchAt = Date.now();
          if (state.onGround) {
            state.vy = -4.5;
            state.onGround = false;
            spawnParticle('✨', 0, 12);
          }
        }

        // 1) Caminhada/Corrida Comandada por Voz ou Botão (CONTINUA mesmo enquanto o Stack-chan fala!)
        if (state.commandedWalk) {
          const dist = state.commandedWalk.targetX - (state.x + PET_W / 2);
          if (Math.abs(dist) < 26 || (now - state.commandedWalk.startedAt > 18000)) {
            state.commandedWalk = null;
            state.aiAction = 'IDLE';
            if (state.onGround) {
              state.vy = -4.8;
              state.onGround = false;
              spawnParticle('✨', 0, 10);
            }
          } else {
            state.walkDir = dist >= 0 ? 1 : -1;
            state.x += state.walkDir * state.commandedWalk.speed;
            state.walkCycle += 0.34;
            state.lookTarget.x = state.walkDir * 11;
            if (state.commandedWalk.hopStride && state.onGround && Math.random() < 0.045) {
              state.vy = -4.2;
              state.onGround = false;
            }
          }
        } else if (Date.now() < state.followMouseUntil) {
          // 2) Modo Seguir o Cursor do Mouse pelas Telas!
          const distMouse = state.mouseScreenX - (state.x + PET_W / 2);
          if (Math.abs(distMouse) > 68) {
            state.walkDir = distMouse >= 0 ? 1 : -1;
            state.x += state.walkDir * 3.8;
            state.walkCycle += 0.30;
            state.lookTarget.x = state.walkDir * 10;
          }
        } else {
          // 3) Comportamento autônomo normal (pausa suavemente enquanto conversa ou faz truque)
          const busyTalking = Boolean(state.trick) || state.isSpeaking || state.isThinking || state.isUserSpeaking || state.settingsOpen || state.isResizing;

          if (!busyTalking && state.onGround) {
            if (Date.now() - state.lastInteractionAt > 180000 && Date.now() - state.lastProximityCommentAt > 90000 && state.aiAction !== 'SLEEP') {
              state.aiAction = 'SLEEP';
              state.walkTargetX = null;
              setEmotion('SLEEPY', 0);
            }

            if (state.aiAction === 'SLEEP') {
              if (Math.random() < 0.008) spawnParticle('💤', 28, 12);
            } else if (prefs.roamEnabled) {
              if (now > state.nextAiDecisionAt) {
                const roll = Math.random();
                if (roll < 0.44) {
                  state.aiAction = 'WALK';
                  state.walkTargetX = pickAutonomousDestination(Date.now());
                  state.walkStartedAt = now;
                  state.walkDir = state.walkTargetX >= (state.x + PET_W / 2) ? 1 : -1;
                  state.nextAiDecisionAt = now + 22000;
                } else if (roll < 0.68) {
                  state.aiAction = 'WALK';
                  state.walkTargetX = null;
                  if (Math.random() < 0.45) {
                    state.walkDir = state.mouseScreenX > state.x + PET_W / 2 ? 1 : -1;
                  } else {
                    state.walkDir = Math.random() < 0.5 ? -1 : 1;
                  }
                  state.nextAiDecisionAt = now + 2800 + Math.random() * 4400;
                } else if (roll < 0.82 && (state.desktop.ledges || []).length > 0) {
                  const petCx = state.x + PET_W / 2;
                  const reachable = state.desktop.ledges.find((l) => {
                    const lCenter = l.x + l.w / 2;
                    return Math.abs(petCx - lCenter) < 360 && l.y < state.y + PET_H - 40 && ((state.y + PET_H) - l.y) < 470;
                  });
                  if (reachable) {
                    const ledgeCenter = reachable.x + reachable.w / 2;
                    const dyJump = (state.y + PET_H) - reachable.y;
                    state.vy = -Math.min(21, Math.sqrt(2 * 0.68 * (dyJump + 45)));
                    state.vx = (ledgeCenter - petCx) / 32;
                    state.onGround = false;
                    setEmotion('EXCITED', 2400);
                    CuteSynth.happy();
                    spawnParticle('✨', 0, 20);
                  }
                  state.aiAction = 'IDLE';
                  state.walkTargetX = null;
                  state.nextAiDecisionAt = now + 3500;
                } else if (roll < 0.91) {
                  state.aiAction = 'SIT';
                  state.walkTargetX = null;
                  state.nextAiDecisionAt = now + 3600 + Math.random() * 3600;
                  scheduleProximityInspect(400);
                } else {
                  state.aiAction = 'IDLE';
                  state.walkTargetX = null;
                  if (Math.random() < 0.28) {
                    state.vy = -6.5;
                    state.onGround = false;
                  }
                  state.nextAiDecisionAt = now + 2400 + Math.random() * 3200;
                  scheduleProximityInspect(400);
                }
              }

              if (state.aiAction === 'WALK') {
                if (state.walkTargetX !== null) {
                  const distToTarget = state.walkTargetX - (state.x + PET_W / 2);
                  if (Math.abs(distToTarget) < 28 || (now - state.walkStartedAt > 23000)) {
                    state.walkTargetX = null;
                    state.aiAction = 'IDLE';
                    state.nextAiDecisionAt = now + 3200 + Math.random() * 3500;
                    scheduleProximityInspect(350);
                  } else {
                    state.walkDir = distToTarget >= 0 ? 1 : -1;
                    const speed = 2.05;
                    state.x += state.walkDir * speed;
                    state.walkCycle += 0.23;
                    state.lookTarget.x = state.walkDir * 10;
                  }
                } else {
                  const speed = 1.35;
                  state.x += state.walkDir * speed;
                  state.walkCycle += 0.19;
                  state.lookTarget.x = state.walkDir * 9;
                }
              }
            } else {
              state.aiAction = 'IDLE';
              state.walkTargetX = null;
            }
          } else if (busyTalking) {
            if (state.aiAction === 'WALK' || state.aiAction === 'SLEEP') {
              state.aiAction = 'IDLE';
              state.walkTargetX = null;
            }
          }
        }
      }

      // Aplica transformações nos pezinhos, inclinação e COREOGRAFIAS ESPECIAIS 60 FPS!
      let bobY = 0;
      let bobX = 0;
      let tilt = 0;
      let trickSpinDeg = 0;
      let flipScaleX = 1;

      const isWalkingNow = Boolean(state.commandedWalk) ||
        (Date.now() < state.followMouseUntil && Math.abs(state.mouseScreenX - (state.x + PET_W / 2)) > 68) ||
        state.aiAction === 'WALK';

      if (state.trick) {
        const elapsed = now - state.trick.start;
        if (elapsed >= state.trick.duration) {
          if (state.trick.type === 'MODO_RGB' && state.trick.origSkin) {
            applySkin(state.trick.origSkin);
          }
          if (state.trick.type === 'FINGIR_MORTO' && state.onGround) {
            state.vy = -7.0;
            state.onGround = false;
            setEmotion('LAUGHING', 3200);
            CuteSynth.happy();
          }
          state.trick = null;
        } else {
          const tt = elapsed;
          switch (state.trick.type) {
            case 'DANCAR': {
              const beat = tt * 0.013;
              bobX = Math.sin(beat) * 16;
              bobY = -Math.abs(Math.sin(beat * 2)) * 15;
              tilt = Math.sin(beat) * 14;
              const fL = Math.max(-12, Math.sin(beat * 2) * 12);
              const fR = Math.max(-12, -Math.sin(beat * 2) * 12);
              footLeft.style.transform = `translateY(${fL}px) rotate(${Math.sin(beat) * 18}deg)`;
              footRight.style.transform = `translateY(${fR}px) rotate(${Math.cos(beat) * 18}deg)`;
              if (Math.floor(tt / 420) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 420);
                spawnParticle(['🎵', '🎶', '✨', '💃'][state.trick.stepTick % 4], (Math.random() - 0.5) * 40, 6);
                if (state.trick.stepTick % 4 === 0) CuteSynth.danceBeat();
              }
              break;
            }

            case 'MORTAL': {
              if (tt < 210) {
                // Impulso agachando antes do salto!
                state.squashX = 1.26;
                state.squashY = 0.72;
                bobY = 12;
                footLeft.style.transform = 'translateY(-4px) rotate(-15deg)';
                footRight.style.transform = 'translateY(-4px) rotate(15deg)';
              } else {
                if (!state.trick.launched) {
                  state.trick.launched = true;
                  state.vy = -16.4;
                  state.vx = state.trick.dir * 2.4;
                  state.onGround = false;
                  CuteSynth.fanfare();
                  spawnParticle('⭐', -18, 10);
                  spawnParticle('✨', 18, 10);
                }
                const airProgress = Math.min(1, (tt - 210) / 760);
                const easedSpin = 1 - Math.pow(1 - airProgress, 2);
                trickSpinDeg = -360 * state.trick.dir * easedSpin;
                footLeft.style.transform = 'rotate(-25deg)';
                footRight.style.transform = 'rotate(25deg)';
              }
              break;
            }

            case 'PIRUETA': {
              const phase = tt * 0.016;
              flipScaleX = Math.cos(phase);
              bobY = -Math.abs(Math.sin(phase * 0.5)) * 10;
              footLeft.style.transform = 'rotate(-16deg)';
              footRight.style.transform = 'rotate(16deg)';
              if (Math.floor(tt / 350) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 350);
                spawnParticle('💫', 0, 8);
              }
              break;
            }

            case 'MOONWALK': {
              // Desliza suavemente para trás enquanto faz o passo invertido!
              state.x += state.trick.dir * 2.2;
              const cycle = tt * 0.015;
              tilt = -state.trick.dir * 7.5;
              bobY = -Math.abs(Math.cos(cycle)) * 3;
              const slideL = Math.sin(cycle) * 11;
              const slideR = -Math.sin(cycle) * 11;
              footLeft.style.transform = `translateX(${slideL}px) rotate(${Math.max(0, Math.sin(cycle)) * -22}deg)`;
              footRight.style.transform = `translateX(${slideR}px) rotate(${Math.max(0, -Math.sin(cycle)) * -22}deg)`;
              state.lookTarget.x = -state.trick.dir * 11;
              if (Math.floor(tt / 450) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 450);
                spawnParticle('✨', -state.trick.dir * 32, 145);
              }
              break;
            }

            case 'COMEMORAR': {
              if (state.onGround && Math.floor(tt / 900) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 900);
                state.vy = -10.5;
                state.onGround = false;
                CuteSynth.happy();
                spawnParticle(['🎉', '🏆', '🔥', '✨'][state.trick.stepTick % 4], (Math.random() - 0.5) * 50, 4);
              }
              tilt = Math.sin(tt * 0.018) * 11;
              footLeft.style.transform = 'rotate(-20deg)';
              footRight.style.transform = 'rotate(20deg)';
              break;
            }

            case 'ESCONDER': {
              // Agachadinho bem baixinho tremendo e olhando pros lados!
              state.squashX = 1.22;
              state.squashY = 0.65;
              bobY = 22;
              bobX = Math.sin(tt * 0.09) * 2.4;
              state.lookTarget.x = Math.sin(tt * 0.007) * 13;
              state.lookTarget.y = -5;
              footLeft.style.transform = 'translateY(-8px) rotate(-28deg)';
              footRight.style.transform = 'translateY(-8px) rotate(28deg)';
              if (Math.floor(tt / 950) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 950);
                spawnParticle('💧', 26, 20);
              }
              break;
            }

            case 'FINGIR_MORTO': {
              const fallProg = Math.min(1, tt / 340);
              trickSpinDeg = 86 * fallProg;
              bobY = 16 * fallProg;
              footLeft.style.transform = 'rotate(25deg)';
              footRight.style.transform = 'rotate(-15deg)';
              if (Math.floor(tt / 1100) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 1100);
                spawnParticle('👻', 14, -8);
              }
              break;
            }

            case 'CORRER_TURBO': {
              state.x += state.trick.dir * 7.4;
              tilt = state.trick.dir * 16;
              state.walkCycle += 0.55;
              bobY = -Math.abs(Math.sin(state.walkCycle)) * 7;
              footLeft.style.transform = `translateY(${Math.sin(state.walkCycle) * 10}px) rotate(${Math.sin(state.walkCycle) * 22}deg)`;
              footRight.style.transform = `translateY(${-Math.sin(state.walkCycle) * 10}px) rotate(${-Math.sin(state.walkCycle) * 22}deg)`;
              state.lookTarget.x = state.trick.dir * 13;
              if (Math.floor(tt / 180) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 180);
                spawnParticle(state.trick.stepTick % 2 === 0 ? '💨' : '⚡', -state.trick.dir * 42, 130);
              }
              break;
            }

            case 'CANTAR': {
              const sway = tt * 0.008;
              tilt = Math.sin(sway) * 10;
              bobY = -Math.abs(Math.sin(sway * 2)) * 8;
              footLeft.style.transform = `rotate(${Math.sin(sway) * 12}deg)`;
              footRight.style.transform = `rotate(${-Math.sin(sway) * 12}deg)`;
              if (Math.floor(tt / 480) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 480);
                spawnParticle(['🎵', '🎶', '🎼', '🎤'][state.trick.stepTick % 4], (Math.random() - 0.5) * 45, 5);
                if (state.trick.stepTick === 4) CuteSynth.melody();
              }
              break;
            }

            case 'MODO_COMBATE': {
              bobX = Math.sin(tt * 0.08) * 3.5;
              const stomp = Math.sin(tt * 0.022);
              bobY = stomp < 0 ? stomp * 10 : 0;
              tilt = Math.sin(tt * 0.011) * 8;
              footLeft.style.transform = `translateY(${Math.min(0, stomp * 12)}px)`;
              footRight.style.transform = `translateY(${Math.min(0, -stomp * 12)}px)`;
              if (Math.floor(tt / 520) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 520);
                CuteSynth.angry();
                spawnParticle(state.trick.stepTick % 2 === 0 ? '💢' : '🔥', (Math.random() - 0.5) * 44, 8);
              }
              break;
            }

            case 'MANDAR_BEIJO': {
              tilt = Math.sin(tt * 0.007) * 9;
              bobY = -Math.abs(Math.sin(tt * 0.009)) * 7;
              state.squashX = 1.06;
              state.squashY = 0.95;
              if (Math.floor(tt / 500) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 500);
                spawnParticle(['❤️', '💖', '😘'][state.trick.stepTick % 3], (Math.random() - 0.5) * 40, 6);
              }
              break;
            }

            case 'MODO_RGB': {
              const skins = ['classic', 'sakura', 'mint', 'm5yellow', 'cyber'];
              const idx = Math.floor(tt / 220) % skins.length;
              petRig.setAttribute('data-skin', skins[idx]);
              bobY = -Math.abs(Math.sin(tt * 0.018)) * 11;
              tilt = Math.sin(tt * 0.012) * 10;
              if (Math.floor(tt / 380) > state.trick.stepTick) {
                state.trick.stepTick = Math.floor(tt / 380);
                spawnParticle(['🌈', '✨', '⚡'][state.trick.stepTick % 3], (Math.random() - 0.5) * 46, 6);
              }
              break;
            }
          }
        }
      } else if (!state.onGround || state.isDragging) {
        const swing = Math.sin(now * 0.016) * 18;
        footLeft.style.transform = `rotate(${swing}deg) translateY(3px)`;
        footRight.style.transform = `rotate(${-swing}deg) translateY(3px)`;
        tilt = Math.max(-14, Math.min(14, state.vx * 1.8));
      } else if (isWalkingNow) {
        const stepL = Math.max(-8, Math.sin(state.walkCycle) * 8);
        const stepR = Math.max(-8, Math.sin(state.walkCycle + Math.PI) * 8);
        footLeft.style.transform = `translateY(${stepL}px) rotate(${Math.sin(state.walkCycle) * 8}deg)`;
        footRight.style.transform = `translateY(${stepR}px) rotate(${-Math.sin(state.walkCycle) * 8}deg)`;
        bobY = -Math.abs(Math.sin(state.walkCycle)) * 4;
        tilt = state.walkDir * 3.0;
      } else if (state.aiAction === 'SIT') {
        footLeft.style.transform = `translateY(-5px) rotate(-22deg)`;
        footRight.style.transform = `translateY(-5px) rotate(22deg)`;
        bobY = 5;
      } else {
        footLeft.style.transform = 'none';
        footRight.style.transform = 'none';
        bobY = Math.sin(now * 0.0028) * 2.2;
        if (state.emotion === 'CURIOUS') tilt = 6.5;
        else if (state.emotion === 'LAUGHING') bobY = -Math.abs(Math.sin(now * 0.02)) * 6;
      }

      state.bodyTiltDeg += (tilt - state.bodyTiltDeg) * 0.18;
      state.currentLook.x += (state.lookTarget.x - state.currentLook.x) * 0.16;
      state.currentLook.y += (state.lookTarget.y - state.currentLook.y) * 0.16;

      const totalRotDeg = state.bodyTiltDeg + trickSpinDeg;
      const finalScaleX = state.squashX * flipScaleX;

      actorRoot.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`;
      petRig.style.transform = `translate(${bobX.toFixed(1)}px, ${bobY.toFixed(1)}px) rotate(${totalRotDeg.toFixed(1)}deg) scale(${finalScaleX.toFixed(3)}, ${state.squashY.toFixed(3)})`;

      renderOledFace(now);
      requestAnimationFrame(updatePhysicsAndAutonomy);
    }
    requestAnimationFrame(updatePhysicsAndAutonomy);

