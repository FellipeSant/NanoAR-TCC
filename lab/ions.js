// Fase 2: isótopos e íons — as "leis da natureza" do átomo aberto.
//  • nêutrons: só se chega a núcleos que já foram observados (dados NUBASE via mendeleev);
//    cada núcleo mostra se é estável, sua abundância natural, meia-vida e em que ele decai
//  • elétrons: tirar custa a energia de ionização real (e mostra o salto quando se chega numa
//    camada interna); ganhar elétrons só até o íon negativo mais carregado que o elemento forma
//    (ex.: Cl⁻, O²⁻, N³⁻) — metais e gases nobres não formam íons negativos estáveis
//  • decaimento: um núcleo instável se transforma pelo modo real (β⁻, β⁺, captura eletrônica, α…),
//    emitindo as partículas certas — e o átomo vira outro elemento
//  • faixa de cargas (oxRange): quantos elétrons cada elemento dá ou recebe numa ligação iônica
// Este módulo só calcula; o desenho fica em atomview.js e a interação em lab.js.

const NOBLE = { 2: 'hélio', 10: 'neônio', 18: 'argônio', 36: 'criptônio', 54: 'xenônio', 86: 'radônio', 118: 'oganessônio' };
const H_NAMES = { 1: 'prótio', 2: 'deutério', 3: 'trítio' };
const ANION_NAMES = { 'H-1': 'hidreto', 'C-4': 'carbeto', 'N-3': 'nitreto', 'O-2': 'óxido', 'F-1': 'fluoreto', 'P-3': 'fosfeto', 'S-2': 'sulfeto', 'Cl-1': 'cloreto', 'Se-2': 'seleneto', 'Br-1': 'brometo', 'Te-2': 'telureto', 'I-1': 'iodeto' };
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = (n) => String(n).replace(/\d/g, (d) => SUP[d]);
export const chargeSup = (q) => (q === 0 ? '' : `${Math.abs(q) === 1 ? '' : sup(Math.abs(q))}${q > 0 ? '⁺' : '⁻'}`);
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const num = (v, digits = 3) => v.toLocaleString('pt-BR', { maximumSignificantDigits: digits });

let DB = null; // { [z]: { i: [[A, abund, stable, halfLife, mode]], ie: [eV…], ox: […] } }
let ELEMENTS = null;

export async function loadIsotopes(elements, url = new URL('./data/isotopes.json', import.meta.url)) {
  ELEMENTS = elements;
  DB = await (await fetch(url)).json();
  return DB;
}
export const isotopesReady = () => !!DB;

// cargas que o elemento costuma ter: um metal perde até `max` elétrons (Na +1, Mg +2, Al +3);
// um não metal ganha até −`min` (Cl −1, O −2, N −3). Sem os dados, usa a valência.
export function oxRange(el) {
  const ox = DB?.[el.z]?.ox || [];
  const pos = ox.filter((v) => v > 0), neg = ox.filter((v) => v < 0);
  return {
    max: pos.length ? Math.max(...pos) : el.valence ?? 0,
    min: neg.length ? Math.min(...neg) : el.ve != null && el.ve >= 4 ? el.ve - 8 : 0,
  };
}

export function initialState(el) {
  return { N: el.n ?? 0, electrons: el.z };
}

function nuclide(z, A) {
  const row = DB?.[z]?.i.find((r) => r[0] === A);
  return row ? { A: row[0], abundance: row[1], stable: !!row[2], halfLife: row[3], mode: row[4] } : null;
}

// elétrons por camada: o íon positivo perde primeiro os da camada mais externa (ex.: Fe²⁺ perde os 4s);
// o íon negativo ganha na camada externa (até completar 8, ou 2 na primeira camada)
export function shellsFor(el, electrons) {
  const sh = [...el.data.sh];
  let diff = el.z - electrons;
  for (let k = sh.length - 1; k >= 0 && diff > 0; k--) {
    const take = Math.min(sh[k], diff);
    sh[k] -= take;
    diff -= take;
  }
  if (diff < 0) sh[sh.length - 1] -= diff;
  while (sh.length && sh[sh.length - 1] === 0) sh.pop();
  return sh;
}

