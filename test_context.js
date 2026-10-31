/**
 * test_context.js — Suíte de Testes Unitários para Fase 4: Detector de Contexto & Histerese
 * Valida Seção 4 de SPEC_PERSONALIDADE_ADAPTATIVA.md
 */

const assert = require('assert');
const path = require('path');

// Mock do ambiente global
global.window = global;
global.prefs = {
  personality: 'adaptativo',
  studyMode: false
};
global.state = {
  desktop: {
    activeApp: '',
    activeTitle: ''
  },
  emotion: 'NORMAL',
  frustrationDetected: false,
  studyMode: false,
  privateMode: false,
  isSensitiveWindow: false
};

// Mock do DOM mínimo para badge
const mockBadge = {
  textContent: '',
  style: {},
  title: '',
  setAttribute(k, v) { this[k] = v; }
};
global.document = {
  getElementById(id) {
    if (id === 'badgePersonality') return mockBadge;
    return null;
  }
};

// Carrega os módulos
const MemoryStore = require('./js/memory/memory_store.js');
const PersonalityStore = require('./js/personality/personality_store.js');
const PersonalityEngine = require('./js/personality/personality_engine.js');
const ContextDetector = require('./js/personality/context_detector.js');

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO SUÍTE DE TESTES: ContextDetector & Modo Adaptativo');
  console.log('====================================================\n');

  // Inicializa o PersonalityStore com o vault local
  PersonalityStore.init();
  PersonalityEngine.init();

  // [1] Teste de Classificação de Contextos e Regras
  console.log('[1] Testando regras de detecção de contexto...');
  
  // 1a. VS Code / Desenvolvimento
  const devState = { desktop: { activeApp: 'Code.exe', activeTitle: 'context_detector.js - Stack-Chan' } };
  const resDev = ContextDetector.detectContext(devState, { personality: 'adaptativo' }, new Date('2026-10-29T14:00:00').getTime());
  assert.strictEqual(resDev.contextName, 'desenvolvimento', 'Deveria classificar como desenvolvimento');
  assert.strictEqual(resDev.candidateFacet, 'engenharia_software', 'Faceta candidata deveria ser engenharia_software');
  assert.strictEqual(resDev.modulations.proatividade, -0.25, 'Proatividade deveria modular -0.25');
  console.log('- VS Code: Contexto = "desenvolvimento" -> Faceta = "engenharia_software" (Proatividade: -0.25)');

  // 1b. Terminal na Madrugada (02h)
  const termState = { desktop: { activeApp: 'powershell.exe', activeTitle: 'Administrator: Windows PowerShell' } };
  const resTerm = ContextDetector.detectContext(termState, { personality: 'adaptativo' }, new Date('2026-10-29T02:30:00').getTime());
  assert.strictEqual(resTerm.contextName, 'terminal_madrugada', 'Deveria classificar como terminal_madrugada');
  assert.strictEqual(resTerm.candidateFacet, 'cyberpunk', 'Faceta candidata deveria ser cyberpunk');
  assert.strictEqual(resTerm.modulations.tecnicidade, 0.20, 'Tecnicidade deveria modular +0.20');
  console.log('- Terminal às 02h30: Contexto = "terminal_madrugada" -> Faceta = "cyberpunk" (Tecnicidade: +0.20)');

  // 1c. Jogos / Discord
  const gameState = { desktop: { activeApp: 'ArenaBreakoutInfinite.exe', activeTitle: 'Arena Breakout' } };
  const resGame = ContextDetector.detectContext(gameState, { personality: 'adaptativo' }, new Date('2026-10-29T20:00:00').getTime());
  assert.strictEqual(resGame.contextName, 'jogos', 'Deveria classificar como jogos');
  assert.strictEqual(resGame.candidateFacet, 'gamer', 'Faceta candidata deveria ser gamer');
  assert.strictEqual(resGame.modulations.energia, 0.20, 'Energia deveria modular +0.20');
  console.log('- Arena Breakout: Contexto = "jogos" -> Faceta = "gamer" (Energia: +0.20)');

  // 1d. Frustração do Usuário
  const frustState = { emotion: 'ANGRY', frustrationDetected: true, desktop: { activeApp: 'Code.exe' } };
  const resFrust = ContextDetector.detectContext(frustState, { personality: 'adaptativo' }, Date.now());
  assert.strictEqual(resFrust.contextName, 'usuario_frustrado', 'Deveria classificar como usuario_frustrado');
  assert.strictEqual(resFrust.isFrustrated, true, 'Flag isFrustrated deve ser true');
  assert.strictEqual(resFrust.modulations.provocacao, -0.70, 'Provocação deve ter modulação negativa total');
  console.log('- Usuário Frustrado: Contexto = "usuario_frustrado" -> Zoeira cravada em 0 e alta empatia');

  // 1e. Casual / Área de trabalho
  const casualState = { desktop: { activeApp: 'Spotify.exe', activeTitle: 'Spotify Free' } };
  const resCasual = ContextDetector.detectContext(casualState, { personality: 'adaptativo' }, new Date('2026-10-29T16:00:00').getTime());
  assert.strictEqual(resCasual.contextName, 'casual', 'Deveria classificar como casual');
  assert.strictEqual(resCasual.candidateFacet, 'padrao', 'Faceta candidata deveria ser padrao');
  console.log('- Spotify: Contexto = "casual" -> Faceta = "padrao" (Fofo)');
  console.log('✔ Teste de Regras de Contexto passou com 100% de sucesso!\n');

  // [2] Teste de Modulação Imediata (0ms)
  console.log('[2] Testando Modulação Contextual Imediata em 0ms...');
  global.prefs.personality = 'adaptativo';
  global.state.desktop = { activeApp: 'Code.exe', activeTitle: 'pet_brain.js' };
  ContextDetector.evaluateContext(global.state, global.prefs, Date.now());
  const currentMods = ContextDetector.getCurrentModulations();
  assert.strictEqual(currentMods.proatividade, -0.25, 'Modulação de proatividade deve estar ativa imediatamente');
  assert.strictEqual(currentMods.verbosidade, -0.15, 'Modulação de verbosidade deve estar ativa imediatamente');
  console.log('- Modulação imediata aplicada em 0ms no VS Code: proatividade = -0.25, verbosidade = -0.15');
  console.log('✔ Teste de Modulação Imediata passou com sucesso!\n');

  // [3] Teste de Histerese de ~3 minutos (180.000 ms)
  console.log('[3] Testando Histerese de 3 minutos para troca de faceta dominante...');
  ContextDetector.resetHysteresis();
  ContextDetector.setHysteresisMs(180000); // 180s
  ContextDetector.forceFacet('padrao', 'setup_teste'); // Começa em Fofo
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'padrao');

  let simTime = 1000000;
  // Usuário abre o VS Code no instante simTime
  global.state.desktop = { activeApp: 'Code.exe', activeTitle: 'index.html' };
  
  // T = 0s
  let status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'padrao', 'T=0s: Faceta ainda deve ser "padrao"');
  assert.strictEqual(status.pendingFacet, 'engenharia_software', 'T=0s: Faceta pendente deve ser "engenharia_software"');
  console.log('- T = 0s no VS Code: Faceta ativa = "padrao", Candidato pendente = "engenharia_software"');

  // T = 60s (1 minuto) -> Não deve trocar
  simTime += 60 * 1000;
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'padrao', 'T=60s: Faceta ainda deve ser "padrao" devido à histerese');
  assert.strictEqual(status.pendingElapsedMs, 60000, 'Tempo decorrido deve ser 60000ms');
  console.log('- T = 60s no VS Code: Faceta mantida em "padrao" (decorrido: 60s de 180s necessários)');

  // T = 120s (2 minutos) -> Alt+Tab rápido para Spotify por 5 segundos
  simTime += 60 * 1000;
  global.state.desktop = { activeApp: 'Spotify.exe', activeTitle: 'Lo-Fi Beats' };
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  // Como o Spotify pede "padrao" e a faceta ativa já é "padrao", pendingFacet zera
  assert.strictEqual(status.pendingFacet, null, 'Alt+Tab para Spotify limpou o pending');
  console.log('- T = 120s (Alt+Tab rápido para Spotify): Histerese do VS Code cancelada');

  // T = 125s -> Usuário volta para o VS Code
  simTime += 5 * 1000;
  global.state.desktop = { activeApp: 'Code.exe', activeTitle: 'index.html' };
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(status.pendingFacet, 'engenharia_software', 'Volta ao VS Code inicia nova contagem de histerese');

  // T = 125s + 179s (quase 3 min) -> Não deve trocar
  simTime += 179 * 1000;
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'padrao', 'T = 179s: Não troca antes dos 180s');

  // T = 125s + 181s (> 3 min ininterruptos no VS Code) -> DEVE TROCAR!
  simTime += 2 * 1000;
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'engenharia_software', 'Após 181s no VS Code, DEVE trocar para "engenharia_software"!');
  assert.strictEqual(status.pendingFacet, null, 'Pending deve ser nulo após a promoção');
  console.log('- T = 181s ininterruptos no VS Code: Faceta dominante alternou para "engenharia_software"!');
  console.log('- Badge visual atualizada para:', mockBadge.textContent);
  assert.strictEqual(mockBadge.textContent, 'AUTO: MENTOR DEV', 'Badge deve exibir "AUTO: MENTOR DEV"');
  console.log('✔ Teste de Histerese passou com 100% de conformidade!\n');

  // [4] Teste da Regra de Ouro: Modo Manual Fixo NUNCA troca a faceta-base
  console.log('[4] Testando Regra de Ouro: Modo Manual Fixo não troca faceta dominante...');
  global.prefs.personality = 'gamer'; // Usuário escolheu fixo "Gamer"
  ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'gamer', 'Faceta deve ser "gamer"');
  assert.strictEqual(mockBadge.textContent, 'GAMER', 'Badge fixa deve exibir "GAMER"');

  // Usuário passa 10 horas programando no VS Code em modo Gamer Fixo
  simTime += 10 * 3600 * 1000;
  global.state.desktop = { activeApp: 'Code.exe', activeTitle: 'main.cpp' };
  status = ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(ContextDetector.getCurrentFacet(), 'gamer', 'Modo fixo Gamer NUNCA deve mudar para mentor!');
  assert.strictEqual(status.mode, 'fixed');
  assert.strictEqual(mockBadge.textContent, 'GAMER');
  console.log('- 10 horas no VS Code em modo Gamer Fixo: Faceta permaneceu "gamer" (base intocada)');
  console.log('✔ Teste de Modo Fixo passou com sucesso!\n');

  // [5] Teste de Congelamento no Perfil de Estudo (Study Mode)
  console.log('[5] Testando Perfil de Estudo (Study Mode) e Badge...');
  global.state.studyMode = true;
  global.prefs.personality = 'adaptativo';
  ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.strictEqual(mockBadge.textContent, 'ESTUDO ATIVO', 'Badge deve ser ESTUDO ATIVO');
  assert.strictEqual(mockBadge.style.color, '#38bdf8');
  console.log('- Modo Estudo ativo: Personalidade congelada e badge = "ESTUDO ATIVO"');

  // Desativa Modo Estudo
  global.state.studyMode = false;
  ContextDetector.evaluateContext(global.state, global.prefs, simTime);
  assert.notStrictEqual(mockBadge.textContent, 'ESTUDO ATIVO', 'Badge deve voltar ao normal');
  console.log('- Modo Estudo desativado: Badge restaurada para', mockBadge.textContent);
  console.log('✔ Teste de Modo Estudo passou com sucesso!\n');

  // [6] Teste de Modo Privado (Alt + P)
  console.log('[6] Testando Modo Privado (Alt + P) e Badge...');
  global.state.privateMode = true;
  ContextDetector.updateBadge();
  assert.strictEqual(mockBadge.textContent, 'PRIVADO', 'Badge deve ser PRIVADO');
  assert.strictEqual(mockBadge.style.color, '#94a3b8');
  console.log('- Modo Privado ativo: Badge = "PRIVADO"');

  global.state.privateMode = false;
  ContextDetector.updateBadge();
  console.log('- Modo Privado desativado: Badge restaurada para', mockBadge.textContent);
  console.log('✔ Teste de Modo Privado passou com sucesso!\n');

  console.log('====================================================');
  console.log('TODOS OS TESTES DA FASE 4 PASSARAM COM 100% DE SUCESSO!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
