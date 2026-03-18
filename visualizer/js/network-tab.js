import { GRAPH_TOP_ATTACKERS_LIMIT } from './constants.js';
import { state } from './state.js';
import { showPointTip, moveTip, hideTip } from './tooltip.js';

let sim = null;

const POS_KEY = 'honeypot-network-positions-v1';

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
  const nodeIds = new Set(['VPS']);
  top.forEach((d) => {
    if (!nodeIds.has(d.ip)) {
      nodes.push({
        id: d.ip,
        type: 'atk',
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
        if (!nodeIds.has(hopIp)) {
          nodes.push({ id: hopIp, type: 'hop' });
          nodeIds.add(hopIp);
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
  node.append('circle').attr('r', (d) => (d.type === 'vps' ? 17 : d.type === 'hop' ? 4 : (d.vuln > 0 ? 8 : 5)));
  node.append('text').attr('class', (d) => (d.type === 'vps' ? 'nl vp' : 'nl'))
    .attr('dx', (d) => (d.type === 'vps' ? -12 : 12))
    .attr('dy', (d) => (d.type === 'vps' ? -22 : d.type === 'hop' ? 0 : 4))
    .text((d) => (d.type === 'vps' ? '🍯 VPS' : d.type === 'hop' ? '' : d.id));
  node.filter((d) => d.type === 'atk')
    .on('mouseenter', (e, d) => showPointTip(e, {
      ip: d.id,
      country: d.country || 'Unknown',
      vuln_high: d.vuln || 0,
      ports: d.ports || '',
      nmap: !!d.nmap,
      dns: !!d.dns,
      screenshot: !!d.screenshot,
      nikto: !!d.nikto,
      traceroute: !!d.traceroute,
    }))
    .on('mousemove', moveTip).on('mouseleave', hideTip);
  node.filter((d) => d.type === 'hop')
    .on('mouseenter', (e, d) => showPointTip(e, {
      ip: d.id,
      country: '',
      vuln_high: 0,
      ports: 'Relais traceroute',
      nmap: false,
      dns: false,
      screenshot: false,
      nikto: false,
      traceroute: true,
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
}

export function resetSim() {
  if (sim) sim.alpha(1).restart();
}
