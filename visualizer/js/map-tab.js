import { CC, ISO2_TO_N3, VPS, W, H } from './constants.js';
import { state, getByCountry } from './state.js';
import { showCountryTip, showPointTip, moveTip, hideTip } from './tooltip.js';

let projection = d3.geoMercator().scale(153).translate([W / 2, H / 2 + 60]).center([0, 20]);
let pathGen = d3.geoPath().projection(projection);

let mapG;
let currentZoomK = 1;
let worldLandFeature = null;
let ipGeoCache = {};
let countryFeatureByIso2 = {};
let detailPointCache = [];

function updateZoomPct(k) {
  const el = document.getElementById('zoom-pct');
  if (el) el.textContent = `${Math.round((k || 1) * 100)}%`;
}

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

function hasValidLatLon(d) {
  return d && Number.isFinite(d.lat) && Number.isFinite(d.lon)
    && d.lat >= -90 && d.lat <= 90 && d.lon >= -180 && d.lon <= 180;
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

function rebuildDetailPointCache() {
  const groups = {};
  const keys = [];
  detailPointCache = [];
  for (let i = 0; i < state.D.length; i += 1) {
    const d = state.D[i];
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

export function onDataChanged() {
  rebuildDetailPointCache();
  drawMapOverlay();
}

export function drawMapOverlay() {
  const g = mapG || d3.select('#map-g');
  if (g.empty()) return;
  g.selectAll('.atk-line,.adot,.vdot').remove();
  if (!state.D.length) return;
  const k = currentZoomK || 1;
  const invK = 1 / Math.max(k, 1);
  const vp = projection([VPS.lon, VPS.lat]);
  const vx = vp[0];
  const vy = vp[1];

  if (k < 2) {
    const bc = getByCountry(state.D);
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
      const big = cnt > state.D.length * 0.08;
      const dot = g.append('g').attr('class', big ? 'adot big' : 'adot');
      dot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r + 2 * invK).attr('class', 'rng');
      dot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r).attr('class', 'm');
      const iconScale = (2 * r) / 24;
      dot.append('g').attr('class', 'atk-icon').attr('transform', `translate(${cx},${cy}) scale(${iconScale}) translate(-12,-12)`)
        .append('use').attr('href', '#attacker-icon').attr('x', 0).attr('y', 0).attr('width', 24).attr('height', 24);
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
      const iconScale = (2 * item.r) / 24;
      dot.append('g').attr('class', 'atk-icon').attr('transform', `translate(${item.x},${item.y}) scale(${iconScale}) translate(-12,-12)`)
        .append('use').attr('href', '#attacker-icon').attr('x', 0).attr('y', 0).attr('width', 24).attr('height', 24);
      dot.on('mouseenter', (e) => showPointTip(e, item.d))
        .on('mousemove', moveTip).on('mouseleave', hideTip);
    });
  }

  const vg = g.append('g').attr('class', 'vdot');
  vg.append('circle').attr('cx', vx).attr('cy', vy).attr('r', 6 * invK).attr('class', 'rng').style('animation', 'none');
  vg.append('circle').attr('cx', vx).attr('cy', vy).attr('r', 3.4 * invK).attr('class', 'm');
  if (k < 3) vg.append('text').attr('x', vx + 6 * invK).attr('y', vy - 6 * invK).attr('class', 'vlbl').attr('font-size', 6 * invK).text('VPS');
}

export function initMap() {
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
      if (state.D.length > 0) rebuildDetailPointCache();
      mapG.append('g').selectAll('path').data(countries.features).join('path')
        .attr('class', 'country').attr('d', pathGen);
      mapG.append('path')
        .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
        .attr('fill', 'none').attr('stroke', '#1c3d58').attr('stroke-width', '.4').attr('d', pathGen);
      const zoom = d3.zoom().scaleExtent([1, 24])
        .on('zoom', (e) => { mapG.attr('transform', e.transform); updateZoomPct(e.transform.k); })
        .on('end', (e) => { currentZoomK = e.transform.k; drawMapOverlay(); });
      svg.call(zoom);
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
      if (state.D.length > 0) drawMapOverlay();
    })
    .catch(() => { document.getElementById('map-loader').textContent = 'Erreur carte'; });
}
