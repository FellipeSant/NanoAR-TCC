#!/usr/bin/env python3
"""Gera lab/data/elements.json (118 elementos) e lab/data/isotopes.json para o Laboratório, a partir
da biblioteca `mendeleev` (licença MIT; reúne dados de fontes como IUPAC, NIST e NUBASE).

Uso:
    pip install mendeleev
    python tools/build_elements.py

Campos por elemento:
  z símbolo(s) nome(n, pt-BR) massa(m) grupo(g) período(p) bloco(b) categoria(c)
  eletronegatividade Pauling(en) cor CPK(cpk) elétrons por camada(sh) configuração(cfg)
  isótopo de referência A (a; o mais abundante, ou o de maior meia-vida), se existe na natureza(natural)
  e se é radioativo (radio; nenhum isótopo estável)
  ano da descoberta(y; null = conhecido desde a Antiguidade) estado a 25 °C(st)
  valência usada nas ligações do laboratório(val; null = ainda não simulado) e
  elétrons de valência(ve; para a geometria VSEPR)
  linha/coluna na tabela desenhada (row, col)

isotopes.json (Fase 2: isótopos e íons), por número atômico:
  i  = todos os núcleos conhecidos: [A, abundância natural em % (ou null), estável (1/0),
       meia-vida em segundos (ou null), modo principal de decaimento (código NUBASE: B-, B+, EC, A, n, p, SF…)]
  ie = energias de ionização em eV (1ª, 2ª, …)
  ox = estados de oxidação mais comuns (ex.: Fe → [2, 3])
"""
import json
import os
import re

from mendeleev import element

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'lab', 'data', 'elements.json')
OUT_ISO = os.path.join(ROOT, 'lab', 'data', 'isotopes.json')

NAMES = """Hidrogênio Hélio Lítio Berílio Boro Carbono Nitrogênio Oxigênio Flúor Neônio Sódio Magnésio Alumínio
Silício Fósforo Enxofre Cloro Argônio Potássio Cálcio Escândio Titânio Vanádio Cromo Manganês Ferro Cobalto
Níquel Cobre Zinco Gálio Germânio Arsênio Selênio Bromo Criptônio Rubídio Estrôncio Ítrio Zircônio Nióbio
Molibdênio Tecnécio Rutênio Ródio Paládio Prata Cádmio Índio Estanho Antimônio Telúrio Iodo Xenônio Césio
Bário Lantânio Cério Praseodímio Neodímio Promécio Samário Európio Gadolínio Térbio Disprósio Hólmio Érbio
Túlio Itérbio Lutécio Háfnio Tântalo Tungstênio Rênio Ósmio Irídio Platina Ouro Mercúrio Tálio Chumbo
Bismuto Polônio Astato Radônio Frâncio Rádio Actínio Tório Protactínio Urânio Netúnio Plutônio Amerício
Cúrio Berquélio Califórnio Einstênio Férmio Mendelévio Nobélio Laurêncio Rutherfórdio Dúbnio Seabórgio
Bóhrio Hássio Meitnério Darmstádio Roentgênio Copernício Nihônio Fleróvio Moscóvio Livermório Tenessino
Oganessônio""".split()
assert len(NAMES) == 118

CATEGORY = {
    'Alkali metals': 'alcalino',
    'Alkaline earth metals': 'alcalino-terroso',
    'Transition metals': 'transicao',
    'Lanthanides': 'lantanideo',
    'Actinides': 'actinideo',
    'Poor metals': 'pos-transicao',
    'Metalloids': 'semimetal',
    'Nonmetals': 'nao-metal',
    'Halogens': 'halogenio',
    'Noble gases': 'gas-nobre',
}

GASES = {1, 2, 7, 8, 9, 10, 17, 18, 36, 54, 86}
LIQUIDS = {35, 80}

# unidades como aparecem na base (por extenso) → segundos
YEAR = 3.15576e7
UNIT = {'ysec': 1e-24, 'zsec': 1e-21, 'asec': 1e-18, 'fsec': 1e-15, 'psec': 1e-12, 'nsec': 1e-9, 'usec': 1e-6,
        'msec': 1e-3, 'sec': 1, 'minute': 60, 'hour': 3600, 'day': 86400, 'year': YEAR, 'kyear': 1e3 * YEAR,
        'Myear': 1e6 * YEAR, 'Gyear': 1e9 * YEAR, 'Tyear': 1e12 * YEAR, 'Pyear': 1e15 * YEAR,
        'Eyear': 1e18 * YEAR, 'Zyear': 1e21 * YEAR, 'Yyear': 1e24 * YEAR}


