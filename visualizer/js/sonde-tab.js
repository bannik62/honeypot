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
 */
function fillSondeIfaceSelect(ifaceEl, payload) {
  if (!ifaceEl) return;
  const prev = ifaceEl.value;
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
  ifaceEl.innerHTML = '';
  merged.forEach((name) => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    const role = byName.get(name) || ifaceRoleClientHint(name);
    if (role) o.title = role;
    ifaceEl.appendChild(o);
  });
  if (merged.includes(prev)) ifaceEl.value = prev;
  else ifaceEl.value = 'any';
  syncSondeIfaceSelectTitle(ifaceEl);
}

/** Infobulle sur le <select> fermé (les <option title> sont peu fiables selon les navigateurs). */
function syncSondeIfaceSelectTitle(ifaceEl) {
  if (!ifaceEl) return;
  const opt = ifaceEl.selectedOptions[0];
  ifaceEl.title = opt?.title || ifaceRoleClientHint(ifaceEl.value);
}

async function loadSondeInterfaces(ifaceEl) {
  try {
    const r = await fetch('/api/sonde/interfaces');
    const j = await r.json();
    fillSondeIfaceSelect(ifaceEl, j.interfaces);
  } catch {
    fillSondeIfaceSelect(ifaceEl, []);
  }
}

export function initSonde() {
  const pre = document.getElementById('sonde-log');
  const startBtn = document.getElementById('sonde-start');
  const stopBtn = document.getElementById('sonde-stop');
  const layerEl = document.getElementById('sonde-layer');
  const portEl = document.getElementById('sonde-port');
  const grepEl = document.getElementById('sonde-grep');
  const ifaceEl = document.getElementById('sonde-iface');
  const ifaceRefresh = document.getElementById('sonde-iface-refresh');
  if (!pre || !startBtn || !stopBtn || !layerEl || !portEl || !grepEl) return;

  fillSondeIfaceSelect(ifaceEl, []);
  loadSondeInterfaces(ifaceEl);
  ifaceRefresh?.addEventListener('click', () => loadSondeInterfaces(ifaceEl));
  ifaceEl?.addEventListener('change', () => syncSondeIfaceSelectTitle(ifaceEl));

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
    const port = parseInt(portEl.value, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      resetLog();
      appendLineSync('# Port invalide (1–65535).');
      return;
    }
    stopStream();
    resetLog();

    const layer = layerEl.value;
    const filter = document.getElementById('sonde-filter').value;
    const direction = document.getElementById('sonde-direction')?.value || 'both';
    // Grep "tel quel" : recherche littérale, sensible à la casse.
    // Exemple : "In" ne doit pas matcher "win".
    const grepNeedle = String(grepEl.value || '').trim();
    const iface = ifaceEl?.value?.trim() || 'any';
    const qs = new URLSearchParams({
      port: String(port),
      layer,
      filter,
      direction,
      iface,
    });
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

  setSondeToggle(false);
}
