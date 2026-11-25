// Senha da administração e publicação das cores no GitHub.
//
// IMPORTANTE (site estático): a senha é conferida no navegador, então ela só "tranca a porta"
// da página. Quem de fato autoriza mudar o site é o token do GitHub — e ele NUNCA fica no código:
// é informado uma vez pelo administrador e guardado só no aparelho dele, criptografado com a senha.
//
// A senha NÃO está neste arquivo: só uma "impressão digital" dela (hash PBKDF2-SHA256 com sal,
// 600 mil rodadas), que serve para conferir a senha digitada mas não permite descobri-la.
// A senha fica anotada só no computador do administrador (SENHA-ADMIN.local.txt, fora do Git).
// Para trocar a senha: python tools/admin_password.py  (e cole as linhas abaixo).
export const ADMIN = {
  passwordSalt: '018eecc44959f69933524f2d96713f2e',
  passwordHash: 'fc6e4be25fe4145b1d10c97cf2d024cd03258d417fd5910147c1da2750fec0ff',
  iterations: 600000,
  // onde as cores publicadas são gravadas (o GitHub Pages publica o branch main)
  github: { owner: 'FellipeSant', repo: 'NanoAR-TCC', branch: 'main', path: 'config/style.json' },
};

const TOKEN_KEY = 'nanoar-gh-token';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

async function baseKey(password) {
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function checkPassword(password) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(ADMIN.passwordSalt), iterations: ADMIN.iterations },
    await baseKey(password),
    256,
  );
  return hex(bits) === ADMIN.passwordHash;
}

// Mostra a tela de senha e só continua quando a senha estiver certa.
export function unlockAdmin() {
  const lock = document.getElementById('lock');
  const form = document.getElementById('lock-form');
  const input = document.getElementById('admin-pass');
  const error = document.getElementById('lock-error');
  if (!window.crypto?.subtle) {
    error.textContent = 'Abra esta página pelo endereço seguro (https://).';
    return new Promise(() => {});
  }
  input.focus();
  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const button = form.querySelector('button');
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Verificando…';
      const ok = await checkPassword(input.value).catch(() => false);
      if (!ok) {
        button.disabled = false;
        button.textContent = label;
        error.textContent = 'Senha incorreta.';
        input.select();
        return;
      }
      const session = new AdminSession(input.value);
      input.value = '';
      await session.ready;
      lock.hidden = true;
      resolve(session);
    });
  });
}

class PublishError extends Error {
  constructor(message, { needToken = false } = {}) {
    super(message);
    this.needToken = needToken;
  }
}

function apiError(status) {
  if (status === 401) return new PublishError('O token do GitHub é inválido ou expirou. Informe um novo token.', { needToken: true });
  if (status === 403) return new PublishError('O token não tem permissão para gravar no repositório. Crie um token com "Contents: Read and write".', { needToken: true });
  if (status === 404) return new PublishError('O token não tem acesso a este repositório. Ao criar o token, selecione o repositório do site.', { needToken: true });
  if (status === 422) return new PublishError('O GitHub recusou a gravação. Confira o branch configurado em js/admin-auth.js.');
  return new PublishError(`O GitHub respondeu com erro ${status}. Tente de novo em instantes.`);
}

function base64Utf8(text) {
  let bin = '';
  for (const b of enc.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

class AdminSession {
  constructor(password) {
    // chave AES derivada da senha: protege o token guardado neste aparelho
    this.ready = baseKey(password).then(async (key) => {
      this.key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`nanoar-token:${ADMIN.passwordSalt}`), iterations: ADMIN.iterations },
        key,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    });
  }

  get hasToken() {
    try {
      return !!localStorage.getItem(TOKEN_KEY);
    } catch {
      return false;
    }
  }

  async getToken() {
    try {
      const { iv, data } = JSON.parse(localStorage.getItem(TOKEN_KEY));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv) }, this.key, unhex(data));
      return new TextDecoder().decode(plain);
    } catch {
      return null; // não há token, ou a senha mudou desde que ele foi salvo
    }
  }

  async saveToken(token) {
    token = token.trim();
    const { owner, repo } = ADMIN.github;
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: this.headers(token), cache: 'no-store' });
    } catch {
      throw new PublishError('Sem conexão com o GitHub. Verifique a internet.');
    }
    if (!res.ok) throw apiError(res.status);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(token));
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ iv: hex(iv), data: hex(data) }));
  }

  forgetToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nada a fazer */
    }
  }

  headers(token) {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }

  // Grava o texto em config/style.json no GitHub (um commit). Devolve o link do commit.
  async publish(text) {
    const token = await this.getToken();
    if (!token) throw new PublishError('Informe o token do GitHub para publicar.', { needToken: true });
    const { owner, repo, branch, path } = ADMIN.github;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers = this.headers(token);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let sha;
        const current = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
        if (current.ok) sha = (await current.json()).sha;
        else if (current.status !== 404) throw apiError(current.status);
        const res = await fetch(url, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Atualiza as cores das estruturas (página de administração)',
            content: base64Utf8(text),
            branch,
            ...(sha ? { sha } : {}),
          }),
        });
        if (res.ok) return (await res.json()).commit?.html_url || null;
        if (res.status === 409 && attempt === 0) continue; // alguém mudou o arquivo ao mesmo tempo: tenta de novo
        throw apiError(res.status);
      }
    } catch (err) {
      if (err instanceof PublishError) throw err;
      throw new PublishError('Sem conexão com o GitHub. Verifique a internet.');
    }
    throw apiError(409);
  }
}
