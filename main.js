
let toggleSafeDevTools = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  } else {
    // IMPORTANTE: Abre DevTools EXCLUSIVAMENTE desacoplado (mode: 'detach').
    // NUNCA acoplado (docked) dentro de janela transparente 'screen-saver',
    // evitando travamento de clique em todo o desktop do Windows.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  desktopCapturer,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

app.setPath('userData', path.join(__dirname, '.user-data'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const LOG_FILE = path.join(__dirname, 'pet-debug.log');

function writeLog(tag, msg) {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  writeLog('MAIN', 'Atalho acionado; outra instância já está aberta. Ativando a janela existente.');
  app.quit();
  process.exit(0);
}

writeLog('MAIN', `=== BitBop Interactive Companion v2 Iniciado em ${new Date().toISOString()} ===`);

app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
  writeLog('MAIN', 'Segunda instância invocada via atalho; trazendo BitBop para frente.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.webContents.send('tray-action', 'summon');
  }
});

process.on('uncaughtException', (err) => {
  writeLog('CRASH_UNCAUGHT', err ? (err.stack || err.message) : 'Unknown uncaught');
});
process.on('unhandledRejection', (reason) => {
  writeLog('CRASH_REJECTION', reason ? (reason.stack || reason.message || String(reason)) : 'Unknown rejection');
});
app.on('will-quit', () => writeLog('APP', 'will-quit'));
app.on('quit', (e, code) => writeLog('APP', `quit code: ${code}`));

let mainWindow = null;
let tray = null;
const childProcesses = [];
let watchdogInterval = null;
let isShuttingDown = false;
let latestDesktopState = {
  activeTitle: '',
  activeApp: '',
  openWindows: [],
  windows: [],
  ledges: [],
};

function computeMultiMonitorStage() {
  const allDisplays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const sorted = [...allDisplays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of sorted) {
    const wa = d.workArea;
    if (wa.x < minX) minX = wa.x;
    if (wa.y < minY) minY = wa.y;
    if (wa.x + wa.width > maxX) maxX = wa.x + wa.width;
    if (wa.y + wa.height > maxY) maxY = wa.y + wa.height;
  }

  const stageBounds = {
    x: minX,
    y: minY,
    width: Math.max(800, maxX - minX),
    height: Math.max(600, maxY - minY),
  };

  const displays = sorted.map((d, idx) => {
    const isPrimary = d.id === primaryId;
    const posHint = sorted.length > 1
      ? (idx === 0 ? 'Esquerda' : idx === sorted.length - 1 ? 'Direita' : `Centro ${idx + 1}`)
      : 'Única';
    return {
      id: d.id,
      index: idx + 1,
      label: `Tela ${idx + 1} (${posHint}${isPrimary ? ' - Principal' : ''})`,
      isPrimary,
      bounds: d.bounds,
      workArea: d.workArea,
      // Coordenadas relativas ao palco unificado (stageBounds)
      x: d.workArea.x - stageBounds.x,
      y: d.workArea.y - stageBounds.y,
      w: d.workArea.width,
      h: d.workArea.height,
      floorY: (d.workArea.y - stageBounds.y) + d.workArea.height,
    };
  });

  return { stageBounds, displays };
}

function checkHttpAlive(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHttp(url, maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkHttpAlive(url)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function loadSavedAiConfig() {
  try {
    const p = path.join(__dirname, '.gemini-config.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return { aiProvider: 'local' };
}

function warmUpOllamaGpu() {
  const cfg = loadSavedAiConfig();
  if (cfg.aiProvider === 'gemini' && cfg.geminiApiKey) {
    writeLog('AI', `Usando Google Gemini (${cfg.geminiModel || 'gemini-3.1-flash-lite'}) como cérebro principal — poupando VRAM do Ollama.`);
    return;
  }
  const payload = JSON.stringify({
    model: 'qwen3-vl:2b-instruct',
    keep_alive: '60m',
    options: { num_ctx: 2048, num_predict: 1 },
    messages: [{ role: 'user', content: 'oi' }],
    stream: false,
  });

  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      writeLog('OLLAMA', `Warmup GPU (qwen3-vl:2b-instruct) HTTP ${res.statusCode}`);
      res.resume();
    }
  );
  req.on('error', (e) => writeLog('OLLAMA', `Warmup erro: ${e.message}`));
  req.write(payload);
  req.end();
}

function startOllamaProcess() {
  const ollamaExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  try {
    const proc = spawn(ollamaExe, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OLLAMA_ORIGINS: '*' },
    });
    proc.unref();
    writeLog('OLLAMA', 'Processo ollama serve iniciado.');
  } catch (err) {
    writeLog('OLLAMA', `Erro ao iniciar Ollama: ${err.message}`);
  }
}

let activeWhisperProc = null;
let activeWhisperMode = null;

function stopWhisperProcess() {
  if (activeWhisperProc && !activeWhisperProc.killed) {
    try {
      activeWhisperProc.kill();
      writeLog('WHISPER', `whisper-server encerrado (PID ${activeWhisperProc.pid}) — VRAM liberada.`);
    } catch {}
  }
  activeWhisperProc = null;
  activeWhisperMode = null;
}

function startWhisperProcess(mode = 'whisper-turbo') {
  stopWhisperProcess();

  const whisperDir = 'C:\\Stack-Chan\\whisper';
  const cudaExe = path.join(whisperDir, 'Release-CUDA', 'Release', 'whisper-server.exe');
  const cpuExe = path.join(whisperDir, 'Release', 'whisper-server.exe');
  const useCuda = fs.existsSync(cudaExe);
  const whisperExe = useCuda ? cudaExe : cpuExe;
  const whisperCwd = path.dirname(whisperExe);

  const turboPath = path.join(whisperDir, 'ggml-large-v3-turbo-q5_0.bin');
  const smallPath = path.join(whisperDir, 'ggml-small-q5_1.bin');
  const wantTurbo = mode !== 'whisper-small' && fs.existsSync(turboPath);
  const modelPath = wantTurbo ? turboPath : smallPath;
  const vadModelPath = path.join(whisperDir, 'ggml-silero-v5.1.2.bin');

  const ollamaCudaDir = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'Ollama',
    'lib',
    'ollama',
    'cuda_v12'
  );

  const args = [
    '-m', modelPath,
    '-t', useCuda ? '4' : '8',
    '-l', 'pt',
    '-ac', '0',
    '-bo', useCuda ? '5' : '1',
    '-bs', useCuda ? '5' : '1',
    '-nt',
    '-sns',
    ...(useCuda ? ['-fa'] : []),
    '--vad',
    '-vm', vadModelPath,
    '-vt', '0.26',
    '-vp', '220',
    '-vmsd', '6.0',
    '--prompt', 'E aí BitBop, consegue me ouvir direitinho? Conversa natural em português brasileiro sobre a área de trabalho, Arena Breakout, jogos, vídeos e aplicativos.',
    '--port', '8085',
  ];

  try {
    const whisperProc = spawn(whisperExe, args, {
      cwd: whisperCwd,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${ollamaCudaDir};${process.env.PATH || ''}`,
      },
    });
    activeWhisperProc = whisperProc;
    activeWhisperMode = wantTurbo ? 'whisper-turbo' : 'whisper-small';
    childProcesses.push(whisperProc);
    writeLog('WHISPER', `whisper-server iniciado (${wantTurbo ? 'Large-v3-Turbo' : 'Small'} | ${useCuda ? 'GPU CUDA 12.4 + Beam 5' : 'CPU'}, PID ${whisperProc.pid})`);
  } catch (err) {
    writeLog('WHISPER', `Erro ao iniciar Whisper Server: ${err.message}`);
  }
}

function startTtsProcess() {
  const pythonExe = 'C:\\Python315\\python.exe';
  const ttsScript = path.join(__dirname, 'tts_server.py');

  try {
    const ttsProc = spawn(pythonExe, [ttsScript], {
      cwd: __dirname,
      stdio: 'ignore',
      windowsHide: true,
    });
    childProcesses.push(ttsProc);
    writeLog('TTS', `tts_server.py iniciado (PID ${ttsProc.pid})`);
  } catch (err) {
    writeLog('TTS', `Erro ao iniciar TTS Server: ${err.message}`);
  }
}

function startDesktopTracker() {
  const trackerScript = path.join(__dirname, 'desktop_tracker.ps1');
  if (!fs.existsSync(trackerScript)) return;

  try {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', trackerScript],
      {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }
    );
    childProcesses.push(proc);
    writeLog('TRACKER', `desktop_tracker iniciado (PID ${proc.pid})`);

    let lineBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      lineBuf += chunk;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const { stageBounds, displays } = computeMultiMonitorStage();

          const findScreenForX = (stageX) => {
            const found = displays.find((d) => stageX >= d.x && stageX < d.x + d.w);
            return found || displays[0];
          };

          const adjustedLedges = (parsed.ledges || []).map((l) => {
            const sx = l.x - stageBounds.x;
            const sy = l.y - stageBounds.y;
            const scr = findScreenForX(sx + l.w / 2);
            return {
              hwnd: l.hwnd,
              title: l.title,
              app: l.app || '',
              x: sx,
              y: sy,
              w: l.w,
              screenIndex: scr ? scr.index : 1,
              screenLabel: scr ? scr.label : 'Tela 1',
            };
          });

          const adjustedWindows = (parsed.windows || []).map((w) => {
            const sx = w.x - stageBounds.x;
            const sy = w.y - stageBounds.y;
            const scr = findScreenForX(sx + w.w / 2);
            return {
              hwnd: w.hwnd,
              title: w.title,
              app: w.app || '',
              x: sx,
              y: sy,
              w: w.w,
              h: w.h,
              zoomed: Boolean(w.zoomed),
              screenIndex: scr ? scr.index : 1,
              screenLabel: scr ? scr.label : 'Tela 1',
            };
          });

          latestDesktopState = {
            activeTitle: parsed.activeTitle || '',
            activeApp: parsed.activeApp || '',
            openWindows: parsed.openWindows || [],
            windows: adjustedWindows,
            ledges: adjustedLedges,
          };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('desktop-state', latestDesktopState);
          }
        } catch {}
      }
    });
  } catch (err) {
    writeLog('TRACKER', `Erro ao iniciar tracker: ${err.message}`);
  }
}

let ensuringServices = false;
let servicesPreviouslyReady = false;

async function ensureBackendServices(sendStatus) {
  if (ensuringServices || isShuttingDown) return;
  ensuringServices = true;

  try {
    const aiCfg = loadSavedAiConfig();
    const usingGemini = aiCfg.aiProvider === 'gemini' && Boolean(aiCfg.geminiApiKey);
    const hasGroq = Boolean(aiCfg.groqApiKey);
    let sttMode = aiCfg.sttMode || (hasGroq ? 'groq-whisper-v3' : 'gemini-audio');
    if (sttMode === 'gemini-audio' && !usingGemini) sttMode = hasGroq ? 'groq-whisper-v3' : 'whisper-turbo';
    if (sttMode.startsWith('groq-') && !hasGroq) sttMode = usingGemini ? 'gemini-audio' : 'whisper-turbo';
    const isCloudStt = sttMode === 'gemini-audio' || sttMode.startsWith('groq-');
    const needsLocalWhisper = !isCloudStt;

    if (!usingGemini) {
      if (!(await checkHttpAlive('http://127.0.0.1:11434/api/tags'))) {
        if (sendStatus) sendStatus('Iniciando cérebro visual na GPU...');
        startOllamaProcess();
        await waitForHttp('http://127.0.0.1:11434/api/tags', 12000);
        warmUpOllamaGpu();
      } else if (sendStatus) {
        warmUpOllamaGpu();
      }
    } else if (sendStatus) {
      writeLog('AI', `Provedor ativo: Google Gemini (${aiCfg.geminiModel || 'gemini-3.1-flash-lite'}) | Audição: ${sttMode}`);
    }

    if (needsLocalWhisper) {
      const whisperAlive = await checkHttpAlive('http://127.0.0.1:8085/');
      if (!whisperAlive || (activeWhisperMode && activeWhisperMode !== sttMode)) {
        servicesPreviouslyReady = false;
        if (sendStatus) sendStatus(`Ativando ${sttMode === 'whisper-turbo' ? 'Whisper Large-v3-Turbo' : 'Whisper'} na GPU...`);
        startWhisperProcess(sttMode);
      }
    } else if (activeWhisperProc) {
      stopWhisperProcess();
    }

    if (!(await checkHttpAlive('http://127.0.0.1:8086/health'))) {
      servicesPreviouslyReady = false;
      if (sendStatus) sendStatus('Conectando voz neural PT-BR...');
      startTtsProcess();
    }

    const [ollamaOk, whisperOk, ttsOk] = await Promise.all([
      usingGemini ? checkHttpAlive('http://127.0.0.1:11434/api/tags', 500) : waitForHttp('http://127.0.0.1:11434/api/tags', 12000),
      needsLocalWhisper ? waitForHttp('http://127.0.0.1:8085/', 22000) : Promise.resolve(true),
      waitForHttp('http://127.0.0.1:8086/health', 14000),
    ]);

    const allCoreOk = ttsOk && (!needsLocalWhisper || whisperOk) && (usingGemini || ollamaOk);
    if (!servicesPreviouslyReady && allCoreOk) {
      servicesPreviouslyReady = true;
      writeLog('SERVICES', `Pronto -> gemini=${usingGemini}, stt=${sttMode}, whisper=${whisperOk}, tts=${ttsOk}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('services-ready', { gemini: usingGemini, sttMode, ollamaOk, whisperOk, ttsOk });
      }
    }
  } finally {
    ensuringServices = false;
  }
}

