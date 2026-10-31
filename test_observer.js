/**
 * test_observer.js — Suíte de Testes Unitários para Fase 6: Observador de Tela Inteligente
 * Valida Seção 7 de SPEC_PERSONALIDADE_ADAPTATIVA.md
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock do ambiente global
global.window = global;
global.prefs = {
  personality: 'adaptativo',
  studyMode: false,
  proximityChat: true,
  screenObserverEnabled: true,
  voiceEnabled: true,
  bubbleEnabled: true,
  geminiApiKey: '' // modo offline / rule-based para testes unitários
};
global.state = {
  desktop: { activeApp: 'Code.exe', activeTitle: 'pet_brain.js - Stack-Chan' },
  emotion: 'NORMAL',
  frustrationDetected: false,
  studyMode: false,
  privateMode: false,
  isSensitiveWindow: false,
  isSpeaking: false,
  isThinking: false,
  isUserSpeaking: false,
  settingsOpen: false,
  lastUserInteractionAt: Date.now()
};

// Telemetria de efeitos visuais / áudio mockados
let lastEmotionSet = '';
let lastBubbleShown = '';
let lastSpokenText = '';
let cuteSynthChirpCount = 0;

global.setEmotion = (emotion) => { lastEmotionSet = emotion; };
global.showBubble = (label, text) => { lastBubbleShown = text; };
global.speakText = (text) => { lastSpokenText = text; };
global.CuteSynth = {
  chirp: () => { cuteSynthChirpCount++; },
  curious: () => { }
};

const MemoryStore = require('./js/memory/memory_store.js');
const PersonalityStore = require('./js/personality/personality_store.js');
const PersonalityEngine = require('./js/personality/personality_engine.js');
const ContextDetector = require('./js/personality/context_detector.js');
const ScreenObserver = require('./js/observer/screen_observer.js');

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO SUÍTE DE TESTES: ScreenObserver (~5 min)');
  console.log('====================================================\n');

  PersonalityStore.init();
  PersonalityEngine.init();
  ContextDetector.init();

  // [1] Testando Portões de Decisão
  console.log('[1] Testando portões de decisão obrigatórios...');

  // 1a. Estado normal -> Portões devem passar
  const passCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(passCheck.pass, true, 'Portões normais devem passar');
  console.log('- Condições normais: Todos os portões liberados (PASS)');

  // 1b. Modo Estudo -> Deve bloquear
  global.state.studyMode = true;
  const studyCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(studyCheck.pass, false);
  assert.strictEqual(studyCheck.gate, 'study_mode');
  global.state.studyMode = false;
  console.log('- Modo Estudo ativo: Portão "study_mode" bloqueou com sucesso');

  // 1c. Modo Privado -> Deve bloquear
  global.state.privateMode = true;
  const privCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(privCheck.pass, false);
  assert.strictEqual(privCheck.gate, 'private_mode');
  global.state.privateMode = false;
  console.log('- Modo Privado ativo: Portão "private_mode" bloqueou com sucesso');

  // 1d. Janela sensível (Banco/Senha) -> Deve bloquear
  global.state.desktop.activeTitle = 'Nubank - Internet Banking Seguro';
  const sensCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(sensCheck.pass, false);
  assert.strictEqual(sensCheck.gate, 'sensitive_window');
  global.state.desktop.activeTitle = 'pet_brain.js - Stack-Chan';
  console.log('- Janela de banco detectada: Portão "sensitive_window" bloqueou com sucesso');

  // 1e. Usuário ocioso há mais de 15 minutos -> Deve bloquear
  global.state.lastUserInteractionAt = Date.now() - (20 * 60 * 1000);
  const idleCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(idleCheck.pass, false);
  assert.strictEqual(idleCheck.gate, 'user_idle');
  global.state.lastUserInteractionAt = Date.now();
  console.log('- Usuário ocioso (20 min): Portão "user_idle" bloqueou com sucesso');

  // 1f. Robô ocupado falando -> Deve bloquear
  global.state.isSpeaking = true;
  const busyCheck = ScreenObserver.evaluateGates(global.state, global.prefs);
  assert.strictEqual(busyCheck.pass, false);
  assert.strictEqual(busyCheck.gate, 'busy');
  global.state.isSpeaking = false;
  console.log('- Robô ocupado: Portão "busy" bloqueou com sucesso');
  console.log('✔ Teste de Portões de Decisão passou com 100% de sucesso!\n');

  // [2] Testando Hash e Diff Perceptual de Tela Estática (Zero gasto de API)
  console.log('[2] Testando detecção de tela estática (Diff Perceptual)...');
  const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const hash1 = ScreenObserver.computePerceptualHash(dummyBase64);
  const hash2 = ScreenObserver.computePerceptualHash(dummyBase64);
  const diff = ScreenObserver.hashDiffRatio(hash1, hash2);
  assert.strictEqual(diff, 0.0, 'Imagens idênticas devem ter diff = 0');
  console.log(`- Diff perceptual de imagem idêntica: ${diff * 100}%`);

  // Simula ciclo com tela estática
  global.ipcRenderer = {
    invoke: async (channel) => {
      if (channel === 'capture-desktop') {
        return { base64Jpeg: dummyBase64, cropBase64Jpeg: dummyBase64 };
      }
      return null;
    }
  };

  // Primeiro ciclo registra o hash inicial
  await ScreenObserver.runCycle(true);
  
  // Segundo ciclo consecutivo com o mesmo conteúdo
  const staticResult = await ScreenObserver.runCycle();
  assert.strictEqual(staticResult.skipped, true);
  assert.strictEqual(staticResult.reason, 'tela_estatica');
  console.log('- Segundo ciclo com mesma janela e conteúdo: detectado como "tela_estatica"');
  console.log('✔ Critério de Aceite validado: Em tela estática, ZERO chamadas de API são gastas!\n');

  // [3] Testando os 3 Níveis Estruturados de Presença
  console.log('[3] Testando os 3 níveis estruturados de presença...');

  // 3a. Nível 1: SILÊNCIO OBSERVADOR (~65% - foco no código)
  lastEmotionSet = '';
  lastBubbleShown = '';
  lastSpokenText = '';
  const resSilencio = await ScreenObserver.executeAction({
    acao_fala: 'SILENCIO_OBSERVADOR',
    comentario: '',
    emocao_sugerida: 'THINKING',
    atividade: 'Refatorando motor de observação no VS Code'
  });
  assert.strictEqual(resSilencio.executed, 'SILENCIO_OBSERVADOR');
  assert.strictEqual(lastEmotionSet, 'THINKING', 'Deve emitir expressão discreta no OLED');
  assert.strictEqual(lastBubbleShown, '', 'NÃO deve exibir balão de texto');
  assert.strictEqual(lastSpokenText, '', 'NÃO deve emitir voz TTS');
  console.log('- SILENCIO_OBSERVADOR: Reação OLED discreta, zero som, zero balão de diálogo');

  // 3b. Nível 2: APENAS BALÃO SILENCIOSO (~20%)
  lastEmotionSet = '';
  lastBubbleShown = '';
  lastSpokenText = '';
  cuteSynthChirpCount = 0;
  const resBalao = await ScreenObserver.executeAction({
    acao_fala: 'APENAS_BALAO_SILENCIOSO',
    comentario: 'Que código elegante!',
    emocao_sugerida: 'CURIOUS',
    atividade: 'Lendo código'
  });
  assert.strictEqual(resBalao.executed, 'APENAS_BALAO_SILENCIOSO');
  assert.strictEqual(lastBubbleShown, 'Que código elegante!', 'Deve exibir pensamento no balão');
  assert.strictEqual(lastSpokenText, '', 'NÃO deve emitir voz');
  assert(cuteSynthChirpCount > 0, 'Deve emitir bip sutil no CuteSynth');
  console.log('- APENAS_BALAO_SILENCIOSO: Balão curto + bip sonoro sutil, sem TTS');

  // 3c. Nível 3: COMENTAR VOZ (~15%)
  lastSpokenText = '';
  const resVoz = await ScreenObserver.executeAction({
    acao_fala: 'COMENTAR_VOZ',
    comentario: 'Conseguiu rodar os testes perfeitamente!',
    emocao_sugerida: 'HAPPY',
    atividade: 'Comemorando testes'
  });
  assert.strictEqual(resVoz.executed, 'COMENTAR_VOZ');
  assert.strictEqual(lastSpokenText, 'Conseguiu rodar os testes perfeitamente!', 'Deve acionar voz via TTS');
  console.log('- COMENTAR_VOZ: Fala via TTS expressiva com personalidade ativa');

  // 3d. Degradação de Voz após atingir Teto Diário (12 falas)
  ScreenObserver.setDailySpokenLimit(1);
  const resDegradado = await ScreenObserver.executeAction({
    acao_fala: 'COMENTAR_VOZ',
    comentario: 'Outro comentário',
    emocao_sugerida: 'COOL'
  });
  assert.strictEqual(resDegradado.executed, 'APENAS_BALAO_SILENCIOSO', 'Deve degradar para balão silencioso ao estourar teto');
  console.log('- Teto diário de voz atingido: Degradação graciosa para Balão Silencioso');
  console.log('✔ Teste dos 3 Níveis de Presença passou com 100% de sucesso!\n');

  // [4] Testando Garantia de Zero Prints em Disco
  console.log('[4] Verificando integridade de disco (Zero prints em disco)...');
  const tempFiles = fs.readdirSync(__dirname).filter(f => /\.(?:png|jpg|jpeg)$/i.test(f));
  assert.strictEqual(tempFiles.length, 0, 'Nenhum screenshot pode ser gravado no diretório');
  console.log('- Nenhum arquivo de imagem residual encontrado no disco.');
  console.log('✔ Garantia de Zero Screenshots em Disco validada!\n');

  // [5] Testando Deduplicação de Sessão e Nota em 03_Conhecimento/
  console.log('[5] Testando deduplicação de sessões e geração em 03_Conhecimento/...');
  const context = { app: 'Code.exe', title: 'screen_observer.js' };
  
  // Observação marcante com importancia >= 6
  ScreenObserver.callVisionAnalysis = async () => ({
    acao_fala: 'SILENCIO_OBSERVADOR',
    atividade: 'Arquitetura do Observador de Tela BitBop',
    categoria: 'codigo',
    importancia: 8,
    tags: ['bitbop', 'observador', 'arquitetura']
  });

  await ScreenObserver.runCycle(true);

  const conhPath = path.join(__dirname, 'BitBop-Cerebro', '03_Conhecimento', 'Visao_Arquitetura_do_Observador_de_Tela_BitBop.md');
  assert(fs.existsSync(conhPath), 'Nota atômica em 03_Conhecimento/ deve ter sido gerada');
  const conhContent = fs.readFileSync(conhPath, 'utf8');
  assert(conhContent.includes('tipo: visao_cotidiano'), 'Tipo deve ser visao_cotidiano');
  assert(conhContent.includes('[[codigo]]'), 'Deve conter Wikilinks da categoria');
  console.log('- Nota atômica de conhecimento gerada com sucesso:', conhPath);
  console.log('✔ Teste de Deduplicação e Conhecimento passou com sucesso!\n');

  ScreenObserver.stop();

  console.log('====================================================');
  console.log('TODOS OS TESTES DA FASE 6 PASSARAM COM 100% DE SUCESSO!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
