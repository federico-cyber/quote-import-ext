# Unificazione estensioni Chrome Qricambi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fondere `pricing-ext-v5` e `quote-import-ext` in un'unica estensione Chrome con un solo FAB a 2 voci, e aggiungere una vista storico import nel popup.

**Architecture:** Si riusa il repo `quote-import-ext` come base. Un nuovo `fab.js` possiede l'unico FAB (button + menu a 2 voci, injection con backoff, re-injection observer) ed espone `window.__AR_QRICAMBI = { onPricing, onImport }`. I due content script diventano `pricing.content.js` e `import.content.js`: mantengono la loro logica di business intatta (incluso `setVueInput`), perdono solo il "guscio" FAB e registrano il loro handler sul namespace condiviso. `defaults.js` diventa un unico oggetto flat (zero collisioni di chiave fra i due set). Tutto lo storage va su `chrome.storage.local`. Lo storico import è un array FIFO (cap 50) in `chrome.storage.local.importHistory`, scritto su tutti i rami della risposta POST.

**Tech Stack:** Chrome Extension Manifest v3, vanilla JS (no build, no npm, no bundler), `chrome.storage.local`.

**Testing reality:** Nessuna delle due estensioni ha test automatici e non c'è un test harness (vanilla JS caricato direttamente da Chrome). La verifica è **manuale**: caricamento unpacked in `chrome://extensions`, ispezione console, esecuzione su una pagina preventivo Qricambi reale. Ogni task termina con step di verifica manuale espliciti al posto di test automatici.

**Working directory:** `/home/fede/arauto/quote-import-ext-unifica` (worktree isolata, branch `feat/unifica-estensioni-qricambi`). Tutti i comandi e path sono relativi a questa directory salvo indicazione diversa.

