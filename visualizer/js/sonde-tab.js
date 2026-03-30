import { syncHeaderContextFeed } from './header-context-feed.js';

/**
 * Onglet Sonde — EventSource SSE vers /api/sonde/stream
 * Garde-fous : le L7 (-A) peut envoyer des Mo/s ; sans limite le navigateur plante.
 */

const MAX_LINES = 800; // lignes max dans le <pre>
const MAX_LINE_CHARS = 480; // tronquer une ligne (payload ASCII)
const LINES_PER_FRAME = 120; // max lignes appliquées par frame (évite blocage UI)

function buildFilterOptions(layer) {
  const sel = document.getElementById('sonde-filter');
  if (!sel) return;
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  if (layer === 'L3') {
    add('all', 'TCP + UDP + ICMP');
    add('tcp', 'TCP seul');
    add('udp', 'UDP seul');
    add('icmp', 'ICMP seul');
  } else if (layer === 'L4') {
    add('syn', 'SYN seul');
    add('fin', 'FIN seul');
    add('rst', 'RST seul');
    add('synfinrst', 'SYN + FIN + RST (tous)');
  } else {
    add('gt50', 'Payload > 50 octets');
    add('gt128', 'Payload > 128 octets');
  }
}

function truncateLine(text) {
  if (text.length <= MAX_LINE_CHARS) return text;
  return `${text.slice(0, MAX_LINE_CHARS)} … [tronqué ${text.length} car.]`;
}

/** Infobulles de secours si l’API renvoie l’ancien format ou est indisponible. */
const IFACE_ROLE_FALLBACK = {
  any:
    'Toutes les interfaces : vue globale, souvent plus de bruit. Utile pour explorer sans choisir une carte.',
  lo:
    'Loopback : trafic 127.0.0.1 sur cet hôte. Pas le trafic Internet direct ; rarement les conteneurs sauf config spéciale.',
  docker0:
    'Bridge Docker par défaut : échanges hôte ↔ conteneurs sur le réseau classique 172.17.x.',
};

function ifaceRoleClientHint(name) {
  if (IFACE_ROLE_FALLBACK[name]) return IFACE_ROLE_FALLBACK[name];
  if (/^ens\d+$/.test(name)) {
    return 'Interface Ethernet (ens…) : souvent carte principale ; sur un VPS, typiquement trafic public (ex. TLS 443).';
  }
  if (/^enp\d+s\d+$/.test(name)) {
    return 'Interface Ethernet (enp…) : LAN/WAN selon la machine.';
  }
  if (/^eth\d+$/.test(name)) return 'Interface Ethernet classique (eth…) : LAN/WAN selon ta configuration.';
  if (/^enx[0-9a-f]{12}$/i.test(name)) return 'Ethernet USB (enx…) : rôle comme une carte filaire selon le branchement.';
  if (/^wlan\d+$/.test(name)) return 'Interface Wi-Fi.';
  if (/^br-[0-9a-f]{12}$/i.test(name)) {
    return 'Bridge Linux : souvent réseau Docker Compose ; trafic conteneurs ou proxy→backend selon ta conf.';
  }
  if (/^veth[a-z0-9]{4,24}$/i.test(name)) {
    return 'Paire hôte ↔ conteneur : le nom seul n’identifie pas le service.';
  }
  if (/^tun\d+$/.test(name)) return 'Tunnel (souvent VPN).';
  if (/^tap\d+$/.test(name)) return 'TAP (VPN ou réseau virtuel).';
  return "Interface réseau : rôle selon ton installation (ip -br link, test tcpdump).";
}

/**
 * @param {unknown} payload — tableau de {name, role} ou de chaînes (ancien format)
 * @returns {{ merged: string[], byName: Map<string, string> }}
 */
function buildIfaceRowsFromPayload(payload) {
  /** @type {{name: string, role: string}[]} */
  let rows = [];
  if (Array.isArray(payload)) {
    if (payload.length && typeof payload[0] === 'object' && payload[0] !== null && 'name' in payload[0]) {
      rows = payload.map((x) => ({
        name: String(x.name),
        role: typeof x.role === 'string' && x.role ? x.role : ifaceRoleClientHint(String(x.name)),
      }));
    } else {
      rows = payload.map((name) => ({
        name: String(name),
        role: ifaceRoleClientHint(String(name)),
      }));
    }
  }
  const byName = new Map(rows.map((r) => [r.name, r.role]));
  ['any', 'lo', 'docker0'].forEach((n) => {
    if (!byName.has(n)) byName.set(n, IFACE_ROLE_FALLBACK[n] || ifaceRoleClientHint(n));
  });
  const merged = [...byName.keys()].sort((a, b) => {
    if (a === 'any') return -1;
    if (b === 'any') return 1;
    return a.localeCompare(b);
  });
  return { merged, byName };
}

