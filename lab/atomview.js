// "Átomo aberto": modelo de Bohr (simplificado) de um elemento — e, na Fase 2, de seus isótopos e íons.
//  • núcleo com o número de prótons (vermelho) e nêutrons (cinza) do estado atual
//  • elétrons em anéis por camada (K, L, M…), girando; a camada externa em amarelo
//  • rótulo virado para a pessoa + botões: tirar/colocar nêutron e elétron (as regras estão em ions.js)
//  • aviso: fora de escala — o núcleo real é ~100 mil vezes menor que o átomo
import * as THREE from 'three';
import { CanvasPanel, makeButton, roundRect, font } from './ui3d.js';

const SPHERE = new THREE.SphereGeometry(1, 8, 6); // partículas de ~5 mm: poucos triângulos bastam (o urânio tem 330 delas)
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const NUCLEON = 0.0055;
const COLOR = { p: 0xe84a4a, n: 0xb9c2c8, e: 0x4fc3ff, ev: 0xffd400 };
const noRay = (o) => o.traverse((x) => (x.raycast = () => {}));

export class AtomView extends THREE.Group {
  // describe(state) → { title, rows:[{text,color}], shells } (ions.js); onButton('n'|'e', +1|−1)
  constructor(el, state, { describe, onButton } = {}) {
    super();
    this.el = el;
    this.describe = describe;
    this.visual = new THREE.Group(); // núcleo + camadas (refeito a cada mudança)
    this.add(this.visual);
    this.flyers = [];

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

  setState(state) {
    this.state = state;
    this.info = this.describe(state);
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
    for (let i = 0; i < A; i++) {
      const r = this.rn * Math.cbrt((i + 0.5) / A);
      const y = 1 - (2 * (i + 0.5)) / A;
      const rr = Math.sqrt(1 - y * y);
      const t = i * GOLDEN;
      m.makeScale(NUCLEON, NUCLEON, NUCLEON).setPosition(r * Math.cos(t) * rr, r * y, r * Math.sin(t) * rr);
      const isProton = ip < Z && (iN >= N || ip / Z <= iN / Math.max(1, N)); // intercalados (proporcional)
      if (isProton) protons.setMatrixAt(ip++, m);
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
    const foot = 'Modelo de Bohr, fora de escala (o núcleo real é ~100 mil vezes menor) · pinça rápida no núcleo fecha';
    ctx.fillStyle = '#8aa3ae';
    fit(foot, 26, 400);
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

  update(dt, headQuat) {
    for (const r of this.rings) r.rotateY(r.userData.speed * dt);
    for (const f of this.flyers) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.mesh.position.lerpVectors(f.from, f.to, 1 - (1 - k) ** 3);
      f.mesh.material.opacity = f.out ? 1 - k : Math.min(1, k * 3);
    }
    for (const f of this.flyers.filter((x) => x.t >= x.dur)) {
      this.remove(f.mesh);
      f.mesh.material.dispose();
    }
    this.flyers = this.flyers.filter((x) => x.t < x.dur);
    // cartão acima das camadas, virado para a pessoa (compensa a rotação do próprio átomo, se houver)
    this.card.position.set(0, this.outer + 0.2, 0);
    this.mini.position.set(0, this.outer + 0.05, 0);
    const parentQ = new THREE.Quaternion();
    this.getWorldQuaternion(parentQ);
    this.card.quaternion.copy(parentQ.invert().multiply(headQuat));
    this.mini.quaternion.copy(this.card.quaternion);
  }

  dispose() {
    this.traverse((o) => {
      if (o.geometry && o.geometry !== SPHERE) o.geometry.dispose();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
