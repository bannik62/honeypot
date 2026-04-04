/**
 * Presets LAB — variables {{…}}, fusion contrôlée (en-têtes / corps / URL).
 * Utilisé par lab-tab.js ; pas de dépendance au backend.
 */

const VAR_RE = /\{\{([A-Z0-9_]+)\}\}/g;

/** @typedef {'override'|'headers_merge'|'fill_empty'} LabPresetGlobalMode */

/**
 * Contexte pour substitution : dérivé du champ URL et Host optionnel du formulaire LAB HTTP.
 * @returns {Record<string, string>}
 */
export function buildLabHttpContext() {
  const urlRaw = document.getElementById('lab-http-url')?.value?.trim() || '';
  const hostHeader = document.getElementById('lab-http-host-header')?.value?.trim() || '';
  const ctx = {
    URL: urlRaw,
    HOST_HEADER: hostHeader,
    HOST: '',
    ORIGIN: '',
    PATHNAME: '',
    SEARCH: '',
    PROTOCOL: '',
  };
  try {
    const u = new URL(urlRaw);
    ctx.HOST = u.host;
    ctx.ORIGIN = u.origin;
    ctx.PATHNAME = u.pathname;
    ctx.SEARCH = u.search;
    ctx.PROTOCOL = u.protocol.replace(':', '');
  } catch {
    /* URL invalide : champs dérivés vides */
  }
  return ctx;
}

/**
 * Contexte minimal pour presets TCP (hôte/port saisis).
 * @returns {Record<string, string>}
 */
export function buildLabTcpContext() {
  const host = document.getElementById('lab-tcp-host')?.value?.trim() || '';
  const port = document.getElementById('lab-tcp-port')?.value?.trim() || '';
  return { HOST: host, PORT: port };
}

/**
 * @param {string|null|undefined} str
 * @param {Record<string, string>} ctx
 */
export function substituteVars(str, ctx) {
  if (str == null) return str;
  if (typeof str !== 'string') return str;
  return str.replace(VAR_RE, (_, key) => {
    const v = ctx[key];
    return v != null ? String(v) : '';
  });
}

function substituteVarsInHeaders(obj, ctx) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    const nk = substituteVars(k, ctx);
    if (typeof v === 'string') out[nk] = substituteVars(v, ctx);
    else out[nk] = v;
  });
  return out;
}

/** Merge : les clés déjà présentes et non vides dans `existing` gardent la priorité ; sinon valeur `incoming`. */
export function mergeHeadersPreserveExisting(existing, incoming) {
  const out = {};
  if (existing && typeof existing === 'object') {
    Object.entries(existing).forEach(([k, v]) => {
      out[k] = v;
    });
  }
  if (incoming && typeof incoming === 'object') {
    Object.entries(incoming).forEach(([k, v]) => {
      if (out[k] == null || out[k] === '') out[k] = v;
    });
  }
  return out;
}

function parseHeadersJson(raw) {
  if (!raw || !String(raw).trim()) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null ? o : {};
  } catch {
    return {};
  }
}

/**
 * Fusion JSON superficielle : `{ ...a, ...b }` (b écrase les clés communes).
 * @param {string} existingStr
 * @param {string} incomingStr
 */
export function mergeBodyJsonShallow(existingStr, incomingStr) {
  try {
    const a = JSON.parse(existingStr || '{}');
    const b = JSON.parse(incomingStr || '{}');
    if (
      typeof a === 'object' &&
      a !== null &&
      !Array.isArray(a) &&
      typeof b === 'object' &&
      b !== null &&
      !Array.isArray(b)
    ) {
      return JSON.stringify({ ...a, ...b }, null, 2);
    }
  } catch {
    /* ignore */
  }
  return incomingStr;
}

/**
 * @param {string} field
 * @param {object|null|undefined} presetMerge - ex. { headers: 'merge', body: 'json_shallow' }
 * @param {LabPresetGlobalMode} globalMode
 */
function resolveFieldMode(field, presetMerge, globalMode) {
  if (presetMerge && typeof presetMerge === 'object' && presetMerge[field]) {
    return String(presetMerge[field]);
  }
  if (globalMode === 'override') {
    if (field === 'headers') return 'override';
    return 'override';
  }
  if (globalMode === 'headers_merge') {
    if (field === 'headers') return 'merge';
    return 'override';
  }
  if (globalMode === 'fill_empty') {
    if (field === 'headers') return 'merge';
    return 'fill_empty';
  }
  return 'override';
}

