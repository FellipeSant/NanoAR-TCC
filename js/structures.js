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

export const GENERATORS = { graphene, graphite, nanotube, fullerene, diamond };
