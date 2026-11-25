// Página de administração: escolher cores/tamanhos, testar na câmera (só neste aparelho)
// e baixar o config/style.json para publicar para todos.
import * as THREE from 'three';
import { TARGETS, STYLE, findTarget } from './targets.js';
import { Rig, setupLighting, attachGestures, pickRig } from './kit.js';
import { loadStyles, getPublished, getLocal, saveLocal, clearLocal, styleFor, normalize, LIMITS } from './style.js';

const PRESETS = [
  { name: 'Turquesa', atomColor: '#1fae9f', bondColor: '#8ea3ae' },
  { name: 'Laranja', atomColor: '#ff7a00', bondColor: '#ffb35c' },
  { name: 'Magenta', atomColor: '#d6338f', bondColor: '#f2a3cf' },
  { name: 'Amarelo e azul', atomColor: '#ffc400', bondColor: '#2f7bff' },
  { name: 'Vermelho', atomColor: '#e63946', bondColor: '#f4a261' },
  { name: 'Clássico (cinza)', atomColor: '#4a555d', bondColor: '#c9d1d6' },
];

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const chips = $('chips');
const caption = $('caption');
const playBtn = $('play-btn');

await loadStyles();
let config = getLocal() || getPublished(); // cópia de trabalho
let dirty = false;
let scope = 'all';

// ------------------------------------------------------------ cena 3D
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (err) {
  stage.innerHTML = '<p class="hint" style="padding:16px">Este navegador não conseguiu iniciar os gráficos 3D (WebGL).</p>';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
setupLighting(renderer, scene);

const rigs = new Map();
let current = null;

function layout() {
  const r = stage.getBoundingClientRect();
  const w = r.width, h = r.height;
  if (!w || !h) return;
  renderer.setSize(w, h);
  const top = chips.getBoundingClientRect().bottom - r.top + 8;
  const bottom = document.querySelector('.preview-bottom').getBoundingClientRect().top - r.top - 8;
  const freeH = Math.max(100, bottom - top);
  const px = 0.85 * Math.min(freeH, w);
  camera.aspect = w / h;
  camera.position.set(0, 0, h / px / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  camera.setViewOffset(w, h, 0, h / 2 - (top + freeH / 2), w, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(layout).observe(stage);

function select(cfg) {
  if (current) scene.remove(current);
  let rig = rigs.get(cfg.id);
  if (!rig) {
    rig = new Rig({ ...cfg, size: 1 }, { style: styleFor(cfg.id, config) });
    rig.onCaption = (text) => {
      caption.hidden = !text;
      if (text) caption.textContent = text;
    };
    rigs.set(cfg.id, rig);
  }
  current = rig;
  scene.add(rig);
  caption.hidden = true;
  rig.load().then(updatePlay, updatePlay);
  for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.id === cfg.id));
  history.replaceState(null, '', `#${cfg.id}`);
  updatePanel();
  updatePlay();
}

function updatePlay() {
  const label = current?.actionLabel;
  playBtn.hidden = !label;
  playBtn.disabled = !!current?.busy;
  if (label) playBtn.querySelector('span').textContent = label;
}

function play() {
  const done = current?.play();
  updatePlay();
  done?.then(updatePlay);
}
playBtn.addEventListener('click', play);

for (const cfg of TARGETS.filter((t) => !t.placeholder)) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.dataset.id = cfg.id;
  b.textContent = cfg.name;
  b.addEventListener('click', () => select(cfg));
  chips.appendChild(b);
}

attachGestures(stage, {
  getRig: () => current,
  onDragStart: (e) => {
    const peel = current && pickRig(e, camera, renderer.domElement, [current]) && current.beginPeel();
    if (!peel) return null;
    return { move: peel.move, end: (dx, vx) => peel.end(dx, vx).then(updatePlay) };
  },
  onTap: (e) => current && pickRig(e, camera, renderer.domElement, [current]) && play(),
});

// fundo da pré-visualização: um "QR code" de mentira para julgar o contraste como na câmera
stage.style.setProperty('--qr-bg', `url(${fakeQr()})`);
for (const b of document.querySelectorAll('[data-bg]')) {
  b.addEventListener('click', () => {
    stage.className = `preview-stage bg-${b.dataset.bg}`;
    for (const o of document.querySelectorAll('[data-bg]')) o.setAttribute('aria-pressed', String(o === b));
  });
}

function fakeQr() {
  const n = 37, m = 9, quiet = 4;
  const c = document.createElement('canvas');
  c.width = c.height = (n + 2 * quiet) * m;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on;
    if (finder(x, y)) {
      const fx = x < 7 ? x : x - (n - 7), fy = y < 7 ? y : y - (n - 7);
      const d = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
      on = d !== 2;
    } else on = rnd() > 0.5;
    if (on) g.fillRect((x + quiet) * m, (y + quiet) * m, m, m);
  }
  return c.toDataURL();
}

