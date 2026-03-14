import { state, setData, getByCountry } from './state.js';
import { loadInitialData, loadCSV as parseCSV } from './data-loader.js';
import { initMap, onDataChanged } from './map-tab.js';
import { renderGraph, resetSim } from './network-tab.js';
import { renderStats } from './stats-tab.js';
import { renderIPTable } from './ips-tab.js';

function updateHeader() {
  const D = state.D;
  const bc = getByCountry(D);
  const vulns = D.filter((d) => d.vuln_high > 0).length;
  document.getElementById('ht').textContent = D.length.toLocaleString();
  document.getElementById('hi').textContent = Object.keys(bc).length;
  document.getElementById('hc2').textContent = vulns;
}

function loadJSON(data) {
  setData(data);
  updateHeader();
  onDataChanged();
  renderStats();
  renderIPTable();
  if (document.getElementById('panel-graph').classList.contains('active')) renderGraph();
}

function loadCSV(txt) {
  parseCSV(txt, loadJSON);
}

document.getElementById('ip-search').addEventListener('input', function onInput() {
  renderIPTable(document.getElementById('ip-filter').value, this.value);
});
document.getElementById('ip-filter').addEventListener('change', function onFilter() {
  renderIPTable(this.value, document.getElementById('ip-search').value);
});
document.getElementById('ip-limit').addEventListener('change', () => {
  renderIPTable(document.getElementById('ip-filter').value, document.getElementById('ip-search').value);
});

document.getElementById('panel-ips').addEventListener('click', (e) => {
  const badge = e.target.closest('.badge-detail');
  if (!badge) return;
  const ip = badge.dataset.ip;
  const type = badge.dataset.type;
  if (!ip || !type) return;
  const modal = document.getElementById('ip-detail-modal');
  const titleEl = document.getElementById('ip-modal-title');
  const bodyEl = document.getElementById('ip-modal-body');
  const labels = { nmap: 'Rapport Nmap', dns: 'Rapport DNS', nikto: 'Rapport Nikto', screenshot: 'Capture d\'écran' };
  titleEl.textContent = `${labels[type] || type} — ${ip}`;
  bodyEl.innerHTML = '<span class="ip-modal-loading">Chargement…</span>';
  modal.classList.add('open');
  if (type === 'screenshot') {
    const listUrl = `/data/screenshotAndLog/${encodeURIComponent(ip)}/list`;
    fetch(listUrl)
      .then((r) => {
        if (!r.ok) {
          const msg = r.status === 404
            ? `Aucune capture pour cette IP. Vérifiez sur le VPS : data/screenshotAndLog/${escapeHtml(ip)}/<br><br><a href="/data/screenshotAndLog/debug" target="_blank">Diagnostic</a>`
            : `Erreur serveur (${r.status}).`;
          bodyEl.innerHTML = `<span class="ip-modal-loading">${msg}</span>`;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        const pngs = data.pngs || [];
        if (pngs.length === 0) {
          bodyEl.innerHTML = '<span class="ip-modal-loading">Aucune capture .png pour cette IP.</span>';
          return;
        }
        const base = `/data/screenshotAndLog/${encodeURIComponent(ip)}/`;
        bodyEl.innerHTML = pngs
          .map(
            (p) =>
              `<figure class="ip-modal-figure"><figcaption class="ip-modal-ts">Port ${escapeHtml(p.port)} — ${escapeHtml(p.timestamp)}</figcaption><img src="${base}${encodeURIComponent(p.file)}" alt="Capture ${escapeHtml(p.port)}"/></figure>`
          )
          .join('');
      })
      .catch(() => {
        bodyEl.innerHTML =
          '<span class="ip-modal-loading">Ressource indisponible (réseau ou serveur). Utilisez le dashboard via honeypot-start-server sur le VPS + tunnel SSH.</span>';
      });
    return;
  }
  const url = `/data/screenshotAndLog/${encodeURIComponent(ip)}/${type}`;
  fetch(url)
    .then((r) => {
      if (!r.ok) {
        const msg = r.status === 404
          ? `Fichier absent (404). Vérifiez sur le VPS : data/screenshotAndLog/${ip}/<br><br><a href="/data/screenshotAndLog/debug" target="_blank">Diagnostic</a>`
          : `Erreur serveur (${r.status}).`;
        bodyEl.innerHTML = `<span class="ip-modal-loading">${msg}</span>`;
        return;
      }
      return r.text();
    })
    .then((data) => {
      if (!data) return;
      bodyEl.innerHTML = `<pre>${escapeHtml(data)}</pre>`;
    })
    .catch(() => {
      bodyEl.innerHTML =
        '<span class="ip-modal-loading">Ressource indisponible (réseau ou serveur). Utilisez le dashboard via honeypot-start-server sur le VPS + tunnel SSH.</span>';
    });
});

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function closeIpModal() {
  document.getElementById('ip-detail-modal').classList.remove('open');
}

document.getElementById('ip-detail-modal').querySelector('.ip-modal-close').addEventListener('click', closeIpModal);
document.getElementById('ip-detail-modal').querySelector('.ip-modal-backdrop').addEventListener('click', closeIpModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIpModal(); });

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.tab;
    document.getElementById(`panel-${id}`).classList.add('active');
    if (id === 'graph' && state.D.length > 0) setTimeout(renderGraph, 60);
    if (id === 'ips' && state.D.length > 0) renderIPTable();
  });
});

function loadDemo() {
  const countries = ['CN', 'RU', 'DE', 'NL', 'US', 'UA', 'VN', 'FR', 'SE', 'RO', 'GB', 'BG', 'HK', 'IN'];
  const demo = [];
  for (let i = 0; i < 80; i += 1) {
    const c = countries[i % countries.length];
    const a = Math.floor(Math.random() * 220) + 1;
    const b = Math.floor(Math.random() * 255);
    const cc = Math.floor(Math.random() * 255);
    const dd = Math.floor(Math.random() * 255);
    demo.push({
      ip: `${a}.${b}.${cc}.${dd}`,
      country: c,
      nmap: Math.random() > 0.3,
      dns: Math.random() > 0.4,
      screenshot: Math.random() > 0.5,
      nikto: Math.random() > 0.7,
      vuln_high: Math.random() > 0.8 ? Math.floor(Math.random() * 5) : 0,
      ports: Math.random() > 0.5 ? '80,443' : '22',
    });
  }
  loadJSON(demo);
  document.getElementById('dzt').innerHTML = `<strong>⚡ Démo chargée — ${demo.length} IPs</strong>`;
}

window.loadDemo = loadDemo;
window.resetSim = resetSim;
window.loadCSV = loadCSV;

initMap();
loadInitialData(loadJSON);
