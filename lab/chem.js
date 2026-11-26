// Motor químico simples (mas honesto) para montar moléculas com as mãos.
//
// Regras:
//  • Valência (nº máximo de ligações): H 1, C 4, N 3, O 2. Ligações simples, duplas e triplas.
//  • Dois átomos se ligam quando um é levado até o outro (o que se está apontando) e AMBOS ainda
//    têm ligações livres. Pinçar a ligação: simples → dupla → tripla (se a valência permitir) → desfaz.
//  • Se um deles já está completo (estável), há repulsão: o outro é empurrado para longe.
//  • Geometria pelo modelo VSEPR: os "domínios" em volta de cada átomo (ligações, valências livres
//    e pares de elétrons não ligantes) se afastam: 2 → 180°, 3 → 120°, 4 → 109,5° (107° com 1 par
//    livre, como no NH₃; 104,5° com 2 pares livres, como na H₂O).
//  • Ligação iônica (Fase 2): um metal levado até um não metal com diferença de eletronegatividade
//    ≥ 1,7 (Pauling) PASSA elétrons para ele — Na + Cl → Na⁺ Cl⁻ — até onde as cargas dos dois
//    permitem (Na +1, Mg +2, Al +3; Cl −1, O −2, N −3). Íons de cargas opostas se atraem (de longe,
//    sozinhos) e se ligam; cargas iguais se repelem. Íons não fazem ligações covalentes.
// Escala do laboratório: distâncias em metros do mundo virtual (não em ångström).
import * as THREE from 'three';

export const RADIUS = 0.05; // raio visual dos átomos
export const BOND_LEN = [0, 0.15, 0.135, 0.125]; // comprimento por ordem de ligação (simples, dupla, tripla)
const CAPTURE = 0.19; // aproximar mais que isso tenta formar ligação
const DAMPING = 3.5; // os átomos soltos param devagar (como num líquido)
const SETTLE = 0.25; // segundos perto do alvo antes de ligar (passar de raspão não liga)
const IONIC_LEN = 0.17; // distância entre íons ligados
const ATTRACT = 0.45; // íons de cargas opostas se atraem a menos que isso
const REPEL = 0.3; // íons de mesma carga se repelem a menos que isso
const IONIC_EN = 1.7; // diferença de eletronegatividade a partir da qual a ligação é iônica
const METALS = new Set(['alcalino', 'alcalino-terroso', 'transicao', 'pos-transicao', 'lantanideo', 'actinideo']);
const NONMETALS = new Set(['nao-metal', 'halogenio']);
const isMetal = (el) => METALS.has(el.data?.c);
const isNonmetal = (el) => NONMETALS.has(el.data?.c);
// nome do ânion (para nomear compostos iônicos: "cloreto de sódio")
const ANION_ROOT = { H: 'hidreto', C: 'carbeto', N: 'nitreto', O: 'óxido', F: 'fluoreto', P: 'fosfeto', S: 'sulfeto', Cl: 'cloreto', Se: 'seleneto', Br: 'brometo', Te: 'telureto', I: 'iodeto' };

// pares de elétrons não ligantes do átomo neutro: (elétrons de valência − valência) / 2
const lonePairs = (el) => (el.ve == null || el.valence == null ? 0 : Math.max(0, (el.ve - el.valence) / 2));
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const chargeText = (q) => (q === 0 ? '' : `${Math.abs(q) === 1 ? '' : String(Math.abs(q)).replace(/\d/g, (d) => SUPS[d])}${q > 0 ? '⁺' : '⁻'}`);

export class Chem {
  // oxRange(el) → { max, min }: cargas que o elemento costuma ter (ions.js)
  constructor({ onBond, onRepel, onBreak, onTransfer, onIonic, oxRange } = {}) {
    this.atoms = []; // { obj: THREE.Object3D, el, v: Vector3, held: bool, cool: 0, charge }
    this.bonds = []; // { a, b, order, ionic } — na iônica, `order` = quantas cargas a ligação usa
    this.on = { onBond, onRepel, onBreak, onTransfer, onIonic };
    this.oxRange = oxRange || ((el) => ({ max: el.valence ?? 0, min: el.ve >= 4 ? el.ve - 8 : 0 }));
    this.version = 0; // muda sempre que as ligações mudam (para redesenhar rótulos)
  }

