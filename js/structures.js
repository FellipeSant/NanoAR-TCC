// Estruturas de carbono geradas por código (unidades em ångström).
//
// Em vez de baixar modelos 3D pesados, cada estrutura é calculada aqui a partir da sua
// geometria real (ligação C–C de 1,42 Å no grafeno, 1,54 Å no diamante, 3,35 Å entre
// camadas do grafite...). Isso deixa o site leve e permite animar átomo por átomo.
//
// Cada gerador devolve:
//   positions  Float32Array (x, y, z por átomo) no estado padrão
//   bonds      Uint16Array  (pares de índices de átomos)
//   groups     Uint8Array   (grupo de cada átomo; grupos podem sumir/aparecer separadamente)
//   nGroups    número de grupos
//   animation  (opcional) { kind, frame(t, out, opacity) } — t = 0..1
//   rest       valor de t do estado padrão
//
// Orientação: Y é o "para cima" do cartaz e +Z aponta para quem está olhando.
//
// Opcionais (usados pelo DNA): colorIndex + palette (cor de cada átomo; null = cor do admin),
// bondGroups (grupo de cada ligação), hbonds (ligações de hidrogênio, finas) + hbondGroup,
// animation.palette(t) (cores que mudam), animation.zoom(t) (ampliação) e radiusScale (átomos mais grossos).
import { NUCLEOTIDES, TWIST, RISE } from './dna-templates.js';

const CC = 1.42; // ligação C–C no grafeno (Å)
const A = CC * Math.sqrt(3); // parâmetro de rede do grafeno, 2,46 Å
const INTERLAYER = 3.35; // distância entre camadas do grafite (Å)

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ------------------------------------------------------------------ utilitários

