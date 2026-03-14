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
