// Detecção das mãos em segundo plano (Web Worker clássico), para não travar a renderização.
// O MediaPipe só é distribuído como módulo ES ou CommonJS; aqui usamos o CommonJS com um "module" falso.
/* global importScripts, FilesetResolver, HandLandmarker */
const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarker = null;

async function create(vision, delegate) {
  const options = {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 1, // uma mão = detecção mais rápida (o raio já permite pegar e mover)
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  if (delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined') options.canvas = new OffscreenCanvas(1, 1);
  return self.module.exports.HandLandmarker.createFromOptions(vision, options);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      self.module = { exports: {} };
      self.exports = self.module.exports;
      // o CDN entrega o .cjs com o tipo "application/node", que o navegador não executa direto;
      // baixamos o texto e carregamos como JavaScript
      const code = await (await fetch(`${BASE}/vision_bundle.cjs`)).text();
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      importScripts(url);
      URL.revokeObjectURL(url);
      const vision = await self.module.exports.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      let delegate = m.delegate || 'GPU';
      try {
        landmarker = await create(vision, delegate);
      } catch {
        delegate = 'CPU';
        landmarker = await create(vision, 'CPU');
      }
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  } else if (m.type === 'frame' && landmarker) {
    const t0 = performance.now();
    let res = null;
    try {
      res = landmarker.detectForVideo(m.bitmap, m.time);
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    m.bitmap.close();
    self.postMessage({
      type: 'result',
      ms: performance.now() - t0,
      landmarks: res?.landmarks || [],
    });
  }
};
