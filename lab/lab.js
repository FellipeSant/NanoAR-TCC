// Laboratório NanoAR — protótipo (a Fase 0, de viabilidade, foi concluída).
// Mede, em qualquer celular: visão no VR Box (estéreo + lentes), cabeça pelo giroscópio,
// realidade mista (câmera) ou sala virtual, mãos pela câmera, olhar e voz.
import * as THREE from 'three';
import { HeadTracker } from './head.js';
import { StereoView, DEFAULT_LENS } from './stereo.js';
import { HandTracker } from './hands.js';
import { CanvasPanel, makeButton, Gaze, roundRect, font, findSelectable } from './ui3d.js';
import { Voice, voiceSupported } from './voice.js';
import { Chem, RADIUS, BOND_LEN } from './chem.js';
import { loadElements, PeriodicTable, elementLines } from './ptable.js';
import { AtomView } from './atomview.js';
import { loadIsotopes, initialState, describe, change, ionName } from './ions.js';

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');

// reserva, caso lab/data/elements.json não carregue (a tabela completa vem do arquivo de dados)
const ELEMENTS = [
  // valence = nº de ligações que faz; ve = elétrons na camada de valência
  { sym: 'H', name: 'Hidrogênio', z: 1, n: 0, valence: 1, ve: 1, color: '#f2f2f2', words: ['hidrogenio'] },
  { sym: 'C', name: 'Carbono', z: 6, n: 6, valence: 4, ve: 4, color: '#5a5a5a', words: ['carbono'] },
  { sym: 'N', name: 'Nitrogênio', z: 7, n: 7, valence: 3, ve: 5, color: '#3a5cf8', words: ['nitrogenio'] },
  { sym: 'O', name: 'Oxigênio', z: 8, n: 8, valence: 2, ve: 6, color: '#ff2a2a', words: ['oxigenio'] },
];

// ------------------------------------------------------------ preferências (salvas no aparelho)
const KEY = 'nanoar-lab';
const camOk = !!navigator.mediaDevices?.getUserMedia;
const settings = Object.assign(
  { env: camOk ? 'mr' : 'vr', view: 'box', hands: camOk, handsProc: 'auto', gaze: true, voice: false, lens: { ...DEFAULT_LENS } },
  (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  })(),
);
settings.lens = { ...DEFAULT_LENS, ...settings.lens };
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* navegação privada */
  }
};

// ------------------------------------------------------------ menu
const form = $('menu-form');
function syncMenu() {
  form.env.value = settings.env;
  form.view.value = settings.view;
  $('opt-hands').checked = settings.hands;
  $('opt-gaze').checked = settings.gaze;
  $('opt-voice').checked = settings.voice && voiceSupported;
  $('opt-hands-proc').value = settings.handsProc;
  for (const input of form.querySelectorAll('[data-lens]')) {
    input.value = settings.lens[input.dataset.lens];
    input.nextElementSibling.textContent = Number(input.value).toFixed(2);
  }
}
if (!camOk) {
  for (const el of [form.querySelector('[value="mr"]'), $('opt-hands')]) el.disabled = true;
  msg('Este navegador não dá acesso à câmera: só a sala virtual e o olhar.');
}
if (!voiceSupported) {
  $('opt-voice').disabled = true;
  $('voice-note').textContent = 'indisponível neste navegador';
}
form.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'env' || t.name === 'view') settings[t.name] = t.value;
  if (t.id === 'opt-hands') settings.hands = t.checked;
  if (t.id === 'opt-gaze') settings.gaze = t.checked;
  if (t.id === 'opt-voice') settings.voice = t.checked;
  if (t.id === 'opt-hands-proc') settings.handsProc = t.value;
  save();
});
form.addEventListener('input', (e) => {
  const k = e.target.dataset.lens;
  if (!k) return;
  settings.lens[k] = Number(e.target.value);
  e.target.nextElementSibling.textContent = Number(e.target.value).toFixed(2);
  save();
});
$('lens-reset').addEventListener('click', () => {
  settings.lens = { ...DEFAULT_LENS };
  save();
  syncMenu();
});
$('copy-report').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('report-text').textContent);
    msg('Resultado copiado. Cole na conversa para analisarmos.');
  } catch {
    msg('Não foi possível copiar: selecione o texto e copie.');
  }
});
function msg(text) {
  $('menu-msg').textContent = text;
}
function showReport(text) {
  $('report').hidden = !text;
  $('report-text').textContent = text || '';
}
syncMenu();
try {
  showReport(localStorage.getItem(`${KEY}-report`));
} catch {
  /* sem relatório anterior */
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  enter().catch((err) => {
    console.error(err);
    exit();
    msg(`Não foi possível iniciar: ${err.message || err}`);
  });
});

// ------------------------------------------------------------ sessão
let S = null;

async function enter() {
  const s = JSON.parse(JSON.stringify(settings));
  msg('Preparando…');
  const stage = $('stage');
  const isIOSPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  const head = new HeadTracker(stage);
  // iPhone: a permissão do giroscópio precisa vir logo após o toque; no Android, a tela cheia
  let headKind;
  if (isIOSPermission) headKind = await head.start();
  if (s.view === 'box') {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      /* sem tela cheia (iPhone): segue assim mesmo */
    }
    try {
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* sem trava de orientação */
    }
  }
  if (!isIOSPermission) headKind = await head.start();

  // câmera: realidade mista e/ou mãos
  let video = null;
  if (camOk && (s.env === 'mr' || s.hands)) {
    try {
      video = await openCamera();
    } catch (err) {
      console.warn(err);
      msg('Câmera não permitida: seguindo sem ela.');
      s.env = 'vr';
      s.hands = false;
    }
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.autoClear = false;
  stage.replaceChildren(renderer.domElement);

  const stereo = new StereoView(renderer, { stereo: s.view === 'box', lens: s.lens });
  stereo.setSize(innerWidth, innerHeight);
  if (s.env === 'mr' && video) stereo.setVideo(video);

  const hands = s.hands && video ? new HandTracker(video, { camFov: s.lens.camFov, preference: s.handsProc }) : null;
  hands?.load().catch((err) => console.warn('mãos:', err));

  let elements = ELEMENTS;
  try {
    elements = await loadElements();
  } catch (err) {
    console.warn('tabela periódica indisponível; usando os 4 elementos de reserva', err);
  }
  // isótopos e íons (Fase 2): carregados em segundo plano; os átomos abertos se atualizam quando chegam
  loadIsotopes(elements)
    .then(() => S?.atoms.forEach((a) => a.userData.view?.setState(a.userData.state)))
    .catch((err) => console.warn('dados de isótopos indisponíveis', err));
  S = {
    s, stage, renderer, stereo, head, headKind, video, hands, voice: null, elements,
    scene: new THREE.Scene(), atoms: [], selectables: [], draggables: [],
    fps: { frames: 0, since: performance.now(), value: 0, min: Infinity, samples: [] },
    headEvents0: head.events, started: performance.now(), handCursors: [], lastHud: 0, info: null,
  };
  buildScene(S);

  if (s.voice && voiceSupported) {
    S.voice = new Voice([
      // átomo aberto por último (antes dos nomes: "tirar elétron do sódio" não cria um sódio)
      { words: ['tirar neutron', 'tira neutron', 'remover neutron', 'menos neutron'], run: () => voiceChange('n', -1) },
      { words: ['colocar neutron', 'coloca neutron', 'adicionar neutron', 'mais neutron', 'por neutron'], run: () => voiceChange('n', 1) },
      { words: ['tirar eletron', 'tira eletron', 'remover eletron', 'menos eletron', 'arrancar eletron'], run: () => voiceChange('e', -1) },
      { words: ['colocar eletron', 'coloca eletron', 'adicionar eletron', 'mais eletron', 'por eletron'], run: () => voiceChange('e', 1) },
      // nomes mais longos primeiro (evita confundir nomes parecidos)
      ...[...S.elements].sort((x, y) => y.words[0].length - x.words[0].length).map((el) => ({ words: el.words, run: () => spawn(el) })),
      { words: ['limpar', 'apagar'], run: clearAtoms },
      { words: ['frente', 'centralizar'], run: () => head.recenter() },
    ]);
    S.voice.start();
  }
  S.gaze.enabled = s.gaze;

  // sair: no óculos, qualquer toque; na tela, o botão "Sair" (ou Esc)
  $('menu').hidden = true;
  stage.hidden = false;
  $('exit-btn').hidden = s.view === 'box';
  let down = null;
  S.onDown = (e) => (down = { x: e.clientX, y: e.clientY });
  S.onTap = (e) => {
    if (s.view === 'box') return exit();
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) tapSelect(e); // arrastar para olhar não conta
  };
  stage.addEventListener('pointerdown', S.onDown);
  stage.addEventListener('click', S.onTap);
  S.onKey = (e) => e.key === 'Escape' && exit();
  window.addEventListener('keydown', S.onKey);
  S.onResize = () => {
    renderer.setSize(innerWidth, innerHeight);
    stereo.setSize(innerWidth, innerHeight);
    $('rotate').hidden = !(s.view === 'box' && innerHeight > innerWidth);
  };
  window.addEventListener('resize', S.onResize);
  S.onResize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)));
  if (DEBUG) {
    window.__lab = S;
    S.debug = { clear: clearAtoms, spawn: (sym) => spawn(S.elements.find((e) => e.sym === sym)), open: (i) => toggleOpen(S.atoms[i]), change: (i, what, d) => changeAtom(S.atoms[i], what, d) }; // atalhos para testes
  }
}

