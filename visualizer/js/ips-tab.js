import { state } from './state.js';

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
  if (search) rows = rows.filter((d) => d.ip.includes(search) || (d.country && d.country.toLowerCase().includes(search.toLowerCase())));
  rows.sort((a, b) => (b.vuln_high || 0) - (a.vuln_high || 0));
  const limSel = document.getElementById('ip-limit');
  const lim = (limSel && limSel.value === 'all') ? rows.length : Math.max(1, parseInt((limSel && limSel.value) || '200', 10));
  const shown = rows.slice(0, lim);
  const meta = document.getElementById('ip-meta');
  if (meta) meta.textContent = `IPs affichées: ${shown.length.toLocaleString()} / ${rows.length.toLocaleString()}${rows.length > D.length ? ' (filtré)' : ''}`;
  document.getElementById('ip-tbody').innerHTML = shown.map((d) => {
    let badges = '';
    if (d.nmap) badges += '<span class="badge ok">nmap</span>';
    if (d.dns) badges += '<span class="badge ok">dns</span>';
    if (d.screenshot) badges += '<span class="badge ok">📸</span>';
    if (d.nikto) badges += '<span class="badge warn">nikto</span>';
    const vuln = d.vuln_high > 0 ? `<span class="badge err">HIGH:${d.vuln_high}</span>` : '<span class="mv">—</span>';
    return `<tr><td class="av">${d.ip}</td><td>${d.country || '?'}</td><td class="mv" style="font-size:.65rem">${d.ports || '—'}</td><td>${badges}</td><td>${vuln}</td></tr>`;
  }).join('');
}
