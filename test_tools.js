/**
 * test_tools.js — Validação das Ferramentas de Voz e Function Calling (Fase 8)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Carrega dependências
const MemoryStore = require('./js/memory/memory_store.js');
const PersonalityStore = require('./js/personality/personality_store.js');
const PersonalityEngine = require('./js/personality/personality_engine.js');
const ContextDetector = require('./js/personality/context_detector.js');
const PersonalityTools = require('./js/personality/personality_tools.js');

console.log('--- TESTE FASE 8: FERRAMENTAS DE VOZ & FUNCTION CALLING ---');

// Mock global environment
global.MemoryStore = MemoryStore;
global.PersonalityStore = PersonalityStore;
global.PersonalityEngine = PersonalityEngine;
global.ContextDetector = ContextDetector;
global.prefs = { personality: 'adaptativo', customPersonality: '' };
global.state = { desktop: { activeApp: 'Code.exe', activeTitle: 'test.js - Visual Studio Code' } };

// 1. Validação do schema de ferramentas do Gemini
const decls = PersonalityTools.getGeminiToolDeclarations();
assert(Array.isArray(decls), 'Declarações devem ser um array');
assert.strictEqual(decls.length, 5, 'Deve conter exatamente as 5 ferramentas da spec');

const toolNames = decls.map(d => d.name);
console.log('Tools declaradas:', toolNames.join(', '));
assert(toolNames.includes('ajustar_tom'), 'Falta ferramenta ajustar_tom');
assert(toolNames.includes('trocar_persona'), 'Falta ferramenta trocar_persona');
assert(toolNames.includes('travar_personalidade'), 'Falta ferramenta travar_personalidade');
assert(toolNames.includes('resetar_personalidade'), 'Falta ferramenta resetar_personalidade');
assert(toolNames.includes('explicar_personalidade'), 'Falta ferramenta explicar_personalidade');

// 2. Validação dos Comandos Diretos de Voz (<100ms bypass)
console.log('\nValidando comandos diretos de voz...');

// Modo Gamer
const resGamer = PersonalityTools.checkDirectVoiceCommands('BitBop, ativa o modo gamer agora');
assert(resGamer !== null, 'Comando "modo gamer" não foi reconhecido');
assert.strictEqual(resGamer.action, 'trocar_persona');
assert.strictEqual(resGamer.persona, 'gamer');
assert(resGamer.speech_response.includes('Gamer') || resGamer.speech_response.includes('ativado'));
console.log('✓ "modo gamer" ->', resGamer.speech_response);

// Travar Personalidade
const resLock = PersonalityTools.checkDirectVoiceCommands('BitBop, fica assim e trava a personalidade');
assert(resLock !== null, 'Comando "trava a personalidade" não foi reconhecido');
assert.strictEqual(resLock.action, 'travar_personalidade');
assert.strictEqual(resLock.ativo, true);
assert.strictEqual(PersonalityEngine.isLocked(), true, 'PersonalityEngine deveria estar travado');
console.log('✓ "trava a personalidade" ->', resLock.speech_response);

// Destravar Personalidade
const resUnlock = PersonalityTools.checkDirectVoiceCommands('pode destravar a personalidade');
assert(resUnlock !== null, 'Comando "destravar a personalidade" não foi reconhecido');
assert.strictEqual(resUnlock.ativo, false);
assert.strictEqual(PersonalityEngine.isLocked(), false, 'PersonalityEngine deveria estar destravado');
console.log('✓ "destrava a personalidade" ->', resUnlock.speech_response);

// Resetar
const resReset = PersonalityTools.checkDirectVoiceCommands('BitBop, volta pro normal e reseta os traços');
assert(resReset !== null, 'Comando "reseta os traços" não foi reconhecido');
assert.strictEqual(resReset.action, 'resetar_personalidade');
console.log('✓ "reseta os traços" ->', resReset.speech_response);

// 3. Validação de Ajuste de Tom e Registro em Historico_Adaptacao.md
console.log('\nValidando ajustar_tom...');
const resTom = PersonalityTools.processPersonalityCall('ajustar_tom', {
  traco: 'verbosidade',
  direcao: 'diminuir',
  speech_response: 'Entendido, serei muito mais conciso!'
});
assert.strictEqual(resTom.ok, true);
assert.strictEqual(resTom.speech_response, 'Entendido, serei muito mais conciso!');
console.log('✓ ajustar_tom executado:', resTom.speech_response);

// 4. Validação de Explicar Personalidade (auditoria e leitura de histórico)
console.log('\nValidando explicar_personalidade...');
const resExpl = PersonalityTools.checkDirectVoiceCommands('por que você tá mais quieto hoje?');
assert(resExpl !== null, 'Pergunta "por que você tá mais quieto?" não foi reconhecida');
assert.strictEqual(resExpl.action, 'explicar_personalidade');
assert(typeof resExpl.speech_response === 'string' && resExpl.speech_response.length > 0);
console.log('✓ "por que você tá mais quieto?" ->', resExpl.speech_response);

console.log('\n🎉 TODOS OS TESTES DA FASE 8 PASSARAM COM SUCESSO!');
