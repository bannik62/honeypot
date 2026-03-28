import { GRAPH_TOP_ATTACKERS_LIMIT } from './constants.js';
import { state } from './state.js';
import { showPointTip, moveTip, hideTip } from './tooltip.js';
import { syncHeaderContextFeed } from './header-context-feed.js';

let sim = null;

const POS_KEY = 'honeypot-network-positions-v1';

/** Icône PNG des nœuds attaquants (chemin relatif à la page du dashboard). */
const GRAPH_ATK_ICON = 'img/pirate.png';

function loadSavedPositions() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Impossible de lire les positions réseau depuis localStorage', e);
  }
  return null;
}

function savePositions(nodes) {
  try {
    const out = {};
    nodes.forEach((n) => {
      if (typeof n.x === 'number' && typeof n.y === 'number') {
        out[n.id] = { x: n.x, y: n.y };
      }
    });
    localStorage.setItem(POS_KEY, JSON.stringify(out));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Impossible de sauvegarder les positions réseau dans localStorage', e);
  }
}

function attackerScore(d) {
  return (d.vuln_high || 0) * 100 + (d.nikto ? 35 : 0) + (d.nmap ? 20 : 0) + (d.screenshot ? 8 : 0) + (d.dns ? 5 : 0) + (d.traceroute ? 3 : 0);
}

/** Pour le graphe réseau : une IP avec traceroute (hops) doit être prioritaire, sinon le "top" est souvent full vulns sans chemin → étoile IP→VPS sans routeurs. */
function hasTracerouteHops(d) {
  return Array.isArray(d.hops) && d.hops.length > 0;
}

function hopCount(d) {
  return Array.isArray(d.hops) ? d.hops.length : 0;
}

