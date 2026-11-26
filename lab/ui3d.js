// Painéis e botões 3D (texto desenhado num canvas) + mira do olhar com seleção por tempo.
import * as THREE from 'three';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Painel de texto: largura/altura em metros; `draw(ctx, w, h)` desenha o conteúdo.
export class CanvasPanel extends THREE.Mesh {
  constructor(width, height, { px = 512, draw } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round((px * height) / width);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    super(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawFn = draw;
    this.redraw();
  }
  redraw(...args) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFn?.(ctx, canvas.width, canvas.height, ...args);
    this.material.map.needsUpdate = true;
  }
}

export function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
}

// diminui a fonte até o texto caber na largura
function fitText(ctx, text, maxWidth, size, weight) {
  ctx.font = font(size, weight);
  while (ctx.measureText(text).width > maxWidth && size > 8) ctx.font = font((size -= 1), weight);
}

export function font(size, weight = 600) {
  return `${weight} ${size}px ${FONT}`;
}

// Botão selecionável (olhar, pinça ou voz). `onSelect` é chamado ao selecionar.
export function makeButton(label, { width = 0.22, height = 0.09, sub = '', color = '#12303b', accent = '#4fd1c5', onSelect } = {}) {
  const btn = new CanvasPanel(width, height, {
    px: 384,
    draw: (ctx, w, h, hover = false) => {
      roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.22, hover ? accent : color, hover ? '#ffffff' : 'rgba(255,255,255,0.35)');
      ctx.fillStyle = hover ? '#062b28' : '#eaf3f6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, label, w * 0.86, sub ? h * 0.38 : h * 0.42, 600);
      ctx.fillText(label, w / 2, sub ? h * 0.4 : h / 2);
      if (sub) {
        fitText(ctx, sub, w * 0.86, h * 0.2, 400);
        ctx.fillText(sub, w / 2, h * 0.76);
      }
    },
  });
  btn.userData = { selectable: true, onSelect, label, setHover: (v) => btn.redraw(v) };
  return btn;
}

// Mira no centro da visão: anel que se completa enquanto a pessoa olha para algo selecionável.
export class Gaze {
  constructor({ dwell = 1.2 } = {}) {
    this.dwell = dwell;
    this.group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.014, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.fill = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.022, 32, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, depthTest: false }));
    ring.renderOrder = this.fill.renderOrder = 999;
    this.group.add(ring, this.fill);
    this.raycaster = new THREE.Raycaster();
    this.hover = null;
    this.t = 0;
    this.cooldown = 0;
    this.enabled = true;
  }

  // posiciona a mira a 1 m à frente e verifica o que está sendo olhado
  update(dt, headQuat, targets) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
    this.group.position.copy(dir);
    this.group.quaternion.copy(headQuat);
    this.group.visible = this.enabled;
    if (!this.enabled) return this.setHover(null);
    this.raycaster.set(new THREE.Vector3(), dir);
    const hit = this.raycaster.intersectObjects(targets, true).find((h) => visible(h.object) && findSelectable(h.object));
    const obj = hit && findSelectable(hit.object);
    this.hit = hit || null;
    if (obj !== this.hover) {
      this.setHover(obj);
      this.t = 0;
    }
    if (obj) obj.userData.onHoverMove?.(hit); // ex.: a tabela periódica descobre o elemento apontado
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (obj && this.cooldown === 0) {
      this.t += dt;
      if (this.t >= this.dwell) {
        this.t = 0;
        this.cooldown = 1.0; // evita selecionar de novo sem querer
        obj.userData.onSelect?.('olhar', this.hit);
      }
    } else this.t = 0;
    const k = Math.min(1, this.t / this.dwell);
    this.fill.geometry.dispose();
    this.fill.geometry = new THREE.RingGeometry(0.014, 0.022, 32, 1, Math.PI / 2, Math.max(0.001, k * Math.PI * 2));
  }

  setHover(obj) {
    if (this.hover && this.hover !== obj) this.hover.userData.setHover?.(false);
    if (obj && obj !== this.hover) obj.userData.setHover?.(true);
    this.hover = obj;
  }
}

function visible(o) {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

export function findSelectable(o) {
  while (o) {
    if (o.userData?.selectable) return o;
    o = o.parent;
  }
  return null;
}
