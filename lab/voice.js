// Comandos de voz em português (Web Speech API). Funciona no Chrome/Android e no Safari recente;
// em outros navegadores a opção simplesmente fica indisponível.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = !!SR;

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Voice {
  constructor(commands) {
    this.commands = commands; // [{ words: ['carbono'], run() }]
    this.heard = '';
    this.status = voiceSupported ? 'ouvindo' : 'indisponível neste navegador';
    this.running = false;
  }

  start() {
    if (!SR) return;
    this.running = true;
    const rec = (this.rec = new SR());
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript.trim();
      this.heard = text;
      const t = strip(text);
      for (const c of this.commands) {
        if (c.words.some((w) => t.includes(strip(w)))) {
          c.run();
          break;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.status = 'microfone não permitido';
        this.running = false;
      }
    };
    rec.onend = () => this.running && setTimeout(() => this.running && rec.start(), 300); // reinicia sozinho
    try {
      rec.start();
    } catch {
      this.status = 'não foi possível iniciar';
    }
  }

  stop() {
    this.running = false;
    try {
      this.rec?.stop();
    } catch {
      /* já parado */
    }
  }
}
