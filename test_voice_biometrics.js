// test_voice_biometrics.js - Validação Completa da Biometria Vocal CAM++
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('🧪 [TESTE BIOMETRIA] 1. Inicializando VoiceBiometrics e CAM++ ONNX...');

// Setup global mocks para ambiente Node
global.window = global;
global.state = { isCalibratingVoice: false, silentObserverMode: false, desktop: { activeApp: 'Discord', activeTitle: 'Call' } };
global.prefs = { biometricsRestricted: false };
global.document = {
  getElementById: (id) => ({ textContent: '', style: {}, checked: false })
};
global.showBubble = (t, m) => console.log(`    [Bubble] ${t}: ${m.substring(0, 45)}...`);
global.speakText = (t) => Promise.resolve();
global.setEmotion = () => {};
global.CuteSynth = { happy: () => {}, excited: () => {}, purr: () => {} };

const VoiceBiometrics = require('./js/voice/voice_biometrics.js');

assert(VoiceBiometrics.isReady(), 'O motor CAM++ deveria estar pronto e carregado');
console.log('  ✓ Motor CAM++ (sherpa-onnx) carregado com sucesso!');

console.log('\n🧪 [TESTE BIOMETRIA] 2. Testando comportamento antes da calibração (Aberto)...');
const sampleRate = 16000;
const testAudio = new Float32Array(sampleRate * 2);
for (let i = 0; i < testAudio.length; i++) {
  testAudio[i] = Math.sin(2 * Math.PI * 300 * i / sampleRate) * 0.4;
}

(async () => {
  // Antes de calibrar
  const uncalibratedRes = await VoiceBiometrics.verifySamples(testAudio);
  assert.strictEqual(uncalibratedRes.enrolled, false, 'Não deve estar calibrado inicialmente');
  assert.strictEqual(uncalibratedRes.isOwner, true, 'Quando não calibrado, deve permitir interação normalmente');
  console.log('  ✓ Modo inicial não calibrado permite interações sem bloqueio.');

  console.log('\n🧪 [TESTE BIOMETRIA] 3. Testando Calibração e Cadastro da Voz do Dono...');
  // Simula 3 segundos de fala do dono
  const ownerSamples = new Float32Array(sampleRate * 3);
  for (let i = 0; i < ownerSamples.length; i++) {
    ownerSamples[i] = Math.sin(2 * Math.PI * 220 * i / sampleRate) * 0.5 + Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.25;
  }

  const enrollRes = await VoiceBiometrics.enrollOwner(ownerSamples, 'Álvaro');
  assert(enrollRes.ok, 'Cadastro do dono deve retornar ok: true');
  assert(VoiceBiometrics.isEnrolled(), 'isEnrolled deve retornar true após cadastro');

  const voiceprintPath = path.join(__dirname, 'BitBop-Cerebro', '00_Nucleo', 'Voiceprint_Dono.json');
  assert(fs.existsSync(voiceprintPath), 'Voiceprint_Dono.json deve existir no cofre do Obsidian');

  const savedData = JSON.parse(fs.readFileSync(voiceprintPath, 'utf8'));
  assert.strictEqual(savedData.user, 'Álvaro');
  assert.strictEqual(savedData.embeddingDim, 192);
  assert.strictEqual(savedData.embedding.length, 192);
  console.log(`  ✓ Assinatura gravada no Obsidian: ${voiceprintPath} (192 dimensões)`);

  console.log('\n🧪 [TESTE BIOMETRIA] 4. Testando Verificação do Dono vs. Voz Secundária...');
  // Áudio da mesma voz do dono (pequenas variações normais de pronúncia)
  const sameVoice = new Float32Array(sampleRate * 3);
  for (let i = 0; i < sameVoice.length; i++) {
    sameVoice[i] = Math.sin(2 * Math.PI * 222 * i / sampleRate) * 0.48 + Math.sin(2 * Math.PI * 444 * i / sampleRate) * 0.24;
  }

  const verifyOwnerRes = await VoiceBiometrics.verifySamples(sameVoice);
  console.log(`  Similaridade da voz do Dono: ${verifyOwnerRes.similarity} (corte: ${verifyOwnerRes.threshold})`);
  assert(verifyOwnerRes.isOwner, 'Deveria reconhecer a voz como do Dono');
  assert.strictEqual(verifyOwnerRes.speaker, 'DONO');
  console.log('  ✓ Reconhecimento afirmativo do Dono com alta similaridade!');

  // Áudio de outra pessoa (frequências completamente diferentes)
  const otherVoice = new Float32Array(sampleRate * 3);
  for (let i = 0; i < otherVoice.length; i++) {
    otherVoice[i] = Math.sin(2 * Math.PI * 880 * i / sampleRate) * 0.5 + Math.sin(2 * Math.PI * 1320 * i / sampleRate) * 0.3;
  }
  const verifyOtherRes = await VoiceBiometrics.verifySamples(otherVoice);
  console.log(`  Similaridade de voz diferente: ${verifyOtherRes.similarity}`);
  assert(verifyOtherRes.similarity < verifyOwnerRes.similarity, 'Voz diferente deve ter similaridade menor');
  console.log('  ✓ Distinção clara entre o Dono e outra voz!');

  console.log('\n🧪 [TESTE BIOMETRIA] 5. Testando medição de latência da Biometria...');
  const t0 = performance.now();
  await VoiceBiometrics.verifySamples(sameVoice);
  const dt = performance.now() - t0;
  console.log(`  ⏱️ Tempo total de inferência CAM++: ${dt.toFixed(2)} ms (Alvo: < 50ms)`);
  assert(dt < 65, 'Latência da biometria deve ser inferior a 65ms');

  console.log('\n🧪 [TESTE BIOMETRIA] 6. Testando Reset da Biometria...');
  const backupData = fs.existsSync(voiceprintPath) ? fs.readFileSync(voiceprintPath, 'utf8') : null;
  VoiceBiometrics.resetBiometrics();
  assert(!VoiceBiometrics.isEnrolled(), 'Após reset, isEnrolled deve ser false');
  if (backupData) {
    fs.writeFileSync(voiceprintPath, backupData, 'utf8');
    VoiceBiometrics.init();
  }
  console.log('  ✓ Reset de biometria funcional.');

  console.log('\n🎉 TODOS OS TESTES DE BIOMETRIA VOCAL (CAM++) PASSARAM COM SUCESSO!');
})();
