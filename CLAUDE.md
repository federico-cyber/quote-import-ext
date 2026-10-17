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

### Payload = preventivo aperto (#30)

`lastPatchPayload` è l'ultimo stato confermato, **non** necessariamente il preventivo
che l'utente ha davanti. Tre regole:

- **Ordine.** `injected.js` numera ogni PATCH con un `seq` crescente all'**invio** e
  pubblica `{payload, seq}`; una conferma arrivata dopo una più recente si scarta
  (anche `import.content.js` scarta i `seq` minori dell'ultimo accettato). Vince
  l'ultimo invio, non l'ultima risposta.
- **Conferma sul mismatch.** `handleClick` confronta `payload.ID` con il preventivo
  aperto: numeri a 4+ cifre nell'URL (`idsFromHref`), altrimenti l'ultimo id visto da
  `injected.js` (`AR_QUOTE_OPEN` da `GET /api/Quote/find/<id>`, o l'ID dell'ultima PATCH
  confermata). Se non coincidono mostra una conferma con i **due** preventivi e importa
  solo se l'utente dice sì (scelta di Fede, #30). Se nessuna fonte dà un id
  ('unknown') non chiede nulla: resta la sola conferma d'import. Il formato dell'URL
  Qricambi e il `find/<id>` vengono dal bundle, **non** verificati su una pagina reale.
- **Azzeramento.** Dopo un import 200 (non in collisione, #29) o 409 `lastPatchPayload`/`lastPatchSeq` vengono
  rimossi (solo se in storage c'è ancora il payload importato). Dopo 422/500/errore di
  rete, collisione di numerazione o import annullato restano, così si può riprovare.

### Storage

Tutto su `chrome.storage.local`:
- parametri pricing + `backendUrl` + `apiKey` (config, gestita da `options.html`);
- `lastPatchPayload` (ultimo payload intercettato da `injected.js`, **già confermato
  da Qricambi**) + `lastPatchSeq` (suo ordine di invio); azzerati dopo import 200/409;
- `importHistory` (array FIFO, cap 50 — vedi sotto).

## Test

Nessuna CI su questo repo. Test node puri, zero dipendenze:

```
node tests/test_injected_confirm.js
node tests/test_calcola_riga.js
node tests/test_import_fallback.js
node tests/test_fab_shortcut.js
node tests/test_onboth_gating.js
node tests/test_parse_num.js
node tests/test_import_payload_guard.js
```

### Una azione alla volta: menu e shortcut (#28)

`fab.js` ha un'unica guardia (`runAction`) per Pricing / Import / Pricing+Import,
condivisa tra le voci di menu e gli shortcut Alt+Shift+P/I/B: finché un'azione è in
corso le altre richieste (menu o tastiera) vengono ignorate con un `console.warn`, le
tre voci restano disabilitate e un errore dell'handler finisce in `console.error`.
Senza guardia un doppio keydown lanciava due volte `onPricing` (lo snapshot di ANNULLA
si riscriveva con i valori già ritoccati) o due POST di import.

### Pricing + Import (`onBoth` in `fab.js`, #31)

Scelta di Fede «Fermati su errori». `onPricing` **ritorna** l'esito (`ok`/`tot`/`skip`/
`skipReasons`; su eccezione `{..., error}`) e `onBoth` lo consuma: l'import NON parte se
l'esito manca, c'e' un errore, `tot===0`, `ok===0` o anche **una sola** riga saltata/fallita
(`skip` o qualunque `skipReasons.*`). Non c'e' piu' l'attesa fissa di 1800 ms: `onBoth`
registra un listener `chrome.storage.onChanged` su `lastPatchPayload` **prima** del pricing,
poi attende la scrittura (quiete `bothSettleMs` dall'ultima, per le PATCH ravvicinate) entro
`bothWaitMs`. Senza scrittura (PATCH rifiutata, mai partita, oppure payload identico al
precedente, per cui Chrome non emette `onChanged`) l'import non parte e compare un alert col
motivo: l'utente puo' usare «Importa in SIRJ» a mano. Non rimettere un `setTimeout` fisso.

### Sconto sempre intero 0-99 (#21)

`calcolaRiga()` (pura, in `pricing.content.js`) restituisce uno sconto cliente
intero di 1-2 cifre in ogni regola, anche con parametri di configurazione non
interi.

**Listino ritoccato al centesimo (#24).** Qricambi tiene la Vendita al centesimo
e ne ricava lo sconto già nella UI (il payload PATCH porta 44,97): se
listino × (1 − sconto) non cade sul centesimo (8,74 × 0,55 = 4,807) nessun ordine
di scrittura salva uno sconto intero. Per questo `calcolaRiga()` alza il listino
del minimo necessario perché listino × (100 − sconto) sia divisibile per 100
(< 0,20 €, il margine non scende mai; se per quello sconto servirebbe di più usa
lo sconto intero più vicino) e il listino viene scritto in **ogni** regola, non
solo in B. Decisione di Fede (28/09): solo con Alt+Shift+P, le righe prezzate a
mano restano come le scrive lui. La riscrittura dello sconto dopo la Vendita
resta come rete di sicurezza: non toglierla.

### setVueInput (in `pricing.content.js`)

Funzione critica — Vue 3 può sovrascrivere i valori. Approccio a 4 livelli
(`execCommand` → native setter → `__vueParentComponent` emit → verification loop).
**Non semplificare mai `setVueInput()`** — la complessità gestisce la reattività Vue.

### Storico import

`import.content.js` appende un record a `chrome.storage.local.importHistory` su
**tutti** i rami della risposta POST. Array FIFO cap 50. Il popup ne mostra gli ultimi 20.

| status | Quando | Avviso all'operatore |
|---|---|---|
| `ok` / `ok-fallback` | 200 (fallback = cliente generico/override) | modal verde col numero PR3; se `unmatched_articles` non è vuoto, riga arancione con i codici non agganciati |
| `collision` | 200 con `collision: true` (il numero PR3 è stato poi occupato da un altro documento) | toast `warn` + modal arancione, mai verde |
| `esito-incerto` | 503 con `esito_incerto: true` (commit a esito incerto, PR3 forse scritto) | toast `warn` + modal arancione col numero `sirj_numero/sirj_anno` da verificare in SIRJ, non ritentare alla cieca |
| `dup` | 409 | toast `warn` |
| `err` | 422 senza fallback, altri HTTP, errore di rete | toast `err` |

Test dei rami: `node tests/test_import_response_branches.js` (esegue `import.content.js`
e `popup.js` in `vm` con chrome/fetch/DOM finti).

## Debug

```
F12 → Console → filtra "[AR-PRICING" | "[QUOTE-IMPORT" | "[AR-QR-FAB"
```

## Coerenza versione

Le stringhe versione vanno tenute in sync: `manifest.json:version`, i `TAG` di
`fab.js` / `pricing.content.js` / `import.content.js` / `injected.js`, commento
in `defaults.js`, footer di `popup.html` e `options.html`.
