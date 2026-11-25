// Peças compartilhadas pela página de RA (ar.html) e pela administração (admin.html).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GENERATORS, ease } from './structures.js';
import { STYLE } from './targets.js';

const UP = new THREE.Vector3(0, 1, 0);
const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);

// Iluminação: mapa de ambiente gerado na hora (sem baixar imagens HDR) + uma luz direcional.
export function setupLighting(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.5, 1, 1);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x445566, 0.6));
}

// ------------------------------------------------------------ estrutura procedural

// Desenha átomos (esferas) e ligações (cilindros) com InstancedMesh:
// duas chamadas de desenho por grupo, não importa quantos átomos.
export class StructureView extends THREE.Group {
  constructor(data, style = STYLE) {
    super();
    this.data = data;
    this.pos = data.positions.slice();
    this.opacity = new Float32Array(data.nGroups).fill(1);
    this.t = data.rest;
    const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 });
    const bondMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    this.parts = [];
    for (let g = 0; g < data.nGroups; g++) {
      const atoms = [];
      data.groups.forEach((gr, i) => gr === g && atoms.push(i));
      const bonds = [];
      for (let b = 0; b < data.bonds.length; b += 2) if (data.groups[data.bonds[b]] === g) bonds.push(data.bonds[b], data.bonds[b + 1]);
      const atomMesh = new THREE.InstancedMesh(SPHERE, atomMat.clone(), atoms.length);
      const bondMesh = new THREE.InstancedMesh(CYLINDER, bondMat.clone(), bonds.length / 2);
      for (const m of [atomMesh, bondMesh]) {
        m.frustumCulled = false; // as instâncias se movem; a caixa da geometria base não vale
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.add(m);
      }
      this.parts.push({ atoms, bonds, atomMesh, bondMesh });
    }
    this.applyStyle(style);
    this.radius = this.boundingRadius();
  }

  applyStyle(style) {
    this.style = { ...STYLE, ...style };
    for (const part of this.parts) {
      part.atomMesh.material.color.set(this.style.atomColor);
      part.bondMesh.material.color.set(this.style.bondColor);
    }
    this.update();
  }

  boundingRadius() {
    let r = 0;
    for (let i = 0; i < this.pos.length; i += 3) r = Math.max(r, Math.hypot(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
    return r + STYLE.atomRadius;
  }

  setT(t) {
    this.t = t;
    if (this.data.animation) this.data.animation.frame(t, this.pos, this.opacity);
    this.update();
  }

  update() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    const { atomRadius: ar, bondRadius: br } = this.style;
    const p = this.pos;
    this.parts.forEach((part, g) => {
      const o = this.opacity[g];
      for (const mesh of [part.atomMesh, part.bondMesh]) {
        mesh.visible = o > 0.01;
        mesh.material.opacity = o;
        const transparent = o < 0.999;
        if (mesh.material.transparent !== transparent) {
          mesh.material.transparent = transparent;
          mesh.material.needsUpdate = true;
        }
      }
      if (o <= 0.01) return;
      part.atoms.forEach((i, k) => {
        m.makeScale(ar, ar, ar).setPosition(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
        part.atomMesh.setMatrixAt(k, m);
      });
      for (let k = 0; k < part.bonds.length; k += 2) {
        const i = part.bonds[k], j = part.bonds[k + 1];
        a.set(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
        b.set(p[3 * j], p[3 * j + 1], p[3 * j + 2]);
        d.subVectors(b, a);
        const len = d.length();
        // ligações muito esticadas (ex.: a "costura" do nanotubo ainda aberta) ficam invisíveis
        const vis = THREE.MathUtils.clamp((2.15 - len) / 0.4, 0, 1);
        q.setFromUnitVectors(UP, d.multiplyScalar(1 / (len || 1)));
        s.set(br * vis, len, br * vis);
        m.compose(a.add(b).multiplyScalar(0.5), q, s);
        part.bondMesh.setMatrixAt(k / 2, m);
      }
      part.atomMesh.instanceMatrix.needsUpdate = true;
      part.bondMesh.instanceMatrix.needsUpdate = true;
    });
  }
}

// ------------------------------------------------------------ modelos .glb

let gltfLoader;
function loader() {
  if (!gltfLoader) {
    const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/libs/draco/gltf/');
    gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  }
  return gltfLoader;
}

async function createContent(cfg, style) {
  if (cfg.placeholder) return { object: new THREE.Group(), radius: 0.5, view: null };
  if (cfg.structure) {
    const view = new StructureView(GENERATORS[cfg.structure](cfg.params || {}), style);
    return { object: view, radius: view.radius, view };
  }
  const gltf = await loader().loadAsync(cfg.model);
  const obj = gltf.scene;
  const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
  obj.position.sub(sphere.center);
  const group = new THREE.Group();
  group.add(obj);
  return { object: group, radius: sphere.radius, view: null };
}

// ------------------------------------------------------------ animação

// Executa uma sequência de trechos {from, to, dur, caption} sobre o parâmetro t da estrutura.
export class Animator {
  constructor(view, onCaption) {
    this.view = view;
    this.onCaption = onCaption;
    this.segments = [];
  }
  get busy() {
    return this.segments.length > 0;
  }
  play(segments) {
    return new Promise((resolve) => {
      this.segments = segments.map((s) => ({ ...s, elapsed: 0, started: false }));
      this.resolve = resolve;
    });
  }
  update(dt) {
    const s = this.segments[0];
    if (!s) return;
    if (!s.started) {
      s.started = true;
      this.onCaption?.(s.caption ?? null);
    }
    s.elapsed += dt;
    const k = Math.min(1, s.elapsed / s.dur);
    this.view.setT(s.from + (s.to - s.from) * ease(k));
    if (k >= 1) {
      this.segments.shift();
      if (!this.segments.length) {
        this.onCaption?.(null);
        this.resolve?.();
      }
    }
  }
}

// ------------------------------------------------------------ "rig" de cada estrutura

// Hierarquia: Rig (posição) → user (gestos: giro e zoom) → tilt (inclinação) → spin (giro automático) → conteúdo
export class Rig extends THREE.Group {
  constructor(cfg, { lift = 0, style = STYLE } = {}) {
    super();
    this.cfg = cfg;
    this.style = style;
    this.position.z = lift;
    this.user = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.tiltGroup.rotation.x = THREE.MathUtils.degToRad(cfg.tilt || 0);
    this.spin = new THREE.Group();
    this.add(this.user);
    this.user.add(this.tiltGroup);
    this.tiltGroup.add(this.spin);
    this.spinSpeed = 0.35; // rad/s
    this.spinHold = 0;
    this.state = 'idle';
    this.content = null;
    this.animator = null;
    this.onCaption = null;
  }

  load() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.loading = createContent(this.cfg, this.style).then(
      (c) => {
        this.content = c;
        c.object.scale.setScalar((this.cfg.size ?? 1) / (2 * c.radius));
        this.spin.add(c.object);
        if (c.view) this.animator = new Animator(c.view, (txt) => this.onCaption?.(txt));
        this.state = 'ready';
        return c;
      },
      (err) => {
        this.state = 'error';
        this.loading = null;
        throw err;
      },
    );
    return this.loading;
  }

  get busy() {
    return !!this.animator?.busy || !!this.dragging;
  }

  // Esfoliação com o dedo (modo 'steps'): a camada de cima acompanha o arraste e é jogada
  // na direção do gesto. `camera`/`canvas` servem para converter o movimento do dedo na tela
  // para as coordenadas da estrutura (funciona com o celular e o cartaz em qualquer ângulo).
  // Devolve { move(dx, dy), end(dx, dy, vx, vy) } ou null se não houver camada para descolar.
  beginPeel(camera, canvas) {
    const v = this.content?.view;
    const anim = v?.data.animation;
    if (this.cfg.animation?.mode !== 'steps' || !anim || this.busy) return null;
    const k = Math.round(v.t);
    if (k >= anim.maxT) return null;
    this.dragging = true;
    const dist = Math.max(140, window.innerWidth * 0.45); // arraste (px) para descolar por completo
    const progress = (dx, dy) => Math.min(0.9, Math.hypot(dx, dy) / dist);
    const obj = this.content.object;
    const r = this.content.radius;
    const project = (x, y) => {
      const rect = canvas.getBoundingClientRect();
      const p = new THREE.Vector3(x, y, 0).applyMatrix4(obj.matrixWorld).project(camera);
      return [((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height];
    };
    // resolve (a, b) tal que o arraste na tela = a·(eixo x da estrutura) + b·(eixo y), ambos projetados
    const aim = (dx, dy) => {
      obj.updateWorldMatrix(true, false);
      const o = project(0, 0), px = project(r, 0), py = project(0, r);
      const ax = [px[0] - o[0], px[1] - o[1]], ay = [py[0] - o[0], py[1] - o[1]];
      const det = ax[0] * ay[1] - ax[1] * ay[0];
      if (Math.abs(det) < 1e-6) return anim.setDirection(dx, -dy);
      anim.setDirection((dx * ay[1] - dy * ay[0]) / det, (ax[0] * dy - ax[1] * dx) / det);
    };
    return {
      move: (dx, dy) => {
        if (Math.hypot(dx, dy) > 6) aim(dx, dy);
        v.setT(k + progress(dx, dy));
      },
      end: (dx = 0, dy = 0, vx = 0, vy = 0) => {
        this.dragging = false;
        const p = progress(dx, dy);
        const len = Math.hypot(dx, dy) || 1;
        const flick = (vx * dx + vy * dy) / len > 0.5; // jogada rápida na direção do arraste
        const done = p > 0.33 || flick;
        return this.animator.play([{ from: v.t, to: done ? k + 1 : k, dur: done ? 0.4 + (1 - p) * 0.8 : 0.35 }]);
      },
    };
  }

  // Modo 'steps' (grafite): quantas camadas existem e quantas sobram agora
  get stack() {
    const v = this.content?.view;
    if (this.cfg.animation?.mode !== 'steps' || !v?.data.animation) return null;
    const total = v.data.animation.maxT + 1;
    return { total, remaining: total - Math.round(v.t) };
  }

  // Textos atuais do cartão (mudam conforme a animação avança)
  get info() {
    const a = this.cfg.animation;
    const v = this.content?.view;
    if (a?.mode === 'toggle' && v && v.t > 0.5) return { ...this.cfg, ...a.after };
    const layers = this.stack;
    if (layers) {
      const stage = a.stages?.find((s) => s.layers === layers.remaining);
      if (stage) return { ...this.cfg, note: null, facts: null, ...stage };
    }
    return this.cfg;
  }

  get actionLabel() {
    const a = this.cfg.animation;
    if (!a || !this.content?.view) return null;
    if (a.mode === 'toggle') return this.content.view.t > 0.5 ? a.undo : a.action;
    if (a.mode === 'steps') return this.stack.remaining > 1 ? a.action : a.undo;
    return a.action;
  }

  play() {
    const a = this.cfg.animation;
    const v = this.content?.view;
    if (!a || !v || this.busy) return null;
    if (a.mode === 'toggle') {
      const to = v.t < 0.5 ? 1 : 0;
      return this.animator.play([{ from: v.t, to, dur: to ? 2.6 : 1.6 }]);
    }
    if (a.mode === 'steps') {
      const max = v.data.animation.maxT;
      const k = Math.round(v.t);
      return this.animator.play(k < max ? [{ from: v.t, to: k + 1, dur: 1.6 }] : [{ from: v.t, to: 0, dur: 2.2 }]);
    }
    const [first, middle, last] = a.steps;
    const segs = [];
    if (v.t > 0.01) segs.push({ from: v.t, to: 0, dur: 1.0, caption: first });
    segs.push(
      { from: 0, to: 0, dur: 1.0, caption: first },
      { from: 0, to: 1, dur: 3.4, caption: middle },
      { from: 1, to: 1, dur: 1.8, caption: last },
    );
    return this.animator.play(segs);
  }

  update(dt) {
    this.animator?.update(dt);
    const r = this.spin.rotation.y;
    if (this.busy) {
      // durante a animação, volta suavemente a ficar de frente
      const front = Math.round(r / (2 * Math.PI)) * 2 * Math.PI;
      this.spin.rotation.y += (front - r) * Math.min(1, dt * 4);
    } else if (this.spinHold > 0) {
      this.spinHold -= dt;
    } else {
      this.spin.rotation.y = r + this.spinSpeed * dt;
    }
  }

  applyStyle(style) {
    this.style = style;
    this.content?.view?.applyStyle(style);
  }

  resetUser() {
    this.user.rotation.set(0, 0, 0);
    this.user.scale.setScalar(1);
  }

  // Esfera envolvente no mundo (para detectar toques)
  worldSphere() {
    if (!this.content) return null;
    this.updateWorldMatrix(true, true);
    return new THREE.Sphere(new THREE.Vector3(), this.content.radius).applyMatrix4(this.content.object.matrixWorld);
  }
}

// ------------------------------------------------------------ gestos

// Um dedo: girar · dois dedos: pinça para ampliar/reduzir · toque rápido: onTap · roda do mouse: zoom.
// onDragStart(evento) pode "tomar" o arraste (ex.: descolar a camada do grafite com o dedo):
// devolve { move(dx, dy), end(dx, dy, vx, vy) } ou null para girar normalmente.
export function attachGestures(el, { getRig, onTap, onDragStart, minScale = 0.4, maxScale = 3.5 }) {
  const pointers = new Map();
  let start = null, pinch = null;

  const cancelHandler = () => {
    if (start?.handler) {
      start.handler.end(0, 0, 0, 0); // volta a camada para o lugar
      start.handler = null;
    }
  };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, time: performance.now(), moved: false, handler: null, vx: 0, vy: 0, lastX: e.clientX, lastY: e.clientY, lastT: performance.now() };
    }
    if (pointers.size === 2) {
      cancelHandler();
      const rig = getRig();
      const [p, q] = [...pointers.values()];
      pinch = rig && { rig, dist: Math.hypot(p.x - q.x, p.y - q.y), scale: rig.user.scale.x };
      if (start) start.moved = true;
    }
  });

  el.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size >= 2 && pinch) {
      const [p, q] = [...pointers.values()];
      const s = THREE.MathUtils.clamp((pinch.scale * Math.hypot(p.x - q.x, p.y - q.y)) / (pinch.dist || 1), minScale, maxScale);
      pinch.rig.user.scale.setScalar(s);
      pinch.rig.spinHold = 2.5;
    } else if (pointers.size === 1 && start) {
      if (!start.moved && Math.hypot(cur.x - start.x, cur.y - start.y) > 8) {
        start.moved = true;
        start.handler = onDragStart?.(start) || null;
      }
      if (!start.moved) return;
      const now = performance.now();
      const dt = Math.max(1, now - start.lastT);
      start.vx = (cur.x - start.lastX) / dt;
      start.vy = (cur.y - start.lastY) / dt;
      start.lastX = cur.x;
      start.lastY = cur.y;
      start.lastT = now;
      if (start.handler) return start.handler.move(cur.x - start.x, cur.y - start.y);
      const rig = getRig();
      if (!rig) return;
      rig.user.rotation.y += (cur.x - prev.x) * 0.01;
      rig.user.rotation.x = THREE.MathUtils.clamp(rig.user.rotation.x + (cur.y - prev.y) * 0.01, -1.5, 1.5);
      rig.spinHold = 2.5;
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && start) {
      if (start.handler) start.handler.end(e.clientX - start.x, e.clientY - start.y, start.vx, start.vy);
      else if (!start.moved && performance.now() - start.time < 350) onTap?.(e);
      start = null;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', (e) => {
    cancelHandler();
    end(e);
  });

  el.addEventListener('wheel', (e) => {
    const rig = getRig();
    if (!rig) return;
    e.preventDefault();
    rig.user.scale.setScalar(THREE.MathUtils.clamp(rig.user.scale.x * Math.exp(-e.deltaY * 0.0015), minScale, maxScale));
  }, { passive: false });

  // Safari iOS: impede o zoom da página inteira com pinça
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}

// Raio a partir de um toque na tela → qual rig foi tocado (o mais próximo da câmera)
export function pickRig(e, camera, canvas, rigs) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  let best = null, bestDist = Infinity;
  for (const rig of rigs) {
    const sphere = rig.worldSphere();
    if (!sphere) continue;
    sphere.radius *= 1.1; // toque um pouco "generoso"
    const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
    if (hit) {
      const d = hit.distanceTo(ray.ray.origin);
      if (d < bestDist) { bestDist = d; best = rig; }
    }
  }
  return best;
}