**Spec di riferimento:** `docs/superpowers/specs/2026-05-14-unifica-estensioni-qricambi-design.md`
**Issue:** [#2](https://github.com/federico-cyber/quote-import-ext/issues/2)

---

## File Structure (stato finale dell'estensione)

| File | Responsabilità | Origine |
|---|---|---|
| `manifest.json` | MV3 unico: 2 content_scripts, permessi, popup, options | riscritto (Task 3) |
| `defaults.js` | Unico `const DEFAULTS` flat: pricing + backend + injection | riscritto (Task 2) |
| `fab.js` | Unico FAB: button + menu 2 voci, backoff injection, observer, espone `window.__AR_QRICAMBI` | **nuovo** (Task 4) |
| `injected.js` | Hook `fetch`/`XHR` nel MAIN world (intercetta `PATCH /api/Quote`) | invariato salvo TAG (Task 6) |
| `pricing.content.js` | Logica pricing A/B/C + `setVueInput` + widget utile/toast | ex `pricing-ext-v5/content.js`, guscio FAB rimosso (Task 1, 5) |
| `import.content.js` | Listener payload + POST a SIRJ + storico import | ex `content.js` di quote-import-ext, FAB rimosso + storico (Task 1, 6) |
| `options.html` / `options.js` | Options page unica: parametri pricing + config backend | riscritto (Task 7) |
| `popup.html` / `popup.js` | Popup unico: storico import + regole pricing collassabili | riscritto (Task 8) |
| `icons/icon128.png` | Icona estensione | invariato (già nel repo) |
| `CLAUDE.md` / `README.md` | Documentazione architettura unificata | aggiornati (Task 9) |

**Layout di caricamento content script (manifest):**
```
MAIN world,    document_start: injected.js
ISOLATED world, document_idle:  defaults.js, fab.js, pricing.content.js, import.content.js
```
`defaults.js` definisce il global `DEFAULTS`; `fab.js` definisce `window.__AR_QRICAMBI` e inietta il FAB; i due content script registrano i loro handler su `window.__AR_QRICAMBI`.

**Posizionamento UI fisso (coordinate fissate qui per evitare collisioni):**
- FAB (`fab.js`): `#ar-qr-fab` → `bottom:80px; right:24px; z-index:1000000`. Il menu si espande verso l'alto e **si chiude al click** su una voce.
- Pricing UI (`pricing.content.js`): `#ar-pricing-ui` → `bottom:150px; right:24px; z-index:999998` (sotto il FAB nello z-order, sopra nel layout verticale). Contiene `#ar-pricing-summary` e `#ar-pricing-toast`. Nessuna collisione col menu perché il menu si chiude al click, prima che summary/toast vengano mostrati.
- Toast import (`import.content.js`): invariato → `top:20px; right:20px; z-index:99999`.

---

## Task 1: Scaffold — porta i sorgenti pricing nel worktree

**Files:**
- Create: `pricing.content.js` (copia di `~/projects/pricing-ext-v5/content.js`)
- Rename: `content.js` → `import.content.js`

- [ ] **Step 1: Copia il sorgente pricing nel worktree**

Solo `content.js` — NON copiare `CHANGELOG-v6.1.md`, `firebase-debug.log`, `tasks/`, `.DS_Store`.

```bash
cp ~/projects/pricing-ext-v5/content.js /home/fede/arauto/quote-import-ext-unifica/pricing.content.js
```

- [ ] **Step 2: Rinomina il content script di quote-import**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git mv content.js import.content.js
```

- [ ] **Step 3: Verifica i file presenti**

Run: `ls /home/fede/arauto/quote-import-ext-unifica`
Expected: presenti `pricing.content.js`, `import.content.js`, `injected.js`, `defaults.js`, `manifest.json`, `options.html`, `options.js`, `popup.html`, `popup.js`, `icons/`, `CLAUDE.md`, `README.md`. Assente `content.js`.

- [ ] **Step 4: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add pricing.content.js import.content.js
git commit -m "chore: scaffold estensione unificata (porta pricing.content.js, rinomina import.content.js) (#2)"
```

---

## Task 2: `defaults.js` unico flat

**Files:**
- Modify: `defaults.js` (riscrittura completa)

- [ ] **Step 1: Riscrivi `defaults.js`**

Fonde tutte le chiavi di `pricing-ext-v5/defaults.js` e `quote-import-ext/defaults.js`. Zero collisioni di chiave. Le chiavi `fabBgColor`/`fabLabel`/`fabPosition` del vecchio quote-import **si eliminano** (il FAB unico ha il suo styling in `fab.js`). Si aggiungono le costanti di injection (prima hardcoded in `pricing-ext-v5/content.js`) perché ora le usa `fab.js`.

Contenuto completo di `defaults.js`:

```js
// defaults.js — single source of truth per l'estensione unificata "AR AUTO — Qricambi".
// Caricato prima di fab.js / pricing.content.js / import.content.js (content scripts)
// e di options.js / popup.js (pagine estensione).
// Version: 1.0.0
const DEFAULTS = {
  // ── Regole pricing (ex pricing-ext-v5 v6.1) ─────────────────────────
  regADelta: 20,
  regACapThreshold: 80,
  regACapValue: 70,
  regCThreshold: 78,
  regCMarkup: 77,
  regBMultiplier: 2.0,
  regBDiscount: 30,
  uiRoundStep: 5,
  uiThresholdLow: 10,
  uiThresholdHigh: 35,
  // ── Backend import SIRJ (ex quote-import-ext v0.5.0) ────────────────
  backendUrl: "http://100.86.223.69:5008/api/quote-import",
  apiKey: "",
  // ── FAB injection (usate da fab.js) ─────────────────────────────────
  fabZIndex: 1000000,
  injectionMaxAttempts: 8,
  injectionInitialDelayMs: 200,
  injectionMaxDelayMs: 30000,
};
```

Nota intenzionale: `pricing.content.js` continua a fare `chrome.storage.local.get(DEFAULTS, ...)` passando l'intero oggetto. Le chiavi extra (`backendUrl`, `apiKey`, `fab*`) finiscono in `S` ma il codice pricing non le legge — superset innocuo, nessun refactoring necessario.

- [ ] **Step 2: Verifica sintassi**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/defaults.js`
Expected: nessun output (sintassi valida).

- [ ] **Step 3: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add defaults.js
git commit -m "feat: defaults.js unico flat (pricing + backend + injection) (#2)"
```

---

## Task 3: `manifest.json` unificato

**Files:**
- Modify: `manifest.json` (riscrittura completa)

- [ ] **Step 1: Riscrivi `manifest.json`**

Contenuto completo:

```json
{
  "manifest_version": 3,
  "name": "AR AUTO — Qricambi",
  "version": "1.0.0",
  "description": "Pricing automatico + import preventivi Qricambi in SIRJ, in un'unica estensione.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "*://*.qricambi.com/*",
    "http://100.86.223.69:5008/*",
    "http://192.168.1.49:5008/*",
    "http://localhost:5008/*"
  ],
  "icons": { "128": "icons/icon128.png" },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["*://*.qricambi.com/*"],
      "js": ["injected.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["*://*.qricambi.com/*"],
      "js": ["defaults.js", "fab.js", "pricing.content.js", "import.content.js"],
      "run_at": "document_idle",
      "world": "ISOLATED"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "AR AUTO — Qricambi"
  }
}
```

- [ ] **Step 2: Verifica JSON valido**

Run: `node -e "JSON.parse(require('fs').readFileSync('/home/fede/arauto/quote-import-ext-unifica/manifest.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add manifest.json
git commit -m "feat: manifest unificato (AR AUTO — Qricambi v1.0.0, 4 content script) (#2)"
```

---

## Task 4: `fab.js` — FAB condiviso con menu a 2 voci

**Files:**
- Create: `fab.js`

- [ ] **Step 1: Crea `fab.js`**

Contenuto completo:

```js
// fab.js — Floating Action Button condiviso per l'estensione unificata "AR AUTO — Qricambi".
// Inietta UN solo FAB con un menu a 2 voci. pricing.content.js e import.content.js
// registrano i loro handler su window.__AR_QRICAMBI; questo modulo li cabla alle
// voci di menu. Caricato dopo defaults.js, prima dei due content script.
(function () {
  'use strict';
  const TAG = '[AR-QR-FAB v1.0.0]';
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
  `;

  // ── Elementi ──────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'ar-qr-fab';
  fab.innerHTML = `
    <div id="ar-qr-fab-menu">
      <button class="ar-qr-menu-item" id="ar-qr-menu-pricing">⚡ Applica Pricing</button>
      <button class="ar-qr-menu-item" id="ar-qr-menu-import">→ Importa in SIRJ</button>
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
```

- [ ] **Step 2: Verifica sintassi**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/fab.js`
Expected: nessun output (sintassi valida). Nota: `node -c` non valuta `DEFAULTS`/`window`/`document`, verifica solo la sintassi — è sufficiente in questo step.

- [ ] **Step 3: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add fab.js
git commit -m "feat: fab.js — FAB unico con menu a 2 voci + injection condivisa (#2)"
```

---

## Task 5: Adatta `pricing.content.js` al FAB condiviso

`pricing.content.js` perde il suo "guscio" FAB (button, injection, observer) e registra `window.__AR_QRICAMBI.onPricing`. La logica di business — `esegui`, `eseguiConIndici`, `setVueInput`, `mappaColonne`, `injectUtileColumn`, ecc. — **resta intatta**. Ogni step è un blocco isolato: se un edit va male, si reverta solo quel blocco.

**Files:**
- Modify: `pricing.content.js`

- [ ] **Step 1: Bump del TAG di versione**

In `pricing.content.js`, sostituisci:
```js
  const TAG = '[AR-PRICING v6.1]';
```
con:
```js
  const TAG = '[AR-PRICING v1.0.0]';
```

- [ ] **Step 2: Rimuovi le regole CSS del FAB**

Nel template literal `css.textContent`, rimuovi **solo** i blocchi delle regole `#ar-pricing-fab`, `#ar-pricing-btn`, `#ar-pricing-btn:hover`, `#ar-pricing-btn:active`, `#ar-pricing-btn:disabled` (il FAB ora è in `fab.js`). **Mantieni** tutte le altre regole: `#ar-pricing-toast` e varianti, `@keyframes ar-fade`, `.ar-flash-*`, `.ar-row-*`, `.ar-utile-cell`, `#ar-pricing-summary` e figli.

Sostituisci questo blocco iniziale del template:
```js
  css.textContent = `
    #ar-pricing-fab {
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, 'DM Sans', sans-serif;
    }
    #ar-pricing-btn {
      background: #e8ff47;
      color: #0e0f11;
      border: none;
      border-radius: 28px;
      padding: 12px 22px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(232,255,71,0.4);
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    #ar-pricing-btn:hover {
      background: #d4eb3a;
      transform: translateY(-2px);
      box-shadow: 0 6px 28px rgba(232,255,71,0.5);
    }
    #ar-pricing-btn:active { transform: translateY(0); }
    #ar-pricing-btn:disabled {
      background: #3a3d44;
      color: #6b7280;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }
    #ar-pricing-toast {
```
con:
```js
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
```

- [ ] **Step 3: Sostituisci l'elemento `fab` con il contenitore `#ar-pricing-ui`**

Il vecchio `fab` conteneva summary + toast + button. Il button se ne va; summary e toast restano in un contenitore dedicato. Sostituisci:
```js
  // ── FAB (creato una sola volta) ────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'ar-pricing-fab';
  fab.innerHTML = `
    <div id="ar-pricing-summary">
      <div class="label">Guadagno Totale Stimato</div>
      <div class="value" id="ar-total-value">0,00 €</div>
      <div id="ar-total-details" class="sub">0 righe elaborate</div>
    </div>
    <div id="ar-pricing-toast"></div>
    <button id="ar-pricing-btn">
      <span>⚡</span> APPLICA PRICING
    </button>
  `;
```
con:
```js
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
```