  add(obj, el) {
    const atom = { obj, el, v: new THREE.Vector3(), held: false, cool: 0, scale: 1 }; // scale: tamanho da molécula (alça ⤢)
    this.atoms.push(atom);
    obj.userData.atom = atom;
    return atom;
  }

  remove(obj) {
    const atom = obj.userData.atom;
    this.atoms = this.atoms.filter((a) => a !== atom);
    this.bonds = this.bonds.filter((b) => b.a !== atom && b.b !== atom);
    this.version++;
  }

  bondBetween(a, b) {
    return this.bonds.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  }
  used(a) {
    return this.bonds.reduce((s, x) => s + (!x.ionic && (x.a === a || x.b === a) ? x.order : 0), 0); // só as covalentes
  }
  ionicUsed(a) {
    return this.bonds.reduce((s, x) => s + (x.ionic && (x.a === a || x.b === a) ? x.order : 0), 0);
  }
  // cargas do íon ainda não "compensadas" por íons vizinhos
  ionFree(a) {
    return a.charge ? Math.max(0, Math.abs(a.charge) - this.ionicUsed(a)) : 0;
  }
  // quantos elétrons o átomo ainda pode dar (metal) ou receber (não metal) numa ligação iônica
  transferLeft(a) {
    const r = this.oxRange(a.el), q = a.charge || 0;
    if (isMetal(a.el)) return Math.max(0, r.max - q);
    if (isNonmetal(a.el)) return Math.max(0, q - r.min);
    return 0;
  }
  // metal + não metal com eletronegatividades bem diferentes: o metal passa k elétrons
  transferPair(a, b) {
    const m = isMetal(a.el) ? a : isMetal(b.el) ? b : null;
    const x = m === a ? b : a;
    if (!m || !isNonmetal(x.el) || m.el.en == null || x.el.en == null || x.el.en - m.el.en < IONIC_EN) return null;
    if (this.used(m) || this.used(x) || (m.charge || 0) < 0 || (x.charge || 0) > 0) return null;
    const k = Math.min(this.transferLeft(m), this.transferLeft(x));
    return k > 0 ? { m, x, k } : null;
  }
  // que ligação `a` (levado pela mão) pode fazer com `b`: 'ionic', 'transfer', 'covalent' ou null
  canJoin(a, b) {
    if (a.open || b.open || a === b || this.bondBetween(a, b)) return null;
    if ((a.charge || 0) * (b.charge || 0) < 0 && this.ionFree(a) > 0 && this.ionFree(b) > 0) return 'ionic';
    if (this.transferPair(a, b)) return 'transfer';
    if (this.free(a) > 0 && this.free(b) > 0) return 'covalent';
    return null;
  }
  join(a, b, kind) {
    if (kind === 'transfer') {
      const { m, x, k } = this.transferPair(a, b);
      m.charge = (m.charge || 0) + k;
      x.charge = (x.charge || 0) - k;
      this.bonds.push({ a: m, b: x, order: k, ionic: true });
      this.version++;
      this.on.onTransfer?.(m, x, k);
    } else if (kind === 'ionic') {
      this.bonds.push({ a, b, order: Math.min(this.ionFree(a), this.ionFree(b)), ionic: true });
      this.version++;
      this.on.onIonic?.(a, b);
    } else {
      this.bonds.push({ a, b, order: 1 });
      this.version++;
      this.on.onBond?.(a, b, 1);
    }
  }
  free(a) {
    if (a.el.valence == null) return 0; // elementos cujas ligações ainda não são simuladas (ex.: metais de transição)
    if (a.charge) return 0; // íons (Fase 2) ainda não fazem ligações
    return a.el.valence - this.used(a);
  }
  neighbors(a) {
    return this.bonds.filter((x) => x.a === a || x.b === a).map((x) => (x.a === a ? x.b : x.a));
  }

