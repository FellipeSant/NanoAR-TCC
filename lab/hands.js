// Mãos pela câmera traseira (MediaPipe Hand Landmarker), sem tocar na tela.
// Para cada mão: posição 3D aproximada da "pinça" (entre o polegar e o indicador) no referencial
// da câmera e se ela está pinçando. A distância vem do tamanho aparente da mão na imagem.
import * as THREE from 'three';

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9, PINKY_MCP = 17;
const PALM_LEN = 0.09; // pulso → base do dedo médio (m), adulto típico
const PALM_WIDTH = 0.075; // base do indicador → base do mindinho (m)
const REMEMBER = 'nanoar-lab-hands-delegate'; // lembra neste aparelho se a GPU foi lenta

export class HandTracker {
  // preference: 'auto' (começa na GPU e troca para a CPU se for lenta), 'CPU' ou 'GPU'
  constructor(video, { camFov = 68, maxWidth = 480, rate = 30, preference = 'auto' } = {}) {
    this.preference = preference;
    this.history = []; // ex.: ['GPU 6895 ms', 'CPU 45 ms'] para o relatório
    this.video = video;
    this.camFov = camFov;
    this.maxWidth = maxWidth;
    this.interval = 1000 / rate;
    this.status = 'carregando modelo das mãos…';
    this.mode = null; // 'worker' | 'main'
    this.delegate = null; // 'GPU' | 'CPU'
    this.hands = []; // [{ pinch: Vector3 (câmera), pinching, points: Vector3[21] }]
    this.busy = false;
    this.last = 0;
    this.stats = { results: 0, ms: 0, withHands: 0, since: performance.now() };
  }

  async load() {
    try {
      let remembered = null;
      try {
        remembered = localStorage.getItem(REMEMBER);
      } catch {
        /* sem armazenamento */
      }
      const useCpu = this.preference === 'CPU' || (this.preference === 'auto' && remembered === 'CPU');
      if (useCpu && this.preference === 'auto') this.history.push('GPU lenta antes → CPU direto');
      await this.loadWorker(useCpu ? 'CPU' : 'GPU');
    } catch (err) {
      console.warn('mãos em segundo plano indisponível; usando a página principal', err);
      this.worker?.terminate();
      this.worker = null;
      try {
        await this.loadMain();
      } catch (err2) {
        this.status = 'mãos indisponíveis neste aparelho';
        throw err2;
      }
    }
    this.status = 'pronto';
  }

