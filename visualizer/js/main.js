import { CC, ISO2_TO_N3, VPS, GRAPH_TOP_ATTACKERS_LIMIT, W, H } from './constants.js';
import { state, setData } from './state.js';
import { showCountryTip, showPointTip, showTip, moveTip, hideTip } from './tooltip.js';
import { loadInitialData, loadCSV as parseCSV } from './data-loader.js';

let D = state.D;
let sim = null;
let projection;
let pathGen;
let mapG;
let currentZoomK = 1;
let mapZoomSvg;
let mapZoomBehavior;
let worldLandFeature = null;
let ipGeoCache = {};
let countryFeatureByIso2 = {};
let detailPointCache = [];

function updateZoomPct(k) {
  const el = document.getElementById('zoom-pct');
  if (el) el.textContent = `${Math.round((k || 1) * 100)}%`;
}

projection = d3.geoMercator().scale(153).translate([W / 2, H / 2 + 60]).center([0, 20]);
pathGen = d3.geoPath().projection(projection);

function ipHash(ip) {
  let h = 2166136261;
  for (let i = 0; i < ip.length; i += 1) { h ^= ip.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h >>> 0;
}

function seededRandFactory(seed) {
  let s = (seed >>> 0) || 1;
  return function rand() {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pointOnLandNear(baseLonLat, seed) {
  if (!worldLandFeature) return baseLonLat;
  const a0 = (seed % 360) * Math.PI / 180;
  const ga = 2.399963229728653;

  for (let i = 0; i < 80; i += 1) {
    const r = 0.10 + (i % 16) * 0.08;
    const a = a0 + i * ga;
    const cand = [baseLonLat[0] + Math.cos(a) * r, baseLonLat[1] + Math.sin(a) * r * 0.62];
    if (d3.geoContains(worldLandFeature, cand)) return cand;
  }
  for (let i = 0; i < 220; i += 1) {
    const r = 1.3 + i * 0.06;
    const a = a0 + i * ga;
    const cand = [baseLonLat[0] + Math.cos(a) * r, baseLonLat[1] + Math.sin(a) * r * 0.62];
    if (d3.geoContains(worldLandFeature, cand)) return cand;
  }
  return baseLonLat;
}

function ipGeoPoint(ip, countryCode) {
  const iso = (countryCode || '').toUpperCase().trim();
  const cf = countryFeatureByIso2[iso];
  if (cf) {
    const polyKey = `poly:${iso}|${ip}`;
    if (ipGeoCache[polyKey]) return ipGeoCache[polyKey];
    const rand = seededRandFactory(ipHash(polyKey));
    const b = d3.geoBounds(cf);
    let minLon = b[0][0];
    let minLat = b[0][1];
    let maxLon = b[1][0];
    let maxLat = b[1][1];
    if (maxLon < minLon) { minLon = -180; maxLon = 180; }
    for (let i = 0; i < 260; i += 1) {
      const lon = minLon + rand() * (maxLon - minLon);
      const lat = minLat + rand() * (maxLat - minLat);
      const cand = [lon, lat];
      if (d3.geoContains(cf, cand)) { ipGeoCache[polyKey] = cand; return cand; }
    }
    const ctr = d3.geoCentroid(cf);
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < 180; i += 1) {
      const rr = 0.08 + i * 0.05;
      const a = a0 + i * 2.399963229728653;
      const cand = [ctr[0] + Math.cos(a) * rr, ctr[1] + Math.sin(a) * rr * 0.62];
      if (d3.geoContains(cf, cand)) { ipGeoCache[polyKey] = cand; return cand; }
    }
    ipGeoCache[polyKey] = ctr;
    return ctr;
  }

  const base = CC[countryCode];
  if (!base) return null;
  const key = `${countryCode}|${ip}`;
  if (ipGeoCache[key]) return ipGeoCache[key];
  const p = pointOnLandNear(base, ipHash(ip));
  ipGeoCache[key] = p;
  return p;
}

function hasValidLatLon(d) {
  return d && Number.isFinite(d.lat) && Number.isFinite(d.lon)
    && d.lat >= -90 && d.lat <= 90 && d.lon >= -180 && d.lon <= 180;
}

function rebuildDetailPointCache() {
  const groups = {};
  const keys = [];
  detailPointCache = [];
  for (let i = 0; i < D.length; i += 1) {
    const d = D[i];
    const c = d.country || 'Unknown';
    const geo = hasValidLatLon(d) ? [d.lon, d.lat] : ipGeoPoint(d.ip, c);
    if (!geo) continue;
    const p = projection(geo);
    if (!p) continue;
    const key = `${hasValidLatLon(d) ? 'geo:' : 'est:'}${geo[0].toFixed(3)},${geo[1].toFixed(3)}`;
    const rec = { d, cx: p[0], cy: p[1], key, hash: ipHash(d.ip || '') };
    if (!groups[key]) { groups[key] = []; keys.push(key); }
    groups[key].push(rec);
  }
  for (let i = 0; i < keys.length; i += 1) {
    const arr = groups[keys[i]];
    arr.sort((a, b) => a.hash - b.hash);
    arr.forEach((item, idx) => { item.clusterIndex = idx; item.clusterSize = arr.length; detailPointCache.push(item); });
  }
}

fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
  .then((r) => r.json())
  .then((world) => {
    document.getElementById('map-loader').style.display = 'none';
    const svg = d3.select('#mapsvg');
    mapG = svg.append('g').attr('id', 'map-g');
    const countries = topojson.feature(world, world.objects.countries);
    countryFeatureByIso2 = {};
    const N3_TO_ISO2 = {};
    Object.keys(ISO2_TO_N3).forEach((iso2) => { N3_TO_ISO2[ISO2_TO_N3[iso2]] = iso2; });
    countries.features.forEach((f) => {
      const iso2 = N3_TO_ISO2[Number(f.id)];
      if (iso2) countryFeatureByIso2[iso2] = f;
    });
    worldLandFeature = world.objects.land
      ? topojson.feature(world, world.objects.land)
      : { type: 'FeatureCollection', features: countries.features };
    ipGeoCache = {};
    if (D.length > 0) rebuildDetailPointCache();
    mapG.append('g').selectAll('path').data(countries.features).join('path')
      .attr('class', 'country').attr('d', pathGen);
    mapG.append('path')
      .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
      .attr('fill', 'none').attr('stroke', '#1c3d58').attr('stroke-width', '.4').attr('d', pathGen);
    const zoom = d3.zoom().scaleExtent([1, 24])
      .on('zoom', (e) => { mapG.attr('transform', e.transform); updateZoomPct(e.transform.k); })
      .on('end', (e) => { currentZoomK = e.transform.k; drawMapOverlay(); });
    svg.call(zoom);
    mapZoomSvg = svg; mapZoomBehavior = zoom;
    updateZoomPct(1);
    const btns = document.querySelectorAll('#map-ctl button');
    function applyZoom(fn) {
      const t = d3.zoomTransform(svg.node());
      zoom.transform(svg, fn(t));
      currentZoomK = d3.zoomTransform(svg.node()).k;
      updateZoomPct(currentZoomK);
      drawMapOverlay();
    }
    function applyPan(dx, dy) {
      const t = d3.zoomTransform(svg.node());
      const s = t.k;
      zoom.translateBy(svg, dx / s, dy / s);
      currentZoomK = d3.zoomTransform(svg.node()).k;
      updateZoomPct(currentZoomK);
      drawMapOverlay();
    }
    if (btns.length >= 6) {
      btns[0].onclick = () => applyZoom((t) => t.scale(t.k * 1.3));
      btns[1].onclick = () => applyZoom((t) => t.scale(t.k / 1.3));
      btns[2].onclick = () => applyPan(0, 60);
      btns[3].onclick = () => applyPan(0, -60);
      btns[4].onclick = () => applyPan(-60, 0);
      btns[5].onclick = () => applyPan(60, 0);
    }
    if (D.length > 0) drawMapOverlay();
  })
  .catch(() => { document.getElementById('map-loader').textContent = 'Erreur carte'; });

function getByCountry() {
  const bc = {};
  D.forEach((d) => {
    const c = d.country || 'Unknown';
    bc[c] = (bc[c] || 0) + 1;
  });
  return bc;
}

function drawMapOverlay() {
  const g = mapG || d3.select('#map-g');
  if (g.empty()) return;
  g.selectAll('.atk-line,.adot,.vdot').remove();
  if (!D.length) return;
  const k = currentZoomK || 1;
  const invK = 1 / Math.max(k, 1);
  const vp = projection([VPS.lon, VPS.lat]);
  const vx = vp[0];
  const vy = vp[1];

  if (k < 2) {
    const bc = getByCountry();
    const sorted = Object.entries(bc).sort((a, b) => b[1] - a[1]);
    const maxC = sorted[0] ? sorted[0][1] : 1;
    sorted.forEach((entry, i) => {
      const c = entry[0];
      const cnt = entry[1];
      const co = CC[c];
      if (!co || c === 'Unknown') return;
      const ap = projection(co);
      if (!ap) return;
      const ax = ap[0];
      const ay = ap[1];
      if (Math.abs(ax - vx) < 15 && Math.abs(ay - vy) < 15) return;
      const mx = (ax + vx) / 2;
      const my = Math.min(ay, vy) - 50 - (cnt / maxC) * 60;
      g.append('path').attr('class', 'atk-line')
        .attr('d', `M${ax},${ay} Q${mx},${my} ${vx},${vy}`)
        .style('stroke-width', (0.9 * invK).toFixed(3))
        .style('animation-delay', `${i * 0.05}s`);
    });
    sorted.forEach((entry) => {
      const c = entry[0];
      const cnt = entry[1];
      const co = CC[c];
      if (!co || c === 'Unknown') return;
      const cp = projection(co);
      if (!cp) return;
      const cx = cp[0];
      const cy = cp[1];
      const r = Math.max(3.2 * invK, Math.sqrt(cnt) * 1.7 * invK);
      const screenR = r * k;
      const big = cnt > D.length * 0.08;
      const dot = g.append('g').attr('class', big ? 'adot big' : 'adot');
      dot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r + 2 * invK).attr('class', 'rng');
      dot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r).attr('class', 'm');
      if (screenR > 12) {
        dot.append('text').attr('x', cx + r + 2).attr('y', cy + 2).attr('class', 'dlbl')
          .attr('fill', big ? 'var(--w)' : 'var(--tx)').attr('font-size', 7 * invK).text(`${c}(${cnt})`);
      }
      dot.on('mouseenter', (e) => showCountryTip(e, c, cnt))
        .on('mousemove', moveTip).on('mouseleave', hideTip);
    });
  } else {
    if (!detailPointCache.length) rebuildDetailPointCache();
    const maxDots = (k < 4) ? 1200 : ((k < 8) ? 3000 : 7000);
    const step = Math.max(1, Math.ceil(detailPointCache.length / Math.max(1, maxDots)));
    const zoomSpreadBoost = Math.min(22, Math.max(1, (k - 1) * 1.2));
    const drawItems = [];
    for (let pi = 0; pi < detailPointCache.length; pi += step) {
      const rec = detailPointCache[pi];
      const n = rec.clusterSize || 1;
      const idx = (rec.clusterIndex === undefined) ? 0 : rec.clusterIndex;
      let cx = rec.cx;
      let cy = rec.cy;
      const ax = rec.cx;
      const ay = rec.cy;

      if (n > 1) {
        const angle = idx * 2.399963229728653;
        let radiusPx = 2.2 * Math.sqrt(idx + 1);
        const clusterBoost = Math.min(90, 8 + Math.sqrt(n) * 5.5);
        radiusPx = Math.min(radiusPx, clusterBoost);
        const spread = radiusPx * zoomSpreadBoost * invK;
        cx += Math.cos(angle) * spread;
        cy += Math.sin(angle) * spread;
      }
      const ipRadius = 0.9 * invK;
      drawItems.push({ d: rec.d, x: cx, y: cy, ax, ay, r: ipRadius });
    }

    const minScreenDist = Math.min(16, 2.5 + k * 0.9);
    const minDist = minScreenDist * invK;
    const cellSize = Math.max(minDist * 1.8, 0.2 * invK);
    for (let it = 0; it < 3; it += 1) {
      const grid = {};
      drawItems.forEach((p) => {
        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        const gk = `${gx}:${gy}`;
        if (!grid[gk]) grid[gk] = [];
        grid[gk].push(p);
      });
      drawItems.forEach((p) => {
        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const arr = grid[`${gx + ox}:${gy + oy}`];
            if (!arr) continue;
            arr.forEach((q) => {
              if (p === q) return;
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
              if (dist >= minDist) return;
              const push = (minDist - dist) * 0.48;
              const ux = dx / dist;
              const uy = dy / dist;
              p.x += ux * push;
              p.y += uy * push;
            });
          }
        }
        p.x += (p.ax - p.x) * 0.08;
        p.y += (p.ay - p.y) * 0.08;
      });
    }

    drawItems.forEach((item) => {
      const dot = g.append('g').attr('class', 'adot');
      dot.append('circle').attr('cx', item.x).attr('cy', item.y).attr('r', item.r).attr('class', 'm');
      dot.on('mouseenter', (e) => showPointTip(e, item.d))
        .on('mousemove', moveTip).on('mouseleave', hideTip);
    });
  }

  const vg = g.append('g').attr('class', 'vdot');
  vg.append('circle').attr('cx', vx).attr('cy', vy).attr('r', 6 * invK).attr('class', 'rng').style('animation', 'none');
  vg.append('circle').attr('cx', vx).attr('cy', vy).attr('r', 3.4 * invK).attr('class', 'm');
  if (k < 3) vg.append('text').attr('x', vx + 6 * invK).attr('y', vy - 6 * invK).attr('class', 'vlbl').attr('font-size', 6 * invK).text('VPS');
}

function loadJSON(data) {
  D = data;
  setData(data);
  rebuildDetailPointCache();
  updateHeader();
  drawMapOverlay();
  renderStats();
  renderIPTable();
  if (document.getElementById('panel-graph').classList.contains('active')) renderGraph();
}

function loadCSV(txt) {
  parseCSV(txt, loadJSON);
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

loadInitialData(loadJSON);
