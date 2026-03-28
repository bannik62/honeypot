/**
 * Bandeau central de l'en-tête : titre explicite + contenu selon l'onglet.
 * Onglet Stats → journal API Vulners ; autres → résumé contextuel (pas de polling).
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate(s, max) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const TITLE = {
  map: 'CARTE — FILTRE & ZOOM',
  graph: 'GRAPHE RÉSEAU (TOP ATTAQUANTS)',
  stats: 'JOURNAL API VULNERS',
  ips: 'LISTE IPs & RAPPORTS',
  sonde: 'SONDE tcpdump (APERÇU)',
  audit: 'AUDIT PARE-FEU & PORTS',
};

function getMapFilterLabel() {
  const sel = document.getElementById('map-filter-cat');
  const opt = sel?.selectedOptions?.[0];
  if (!opt) return 'Filtre : —';
  return `Filtre : ${opt.textContent.trim()}`;
}

function fillContextRows(tab) {
  /** @type {{ text: string, title: string }[]} */
  const rows = [];
  if (tab === 'map') {
    const fl = getMapFilterLabel();
    rows.push({ text: fl, title: fl });
    const z = document.getElementById('zoom-pct')?.textContent?.trim() || '—';
    rows.push({ text: `Zoom : ${z}`, title: `Zoom ${z}` });
    rows.push({
      text: 'Légende : VPS · attaquant · top attaquant',
      title: 'VPS (vert), attaquant (ambre), top attaquant (rouge crimson)',
    });
  } else if (tab === 'graph') {
    const g = document.getElementById('graph-meta')?.textContent?.trim() || 'Réseau : —';
    rows.push({ text: truncate(g, 140), title: g });
  } else if (tab === 'ips') {
    const m = document.getElementById('ip-meta')?.textContent?.trim() || '—';
    rows.push({ text: truncate(m, 140), title: m });
    rows.push({
      text: 'Astuce : cliquer un badge ouvre Nmap, DNS, capture, vulns…',
      title: 'Badges nmap, dns, tr, screenshot, nikto, HIGH',
    });
  } else if (tab === 'sonde') {
    const startBtn = document.getElementById('sonde-start');
    const running = startBtn && startBtn.disabled;
    rows.push({
      text: running ? 'État : capture en cours (SSE)' : 'État : arrêté',
      title: running ? 'Flux EventSource actif' : 'Pas de flux tcpdump',
    });
    const pre = document.getElementById('sonde-log');
    const raw = pre?.textContent || '';
    const lines = raw.split('\n').filter((l) => l.trim()).slice(-4);
    if (!lines.length) {
      rows.push({
        text: 'Journal vide — port + Démarrer, ou vérifier grep/filtre.',
        title: 'Aucune ligne dans #sonde-log',
      });
    } else {
      lines.forEach((line) => {
        rows.push({ text: truncate(line, 118), title: line });
      });
    }
  } else if (tab === 'audit') {
    const ufw = document.getElementById('audit-ufw-status');
    const txt = ufw ? ufw.innerText.replace(/\s+/g, ' ').trim() : '';
    if (!txt) {
      rows.push({
        text: 'En attente — utilisez « Rafraîchir » dans l’onglet Audit.',
        title: 'Bloc UFW non rempli',
      });
    } else {
      rows.push({ text: truncate(txt, 200), title: txt });
    }
    const tbody = document.getElementById('audit-ports-tbody');
    const nPorts = tbody ? tbody.querySelectorAll('tr').length : 0;
    rows.push({
      text: `Tableau ports : ${nPorts} ligne(s)`,
      title: 'Nombre de lignes du tbody ports (inclut message vide)',
    });
  }
  return rows;
}

export function syncHeaderContextFeed() {
  const tab = document.querySelector('.tab.active')?.dataset?.tab || 'map';
  const titleEl = document.getElementById('header-feed-title');
  const vulnPane = document.getElementById('vulners-feed-lines');
  const ctxPane = document.getElementById('header-context-lines');
  const feedWrap = document.getElementById('vulners-feed');
  if (!titleEl || !vulnPane || !ctxPane || !feedWrap) return;

  titleEl.textContent = TITLE[tab] || TITLE.map;
  const showVulners = tab === 'stats';
  vulnPane.hidden = !showVulners;
  ctxPane.hidden = showVulners;

  if (!showVulners) {
    const rows = fillContextRows(tab);
    ctxPane.innerHTML = rows
      .map(
        (r) =>
          `<div class="vf-row" title="${escapeHtml(r.title)}"><span class="vf-ts"></span>${escapeHtml(r.text)}</div>`,
      )
      .join('');
    ctxPane.scrollTop = ctxPane.scrollHeight;
  } else {
    vulnPane.scrollTop = vulnPane.scrollHeight;
    feedWrap.scrollTop = feedWrap.scrollHeight;
  }
}