// Liga átomos mais próximos que `maxLen`. `periodX` trata x como periódico (nanotubo).
function findBonds(pos, maxLen, periodX = 0) {
  const n = pos.length / 3;
  const cell = maxLen;
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const wrapCells = periodX ? Math.max(1, Math.floor(periodX / cell)) : 0;
  const cx = (x) => {
    let c = Math.floor(x / cell);
    return wrapCells ? ((c % wrapCells) + wrapCells) % wrapCells : c;
  };
  for (let a = 0; a < n; a++) {
    const k = key(cx(pos[3 * a]), Math.floor(pos[3 * a + 1] / cell), Math.floor(pos[3 * a + 2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(a);
  }
  const bonds = [];
  const seenPairs = new Set(); // com x periódico, a mesma célula vizinha pode aparecer duas vezes
  const max2 = maxLen * maxLen;
  for (let a = 0; a < n; a++) {
    const i0 = cx(pos[3 * a]), j0 = Math.floor(pos[3 * a + 1] / cell), k0 = Math.floor(pos[3 * a + 2] / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      let i = i0 + di;
      if (wrapCells) i = ((i % wrapCells) + wrapCells) % wrapCells;
      const list = grid.get(key(i, j0 + dj, k0 + dk));
      if (!list) continue;
      for (const b of list) {
        if (b <= a) continue;
        let dx = pos[3 * b] - pos[3 * a];
        if (periodX) dx -= periodX * Math.round(dx / periodX);
        const dy = pos[3 * b + 1] - pos[3 * a + 1], dz = pos[3 * b + 2] - pos[3 * a + 2];
        if (dx * dx + dy * dy + dz * dz < max2 && !seenPairs.has(a * 65536 + b)) {
          seenPairs.add(a * 65536 + b);
          bonds.push(a, b);
        }
      }
    }
  }
  return new Uint16Array(bonds);
}

// Remove átomos com menos de `minBonds` ligações (bordas "penduradas"), repetindo até estabilizar.
function prune(atoms, maxLen, minBonds = 2) {
  let list = atoms;
  for (;;) {
    const pos = new Float32Array(list.flatMap((a) => a.slice(0, 3)));
    const bonds = findBonds(pos, maxLen);
    const deg = new Uint8Array(list.length);
    for (const i of bonds) deg[i]++;
    const keep = list.filter((_, i) => deg[i] >= minBonds);
    if (keep.length === list.length) return list;
    list = keep;
  }
}

function pack(atoms, { maxLen = 1.6, periodX = 0, animation = null, rest = 0 } = {}) {
  const positions = new Float32Array(atoms.length * 3);
  const groups = new Uint8Array(atoms.length);
  atoms.forEach((a, i) => {
    positions.set([a[0], a[1], a[2]], 3 * i);
    groups[i] = a[3] || 0;
  });
  // centraliza
  const c = [0, 1, 2].map((k) => {
    let min = Infinity, max = -Infinity;
    for (let i = k; i < positions.length; i += 3) { min = Math.min(min, positions[i]); max = Math.max(max, positions[i]); }
    return (min + max) / 2;
  });
  for (let i = 0; i < positions.length; i++) positions[i] -= c[i % 3];
  const bonds = findBonds(positions, maxLen, periodX);
  return { positions, bonds, groups, nGroups: Math.max(...groups) + 1, animation, rest };
}

// Folha de grafeno retangular no plano XY (bordas zigue-zague ao longo de x).
// Célula retangular A × 3·CC com 4 átomos.
function grapheneAtoms(nx, ny, { shift = [0, 0], periodic = false } = {}) {
  const basis = [[0, 0], [A / 2, CC / 2], [A / 2, 1.5 * CC], [0, 2 * CC]];
  const atoms = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (const [bx, by] of basis) {
    let x = i * A + bx + shift[0];
    if (periodic) x = ((x % (nx * A)) + nx * A) % (nx * A);
    atoms.push([x, j * 3 * CC + by + shift[1], 0]);
  }
  return atoms;
}

// ------------------------------------------------------------------ estruturas

// Grafeno: uma camada, deitada (plano XZ).
export function graphene({ nx = 9, ny = 5 } = {}) {
  const atoms = prune(grapheneAtoms(nx, ny), 1.6).map(([x, y]) => [x, 0, y]);
  return pack(atoms);
}

// Grafite: camadas de grafeno com empilhamento AB (Bernal), deitadas (camada 0 embaixo).
// Animação "peel" (esfoliação camada por camada): t vai de 0 até layers − 1;
// cada unidade de t descola a camada de cima como uma fita adesiva, na direção em que
// a pessoa a joga (setDirection). Sobra uma: o grafeno.
export function graphite({ nx = 7, ny = 4, layers = 5 } = {}) {
  const atoms = [];
  const mid = (layers - 1) / 2;
  for (let l = 0; l < layers; l++) {
    const shift = l % 2 ? [0, CC] : [0, 0]; // camada B deslocada de uma ligação
    for (const [x, y] of prune(grapheneAtoms(nx, ny, { shift }), 1.6)) atoms.push([x, (l - mid) * INTERLAYER, y, l]);
  }
  const s = pack(atoms);
  const base = s.positions.slice();
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < base.length; i += 3) { minX = Math.min(minX, base[i]); maxX = Math.max(maxX, base[i]); }
  const width = maxX - minX;
  s.animation = {
    kind: 'peel',
    maxT: layers - 1,
    // Direção (no plano x–y da estrutura: x = de lado, y = para fora da pilha) em que a camada é jogada.
    dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    setDirection(x, y) {
      const len = Math.hypot(x, y);
      if (len < 1e-6) return;
      x /= len;
      y /= len;
      if (y < 0.3) { // sempre um pouco para cima (para fora da pilha), nunca para dentro dela
        y = 0.3;
        x = (x < 0 ? -1 : 1) * Math.sqrt(1 - y * y);
      }
      this.dir = { x, y };
    },
    frame(t, out, opacity) {
      const d = this.dir.x < 0 ? -1 : 1; // jogar para a esquerda = espelhar a animação
      const ux = Math.abs(this.dir.x), uy = this.dir.y;
      const pivot = d > 0 ? minX : -maxX; // borda de trás (em x espelhado)
      const fly = width * 1.5;
      // a pilha que sobra continua centralizada
      const recenter = (t * INTERLAYER) / 2;
      for (let g = 0; g < s.nGroups; g++) {
        const p = clamp01(t - (layers - 1 - g)); // progresso da camada g (de cima para baixo)
        opacity[g] = 1 - ease(clamp01((p - 0.45) / 0.55));
      }
      for (let i = 0; i < s.groups.length; i++) {
        const g = s.groups[i];
        const p = clamp01(t - (layers - 1 - g));
        let x = base[3 * i] * d, y = base[3 * i + 1];
        if (p > 0) {
          // 1) a camada se solta: a borda da frente levanta girando em torno da borda de trás
          //    (mais inclinada quanto mais de lado for o gesto; reto para cima, sobe "deitada")
          const a = ease(clamp01(p / 0.55));
          const ang = a * 0.75 * ux;
          const yl = (g - mid) * INTERLAYER;
          const dx = x - pivot, dy = y - yl;
          x = pivot + dx * Math.cos(ang) - dy * Math.sin(ang);
          y = yl + dx * Math.sin(ang) + dy * Math.cos(ang) + a * INTERLAYER * 0.8 * (1 - ux);
          // 2) e sai voando na direção em que foi jogada
          const b = ease(clamp01((p - 0.45) / 0.55));
          x += fly * ux * b;
          y += fly * uy * b;
        }
        out[3 * i] = x * d;
        out[3 * i + 1] = y + recenter;
        out[3 * i + 2] = base[3 * i + 2];
      }
    },
  };
  return s;
}

// Nanotubo zigue-zague (n,0): uma folha de grafeno enrolada em torno do eixo Y.
// Animação "roll": t = 0 folha plana (de frente para quem olha) → t = 1 tubo fechado.
export function nanotube({ n = 12, cells = 8 } = {}) {
  const C = n * A; // circunferência
  const flat = grapheneAtoms(n, cells, { periodic: true });
  const s = pack(flat.map(([x, y]) => [x, y, 0]), { periodX: C, rest: 1 });
  // pack() centralizou x e y; a costura (x = ±C/2) fica nas bordas da folha
  const base = s.positions.slice();
  s.animation = {
    kind: 'roll',
    frame(t, out, opacity) {
      opacity.fill(1);
      const k = (t * 2 * Math.PI) / C; // curvatura
      let mz = 0;
      for (let i = 0; i < base.length / 3; i++) {
        const u = base[3 * i];
        let x = u, z = 0;
        if (k > 1e-6) { x = Math.sin(k * u) / k; z = -(1 - Math.cos(k * u)) / k; }
        out[3 * i] = x;
        out[3 * i + 1] = base[3 * i + 1];
        out[3 * i + 2] = z;
        mz += z;
      }
      mz /= base.length / 3;
      for (let i = 2; i < out.length; i += 3) out[i] -= mz;
    },
  };
  s.animation.frame(1, s.positions, new Float32Array(1));
  return s;
}

// Fulereno C60 (icosaedro truncado).
// Animação "curl": t = 0 um floco plano de carbono → curva-se como uma tigela → t = 1 esfera fechada.
export function fullerene() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [];
  const signs = (v) => {
    let out = [[]];
    for (const c of v) out = out.flatMap((p) => (c === 0 ? [[...p, 0]] : [[...p, c], [...p, -c]]));
    return out;
  };
  for (const v of [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, phi ** 3]]) {
    for (const [x, y, z] of signs(v)) raw.push([x, y, z], [y, z, x], [z, x, y]); // permutações cíclicas
  }
  // aresta = 2 → escala para 1,42 Å; gira para que o centro de um hexágono (eixo 1,1,1) aponte para +Z
  const scale = CC / 2;
  const axis = [1, 1, 1].map((v) => v / Math.sqrt(3));
  const atoms = raw.map((p) => rotateTo(p.map((v) => v * scale), axis, [0, 0, 1]));
  const R = Math.hypot(...atoms[0]);
  // coordenadas "do floco": ângulo polar a partir do polo +Z e azimute
  const polar = atoms.map(([x, y, z]) => [Math.acos(Math.max(-1, Math.min(1, z / R))), Math.atan2(y, x)]);
  const s = pack(atoms, { maxLen: 1.6, rest: 1 }); // mantém a ordem dos átomos (já centrados)
  s.animation = {
    kind: 'curl',
    frame(t, out, opacity) {
      opacity.fill(1);
      // Projeção de área igual quando plano (densidade uniforme, como um floco de grafeno)
      // e curvatura crescente até fechar a esfera de raio R.
      const k = t / R;
      let mx = 0, my = 0, mz = 0;
      polar.forEach(([theta, az], i) => {
        const sFlat = 2 * R * Math.sin(theta / 2);
        const sArc = sFlat + (R * theta - sFlat) * t;
        let r = sArc, z = 0;
        if (k > 1e-6) { r = Math.sin(sArc * k) / k; z = -(1 - Math.cos(sArc * k)) / k; }
        out[3 * i] = r * Math.cos(az);
        out[3 * i + 1] = r * Math.sin(az);
        out[3 * i + 2] = z;
        mx += out[3 * i]; my += out[3 * i + 1]; mz += z;
      });
      const n = polar.length;
      for (let i = 0; i < n; i++) { out[3 * i] -= mx / n; out[3 * i + 1] -= my / n; out[3 * i + 2] -= mz / n; }
    },
  };
  return s;
}

