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
| `injected.js` | MAIN, document_start | Hook `fetch`/`XHR`, intercetta `PATCH /api/Quote`, **attende la conferma del server** e solo allora posta il payload via `postMessage`; posta anche il cliente del preventivo aperto (`AR_QUOTE_CUSTOMER`), l'apertura (`AR_QUOTE_OPEN`, solo su find 2xx) e i salvataggi in volo (`AR_QUOTE_SAVES`) |
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
  aperto: numeri a 4+ cifre nell'URL (`idsFromHref`, in `defaults.js`), altrimenti l'ultimo id visto da
  `injected.js` (`AR_QUOTE_OPEN` da `GET /api/Quote/find/<id>` **solo se la risposta è 2xx**, #49;
  o l'ID dell'ultima PATCH confermata). Una find in 404/5xx o in errore di rete non segna
  nessun preventivo aperto: all'invio parte solo `AR_QUOTE_OPEN_INTENT`, che
  `import.content.js` usa soltanto con l'interruttore `quoteOpenSoloOk` spento. Se non coincidono mostra una conferma con i **due** preventivi e importa
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
node tests/test_fascia_recupero.js
node tests/test_import_fallback.js
node tests/test_fab_shortcut.js
node tests/test_onboth_gating.js
node tests/test_parse_num.js
node tests/test_import_payload_guard.js
node tests/test_import_response_branches.js
node tests/test_annulla_pricing.js
```

### Una azione alla volta: menu e shortcut (#28)

`fab.js` ha un'unica guardia (`runAction`) per Pricing / Import / Pricing+Import,
condivisa tra le voci di menu e gli shortcut Alt+Shift+P/I/B: finché un'azione è in
corso le altre richieste (menu o tastiera) vengono ignorate con un `console.warn`, le
tre voci restano disabilitate e un errore dell'handler finisce in `console.error`.
Senza guardia un doppio keydown lanciava due volte `onPricing` (lo snapshot di ANNULLA
si riscriveva con i valori già ritoccati) o due POST di import.

Anche **ANNULLA** (`onUndo`) passa da `runAction` (#42): durante Pricing/Import il click
viene ignorato con il warn e la voce è disabilitata; non è in `actionItems` perché il suo
stato finale non è fisso: lo decide `setUndoEnabled` (`undoEnabled` in `fab.js`), e a fine
azione `syncUndoItem` lo ripristina invece di riabilitarlo sempre. Senza guardia ANNULLA
ripristinava uno snapshot parziale e lo azzerava mentre `esegui()` ne stava ancora
riempiendo le righe.

### Pricing + Import (`onBoth` in `fab.js`, #31, #46, #47)

Scelta di Fede «Fermati su errori». `onPricing` **ritorna** l'esito (`ok`/`tot`/`skip`/
`skipReasons`/`cambiate`; su eccezione `{..., error}`) e `onBoth` lo consuma: l'import NON parte se
l'esito manca, c'e' un errore, `tot===0`, `ok===0`, anche **una sola** riga saltata/fallita
(`skip` o qualunque `skipReasons.*`) o la fascia sconto del cliente non è verificata
(arauto#4911). Non c'e' piu' l'attesa fissa di 1800 ms: `onBoth`
registra un listener `chrome.storage.onChanged` su `lastPatchPayload` **prima** del pricing,
poi attende la scrittura entro `bothWaitMs` (15 s). Senza scrittura (PATCH rifiutata, mai
partita, oppure payload identico al precedente, per cui Chrome non emette `onChanged`) l'import
non parte e compare un alert col motivo: l'utente puo' usare «Importa in SIRJ» a mano. Non
rimettere un `setTimeout` fisso.

- **Preventivo già prezzato (#46).** `cambiate` conta le righe in cui il pricing ha **davvero**
  cambiato almeno un campo (sconto/listino/vendita: valore finale dell'input ≠ quello catturato
  prima delle scritture, `rigaCambiata` in `pricing.content.js`); `ok` non basta, perché
  `setVueInput` torna `true` anche se il valore c'era già. Con `cambiate === 0` `onBoth` mostra
  **subito** «nessuna modifica… usa Importa in SIRJ» e non importa niente, senza aspettare
  `bothWaitMs`. Non si deduce mai «niente cambiato» dall'assenza di PATCH; se `cambiate` manca
  (esito vecchio) si attende come prima. Nessun interruttore.
- **Quiete e salvataggi in volo (#47, interruttore `importAttendeInVolo`).** La quiete di
  `bothSettleMs` (600 ms) da sola puo' chiudersi mentre una PATCH lenta e' ancora in volo
  (import con prezzi misti). `injected.js` conta le PATCH in volo (salgono all'invio, scendono su
  risposta di **qualsiasi** status, abort, errore di rete, timeout: se restassero > 0 l'import non
  partirebbe piu') e posta `AR_QUOTE_SAVES {inflight, sentSeq, confirmedSeq}` (valori assoluti).
  Con l'interruttore acceso `onBoth` importa solo quando c'e' stata la scrittura, **in volo = 0**
  da `bothSettleMs` e l'ultima PATCH inviata e' confermata (`sentSeq === confirmedSeq`); un nuovo
  invio azzera la quiete. Se l'ultima e' rifiutata: alert, niente import. Allo scadere di
  `bothWaitMs` senza quiete: alert e **mai** import (anche con una scrittura gia' vista; a
  interruttore spento invece vale la scrittura vista, come prima). Spento = solo quiete
  dall'ultima scrittura, comportamento di prima della 1.2.1.

### Interruttori di rollback (v1.2.1, v1.2.2)

In `defaults.js` e nelle Opzioni (sezione «Correzioni (rollback)»), **default acceso**. Servono a
tornare al comportamento precedente dalle Opzioni, senza una nuova release (lo storage dei PC
non si tocca a mano). `importAttendeInVolo` si legge a ogni Pricing + Import (vale dal prossimo);
`quoteOpenSoloOk` al caricamento della pagina Qricambi (dopo averlo cambiato ricarica Qricambi).

| Chiave | Fix | Spento |
|---|---|---|
| `importAttendeInVolo` | #47 (Pricing + Import aspetta i salvataggi in volo) | solo quiete di `bothSettleMs` dall'ultima scrittura |
| `quoteOpenSoloOk` | #49 (preventivo aperto segnato solo su find 2xx) | preventivo aperto segnato all'invio della find, anche se poi fallisce |
| `regBSottoCosto` | #34 (listino non sopra l'acquisto → Regola B) | Regola A col listino com'è: sconto 0 e vendita = listino, sotto costo |

`injected.js` (mondo MAIN) non legge `chrome.storage`: posta sempre entrambi i segnali
(`AR_QUOTE_OPEN` su 2xx e `AR_QUOTE_OPEN_INTENT` all'invio, `AR_QUOTE_SAVES`) e decide chi li
consuma (`import.content.js`, `fab.js`) in base all'interruttore. Il fix #46 non ne ha.

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

### Fascia sconto di recupero (arauto#4911)

Clienti su una fascia di recupero (1106 «RECUPERO DA 106», 1100 «RECUPERO DA 100»):
dopo le regole A/C/B e lo sconto intero, ogni sconto **≥ soglia** perde **punti** punti
(55 → 50, 60 → 55); sotto soglia non cambia nulla. Poi il ritocco al centesimo (#24),
che con la fascia di recupero ha due vincoli: su una riga ridotta prova solo sconti
**più bassi** (il recupero toglie sempre almeno `punti` punti, `scontoCalcolato` è lo
sconto prima del ritocco), e una riga non ridotta non sale mai a soglia (54 non diventa
55). Fra 0 e −5 c'è sempre un multiplo di 5, quindi il listino resta al centesimo.

- **Chi decide.** Soglia, punti e l'elenco delle fasce stanno nel bridge
  (`arauto/shared/fascia_recupero.py`): `onPricing` chiama
  `POST <backendUrl>/fascia-cliente` (stessa `X-API-Key` dell'import, timeout 4 s) col
  `customerdata` del preventivo aperto, o con `override_clifor_numero` se impostato.
  L'estensione non ne tiene una copia.
- **Da dove arriva il cliente.** `injected.js` legge la risposta di
  `GET /api/Quote/find/<id>` (`res.clone()`, la pagina riceve la Response originale) e
  posta `{source: "AR_QUOTE_CUSTOMER", id, customerdata}`; anche ogni PATCH confermata
  porta il suo `customerdata`. `scegliPreventivo` usa il primo id dell'URL
  (`idsFromHref`, in `defaults.js`, la stessa dell'import) di cui si conosce il cliente;
  poi l'ultimo preventivo visto, se è stato visto sulla stessa pagina (stesso URL: così un
  numero dell'URL che non è un preventivo non blocca la fascia); poi il primo id
  dell'URL senza cliente. Il cliente di un preventivo visto su un'altra pagina non si
  prende mai. La forma di `find/<id>` viene dal bundle: la console logga
  `customerdata presente` o `ASSENTE (chiavi: …)`, da controllare dal vivo.
- **Nel dubbio, prezzi normali.** Solo `stato: 'recupero'` (risposta 200 con soglia e
  punti validi) porta la regola. Flag del bridge spenta → nessuna riga nel toast.
  Cliente non letto (400: «salva il preventivo e rilancia»), non trovato o ambiguo
  (422), errore, server giù o `X-API-Key` vuota nelle Opzioni (in quel caso nessuna
  chiamata) → riga rossa «Fascia sconto non verificata» e pricing normale. In
  **Pricing + Import** invece l'import non parte: `bothBlockReason` pretende
  `res.fascia.stato` fra `recupero`, `normale` e `spento`, altrimenti alert col motivo. Fascia normale → riga «NOME · fascia L»; recupero → riga arancione con
  soglia, punti e righe toccate.
- Test: `node tests/test_fascia_recupero.js` (regola, sweep, scelta del preventivo,
  ogni ramo della risposta) e i casi `find/<id>` di `tests/test_injected_confirm.js`.

### Listino sotto l'acquisto e esito delle riscritture (#34)

- **Listino non sopra l'acquisto.** Con `listino <= acquisto` (listino anagrafico vecchio o
  basso) la Regola A darebbe sconto 0 e vendita = listino, sotto costo: `calcolaRiga` tratta la
  riga come senza listino (**Regola B**, listino fittizio). Interruttore `regBSottoCosto`, letto
  a ogni pricing.
- **Rollback del listino.** Se il listino non si scrive, sconto e vendita non si toccano
  (`skipReasons.setFailed`); se lo sconto non si scrive dopo il listino, il listino torna al
  valore di prima (`rollbackB`). Se anche quella riscrittura fallisce la riga finisce in
  `skipReasons.rollbackFallito` («Listino NON ripristinato, controlla la riga» nel toast), entra
  nello snapshot (ANNULLA la può riprovare) e Pricing + Import non importa.
- **ANNULLA.** Una riga conta come ripristinata solo se **tutti** i suoi campi ancora in pagina
  sono stati riscritti (`setVueInput === true`, oppure campo vuoto prima del pricing che
  Qricambi ripresenta come 0: `ripristinoVuoto`); le righe fallite restano nello snapshot (ANNULLA
  resta attivo per riprovare) e il toast è rosso con il conteggio.

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