function setupLocalhostCorsBypass() {
  const localFilter = {
    urls: ['http://127.0.0.1:*/*', 'http://localhost:*/*'],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(localFilter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    delete headers['Origin'];
    delete headers['origin'];
    callback({ requestHeaders: headers });
  });

  session.defaultSession.webRequest.onHeadersReceived(localFilter, (details, callback) => {
    const responseHeaders = { ...(details.responseHeaders || {}) };
    delete responseHeaders['access-control-allow-origin'];
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Headers'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    callback({ responseHeaders });
  });
}

function createTrayIcon() {
  // Ícone 16x16 fofo do Stack-chan gerado em memória (fundo escuro + olhinhos ciano)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const border = x === 0 || x === 15 || y === 0 || y === 15;
      const leftEye = x >= 3 && x <= 5 && y >= 5 && y <= 8;
      const rightEye = x >= 10 && x <= 12 && y >= 5 && y <= 8;
      const smile = x >= 6 && x <= 9 && y === 11;
      if (leftEye || rightEye || smile) {
        buf[idx] = 255;     // B
        buf[idx + 1] = 240; // G
        buf[idx + 2] = 0;   // R (Cyan!)
        buf[idx + 3] = 255; // A
      } else if (border) {
        buf[idx] = 220;
        buf[idx + 1] = 210;
        buf[idx + 2] = 200;
        buf[idx + 3] = 255;
      } else {
        buf[idx] = 42;
        buf[idx + 1] = 23;
        buf[idx + 2] = 15;
        buf[idx + 3] = 255;
      }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  tray = new Tray(img);
  tray.setToolTip('BitBop Pet Companion');

  const menu = Menu.buildFromTemplate([
    {
      label: '📍 Chamar BitBop para o Cursor / Tela Principal',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'summon'),
    },
    {
      label: '🗺️ Passear para a Outra Tela',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'switch-screen'),
    },
    {
      label: '👀 Perguntar o que há nas Telas',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'look-screen'),
    },
    {
      label: '⚙️ Abrir Configurações',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'open-settings'),
    },
    {
      label: '🎤 Pausar / Ativar Microfone',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-mic'),
    },
    {
      label: '💬 Alternar Balão de Diálogo',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-bubble'),
    },
    {
      label: '🔊 Alternar Voz Falada (Mudo/Som)',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-voice'),
    },
    {
      label: '📚 Alternar Perfil de Estudo (Study Mode) [Alt+S]',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-study-mode'),
    },
    {
      label: '🎧 Alternar Modo Ouvinte (Só Observar) [Alt+O]',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-listener-mode'),
    },
    {
      label: '💤 Fazer o BitBop Dormir Agora (Consolidar Memórias)',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'sleep-consolidate'),
    },
    {
      label: '🕶️ Alternar Modo Privado [Alt+P]',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-private-mode'),
    },
    {
      label: '🔧 Abrir Console / DevTools (Janela Separada Segura)',
      click: () => toggleSafeDevTools(),
    },
    {
      label: '🎭 Alternar Ações & Truques Aleatórios (Silencioso)',
      click: () => mainWindow && mainWindow.webContents.send('tray-action', 'toggle-silent-dance'),
    },
    { type: 'separator' },
    {
      label: '✕ Fechar BitBop',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tray-action', 'summon');
    }
  });
}

