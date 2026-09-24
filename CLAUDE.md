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
| `injected.js` | MAIN, document_start | Hook `fetch`/`XHR`, intercetta `PATCH /api/Quote`, **attende la conferma del server** e solo allora posta il payload via `postMessage` |
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

### Conferma del salvataggio Qricambi (arauto#1990)

`injected.js` pubblica il payload **solo dopo** che Qricambi ha confermato la PATCH
(`res.ok` per `fetch`, `status` 2xx dentro il listener `load` per XHR). Su risposta
negativa, abort o errore di rete non pubblica nulla: un preventivo mai salvato su
Qricambi non deve poter finire in SIRJ come PR3.

**Non spostare `maybePost`/`publishConfirmed` prima della risposta** — era il difetto
originale: veniva chiamata sull'*intento* di scrittura.

Conseguenza voluta: dopo una PATCH rifiutata, `lastPatchPayload` conserva l'ultimo
stato **confermato dal server**, che è esattamente ciò che Qricambi ha davvero salvato.
Importarlo resta corretto.

Il *contenuto* pubblicato è invariato rispetto a prima del fix: cambia solo *quando*.

### Storage

Tutto su `chrome.storage.local`:
- parametri pricing + `backendUrl` + `apiKey` (config, gestita da `options.html`);
- `lastPatchPayload` (ultimo payload intercettato da `injected.js`, **già confermato
  da Qricambi**);
- `importHistory` (array FIFO, cap 50 — vedi sotto).

## Test

Nessuna CI su questo repo. Test node puri, zero dipendenze:

```
node tests/test_injected_confirm.js
node tests/test_calcola_riga.js
```

### Sconto sempre intero 0-99 (#21)

`calcolaRiga()` (pura, in `pricing.content.js`) restituisce uno sconto cliente
intero di 1-2 cifre in ogni regola, anche con parametri di configurazione non
interi. Dopo aver scritto la Vendita (al centesimo) lo sconto viene **riscritto
per ultimo**: Qricambi ricalcola lo sconto dalla Vendita arrotondata e lo
lascerebbe con decimali (44,99 invece di 45). Non togliere la seconda scrittura.

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
