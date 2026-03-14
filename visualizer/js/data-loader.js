export function loadInitialData(loadJSON) {
  return fetch('/data/visualizer-dashboard/data.json')
    .then((r) => {
      if (!r.ok) throw new Error('data.json missing');
      return r.json();
    })
    .then((data) => {
      loadJSON(data);
      const status = document.getElementById('dzt');
      if (status) status.innerHTML = '<strong>✅ data.json chargé</strong>';
    })
    .catch(() => {
      const status = document.getElementById('dzt');
      if (status) status.innerHTML = 'Aucune donnée (ouvrir via <code>honeypot-start-server start</code>)';
    });
}

export function loadCSV(txt, loadJSON) {
  const lines = txt.trim().split('\n');
  const byIp = {};
  for (let i = 1; i < lines.length; i += 1) {
    const p = lines[i].split(',');
    if (p.length < 4) continue;
    const ip = p[1].trim();
    const country = p[3].trim();
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
    if (!byIp[ip]) byIp[ip] = { ip, country, nmap: false, dns: false, screenshot: false, nikto: false, vuln_high: 0, ports: '', count: 0 };
    byIp[ip].count += 1;
  }
  loadJSON(Object.values(byIp));
}
