/**
 * Overlay plein écran : chargement (barre indéterminée / %), zone log type terminal, erreurs.
 */

function root() {
  return document.getElementById('loading-overlay');
}

function overlayBox() {
  return document.querySelector('.loading-overlay-box');
}

function hideErrorUi() {
  const el = root();
  const errEl = document.getElementById('loading-overlay-err');
  const dismiss = document.getElementById('loading-overlay-dismiss');
  const barWrap = el && el.querySelector('.loading-overlay-bar-wrap');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  if (dismiss) dismiss.hidden = true;
  if (barWrap) barWrap.style.display = '';
}

function setTerminalMode(on) {
  const box = overlayBox();
  const logEl = document.getElementById('loading-overlay-log');
  const barWrap = root() && root().querySelector('.loading-overlay-bar-wrap');
  if (box) box.classList.toggle('has-terminal', !!on);
  if (logEl) {
    if (on) {
      logEl.hidden = false;
    } else {
      logEl.hidden = true;
      logEl.textContent = '';
    }
  }
  if (barWrap) barWrap.style.display = on ? 'none' : '';
}

export const loadingOverlay = {
  /**
   * @param {{ message?: string, indeterminate?: boolean, progress?: number }} opts
   */
  show(opts = {}) {
    const el = root();
    if (!el) return;
    hideErrorUi();
    setTerminalMode(false);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.setAttribute('aria-busy', 'true');

    const msgEl = document.getElementById('loading-overlay-msg');
    const bar = document.getElementById('loading-overlay-bar');
    if (msgEl) msgEl.textContent = opts.message || 'Chargement…';

    if (bar) {
      bar.classList.remove('indeterminate', 'determinate');
      const usePct = opts.indeterminate === false && typeof opts.progress === 'number';
      if (usePct) {
        bar.classList.add('determinate');
        const p = Math.max(0, Math.min(100, opts.progress));
        bar.style.width = `${p}%`;
      } else {
        bar.classList.add('indeterminate');
        bar.style.width = '';
      }
    }
  },

  /** Mode terminal : masque la barre, affiche le scroll de log (régénération data.json). */
  showTerminal(opts = {}) {
    const el = root();
    if (!el) return;
    hideErrorUi();
    setTerminalMode(true);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.setAttribute('aria-busy', 'true');

    const titleEl = document.querySelector('.loading-overlay-title');
    if (titleEl) titleEl.textContent = opts.title || 'GÉNÉRATION';

    const msgEl = document.getElementById('loading-overlay-msg');
    if (msgEl) msgEl.textContent = opts.message || 'Exécution de generate-data.sh sur le serveur…';
  },

  appendLogChunk(text) {
    const logEl = document.getElementById('loading-overlay-log');
    if (!logEl || logEl.hidden) return;
    logEl.textContent += text;
    logEl.scrollTop = logEl.scrollHeight;
  },

  setProgress(p) {
    const bar = document.getElementById('loading-overlay-bar');
    if (!bar) return;
    bar.classList.remove('indeterminate');
    bar.classList.add('determinate');
    bar.style.width = `${Math.max(0, Math.min(100, p))}%`;
  },

  setMessage(text) {
    const msgEl = document.getElementById('loading-overlay-msg');
    if (msgEl) msgEl.textContent = text;
  },

  hide() {
    const el = root();
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('aria-busy', 'false');
    hideErrorUi();
    setTerminalMode(false);

    const titleEl = document.querySelector('.loading-overlay-title');
    if (titleEl) titleEl.textContent = 'CHARGEMENT';

    const bar = document.getElementById('loading-overlay-bar');
    if (bar) {
      bar.classList.remove('determinate');
      bar.classList.add('indeterminate');
      bar.style.width = '';
    }
  },

  showError(message) {
    const el = root();
    if (!el) return;
    setTerminalMode(false);
    const titleEl = document.querySelector('.loading-overlay-title');
    if (titleEl) titleEl.textContent = 'ERREUR';
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.setAttribute('aria-busy', 'false');

    const msgEl = document.getElementById('loading-overlay-msg');
    const errEl = document.getElementById('loading-overlay-err');
    const dismiss = document.getElementById('loading-overlay-dismiss');
    const barWrap = el.querySelector('.loading-overlay-bar-wrap');
    const bar = document.getElementById('loading-overlay-bar');

    if (msgEl) msgEl.textContent = 'Erreur';
    if (barWrap) barWrap.style.display = 'none';
    if (bar) {
      bar.classList.remove('indeterminate', 'determinate');
      bar.style.width = '0%';
    }
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = message || 'Une erreur est survenue.';
    }
    if (dismiss) dismiss.hidden = false;
  },
};

function bindDismiss() {
  const btn = document.getElementById('loading-overlay-dismiss');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => loadingOverlay.hide());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindDismiss);
} else {
  bindDismiss();
}