// ------------------------------------------------------------ textos
function fmtTime(s) {
  const Y = 3.15576e7;
  if (s > 1e12 * Y) {
    const years = s / Y, exp = Math.floor(Math.log10(years));
    return `${num(years / 10 ** exp, 2)} × 10${sup(exp)} anos (muito mais que a idade do Universo)`;
  }
  const units = [
    [1e9 * Y, 'bilhão de anos', 'bilhões de anos'], [1e6 * Y, 'milhão de anos', 'milhões de anos'], [1e3 * Y, 'mil anos', 'mil anos'],
    [Y, 'ano', 'anos'], [86400, 'dia', 'dias'], [3600, 'hora', 'horas'], [60, 'minuto', 'minutos'], [1, 'segundo', 'segundos'],
    [1e-3, 'milissegundo', 'milissegundos'], [1e-6, 'microssegundo', 'microssegundos'], [1e-9, 'nanossegundo', 'nanossegundos'],
  ];
  for (const [u, one, many] of units) {
    if (s >= u) {
      const v = s / u;
      return `${num(v)} ${v < 2 ? one : many}`;
    }
  }
  return 'menos de um bilionésimo de segundo';
}

// modos de decaimento (códigos NUBASE): variação de Z e de A e o nome curto
const MODES = {
  'B-': [1, 0, 'β⁻'], 'B+': [-1, 0, 'β⁺'], 'e+': [-1, 0, 'β⁺'], EC: [-1, 0, 'captura eletrônica'], 'EC+B+': [-1, 0, 'β⁺'],
  A: [-2, -4, 'α'], n: [0, -1, 'emite 1 nêutron'], '2n': [0, -2, 'emite 2 nêutrons'], '3n': [0, -3, 'emite 3 nêutrons'], '4n': [0, -4, 'emite 4 nêutrons'],
  p: [-1, -1, 'emite 1 próton'], '2p': [-2, -2, 'emite 2 prótons'], '3p': [-3, -3, 'emite 3 prótons'],
  'B-n': [1, -1, 'β⁻ e nêutron'], 'B+p': [-2, -1, 'β⁺ e próton'], 'B+A': [-3, -4, 'β⁺ e α'], 'B-A': [-1, -4, 'β⁻ e α'],
  '2B-': [2, 0, 'duplo β⁻'], '2B+': [-2, 0, 'duplo β⁺'],
};
const UNBOUND = new Set(['n', '2n', '3n', '4n', 'p', '2p', '3p']);

// o que sai do núcleo em cada modo (para a animação) e a explicação em palavras
const EMITS = {
  'B-': ['e-', 'nu'], 'B+': ['e+', 'nu'], 'e+': ['e+', 'nu'], 'EC+B+': ['e+', 'nu'], EC: ['capture', 'nu'], A: ['alpha'],
  n: ['n'], '2n': ['n', 'n'], '3n': ['n', 'n', 'n'], '4n': ['n', 'n', 'n', 'n'], p: ['p'], '2p': ['p', 'p'], '3p': ['p', 'p', 'p'],
  'B-n': ['e-', 'nu', 'n'], 'B+p': ['e+', 'nu', 'p'], 'B+A': ['e+', 'nu', 'alpha'], 'B-A': ['e-', 'nu', 'alpha'],
  '2B-': ['e-', 'e-', 'nu', 'nu'], '2B+': ['e+', 'e+', 'nu', 'nu'],
};
const HAPPENED = {
  'B-': 'decaimento β⁻ — um nêutron virou próton e saiu um elétron (e um antineutrino)',
  'B+': 'decaimento β⁺ — um próton virou nêutron e saiu um pósitron, a antipartícula do elétron (e um neutrino)',
  EC: 'captura eletrônica — o núcleo puxou um elétron da camada K, um próton virou nêutron e saiu um neutrino',
  A: 'decaimento α — saiu uma partícula alfa: 2 prótons e 2 nêutrons, um núcleo de hélio',
  '2B-': 'duplo β⁻ — dois nêutrons viraram prótons ao mesmo tempo',
  '2B+': 'duplo β⁺ — dois prótons viraram nêutrons ao mesmo tempo',
};
HAPPENED['e+'] = HAPPENED['EC+B+'] = HAPPENED['B+'];

