const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Garante isolamento do BitBop em execução
app.setPath('userData', path.join(__dirname, '.export-user-data'));

const DESKTOP_DIR = path.join('C:', 'Users', 'alv-k', 'OneDrive', 'Desktop', 'BitBop_Animacoes_PNG');

const DIRS = {
  root: DESKTOP_DIR,
  emotions: path.join(DESKTOP_DIR, '01_Expressoes_Emocoes_Completas'),
  poses: path.join(DESKTOP_DIR, '02_Poses_Animacoes_Corporais'),
  oled: path.join(DESKTOP_DIR, '03_Telas_OLED_CloseUp'),
  skins: path.join(DESKTOP_DIR, '04_Variacoes_Skins_Carcacas'),
};

Object.values(DIRS).forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const EMOTIONS_LIST = [
  { id: '01_normal_padrao', emo: 'NORMAL', desc: 'Padrão neutro e curioso, olhar atento ciano' },
  { id: '02_feliz_happy', emo: 'HAPPY', desc: 'Feliz com olhos em arco, bochechas coradas e sorriso aberto' },
  { id: '03_empolgado_excited', emo: 'EXCITED', desc: 'Empolgado com olhos de estrelas brilhantes e sorriso radiante' },
  { id: '04_amor_love', emo: 'LOVE', desc: 'Apaixonado com olhos de coração rosa e bochechas avermelhadas' },
  { id: '05_triste_sad', emo: 'SAD', desc: 'Triste com sobrancelhas caídas e lágrimas azuis brilhantes' },
  { id: '06_bravo_angry', emo: 'ANGRY', desc: 'Bravo com olhos estreitados vermelhos e boca zangada' },
  { id: '07_surpreso_surprised', emo: 'SURPRISED', desc: 'Surpreso com olhos arregalados, pupilas dilatadas e boca em O' },
  { id: '08_curioso_curious', emo: 'CURIOUS', desc: 'Curioso com um olho maior que o outro e sobrancelha erguida', lookX: 8, lookY: -4 },
  { id: '09_gargalhada_laughing', emo: 'LAUGHING', desc: 'Gargalhando de alegria com olhos piscando > < e bochechas coradas' },
  { id: '10_tonto_dizzy', emo: 'DIZZY', desc: 'Tonto ou chacoalhado com espirais giratórias amarelas e boca em onda' },
  { id: '11_dormindo_sleepy', emo: 'SLEEPY', desc: 'Sonolento relaxado com arcos baixos roxos e boca serena' },
  { id: '12_ouvindo_listening', emo: 'LISTENING', desc: 'Ouvindo atenciosamente a sua voz (microfone ativo, olhos verdes)' },
  { id: '13_pensando_thinking', emo: 'THINKING', desc: 'Pensando e processando com os 3 pontinhos flutuando na tela' },
  { id: '14_estiloso_cool', emo: 'COOL', desc: 'Estiloso com óculos de sol tipo visor cyber e boca confiante' },
  { id: '15_fingir_morto_dead', emo: 'DEAD', desc: 'Truque dramático de fingir de morto com olhos X X vermelhos' },
];