- [ ] **Step 4: Sostituisci `injectFab` + backoff con `injectPricingUi`**

Il contenitore `#ar-pricing-ui` serve solo quando l'utente clicca "Applica Pricing" (ben dopo il load): non serve il backoff elaborato, basta iniettarlo a `document_idle` con un fallback su `DOMContentLoaded`. La re-injection di sicurezza viene fatta dall'handler stesso (Step 5). Sostituisci l'intero blocco da:
```js
  // ── INJECTION ROBUSTA ─────────────────────────────────────
  function injectFab() {
    try {
      if (!document.body) return false;
      if (!document.head) return false;

      if (!document.getElementById('ar-pricing-style')) {
        css.id = 'ar-pricing-style';
        document.head.appendChild(css);
      }

      if (!document.getElementById('ar-pricing-fab')) {
        document.body.appendChild(fab);
        console.log(TAG, 'FAB iniettato nel DOM');
      }

      return true;
    } catch (e) {
      console.error(TAG, 'Errore injection:', e);
      return false;
    }
  }

  // ── EXPONENTIAL BACKOFF INJECTION (v6.1) ──────────────────
  // Riprova ad iniettare il FAB fino a 30 secondi per SPA lente
  // Usa exponential backoff: 200ms, 500ms, 1s, 2s, 4s, 8s, 15s, 30s
  let injectionAttempt = 0;
  const MAX_INJECTION_ATTEMPTS = 8;
  const BASE_DELAY = 200;
  const MAX_TOTAL_DELAY = 30000; // 30 secondi max
  let totalDelayAccum = 0;

  function scheduleNextInjection() {
    if (injectionAttempt >= MAX_INJECTION_ATTEMPTS || totalDelayAccum >= MAX_TOTAL_DELAY) {
      console.warn(TAG, 'Injection aborted after', injectionAttempt, 'attempts or 30s timeout');
      return;
    }

    const delay = Math.min(
      BASE_DELAY * Math.pow(2, injectionAttempt),
      MAX_TOTAL_DELAY - totalDelayAccum
    );

    totalDelayAccum += delay;
    injectionAttempt++;

    setTimeout(() => {
      if (injectFab()) {
        console.log(TAG, `FAB injected successfully on attempt ${injectionAttempt} (delay ${delay}ms)`);
      } else {
        scheduleNextInjection(); // Schedula prossimo tentativo
      }
    }, delay);
  }

  // Trigger iniziale immediato
  if (!injectFab()) {
    // Se fallisce subito, schedula retry con backoff
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleNextInjection);
    } else {
      scheduleNextInjection(); // Already loaded, start backoff
    }
  }
```
con:
```js
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
```

- [ ] **Step 5: Sostituisci il click handler con la registrazione di `onPricing`**

