/**
 * Testes Unitários de Validação do Motor de Traços (PersonalityEngine)
 * Arquivo: test_traits.js
 */

const assert = require('assert');

// Mock do ambiente global
global.window = global;
global.prefs = {
  personality: 'engenharia_software'
};

// Carrega os módulos necessários
require('./js/memory/memory_store.js');
require('./js/personality/personality_store.js');
require('./js/personality/personality_engine.js');

const store = global.PersonalityStore;
const engine = global.PersonalityEngine;

store.init();
engine.init();

console.log('====================================================');
console.log('INICIANDO SUÍTE DE TESTES: PersonalityEngine');
console.log('====================================================');

// 1. TESTE DE CLAMP (DERIVA MÁXIMA DE ±0.25 DA BASE)
console.log('\n[1] Testando limites de clamp (base ± 0.25)...');
// Para Mentor: formalidade base é 0.60. Limites permitidos: [0.35, 0.85]
const baseFormalidade = 0.60;
const derivaMax = 0.25;

// Teste com offset extremo positivo (+0.50)
engine._setOffsetRaw('formalidade', 0.50, Date.now());
const effMax = engine.calculateEffectiveTrait('formalidade', { personaId: 'engenharia_software' });
console.log(`- Base: ${baseFormalidade} | Offset bruto: +0.50 -> Efetivo clampado: ${effMax}`);
assert(effMax <= Number((baseFormalidade + derivaMax).toFixed(3)), `Falhou: ${effMax} > ${baseFormalidade + derivaMax}`);
assert.strictEqual(effMax, 0.85, 'Deveria ter cravado exatamente em 0.85');

// Teste com offset extremo negativo (-0.50)
engine._setOffsetRaw('formalidade', -0.50, Date.now());
const effMin = engine.calculateEffectiveTrait('formalidade', { personaId: 'engenharia_software' });
console.log(`- Base: ${baseFormalidade} | Offset bruto: -0.50 -> Efetivo clampado: ${effMin}`);
assert(effMin >= Number((baseFormalidade - derivaMax).toFixed(3)), `Falhou: ${effMin} < ${baseFormalidade - derivaMax}`);
assert.strictEqual(effMin, 0.35, 'Deveria ter cravado exatamente em 0.35');

// Teste com modulação extrema de contexto (+0.80)
const effMod = engine.calculateEffectiveTrait('formalidade', { 
  personaId: 'engenharia_software',
  contextModulations: { formalidade: 0.80 }
});
console.log(`- Base: ${baseFormalidade} | Modulação extrema: +0.80 -> Efetivo: ${effMod}`);
assert(effMod <= 0.85, 'A modulação de contexto nunca deve vazar o clamp da persona');

console.log('✔ Teste de Clamps passou com 100% de precisão!');

// 2. TESTE DE TRAVA DE FRUSTRAÇÃO NA PROVOCAÇÃO
console.log('\n[2] Testando trava de frustração na Provocação (Zoeira)...');
// Para Gamer: provocação base é 0.60, teto é 0.70
engine._setOffsetRaw('provocacao', 0.10, Date.now());
const provNormal = engine.calculateEffectiveTrait('provocacao', { personaId: 'gamer', isFrustrated: false });
console.log(`- Gamer sem frustração: Provocação = ${provNormal}`);
assert(provNormal > 0, 'Sem frustração, provocação deve ser positiva');

const provFrustrated = engine.calculateEffectiveTrait('provocacao', { personaId: 'gamer', isFrustrated: true });
console.log(`- Gamer com frustração detectada: Provocação = ${provFrustrated}`);
assert.strictEqual(provFrustrated, 0.0, 'REGRA DE OURO: Provocação DEVE cair imediatamente para 0.0 na frustração');

console.log('✔ Teste de Frustração passou: Provocação zerou na hora!');

// 3. TESTE DE DECAIMENTO TEMPORAL (MEIA-VIDA DE 14 DIAS)
console.log('\n[3] Testando decaimento temporal de offsets (meia-vida ~14 dias)...');
const t0 = Date.now();
const offsetInicial = 0.20;
engine._setOffsetRaw('humor', offsetInicial, t0);

// Imediatamente no t0
const off0 = engine.calculateEffectiveTrait('humor', { personaId: 'engenharia_software', now: t0 }) - 0.30; // base = 0.30
console.log(`- Dia 0: Offset = ${off0.toFixed(3)} (esperado: ~0.20)`);
assert(Math.abs(off0 - 0.20) < 0.01);