$('exit-btn').addEventListener('click', () => exit());

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  const v = document.createElement('video');
  v.playsInline = true;
  v.muted = true;
  v.srcObject = stream;
  await new Promise((r) => (v.onloadedmetadata = r));
  await v.play();
  return v;
}

function exit() {
  if (!S) return;
  const report = buildReport(S);
  S.renderer.setAnimationLoop(null);
  S.head.stop();
  S.hands?.stop();
  S.voice?.stop();
  S.video?.srcObject?.getTracks().forEach((t) => t.stop());
  S.stage.removeEventListener('click', S.onTap);
  S.stage.removeEventListener('pointerdown', S.onDown);
  window.removeEventListener('keydown', S.onKey);
  window.removeEventListener('resize', S.onResize);
  S.stereo.dispose();
  S.renderer.dispose();
  S.stage.replaceChildren();
  S.stage.hidden = true;
  $('exit-btn').hidden = true;
  $('rotate').hidden = true;
  $('menu').hidden = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* nada */
  }
  showReport(report);
  try {
    localStorage.setItem(`${KEY}-report`, report);
  } catch {
    /* nada */
  }
  msg('');
  S = null;
}

// ------------------------------------------------------------ cena
function buildScene(S) {
  const { scene, s } = S;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  if (s.env === 'vr') {
    // céu em degradê e chão em grade (leve: sem texturas)
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'varying vec3 p; void main(){ float h = p.y; vec3 top = vec3(0.04,0.16,0.22); vec3 mid = vec3(0.12,0.27,0.33); vec3 bot = vec3(0.02,0.07,0.09); vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0,0.6,h)) : mix(mid, bot, smoothstep(0.0,0.3,-h)); gl_FragColor = vec4(c,1.0); }',
      }),
    );
    const grid = new THREE.GridHelper(30, 60, 0x4fd1c5, 0x1f4a55);
    grid.position.y = -1.4;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(sky, grid);
  }

  // painéis: tabela (centro), controles (direita) e medições (esquerda).
  // Cada um tem um botão "–" para minimizar (vira uma etiqueta; pinçar nela abre de novo)
  // e pode ser arrastado pela borda.
  // tabela periódica completa (curvada), com alça para arrastar e botão de minimizar
  const pt = new PeriodicTable(S.elements, {
    onSelect: (el) => {
      spawn(el);
      showCard(el);
    },
    onHover: (el) => showCard(el),
  });
  S.ptable = pt;
  S.selectables.push(pt.mesh);
  const table = makeBox(S, {
    title: 'Tabela periódica',
    back: dragHandle(0.36, 0.06, '⠿ arrastar a tabela'),
    position: [0, 0.03, -1.35],
    extra: pt,
    backAt: [0, -pt.height / 2 - 0.05, 0.02],
    minAt: [0.36, pt.height / 2 - 0.06, 0.06],
  });
  // ficha do elemento apontado (à direita da tabela)
  S.card = new CanvasPanel(0.56, 0.34, { px: 640, draw: drawCard });
  const cardBox = makeBox(S, { title: 'Ficha', back: S.card, position: [1.05, 0.22, -0.85], rotY: -0.9 });

  const ctrlBack = new CanvasPanel(0.5, 0.44, { draw: (ctx, w, h) => roundRect(ctx, 4, 4, w - 8, h - 8, 26, 'rgba(10,24,31,0.7)', 'rgba(255,255,255,0.25)') });
  const ctrl = makeBox(S, { title: 'Controles', back: ctrlBack, position: [1.05, -0.3, -0.85], rotY: -0.9 });
  const lens = S.stereo.lens;
  const buttons = [
    ['Frente', 'recentralizar', () => S.head.recenter()],
    ['Limpar', 'apagar átomos', clearAtoms],
    ['Lentes −', 'menos distorção', () => (lens.k1 = Math.max(0, lens.k1 - 0.04))],
    ['Lentes +', 'mais distorção', () => (lens.k1 = Math.min(0.6, lens.k1 + 0.04))],
    ['Câmera −', 'imagem menor', () => (lens.camZoom = Math.max(0.6, lens.camZoom - 0.05))],
    ['Câmera +', 'imagem maior', () => (lens.camZoom = Math.min(1.6, lens.camZoom + 0.05))],
  ];
  buttons.forEach(([label, sub, run], i) => {
    const b = makeButton(label, { width: 0.2, height: 0.1, sub, onSelect: () => { run(); persistLens(); } });
    b.position.set((i % 2) * 0.22 - 0.11, 0.1 - Math.floor(i / 2) * 0.12, 0.01);
    ctrl.content.add(b);
    S.selectables.push(b);
  });

  S.hud = new CanvasPanel(0.56, 0.4, { px: 640, draw: drawHud });
  const hudBox = makeBox(S, { title: 'Medições', back: S.hud, position: [-1.05, 0.05, -0.85], rotY: 0.9 });
  S.boxes = [table, cardBox, ctrl, hudBox];

  S.gaze = new Gaze();
  scene.add(S.gaze.group);

  // mãos: os 21 pontos, o "raio" que sai da mão e o marcador onde ele acerta
  S.handSlots = [0, 1].map(() => {
    const g = new THREE.Group();
    // tudo da mão é "transparent": o three.js desenha os objetos transparentes DEPOIS dos opacos,
    // e as caixas são transparentes — um marcador opaco ficaria escondido atrás delas
    const onTop = { transparent: true, depthTest: false, depthWrite: false };
    const beams = makeHandBeams(onTop); // a mão desenhada com raios de luz (ossos dos dedos)
    const ray = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: 0x4fd1c5, opacity: 0.7, ...onTop }));
    ray.frustumCulled = false;
    // mira da mão (onde o raio acerta): por cima de qualquer caixa, mesmo tamanho aparente a qualquer
    // distância; o miolo enche conforme a pinça fecha e fica cheio (amarelo) enquanto aperta
    const reticle = new THREE.Group();
    const outline = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.2, 40), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.55, ...onTop }));
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.95, ...onTop }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.72, 40), new THREE.MeshBasicMaterial({ color: 0x4fd1c5, opacity: 0.9, ...onTop }));
    outline.renderOrder = 1000;
    rim.renderOrder = 1001;
    fill.renderOrder = 1002;
    reticle.add(outline, rim, fill);
    ray.renderOrder = 998;
    g.add(beams.group, ray, reticle);
    g.visible = false;
    scene.add(g);
    return { g, beams, ray, reticle, rim, fill, dir: null, depth: 0.4, wasPinching: false, grab: null, hover: null, flash: 0 };
  });
  S.handRay = new THREE.Raycaster();

  // química: ligações (bastões), rótulos das moléculas e avisos
  S.chem = new Chem({
    onBond: (a, b, order) => {
      // quem está na mão recua até a distância da ligação (em vez de empurrar a outra molécula)
      for (const sl of S.handSlots) if (sl.grab && (sl.grab.obj === a.obj || sl.grab.obj === b.obj)) sl.grab.dist = Math.max(0.3, sl.grab.dist - BOND_LEN[order]);
      flash(a, 0x4fd1c5);
      flash(b, 0x4fd1c5);
      buzz(25);
      const canMore = order < 3 && S.chem.free(a) > 0 && S.chem.free(b) > 0;
      // tipo de ligação pela diferença de eletronegatividade (Pauling)
      const dEn = a.el.en != null && b.el.en != null ? Math.abs(a.el.en - b.el.en) : null;
      if (dEn != null && dEn > 1.7) {
        const [cat, an] = a.el.en < b.el.en ? [a, b] : [b, a];
        toast(`Ligação iônica: ${cat.el.sym}⁺ ${an.el.sym}⁻ (diferença de eletronegatividade ${dEn.toFixed(1).replace('.', ',')})`);
      } else {
        const kind = dEn == null ? '' : dEn < 0.4 ? ' covalente apolar' : ' covalente polar';
        toast(`Ligação${kind} ${['', 'simples', 'dupla', 'tripla'][order]}: ${a.el.sym}${['', '–', '=', '≡'][order]}${b.el.sym}${canMore ? ` · pince a ligação para fazê-la ${order === 1 ? 'dupla' : 'tripla'}` : ''}`);
      }
    },
    onRepel: (a, b) => {
      const stable = S.chem.free(a) === 0 ? a : b;
      flash(b, 0xff3b3b);
      buzz([20, 40, 20]);
      const n = stable.el.valence;
      if (stable.charge) toast(`${ionName(stable.el, stable.charge)} é um íon: no laboratório, por enquanto, só átomos neutros fazem ligações`, true);
      else if (n == null) toast(`As ligações do ${stable.el.name.toLowerCase()} ainda não são simuladas no laboratório`, true);
      else if (n === 0) toast(`${stable.el.name} é um gás nobre: já é estável e não faz ligações`, true);
      else toast(`${stable.el.name} já tem ${n} ${n === 1 ? 'ligação' : 'ligações'}: está estável`, true);
    },
    onBreak: () => {
      buzz(15);
      toast('Ligação desfeita');
    },
    onSettle: (a, b, k) => {
      b.obj.userData.flash = { color: 0x4fd1c5, t: 0.25 * k + 0.05 };
    },
  });
  S.bondGroup = new THREE.Group();
  scene.add(S.bondGroup);
  S.stick = { geo: new THREE.CylinderGeometry(0.009, 0.009, 1, 10, 1, true), hitGeo: new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1), mat: new THREE.MeshStandardMaterial({ color: 0xdfe7ea, roughness: 0.5 }) };
  S.bondViews = [];
  S.molLabels = [];
  S.manips = [];
  S.zoom = false;
  S.zoomScale = 1;
  S.toast = new CanvasPanel(0.62, 0.12, { px: 768, draw: drawToast });
  S.toast.visible = false;
  S.toast.renderOrder = 997;
  S.toast.material.depthTest = false;
  scene.add(S.toast);
  S.chemVersion = -1;


}