/**
 * Applique un preset Web au formulaire LAB (champs du DOM).
 * @param {object} preset - entrée JSON (id, name, merge, method, url, headers, body, host_header)
 * @param {LabPresetGlobalMode} globalMode
 */
export function applyWebPreset(preset, globalMode = 'override') {
  const ctx = buildLabHttpContext();
  const pm = preset.merge && typeof preset.merge === 'object' ? preset.merge : null;

  const method = substituteVars(preset.method != null ? String(preset.method) : 'GET', ctx);
  const url = substituteVars(preset.url != null ? String(preset.url) : '', ctx);
  const hostHeader = substituteVars(
    preset.host_header != null ? String(preset.host_header) : '',
    ctx,
  );
  const bodyRaw = substituteVars(preset.body != null ? String(preset.body) : '', ctx);
  const headersObj = substituteVarsInHeaders(
    preset.headers && typeof preset.headers === 'object' ? { ...preset.headers } : {},
    ctx,
  );

  const mEl = document.getElementById('lab-http-method');
  const uEl = document.getElementById('lab-http-url');
  const hEl = document.getElementById('lab-http-headers');
  const bEl = document.getElementById('lab-http-body');
  const hhEl = document.getElementById('lab-http-host-header');

  const cur = {
    method: mEl?.value || 'GET',
    url: uEl?.value?.trim() || '',
    headers: parseHeadersJson(hEl?.value),
    body: bEl?.value ?? '',
    host_header: hhEl?.value?.trim() || '',
  };

  const fm = (f) => resolveFieldMode(f, pm, globalMode);

  if (fm('method') === 'override') {
    if (mEl) mEl.value = method;
  }
  /* fill_empty : on ne change pas la méthode (le select a toujours une valeur). */

  if (fm('url') === 'override') {
    if (uEl) uEl.value = url;
  } else if (fm('url') === 'fill_empty' && !cur.url) {
    if (uEl) uEl.value = url;
  }

  if (fm('host_header') === 'override') {
    if (hhEl) hhEl.value = hostHeader;
  } else if (fm('host_header') === 'fill_empty' && !cur.host_header) {
    if (hhEl) hhEl.value = hostHeader;
  }

  if (fm('headers') === 'override') {
    if (hEl) hEl.value = Object.keys(headersObj).length ? JSON.stringify(headersObj, null, 2) : '';
  } else if (fm('headers') === 'merge') {
    const merged = mergeHeadersPreserveExisting(cur.headers, headersObj);
    if (hEl) hEl.value = JSON.stringify(merged, null, 2);
  }

  const bodyMode = fm('body');
  if (bodyMode === 'override') {
    if (bEl) bEl.value = bodyRaw;
  } else if (bodyMode === 'fill_empty') {
    if (bEl && !cur.body.trim()) bEl.value = bodyRaw;
  } else if (bodyMode === 'json_shallow') {
    if (bEl) bEl.value = mergeBodyJsonShallow(cur.body, bodyRaw);
  }
}

/**
 * @param {object} preset
 */
export function applyTcpPreset(preset) {
  const ctx = buildLabTcpContext();
  const host = substituteVars(preset.host != null ? String(preset.host) : '', ctx);
  const payload = substituteVars(preset.payload != null ? String(preset.payload) : '', ctx);
  const bindRaw =
    preset.bind_ipv4 != null ? substituteVars(String(preset.bind_ipv4), ctx) : '';

  const hostEl = document.getElementById('lab-tcp-host');
  const portEl = document.getElementById('lab-tcp-port');
  const encEl = document.getElementById('lab-tcp-encoding');
  const payEl = document.getElementById('lab-tcp-payload');
  const readEl = document.getElementById('lab-tcp-readmax');
  const tEl = document.getElementById('lab-tcp-timeout');
  const bindEl = document.getElementById('lab-tcp-bind');

  if (hostEl) hostEl.value = host;
  if (portEl && preset.port != null) portEl.value = String(preset.port);
  if (encEl && preset.payload_encoding) encEl.value = String(preset.payload_encoding);
  if (payEl) payEl.value = payload;
  if (readEl && preset.read_max != null) readEl.value = String(preset.read_max);
  if (tEl && preset.timeout_sec != null) tEl.value = String(preset.timeout_sec);
  if (bindEl) bindEl.value = bindRaw;
}