function ifaceTriggerLabel(name) {
  return name === 'any' ? 'any ▾' : `${name} ▾`;
}

/**
 * Liste déroulante HTML (pas un &lt;select&gt;) : les infobulles `title` sur chaque ligne
 * s’affichent au survol dans tous les navigateurs courants.
 */
function fillSondeIfaceCombo(hidden, trigger, panel, payload) {
  const { merged, byName } = buildIfaceRowsFromPayload(payload);
  const prev = (hidden.value || 'any').trim() || 'any';
  panel.innerHTML = '';
  merged.forEach((name) => {
    const role = byName.get(name) || ifaceRoleClientHint(name);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    btn.className = 'sonde-iface-opt';
    btn.dataset.name = name;
    btn.textContent = name;
    btn.title = role;
    btn.setAttribute('aria-selected', name === prev ? 'true' : 'false');
    panel.appendChild(btn);
  });
  const chosen = merged.includes(prev) ? prev : 'any';
  hidden.value = chosen;
  const chRole = byName.get(chosen) || ifaceRoleClientHint(chosen);
  trigger.textContent = ifaceTriggerLabel(chosen);
  trigger.title = chRole;
  panel.querySelectorAll('.sonde-iface-opt').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.name === chosen ? 'true' : 'false');
  });
}

/** @type {((e: MouseEvent) => void) | null} */
let sondeIfaceDocClick = null;
/** @type {((e: KeyboardEvent) => void) | null} */
let sondeIfaceKeydown = null;

function setupSondeIfaceCombo(wrap, hidden, trigger, panel) {
  function closePanel() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function openPanel() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function togglePanel() {
    if (panel.hidden) openPanel();
    else closePanel();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.sonde-iface-opt');
    if (!btn) return;
    e.stopPropagation();
    const name = btn.dataset.name || 'any';
    const role = btn.title || ifaceRoleClientHint(name);
    hidden.value = name;
    trigger.textContent = ifaceTriggerLabel(name);
    trigger.title = role;
    panel.querySelectorAll('.sonde-iface-opt').forEach((b) => {
      b.setAttribute('aria-selected', b.dataset.name === name ? 'true' : 'false');
    });
    closePanel();
  });

  if (sondeIfaceDocClick) document.removeEventListener('click', sondeIfaceDocClick);
  sondeIfaceDocClick = (e) => {
    if (!wrap.contains(/** @type {Node} */ (e.target))) closePanel();
  };
  document.addEventListener('click', sondeIfaceDocClick);

  if (sondeIfaceKeydown) document.removeEventListener('keydown', sondeIfaceKeydown);
  sondeIfaceKeydown = (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  };
  document.addEventListener('keydown', sondeIfaceKeydown);
}

function clampTopEntries(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function parseIfaceFromTcpdumpLine(line) {
  // Ex: "13:20:08.283494 lo    In  IP 127.0.0.1.3002 > ..."
  //     "13:20:08.283494 ens3  Out IP ..."
  const m = /^\S+\s+([a-zA-Z0-9._-]+)\s+(In|Out)\s+/.exec(line);
  return m ? m[1] : null;
}

function parsePortsFromTcpdumpLine(line) {
  // IPv4/IPv6: "... IP 127.0.0.1.3002 > 127.0.0.1.53454:" / "... IP6 ... .443 > ... .51515:"
  const m = /\bIP6?\s+[^ ]+\.([0-9]{1,5})\s+>\s+[^ ]+\.([0-9]{1,5})(?::|\s)/.exec(line);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (!(a >= 1 && a <= 65535 && b >= 1 && b <= 65535)) return null;
  return { src: a, dst: b };
}

function renderSondeSummary(summaryEl, ifaceCounts, portCounts) {
  if (!summaryEl) return;
  const ifaceTop = clampTopEntries(ifaceCounts, 7);
  const portTop = clampTopEntries(portCounts, 9);

  if (!ifaceTop.length && !portTop.length) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = '';
    return;
  }

  summaryEl.hidden = false;
  summaryEl.innerHTML = [
    `<div class="sr"><span class="k">Interfaces</span>`,
    ...ifaceTop.map(
      ([name, n]) =>
        `<span class="chip" data-kind="iface" data-value="${name}">${name} <span class="n">${n}</span></span>`,
    ),
    `</div>`,
    `<div class="sr"><span class="k">Ports</span>`,
    ...portTop.map(
      ([p, n]) =>
        `<span class="chip" data-kind="port" data-value="${p}">${p} <span class="n">${n}</span></span>`,
    ),
    `</div>`,
  ].join('');
}