// painel com botão de minimizar e etiqueta para reabrir; arrastável pela borda (o fundo)
function makeBox(S, { title, back, position, rotY = 0, extra = null, backAt = null, minAt = null }) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.y = rotY;
  const content = new THREE.Group();
  const { width: w, height: h } = back.geometry.parameters;
  content.add(back);
  if (extra) content.add(extra);
  if (backAt) back.position.set(...backAt);
  back.userData = { draggable: true, dragTarget: group };
  S.draggables.push(back);
  const box = { group, content, title };
  const minBtn = makeButton('–', { width: 0.07, height: 0.07, onSelect: () => setCollapsed(true) });
  minBtn.position.set(...(minAt || [w / 2 - 0.05, h / 2 - 0.05, 0.02]));
  content.add(minBtn);
  const tab = makeButton(`+ ${title}`, { width: 0.3, height: 0.08, onSelect: () => setCollapsed(false) });
  tab.position.set(0, extra ? 0 : h / 2 - 0.04, 0.01);
  tab.visible = false;
  S.selectables.push(minBtn, tab);
  const setCollapsed = (v) => {
    content.visible = !v;
    tab.visible = v;
  };
  box.setCollapsed = setCollapsed;
  group.add(content, tab);
  S.scene.add(group);
  return box;
}

// alça para arrastar um painel (uma barrinha com texto)
function dragHandle(w, h, text) {
  return new CanvasPanel(w, h, {
    draw: (ctx, cw, ch) => {
      roundRect(ctx, 4, 4, cw - 8, ch - 8, ch * 0.4, 'rgba(10,24,31,0.85)', 'rgba(79,209,197,0.6)');
      ctx.fillStyle = '#bfd3db';
      ctx.font = font(ch * 0.42, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cw / 2, ch / 2);
    },
  });
}

// ficha do elemento: aparece ao apontar para a tabela
function showCard(el) {
  if (S.cardEl === el) return;
  S.cardEl = el;
  S.card.redraw(elementLines(el), el);
}