// Diamante: rede cúbica do diamante (cela convencional a = 3,567 Å), bloco 2×2×2.
export function diamond({ cells = 2 } = {}) {
  const a = 3.567;
  const fcc = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
  const basis = [...fcc, ...fcc.map(([x, y, z]) => [x + 0.25, y + 0.25, z + 0.25])];
  const seen = new Set();
  const atoms = [];
  for (let i = -1; i <= cells; i++) for (let j = -1; j <= cells; j++) for (let k = -1; k <= cells; k++) {
    for (const [bx, by, bz] of basis) {
      const p = [(i + bx) * a, (j + by) * a, (k + bz) * a];
      if (p.some((v) => v < -1e-6 || v > cells * a + 1e-6)) continue;
      const key = p.map((v) => v.toFixed(3)).join();
      if (!seen.has(key)) { seen.add(key); atoms.push(p); }
    }
  }
  return pack(prune(atoms, 1.7, 2), { maxLen: 1.7 });
}

function rotateTo(p, from, to) {
  // Rotação de Rodrigues que leva o vetor unitário `from` em `to`.
  const [ax, ay, az] = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
  const sin = Math.hypot(ax, ay, az), cos = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (sin < 1e-9) return p.slice();
  const k = [ax / sin, ay / sin, az / sin];
  const dot = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
  const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
  return [0, 1, 2].map((i) => p[i] * cos + cr[i] * sin + k[i] * dot * (1 - cos));
}

