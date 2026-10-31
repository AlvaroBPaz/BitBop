    // =========================================================================
    // 4. BALÃO DE FALA AUTO-OCULTÁVEL E PARTÍCULAS VISUAIS
    // =========================================================================
    let bubbleHideTimer = null;
    let actionBadgeHideTimer = null;
    const actionBadgeEl = document.getElementById('actionBadge');
    const actionBadgeIconEl = document.getElementById('actionBadgeIcon');
    const actionBadgeTextEl = document.getElementById('actionBadgeText');

    function showActionBadge(icon, text, autoHideMs = 3800) {
      if (!actionBadgeEl) return;
      if (actionBadgeHideTimer) clearTimeout(actionBadgeHideTimer);

      if (actionBadgeIconEl) actionBadgeIconEl.innerText = icon || '⚡';
      if (actionBadgeTextEl) actionBadgeTextEl.innerText = text || '';

      actionBadgeEl.classList.add('visible');

      if (autoHideMs > 0) {
        actionBadgeHideTimer = setTimeout(() => {
          actionBadgeEl.classList.remove('visible');
        }, autoHideMs);
      }
    }

    function hideActionBadge() {
      if (actionBadgeHideTimer) clearTimeout(actionBadgeHideTimer);
      if (actionBadgeEl) actionBadgeEl.classList.remove('visible');
    }

    function showBubble(label, text, autoHideMs = 5500, showVisionTag = false, force = false, obsidianCount = 0) {
      if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
      speakerLabel.innerText = label;
      speechText.innerText = text;
      visionBadge.style.display = showVisionTag ? 'inline' : 'none';

      const obsBadge = document.getElementById('obsidianBadge');
      if (obsBadge) {
        if (obsidianCount > 0) {
          obsBadge.innerText = `📚 Lido do Obsidian (${obsidianCount} notas)`;
          obsBadge.style.display = 'inline';
        } else {
          obsBadge.style.display = 'none';
        }
      }

      // Se o usuário desativou o balão de fala nas configurações, nunca exibe o diálogo falado
      if (!prefs.bubbleEnabled && !force) {
        speechBubble.classList.remove('visible');
        return;
      }
      speechBubble.classList.add('visible');

      if (autoHideMs > 0) {
        bubbleHideTimer = setTimeout(() => {
          if (!state.isSpeaking && !state.isThinking && !state.isUserSpeaking && !state.isTranscribing) {
            speechBubble.classList.remove('visible');
            if (obsBadge) obsBadge.style.display = 'none';
          }
        }, autoHideMs);
      }
    }

    function spawnParticle(symbol, offsetX = 0, offsetY = 10) {
      const el = document.createElement('div');
      el.className = 'fx-particle';
      el.innerText = symbol;
      const px = state.x + PET_W / 2 + offsetX + (Math.random() - 0.5) * 55;
      const py = state.y + offsetY + (Math.random() - 0.5) * 20;
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 44)}px`);
      el.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 35)}deg`);
      fxLayer.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    }

    function setEmotion(emo, durationMs = 4500) {
      state.emotion = emo;
      state.emotionUntil = durationMs > 0 ? Date.now() + durationMs : 0;
    }

    // =========================================================================
    // 5. MOTOR DE EXPRESSÕES FACIAIS OLED (12+ ROSTOS RICOS)
    // =========================================================================
    const EMOTION_THEMES = {
      NORMAL:    { color: '#00f5ff', glow: 'rgba(0, 245, 255, 0.22)', blush: 0 },
      HAPPY:     { color: '#00f5ff', glow: 'rgba(0, 245, 255, 0.28)', blush: 0.7 },
      EXCITED:   { color: '#38bdf8', glow: 'rgba(250, 204, 21, 0.35)', blush: 0.85 },
      LOVE:      { color: '#fb7185', glow: 'rgba(251, 113, 133, 0.40)', blush: 1.0 },
      SAD:       { color: '#60a5fa', glow: 'rgba(96, 165, 250, 0.22)', blush: 0 },
      ANGRY:     { color: '#f87171', glow: 'rgba(248, 113, 113, 0.35)', blush: 0.4 },
      SURPRISED: { color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.35)', blush: 0.3 },
      CURIOUS:   { color: '#22d3ee', glow: 'rgba(34, 211, 238, 0.30)', blush: 0.2 },
      LAUGHING:  { color: '#34d399', glow: 'rgba(52, 211, 153, 0.32)', blush: 0.9 },
      DIZZY:     { color: '#facc15', glow: 'rgba(250, 204, 21, 0.30)', blush: 0.5 },
      SLEEPY:    { color: '#a78bfa', glow: 'rgba(167, 139, 250, 0.16)', blush: 0.3 },
      LISTENING: { color: '#34d399', glow: 'rgba(52, 211, 153, 0.35)', blush: 0.2 },
      THINKING:  { color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.26)', blush: 0 },
      COOL:      { color: '#38bdf8', glow: 'rgba(236, 72, 153, 0.38)', blush: 0.35 },
      DEAD:      { color: '#94a3b8', glow: 'rgba(148, 163, 184, 0.12)', blush: 0 },
    };

    function renderOledFace(now) {
      if (state.emotionUntil > 0 && now > state.emotionUntil && !state.isSpeaking && !state.isThinking && !state.isUserSpeaking) {
        state.emotion = state.aiAction === 'SLEEP' ? 'SLEEPY' : 'NORMAL';
        state.emotionUntil = 0;
      }

      const emo = state.isUserSpeaking ? 'LISTENING' : (state.isThinking ? 'THINKING' : state.emotion);
      const theme = EMOTION_THEMES[emo] || EMOTION_THEMES.NORMAL;
      const col = theme.color;

      oledScreen.style.setProperty('--glow-color', theme.glow);
      blushGroup.setAttribute('opacity', `${theme.blush}`);
      scanBeam.classList.toggle('scanning', state.isScanningScreen);

      // Posição dos olhos com parallax 2.5D
      const lx = 92 + state.currentLook.x;
      const rx = 228 + state.currentLook.x;
      const ey = 108 + state.currentLook.y;
      leftEyeSlot.setAttribute('transform', `translate(${lx.toFixed(1)}, ${ey.toFixed(1)})`);
      rightEyeSlot.setAttribute('transform', `translate(${rx.toFixed(1)}, ${ey.toFixed(1)})`);

      // Reset padrão
      leftBrow.setAttribute('d', '');
      rightBrow.setAttribute('d', '');
      leftBrow.setAttribute('stroke', col);
      rightBrow.setAttribute('stroke', col);
      leftEyeShape.setAttribute('d', '');
      rightEyeShape.setAttribute('d', '');
      leftEyeShape.setAttribute('stroke', col);
      rightEyeShape.setAttribute('stroke', col);
      leftEyeShape.setAttribute('fill', 'none');
      rightEyeShape.setAttribute('fill', 'none');
      leftEyeMain.setAttribute('fill', col);
      rightEyeMain.setAttribute('fill', col);
      leftTear.setAttribute('opacity', '0');
      rightTear.setAttribute('opacity', '0');
      thinkDots.setAttribute('opacity', emo === 'THINKING' ? '1' : '0');

      let showSolidEyes = true;
      let eyeRxL = 20, eyeRyL = 25, eyeRxR = 20, eyeRyR = 25;

      if (state.isBlinking && (emo === 'NORMAL' || emo === 'CURIOUS' || emo === 'LISTENING' || emo === 'THINKING')) {
        showSolidEyes = false;
        leftEyeShape.setAttribute('d', 'M -20 0 L 20 0');
        rightEyeShape.setAttribute('d', 'M -20 0 L 20 0');
      } else {
        switch (emo) {
          case 'HAPPY':
            showSolidEyes = false;
            leftEyeShape.setAttribute('d', 'M -20 6 Q 0 -18 20 6');
            rightEyeShape.setAttribute('d', 'M -20 6 Q 0 -18 20 6');
            break;

          case 'LOVE':
            showSolidEyes = false;
            // Corações fofos nos olhos!
            const heartPath = 'M 0 14 C -24 -2, -26 -20, -11 -20 C -4 -20, 0 -13, 0 -9 C 0 -13, 4 -20, 11 -20 C 26 -20, 24 -2, 0 14 Z';
            leftEyeShape.setAttribute('d', heartPath);
            rightEyeShape.setAttribute('d', heartPath);
            leftEyeShape.setAttribute('fill', '#fb7185');
            rightEyeShape.setAttribute('fill', '#fb7185');
            leftEyeShape.setAttribute('stroke-width', '2');
            rightEyeShape.setAttribute('stroke-width', '2');
            break;

          case 'EXCITED':
            showSolidEyes = false;
            // Estrelas brilhantes pulsantes!
            const s = 1 + Math.sin(now * 0.015) * 0.12;
            const star = `M 0 ${-24 * s} L ${6 * s} ${-6 * s} L ${24 * s} 0 L ${6 * s} ${6 * s} L 0 ${24 * s} L ${-6 * s} ${6 * s} L ${-24 * s} 0 L ${-6 * s} ${-6 * s} Z`;
            leftEyeShape.setAttribute('d', star);
            rightEyeShape.setAttribute('d', star);
            leftEyeShape.setAttribute('fill', '#fde047');
            rightEyeShape.setAttribute('fill', '#fde047');
            leftEyeShape.setAttribute('stroke', '#38bdf8');
            rightEyeShape.setAttribute('stroke', '#38bdf8');
            leftEyeShape.setAttribute('stroke-width', '3');
            rightEyeShape.setAttribute('stroke-width', '3');
            leftBrow.setAttribute('d', `M ${lx - 22} ${ey - 34} Q ${lx} ${ey - 44} ${lx + 20} ${ey - 32}`);
            rightBrow.setAttribute('d', `M ${rx - 20} ${ey - 32} Q ${rx} ${ey - 44} ${rx + 22} ${ey - 34}`);
            break;

          case 'LAUGHING':
            showSolidEyes = false;
            leftEyeShape.setAttribute('d', 'M -18 -12 L 16 0 L -18 12');
            rightEyeShape.setAttribute('d', 'M 18 -12 L -16 0 L 18 12');
            break;

          case 'SAD':
            eyeRxL = 20; eyeRyL = 21; eyeRxR = 20; eyeRyR = 21;
            leftBrow.setAttribute('d', `M ${lx - 24} ${ey - 24} Q ${lx} ${ey - 32} ${lx + 20} ${ey - 38}`);
            rightBrow.setAttribute('d', `M ${rx - 20} ${ey - 38} Q ${rx} ${ey - 32} ${rx + 24} ${ey - 24}`);
            const tearBob = Math.sin(now * 0.008) * 2.5;
            leftTear.setAttribute('cy', `${20 + tearBob}`);
            rightTear.setAttribute('cy', `${20 - tearBob}`);
            leftTear.setAttribute('opacity', '0.9');
            rightTear.setAttribute('opacity', '0.9');
            break;

          case 'ANGRY':
            eyeRxL = 21; eyeRyL = 16; eyeRxR = 21; eyeRyR = 16;
            leftBrow.setAttribute('d', `M ${lx - 24} ${ey - 34} L ${lx + 22} ${ey - 18}`);
            rightBrow.setAttribute('d', `M ${rx - 22} ${ey - 18} L ${rx + 24} ${ey - 34}`);
            break;

          case 'SURPRISED':
            showSolidEyes = false;
            leftEyeShape.setAttribute('d', 'M -23 0 A 23 26 0 1 0 23 0 A 23 26 0 1 0 -23 0 M -4 0 A 4 4 0 1 0 4 0 A 4 4 0 1 0 -4 0');
            rightEyeShape.setAttribute('d', 'M -23 0 A 23 26 0 1 0 23 0 A 23 26 0 1 0 -23 0 M -4 0 A 4 4 0 1 0 4 0 A 4 4 0 1 0 -4 0');
            leftBrow.setAttribute('d', `M ${lx - 20} ${ey - 38} Q ${lx} ${ey - 48} ${lx + 20} ${ey - 38}`);
            rightBrow.setAttribute('d', `M ${rx - 20} ${ey - 38} Q ${rx} ${ey - 48} ${rx + 20} ${ey - 38}`);
            break;

          case 'CURIOUS':
            eyeRxL = 16; eyeRyL = 19;
            eyeRxR = 24; eyeRyR = 28;
            rightBrow.setAttribute('d', `M ${rx - 22} ${ey - 38} Q ${rx} ${ey - 48} ${rx + 22} ${ey - 36}`);
            break;

          case 'DIZZY':
            showSolidEyes = false;
            const rot = (now * 0.45) % 360;
            const spiral = 'M 0 0 m -4 0 a 4 4 0 1 0 8 0 a 9 9 0 1 0 -18 0 a 15 15 0 1 0 30 0 a 20 20 0 1 0 -40 0';
            leftEyeShape.setAttribute('d', spiral);
            rightEyeShape.setAttribute('d', spiral);
            leftEyeShape.setAttribute('stroke-width', '4.5');
            rightEyeShape.setAttribute('stroke-width', '4.5');
            leftEyeShape.setAttribute('transform', `rotate(${rot})`);
            rightEyeShape.setAttribute('transform', `rotate(${-rot})`);
            break;

          case 'SLEEPY':
            showSolidEyes = false;
            leftEyeShape.setAttribute('d', 'M -19 4 Q 0 12 19 4');
            rightEyeShape.setAttribute('d', 'M -19 4 Q 0 12 19 4');
            break;

          case 'LISTENING':
            eyeRxL = 22; eyeRyL = 27; eyeRxR = 22; eyeRyR = 27;
            break;

          case 'THINKING':
            eyeRxL = 19; eyeRyL = 22; eyeRxR = 19; eyeRyR = 22;
            document.getElementById('td1').setAttribute('cy', `${Math.sin(now * 0.008) * 5}`);
            document.getElementById('td2').setAttribute('cy', `${Math.sin(now * 0.008 + 1.2) * 5}`);
            document.getElementById('td3').setAttribute('cy', `${Math.sin(now * 0.008 + 2.4) * 5}`);
            break;

          case 'COOL':
            showSolidEyes = false;
            // Óculos escuros estilosos tipo visor cyber!
            const shadeLens = 'M -28 -10 L 28 -10 L 22 14 Q 0 18 -22 14 Z';
            leftEyeShape.setAttribute('d', shadeLens);
            rightEyeShape.setAttribute('d', shadeLens);
            leftEyeShape.setAttribute('fill', '#0ea5e9');
            rightEyeShape.setAttribute('fill', '#ec4899');
            leftEyeShape.setAttribute('stroke', '#f8fafc');
            rightEyeShape.setAttribute('stroke', '#f8fafc');
            leftEyeShape.setAttribute('stroke-width', '3.5');
            rightEyeShape.setAttribute('stroke-width', '3.5');
            leftBrow.setAttribute('d', `M ${lx + 24} ${ey - 8} L ${rx - 24} ${ey - 8}`);
            leftBrow.setAttribute('stroke', '#f8fafc');
            break;

          case 'DEAD':
            showSolidEyes = false;
            // Olhos X X dramáticos de fingir de morto!
            const xEye = 'M -17 -17 L 17 17 M 17 -17 L -17 17';
            leftEyeShape.setAttribute('d', xEye);
            rightEyeShape.setAttribute('d', xEye);
            leftEyeShape.setAttribute('stroke', '#f87171');
            rightEyeShape.setAttribute('stroke', '#f87171');
            leftEyeShape.setAttribute('stroke-width', '6.5');
            rightEyeShape.setAttribute('stroke-width', '6.5');
            break;
        }
      }

      if (emo !== 'DIZZY') {
        leftEyeShape.removeAttribute('transform');
        rightEyeShape.removeAttribute('transform');
      }

      if (showSolidEyes) {
        leftEyeMain.setAttribute('opacity', '1');
        rightEyeMain.setAttribute('opacity', '1');
        leftEyeMain.setAttribute('rx', `${eyeRxL}`);
        leftEyeMain.setAttribute('ry', `${eyeRyL}`);
        rightEyeMain.setAttribute('rx', `${eyeRxR}`);
        rightEyeMain.setAttribute('ry', `${eyeRyR}`);
        leftEyeGlint.setAttribute('opacity', '0.85');
        rightEyeGlint.setAttribute('opacity', '0.85');
      } else {
        leftEyeMain.setAttribute('opacity', '0');
        rightEyeMain.setAttribute('opacity', '0');
        leftEyeGlint.setAttribute('opacity', '0');
        rightEyeGlint.setAttribute('opacity', '0');
      }

      // Boca dinâmica: Lip-Sync quando falando, ou forma emocional expressiva!
      mouthSlot.setAttribute('transform', `translate(${160 + state.currentLook.x * 0.45}, 176)`);
      mouthPath.setAttribute('stroke', col);
      mouthTalkRect.setAttribute('fill', col);

      if (state.isSpeaking) {
        mouthPath.setAttribute('opacity', '0');
        mouthTalkRect.setAttribute('opacity', '1');
        const openAmt = Math.min(1, Math.max(0.08, state.mouthOpen));
        const h = 5 + openAmt * 30;
        const w = 34 + openAmt * 22;
        mouthTalkRect.setAttribute('x', `${-w / 2}`);
        mouthTalkRect.setAttribute('y', `${-h / 2}`);
        mouthTalkRect.setAttribute('width', `${w}`);
        mouthTalkRect.setAttribute('height', `${h}`);
        mouthTalkRect.setAttribute('rx', `${Math.min(w / 2, h / 2)}`);
      } else {
        mouthTalkRect.setAttribute('opacity', '0');
        mouthPath.setAttribute('opacity', '1');
        mouthPath.setAttribute('fill', 'none');

        if (emo === 'HAPPY' || emo === 'LOVE') {
          mouthPath.setAttribute('d', 'M -24 -3 Q 0 18 24 -3');
        } else if (emo === 'EXCITED' || emo === 'LAUGHING') {
          mouthPath.setAttribute('d', 'M -26 -5 Q 0 26 26 -5 Z');
          mouthPath.setAttribute('fill', col);
        } else if (emo === 'SAD') {
          mouthPath.setAttribute('d', 'M -22 10 Q 0 -8 22 10');
        } else if (emo === 'ANGRY') {
          mouthPath.setAttribute('d', 'M -22 6 L -10 -2 L 0 6 L 10 -2 L 22 6');
        } else if (emo === 'SURPRISED') {
          mouthPath.setAttribute('d', 'M -10 0 A 10 12 0 1 0 10 0 A 10 12 0 1 0 -10 0');
        } else if (emo === 'DIZZY') {
          mouthPath.setAttribute('d', 'M -26 2 Q -13 -10 0 2 T 26 2');
        } else if (emo === 'SLEEPY') {
          mouthPath.setAttribute('d', 'M -8 2 A 6 6 0 1 0 8 2 A 6 6 0 1 0 -8 2');
        } else if (emo === 'COOL') {
          mouthPath.setAttribute('d', 'M -18 2 Q 2 14 24 -4');
        } else if (emo === 'DEAD') {
          mouthPath.setAttribute('d', 'M -20 4 L 20 4 M 4 4 Q 10 18 16 4');
        } else if (emo === 'LISTENING') {
          mouthPath.setAttribute('d', 'M -15 0 Q 0 10 15 0');
        } else {
          mouthPath.setAttribute('d', 'M -20 -1 Q 0 8 20 -1');
        }
      }
    }

    // Piscar natural
    function scheduleBlink() {
      setTimeout(() => {
        if (!state.isBlinking && state.aiAction !== 'SLEEP') {
          state.isBlinking = true;
          setTimeout(() => { state.isBlinking = false; }, 125);
        }
        scheduleBlink();
      }, 2400 + Math.random() * 3400);
    }
    scheduleBlink();


// Globais exportadas para window
window.setEmotion = setEmotion;
window.showBubble = showBubble;
window.showActionBadge = showActionBadge;
window.hideActionBadge = hideActionBadge;
window.spawnParticle = spawnParticle;
window.EMOTION_THEMES = EMOTION_THEMES;
