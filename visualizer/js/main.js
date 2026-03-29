import { state, setData, getByCountry } from './state.js';
import { loadInitialData, loadCSV as parseCSV, runRegenerateAndReload } from './data-loader.js';
import { initMap, onDataChanged } from './map-tab.js';
import { renderGraph, resetSim, exportNetworkGraphPng } from './network-tab.js';
import { renderStats } from './stats-tab.js';
import { renderIPTable, exportIPsJson } from './ips-tab.js';
import { initSonde } from './sonde-tab.js';
import { initAudit } from './audit-tab.js';
import { initLab } from './lab-tab.js';
import { syncHeaderContextFeed } from './header-context-feed.js';

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
  syncHeaderContextFeed();
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
  const labels = { nmap: 'Rapport Nmap', dns: 'Rapport DNS', nikto: 'Rapport Nikto', traceroute: 'Traceroute', screenshot: 'Capture d\'écran', vuln: 'Vulnérabilités' };
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
  if (type === 'vuln') {
    const url = `/data/screenshotAndLog/${encodeURIComponent(ip)}/nmap`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('nmap missing');
        return r.text();
      })
      .then((data) => {
        if (!data) return;
        const entries = extractVulnEntriesFromNmap(data);
        if (!entries.length) {
          bodyEl.innerHTML = '<span class="ip-modal-loading">Aucune vulnérabilité trouvée.</span>';
          return;
        }
        // lookup côté serveur (la clé Vulners reste sur le VPS)
        fetch('/api/vulners/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: entries.map((e) => e.id) }),
        })
          .then((r) => (r.ok ? r.json() : { details: {} }))
          .then((res) => renderVulns(bodyEl, entries, (res && res.details) || {}))
          .catch(() => renderVulns(bodyEl, entries, {}));
      })
      .catch(() => {
        bodyEl.innerHTML = '<span class="ip-modal-loading">Rapport nmap introuvable.</span>';
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
      const html = linkifyTextPreservingSafety(data);
      bodyEl.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-all">${html}</pre>`;
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

function linkifyTextPreservingSafety(text) {
  if (!text) return '';
  const re = /https?:\/\/[^\s<>"']+/g;
  let out = '';
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const raw = m[0];
    out += escapeHtml(text.slice(last, start));
    // Retire la ponctuation finale fréquente, sans casser le href
    const trimmed = raw.replace(/[)\],.;:!?]+$/g, '');
    const trailing = raw.slice(trimmed.length);
    const href = encodeURI(trimmed);
    const display = escapeHtml(trimmed);
    out += `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:var(--a);text-decoration:none">${display} 🔗</a>${escapeHtml(trailing)}`;
    last = start + raw.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function extractVulnEntriesFromNmap(data) {
  const entries = [];
  const seen = new Set();
  const lines = data.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // ID  score  url (format vulners)
    const m = line.match(/([A-Z0-9][A-Z0-9:_\-]+)\s+([\d.]+)\s+(https?:\/\/\S+)/);
    if (!m) continue;
    const id = m[1];
    const score = Number.parseFloat(m[2]);
    const url = m[3];
    if (!id || Number.isNaN(score) || !url) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, score, url });
  }
  entries.sort((a, b) => b.score - a.score);
  return entries;
}

