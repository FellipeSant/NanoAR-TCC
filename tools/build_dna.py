#!/usr/bin/env python3
"""Gera js/dna-templates.js: os "moldes" dos nucleotídeos do DNA-B, usados por js/structures.js.

O DNA do QR code reservado é montado por código (como as estruturas de carbono): cada par de
bases é o anterior girado em torno do eixo da hélice e deslocado para cima. Este script calcula,
uma única vez, as coordenadas de cada nucleotídeo (A, C, G, T nas duas fitas) dentro do seu
"degrau" da escada:

  1. o Open Babel monta uma dupla hélice B (modelo de fibra) a partir de uma sequência;
  2. os átomos de cada nucleotídeo são identificados pela ligação química (C1', N9/N1, …);
  3. as bases são trocadas pela geometria padrão de Olson et al. (2001), ajustada por mínimos
     quadrados (o Open Babel 3.1 tem uma ligação C–N de 1,15 Å na citosina, curta demais);
  4. o oxigênio 2' da ribose (RNA) é acrescentado em cada açúcar, do mesmo lado do O3'.

Uso:  python3 tools/build_dna.py        (precisa do `obabel` e do numpy)
"""
import collections
import json
import math
import pathlib
import subprocess
import tempfile

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'js' / 'dna-templates.js'
SEQ = 'CGCGAATTCGCGTACG'  # só para gerar os moldes (tem A, C, G e T nas duas fitas)

# Bases padrão no sistema de referência do par de bases (Olson et al., J. Mol. Biol. 313, 229, 2001)
STD = {
    'A': {"C1'": (-2.479, 5.346, 0), 'N9': (-1.291, 4.498, 0), 'C8': (0.024, 4.897, 0), 'N7': (0.877, 3.902, 0),
          'C5': (0.071, 2.771, 0), 'C6': (0.369, 1.398, 0), 'N6': (1.611, 0.909, 0), 'N1': (-0.668, 0.532, 0),
          'C2': (-1.912, 1.023, 0), 'N3': (-2.320, 2.290, 0), 'C4': (-1.267, 3.124, 0)},
    'G': {"C1'": (-2.477, 5.399, 0), 'N9': (-1.289, 4.551, 0), 'C8': (0.023, 4.962, 0), 'N7': (0.870, 3.969, 0),
          'C5': (0.071, 2.833, 0), 'C6': (0.424, 1.460, 0), 'O6': (1.554, 0.955, 0), 'N1': (-0.700, 0.641, 0),
          'C2': (-1.999, 1.087, 0), 'N2': (-2.949, 0.139, -0.001), 'N3': (-2.342, 2.364, 0.001), 'C4': (-1.265, 3.177, 0)},
    'C': {"C1'": (-2.477, 5.402, 0), 'N1': (-1.285, 4.542, 0), 'C2': (-1.472, 3.158, 0), 'O2': (-2.628, 2.709, 0.001),
          'N3': (-0.391, 2.344, 0), 'C4': (0.837, 2.868, 0), 'N4': (1.875, 2.027, 0.001), 'C5': (1.056, 4.275, 0),
          'C6': (-0.023, 5.068, 0)},
    'T': {"C1'": (-2.481, 5.354, 0), 'N1': (-1.284, 4.500, 0), 'C2': (-1.462, 3.135, 0), 'O2': (-2.562, 2.608, 0),
          'N3': (-0.298, 2.407, 0), 'C4': (0.994, 2.897, 0), 'O4': (1.944, 2.119, 0), 'C5': (1.106, 4.338, 0),
          'C7': (2.466, 4.961, 0.001), 'C6': (-0.024, 5.057, 0)},
}
COMPLEMENT = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'}


def build_with_openbabel(seq):
    with tempfile.TemporaryDirectory() as tmp:
        fa, mol2 = pathlib.Path(tmp, 'dna.fasta'), pathlib.Path(tmp, 'dna.mol2')
        fa.write_text(f'>dna\n{seq}\n')
        subprocess.run(['obabel', '-ifasta', str(fa), '-omol2', '-O', str(mol2)], check=True, capture_output=True)
        lines = mol2.read_text().split('\n')
    ai, bi = lines.index('@<TRIPOS>ATOM'), lines.index('@<TRIPOS>BOND')
    atoms = {}
    for line in lines[ai + 1:bi]:
        f = line.split()
        if f and f[5].split('.')[0] != 'H':
            atoms[int(f[0])] = (f[5].split('.')[0], np.array([float(v) for v in f[2:5]]))
    adj = collections.defaultdict(set)
    for line in lines[bi + 1:]:
        f = line.split()
        if len(f) < 3 or line.startswith('@'):
            break
        a, b = int(f[1]), int(f[2])
        if a in atoms and b in atoms:
            adj[a].add(b)
            adj[b].add(a)
    return atoms, adj


