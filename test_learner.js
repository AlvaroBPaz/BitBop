/**
 * test_learner.js — Suíte de Testes Unitários para Fase 5: Aprendizado Seguro & Humor
 * Valida Seção 5 de SPEC_PERSONALIDADE_ADAPTATIVA.md
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock do ambiente global
global.window = global;
global.prefs = {
  personality: 'adaptativo',
  studyMode: false
};
global.state = {
  desktop: { activeApp: '', activeTitle: '' },
  emotion: 'NORMAL',
  frustrationDetected: false,
  studyMode: false,
  privateMode: false,
  isSensitiveWindow: false
};

const MemoryStore = require('./js/memory/memory_store.js');
const PersonalityStore = require('./js/personality/personality_store.js');
const PersonalityEngine = require('./js/personality/personality_engine.js');
const ContextDetector = require('./js/personality/context_detector.js');
const PersonalityLearner = require('./js/personality/personality_learner.js');

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO SUÍTE DE TESTES: PersonalityLearner & Humor');
  console.log('====================================================\n');

  // Inicializa subsistemas
  PersonalityStore.init();
  PersonalityEngine.init();
  PersonalityEngine.resetTraits(); // Zera offsets para baseline previsível
  ContextDetector.init();

  // [1] Teste Mandatório do Critério de Aceite: "BitBop, fala mais curto"
  console.log('[1] Testando critério de aceite: Comando "BitBop, fala mais curto"...');
  const initialOffset = PersonalityEngine.calculateEffectiveTrait('verbosidade');
  
  const turnUser = {
    userTranscript: 'BitBop, fala mais curto por favor!',
    botResponse: 'Entendido, serei mais conciso.',
    audioSource: 'usuario_voz',
    currentEmotion: 'NORMAL'
  };

  const resAccept = PersonalityLearner.processTurn(turnUser);
  assert.strictEqual(resAccept.processed, true, 'Turno legítimo deve ser processado');
  assert.strictEqual(resAccept.adjusted, true, 'Deve ter ajustado o traço');

  const newOffset = PersonalityEngine.calculateEffectiveTrait('verbosidade');
  console.log(`- Verbosidade antes: ${initialOffset} -> Verbosidade depois: ${newOffset} (Redução aplicada)`);
  assert(newOffset < initialOffset, 'Verbosidade efetiva deve ter diminuído');

  // Verifica registro em Historico_Adaptacao.md
  const histNote = MemoryStore.readNote('00_Nucleo/Personalidade/Historico_Adaptacao.md');
  assert(histNote && histNote.body.includes('usuário pediu fala mais curta'), 'Historico_Adaptacao.md deve conter justificativa do ajuste');
  assert(histNote.body.includes('verbosidade'), 'Historico_Adaptacao.md deve registrar o traço verbosidade');
  console.log('✔ Critério de aceite validado: traço reduzido e registrado em Historico_Adaptacao.md!\n');

  // [2] Teste Mandatório de Segurança: Bloqueio Estrito de Mídia / Vídeos do YouTube
  console.log('[2] Testando bloqueio estrito de áudio de mídia (YouTube, Netflix, etc.)...');
  const offsetBeforeMedia = PersonalityEngine.calculateEffectiveTrait('verbosidade');

  const turnMedia = {
    userTranscript: 'BitBop, fala mais curto e seja mais engraçado',
    botResponse: '',
    audioSource: 'midia_ambiente', // Classificado como mídia
    currentEmotion: 'NORMAL'
  };

  const resMedia = PersonalityLearner.processTurn(turnMedia);
  assert.strictEqual(resMedia.ignored, true, 'Áudio de mídia DEVE ser ignorado');
  assert.strictEqual(resMedia.reason, 'origem_audio_invalida', 'Motivo deve ser origem de áudio inválida');

  const offsetAfterMedia = PersonalityEngine.calculateEffectiveTrait('verbosidade');
  assert.strictEqual(offsetBeforeMedia, offsetAfterMedia, 'Nenhum traço pode mudar com áudio de mídia');
  console.log('- Áudio de vídeo classificado como "midia_ambiente" foi 100% rejeitado sem tocar nos traços.');
  console.log('✔ Teste de Blindagem de Áudio de Mídia passou com sucesso!\n');

  // [3] Teste de Pausa no Modo Estudo
  console.log('[3] Testando pausa de aprendizado quando Modo Estudo estiver ativo...');
  global.state.studyMode = true;

  const turnInStudy = {
    userTranscript: 'Pode ser mais engraçado agora',
    botResponse: '',
    audioSource: 'usuario_voz',
    currentEmotion: 'NORMAL'
  };

  const resStudy = PersonalityLearner.processTurn(turnInStudy);
  assert.strictEqual(resStudy.ignored, true, 'Modo Estudo deve pausar aprendizado');
  assert.strictEqual(resStudy.reason, 'modo_estudo_ativo');
  console.log('- Modo Estudo ativo: Comando foi pausado sem alterar traços.');
  global.state.studyMode = false;
  console.log('✔ Teste de Modo Estudo passou com sucesso!\n');

  // [4] Teste de Regra Procedural em 04_Procedimentos/
  console.log('[4] Testando criação de regra procedural: "Para de comentar enquanto eu codo"...');
  const turnSilenceDev = {
    userTranscript: 'BitBop, para de comentar enquanto eu codo',
    botResponse: 'Com certeza, silêncio absoluto no código ativado.',
    audioSource: 'usuario_voz',
    currentEmotion: 'NORMAL'
  };

  PersonalityLearner.processTurn(turnSilenceDev);
  const procPath = path.join(__dirname, 'BitBop-Cerebro', '04_Procedimentos', 'Regra_Silencio_Codigo.md');
  assert(fs.existsSync(procPath), 'Arquivo 04_Procedimentos/Regra_Silencio_Codigo.md deve existir');
  const procContent = fs.readFileSync(procPath, 'utf8');
  assert(procContent.includes('Silêncio Durante Programação'), 'Procedimento deve conter a regra de silêncio');
  console.log('- Arquivo gravado com sucesso:', procPath);
  console.log('✔ Teste de Regra Procedural passou com sucesso!\n');

  // [5] Teste do Motor de Humor e Afeto (patEnergy)
  console.log('[5] Testando Motor de Humor, Carinho (patEnergy) e Expressões OLED...');
  PersonalityLearner._setHumor(0.2, 0.4, 'Repouso');
  const initialHumor = PersonalityLearner.getHumor();
  console.log(`- Humor inicial: Valência = ${initialHumor.valence}, Energia = ${initialHumor.energy}`);

  // Simula carinho afetuoso do usuário
  PersonalityLearner.recordCarinho();
  const humorAfterPat = PersonalityLearner.getHumor();
  console.log(`- Humor após carinho: Valência = ${humorAfterPat.valence}, Energia = ${humorAfterPat.energy}`);
  assert(humorAfterPat.valence > initialHumor.valence, 'Carinho deve aumentar a valência');
  assert(humorAfterPat.energy > initialHumor.energy, 'Carinho deve aumentar a energia');

  // Expressão sugerida
  const emotion = PersonalityLearner.getSuggestedOledEmotion();
  console.log(`- Expressão sugerida para OLED: ${emotion}`);
  assert(['HAPPY', 'EXCITED'].includes(emotion), 'Expressão sugerida após carinho deve ser positiva');

  // Verifica persistência de Humor.md
  const humorPath = path.join(__dirname, 'BitBop-Cerebro', '00_Nucleo', 'Personalidade', 'Humor.md');
  assert(fs.existsSync(humorPath), 'Humor.md deve existir no vault');
  console.log('✔ Teste do Motor de Humor passou com sucesso!\n');

  // [6] Teste de Sinais Implícitos e Portão de Confirmação em 08_Inbox/
  console.log('[6] Testando Sinais Implícitos (Barge-ins) e geração em 08_Inbox/...');
  const longText = 'Olá Álvaro! Eu percebi que você está estudando sobre microsserviços e bancos de dados relacionais e não relacionais hoje...';
  
  // Simula 4 barge-ins consecutivos em falas longas
  for (let i = 0; i < 4; i++) {
    PersonalityLearner.recordBargeIn({
      botResponse: longText,
      botTextLen: longText.length
    });
  }

  const inboxPath = path.join(__dirname, 'BitBop-Cerebro', '08_Inbox', 'Sugestao_Verbosidade.md');
  assert(fs.existsSync(inboxPath), '08_Inbox/Sugestao_Verbosidade.md deve ter sido gerada após atingir limiar');
  const inboxContent = fs.readFileSync(inboxPath, 'utf8');
  assert(inboxContent.includes('tipo: inbox_sugestao'), 'Frontmatter de sugestão deve estar correto');
  assert(inboxContent.includes('traço: verbosidade'), 'Deve propor ajuste em verbosidade');
  console.log('- Nota de sugestão criada no Inbox:', inboxPath);
  console.log('✔ Teste de Sinais Implícitos e Inbox passou com sucesso!\n');

  console.log('====================================================');
  console.log('TODOS OS TESTES DA FASE 5 PASSARAM COM 100% DE SUCESSO!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