def seconds(iso):
    if not iso.half_life:
        return None
    unit = (iso.half_life_unit or 'sec').strip()
    if unit not in UNIT:
        raise ValueError(f'unidade de meia-vida desconhecida: {unit!r}')
    return float(iso.half_life) * UNIT[unit]


def reference_isotope(e):
    with_abundance = [i for i in e.isotopes if i.abundance]
    if with_abundance:
        best = max(with_abundance, key=lambda i: i.abundance)
        return best.mass_number, True
    timed = [(seconds(i), i) for i in e.isotopes if seconds(i)]
    if timed:
        return max(timed, key=lambda t: t[0])[1].mass_number, False
    return round(e.atomic_weight) if e.atomic_weight else None, False


def main_mode(iso):
    """modo de decaimento principal (o de maior intensidade conhecida; senão o primeiro listado)"""
    modes = list(iso.decay_modes)
    if not modes:
        return None
    known = [d for d in modes if d.intensity is not None and d.relation in ('=', '~', '>')]
    return (max(known, key=lambda d: d.intensity) if known else modes[0]).mode


def sig(x, n=4):
    return float(f'{x:.{n}g}')


def isotope_data(e):
    rows = []
    for i in sorted(e.isotopes, key=lambda i: i.mass_number):
        stable = bool(i.is_stable and i.abundance)  # a base marca alguns núcleos exóticos como "estáveis"
        hl = seconds(i)
        rows.append([i.mass_number, sig(i.abundance) if i.abundance else None, int(stable),
                     sig(hl) if hl and not stable else None, None if stable else main_mode(i)])
    ie = e.ionenergies or {}
    return {
        'i': rows,
        'ie': [round(float(ie[k]), 2) for k in sorted(ie)],
        'ox': sorted(e.oxistates or []),
    }


def lab_valence(z, group):
    """Valência típica (nº de ligações) usada no laboratório; None = ainda não simulado."""
    if z == 1:
        return 1, 1
    if z >= 104 or group is None or 3 <= group <= 12:
        return None, None
    if group == 18:
        return 0, 2 if z == 2 else 8  # gases nobres: estáveis
    return {1: (1, 1), 2: (2, 2), 13: (3, 3), 14: (4, 4), 15: (3, 5), 16: (2, 6), 17: (1, 7)}[group]


def grid(z, group, period):
    """(linha, coluna) na tabela desenhada: períodos 1–7 nas linhas 0–6; lantanídeos e actinídeos nas linhas 8 e 9."""
    if 57 <= z <= 71:
        return 8, 2 + (z - 57)
    if 89 <= z <= 103:
        return 9, 2 + (z - 89)
    return period - 1, group - 1


def main():
    out = []
    for z in range(1, 119):
        e = element(z)
        group = e.group_id
        shells = {}
        for (n, _l), count in e.ec.conf.items():
            shells[n] = shells.get(n, 0) + count
        a, natural = reference_isotope(e)
        # a base marca como "estáveis" alguns isótopos exóticos sem meia-vida medida (ex.: Tc-83);
        # todo nuclídeo realmente estável existe na natureza, então exige também abundância natural
        radio = not any(i.is_stable and i.abundance for i in e.isotopes)
        val, ve = lab_valence(z, group)
        row, col = grid(z, group, e.period)
        out.append({
            'z': z,
            's': e.symbol,
            'n': NAMES[z - 1],
            'm': round(float(e.atomic_weight), 3) if e.atomic_weight else None,
            'g': group,
            'p': e.period,
            'b': e.block,
            'c': CATEGORY.get(e.series, 'desconhecido'),
            'en': round(float(e.en_pauling), 2) if e.en_pauling else None,
            'cpk': (e.cpk_color or '#c8c8c8').lower(),
            'sh': [shells[n] for n in sorted(shells)],
            'cfg': re.sub(r'\s+', ' ', e.econf or '').strip(),
            'a': a,
            'natural': natural,
            'radio': radio,
            'y': e.discovery_year,
            'st': 'gás' if z in GASES else 'líquido' if z in LIQUIDS else 'sólido' if z <= 103 else None,
            'val': val,
            've': ve,
            'row': row,
            'col': col,
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} elementos -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')
    iso = {z: isotope_data(element(z)) for z in range(1, 119)}
    with open(OUT_ISO, 'w', encoding='utf-8') as f:
        json.dump(iso, f, ensure_ascii=False, separators=(',', ':'))
    n = sum(len(v['i']) for v in iso.values())
    print(f'{n} núcleos -> {os.path.relpath(OUT_ISO, ROOT)} ({os.path.getsize(OUT_ISO) // 1024} KB)')


if __name__ == '__main__':
    main()