def name_nucleotides(atoms, adj):
    """Identifica cada nucleotídeo e dá nome aos átomos (C1', O4', …, N9, C8, …)."""
    el = lambda i: atoms[i][0]
    nucs = []
    for c1 in atoms:
        if el(c1) != 'C':
            continue
        ring_o = [o for o in adj[c1] if el(o) == 'O' and len(adj[o]) == 2]  # O4' do anel (não um C=O da base)
        base_n = [n for n in adj[c1] if el(n) == 'N']
        if len(ring_o) != 1 or len(base_n) != 1:
            continue
        o4, n = ring_o[0], base_n[0]
        names = {"C1'": c1, "O4'": o4}
        c2p = next(c for c in adj[c1] if c not in (o4, n))
        c4p = next(c for c in adj[o4] if c != c1)
        c3p = next(c for c in adj[c2p] if c != c1)
        names.update({"C2'": c2p, "C3'": c3p, "C4'": c4p})
        names["O3'"] = next(o for o in adj[c3p] if el(o) == 'O')
        names["C5'"] = next(c for c in adj[c4p] if c not in (o4, c3p))
        names["O5'"] = next(o for o in adj[names["C5'"]] if el(o) == 'O')
        p = [x for x in adj[names["O5'"]] if el(x) == 'P']
        if p:
            names['P'] = p[0]
            free = sorted(o for o in adj[p[0]] if el(o) == 'O' and len(adj[o]) == 1)
            if len(free) == 2:  # o primeiro nucleotídeo (5') tem um O a mais: fica de fora
                names['OP1'], names['OP2'] = free
        # base
        # purina: o N ligado ao açúcar (N9) tem um vizinho C8 que só se liga a outro N (N7);
        # na pirimidina, o vizinho equivalente (C6) se liga a um C (C5)
        if any(len(adj[x]) == 2 and any(el(y) == 'N' for y in adj[x] if y != n) for x in adj[n] if x != c1):
            typ, base = purine(n, c1, adj, atoms)
        else:
            typ, base = pyrimidine(n, c1, adj, atoms)
        names.update(base)
        nucs.append({'type': typ, 'names': names})
    return nucs


def purine(n9, c1, adj, atoms):
    el = lambda i: atoms[i][0]
    nb = [x for x in adj[n9] if x != c1]
    c8 = next(x for x in nb if len(adj[x]) == 2)
    c4 = next(x for x in nb if x != c8)
    n7 = next(x for x in adj[c8] if x != n9)
    c5 = next(x for x in adj[n7] if x != c8)
    n3 = next(x for x in adj[c4] if x not in (n9, c5))
    c2 = next(x for x in adj[n3] if x != c4)
    c6 = next(x for x in adj[c5] if x not in (n7, c4))
    n1 = next(x for x in adj[c6] if x in adj[c2])
    names = {'N9': n9, 'C8': c8, 'N7': n7, 'C5': c5, 'C4': c4, 'N3': n3, 'C2': c2, 'N1': n1, 'C6': c6}
    ex6 = next(x for x in adj[c6] if x not in (c5, n1))
    ex2 = [x for x in adj[c2] if x not in (n3, n1)]
    if el(ex6) == 'O':
        names.update({'O6': ex6, 'N2': ex2[0]})
        return 'G', names
    names['N6'] = ex6
    return 'A', names


def pyrimidine(n1, c1, adj, atoms):
    el = lambda i: atoms[i][0]
    nb = [x for x in adj[n1] if x != c1]
    c2 = next(x for x in nb if any(el(y) == 'O' for y in adj[x]))
    c6 = next(x for x in nb if x != c2)
    o2 = next(x for x in adj[c2] if el(x) == 'O')
    n3 = next(x for x in adj[c2] if x not in (n1, o2))
    c4 = next(x for x in adj[n3] if x != c2)
    c5 = next(x for x in adj[c6] if x != n1)
    ex4 = next(x for x in adj[c4] if x not in (n3, c5))
    names = {'N1': n1, 'C2': c2, 'O2': o2, 'N3': n3, 'C4': c4, 'C5': c5, 'C6': c6}
    ex5 = [x for x in adj[c5] if x not in (c4, c6)]
    if el(ex4) == 'O':
        names.update({'O4': ex4, 'C7': ex5[0]})
        return 'T', names
    names['N4'] = ex4
    return 'C', names


def kabsch(P, Q):
    """Rotação R e translação t que levam os pontos P sobre Q (R @ p + t)."""
    pc, qc = P.mean(0), Q.mean(0)
    H = (P - pc).T @ (Q - qc)
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, qc - R @ pc


def add_o2(pos):
    """O2' da ribose: no C2', do mesmo lado do anel que o O3' (cis), a 1,42 Å."""
    c1, c2, c3, o3 = (pos[k] for k in ("C1'", "C2'", "C3'", "O3'"))
    b = 2 * c2 - c1 - c3
    b /= np.linalg.norm(b)
    nrm = np.cross(c1 - c2, c3 - c2)
    nrm /= np.linalg.norm(nrm)
    if np.dot(o3 - c3, nrm) < 0:
        nrm = -nrm
    half = math.radians(109.5) / 2
    d = b * math.cos(half) + nrm * math.sin(half)
    return c2 + 1.42 * d / np.linalg.norm(d)


