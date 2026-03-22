import { loadingOverlay } from './loading-overlay.js';

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
 * Maintenance (étape 3) : appelle POST /api/dashboard/regenerate (generate-data.sh sur le VPS),
 * puis recharge data.json dans le dashboard avec barre de progression / erreurs serveur.
 */
export async function runRegenerateAndReload(loadJSON) {
  loadingOverlay.show({
    message: 'Régénération de data.json sur le serveur…',
    indeterminate: true,
  });
  try {
    const r = await fetch('/api/dashboard/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    let j;
    try {
      j = await r.json();
    } catch {
      loadingOverlay.showError(`Réponse invalide du serveur (HTTP ${r.status}).`);
      return;
    }
    if (!j.ok) {
      const detail = [j.error, j.stderr_tail].filter(Boolean).join('\n').trim();
      loadingOverlay.showError(
        detail || `Échec de la génération (HTTP ${r.status}, code ${j.returncode ?? '?'})`,
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
    loadingOverlay.setProgress(100);
    loadingOverlay.setMessage('Terminé');
    await new Promise((res) => setTimeout(res, 220));
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
