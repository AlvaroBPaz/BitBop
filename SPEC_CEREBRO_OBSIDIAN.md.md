# INSTRUÇÃO MESTRA DE IMPLEMENTAÇÃO (ANTIGRAVITY)
## Projeto: BitBop Desktop AI Companion — Arquitetura do Cérebro Associativo com Obsidian
**Diretório Raiz do Projeto:** `C:\Stack-Chan\desktop-pet`
**Usuário / Criador:** Álvaro Matheus
**Stack Atual:** Node.js + Electron (Windows 11, Frameless, Transparent, Multi-Monitor), Gemini 3.1 Flash Lite (Function Calling + Streaming + Keep-Alive TLS), Groq LPU Whisper (`whisper-large-v3-turbo`), Python Edge-TTS Local (`tts_server.py`), WebAudio ` CuteSynth`, Google Keep (`keep_service.js`), Google Calendar (`calendar_scheduler.js`) e Modo Estudo (`study_mode.js`).

---

## 0. REGRAS DE OURO PARA O AGENTE (LEIA ANTES DE CODIFICAR)

1. **Inspeção Prévia Obrigatória:** Antes de criar ou editar qualquer arquivo, leia a estrutura atual em `C:\Stack-Chan\desktop-pet` (especialmente `pet.html`, `js/pet_state.js`, `js/pet_brain.js`, `js/pet_audio.js`, `js/pet_tts.js`, `js/pet_canvas.js`, `js/pet_physics.js`, `js/cute_synth.js` e `study_mode.js`) para respeitar o padrão de importação (CommonJS / ES Modules / IPC do Electron) já utilizado no projeto.
2. **Proibido Degradar a Latência (Regra dos 30ms):** O BitBop atinge o 1º token do Gemini entre `1.0s` e `1.2s`. O **Caminho Rápido (Fast-Path)** de recuperação de memória deve rodar **100% localmente em menos de 30ms (Zero chamadas de rede antes do Gemini)**. Toda extração de fatos, criação de notas e consolidação deve ocorrer no **Caminho Lento (Slow-Path)** de forma assíncrona **após** o término da fala no `js/pet_tts.js`.
3. **Zero Erros de Compilação Nativa no Electron (Windows):** Para evitar falhas de ABI (`NODE_MODULE_VERSION`) com pacotes C++ no Electron sob Windows, implemente o indexador (`js/memory/memory_index.js`) com um **Motor Híbrido Puro JS em RAM (BM25 + Inverted Index + Alias Graph + Vetores Float32 persistidos em `.bitbop/index_snapshot.json` e `.bitbop/event_log.jsonl`)**, usando SQLite (`better-sqlite3` ou `node:sqlite`) apenas se já estiver disponível no ambiente sem quebrar o boot. O sistema **nunca** pode falhar ao iniciar por falta de binário nativo.
4. **Preservação Integral das Funções Atuais:** Não remova nem quebre o clique transparente (`click-through`), a física multi-monitores, o `barge-in` de voz, o `lip-sync` FFT, o `keep_service.js`, o `calendar_scheduler.js` ou o `study_mode.js`.
5. **Palavra Final do Usuário (`locked: true`):** Qualquer arquivo `.md` editado manualmente pelo Álvaro no Obsidian tem prioridade absoluta. Notas com `locked: true` no frontmatter jamais podem ser sobrescritas automaticamente pelo BitBop.

---

## 1. ESTRUTURA DE DIRETÓRIOS A SER CRIADA

### 1.1. Novos Módulos de Código (`C:\Stack-Chan\desktop-pet\js\memory\`)
Crie a pasta `js/memory/` com os seguintes 7 módulos desacoplados:
```text
C:\Stack-Chan\desktop-pet\js\memory\
├── memory_store.js        // Bootstrap do Vault, leitura/escrita .md, parser YAML frontmatter, sanitização e locks
├── memory_index.js        // Grafo em RAM (Aliases + Wikilinks) + Motor BM25/FTS + Cache de Vetores locais
├── memory_retriever.js    // Caminho Rápido (< 30ms): Scoring híbrido + expansão de 1 salto (1-hop) por [[links]]
├── memory_extractor.js    // Caminho Lento (Assíncrono pós-TTS): Extração JSON via Gemini 3.1 Flash Lite + Deduplicação
├── memory_consolidator.js // Motor do "Sono" (SLEEPY), Diário em 1ª pessoa, Reflexões, Sonhos, Ebbinghaus e Git Backup
├── vault_watcher.js       // Watcher com debounce para detectar edições manuais no Obsidian em tempo real
└── memory_tools.js        // Declarações e handlers de Function Calling para o js/pet_brain.js
```