// Após 14 dias (1 meia-vida -> metade do offset)
const t14 = t0 + 14 * 24 * 60 * 60 * 1000;
const off14 = engine.calculateEffectiveTrait('humor', { personaId: 'engenharia_software', now: t14 }) - 0.30;
console.log(`- Dia 14: Offset = ${off14.toFixed(3)} (esperado: ~0.10)`);
assert(Math.abs(off14 - 0.10) < 0.015, `Deveria decair para ~0.10, obtido: ${off14}`);

// Após 28 dias (2 meias-vidas -> 1/4 do offset)
const t28 = t0 + 28 * 24 * 60 * 60 * 1000;
const off28 = engine.calculateEffectiveTrait('humor', { personaId: 'engenharia_software', now: t28 }) - 0.30;
console.log(`- Dia 28: Offset = ${off28.toFixed(3)} (esperado: ~0.05)`);
assert(Math.abs(off28 - 0.05) < 0.015, `Deveria decair para ~0.05, obtido: ${off28}`);

console.log('✔ Teste de Decaimento Temporal passou com curva matemática perfeita!');

// 4. TESTE DE FAIXAS ESTÁVEIS E DETERMINISMO DO PROMPT
console.log('\n[4] Testando mapeamento de faixas e determinismo do renderBlock()...');
assert.strictEqual(engine.getFaixaDescription('verbosidade', 0.20), 'Extremamente conciso (1 a 2 frases curtas).');
assert.strictEqual(engine.getFaixaDescription('verbosidade', 0.50), 'Respostas médias (2 a 3 frases diretas).');
assert.strictEqual(engine.getFaixaDescription('verbosidade', 0.85), 'Respostas explicativas e detalhadas.');

engine.resetTraits();
const block1 = engine.renderBlock({ personaId: 'engenharia_software' });
const block2 = engine.renderBlock({ personaId: 'engenharia_software' });

assert.strictEqual(block1, block2, 'Chamadas consecutivas sem alteração de estado devem gerar blocos idênticos!');
console.log('- Determinismo: 100% idêntico entre chamadas consecutivas.');

// Verifica ausência de floats no bloco
const floatMatches = block1.match(/\b\d+\.\d+\b/g);
assert.strictEqual(floatMatches, null, `O prompt não deve conter números decimais expostos! Encontrados: ${floatMatches}`);
console.log('- Zero números decimais vazados no bloco do prompt.');

// Verifica tamanho em tokens (~4 caracteres por token)
const estimatedTokens = Math.round(block1.length / 4);
console.log(`- Tamanho estimado do bloco: ~${estimatedTokens} tokens (${block1.length} caracteres)`);
assert(estimatedTokens < 360, `Bloco do Mentor deve ter menos de 360 tokens, atual: ${estimatedTokens}`);
const fofoBlock = engine.renderBlock({ personaId: 'padrao' });
const fofoTokens = Math.round(fofoBlock.length / 4);
console.log(`- Tamanho estimado do bloco (Fofo): ~${fofoTokens} tokens (${fofoBlock.length} caracteres)`);
assert(fofoTokens <= 250, `Bloco do Fofo deve ter no máximo ~250 tokens, atual: ${fofoTokens}`);

// 5. TESTE DE LIMITE DE DERIVA DIÁRIA (±0.03 IMPLÍCITO)
console.log('\n[5] Testando limite de deriva implícita (teto ±0.03/dia)...');
engine.resetTraits();
// Tentativa de aplicar deriva implícita de +0.05
const resImp = engine.adjustTrait('verbosidade', 0.05, false, 'teste implícito');
console.log(`- Ajuste implícito solicitado: +0.05 -> Aplicado: ${resImp.newOffset}`);
assert.strictEqual(resImp.newOffset, 0.03, 'Ajuste implícito não pode ultrapassar +0.03 no mesmo dia!');

// Ajuste explícito de +0.10
const resExp = engine.adjustTrait('verbosidade', 0.10, true, 'teste explícito');
console.log(`- Ajuste explícito solicitado: +0.10 -> Novo offset acumulado: ${resExp.newOffset}`);
assert.strictEqual(resExp.newOffset, 0.13, 'Ajuste explícito acumula normalmente até o teto de ±0.25');

console.log('✔ Limites de deriva implícita e explícita respeitados com sucesso!');

console.log('\n====================================================');
console.log('TODOS OS TESTES PASSARAM COM SUCESSO! (CRITÉRIO DE ACEITE ATINGIDO)');
console.log('====================================================');
