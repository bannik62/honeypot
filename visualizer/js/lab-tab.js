/**
 * Onglet LAB — HTTP / TCP + presets (premier jet).
 */

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

function mergeHeadersPreserveExisting(existing, incoming) {
  const out = {};
  if (existing && typeof existing === 'object') {
    Object.entries(existing).forEach(([k, v]) => { out[k] = v; });
  }
  if (incoming && typeof incoming === 'object') {
    Object.entries(incoming).forEach(([k, v]) => {
      if (out[k] == null || out[k] === '') out[k] = v;
    });
  }
  return out;
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
  const extractedEl = document.getElementById('lab-extracted');
  const followRedirectsEl = document.getElementById('lab-http-follow-redirects');
  const sessionEl = document.getElementById('lab-http-session');
  const sessionResetEl = document.getElementById('lab-http-session-reset');
  const extractPrefillEl = document.getElementById('lab-http-extract-prefill');
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

  presetWeb?.addEventListener('change', () => {
    const opt = presetWeb.selectedOptions[0];
    if (!opt || !opt.dataset.preset) return;
    try {
      const p = JSON.parse(opt.dataset.preset);
      const m = document.getElementById('lab-http-method');
      const u = document.getElementById('lab-http-url');
      const h = document.getElementById('lab-http-headers');
      const b = document.getElementById('lab-http-body');
      if (m) m.value = p.method || 'GET';
      if (u) u.value = p.url || '';
      if (h) h.value = p.headers ? JSON.stringify(p.headers, null, 2) : '';
      if (b) b.value = p.body != null ? String(p.body) : '';
    } catch {
      /* ignore */
    }
  });

  presetTcp?.addEventListener('change', () => {
    const opt = presetTcp.selectedOptions[0];
    if (!opt || !opt.dataset.preset) return;
    try {
      const p = JSON.parse(opt.dataset.preset);
      document.getElementById('lab-tcp-host').value = p.host || '';
      document.getElementById('lab-tcp-port').value = p.port != null ? String(p.port) : '';
      document.getElementById('lab-tcp-encoding').value = p.payload_encoding || 'text';
      document.getElementById('lab-tcp-payload').value = p.payload != null ? String(p.payload) : '';
      document.getElementById('lab-tcp-readmax').value = p.read_max != null ? String(p.read_max) : '4096';
      document.getElementById('lab-tcp-timeout').value = p.timeout_sec != null ? String(p.timeout_sec) : '8';
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
            if (ex.form_action) parts.push(`<div><strong>Form action</strong>: <code>${escapeHtml(ex.form_action)}</code></div>`);
            if (ex.csrf && ex.csrf.authenticity_token) parts.push(`<div><strong>authenticity_token</strong>: <code>${escapeHtml(mask ? maskSecret(ex.csrf.authenticity_token) : ex.csrf.authenticity_token)}</code></div>`);
            if (ex.csrf && ex.csrf.csrf_token_meta) parts.push(`<div><strong>meta csrf-token</strong>: <code>${escapeHtml(mask ? maskSecret(ex.csrf.csrf_token_meta) : ex.csrf.csrf_token_meta)}</code></div>`);
            if (ex.csrf && ex.csrf.hidden_name && ex.csrf.hidden_token) parts.push(`<div><strong>${escapeHtml(String(ex.csrf.hidden_name))}</strong>: <code>${escapeHtml(mask ? maskSecret(ex.csrf.hidden_token) : ex.csrf.hidden_token)}</code></div>`);
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
    const payload = {
      host,
      port,
      payload_encoding: document.getElementById('lab-tcp-encoding')?.value || 'text',
      payload: document.getElementById('lab-tcp-payload')?.value ?? '',
      read_max: parseInt(document.getElementById('lab-tcp-readmax')?.value, 10) || 4096,
      timeout_sec: parseFloat(document.getElementById('lab-tcp-timeout')?.value) || 8,
    };
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
        out.innerHTML = `<div style="color:var(--a3);margin-bottom:8px">Reçu ${t.bytes_received} octet(s)${t.read_truncated ? ' (limite atteinte)' : ''}</div>`
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

  // Force l’état initial: hors GOD, le bloc "Limites (GOD)" doit être caché.
  setGodUi(false);
  refreshLimitsUi();
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
        if (hostEl && p.host) hostEl.value = p.host;
        if (portEl && p.port) portEl.value = String(p.port);
        if (encEl && p.payload_encoding) encEl.value = p.payload_encoding;
        if (payEl && Object.prototype.hasOwnProperty.call(p, 'payload')) payEl.value = p.payload;
        if (readEl && p.read_max) readEl.value = String(p.read_max);
        if (tEl && p.timeout_sec) tEl.value = String(p.timeout_sec);
      }
    });
  }

  loadPresets();
}