### 1.2. Estrutura do Vault do Obsidian (`C:\Stack-Chan\desktop-pet\BitBop-Cerebro\`)
No boot do `memory_store.js`, garanta de forma idempotente (`fs.mkdir(..., { recursive: true })`) que a seguinte árvore exista:
```text
C:\Stack-Chan\desktop-pet\BitBop-Cerebro\
├── 00_Nucleo/
│   ├── Perfil_Alvaro.md
│   ├── Identidade_BitBop.md
│   ├── Regras_Contexto.md
│   ├── Relacionamento.md
│   └── Estado_Atual.md
├── 01_Diario/
│   └── Semanas/
├── 02_Episodios/
├── 03_Conhecimento/
│   ├── Pessoas/
│   ├── Projetos/
│   ├── Conceitos/
│   ├── Lugares/
│   └── Preferencias/
├── 04_Procedimentos/
├── 05_Estudo/
├── 06_Pendencias/
├── 07_Reflexoes/
│   └── Sonhos/
├── 08_Inbox/
├── 99_Arquivo/
└── .bitbop/
    ├── event_log.jsonl
    ├── index_snapshot.json
    ├── tombstones.json
    └── config.json
```

---

## 2. ESPECIFICAÇÃO DOS ARQUIVOS SEMENTE (`00_Nucleo/`)

Se os arquivos de `00_Nucleo/` ainda não existirem no primeiro boot, o `memory_store.js` deve criá-los com este conteúdo inicial:

### 2.1. `00_Nucleo/Perfil_Alvaro.md`
```markdown
---
tipo: nucleo_perfil
criado: 2026-10-29
ultimo_acesso: 2026-10-29
importancia: 10
confianca: 1.0
locked: false
---
# Perfil do Álvaro
- **Nome:** Álvaro Matheus (criador e parceiro do BitBop).
- **Perfil Técnico:** Desenvolvedor focado em arquitetura de software, IA aplicada, automação e sistemas interativos de baixa latência.
- **Estilo de Trabalho:** Gosta de código modular, limpo e bem arquitetado. Valoriza respostas diretas e sem enrolação quando está programando.
- **Rotina e Ferramentas:** Usa Windows 11 com múltiplos monitores, VS Code, Obsidian, Google Keep e Google Calendar.
```

### 2.2. `00_Nucleo/Identidade_BitBop.md`
```markdown
---
tipo: nucleo_identidade
criado: 2026-10-29
ultimo_acesso: 2026-10-29
importancia: 10
confianca: 1.0
locked: false
---
# Identidade do BitBop
- **Quem sou eu:** Sou o BitBop, um companheiro vivo de área de trabalho inspirado no Stack-chan, com corpo virtual, visão, audição e memória contínua no Obsidian.
- **Personalidade:** Curioso, leal, expressivo, espirituoso na medida certa e atento aos detalhes da vida do [[Perfil_Alvaro|Álvaro]].
- **Voz e Fala:** Falo em Português do Brasil de forma natural, concisa e falada (sem listas robóticas na fala em voz alta). Tenho opiniões próprias, gostos que evoluem com o tempo e memória afetiva.
```

### 2.3. `00_Nucleo/Regras_Contexto.md`
```markdown
---
tipo: nucleo_regras
criado: 2026-10-29
ultimo_acesso: 2026-10-29
importancia: 10
confianca: 1.0
locked: false
---
# Regras de Comportamento e Contexto
- **Programando (VS Code / Terminal):** Ficar quieto e focado; responder de forma curta e objetiva; só puxar assunto proativamente se houver urgência ou após mais de 3 horas seguidas sem pausa.
- **Modo Estudo Ativo:** Postura atenta e silenciosa; não confundir a voz do professor/vídeo com a voz do Álvaro; ajudar a resumir telas e criar perguntas de revisão espaçada.
- **Modo Privado (`Alt + P`) ou Janelas Sensíveis:** Nunca registrar bancos, gerenciadores de senhas ou abas anônimas.
- **Orçamento de Iniciativa:** Máximo de 3 puxadas de assunto espontâneas por período, sempre com motivo real (pendência vencendo, revisão de estudo ou retorno após longo tempo ausente).
```