def main():
    atoms, adj = build_with_openbabel(SEQ)
    nucs = name_nucleotides(atoms, adj)
    assert len(nucs) == 2 * len(SEQ), len(nucs)
    pos = lambda nuc: {k: atoms[i][1] for k, i in nuc['names'].items()}

    # fitas: componentes conexas
    comp = {}
    for start in atoms:
        if start in comp:
            continue
        stack, label = [start], len(set(comp.values()))
        while stack:
            x = stack.pop()
            if x in comp:
                continue
            comp[x] = label
            stack += [y for y in adj[x] if y not in comp]
    # eixo da hélice = x do Open Babel (os P ficam a 8,91 Å dele); fita I = a que contém o 1º P
    for nuc in nucs:
        nuc['strand'] = comp[nuc['names']["C1'"]]
        nuc['h'] = float(np.mean([p[0] for p in pos(nuc).values()]))
    s1 = sorted([n for n in nucs if n['strand'] == 0], key=lambda n: n['h'])
    s2 = sorted([n for n in nucs if n['strand'] == 1], key=lambda n: n['h'])
    assert ''.join(n['type'] for n in s1) in (SEQ, SEQ[::-1])
    if ''.join(n['type'] for n in s1) != SEQ:
        s1, s2 = s2, s1
    assert all(COMPLEMENT[a['type']] == b['type'] for a, b in zip(s1, s2)), 'pares errados'

    # passo da hélice: giro e subida entre pares vizinhos (pelos C1' da fita I)
    ang = lambda p: math.atan2(p[2], p[1])
    c1s = [pos(n)["C1'"] for n in s1]
    twist = np.mean([((ang(b) - ang(a) + math.pi) % (2 * math.pi)) - math.pi for a, b in zip(c1s, c1s[1:])])
    rise = np.mean([b[0] - a[0] for a, b in zip(c1s, c1s[1:])])

    def to_frame(p, i):
        # leva o degrau i para o degrau 0 e troca os eixos (x do Open Babel → y, para cima)
        x, y, z = p
        x -= i * rise
        c, s = math.cos(-i * twist), math.sin(-i * twist)
        y, z = c * y - s * z, s * y + c * z
        return np.array([z, x, y])  # permutação cíclica = rotação (não espelha a hélice)

    # mão da hélice depois da troca de eixos: o DNA-B gira para a direita
    a0, a1 = to_frame(c1s[0], 0), to_frame(c1s[1], 0)
    handed = np.dot(np.cross([a0[0], 0, a0[2]], [a1[0], 0, a1[2]]), [0, 1, 0]) * (a1[1] - a0[1])
    assert handed > 0, 'a hélice ficou canhota'

    templates = {}
    worst = 0
    for strand, chain in (('I', s1), ('II', s2)):
        for i, nuc in enumerate(chain):
            key = f"{strand}{nuc['type']}"
            if key in templates or i in (0, len(chain) - 1):
                continue  # usa um nucleotídeo do meio (as pontas têm grupos a mais)
            p = pos(nuc)
            std = STD[nuc['type']]
            names = [k for k in std if k in p]
            R, t = kabsch(np.array([std[k] for k in names], float), np.array([p[k] for k in names]))
            rms = math.sqrt(np.mean([np.sum((R @ np.array(std[k]) + t - p[k]) ** 2) for k in names]))
            worst = max(worst, rms)
            for k in std:
                if k != "C1'":
                    p[k] = R @ np.array(std[k], float) + t
            p["O2'"] = add_o2(p)
            order = ['P', 'OP1', 'OP2', "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "O2'", "C1'"] + [k for k in std if k != "C1'"]
            templates[key] = [[k] + [round(float(v), 3) for v in to_frame(p[k], i)] for k in order if k in p]
    assert len(templates) == 8, sorted(templates)

    # conferência: ligações das bases e distância O3'(i)–P(i+1)
    body = json.dumps(templates, separators=(',', ':'))
    OUT.write_text(
        '// Gerado por tools/build_dna.py — não edite à mão.\n'
        '// Moldes dos nucleotídeos do DNA-B (Å): [nome, x, y, z] no degrau 0 da escada; o eixo da hélice é y.\n'
        '// Fita I sobe (5\'→3\'), fita II desce. Bases: geometria padrão de Olson et al. (2001).\n'
        f'export const TWIST = {twist:.6f}; // giro entre pares vizinhos (rad)\n'
        f'export const RISE = {rise:.4f}; // subida entre pares vizinhos (Å)\n'
        f'export const NUCLEOTIDES = {body};\n'
    )
    print(f'{OUT.relative_to(ROOT)}: giro {math.degrees(twist):.2f}°, subida {rise:.3f} Å, '
          f'{360 / abs(math.degrees(twist)):.1f} pares por volta, ajuste das bases rms ≤ {worst:.3f} Å')


if __name__ == '__main__':
    main()