function syncStageWithDisplays() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const topo = computeMultiMonitorStage();
  mainWindow.setBounds(topo.stageBounds);
  mainWindow.webContents.send('stage-topology', topo);
  writeLog('STAGE', `Palco Multi-Telas sincronizado: ${JSON.stringify(topo.stageBounds)} | Telas=${topo.displays.length} | RealBounds=${JSON.stringify(mainWindow.getBounds())}`);
}

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  setupLocalhostCorsBypass();

  const initialTopo = computeMultiMonitorStage();
  const sb = initialTopo.stageBounds;

  mainWindow = new BrowserWindow({
    x: sb.x,
    y: sb.y,
    width: sb.width,
    height: sb.height,
    enableLargerThanScreen: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setBounds(sb);
  // Mantém sempre acima de janelas normais sem bloquear cliques fora do robô!
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.webContents.on('console-message', (_event, level, message, line) => {
    writeLog(`RENDERER:${level}`, `${message} (L${line})`);
  });

  mainWindow.loadFile(path.join(__dirname, 'pet.html'));

  // Intercepta Ctrl+Shift+I e F12 para abrir DevTools em janela separada e segura
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      toggleSafeDevTools();
    } else if (input.key === 'F12') {
      event.preventDefault();
      toggleSafeDevTools();
    }
  });

  mainWindow.webContents.on('devtools-opened', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  mainWindow.webContents.on('devtools-closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    syncStageWithDisplays();
    startDesktopTracker();
    ensureBackendServices((msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('services-loading', msg);
      }
    });
  });

  screen.on('display-metrics-changed', syncStageWithDisplays);
  screen.on('display-added', syncStageWithDisplays);
  screen.on('display-removed', syncStageWithDisplays);

  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = setInterval(() => {
    if (!isShuttingDown) {
      ensureBackendServices(null);
    }
  }, 8000);

  createTrayIcon();

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeLog('RENDER_GONE', JSON.stringify(details));
  });
  mainWindow.on('close', () => {
    writeLog('WINDOW', 'mainWindow event close');
  });
  mainWindow.on('closed', () => {
    writeLog('WINDOW', 'mainWindow event closed');
    mainWindow = null;
  });
}