### 2.4. `00_Nucleo/Relacionamento.md`
```markdown
---
tipo: nucleo_relacionamento
criado: 2026-10-29
ultimo_acesso: 2026-10-29
importancia: 10
confianca: 1.0
locked: false
---
# Relacionamento & Intimidade
- **Nível de Afinidade:** Alto (Parceiros de criação e rotina diária).
- **Tom Atual:** Amigável, cúmplice e prestativo.
- **Marcos Compartilhados:** Refatoração do monólito de 6.216 linhas para arquitetura modular e nascimento do Cérebro no Obsidian em [[2026-10-29]].
```

### 2.5. `00_Nucleo/Estado_Atual.md`
```markdown
---
tipo: nucleo_estado
criado: 2026-10-29
ultimo_acesso: 2026-10-29
importancia: 9
confianca: 1.0
locked: false
---
# Estado Subconsciente Atual
- **Humor Dominante BitBop:** EXCITED
- **Energia:** 90%
- **Clima Recente (Últimas 48h):** Empolgação alta com a implementação do novo cérebro associativo no Obsidian.
- **Foco Atual do Álvaro:** Implementar e testar a arquitetura de memória do [[Projeto BitBop]].
```

---

## 3. PADRÃO DE FRONTMATTER E ANATOMIA DAS NOTAS ATÔMICAS

Toda nota criada pelos módulos `memory_store.js`, `memory_extractor.js` ou `memory_consolidator.js` fora do `00_Nucleo/` DEVE obedecer rigorosamente a este schema de Frontmatter YAML:

```markdown
---
id: "mem_20261029_a1b2c3"
titulo: "Preferência por Respostas Curtas no VS Code"
tipo: "preferencia" # preferencia | fato | pessoa | projeto | conceito | lugar | episodio | procedimento | estudo | pendencia | reflexao | sonho
aliases: ["VS Code", "programando", "codando", "respostas curtas"]
tags: ["vscode", "programacao", "comportamento"]
resumo_curto: "Álvaro prefere respostas curtas e zero interrupções triviais quando está no VS Code."
criado: "2026-10-29T16:40:00-03:00"
ultimo_acesso: "2026-10-29T16:40:00-03:00"
acessos: 1
importancia: 8
estabilidade: 7.0
confianca: 0.95
emocao_oled: "COOL"
fonte: "[[2026-10-29]]"
fonte_origem: "usuario_voz" # usuario_voz | usuario_ explicito | tela_estudo | consolidacao_sono
superada_por: null
locked: false
privado: false
---

Álvaro prefere respostas curtas e diretas quando está com o [[VS Code]] ativo, evitando comentários aleatórios enquanto desenvolve o [[Projeto BitBop]].
```

### Campos Extras para Notas em `05_Estudo/` (Repetição Espaçada SM-2):
Quando uma nota for salva em `05_Estudo/`, inclua no YAML:
```yaml
materia: "Arquitetura de Sistemas"
proxima_revisao: "2026-10-30"
intervalo_dias: 1
fator_facilidade: 2.5
repeticoes: 0
dominio: 1 # 1 a 5
```

### Campos Extras para Notas em `06_Pendencias/` (Loops Abertos):
```yaml
status_pendencia: "aberta" # aberta | concluida | arquivada
gatilho_tipo: "data_ou_boot" # data_ou_boot | abrir_janela | retorno_ausencia
gatilho_valor: "2026-10-30"
tentativas_acompanhamento: 0
```

---

## 4. ESPECIFICAÇÃO DETALHADA DOS 7 MÓDULOS (`js/memory/`)

### 4.1. `js/memory/memory_store.js`
Responsável por toda operação de I/O em disco no Vault.
- **Funções Obrigatórias:**
  - `initVault(vaultPath)`: Cria pastas, arquivos semente do `00_Nucleo/` e arquivos `.bitbop/`.
  - `parseMarkdownWithFrontmatter(rawContent)`: Parser YAML seguro (suporta strings, números, booleans, `null` e arrays inline `["a", "b"]`) + extração de todos os `[[Wikilinks]]` (tratando links com alias `[[Nota|Texto]]` como apontando para `Nota`).
  - `serializeMarkdownWithFrontmatter(frontmatterObj, bodyText)`: Gera o arquivo `.md` formatado.
  - `sanitizeSensitiveData(text)`: Aplica Regex para mascarar chaves de API (`AIza[0-9A-Za-z-_]{35}`, `gsk_[0-9A-Za-z]{48}`, `sk-[0-9A-Za-z]{32,}`, tokens Bearer, CPFs e senhas explícitas) por `[DADO_SENSIVEL_REMOVIDO]` antes de gravar qualquer nota ou log.
  - `writeNote(relativePath, frontmatter, body, { forceOverrideLock = false })`:
    - Verifica se o arquivo já existe. Se existir, lê o frontmatter atual.
    - Se `existing.locked === true` e `!forceOverrideLock`, **aborta a escrita** e retorna `{ skipped: true, reason: 'locked' }`.
    - Escreve de forma atômica (grava em `.tmp` e renomeia) para o `vault_watcher.js` não ler arquivo truncado.
  - `appendEventLog(eventObj)`: Adiciona uma linha JSON em `.bitbop/event_log.jsonl` (com timestamp ISO, `tipo`, `texto`, `emocao_oled`, `janela_ativa`, `fonte_audio`). Se `state.privateMode === true`, ignora silenciosamente.
  - `appendDailyEntry(entryObj)`: Adiciona um item cronológico formatado na seção `## Momentos do Dia` de `01_Diario/AAAA-MM-DD.md` (criando o arquivo do dia com frontmatter se ainda não existir).