// ------------------------------------------------------------ painel
const inputs = {
  atomColor: $('atomColor'),
  bondColor: $('bondColor'),
  atomRadius: $('atomRadius'),
  bondRadius: $('bondRadius'),
};
for (const k of ['atomRadius', 'bondRadius']) {
  inputs[k].min = LIMITS[k][0];
  inputs[k].max = LIMITS[k][1];
}

function values() {
  return scope === 'all' ? { ...STYLE, ...config.default } : styleFor(current.cfg.id, config);
}

function updatePanel() {
  if (!current) return;
  const v = values();
  inputs.atomColor.value = v.atomColor;
  inputs.bondColor.value = v.bondColor;
  $('atomColorHex').value = v.atomColor;
  $('bondColorHex').value = v.bondColor;
  inputs.atomRadius.value = v.atomRadius;
  inputs.bondRadius.value = v.bondRadius;
  $('atomRadiusOut').textContent = `${Number(v.atomRadius).toFixed(2)} Å`;
  $('bondRadiusOut').textContent = `${Number(v.bondRadius).toFixed(2)} Å`;
  $('scope-name').textContent = current.cfg.name;
  $('own-note').hidden = !config.structures[current.cfg.id];
  $('model-note').hidden = !current.cfg.model;
  updateStatus();
}

function updateStatus() {
  const local = getLocal();
  let text = local
    ? 'Teste ativo neste aparelho: a câmera aqui usa estas cores. Os outros celulares ainda usam as cores publicadas.'
    : 'Mostrando as cores publicadas (config/style.json).';
  if (dirty) text += ' Há mudanças ainda não testadas.';
  $('status').textContent = text;
  $('status').classList.toggle('on', !!local);
  $('discard-btn').disabled = !local;
}

function set(key, value) {
  if (scope === 'all') config.default[key] = value;
  else config.structures[current.cfg.id] = { ...(config.structures[current.cfg.id] || {}), [key]: value };
  dirty = true;
  applyAll();
  updatePanel();
}

function applyAll() {
  for (const rig of rigs.values()) rig.applyStyle(styleFor(rig.cfg.id, config));
}

inputs.atomColor.addEventListener('input', (e) => set('atomColor', e.target.value));
inputs.bondColor.addEventListener('input', (e) => set('bondColor', e.target.value));
inputs.atomRadius.addEventListener('input', (e) => set('atomRadius', Number(e.target.value)));
inputs.bondRadius.addEventListener('input', (e) => set('bondRadius', Number(e.target.value)));
for (const k of ['atomColor', 'bondColor']) {
  $(`${k}Hex`).addEventListener('change', (e) => {
    const v = e.target.value.trim().replace(/^([^#])/, '#$1').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) set(k, v);
    else updatePanel();
  });
}

for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.innerHTML = `<span class="sw" style="background:${p.atomColor}"></span><span class="sw" style="background:${p.bondColor}"></span><span>${p.name}</span>`;
  b.addEventListener('click', () => {
    set('atomColor', p.atomColor);
    set('bondColor', p.bondColor);
  });
  $('presets').appendChild(b);
}

for (const b of document.querySelectorAll('[data-scope]')) {
  b.addEventListener('click', () => {
    scope = b.dataset.scope;
    for (const o of document.querySelectorAll('[data-scope]')) o.setAttribute('aria-pressed', String(o === b));
    updatePanel();
  });
}

$('clear-own').addEventListener('click', () => {
  delete config.structures[current.cfg.id];
  dirty = true;
  applyAll();
  updatePanel();
});

$('test-btn').addEventListener('click', () => {
  saveLocal(config);
  location.href = 'ar.html';
});

$('download-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(normalize(config), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'style.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('discard-btn').addEventListener('click', () => {
  clearLocal();
  config = getPublished();
  dirty = false;
  applyAll();
  updatePanel();
});

$('reset-btn').addEventListener('click', () => {
  config = normalize({ default: STYLE });
  dirty = true;
  applyAll();
  updatePanel();
});

const fromHash = findTarget(location.hash.slice(1));
select(fromHash && !fromHash.placeholder ? fromHash : TARGETS.find((t) => t.id === 'grafite'));
layout();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  current?.update(dt);
  if (current && !current.busy && playBtn.disabled) updatePlay();
  renderer.render(scene, camera);
});