function renderVulns(bodyEl, entries, details) {
  const html = entries.map((e) => {
    const score = e.score;
    const color = score >= 9.0 ? 'var(--a2)' : score >= 7.0 ? 'var(--w)' : 'var(--a3)';
    const icon = score >= 9.0 ? '🔴' : score >= 7.0 ? '🟡' : '🟢';
    const descTxt = (details && details[e.id]) ? String(details[e.id]) : '';
    const desc = descTxt ? `<div style="color:var(--mu);font-size:.68rem;margin:2px 0 4px">${escapeHtml(descTxt)}</div>` : '';
    return `
      <div style="border-bottom:1px solid var(--b);padding:8px 0">
        <div style="display:flex;align-items:center;gap:8px">
          <span>${icon}</span>
          <span style="color:${color};font-weight:bold">${escapeHtml(e.id)}</span>
          <span style="color:var(--mu);font-size:.7rem">Score: ${e.score}</span>
        </div>
        ${desc}
        <a href="${encodeURI(e.url)}" target="_blank" rel="noopener noreferrer"
           style="color:var(--a);font-size:.68rem;text-decoration:none">
          ${escapeHtml(e.url)} 🔗
        </a>
      </div>`;
  }).join('');
  bodyEl.innerHTML = `<div style="padding:4px 0">${html}</div>`;
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
    syncHeaderContextFeed();
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
window.exportNetworkGraphPng = exportNetworkGraphPng;
window.exportIPsJson = exportIPsJson;
window.loadCSV = loadCSV;
window.regenerateDashboardData = () => runRegenerateAndReload(loadJSON);

document.getElementById('btn-regenerate-data')?.addEventListener('click', () => {
  runRegenerateAndReload(loadJSON);
});
document.getElementById('btn-export-ips-json')?.addEventListener('click', () => exportIPsJson());

document.getElementById('graph-export-png')?.addEventListener('click', () => exportNetworkGraphPng());
document.getElementById('graph-export-png-global')?.addEventListener('click', () => exportNetworkGraphPng({ mode: 'global' }));
document.getElementById('graph-reset-sim')?.addEventListener('click', () => resetSim());

fetch('/api/vulners/status')
  .then((r) => r.json())
  .then((res) => {
    const dot = document.getElementById('vulners-dot');
    if (dot) {
      const configured = !!res.configured;
      dot.style.color = configured ? 'var(--a3)' : 'var(--a2)';
      dot.title = configured ? 'Clé API Vulners configurée' : 'Clé API Vulners manquante';
    }
  })
  .catch(() => {});

// Feed "debug" côté UI : montre si le backend reçoit/répond aux lookups
// (sans jamais exposer de clé, ni de token)
{
  const feedLines = document.getElementById('vulners-feed-lines');
  let lastId = 0;

  function pushLine(ev) {
    if (!feedLines) return;
    const ts = ev && ev.ts ? new Date(ev.ts * 1000) : null;
    const tsStr = ts ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const configured = ev && ev.configured ? 'key=OK' : 'key=missing';

    let text = '';
    if (ev.type === 'lookup_start') {
      text = `LOOKUP_START ids=${ev.ids_count || 0} ${configured} v=${ev.server_version || '?'}`;
    } else if (ev.type === 'lookup_ok') {
      text = `LOOKUP_OK ids=${ev.ids_count || 0} docs=${ev.docs_count || 0} ${configured} v=${ev.server_version || '?'}`;
    } else if (ev.type === 'lookup_skip_no_key') {
      text = `LOOKUP_SKIP no-key ids=${ev.ids_count || 0} v=${ev.server_version || '?'}`;
    } else if (ev.type === 'lookup_error') {
      text = `LOOKUP_ERROR ids=${ev.ids_count || 0} err=${ev.error || 'unknown'} ${configured} v=${ev.server_version || '?'}`;
    } else {
      text = `${ev.type || 'event'} ${configured} v=${ev.server_version || '?'}`;
    }

    const row = document.createElement('div');
    row.className = 'vf-row';
    row.title = text;
    row.innerHTML = `<span class="vf-ts">${escapeHtml(tsStr)}</span>${escapeHtml(text)}`;
    feedLines.appendChild(row);
    if (document.querySelector('.tab.active')?.dataset?.tab === 'stats') {
      feedLines.scrollTop = feedLines.scrollHeight;
    }

    // Petit bonus : quand ça marche/échoue, on met aussi l'indicateur en conséquence.
    const dot = document.getElementById('vulners-dot');
    if (dot) {
      if (ev.type === 'lookup_ok') dot.style.color = 'var(--a3)';
      if (ev.type === 'lookup_error') dot.style.color = 'var(--a2)';
    }
  }

  function refreshFeed() {
    fetch('/api/vulners/events')
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        const events = (res && res.events) ? res.events : [];
        events.forEach((ev) => {
          if (!ev || typeof ev.id !== 'number') return;
          if (ev.id <= lastId) return;
          lastId = ev.id;
          pushLine(ev);
        });
      })
      .catch(() => {});
  }

  refreshFeed();
  setInterval(refreshFeed, 1200);
}

initMap();
initSonde();
initAudit();
initLab();
syncHeaderContextFeed();
loadInitialData(loadJSON);
