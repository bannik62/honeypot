import { state, getByCountry } from './state.js';

export function renderStats() {
  const D = state.D;
  if (!D.length) return;
  document.getElementById('empty').style.display = 'none';
  document.getElementById('sb').style.display = 'block';
  const bc = getByCountry(D);
  const sorted = Object.entries(bc).sort((a, b) => b[1] - a[1]);
  const topC = sorted[0] || ['—', 0];
  const vulns = D.filter((d) => d.vuln_high > 0).length;
  document.getElementById('cards').innerHTML =
    `<div class="card"><div class="lb">IPs SCANNÉES</div><div class="vl">${D.length.toLocaleString()}</div></div>`
    + `<div class="card r"><div class="lb">AVEC VULNS</div><div class="vl">${vulns}</div></div>`
    + `<div class="card g"><div class="lb">PAYS</div><div class="vl">${Object.keys(bc).length}</div></div>`
    + `<div class="card w"><div class="lb">TOP PAYS</div><div class="vl">${topC[0]}</div></div>`;
  const mx = sorted[0] ? sorted[0][1] : 1;
  document.getElementById('ctb').innerHTML = sorted.map((e, i) => `<tr><td class="mv">${i + 1}</td><td>${e[0]}</td><td class="cv">${e[1]}</td><td class="mv">${(e[1] / D.length * 100).toFixed(1)}%</td><td><div class="bt"><div class="bf" style="width:${(e[1] / mx * 100).toFixed(1)}%"></div></div></td></tr>`).join('');
}
