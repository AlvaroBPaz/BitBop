/**
 * ============================================================================
 * MÓDULO: SilentRoamDanceModule (Modo Ações & Truques Aleatórios Silencioso)
 * Arquivo: silent_roam_dance.js
 * ============================================================================
 * 
 * Funcionalidade:
 * Transforma o BitBop em um companheiro 100% autônomo, divertido e visual:
 * - Anda livremente pelo desktop e salta entre monitores e topo de janelas.
 * - Executa TODAS as acrobacias, danças, truques e expressões do repertório aleatoriamente.
 * - RESTRIÇÃO DE TAMANHO & COR: Mantém 100% FIXO o tamanho e a cor escolhidos pelo usuário!
 *   (Sem mutações de escala Mini/Gigante e sem trocas de carcaça/RGB).
 * - 100% SILENCIOSO: Microfone desligado (zero processamento de VAD/STT / 0% CPU).
 * - SEM FALA: Sem áudio de voz TTS e sem balões de diálogo.
 * - Restauração fiel: ao desligar, recupera as preferências originais do usuário.
 */

(function (global) {
  'use strict';

  class SilentRoamDanceModule {
    constructor() {
      this.context = null;
      this.isActive = false;
      this.savedPrefs = null;
      this.schedulerTimer = null;
      this.lastActionId = null;

      // Intervalo dinâmico entre ações (6 a 13 segundos para variedade contínua)
      this.minIntervalMs = 6000;
      this.maxIntervalMs = 13000;

      // Repertório filtrado: APENAS acrobacias, coreografias, locomoção e expressões faciais!
      // (SEM mudanças de tamanho/escala e SEM mudanças de cor/skin)
      this.actionCatalog = [
        // --- 1. Acrobacias e Coreografias Físicas ---
        { id: 'DANCAR', label: 'Dança dos Pezinhos', type: 'action', weight: 4 },
        { id: 'MOONWALK', label: 'Passo Moonwalk', type: 'action', weight: 4 },
        { id: 'MORTAL', label: 'Mortal 360 Carpado', type: 'action', weight: 3 },
        { id: 'PIRUETA', label: 'Pirueta Aérea 3D', type: 'action', weight: 3 },
        { id: 'COMEMORAR', label: 'Comemoração Épica', type: 'action', weight: 3 },
        { id: 'CORRER_TURBO', label: 'Disparada Turbo', type: 'action', weight: 3 },
        { id: 'MODO_COMBATE', label: 'Modo Combate & Fogo', type: 'action', weight: 3 },
        { id: 'CANTAR', label: 'Balanço Musical', type: 'action', weight: 3 },
        { id: 'MANDAR_BEIJO', label: 'Beijo & Corações', type: 'action', weight: 3 },
        { id: 'ESCONDER', label: 'Agachadinho & Tímido', type: 'action', weight: 2 },
        { id: 'FINGIR_MORTO', label: 'Fingir de Morto & Reviver', type: 'action', weight: 2 },

        // --- 2. Exploração Dinâmica e Salto entre Telas ---
        { id: 'PULAR_ALTO', label: 'Salto Foguete / Subir em Janela', type: 'action', weight: 3 },
        { id: 'TROCAR_TELA', label: 'Salto para Outro Monitor', type: 'action', weight: 3 },
        { id: 'IR_DIREITA', label: 'Caminhada Rápida à Direita', type: 'action', weight: 2 },
        { id: 'IR_ESQUERDA', label: 'Caminhada Rápida à Esquerda', type: 'action', weight: 2 },
        { id: 'PULINHO_ALEGRE', label: 'Salto Elástico', type: 'hop', weight: 3 },

        // --- 3. Expressões Faciais Marcantes no Visor OLED ---
        { id: 'EXPR_COOL', label: 'Óculos de Sol', type: 'mood', mood: 'COOL', emoji: '🕶️', weight: 2 },
        { id: 'EXPR_LOVE', label: 'Olhos de Coração', type: 'mood', mood: 'LOVE', emoji: '❤️', weight: 2 },
        { id: 'EXPR_LAUGHING', label: 'Gargalhada Divertida', type: 'mood', mood: 'LAUGHING', emoji: '✨', weight: 2 },
        { id: 'EXPR_DIZZY', label: 'Olhos de Espiral', type: 'mood', mood: 'DIZZY', emoji: '💫', weight: 1.5 },
        { id: 'EXPR_SURPRISED', label: 'Surpreso & Curioso', type: 'mood', mood: 'SURPRISED', emoji: '👀', weight: 1.5 },
        { id: 'EXPR_EXCITED', label: 'Olhos Brilhantes', type: 'mood', mood: 'EXCITED', emoji: '⭐', weight: 2 },
      ];

      this._boundTick = this._executeRoutineTick.bind(this);
    }

    /**
     * Injeta o contexto da aplicação
     */
    init(petContext) {
      if (!petContext) {
        console.warn('[SilentRoamDance] Contexto inválido fornecido.');
        return this;
      }
      this.context = petContext;
      console.log(`[SilentRoamDance] Conectado. Repertório: ${this.actionCatalog.length} ações (mantendo cor e tamanho fixos).`);
      return this;
    }

    /**
     * Ativa o modo silencioso com execução contínua de ações (sem alterar cor nem tamanho)
     */
    enable() {
      if (this.isActive || !this.context) return false;

      try {
        const { state, prefs, stopCurrentSpeech, updateMicVisuals, updateCommModeVisuals, spawnParticle, setEmotion } = this.context;

        // 1. Grava snapshot de preferências do usuário
        this.savedPrefs = {
          micEnabled: Boolean(prefs.micEnabled),
          voiceEnabled: Boolean(prefs.voiceEnabled),
          bubbleEnabled: Boolean(prefs.bubbleEnabled),
          proximityChat: Boolean(prefs.proximityChat),
          roamEnabled: Boolean(prefs.roamEnabled),
        };

        // 2. Interrompe áudio ou fala ativa
        if (typeof stopCurrentSpeech === 'function') {
          stopCurrentSpeech();
        }

        // 3. Oculta balão de fala
        if (this.context.speechBubble) {
          this.context.speechBubble.classList.remove('visible');
        }

        // 4. Mudo Total: Desativa microfone (Zero consumo de CPU/VAD/STT)
        prefs.micEnabled = false;
        if (typeof updateMicVisuals === 'function') {
          updateMicVisuals();
        }

        // 5. Sem Fala: Desativa voz (TTS), balão de texto e comentários proativos
        prefs.voiceEnabled = false;
        prefs.bubbleEnabled = false;
        prefs.proximityChat = false;
        if (typeof updateCommModeVisuals === 'function') {
          updateCommModeVisuals();
        }

        // 6. Garante que a exploração livre esteja sempre ligada
        prefs.roamEnabled = true;
        if (this.context.chkRoam) {
          this.context.chkRoam.checked = true;
        }

        // 7. Acorda de imediato caso estivesse dormindo ou sentado
        state.aiAction = 'IDLE';
        state.walkTargetX = null;
        state.nextAiDecisionAt = 0;

        this.isActive = true;

        // 8. Efeito visual discreto de ativação
        if (typeof spawnParticle === 'function') {
          spawnParticle('🎭', 0, 10);
          spawnParticle('⚡', 0, -10);
        }
        if (typeof setEmotion === 'function') {
          setEmotion('COOL', 2500);
        }

        // 9. Dispara o agendador de ações aleatórias contínuas imediatamente
        this._scheduleNext(400);

        this._dispatchChangeEvent(true);
        console.log('[SilentRoamDance] Ativado: o pet executará truques e acrobacias mantendo tamanho e cor intactos.');
        return true;
      } catch (err) {
        console.error('[SilentRoamDance] Erro ao ativar:', err);
        return false;
      }
    }

    /**
     * Desativa o modo e restaura fielmente o estado anterior do usuário
     */
    disable() {
      if (!this.isActive || !this.context) return false;

      try {
        const { prefs, updateMicVisuals, updateCommModeVisuals, spawnParticle, setEmotion } = this.context;

        // Cancela timers de repetição
        if (this.schedulerTimer) {
          clearTimeout(this.schedulerTimer);
          this.schedulerTimer = null;
        }

        // Restaura as preferências que o usuário usava antes
        if (this.savedPrefs) {
          prefs.micEnabled = this.savedPrefs.micEnabled;
          prefs.voiceEnabled = this.savedPrefs.voiceEnabled;
          prefs.bubbleEnabled = this.savedPrefs.bubbleEnabled;
          prefs.proximityChat = this.savedPrefs.proximityChat;
          prefs.roamEnabled = this.savedPrefs.roamEnabled;
          this.savedPrefs = null;
        }

        const { state } = this.context;
        if (state) {
          state.aiAction = 'IDLE';
          state.walkTargetX = null;
          state.nextAiDecisionAt = 0;
        }

        if (typeof updateMicVisuals === 'function') {
          updateMicVisuals();
        }
        if (typeof updateCommModeVisuals === 'function') {
          updateCommModeVisuals();
        }

        this.isActive = false;

        if (typeof spawnParticle === 'function') {
          spawnParticle('☀️', 0, 10);
        }
        if (typeof setEmotion === 'function') {
          setEmotion('HAPPY', 3000);
        }

        this._dispatchChangeEvent(false);
        console.log('[SilentRoamDance] Desativado: preferências restauradas.');
        return true;
      } catch (err) {
        console.error('[SilentRoamDance] Erro ao desativar:', err);
        return false;
      }
    }

    /**
     * Alterna o estado do modo
     */
    toggle() {
      return this.isActive ? this.disable() : this.enable();
    }

    /**
     * Agenda a próxima ação aleatória com jitter natural
     * @private
     */
    _scheduleNext(delayOverrideMs = null) {
      if (!this.isActive) return;

      if (this.schedulerTimer) {
        clearTimeout(this.schedulerTimer);
        this.schedulerTimer = null;
      }

      const delay = delayOverrideMs !== null
        ? delayOverrideMs
        : Math.floor(this.minIntervalMs + Math.random() * (this.maxIntervalMs - this.minIntervalMs));

      this.schedulerTimer = setTimeout(this._boundTick, delay);
    }

    /**
     * Sorteia e executa uma ação da lista
     * @private
     */
    _executeRoutineTick() {
      if (!this.isActive || !this.context) return;

      try {
        const { state, executePetAction, setEmotion, spawnParticle, CuteSynth } = this.context;

        // Se o usuário estiver arrastando, redimensionando ou o pet estiver ocupado com um truque longo, aguarda um pouco
        if (state.isDragging || state.isResizing || state.trick || !state.onGround) {
          this._scheduleNext(2500);
          return;
        }

        // Filtra para nunca repetir exatamente a mesma ação duas vezes seguidas
        const candidates = this.actionCatalog.filter((item) => item.id !== this.lastActionId);

        // Roleta ponderada por peso
        const totalWeight = candidates.reduce((sum, item) => sum + (item.weight || 1), 0);
        let randVal = Math.random() * totalWeight;
        let chosen = candidates[0];

        for (const item of candidates) {
          randVal -= (item.weight || 1);
          if (randVal <= 0) {
            chosen = item;
            break;
          }
        }

        this.lastActionId = chosen.id;
        console.log(`[SilentRoamDance] Executando ação: [${chosen.id}] (${chosen.label})`);

        // Executa conforme a categoria da ação (NUNCA altera skin e NUNCA altera escala)
        switch (chosen.type) {
          case 'action': {
            // Executa com fromUiClick: false para GARANTIR ZERO FALA e ZERO BALÃO!
            if (typeof executePetAction === 'function') {
              executePetAction(chosen.id, { fromUiClick: false });
            }
            break;
          }

          case 'hop': {
            state.vy = -7.5;
            state.vx = (Math.random() - 0.5) * 5;
            state.onGround = false;
            if (typeof setEmotion === 'function') setEmotion('EXCITED', 2500);
            if (typeof spawnParticle === 'function') spawnParticle('⭐', 0, 10);
            if (CuteSynth && typeof CuteSynth.happy === 'function') CuteSynth.happy();
            break;
          }

          case 'mood': {
            if (typeof setEmotion === 'function') {
              setEmotion(chosen.mood, 4500);
            }
            if (typeof spawnParticle === 'function' && chosen.emoji) {
              spawnParticle(chosen.emoji, 0, 8);
            }
            break;
          }
        }

        // Reagenda o próximo sorteio
        this._scheduleNext();
      } catch (err) {
        console.warn('[SilentRoamDance] Erro na execução da ação aleatória:', err);
        this._scheduleNext(5000);
      }
    }

    /**
     * Emite evento CustomEvent no window para sincronizar controles
     * @private
     */
    _dispatchChangeEvent(active) {
      try {
        window.dispatchEvent(new CustomEvent('silent-roam-dance:change', {
          detail: { active, timestamp: Date.now() },
        }));
      } catch {}
    }

    /**
     * Retorna status atual do módulo
     */
    getStatus() {
      return {
        active: this.isActive,
        lastAction: this.lastActionId,
        availableActionsCount: this.actionCatalog.length,
      };
    }
  }

  // Exportação segura
  const instance = new SilentRoamDanceModule();
  if (typeof module !== 'undefined' && module.exports) module.exports = instance;
  global.SilentRoamDance = instance;
})(typeof window !== 'undefined' ? window : global);
