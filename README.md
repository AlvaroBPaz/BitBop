# 🤖 BitBop — Stack-Chan Desktop Companion Pet (BETA)

> **Seu companheiro de mesa com IA multimodal, biometria vocal CAM++, cérebro cognitivo integrado ao Obsidian e zero latência perceptível.**

BitBop é um mascote de mesa autônomo (*Desktop Pet*) inspirado no projeto Stack-Chan japonês, construído sobre Electron, Node.js e Web Audio API. Ele combina síntese de voz neural ultra-rápida, biometria vocal para reconhecimento de dono, observação pró-ativa de múltiplas telas e um segundo cérebro cognitivo no Obsidian.

---

## ✨ Principais Funcionalidades

- **🎭 Expressões & Física Desktop:** 13 estados emocionais procedurais renderizados em Canvas 2D a 60 FPS, física vetorial de gravidade, pulos, arrasto de mouse, carinho (*purr*) e caminhada livre entre múltiplos monitores.
- **🎙️ Audição Contínua & Biometria Vocal (CAM++):** Detecção de voz (VAD) via `AudioWorklet` e extração local de embeddings de voz de 192 dimensões com `sherpa-onnx` (~30ms), reconhecendo o dono e ignorando terceiros.
- **⚡ Zero-Gap Neural Audio:** Pipeline de áudio com streaming de sentenças e pré-carregamento de áudio em RAM (`prefetchSentenceAudio`), permitindo fala natural sem pausas robóticas entre frases (0ms de gap).
- **🧠 Cérebro Multimodal com Fail-Fast (3.5s):** Cascata inteligente de 4 níveis:
  1. *Google Gemini 3.1 Flash-Lite* (primário com `thinkingBudget: 0`)
  2. *Google Gemini 3.5 Flash-Lite* (secundário)
  3. *Groq Cloud LPU* (~250-400ms contingência ultra-rápida com disjuntor de cota)
  4. *Ollama Local Qwen3-VL* (100% offline)
- **📚 Arquitetura Cognitiva de 4 Partes (Obsidian Vault):**
  1. *Hipocampo em Tempo Real (`hippocampus_logger.js`)* gravando conversas em `05_Diario/AAAA-MM-DD.md`.
  2. *Catálogo Mental do Vault (`brain_catalog.js`)* com indexação em RAM das 9 pastas canônicas.
  3. *Navegador Subconsciente (`subconscious_navigator.js`)* gerando dossiês de memória em < 20ms.
  4. *Travessia de Grafo e Auto-Linking* de wikilinks `[[Nota]]`.
- **📅 Agendamento Híbrido Google Agenda:** Tool Calling determinístico forçado (`mode: 'ANY'`) aliado a parser semântico de linguagem natural integrado via Google Apps Script Webhook.
- **🖥️ Observador Multi-Telas Anti-Spam:** Monitoramento contínuo de janelas com deduplicação semântica baseada em assunto (`commentedSubjects`), evitando comentários repetidos ao alternar de tela.

---

## 🚀 Como Executar

### Pré-requisitos
- [Node.js](https://nodejs.org/) v20+ ou v24+
- [Python](https://www.python.org/) 3.10+ (para o servidor TTS `tts_server.py`)
- Chave de API da Google Gemini e/ou Groq Cloud

### Instalação

1. Clone o repositório:
```bash
git clone https://github.com/AlvaroBPaz/BitBop.git
cd BitBop
```

2. Instale as dependências Node.js:
```bash
npm install
```

3. Instale as dependências Python para o servidor de áudio TTS:
```bash
pip install edge-tts aiohttp
```

4. Configure as chaves de API:
Copie `.gemini-config.example.json` para `.gemini-config.json` e preencha suas chaves:
```json
{
  "geminiApiKey": "SUA_CHAVE_GEMINI",
  "groqApiKey": "SUA_CHAVE_GROQ"
}
```

5. Inicie o BitBop:
- Execute `start_bitbop.bat` ou no terminal:
```bash
npm start
```

---

## 📖 Documentação Completa

Para a especificação técnica exaustiva de cada módulo, consulte:
- [📘 MANUAL_COMPLETO_BITBOP.md](MANUAL_COMPLETO_BITBOP.md)

---

## 👤 Autor

Desenvolvido por **Álvaro Matheus** ([@AlvaroBPaz](https://github.com/AlvaroBPaz)).
