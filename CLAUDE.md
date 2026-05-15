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

**Perché `injected.js` gira nel mondo MAIN:** in MV3 i content script vengono eseguiti
in un mondo ISOLATED che non ha accesso al `window` reale della pagina; per intercettare
`fetch`/`XMLHttpRequest` è necessario sovrascrivere le funzioni native sull'oggetto
`window` della pagina stessa, operazione possibile solo nel mondo MAIN. Una volta
intercettato il payload, `injected.js` non può accedere alle API `chrome.*` (riservate al
mondo ISOLATED), quindi lo pubblica tramite `window.postMessage` e `import.content.js`
lo raccoglie dal lato ISOLATED per effettuare la chiamata al backend.

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
