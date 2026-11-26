// Rastreamento da cabeça (3DoF = só rotação), adaptável a qualquer aparelho:
//   1. RelativeOrientationSensor (Generic Sensor API, Chrome/Android): suave, sem saltos da bússola
//   2. evento deviceorientation (iPhone e demais navegadores; no iPhone pede permissão)
//   3. arrastar com o dedo/mouse (computador ou aparelho sem giroscópio)
import * as THREE from 'three';

const Q_WORLD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); // Terra (Z p/ cima) → three (Y p/ cima)
const Z = new THREE.Vector3(0, 0, 1);

export class HeadTracker {
  constructor(dragElement) {
    this.el = dragElement;
    this.raw = new THREE.Quaternion(); // orientação sem a correção de "frente"
    this.quaternion = new THREE.Quaternion(); // orientação final usada pela câmera
    this.yawOffset = 0;
    this.kind = 'none';
    this.events = 0; // leituras recebidas (para medir a frequência)
    this.drag = { yaw: 0, pitch: 0 };
    this.pendingRecenter = true;
  }

  async start() {
    // iPhone/iPad: precisa pedir permissão dentro de um toque do usuário
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return this.startDrag('permissão negada');
      } catch {
        return this.startDrag('permissão indisponível');
      }
    }
    if ('RelativeOrientationSensor' in window) {
      try {
        const s = new window.RelativeOrientationSensor({ frequency: 60, referenceFrame: 'screen' });
        const ok = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 1200);
          s.addEventListener('reading', () => {
            if (this.kind !== 'sensor') {
              clearTimeout(timer);
              this.kind = 'sensor';
              resolve(true);
            }
            this.events++;
            this.raw.fromArray(s.quaternion);
            this.raw.premultiply(Q_WORLD);
          });
          s.addEventListener('error', () => {
            clearTimeout(timer);
            resolve(false);
          });
          s.start();
        });
        if (ok) {
          this.sensor = s;
          return this.kind;
        }
        s.stop();
      } catch {
        /* sem permissão ou sem sensor: tenta o próximo */
      }
    }
    if ('DeviceOrientationEvent' in window) {
      const got = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 1200);
        this.onDO = (e) => {
          if (e.alpha == null && e.beta == null) return;
          if (this.kind !== 'deviceorientation') {
            clearTimeout(timer);
            this.kind = 'deviceorientation';
            resolve(true);
          }
          this.events++;
          this.fromEuler(e.alpha || 0, e.beta || 0, e.gamma || 0);
        };
        window.addEventListener('deviceorientation', this.onDO);
      });
      if (got) return this.kind;
      window.removeEventListener('deviceorientation', this.onDO);
    }
    return this.startDrag('sem giroscópio');
  }

  // conversão clássica alpha/beta/gamma → quaternion, considerando a rotação da tela
  fromEuler(alpha, beta, gamma) {
    const d = THREE.MathUtils.DEG2RAD;
    const euler = new THREE.Euler(beta * d, alpha * d, -gamma * d, 'YXZ');
    const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * d;
    this.raw.setFromEuler(euler);
    this.raw.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // câmera olha para fora da tela
    this.raw.multiply(new THREE.Quaternion().setFromAxisAngle(Z, -orient));
  }

  startDrag(reason) {
    this.kind = 'drag';
    this.reason = reason;
    let last = null;
    this.onDown = (e) => (last = { x: e.clientX, y: e.clientY });
    this.onMove = (e) => {
      if (!last) return;
      this.drag.yaw += (e.clientX - last.x) * 0.005;
      this.drag.pitch = THREE.MathUtils.clamp(this.drag.pitch + (e.clientY - last.y) * 0.005, -1.4, 1.4);
      last = { x: e.clientX, y: e.clientY };
      this.events++;
    };
    this.onUp = () => (last = null);
    this.el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    return this.kind;
  }

  // "olhar para frente": a direção atual vira a frente da cena (só o giro horizontal)
  recenter() {
    this.pendingRecenter = true;
  }

  update() {
    if (this.kind === 'drag') {
      this.raw.setFromEuler(new THREE.Euler(this.drag.pitch, this.drag.yaw, 0, 'YXZ'));
    }
    if (this.pendingRecenter && this.kind !== 'none') {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.raw);
      this.yawOffset = Math.atan2(-fwd.x, -fwd.z);
      this.pendingRecenter = false;
    }
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.yawOffset).multiply(this.raw);
    return this.quaternion;
  }

  stop() {
    this.sensor?.stop();
    if (this.onDO) window.removeEventListener('deviceorientation', this.onDO);
    if (this.onDown) {
      this.el.removeEventListener('pointerdown', this.onDown);
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
    }
  }
}
