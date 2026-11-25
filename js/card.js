// Cartão informativo + legenda de animação (usado em ar.html).

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

export class Card {
  constructor({ card, caption }) {
    this.el = card;
    this.captionEl = caption;
    this.el.innerHTML = `
      <div class="card-head">
        <div>
          <p class="card-tag"></p>
          <h2 class="card-title"></h2>
        </div>
        <div class="card-tools">
          <button class="card-toggle card-reset" type="button" aria-label="Voltar ao tamanho e posição originais" title="Recentralizar">${ICON_RESET}</button>
          <button class="card-toggle card-collapse" type="button" aria-label="Mostrar ou ocultar a descrição" aria-expanded="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="card-layers" hidden><span class="card-layers-bar"></span><span class="card-layers-text"></span></div>
      <p class="card-desc"></p>
      <ul class="card-facts" hidden></ul>
      <p class="card-note" hidden></p>
      <div class="card-loading" hidden><span class="spinner"></span><span>Carregando modelo 3D…</span></div>
      <div class="card-actions">
        <button class="btn btn-primary card-play" type="button" hidden>${ICON_PLAY}<span></span></button>
      </div>
      <p class="card-hint"></p>`;
    const $ = (s) => this.el.querySelector(s);
    this.tag = $('.card-tag');
    this.title = $('.card-title');
    this.desc = $('.card-desc');
    this.note = $('.card-note');
    this.facts = $('.card-facts');
    this.layersEl = $('.card-layers');
    this.loading = $('.card-loading');
    this.playBtn = $('.card-play');
    this.resetBtn = $('.card-reset');
    this.hint = $('.card-hint');
    this.toggle = $('.card-collapse');
    this.toggle.addEventListener('click', () => {
      const collapsed = this.el.classList.toggle('collapsed');
      this.toggle.setAttribute('aria-expanded', String(!collapsed));
      this.onLayout?.();
    });
    this.playBtn.addEventListener('click', () => this.rig && this.onPlay?.(this.rig));
    this.resetBtn.addEventListener('click', () => this.rig?.resetUser());
    this.rig = null;
  }

  show(rig) {
    this.rig = rig;
    this.el.hidden = false;
    this.render();
  }

  hide() {
    this.rig = null;
    this.el.hidden = true;
  }

  render() {
    const rig = this.rig;
    if (!rig) return;
    const info = rig.info;
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
    this.hint.textContent = rig.stack?.remaining > 1
      ? 'Arraste a camada de cima para o lado para descolá-la (ou toque) · pinça para ampliar'
      : label
      ? `Toque na estrutura para ${label.charAt(0).toLowerCase()}${label.slice(1)} · arraste para girar · pinça para ampliar`
      : 'Arraste para girar · pinça para ampliar';
    if (rig.state === 'error') this.hint.textContent = 'Não foi possível carregar o modelo. Verifique a conexão.';
    this.hint.hidden = !!rig.cfg.placeholder;
    this.resetBtn.hidden = !!rig.cfg.placeholder;
    this.onLayout?.();
  }

  setCaption(text) {
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