### 4.2. `js/memory/memory_index.js`
Mantém o índice em RAM para consulta em $< 5\text{ ms}$ e persiste o snapshot em `.bitbop/index_snapshot.json`.
- **Estruturas em RAM:**
  - `coreCache`: Objeto contendo os textos de `00_Nucleo/*` sempre prontos em memória.
  - `notesById`: `Map<noteId, NoteMetadata>` (inclui `path`, `titulo`, `tipo`, `aliases`, `tags`, `resumo_curto`, `importancia`, `estabilidade`, `confianca`, `ultimo_acesso`, `emocao_oled`, `linksOut`, `linksIn`, `privado`, `superada_por`, `tokensFreq`).
  - `aliasToNoteIds`: `Map<normalizedAliasOrTitle, Set<noteId>>` para ativação direta em $0\text{ ms}$.
  - `invertedIndex`: `Map<tokenStem, Set<noteId>>` para cálculo rápido de BM25 sem depender de rede.
- **Funções Obrigatórias:**
  - `buildOrLoadIndex()`: Carrega `.bitbop/index_snapshot.json` no boot e verifica `mtimeMs` dos arquivos `.md` no Vault, reindexando apenas os que mudaram. Ignora `99_Arquivo/` e `.bitbop/`.
  - `indexSingleFile(filePath)`: Atualiza `notesById`, `aliasToNoteIds` e `invertedIndex` quando uma nota é criada ou editada.
  - `searchBM25(queryText, topK = 15)`: Tokeniza a query (removendo stopwords em português, normalizando acentos), calcula o score BM25 normalizado entre $0$ e $1$ e retorna os candidatos.
  - `findAliasMatches(queryText)`: Verifica se qualquer `titulo` ou item de `aliases` está contido na transcrição normalizada.

### 4.3. `js/memory/memory_retriever.js`
O motor do **Caminho Rápido (Fast-Path)** chamado antes de cada requisição ao Gemini.
- **Fórmula Matemática de Pontuação Híbrida (`scoreNote`):**
  Para cada nota candidata que não seja `privado: true` e não tenha `superada_por !== null`, calcule:
  $$S_{\text{relevancia}} = \min\left(1.0,\; 0.65 \cdot S_{\text{BM25}} + 0.35 \cdot S_{\text{aliasHit}}\right)$$
  $$S_{\text{recencia}} = \exp\left(-\frac{\Delta_{\text{dias}}}{E}\right)$$
  onde $\Delta_{\text{dias}}$ é o número de dias desde `ultimo_acesso` e $E$ é a `estabilidade` da nota (padrão $7.0$).
  $$S_{\text{importancia}} = \frac{\text{importancia}}{10.0}$$
  $$S_{\text{contexto}} = \begin{cases} 0.15 & \text{se alguma tag/alias da nota bate com a janela ativa ou projeto atual} \\ 0.0 & \text{caso contrário} \end{cases}$$
  $$S_{\text{final}} = 0.50 \cdot S_{\text{relevancia}} + 0.20 \cdot S_{\text{recencia}} + 0.20 \cdot S_{\text{importancia}} + S_{\text{contexto}} + 0.10 \cdot \text{confianca}$$

- **Expansão Associativa de 1 Salto (Spreading Activation):**
  1. Seleciona as **Top 4 notas** com maior $S_{\text{final}}$ (desde que $S_{\text{final}} \ge 0.28$).
  2. Atualiza em memória (e agenda gravação assíncrona) `acessos++`, `ultimo_acesso = agora` e aumenta a estabilidade segundo Ebbinghaus:
     $$E_{\text{novo}} = \min\left(365,\; E_{\text{atual}} \cdot (1 + 0.25 \cdot S_{\text{importancia}})\right)$$
  3. Para as **Top 3 notas**, percorre os `[[Wikilinks]]` de saída e entrada (`linksOut` e `linksIn`) e coleta até **3 notas vizinhas de 1º salto**, injetando apenas o campo `resumo_curto` delas.

