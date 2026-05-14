/* ============================================================
   AR AUTO PRICING v6.1 — Content Script
   Framework target: Vue.js + Vuetify 3 (app.qricambi.com)

   REGOLA A (con listino):
     sconto_fornitore = (1 - acquisto/listino) × 100

     → Se sconto_fornitore > 78pp:
         REGOLA C — ricarico fisso 77pp sul netto
         prezzoCliente = acquisto × 1.77
         scontoCliente = (1 - prezzoCliente/listino) × 100  [arrotondato a 5pp]

     → Altrimenti (≤ 78pp):
         scontoCliente = sconto_fornitore − 20pp  [arrotondato a 5pp verso il basso, min 0]
         Se sconto_fornitore > 80pp → scontoCliente = 70 (cap precedente mantenuto)

   REGOLA B (senza listino o listino = 0):
     listino_fittizio = acquisto × 2
     sconto_cliente   = 30%
     → scrivi listino_fittizio nel campo Listino
     → scrivi 30 nel campo Sconto

   FIX v3.2:
     - mappaColonne() rileva offset th/td (bottone X senza <th>)
     - leggiCella() prova input.value poi textContent
     - trovaTabellaPreventivo() cerca tabella con header "acquisto"

   FIX v3.3:
     - setVueInput() riscritto con 3 livelli:
       1. document.execCommand('insertText') — innesca i veri eventi
          browser che Vue 3 intercetta (più affidabile di Event dispatch)
       2. Accesso a __vueParentComponent per emettere update:modelValue
          direttamente nel sistema reattivo di Vue 3
       3. Fallback nativo (setter + events) come ultima risorsa
     - Verifica post-set: dopo 150ms controlla che il valore non sia
       stato resettato dalla re-render di Vue; se sì, ritenta

   v6.0 — REGOLA C:
     Quando sconto fornitore > 78pp viene applicato un ricarico
     fisso di 77pp sul prezzo di acquisto netto.
   ============================================================ */