// ------------------------------------------------------------------ DNA

// DNA-B (dupla hélice), montado degrau por degrau: cada par de bases é o anterior girado 36° em
// torno do eixo (y) e 3,38 Å mais alto. Os moldes de cada nucleotídeo vêm de js/dna-templates.js
// (tools/build_dna.py). Só C, N, O e P aparecem (os hidrogênios ficam de fora, como no carbono).
//
// Animação em etapas (t = 0 DNA → 1 RNA → 2 bases soltas):
//   0 → 1  as ligações de hidrogênio se rompem e a fita II sai "desenroscando" pela própria hélice
//          (assim não atravessa a fita I); na fita I, T vira U (some o CH₃) e cada açúcar ganha o O2'
//   1 → 2  o esqueleto de açúcar e fosfato some; uma base de cada tipo (A, G, C, U e uma T, que
//          recupera o CH₃) vem para a frente, de frente para quem olha: purinas em cima, pirimidinas embaixo
const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };
const PAIR_HBONDS = { AT: [['N6', 'O4'], ['N1', 'N3']], GC: [['O6', 'N4'], ['N1', 'N3'], ['N2', 'O2']] }; // purina → pirimidina
export const DNA_COLORS = {
  A: '#ff4d5e', // vermelho  } pares com cores complementares:
  T: '#7ee04e', // verde     } A–T vermelho/verde, G–C azul/amarelo
  G: '#5b7cff', // azul
  C: '#ffd23f', // amarelo
  U: '#c77dff', // roxo
  P: '#ff9f40', // fósforo (laranja)
  O2: '#ffffff', // o oxigênio a mais do açúcar do RNA
};

