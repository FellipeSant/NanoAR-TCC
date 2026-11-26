// Visão para o VR Box (duas imagens lado a lado, com correção das lentes) ou para a tela (uma imagem).
// A imagem da câmera do celular (realidade mista) é misturada por trás das estruturas 3D,
// no tamanho angular real, para que o virtual e o real fiquem na mesma escala.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
  uniform sampler2D tScene;
  uniform sampler2D tVideo;
  uniform bool hasVideo;
  uniform float k1;
  uniform float k2;
  uniform vec2 center;     // centro da lente (coordenadas da imagem do olho, 0..1)
  uniform float aspect;    // largura/altura da imagem de um olho
  uniform vec2 videoScale; // parte da visão ocupada pela imagem da câmera
  varying vec2 vUv;
  void main() {
    // pré-distorção "barril", que as lentes desfazem
    vec2 p = vUv - center;
    p.x *= aspect;
    float r2 = dot(p, p) * 4.0;
    float d = 1.0 + k1 * r2 + k2 * r2 * r2;
    p *= d;
    p.x /= aspect;
    vec2 src = center + p;
    if (src.x < 0.0 || src.y < 0.0 || src.x > 1.0 || src.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec4 s = texture2D(tScene, src);
    vec3 col = s.rgb;
    if (hasVideo) {
      vec2 vuv = (src - 0.5) / videoScale + 0.5;
      vec3 v = (vuv.x < 0.0 || vuv.y < 0.0 || vuv.x > 1.0 || vuv.y > 1.0) ? vec3(0.0) : texture2D(tVideo, vuv).rgb;
      col = s.rgb + v * (1.0 - s.a); // a cena já vem pré-multiplicada pelo alfa
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export const DEFAULT_LENS = {
  ipd: 0.064, // distância entre os olhos no mundo virtual (m)
  fov: 85, // campo de visão vertical de cada olho no óculos (graus)
  screenFov: 60, // campo de visão vertical no modo sem óculos (graus)
  k1: 0.22, // distorção das lentes
  k2: 0.1,
  lensShift: 0, // desloca os centros das lentes (fração da largura de um olho; + = para fora)
  camFov: 68, // campo de visão horizontal da câmera do celular (graus)
  camZoom: 1, // ajuste fino do tamanho da imagem da câmera
  scale: 1, // resolução de cada olho (1 = tela; menos = mais leve)
};

export class StereoView {
  constructor(renderer, { stereo = true, lens = DEFAULT_LENS } = {}) {
    this.renderer = renderer;
    this.stereo = stereo;
    this.lens = { ...DEFAULT_LENS, ...lens };
    this.eyes = stereo ? 2 : 1;
    this.cams = Array.from({ length: this.eyes }, () => new THREE.PerspectiveCamera(70, 1, 0.01, 200));
    this.targets = Array.from({ length: this.eyes }, () => new THREE.WebGLRenderTarget(16, 16, { samples: 2 }));
    this.post = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quads = this.targets.map((target, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          tScene: { value: target.texture },
          tVideo: { value: null },
          hasVideo: { value: false },
          k1: { value: 0 },
          k2: { value: 0 },
          center: { value: new THREE.Vector2(0.5, 0.5) },
          aspect: { value: 1 },
          videoScale: { value: new THREE.Vector2(1, 1) },
        },
        depthTest: false,
        depthWrite: false,
      });
      // quad em coordenadas de tela: metade esquerda/direita (estéreo) ou tela inteira
      const geo = new THREE.PlaneGeometry(this.eyes === 2 ? 1 : 2, 2);
      geo.translate(this.eyes === 2 ? (i === 0 ? -0.5 : 0.5) : 0, 0, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.post.add(mesh);
      return mesh;
    });
    this.video = null;
  }

  setVideo(video) {
    if (this.videoTexture) this.videoTexture.dispose();
    this.video = video;
    this.videoTexture = video ? new THREE.VideoTexture(video) : null;
    if (this.videoTexture) this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    for (const q of this.quads) {
      q.material.uniforms.tVideo.value = this.videoTexture;
      q.material.uniforms.hasVideo.value = !!video;
    }
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    const dpr = Math.min(window.devicePixelRatio, 2) * this.lens.scale;
    const ew = (w / this.eyes) * dpr, eh = h * dpr;
    for (const t of this.targets) t.setSize(Math.max(16, Math.round(ew)), Math.max(16, Math.round(eh)));
  }

  render(scene, headQuat, { opaqueBackground = false } = {}) {
    const r = this.renderer;
    const L = this.lens;
    const aspect = this.w / this.eyes / this.h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(headQuat);
    const fov = this.eyes === 2 ? L.fov : L.screenFov;
    const vFov = THREE.MathUtils.degToRad(fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // tamanho angular da imagem da câmera dentro da visão de cada olho
    let vs = new THREE.Vector2(1, 1);
    if (this.video?.videoWidth) {
      const camH = THREE.MathUtils.degToRad(L.camFov);
      const camV = 2 * Math.atan(Math.tan(camH / 2) * (this.video.videoHeight / this.video.videoWidth));
      vs = new THREE.Vector2(Math.tan(camH / 2) / Math.tan(hFov / 2), Math.tan(camV / 2) / Math.tan(vFov / 2)).multiplyScalar(L.camZoom);
    }
    const oldTarget = r.getRenderTarget();
    const oldColor = r.getClearColor(new THREE.Color());
    const oldAlpha = r.getClearAlpha();
    this.cams.forEach((cam, i) => {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      const side = this.eyes === 2 ? (i === 0 ? -1 : 1) : 0;
      cam.position.copy(right).multiplyScalar((side * L.ipd) / 2);
      cam.quaternion.copy(headQuat);
      cam.updateMatrixWorld();
      r.setRenderTarget(this.targets[i]);
      r.setClearColor(0x000000, opaqueBackground ? 1 : 0);
      r.clear();
      r.render(scene, cam);
      const u = this.quads[i].material.uniforms;
      const stereo = this.eyes === 2;
      u.k1.value = stereo ? L.k1 : 0;
      u.k2.value = stereo ? L.k2 : 0;
      u.center.value.set(0.5 + (stereo ? side * L.lensShift : 0), 0.5);
      u.aspect.value = aspect;
      u.videoScale.value.copy(vs);
    });
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.post, this.postCam);
    r.setRenderTarget(oldTarget);
    r.setClearColor(oldColor, oldAlpha);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    for (const q of this.quads) q.material.dispose();
    this.videoTexture?.dispose();
  }
}
