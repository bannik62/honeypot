export function showCountryTip(e, country, count) {
  document.getElementById('tiip').textContent = country || 'Unknown';
  document.getElementById('tip-country').textContent = country || 'Unknown';
  document.getElementById('tip-vuln').textContent = '—';
  document.getElementById('tip-ports').textContent = '—';
  document.getElementById('tip-reports').textContent = `${count || 0} IP(s)`;
  document.getElementById('tip').style.display = 'block';
  moveTip(e);
}

export function showPointTip(e, d) {
  const reports = [];
  if (d.nmap) reports.push('nmap');
  if (d.dns) reports.push('dns');
  if (d.traceroute) reports.push('tr');
  if (d.screenshot) reports.push('shot');
  if (d.nikto) reports.push('nikto');
  document.getElementById('tiip').textContent = d.ip || 'Unknown';
  document.getElementById('tip-country').textContent = d.country || 'Unknown';
  document.getElementById('tip-vuln').textContent = (d.vuln_high || 0).toString();
  document.getElementById('tip-ports').textContent = (d.ports && d.ports.trim()) ? d.ports : '—';
  document.getElementById('tip-reports').textContent = reports.length ? reports.join(', ') : '—';
  document.getElementById('tip').style.display = 'block';
  moveTip(e);
}

export function showTip(e, country, ip, info) {
  showPointTip(e, {
    ip,
    country,
    vuln_high: 0,
    ports: info || '',
    nmap: false,
    dns: false,
    screenshot: false,
    nikto: false,
    traceroute: false,
  });
}

export function moveTip(e) {
  const t = document.getElementById('tip');
  t.style.left = `${e.clientX + 14}px`;
  t.style.top = `${e.clientY - 10}px`;
}

export function hideTip() {
  document.getElementById('tip').style.display = 'none';
}
