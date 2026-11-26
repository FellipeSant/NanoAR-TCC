// "Átomo aberto": modelo de Bohr (simplificado) de um elemento — e, na Fase 2, de seus isótopos e íons.
//  • núcleo com o número de prótons (vermelho) e nêutrons (cinza) do estado atual
//  • elétrons em anéis por camada (K, L, M…), girando; a camada externa em amarelo
//  • rótulo virado para a pessoa + botões: tirar/colocar nêutron e elétron (as regras estão em ions.js)
//  • núcleo instável: botão "decair" — as partículas emitidas saem voando e o átomo vira outro elemento
//  • com a mão: pinçar um elétron da camada externa (ou o núcleo, para um nêutron) e puxar para fora;
//    a alça "⠿ mover" move o átomo aberto; o cartão não cresce com o zoom de duas mãos
//  • aviso: fora de escala — o núcleo real é ~100 mil vezes menor que o átomo
import * as THREE from 'three';
import { CanvasPanel, makeButton, roundRect, font } from './ui3d.js';

const SPHERE = new THREE.SphereGeometry(1, 8, 6); // partículas de ~5 mm: poucos triângulos bastam (o urânio tem 330 delas)
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const NUCLEON = 0.0055;
const COLOR = { p: 0xe84a4a, n: 0xb9c2c8, e: 0x4fc3ff, ev: 0xffd400, pos: 0xff6fd8, nu: 0xffffff };
const noRay = (o) => o.traverse((x) => (x.raycast = () => {}));
const _ws = new THREE.Vector3();