const POSES_LIST = [
  {
    id: '01_danca_dos_pezinhos',
    name: 'Dança dos Pezinhos',
    config: {
      emotion: 'HAPPY',
      rigTransform: 'translateY(-6px) rotate(-6deg)',
      footLeft: 'translateY(-14px) rotate(22deg)',
      footRight: 'translateY(2px) rotate(-8deg)',
      particles: [{ text: '♪', x: 100, y: 90 }, { text: '♫', x: 380, y: 80 }]
    }
  },
  {
    id: '02_salto_pulo_elastico',
    name: 'Salto Elástico',
    config: {
      emotion: 'EXCITED',
      rigTransform: 'translateY(-28px) scale(0.92, 1.15)',
      footLeft: 'translateY(-8px) rotate(-22deg)',
      footRight: 'translateY(-8px) rotate(22deg)',
      particles: [{ text: '✨', x: 80, y: 110 }, { text: '✨', x: 410, y: 110 }]
    }
  },
  {
    id: '03_passo_moonwalk',
    name: 'Passo Moonwalk',
    config: {
      emotion: 'COOL',
      rigTransform: 'rotate(7deg) translateX(-12px)',
      footLeft: 'translateX(-14px) rotate(-24deg)',
      footRight: 'translateX(10px) rotate(14deg)',
      particles: [{ text: '🕶️', x: 390, y: 120 }]
    }
  },
  {
    id: '04_pirueta_acrobatica',
    name: 'Pirueta Acrobática 3D',
    config: {
      emotion: 'EXCITED',
      rigTransform: 'translateY(-18px) rotate(24deg) scale(0.96, 1.04)',
      footLeft: 'rotate(-25deg)',
      footRight: 'rotate(25deg)',
      particles: [{ text: '💫', x: 250, y: 40 }]
    }
  },
  {
    id: '05_agachado_timido',
    name: 'Agachadinho Tímido',
    config: {
      emotion: 'CURIOUS',
      rigTransform: 'translateY(14px) scale(1.18, 0.78)',
      footLeft: 'translateY(-4px) rotate(-15deg)',
      footRight: 'translateY(-4px) rotate(15deg)',
      particles: [{ text: '👀', x: 380, y: 140 }]
    }
  },
  {
    id: '06_comemoracao_epica',
    name: 'Comemoração Épica',
    config: {
      emotion: 'LAUGHING',
      rigTransform: 'translateY(-16px) scale(1.08, 1.05) rotate(4deg)',
      footLeft: 'translateY(-8px) rotate(-18deg)',
      footRight: 'translateY(-8px) rotate(18deg)',
      particles: [{ text: '🎉', x: 90, y: 70 }, { text: '⭐', x: 400, y: 60 }]
    }
  },
  {
    id: '07_carinho_cafune',
    name: 'Recebendo Carinho / Cafuné',
    config: {
      emotion: 'LOVE',
      rigTransform: 'translateY(4px) scale(1.06, 0.94)',
      footLeft: 'rotate(6deg)',
      footRight: 'rotate(-6deg)',
      particles: [{ text: '💖', x: 120, y: 80 }, { text: '💕', x: 370, y: 90 }]
    }
  },
];

