import { loadingOverlay } from './loading-overlay.js';

const EXIT_MARKER = '__HONEYPOT_EXIT__';

function formatLoadError(err) {
  const status = err && err.status;
  const msg = err && err.message ? String(err.message) : '';
  if (status === 404) {
    return 'Fichier data.json introuvable (404). Vérifiez le chemin /data/visualizer-dashboard/ ou lancez honeypot-start-server sur le VPS.';
  }
  if (status && status >= 400) {
    return `Impossible de charger data.json (HTTP ${status}). ${msg || 'Réessayez ou ouvrez le dashboard via le tunnel SSH.'}`;
  }
  if (msg && msg !== 'data.json missing') {
    return `Impossible de charger data.json : ${msg}`;
  }
  return 'Aucune donnée ou réseau indisponible. Ouvrez via honeypot-start-server (tunnel SSH) ou importez un CSV.';
}

export function loadInitialData(loadJSON) {
  loadingOverlay.show({
    message: 'Chargement de data.json…',
    indeterminate: true,
  });

  return fetch('/data/visualizer-dashboard/data.json')
    .then((r) => {
      if (!r.ok) {
        const e = new Error(r.statusText || 'data.json missing');
        e.status = r.status;
        throw e;
      }
      return r.json();
    })
    .then((data) => {
      loadingOverlay.setProgress(100);
      loadingOverlay.setMessage('Données prêtes');
      return new Promise((resolve) => {
        setTimeout(() => {
          loadingOverlay.hide();
          resolve(data);
        }, 220);
      });
    })
    .then((data) => {
      loadJSON(data);
      const status = document.getElementById('dzt');
      if (status) status.innerHTML = '<strong>✅ data.json chargé</strong>';
    })
    .catch((err) => {
      loadingOverlay.showError(formatLoadError(err));
      const status = document.getElementById('dzt');
      if (status) {
        status.innerHTML = 'Aucune donnée (ouvrir via <code>honeypot-start-server start</code>)';
      }
    });
}

/**
 * Stream generate-data.sh (POST /api/dashboard/regenerate-stream) → log scroll, puis reload data.json.
 */
export async function runRegenerateAndReload(loadJSON) {
  loadingOverlay.showTerminal({
    message: 'Connexion au serveur…',
  });

  let fullText = '';

  try {
    const r = await fetch('/api/dashboard/regenerate-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (!r.ok) {
      loadingOverlay.showError(`Erreur HTTP ${r.status} sur regenerate-stream.`);
      return;
    }

    if (!r.body) {
      loadingOverlay.showError('Réponse sans corps (stream indisponible).');
      return;
    }

    loadingOverlay.setMessage('generate-data.sh — sortie en direct :');

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      fullText += chunk;
      loadingOverlay.appendLogChunk(chunk);
    }
    const flush = dec.decode();
    if (flush) {
      fullText += flush;
      loadingOverlay.appendLogChunk(flush);
    }

    const exitMatch = fullText.match(new RegExp(`${EXIT_MARKER}\\s+(\\d+)\\s*$`, 'm'));
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : -1;

    if (exitCode !== 0) {
      const logTail = fullText.length > 12000 ? fullText.slice(-12000) : fullText;
      loadingOverlay.showError(
        exitCode === 124
          ? `Timeout après 50 minutes (limite serveur).\n\n--- sortie ---\n${logTail}`
          : `Code ${exitCode}.\n\n--- sortie ---\n${logTail}`,
      );
      return;
    }

    loadingOverlay.setMessage('Chargement des nouvelles données…');
    const fr = await fetch('/data/visualizer-dashboard/data.json', { cache: 'no-store' });
    if (!fr.ok) {
      loadingOverlay.showError(`data.json introuvable après génération (HTTP ${fr.status}).`);
      return;
    }
    const data = await fr.json();
    loadingOverlay.hide();
    loadJSON(data);
    const status = document.getElementById('dzt');
    if (status) status.innerHTML = '<strong>✅ data.json régénéré et rechargé</strong>';
  } catch (e) {
    loadingOverlay.showError(e.message || String(e));
  }
}

export function loadCSV(txt, loadJSON) {
  const lines = txt.trim().split('\n');
  const byIp = {};
  for (let i = 1; i < lines.length; i += 1) {
    const p = lines[i].split(',');
    if (p.length < 4) continue;
    const ip = p[1].trim();
    const country = p[3].trim();
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
    if (!byIp[ip]) byIp[ip] = { ip, country, nmap: false, dns: false, screenshot: false, nikto: false, traceroute: false, hops: [], vuln_high: 0, ports: '', count: 0 };
    byIp[ip].count += 1;
  }
  loadJSON(Object.values(byIp));
}
