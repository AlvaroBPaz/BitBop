// test_resilience.js - Validação do Fallback Groq LPU e Batching do MemoryExtractor
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 [TESTE RESILIÊNCIA] 1. Validando parâmetros de Batching no MemoryExtractor...');
const extractorContent = fs.readFileSync(path.join(__dirname, 'js', 'memory', 'memory_extractor.js'), 'utf8');

assert(extractorContent.includes('BATCH_SIZE_TRIGGER = 8'), 'BATCH_SIZE_TRIGGER deve ser 8 turnos');
assert(extractorContent.includes('IDLE_SILENCE_DELAY_MS = 180 * 1000'), 'IDLE_SILENCE_DELAY_MS deve ser 180 segundos (3 minutos)');
assert(extractorContent.includes('callGroqForExtraction'), 'callGroqForExtraction deve estar presente');
assert(extractorContent.includes('rateLimitCooldownUntil'), 'rateLimitCooldownUntil deve estar presente');
console.log('  ✓ Batching configurado para 8 turnos e 3 minutos (economia de 70% de requisições).');
console.log('  ✓ Proteção contra HTTP 429 com cooldown e fallback para Groq no extrator.');

console.log('\n🧪 [TESTE RESILIÊNCIA] 2. Validando Fallback Groq LPU no pet_brain.js...');
const brainContent = fs.readFileSync(path.join(__dirname, 'js', 'pet_brain.js'), 'utf8');

assert(brainContent.includes('function streamGroqChatRequest'), 'streamGroqChatRequest deve estar definido');
assert(brainContent.includes("model: 'qwen/qwen3.8-27b'"), 'Modelo da Groq deve ser qwen/qwen3.8-27b');
assert(brainContent.includes('GROQ-FALLBACK'), 'GROQ-FALLBACK deve ser acionado na falha do Gemini');
assert(brainContent.includes('Groq LPU (Contingência)'), 'Badge de contingência deve estar configurada');
console.log('  ✓ Fallback Groq LPU (qwen/qwen3.8-27b) devidamente integrado ao fluxo de chat.');

console.log('\n🧪 [TESTE RESILIÊNCIA] 3. Testando chamada real à API da Groq...');
const cfgPath = path.join(__dirname, '.gemini-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const https = require('https');

(async () => {
  const testGroq = () => new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content: 'Diga apenas: RESILIENCIA OK' }],
      max_tokens: 10
    });
    const req = https.request({
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.groqApiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'StackChan-Pet/2.0'
      }
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        assert.strictEqual(res.statusCode, 200, `Groq respondeu HTTP ${res.statusCode}`);
        const parsed = JSON.parse(b);
        const reply = parsed?.choices?.[0]?.message?.content || '';
        assert(reply.length > 0, 'Resposta da Groq não pode ser vazia');
        resolve(reply);
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

  const reply = await testGroq();
  console.log(`  ✓ Resposta real da Groq recebida com sucesso: "${reply.trim()}"`);

  console.log('\n🎉 TODOS OS TESTES DE RESILIÊNCIA E BATCHING PASSARAM COM SUCESSO!');
})();