function drawCard(ctx, w, h, info, el) {
  roundRect(ctx, 4, 4, w - 8, h - 8, 26, 'rgba(10,24,31,0.9)', 'rgba(79,209,197,0.6)');
  if (!info) {
    ctx.fillStyle = '#9fb6c1';
    ctx.font = font(28, 400);
    ctx.fillText('Aponte para um elemento da tabela', 30, 70);
    return;
  }
  ctx.fillStyle = el.color;
  roundRect(ctx, 26, 24, 110, 110, 16, el.color);
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.75;
  ctx.font = font(58, 700);
  ctx.textAlign = 'center';
  ctx.fillText(el.sym, 81, 98);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(38, 700);
  ctx.fillText(info.title, 152, 70);
  ctx.fillStyle = '#4fd1c5';
  ctx.font = font(24, 600);
  ctx.fillText(info.tag, 152, 110);
  ctx.fillStyle = '#d3e2e8';
  ctx.font = font(23, 400);
  info.rows.forEach((r, i) => ctx.fillText(r, 26, 178 + i * 37, w - 52));
}

// o raio do three.js acerta até objetos escondidos: só vale o que está realmente visível
function isShown(o) {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

function persistLens() {
  Object.assign(settings.lens, { k1: S.stereo.lens.k1, camZoom: S.stereo.lens.camZoom });
  save();
}

// ------------------------------------------------------------ átomos (teste de pegar/mover)
function spawn(el) {
  if (!S) return;
  const q = S.head.quaternion;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  fwd.y = 0;
  fwd.normalize();
  const atom = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 20), new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.35, metalness: 0.1 }));
  // rótulo: símbolo, ou o isótopo/íon depois de mexer no átomo aberto (ex.: ¹⁴C, Na⁺)
  const label = new CanvasPanel(0.11, 0.07, {
    px: 200,
    draw: (ctx, w, h) => {
      const text = atom.userData.tag || el.sym;
      let size = 96;
      ctx.font = font(size, 700);
      while (ctx.measureText(text).width > w - 12 && size > 40) ctx.font = font((size -= 4), 700);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 10;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillText(text, w / 2, h / 2);
    },
  });
  label.position.y = 0.085;
  atom.add(ball, label);
  // aparece num lugar livre, numa bancada abaixo da tabela (não tampa os elementos de baixo)
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const spots = [0, 1, -1, 2, -2, 3, -3].flatMap((i) => [-0.36, -0.5].map((y) => fwd.clone().multiplyScalar(0.65).addScaledVector(right, i * 0.15).setY(y)));
  atom.position.copy(spots.find((p) => S.atoms.every((a) => a.position.distanceTo(p) > 0.16)) || spots[0]);
  atom.userData = { selectable: true, grabbable: true, element: el, label, ball, hovered: false, state: initialState(el), tag: null, onSelect: () => toggleOpen(atom), setHover: (v) => {
    atom.userData.hovered = v;
    if (v && atom.userData.view && S.lastOpen !== atom) setActiveOpen(atom); // apontar para um átomo aberto mostra o cartão dele
  } };
  S.scene.add(atom);
  S.chem.add(atom, el);
  S.atoms.push(atom);
  S.selectables.push(atom);
  if (S.atoms.length > 16) removeAtom(S.atoms[0]);
}

function removeAtom(atom) {
  atom.userData.view?.dispose();
  if (S.lastOpen === atom) S.lastOpen = null;
  S.chem.remove(atom);
  S.scene.remove(atom);
  S.atoms = S.atoms.filter((a) => a !== atom);
  S.selectables = S.selectables.filter((a) => a !== atom);
}

function clearAtoms() {
  if (S) [...S.atoms].forEach(removeAtom);
}

// pinça rápida (ou olhar) num átomo solto: abre/fecha o modelo de Bohr
function toggleOpen(atom) {
  const chemAtom = atom.userData.atom;
  if (!atom.userData.view && S.chem.neighbors(chemAtom).length) {
    toast('Para abrir o átomo, desfaça antes as ligações dele', true);
    return;
  }
  if (atom.userData.view) {
    atom.remove(atom.userData.view);
    atom.userData.view.dispose();
    atom.userData.view = null;
    chemAtom.open = false;
    if (S.lastOpen === atom) setActiveOpen([...S.atoms].reverse().find((a) => a.userData.view) || null);
  } else {
    const el = atom.userData.element;
    atom.userData.view = new AtomView(el, atom.userData.state, {
      describe: (st) => describe(el, st),
      onButton: (what, delta) => changeAtom(atom, what, delta),
    });
    atom.add(atom.userData.view);
    chemAtom.open = true;
    chemAtom.openRadius = atom.userData.view.outer + 0.02; // a física passa a respeitar o tamanho aberto
    setActiveOpen(atom);
    const st = atom.userData.state;
    toast(`${el.name}: ${el.z} prótons, ${st.N} nêutrons, ${st.electrons} elétrons — use os botões para tirar ou colocar partículas`);
  }
  atom.userData.ball.visible = atom.userData.label.visible = !atom.userData.view;
}

// Fase 2: tirar/colocar nêutron ou elétron (as regras da natureza estão em ions.js)
function changeAtom(atom, what, delta) {
  const view = atom?.userData.view;
  if (!view) return;
  const el = atom.userData.element;
  const r = change(el, atom.userData.state, what, delta);
  if (!r.ok) {
    toast(r.msg, true);
    buzz([20, 40, 20]);
    return;
  }
  atom.userData.state = r.state;
  view.setState(r.state);
  view.fly(what, delta);
  const chemAtom = atom.userData.atom;
  chemAtom.openRadius = view.outer + 0.02;
  chemAtom.charge = el.z - r.state.electrons; // íons ainda não fazem ligações no laboratório
  atom.userData.tag = view.info.tag === el.sym ? null : view.info.tag;
  atom.userData.label.redraw();
  setActiveOpen(atom);
  buzz(12);
  toast(r.msg, !!r.warn);
}

// só um átomo aberto mostra o cartão completo (com botões) por vez; os outros mostram só o nome
function setActiveOpen(atom) {
  S.lastOpen = atom;
  for (const a of S.atoms) a.userData.view?.setActive(a === atom);
}

// por voz: age no último átomo aberto que ainda estiver aberto
function voiceChange(what, delta) {
  const atom = S?.lastOpen?.userData.view ? S.lastOpen : [...(S?.atoms || [])].reverse().find((a) => a.userData.view);
  if (!atom) return toast('Abra um átomo primeiro (pinça rápida nele)', true);
  changeAtom(atom, what, delta);
}