  loadWorker(delegate = 'GPU') {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./hands-worker.js', import.meta.url));
      const timer = setTimeout(() => reject(new Error('tempo esgotado')), 30000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.worker = w;
          this.mode = 'worker';
          this.delegate = m.delegate;
          w.onmessage = (ev) => ev.data.type === 'result' ? this.onResult(ev.data.landmarks, ev.data.ms) : console.warn('mãos:', ev.data.message);
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      w.postMessage({ type: 'init', delegate });
    });
  }

  async loadMain() {
    const { FilesetResolver, HandLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const create = (delegate) =>
      HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1 });
    try {
      this.landmarker = await create('GPU');
      this.delegate = 'GPU';
    } catch {
      this.landmarker = await create('CPU');
      this.delegate = 'CPU';
    }
    this.mode = 'main';
  }

  // chamada a cada quadro; envia uma imagem nova para detecção quando a anterior terminou
  async update(now) {
    const v = this.video;
    if (this.busy || this.status !== 'pronto' || !v.videoWidth || now - this.last < this.interval) return;
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    this.last = now;
    this.busy = true;
    try {
      if (this.worker) {
        const k = Math.min(1, (this.delegate === 'CPU' ? 320 : this.maxWidth) / v.videoWidth); // CPU: imagem menor, mais rápido
        let bitmap;
        try {
          bitmap = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * k), resizeHeight: Math.round(v.videoHeight * k), resizeQuality: 'low' });
        } catch {
          bitmap = await createImageBitmap(v);
        }
        this.worker.postMessage({ type: 'frame', bitmap, time: now }, [bitmap]);
        return; // "busy" é liberado quando o resultado chega
      }
      const t0 = performance.now();
      const res = this.landmarker.detectForVideo(v, now);
      this.onResult(res.landmarks || [], performance.now() - t0);
    } catch (err) {
      console.warn('mãos:', err);
      this.busy = false;
    }
  }

  onResult(landmarks, ms) {
    this.busy = false;
    const s = this.stats;
    s.results++;
    s.ms += ms;
    // GPU lenta neste aparelho? troca uma vez para a CPU (às vezes é mais rápida em celulares simples)
    // GPU lenta neste aparelho? troca para a CPU logo cedo (a 1ª detecção inclui o "aquecimento")
    if (this.preference === 'auto' && this.worker && this.delegate === 'GPU' && !this.switched) {
      if ((s.results === 1 && ms > 2500) || (s.results === 2 && ms > 150) || (s.results >= 3 && s.results <= 6 && ms > 150)) {
        this.history.push(`GPU ${ms.toFixed(0)} ms`);
        this.switchToCpu(ms);
      }
    }
    if (landmarks.length) s.withHands++;
    const v = this.video;
    const W = v.videoWidth, H = v.videoHeight;
    const fx = W / 2 / Math.tan(THREE.MathUtils.degToRad(this.camFov) / 2);
    const prev = this.hands;
    this.hands = landmarks.map((lm) => {
      const px = (i) => new THREE.Vector2(lm[i].x * W, lm[i].y * H);
      // distância pela maior das duas medidas da palma (a menor encolhe quando a mão gira)
      const ratio = Math.max(px(WRIST).distanceTo(px(MIDDLE_MCP)) / PALM_LEN, px(INDEX_MCP).distanceTo(px(PINKY_MCP)) / PALM_WIDTH);
      const depth = fx / Math.max(ratio, 1e-3);
      const to3d = (i) => {
        const p = px(i);
        const z = depth * (1 + (lm[i].z || 0) * 0.6); // profundidade relativa de cada ponto
        return new THREE.Vector3(((p.x - W / 2) / fx) * z, (-(p.y - H / 2) / fx) * z, -z);
      };
      const points = lm.map((_, i) => to3d(i));
      const pinch = points[THUMB_TIP].clone().lerp(points[INDEX_TIP], 0.5);
      const gap = px(THUMB_TIP).distanceTo(px(INDEX_TIP)) / Math.max(px(WRIST).distanceTo(px(MIDDLE_MCP)), 1);
      // mão mais próxima da anterior (para suavizar e manter o estado da pinça)
      const old = prev.reduce((best, h) => (!best || h.pinch.distanceTo(pinch) < best.pinch.distanceTo(pinch) ? h : best), null);
      const near = old && old.pinch.distanceTo(pinch) < 0.15;
      const wasPinching = near && old.pinching;
      return {
        pinch, // a suavização é feita quadro a quadro em lab.js
        depth,
        gap,
        pinching: wasPinching ? gap < 0.55 : gap < 0.35, // histerese: evita "piscar"
        points,
      };
    });
  }

  async switchToCpu(ms) {
    this.switched = `GPU lenta (${ms.toFixed(0)} ms) → CPU`;
    try {
      localStorage.setItem(REMEMBER, 'CPU');
    } catch {
      /* sem armazenamento */
    }
    const old = this.worker;
    this.status = 'trocando para a CPU…';
    try {
      this.worker = null;
      await this.loadWorker('CPU');
      old.terminate();
      this.stats = { results: 0, ms: 0, withHands: 0, since: performance.now() };
    } catch {
      this.worker = old; // mantém a GPU se a CPU falhar
    }
    this.busy = false;
    this.status = 'pronto';
  }

  // resumo para o relatório, ex.: "GPU 6895 ms → CPU 45 ms"
  get summary() {
    const now = this.status === 'pronto' && this.stats.results ? [`${this.delegate} ${this.avgMs.toFixed(0)} ms`] : [];
    return [...this.history, ...now].join(' → ');
  }

  get rate() {
    const s = this.stats;
    return (s.results * 1000) / Math.max(1, performance.now() - s.since);
  }

  get avgMs() {
    return this.stats.ms / Math.max(1, this.stats.results);
  }

  stop() {
    this.worker?.terminate();
    this.landmarker?.close?.();
    this.status = 'desligado';
  }
}
