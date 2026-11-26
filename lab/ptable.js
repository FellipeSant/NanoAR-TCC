// Tabela periódica completa (118 elementos) em 3D, curvada à frente da pessoa.
// A tabela inteira é desenhada UMA vez num canvas (uma textura, uma chamada de desenho);
// o raio (mão/olhar) diz em que ponto da imagem acertou e daí sai o elemento.
import * as THREE from 'three';
import { roundRect, font } from './ui3d.js';

export const CATEGORY = {
  alcalino: { label: 'Metais alcalinos', color: '#e8743b' },
  'alcalino-terroso': { label: 'Metais alcalino-terrosos', color: '#e0b030' },
  transicao: { label: 'Metais de transição', color: '#d65a7a' },
  'pos-transicao': { label: 'Outros metais', color: '#8a9bb0' },
  semimetal: { label: 'Semimetais', color: '#3fb6a8' },
  'nao-metal': { label: 'Não metais', color: '#4caf6a' },
  halogenio: { label: 'Halogênios', color: '#2fa3d9' },
  'gas-nobre': { label: 'Gases nobres', color: '#8f6ad6' },
  lantanideo: { label: 'Lantanídeos', color: '#c06cc0' },
  actinideo: { label: 'Actinídeos', color: '#b05555' },
  desconhecido: { label: 'Desconhecido', color: '#666666' },
};

const CW = 2048, CH = 1280; // tamanho do canvas
const MX = 34, MY = 40; // margens
const CELL_W = (CW - 2 * MX) / 18, CELL_H = 124;
const rowY = (r) => MY + (r <= 6 ? r * CELL_H : 7 * CELL_H + 30 + (r - 8) * CELL_H);

export async function loadElements(url = new URL('./data/elements.json', import.meta.url)) {
  const list = await (await fetch(url)).json();
  // formato usado pelo laboratório (compatível com o motor químico)
  return list.map((e) => ({
    z: e.z, sym: e.s, name: e.n, n: e.a != null ? e.a - e.z : null, valence: e.val, ve: e.ve,
    color: e.cpk === '#ffffff' ? '#f2f2f2' : e.cpk, en: e.en, data: e,
    words: [e.n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()],
  }));
}