  // pinçar uma ligação: simples → dupla → tripla (enquanto os dois tiverem valência livre) → desfaz
  cycleBond(bond) {
    const { a, b } = bond;
    if (bond.ionic) {
      // desfaz a ligação iônica: os íons continuam íons e se afastam (sem se atrair por um tempo)
      this.bonds = this.bonds.filter((x) => x !== bond);
      const dir = b.obj.position.clone().sub(a.obj.position).normalize();
      if (!a.held) a.v.addScaledVector(dir, -0.5);
      if (!b.held) b.v.addScaledVector(dir, 0.5);
      a.cool = b.cool = 2;
      this.version++;
      this.on.onBreak?.(a, b, true);
      return;
    }
    if (bond.order < 3 && this.free(a) > 0 && this.free(b) > 0) {
      bond.order++;
      this.version++;
      this.on.onBond?.(a, b, bond.order);
    } else {
      this.bonds = this.bonds.filter((x) => x !== bond);
      this.version++;
      this.on.onBreak?.(a, b);
    }
  }

  // ângulo ideal entre ligações em volta de `a` (VSEPR)
  angle(a) {
    const lp = a.charge ? 0 : lonePairs(a.el); // íons: os vizinhos (de carga oposta) só se afastam entre si
    const domains = this.neighbors(a).length + this.free(a) + lp;
    if (domains <= 2) return Math.PI;
    if (domains === 3) return THREE.MathUtils.degToRad(120);
    if (lp >= 2) return THREE.MathUtils.degToRad(104.5);
    if (lp >= 1) return THREE.MathUtils.degToRad(107);
    return THREE.MathUtils.degToRad(109.47);
  }