function decayText(z, A, mode) {
  if (!mode) return '';
  if (/SF$/.test(mode)) return ' · fissão espontânea (o núcleo se parte em dois)';
  let m = MODES[mode];
  const cluster = !m && mode.match(/^(\d+)([A-Z][a-z]?)$/); // emissão de um núcleo inteiro (ex.: ¹⁴C)
  if (cluster) {
    const c = ELEMENTS.find((e) => e.sym === cluster[2]);
    if (c) m = [-c.z, -Number(cluster[1]), `emite um núcleo de ${c.name.toLowerCase()}-${cluster[1]}`];
  }
  if (!m) return '';
  const d = ELEMENTS[z + m[0] - 1];
  return d ? ` · ${m[2]} → ${d.name.toLowerCase()}-${A + m[1]}` : ` · ${m[2]}`;
}

function nucleusStatus(el, nuc) {
  if (!nuc) return { text: 'Núcleo desconhecido', color: '#9fb6c1' };
  const pct = nuc.abundance ? `${num(nuc.abundance)}% do ${el.name.toLowerCase()} natural` : '';
  if (nuc.stable) return { text: `Núcleo estável${pct ? ` · ${pct}` : ''}`, color: '#7ee08a' };
  if (!nuc.halfLife && UNBOUND.has(nuc.mode)) return { text: `Núcleo não se mantém: se desfaz na hora (${MODES[nuc.mode][2]})`, color: '#ff7b6b' };
  const hl = nuc.halfLife ? `meia-vida ${fmtTime(nuc.halfLife)}` : 'meia-vida desconhecida';
  return { text: `☢ Radioativo · ${hl}${decayText(el.z, nuc.A, nuc.mode)}${pct ? ` · ${pct}` : ''}`, color: '#ffd400' };
}

function isotopeName(el, A) {
  return `${el.name}-${A}${el.z === 1 && H_NAMES[A] ? ` (${H_NAMES[A]})` : ''}`;
}

export function ionName(el, q) {
  if (q >= 0) return `${el.sym}${chargeSup(q)}`;
  const n = ANION_NAMES[`${el.sym}${q}`];
  return `${el.sym}${chargeSup(q)}${n ? ` (${n})` : ''}`;
}

// tudo o que o átomo aberto mostra para um estado {N, electrons}
export function describe(el, state) {
  const Z = el.z, N = state.N, e = state.electrons, A = Z + N, q = Z - e;
  const shells = shellsFor(el, e);
  const nuc = nuclide(Z, A);
  const outer = shells[shells.length - 1] || 0;
  const transition = el.valence == null && Z > 2;
  const rows = [
    { text: `${count(Z, 'próton')} · ${count(N, 'nêutron')} · ${count(e, 'elétron')}${q ? ` · carga ${q > 0 ? '+' : '−'}${Math.abs(q)}` : ''}`, color: '#eaf3f6' },
    {
      text: shells.length ? `Camadas ${shells.map((n, i) => `${'KLMNOPQ'[i]}${n}`).join(' ')} · ${q || transition ? 'camada externa' : 'valência'}: ${outer} e⁻` : 'Sem elétrons: só o núcleo (núcleo "nu")',
      color: '#d3e2e8',
    },
    DB ? nucleusStatus(el, nuc) : { text: 'Carregando dados dos isótopos…', color: '#9fb6c1' },
  ];
  if (q) rows.push({ text: `Íon ${ionName(el, q)}: ${q > 0 ? 'cátion (perdeu' : 'ânion (ganhou'} ${Math.abs(q)} elétron${Math.abs(q) > 1 ? 's' : ''})${NOBLE[e] ? ` · mesmos elétrons que o ${NOBLE[e]}` : ''}`, color: '#4fd1c5' });
  else rows.push({ text: 'Átomo neutro: prótons = elétrons', color: '#9fb6c1' });
  const tag = `${A !== el.data.a ? sup(A) : ''}${el.sym}${chargeSup(q)}`;
  return { title: `${isotopeName(el, A)}${q ? `  ·  ${el.sym}${chargeSup(q)}` : ''}`, rows, shells, A, q, tag, nuclide: nuc };
}