export function dna({ sequence = 'CGCGAATTCGCGTACG' } = {}) {
  const seq = sequence.toUpperCase();
  const n = seq.length;
  // grupos (cada um aparece/some separadamente) e cores (índices da paleta)
  const G = { backbone: 0, bases: 1, strand2: 2, o2: 3, methyl: 4, picked: 5, methylT: 6, hbonds: 7 };
  const C = { backbone: 0, P: 1, A: 2, G: 3, T: 4, C: 5, TU: 6, TUT: 7, O2: 8 };
  const palette = [null, DNA_COLORS.P, DNA_COLORS.A, DNA_COLORS.G, DNA_COLORS.T, DNA_COLORS.C, DNA_COLORS.T, DNA_COLORS.T, DNA_COLORS.O2];

  // uma base de cada tipo, perto do meio da hélice, vai para a "vitrine" no fim
  const mid = (n - 1) / 2;
  const nearest = (type, skip = -1) => [...seq].map((b, i) => (b === type && i !== skip ? i : -1)).filter((i) => i >= 0)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const pick = { A: nearest('A'), G: nearest('G'), C: nearest('C'), T: nearest('T') };
  pick.U = nearest('T', pick.T); // a uracila vem de uma timina da fita I que perdeu o CH₃
  if (Object.values(pick).some((i) => i === undefined)) throw new Error('A sequência do DNA precisa ter A, G, C e duas T na fita I');
  const roleOf = (i) => Object.keys(pick).find((k) => pick[k] === i);

  const atoms = []; // { p:[x,y,z], group, color, name, strand, i }
  const at = new Map(); // "I5N1" → índice
  for (let i = 0; i < n; i++) {
    const c = Math.cos(i * TWIST), s = Math.sin(i * TWIST);
    for (const strand of ['I', 'II']) {
      const type = strand === 'I' ? seq[i] : COMPLEMENT[seq[i]];
      const fivePrime = strand === 'I' ? i === 0 : i === n - 1; // a ponta 5' não tem fosfato
      const role = strand === 'I' ? roleOf(i) : undefined;
      for (const [name, x, y, z] of NUCLEOTIDES[strand + type]) {
        if (fivePrime && (name === 'P' || name.startsWith('OP'))) continue;
        if (name === "O2'" && strand === 'II') continue;
        const backbone = name.includes("'") || name === 'P' || name.startsWith('OP');
        let group, color;
        if (strand === 'II') {
          group = G.strand2;
          color = backbone ? (name === 'P' ? C.P : C.backbone) : C[type];
        } else if (name === "O2'") {
          group = G.o2;
          color = C.O2;
        } else if (backbone) {
          group = G.backbone;
          color = name === 'P' ? C.P : C.backbone;
        } else {
          group = name === 'C7' ? (role === 'T' ? G.methylT : G.methyl) : role ? G.picked : G.bases;
          color = type !== 'T' ? C[type] : role === 'T' ? C.TUT : C.TU;
        }
        at.set(`${strand}${i}${name}`, atoms.length);
        atoms.push({ p: [c * x + s * z, y + i * RISE, -s * x + c * z], group, color, name, strand, i, role });
      }
    }
  }

  // o eixo da hélice já passa por x = z = 0; só centraliza a altura
  const ys = atoms.map((a) => a.p[1]);
  const yc = (Math.min(...ys) + Math.max(...ys)) / 2;
  const positions = new Float32Array(atoms.flatMap((a) => [a.p[0], a.p[1] - yc, a.p[2]]));
  const groups = new Uint8Array(atoms.map((a) => a.group));
  const colorIndex = new Uint8Array(atoms.map((a) => a.color));

  // ligações covalentes (até 1,7 Å). O O2' só se liga ao C2': nesta forma de hélice ele fica a
  // 1,75 Å do fosfato seguinte — é por isso que o RNA de verdade não se enrola como o DNA-B
  const all = findBonds(positions, 1.7);
  const bonds = [], bondGroups = [];
  for (let k = 0; k < all.length; k += 2) {
    const a = atoms[all[k]], b = atoms[all[k + 1]];
    if ((a.name === "O2'" && b.name !== "C2'") || (b.name === "O2'" && a.name !== "C2'")) continue;
    let g = a.group;
    for (const x of [a, b]) if (x.group === G.o2 || x.group === G.methyl || x.group === G.methylT) g = x.group;
    if (a.strand === 'I' && (a.name === "C1'" || b.name === "C1'")) g = G.backbone; // ligação açúcar–base some com o esqueleto
    bonds.push(all[k], all[k + 1]);
    bondGroups.push(g);
  }

  // ligações de hidrogênio entre as bases (2 em A–T, 3 em G–C)
  const hbonds = [];
  for (let i = 0; i < n; i++) {
    const b1 = seq[i], b2 = COMPLEMENT[b1];
    const purineFirst = b1 === 'A' || b1 === 'G';
    for (const [pu, py] of PAIR_HBONDS[purineFirst ? b1 + b2 : b2 + b1]) {
      const [x, y] = purineFirst ? [pu, py] : [py, pu];
      hbonds.push(at.get(`I${i}${x}`), at.get(`II${i}${y}`));
    }
  }

  // "vitrine" das bases: para cada uma, rotação até ficar de frente (N ligado ao açúcar para baixo)
  const base = positions.slice();
  const P = (j) => [base[3 * j], base[3 * j + 1], base[3 * j + 2]];
  const bodies = ['A', 'G', 'C', 'T', 'U'].map((role) => {
    const idx = atoms.map((a, j) => (a.role === role && a.strand === 'I' && (a.group === G.picked || (role === 'T' && a.group === G.methylT)) ? j : -1)).filter((j) => j >= 0);
    const c0 = [0, 1, 2].map((k) => idx.reduce((sum, j) => sum + base[3 * j + k], 0) / idx.length);
    const glyco = P(at.get(`I${pick[role]}${role === 'A' || role === 'G' ? 'N9' : 'N1'}`));
    const a = norm(sub(glyco, c0));
    let far = idx[0], best = 0;
    for (const j of idx) {
      const w = len(cross(a, sub(P(j), c0)));
      if (w > best) { best = w; far = j; }
    }
    let nrm = norm(cross(a, sub(P(far), c0)));
    if (nrm[1] < 0) nrm = nrm.map((v) => -v); // todas vistas pelo mesmo lado
    const q = quatFromBasis(a, nrm);
    const local = idx.map((j) => rotateQ(q, sub(P(j), c0)));
    const box = [0, 1].map((k) => [Math.min(...local.map((v) => v[k])), Math.max(...local.map((v) => v[k]))]);
    return { role, idx, c0, q, box };
  });
  const rows = [['A', 'G'], ['C', 'T', 'U']]; // purinas (2 anéis) em cima, pirimidinas (1 anel) embaixo
  const GAP = 3.2; // espaço entre as bases (Å, antes de ampliar)
  const heights = rows.map((row) => Math.max(...row.map((k) => bodies.find((b) => b.role === k)).map((b) => b.box[1][1] - b.box[1][0])));
  // a vitrine fica da altura do QR code para cima: no celular, o cartão cobre a parte de baixo da tela
  const lift = heights[1] + GAP / 2 - 2;
  rows.forEach((row, r) => {
    const items = row.map((k) => bodies.find((b) => b.role === k));
    const widths = items.map((b) => b.box[0][1] - b.box[0][0]);
    let x = -(widths.reduce((s, w) => s + w, 0) + GAP * (items.length - 1)) / 2;
    const yRow = lift + (r === 0 ? GAP / 2 + heights[0] / 2 : -GAP / 2 - heights[1] / 2);
    items.forEach((b, k) => {
      b.c1 = [x + widths[k] / 2 - (b.box[0][0] + b.box[0][1]) / 2, yRow - (b.box[1][0] + b.box[1][1]) / 2, 0];
      x += widths[k] + GAP;
    });
  });
  const strand2 = atoms.map((a, j) => (a.group === G.strand2 ? j : -1)).filter((j) => j >= 0);
  const ZOOM = 1.7; // as bases soltas aparecem ampliadas (mais que isso não cabe na largura do celular)

  const mix = (a, b, x) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    let out = 0;
    for (const sh of [16, 8, 0]) out |= Math.round(((pa >> sh) & 255) * (1 - x) + ((pb >> sh) & 255) * x) << sh;
    return out;
  };
  const stage = (t) => {
    const k = (a, b) => clamp01((t - a) / (b - a));
    const rna = ease(k(0.55, 0.95)); // T → U e o O2' aparecendo
    const fade = ease(k(1, 1.3)); // o esqueleto sumindo
    const show = ease(k(1.1, 1.9)); // as bases indo para a vitrine
    const backT = ease(k(1.3, 1.7)); // a timina recupera o CH₃
    return { k, rna, fade, show, backT };
  };

  const animation = {
    kind: 'dna',
    maxT: 2,
    frame(t, out, opacity) {
      const { k, rna, fade, show, backT } = stage(t);
      opacity[G.hbonds] = 1 - k(0, 0.12);
      opacity[G.strand2] = t < 1 ? 1 - ease(k(0.3, 0.62)) : 0;
      opacity[G.backbone] = opacity[G.bases] = 1 - fade;
      opacity[G.o2] = rna * (1 - fade);
      opacity[G.methyl] = 1 - rna;
      opacity[G.methylT] = t <= 1 ? 1 - rna : backT;
      opacity[G.picked] = 1;
      out.set(base);
      // fita II: desenrosca subindo pela própria hélice (giro e subida na proporção da hélice)
      const u = ease(k(0, 0.62));
      if (u > 0) {
        const ang = u * 0.9 * 2 * Math.PI;
        const c = Math.cos(ang), s = Math.sin(ang), dy = (ang * RISE) / TWIST;
        for (const j of strand2) {
          const x = base[3 * j], z = base[3 * j + 2];
          out[3 * j] = c * x + s * z;
          out[3 * j + 1] = base[3 * j + 1] + dy;
          out[3 * j + 2] = -s * x + c * z;
        }
      }
      if (show > 0) {
        bodies.forEach((b, n) => {
          // cada base sai num momento e passa a uma profundidade diferente: não se atravessam no caminho
          const sb = ease(k(1.1 + 0.07 * n, 1.62 + 0.07 * n));
          const q = slerpFromIdentity(b.q, sb);
          const bump = (6 + 4 * n) * Math.sin(Math.PI * sb);
          const c = [0, 1, 2].map((m) => b.c0[m] + (b.c1[m] - b.c0[m]) * sb + (m === 2 ? bump : 0));
          for (const j of b.idx) {
            const v = rotateQ(q, sub(P(j), b.c0));
            out[3 * j] = c[0] + v[0];
            out[3 * j + 1] = c[1] + v[1];
            out[3 * j + 2] = c[2] + v[2];
          }
        });
      }
    },
    palette(t) {
      const { rna, backT } = stage(t);
      const p = palette.slice();
      p[C.TU] = mix(DNA_COLORS.T, DNA_COLORS.U, rna);
      p[C.TUT] = t <= 1 ? p[C.TU] : mix(DNA_COLORS.U, DNA_COLORS.T, backT);
      return p;
    },
    zoom: (t) => 1 + (ZOOM - 1) * stage(t).show,
  };

  return {
    positions, bonds: new Uint16Array(bonds), bondGroups: new Uint8Array(bondGroups), groups, nGroups: 8,
    colorIndex, palette, hbonds: new Uint16Array(hbonds), hbondGroup: G.hbonds, animation, rest: 0,
    radiusScale: 1.4, // a hélice fica fina demais com o tamanho de átomo das estruturas de carbono
  };
}

