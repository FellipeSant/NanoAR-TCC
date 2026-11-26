// Cartão informativo + legenda de animação (usado em ar.html).
import { prefs, setPref, stepTextScale, maxTextScale, TEXT_SCALES, speak, stopSpeaking, isSpeaking, canSpeak, announce } from './a11y.js';

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_SPEAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

export class Card {
  constructor({ card, caption }) {
    this.el = card;
    this.captionEl = caption;
    this.el.innerHTML = `
      <div class="card-head">
        <p class="card-tag"></p>
        <div class="card-tools">
          <div class="card-size" role="group" aria-label="Tamanho do texto">
            <button class="card-toggle card-smaller" type="button" aria-label="Diminuir o texto" title="Diminuir o texto"><span>A<small>−</small></span></button>
            <button class="card-toggle card-bigger" type="button" aria-label="Aumentar o texto" title="Aumentar o texto"><span>A<small>+</small></span></button>
          </div>
          <button class="card-toggle card-collapse" type="button" aria-label="Mostrar ou ocultar a descrição" aria-expanded="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <h2 class="card-title"></h2>
      <div class="card-body">
        <div class="card-layers" hidden><span class="card-layers-bar"></span><span class="card-layers-text"></span></div>
        <p class="card-desc"></p>
        <ul class="card-legend" hidden aria-label="Cores"></ul>
        <ul class="card-facts" hidden></ul>
        <p class="card-note" hidden></p>
        <div class="card-loading" hidden><span class="spinner"></span><span>Carregando modelo 3D…</span></div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary card-play" type="button" hidden>${ICON_PLAY}<span></span></button>
        <button class="card-toggle card-speak" type="button" aria-label="Ouvir o texto do cartão" aria-pressed="false" title="Ouvir"${canSpeak ? '' : ' hidden'}>${ICON_SPEAK}</button>
        <button class="card-toggle card-reset" type="button" aria-label="Voltar a estrutura ao tamanho e posição originais" title="Recentralizar">${ICON_RESET}</button>
      </div>
`;
    const $ = (s) => this.el.querySelector(s);
    this.tag = $('.card-tag');
    this.title = $('.card-title');
    this.desc = $('.card-desc');
    this.note = $('.card-note');
    this.facts = $('.card-facts');
    this.legend = $('.card-legend');
    this.layersEl = $('.card-layers');
    this.loading = $('.card-loading');
    this.playBtn = $('.card-play');
    this.resetBtn = $('.card-reset');
    this.tipsShown = new Set();
    this.toggle = $('.card-collapse');
    this.toggle.addEventListener('click', () => {
      const collapsed = this.el.classList.toggle('collapsed');
      this.toggle.setAttribute('aria-expanded', String(!collapsed));
      this.onLayout?.();
    });
    // tamanho do texto (preferência de acessibilidade, lembrada neste aparelho)
    this.smaller = $('.card-smaller');
    this.bigger = $('.card-bigger');
    this.smaller.addEventListener('click', () => stepTextScale(-1));
    this.bigger.addEventListener('click', () => stepTextScale(1));
    window.addEventListener('nanoar:a11y', (e) => {
      this.smaller.disabled = e.detail.textScale <= TEXT_SCALES[0] + 0.001;
      this.bigger.disabled = e.detail.textScale >= maxTextScale() - 0.005;
      this.onLayout?.();
    });
    this.attachPinch();
    // ouvir o cartão
    this.speakBtn = $('.card-speak');
    this.speakBtn.addEventListener('click', () => {
      if (isSpeaking()) return this.stopSpeech();
      this.speakBtn.setAttribute('aria-pressed', 'true');
      speak(this.spokenText(), () => this.speakBtn.setAttribute('aria-pressed', 'false'));
    });
    this.playBtn.addEventListener('click', () => this.rig && this.onPlay?.(this.rig));
    this.resetBtn.addEventListener('click', () => this.rig?.resetUser());
    this.rig = null;
  }

  spokenText() {
    const info = this.rig?.info;
    if (!info) return '';
    const layers = this.rig.stack ? `${this.rig.stack.remaining} ${this.rig.stack.remaining === 1 ? 'camada' : 'camadas'}. ` : '';
    const facts = (info.facts || []).map((f) => `${f.label}: ${f.value}`).join('. ');
    const legend = info.legend?.length ? `Cores: ${info.legend.map((l) => `${l.label}, ${l.colorName}`).join('; ')}.` : '';
    return [`${info.name}.`, layers, info.description, legend, facts, info.note].filter(Boolean).join(' ');
  }

  stopSpeech() {
    stopSpeaking();
    this.speakBtn.setAttribute('aria-pressed', 'false');
  }

