// Cores e tamanhos dos átomos e ligações.
//
// De onde vêm (o primeiro que existir vale):
//   1. teste local — salvo pela página admin.html só NESTE aparelho (localStorage)
//   2. config/style.json — o arquivo publicado no repositório (vale para todo mundo)
//   3. STYLE em js/targets.js — o padrão do código
//
// Formato do config/style.json:
//   { "default":    { "atomColor": "#1fae9f", "bondColor": "#8ea3ae", "atomRadius": 0.36, "bondRadius": 0.12 },
//     "structures": { "grafite": { "atomColor": "#ff7a00" } } }      ← opcional, por estrutura
import { STYLE, TARGETS } from './targets.js';

export const LOCAL_KEY = 'nanoar-style-test';
export const LIMITS = { atomRadius: [0.15, 0.7], bondRadius: [0.03, 0.35] };

let published = empty();
let local = null;

function empty() {
  return { default: {}, structures: {} };
}

function cleanEntry(e) {
  const out = {};
  if (!e || typeof e !== 'object') return out;
  for (const k of ['atomColor', 'bondColor']) if (/^#[0-9a-f]{6}$/i.test(e[k] ?? '')) out[k] = e[k].toLowerCase();
  for (const k of ['atomRadius', 'bondRadius']) {
    const v = Number(e[k]);
    if (Number.isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
  }
  return out;
}

export function normalize(cfg) {
  const out = empty();
  out.default = cleanEntry(cfg?.default);
  for (const t of TARGETS) {
    const e = cleanEntry(cfg?.structures?.[t.id]);
    if (Object.keys(e).length) out.structures[t.id] = e;
  }
  return out;
}

export async function loadStyles() {
  try {
    const res = await fetch('config/style.json', { cache: 'no-cache' });
    if (res.ok) published = normalize(await res.json());
  } catch {
    /* sem arquivo publicado: usa o padrão */
  }
  local = readLocal();
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export const getPublished = () => structuredClone(published);
export const getLocal = () => (local ? structuredClone(local) : null);
export const hasLocalTest = () => !!local;

export function saveLocal(cfg) {
  local = normalize(cfg);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  } catch {
    /* navegação privada: o teste vale só enquanto a página estiver aberta */
  }
}

export function clearLocal() {
  local = null;
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* nada a fazer */
  }
}

// Estilo final de uma estrutura, usando `cfg` (ou o que estiver valendo: teste local > publicado)
export function styleFor(id, cfg = local || published) {
  return { ...STYLE, ...cfg.default, ...(cfg.structures?.[id] || {}) };
}
