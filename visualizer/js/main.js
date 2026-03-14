import { GRAPH_TOP_ATTACKERS_LIMIT } from './constants.js';
import { state, setData } from './state.js';
import { showTip, moveTip, hideTip } from './tooltip.js';
import { loadInitialData, loadCSV as parseCSV } from './data-loader.js';
import { initMap, onDataChanged } from './map-tab.js';

let D = state.D;
let sim = null;

function getByCountry() {
  const bc = {};
  D.forEach((d) => {
    const c = d.country || 'Unknown';
    bc[c] = (bc[c] || 0) + 1;
  });
  return bc;
}

function updateHeader() {
  const bc = getByCountry();
  const vulns = D.filter((d) => d.vuln_high > 0).length;
  document.getElementById('ht').textContent = D.length.toLocaleString();
  document.getElementById('hi').textContent = Object.keys(bc).length;
  document.getElementById('hc2').textContent = vulns;
}

function renderGraph() {
  const wrap = document.getElementById('gwrap');
  const W2 = wrap.clientWidth || 360;
  const H2 = wrap.clientHeight || 400;
  const svg = d3.select('#gsvg');
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${W2} ${H2}`);
  svg.append('defs').append('marker').attr('id', 'arr')
    .attr('viewBox', '0 -5 10 10').attr('refX', 15).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-5L10,0L0,5').attr('class', 'ah');

  function attackerScore(d) {
    return (d.vuln_high || 0) * 100 + (d.nikto ? 35 : 0) + (d.nmap ? 20 : 0) + (d.screenshot ? 8 : 0) + (d.dns ? 5 : 0);
  }
  const top = D.slice().sort((a, b) => {
    const s = attackerScore(b) - attackerScore(a);
    if (s !== 0) return s;
    const v = (b.vuln_high || 0) - (a.vuln_high || 0);
    if (v !== 0) return v;
    return (a.ip || '').localeCompare(b.ip || '');
  }).slice(0, GRAPH_TOP_ATTACKERS_LIMIT);

  const gm = document.getElementById('graph-meta');
  if (gm) gm.textContent = `Réseau: ${top.length.toLocaleString()} / ${D.length.toLocaleString()} (top attaquants)`;
  if (!top.length) return;

  const nodes = [{ id: 'VPS', type: 'vps' }];
  const links = [];
  top.forEach((d) => {
    nodes.push({ id: d.ip, type: 'atk', country: d.country, vuln: d.vuln_high, ports: d.ports });
    links.push({ source: d.ip, target: 'VPS', hot: d.vuln_high > 0 });
  });

  if (sim) sim.stop();
  sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-55))
    .force('center', d3.forceCenter(W2 / 2, H2 / 2))
    .force('collide', d3.forceCollide().radius(20));

  const edge = svg.append('g').selectAll('line').data(links).join('line')
    .attr('class', (d) => `edge${d.hot ? ' hot' : ''}`)
    .attr('marker-end', 'url(#arr)');
  const node = svg.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', (d) => (d.type === 'vps' ? 'nv' : 'na'))
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  node.append('circle').attr('r', (d) => (d.type === 'vps' ? 17 : (d.vuln > 0 ? 8 : 5)));
  node.append('text').attr('class', (d) => (d.type === 'vps' ? 'nl vp' : 'nl'))
    .attr('dx', (d) => (d.type === 'vps' ? -12 : 12))
    .attr('dy', (d) => (d.type === 'vps' ? -22 : 4))
    .text((d) => (d.type === 'vps' ? '🍯 VPS' : d.id));
  node.filter((d) => d.type === 'atk')
    .on('mouseenter', (e, d) => showTip(e, d.country, d.id, `${d.vuln} vuln(s) | ${d.ports}`))
    .on('mousemove', moveTip).on('mouseleave', hideTip);
  sim.on('tick', () => {
    edge.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  });
}

function resetSim() {
  if (sim) sim.alpha(1).restart();
}

function renderStats() {
  if (!D.length) return;
  document.getElementById('empty').style.display = 'none';
  document.getElementById('sb').style.display = 'block';
  const bc = getByCountry();
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

function renderIPTable(filter, search) {
  if (!D.length) return;
  document.getElementById('ip-empty').style.display = 'none';
  document.getElementById('ip-content').style.display = 'block';
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

function loadJSON(data) {
  setData(data);
  D = state.D;
  onDataChanged();
  updateHeader();
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
    if (id === 'graph' && D.length > 0) setTimeout(renderGraph, 60);
    if (id === 'ips' && D.length > 0) renderIPTable();
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