export function renderGraph() {
  const D = state.D;
  const wrap = document.getElementById('gwrap');
  const W2 = wrap ? wrap.clientWidth || 360 : 360;
  const H2 = wrap ? wrap.clientHeight || 400 : 400;
  const svg = d3.select('#gsvg');
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${W2} ${H2}`);
  svg.append('defs').append('marker').attr('id', 'arr')
    .attr('viewBox', '0 -5 10 10').attr('refX', 15).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-5L10,0L0,5').attr('class', 'ah');

  const zoomGroup = svg.append('g');

  const top = D.slice().sort((a, b) => {
    const ha = hasTracerouteHops(a);
    const hb = hasTracerouteHops(b);
    if (ha !== hb) return hb ? 1 : -1; // ceux avec hops en premier
    const hc = hopCount(b) - hopCount(a);
    if (hc !== 0) return hc;
    const s = attackerScore(b) - attackerScore(a);
    if (s !== 0) return s;
    const v = (b.vuln_high || 0) - (a.vuln_high || 0);
    if (v !== 0) return v;
    return (a.ip || '').localeCompare(b.ip || '');
  }).slice(0, GRAPH_TOP_ATTACKERS_LIMIT);

  const gm = document.getElementById('graph-meta');
  if (gm) gm.textContent = `Réseau: ${top.length.toLocaleString()} / ${D.length.toLocaleString()} (top attaquants)`;
  if (!top.length) {
    syncHeaderContextFeed();
    return;
  }

  // Fallback "Pays" pour les hops : si `hop_countries` n'est pas encore présent dans `data.json`,
  // on récupère le pays depuis l'objet principal `D` (pour chaque IP).
  const countryByIp = new Map();
  if (Array.isArray(D)) {
    D.forEach((x) => {
      if (x && typeof x.ip === 'string' && x.ip.trim()) countryByIp.set(x.ip, x.country || 'Unknown');
    });
  }

  const nodes = [{ id: 'VPS', type: 'vps' }];
  const links = [];
  const nodeIds = new Set(['VPS']);
  const nodeById = new Map([['VPS', nodes[0]]]);
  top.forEach((d) => {
    if (!nodeIds.has(d.ip)) {
      nodes.push({
        id: d.ip,
        type: 'atk',
        name: (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : undefined,
        country: d.country,
        vuln: d.vuln_high,
        ports: d.ports,
        nmap: d.nmap,
        dns: d.dns,
        screenshot: d.screenshot,
        nikto: d.nikto,
        traceroute: d.traceroute,
      });
      nodeIds.add(d.ip);
    }
    let hops = Array.isArray(d.hops) ? d.hops : [];
    if (hops.length > 0) {
      const deduped = [];
      let prev = null;
      hops.forEach((h) => { if (h !== prev) { deduped.push(h); prev = h; } });
      hops = deduped;
      hops.forEach((hopIp) => {
        const hasHopNamesObj = d.hop_names && typeof d.hop_names === 'object';
        const hopNameRaw = hasHopNamesObj ? d.hop_names[hopIp] : undefined;
        const hopName = (typeof hopNameRaw === 'string' && hopNameRaw.trim()) ? hopNameRaw.trim() : undefined;

        const hasHopCountriesObj = d.hop_countries && typeof d.hop_countries === 'object';
        const hopCountryRaw = hasHopCountriesObj ? d.hop_countries[hopIp] : undefined;
        const hopCountry = (typeof hopCountryRaw === 'string' && hopCountryRaw.trim())
          ? hopCountryRaw.trim()
          : (countryByIp.get(hopIp) || undefined);

        if (!nodeIds.has(hopIp)) {
          const newNode = { id: hopIp, type: 'hop', name: hopName, country: hopCountry };
          nodes.push(newNode);
          nodeById.set(hopIp, newNode);
          nodeIds.add(hopIp);
        } else {
          // Mettre à jour le noeud hop si une info (name/country) manque
          const existing = nodeById.get(hopIp);
          if (existing) {
            if (!existing.name && hopName) existing.name = hopName;
            if ((!existing.country || existing.country === 'Unknown') && hopCountry) existing.country = hopCountry;
          }
        }
      });
      // Toujours dans le sens attaquant -> VPS
      links.push({ source: d.ip, target: hops[hops.length - 1], hot: d.vuln_high > 0 });
      for (let i = hops.length - 1; i > 0; i -= 1) {
        links.push({ source: hops[i], target: hops[i - 1], hot: false });
      }
      links.push({ source: hops[0], target: 'VPS', hot: false });
    } else {
      links.push({ source: d.ip, target: 'VPS', hot: d.vuln_high > 0 });
    }
  });

  const savedPos = loadSavedPositions();
  if (savedPos) {
    nodes.forEach((n) => {
      const sp = savedPos[n.id];
      if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
        n.x = sp.x;
        n.y = sp.y;
      }
    });
  }

  if (sim) {
    sim.stop();
    sim.on('tick', null).on('end', null);
  }
  sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-55))
    .force('center', d3.forceCenter(W2 / 2, H2 / 2))
    .force('collide', d3.forceCollide().radius(20));

  const edge = zoomGroup.append('g').selectAll('line').data(links).join('line')
    .attr('class', (d) => `edge${d.hot ? ' hot' : ''}`)
    .attr('marker-end', 'url(#arr)');
  const node = zoomGroup.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', (d) => (d.type === 'vps' ? 'nv' : d.type === 'hop' ? 'na nh' : 'na'))
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.x; d.fy = d.y; }));
  svg.call(d3.zoom()
    .scaleExtent([0.2, 4])
    .filter((event) => !event.target.closest('.na') && !event.target.closest('.nv'))
    .on('zoom', (event) => zoomGroup.attr('transform', event.transform)));
  const atkIconPx = (d) => ((d.vuln || 0) > 0 ? 22 : 18);
  node.filter((d) => d.type === 'vps' || d.type === 'hop').append('circle')
    .attr('r', (d) => (d.type === 'vps' ? 17 : 4));
  node.filter((d) => d.type === 'atk').append('image')
    .attr('class', 'graph-atk-icon')
    .attr('href', GRAPH_ATK_ICON)
    .attr('width', atkIconPx)
    .attr('height', atkIconPx)
    .attr('x', (d) => -atkIconPx(d) / 2)
    .attr('y', (d) => -atkIconPx(d) / 2);
  node.append('text').attr('class', (d) => (d.type === 'vps' ? 'nl vp' : 'nl'))
    .attr('dx', (d) => (d.type === 'vps' ? -12 : 12))
    .attr('dy', (d) => (d.type === 'vps' ? -22 : d.type === 'hop' ? 0 : 4))
    // Les hops traceroute représentent des "routeurs intermédiaires" : on affiche au moins leur IP.
    .text((d) => (d.type === 'vps' ? '🍯 VPS' : d.type === 'hop' ? d.id : d.id));
  node.filter((d) => d.type === 'atk')
    .on('mouseenter', (e, d) => showPointTip(e, {
      ip: d.id,
      name: d.name,
      country: d.country || 'Unknown',
      vuln_high: d.vuln || 0,
      ports: d.ports || '',
      nmap: !!d.nmap,
      dns: !!d.dns,
      screenshot: !!d.screenshot,
      nikto: !!d.nikto,
      traceroute: !!d.traceroute,
      nodeType: 'atk',
    }))
    .on('mousemove', moveTip).on('mouseleave', hideTip);
  node.filter((d) => d.type === 'hop')
    .on('mouseenter', (e, d) => showPointTip(e, {
      ip: d.id,
      name: d.name,
      country: d.country || 'Unknown',
      vuln_high: 0,
      ports: 'Relais traceroute',
      nmap: false,
      dns: false,
      screenshot: false,
      nikto: false,
      traceroute: true,
      nodeType: 'hop',
    }))
    .on('mousemove', moveTip).on('mouseleave', hideTip);
  sim.on('tick', () => {
    edge.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  });

  sim.on('end', () => {
    savePositions(nodes);
  });
  syncHeaderContextFeed();
}

export function resetSim() {
  if (sim) sim.alpha(1).restart();
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const EXPORT_STYLE = (a2, a3, tx, mu) => `
    svg { font-family: "Share Tech Mono", "DejaVu Sans Mono", monospace; }
    .nv circle { fill: ${a3}; filter: drop-shadow(0 0 6px ${a3}); }
    .na.nh circle { fill: ${mu}; opacity: 0.75; }
    .na:not(.nh) .graph-atk-icon { opacity: 0.9; }
    .nl { fill: ${tx}; font-family: "Share Tech Mono", "DejaVu Sans Mono", monospace; font-size: 10px; }
    .nl.vp { fill: ${a3}; font-family: Orbitron, "DejaVu Sans", sans-serif; font-weight: 700; font-size: 11px; }
    .edge { stroke: ${a2}; stroke-opacity: 0.38; fill: none; }
    .edge.hot { stroke-opacity: 0.58; }
    .ah { fill: ${a2}; }
  `;

function findGraphZoomGroup(svg) {
  return Array.from(svg.children).find((el) => el.tagName === 'g') || null;
}

/**
 * @param {{ mode?: 'viewport' | 'global' }} [opts]
 * - viewport : PNG de la zone visible (zoom / pan inclus), comme à l’écran.
 * - global : reset du transform sur le clone + viewBox sur tout le graphe (marges).
 */
export function exportNetworkGraphPng(opts = {}) {
  const mode = opts.mode === 'global' ? 'global' : 'viewport';
  const svgEl = document.getElementById('gsvg');
  const wrap = document.getElementById('gwrap');
  if (!svgEl || !wrap) return;
  const lineCount = svgEl.querySelectorAll('line').length;
  if (lineCount === 0) {
    window.alert('Aucun graphe à exporter — charge des données et ouvre l’onglet Réseau.');
    return;
  }

  const W2 = wrap.clientWidth || 360;
  const H2 = wrap.clientHeight || 400;
  const pixelScale = 2;
  const svgNS = 'http://www.w3.org/2000/svg';

  const a2 = cssVar('--a2', '#ff3e6c');
  const a3 = cssVar('--a3', '#39ff14');
  const tx = cssVar('--tx', '#c8e6ff');
  const mu = cssVar('--mu', '#4a7a9b');
  const bg = cssVar('--s', '#0a1520');

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', svgNS);

  let defs = clone.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(svgNS, 'defs');
    clone.insertBefore(defs, clone.firstChild);
  }
  const styleEl = document.createElementNS(svgNS, 'style');
  styleEl.setAttribute('type', 'text/css');
  styleEl.textContent = EXPORT_STYLE(a2, a3, tx, mu);
  defs.appendChild(styleEl);

  let outW;
  let outH;

  if (mode === 'global') {
    const zoomG = findGraphZoomGroup(clone);
    if (zoomG) zoomG.removeAttribute('transform');

    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none';
    document.body.appendChild(holder);
    clone.setAttribute('width', String(W2));
    clone.setAttribute('height', String(H2));
    holder.appendChild(clone);

    let bbox;
    try {
      bbox = clone.getBBox();
    } catch {
      bbox = null;
    }
    holder.remove();

    if (!bbox || !(bbox.width > 0) || !(bbox.height > 0)) {
      window.alert('Impossible de calculer le cadre du graphe pour l’export « tout le réseau ».');
      return;
    }

    const pad = 64;
    const vbX = bbox.x - pad;
    const vbY = bbox.y - pad;
    const vbW = bbox.width + 2 * pad;
    const vbH = bbox.height + 2 * pad;
    clone.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

    const bgRect = document.createElementNS(svgNS, 'rect');
    bgRect.setAttribute('x', String(vbX));
    bgRect.setAttribute('y', String(vbY));
    bgRect.setAttribute('width', String(vbW));
    bgRect.setAttribute('height', String(vbH));
    bgRect.setAttribute('fill', bg);
    clone.insertBefore(bgRect, clone.firstChild);

    const maxSide = 2800;
    const fit = Math.min(maxSide / vbW, maxSide / vbH, pixelScale * 1.25);
    outW = Math.max(1, Math.round(vbW * fit));
    outH = Math.max(1, Math.round(vbH * fit));
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
  } else {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    outW = Math.round(W2 * pixelScale);
    outH = Math.round(H2 * pixelScale);
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
  }

  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  const svgBlob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>${source}`], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const d = new Date();
      const pad2 = (n) => String(n).padStart(2, '0');
      const tag = mode === 'global' ? 'complet' : 'vue';
      a.download = `honeypot-reseau-${tag}-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    window.alert('Export PNG impossible depuis ce navigateur. Réessaie avec Chromium / Firefox récent.');
  };
  img.src = url;
}