  // Pinça com dois dedos sobre o cartão: aumenta ou diminui o cartão inteiro
  attachPinch() {
    const pts = new Map();
    let start = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    this.el.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) start = { d: dist(), scale: Math.min(maxTextScale(), prefs.textScale) };
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start) setPref('textScale', Math.min(maxTextScale(), Math.max(TEXT_SCALES[0], (start.scale * dist()) / (start.d || 1))));
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) start = null;
    };
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  show(rig) {
    this.rig = rig;
    this.el.hidden = false;
    this.render();
    // dica de gestos: aparece no topo por alguns segundos, uma vez por estrutura
    const tip = this.tipFor(rig);
    if (tip && !this.tipsShown.has(rig.cfg.id)) {
      this.tipsShown.add(rig.cfg.id);
      this.tip(tip);
    }
  }

  tipFor(rig) {
    if (rig.cfg.placeholder) return null;
    if (rig.cfg.animation?.mode === 'steps') return 'Deslize o dedo na diagonal, para cima, para jogar a camada de cima longe';
    if (rig.cfg.animation?.tip) return rig.cfg.animation.tip;
    if (rig.cfg.animation) return 'Toque na estrutura para ver como ela se forma';
    return 'Arraste para girar · use dois dedos para ampliar';
  }

  tip(text) {
    if (!this.captionEl.hidden && !this.captionEl.classList.contains('tip')) return; // não cobre a legenda de uma animação
    this.setCaption(text, true);
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => this.captionEl.classList.contains('tip') && this.setCaption(null), 5000);
  }

  hide() {
    this.rig = null;
    this.lastTitle = null;
    this.el.hidden = true;
  }

  render() {
    const rig = this.rig;
    if (!rig) return;
    const info = rig.info;
    if (info.name !== this.lastTitle) {
      this.lastTitle = info.name;
      const layers = rig.stack ? ` ${rig.stack.remaining} ${rig.stack.remaining === 1 ? 'camada' : 'camadas'}.` : '';
      announce(`${info.name}.${layers}`);
      if (prefs.autoRead && !rig.cfg.placeholder) {
        this.speakBtn.setAttribute('aria-pressed', 'true');
        speak(this.spokenText(), () => this.speakBtn.setAttribute('aria-pressed', 'false'));
      }
    }
    this.tag.textContent = info.tag || '';
    this.title.textContent = info.name;
    this.desc.textContent = info.description;
    const note = info.note;
    this.note.hidden = !note;
    this.note.textContent = note || '';
    // fatos curtos (ano, Nobel…) em "pílulas"
    const facts = info.facts || [];
    this.facts.hidden = !facts.length;
    this.facts.replaceChildren(...facts.map(({ label, value }) => {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('span'), { textContent: label }), ' ', Object.assign(document.createElement('b'), { textContent: value }));
      return li;
    }));
    // legenda das cores (ex.: as bases do DNA); o nome da cor vai para leitores de tela
    const legend = info.legend || [];
    this.legend.hidden = !legend.length;
    this.legend.replaceChildren(...legend.map(({ color, label, colorName }) => {
      const li = document.createElement('li');
      const dot = Object.assign(document.createElement('i'), { title: colorName });
      dot.style.background = color;
      li.append(dot, Object.assign(document.createElement('span'), { textContent: label }));
      li.setAttribute('aria-label', `${label}: ${colorName}`);
      return li;
    }));
    // contador de camadas (esfoliação passo a passo)
    const layers = rig.stack;
    this.layersEl.hidden = !layers;
    if (layers) {
      const bar = this.layersEl.querySelector('.card-layers-bar');
      bar.replaceChildren(...Array.from({ length: layers.total }, (_, i) => {
        const seg = document.createElement('i');
        if (i < layers.remaining) seg.className = 'on';
        return seg;
      }));
      this.layersEl.querySelector('.card-layers-text').textContent =
        layers.remaining === 1 ? '1 camada' : `${layers.remaining} camadas`;
    }
    this.loading.hidden = rig.state !== 'loading';
    const label = rig.actionLabel;
    this.playBtn.hidden = !label;
    this.playBtn.disabled = rig.busy;
    if (label) this.playBtn.querySelector('span').textContent = label;
    this.resetBtn.hidden = !!rig.cfg.placeholder;
    this.onLayout?.();
  }

  setCaption(text, isTip = false) {
    if (!isTip) clearTimeout(this.tipTimer);
    this.captionEl.classList.toggle('tip', isTip);
    this.captionEl.hidden = !text;
    if (text) {
      this.captionEl.textContent = text;
      // reinicia a animação de entrada
      this.captionEl.style.animation = 'none';
      void this.captionEl.offsetWidth;
      this.captionEl.style.animation = '';
    }
  }
}
