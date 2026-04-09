/**
 * Templates de corps (HTTP) — stockage localStorage + filtres.
 */

const LS_KEY = 'labHttpBodyTemplates.v1';

/**
 * @typedef {Object} BodyTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string[]} tags
 * @property {string} body_type
 * @property {string=} content_type_hint
 * @property {string} body
 * @property {string=} notes
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const BODY_CATEGORIES = [
  { id: 'generic', label: 'Generic' },
  { id: 'json', label: 'JSON' },
  { id: 'form', label: 'Form' },
  { id: 'ssti', label: 'SSTI' },
  { id: 'ssrf', label: 'SSRF' },
  { id: 'sqli', label: 'SQLi' },
  { id: 'bypass-403', label: '403 Bypass' },
  { id: 'custom', label: 'Custom' },
];

export function builtinBodyTemplates() {
  const now = Date.now();
  /** @type {BodyTemplate[]} */
  return [
    {
      id: 'b-body-empty',
      name: 'Vide',
      category: 'generic',
      tags: ['empty'],
      body_type: 'raw',
      content_type_hint: '',
      body: '',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-json-empty',
      name: 'JSON — objet vide',
      category: 'json',
      tags: ['json'],
      body_type: 'json',
      content_type_hint: 'application/json',
      body: '{}',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-form-skel',
      name: 'Form — squelette',
      category: 'form',
      tags: ['form'],
      body_type: 'form',
      content_type_hint: 'application/x-www-form-urlencoded',
      body: 'key=value',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @returns {BodyTemplate[]}
 */
export function loadUserBodyTemplates() {
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
        body_type: String(t.body_type || 'raw'),
        content_type_hint: t.content_type_hint != null ? String(t.content_type_hint) : '',
        body: String(t.body ?? ''),
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
 * @param {BodyTemplate[]} templates
 */
export function saveUserBodyTemplates(templates) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ version: 1, templates }));
  } catch {
    /* ignore */
  }
}

function haystack(t) {
  const tags = (t.tags || []).join(' ');
  const hint = t.content_type_hint || '';
  return `${t.name} ${t.category} ${tags} ${t.notes || ''} ${t.body_type} ${hint}`.toLowerCase();
}

/**
 * @param {BodyTemplate[]} all
 * @param {string} q
 * @param {string} cat
 */
export function filterBodyTemplates(all, q, cat) {
  const qq = String(q || '').trim().toLowerCase();
  const c = String(cat || '');
  return all.filter((t) => {
    if (c && t.category !== c) return false;
    if (!qq) return true;
    return haystack(t).includes(qq);
  });
}

/**
 * @param {BodyTemplate} t
 * @param {string} q
 * @param {string} cat
 * @returns {number}
 */
export function scoreBodyTemplate(t, q, cat) {
  let s = 0;
  const qq = String(q || '').trim().toLowerCase();
  if (cat && t.category === cat) s += 50;
  if (qq) {
    if (haystack(t).includes(qq)) s += 20;
  }
  if (t.body_type === 'json' || (t.tags || []).includes('json')) s += 2;
  if (t.body_type === 'form' || (t.tags || []).includes('form')) s += 2;
  return s;
}

export function exportUserBodyTemplatesJson() {
  const templates = loadUserBodyTemplates();
  return JSON.stringify({ version: 1, templates }, null, 2);
}