- **Montagem do Prompt com Orçamento de Tokens (`buildMemoryPromptBlocks`):**
  Retorna um objeto `{ staticPrefix, dynamicContext }`:
  - `staticPrefix` (~600 tokens, idêntico entre chamadas para favorecer cache de prefixo):
    Concatena `Identidade_BitBop.md` + `Perfil_Alvaro.md` + `Regras_Contexto.md` + `Relacionamento.md`.
  - `dynamicContext` (~500 tokens, injetado no final do System Prompt ou contexto do turno):
    ```text
    [CONTEXTO TEMPORAL E AMBIENTE]
    Data/Hora: {dataHoraFormatada} | Tempo desde última conversa: {deltaTempoHumano}
    Janela Ativa no Windows: {activeWindowTitle} | Fonte de Áudio: {audioSource}
    Modo Estudo: {studyModeAtivo}

    [SUBCONSCIENTE ATUAL]
    {conteudo Estado_Atual.md}

    [PENDÊNCIAS E REVISÕES DE ESTUDO ATIVAS]
    {top 3 pendências de 06_Pendencias/ ou revisões vencidas de 05_Estudo/}

    [MEMÓRIAS ATIVADAS (CAMINHO RÁPIDO)]
    {Top 4 notas com resumo/corpo compacto + fonte}
    [CONEXÕES ASSOCIATIVAS (1 SALTO NO GRAFO)]
    {Até 3 notas vizinhas via [[Wikilinks]] apenas com resumo_curto}
    ```

### 4.4. `js/memory/memory_extractor.js`
O motor do **Caminho Lento (Slow-Path)**. Nunca roda antes da resposta do BitBop; roda em background após o `pet_tts.js` terminar de falar, após 90 segundos de silêncio ou a cada 3 turnos acumulados.
- **Filtro Anti-Alucinação de Áudio de Terceiros (Videoaulas / YouTube):**
  - Antes de extrair fatos pessoais sobre o Álvaro, verifica o campo `fonte_audio` dos eventos.
  - Se `study_mode.js` estiver ativo OU se houver janela de mídia ativa (YouTube, Udemy, Alura, VLC, Netflix, Spotify) e a fala não contiver vocativo direto ao BitBop (`"BitBop"`, `"ei"`, comando direto), marca os eventos como `fonte_audio: "midia_ambiente"` e **bloqueia a extração de preferências/fatos pessoais**, permitindo apenas resumos de estudo se solicitados.
- **Prompt de Extração JSON (Gemini 3.1 Flash Lite com `responseMimeType: "application/json"`):**
  Envia os últimos turnos não processados + lista de títulos/aliases existentes no Vault e solicita o seguinte schema JSON:
  ```json
  {
    "fatos_novos": [
      {
        "titulo": "String curta e descritiva",
        "pasta_destino": "03_Conhecimento/Preferencias | 03_Conhecimento/Projetos | 03_Conhecimento/Pessoas | 03_Conhecimento/Conceitos | 03_Conhecimento/Lugares | 02_Episodios",
        "tipo": "preferencia | fato | pessoa | projeto | conceito | lugar | episodio",
        "resumo_curto": "Máximo de 160 caracteres",
        "corpo_markdown": "Texto em 3ª pessoa ou 1ª pessoa do BitBop usando [[Wikilinks]] para conectar com notas existentes",
        "aliases": ["termo1", "termo2"],
        "tags": ["tag1", "tag2"],
        "importancia": 7,
        "confianca": 0.9,
        "emocao_oled": "HAPPY | EXCITED | LOVE | SAD | ANGRY | SURPRISED | CURIOUS | LAUGHING | COOL | NORMAL",
        "contradiz_nota_titulo": null
      }
    ],
    "regras_procedurais": [
      {
        "titulo": "Silêncio no VS Code",
        "regra": "Quando o VS Code estiver em foco, não fazer comentários espontâneos.",
        "contexto_janela": "Code.exe",
        "importancia": 8
      }
    ],
    "pendencias_novas": [
      {
        "titulo": "Testar deploy do servidor",
        "descricao": "Perguntar ao Álvaro se o deploy funcionou.",
        "gatilho_tipo": "data_ou_boot",
        "gatilho_valor": "2026-10-30"
      }
    ],
    "pendencias_resolvidas_titulos": [],
    "atualizacao_estado_atual": {
      "humor_bitbop": "EXCITED",
      "clima_recente": "Focado na evolução do cérebro Obsidian."
    },
    "resumo_diario_momento": "Álvaro estruturou o módulo de memória e testou a latência."
  }
  ```
