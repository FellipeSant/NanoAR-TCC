// Recursos de acessibilidade (salvos neste aparelho):
//   tamanho do texto · alto contraste · reduzir movimentos · leitura em voz alta ·
//   botões para girar/ampliar (sem gestos) · tradução para Libras (VLibras, carregado só se pedido)
// e um "anunciador" para leitores de tela.

const KEY = 'nanoar-a11y';
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.7];

const defaults = {
  textScale: 1,
  contrast: matchMedia('(prefers-contrast: more)').matches,
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  autoRead: false,
  controls: false,
};

export const prefs = { ...defaults, ...read() };

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function setPref(name, value) {
  prefs[name] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* navegação privada: vale só nesta visita */
  }
  apply();
}

// maior tamanho de texto que ainda cabe bem no cartão: depende da largura da tela, do tamanho
// automático (--auto-scale) e de o cartão estar embaixo (em pé) ou na lateral (deitado)
export function maxTextScale() {
  const auto = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--auto-scale')) || 1;
  const w = window.innerWidth;
  const side = w > window.innerHeight && w >= 640;
  const cardWidth = side ? Math.min(420, w * 0.4) : Math.min(w - 24, (w >= 600 ? 620 : 560) * auto);
  return Math.min(TEXT_SCALES.at(-1), Math.max(1.15, cardWidth / 260 / auto));
}

export function apply() {
  const root = document.documentElement;
  const scale = Math.min(maxTextScale(), Math.max(TEXT_SCALES[0], prefs.textScale));
  root.style.setProperty('--text-scale', scale);
  root.classList.toggle('hc', !!prefs.contrast);
  root.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  window.dispatchEvent(new CustomEvent('nanoar:a11y', { detail: { ...prefs, textScale: scale } }));
}

export function stepTextScale(dir) {
  const cur = Math.min(maxTextScale(), prefs.textScale);
  const next = dir > 0 ? TEXT_SCALES.find((v) => v > cur + 0.01) ?? TEXT_SCALES.at(-1) : [...TEXT_SCALES].reverse().find((v) => v < cur - 0.01) ?? TEXT_SCALES[0];
  setPref('textScale', Math.min(maxTextScale(), next));
}

window.addEventListener('resize', apply);

// ------------------------------------------------------------ leitor de tela
let live;
export function announce(text) {
  if (!live) {
    live = Object.assign(document.createElement('div'), { className: 'sr-only' });
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 60);
}

// ------------------------------------------------------------ voz
export const canSpeak = 'speechSynthesis' in window;
let speaking = null;
export function speak(text, onEnd) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt-br'));
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => {
    if (speaking === u) speaking = null;
    onEnd?.();
  };
  speaking = u;
  speechSynthesis.speak(u);
}
export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
  speaking = null;
}
export const isSpeaking = () => !!speaking;

// ------------------------------------------------------------ Libras (VLibras, do governo federal)
let vlibras = null;
export function loadVLibras() {
  if (vlibras) return vlibras;
  vlibras = new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.setAttribute('vw', '');
    box.className = 'enabled';
    box.innerHTML = '<div vw-access-button class="active"></div><div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div>';
    document.body.appendChild(box);
    const s = document.createElement('script');
    s.src = 'https://vlibras.gov.br/app/vlibras-plugin.js';
    s.onload = () => {
      new window.VLibras.Widget('https://vlibras.gov.br/app');
      // o VLibras se inicia no evento "load" da página, que já aconteceu
      if (document.readyState === 'complete') window.dispatchEvent(new Event('load'));
      resolve();
    };
    s.onerror = () => {
      vlibras = null;
      box.remove();
      reject(new Error('VLibras indisponível'));
    };
    document.head.appendChild(s);
  });
  return vlibras;
}

// ------------------------------------------------------------ painel
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5l7 1.5 7-1.5"/><path d="M12 10v5"/><path d="M8.5 21l3.5-6 3.5 6"/></svg>';
export const A11Y_ICON = ICON;

export function mountA11yPanel({ openers = [], withControls = false } = {}) {
  const panel = document.createElement('section');
  panel.className = 'screen translucent a11y';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'a11y-title');
  const sw = (pref, label, hint = '') =>
    `<button class="switch" type="button" role="switch" data-pref="${pref}" aria-checked="false"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><i aria-hidden="true"></i></button>`;
  panel.innerHTML = `
    <div class="screen-box a11y-box">
      <h2 id="a11y-title">${ICON} Acessibilidade</h2>
      <div class="a11y-size">
        <span id="a11y-size-label"><b>Tamanho do texto</b></span>
        <div role="group" aria-labelledby="a11y-size-label">
          <button class="card-toggle" type="button" data-size="-1" aria-label="Diminuir o texto"><span>A<small>−</small></span></button>
          <output aria-live="polite"></output>
          <button class="card-toggle" type="button" data-size="1" aria-label="Aumentar o texto"><span>A<small>+</small></span></button>
        </div>
      </div>
      ${sw('contrast', 'Alto contraste', 'Cores mais fortes e fundo preto')}
      ${sw('reduceMotion', 'Reduzir movimentos', 'As estruturas param de girar sozinhas')}
      ${canSpeak ? sw('autoRead', 'Ler em voz alta', 'Lê cada cartão automaticamente') : ''}
      ${withControls ? sw('controls', 'Botões para girar e ampliar', 'Para usar sem gestos de pinça e arraste') : ''}
      <button class="btn" type="button" data-vlibras>Tradução para Libras (VLibras)</button>
      <p class="small a11y-msg" role="status"></p>
      <button class="btn btn-primary" type="button" data-close>Pronto</button>
    </div>`;
  document.body.appendChild(panel);
  const out = panel.querySelector('output');
  let opener = null;

  const render = () => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1;
    out.textContent = `${Math.round(scale * 100)}%`;
    panel.querySelector('[data-size="-1"]').disabled = scale <= TEXT_SCALES[0] + 0.001;
    panel.querySelector('[data-size="1"]').disabled = scale >= maxTextScale() - 0.005;
    for (const b of panel.querySelectorAll('[data-pref]')) b.setAttribute('aria-checked', String(!!prefs[b.dataset.pref]));
  };
  window.addEventListener('nanoar:a11y', render);

  panel.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pref) setPref(t.dataset.pref, !prefs[t.dataset.pref]);
    else if (t.dataset.size) stepTextScale(Number(t.dataset.size));
    else if ('close' in t.dataset) close();
    else if ('vlibras' in t.dataset) {
      const msg = panel.querySelector('.a11y-msg');
      msg.textContent = 'Carregando o VLibras…';
      try {
        await loadVLibras();
        msg.textContent = 'Pronto: toque no botão azul do VLibras, no canto da tela.';
      } catch {
        msg.textContent = 'Não foi possível carregar o VLibras agora. Verifique a internet.';
      }
    }
  });
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  function open(e) {
    opener = e?.currentTarget || document.activeElement;
    panel.hidden = false;
    render();
    panel.querySelector('[data-size="1"]').focus();
  }
  function close() {
    panel.hidden = true;
    opener?.focus?.();
  }
  for (const b of openers) b?.addEventListener('click', open);
  apply();
  return { open, close };
}
