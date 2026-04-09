/**
 * Onglet LAB — HTTP / TCP + presets (premier jet).
 */

import { applyTcpPreset, applyWebPreset, mergeHeadersPreserveExisting } from './lab-presets.js';
import {
  CATEGORIES,
  builtinTemplates,
  exportUserTemplatesJson,
  filterTemplates,
  loadUserTemplates,
  newId,
  parseHeadersTextarea,
  saveUserTemplates,
  scoreTemplate,
} from './lab-header-templates.js';
import {
  BODY_CATEGORIES,
  builtinBodyTemplates,
  exportUserBodyTemplatesJson,
  filterBodyTemplates,
  loadUserBodyTemplates,
  saveUserBodyTemplates,
  scoreBodyTemplate,
} from './lab-body-templates.js';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function maskSecret(s) {
  const v = String(s || '');
  if (!v) return v;
  if (v.length <= 10) return '***';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function kindLabel(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'input') return 'Entrée invalide';
  if (k === 'dns') return 'DNS';
  if (k === 'tls') return 'TLS';
  if (k === 'network') return 'Réseau';
  if (k === 'rate') return 'Limite';
  if (k === 'concurrency') return 'Concurrence';
  if (k === 'forbidden') return 'Interdit';
  if (k === 'internal') return 'Serveur';
  return 'Erreur';
}

function renderLabError(res) {
  const msg = escapeHtml(res?.error || 'Erreur');
  const lbl = escapeHtml(kindLabel(res?.kind));
  const ra = Number(res?.retry_after_sec || 0);
  const hint = ra > 0 ? `<div style="margin-top:6px;color:var(--mu);font-size:.62rem">Réessayez dans ${escapeHtml(String(ra))} s.</div>` : '';
  return `<div style="color:var(--a2)"><strong>${lbl}</strong> — ${msg}${hint}</div>`;
}

function formatJsonPretty(s) {
  try {
    const o = JSON.parse(s);
    return JSON.stringify(o, null, 2);
  } catch {
    return s;
  }
}

const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA',
];

/** Flèches : e.code. B/A : code US (KeyB/KeyA) ou caractère (AZERTY : « a » sur KeyQ, pas KeyA). */
function konamiMatchesStep(idx, e) {
  if (idx < 8) return e.code === KONAMI[idx];
  const ch = e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
  if (idx === 8) return e.code === 'KeyB' || ch === 'b';
  if (idx === 9) return e.code === 'KeyA' || ch === 'a';
  return false;
}

function toFormUrlEncoded(fields) {
  const params = new URLSearchParams();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v == null) return;
    params.append(String(k), String(v));
  });
  return params.toString();
}

/** Évite de remplacer le champ URL par une IPv4 (TLS/SNI attend le hostname). */
function isIPv4LiteralHost(hostname) {
  if (!hostname) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  return m.slice(1).every((x) => {
    const n = Number(x);
    return n >= 0 && n <= 255;
  });
}

/** Préremplit l’URL POST si le serveur fournit un hostname (pas une IP seule). */
function applyLabPrefillUrl(urlInput, postUrl) {
  if (!urlInput || !postUrl) return;
  try {
    const pu = new URL(postUrl);
    if (isIPv4LiteralHost(pu.hostname)) return;
    urlInput.value = postUrl;
  } catch {
    urlInput.value = postUrl;
  }
}

