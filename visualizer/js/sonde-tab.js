/**
 * Onglet Sonde — EventSource SSE vers /api/sonde/stream
 */

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
    add('synfinrst', 'SYN / FIN / RST');
  } else {
    add('gt50', 'Payload > 50 octets');
    add('gt128', 'Payload > 128 octets');
  }
}

function appendLine(pre, text) {
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  pre.textContent += `${text}\n`;
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

export function initSonde() {
  const pre = document.getElementById('sonde-log');
  const startBtn = document.getElementById('sonde-start');
  const stopBtn = document.getElementById('sonde-stop');
  const layerEl = document.getElementById('sonde-layer');
  const portEl = document.getElementById('sonde-port');
  if (!pre || !startBtn || !stopBtn || !layerEl || !portEl) return;

  let es = null;

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
      appendLine(pre, '# Port invalide (1–65535).');
      return;
    }
    stopStream();
    pre.textContent = '';

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
        if (j.t != null) appendLine(pre, j.t);
        if (j.end) {
          stopStream();
        }
      } catch {
        appendLine(pre, event.data);
      }
    };

    es.onerror = () => {
      if (es) {
        es.close();
        es = null;
      }
      appendLine(pre, '# Connexion SSE interrompue (réseau, sudo ou arrêt).');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      fetch('/api/sonde/stop', { method: 'POST' }).catch(() => {});
    };
  });

  stopBtn.addEventListener('click', () => {
    stopStream();
    appendLine(pre, '# Arrêt demandé.');
  });

  stopBtn.disabled = true;
}