async function loadSondeInterfaces(hidden, trigger, panel) {
  try {
    const r = await fetch('/api/sonde/interfaces');
    const j = await r.json();
    fillSondeIfaceCombo(hidden, trigger, panel, j.interfaces);
  } catch {
    fillSondeIfaceCombo(hidden, trigger, panel, []);
  }
}

export function initSonde() {
  const pre = document.getElementById('sonde-log');
  const startBtn = document.getElementById('sonde-start');
  const stopBtn = document.getElementById('sonde-stop');
  const layerEl = document.getElementById('sonde-layer');
  const portEl = document.getElementById('sonde-port');
  const grepEl = document.getElementById('sonde-grep');
  const exploreEl = document.getElementById('sonde-explore');
  const summaryEl = document.getElementById('sonde-summary');
  const ifaceWrap = document.getElementById('sonde-iface-wrap');
  const ifaceHidden = document.getElementById('sonde-iface-value');
  const ifaceTrigger = document.getElementById('sonde-iface-trigger');
  const ifacePanel = document.getElementById('sonde-iface-panel');
  const ifaceRefresh = document.getElementById('sonde-iface-refresh');
  if (!pre || !startBtn || !stopBtn || !layerEl || !portEl || !grepEl) return;

  /** @type {() => string} */
  let getSondeIface = () => 'any';
  /** @type {(name: string) => void} */
  let setSondeIface = () => {};
  if (ifaceWrap && ifaceHidden && ifaceTrigger && ifacePanel) {
    setupSondeIfaceCombo(ifaceWrap, ifaceHidden, ifaceTrigger, ifacePanel);
    fillSondeIfaceCombo(ifaceHidden, ifaceTrigger, ifacePanel, []);
    loadSondeInterfaces(ifaceHidden, ifaceTrigger, ifacePanel);
    ifaceRefresh?.addEventListener('click', () =>
      loadSondeInterfaces(ifaceHidden, ifaceTrigger, ifacePanel),
    );
    getSondeIface = () => (ifaceHidden.value || 'any').trim() || 'any';
    setSondeIface = (name) => {
      const chosen = String(name || 'any').trim() || 'any';
      ifaceHidden.value = chosen;
      const btn = ifacePanel.querySelector(`.sonde-iface-opt[data-name="${CSS.escape(chosen)}"]`);
      const role = btn?.title || ifaceRoleClientHint(chosen);
      ifaceTrigger.textContent = ifaceTriggerLabel(chosen);
      ifaceTrigger.title = role;
      ifacePanel.querySelectorAll('.sonde-iface-opt').forEach((b) => {
        b.setAttribute('aria-selected', b.dataset.name === chosen ? 'true' : 'false');
      });
    };
  }

  function isExploration() {
    return Boolean(exploreEl?.checked);
  }

  function applyExplorationUiState() {
    const exploring = isExploration();
    if (portEl) {
      portEl.disabled = exploring;
      if (exploring) portEl.title = 'Mode exploration : port désactivé (tous les ports).';
      else portEl.title = 'Port TCP/UDP';
    }
    if (ifaceTrigger) ifaceTrigger.disabled = exploring;
    if (ifaceRefresh) ifaceRefresh.disabled = exploring;
    if (exploring) setSondeIface('any');
  }

  exploreEl?.addEventListener('change', () => {
    applyExplorationUiState();
  });
  applyExplorationUiState();

  let es = null;
  /** @param {boolean} running — true = capture en cours (Arrêter en bleu, Démarrer grisé) */
  function setSondeToggle(running) {
    if (running) {
      startBtn.classList.remove('pri');
      startBtn.classList.add('sonde-muted');
      startBtn.disabled = true;
      stopBtn.classList.remove('sonde-muted');
      stopBtn.classList.add('pri');
      stopBtn.disabled = false;
    } else {
      startBtn.classList.add('pri');
      startBtn.classList.remove('sonde-muted');
      startBtn.disabled = false;
      stopBtn.classList.remove('pri');
      stopBtn.classList.add('sonde-muted');
      stopBtn.disabled = true;
    }
  }

  /** @type {string[]} */
  let ring = [];
  /** @type {string[]} */
  let inbox = [];
  let flushScheduled = false;
  /** @type {Map<string, number>} */
  let ifaceCounts = new Map();
  /** @type {Map<number, number>} */
  let portCounts = new Map();

  function applyRingToDom() {
    while (ring.length > MAX_LINES) ring.shift();
    pre.textContent = ring.join('\n');
    pre.scrollTop = pre.scrollHeight;
  }

  function flushInbox() {
    let n = 0;
    while (inbox.length && n < LINES_PER_FRAME) {
      ring.push(truncateLine(inbox.shift()));
      n += 1;
    }
    applyRingToDom();
    if (inbox.length) {
      requestAnimationFrame(flushInbox);
    } else {
      flushScheduled = false;
      if (document.querySelector('.tab.active')?.dataset?.tab === 'sonde') syncHeaderContextFeed();
    }
  }

  function enqueueLine(text) {
    if (isExploration()) {
      const iface = parseIfaceFromTcpdumpLine(text);
      if (iface) ifaceCounts.set(iface, (ifaceCounts.get(iface) || 0) + 1);
      const ports = parsePortsFromTcpdumpLine(text);
      if (ports) {
        portCounts.set(ports.src, (portCounts.get(ports.src) || 0) + 1);
        portCounts.set(ports.dst, (portCounts.get(ports.dst) || 0) + 1);
      }
      renderSondeSummary(summaryEl, ifaceCounts, portCounts);
    }
    inbox.push(text);
    if (!flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flushInbox);
    }
  }

  function appendLineSync(text) {
    ring.push(truncateLine(text));
    applyRingToDom();
    if (document.querySelector('.tab.active')?.dataset?.tab === 'sonde') syncHeaderContextFeed();
  }

  function resetLog() {
    ring = [];
    inbox = [];
    flushScheduled = false;
    pre.textContent = '';
    ifaceCounts = new Map();
    portCounts = new Map();
    if (summaryEl) {
      summaryEl.hidden = true;
      summaryEl.innerHTML = '';
    }
  }

  function stopStream() {
    if (es) {
      es.close();
      es = null;
    }
    fetch('/api/sonde/stop', { method: 'POST' }).catch(() => {});
    setSondeToggle(false);
  }

  layerEl.addEventListener('change', () => {
    buildFilterOptions(layerEl.value);
  });
  buildFilterOptions(layerEl.value);

  startBtn.addEventListener('click', () => {
    const exploring = isExploration();
    const port = parseInt(portEl.value, 10);
    if (!exploring && (Number.isNaN(port) || port < 1 || port > 65535)) {
      resetLog();
      appendLineSync('# Port invalide (1–65535).');
      return;
    }
    stopStream();
    resetLog();

    const layer = layerEl.value;
    if (exploring && layer === 'L7') {
      appendLineSync('# Exploration : L7 (payload) est désactivé (trop volumineux / souvent chiffré).');
      return;
    }
    const filter = document.getElementById('sonde-filter').value;
    const direction = document.getElementById('sonde-direction')?.value || 'both';
    // Grep "tel quel" : recherche littérale, sensible à la casse.
    // Exemple : "In" ne doit pas matcher "win".
    const grepNeedle = String(grepEl.value || '').trim();
    const iface = exploring ? 'any' : getSondeIface();
    const qs = new URLSearchParams({
      layer,
      filter,
      direction,
      iface,
    });
    if (exploring) qs.set('explore', '1');
    else qs.set('port', String(port));
    const url = `/api/sonde/stream?${qs}`;

    setSondeToggle(true);

    es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const j = JSON.parse(event.data);
        if (j.t != null) {
          const line = String(j.t);
          // On ne filtre pas les lignes "info" qui commencent par "#".
          if (line.startsWith('#')) {
            enqueueLine(line);
          } else if (!grepNeedle) {
            enqueueLine(line);
          } else {
            if (line.includes(grepNeedle)) enqueueLine(line);
          }
        }
        if (j.end) {
          stopStream();
        }
      } catch {
        // Cas improbable (flux non-JSON) : on affiche tel quel.
        enqueueLine(event.data);
      }
    };

    es.onerror = () => {
      if (es) {
        es.close();
        es = null;
      }
      enqueueLine('# Connexion SSE interrompue (réseau, sudo ou arrêt).');
      enqueueLine('# Si tcpdump ne démarre pas: vérifiez sudo (sudo -n tcpdump ...) et README § Sonde.');
      setSondeToggle(false);
      fetch('/api/sonde/stop', { method: 'POST' }).catch(() => {});
    };
  });

  stopBtn.addEventListener('click', () => {
    inbox = [];
    flushScheduled = false;
    stopStream();
    appendLineSync('# Arrêt demandé.');
  });

  summaryEl?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const kind = chip.dataset.kind;
    const value = chip.dataset.value;
    if (!kind || !value) return;

    // Cliquer sur un chip = raccourci vers mode ciblé
    if (exploreEl) exploreEl.checked = false;
    applyExplorationUiState();

    if (kind === 'iface') {
      setSondeIface(value);
      return;
    }
    if (kind === 'port') {
      portEl.value = String(value);
      return;
    }
  });

  setSondeToggle(false);
}