// ------------------------------------------------------------ ligações, rótulos e avisos
// bastões entre os átomos: 1, 2 ou 3 linhas paralelas (simples, dupla, tripla).
// Cada ligação tem um cilindro invisível mais grosso, fácil de mirar: pinçar = mudar a ligação.
function updateBonds(S, q) {
  const view = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const bonds = S.chem.bonds;
  while (S.bondViews.length < bonds.length) {
    const g = new THREE.Group();
    const mat = S.stick.mat.clone();
    const sticks = [0, 1, 2].map(() => new THREE.Mesh(S.stick.geo, mat));
    const hit = new THREE.Mesh(S.stick.hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    const v = { g, sticks, hit, mat, hovered: false };
    hit.userData = { selectable: true, setHover: (on) => (v.hovered = on) };
    g.add(hit, ...sticks);
    S.bondGroup.add(g);
    S.bondViews.push(v);
  }
  const up = new THREE.Vector3(0, 1, 0);
  S.bondViews.forEach((v, i) => {
    const bond = bonds[i];
    v.g.visible = !!bond;
    if (!bond) return;
    const pa = bond.a.obj.position, pb = bond.b.obj.position;
    const dir = pb.clone().sub(pa);
    const len = dir.length();
    dir.normalize();
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const sc = (bond.a.scale + bond.b.scale) / 2;
    const visibleLen = Math.max(0.001, len - RADIUS * 1.6 * sc);
    v.hit.userData.onSelect = () => S.chem.cycleBond(bond);
    v.hit.position.copy(mid);
    v.hit.quaternion.copy(quat);
    v.hit.scale.set(sc, visibleLen, sc);
    const side = new THREE.Vector3().crossVectors(dir, view).normalize().multiplyScalar(0.022 * sc);
    const offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-0.5, 0.5] : [-1, 0, 1];
    v.sticks.forEach((m, k) => {
      m.visible = k < offsets.length;
      if (!m.visible) return;
      m.position.copy(mid).addScaledVector(side, offsets[k]);
      m.quaternion.copy(quat);
      m.scale.set(sc, visibleLen, sc);
    });
    v.mat.color.set(v.hovered ? 0x4fd1c5 : 0xdfe7ea);
  });
}

function bondTargets(S) {
  return S.bondViews.filter((v) => v.g.visible).map((v) => v.hit);
}

// rótulo acima de cada molécula (2+ átomos): fórmula, nome e quantas ligações faltam.
// O rótulo é uma alça: pinçar e arrastar move a molécula inteira; pinça rápida a traz para perto.
// Ao lado: ↻ (pinçar e mover a mão gira) e ⤢ (pinçar e subir/descer a mão muda o tamanho).
function updateMoleculeLabels(S, q) {
  const mols = S.chem.molecules().filter((m) => m.length > 1);
  while (S.molLabels.length < mols.length) {
    const item = { group: new THREE.Group(), mol: null };
    item.label = new CanvasPanel(0.42, 0.1, { draw: drawMolLabel });
    item.label.userData = { manip: 'move', item };
    const handle = (manip, icon, x) => {
      const h = new CanvasPanel(0.075, 0.075, { px: 128, draw: (ctx, w, hh, hover = false) => drawHandle(ctx, w, hh, icon, hover) });
      h.position.x = x;
      h.userData = { manip, item, setHover: (v) => h.redraw(v) };
      return h;
    };
    item.rot = handle('rotate', '↻', 0.27);
    item.scl = handle('scale', '⤢', 0.36);
    for (const m of [item.label, item.rot, item.scl]) {
      m.material.depthTest = false;
      m.renderOrder = 996;
      item.group.add(m);
    }
    S.scene.add(item.group);
    S.molLabels.push(item);
  }
  S.manips = [];
  S.molLabels.forEach((item, i) => {
    const m = mols[i];
    item.group.visible = !!m;
    item.mol = m || null;
    if (!m) return;
    const info = S.chem.describe(m);
    const text = info.complete ? `${info.pretty}${info.name ? ` — ${info.name}` : ' — completa'}` : `${info.pretty} · ${info.missing === 1 ? 'falta 1 ligação' : `faltam ${info.missing} ligações`}`;
    if (item.label.userData.text !== text) {
      item.label.userData.text = text;
      item.label.redraw(text, info.complete);
    }
    const c = new THREE.Vector3();
    let top = -Infinity;
    let sc = 0;
    for (const a of m) {
      c.add(a.obj.position);
      top = Math.max(top, a.obj.position.y);
      sc += a.scale;
    }
    c.multiplyScalar(1 / m.length);
    sc /= m.length;
    item.group.position.set(c.x, top + 0.13 * sc, c.z);
    item.group.quaternion.copy(q);
    item.group.scale.setScalar(S.zoomScale);
    S.manips.push(item.label, item.rot, item.scl);
  });
}

function drawHandle(ctx, w, h, icon, hover) {
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = hover ? '#4fd1c5' : 'rgba(10,24,31,0.9)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = hover ? '#ffffff' : 'rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.fillStyle = hover ? '#062b28' : '#ffffff';
  ctx.font = font(h * 0.55, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, w / 2, h / 2 + 2);
}

function findManip(o) {
  while (o) {
    if (o.userData?.manip) return o;
    o = o.parent;
  }
  return null;
}

// "zoom nas informações": painéis, rótulos e avisos 50% maiores (pinça segurada no vazio)
function toggleZoom() {
  S.zoom = !S.zoom;
  toast(S.zoom ? 'Zoom nas informações: ligado' : 'Zoom nas informações: desligado');
}

function drawMolLabel(ctx, w, h, text = '', complete = false) {
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.3, complete ? 'rgba(79,209,197,0.92)' : 'rgba(10,24,31,0.88)', complete ? '#ffffff' : 'rgba(255,255,255,0.4)');
  ctx.fillStyle = complete ? '#062b28' : '#eaf3f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = h * 0.42;
  ctx.font = font(size, 600);
  while (ctx.measureText(text).width > w * 0.92 && size > 10) ctx.font = font((size -= 1), 600);
  ctx.fillText(text, w / 2, h / 2);
}

function flash(atom, color) {
  atom.obj.userData.flash = { color, t: 0.5 };
}

// vibração do celular (sente-se mesmo dentro do óculos; Android)
function buzz(pattern) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* sem vibração */
  }
}

// aviso curto, sempre à frente da pessoa
function toast(text, warn = false) {
  if (!S) return;
  S.toastText = text;
  S.toast.redraw(text, warn);
  S.toast.visible = true;
  S.toastT = 2.4 + Math.max(0, text.length - 50) / 25; // textos longos ficam mais tempo
}

function updateToast(S, q, dt) {
  if (!S.toast.visible) return;
  S.toastT -= dt;
  if (S.toastT <= 0) S.toast.visible = false;
  S.toast.position.copy(new THREE.Vector3(0, 0.2, -0.9).applyQuaternion(q));
  S.toast.quaternion.copy(q);
}

function drawToast(ctx, w, h, text = '', warn = false) {
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.35, warn ? 'rgba(120,20,20,0.92)' : 'rgba(10,24,31,0.92)', warn ? '#ff8a80' : '#4fd1c5');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = w * 0.92;
  ctx.font = font(44, 600);
  if (ctx.measureText(text).width <= maxW) return ctx.fillText(text, w / 2, h / 2);
  // texto longo: duas linhas, quebrando no espaço mais perto do meio
  const words = text.split(' ');
  let lines = [text];
  for (let i = 1, best = Infinity; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) < best) {
      best = Math.max(a.length, b.length);
      lines = [a, b];
    }
  }
  let size = 40;
  ctx.font = font(size, 600);
  while (lines.some((l) => ctx.measureText(l).width > maxW) && size > 12) ctx.font = font((size -= 1), 600);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, lines.length === 1 ? h / 2 : h * (0.31 + i * 0.4)));
}

// toque direto na tela (modo sem óculos)
function tapSelect(e) {
  const rect = S.renderer.domElement.getBoundingClientRect();
  const cam = S.stereo.cams[0];
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), cam);
  const h = ray.intersectObjects(S.selectables, true).find((x) => isShown(x.object) && findSelectable(x.object));
  if (h) findSelectable(h.object).userData.onSelect?.('toque', h);
}

