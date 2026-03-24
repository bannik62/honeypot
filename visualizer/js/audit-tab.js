import { loadingOverlay } from './loading-overlay.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function badgeClassFor(status) {
  if (status === 'protected') return 'protected';
  if (status === 'open') return 'open';
  if (status === 'dead') return 'dead';
  if (status === 'unknown') return 'unknown';
  return 'unknown';
}

function renderPorts(ports) {
  const tbody = document.getElementById('audit-ports-tbody');
  if (!tbody) return;
  if (!ports || ports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:10px 8px;color:var(--mu)">Aucun port en écoute</td></tr>';
    return;
  }
  tbody.innerHTML = ports.map((p) => {
    const proc = p.process ? escapeHtml(p.process) : '—';
    const pid = p.pid != null ? escapeHtml(p.pid) : '—';
    const container = p.container ? escapeHtml(p.container) : '';
    const origin = p.origin === 'docker' ? `<span>${container || 'docker'} </span>` : '';
    const originTxt = p.origin === 'docker' ? `docker` : 'natif';
    const originCell = p.origin === 'docker'
      ? `<span style="color:var(--a3)">${originTxt}</span>`
      : originTxt;
    return `
      <tr>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${p.port}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${escapeHtml(p.proto)}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${escapeHtml(p.state || '—')}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">
          ${escapeHtml(p.origin === 'docker' ? `(${originTxt}) ${proc}` : proc)}
          <span style="opacity:.7">PID ${pid}</span>
        </td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${originCell}</td>
      </tr>
    `;
  }).join('');
}

function renderUfw(ufw) {
  const el = document.getElementById('audit-ufw-status');
  if (!el) return;
  const raw = ufw?.raw ? String(ufw.raw) : '';
  const dbg = ufw?.debug || null;
  const rawSnippet = raw ? raw.split('\n').slice(0, 8).join('\n') : '';
  const rawHtml = rawSnippet
    ? escapeHtml(rawSnippet).replace(/\n/g, '<br>')
    : '';
  const hint = 'UFW non accessible en mode non interactif (sudo -n). Vérifiez la configuration sudo (voir README § Audit).';

  let activeTxt = 'inconnu';
  if (ufw?.active === true) activeTxt = 'actif';
  else if (ufw?.active === false) activeTxt = 'inactif';
  const policyTxt = ufw?.policy_in ? String(ufw.policy_in) : '—';
  const rulesTxt = String(ufw?.rules_count ?? 0);
  const warnLine = (ufw?.active == null && dbg?.error)
    ? `<div style="margin-top:6px;opacity:.9;color:var(--w)">${escapeHtml(hint)}</div>`
    : '';

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--b);font-size:.66rem">État</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--b);font-size:.66rem">Policy incoming</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--b);font-size:.66rem">Règles</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.72rem">${escapeHtml(activeTxt)}</td>
          <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.72rem">${escapeHtml(policyTxt)}</td>
          <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.72rem">${escapeHtml(rulesTxt)}</td>
        </tr>
      </tbody>
    </table>
    ${warnLine}
    ${rawHtml ? `<div style="margin-top:6px;opacity:.85;font-size:.64rem;color:var(--mu)">Debug ufw :<br><code style="white-space:normal;word-break:break-word">${rawHtml}</code></div>` : ''}
  `;

}

function renderCross(cross) {
  const tbody = document.getElementById('audit-cross-tbody');
  if (!tbody) return;
  if (!cross || cross.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:10px 8px;color:var(--mu)">—</td></tr>';
    return;
  }
  tbody.innerHTML = cross.map((c) => {
    const badge = `<span class="audit-badge ${badgeClassFor(c.status)}">${escapeHtml(c.label || '')}</span>`;
    return `
      <tr>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${c.key ? c.key[0] : ''}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${c.key ? escapeHtml(c.key[1]) : ''}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${badge}</td>
      </tr>
    `;
  }).join('');
}

function renderDeadDeny(list) {
  const tbody = document.getElementById('audit-deaddeny-tbody');
  if (!tbody) return;
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:10px 8px;color:var(--mu)">—</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((r) => {
    const badge = `<span class="audit-badge dead">${escapeHtml(r.label || '🟡 Règle morte')}</span>`;
    return `
      <tr>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${escapeHtml(r.port)}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${escapeHtml(r.proto)}</td>
        <td style="padding:6px 8px;border-top:1px solid rgba(26,58,92,.35);font-size:.68rem">${badge}</td>
      </tr>
    `;
  }).join('');
}

async function loadAudit() {
  loadingOverlay.show({
    title: 'AUDIT RÉSEAU',
    message: 'Snapshot ports + UFW…',
    indeterminate: true,
  });
  try {
    const r = await fetch('/api/audit', { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    const compatEl = document.getElementById('audit-fw-compat');
    const sections = document.getElementById('audit-sections');

    if (!data.ok) throw new Error(data.error || 'Audit échoué');

    renderPorts(data.ports_open);

    if (!data.ufw_supported) {
      if (compatEl) {
        compatEl.style.display = 'block';
        compatEl.textContent = 'firewall non supporté / parsing UFW partiel : statuts incomplets — croisement affiché en mode inconnu.';
      }
      // Important : on continue à afficher les tables (phase 1 read-only),
      // même si la policy UFW ne peut pas être déterminée.
    } else if (compatEl) {
      compatEl.style.display = 'none';
      if (sections) sections.classList.remove('audit-muted');
    }

    renderUfw(data.ufw);
    renderCross(data.cross_open_ports);
    renderDeadDeny(data.dead_deny_rules);
    loadingOverlay.hide();
  } catch (e) {
    loadingOverlay.showError(e?.message || String(e));
  }
}

export function initAudit() {
  const btn = document.getElementById('audit-refresh');
  if (!btn) return;
  btn.addEventListener('click', () => loadAudit());
  // Option : premier chargement immédiat (toujours en mode "manuel" côté utilisateur : pas de polling).
  loadAudit();
}

