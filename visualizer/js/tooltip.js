import { state } from './state.js';

export function showCountryTip(e, country, count) {
  const k1 = document.getElementById('tip-k1');
  if (k1) k1.textContent = 'IPs';
  const cc = country || 'Unknown';
  const ips = state.D.filter((d) => (d.country || 'Unknown') === cc);
  const totalVulns = ips.reduce((sum, d) => sum + (Number.parseInt(d.vuln_high, 10) || 0), 0);
  const portSet = new Set();
  ips.forEach((d) => {
    if (!d.ports || typeof d.ports !== 'string') return;
    d.ports.split(',').map((p) => p.trim()).filter(Boolean).forEach((p) => portSet.add(p));
  });
  const portsTxt = Array.from(portSet).slice(0, 10).join(', ');
  const reports = [];
  if (ips.some((d) => d.nmap)) reports.push('nmap');
  if (ips.some((d) => d.dns)) reports.push('dns');
  if (ips.some((d) => d.traceroute)) reports.push('tr');
  if (ips.some((d) => d.screenshot)) reports.push('shot');
  if (ips.some((d) => d.nikto)) reports.push('nikto');
  document.getElementById('tiip').textContent = cc;
  document.getElementById('tip-country').textContent = `${count || ips.length || 0} IP(s)`;
  document.getElementById('tip-vuln').textContent = totalVulns > 0 ? totalVulns.toString() : '—';
  document.getElementById('tip-ports').textContent = portsTxt || '—';
  document.getElementById('tip-reports').textContent = reports.length ? reports.join(', ') : '—';
  document.getElementById('tip').style.display = 'block';
  moveTip(e);
}

export function showPointTip(e, d) {
  const k1 = document.getElementById('tip-k1');
  if (k1) k1.textContent = 'Pays';
  const nodeType = (d && d.nodeType) ? String(d.nodeType) : '';
  const vulnHigh = Number.parseInt(d.vuln_high, 10) || 0;
  const ports = (d.ports && typeof d.ports === 'string') ? d.ports.trim() : '';
  const reports = [];
  if (d.nmap) reports.push('nmap');
  if (d.dns) reports.push('dns');
  if (d.traceroute) reports.push('tr');
  if (d.screenshot) reports.push('shot');
  if (d.nikto) reports.push('nikto');
  const name = (d.name && typeof d.name === 'string') ? d.name.trim() : '';
  // Robustesse : selon le contexte, certains appels passent `id` au lieu de `ip`.
  const ip = (d && typeof d.ip === 'string' && d.ip.trim()) ? d.ip.trim() : (d && d.id ? String(d.id) : 'Unknown');

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  if (nodeType === 'hop') {
    const safeName = name && name !== ip ? name : 'unknow';
    const tiip = document.getElementById('tiip');
    tiip.innerHTML = `ip : ${escapeHtml(ip)}<br>name : ${escapeHtml(safeName)}`;
  } else {
    document.getElementById('tiip').textContent = name && name !== ip ? `${name} (${ip})` : ip;
  }
  document.getElementById('tip-country').textContent = d.country || 'Unknown';
  document.getElementById('tip-vuln').textContent = vulnHigh > 0 ? vulnHigh.toString() : '—';
  document.getElementById('tip-ports').textContent = ports || '—';
  document.getElementById('tip-reports').textContent = reports.length ? reports.join(', ') : '—';
  document.getElementById('tip').style.display = 'block';
  moveTip(e);
}

export function moveTip(e) {
  const t = document.getElementById('tip');
  t.style.left = `${e.clientX + 14}px`;
  t.style.top = `${e.clientY - 10}px`;
}

export function hideTip() {
  document.getElementById('tip').style.display = 'none';
}