const SKINS_LIST = [
  { id: 'skin_01_classic_branco', skin: 'classic', emo: 'HAPPY', name: 'Classic (Branco M5Stack)' },
  { id: 'skin_02_cyber_grafite', skin: 'cyber', emo: 'COOL', name: 'Cyber (Grafite Dark Mode)' },
  { id: 'skin_03_sakura_rosa', skin: 'sakura', emo: 'LOVE', name: 'Sakura (Rosa Pastel)' },
  { id: 'skin_04_mint_menta', skin: 'mint', emo: 'LAUGHING', name: 'Mint (Verde Menta)' },
  { id: 'skin_05_m5yellow_amarelo', skin: 'm5yellow', emo: 'EXCITED', name: 'M5Yellow (Amarelo M5Core)' },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const rigHtmlPath = path.join(__dirname, 'export_rig.html');
  await win.loadFile(rigHtmlPath);
  await new Promise(r => setTimeout(r, 600));

  console.log('[EXPORT] Iniciando exportação de todas as imagens do BitBop...');

  // 1. Exporta as 15 expressões completas do robô
  for (const item of EMOTIONS_LIST) {
    await win.webContents.executeJavaScript(`
      window.applyPose({
        emotion: '${item.emo}',
        skin: 'classic',
        lookX: ${item.lookX || 0},
        lookY: ${item.lookY || 0}
      });
    `);
    await new Promise(r => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const dest = path.join(DIRS.emotions, `${item.id}.png`);
    fs.writeFileSync(dest, img.toPNG());
    console.log(`[EMOÇÃO] ${item.id}.png gravado.`);
  }

  // 2. Exporta as Poses / Animações Corporais
  for (const pose of POSES_LIST) {
    const cfgJson = JSON.stringify(pose.config);
    await win.webContents.executeJavaScript(`
      window.applyPose(${cfgJson});
    `);
    await new Promise(r => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const dest = path.join(DIRS.poses, `${pose.id}.png`);
    fs.writeFileSync(dest, img.toPNG());
    console.log(`[POSE] ${pose.id}.png gravado.`);
  }

  // 3. Exporta Telas OLED Close-up (320x240 ampliado)
  for (const item of EMOTIONS_LIST) {
    await win.webContents.executeJavaScript(`
      window.applyOledCloseUp('${item.emo}');
    `);
    await new Promise(r => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const dest = path.join(DIRS.oled, `oled_${item.id}.png`);
    fs.writeFileSync(dest, img.toPNG());
    console.log(`[OLED] oled_${item.id}.png gravado.`);
  }

  // 4. Exporta Variações de Skins / Carcaças
  for (const s of SKINS_LIST) {
    await win.webContents.executeJavaScript(`
      window.applyPose({
        emotion: '${s.emo}',
        skin: '${s.skin}'
      });
    `);
    await new Promise(r => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const dest = path.join(DIRS.skins, `${s.id}.png`);
    fs.writeFileSync(dest, img.toPNG());
    console.log(`[SKIN] ${s.id}.png gravado.`);
  }

  // 5. Criação da Spritesheet Geral Composta
  console.log('[SPRITESHEET] Montando a folha de sprites geral...');
  const itemsWithDataUri = EMOTIONS_LIST.map(it => {
    const p = path.join(DIRS.emotions, `${it.id}.png`);
    const b64 = fs.readFileSync(p).toString('base64');
    return {
      id: it.id,
      emo: it.emo,
      dataUri: `data:image/png;base64,${b64}`
    };
  });

  win.setSize(1280, 840);
  await win.webContents.executeJavaScript(`
    document.body.innerHTML = '';
    document.body.style.display = 'block';
    document.body.style.background = '#090d16';
    document.body.style.padding = '24px';
    document.body.style.fontFamily = 'Segoe UI, sans-serif';

    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.marginBottom = '20px';
    header.innerHTML = '<h1 style="color:#38bdf8;margin:0;font-size:28px;letter-spacing:1px;">🤖 BitBop Pet - Galeria de Expressões & Animações</h1><p style="color:#94a3b8;font-size:14px;margin-top:4px;">Catálogo oficial de renderização vetorial e display OLED</p>';
    document.body.appendChild(header);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
    grid.style.gap = '14px';
    grid.style.maxWidth = '1230px';
    grid.style.margin = '0 auto';
    document.body.appendChild(grid);

    const items = ${JSON.stringify(itemsWithDataUri)};
    items.forEach(it => {
      const card = document.createElement('div');
      card.style.background = 'rgba(15, 23, 42, 0.85)';
      card.style.border = '1px solid rgba(56, 189, 248, 0.28)';
      card.style.borderRadius = '14px';
      card.style.padding = '10px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.alignItems = 'center';

      const img = document.createElement('img');
      img.src = it.dataUri;
      img.style.width = '170px';
      img.style.height = '170px';
      img.style.objectFit = 'contain';

      const label = document.createElement('div');
      label.style.color = '#e2e8f0';
      label.style.fontWeight = 'bold';
      label.style.fontSize = '13px';
      label.style.marginTop = '6px';
      label.innerText = it.emo;

      const sub = document.createElement('div');
      sub.style.color = '#38bdf8';
      sub.style.fontSize = '10.5px';
      sub.style.marginTop = '2px';
      sub.innerText = it.id.replace(/^[0-9]+_/, '').replace('_', ' ').toUpperCase();

      card.appendChild(img);
      card.appendChild(label);
      card.appendChild(sub);
      grid.appendChild(card);
    });
  `);

  await new Promise(r => setTimeout(r, 800));
  const sheetImg = await win.webContents.capturePage();
  const sheetDest = path.join(DESKTOP_DIR, 'BitBop_Spritesheet_Geral.png');
  fs.writeFileSync(sheetDest, sheetImg.toPNG());
  console.log('[SPRITESHEET] BitBop_Spritesheet_Geral.png gravado.');

  // 6. Criação do arquivo LEIA-ME explicativo
  const readmeContent = `======================================================================
  🤖 BITBOP PET - CATÁLOGO COMPLETO DE IMAGENS E ANIMAÇÕES
======================================================================

Todas as imagens foram geradas a partir do motor de renderização do BitBop
com alta definição (512x512 pixels), formato PNG e canal Alpha transparente.

PASTAS INCLUÍDAS:
----------------------------------------------------------------------
📁 01_Expressoes_Emocoes_Completas (15 imagens):
   O robô BitBop completo (chassi M5Stack, tela OLED, expressões faciais,
   bochechas luminosas e pezinhos articulados) em cada uma das emoções:
   - 01_normal_padrao.png   : Olhar neutro, atento e fofo (Ciano)
   - 02_feliz_happy.png      : Olhos em arco, bochechas coradas e sorriso
   - 03_empolgado_excited.png: Olhos de estrela brilhante e boca aberta
   - 04_amor_love.png        : Olhos em coração rosa com bochechas brilhantes
   - 05_triste_sad.png       : Sobrancelhas caídas e lágrimas azuis
   - 06_bravo_angry.png      : Olhos vermelhos zangados e boca em zigue-zague
   - 07_surpreso_surprised.png: Olhos arregalados e boca em O
   - 08_curioso_curious.png  : Olhar inquisitivo e sobrancelha levantada
   - 09_gargalhada_laughing.png: Olhos fechados > < e risada aberta
   - 10_tonto_dizzy.png      : Espirais amarelas nos olhos e boca em ondas
   - 11_dormindo_sleepy.png  : Arcos baixos roxos e boca serena
   - 12_ouvindo_listening.png: Microfone ativo e olhar receptivo verde
   - 13_pensando_thinking.png: Pontinhos flutuantes de processamento
   - 14_estiloso_cool.png    : Óculos de sol visor cyber e boca confiante
   - 15_fingir_morto_dead.png: Olhos em X X vermelhos de truque cômico

📁 02_Poses_Animacoes_Corporais (7 imagens):
   Capturas dinâmicas das coreografias e animações de física do BitBop:
   - 01_danca_dos_pezinhos.png : Dança com pezinhos alternados e notas musicais
   - 02_salto_pulo_elastico.png : Pulo elástico no ar com squash & stretch
   - 03_passo_moonwalk.png     : Deslizamento lateral clássico tipo moonwalk
   - 04_pirueta_acrobatica.png : Giro acrobático no ar em 3D
   - 05_agachado_timido.png    : Postura compacta agachada
   - 06_comemoracao_epica.png  : Salto com confetes e comemoração
   - 07_carinho_cafune.png     : Reação sensível ao carinho na cabeça

📁 03_Telas_OLED_CloseUp (15 imagens):
   Close-ups em alta resolução focados exclusivamente na tela OLED
   com o brilho característico neon e scanlines. Ideais para emojis e avatares!

📁 04_Variacoes_Skins_Carcacas (5 imagens):
   As diferentes carcaças que o BitBop pode vestir:
   - skin_01_classic_branco.png  : Branco e Prata (Original M5Stack)
   - skin_02_cyber_grafite.png   : Grafite Dark Mode com detalhes cyber
   - skin_03_sakura_rosa.png     : Rosa Sakura suave
   - skin_04_mint_menta.png      : Verde Menta refrescante
   - skin_05_m5yellow_amarelo.png: Amarelo M5Core vibrante

🖼️ BitBop_Spritesheet_Geral.png:
   Painel resumo elegante com todas as principais emoções organizadas lado a lado.

======================================================================
Exportado com sucesso para a sua Área de Trabalho!
`;

  fs.writeFileSync(path.join(DESKTOP_DIR, 'LEIA-ME_Catalogo_Animacoes.txt'), readmeContent, 'utf8');
  console.log('[CONCLUÍDO] Todos os 43 arquivos exportados com sucesso para a Área de Trabalho!');

  app.quit();
});
