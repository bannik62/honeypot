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

export function initSonde() {
  const pre = document.getElementById('sonde-log');
  const startBtn = document.getElementById('sonde-start');
  const stopBtn = document.getElementById('sonde-stop');
  const layerEl = document.getElementById('sonde-layer');
  const portEl = document.getElementById('sonde-port');
  if (!pre || !startBtn || !stopBtn || !layerEl || !portEl) return;

  let es = null;
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
    stopBtn.disabled = true;
    startBtn.disabled = false;
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
    const qs = new URLSearchParams({ port: String(port), layer, filter });
    const url = `/api/sonde/stream?${qs}`;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const j = JSON.parse(event.data);
        if (j.t != null) enqueueLine(j.t);
        if (j.end) {
          stopStream();
        }
      } catch {
        enqueueLine(event.data);
      }
    };

    es.onerror = () => {
      if (es) {
        es.close();
        es = null;
      }
      enqueueLine('# Connexion SSE interrompue (réseau, sudo ou arrêt).');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      fetch('/api/sonde/stop', { method: 'POST' }).catch(() => {});
    };
  });

  stopBtn.addEventListener('click', () => {
    inbox = [];
    flushScheduled = false;
    stopStream();
    appendLineSync('# Arrêt demandé.');
  });

  stopBtn.disabled = true;
}