export class PeriodicTable extends THREE.Group {
  constructor(elements, { width = 1.6, radius = 1.3, onSelect, onHover } = {}) {
    super();
    this.elements = elements;
    this.byCell = new Map(elements.map((el) => [`${el.data.row},${el.data.col}`, el]));
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.draw();
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    // plano dobrado num arco (as bordas vêm para perto da pessoa): tudo fica de frente
    const height = (width * CH) / CW;
    const geo = new THREE.PlaneGeometry(width, height, 48, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), ang = x / radius;
      pos.setXYZ(i, radius * Math.sin(ang), pos.getY(i), radius * (1 - Math.cos(ang)));
    }
    geo.computeVertexNormals();
    this.width = width;
    this.height = height;
    this.radius = radius;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    this.mesh.userData = {
      selectable: true,
      onSelect: (source, hit) => {
        const el = hit && this.elementAt(hit.uv);
        if (el) onSelect?.(el, source);
      },
      setHover: (v) => {
        if (!v) this.showHighlight(null);
      },
      onHoverMove: (hit) => {
        const el = hit && this.elementAt(hit.uv);
        this.showHighlight(el);
        if (el && el !== this.hovered) onHover?.(el);
        this.hovered = el || null;
      },
    };
    this.add(this.mesh);
    // destaque do elemento apontado
    const hw = (CELL_W / CW) * width, hh = (CELL_H / CH) * height;
    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 1.06, hh * 1.06),
      new THREE.MeshBasicMaterial({ map: highlightTexture(), transparent: true, depthWrite: false }),
    );
    this.highlight.visible = false;
    this.add(this.highlight);
  }

  // canvas → coordenadas da textura (uv)
  elementAt(uv) {
    if (!uv) return null;
    const x = uv.x * CW, y = (1 - uv.y) * CH;
    const col = Math.floor((x - MX) / CELL_W);
    let row = null;
    for (const r of [0, 1, 2, 3, 4, 5, 6, 8, 9]) if (y >= rowY(r) && y < rowY(r) + CELL_H) row = r;
    if (row === null || col < 0 || col > 17) return null;
    return this.byCell.get(`${row},${col}`) || null;
  }

  // centro do quadradinho de um elemento (no referencial da tabela) e o ângulo da curva ali
  tilePosition(el) {
    const { row, col } = el.data;
    const cx = MX + (col + 0.5) * CELL_W, cy = rowY(row) + CELL_H / 2;
    const x = (cx / CW - 0.5) * this.width, y = (0.5 - cy / CH) * this.height;
    const ang = x / this.radius;
    return { position: new THREE.Vector3(this.radius * Math.sin(ang), y, this.radius * (1 - Math.cos(ang))), angle: ang };
  }

  showHighlight(el) {
    this.highlight.visible = !!el;
    if (!el) return;
    const { position, angle } = this.tilePosition(el);
    this.highlight.position.copy(position).setZ(position.z + 0.004);
    this.highlight.rotation.y = -angle;
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);
    roundRect(ctx, 4, 4, CW - 8, CH - 8, 36, 'rgba(10,24,31,0.86)', 'rgba(79,209,197,0.55)');
    for (const el of this.elements) this.drawCell(ctx, el);
    // marcadores dos lantanídeos e actinídeos no grupo 3
    for (const [row, text, sub] of [[5, '57–71', 'lantanídeos'], [6, '89–103', 'actinídeos']]) {
      const x = MX + 2 * CELL_W + 4, y = rowY(row) + 4;
      roundRect(ctx, x, y, CELL_W - 8, CELL_H - 8, 12, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.25)');
      ctx.fillStyle = '#bfd3db';
      ctx.textAlign = 'center';
      ctx.font = font(24, 600);
      ctx.fillText(text, x + CELL_W / 2 - 4, y + 52);
      ctx.font = font(17, 400);
      ctx.fillText(sub, x + CELL_W / 2 - 4, y + 82);
    }
    // título e legenda no espaço vazio do alto
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eaf3f6';
    ctx.font = font(40, 700);
    ctx.fillText('Tabela periódica', MX + 2.2 * CELL_W, MY + 44);
    ctx.font = font(22, 400);
    ctx.fillStyle = '#9fb6c1';
    ctx.fillText('Aponte para ver a ficha · pince para criar o átomo', MX + 2.2 * CELL_W, MY + 80);
    const cats = Object.entries(CATEGORY).filter(([k]) => k !== 'desconhecido');
    cats.forEach(([, c], i) => {
      const x = MX + 2.2 * CELL_W + (i % 5) * 2.1 * CELL_W, y = MY + 116 + Math.floor(i / 5) * 40;
      roundRect(ctx, x, y - 20, 26, 26, 6, c.color);
      ctx.fillStyle = '#d3e2e8';
      ctx.font = font(20, 400);
      ctx.fillText(c.label, x + 34, y);
    });
  }

  drawCell(ctx, el) {
    const { row, col, c, radio } = el.data;
    const x = MX + col * CELL_W + 4, y = rowY(row) + 4, w = CELL_W - 8, h = CELL_H - 8;
    const color = (CATEGORY[c] || CATEGORY.desconhecido).color;
    roundRect(ctx, x, y, w, h, 12, shade(color, 0.42), color);
    ctx.fillStyle = '#eaf3f6';
    ctx.textAlign = 'left';
    ctx.font = font(20, 600);
    ctx.fillText(String(el.z), x + 9, y + 24);
    if (radio) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd400';
      ctx.fillText('☢', x + w - 8, y + 24);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(48, 700);
    ctx.fillText(el.sym, x + w / 2, y + 72);
    let size = 16;
    ctx.font = font(size, 400);
    while (ctx.measureText(el.name).width > w - 8 && size > 10) ctx.font = font((size -= 1), 400);
    ctx.fillStyle = '#d3e2e8';
    ctx.fillText(el.name, x + w / 2, y + h - 12);
  }
}

function shade(hex, k) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function highlightTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 112, 16);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ficha do elemento (texto do painel ao lado da tabela)
export function elementLines(el) {
  const d = el.data;
  const sup = (s) => s.replace(/([spdf])(\d+)/g, (_, l, n) => l + String(n).replace(/\d/g, (x) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[x]));
  const layers = 'KLMNOPQ';
  return {
    title: `${el.name} (${el.sym})`,
    tag: (CATEGORY[d.c] || CATEGORY.desconhecido).label,
    rows: [
      `Número atômico (Z): ${el.z}  ·  massa: ${d.m ?? '—'} u`,
      `Configuração: ${sup(d.cfg) || '—'}`,
      `Camadas: ${d.sh.map((n, i) => `${layers[i]} ${n}`).join(' · ')}`,
      `Eletronegatividade: ${d.en ?? '—'}  ·  ${d.st ? `${d.st} a 25 °C` : 'estado desconhecido'}`,
      `Isótopo mais comum/estável: ${el.sym}-${d.a ?? '?'} (${el.z} p⁺, ${el.n ?? '?'} n⁰)`,
      `${d.radio ? '☢ Radioativo · ' : ''}${d.y ? `descoberto em ${d.y}` : 'conhecido desde a Antiguidade'}`,
    ],
  };
}