// O núcleo decai (com o tempo acelerado): devolve o novo elemento, o novo estado e as partículas emitidas.
// A carga do átomo é mantida (um átomo neutro continua neutro).
export function decay(el, state) {
  if (!DB) return { ok: false, msg: 'Ainda carregando os dados dos isótopos…' };
  const Z = el.z, A = Z + state.N, nuc = nuclide(Z, A);
  const name = isotopeName(el, A);
  if (!nuc) return { ok: false, msg: `${name}: núcleo desconhecido` };
  if (nuc.stable) return { ok: false, msg: `${name} é estável: não decai` };
  const mode = nuc.mode;
  if (!mode) return { ok: false, msg: `${name} é radioativo, mas o modo de decaimento não é conhecido` };
  if (/SF$/.test(mode)) return { ok: false, msg: `${name} decai por fissão espontânea (o núcleo se parte em dois): isso fica para a reação em cadeia` };
  let dz, da, emits, what;
  if (MODES[mode]) {
    [dz, da] = MODES[mode];
    emits = EMITS[mode] || [];
    const k = emits.length;
    const left = k > 1 ? 'saíram' : 'saiu';
    what = HAPPENED[mode] || (/^\d?n$/.test(mode) ? `${left} ${count(k, 'nêutron')} do núcleo` : /^\d?p$/.test(mode) ? `${left} ${count(k, 'próton')} do núcleo` : MODES[mode][2]);
  } else {
    const cluster = mode.match(/^(\d+)([A-Z][a-z]?)$/); // emissão de um núcleo inteiro (ex.: ¹⁴C)
    const c = cluster && ELEMENTS.find((e) => e.sym === cluster[2]);
    if (!c) return { ok: false, msg: `${name}: modo de decaimento "${mode}" ainda não simulado` };
    dz = -c.z;
    da = -Number(cluster[1]);
    emits = [{ kind: 'cluster', p: c.z, n: Number(cluster[1]) - c.z }];
    what = `saiu um núcleo inteiro de ${c.name.toLowerCase()}-${cluster[1]}`;
  }
  const el2 = ELEMENTS[Z + dz - 1];
  if (!el2) return { ok: false, msg: `${name}: o núcleo-filho não está na tabela` };
  const q = Z - state.electrons;
  const next = { N: A + da - el2.z, electrons: Math.max(0, el2.z - q) };
  const hl = nuc.halfLife;
  const short = MODES[mode]?.[2] || 'emite um núcleo';
  const msg = `☢ ${name} → ${isotopeName(el2, A + da).toLowerCase()}${el2.z === Z ? '' : ' (outro elemento!)'} · ${short}${hl ? ` · meia-vida ${fmtTime(hl)}` : ''}`;
  // explicação mais longa: vai para o cartão do átomo aberto
  const detail = `${what[0].toUpperCase()}${what.slice(1)}.${hl > 2 ? ` Tempo acelerado: na natureza, metade desses núcleos leva ${fmtTime(hl)} para decair.` : hl ? '' : ' O núcleo se desfaz na hora.'}`;
  return { ok: true, el: el2, state: next, mode, particles: emits.map((k) => (typeof k === 'string' ? { kind: k } : k)), msg, detail };
}

// o núcleo atual pode decair? (para mostrar o botão "decair")
export function canDecay(el, state) {
  const nuc = nuclide(el.z, el.z + state.N);
  return !!(nuc && !nuc.stable && nuc.mode);
}