export class AtomView extends THREE.Group {
  // describe(state) → { title, rows:[{text,color}], shells } (ions.js); onButton('n'|'e', +1|−1);
  // canDecay(state) → o núcleo é instável?; onDecay() → pedido de decaimento
  constructor(el, state, { describe, onButton, canDecay, onDecay } = {}) {
    super();
    this.el = el;
    this.describe = describe;
    this.canDecay = canDecay;
    this.note = null; // explicação do último decaimento (aparece no rodapé do cartão por um tempo)
    this.noteT = 0;
    this.visual = new THREE.Group(); // núcleo + camadas (refeito a cada mudança)
    this.add(this.visual);
    this.flyers = [];
    this.hold = 0; // > 0: a mão está mirando aqui — as camadas param de girar (fica fácil pegar um elétron)
    this.hidden = null; // elétron que está sendo puxado (escondido do anel)

    // para pegar/fechar o átomo há só uma esfera invisível em volta do núcleo: as órbitas são
    // linhas, e o three.js "acerta" linhas a até 1 m de distância — roubariam o apontamento da tabela
    const hitMat = new THREE.MeshBasicMaterial();
    hitMat.visible = false; // não desenha, mas o raio acerta
    this.hit = new THREE.Mesh(SPHERE, hitMat);
    this.add(this.hit);

    // cartão virado para a pessoa: rótulo + botões
    this.card = new THREE.Group();
    this.label = new CanvasPanel(0.5, 0.19, { px: 1024, draw: (ctx, w, h) => this.drawLabel(ctx, w, h) });
    this.label.material.depthTest = false;
    this.label.renderOrder = 995;
    noRay(this.label);
    this.card.add(this.label);
    const defs = [
      ['− nêutron', 'n', -1, '#2a3338', '#b9c2c8'],
      ['+ nêutron', 'n', 1, '#2a3338', '#b9c2c8'],
      ['− elétron', 'e', -1, '#12303b', '#4fc3ff'],
      ['+ elétron', 'e', 1, '#12303b', '#4fc3ff'],
    ];
    this.buttons = defs.map(([text, what, delta, color, accent], i) => {
      const b = makeButton(text, { width: 0.118, height: 0.062, color, accent, onSelect: () => onButton?.(what, delta) });
      b.material.depthTest = false;
      b.renderOrder = 995;
      b.position.set(-0.189 + i * 0.126, -0.135, 0);
      b.userData.what = `${what}${delta > 0 ? '+' : '-'}`;
      this.card.add(b);
      return b;
    });
    // núcleo instável: deixar decair (o tempo é acelerado)
    // fica na mesma fileira dos outros botões, à direita (o cartão não sobe e não tampa a tabela)
    this.decayBtn = makeButton('☢ decair', { width: 0.13, height: 0.062, color: '#3b3000', accent: '#ffd400', onSelect: () => onDecay?.() });
    this.decayBtn.material.depthTest = false;
    this.decayBtn.renderOrder = 995;
    this.decayBtn.position.set(0.322, -0.135, 0);
    this.decayBtn.userData.what = 'decay';
    this.decayBtn.visible = false;
    this.card.add(this.decayBtn);
    // alça para mover o átomo aberto (pinçar o núcleo agora puxa um nêutron)
    this.moveHandle = new CanvasPanel(0.13, 0.045, {
      px: 256,
      draw: (ctx, w, h) => {
        roundRect(ctx, 3, 3, w - 6, h - 6, h * 0.4, 'rgba(10,24,31,0.92)', 'rgba(79,209,197,0.7)');
        ctx.fillStyle = '#bfd3db';
        ctx.font = font(h * 0.5, 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⠿ mover', w / 2, h / 2 + 1);
      },
    });
    this.moveHandle.material.depthTest = false;
    this.moveHandle.renderOrder = 995;
    this.moveHandle.position.set(-0.17, 0.125, 0);
    this.moveHandle.userData.moveHandle = true;
    this.card.add(this.moveHandle);
    this.add(this.card);
    // versão compacta (só o nome) para quando outro átomo aberto é o "ativo": evita amontoar cartões
    this.mini = new CanvasPanel(0.26, 0.05, {
      px: 512,
      draw: (ctx, w, h) => {
        if (!this.info) return;
        roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.4, 'rgba(10,24,31,0.85)', this.info.rows[2]?.color || '#ffd400');
        const t = this.info.title;
        let size = 44;
        ctx.font = font(size, 700);
        while (ctx.measureText(t).width > w - 40 && size > 16) ctx.font = font((size -= 1), 700);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, w / 2, h / 2 + 2);
      },
    });
    this.mini.material.depthTest = false;
    this.mini.renderOrder = 994;
    this.mini.visible = false;
    noRay(this.mini);
    this.add(this.mini);
    this.setState(state);
  }

  // ativo = cartão completo com botões; inativo = só o nome
  setActive(active) {
    this.card.visible = active;
    this.mini.visible = !active;
  }

  // o átomo virou outro elemento (decaimento): o próximo setState redesenha tudo
  setElement(el) {
    this.el = el;
  }

  // posições (no mundo) dos elétrons da camada externa — para a mão mirar e pegar um
  outerElectrons() {
    const ring = this.rings[this.rings.length - 1];
    if (!ring) return [];
    const mesh = ring.children[1];
    mesh.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4(), out = [];
    for (let i = 0; i < this.info.shells[this.info.shells.length - 1]; i++) {
      mesh.getMatrixAt(i, m);
      out.push(new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld));
    }
    return out;
  }

  // esconde (ou mostra de volta) o elétron que a mão está puxando
  hideElectron(i) {
    this.showElectron();
    const mesh = this.rings[this.rings.length - 1]?.children[1];
    if (!mesh) return;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    this.hidden = { mesh, i, m: m.clone() };
    mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
  }
  showElectron() {
    const h = this.hidden;
    this.hidden = null;
    if (!h || !this.rings.some((r) => r.children[1] === h.mesh)) return; // o anel já foi refeito
    h.mesh.setMatrixAt(h.i, h.m);
    h.mesh.instanceMatrix.needsUpdate = true;
  }

  setNote(text, seconds = 10) {
    this.note = text;
    this.noteT = seconds;
    this.label.redraw();
  }

  setState(state) {
    this.state = state;
    this.info = this.describe(state);
    this.decayBtn.visible = !!this.canDecay?.(state);
    const Z = this.el.z, N = state.N, A = Z + N;
    const shells = this.info.shells;

    for (const o of [...this.visual.children]) {
      this.visual.remove(o);
      o.traverse((x) => {
        if (x.geometry && x.geometry !== SPHERE) x.geometry.dispose();
        x.material?.dispose?.();
      });
    }

    // núcleo: esferas preenchendo uma bola (raio ∝ A^(1/3)), prótons e nêutrons misturados
    this.rn = 0.0062 * Math.cbrt(A);
    const protons = new THREE.InstancedMesh(SPHERE, new THREE.MeshStandardMaterial({ color: COLOR.p, roughness: 0.4 }), Z);
    const neutrons = new THREE.InstancedMesh(SPHERE, new THREE.MeshStandardMaterial({ color: COLOR.n, roughness: 0.5 }), Math.max(1, N));
    neutrons.visible = N > 0;
    const m = new THREE.Matrix4();
    let ip = 0, iN = 0;
    // quem é próton: os Z índices com menor valor numa terceira sequência (√2), sem relação com a posição
    const key = (i) => (i * 0.41421356237 + 0.3) % 1;
    const protonSet = new Set([...Array(A).keys()].sort((a, b) => key(a) - key(b)).slice(0, Z));
    for (let i = 0; i < A; i++) {
      // bola uniforme: o raio cresce com i (mesmo volume para cada núcleon), mas a direção vem de
      // duas sequências "quase aleatórias" independentes — assim prótons e nêutrons se misturam em
      // todas as direções (aparece no zoom de duas mãos)
      const r = this.rn * Math.cbrt((i + 0.5) / A);
      const y = 1 - 2 * ((i * 0.6180339887 + 0.5) % 1);
      const rr = Math.sqrt(1 - y * y);
      const t = 2 * Math.PI * ((i * 0.7548776662) % 1);
      m.makeScale(NUCLEON, NUCLEON, NUCLEON).setPosition(r * Math.cos(t) * rr, r * y, r * Math.sin(t) * rr);
      if (protonSet.has(i)) protons.setMatrixAt(ip++, m);
      else neutrons.setMatrixAt(iN++, m);
    }
    this.visual.add(protons, neutrons);

    // camadas e elétrons (a primeira camada fica fora do núcleo, mesmo nos núcleos grandes)
    this.rings = [];
    const r0 = Math.max(0.05, this.rn + 0.02);
    shells.forEach((count, k) => {
      const radius = r0 + k * 0.03;
      const outer = k === shells.length - 1;
      const ring = new THREE.Group();
      ring.rotation.set(0.35 * Math.sin(k * 1.7), 0, 0.3 * Math.cos(k * 2.3)); // planos levemente diferentes
      const pts = [];
      for (let i = 0; i <= 64; i++) pts.push(new THREE.Vector3(radius * Math.cos((i / 64) * Math.PI * 2), 0, radius * Math.sin((i / 64) * Math.PI * 2)));
      ring.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: outer ? COLOR.ev : 0x6fb6d9, transparent: true, opacity: 0.6 })));
      const electrons = new THREE.InstancedMesh(SPHERE, new THREE.MeshStandardMaterial({ color: outer ? COLOR.ev : COLOR.e, emissive: outer ? 0x5a4a00 : 0x0a3550 }), Math.max(1, count));
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        m.makeScale(0.0065, 0.0065, 0.0065).setPosition(radius * Math.cos(a), 0, radius * Math.sin(a));
        electrons.setMatrixAt(i, m);
      }
      ring.add(electrons);
      ring.userData = { speed: 0.9 / (k + 1), radius };
      this.visual.add(ring);
      this.rings.push(ring);
    });
    this.outer = shells.length ? r0 + (shells.length - 1) * 0.03 : this.rn + 0.02;
    noRay(this.visual);
    this.hit.scale.setScalar(Math.max(0.045, this.rn + 0.025));
    this.label.redraw();
    this.mini?.redraw();
  }

  drawLabel(ctx, w, h) {
    const info = this.info;
    if (!info) return;
    roundRect(ctx, 6, 6, w - 12, h - 12, 40, 'rgba(10,24,31,0.92)', info.rows[2]?.color || '#ffd400');
    const fit = (text, size, weight) => {
      ctx.font = font(size, weight);
      while (ctx.measureText(text).width > w - 80 && size > 18) ctx.font = font((size -= 1), weight);
    };
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    fit(info.title, 60, 700);
    ctx.fillText(info.title, 40, 80);
    info.rows.forEach((r, i) => {
      ctx.fillStyle = r.color;
      fit(r.text, 38, i >= 2 ? 600 : 400);
      ctx.fillText(r.text, 40, 140 + i * 54);
    });
    const foot = this.note || 'Modelo de Bohr, fora de escala (o núcleo real é ~100 mil vezes menor) · pinça rápida no núcleo fecha';
    ctx.fillStyle = this.note ? '#ffd400' : '#8aa3ae';
    fit(foot, 26, this.note ? 600 : 400);
    ctx.fillText(foot, 40, h - 26);
  }

  // partícula voando para dentro ou para fora (só efeito visual; o estado já mudou)
  fly(what, delta) {
    const mesh = new THREE.Mesh(SPHERE, new THREE.MeshStandardMaterial({ color: what === 'n' ? COLOR.n : COLOR.e, emissive: what === 'e' ? 0x0a3550 : 0x000000, transparent: true }));
    mesh.scale.setScalar(what === 'n' ? NUCLEON * 1.3 : 0.0075);
    mesh.raycast = () => {};
    // sai na direção da pessoa (para frente) e um pouco para cima, com uma variação
    const dir = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.5, 1).normalize();
    const near = what === 'n' ? new THREE.Vector3() : dir.clone().multiplyScalar(this.outer);
    const far = dir.clone().multiplyScalar(this.outer + 0.22);
    const [from, to] = delta < 0 ? [near, far] : [far, near];
    mesh.position.copy(from);
    this.add(mesh);
    this.flyers.push({ mesh, from, to, out: delta < 0, t: 0, dur: 0.7 });
  }

  // decaimento: as partículas emitidas saem do núcleo (ou, na captura eletrônica, um elétron da
  // camada K entra nele). kinds: 'e-', 'e+', 'nu' (neutrino), 'alpha', 'n', 'p', 'capture', 'cluster'
  emit(particles) {
    particles.forEach((p, k) => {
      const obj = particleMesh(p);
      obj.traverse((x) => (x.raycast = () => {}));
      // espalhadas, mas saindo para o lado de quem olha (+z) e um pouco para cima
      const a = (k / Math.max(1, particles.length)) * Math.PI * 2 + Math.random() * 0.8;
      const dir = new THREE.Vector3(Math.cos(a) * 0.9, 0.35 + Math.sin(a) * 0.5, 1).normalize();
      const fast = p.kind === 'nu'; // o neutrino quase não interage: atravessa tudo, rápido
      let from = new THREE.Vector3(), to = dir.clone().multiplyScalar(this.outer + (fast ? 0.6 : 0.3)), out = true;
      if (p.kind === 'capture') {
        from = dir.clone().setY(0).normalize().multiplyScalar(Math.max(0.05, this.rn + 0.02)); // camada K
        to = new THREE.Vector3();
        out = false;
      }
      obj.position.copy(from);
      this.add(obj);
      this.flyers.push({ mesh: obj, from, to, out, t: -k * 0.12, dur: fast ? 0.6 : 1.1 });
    });
  }

  update(dt, headQuat) {
    if (this.hold > 0) this.hold -= dt;
    else for (const r of this.rings) r.rotateY(r.userData.speed * dt);
    if (this.noteT > 0 && (this.noteT -= dt) <= 0) {
      this.note = null;
      this.label.redraw();
    }
    for (const f of this.flyers) {
      f.t += dt;
      const k = THREE.MathUtils.clamp(f.t / f.dur, 0, 1);
      f.mesh.visible = f.t >= 0;
      f.mesh.position.lerpVectors(f.from, f.to, 1 - (1 - k) ** 3);
      const o = f.out ? 1 - k * k : Math.min(1, k * 3) * (1 - Math.max(0, k - 0.8) * 5);
      f.mesh.traverse((x) => x.material && (x.material.opacity = o));
    }
    for (const f of this.flyers.filter((x) => x.t >= x.dur)) {
      this.remove(f.mesh);
      f.mesh.traverse((x) => x.material?.dispose());
    }
    this.flyers = this.flyers.filter((x) => x.t < x.dur);
    // cartão acima das camadas, virado para a pessoa (compensa a rotação do próprio átomo, se houver)
    // zoom de duas mãos: o átomo cresce, mas o cartão fica do mesmo tamanho (e logo acima das camadas)
    const ws = this.getWorldScale(_ws).x || 1;
    this.card.scale.setScalar(1 / ws);
    this.mini.scale.setScalar(1 / ws);
    this.card.position.set(0, this.outer + 0.2 / ws, 0);
    this.mini.position.set(0, this.outer + 0.05 / ws, 0);
    const parentQ = new THREE.Quaternion();
    this.getWorldQuaternion(parentQ);
    this.card.quaternion.copy(parentQ.invert().multiply(headQuat));
    this.mini.quaternion.copy(this.card.quaternion);
  }

  dispose() {
    this.flyers.forEach((f) => f.mesh.traverse((x) => x.material?.dispose()));
    this.traverse((o) => {
      if (o.geometry && o.geometry !== SPHERE) o.geometry.dispose();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

// partícula emitida: elétron (azul), pósitron (rosa), neutrino (branco, pequeno), nêutron (cinza),
// próton (vermelho), alfa (2 prótons + 2 nêutrons juntos) ou um núcleo inteiro (cluster)
function particleMesh(p) {
  const mat = (color, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, emissive, transparent: true });
  const one = (color, size, emissive) => {
    const m = new THREE.Mesh(SPHERE, mat(color, emissive));
    m.scale.setScalar(size);
    return m;
  };
  if (p.kind === 'e-' || p.kind === 'capture') return one(COLOR.e, 0.0075, 0x0a3550);
  if (p.kind === 'e+') return one(COLOR.pos, 0.0075, 0x4a1040);
  if (p.kind === 'nu') return one(COLOR.nu, 0.004, 0x555555);
  if (p.kind === 'n') return one(COLOR.n, NUCLEON * 1.3);
  if (p.kind === 'p') return one(COLOR.p, NUCLEON * 1.3);
  // alfa ou núcleo: bolinha de prótons e nêutrons
  const np = p.kind === 'alpha' ? 2 : p.p, nn = p.kind === 'alpha' ? 2 : p.n;
  const g = new THREE.Group();
  const total = np + nn, r = NUCLEON * 1.1 * Math.cbrt(total);
  for (let i = 0; i < total; i++) {
    const y = 1 - (2 * (i + 0.5)) / total, rr = Math.sqrt(1 - y * y), t = i * GOLDEN;
    const m = one(i < np ? COLOR.p : COLOR.n, NUCLEON * 1.2);
    m.position.set(r * Math.cos(t) * rr, r * y, r * Math.sin(t) * rr);
    g.add(m);
  }
  return g;
}