(function () {
  'use strict';

  const TAG = '[AR-PRICING v1.0.0]';
  console.log(TAG, 'Content script avviato su', location.href);

  // ── STILI ─────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
    #ar-pricing-ui {
      position: fixed;
      bottom: 150px;
      right: 24px;
      z-index: 999998;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, 'DM Sans', sans-serif;
    }
    #ar-pricing-toast {
      background: #16181c;
      border: 1px solid #2a2d34;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 12px;
      color: #e8eaed;
      max-width: 260px;
      line-height: 1.6;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: none;
    }
    #ar-pricing-toast.visible { display: block; animation: ar-fade .2s ease; }
    #ar-pricing-toast.success { border-color: #3a4a1a; }
    #ar-pricing-toast.error   { border-color: #4a2a1a; }
    @keyframes ar-fade {
      from { opacity:0; transform:translateY(4px); }
      to   { opacity:1; transform:translateY(0); }
    }
    #ar-pricing-toast b  { color: #e8ff47; }
    #ar-pricing-toast .g { color: #4ade80; }
    #ar-pricing-toast .b { color: #47c8ff; }
    #ar-pricing-toast .r { color: #f87171; }
    #ar-pricing-toast .o { color: #fb923c; }
    #ar-pricing-toast .m { color: #6b7280; font-size: 11px; }
    .ar-flash-a td { background-color: rgba(232,255,71,0.20) !important; transition: background-color .8s ease; }
    .ar-flash-b td { background-color: rgba(71,200,255,0.20) !important; transition: background-color .8s ease; }
    .ar-flash-c td { background-color: rgba(251,146,60,0.20) !important; transition: background-color .8s ease; }
    
    /* Colori riga più tenui e professionali */
    .ar-row-low td  { background-color: rgba(248, 113, 113, 0.08) !important; color: #fca5a5 !important; }
    .ar-row-high td { background-color: rgba(74, 222, 128, 0.08) !important; color: #86efac !important; }
    
    .ar-utile-cell { border-left: 1px solid rgba(232,255,71,0.1); }

    /* Fix per sovrascrivere variabili CSS di Vuetify */
    .ar-row-low td, .ar-row-high td, .ar-flash-a td, .ar-flash-b td, .ar-flash-c td {
      --v-table-row-hover-background: transparent !important;
    }

    #ar-pricing-summary {
      background: rgba(22, 24, 28, 0.95);
      backdrop-filter: blur(8px);
      border: 1px solid #e8ff47;
      border-radius: 12px;
      padding: 10px 14px;
      margin-bottom: 6px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      display: none;
      animation: ar-fade .3s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 200px;
      /* Spostiamo un po' a sinistra per non coprire i tasti di sistema */
      margin-right: 20px;
    }
    #ar-pricing-summary.visible { display: block; }
    #ar-pricing-summary .label { font-size: 9px; color: #9ca3af; text-transform: uppercase; font-weight: 600; letter-spacing: 0.08em; margin-bottom: 2px; }
    #ar-pricing-summary .value { font-size: 22px; font-weight: 800; color: #e8ff47; line-height: 1.1; }
    #ar-pricing-summary .sub { font-size: 10px; color: #4ade80; margin-top: 2px; font-weight: 500; }
  `;

  // ── UI pricing (summary widget + toast — il FAB è in fab.js) ──────
  const pricingUi = document.createElement('div');
  pricingUi.id = 'ar-pricing-ui';
  pricingUi.innerHTML = `
    <div id="ar-pricing-summary">
      <div class="label">Guadagno Totale Stimato</div>
      <div class="value" id="ar-total-value">0,00 €</div>
      <div id="ar-total-details" class="sub">0 righe elaborate</div>
    </div>
    <div id="ar-pricing-toast"></div>
  `;

  // ── INJECTION UI PRICING ──────────────────────────────────
  // Il contenitore serve solo on-demand (al click "Applica Pricing"),
  // quindi basta iniettarlo a document_idle con fallback DOMContentLoaded.
  function injectPricingUi() {
    try {
      if (!document.body || !document.head) return false;
      if (!document.getElementById('ar-pricing-style')) {
        css.id = 'ar-pricing-style';
        document.head.appendChild(css);
      }
      if (!document.getElementById('ar-pricing-ui')) {
        document.body.appendChild(pricingUi);
        console.log(TAG, 'UI pricing iniettata nel DOM');
      }
      return true;
    } catch (e) {
      console.error(TAG, 'Errore injection UI pricing:', e);
      return false;
    }
  }

  if (!injectPricingUi()) {
    document.addEventListener('DOMContentLoaded', injectPricingUi);
  }

  // ── UTILS ─────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // showToast: html deve contenere SOLO stringhe statiche o valori passati per escHtml().
  // Non interpolare mai dati esterni (DOM, fetch, user-input) direttamente nel parametro html.
  function showToast(html, type, ms = 5000) {
    const toast = document.getElementById('ar-pricing-toast');
    if (!toast) return;
    toast.innerHTML = html;
    toast.className = `visible ${type}`;
    if (ms > 0) setTimeout(() => { toast.className = ''; }, ms);
  }

  // Helper: aggiunge una riga colorata al toast via DOM (nessun dato utente in innerHTML).
  // cssClass: 'g' | 'b' | 'o' | 'r' | 'm'
  function toastLine(cssClass, label, count) {
    const span = document.createElement('span');
    span.className = cssClass;
    span.textContent = `● ${label}: ${parseInt(count, 10)}`;
    return span.outerHTML + '<br>';
  }

  function parseNum(str) {
    if (str === null || str === undefined) return null;
    // Rimuove tutto tranne numeri, virgola, punto e segno meno. Gestisce "+% 40", "-% 30", "€ 100"
    const s = String(str).replace(/[^\d.,-]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // ── VUE 3 COMPATIBLE INPUT SETTER (v6.1) ──────────────────
  //
  // Vue 3 + Vuetify 3 usa proxy reattivi: settare input.value
  // e sparare un Event('input') funziona spesso ma Vue può
  // ri-renderizzare e sovrascrivere il valore se il suo model
  // interno non è stato aggiornato.
  //
  // Strategia a 4 livelli:
  //   1. execCommand('insertText') — il browser gestisce nativo
  //      l'input come se l'utente avesse scritto: innesca
  //      beforeinput/input/compositionend che Vue 3 ascolta
  //   2. nativeSetter + Event dispatch — fallback robusto
  //   3. __vueParentComponent emit (Vue 3) — aggiorna il modello
  //      reattivo via update:modelValue (Vue 3 v-model contract)
  //   4. NEW (v6.1): Verification loop — verifica che il valore persista
  //      dopo Vue re-render. Se cambia, ritenta (max 3 volte).
  //      Fix per race condition dove Vue poteva sovrascrivere il valore.
  //
  async function setVueInput(input, value) {
    if (!input) return false;

    // v5.8 FIX: Se il valore è numerico, passiamolo come Number a Vue
    // Molti watcher di QRICAMBI usano .filter o logiche che crashano con Stringhe
    const strVal = String(value);
    const numVal = parseFloat(strVal.replace(',', '.'));
    const valToSet = isNaN(numVal) ? strVal : numVal;

    // Helper per verificare se il valore è uguale (con tolleranza numerica)
    const valuesEqual = (a, b) => {
      const numA = parseFloat(String(a).replace(',', '.'));
      const numB = parseFloat(String(b).replace(',', '.'));
      if (!isNaN(numA) && !isNaN(numB)) {
        return Math.abs(numA - numB) < 0.01; // Tolleranza floating point
      }
      return String(a).trim() === String(b).trim();
    };

    // ── Livello 1: execCommand insertText ─────────────────
    try {
      input.focus();
      input.select();
      if (input.setSelectionRange) {
        input.setSelectionRange(0, input.value.length);
      }
      document.execCommand('insertText', false, strVal);
      // Non return: procediamo ai trigger di evento
    } catch (e1) {
      console.log(TAG, '  setVueInput: execCommand fallito:', e1.message);
    }

    // ── Livello 2: nativeSetter + events ──────────────────
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      ).set;
      nativeSetter.call(input, strVal);

      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: strVal }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      console.log(TAG, '  setVueInput: nativeSetter OK, val=', input.value);
    } catch (e2) {
      console.log(TAG, '  setVueInput: nativeSetter fallito:', e2.message);
      try {
        input.value = strVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e3) { }
    }

    // ── Livello 3: Vue 3 __vueParentComponent emit ───────────────
    try {
      let el = input;
      let depth = 0;
      let vComp = null;
      while (el && el.tagName !== 'TD' && depth < 15) {
        if (el.__vueParentComponent) { vComp = el.__vueParentComponent; break; }
        el = el.parentElement;
        depth++;
      }
      if (!vComp && input) {
        const td = input.closest('td');
        if (td) {
          const allEls = td.querySelectorAll('*');
          for (const child of allEls) {
            if (child.__vueParentComponent) { vComp = child.__vueParentComponent; break; }
          }
        }
      }

      if (vComp && vComp.proxy) {
        // Vue 3: v-model usa update:modelValue invece di input
        vComp.proxy.$emit('update:modelValue', valToSet);
        console.log(TAG, '  setVueInput: Vue 3 emit OK →', typeof valToSet, valToSet);
      }
    } catch (e4) {
      console.log(TAG, '  setVueInput: Vue emit fallito:', e4.message);
    }

    // ── Livello 4 (NEW): Verification Loop with Retry ──────────────
    // Aspetta Vue 3 re-render e verifica che il valore persista
    // Se Vue lo sovrascrive, ritenta fino a 3 volte
    const MAX_VERIFY_ATTEMPTS = 3;
    let verifyAttempt = 0;

    while (verifyAttempt < MAX_VERIFY_ATTEMPTS) {
      // Aspetta multiple RAF per far respirare il Vue scheduler
      for (let i = 0; i < 3; i++) {
        await new Promise(r => requestAnimationFrame(r));
      }

      // Verifica post-setValue se il valore è rimasto
      const currentVal = input.value;
      if (valuesEqual(currentVal, strVal)) {
        console.log(TAG, '  setVueInput: Verificato OK (attempt', verifyAttempt + 1 + '/', MAX_VERIFY_ATTEMPTS + ')');
        return true;
      }

      verifyAttempt++;
      if (verifyAttempt < MAX_VERIFY_ATTEMPTS) {
        console.log(TAG, '  setVueInput: Valore changed after render, riprovo (attempt', verifyAttempt + '/', MAX_VERIFY_ATTEMPTS + '), current:', currentVal, 'expected:', strVal);

        // Retry: riscriviamo il valore
        try {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          ).set;
          nativeSetter.call(input, strVal);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: strVal }));
        } catch (e) {
          console.log(TAG, '  setVueInput: Retry fallito:', e.message);
        }
      }
    }

    console.log(TAG, '  setVueInput: FALLITO dopo', MAX_VERIFY_ATTEMPTS, 'verifiche');
    return false;
  }

  // ── TROVA LA TABELLA DEL PREVENTIVO ───────────────────────
  function trovaTabellaPreventivo() {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const hText = (t.querySelector('thead')?.textContent || '').toLowerCase();
      if (hText.includes('acquisto') && hText.includes('sconto')) {
        return t;
      }
    }
    return tables[0] || null;
  }

  // ── TROVA COLONNE DA HEADER ───────────────────────────────
  // FIX v3.2: offset fra th header e td body (bottone X senza <th>)
  function mappaColonne(table) {
    if (!table) return null;

    const headerRow = table.querySelector('thead tr');
    if (!headerRow) {
      console.log(TAG, 'mappaColonne: nessun thead tr');
      return null;
    }

    const ths = Array.from(headerRow.querySelectorAll('th, td'));
    console.log(TAG, 'Header th texts:',
      ths.map(th => `"${th.textContent.trim()}"`)
    );

    const raw = {};
    ths.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase().replace(/[*]+$/, '').trim();
      if (t === 'descrizione') raw.descrizione = i;
      if (t === 'acquisto') raw.acquisto = i;
      if (t === 'ricarico') raw.ricarico = i;
      if (t === 'listino') raw.listino = i;
      if (t === 'sconto') raw.sconto = i;
      if (t === 'vendita') raw.vendita = i;
      if (t === '#pezzi') raw.pezzi = i;
    });

    console.log(TAG, 'Mappa grezza (header):', raw);

    if (raw.acquisto === undefined || raw.sconto === undefined) {
      console.log(TAG, 'mappaColonne: acquisto o sconto non trovati nel header');
      return null;
    }

    const firstBodyRow = table.querySelector('tbody tr');
    if (firstBodyRow) {
      const bodyTdCount = firstBodyRow.querySelectorAll('td').length;
      const headerThCount = ths.length;
      const offset = bodyTdCount - headerThCount;

      console.log(TAG,
        `th header: ${headerThCount}, td body: ${bodyTdCount}, offset: ${offset}`
      );

      if (offset > 0) {
        const adj = {};
        for (const [k, v] of Object.entries(raw)) {
          adj[k] = v + offset;
        }
        console.log(TAG, 'Mappa aggiustata (offset +' + offset + '):', adj);
        return adj;
      }
    }

    return raw;
  }

  // ── LEGGI VALORE DA CELLA ─────────────────────────────────
  function leggiCella(td) {
    if (!td) return null;

    const inp = td.querySelector('input');
    if (inp) {
      const fromInput = parseNum(inp.value);
      if (fromInput !== null && fromInput > 0) return fromInput;
    }

    const fromText = parseNum(td.textContent);
    if (fromText !== null && fromText > 0) return fromText;

    if (inp) return parseNum(inp.value);
    return fromText;
  }

  function inputDiCella(td) {
    if (!td) return null;
    return td.querySelector('input');
  }

  // ── SETTINGS & DEFAULTS ──────────────────────────────────
  // DEFAULTS is loaded from defaults.js (shared with options.js)

  let S = { ...DEFAULTS };

  async function loadSettings() {
    return new Promise((resolve) => {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        console.warn(TAG, 'chrome.storage non disponibile, uso defaults');
        resolve();
        return;
      }
      chrome.storage.local.get(DEFAULTS, (settings) => {
        // Fallback: pulisce null/undefined
        const cleanSettings = {};
        for (const [k, v] of Object.entries(settings)) {
          cleanSettings[k] = (v !== null && v !== undefined && !isNaN(v)) ? v : DEFAULTS[k];
        }
        S = { ...DEFAULTS, ...cleanSettings };
        console.log(TAG, 'Impostazioni caricate e validate:', S);
        resolve();
      });
    });
  }

  // ── HANDLER: registrato su window.__AR_QRICAMBI per il menu FAB ──
  window.__AR_QRICAMBI = window.__AR_QRICAMBI || { onPricing: null, onImport: null };
  window.__AR_QRICAMBI.onPricing = async function () {
    injectPricingUi(); // rete di sicurezza se l'SPA ha ripulito il body
    try {
      await loadSettings(); // Ricarica prima di ogni esecuzione
      const res = await esegui();

      if (res.tot === 0) {
        showToast(`
          <b>Nessuna riga trovata</b><br>
          <span class="m">Assicurati di essere su un preventivo aperto
          con almeno una riga prodotto.</span>
        `, 'error');
      } else if (res.ok === 0) {
        showToast(
          `<b>0 righe aggiornate</b><br>` +
          (res.skipReasons.noAcquisto  ? toastLine('r', 'Senza acquisto', res.skipReasons.noAcquisto) : '') +
          (res.skipReasons.noScontoInp ? toastLine('r', 'Campo sconto assente', res.skipReasons.noScontoInp) : '') +
          (res.skipReasons.rollbackB   ? toastLine('r', 'Rollback Regola B', res.skipReasons.rollbackB) : '') +
          (res.skipReasons.setFailed   ? toastLine('r', 'Scrittura fallita', res.skipReasons.setFailed) : '') +
          `<span class="m">Controlla la console (F12) per i dettagli.</span>`,
          'error'
        );
      } else {
        const rA = res.dettagli.filter(r => r.regola === 'A').length;
        const rB = res.dettagli.filter(r => r.regola === 'B').length;
        const rC = res.dettagli.filter(r => r.regola === 'C').length;
        const nRighe = parseInt(res.ok, 10);
        const label = nRighe !== 1 ? 'righe aggiornate' : 'riga aggiornata';
        showToast(
          `<b>✓ ${nRighe} ${label}</b><br>` +
          (rA ? toastLine('g', 'Regola A', rA) : '') +
          (rB ? toastLine('b', 'Regola B', rB) : '') +
          (rC ? toastLine('o', 'Regola C', rC) : '') +
          (res.skipReasons.noAcquisto  ? toastLine('r', 'Senza acquisto', res.skipReasons.noAcquisto) : '') +
          (res.skipReasons.noScontoInp ? toastLine('r', 'Campo sconto assente', res.skipReasons.noScontoInp) : '') +
          (res.skipReasons.rollbackB   ? toastLine('r', 'Rollback Regola B', res.skipReasons.rollbackB) : '') +
          (res.skipReasons.setFailed   ? toastLine('r', 'Scrittura fallita', res.skipReasons.setFailed) : '') +
          `<span class="m">Verifica e salva il preventivo.</span>`,
          'success'
        );
        updateSummaryWidget(res);
      }
    } catch (e) {
      console.error(TAG, 'Errore esecuzione pricing:', e);
      showToast(`<b>Errore</b><br><span class="m">${escHtml(e.message)}</span>`, 'error');
    }
  };

  function updateSummaryWidget(res) {
    const summary = document.getElementById('ar-pricing-summary');
    const valEl = document.getElementById('ar-total-value');
    const detEl = document.getElementById('ar-total-details');
    if (!summary || !valEl || !detEl) return;

    const totaleUtile = res.dettagli.reduce((acc, d) => acc + (d.utileTotale || 0), 0);
    const ricaricoMedio = res.dettagli.reduce((acc, d) => acc + (d.ricaricoEffettivo || 0), 0) / (res.ok || 1);

    valEl.textContent = totaleUtile.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    detEl.innerHTML = `<span>●</span> ${res.ok} righe | ricarico medio ${ricaricoMedio.toFixed(1)}%`;
    summary.classList.add('visible');
  }

  function updateSummaryFromTable() {
    const table = trovaTabellaPreventivo();
    if (!table) return;
    const col = mappaColonne(table);
    if (!col) return;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const dati = [];
    let ok = 0;

    rows.forEach(tr => {
      const utileCell = tr.querySelector('.ar-utile-cell');
      if (!utileCell || utileCell.textContent === '-') return;

      const acquisto = leggiCella(tr.children[col.acquisto]);
      const vendita = leggiCella(tr.children[col.vendita]);
      
      if (acquisto && vendita) {
        const ricarico = (vendita / acquisto - 1) * 100;
        const utileTotale = parseNum(utileCell.textContent);
        dati.push({ utileTotale, ricaricoEffettivo: ricarico });
        ok++;
      }
    });

    if (ok > 0) {
      updateSummaryWidget({ dettagli: dati, ok });
    }
  }

  let tableListenerActive = false;

  function setupTableListeners() {
    if (tableListenerActive) return;
    tableListenerActive = true;

    async function onTableInput(e) {
      const input = e.target;
      if (input.tagName !== 'INPUT') return;

      // Verifica che l'input sia dentro la tabella pricing
      const table = trovaTabellaPreventivo();
      if (!table || !table.contains(input)) return;

      const tr = input.closest('tr');
      if (!tr) return;

      // Attendi 4 RAF per permettere a Vue di propagare i valori derivati
      for (let i = 0; i < 4; i++) {
        await new Promise(r => requestAnimationFrame(r));
      }

      const col = mappaColonne(table);
      if (!col) return;

      const acquisto = leggiCella(tr.children[col.acquisto]);
      const vendita = leggiCella(tr.children[col.vendita]);
      const pezzi = leggiCella(tr.children[col.pezzi]) || 0;
      const utileCell = tr.querySelector('.ar-utile-cell');

      if (utileCell && acquisto !== null && vendita !== null) {
        const utileTotale = (vendita - acquisto) * pezzi;
        utileCell.textContent = utileTotale.toFixed(2);

        const ricarico = (vendita / acquisto - 1) * 100;
        tr.classList.remove('ar-row-low', 'ar-row-high');
        if (ricarico < S.uiThresholdLow) tr.classList.add('ar-row-low');
        else if (ricarico > S.uiThresholdHigh) tr.classList.add('ar-row-high');

        updateSummaryFromTable();
      }
    }

    document.body.addEventListener('input', onTableInput, true);
    document.body.addEventListener('change', onTableInput, true);
  }

  // ── LOGICA PRINCIPALE ──────────────────────────────────────
  async function esegui() {
    const table = trovaTabellaPreventivo();
    console.log(TAG, 'Tabella trovata:', table ? 'sì' : 'no');

    const col = mappaColonne(table);
    if (!col) return { tot: 0, ok: 0, skip: 0, skipReasons: { noAcquisto: 0, noScontoInp: 0, rollbackB: 0, setFailed: 0 }, dettagli: [] };

    // Inietta colonna Utile se non esiste
    injectUtileColumn(table, col);

    // Riduce descrizione per dare spazio
    shrinkDescriptionColumn(table, col);

    // Attiva monitoraggio real-time
    setupTableListeners();

    const btn = document.getElementById('ar-pricing-btn');
    const onProgress = (current, total) => {
      if (btn && total > 5) {
        btn.innerHTML = `<span>⏳</span> Riga ${current}/${total}`;
      }
    };
    return await eseguiConIndici(table, col, onProgress);
  }

  function shrinkDescriptionColumn(table, col) {
    if (!table || col.descrizione === undefined) return;
    const idx = col.descrizione;
    const rows = table.querySelectorAll('tr');
    rows.forEach(tr => {
      const cell = tr.children[idx];
      if (cell) {
        // Rimuoviamo maxWidth per permettere alla descrizione di prendere tutto lo spazio EXTRA
        // compattando così automaticamente le altre colonne come l'Utile.
        cell.style.width = 'auto'; 
        cell.style.maxWidth = 'none';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';
        cell.style.whiteSpace = 'nowrap';
      }
    });
  }

  function injectUtileColumn(table, col) {
    let th = document.getElementById('ar-col-utile');
    const thead = table.querySelector('thead tr');
    if (!thead) return;

    if (!th) {
      th = document.createElement('th');
      th.id = 'ar-col-utile';
      th.textContent = 'UTILE';
      
      // Tentativo di copiare lo stile dai TH fratelli per integrazione perfetta
      const siblingTh = thead.querySelector('th:not(#ar-col-utile)');
      if (siblingTh) {
        th.className = siblingTh.className; // Copia classi Vuetify (es. v-data-table__th)
      }
      
      th.style.cssText = 'color: #e8ff47 !important; font-size: 9px !important; font-weight: 800 !important; text-align: right !important; width: 40px !important; min-width: 40px !important; max-width: 40px !important; padding: 0 4px !important; vertical-align: middle !important; white-space: nowrap !important;';
      
      const ths = Array.from(thead.children);
      // Cerchiamo Azioni o l'ultima colonna
      const actionTh = ths.find(t => t.textContent.toLowerCase().includes('azioni'));
      if (actionTh) {
        thead.insertBefore(th, actionTh);
      } else {
        thead.appendChild(th);
      }
    }

    const currentThs = Array.from(thead.children);
    const thIndex = currentThs.indexOf(th);

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      if (!tr.querySelector('.ar-utile-cell')) {
        const td = document.createElement('td');
        td.className = 'ar-utile-cell';
        td.style.cssText = 'font-family: monospace !important; font-size: 10px !important; font-weight: bold !important; text-align: right !important; color: #fff !important; padding: 0 4px !important; width: 40px !important; min-width: 40px !important; max-width: 40px !important; white-space: nowrap !important;';
        td.textContent = '-';
        
        const tds = Array.from(tr.children);
        if (thIndex >= 0 && thIndex < tds.length) {
          tr.insertBefore(td, tds[thIndex]);
        } else {
          tr.appendChild(td);
        }
      }
    });
  }

  async function eseguiConIndici(table, col, onProgress) {
    const minCols = Math.max(
      col.acquisto ?? 0,
      col.listino ?? 0,
      col.sconto ?? 0
    ) + 1;

    const allTr = Array.from(table.querySelectorAll('tbody tr'));
    console.log(TAG, `Analisi su ${allTr.length} righe`);

    let ok = 0, skip = 0;
    const skipReasons = { noAcquisto: 0, noScontoInp: 0, rollbackB: 0, setFailed: 0 };
    const dettagli = [];

    for (let ri = 0; ri < allTr.length; ri++) {
      if (onProgress) onProgress(ri + 1, allTr.length);
      const tr = allTr[ri];
      const tds = tr.querySelectorAll('td');

      if (tds.length < minCols) continue;

      const acquisto = leggiCella(tds[col.acquisto]);
      const listino = leggiCella(tds[col.listino]);
      const pezzi = leggiCella(tds[col.pezzi]) || 1;

      if (!acquisto || acquisto <= 0) {
        skip++; skipReasons.noAcquisto++;
        continue;
      }

      const scontoInp = inputDiCella(tds[col.sconto]);
      const listinoInp = inputDiCella(tds[col.listino]);

      if (!scontoInp) {
        skip++; skipReasons.noScontoInp++;
        continue;
      }

      let regola, scontoCliente, listinoFin, prezzoClienteTarget;
      let successo = false;

      if (listino && listino > 0) {
        const scontoForn = (1 - acquisto / listino) * 100;
        const step = S.uiRoundStep > 0 ? S.uiRoundStep : 1; // Previene modulo/div zero

        if (scontoForn > S.regCThreshold) {
          // REGOLA C: ricarico sul netto "in avanti"
          // Prezzo = acquisto * (1 + 77/100)
          const targetPrice = acquisto * (1 + S.regCMarkup / 100);
          const scontoRaw = (1 - targetPrice / listino) * 100;

          // Arrotondo lo sconto al ribasso (floor): prezzo cliente più alto → più margine.
          scontoCliente = Math.floor(scontoRaw / step) * step;
          prezzoClienteTarget = listino * (1 - scontoCliente / 100);
          listinoFin = listino;
          regola = 'C';
        } else if (scontoForn > S.regACapThreshold) {
          // REGOLA A CAP
          scontoCliente = S.regACapValue;
          prezzoClienteTarget = listino * (1 - scontoCliente / 100);
          listinoFin = listino;
          regola = 'A';
        } else {
          // REGOLA A NORMALE
          const diff = scontoForn - S.regADelta;
          scontoCliente = Math.max(0, Math.round(diff / step) * step);
          prezzoClienteTarget = listino * (1 - scontoCliente / 100);
          listinoFin = listino;
          regola = 'A';
        }
        successo = await setVueInput(scontoInp, scontoCliente);
      } else {
        // REGOLA B — aggiornamento atomico: listino + sconto
        // Se sconto fallisce dopo che listino è già stato scritto, rollback.
        listinoFin = acquisto * S.regBMultiplier;
        scontoCliente = S.regBDiscount;
        prezzoClienteTarget = listinoFin * (1 - scontoCliente / 100);
        regola = 'B';

        const listinoOrigValue = listinoInp ? listinoInp.value : null;
        if (listinoInp) await setVueInput(listinoInp, listinoFin.toFixed(2));

        successo = await setVueInput(scontoInp, scontoCliente);
        if (!successo && listinoInp && listinoOrigValue !== null) {
          console.warn(TAG, `Regola B riga ${ri}: sconto fallito, rollback listino`);
          await setVueInput(listinoInp, listinoOrigValue);
          skip++; skipReasons.rollbackB++;
          continue;
        }
      }

      if (successo) {
        // Aggiorna Vendita se possibile
        if (col.vendita != null) {
          const venditaInp = inputDiCella(tds[col.vendita]);
          if (venditaInp) await setVueInput(venditaInp, prezzoClienteTarget.toFixed(2));
        }

        // Calcolo Utile e Color Coding
        const utileUnitario = prezzoClienteTarget - acquisto;
        const utileTotale = utileUnitario * pezzi;
        const ricaricoEffettivo = (prezzoClienteTarget / acquisto - 1) * 100;

        const utileCell = tr.querySelector('.ar-utile-cell');
        if (utileCell) {
          utileCell.textContent = utileTotale.toFixed(2); // Rimosso € per spazio
          utileCell.style.color = '#fff';
        }

        // Flash visual feedback
        let flashClass = 'ar-flash-a';
        if (regola === 'B') flashClass = 'ar-flash-b';
        if (regola === 'C') flashClass = 'ar-flash-c';
        tr.classList.add(flashClass);
        setTimeout(() => tr.classList.remove('ar-flash-a', 'ar-flash-b', 'ar-flash-c'), 1500);

        // Color Coding della riga
        tr.classList.remove('ar-row-low', 'ar-row-high');
        if (ricaricoEffettivo < S.uiThresholdLow) {
          tr.classList.add('ar-row-low'); // Rosso
        } else if (ricaricoEffettivo > S.uiThresholdHigh) {
          tr.classList.add('ar-row-high'); // Verde
        }

        ok++;
        dettagli.push({ regola, utileTotale, ricaricoEffettivo });
      } else {
        skip++; skipReasons.setFailed++;
      }
    }

    return { tot: ok + skip, ok, skip, skipReasons, dettagli };
  }

})();