// ------------------------------------------------------------ mãos: raio que sai da mão (como no Meta Quest)
// A direção vem de onde a mão aparece na imagem da câmera (preciso); a distância estimada só serve
// para aproximar/afastar o que está sendo segurado. Pinçar = clicar (botões) ou segurar (átomos, painéis).
function updateHands(S, dt) {
  const q = S.head.quaternion;
  const hands = S.hands?.hands || [];
  const k = 1 - Math.exp(-dt * 18); // suaviza entre uma detecção e outra
  S.handSlots.forEach((slot, i) => {
    const h = hands[i];
    slot.g.visible = !!h;
    if (!h) {
      releaseHand(slot);
      return;
    }
    const target = h.pinch.clone().normalize().applyQuaternion(q);
    slot.dir = slot.dir ? slot.dir.lerp(target, k).normalize() : target;
    slot.depth += (h.depth - slot.depth) * k;
    const handPos = slot.dir.clone().multiplyScalar(Math.min(slot.depth, 0.5));

    // pontos da mão (na mesma direção em que a câmera os vê) → raios contornando os dedos
    const joints = h.points.map((p) => p.clone().normalize().multiplyScalar(Math.min(slot.depth, 0.5) * (p.length() / Math.max(h.pinch.length(), 1e-3))).applyQuaternion(q));
    const closing = h.pinching ? 1 : THREE.MathUtils.clamp((0.9 - h.gap) / (0.9 - 0.35), 0, 1); // 0 = mão aberta, 1 = pinça
    slot.beams.update(joints, closing);

    // o que o raio acerta
    S.handRay.set(new THREE.Vector3(), slot.dir);
    const hits = S.handRay.intersectObjects([...S.manips, ...S.selectables, ...bondTargets(S), ...S.draggables], true);
    const hit = hits.find((x) => isShown(x.object) && (findManip(x.object) || findSelectable(x.object) || findDraggable(x.object)));
    const manip = hit && findManip(hit.object);
    const sel = hit && !manip && findSelectable(hit.object);
    const drag = hit && !manip && !sel && findDraggable(hit.object);
    const hoverObj = sel || (manip && manip.userData.setHover ? manip : null);
    const end = hit ? hit.point.clone() : slot.dir.clone().multiplyScalar(2.5);
    if (hoverObj !== slot.hover) {
      if (slot.hover && slot.hover !== S.gaze.hover) slot.hover.userData.setHover?.(false);
      hoverObj?.userData.setHover?.(true);
      slot.hover = hoverObj || null;
    }
    if (hoverObj) hoverObj.userData.onHoverMove?.(hit);

    // pinça: só age no instante em que fecha (1 pinça = 1 clique)
    const started = h.pinching && !slot.wasPinching;
    slot.wasPinching = h.pinching;
    if (started && !slot.grab) {
      if (manip && manip.userData.item.mol) {
        // segurando a molécula inteira (rígida enquanto a pinça estiver fechada)
        const mol = [...manip.userData.item.mol];
        const center = mol.reduce((c, a) => c.add(a.obj.position), new THREE.Vector3()).multiplyScalar(1 / mol.length);
        slot.grab = {
          kind: manip.userData.manip, mol, center, dir0: slot.dir.clone(), t0: performance.now(), depth0: slot.depth,
          dist: hit.distance, offs: mol.map((a) => a.obj.position.clone().sub(hit.point)),
          p0: mol.map((a) => a.obj.position.clone()), s0: mol.reduce((t, a) => t + a.scale, 0) / mol.length,
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        };
      } else if (sel?.userData.grabbable) slot.grab = { obj: sel, dist: hit.distance, offset: sel.position.clone().sub(hit.point), depth0: slot.depth, t0: performance.now(), dir0: slot.dir.clone() };
      else if (sel) {
        sel.userData.onSelect?.('mão', hit);
        slot.flash = 0.25;
      } else if (drag) {
        const obj = drag.userData.dragTarget;
        slot.grab = { obj, dist: hit.distance, offset: obj.position.clone().sub(hit.point), depth0: slot.depth, panel: true };
      }
    }
    // pinça segurada no vazio (sem nada no raio) por ~0,6 s: liga/desliga o zoom nas informações
    if (h.pinching && !slot.grab && !hit) {
      slot.voidT = (slot.voidT || 0) + dt;
      if (slot.voidT >= 0.6 && !slot.voidDone) {
        slot.voidDone = true;
        toggleZoom();
        buzz(20);
      }
    } else if (!h.pinching) {
      slot.voidT = 0;
      slot.voidDone = false;
    }
    if (slot.grab?.mol && h.pinching) {
      const g = slot.grab;
      const az = (v) => Math.atan2(v.x, -v.z);
      const el = (v) => Math.asin(THREE.MathUtils.clamp(v.y, -1, 1));
      if (g.kind === 'move') {
        const d = THREE.MathUtils.clamp(g.dist + (slot.depth - g.depth0) * 3, 0.3, 4);
        const point = slot.dir.clone().multiplyScalar(d);
        g.mol.forEach((a, n) => a.obj.position.copy(point).add(g.offs[n]));
        end.copy(point);
      } else if (g.kind === 'rotate') {
        // mão para os lados → gira em torno do eixo vertical; para cima/baixo → em torno do eixo horizontal
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (az(slot.dir) - az(g.dir0)) * -4);
        rot.multiply(new THREE.Quaternion().setFromAxisAngle(g.right, (el(slot.dir) - el(g.dir0)) * -4));
        g.mol.forEach((a, n) => a.obj.position.copy(g.p0[n]).sub(g.center).applyQuaternion(rot).add(g.center));
      } else if (g.kind === 'scale') {
        // mão para cima → maior; para baixo → menor
        const sNew = THREE.MathUtils.clamp(g.s0 * Math.exp((el(slot.dir) - el(g.dir0)) * 3), 0.4, 3); // ~10 cm de mão ≈ 1,6×
        g.mol.forEach((a, n) => {
          a.scale = sNew;
          a.obj.position.copy(g.p0[n]).sub(g.center).multiplyScalar(sNew / g.s0).add(g.center);
        });
      }
    } else if (slot.grab && h.pinching) {
      // "ímã": segurando um átomo e apontando perto de outro, a profundidade vai até ele
      if (!slot.grab.panel && !slot.grab.obj.userData.atom.bondedThisGrab) {
        let best = null;
        const cands = [];
        const held = slot.grab.obj.userData.atom;
        for (const a of S.atoms) {
          if (a === slot.grab.obj || S.chem.bondBetween(held, a.userData.atom)) continue; // só atrai quem ainda não está ligado
          const along = a.position.dot(slot.dir);
          const perp = a.position.clone().sub(slot.dir.clone().multiplyScalar(along)).length();
          if (along <= 0.25 || perp >= 0.16) continue;
          // apontar para qualquer parte de uma molécula = ligar no "lugar livre" dela (o átomo com
          // ligação sobrando mais perto); só há repulsão se a molécula inteira já estiver estável
          let target = a.userData.atom;
          if (S.chem.free(target) === 0) {
            const openOnes = S.chem.molecule(target).filter((m) => S.chem.free(m) > 0 && m !== held);
            if (openOnes.length) target = openOnes.sort((m1, m2) => m1.obj.position.distanceTo(a.position) - m2.obj.position.distanceTo(a.position))[0];
          }
          const free = S.chem.free(target);
          cands.push({ along: target.obj.position.dot(slot.dir), perp, atom: target, open: free > 0, free });
        }
        // abertos primeiro; com mira parecida, prefere quem tem mais ligações livres (o "centro" da molécula)
        const score = (c) => (c.open ? 0 : 10) + c.perp - (c.open ? Math.min(c.free, 3) * 0.012 : 0);
        best = cands.sort((x, y) => score(x) - score(y))[0] || null;
        // histerese: mantém o alvo atual enquanto ele ainda for candidato e não estiver claramente pior
        const cur = cands.find((c) => c.atom === held.intent);
        if (cur && best && best.atom !== cur.atom && score(cur) - score(best) < 0.03) best = cur;
        if (best) slot.grab.dist += (best.along - (slot.grab.dist + (slot.depth - slot.grab.depth0) * 3)) * Math.min(1, dt * 6);
        held.intent = best ? best.atom : null;
      }
      // mão para frente/para trás → aproxima ou afasta o objeto
      const d = THREE.MathUtils.clamp(slot.grab.dist + (slot.depth - slot.grab.depth0) * 3, 0.3, 4);
      slot.grab.obj.position.copy(slot.dir).multiplyScalar(d).add(slot.grab.offset);
      if (slot.grab.panel) slot.grab.obj.lookAt(0, slot.grab.obj.position.y, 0); // painel sempre virado para a pessoa
      end.copy(slot.dir).multiplyScalar(d);
    } else if (!h.pinching) releaseHand(slot);

    // desenho: raio da mão até o alvo, marcador e anel da pinça
    const ray = slot.ray.geometry.attributes.position.array;
    ray.set([handPos.x, handPos.y, handPos.z, end.x, end.y, end.z]);
    slot.ray.geometry.attributes.position.needsUpdate = true;
    slot.ray.material.color.set(slot.grab ? 0xffd400 : sel || drag || manip ? 0xffffff : 0x4fd1c5);
    slot.flash = Math.max(0, slot.flash - dt);
    const aiming = !!(sel || drag || manip || slot.grab);
    const dist = end.length();
    const grow = slot.flash > 0 ? 1.5 : aiming ? 1.2 : 1 + Math.min(1, (slot.voidT || 0) / 0.6) * 1.2;
    slot.reticle.position.copy(end);
    slot.reticle.quaternion.copy(q);
    slot.reticle.scale.setScalar(dist * 0.016 * grow); // raio ≈ 0,9° (cabe dentro de um quadradinho da tabela)
    slot.fill.scale.setScalar(Math.max(0.001, closing * closing));
    slot.fill.material.color.set(h.pinching ? 0xffd400 : 0x4fd1c5);
    slot.fill.material.opacity = h.pinching ? 1 : 0.75;
    slot.rim.material.color.set(h.pinching ? 0xffd400 : aiming ? 0xffffff : 0xbfd3db);
  });
}