// Alterna clique-através vs interativo quando o mouse passa sobre o Stack-chan ou o painel ⚙️
ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

// Troca ao vivo entre Groq LPU (0 MB VRAM), Áudio Nativo Gemini (0 MB VRAM) e Whisper GPU Local
ipcMain.handle('switch-stt-mode', async (_event, requestedMode) => {
  const modeStr = String(requestedMode || '');
  if (modeStr === 'gemini-audio' || modeStr.startsWith('groq-')) {
    stopWhisperProcess();
    return { ok: true, mode: modeStr };
  }
  const target = modeStr === 'whisper-small' ? 'whisper-small' : 'whisper-turbo';
  const alive = await checkHttpAlive('http://127.0.0.1:8085/');
  if (!alive || activeWhisperMode !== target) {
    startWhisperProcess(target);
    const ok = await waitForHttp('http://127.0.0.1:8085/', 22000);
    return { ok, mode: target };
  }
  return { ok: true, mode: target };
});

// Captura multi-telas + recorte de proximidade ao redor do Stack-chan!
ipcMain.handle('capture-desktop', async (_event, opts = {}) => {
  try {
    const mode = opts.mode || 'all'; // 'all' | 'around-pet'
    const w = opts.width || 960;
    const h = opts.height || 540;
    const q = opts.quality || 78;

    const { stageBounds, displays } = computeMultiMonitorStage();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h },
    });

    if (!sources || sources.length === 0) {
      return { base64Jpeg: null, screens: [], cropBase64Jpeg: null, ...latestDesktopState };
    }

    // Associa cada source do desktopCapturer ao seu monitor físico (ordenado da esquerda p/ direita)
    const mappedScreens = displays.map((disp, idx) => {
      let src = sources.find((s) => String(s.display_id) === String(disp.id));
      if (!src) src = sources[idx] || sources[0];
      return { disp, src };
    });

    if (mode === 'around-pet' && typeof opts.petX === 'number' && typeof opts.petY === 'number') {
      const targetEntry =
        mappedScreens.find(({ disp }) => opts.petX >= disp.x && opts.petX < disp.x + disp.w) ||
        mappedScreens[0];
      const { disp, src } = targetEntry;
      const fullJpeg = src.thumbnail.toJPEG(q).toString('base64');

      // Recorta um zoom 480x320 bem ao redor de onde o Stack-chan está pisando!
      let cropBase64Jpeg = null;
      try {
        const tSize = src.thumbnail.getSize();
        const absPetX = stageBounds.x + opts.petX;
        const absPetY = stageBounds.y + opts.petY;
        const relX = Math.max(0, Math.min(1, (absPetX - disp.bounds.x) / Math.max(1, disp.bounds.width)));
        const relY = Math.max(0, Math.min(1, (absPetY - disp.bounds.y) / Math.max(1, disp.bounds.height)));
        const cropW = Math.min(tSize.width, 480);
        const cropH = Math.min(tSize.height, 320);
        const cx = Math.max(0, Math.min(tSize.width - cropW, Math.round(relX * tSize.width - cropW / 2)));
        const cy = Math.max(0, Math.min(tSize.height - cropH, Math.round(relY * tSize.height - cropH * 0.65)));
        const cropped = src.thumbnail.crop({ x: cx, y: cy, width: cropW, height: cropH });
        cropBase64Jpeg = cropped.toJPEG(82).toString('base64');
      } catch {}

      return {
        base64Jpeg: fullJpeg,
        cropBase64Jpeg,
        petScreenLabel: disp.label,
        screens: [{ index: disp.index, label: disp.label, isPrimary: disp.isPrimary, base64Jpeg: fullJpeg }],
        ...latestDesktopState,
      };
    }

    // Modo 'all': envia TODAS as telas do PC para o Gemini enxergar cada monitor!
    const screensOut = mappedScreens.map(({ disp, src }) => ({
      index: disp.index,
      label: disp.label,
      isPrimary: disp.isPrimary,
      base64Jpeg: src.thumbnail.toJPEG(q).toString('base64'),
    }));

    const primaryEntry = screensOut.find((s) => s.isPrimary) || screensOut[0];
    return {
      base64Jpeg: primaryEntry ? primaryEntry.base64Jpeg : null,
      screens: screensOut,
      cropBase64Jpeg: null,
      ...latestDesktopState,
    };
  } catch (err) {
    writeLog('VISION', `Erro na captura de tela: ${err.message}`);
    return { base64Jpeg: null, screens: [], cropBase64Jpeg: null, ...latestDesktopState };
  }
});

ipcMain.on('window-close', () => {
  app.quit();
});

function cleanupChildren() {
  isShuttingDown = true;
  try {
    globalShortcut.unregisterAll();
  } catch {}
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (tray) {
    try { tray.destroy(); } catch {}
    tray = null;
  }
  for (const proc of childProcesses) {
    try {
      if (proc && !proc.killed) {
        proc.kill();
      }
    } catch {}
  }
}

app.on('before-quit', cleanupChildren);
app.whenReady().then(() => {
  createWindow();
  try {
    globalShortcut.register('Alt+S', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'toggle-study-mode');
      }
    });
    globalShortcut.register('Alt+O', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'toggle-listener-mode');
      }
    });
    globalShortcut.register('Alt+P', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'toggle-private-mode');
      }
    });
    // Atalho global de emergência para destravar o mouse caso haja qualquer anomalia
    globalShortcut.register('CommandOrControl+Alt+Shift+Escape', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    });
    writeLog('SHORTCUT', 'Atalhos globais Alt+S, Alt+O e Alt+P registrados.');
  } catch (err) {
    writeLog('SHORTCUT', `Erro ao registrar atalho Alt+S: ${err.message}`);
  }
});
app.on('window-all-closed', () => {
  cleanupChildren();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
