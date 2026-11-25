// Página de Realidade Aumentada: uma única página reconhece todos os QR codes do cartaz.
import * as THREE from 'three';
import { TARGETS, MAX_TRACK, findTarget } from './targets.js';
import { Rig, setupLighting, attachGestures, pickRig } from './kit.js';
import { Card } from './card.js';
import { loadStyles, styleFor, hasLocalTest } from './style.js';
import { mountA11yPanel, prefs, announce } from './a11y.js';

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug'); // ar.html?debug mostra detalhes no console
const stage = $('stage');
const scan = $('scan');
const card = new Card({ card: $('card'), caption: $('caption') });
mountA11yPanel({ openers: [$('a11y-btn'), $('a11y-start')], withControls: true });

// Quem chegou por um QR code antigo (Pages/grafite.html → ar.html#grafite): o conteúdo daquele
// QR code começa a carregar antes, mas nada é mostrado até a câmera reconhecê-lo.
const hinted = findTarget(location.hash.slice(1));

// Começa a baixar o motor de RA e os alvos enquanto a pessoa lê a tela inicial.
const mindarReady = import('mindar-image-three');
const targetsReady = loadTargets();
const qrReady = createQrDecoder();
const stylesReady = loadStyles();
mindarReady.catch(() => {});
targetsReady.catch(() => {});
qrReady.catch(() => {});

// Leitor de QR code: nativo do navegador quando existe (Android/Chrome), senão jsQR (iPhone).
async function createQrDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (canvas) => (await detector.detect(canvas))[0]?.rawValue || null;
      }
    } catch {
      /* usa o jsQR */
    }
  }
  const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
  return (canvas, ctx) => {
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data || null;
  };
}

// Texto do QR code impresso (…/Pages/grafite.html) → alvo
function targetFromQr(text) {
  const m = /Pages\/([\w-]+)\.html/i.exec(text) || /#([\w-]+)$/.exec(text);
  return m ? findTarget(m[1]) : null;
}

// assets/targets.mind.gz tem metade do tamanho; é descompactado aqui no navegador.
async function loadTargets() {
  if ('DecompressionStream' in window) {
    try {
      const res = await fetch('assets/targets.mind.gz');
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
        const blob = gz
          ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).blob()
          : new Blob([bytes]);
        return URL.createObjectURL(blob);
      }
    } catch (err) {
      console.warn('targets.mind.gz indisponível; usando targets.mind', err);
    }
  }
  return 'assets/targets.mind';
}

function showScreen(name) {
  for (const id of ['start', 'loading', 'error', 'help']) $(id).hidden = id !== name;
  // leva o foco (teclado/leitor de tela) para o botão principal da tela que abriu
  if (name) $(name).querySelector('button')?.focus();
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('help').hidden && showScreen(null));

function fail(kind, err) {
  console.error(kind, err);
  const msg = {
    webgl: 'Este navegador não conseguiu iniciar os gráficos 3D (WebGL). Atualize o navegador ou tente pelo Chrome ou Safari.',
    camera: window.isSecureContext
      ? 'Não foi possível usar a câmera. Verifique se o acesso à câmera está permitido para este site nas configurações do navegador e tente de novo.'
      : 'A câmera só funciona em endereços seguros (https://). Abra o site pelo link oficial.',
    load: 'Não foi possível carregar os arquivos da realidade aumentada. Verifique sua conexão com a internet e tente de novo.',
  }[kind];
  $('error-msg').textContent = msg;
  showScreen('error');
}

if (window.nanoarStartRequested) start();
else $('start-btn').addEventListener('click', start, { once: true });
$('retry-btn').addEventListener('click', () => location.reload());
$('help-btn').addEventListener('click', () => showScreen('help'));
$('help-close').addEventListener('click', () => showScreen(null));

