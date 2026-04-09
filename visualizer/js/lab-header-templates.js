/**
 * Templates d'en-têtes (HTTP) — stockage localStorage + filtres (intention/tags).
 */

const LS_KEY = 'labHttpHeaderTemplates.v1';

/**
 * @typedef {Object} HeaderTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string[]} tags
 * @property {Record<string,string>} headers
 * @property {string=} notes
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const CATEGORIES = [
  { id: 'api_json', label: 'API JSON' },
  { id: 'form', label: 'Form' },
  { id: 'browser', label: 'Browser' },
  { id: 'auth', label: 'Auth' },
  { id: 'csrf', label: 'CSRF' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'ssrf', label: 'SSRF' },
  { id: 'sqli', label: 'SQLi' },
  { id: 'bypass-403', label: '403 Bypass' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'custom', label: 'Custom' },
];

/** Built-ins (non modifiables) */
export function builtinTemplates() {
  const now = Date.now();
  /** @type {HeaderTemplate[]} */
  const base = [
    {
      id: 'b-json-min',
      name: 'API JSON — minimal',
      category: 'api_json',
      tags: ['json', 'api'],
      headers: { Accept: 'application/json' },
      notes: 'Ajoute seulement Accept JSON.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-json-post',
      name: 'API JSON — POST',
      category: 'api_json',
      tags: ['json', 'api'],
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      notes: 'Content-Type JSON + Accept JSON.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-form-urlenc',
      name: 'Form — urlencoded',
      category: 'form',
      tags: ['form', 'csrf'],
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      notes: 'Pour body de type a=b&c=d (souvent avec CSRF).',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-browser-like',
      name: 'Browser-like — HTML',
      category: 'browser',
      tags: ['html', 'browser'],
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
      },
      notes: 'Utile pour récupérer une page comme un navigateur.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-auth-bearer',
      name: 'Auth — Bearer (placeholder)',
      category: 'auth',
      tags: ['auth', 'bearer', 'api'],
      headers: { Authorization: 'Bearer YOUR_TOKEN', Accept: 'application/json' },
      notes: 'Remplace YOUR_TOKEN avant envoi.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-graphql',
      name: 'GraphQL — JSON',
      category: 'graphql',
      tags: ['graphql', 'json', 'api'],
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      notes: 'Souvent POST /graphql avec body JSON { query, variables }.',
      createdAt: now,
      updatedAt: now,
    },
  ];
  return base;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @returns {HeaderTemplate[]}
 */
export function loadUserTemplates() {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const data = safeJsonParse(raw);
    const arr = Array.isArray(data) ? data : data?.templates;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        id: String(t.id || ''),
        name: String(t.name || 'template'),
        category: String(t.category || 'custom'),
        tags: Array.isArray(t.tags) ? t.tags.map((x) => String(x)) : [],
        headers: t.headers && typeof t.headers === 'object' ? t.headers : {},
        notes: t.notes != null ? String(t.notes) : '',
        createdAt: Number(t.createdAt || Date.now()),
        updatedAt: Number(t.updatedAt || Date.now()),
      }))
      .filter((t) => t.id && t.name);
  } catch {
    return [];
  }
}

/**
 * @param {HeaderTemplate[]} templates
 */
export function saveUserTemplates(templates) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ version: 1, templates }));
  } catch {
    /* ignore */
  }
}

export function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @param {string} rawJson
 * @returns {Record<string,string>|null}
 */
export function parseHeadersTextarea(rawJson) {
  const raw = String(rawJson || '').trim();
  if (!raw) return {};
  const o = safeJsonParse(raw);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  /** @type {Record<string,string>} */
  const out = {};
  Object.entries(o).forEach(([k, v]) => {
    if (v == null) return;
    out[String(k)] = String(v);
  });
  return out;
}

function haystack(t) {
  const tags = (t.tags || []).join(' ');
  const hdrs = Object.entries(t.headers || {})
    .slice(0, 20)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return `${t.name} ${t.category} ${tags} ${t.notes || ''} ${hdrs}`.toLowerCase();
}

/**
 * @param {HeaderTemplate[]} all
 * @param {string} q
 * @param {string} cat
 */
export function filterTemplates(all, q, cat) {
  const qq = String(q || '').trim().toLowerCase();
  const c = String(cat || '');
  return all.filter((t) => {
    if (c && t.category !== c) return false;
    if (!qq) return true;
    return haystack(t).includes(qq);
  });
}

/**
 * Scoring simple pour “Recommandés”
 * @param {HeaderTemplate} t
 * @param {string} q
 * @param {string} cat
 * @param {string} body
 */
export function scoreTemplate(t, q, cat, body) {
  let s = 0;
  const qq = String(q || '').trim().toLowerCase();
  if (cat && t.category === cat) s += 50;
  if (qq) {
    const hs = haystack(t);
    if (hs.includes(qq)) s += 20;
  }
  const b = String(body || '').trim();
  if (b.startsWith('{') || b.startsWith('[')) {
    if (t.category === 'api_json' || t.tags.includes('json')) s += 15;
  }
  if (/[=&]/.test(b) && !b.startsWith('{')) {
    if (t.category === 'form' || t.tags.includes('form')) s += 12;
  }
  if ((t.tags || []).includes('auth')) s += 2;
  return s;
}

export function exportUserTemplatesJson() {
  const templates = loadUserTemplates();
  return JSON.stringify({ version: 1, templates }, null, 2);
}

