// fab.js — Floating Action Button condiviso per l'estensione unificata "AR AUTO — Qricambi".
// Inietta UN solo FAB con un menu a 2 voci. pricing.content.js e import.content.js
// registrano i loro handler su window.__AR_QRICAMBI; questo modulo li cabla alle
// voci di menu. Caricato dopo defaults.js, prima dei due content script.
(function () {
  'use strict';
  const TAG = '[AR-QR-FAB v1.2.5]';
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

  // Guardia di riesecuzione CONDIVISA tra menu e shortcut (#28): una sola azione
  // alla volta tra Pricing / Import / Pricing+Import. Un secondo Applica Pricing
  // sui valori gia ritoccati sovrascriverebbe lo snapshot di ANNULLA, e un doppio
  // Import farebbe due POST verso il bridge. Le tre voci di menu restano
  // disabilitate finche l'azione e in corso (feedback visivo anche per lo shortcut).
  const actionItems = [];
  let actionRunning = false;

  // ANNULLA (v1.1.4) ha uno stato proprio: lo decide pricing.content.js via
  // setUndoEnabled (c'e uno snapshot da ripristinare o no), non un reset fisso.
  // Durante un'azione e disabilitato come le altre voci (#42); a fine azione
  // torna a riflettere undoEnabled, non a "abilitato".
  const undoItem = () => fab.querySelector('#ar-qr-menu-undo');
  let undoEnabled = false;
  function syncUndoItem() {
    const item = undoItem();
    if (item) item.disabled = !undoEnabled || actionRunning;
  }

  async function runAction(handlerName, source) {
    const handler = window.__AR_QRICAMBI[handlerName];
    if (typeof handler !== 'function') {
      console.warn(TAG, handlerName, 'non registrato');
      return;
    }
    if (actionRunning) {
      console.warn(TAG, handlerName, 'ignorato (' + source + '): un\'altra azione e in corso');
      return;
    }
    actionRunning = true;
    actionItems.forEach((it) => { it.disabled = true; });
    syncUndoItem();
    try { await handler(); }
    catch (err) { console.error(TAG, handlerName, 'errore:', err); }
    finally {
      actionRunning = false;
      actionItems.forEach((it) => { it.disabled = false; });
      syncUndoItem();
    }
  }

  function bindMenuItem(id, handlerName) {
    const item = fab.querySelector(id);
    actionItems.push(item);
    item.addEventListener('click', () => {
      fab.classList.remove('open'); // chiudi il menu subito, per reattivita
      return runAction(handlerName, 'menu');
    });
  }
  bindMenuItem('#ar-qr-menu-pricing', 'onPricing');
  bindMenuItem('#ar-qr-menu-import', 'onImport');
  bindMenuItem('#ar-qr-menu-both', 'onBoth');

  // ── ANNULLA (v1.1.4): voce disabilitata finché non c'è uno snapshot ──
  // setUndoEnabled è chiamato da pricing.content.js dopo un Applica riuscito
  // e dopo un Annulla (anche mentre runAction e in corso: il bottone resta
  // disabilitato fino a fine azione, poi syncUndoItem applica lo stato).
  // Il click passa da runAction (#42): niente ANNULLA durante Pricing/Import, e
  // viceversa. Non e in actionItems perche il suo stato finale non e fisso.
  window.__AR_QRICAMBI.setUndoEnabled = function (enabled) {
    undoEnabled = !!enabled;
    syncUndoItem();
  };
  undoItem().addEventListener('click', () => {
    fab.classList.remove('open');
    if (!undoEnabled) return; // nessuno snapshot da ripristinare
    return runAction('onUndo', 'menu');
  });

  // ── Handler combinato pricing → conferma salvataggio → import (#31) ──
  // Il PATCH /api/Quote scatta SOLO dopo che Vue ha riconciliato gli input
  // modificati da pricing, ed e' pubblicato da injected.js solo dopo la conferma
  // di Qricambi: import.content.js lo salva in chrome.storage.local.lastPatchPayload.
  // Niente attesa fissa: si ascolta la vera scrittura di quella chiave
  // (chrome.storage.onChanged), con una breve finestra di quiete per le PATCH
  // ravvicinate (l'ultima porta lo stato completo) e un timeout.
  // Scelta di Fede «Fermati su errori»: l'import parte solo se il pricing e'
  // riuscito su TUTTE le righe; una sola riga saltata o fallita lo blocca.

  // Motivo per cui NON importare, o null se l'esito del pricing e' pulito.
  const FASCIA_VERIFICATA = new Set(['recupero', 'normale', 'spento']);
  function bothBlockReason(res) {
    if (!res || typeof res !== 'object') return 'esito del pricing non disponibile';
    if (res.error) return `errore nel pricing (${res.error})`;
    if (!(res.tot > 0)) return 'nessuna riga trovata nel preventivo';
    if (!(res.ok > 0)) return 'nessuna riga aggiornata dal pricing';
    const reasons = res.skipReasons || {};
    const fromReasons = Object.values(reasons).reduce((a, n) => a + (Number(n) || 0), 0);
    const skipped = Math.max(Number(res.skip) || 0, fromReasons);
    if (skipped > 0) return `${skipped} righe saltate o fallite dal pricing`;
    // arauto#4911: un cliente su fascia di recupero prezzato senza recupero non
    // deve arrivare in SIRJ. Fascia non letta (server giu', cliente non noto)
    // = niente import automatico.
    const fascia = res.fascia;
    if (!fascia || !FASCIA_VERIFICATA.has(fascia.stato)) {
      const motivo = fascia && fascia.motivo ? ` (${fascia.motivo})` : '';
      return `fascia sconto del cliente non verificata${motivo}`;
    }
    return null;
  }

  // quote-import-ext#46: il pricing ha girato su tutte le righe ma non ne ha
  // cambiata nessuna (preventivo gia' prezzato). Qricambi non manda PATCH, quindi
  // non c'e' nulla da aspettare: avviso SUBITO, senza attendere bothWaitMs e senza
  // importare. Conta le righe davvero cambiate (`cambiate`, da pricing.content.js),
  // NON l'assenza di PATCH. Se il conteggio manca (esito vecchio) vale `false`: si
  // procede con l'attesa di sempre.
  function bothNoChanges(res) {
    return !!res && typeof res === 'object' && res.cambiate === 0;
  }

  // Si arma PRIMA del pricing, cosi' una PATCH veloce non si perde.
  //
  // inFlight (quote-import-ext#47, interruttore importAttendeInVolo): oltre alla
  // scrittura di lastPatchPayload serve che injected.js non abbia salvataggi in volo
  // (`AR_QUOTE_SAVES`, valori assoluti) e che l'ULTIMO salvataggio inviato sia
  // confermato. La quiete parte dall'ultimo evento a zero in volo e si azzera se ne
  // parte un altro: una PATCH lenta non puo' piu' farsi superare dal timer.
  // Allo scadere di `timeoutMs` senza quiete NON si importa mai (anche con una
  // scrittura gia' vista). Con inFlight spento resta la logica di prima.
  // wait() risolve {ok, reason}.
  function armPatchWatch(inFlight) {
    let changed = false;
    let onChange = null;
    const saves = { inflight: 0, sentSeq: 0, confirmedSeq: 0 };
    let onSaves = null;
    const listener = (changes, area) => {
      if (area !== 'local' || !changes || !changes.lastPatchPayload) return;
      if (!changes.lastPatchPayload.newValue) return;
      changed = true;
      if (onChange) onChange();
    };
    const onMessage = (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== 'AR_QUOTE_SAVES') return;
      saves.inflight = Math.max(0, Number(d.inflight) || 0);
      saves.sentSeq = Number(d.sentSeq) || 0;
      saves.confirmedSeq = Number(d.confirmedSeq) || 0;
      if (onSaves) onSaves();
    };
    chrome.storage.onChanged.addListener(listener);
    if (inFlight) window.addEventListener('message', onMessage);
    return {
      dispose() {
        chrome.storage.onChanged.removeListener(listener);
        if (inFlight) window.removeEventListener('message', onMessage);
      },
      wait(timeoutMs, settleMs) {
        return new Promise((resolve) => {
          let settleTimer = null;
          let timeoutTimer = null;
          const finish = (ok, reason) => {
            clearTimeout(settleTimer); clearTimeout(timeoutTimer);
            onChange = null; onSaves = null;
            resolve({ ok, reason });
          };
          if (!inFlight) {
            // comportamento di prima: quiete dall'ultima scrittura; al timeout vale
            // la scrittura gia' vista.
            const arm = () => {
              clearTimeout(settleTimer);
              settleTimer = setTimeout(() => finish(true), settleMs);
            };
            timeoutTimer = setTimeout(() => finish(changed), timeoutMs);
            onChange = arm;
            if (changed) arm();
            return;
          }
          const decide = () => {
            if (saves.sentSeq > saves.confirmedSeq) {
              return finish(false, "Qricambi ha rifiutato l'ultimo salvataggio del preventivo");
            }
            if (!changed) return; // salvataggio confermato ma non ancora scritto in storage
            finish(true);
          };
          const rearm = () => {
            clearTimeout(settleTimer); settleTimer = null;
            if (saves.inflight > 0) return; // attende la risposta
            if (!changed && !(saves.sentSeq > 0)) return; // niente ancora
            settleTimer = setTimeout(decide, settleMs);
          };
          timeoutTimer = setTimeout(() => {
            const s = Math.round(timeoutMs / 1000);
            finish(false, saves.inflight > 0
              ? `Qricambi sta ancora salvando il preventivo (${saves.inflight} salvataggi in corso dopo ${s} s)`
              : `Qricambi non ha confermato il salvataggio entro ${s} s`);
          }, timeoutMs);
          onChange = rearm; onSaves = rearm;
          rearm();
        });
      },
    };
  }

  // Interruttore #47 dalle Opzioni (default: acceso). Non deve mai bloccare onBoth.
  async function leggiAttendeInVolo() {
    const def = DEFAULTS.importAttendeInVolo !== false;
    try {
      const s = await new Promise((resolve) =>
        chrome.storage.local.get({ importAttendeInVolo: def }, resolve));
      return !!s && s.importAttendeInVolo !== false;
    } catch (e) { return def; }
  }

  function bothStop(reason) {
    console.warn(TAG, 'onBoth: import NON eseguito —', reason);
    if (typeof alert === 'function') {
      alert(`Pricing + Import: import NON eseguito.\n\nMotivo: ${reason}.\n` +
            `Controlla il preventivo e usa "Importa in SIRJ" quando e' tutto a posto.`);
    }
  }

  window.__AR_QRICAMBI.onBoth = async function () {
    const onPricing = window.__AR_QRICAMBI.onPricing;
    const onImport  = window.__AR_QRICAMBI.onImport;
    if (typeof onPricing !== 'function' || typeof onImport !== 'function') {
      console.warn(TAG, 'onBoth: handler mancanti', { onPricing: !!onPricing, onImport: !!onImport });
      return;
    }
    console.log(TAG, 'sequenza pricing → conferma salvataggio → import avviata');
    const watch = armPatchWatch(await leggiAttendeInVolo());
    try {
      const res = await onPricing();
      const blocked = bothBlockReason(res);
      if (blocked) { bothStop(blocked); return; }
      if (bothNoChanges(res)) {
        console.warn(TAG, 'onBoth: import NON eseguito — il pricing non ha cambiato nessuna riga');
        if (typeof alert === 'function') {
          alert('Pricing + Import: nessuna modifica.\n\nIl pricing non ha cambiato nessuna riga ' +
                '(il preventivo e\' gia\' prezzato), quindi non parte nessun salvataggio e ' +
                'niente e\' stato importato.\nUsa "Importa in SIRJ" per importarlo.');
        }
        return;
      }
      const saved = await watch.wait(DEFAULTS.bothWaitMs, DEFAULTS.bothSettleMs);
      if (!saved.ok) {
        bothStop(saved.reason ||
          `Qricambi non ha confermato il salvataggio entro ${Math.round(DEFAULTS.bothWaitMs / 1000)} s`);
        return;
      }
      await onImport();
    } catch (e) {
      console.error(TAG, 'onBoth errore:', e);
      bothStop(`errore imprevisto (${e && e.message ? e.message : e})`);
    } finally {
      watch.dispose();
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
    console.log(TAG, 'shortcut', key.toUpperCase(), '→', handlerName);
    runAction(handlerName, 'shortcut');
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