export function initLab() {
  const agree = document.getElementById('lab-agree');
  const sendHttp = document.getElementById('lab-send-http');
  const sendTcp = document.getElementById('lab-send-tcp');
  const out = document.getElementById('lab-result');
  const modWeb = document.getElementById('lab-mod-web');
  const modTcp = document.getElementById('lab-mod-tcp');
  const presetWeb = document.getElementById('lab-preset-web');
  const presetTcp = document.getElementById('lab-preset-tcp');
  const presetApplyModeEl = document.getElementById('lab-preset-apply-mode');
  const headersOpenEl = document.getElementById('lab-headers-open');
  const headersSaveEl = document.getElementById('lab-headers-save');
  const headersModalEl = document.getElementById('lab-headers-modal');
  const headersBackdropEl = document.getElementById('lab-headers-backdrop');
  const headersCloseEl = document.getElementById('lab-headers-close');
  const headersQEl = document.getElementById('lab-headers-q');
  const headersApplyEl = document.getElementById('lab-headers-apply');
  const headersChipsEl = document.getElementById('lab-headers-chips');
  const headersRecEl = document.getElementById('lab-headers-rec');
  const headersAllEl = document.getElementById('lab-headers-all');
  const headersExportEl = document.getElementById('lab-headers-export');
  const packImportEl = document.getElementById('lab-pack-import');
  const packExportEl = document.getElementById('lab-pack-export');
  const bodyOpenEl = document.getElementById('lab-body-open');
  const bodySaveEl = document.getElementById('lab-body-save');
  const bodyModalEl = document.getElementById('lab-body-modal');
  const bodyBackdropEl = document.getElementById('lab-body-backdrop');
  const bodyCloseEl = document.getElementById('lab-body-close');
  const bodyQEl = document.getElementById('lab-body-q');
  const bodyApplyEl = document.getElementById('lab-body-apply');
  const bodyChipsEl = document.getElementById('lab-body-chips');
  const bodyRecEl = document.getElementById('lab-body-rec');
  const bodyAllEl = document.getElementById('lab-body-all');
  const bodyImportEl = document.getElementById('lab-body-import');
  const bodyExportEl = document.getElementById('lab-body-export');
  const extractedEl = document.getElementById('lab-extracted');
  const followRedirectsEl = document.getElementById('lab-http-follow-redirects');
  const sessionEl = document.getElementById('lab-http-session');
  const sessionResetEl = document.getElementById('lab-http-session-reset');
  const extractPrefillEl = document.getElementById('lab-http-extract-prefill');
  const extractFwEl = document.getElementById('lab-http-extract-fw');
  const maskSecretsEl = document.getElementById('lab-mask-secrets');
  const limitsRowEl = document.getElementById('lab-god-limits-row');
  const limitsModeEl = document.getElementById('lab-limits-mode');
  const limitsOffAckRowEl = document.getElementById('lab-limits-off-ack-row');
  const limitsOffAckEl = document.getElementById('lab-limits-off-ack');
  const historyEl = document.getElementById('lab-history');
  const historyClearEl = document.getElementById('lab-history-clear');

  const godBanner = document.getElementById('lab-god-banner');
  const godModal = document.getElementById('lab-god-modal');
  const godModalOk = document.getElementById('lab-god-modal-ok');
  const godOff = document.getElementById('lab-god-off');
  const godBackdrop = document.getElementById('lab-god-modal-backdrop');

  /** @type {boolean} */
  let labGodMode = false;
  let konamiIdx = 0;
  const history = [];

  // --- Header templates (HTTP) ---
  let headerCat = '';
  let bodyCat = '';

  function openHeadersModal() {
    if (!headersModalEl) return;
    headersModalEl.classList.add('open');
    headersModalEl.setAttribute('aria-hidden', 'false');
    try {
      const savedCat = window.localStorage.getItem('labHeadersCategory') || '';
      headerCat = savedCat;
      const savedApply = window.localStorage.getItem('labHeadersApply') || '';
      if (headersApplyEl && (savedApply === 'merge' || savedApply === 'replace')) headersApplyEl.value = savedApply;
    } catch {
      /* ignore */
    }
    renderHeadersLibrary();
    setTimeout(() => headersQEl?.focus(), 0);
  }

  function closeHeadersModal() {
    if (!headersModalEl) return;
    headersModalEl.classList.remove('open');
    headersModalEl.setAttribute('aria-hidden', 'true');
  }

  function openBodyModal() {
    if (!bodyModalEl) return;
    bodyModalEl.classList.add('open');
    bodyModalEl.setAttribute('aria-hidden', 'false');
    try {
      const savedCat = window.localStorage.getItem('labBodyCategory') || '';
      bodyCat = savedCat;
      const savedApply = window.localStorage.getItem('labBodyApply') || '';
      if (bodyApplyEl && (savedApply === 'replace' || savedApply === 'fill_empty')) bodyApplyEl.value = savedApply;
    } catch {
      /* ignore */
    }
    renderBodyLibrary();
    setTimeout(() => bodyQEl?.focus(), 0);
  }

  function closeBodyModal() {
    if (!bodyModalEl) return;
    bodyModalEl.classList.remove('open');
    bodyModalEl.setAttribute('aria-hidden', 'true');
  }

  function getAllHeaderTemplates() {
    const builtins = builtinTemplates();
    const users = loadUserTemplates();
    // Évite collisions id en préfixant côté builtins déjà "b-".
    return [...users, ...builtins];
  }

  function getAllBodyTemplates() {
    const builtins = builtinBodyTemplates();
    const users = loadUserBodyTemplates();
    return [...users, ...builtins];
  }

  function renderChips() {
    if (!headersChipsEl) return;
    headersChipsEl.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lab-chip${headerCat === id ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        headerCat = headerCat === id ? '' : id;
        try {
          window.localStorage.setItem('labHeadersCategory', headerCat);
        } catch {
          /* ignore */
        }
        renderHeadersLibrary();
      });
      return b;
    };
    headersChipsEl.appendChild(mk('', 'Tous'));
    CATEGORIES.forEach((c) => headersChipsEl.appendChild(mk(c.id, c.label)));
  }

  function dl(name, jsonText) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mergeContentTypeHint(hint) {
    const ct = String(hint || '').trim();
    if (!ct) return;
    const hEl = document.getElementById('lab-http-headers');
    if (!hEl) return;
    let cur = {};
    const parsed = parseHeadersTextarea(hEl.value);
    if (parsed && typeof parsed === 'object') cur = parsed;
    if (!cur['Content-Type']) {
      cur['Content-Type'] = ct;
      hEl.value = JSON.stringify(cur, null, 2);
    }
  }

  function applyHeaderTemplate(t, mode) {
    const hEl = document.getElementById('lab-http-headers');
    if (!hEl) return;
    const curObj = (() => {
      const parsed = parseHeadersTextarea(hEl.value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    })();
    const next =
      mode === 'replace' ? { ...(t.headers || {}) } : mergeHeadersPreserveExisting(curObj, t.headers || {});
    hEl.value = JSON.stringify(next, null, 2);
  }

  function applyBodyTemplate(t, mode) {
    const bEl = document.getElementById('lab-http-body');
    if (!bEl) return;
    const cur = String(bEl.value ?? '');
    const body = String(t.body ?? '');
    if (mode === 'fill_empty') {
      if (!cur.trim()) bEl.value = body;
    } else {
      bEl.value = body;
    }
    if (t.content_type_hint) mergeContentTypeHint(t.content_type_hint);
  }

  function renderTemplateItem(t, isUser) {
    const wrap = document.createElement('div');
    wrap.className = 'lab-hitem';
    const name = document.createElement('div');
    name.className = 'nm';
    name.textContent = t.name || 'template';

    const desc = document.createElement('div');
    desc.className = 'ds';
    const meta = [];
    if (t.category) meta.push(t.category);
    if (Array.isArray(t.tags) && t.tags.length) meta.push(t.tags.join(', '));
    desc.textContent = t.notes || meta.join(' — ') || '';

    const acts = document.createElement('div');
    acts.className = 'acts';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn tiny pri';
    applyBtn.textContent = 'Appliquer';
    applyBtn.addEventListener('click', () => {
      const m = String(headersApplyEl?.value || 'merge');
      try {
        window.localStorage.setItem('labHeadersApply', m);
      } catch {
        /* ignore */
      }
      applyHeaderTemplate(t, m === 'replace' ? 'replace' : 'merge');
      closeHeadersModal();
    });
    const repBtn = document.createElement('button');
    repBtn.type = 'button';
    repBtn.className = 'btn tiny';
    repBtn.textContent = 'Remplacer';
    repBtn.addEventListener('click', () => {
      applyHeaderTemplate(t, 'replace');
      closeHeadersModal();
    });
    acts.appendChild(applyBtn);
    acts.appendChild(repBtn);

    if (isUser) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn tiny';
      delBtn.textContent = 'Supprimer';
      delBtn.addEventListener('click', () => {
        const cur = loadUserTemplates().filter((x) => x.id !== t.id);
        saveUserTemplates(cur);
        renderHeadersLibrary();
      });
      acts.appendChild(delBtn);
    }

    const r1 = document.createElement('div');
    r1.className = 'r1';
    const left = document.createElement('div');
    left.appendChild(name);
    if (desc.textContent) left.appendChild(desc);
    r1.appendChild(left);
    r1.appendChild(acts);

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(t.headers || {}, null, 2);

    wrap.appendChild(r1);
    wrap.appendChild(pre);
    return wrap;
  }

  function renderHeadersLibrary() {
    renderChips();
    const q = String(headersQEl?.value || '');
    const body = String(document.getElementById('lab-http-body')?.value || '');
    const all = getAllHeaderTemplates();
    const filtered = filterTemplates(all, q, headerCat);
    const users = new Set(loadUserTemplates().map((t) => t.id));

    const scored = filtered
      .map((t) => ({ t, s: scoreTemplate(t, q, headerCat, body) }))
      .sort((a, b) => b.s - a.s);
    const rec = scored.slice(0, 5).map((x) => x.t);

    if (headersRecEl) {
      headersRecEl.innerHTML = '';
      if (!rec.length) headersRecEl.textContent = '—';
      else rec.forEach((t) => headersRecEl.appendChild(renderTemplateItem(t, users.has(t.id))));
    }
    if (headersAllEl) {
      headersAllEl.innerHTML = '';
      if (!filtered.length) headersAllEl.textContent = '—';
      else filtered.forEach((t) => headersAllEl.appendChild(renderTemplateItem(t, users.has(t.id))));
    }
  }

  function renderBodyChips() {
    if (!bodyChipsEl) return;
    bodyChipsEl.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lab-chip${bodyCat === id ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        bodyCat = bodyCat === id ? '' : id;
        try {
          window.localStorage.setItem('labBodyCategory', bodyCat);
        } catch {
          /* ignore */
        }
        renderBodyLibrary();
      });
      return b;
    };
    bodyChipsEl.appendChild(mk('', 'Tous'));
    BODY_CATEGORIES.forEach((c) => bodyChipsEl.appendChild(mk(c.id, c.label)));
  }

  function renderBodyItem(t, isUser) {
    const wrap = document.createElement('div');
    wrap.className = 'lab-hitem';
    const name = document.createElement('div');
    name.className = 'nm';
    name.textContent = t.name || 'template';

    const desc = document.createElement('div');
    desc.className = 'ds';
    const meta = [];
    if (t.body_type) meta.push(String(t.body_type));
    if (t.content_type_hint) meta.push(String(t.content_type_hint));
    if (Array.isArray(t.tags) && t.tags.length) meta.push(t.tags.join(', '));
    desc.textContent = t.notes || meta.join(' — ') || '';

    const acts = document.createElement('div');
    acts.className = 'acts';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn tiny pri';
    applyBtn.textContent = 'Appliquer';
    applyBtn.addEventListener('click', () => {
      const m = String(bodyApplyEl?.value || 'replace');
      try {
        window.localStorage.setItem('labBodyApply', m);
      } catch {
        /* ignore */
      }
      applyBodyTemplate(t, m === 'fill_empty' ? 'fill_empty' : 'replace');
      closeBodyModal();
    });
    const emptyBtn = document.createElement('button');
    emptyBtn.type = 'button';
    emptyBtn.className = 'btn tiny';
    emptyBtn.textContent = 'Champs vides';
    emptyBtn.addEventListener('click', () => {
      applyBodyTemplate(t, 'fill_empty');
      closeBodyModal();
    });
    acts.appendChild(applyBtn);
    acts.appendChild(emptyBtn);

    if (isUser) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn tiny';
      delBtn.textContent = 'Supprimer';
      delBtn.addEventListener('click', () => {
        const cur = loadUserBodyTemplates().filter((x) => x.id !== t.id);
        saveUserBodyTemplates(cur);
        renderBodyLibrary();
      });
      acts.appendChild(delBtn);
    }

    const r1 = document.createElement('div');
    r1.className = 'r1';
    const left = document.createElement('div');
    left.appendChild(name);
    if (desc.textContent) left.appendChild(desc);
    r1.appendChild(left);
    r1.appendChild(acts);

    const pre = document.createElement('pre');
    const bodyPreview = String(t.body ?? '');
    pre.textContent = bodyPreview.length > 2000 ? `${bodyPreview.slice(0, 2000)}…` : bodyPreview;

    wrap.appendChild(r1);
    wrap.appendChild(pre);
    return wrap;
  }

  function renderBodyLibrary() {
    renderBodyChips();
    const q = String(bodyQEl?.value || '');
    const all = getAllBodyTemplates();
    const filtered = filterBodyTemplates(all, q, bodyCat);
    const users = new Set(loadUserBodyTemplates().map((t) => t.id));

    const scored = filtered
      .map((t) => ({ t, s: scoreBodyTemplate(t, q, bodyCat) }))
      .sort((a, b) => b.s - a.s);
    const rec = scored.slice(0, 5).map((x) => x.t);

    if (bodyRecEl) {
      bodyRecEl.innerHTML = '';
      if (!rec.length) bodyRecEl.textContent = '—';
      else rec.forEach((t) => bodyRecEl.appendChild(renderBodyItem(t, users.has(t.id))));
    }
    if (bodyAllEl) {
      bodyAllEl.innerHTML = '';
      if (!filtered.length) bodyAllEl.textContent = '—';
      else filtered.forEach((t) => bodyAllEl.appendChild(renderBodyItem(t, users.has(t.id))));
    }
  }

  headersOpenEl?.addEventListener('click', openHeadersModal);
  headersBackdropEl?.addEventListener('click', closeHeadersModal);
  headersCloseEl?.addEventListener('click', closeHeadersModal);
  document.addEventListener('keydown', (e) => {
    const onLab = document.getElementById('panel-lab')?.classList.contains('active');
    if (e.key === 'Escape' && onLab && headersModalEl?.classList.contains('open')) closeHeadersModal();
    if (e.key === 'Escape' && onLab && bodyModalEl?.classList.contains('open')) closeBodyModal();
  });

  headersQEl?.addEventListener('input', () => renderHeadersLibrary());
  headersApplyEl?.addEventListener('change', () => {
    try {
      window.localStorage.setItem('labHeadersApply', String(headersApplyEl.value || 'merge'));
    } catch {
      /* ignore */
    }
  });

  // pack import/export (headers + body)
  function readJsonFile(file, cb) {
    const r = new FileReader();
    r.onload = () => {
      try {
        cb(JSON.parse(String(r.result || 'null')));
      } catch {
        cb(null);
      }
    };
    r.readAsText(file);
  }

  function normalizeHeadersTemplates(obj) {
    const arr =
      (obj && Array.isArray(obj.templates) && obj.templates) ||
      (obj && Array.isArray(obj.headers) && obj.headers) ||
      (Array.isArray(obj) ? obj : []);
    return arr
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        id: String(t.id || ''),
        name: String(t.name || 'template'),
        category: String(t.category || 'custom'),
        tags: Array.isArray(t.tags) ? t.tags.map((x) => String(x)) : [],
        headers:
          (t.headers && typeof t.headers === 'object' ? t.headers : (t.data && typeof t.data === 'object' ? t.data : {})),
        notes: t.notes != null ? String(t.notes) : '',
        createdAt: Number(t.createdAt || Date.now()),
        updatedAt: Number(t.updatedAt || Date.now()),
      }))
      .filter((t) => t.id && t.name);
  }

  function normalizeBodyTemplates(obj) {
    const arr =
      (obj && Array.isArray(obj.templates) && obj.templates) ||
      (obj && Array.isArray(obj.payloads) && obj.payloads) ||
      (Array.isArray(obj) ? obj : []);
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
  }

  function mergeById(existing, incoming) {
    const byId = new Map();
    existing.forEach((t) => byId.set(t.id, t));
    incoming.forEach((t) => byId.set(t.id, t));
    return Array.from(byId.values());
  }

  function importPackObject(pack) {
    if (!pack || typeof pack !== 'object') return false;

    // Accept top-level legacy keys too
    const headersObj = pack.headers || pack.header || pack.headers_templates || pack.headersTemplates || pack;
    const bodyObj = pack.body || pack.payloads || pack.body_templates || pack.bodyTemplates || pack;

    const hdrIncoming = normalizeHeadersTemplates(headersObj);
    const bodyIncoming = normalizeBodyTemplates(bodyObj);

    if (!hdrIncoming.length && !bodyIncoming.length) return false;

    if (hdrIncoming.length) {
      const cur = loadUserTemplates();
      saveUserTemplates(mergeById(cur, hdrIncoming));
    }
    if (bodyIncoming.length) {
      const curB = loadUserBodyTemplates();
      saveUserBodyTemplates(mergeById(curB, bodyIncoming));
    }
    return true;
  }

  function pickFile(accept, onPick) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (f) onPick(f);
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  }

  packImportEl?.addEventListener('click', () => {
    pickFile('application/json,.json', (f) => {
      readJsonFile(f, (obj) => {
        const ok = importPackObject(obj);
        if (ok) {
          renderHeadersLibrary();
          renderBodyLibrary();
          if (out) out.innerHTML = '<span style="color:var(--a3);font-size:.65rem">✅ Import pack.json OK</span>';
        } else if (out) {
          out.innerHTML = '<span style="color:var(--a2);font-size:.65rem">Import: format JSON non reconnu.</span>';
        }
      });
    });
  });

  packExportEl?.addEventListener('click', () => {
    const pack = {
      version: 1,
      headers: { templates: loadUserTemplates() },
      body: { templates: loadUserBodyTemplates() },
      pairs: { pairs: [] },
    };
    dl('lab-pack.json', JSON.stringify(pack, null, 2));
  });

  headersExportEl?.addEventListener('click', () => {
    dl('lab-http-headers-templates.json', exportUserTemplatesJson());
  });

  // Body modal wiring
  bodyOpenEl?.addEventListener('click', openBodyModal);
  bodyBackdropEl?.addEventListener('click', closeBodyModal);
  bodyCloseEl?.addEventListener('click', closeBodyModal);
  bodyQEl?.addEventListener('input', () => renderBodyLibrary());
  bodyApplyEl?.addEventListener('change', () => {
    try {
      window.localStorage.setItem('labBodyApply', String(bodyApplyEl.value || 'replace'));
    } catch {
      /* ignore */
    }
  });
  bodyExportEl?.addEventListener('click', () => {
    dl('lab-http-body-templates.json', exportUserBodyTemplatesJson());
  });

  bodyImportEl?.addEventListener('click', () => {
    pickFile('application/json,.json', (f) => {
      readJsonFile(f, (obj) => {
        const ok = importPackObject(obj);
        if (ok) {
          renderHeadersLibrary();
          renderBodyLibrary();
          if (out) out.innerHTML = '<span style="color:var(--a3);font-size:.65rem">✅ Import pack.json OK</span>';
        } else if (out) {
          out.innerHTML = '<span style="color:var(--a2);font-size:.65rem">Import: format JSON non reconnu.</span>';
        }
      });
    });
  });

  bodySaveEl?.addEventListener('click', () => {
    const bEl = document.getElementById('lab-http-body');
    if (!bEl) return;
    const name = window.prompt('Nom du modèle de body ?', 'Mon body');
    if (!name) return;
    const tagsRaw = window.prompt('Tags (séparés par des virgules) ?', '');
    const tags = tagsRaw ? tagsRaw.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const hint = window.prompt('content_type_hint (optionnel) ?', '');
    const now = Date.now();
    const t = {
      id: newId(),
      name: String(name).trim() || 'body',
      category: bodyCat || 'custom',
      tags,
      body_type: 'raw',
      content_type_hint: hint ? String(hint).trim() : '',
      body: String(bEl.value ?? ''),
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    const cur = loadUserBodyTemplates();
    cur.unshift(t);
    saveUserBodyTemplates(cur);
    if (out) out.innerHTML = `<span style="color:var(--a3);font-size:.65rem">✅ Body enregistré: <code>${escapeHtml(t.name)}</code></span>`;
  });

  headersSaveEl?.addEventListener('click', () => {
    const hEl = document.getElementById('lab-http-headers');
    if (!hEl) return;
    const parsed = parseHeadersTextarea(hEl.value);
    if (!parsed) {
      if (out) out.innerHTML = '<span style="color:var(--a2)">En-têtes : JSON invalide — impossible d’enregistrer.</span>';
      return;
    }
    const name = window.prompt('Nom du modèle d’en-têtes ?', 'Mon template');
    if (!name) return;
    const tagsRaw = window.prompt('Tags (séparés par des virgules) ?', '');
    const tags = tagsRaw ? tagsRaw.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const cat = headerCat || 'custom';
    const now = Date.now();
    const t = {
      id: newId(),
      name: String(name).trim() || 'template',
      category: cat,
      tags,
      headers: parsed,
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    const cur = loadUserTemplates();
    cur.unshift(t);
    saveUserTemplates(cur);
    if (out) out.innerHTML = `<span style="color:var(--a3);font-size:.65rem">✅ Modèle enregistré: <code>${escapeHtml(t.name)}</code></span>`;
  });

  function newLabSessionId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getLabSessionId(forceNew = false) {
    try {
      let sid = window.localStorage.getItem('labSessionId') || '';
      if (forceNew || !sid) {
        sid = newLabSessionId();
        window.localStorage.setItem('labSessionId', sid);
      }
      return sid;
    } catch {
      return '';
    }
  }

  sessionResetEl?.addEventListener('click', () => {
    const sid = getLabSessionId(true);
    if (out) out.innerHTML = `<span style="color:var(--mu);font-size:.62rem">Session réinitialisée: <code>${escapeHtml(sid)}</code></span>`;
    if (extractedEl) extractedEl.textContent = '—';
  });

  try {
    const savedFw = window.localStorage.getItem('labExtractFrameworkHint');
    if (extractFwEl && savedFw && ['auto', 'rails', 'django', 'laravel', 'spring', 'aspnet'].includes(savedFw)) {
      extractFwEl.value = savedFw;
    }
  } catch {
    /* ignore */
  }
  extractFwEl?.addEventListener('change', () => {
    try {
      window.localStorage.setItem('labExtractFrameworkHint', String(extractFwEl.value || 'auto'));
    } catch {
      /* ignore */
    }
  });

  function pushHistory(entry) {
    history.unshift(entry);
    if (history.length > 10) history.pop();
    if (!historyEl) return;
    if (!history.length) {
      historyEl.textContent = '—';
      return;
    }
    historyEl.innerHTML = history
      .map(
        (h, idx) =>
          `<span style="display:inline-flex;gap:6px;align-items:center;margin:2px 6px 2px 0">
            <button type="button" class="btn tiny" data-idx="${idx}" data-kind="${h.kind}">${idx + 1}. ${h.kind.toUpperCase()} ${escapeHtml(h.label)}</button>
            <button type="button" class="btn tiny" data-del-idx="${idx}" title="Supprimer">×</button>
          </span>`,
      )
      .join(' ');
  }

  historyClearEl?.addEventListener('click', () => {
    history.splice(0, history.length);
    if (historyEl) historyEl.textContent = '—';
  });

  function labGodFetchHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Lab-God': labGodMode ? '1' : '0',
    };
  }

  function setGodUi(on) {
    labGodMode = on;
    if (godBanner) godBanner.classList.toggle('lab-god-on', on);
    if (limitsRowEl) {
      limitsRowEl.hidden = !on;
      limitsRowEl.style.display = on ? 'flex' : 'none';
    }
    if (!on) {
      if (limitsModeEl) limitsModeEl.value = 'strict';
      if (limitsOffAckEl) limitsOffAckEl.checked = false;
      if (limitsOffAckRowEl) limitsOffAckRowEl.hidden = true;
    }
  }

  function refreshLimitsUi() {
    const mode = String(limitsModeEl?.value || 'strict');
    const showAck = labGodMode && mode === 'off';
    if (limitsOffAckRowEl) limitsOffAckRowEl.hidden = !showAck;
    if (!showAck && limitsOffAckEl) limitsOffAckEl.checked = false;
  }

  limitsModeEl?.addEventListener('change', refreshLimitsUi);

  function closeGodModal() {
    if (godModal) {
      godModal.classList.remove('open');
      godModal.setAttribute('aria-hidden', 'true');
    }
  }

  function openGodModal() {
    if (godModal) {
      godModal.classList.add('open');
      godModal.setAttribute('aria-hidden', 'false');
    }
  }

  godModalOk?.addEventListener('click', closeGodModal);
  godBackdrop?.addEventListener('click', closeGodModal);
  godOff?.addEventListener('click', () => setGodUi(false));

  document.addEventListener('keydown', (e) => {
    const onLab = document.getElementById('panel-lab')?.classList.contains('active');
    if (e.key === 'Escape' && onLab && godModal?.classList.contains('open')) {
      closeGodModal();
      return;
    }
    if (!onLab) return;
    if (e.repeat) return;
    if (konamiMatchesStep(konamiIdx, e)) {
      konamiIdx += 1;
      if (konamiIdx >= KONAMI.length) {
        konamiIdx = 0;
        setGodUi(true);
        openGodModal();
      }
    } else {
      konamiIdx = konamiMatchesStep(0, e) ? 1 : 0;
    }
  });

  function refreshEnabled() {
    const ok = agree && agree.checked;
    if (sendHttp) sendHttp.disabled = !ok;
    if (sendTcp) sendTcp.disabled = !ok;
  }

  if (agree) agree.addEventListener('change', refreshEnabled);
  refreshEnabled();

  document.querySelectorAll('input[name="lab-module"]').forEach((r) => {
    r.addEventListener('change', () => {
      const v = document.querySelector('input[name="lab-module"]:checked')?.value;
      if (modWeb) modWeb.hidden = v !== 'web';
      if (modTcp) modTcp.hidden = v !== 'tcp';
    });
  });

  function loadPresets() {
    fetch('/api/lab/presets/web')
      .then((r) => r.json())
      .then((data) => {
        const presets = data.presets || [];
        if (!presetWeb) return;
        presetWeb.innerHTML = '<option value="">— Preset Web —</option>';
        presets.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = p.name || p.id || 'preset';
          opt.dataset.preset = JSON.stringify(p);
          presetWeb.appendChild(opt);
        });
      })
      .catch(() => {});

    fetch('/api/lab/presets/tcp')
      .then((r) => r.json())
      .then((data) => {
        const presets = data.presets || [];
        if (!presetTcp) return;
        presetTcp.innerHTML = '<option value="">— Preset TCP —</option>';
        presets.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = p.name || p.id || 'preset';
          opt.dataset.preset = JSON.stringify(p);
          presetTcp.appendChild(opt);
        });
      })
      .catch(() => {});
  }

  try {
    const savedMode = window.localStorage.getItem('labPresetApplyMode');
    if (presetApplyModeEl && savedMode && ['override', 'headers_merge', 'fill_empty'].includes(savedMode)) {
      presetApplyModeEl.value = savedMode;
    }
  } catch {
    /* ignore */
  }
  presetApplyModeEl?.addEventListener('change', () => {
    try {
      window.localStorage.setItem('labPresetApplyMode', String(presetApplyModeEl.value || 'override'));
    } catch {
      /* ignore */
    }
  });

  presetWeb?.addEventListener('change', () => {
    const opt = presetWeb.selectedOptions[0];
    if (!opt || !opt.dataset.preset) return;
    try {
      const p = JSON.parse(opt.dataset.preset);
      const mode = /** @type {'override'|'headers_merge'|'fill_empty'} */ (
        presetApplyModeEl?.value || 'override'
      );
      applyWebPreset(p, mode);
    } catch {
      /* ignore */
    }
  });

  presetTcp?.addEventListener('change', () => {
    const opt = presetTcp.selectedOptions[0];
    if (!opt || !opt.dataset.preset) return;
    try {
      const p = JSON.parse(opt.dataset.preset);
      applyTcpPreset(p);
    } catch {
      /* ignore */
    }
  });

  sendHttp?.addEventListener('click', () => {
    if (!agree?.checked) return;
    if (sendHttp) sendHttp.disabled = true;
    if (sendTcp) sendTcp.disabled = true;
    let headers = {};
    const raw = document.getElementById('lab-http-headers')?.value?.trim();
    if (raw) {
      try {
        headers = JSON.parse(raw);
        if (typeof headers !== 'object' || headers === null) throw new Error('not object');
      } catch {
        out.innerHTML = `<span style="color:var(--a2)">En-têtes : JSON invalide.</span>`;
        refreshEnabled();
        return;
      }
    }
    const hostHeader = document.getElementById('lab-http-host-header')?.value?.trim();
    const followRedirects = !!followRedirectsEl?.checked;
    const useSession = !!sessionEl?.checked;
    const extractPrefill = !!extractPrefillEl?.checked;
    const extractFrameworkHint = String(extractFwEl?.value || 'auto');
    const limitsMode = labGodMode ? String(limitsModeEl?.value || 'strict') : 'strict';
    if (labGodMode && limitsMode === 'off' && !limitsOffAckEl?.checked) {
      out.innerHTML = `<span style="color:var(--a2)"><strong>Concurrence/Limites</strong> — coche “Je comprends le risque” pour désactiver les limites.</span>`;
      refreshEnabled();
      return;
    }
    let labSessionId = '';
    if (useSession) {
      labSessionId = getLabSessionId(false);
    }
    const body = {
      method: document.getElementById('lab-http-method')?.value || 'GET',
      url: document.getElementById('lab-http-url')?.value?.trim() || '',
      headers,
      body: document.getElementById('lab-http-body')?.value ?? '',
    };
    if (hostHeader) body.host_header = hostHeader;
    if (followRedirects) body.follow_redirects = true;
    if (useSession && labSessionId) body.session_id = labSessionId;
    if (extractPrefill) body.extract_prefill = true;
    if (extractPrefill && extractFrameworkHint && extractFrameworkHint !== 'auto') {
      body.extract_framework_hint = extractFrameworkHint;
    }
    if (labGodMode && limitsMode && limitsMode !== 'strict') body.limits_mode = limitsMode;
    out.textContent = 'Requête en cours…';
    if (extractedEl) extractedEl.textContent = '—';
    fetch('/api/lab/http', {
      method: 'POST',
      headers: labGodFetchHeaders(),
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          out.innerHTML = renderLabError(res);
          return;
        }
        const h = res.http;
        const head = JSON.stringify(h.headers || {}, null, 2);
        const txt = h.body_text || '';
        const pretty = formatJsonPretty(txt);
        const metaParts = [];
        if (h.dns_used) metaParts.push(`DNS → ${escapeHtml(String(h.resolved_ipv4 || ''))}`);
        if (h.logical_url && h.logical_url !== h.request_url) {
          metaParts.push(`<span style="word-break:break-all">URL logique: <code>${escapeHtml(String(h.logical_url))}</code></span>`);
        }
        if (h.request_url) {
          metaParts.push(`<span style="word-break:break-all">URL appelée: <code>${escapeHtml(String(h.request_url))}</code></span>`);
        }
        if (h.follow_redirects && h.final_url && h.final_url !== h.request_url) {
          metaParts.push(`<span style="word-break:break-all">URL finale: <code>${escapeHtml(String(h.final_url))}</code></span>`);
        }
        if (h.sni_hostname) {
          metaParts.push(`<span>SNI: <code>${escapeHtml(String(h.sni_hostname))}</code></span>`);
        }
        if (h.follow_redirects && Array.isArray(h.redirect_chain) && h.redirect_chain.length) {
          const steps = h.redirect_chain.slice(0, 10).map((r) => {
            const code = escapeHtml(String(r.code || ''));
            const to = escapeHtml(String(r.to || r.location || ''));
            return `<div style="color:var(--mu);font-size:.62rem">↪ ${code} → <code style="word-break:break-all">${to}</code></div>`;
          }).join('');
          metaParts.push(`<details><summary style="cursor:pointer">Redirections (${h.redirect_chain.length})</summary>${steps}</details>`);
        }
        const metaLine = metaParts.length
          ? `<div style="color:var(--mu);font-size:.62rem;margin-bottom:6px">${metaParts.join(' — ')}</div>`
          : '';
        out.innerHTML = `<div style="color:var(--a3);margin-bottom:8px">HTTP ${escapeHtml(String(h.status))} — ${h.truncated ? 'tronqué' : 'complet'}</div>`
          + metaLine
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">En-têtes réponse</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all;margin-bottom:12px">${escapeHtml(head)}</pre>`
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">Corps</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all">${escapeHtml(pretty)}</pre>`;

        if (extractedEl) {
          const ex = h.extracted || null;
          const sess = h.session || null;
          const parts = [];
          const mask = !!maskSecretsEl?.checked;
          if (sess && Array.isArray(sess.cookies_detail) && sess.cookies_detail.length) {
            const items = sess.cookies_detail.slice(0, 12).map((c) => {
              const nv = `${c.name}=${mask ? maskSecret(c.value) : String(c.value || '')}`;
              const attrs = [
                c.domain ? `domain=${c.domain}` : '',
                c.path ? `path=${c.path}` : '',
                c.secure ? 'Secure' : '',
                c.http_only ? 'HttpOnly' : '',
                c.expires ? `exp=${c.expires}` : '',
              ].filter(Boolean).join('; ');
              return `<div><code>${escapeHtml(nv)}</code>${attrs ? ` <span style="color:var(--mu)">(${escapeHtml(attrs)})</span>` : ''}</div>`;
            }).join('');
            parts.push(`<div><strong>Cookies</strong>:</div>${items}`);
          } else if (sess && Array.isArray(sess.cookies) && sess.cookies.length) {
            const v = mask ? sess.cookies.map((x) => String(x).replace(/=.*/, (m) => `=${maskSecret(m.slice(1))}`)) : sess.cookies;
            parts.push(`<div><strong>Cookies</strong>: <code>${escapeHtml(v.join('; '))}</code></div>`);
          }
          if (ex) {
            const csrfInfo = ex.csrf || null;
            if (csrfInfo && typeof csrfInfo === 'object') {
              const da = csrfInfo.detected_as ? String(csrfInfo.detected_as) : '';
              if (da) parts.push(`<div><strong>CSRF</strong>: <span style="color:var(--mu)">${escapeHtml(da)}</span></div>`);
            }
            if (ex.form_action) parts.push(`<div><strong>Form action</strong>: <code>${escapeHtml(ex.form_action)}</code></div>`);
            if (ex.csrf && ex.csrf.authenticity_token) parts.push(`<div><strong>authenticity_token</strong>: <code>${escapeHtml(mask ? maskSecret(ex.csrf.authenticity_token) : ex.csrf.authenticity_token)}</code></div>`);
            if (ex.csrf && ex.csrf.csrf_token_meta) parts.push(`<div><strong>meta csrf-token</strong>: <code>${escapeHtml(mask ? maskSecret(ex.csrf.csrf_token_meta) : ex.csrf.csrf_token_meta)}</code></div>`);
            if (ex.csrf && ex.csrf.spring_header_meta && ex.csrf.spring_token_meta) {
              const hn = String(ex.csrf.spring_header_meta);
              const tk = mask ? maskSecret(ex.csrf.spring_token_meta) : String(ex.csrf.spring_token_meta);
              parts.push(`<div><strong>${escapeHtml(hn)}</strong>: <code>${escapeHtml(tk)}</code> <span style="color:var(--mu)">(spring meta)</span></div>`);
            }
            if (ex.csrf && ex.csrf.hidden_tokens && typeof ex.csrf.hidden_tokens === 'object') {
              const entries = Object.entries(ex.csrf.hidden_tokens);
              entries.slice(0, 6).forEach(([k, v]) => {
                const tk = mask ? maskSecret(String(v || '')) : String(v || '');
                parts.push(`<div><strong>${escapeHtml(String(k))}</strong>: <code>${escapeHtml(tk)}</code></div>`);
              });
            }
            const hidden = ex.hidden_fields || {};
            const hk = Object.keys(hidden);
            if (hk.length) parts.push(`<div><strong>Hidden</strong>: ${escapeHtml(hk.join(', '))}</div>`);
            const ff = Array.isArray(ex.form_fields) ? ex.form_fields : [];
            const names = ff.map((f) => f && f.name ? String(f.name) : '').filter(Boolean);
            if (names.length) parts.push(`<div><strong>Champs</strong>: ${escapeHtml(names.join(', '))}</div>`);
            const ta = Array.isArray(ex.textareas) ? ex.textareas : [];
            const tan = ta.map((t) => t && t.name ? String(t.name) : '').filter(Boolean);
            if (tan.length) parts.push(`<div><strong>Textarea</strong>: ${escapeHtml(tan.join(', '))}</div>`);
            const sel = Array.isArray(ex.selects) ? ex.selects : [];
            const seln = sel.map((s) => s && s.name ? String(s.name) : '').filter(Boolean);
            if (seln.length) parts.push(`<div><strong>Select</strong>: ${escapeHtml(seln.join(', '))}</div>`);
          }
          extractedEl.innerHTML = parts.length ? parts.join('') : '—';
        }

        if (extractPrefillEl?.checked && h.prefill) {
          const pf = h.prefill;
          const m = document.getElementById('lab-http-method');
          const u = document.getElementById('lab-http-url');
          const hh = document.getElementById('lab-http-headers');
          const b = document.getElementById('lab-http-body');
          if (m) m.value = 'POST';
          if (u && pf.post_url) applyLabPrefillUrl(u, pf.post_url);
          if (hh && pf.headers) {
            let cur = {};
            const raw = (hh.value || '').trim();
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') cur = parsed;
              } catch {
                cur = {};
              }
            }
            const merged = mergeHeadersPreserveExisting(cur, pf.headers);
            hh.value = JSON.stringify(merged, null, 2);
          }
          if (b && pf.body_fields) b.value = toFormUrlEncoded(pf.body_fields);
        }
      })
      .catch((e) => {
        out.innerHTML = `<span style="color:var(--a2)">${escapeHtml(String(e))}</span>`;
      })
      .finally(() => {
        pushHistory({
          kind: 'http',
          label: body.url || '(vide)',
          payload: body,
        });
        refreshEnabled();
      });
  });

  sendTcp?.addEventListener('click', () => {
    if (!agree?.checked) return;
    if (sendHttp) sendHttp.disabled = true;
    if (sendTcp) sendTcp.disabled = true;
    const limitsMode = labGodMode ? String(limitsModeEl?.value || 'strict') : 'strict';
    if (labGodMode && limitsMode === 'off' && !limitsOffAckEl?.checked) {
      out.innerHTML = `<span style="color:var(--a2)"><strong>Concurrence/Limites</strong> — coche “Je comprends le risque” pour désactiver les limites.</span>`;
      refreshEnabled();
      return;
    }
    const host = document.getElementById('lab-tcp-host')?.value?.trim();
    const port = parseInt(document.getElementById('lab-tcp-port')?.value, 10);
    const bindRaw = document.getElementById('lab-tcp-bind')?.value?.trim();
    const payload = {
      host,
      port,
      payload_encoding: document.getElementById('lab-tcp-encoding')?.value || 'text',
      payload: document.getElementById('lab-tcp-payload')?.value ?? '',
      read_max: parseInt(document.getElementById('lab-tcp-readmax')?.value, 10) || 4096,
      timeout_sec: parseFloat(document.getElementById('lab-tcp-timeout')?.value) || 8,
    };
    if (bindRaw) payload.bind_ipv4 = bindRaw;
    if (labGodMode && limitsMode && limitsMode !== 'strict') payload.limits_mode = limitsMode;
    out.textContent = 'TCP en cours…';
    fetch('/api/lab/tcp', {
      method: 'POST',
      headers: labGodFetchHeaders(),
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          out.innerHTML = renderLabError(res);
          return;
        }
        const t = res.tcp;
        const hex = t.hex || '';
        const hexDisp = hex.length > 4000 ? `${hex.slice(0, 4000)}…` : hex;
        const srcLine =
          t.source_ipv4 ?
            `<div style="color:var(--mu);font-size:.65rem;margin-bottom:6px">Source TCP : <code>${escapeHtml(String(t.source_ipv4))}</code>${t.bind_ipv4 ? ` (bind <code>${escapeHtml(String(t.bind_ipv4))}</code>)` : ''}</div>`
            : '';
        out.innerHTML = `<div style="color:var(--a3);margin-bottom:8px">Reçu ${t.bytes_received} octet(s)${t.read_truncated ? ' (limite atteinte)' : ''}</div>`
          + srcLine
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">Hex</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all;margin-bottom:12px">${escapeHtml(hexDisp)}</pre>`
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">Aperçu texte (UTF-8, replacement)</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all">${escapeHtml(t.text_preview || '')}</pre>`;
      })
      .catch((e) => {
        out.innerHTML = `<span style="color:var(--a2)">${escapeHtml(String(e))}</span>`;
      })
      .finally(() => {
        pushHistory({
          kind: 'tcp',
          label: payload.host || '(host vide)',
          payload,
        });
        refreshEnabled();
      });
  });

  if (historyEl) {
    historyEl.addEventListener('click', (e) => {
      const del = e.target.closest('button[data-del-idx]');
      if (del) {
        const idx = Number.parseInt(del.dataset.delIdx, 10);
        if (!Number.isNaN(idx) && history[idx]) {
          history.splice(idx, 1);
          // re-render
          if (!history.length) historyEl.textContent = '—';
          else {
            historyEl.innerHTML = history
              .map(
                (h, i) =>
                  `<span style="display:inline-flex;gap:6px;align-items:center;margin:2px 6px 2px 0">
                    <button type="button" class="btn tiny" data-idx="${i}" data-kind="${h.kind}">${i + 1}. ${h.kind.toUpperCase()} ${escapeHtml(h.label)}</button>
                    <button type="button" class="btn tiny" data-del-idx="${i}" title="Supprimer">×</button>
                  </span>`,
              )
              .join(' ');
          }
        }
        return;
      }
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = Number.parseInt(btn.dataset.idx, 10);
      if (Number.isNaN(idx) || !history[idx]) return;
      const h = history[idx];
      if (h.kind === 'http') {
        const p = h.payload || {};
        const m = document.getElementById('lab-http-method');
        const u = document.getElementById('lab-http-url');
        const hh = document.getElementById('lab-http-headers');
        const b = document.getElementById('lab-http-body');
        if (m && p.method) m.value = p.method;
        if (u && p.url) u.value = p.url;
        if (hh && p.headers) hh.value = JSON.stringify(p.headers, null, 2);
        if (b && Object.prototype.hasOwnProperty.call(p, 'body')) b.value = p.body;
      } else if (h.kind === 'tcp') {
        const p = h.payload || {};
        const hostEl = document.getElementById('lab-tcp-host');
        const portEl = document.getElementById('lab-tcp-port');
        const encEl = document.getElementById('lab-tcp-encoding');
        const payEl = document.getElementById('lab-tcp-payload');
        const readEl = document.getElementById('lab-tcp-readmax');
        const tEl = document.getElementById('lab-tcp-timeout');
        const bindEl = document.getElementById('lab-tcp-bind');
        if (hostEl && p.host) hostEl.value = p.host;
        if (portEl && p.port) portEl.value = String(p.port);
        if (encEl && p.payload_encoding) encEl.value = p.payload_encoding;
        if (payEl && Object.prototype.hasOwnProperty.call(p, 'payload')) payEl.value = p.payload;
        if (readEl && p.read_max) readEl.value = String(p.read_max);
        if (tEl && p.timeout_sec) tEl.value = String(p.timeout_sec);
        if (bindEl) bindEl.value = p.bind_ipv4 != null ? String(p.bind_ipv4) : '';
      }
    });
  }

  // Force l’état initial: hors GOD, le bloc "Limites (GOD)" doit être caché.
  setGodUi(false);
  refreshLimitsUi();

  loadPresets();
}
