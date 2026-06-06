// fab.js — Floating Action Button condiviso per l'estensione unificata "AR AUTO — Qricambi".
// Inietta UN solo FAB con un menu a 2 voci. pricing.content.js e import.content.js
// registrano i loro handler su window.__AR_QRICAMBI; questo modulo li cabla alle
// voci di menu. Caricato dopo defaults.js, prima dei due content script.
(function () {
  'use strict';
  const TAG = '[AR-QR-FAB v1.1.6]';
  console.log(TAG, 'avviato su', location.href);

  // Registro handler — i content script assegnano onPricing / onImport al load.
  window.__AR_QRICAMBI = window.__AR_QRICAMBI || { onPricing: null, onImport: null };

  // ── Stili ─────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.id = 'ar-qr-fab-style';
  css.textContent = `
    #ar-qr-fab {
      position: fixed; bottom: 80px; right: 24px;
      z-index: ${DEFAULTS.fabZIndex};
      font-family: -apple-system, 'DM Sans', sans-serif;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    }
    #ar-qr-fab-menu { display: none; flex-direction: column; gap: 6px; }
    #ar-qr-fab.open #ar-qr-fab-menu { display: flex; }
    .ar-qr-menu-item {
      background: #16181c; color: #e8eaed;
      border: 1px solid #2a2d34; border-radius: 22px;
      padding: 10px 18px; font-size: 13px; font-weight: 600;
      cursor: pointer; white-space: nowrap; text-align: left;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5); transition: all 0.15s;
    }
    .ar-qr-menu-item:hover { transform: translateY(-2px); }
    #ar-qr-menu-pricing:hover { border-color: #e8ff47; color: #e8ff47; }
    #ar-qr-menu-import:hover  { border-color: #4ade80; color: #4ade80; }
    .ar-qr-menu-item:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    #ar-qr-fab-btn {
      background: #e8ff47; color: #0e0f11; border: none; border-radius: 28px;
      padding: 12px 22px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em;
      cursor: pointer; box-shadow: 0 4px 20px rgba(232,255,71,0.4);
      transition: all 0.15s; display: flex; align-items: center; gap: 8px;
      white-space: nowrap;
    }
    #ar-qr-fab-btn:hover { background: #d4eb3a; transform: translateY(-2px); }
    #ar-qr-fab-btn:active { transform: translateY(0); }
    .ar-qr-menu-item .kbd {
      font-size: 10px; opacity: 0.45; margin-left: 10px;
      font-weight: 500; letter-spacing: 0.04em;
    }
    #ar-qr-menu-both:hover  { border-color: #47c8ff; color: #47c8ff; }
    #ar-qr-menu-undo:hover:not(:disabled) { border-color: #fb923c; color: #fb923c; }
  `;

  // ── Elementi ──────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'ar-qr-fab';
  fab.innerHTML = `
    <div id="ar-qr-fab-menu">
      <button class="ar-qr-menu-item" id="ar-qr-menu-pricing">⚡ Applica Pricing <span class="kbd">Alt+⇧+P</span></button>
      <button class="ar-qr-menu-item" id="ar-qr-menu-undo" disabled>↩ Annulla Pricing</button>
      <button class="ar-qr-menu-item" id="ar-qr-menu-import">→ Importa in SIRJ <span class="kbd">Alt+⇧+I</span></button>
      <button class="ar-qr-menu-item" id="ar-qr-menu-both">⚡→ Pricing + Import <span class="kbd">Alt+⇧+B</span></button>
    </div>
    <button id="ar-qr-fab-btn"><span>≡</span> AR AUTO</button>
  `;

  // ── Cablaggio ─────────────────────────────────────────────────────
  fab.querySelector('#ar-qr-fab-btn').addEventListener('click', () => {
    fab.classList.toggle('open');
  });

  function bindMenuItem(id, handlerName) {
    fab.querySelector(id).addEventListener('click', async (e) => {
      fab.classList.remove('open'); // chiudi il menu subito, per reattività
      const handler = window.__AR_QRICAMBI[handlerName];
      if (typeof handler !== 'function') {
        console.warn(TAG, handlerName, 'non registrato');
        return;
      }
      const item = e.currentTarget;
      item.disabled = true;
      try { await handler(); }
      catch (err) { console.error(TAG, handlerName, 'errore:', err); }
      finally { item.disabled = false; }
    });
  }
  bindMenuItem('#ar-qr-menu-pricing', 'onPricing');
  bindMenuItem('#ar-qr-menu-import', 'onImport');
  bindMenuItem('#ar-qr-menu-both', 'onBoth');

  // ── ANNULLA (v1.1.4): voce disabilitata finché non c'è uno snapshot ──
  // setUndoEnabled è chiamato da pricing.content.js dopo un Applica riuscito
  // e dopo un Annulla. Binding dedicato (non bindMenuItem) perché lo stato
  // finale del bottone lo decide onUndo via setUndoEnabled, non un reset fisso.
  window.__AR_QRICAMBI.setUndoEnabled = function (enabled) {
    const item = fab.querySelector('#ar-qr-menu-undo');
    if (item) item.disabled = !enabled;
  };
  fab.querySelector('#ar-qr-menu-undo').addEventListener('click', async (e) => {
    fab.classList.remove('open');
    const item = e.currentTarget;
    if (item.disabled) return;
    const handler = window.__AR_QRICAMBI.onUndo;
    if (typeof handler !== 'function') { console.warn(TAG, 'onUndo non registrato'); return; }
    item.disabled = true; // previene doppio click; lo stato finale lo imposta onUndo
    try { await handler(); }
    catch (err) { console.error(TAG, 'onUndo errore:', err); item.disabled = false; }
  });

  // ── Handler combinato pricing → wait → import (v1.1.2) ────────────
  // Il PATCH /api/Quote scatta SOLO dopo che Vue ha riconciliato gli input
  // modificati da pricing. Attendiamo un breve delay per dare a injected.js
  // il tempo di intercettarlo e popolare chrome.storage.local.lastPatchPayload.
  window.__AR_QRICAMBI.onBoth = async function () {
    const onPricing = window.__AR_QRICAMBI.onPricing;
    const onImport  = window.__AR_QRICAMBI.onImport;
    if (typeof onPricing !== 'function' || typeof onImport !== 'function') {
      console.warn(TAG, 'onBoth: handler mancanti', { onPricing: !!onPricing, onImport: !!onImport });
      return;
    }
    console.log(TAG, 'sequenza pricing → wait → import avviata');
    try {
      await onPricing();
      await new Promise((r) => setTimeout(r, DEFAULTS.bothWaitMs || 1800));
      await onImport();
    } catch (e) {
      console.error(TAG, 'onBoth errore:', e);
    }
  };

  // ── Shortcut tastiera (v1.1.2) ────────────────────────────────────
  // Alt+Shift+P → Pricing, Alt+Shift+I → Import, Alt+Shift+B → Both.
  // Ignora se l'utente sta scrivendo in input/textarea/contentEditable.
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey) return;
    const t = e.target;
    const isTyping = t && (
      t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
    );
    if (isTyping) return;
    const key = (e.key || '').toLowerCase();
    const map = { p: 'onPricing', i: 'onImport', b: 'onBoth' };
    const handlerName = map[key];
    if (!handlerName) return;
    e.preventDefault();
    e.stopPropagation();
    const handler = window.__AR_QRICAMBI[handlerName];
    if (typeof handler === 'function') {
      console.log(TAG, 'shortcut', key.toUpperCase(), '→', handlerName);
      handler();
    } else {
      console.warn(TAG, 'shortcut', key, ': handler', handlerName, 'non registrato');
    }
  }, true);

  // ── Injection con exponential backoff ─────────────────────────────
  function injectFab() {
    try {
      if (!document.body || !document.head) return false;
      if (!document.getElementById('ar-qr-fab-style')) document.head.appendChild(css);
      if (!document.getElementById('ar-qr-fab')) {
        document.body.appendChild(fab);
        console.log(TAG, 'FAB iniettato nel DOM');
      }
      return true;
    } catch (e) {
      console.error(TAG, 'Errore injection:', e);
      return false;
    }
  }

  let attempt = 0, totalDelay = 0;
  function scheduleNext() {
    if (attempt >= DEFAULTS.injectionMaxAttempts || totalDelay >= DEFAULTS.injectionMaxDelayMs) {
      console.warn(TAG, 'Injection abortita dopo', attempt, 'tentativi');
      return;
    }
    const delay = Math.min(
      DEFAULTS.injectionInitialDelayMs * Math.pow(2, attempt),
      DEFAULTS.injectionMaxDelayMs - totalDelay
    );
    totalDelay += delay; attempt++;
    setTimeout(() => {
      if (injectFab()) console.log(TAG, `FAB iniettato al tentativo ${attempt}`);
      else scheduleNext();
    }, delay);
  }

  if (!injectFab()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleNext);
    } else {
      scheduleNext();
    }
  }

  // ── Observer re-injection (SPA che ripulisce il body) ─────────────
  const observer = new MutationObserver(() => {
    if (!document.getElementById('ar-qr-fab') && document.body) {
      console.log(TAG, 'FAB rimosso dal DOM, reinjecting...');
      document.body.appendChild(fab);
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true });
      injectFab();
    });
  }
})();