// --- vetores e quatérnios (só o necessário para girar as bases)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => a.map((v) => v / (len(a) || 1));

// rotação que leva `a` para baixo (−y) e `n` para quem olha (+z), como quatérnio [w, x, y, z]
function quatFromBasis(a, n) {
  const b = cross(a, n);
  const T = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]], S = [a, n, b];
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r][c] += T[k][r] * S[k][c];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = 2 * Math.sqrt(tr + 1);
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return q[0] < 0 ? q.map((v) => -v) : q; // o caminho mais curto
}

function slerpFromIdentity(q, s) {
  const ang = 2 * Math.acos(Math.min(1, q[0]));
  const sinHalf = Math.sqrt(Math.max(0, 1 - q[0] * q[0]));
  if (sinHalf < 1e-6) return [1, 0, 0, 0];
  const k = Math.sin((s * ang) / 2) / sinHalf;
  return [Math.cos((s * ang) / 2), q[1] * k, q[2] * k, q[3] * k];
}

function rotateQ([w, x, y, z], v) {
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  const t2 = cross(u, t);
  return [v[0] + w * t[0] + t2[0], v[1] + w * t[1] + t2[1], v[2] + w * t[2] + t2[2]];
}

export const GENERATORS = { graphene, graphite, nanotube, fullerene, diamond, dna };