  // um passo da simulação; átomos com `held` (segurados pela mão) não se movem pela física
  step(dt) {
    const atoms = this.atoms;
    const pos = (a) => a.obj.position;
    for (const a of atoms) {
      a.cool = Math.max(0, a.cool - dt);
      if (!a.held) a.bondedThisGrab = false; // soltou: pode ligar de novo na próxima pegada
    }

    // 1) a mão leva um átomo até outro (o que está sendo apontado): liga ou é repelido
    for (const a of atoms) {
      // cada pegada faz no máximo UMA ligação (evita anéis/triângulos sem querer ao continuar segurando)
      const b = a.held && !a.bondedThisGrab && !a.open ? a.intent : null; // átomo aberto (Bohr) não liga
      if (!b) {
        a.settleT = Math.max(0, (a.settleT || 0) - dt * 2); // tremida de um instante: só atrasa, não zera
        continue;
      }
      if (this.bondBetween(a, b) || b.open) continue;
      if (a.settleOn !== b) {
        a.settleOn = b; // mudou de alvo: recomeça a contar
        a.settleT = 0;
      }
      const d = pos(a).distanceTo(pos(b));
      if (d >= CAPTURE * b.scale) {
        a.settleT = Math.max(0, a.settleT - dt * 2);
        continue;
      }
      a.settleT += dt;
      const kind = this.canJoin(a, b);
      if (kind && a.settleT < SETTLE) {
        this.on.onSettle?.(a, b, a.settleT / SETTLE); // brilho crescente: "vai encaixar"
        continue;
      }
      if (kind) {
        for (const m of this.molecule(a)) m.scale = b.scale; // quem chega adota o tamanho da molécula alvo
        a.bondedThisGrab = true;
        a.cool = b.cool = 0.8;
        this.join(a, b, kind);
      } else {
        // repulsão: UM empurrão por "esbarrão" (o átomo estável e sua molécula se afastam um pouco);
        // a colisão impede que eles se atravessem enquanto a pessoa insiste
        if (b.cool === 0) {
          const dir = pos(b).clone().sub(pos(a)).normalize();
          for (const m of this.molecule(b)) if (!m.held) m.v.addScaledVector(dir, 0.45);
          b.cool = 0.6;
          this.on.onRepel?.(a, b);
        }
      }
    }

    // 1b) íons: cargas opostas se atraem (e se ligam ao encostar); cargas iguais se repelem
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a = atoms[i], b = atoms[j];
        if (!a.charge || !b.charge || a.open || b.open || this.bondBetween(a, b)) continue;
        const delta = pos(b).clone().sub(pos(a));
        const d = Math.max(delta.length(), 0.05);
        const dir = delta.multiplyScalar(1 / d);
        const opposite = a.charge * b.charge < 0;
        const sc = (a.scale + b.scale) / 2;
        if (opposite) {
          if (!(this.ionFree(a) > 0 && this.ionFree(b) > 0) || a.cool > 0 || b.cool > 0 || d > ATTRACT * sc) continue;
          if (this.molecule(a).includes(b)) continue;
          if (d < CAPTURE * sc) {
            a.cool = b.cool = 0.8;
            this.join(a, b, 'ionic');
            continue;
          }
          const acc = Math.min(3, (0.09 * sc * sc) / (d * d)); // ~ 1/d², como a força entre cargas
          if (!a.held) a.v.addScaledVector(dir, acc * dt);
          if (!b.held) b.v.addScaledVector(dir, -acc * dt);
        } else if (d < REPEL * sc && !this.molecule(a).includes(b)) {
          const acc = Math.min(3, (0.06 * sc * sc) / (d * d));
          if (!a.held) a.v.addScaledVector(dir, -acc * dt);
          if (!b.held) b.v.addScaledVector(dir, acc * dt);
        }
      }
    }

    // 2) movimento dos átomos soltos (com amortecimento); ficam entre 30 cm e 3 m da pessoa
    //    (a pessoa está na origem), para nenhuma molécula "sumir" atrás ou dentro da cabeça
    const damp = Math.exp(-dt * DAMPING);
    for (const a of atoms) {
      if (a.held) {
        a.v.set(0, 0, 0);
        continue;
      }
      pos(a).addScaledVector(a.v, dt);
      a.v.multiplyScalar(damp);
      const r = pos(a).length();
      if (r < 0.3 || r > 3) {
        pos(a).multiplyScalar(THREE.MathUtils.clamp(r, 0.3, 3) / (r || 1));
        a.v.multiplyScalar(0.2);
      }
    }

    // 3) restrições (dinâmica baseada em posições): comprimento das ligações, ângulos e colisões
    const w = (a) => (a.held ? 0 : 1);
    const fix = (a, b, target, k) => {
      const delta = pos(b).clone().sub(pos(a));
      const d = delta.length() || 1e-6;
      const wa = w(a), wb = w(b);
      if (wa + wb === 0) return;
      const corr = delta.multiplyScalar(((d - target) / d) * k / (wa + wb));
      pos(a).addScaledVector(corr, wa);
      pos(b).addScaledVector(corr, -wb);
    };
    for (let it = 0; it < 8; it++) {
      for (const bond of this.bonds) fix(bond.a, bond.b, (bond.ionic ? IONIC_LEN : BOND_LEN[bond.order]) * (bond.a.scale + bond.b.scale) / 2, 0.9);
      for (const c of atoms) {
        const ns = this.neighbors(c);
        if (ns.length < 2) continue;
        const theta = this.angle(c);
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const li = pos(ns[i]).distanceTo(pos(c)), lj = pos(ns[j]).distanceTo(pos(c));
            // lei dos cossenos: distância entre os vizinhos para o ângulo ideal
            const target = Math.sqrt(li * li + lj * lj - 2 * li * lj * Math.cos(theta));
            fix(ns[i], ns[j], target, 0.35);
          }
        }
      }
      for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
          const a = atoms[i], b = atoms[j];
          if (this.bondBetween(a, b)) continue;
          const d = pos(a).distanceTo(pos(b));
          // átomo aberto (modelo de Bohr) ocupa o tamanho das camadas dele
          const r = (x) => (x.open ? x.openRadius * x.scale : RADIUS * 1.15 * x.scale); // o zoom de duas mãos aumenta o átomo aberto
          const minD = r(a) + r(b);
          if (d < minD) fix(a, b, minD, 0.5); // não se atravessam
        }
      }
    }
  }

  // átomos conectados a `a` (a molécula inteira)
  molecule(a) {
    const seen = new Set([a]);
    const stack = [a];
    while (stack.length) for (const n of this.neighbors(stack.pop())) if (!seen.has(n)) (seen.add(n), stack.push(n));
    return [...seen];
  }

  molecules() {
    const done = new Set();
    const out = [];
    for (const a of this.atoms) {
      if (done.has(a)) continue;
      const m = this.molecule(a);
      m.forEach((x) => done.add(x));
      out.push(m);
    }
    return out;
  }

  // descrição da molécula: fórmula, se está completa e o nome (quando conhecido)
  describe(mol) {
    const count = {};
    for (const a of mol) count[a.el.sym] = (count[a.el.sym] || 0) + 1;
    // notação de Hill: C, depois H, depois os outros em ordem alfabética
    const order = Object.keys(count).sort((x, y) => (x === 'C' ? -1 : y === 'C' ? 1 : x === 'H' && count.C ? -1 : y === 'H' && count.C ? 1 : x.localeCompare(y)));
    const key = order.map((s) => s + (count[s] > 1 ? count[s] : '')).join('');
    const pretty = order.map((s) => s + (count[s] > 1 ? subscript(count[s]) : '')).join('');
    const ionic = this.bonds.some((b) => b.ionic && mol.includes(b.a));
    // composto iônico: falta o que um íon ainda não compensou e os elétrons que ainda podem passar
    const ionMissing = (a) => (this.ionicUsed(a) ? this.ionFree(a) + this.transferLeft(a) : 0);
    const missing = mol.reduce((s, a) => s + this.free(a) + (ionic ? ionMissing(a) : 0), 0);
    const known = missing === 0 ? KNOWN[key] : null;
    let name = known ? known[1] : null;
    let shown = known ? known[0] : pretty;
    const charge = mol.reduce((s, a) => s + (a.charge || 0), 0);
    let hint = null;
    if (ionic) {
      // fórmula com o cátion primeiro (Al₂O₃, Li₃N) e nome genérico: "<ânion> de <metal>"
      const cat = mol.filter((a) => (a.charge || 0) > 0), an = mol.filter((a) => (a.charge || 0) < 0);
      const part = (list) => [...new Set(list.map((a) => a.el.sym))].map((sym) => {
        const n = list.filter((a) => a.el.sym === sym).length;
        return sym + (n > 1 ? subscript(n) : '');
      }).join('');
      if (!known) shown = part(cat) + part(an) + part(mol.filter((a) => !a.charge));
      const catEl = [...new Set(cat.map((a) => a.el))], anEl = [...new Set(an.map((a) => a.el))];
      if (!name && missing === 0 && catEl.length === 1 && anEl.length === 1 && ANION_ROOT[anEl[0].sym]) name = `${ANION_ROOT[anEl[0].sym]} de ${catEl[0].name.toLowerCase()}`;
      if (missing) {
        const giver = mol.find((a) => this.ionicUsed(a) && this.transferLeft(a) > 0);
        if (charge) hint = `carga ${charge > 0 ? '+' : '−'}${Math.abs(charge)}: falta${Math.abs(charge) > 1 ? 'm' : ''} íon${Math.abs(charge) > 1 ? 's' : ''} ${charge > 0 ? 'negativo' : 'positivo'}${Math.abs(charge) > 1 ? 's' : ''}`;
        else if (giver) {
          const n = this.transferLeft(giver);
          hint = `${giver.el.sym}${chargeText(giver.charge)} ainda pode ${isMetal(giver.el) ? 'perder' : 'ganhar'} ${n} elétron${n > 1 ? 's' : ''}`;
        }
      }
    }
    if (key === 'C2H6O' && missing === 0) {
      const o = mol.find((a) => a.el.sym === 'O');
      const ether = this.neighbors(o).filter((n) => n.el.sym === 'C').length === 2;
      [shown, name] = ether ? ['CH₃OCH₃', 'éter dimetílico'] : ['C₂H₅OH', 'etanol'];
    }
    return { key, pretty: shown, missing, complete: missing === 0, name, ionic, charge, hint };
  }
}