// ------------------------------------------------------------ mão desenhada com raios de luz
// Os 21 pontos do MediaPipe ligados como os ossos da mão; cada osso é um tubinho fino (com um
// halo mais largo e transparente). Tubos têm espessura real nos dois olhos — linha comum do WebGL
// tem só 1 pixel no celular. Polegar e indicador amarelam conforme a pinça fecha.
const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const PINCH_BONES = new Set([0, 1, 2, 3, 5, 6, 7]); // polegar e indicador
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);
const TUBE = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const KNUCKLE = new THREE.SphereGeometry(1, 10, 8);
const HAND_COLOR = new THREE.Color(0x4fd1c5), PINCH_COLOR = new THREE.Color(0xffd400);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _mid = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _UP = new THREE.Vector3(0, 1, 0);

function makeHandBeams(onTop) {
  const mk = (geo, count, opacity, order) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, opacity, ...onTop }), count);
    m.frustumCulled = false;
    m.renderOrder = order;
    for (let i = 0; i < count; i++) m.setColorAt(i, HAND_COLOR);
    return m;
  };
  const glow = mk(TUBE, HAND_BONES.length, 0.25, 996);
  const core = mk(TUBE, HAND_BONES.length, 0.95, 997);
  const knuckles = mk(KNUCKLE, 21, 0.95, 997);
  const group = new THREE.Group();
  group.add(glow, core, knuckles);
  return {
    group,
    update(pts, closing) {
      _c.copy(HAND_COLOR).lerp(PINCH_COLOR, closing);
      HAND_BONES.forEach(([a, b], i) => {
        _d.subVectors(pts[b], pts[a]);
        const len = _d.length();
        _mid.addVectors(pts[a], pts[b]).multiplyScalar(0.5);
        _q.setFromUnitVectors(_UP, len > 1e-6 ? _d.divideScalar(len) : _UP);
        core.setMatrixAt(i, _m.compose(_mid, _q, _s.set(0.0016, len, 0.0016)));
        glow.setMatrixAt(i, _m.compose(_mid, _q, _s.set(0.0045, len, 0.0045)));
        const col = PINCH_BONES.has(i) ? _c : HAND_COLOR;
        core.setColorAt(i, col);
        glow.setColorAt(i, col);
      });
      pts.forEach((p, n) => {
        const r = FINGERTIPS.has(n) ? 0.0034 : 0.0022;
        knuckles.setMatrixAt(n, _m.compose(p, _q.identity(), _s.set(r, r, r)));
        knuckles.setColorAt(n, n === 4 || n === 8 ? _c : HAND_COLOR);
      });
      for (const m of [glow, core, knuckles]) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    },
  };
}

function releaseHand(slot) {
  const g = slot.grab;
  // pinça rápida no rótulo (sem arrastar): traz a molécula para perto, à frente da pessoa
  if (g?.kind === 'move' && performance.now() - g.t0 < 350 && slot.dir && slot.dir.angleTo(g.dir0) < 0.04) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.head.quaternion);
    const target = fwd.multiplyScalar(0.6).add(new THREE.Vector3(0, -0.08, 0));
    const center = g.mol.reduce((c, a) => c.add(a.obj.position), new THREE.Vector3()).multiplyScalar(1 / g.mol.length);
    const shift = target.sub(center);
    g.mol.forEach((a) => a.obj.position.add(shift));
    toast('Molécula trazida para perto');
  }
  // pinça rápida num átomo (sem arrastar): abre/fecha o átomo
  if (g?.obj?.userData.grabbable && performance.now() - g.t0 < 300 && slot.dir && slot.dir.angleTo(g.dir0) < 0.04) toggleOpen(g.obj);
  slot.grab = null;
  slot.wasPinching = false;
}

function findDraggable(o) {
  while (o) {
    if (o.userData?.draggable) return o;
    o = o.parent;
  }
  return null;
}