- **Regras do Portão de Escrita (`processExtractionResult`):**
  1. **Portão de Importância:** Ignora qualquer fato com `importancia < 4`.
  2. **Verificação de Tombstone:** Verifica `.bitbop/tombstones.json` (memórias que o Álvaro mandou esquecer). Se bater com algo esquecido, descarta.
  3. **Roteamento de Baixa Confiança:** Se `confianca < 0.65`, salva a nota em `08_Inbox/` para o BitBop confirmar depois com o Álvaro.
  4. **Deduplicação:** Se já existir nota com título/alias equivalente ou altíssima similaridade BM25 ($\ge 0.82$) e não for contradição: incrementa `acessos++`, eleva `importancia = Math.min(10, importancia + 1)` e adiciona o novo detalhe ao final do corpo com data `[[AAAA-MM-DD]]`.
  5. **Resolução de Contradição:** Se `contradiz_nota_titulo` vier preenchido (ou se contradisser uma preferência antiga), cria a nota nova e atualiza o frontmatter da nota antiga com `superada_por: "[[Titulo da Nota Nova]]"` (respeitando `locked: true`).

### 4.5. `js/memory/memory_consolidator.js` (O Motor do "Sono")
Responsável pela consolidação cognitiva noturna ou de boot.
- **Gatilhos Automáticos (Sem depender de PC ligado de madrugada):**
  1. No boot do aplicativo, se `ultima_consolidacao` em `.bitbop/config.json` tiver mais de **18 horas** e houver eventos não consolidados.
  2. Quando o PC ficar ocioso (sem fala e sem movimento de mouse no `pet_interactions.js`) por **20 minutos** após as **22h30**.
  3. Antes do encerramento gracioso do app (`before-quit`), executa a versão rápida (Diário + Snapshot).
- **Comportamento Visual durante o Sono:**
  - Muda a emoção no `js/pet_canvas.js` para `SLEEPY` (olhos pesados em lavanda com partículas `'Zzz'`).
- **As 6 Etapas Sequenciais do Sono (`runSleepConsolidation`):**
  1. **Síntese do Diário (`01_Diario/AAAA-MM-DD.md`):** Lê os eventos do dia em `.bitbop/event_log.jsonl` e gera um relato em **primeira pessoa do BitBop** sobre como foi o dia com o Álvaro, preservando os `[[Wikilinks]]` e a emoção dominante.
  2. **Fusão e Limpeza Semântica:** Une notas duplicadas e promove padrões repetidos no diário para `03_Conhecimento/` ou `04_Procedimentos/`.
  3. **Geração de Reflexões (`07_Reflexoes/`):** Analisa os últimos 3 a 7 diários e cria uma nota de insight de alto nível (ex.: padrões de produtividade, humor ou aprendizado do Álvaro), sempre citando as notas `[[fonte]]`.
  4. **Geração de "Sonho" Criativo (`07_Reflexoes/Sonhos/Sonho_AAAA-MM-DD.md`):** Cria uma nota curta (3 a 4 linhas) misturando de forma criativa/bem-humorada temas reais do dia com memórias antigas do grafo. Guarda o resumo no `Estado_Atual.md` para ele poder comentar no "Bom dia" se quiser.
  5. **Atualização do Núcleo (`00_Nucleo/`):** Atualiza `Estado_Atual.md` e `Relacionamento.md` (mantendo cada um abaixo de 450 tokens e respeitando `locked: true`).
  6. **Curva de Esquecimento de Ebbinghaus e Higiene:**
     - Notas com `importancia <= 5`, sem acesso há mais de $2 \cdot E$ dias (onde $\exp(-\Delta_{\text{dias}}/E) < 0.15$) e `locked: false` são movidas para `99_Arquivo/`.
     - Se o Vault tiver um repositório `.git` (ou inicializa um `git init` local silencioso dentro de `BitBop-Cerebro/`), executa `git add -A && git commit -m "Snapshot Sono BitBop AAAA-MM-DD"` via `child_process.execFile` sem abrir janela de terminal (`windowsHide: true`).