const subscript = (n) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]);

// moléculas completas conhecidas: fórmula de Hill → [como o público conhece a fórmula, nome]
const KNOWN = {
  H2: ['H₂', 'gás hidrogênio'],
  O2: ['O₂', 'gás oxigênio'],
  N2: ['N₂', 'gás nitrogênio'],
  H2O: ['H₂O', 'água'],
  H2O2: ['H₂O₂', 'peróxido de hidrogênio (água oxigenada)'],
  H3N: ['NH₃', 'amônia'],
  H4N2: ['N₂H₄', 'hidrazina'],
  H2N2: ['N₂H₂', 'diazeno'],
  HNO: ['HNO', 'nitroxila'],
  CH4: ['CH₄', 'metano'],
  CO2: ['CO₂', 'dióxido de carbono'],
  CHN: ['HCN', 'cianeto de hidrogênio'],
  CH2O: ['CH₂O', 'formaldeído'],
  CH4O: ['CH₃OH', 'metanol'],
  CH5N: ['CH₃NH₂', 'metilamina'],
  CH2O2: ['HCOOH', 'ácido fórmico'],
  CH4N2O: ['CO(NH₂)₂', 'ureia'],
  C2H6: ['C₂H₆', 'etano'],
  C2H4: ['C₂H₄', 'eteno (etileno)'],
  C2H2: ['C₂H₂', 'etino (acetileno)'],
  C2H4O2: ['CH₃COOH', 'ácido acético (vinagre)'],
  C3H8: ['C₃H₈', 'propano'],
  // compostos iônicos com nome popular (os outros recebem o nome "<ânion> de <metal>")
  Al2O3: ['Al₂O₃', 'óxido de alumínio (alumina)'],
  Li3N: ['Li₃N', 'nitreto de lítio'],
  // com os elementos dos grupos principais (Fase 1)
  ClNa: ['NaCl', 'cloreto de sódio (sal de cozinha)'],
  ClK: ['KCl', 'cloreto de potássio'],
  FNa: ['NaF', 'fluoreto de sódio'],
  FLi: ['LiF', 'fluoreto de lítio'],
  BrK: ['KBr', 'brometo de potássio'],
  ClH: ['HCl', 'cloreto de hidrogênio (ácido clorídrico)'],
  FH: ['HF', 'fluoreto de hidrogênio'],
  BrH: ['HBr', 'brometo de hidrogênio'],
  HI: ['HI', 'iodeto de hidrogênio'],
  HLi: ['LiH', 'hidreto de lítio'],
  HNa: ['NaH', 'hidreto de sódio'],
  HNaO: ['NaOH', 'hidróxido de sódio (soda cáustica)'],
  HKO: ['KOH', 'hidróxido de potássio'],
  ClHO: ['HClO', 'ácido hipocloroso'],
  H2S: ['H₂S', 'sulfeto de hidrogênio (gás sulfídrico)'],
  H3P: ['PH₃', 'fosfina'],
  H4Si: ['SiH₄', 'silano'],
  BH3: ['BH₃', 'borano'],
  BF3: ['BF₃', 'trifluoreto de boro'],
  AlCl3: ['AlCl₃', 'cloreto de alumínio'],
  Cl3N: ['NCl₃', 'tricloreto de nitrogênio'],
  Cl3P: ['PCl₃', 'tricloreto de fósforo'],
  CCl4: ['CCl₄', 'tetracloreto de carbono'],
  CF4: ['CF₄', 'tetrafluorometano'],
  CH3Cl: ['CH₃Cl', 'clorometano'],
  CH2Cl2: ['CH₂Cl₂', 'diclorometano'],
  CHCl3: ['CHCl₃', 'clorofórmio'],
  CS2: ['CS₂', 'dissulfeto de carbono'],
  Cl2: ['Cl₂', 'gás cloro'],
  F2: ['F₂', 'gás flúor'],
  Br2: ['Br₂', 'bromo'],
  I2: ['I₂', 'iodo'],
  MgO: ['MgO', 'óxido de magnésio'],
  CaO: ['CaO', 'óxido de cálcio (cal virgem)'],
  Cl2Mg: ['MgCl₂', 'cloreto de magnésio'],
  CaCl2: ['CaCl₂', 'cloreto de cálcio'],
  CaF2: ['CaF₂', 'fluoreto de cálcio (fluorita)'],
  Li2O: ['Li₂O', 'óxido de lítio'],
  Na2O: ['Na₂O', 'óxido de sódio'],
  K2O: ['K₂O', 'óxido de potássio'],
};
