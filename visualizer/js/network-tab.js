import { GRAPH_TOP_ATTACKERS_LIMIT } from './constants.js';
import { state } from './state.js';
import { showTip, moveTip, hideTip } from './tooltip.js';

let sim = null;

function attackerScore(d) {
  return (d.vuln_high || 0) * 100 + (d.nikto ? 35 : 0) + (d.nmap ? 20 : 0) + (d.screenshot ? 8 : 0) + (d.dns ? 5 : 0);
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

export function resetSim() {
  if (sim) sim.alpha(1).restart();
}