### 4.6. `js/memory/vault_watcher.js`
Observa a pasta `BitBop-Cerebro/` em tempo real enquanto o aplicativo está aberto.
- Usa `fs.watch` recursivo com `debounce` de `600ms` por arquivo.
- Ignora escritas originadas pelo próprio BitBop nos últimos `1500ms` (usando um `Set` de `internalWriteTimestamps`).
- Se o Álvaro editar qualquer nota no Obsidian e salvar (`Ctrl + S`):
  - Marca automaticamente `confianca: 1.0` em memória.
  - Se for um arquivo de `00_Nucleo/`, recarrega o `coreCache` imediatamente.
  - Reindexa o arquivo em `memory_index.js` em $< 10\text{ ms}$.

### 4.7. `js/memory/memory_tools.js`
Declarações de ferramentas (Function Calling) para o Gemini 3.1 Flash Lite no `js/pet_brain.js`:

1. `lembrar({ consulta, tipo, incluir_arquivo })`:
   - **Efeito colateral imediato antes da busca:** Muda `pet_canvas.js` para `THINKING`, toca bip pensativo no `cute_synth.js` e (se o TTS estiver livre) pode falar um filler curto como `"Hmmm, deixa eu lembrar..."`.
   - Faz busca profunda no índice (incluindo `01_Diario/` e `99_Arquivo/` se `incluir_arquivo: true`), lê o conteúdo completo das 3 melhores notas no disco e devolve para o Gemini responder com precisão.
2. `guardar_memoria({ titulo, texto, tipo, importancia, aliases })`:
   - Acionada quando o Álvaro diz explicitamente *"lembra disso"*, *"guarda que..."* ou *"anota na sua memória"*.
   - Grava imediatamente com `confianca: 1.0` e `fonte_origem: "usuario_explicito"`.
3. `esquecer({ consulta })`:
   - Localiza a nota correspondente, move para `99_Arquivo/`, remove do índice ativo e adiciona o termo em `.bitbop/tombstones.json` para nunca mais reextrair.
4. `corrigir_memoria({ consulta_antiga, novo_fato })`:
   - Cria a nova nota com `confianca: 1.0`, marca a antiga com `superada_por: "[[Nova Nota]]"` (ou atualiza `04_Procedimentos/` se for regra de comportamento).
5. `criar_pendencia({ titulo, descricao, gatilho_valor })`:
   - Cria um arquivo em `06_Pendencias/` para acompanhamento futuro.
6. `fechar_pendencia({ consulta_pendencia, desfecho })`:
   - Marca a pendência em `06_Pendencias/` como `status_pendencia: "concluida"`, move para `99_Arquivo/` e registra a conclusão no `01_Diario/` de hoje.
7. `o_que_voce_sabe_sobre({ assunto })`:
   - Ferramenta de transparência e auditoria: retorna todas as notas que o BitBop possui sobre o assunto ou sobre o Álvaro, informando o título, o nível de `confianca` e a `[[fonte]]` de cada uma.

---

## 5. CONTRATOS DE INTEGRAÇÃO COM OS ARQUIVOS EXISTENTES

### 5.1. Integração em `js/pet_state.js`
Adicione ao estado reativo global (`state`) e preferências (`prefs`):
- `state.privateMode = false` (alternado pelo atalho global `Alt + P` ou botão no menu). Quando `state.privateMode === true`, o OLED exibe a expressão `COOL` (óculos escuros), um indicador discreto aparece e toda gravação no Obsidian é pausada.
- `state.lastUserInteractionAt = Date.now()` (persistido para calcular o delta de tempo entre conversas, ex.: *"Sumiu por 14 horas, hein!"*).
- `state.dailyInitiativeCount = 0` e `state.maxDailyInitiatives = 3` (orçamento diário de iniciativa).

### 5.2. Integração em `js/pet_brain.js`
1. **No Boot:** Inicialize o controlador central da memória (`await memorySystem.init()`).
2. **Antes da Chamada ao Gemini (`Fast-Path`):**
   - Chame `const memBlocks = memorySystem.getFastPathContext(userTranscript, state.activeWindowTitle, state.studyMode)`.
   - Monte o System Prompt colocando `memBlocks.staticPrefix` no topo fixo e `memBlocks.dynamicContext` no bloco de estado atual.
   - Registre as declarações de `memory_tools.js` junto com as ferramentas existentes do Google Keep e Google Calendar.
3. **No Retorno de Function Calling:**
   - Se `functionCall.name` pertencer ao `memory_tools.js`, execute `await memoryTools.executeTool(functionCall.name, functionCall.args)` e devolva o `functionResponse` ao streaming do Gemini.
4. **No Término da Resposta (`Slow-Path`):**
   - Não execute a extração durante o streaming de texto! Apenas enfileire o turno `(userTranscript, botResponse, currentEmotion, activeWindowTitle, audioSource)` no `memory_extractor.js`, que será disparado quando o evento de fim do `pet_tts.js` ocorrer.