async function start() {
  showScreen('loading');
  let mindar;
  try {
    const [{ MindARThree }, imageTargetSrc] = await Promise.all([mindarReady, targetsReady, stylesReady]);
    try {
      mindar = new MindARThree({
        container: stage,
        imageTargetSrc,
        maxTrack: MAX_TRACK,
        uiLoading: 'no',
        uiScanning: 'no',
        uiError: 'no',
        filterMinCF: 0.0001, // menos tremido
        filterBeta: 0.01,
      });
    } catch (err) {
      return fail('webgl', err);
    }
  } catch (err) {
    return fail('load', err);
  }

  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // telas muito densas pesam sem ganho visível
  setupLighting(renderer, scene);

  // Um "rig" (estrutura 3D) por alvo; ele é colocado sobre o QR code que for lido.
  const rigs = TARGETS.map((cfg) => {
    const rig = new Rig(cfg, { lift: cfg.lift ?? 0.3, style: styleFor(cfg.id) });
    rig.visible = false;
    rig.onCaption = (text) => card.rig === rig && card.setCaption(text);
    return rig;
  });
  if (hinted) rigs[TARGETS.indexOf(hinted)].load().catch(() => {});

  // Os QR codes do cartaz são muito parecidos entre si, e o MindAR aceita o primeiro alvo
  // "parecido o bastante" — às vezes o errado. Por isso o MindAR só diz ONDE está o QR code
  // (posição e inclinação); QUAL é ele vem da leitura (decodificação) do próprio QR code.
  const anchors = TARGETS.map((cfg, k) => {
    const anchor = mindar.addAnchor(k);
    anchor.k = k;
    anchor.tracked = false;
    anchor.rig = null;
    anchor.onTargetFound = () => found(anchor);
    anchor.onTargetLost = () => lost(anchor);
    return anchor;
  });

  let active = null;
  let hideTimer = 0;
  const setActive = (rig) => {
    active = rig;
    card.setCaption(null);
    card.show(rig);
  };
  const refresh = (rig) => card.rig === rig && card.render();
  const isShown = (rig) => rig.visible && rig.anchor?.tracked && rig.anchor.rig === rig;

  function found(anchor) {
    anchor.tracked = true;
    clearTimeout(hideTimer);
    identify(anchor);
  }

  async function identify(anchor) {
    const t0 = performance.now();
    while (anchor.tracked) {
      const text = await readQr(anchor).catch(() => null);
      if (!anchor.tracked) return;
      const target = text && targetFromQr(text);
      if (target) return show(anchor, rigs[TARGETS.indexOf(target)]);
      // não conseguiu ler (QR pequeno ou inclinado demais): confia no MindAR após um tempo
      if (performance.now() - t0 > 1800) return show(anchor, rigs[anchor.k]);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  function show(anchor, rig) {
    if (rig.anchor && rig.anchor !== anchor && rig.anchor.rig === rig) rig.anchor.rig = null;
    anchor.group.add(rig);
    anchor.rig = rig;
    rig.anchor = anchor;
    rig.visible = true;
    if (!active || !isShown(active) || active === rig) setActive(rig);
    if (rig.state === 'idle' || rig.state === 'error') rig.load().then(() => refresh(rig), () => refresh(rig));
    refresh(rig);
  }

  function lost(anchor) {
    anchor.tracked = false;
    const rig = anchor.rig;
    anchor.rig = null;
    if (!rig) return;
    rig.visible = false;
    if (active !== rig) return;
    const other = rigs.find(isShown);
    if (other) return setActive(other);
    // pequena espera: evita o cartão piscar quando o rastreamento falha por um instante
    hideTimer = setTimeout(() => {
      active = null;
      card.hide();
      card.setCaption(null);
    }, 1500);
  }

  // Recorta da imagem da câmera só a região onde o MindAR encontrou o QR code
  // (assim um QR vizinho no cartaz não atrapalha) e tenta lê-lo.
  const cropCanvas = document.createElement('canvas');
  const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
  async function readQr(anchor) {
    const decode = await qrReady;
    const video = mindar.video;
    const crop = video?.videoWidth && anchorRegion(anchor.group, video);
    if (!crop) return null;
    const k = Math.min(1, 480 / Math.max(crop.w, crop.h));
    cropCanvas.width = Math.round(crop.w * k);
    cropCanvas.height = Math.round(crop.h * k);
    cropCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, cropCanvas.width, cropCanvas.height);
    const text = await decode(cropCanvas, cropCtx);
    if (DEBUG) {
      console.log('[nanoar] âncora', TARGETS[anchor.k].id, 'recorte', JSON.stringify(crop), 'leu', text);
      window.__nanoarCrop = cropCanvas.toDataURL();
    }
    return text;
  }

  function anchorRegion(group, video) {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const left = parseFloat(video.style.left) || 0, top = parseFloat(video.style.top) || 0;
    const kx = video.videoWidth / (parseFloat(video.style.width) || cw);
    const ky = video.videoHeight / (parseFloat(video.style.height) || ch);
    group.updateWorldMatrix(true, false);
    const v = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      v.set(x, y, 0).applyMatrix4(group.matrixWorld).project(camera);
      const px = (((v.x + 1) / 2) * cw - left) * kx;
      const py = (((1 - v.y) / 2) * ch - top) * ky;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const m = 0.25 * Math.max(x1 - x0, y1 - y0);
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(video.videoWidth, x1 + m); y1 = Math.min(video.videoHeight, y1 + m);
    if (!(x1 - x0 > 40 && y1 - y0 > 40)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // acessibilidade: sem giro automático com "reduzir movimentos"; botões para girar/ampliar
  const ctrl = $('ctrl');
  $('card').insertBefore(ctrl, $('card').querySelector('.card-actions')); // fica dentro do cartão: nunca cobre nada
  const syncA11y = () => {
    for (const rig of rigs) rig.spinSpeed = prefs.reduceMotion ? 0 : 0.35;
    ctrl.hidden = !(prefs.controls && active && isShown(active) && !active.cfg.placeholder);
    stage.setAttribute('aria-label', active && isShown(active) ? `Imagem da câmera com o modelo 3D: ${active.info.name}` : 'Imagem da câmera');
  };
  window.addEventListener('nanoar:a11y', syncA11y);
  ctrl.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const rig = active;
    if (!act || !rig) return;
    const s = rig.user.scale.x;
    if (act === 'zoom-in') rig.user.scale.setScalar(Math.min(3.5, s * 1.25));
    if (act === 'zoom-out') rig.user.scale.setScalar(Math.max(0.4, s / 1.25));
    if (act === 'left') rig.user.rotation.y -= Math.PI / 8;
    if (act === 'right') rig.user.rotation.y += Math.PI / 8;
    rig.spinHold = 4;
  });

  function play(rig) {
    const done = rig.play();
    refresh(rig);
    done?.then(() => refresh(rig));
  }
  card.onPlay = play;

  attachGestures(stage, {
    getRig: () => active,
    onDragStart: (e) => {
      const rig = pickRig(e, camera, renderer.domElement, rigs.filter(isShown));
      const peel = rig?.beginPeel(camera, renderer.domElement);
      if (!peel) return null;
      if (rig !== active) setActive(rig);
      return {
        move: peel.move,
        end: (...args) => {
          peel.end(...args).then(() => refresh(rig));
          refresh(rig);
        },
      };
    },
    onTap: (e) => {
      const rig = pickRig(e, camera, renderer.domElement, rigs.filter(isShown));
      if (!rig) return;
      if (rig !== active) setActive(rig);
      play(rig);
    },
  });

  try {
    await mindar.start();
  } catch (err) {
    return fail('camera', err);
  }

  showScreen(null);
  announce('Câmera aberta. Aponte para um QR code do cartaz.');
  scan.hidden = false;
  $('test-badge').hidden = !hasLocalTest();
  document.body.classList.add('running');
  keepAwake();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    for (const rig of rigs) if (rig.content) rig.update(dt);
    scan.hidden = !!active || anchors.some((a) => a.tracked);
    const showCtrl = !!(prefs.controls && active && isShown(active) && !active.cfg.placeholder);
    if (ctrl.hidden === showCtrl) syncA11y();
    renderer.render(scene, camera);
  });
}

// Mantém a tela acesa enquanto a câmera está aberta (quando o navegador permite).
function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  const request = () => navigator.wakeLock.request('screen').catch(() => {});
  request();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && request());
}