L'handler non gestisce più un bottone proprio (lo fa `fab.js`, che disabilita la voce di menu durante l'`await`). Chiama `injectPricingUi()` come prima cosa (rete di sicurezza se l'SPA ha ripulito il body). Sostituisci l'intero blocco da:
```js
  // ── CLICK HANDLER ─────────────────────────────────────────
  fab.addEventListener('click', (e) => {
    if (!e.target.closest('#ar-pricing-btn')) return;
    const btn = document.getElementById('ar-pricing-btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Analisi...';

    setTimeout(async () => {
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

          // Aggiorna Widget Totale
          updateSummaryWidget(res);
        }
      } catch (e) {
        console.error(TAG, 'Errore esecuzione pricing:', e);
        showToast(`<b>Errore</b><br><span class="m">${escHtml(e.message)}</span>`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡</span> APPLICA PRICING';
      }
    }, 200);
  });
```
con:
```js
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
```

Nota: `esegui()` contiene `const btn = document.getElementById('ar-pricing-btn'); const onProgress = (current, total) => { if (btn && total > 5) {...} }`. Con il bottone rimosso, `btn` è `null` e `onProgress` è già null-safe (`if (btn && ...)`) → **nessuna modifica a `esegui()`**.

- [ ] **Step 6: Rimuovi il MutationObserver finale**

`fab.js` possiede la re-injection del FAB; `injectPricingUi()` viene richiamato dall'handler. Rimuovi l'intero blocco finale:
```js
  // ── SPA OBSERVER ─────────────────────────────────────────
  const bodyObserver = new MutationObserver(() => {
    if (!document.getElementById('ar-pricing-fab') && document.body) {
      console.log(TAG, 'FAB rimosso dal DOM, reinjecting...');
      document.body.appendChild(fab);
    }
  });

  if (document.body) {
    bodyObserver.observe(document.body, { childList: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      bodyObserver.observe(document.body, { childList: true });
      injectFab();
    });
  }

})();
```
con:
```js
})();
```

- [ ] **Step 7: Verifica sintassi**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/pricing.content.js`
Expected: nessun output. Verifica anche che non resti nessun riferimento al vecchio guscio:
Run: `grep -nE "ar-pricing-fab|ar-pricing-btn|injectFab|bodyObserver|scheduleNextInjection" /home/fede/arauto/quote-import-ext-unifica/pricing.content.js`
Expected: nessun output (tutti i riferimenti rimossi).

- [ ] **Step 8: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add pricing.content.js
git commit -m "feat: pricing.content.js usa il FAB condiviso (rimosso guscio FAB, registra onPricing) (#2)"
```

---

## Task 6: Adatta `import.content.js` al FAB condiviso + storico import

`import.content.js` perde il FAB proprio, registra `window.__AR_QRICAMBI.onImport`, sposta la lettura config da `chrome.storage.sync` a `chrome.storage.local`, e scrive lo storico import su tutti i rami della risposta. Il listener `postMessage` e la funzione `toast` restano invariati.

**Files:**
- Modify: `import.content.js`
- Modify: `injected.js` (solo bump TAG)

- [ ] **Step 1: Bump del TAG di versione in `import.content.js`**

Sostituisci:
```js
  const TAG = "[QUOTE-IMPORT v0.5.0]";
```
con:
```js
  const TAG = "[QUOTE-IMPORT v1.0.0]";
```

- [ ] **Step 2: Rimuovi l'injection del FAB proprio**

Rimuovi l'intero blocco da:
```js
  // ── 2. FAB injection con backoff (riuso pattern pricing-ext-v5) ──────
  function injectFab(attempt) {
    if (document.getElementById("ar-quote-import-fab")) return;
    const btn = document.createElement("button");
    btn.id = "ar-quote-import-fab";
    btn.textContent = DEFAULTS.fabLabel;
    btn.style.cssText = `
      position:fixed;right:${DEFAULTS.fabPosition.right};
      bottom:${DEFAULTS.fabPosition.bottom};z-index:${DEFAULTS.fabZIndex || 1000000};
      background:${DEFAULTS.fabBgColor};color:white;border:0;
      padding:12px 18px;border-radius:30px;font-weight:600;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;font-size:14px;
    `;
    btn.onclick = handleClick;
    document.body.appendChild(btn);
    console.log(TAG, "FAB injected on attempt", attempt);
  }

  function startInjection() {
    let attempt = 1, delay = DEFAULTS.injectionInitialDelayMs;
    function tryInject() {
      if (document.body) { injectFab(attempt); return; }
      if (attempt++ >= DEFAULTS.injectionMaxAttempts) {
        console.warn(TAG, "Injection aborted after max attempts"); return;
      }
      delay = Math.min(delay * 2, DEFAULTS.injectionMaxDelayMs);
      setTimeout(tryInject, delay);
    }
    tryInject();
  }
  startInjection();

  // ── 3. Click handler: leggi payload, conferma, POST al backend ──────
  async function handleClick() {
```
con:
```js
  // ── 2. Handler import: registrato su window.__AR_QRICAMBI per il menu FAB ──
  window.__AR_QRICAMBI = window.__AR_QRICAMBI || { onPricing: null, onImport: null };

  // Storico import: array FIFO (cap 50) in chrome.storage.local.importHistory
  async function appendToHistory(record) {
    const stored = await new Promise((resolve) =>
      chrome.storage.local.get({ importHistory: [] }, resolve));
    const history = Array.isArray(stored.importHistory) ? stored.importHistory : [];
    history.unshift(record);
    if (history.length > 50) history.length = 50;
    await new Promise((resolve) =>
      chrome.storage.local.set({ importHistory: history }, resolve));
  }

  async function handleClick() {
```

- [ ] **Step 3: Sposta la lettura config su `chrome.storage.local`**

Dentro `handleClick`, sostituisci:
```js
    const cfg = await new Promise((resolve) =>
      chrome.storage.sync.get(DEFAULTS, resolve));
```
con:
```js
    const cfg = await new Promise((resolve) =>
      chrome.storage.local.get(DEFAULTS, resolve));
```

- [ ] **Step 4: Sostituisci il blocco POST + gestione risposta con la versione che scrive lo storico**

Sostituisci l'intero blocco da:
```js
    btnLoading(true);
    try {
      const res = await fetch(cfg.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.status === 200) {
        chrome.storage.local.set({
          lastQricambiId: payload.ID,
          lastSirjNumero: body.sirj_numero,
          lastSirjAnno: body.sirj_anno,
          lastError: null,
        });
        toast(`✓ Importato come PR3 ${body.sirj_numero}/${body.sirj_anno}`, "ok");
      } else if (res.status === 409) {
        toast(`Già importato: PR3 ${body.sirj_numero}/${body.sirj_anno}`, "warn");
      } else if (res.status === 422) {
        toast(`Cliente non trovato in SIRJ. Codice Qricambi: ${body.customer_hint?.CustomerCode || "?"}`, "err");
      } else {
        chrome.storage.local.set({ lastError: body.error || res.statusText });
        toast(`Errore ${res.status}: ${body.error || res.statusText}`, "err");
      }
    } catch (e) {
      chrome.storage.local.set({ lastError: e.message });
      toast(`Errore rete: ${e.message}`, "err");
    } finally {
      btnLoading(false);
    }
  }

  function btnLoading(on) {
    const b = document.getElementById("ar-quote-import-fab");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "…" : DEFAULTS.fabLabel;
  }
```
con:
```js
    const baseRecord = {
      ts: Date.now(),
      qricambiId: payload.ID,
      customer: payload.customerdata?.CustomerName || "(?)",
      car: payload.car || "",
      itemsCount: payload.items.length,
      total: payload.total || 0,
    };

    try {
      const res = await fetch(cfg.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.status === 200) {
        await appendToHistory({ ...baseRecord, status: "ok",
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        toast(`✓ Importato come PR3 ${body.sirj_numero}/${body.sirj_anno}`, "ok");
      } else if (res.status === 409) {
        await appendToHistory({ ...baseRecord, status: "dup",
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        toast(`Già importato: PR3 ${body.sirj_numero}/${body.sirj_anno}`, "warn");
      } else if (res.status === 422) {
        await appendToHistory({ ...baseRecord, status: "err",
          sirjNumero: null, sirjAnno: null, error: "Cliente non trovato in SIRJ" });
        toast(`Cliente non trovato in SIRJ. Codice Qricambi: ${body.customer_hint?.CustomerCode || "?"}`, "err");
      } else {
        await appendToHistory({ ...baseRecord, status: "err",
          sirjNumero: null, sirjAnno: null, error: body.error || res.statusText });
        toast(`Errore ${res.status}: ${body.error || res.statusText}`, "err");
      }
    } catch (e) {
      await appendToHistory({ ...baseRecord, status: "err",
        sirjNumero: null, sirjAnno: null, error: e.message });
      toast(`Errore rete: ${e.message}`, "err");
    }
  }
```

(Le chiavi legacy `lastQricambiId`/`lastSirjNumero`/`lastSirjAnno`/`lastError` e la funzione `btnLoading` sono eliminate; `fab.js` gestisce il disabilitamento della voce di menu durante l'`await`.)

- [ ] **Step 5: Registra `onImport` in coda allo script**

In fondo a `import.content.js`, subito prima della riga di chiusura dell'IIFE `})();`, aggiungi:
```js
  // ── 5. Registrazione handler per il menu FAB ────────────────────────
  window.__AR_QRICAMBI.onImport = handleClick;
```

- [ ] **Step 6: Bump del TAG in `injected.js`**

In `injected.js`, sostituisci `v0.5.0` con `v1.0.0` nelle due occorrenze del TAG. Sostituisci:
```js
  const TAG = "[QUOTE-IMPORT MAIN v0.5.0]";
```
con:
```js
  const TAG = "[QUOTE-IMPORT MAIN v1.0.0]";
```
(Il TAG è usato in più `console.log` ma è una sola `const` — basta cambiarla.)

- [ ] **Step 7: Verifica sintassi e residui**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/import.content.js && node -c /home/fede/arauto/quote-import-ext-unifica/injected.js`
Expected: nessun output.
Run: `grep -nE "ar-quote-import-fab|btnLoading|startInjection|storage\.sync|lastQricambiId" /home/fede/arauto/quote-import-ext-unifica/import.content.js`
Expected: nessun output (FAB proprio, sync e chiavi legacy rimossi).

- [ ] **Step 8: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add import.content.js injected.js
git commit -m "feat: import.content.js usa FAB condiviso + storico import su chrome.storage.local (#2)"
```

---

## Task 7: Options page unificata

Una sola pagina dark-themed con i parametri pricing (ex `pricing-ext-v5/options.html`) **più** una sezione "Import SIRJ" con `backendUrl` e `apiKey`. Tutto su `chrome.storage.local`. Il bottone "Ripristina Default" resetta **solo** i parametri pricing — `backendUrl` e `apiKey` (specie l'API key) non vengono toccati.

**Files:**
- Modify: `options.html` (riscrittura completa)
- Modify: `options.js` (riscrittura completa)

- [ ] **Step 1: Riscrivi `options.html`**

Si parte dal `pricing-ext-v5/options.html` (tema dark, font Syne/DM Sans/DM Mono, sezioni `.section`) e si aggiunge una sezione "Import SIRJ". Contenuto completo:

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Impostazioni AR AUTO — Qricambi</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap');
    :root {
      --bg: #0e0f11; --surface: #16181c; --border: #2a2d34;
      --accent: #e8ff47; --accent2: #47c8ff; --accent3: #fb923c;
      --green: #4ade80; --red: #f87171; --text: #e8eaed; --muted: #6b7280;
    }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif;
      margin: 0; padding: 40px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 600px; }
    header { margin-bottom: 40px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    h1 { font-family: 'Syne', sans-serif; font-size: 28px; font-weight: 800; margin: 0; }
    h1 span { color: var(--accent); }
    .section { background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section-title { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 700;
      margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .section-title.reg-a { color: var(--accent); }
    .section-title.reg-b { color: var(--accent2); }
    .section-title.reg-c { color: var(--accent3); }
    .section-title.import { color: var(--green); }
    .form-group { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
    label { font-size: 13px; font-weight: 500; color: var(--muted); }
    .input-row { display: flex; align-items: center; gap: 12px; }
    input[type="number"], input[type="text"], input[type="password"] {
      background: #0a0b0d; border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); padding: 8px 12px; font-family: 'DM Mono', monospace; font-size: 14px; }
    input[type="number"] { width: 100px; }
    input[type="text"], input[type="password"] { width: 100%; }
    input:focus { outline: none; border-color: var(--accent); }
    .description { font-size: 12px; color: var(--muted); line-height: 1.5; }
    .actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; }
    button { font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
      padding: 10px 24px; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
    #save-btn { background: var(--accent); color: var(--bg); border: none; }
    #save-btn:hover { background: #d4eb3a; transform: translateY(-1px); }
    #reset-btn { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    #reset-btn:hover { color: var(--text); border-color: var(--muted); }
    .status-msg { margin-top: 16px; text-align: right; font-size: 12px;
      font-family: 'DM Mono', monospace; opacity: 0; transition: opacity 0.3s; }
    .status-msg.show { opacity: 1; color: var(--green); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>AR <span>AUTO</span> — QRICAMBI</h1>
      <p style="color: var(--muted); font-size: 14px; margin-top: 8px;">Configurazione estensione unificata v1.0.0</p>
    </header>

    <div class="section">
      <div class="section-title reg-a">Regola A (con listino)</div>
      <div class="form-group"><label>Delta Sconto (pp)</label>
        <div class="input-row"><input type="number" id="reg-a-delta" value="20">
        <span class="description">Valore sottratto allo sconto fornitore (es. -20pp).</span></div></div>
      <div class="form-group"><label>Soglia Cap Fornitore (%)</label>
        <div class="input-row"><input type="number" id="reg-a-cap-threshold" value="80">
        <span class="description">Se lo sconto fornitore supera questo valore...</span></div></div>
      <div class="form-group"><label>Sconto Fisso Cap (%)</label>
        <div class="input-row"><input type="number" id="reg-a-cap-value" value="70">
        <span class="description">...applica questo sconto fisso al cliente.</span></div></div>
    </div>

    <div class="section">
      <div class="section-title reg-c">Regola C (ricarico fisso)</div>
      <div class="form-group"><label>Soglia Attivazione (%)</label>
        <div class="input-row"><input type="number" id="reg-c-threshold" value="78">
        <span class="description">Attiva Regola C se lo sconto fornitore > questo valore.</span></div></div>
      <div class="form-group"><label>Percentuale Ricarico (%)</label>
        <div class="input-row"><input type="number" id="reg-c-markup" value="77">
        <span class="description">Ricarico fisso sul prezzo netto di acquisto.</span></div></div>
    </div>

    <div class="section">
      <div class="section-title reg-b">Regola B (senza listino)</div>
      <div class="form-group"><label>Moltiplicatore Listino</label>
        <div class="input-row"><input type="number" step="0.1" id="reg-b-multiplier" value="2">
        <span class="description">Prezzo acquisto × Moltiplicatore = Listino fittizio.</span></div></div>
      <div class="form-group"><label>Sconto Cliente (%)</label>
        <div class="input-row"><input type="number" id="reg-b-discount" value="30">
        <span class="description">Sconto applicato al listino fittizio.</span></div></div>
    </div>

    <div class="section">
      <div class="section-title" style="color: var(--text)">UI & Logica Visuale</div>
      <div class="form-group"><label>Passo Arrotondamento Sconto</label>
        <div class="input-row"><input type="number" id="ui-round-step" value="5">
        <span class="description">Arrotonda lo sconto calcolato a questo multiplo (es. 5pp).</span></div></div>
      <div class="form-group"><label>Soglia "Utile Basso" (%)</label>
        <div class="input-row"><input type="number" id="ui-threshold-low" value="10">
        <span class="description">Sotto questa % di ricarico, la riga diventa ROSSA.</span></div></div>
      <div class="form-group"><label>Soglia "Utile Alto" (%)</label>
        <div class="input-row"><input type="number" id="ui-threshold-high" value="35">
        <span class="description">Sopra questa % di ricarico, la riga diventa VERDE.</span></div></div>
    </div>

    <div class="section">
      <div class="section-title import">Import SIRJ</div>
      <div class="form-group"><label for="backendUrl">Backend URL</label>
        <input type="text" id="backendUrl" placeholder="http://100.86.223.69:5008/api/quote-import">
        <span class="description">Endpoint del bridge qricambi (porta 5008). Tailscale: 100.86.223.69 — LAN: 192.168.1.49.</span></div>
      <div class="form-group"><label for="apiKey">X-API-Key</label>
        <input type="password" id="apiKey" placeholder="da /opt/arauto/.env ARAUTO_API_KEY">
        <span class="description">Valore di ARAUTO_API_KEY. Non viene toccato da "Ripristina Default".</span></div>
    </div>

    <div class="actions">
      <button id="reset-btn">Ripristina Default Pricing</button>
      <button id="save-btn">Salva Impostazioni</button>
    </div>
    <div id="status" class="status-msg">Impostazioni salvate con successo!</div>
  </div>

  <script src="defaults.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Riscrivi `options.js`**

Fonde la validazione pricing di `pricing-ext-v5/options.js` con la gestione `backendUrl`/`apiKey`. Tutto su `chrome.storage.local`. Reset = solo chiavi pricing. Contenuto completo:

```js
// options.js — estensione unificata "AR AUTO — Qricambi"
// DEFAULTS è caricato da defaults.js. Tutto lo storage è chrome.storage.local.

// Chiavi dei soli parametri pricing (usate dal reset, che NON tocca backendUrl/apiKey).
const PRICING_KEYS = [
  'regADelta', 'regACapThreshold', 'regACapValue',
  'regCThreshold', 'regCMarkup', 'regBMultiplier', 'regBDiscount',
  'uiRoundStep', 'uiThresholdLow', 'uiThresholdHigh',
];

// Regole di validazione: [min, max, descrizione]
const VALIDATION_RULES = {
  'reg-a-delta':         [0,   50,  'Delta Sconto (0–50pp)'],
  'reg-a-cap-threshold': [50,  99,  'Soglia Cap Fornitore (50–99%)'],
  'reg-a-cap-value':     [0,   99,  'Sconto Fisso Cap (0–99%)'],
  'reg-c-threshold':     [50,  99,  'Soglia Attivazione C (50–99%)'],
  'reg-c-markup':        [1,   200, 'Percentuale Ricarico (1–200%)'],
  'reg-b-multiplier':    [1.1, 10,  'Moltiplicatore Listino (1.1–10)'],
  'reg-b-discount':      [0,   99,  'Sconto Cliente B (0–99%)'],
  'ui-round-step':       [1,   20,  'Passo Arrotondamento (1–20)'],
  'ui-threshold-low':    [0,   99,  'Soglia Utile Basso (0–99%)'],
  'ui-threshold-high':   [0,   200, 'Soglia Utile Alto (0–200%)'],
};

function loadSettings() {
  chrome.storage.local.get(DEFAULTS, (s) => {
    document.getElementById('reg-a-delta').value = s.regADelta;
    document.getElementById('reg-a-cap-threshold').value = s.regACapThreshold;
    document.getElementById('reg-a-cap-value').value = s.regACapValue;
    document.getElementById('reg-c-threshold').value = s.regCThreshold;
    document.getElementById('reg-c-markup').value = s.regCMarkup;
    document.getElementById('reg-b-multiplier').value = s.regBMultiplier;
    document.getElementById('reg-b-discount').value = s.regBDiscount;
    document.getElementById('ui-round-step').value = s.uiRoundStep;
    document.getElementById('ui-threshold-low').value = s.uiThresholdLow;
    document.getElementById('ui-threshold-high').value = s.uiThresholdHigh;
    document.getElementById('backendUrl').value = s.backendUrl;
    document.getElementById('apiKey').value = s.apiKey;
    clearAllErrors();
  });
}

function clearAllErrors() {
  document.querySelectorAll('input[type="number"]').forEach(el => { el.style.borderColor = ''; });
  document.querySelectorAll('.validation-error').forEach(el => el.remove());
}

function showFieldError(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  input.style.borderColor = 'var(--red)';
  const existing = input.parentElement.querySelector('.validation-error');
  if (existing) existing.remove();
  const err = document.createElement('span');
  err.className = 'validation-error';
  err.style.cssText = 'color: var(--red); font-size: 11px; font-family: "DM Mono", monospace;';
  err.textContent = message;
  input.parentElement.appendChild(err);
}

function validateAll() {
  clearAllErrors();
  let valid = true;
  for (const [id, [min, max, label]] of Object.entries(VALIDATION_RULES)) {
    const input = document.getElementById(id);
    if (!input) continue;
    const v = parseFloat(input.value);
    if (isNaN(v)) { showFieldError(id, `${label}: valore non valido`); valid = false; }
    else if (v < min || v > max) { showFieldError(id, `${label}: deve essere tra ${min} e ${max}`); valid = false; }
  }
  const cThresh = parseFloat(document.getElementById('reg-c-threshold').value);
  const capThresh = parseFloat(document.getElementById('reg-a-cap-threshold').value);
  if (!isNaN(cThresh) && !isNaN(capThresh) && cThresh >= capThresh) {
    showFieldError('reg-c-threshold', 'Soglia C deve essere < Soglia Cap A (' + capThresh + '%)');
    valid = false;
  }
  return valid;
}

function flashStatus(text, isError) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.style.color = isError ? 'var(--red)' : '';
  status.className = 'status-msg show';
  setTimeout(() => {
    status.className = 'status-msg';
    status.style.color = '';
    status.textContent = 'Impostazioni salvate con successo!';
  }, isError ? 3000 : 2500);
}

function saveSettings() {
  if (!validateAll()) { flashStatus('Correggi gli errori prima di salvare.', true); return; }
  const getNum = (id) => parseFloat(document.getElementById(id).value);
  const settings = {
    regADelta:        getNum('reg-a-delta'),
    regACapThreshold: getNum('reg-a-cap-threshold'),
    regACapValue:     getNum('reg-a-cap-value'),
    regCThreshold:    getNum('reg-c-threshold'),
    regCMarkup:       getNum('reg-c-markup'),
    regBMultiplier:   getNum('reg-b-multiplier'),
    regBDiscount:     getNum('reg-b-discount'),
    uiRoundStep:      getNum('ui-round-step'),
    uiThresholdLow:   getNum('ui-threshold-low'),
    uiThresholdHigh:  getNum('ui-threshold-high'),
    backendUrl:       document.getElementById('backendUrl').value.trim(),
    apiKey:           document.getElementById('apiKey').value.trim(),
  };
  chrome.storage.local.set(settings, () => flashStatus('Impostazioni salvate con successo!', false));
}

function resetSettings() {
  if (!confirm('Ripristinare i parametri PRICING ai default? (backendUrl e API key non vengono toccati)')) return;
  const pricingDefaults = {};
  for (const k of PRICING_KEYS) pricingDefaults[k] = DEFAULTS[k];
  chrome.storage.local.set(pricingDefaults, () => {
    loadSettings();
    flashStatus('Parametri pricing ripristinati!', false);
  });
}

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('reset-btn').addEventListener('click', resetSettings);
```

- [ ] **Step 3: Verifica sintassi**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/options.js`
Expected: nessun output.

- [ ] **Step 4: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add options.html options.js
git commit -m "feat: options page unificata (pricing + backend, storage.local, reset solo pricing) (#2)"
```

---

## Task 8: Popup unificato con storico import

Popup dark-themed. Mostra: header + gear impostazioni; **storico import** (lista scrollabile, ultimi 20 record da `chrome.storage.local.importHistory`, esito colorato); riassunto regole pricing in una sezione collassabile (`<details>`).

**Files:**
- Modify: `popup.html` (riscrittura completa)
- Modify: `popup.js` (riscrittura completa)

- [ ] **Step 1: Riscrivi `popup.html`**

Contenuto completo:

```html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>AR AUTO — Qricambi</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap');
    :root {
      --bg: #0e0f11; --surface: #16181c; --border: #2a2d34;
      --accent: #e8ff47; --green: #4ade80; --orange: #fb923c; --red: #f87171;
      --text: #e8eaed; --muted: #6b7280;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 320px; background: var(--bg); color: var(--text);
      font-family: 'DM Sans', sans-serif; font-weight: 300; padding: 16px; }
    .header { display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    h1 { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800; }
    h1 span { color: var(--accent); }
    #open-options { background: none; border: none; cursor: pointer; color: var(--muted);
      padding: 4px; display: flex; align-items: center; }
    #open-options:hover { color: var(--text); }
    .label { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
    #history { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .hist-row { background: var(--surface); border: 1px solid var(--border);
      border-left-width: 3px; border-radius: 6px; padding: 8px 10px; font-size: 11px; }
    .hist-row.ok  { border-left-color: var(--green); }
    .hist-row.dup { border-left-color: var(--orange); }
    .hist-row.err { border-left-color: var(--red); }
    .hist-line1 { display: flex; justify-content: space-between; gap: 8px; }
    .hist-customer { font-weight: 500; color: var(--text); }
    .hist-time { font-family: 'DM Mono', monospace; font-size: 9px; color: var(--muted); white-space: nowrap; }
    .hist-line2 { color: var(--muted); margin-top: 3px; }
    .hist-outcome { font-family: 'DM Mono', monospace; font-size: 10px; margin-top: 3px; }
    .hist-outcome.ok  { color: var(--green); }
    .hist-outcome.dup { color: var(--orange); }
    .hist-outcome.err { color: var(--red); }
    .empty { color: var(--muted); font-size: 12px; padding: 12px 0; }
    details { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
    summary { cursor: pointer; font-family: 'DM Mono', monospace; font-size: 10px;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .rule { background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 10px; margin-top: 8px; font-size: 11px; color: var(--muted); line-height: 1.5; }
    .rule code { font-family: 'DM Mono', monospace; color: var(--text);
      background: #0a0b0d; padding: 1px 4px; border-radius: 3px; }
    .footer { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);
      font-family: 'DM Mono', monospace; font-size: 9px; color: var(--border); }
  </style>
</head>
<body>
  <div class="header">
    <h1>AR <span>AUTO</span> — QRICAMBI</h1>
    <button id="open-options" title="Impostazioni" aria-label="Apri impostazioni">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V11a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
    </button>
  </div>

  <div class="label">Storico Import → SIRJ</div>
  <div id="history"><div class="empty">Caricamento…</div></div>

  <details>
    <summary>Regole Pricing</summary>
    <div class="rule"><b>Regola A</b> — con listino (sconto ≤ 78pp): sconto cliente = sconto fornitore <code>− 20pp</code>.</div>
    <div class="rule"><b>Regola C</b> — listino + sconto &gt; 78pp: prezzo cliente = netto <code>× 1.77</code>.</div>
    <div class="rule"><b>Regola B</b> — senza listino: listino fittizio = netto <code>× 2</code>, sconto <code>30%</code>.</div>
  </details>

  <div class="footer">AR AUTO — Qricambi v1.0.0</div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Riscrivi `popup.js`**

Legge `importHistory` da `chrome.storage.local`, rende le ultime 20 righe. Costruzione DOM via `textContent` (nessun dato in `innerHTML`). Contenuto completo:

```js
// popup.js — estensione unificata "AR AUTO — Qricambi"
// Rende lo storico import da chrome.storage.local.importHistory.

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function outcomeText(rec) {
  if (rec.status === 'ok')  return `✓ PR3 ${rec.sirjNumero}/${rec.sirjAnno}`;
  if (rec.status === 'dup') return `↺ già importato: PR3 ${rec.sirjNumero}/${rec.sirjAnno}`;
  return `✗ ${rec.error || 'errore'}`;
}

function renderHistory(history) {
  const container = document.getElementById('history');
  container.textContent = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nessun import registrato.';
    container.appendChild(empty);
    return;
  }
  history.slice(0, 20).forEach((rec) => {
    const row = document.createElement('div');
    row.className = `hist-row ${rec.status}`;

    const line1 = document.createElement('div');
    line1.className = 'hist-line1';
    const customer = document.createElement('span');
    customer.className = 'hist-customer';
    customer.textContent = rec.customer || '(?)';
    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = fmtTime(rec.ts);
    line1.appendChild(customer);
    line1.appendChild(time);

    const line2 = document.createElement('div');
    line2.className = 'hist-line2';
    const carPart = rec.car ? `${rec.car} · ` : '';
    line2.textContent = `${carPart}${rec.itemsCount} articoli · €${rec.total}`;

    const outcome = document.createElement('div');
    outcome.className = `hist-outcome ${rec.status}`;
    outcome.textContent = outcomeText(rec);

    row.appendChild(line1);
    row.appendChild(line2);
    row.appendChild(outcome);
    container.appendChild(row);
  });
}

chrome.storage.local.get({ importHistory: [] }, (s) => {
  const history = Array.isArray(s.importHistory) ? s.importHistory : [];
  renderHistory(history);
});

document.getElementById('open-options').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('options.html'));
});
```

- [ ] **Step 3: Verifica sintassi**

Run: `node -c /home/fede/arauto/quote-import-ext-unifica/popup.js`
Expected: nessun output.

- [ ] **Step 4: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add popup.html popup.js
git commit -m "feat: popup unificato con storico import (#2)"
```

---

## Task 9: Documentazione + verifica manuale end-to-end

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Riscrivi `CLAUDE.md`**

Contenuto completo:

```markdown
# CLAUDE.md — AR AUTO — Qricambi (estensione unificata)

Chrome Extension MV3 che gira su `*.qricambi.com`. Unifica due estensioni
precedenti: il **pricing automatico** (ex `pricing-ext-v5`) e l'**import
preventivi in SIRJ** (ex `quote-import-ext`).

## Caricamento

No build step. `chrome://extensions` → "Carica estensione non pacchettizzata"
→ seleziona questa cartella. Dopo ogni modifica: ricarica l'estensione + refresh
della pagina Qricambi.

## Architettura

Un solo FAB su `*.qricambi.com`, con un menu a 2 voci:
- **⚡ Applica Pricing** → regole pricing A/B/C sulle tabelle preventivo Vue 3.
- **→ Importa in SIRJ** → invia il preventivo corrente come PR3 al bridge `:5008`.

### Content scripts

| File | Mondo | Responsabilità |
|---|---|---|
| `injected.js` | MAIN, document_start | Hook `fetch`/`XHR`, intercetta `PATCH /api/Quote`, posta il payload via `postMessage` |
| `defaults.js` | ISOLATED, document_idle | Unico `const DEFAULTS` flat (pricing + backend + injection) |
| `fab.js` | ISOLATED, document_idle | Inietta l'unico FAB + menu, espone `window.__AR_QRICAMBI = { onPricing, onImport }` |
| `pricing.content.js` | ISOLATED, document_idle | Logica pricing + `setVueInput`; registra `onPricing` |
| `import.content.js` | ISOLATED, document_idle | Listener `postMessage` + POST a SIRJ + storico import; registra `onImport` |

`fab.js` carica per primo fra i tre script ISOLATED dipendenti da `DEFAULTS` e
crea `window.__AR_QRICAMBI`; i due content script vi registrano il loro handler.

### Storage

Tutto su `chrome.storage.local`:
- parametri pricing + `backendUrl` + `apiKey` (config, gestita da `options.html`);
- `lastPatchPayload` (ultimo payload intercettato da `injected.js`);
- `importHistory` (array FIFO, cap 50 — vedi sotto).

### setVueInput (in `pricing.content.js`)

Funzione critica — Vue 3 può sovrascrivere i valori. Approccio a 4 livelli
(`execCommand` → native setter → `__vueParentComponent` emit → verification loop).
**Non semplificare mai `setVueInput()`** — la complessità gestisce la reattività Vue.

### Storico import

`import.content.js` appende un record a `chrome.storage.local.importHistory` su
**tutti** i rami della risposta POST (200/409/422/errore rete). Array FIFO cap 50.
Il popup ne mostra gli ultimi 20.

## Debug

```
F12 → Console → filtra "[AR-PRICING" | "[QUOTE-IMPORT" | "[AR-QR-FAB"
```

## Coerenza versione

Le stringhe versione vanno tenute in sync: `manifest.json:version`, i `TAG` di
`fab.js` / `pricing.content.js` / `import.content.js` / `injected.js`, commento
in `defaults.js`, footer di `popup.html` e `options.html`.
```

- [ ] **Step 2: Riscrivi `README.md`**

Contenuto completo:

```markdown
# AR AUTO — Qricambi

Estensione Chrome (Manifest v3) per `*.qricambi.com`. Unifica pricing automatico
e import preventivi in SIRJ in un'unica estensione con un solo FAB a 2 voci.

## Installazione

1. `chrome://extensions` → attiva "Modalità sviluppatore".
2. "Carica estensione non pacchettizzata" → seleziona questa cartella.
3. Apri il popup dell'estensione → ingranaggio → configura **Backend URL** e
   **X-API-Key** (vedi sotto).

## Configurazione backend (import SIRJ)

| Contesto | Backend URL |
|---|---|
| Mac in LAN AR AUTO (192.168.1.x) | `http://192.168.1.49:5008/api/quote-import` |
| Mac via Tailscale | `http://100.86.223.69:5008/api/quote-import` |

`X-API-Key` = valore di `ARAUTO_API_KEY` in `/opt/arauto/.env` sul server.

## Uso

Su una pagina preventivo Qricambi compare il FAB **≡ AR AUTO** in basso a destra.
Click → menu:

- **⚡ Applica Pricing** — applica le regole A/B/C alle righe del preventivo.
- **→ Importa in SIRJ** — invia il preventivo corrente come PR3. Prima modifica/
  salva il preventivo (anche un solo blur) così `injected.js` lo intercetta.

Il popup dell'estensione mostra lo **storico import** (ultimi 20, con esito).

## Storico import

Ogni import (riuscito, duplicato o errore) viene registrato in
`chrome.storage.local.importHistory` — array FIFO, max 50 record. Lo storico è
locale al profilo Chrome.
```

- [ ] **Step 3: Verifica struttura finale del repo**

Run: `cd /home/fede/arauto/quote-import-ext-unifica && ls && git status --short`
Expected: presenti tutti i file della tabella "File Structure"; `git status` pulito (tutto committato fino a Task 8, restano da committare solo `CLAUDE.md` e `README.md`).

- [ ] **Step 4: Verifica manuale end-to-end (checklist dello spec)**

Caricare l'estensione unpacked in `chrome://extensions` e verificare, uno per uno:

1. **Caricamento pulito** — nessun errore manifest in `chrome://extensions`; aprendo una pagina Qricambi, console (F12) senza errori al boot di `injected.js` / `fab.js` / `pricing.content.js` / `import.content.js`.
2. **FAB unico** — su una pagina preventivo Qricambi compare **un solo** FAB (`≡ AR AUTO`); il click apre il menu con le 2 voci; il click su una voce chiude il menu.
3. **Pricing** — la voce "⚡ Applica Pricing" applica le regole A/B/C come la vecchia `pricing-ext-v5` v6.1: confrontare su un preventivo di prova i valori sconto/vendita prima/dopo. Il widget "Guadagno Totale Stimato" e il toast compaiono in basso a destra senza coprire il FAB.
4. **Import** — la voce "→ Importa in SIRJ" importa come PR3 come la vecchia `quote-import-ext` v0.5.0: verificare i 4 esiti (200 ok, 409 duplicato, 422 cliente non trovato, errore rete) con i rispettivi toast.
5. **Storico** — dopo un import, aprire il popup: il nuovo record è in cima alla lista, con esito colorato corretto (verde ok / arancio dup / rosso err) e `PR3 numero/anno` o messaggio errore. Fare >50 import (o pre-popolare `importHistory` da console) e verificare che il più vecchio cada (cap 50).
6. **Options** — la options page salva e rilegge sia i parametri pricing sia `backendUrl`/`apiKey`. "Ripristina Default Pricing" resetta i parametri pricing ma **lascia intatti** `backendUrl` e `apiKey`.

Annotare l'esito di ogni punto. Se un punto fallisce, **non** marcare il task completato: aprire un'issue GitHub col sintomo e correggere prima di proseguire.

- [ ] **Step 5: Commit**

```bash
cd /home/fede/arauto/quote-import-ext-unifica
git add CLAUDE.md README.md
git commit -m "docs: CLAUDE.md + README per l'estensione unificata (#2)"
```

---

## Note di chiusura per chi esegue

- **Worktree:** tutto il lavoro è in `/home/fede/arauto/quote-import-ext-unifica` sul branch `feat/unifica-estensioni-qricambi`. Non tornare al clone principale `~/arauto/quote-import-ext`.
- **A fine plan:** non mergiare automaticamente. La PR va aperta e lasciata per la verifica manuale di Fede (Task 9 Step 4 richiede Chrome + una pagina Qricambi reale, che l'esecutore non ha). Dopo l'ok di Fede sulla checklist → `superpowers:finishing-a-development-branch`.
- **Rollback:** le estensioni sono unpacked. Se l'estensione unificata si comporta male, si ricarica `~/archive/pricing-ext-v5` e/o `~/arauto/quote-import-ext` (al tag pre-merge). Nessun servizio systemd, nessun DB, nessun `.env` toccato.
- **`pricing-ext-v5` sorgente:** resta dov'è (`~/projects/pricing-ext-v5`, file untracked) finché Fede non conferma che l'unificata funziona. Solo allora si può archiviare/rimuovere — non in questo plan.
```