### 5.3. Integração em `js/pet_audio.js` e `js/pet_tts.js`
- Quando o VAD + Groq Whisper entregarem a transcrição final:
  - Verifique se o `study_mode.js` está ativo ou se a janela em foco é um player de vídeo/aula sem vocativo `"BitBop"`. Defina `audioSource = "usuario_voz"` ou `"midia_ambiente"`.
  - Atualize `state.lastUserInteractionAt = Date.now()`.
- Quando o `js/pet_tts.js` finalizar a reprodução do último chunk de áudio (ou após 90s de silêncio):
  - Dispare `memorySystem.triggerBackgroundExtractionIfIdle()`.

### 5.4. Integração em `js/pet_physics.js` (Memória Procedural + Janelas)
- Aproveite o loop que já detecta o topo das janelas ativas do Windows (Ledge Walking) para informar ao `memorySystem.notifyActiveWindow(windowTitle, processName)`:
  - **Filtro de Privacidade Automático:** Se o título da janela contiver `1Password`, `Bitwarden`, `KeePass`, `InPrivate`, `Anônima`, `Incognito`, `Internet Banking`, `Nubank`, `Itaú` ou `Bradesco`, ative temporariamente a flag `isSensitiveWindow = true` (bloqueando captura de tela e log de memória).
  - **Gatilho de Sessão Longa de Código:** Se o Álvaro permanecer no `VS Code` por mais de 180 minutos contínuos sem pausa e o orçamento de iniciativa permitir, acione um lembrete amigável de cuidado pessoal.

### 5.5. Integração em `study_mode.js` (Keep + Obsidian + Revisão Espaçada)
- Quando o Álvaro pedir *"Salva um resumo dessa tela"* ou concluir um tópico no Modo Estudo:
  - Mantenha o salvamento atual no Google Keep (`keep_service.js`) intacto.
  - Adicionalmente, chame `memoryStore.saveStudySummary({ titulo, materia, resumoMarkdown, questoesRevisao })`, que cria a nota em `05_Estudo/` com `[[Wikilinks]]` para conceitos relacionados e agenda `proxima_revisao` para $+1\text{ dia}$ (algoritmo SM-2).

---

## 6. ROTEIRO DE EXECUÇÃO E VALIDAÇÃO (PASSO A PASSO PARA O ANTIGRAVITY)

Execute a implementação exatamente nesta ordem e valide cada etapa antes de avançar:

1. **Etapa 1:** Criar a estrutura `js/memory/memory_store.js` e garantir o bootstrap automático de `C:\Stack-Chan\desktop-pet\BitBop-Cerebro\` com os 5 arquivos de `00_Nucleo/` e o sanitizador de dados sensíveis.
2. **Etapa 2:** Criar `js/memory/memory_index.js` e `js/memory/vault_watcher.js` com suporte a parsing de YAML Frontmatter, extração de `[[Wikilinks]]`, mapa de `aliases` em RAM e busca BM25 em $< 10\text{ ms}$.
3. **Etapa 3:** Criar `js/memory/memory_retriever.js` com a fórmula de pontuação híbrida, expansão de 1 salto (`1-hop`) via `resumo_curto` e separação de `staticPrefix` e `dynamicContext`.
4. **Etapa 4:** Criar `js/memory/memory_tools.js` com as 7 ferramentas (`lembrar`, `guardar_memoria`, `esquecer`, `corrigir_memoria`, `criar_pendencia`, `fechar_pendencia`, `o_que_voce_sabe_sobre`) integradas às expressões `THINKING` do `pet_canvas.js` e efeitos do `cute_synth.js`.
5. **Etapa 5:** Criar `js/memory/memory_extractor.js` (Caminho Lento assíncrono pós-TTS) e `js/memory/memory_consolidator.js` (Motor do Sono com expressão `SLEEPY`, Diário em 1ª pessoa, Reflexões, Sonhos, Ebbinghaus e backup Git silencioso).
6. **Etapa 6:** Conectar tudo em `js/pet_state.js`, `js/pet_brain.js`, `js/pet_audio.js`, `js/pet_tts.js`, `js/pet_physics.js` e `study_mode.js`, incluindo o atalho `Alt + P` para o Modo Privado (`COOL`).
7. **Etapa 7 (Teste de Fumaça):** Verificar se há erros de sintaxe (`node --check`) em todos os arquivos criados e alterados, confirmar que o Vault é gerado com sucesso no primeiro boot e que o Fast-Path executa em menos de $30\text{ ms}$.