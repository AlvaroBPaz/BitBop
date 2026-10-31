    // =========================================================================
    // 1. SINTETIZADOR PROCEDURAL DE SONS FOFOS DE ROBÔ (ZERO LATÊNCIA WEBAUDIO)
    // =========================================================================
    const CuteSynth = (() => {
      let ctx = null;
      function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      }

      function tone(freqStart, freqEnd, durationSec, type = 'sine', vol = 0.11, delaySec = 0) {
        if (!prefs.sfxEnabled) return;
        try {
          const c = getCtx();
          const t0 = c.currentTime + delaySec;
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freqStart, t0);
          if (freqEnd !== freqStart) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + durationSec);
          }
          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(t0);
          osc.stop(t0 + durationSec + 0.01);
        } catch {}
      }

      return {
        sleepy() {
          tone(440, 330, 0.28, 'sine', 0.08, 0);
          tone(330, 220, 0.36, 'sine', 0.06, 0.22);
        },
        happy() {
          tone(587, 740, 0.08, 'sine', 0.10, 0);
          tone(880, 1174, 0.11, 'sine', 0.10, 0.075);
        },
        excited() {
          tone(523, 659, 0.07, 'triangle', 0.10, 0);
          tone(659, 880, 0.07, 'triangle', 0.10, 0.065);
          tone(880, 1318, 0.13, 'sine', 0.12, 0.13);
        },
        purr() {
          const base = 290 + Math.random() * 90;
          tone(base, base * 1.28, 0.14, 'sine', 0.075, 0);
          tone(base * 1.5, base * 1.85, 0.11, 'sine', 0.055, 0.06);
        },
        curious() {
          tone(440, 520, 0.08, 'sine', 0.09, 0);
          tone(540, 920, 0.14, 'sine', 0.10, 0.08);
        },
        thinking() {
          tone(440, 580, 0.08, 'sine', 0.08, 0);
          tone(580, 720, 0.10, 'sine', 0.08, 0.07);
          tone(720, 880, 0.12, 'sine', 0.09, 0.16);
        },
        surprised() {
          tone(380, 1240, 0.13, 'sine', 0.12, 0);
        },
        sad() {
          tone(520, 390, 0.18, 'sine', 0.09, 0);
          tone(380, 275, 0.26, 'sine', 0.08, 0.16);
        },
        angry() {
          tone(220, 165, 0.09, 'sawtooth', 0.065, 0);
          tone(195, 140, 0.11, 'sawtooth', 0.065, 0.095);
        },
        dizzy() {
          tone(720, 420, 0.09, 'sine', 0.09, 0);
          tone(420, 760, 0.09, 'sine', 0.09, 0.09);
          tone(760, 360, 0.12, 'sine', 0.09, 0.18);
        },
        boing() {
          tone(190, 360, 0.09, 'sine', 0.07, 0);
        },
        scan() {
          tone(880, 1320, 0.06, 'sine', 0.08, 0);
          tone(1320, 1760, 0.08, 'sine', 0.08, 0.065);
        },
        fanfare() {
          tone(523.25, 523.25, 0.09, 'triangle', 0.11, 0);
          tone(659.25, 659.25, 0.09, 'triangle', 0.11, 0.09);
          tone(783.99, 783.99, 0.09, 'triangle', 0.11, 0.18);
          tone(1046.5, 1080, 0.24, 'triangle', 0.13, 0.27);
        },
        danceBeat() {
          const notes = [330, 440, 523.25, 659.25, 523.25, 659.25, 784, 659.25];
          notes.forEach((f, idx) => {
            tone(f, f * 1.03, 0.11, 'triangle', 0.09, idx * 0.18);
          });
        },
        melody() {
          const song = [523.25, 587.33, 659.25, 783.99, 659.25, 880, 783.99, 1046.5];
          song.forEach((f, idx) => {
            tone(f, f, 0.16, 'sine', 0.10, idx * 0.21);
          });
        },
        powerUp() {
          tone(260, 520, 0.12, 'triangle', 0.10, 0);
          tone(400, 880, 0.14, 'triangle', 0.11, 0.09);
          tone(620, 1320, 0.18, 'sine', 0.12, 0.18);
        },
        shrinkDown() {
          tone(980, 480, 0.12, 'sine', 0.10, 0);
          tone(620, 260, 0.16, 'sine', 0.10, 0.10);
        },
        koDrop() {
          tone(640, 150, 0.34, 'sawtooth', 0.08, 0);
          tone(160, 95, 0.22, 'sine', 0.10, 0.30);
        },
        zoomDash() {
          tone(280, 1180, 0.14, 'triangle', 0.10, 0);
          tone(760, 1480, 0.10, 'sine', 0.09, 0.08);
        },
        swallowCrunch() {
          tone(340, 190, 0.08, 'sawtooth', 0.08, 0);
          tone(460, 240, 0.09, 'sine', 0.09, 0.07);
          tone(260, 680, 0.14, 'triangle', 0.11, 0.15);
        }
      };
    })();


// Globais exportadas para window
window.CuteSynth = CuteSynth;