// ------------------------------------------------------------ mudanças (respeitando a natureza)
// what: 'n' (nêutron) ou 'e' (elétron); delta: +1 ou −1.
// Devolve { ok, state, msg } — msg explica o que aconteceu ou por que não é possível.
export function change(el, state, what, delta) {
  if (!DB) return { ok: false, msg: 'Ainda carregando os dados dos isótopos…' };
  const Z = el.z, name = el.name, low = el.name.toLowerCase();
  if (what === 'n') {
    const A = Z + state.N + delta;
    if (state.N + delta < 0) return { ok: false, msg: `${isotopeName(el, Z + state.N)} não tem nêutrons para tirar` };
    const nuc = nuclide(Z, A);
    if (!nuc) {
      return {
        ok: false,
        msg: delta < 0
          ? `${name}-${A} nunca foi observado: com tão poucos nêutrons o núcleo não se mantém`
          : `${name}-${A} nunca foi observado: com tantos nêutrons, o nêutron extra escapa do núcleo`,
      };
    }
    const next = { ...state, N: state.N + delta };
    const st = nucleusStatus(el, nuc);
    return { ok: true, state: next, msg: `${isotopeName(el, A)}: ${st.text.replace(/^Núcleo /, 'núcleo ')}`, warn: !nuc.stable };
  }

  // elétrons
  const e = state.electrons, q = Z - e;
  const ie = DB[Z]?.ie || [];
  const ox = DB[Z]?.ox || [];
  if (delta < 0) {
    if (e === 0) return { ok: false, msg: 'Não há mais elétrons: só sobrou o núcleo' };
    const next = { ...state, electrons: e - 1 };
    const nq = q + 1;
    let msg;
    if (q < 0) msg = `O elétron extra saiu: ${nq === 0 ? `o ${low} voltou a ser neutro` : `agora é ${ionName(el, nq)}`}`;
    else {
      const cost = ie[q], prev = ie[q - 1];
      msg = cost ? `Arrancar esse elétron custou ${num(cost)} eV` : `Elétron arrancado: agora é ${ionName(el, nq)}`;
      if (cost && prev && cost / prev > 2.5) msg += ` — ${num(cost / prev, 2)}× mais que o anterior: ele estava numa camada mais interna`;
    }
    if (e - 1 === 0) msg += '. Núcleo nu: sem nenhum elétron (só acontece em plasmas muito quentes, como no interior do Sol)';
    else if (nq > 0 && NOBLE[e - 1]) msg += `. ${ionName(el, nq)} ficou com os mesmos elétrons que o ${NOBLE[e - 1]}: configuração estável`;
    else if (nq > 0 && ox.includes(nq)) msg += `. ${ionName(el, nq)} é um íon comum do ${low}`;
    return { ok: true, state: next, msg };
  }

  // ganhar um elétron
  const next = { ...state, electrons: e + 1 };
  const nq = q - 1;
  if (q > 0) return { ok: true, state: next, msg: nq === 0 ? `O íon capturou um elétron e voltou a ser ${low} neutro` : `O íon capturou um elétron: agora é ${ionName(el, nq)}` };
  const minOx = Math.min(0, ...ox);
  if (minOx === 0) {
    const noble = NOBLE[Z];
    return { ok: false, msg: noble ? `${name} é um gás nobre: a camada externa já está completa e um elétron a mais não fica preso` : `${name} não forma íon negativo estável: ele tende a perder elétrons, não a ganhar` };
  }
  if (nq < minOx) return { ok: false, msg: `O ${low} forma no máximo o íon ${ionName(el, minOx)}: a camada externa já está completa e um elétron a mais é repelido` };
  let msg = `${name} ganhou um elétron: agora é o ânion ${ionName(el, nq)}`;
  if (NOBLE[e + 1]) msg += `, com os mesmos elétrons que o ${NOBLE[e + 1]} (camada externa completa)`;
  return { ok: true, state: next, msg };
}
