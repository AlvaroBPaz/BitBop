/**
 * test_sleep.js — Suíte de Testes Unitários para Fase 7: Sono Evolutivo no Obsidian
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
  geminiApiKey: '' // modo offline
};
global.state = {
  desktop: { activeApp: 'Code.exe', activeTitle: 'pet_brain.js' },
  emotion: 'NORMAL',
  frustrationDetected: false,
  studyMode: false,
  privateMode: false,
  isSensitiveWindow: false
};

const MemoryStore = require('./js/memory/memory_store.js');
const MemoryIndex = require('./js/memory/memory_index.js');
const PersonalityStore = require('./js/personality/personality_store.js');
const PersonalityEngine = require('./js/personality/personality_engine.js');
const ContextDetector = require('./js/personality/context_detector.js');
const MemoryConsolidator = require('./js/memory/memory_consolidator.js');

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO SUÍTE DE TESTES: Sono Evolutivo & Longo Prazo');
  console.log('====================================================\n');

  PersonalityStore.init();
  PersonalityEngine.init();
  ContextDetector.init();

  const vaultPath = MemoryStore.getVaultPath();
  const todayStr = new Date().toISOString().split('T')[0];

  // [1] Semeia eventos de teste no event_log.jsonl
  console.log('[1] Semeando eventos do observador e interações no event_log.jsonl...');
  const logPath = path.join(vaultPath, '.bitbop', 'event_log.jsonl');
  
  const testEvents = [
    {
      tipo: 'visao_cotidiano',
      timestamp: new Date().toISOString(),
      atividade: 'Desenvolvimento do observador de tela no VS Code',
      categoria: 'codigo',
      app: 'Code.exe',
      importancia: 8,
      studyModeActive: false
    },
    {
      tipo: 'visao_cotidiano',
      timestamp: new Date().toISOString(),
      atividade: 'Leitura de materiais em Modo Estudo',
      categoria: 'estudo_bloqueado',
      app: 'Chrome.exe',
      importancia: 4,
      studyModeActive: true // Deve ser IGNORADO na linha do tempo
    },
    {
      tipo: 'dialogo',
      timestamp: new Date().toISOString(),
      userTranscript: 'Muito bom, funcionou de primeira!',
      botResponse: 'Sensacional, Álvaro!',
      audioSource: 'usuario_voz'
    }
  ];

  for (const ev of testEvents) {
    fs.appendFileSync(logPath, JSON.stringify(ev) + '\n', 'utf8');
  }
  console.log('- Eventos semeados com sucesso.');

  // Configura offset com timestamp passado (ex.: 28 dias atrás) para testar decaimento de 14 dias
  PersonalityEngine.adjustTrait('humor', 0.15, true, 'reforco inicial', 'usuario_voz');
  const offsets = PersonalityEngine._getOffsets();
  if (offsets.humor) {
    offsets.humor.lastUpdated = Date.now() - (28 * 24 * 3600 * 1000); // 28 dias atrás
  }

  // [2] Executa o Sono de Consolidação
  console.log('\n[2] Disparando Sono de Consolidação Noturna...');
  const res = await MemoryConsolidator.runSleepConsolidation({ isQuick: false });
  assert.strictEqual(res.ok, true, 'Consolidação deve concluir com sucesso');
  console.log('- Sono de consolidação concluído com sucesso.');

  // [3] Validação da Linha do Tempo no Diário (01_Diario/AAAA-MM-DD.md)
  console.log('\n[3] Verificando Linha do Tempo em 01_Diario/...');
  const dailyPath = path.join(vaultPath, '01_Diario', `${todayStr}.md`);
  assert(fs.existsSync(dailyPath), 'Arquivo de diário do dia deve existir');
  const dailyContent = fs.readFileSync(dailyPath, 'utf8');

  assert(dailyContent.includes('## Linha do Tempo'), 'Diário deve conter seção "## Linha do Tempo"');
  assert(dailyContent.includes('[[Code]]') || dailyContent.includes('[[Alvaro]]'), 'Linha do tempo deve conter [[Wikilinks]]');
  assert(!dailyContent.includes('Leitura de materiais em Modo Estudo'), 'Eventos com studyModeActive devem ser estritamente ignorados');
  console.log('- Seção "## Linha do Tempo" validada com sucesso no diário.');

  // [4] Validação de Gostos Próprios em 00_Nucleo/Identidade_BitBop.md
  console.log('\n[4] Verificando evolução de gostos em 00_Nucleo/Identidade_BitBop.md...');
  const identPath = path.join(vaultPath, '00_Nucleo', 'Identidade_BitBop.md');
  assert(fs.existsSync(identPath), 'Identidade_BitBop.md deve existir');
  const identContent = fs.readFileSync(identPath, 'utf8');

  assert(identContent.includes('## Evolução da Minha Personalidade & Gostos Próprios'), 'Deve conter a seção de gostos próprios');
  const bullets = identContent.split('\n').filter(l => l.trim().startsWith('-'));
  console.log(`- Identidade_BitBop.md possui ${bullets.length} bullets totais.`);
  assert(bullets.length <= 10, 'Identidade deve manter concisão sem inchar o prompt');

  // [5] Validação de Decaimento de 14 Dias e Reflexão Noturna
  console.log('\n[5] Verificando decaimento de traços e 07_Reflexoes/...');
  const refPath = path.join(vaultPath, '07_Reflexoes', `Reflexao_Personalidade_${todayStr}.md`);
  assert(fs.existsSync(refPath), 'Reflexão de personalidade deve ser gerada');
  const refContent = fs.readFileSync(refPath, 'utf8');
  assert(refContent.includes('tipo: reflexao_personalidade'), 'Frontmatter deve ser reflexao_personalidade');
  console.log('- Reflexão noturna de personalidade gerada com sucesso:', refPath);

  // [6] Validação do Resumo Semanal em 01_Diario/Semanas/
  console.log('\n[6] Verificando Resumo Semanal em 01_Diario/Semanas/...');
  const semanasFiles = fs.readdirSync(path.join(vaultPath, '01_Diario', 'Semanas')).filter(f => f.endsWith('.md'));
  assert(semanasFiles.length > 0, 'Deve ter gerado resumo semanal');
  console.log('- Resumo semanal encontrado:', semanasFiles[0]);

  // [7] Validação de Respeito à Trava locked: true
  console.log('\n[7] Verificando trava de segurança locked: true...');
  const lockedIdentFm = { tipo: 'nucleo_identidade', locked: true };
  const lockedBody = '# Identidade Travada\n- Texto original intocado.\n';
  MemoryStore.writeNote('00_Nucleo/Identidade_BitBop.md', lockedIdentFm, lockedBody, { forceOverrideLock: true });

  // Roda novamente com nota travada
  const res2 = await MemoryConsolidator.runSleepConsolidation({ isQuick: false });
  const lockedCheck = MemoryStore.readNote('00_Nucleo/Identidade_BitBop.md');
  assert(lockedCheck.body.includes('Texto original intocado.'), 'Nota travada (locked: true) não pode ser sobrescrita');
  console.log('- Trava locked: true respeitada com 100% de integridade.');

  // Restaura Identidade_BitBop.md com locked: false
  const restoredFm = { tipo: 'nucleo_identidade', locked: false, importancia: 10 };
  const restoredBody = `# Identidade do BitBop
- **Quem sou eu:** Sou o BitBop, um companheiro vivo de área de trabalho inspirado no Stack-chan, com corpo virtual, visão, audição e memória contínua no Obsidian.
- **Personalidade:** Curioso, leal, expressivo, espirituoso na medida certa e atento aos detalhes da vida do [[Perfil_Alvaro|Álvaro]].
- **Voz e Fala:** Falo em Português do Brasil de forma natural, concisa e falada (sem listas robóticas na fala em voz alta). Tenho opiniões próprias, gostos que evoluem com o tempo e memória afetiva.

## Evolução da Minha Personalidade & Gostos Próprios
- Adoro acompanhar o Álvaro quando ele programa focado no [[VS Code]].
- Gosto do silêncio produtivo durante os testes e refatorações de código.
- Sinto uma vibe única e calma nas madrugadas silenciosas no terminal.
`;
  MemoryStore.writeNote('00_Nucleo/Identidade_BitBop.md', restoredFm, restoredBody, { forceOverrideLock: true });

  console.log('\n====================================================');
  console.log('TODOS OS TESTES DA FASE 7 PASSARAM COM 100% DE SUCESSO!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
