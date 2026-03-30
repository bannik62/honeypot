/**
 * Onglet LAB — HTTP / TCP + presets (premier jet).
 */

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
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

export function initLab() {
  const agree = document.getElementById('lab-agree');
  const sendHttp = document.getElementById('lab-send-http');
  const sendTcp = document.getElementById('lab-send-tcp');
  const out = document.getElementById('lab-result');
  const modWeb = document.getElementById('lab-mod-web');
  const modTcp = document.getElementById('lab-mod-tcp');
  const presetWeb = document.getElementById('lab-preset-web');
  const presetTcp = document.getElementById('lab-preset-tcp');
  const godBanner = document.getElementById('lab-god-banner');
  const godModal = document.getElementById('lab-god-modal');
  const godModalOk = document.getElementById('lab-god-modal-ok');
  const godOff = document.getElementById('lab-god-off');
  const godBackdrop = document.getElementById('lab-god-modal-backdrop');

  /** @type {boolean} */
  let labGodMode = false;
  let konamiIdx = 0;

  function labGodFetchHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Lab-God': labGodMode ? '1' : '0',
    };
  }

  function setGodUi(on) {
    labGodMode = on;
    if (godBanner) godBanner.classList.toggle('lab-god-on', on);
  }

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
    const onLab = document.querySelector('.tab.active')?.dataset?.tab === 'lab';
    if (e.key === 'Escape' && onLab && godModal?.classList.contains('open')) {
      closeGodModal();
      return;
    }
    if (!onLab) return;
    if (e.code === KONAMI[konamiIdx]) {
      konamiIdx += 1;
      if (konamiIdx >= KONAMI.length) {
        konamiIdx = 0;
        setGodUi(true);
        openGodModal();
      }
    } else {
      konamiIdx = e.code === KONAMI[0] ? 1 : 0;
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
    let headers = {};
    const raw = document.getElementById('lab-http-headers')?.value?.trim();
    if (raw) {
      try {
        headers = JSON.parse(raw);
        if (typeof headers !== 'object' || headers === null) throw new Error('not object');
      } catch {
        out.innerHTML = `<span style="color:var(--a2)">En-têtes : JSON invalide.</span>`;
        return;
      }
    }
    const hostHeader = document.getElementById('lab-http-host-header')?.value?.trim();
    const body = {
      method: document.getElementById('lab-http-method')?.value || 'GET',
      url: document.getElementById('lab-http-url')?.value?.trim() || '',
      headers,
      body: document.getElementById('lab-http-body')?.value ?? '',
    };
    if (hostHeader) body.host_header = hostHeader;
    out.textContent = 'Requête en cours…';
    fetch('/api/lab/http', {
      method: 'POST',
      headers: labGodFetchHeaders(),
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          out.innerHTML = `<span style="color:var(--a2)">${escapeHtml(res.error || 'Erreur')}</span>`;
          return;
        }
        const h = res.http;
        const head = JSON.stringify(h.headers || {}, null, 2);
        const txt = h.body_text || '';
        const pretty = formatJsonPretty(txt);
        const metaLine = h.request_url
          ? `<div style="color:var(--mu);font-size:.62rem;margin-bottom:6px">${h.dns_used ? `DNS → ${escapeHtml(String(h.resolved_ipv4 || ''))} — ` : ''}<span style="word-break:break-all">${escapeHtml(String(h.request_url))}</span></div>`
          : '';
        out.innerHTML = `<div style="color:var(--a3);margin-bottom:8px">HTTP ${escapeHtml(String(h.status))} — ${h.truncated ? 'tronqué' : 'complet'}</div>`
          + metaLine
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">En-têtes réponse</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all;margin-bottom:12px">${escapeHtml(head)}</pre>`
          + `<div style="color:var(--mu);font-size:.65rem;margin-bottom:4px">Corps</div>`
          + `<pre style="white-space:pre-wrap;word-break:break-all">${escapeHtml(pretty)}</pre>`;
      })
      .catch((e) => {
        out.innerHTML = `<span style="color:var(--a2)">${escapeHtml(String(e))}</span>`;
      });
  });

  sendTcp?.addEventListener('click', () => {
    if (!agree?.checked) return;
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
    out.textContent = 'TCP en cours…';
    fetch('/api/lab/tcp', {
      method: 'POST',
      headers: labGodFetchHeaders(),
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          out.innerHTML = `<span style="color:var(--a2)">${escapeHtml(res.error || 'Erreur')}</span>`;
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
      });
  });

  loadPresets();
}
