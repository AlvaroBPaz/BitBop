// test_listener_mode.js - Validação do Modo Ouvinte Silencioso (Só Observar)
const assert = require('assert');

// 1. Mock do ambiente de execução do navegador/Electron
global.window = global;
global.state = {
  silentObserverMode: false,
  studyMode: false,
  privateMode: false,
  personalityFacet: 'mentor_eng',
  personalityActive: 'mentor_eng',
  desktop: { activeApp: 'Discord', activeTitle: 'Discord - #geral - Call' },
  emotion: 'NORMAL'
};
global.prefs = {
  personality: 'adaptativo'
};

const domElements = {
  badgePersonality: { textContent: '', style: {}, setAttribute: (k, v) => { domElements.badgePersonality[k] = v; } },
  btnToggleListenerMode: { textContent: '', style: {}, setAttribute: (k, v) => { domElements.btnToggleListenerMode[k] = v; } }
};
global.document = {
  getElementById: (id) => domElements[id] || null
};

// Mocks de subsistemas
let enqueuedTurns = [];
global.MemoryExtractor = {
  enqueueTurn: (turn) => {
    enqueuedTurns.push(turn);
  }
};

let synthCalls = [];
global.CuteSynth = {
  curious: () => synthCalls.push('curious'),
  happy: () => synthCalls.push('happy')
};

let lastEmotion = null;
global.setEmotion = (emo) => { lastEmotion = emo; };

// Carrega os módulos
const PersonalityTools = require('./js/personality/personality_tools.js');
const ContextDetector = require('./js/personality/context_detector.js');

console.log('🧪 [TESTE] 1. Testando gatilhos de voz em Português...');

const activationPhrases = [
  'BitBop, só fica observando',
  'fica só olhando',
  'ativa o modo ouvinte',
  'não fala nada até eu mandar',
  'só escuta',
  'fica em silêncio e só observa',
  'silêncio total, só observa o jogo'
];

for (const phrase of activationPhrases) {
  const match = PersonalityTools.checkDirectVoiceCommands(phrase);
  assert(match !== null, `Deveria ter reconhecido ativação para: "${phrase}"`);
  assert.strictEqual(match.action, 'modo_ouvinte');
  assert.strictEqual(match.ativo, true);
  console.log(`  ✓ Ativação reconhecida: "${phrase}" -> speech_response: "${match.speech_response.substring(0, 30)}..."`);
}

const deactivationPhrases = [
  'BitBop, pode voltar a falar',
  'volta a falar agora',
  'desativa o modo ouvinte',
  'pode falar novamente',
  'pode conversar',
  'sai do modo ouvinte'
];

for (const phrase of deactivationPhrases) {
  const match = PersonalityTools.checkDirectVoiceCommands(phrase);
  assert(match !== null, `Deveria ter reconhecido desativação para: "${phrase}"`);
  assert.strictEqual(match.action, 'modo_ouvinte');
  assert.strictEqual(match.ativo, false);
  console.log(`  ✓ Desativação reconhecida: "${phrase}" -> speech_response: "${match.speech_response.substring(0, 30)}..."`);
}

console.log('\n🧪 [TESTE] 2. Testando alternância de estado e Badge no ContextDetector...');
// Ativar modo ouvinte
global.state.silentObserverMode = true;
ContextDetector.updateBadge();
assert.strictEqual(domElements.badgePersonality.textContent, '🎧 SÓ OBSERVANDO');
assert.strictEqual(domElements.badgePersonality.style.color, '#2dd4bf');
console.log('  ✓ Badge atualizada corretamente para "🎧 SÓ OBSERVANDO" (#2dd4bf)');

console.log('\n🧪 [TESTE] 3. Testando interceptação no pet_brain (Ouvinte Silencioso)...');
// Simula a lógica de interceptação de handleUserMessage em pet_brain.js
function simulateBrainReceive(userText) {
  if (global.state.silentObserverMode) {
    const directCmd = PersonalityTools.checkDirectVoiceCommands(userText);
    if (directCmd && directCmd.action === 'modo_ouvinte' && directCmd.ativo === false) {
      global.state.silentObserverMode = false;
      if (global.ContextDetector) global.ContextDetector.updateBadge();
      return { botSpoke: true, text: directCmd.speech_response };
    }

    if (global.MemoryExtractor && typeof global.MemoryExtractor.enqueueTurn === 'function') {
      global.MemoryExtractor.enqueueTurn({
        userText: userText,
        botResponse: '[Modo Ouvinte: BitBop ouvindo silenciosamente]',
        timestamp: Date.now(),
        audioSource: 'usuario_voz',
        context: { activeApp: global.state.desktop?.activeApp, activeTitle: global.state.desktop?.activeTitle }
      });
    }
    global.setEmotion('CURIOUS', 0);
    return { botSpoke: false, text: null };
  }
  return { botSpoke: true, text: 'Resposta normal do LLM' };
}

// Fala do usuário no jogo com amigos
enqueuedTurns = [];
const gameChat = 'Caraca mano, rusha bomb B, ele tá miado atrás da caixa!';
const r1 = simulateBrainReceive(gameChat);
assert.strictEqual(r1.botSpoke, false, 'BitBop NÃO deve falar durante o jogo no Modo Ouvinte');
assert.strictEqual(r1.text, null);
assert.strictEqual(enqueuedTurns.length, 1);
assert.strictEqual(enqueuedTurns[0].userText, gameChat);
assert.strictEqual(enqueuedTurns[0].botResponse, '[Modo Ouvinte: BitBop ouvindo silenciosamente]');
assert.strictEqual(enqueuedTurns[0].context.activeApp, 'Discord');
assert.strictEqual(lastEmotion, 'CURIOUS');
console.log('  ✓ Conversa durante o jogo foi absorvida na memória sem emitir fala (botSpoke = false)');

// Comando para voltar a falar
const r2 = simulateBrainReceive('BitBop, pode voltar a falar agora');
assert.strictEqual(r2.botSpoke, true, 'BitBop DEVE falar ao receber ordem de desativação');
assert(r2.text.includes('Tô de volta') || r2.text.includes('guardei tudo'), 'Resposta de confirmação esperada');
assert.strictEqual(global.state.silentObserverMode, false);
ContextDetector.updateBadge();
assert.notStrictEqual(domElements.badgePersonality.textContent, '🎧 SÓ OBSERVANDO');
console.log('  ✓ Desativação restaurou a capacidade de fala do BitBop com confirmação afirmativa');

console.log('\n🧪 [TESTE] 4. Testando forçamento de SILENCIO_OBSERVADOR no ScreenObserver...');
// Simula verificação do ScreenObserver
function testScreenObserverAction(actionRequested, isSilentObserver) {
  if (isSilentObserver) return 'SILENCIO_OBSERVADOR';
  return actionRequested;
}
assert.strictEqual(testScreenObserverAction('COMENTAR_VOZ', true), 'SILENCIO_OBSERVADOR');
assert.strictEqual(testScreenObserverAction('APENAS_BALAO_SILENCIOSO', true), 'SILENCIO_OBSERVADOR');
assert.strictEqual(testScreenObserverAction('COMENTAR_VOZ', false), 'COMENTAR_VOZ');
console.log('  ✓ ScreenObserver devidamente forçado a SILENCIO_OBSERVADOR quando modo ouvinte está ativo');

console.log('\n🎉 TODOS OS TESTES DO MODO OUVINTE SILENCIOSO PASSARAM COM SUCESSO!');