// ------------------------------------------------------------ quadro a quadro
function frame(dt) {
  const now = performance.now();
  const q = S.head.update();
  S.hands?.update(now);
  updateHands(S, dt);
  S.gaze.update(dt, q, [...S.selectables, ...bondTargets(S)]);
  // química: quem está sendo segurado não se move pela física
  for (const a of S.chem.atoms) a.held = S.handSlots.some((sl) => sl.grab && (sl.grab.obj === a.obj || sl.grab.mol?.includes(a)));
  S.chem.step(dt);
  updateBonds(S, q);
  updateMoleculeLabels(S, q);
  updateToast(S, q, dt);
  S.zoomScale += ((S.zoom ? 1.5 : 1) - S.zoomScale) * Math.min(1, dt * 8);
  for (const box of S.boxes) box.group.scale.setScalar(S.zoomScale);
  S.toast.scale.setScalar(S.zoomScale);
  for (const a of S.chem.atoms) a.obj.scale.setScalar(a.scale);
  // rótulos dos átomos e painel de informação viram para a pessoa; brilho de hover e de avisos
  for (const a of S.atoms) {
    a.userData.label.quaternion.copy(q);
    const f = a.userData.flash;
    const em = a.userData.ball.material.emissive;
    if (f && f.t > 0) {
      f.t -= dt;
      em.set(f.color).multiplyScalar(Math.max(0, f.t / 0.5));
    } else em.set(a.userData.hovered ? 0x224444 : 0x000000);
  }
  for (const a of S.atoms) a.userData.view?.update(dt, q);
  S.stereo.render(S.scene, q, { opaqueBackground: S.s.env === 'vr' });

  // medições
  const f = S.fps;
  f.frames++;
  if (now - f.since >= 1000) {
    f.value = (f.frames * 1000) / (now - f.since);
    // enquanto o detector das mãos carrega (ou troca de GPU para CPU) o celular engasga: não conta
    const settled = now - S.started > 3000 && (!S.hands || S.hands.status === 'pronto');
    if (settled) {
      f.min = Math.min(f.min, f.value);
      f.samples.push(f.value);
    }
    f.frames = 0;
    f.since = now;
    // qualidade automática: diminui a resolução se ficar lento e volta a subir quando folgar
    if (settled && f.value < 40 && S.stereo.lens.scale > 0.55) {
      S.stereo.lens.scale = Math.round((S.stereo.lens.scale - 0.15) * 100) / 100;
      S.stereo.setSize(innerWidth, innerHeight);
      f.good = 0;
    } else if (settled && f.value > 54 && S.stereo.lens.scale < 1) {
      f.good = (f.good || 0) + 1;
      if (f.good >= 3) {
        S.stereo.lens.scale = Math.min(1, Math.round((S.stereo.lens.scale + 0.1) * 100) / 100);
        S.stereo.setSize(innerWidth, innerHeight);
        f.good = 0;
      }
    } else f.good = 0;
  }
  if (now - S.lastHud > 500) {
    S.lastHud = now;
    S.hud.redraw(hudLines(S));
  }
}

function headLabel(S) {
  return { sensor: 'giroscópio (sensor)', deviceorientation: 'giroscópio (orientação)', drag: 'arrastar (sem giroscópio)' }[S.head.kind] || S.head.kind;
}

function hudLines(S) {
  const secs = Math.max(1, (performance.now() - S.started) / 1000);
  const h = S.hands;
  return [
    `Quadros/s: ${S.fps.value.toFixed(0)}${Number.isFinite(S.fps.min) ? ` (mín ${S.fps.min.toFixed(0)})` : ''} · qualidade ${Math.round(S.stereo.lens.scale * 100)}%`,
    `Cabeça: ${headLabel(S)} · ${Math.round((S.head.events - S.headEvents0) / secs)} Hz`,
    h ? (h.status === 'pronto' ? `Mãos: ${h.mode === 'worker' ? '2º plano' : 'principal'} ${h.delegate} · ${h.rate.toFixed(0)}/s · ${h.avgMs.toFixed(0)} ms` : `Mãos: ${h.status}`) : 'Mãos: desligadas',
    h ? `Mãos vistas: ${h.hands.length} · pinça: ${h.hands.some((x) => x.pinching) ? 'sim' : 'não'}${h.hands[0] ? ` · ${(-h.hands[0].pinch.z * 100).toFixed(0)} cm` : ''}` : '',
    S.voice ? `Voz: ${S.voice.heard ? `“${S.voice.heard}”` : S.voice.status}` : 'Voz: desligada',
    S.video ? `Câmera: ${S.video.videoWidth}×${S.video.videoHeight}` : 'Câmera: desligada',
  ].filter(Boolean);
}

function drawHud(ctx, w, h, lines = []) {
  roundRect(ctx, 4, 4, w - 8, h - 8, 26, 'rgba(10,24,31,0.85)', 'rgba(255,255,255,0.3)');
  ctx.fillStyle = '#4fd1c5';
  ctx.font = font(30, 700);
  ctx.fillText('Medições', 28, 52);
  ctx.fillStyle = '#eaf3f6';
  ctx.font = font(25, 400);
  lines.forEach((line, i) => ctx.fillText(line, 28, 100 + i * 40, w - 56));
}

function buildReport(S) {
  const gl = S.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const secs = (performance.now() - S.started) / 1000;
  const fpsAvg = S.fps.samples.length ? S.fps.samples.reduce((a, b) => a + b, 0) / S.fps.samples.length : S.fps.value;
  const h = S.hands;
  return [
    `Laboratório NanoAR · protótipo · ${new Date().toLocaleString('pt-BR')}`,
    `Aparelho: ${navigator.userAgent}`,
    `Tela: ${screen.width}×${screen.height} · densidade ${devicePixelRatio} · GPU: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/d'}`,
    `Modo: ${S.s.env === 'mr' ? 'realidade mista' : 'sala virtual'} · ${S.s.view === 'box' ? 'óculos' : 'tela'} · duração ${secs.toFixed(0)} s`,
    `Quadros/s: média ${fpsAvg.toFixed(1)} · mínimo ${Number.isFinite(S.fps.min) ? S.fps.min.toFixed(1) : 'n/d'} · qualidade final ${Math.round(S.stereo.lens.scale * 100)}%`,
    `Cabeça: ${headLabel(S)} · ${((S.head.events - S.headEvents0) / Math.max(1, secs)).toFixed(0)} leituras/s`,
    h
      ? `Mãos (${S.s.handsProc === 'auto' ? 'automático' : S.s.handsProc}): ${h.status}${h.mode ? ` · ${h.mode === 'worker' ? '2º plano' : 'principal'} ${h.delegate} · ${h.rate.toFixed(1)} detecções/s · ${h.avgMs.toFixed(1)} ms · mão visível em ${Math.round((100 * h.stats.withHands) / Math.max(1, h.stats.results))}% das imagens` : ''}${h.summary ? ` · histórico: ${h.summary}` : ''}`
      : 'Mãos: desligadas',
    `Voz: ${S.voice ? `${S.voice.status}${S.voice.heard ? ` · último: “${S.voice.heard}”` : ''}` : voiceSupported ? 'desligada' : 'indisponível'}`,
    `Câmera: ${S.video ? `${S.video.videoWidth}×${S.video.videoHeight}` : 'desligada'} · lentes k1=${S.stereo.lens.k1.toFixed(2)} campo ${S.stereo.lens.fov}° câmera ${S.stereo.lens.camZoom.toFixed(2)}×`,
  ].join('\n');
}
