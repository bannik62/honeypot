import { state } from './state.js';
import { syncHeaderContextFeed } from './header-context-feed.js';

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Télécharge les IPs chargées + champs agrégés (même forme que les entrées data.json). */
export function exportIPsJson() {
  const D = state.D;
  if (!Array.isArray(D) || D.length === 0) {
    window.alert('Aucune IP à exporter — charge data.json ou connections.csv.');
    return;
  }
  const records = JSON.parse(JSON.stringify(D));
  const now = new Date();
  const payload = {
    exported_at: now.toISOString(),
    schema: 'honeypot-ips-v1',
    count: records.length,
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `honeypot-ips-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function renderIPTable(filter, search) {
  const D = state.D;
  if (!D.length) return;
  document.getElementById('ip-empty').style.display = 'none';
  document.getElementById('ip-content').style.display = 'block';
  const filterEl = document.getElementById('ip-filter');
  const searchEl = document.getElementById('ip-search');
  if (filter == null && filterEl) filter = filterEl.value;
  if (search == null && searchEl) search = searchEl.value;
  let rows = D.slice();
  if (filter === 'nmap') rows = rows.filter((d) => d.nmap);
  else if (filter === 'vuln') rows = rows.filter((d) => d.vuln_high > 0);
  else if (filter === 'screenshot') rows = rows.filter((d) => d.screenshot);
  else if (filter === 'traceroute') rows = rows.filter((d) => d.traceroute);
  if (search) rows = rows.filter((d) => d.ip.includes(search) || (d.country && d.country.toLowerCase().includes(search.toLowerCase())));
  rows.sort((a, b) => (b.vuln_high || 0) - (a.vuln_high || 0));
  const limSel = document.getElementById('ip-limit');
  const lim = (limSel && limSel.value === 'all') ? rows.length : Math.max(1, parseInt((limSel && limSel.value) || '200', 10));
  const shown = rows.slice(0, lim);
  const meta = document.getElementById('ip-meta');
  if (meta) meta.textContent = `IPs affichées: ${shown.length.toLocaleString()} / ${rows.length.toLocaleString()}${rows.length > D.length ? ' (filtré)' : ''}`;
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  document.getElementById('ip-tbody').innerHTML = shown.map((d) => {
    let badges = '';
    if (d.nmap) badges += `<span class="badge ok badge-detail" data-ip="${esc(d.ip)}" data-type="nmap" title="Voir le rapport">nmap</span>`;
    if (d.dns) badges += `<span class="badge ok badge-detail" data-ip="${esc(d.ip)}" data-type="dns" title="Voir le rapport">dns</span>`;
    if (d.traceroute) badges += `<span class="badge ok badge-detail" data-ip="${esc(d.ip)}" data-type="traceroute" title="Voir le traceroute">tr</span>`;
    if (d.screenshot) badges += `<span class="badge ok badge-detail" data-ip="${esc(d.ip)}" data-type="screenshot" title="Voir la capture">📸</span>`;
    if (d.nikto) badges += `<span class="badge warn badge-detail" data-ip="${esc(d.ip)}" data-type="nikto" title="Voir le rapport">nikto</span>`;
    const vulnCount = Number.parseInt(d.vuln_high, 10) || 0;
    const vuln = vulnCount > 0
      ? `<span class="badge err badge-detail" data-ip="${esc(d.ip)}" data-type="vuln" title="Voir les vulnérabilités">HIGH:${vulnCount}</span>`
      : '<span class="mv">—</span>';
    return `<tr><td class="av">${esc(d.ip)}</td><td>${esc(d.country) || '?'}</td><td class="mv" style="font-size:.65rem">${esc(d.ports) || '—'}</td><td>${badges}</td><td>${vuln}</td></tr>`;
  }).join('');
  syncHeaderContextFeed();
}
