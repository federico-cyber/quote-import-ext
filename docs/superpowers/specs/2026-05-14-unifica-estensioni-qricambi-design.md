# Unificazione estensioni Chrome Qricambi + storico import

**Data:** 2026-05-14
**Issue:** [#2](https://github.com/federico-cyber/quote-import-ext/issues/2)
**Branch:** `feat/unifica-estensioni-qricambi`

## Problema

Due estensioni Chrome separate girano sullo stesso dominio `*.qricambi.com`:

- **pricing-ext-v5** (v6.1, `~/projects/pricing-ext-v5`) — non è un repo git, file
  untracked in `~/projects`. Inietta un FAB rosso che applica 3 regole di pricing
  (A/B/C) alle tabelle preventivo Vue 3 / Vuetify 3.
- **quote-import-ext** (v0.5.0, questo repo) — repo GitHub
  `federico-cyber/quote-import-ext`. Inietta un FAB verde che intercetta la
  `PATCH /api/Quote` di Qricambi e importa il preventivo corrente come PR3 in
  SIRJ tramite il bridge `:5008`.

Conseguenze del setup attuale:

- Due FAB impilati sulla stessa pagina (rosso `bottom:80px`, verde `bottom:150px`).
- Codebase duplicato: `quote-import-ext` è già un fork strutturale di
  `pricing-ext-v5` (stesso pattern `defaults.js` + IIFE + FAB con backoff).
- Versioni, manifest, popup e options page separati da tenere in sync a mano.
- Lo storico degli import non esiste: `quote-import-ext` salva solo l'**ultimo**
  import in `chrome.storage.local` (chiavi `lastQricambiId`, `lastSirjNumero`,
  ecc.), sovrascritto ad ogni nuovo import.

`estensionesirj` (shim compatibilità IE per la webapp SIRJ) gira su un dominio
diverso e ha uno scopo non correlato: **resta fuori scope**.

## Obiettivo

1. Un'unica estensione Chrome che copre sia il pricing sia l'import in SIRJ.
2. Un solo punto d'ingresso visivo sulla pagina Qricambi.
3. Una vista **storico import** consultabile dal popup.

## Approccio

### Dove vive l'estensione unificata

Si **riusa il repo `quote-import-ext`** come base e ci si assorbe dentro
`pricing-ext-v5`. Motivazione:

- `quote-import-ext` ha già repo GitHub, storia git, README, CLAUDE.md.
- `pricing-ext-v5` non ha storia git da preservare (file untracked); una copia
  esiste in `~/archive/pricing-ext-v5` come riferimento/rollback.

Il nome cartella e repo restano `quote-import-ext` (rinominare è cosmetico,
eventualmente in un secondo momento). Cambia solo il campo `name` del manifest:
**"AR AUTO — Qricambi"**.

### Struttura file (merge a basso rischio)

Il `content.js` di pricing-ext-v5 (~35 KB) contiene logica Vue delicata
(`setVueInput` con approccio a 4 livelli per gestire la reattività Vue 3):
**non va riscritto né semplificato**. Si tiene come file separato.

Layout file dell'estensione unificata:

```
manifest.json          MV3 unico
defaults.js            DEFAULTS unico annidato (vedi sotto)
pricing.content.js     ex content.js di pricing-ext-v5, rinominato, logica intatta
import.content.js      ex content.js di quote-import-ext, logica import + storico
injected.js            invariato — hook fetch/XHR nel MAIN world
options.html/js        options page unificata (pricing params + backend config)
popup.html/js          popup unificato (storico import + riassunto regole + gear)
icons/                 invariato
```

`manifest.json` carica i content script così:

```json
"content_scripts": [
  {
    "matches": ["*://*.qricambi.com/*"],
    "js": ["injected.js"],
    "run_at": "document_start",
    "world": "MAIN"
  },
  {
    "matches": ["*://*.qricambi.com/*"],
    "js": ["defaults.js", "pricing.content.js", "import.content.js"],
    "run_at": "document_idle",
    "world": "ISOLATED"
  }
]
```

`permissions`: `activeTab`, `scripting`, `storage`.
`host_permissions`: `*://*.qricambi.com/*` + i tre URL del bridge
(`100.86.223.69:5008`, `192.168.1.49:5008`, `localhost:5008`).

### `DEFAULTS` unico flat — unico punto di refactoring reale

> **Nota.** Le due sottosezioni che seguono correggono due assunzioni dello
> spec originale: la lettura del codice sorgente (non disponibile quando lo
> spec è stato abbozzato) ha mostrato che (1) le due estensioni usano aree di
> storage diverse e (2) la struttura `DEFAULTS` annidata risolveva un problema
> inesistente. Corretto inline.

Entrambe le estensioni definiscono oggi un global `const DEFAULTS`:

- pricing-ext-v5: `{ regADelta, regACapThreshold, ..., uiRoundStep, ... }`
- quote-import-ext: `{ backendUrl, apiKey, fabBgColor, fabLabel, fabPosition, ... }`

I due set di chiavi **non hanno alcuna collisione**: l'unico conflitto reale è
la ridichiarazione del simbolo `const DEFAULTS` quando i due script vengono
caricati insieme. Si risolve con un **unico `DEFAULTS` flat** in un solo
`defaults.js`, che fonde tutte le chiavi dei due oggetti — nessun annidamento,
nessuna rinominazione di riferimenti nei content script (la logica delicata di
`pricing.content.js`, incluso `setVueInput`, resta intatta). Ogni content
script continua a usare il proprio sottoinsieme di chiavi dallo stesso oggetto
condiviso.

Una sezione `fab.*` non serve come namespace: le poche costanti di styling/
backoff del FAB confluiscono anch'esse flat nel `DEFAULTS` unico (es.
`fabZIndex`, `injectionMaxAttempts`, ...).

### Area di storage unica: `chrome.storage.local`

Stato attuale (scoperto dal codice):

- pricing-ext-v5 — config in `chrome.storage.local` (`content.js` e `options.js`).
- quote-import-ext — config (`backendUrl`, `apiKey`) in `chrome.storage.sync`;
  payload e ultimo import in `chrome.storage.local`.

L'estensione unificata usa **`chrome.storage.local` per tutto**: parametri
pricing, config backend, `lastPatchPayload`, e il nuovo `importHistory`. Una
sola area di storage, coerente, senza le quote strette di `sync` (irrilevanti
per un setup single-user). Adeguamento conseguente: `import.content.js` e
`options.js` spostano le letture/scritture di `backendUrl`/`apiKey` da
`chrome.storage.sync` a `chrome.storage.local`; `pricing.content.js` è già su
`local` e non cambia area.

### FAB unico con mini-menu a 2 voci

Oggi: due FAB separati. Obiettivo: **un solo FAB** che al click espande due azioni:

- **⚡ Applica Pricing** → invoca la logica di `pricing.content.js`
  (`trovaTabellaPreventivo` → `mappaColonne` → `eseguiConIndici`).
- **→ Importa in SIRJ** → invoca `handleClick` di `import.content.js`
  (legge `lastPatchPayload`, conferma, POST al bridge).

Le due operazioni restano **indipendenti**: si può applicare il pricing senza
importare, o re-importare senza ri-prezzare. Il menu è solo un contenitore visivo.

Il FAB e il menu vivono in un modulo condiviso, iniettato una sola volta. Per
evitare una dipendenza di ordinamento fragile tra i due content script, l'ultimo
script caricato (`import.content.js`) è responsabile di iniettare il FAB+menu e
cabla le due voci a funzioni esposte dai rispettivi moduli su un namespace
condiviso (`window.__AR_QRICAMBI`), oppure tramite `CustomEvent`. Il pattern
esatto va deciso in fase di plan; il vincolo di design è: **un solo FAB iniettato,
due handler indipendenti**.

Backoff di injection invariato (esponenziale 200ms → 30s, max 8 tentativi).

### Storico import

**Storage.** Nuova chiave `chrome.storage.local.importHistory`: array FIFO con
cap a **50** elementi (il più vecchio cade quando si supera il cap). Ogni record:

```js
{
  ts: 1715692800000,        // Date.now() al momento dell'import
  qricambiId: 12345,        // payload.ID
  customer: "Mario Rossi",  // payload.customerdata.CustomerName
  car: "Fiat Panda",        // payload.car
  itemsCount: 7,            // payload.items.length
  total: 234.50,            // payload.total
  status: "ok",             // "ok" | "dup" | "err"
  sirjNumero: 801,          // body.sirj_numero (ok/dup)
  sirjAnno: 2026,           // body.sirj_anno  (ok/dup)
  error: null               // stringa errore (err), altrimenti null
}
```

**Scrittura.** In `handleClick` di `import.content.js`, dopo la risposta del POST,
si appende un record su **tutti i rami**:

- HTTP 200 → `status: "ok"`, con `sirjNumero`/`sirjAnno`.
- HTTP 409 → `status: "dup"`, con `sirjNumero`/`sirjAnno` del documento esistente.
- HTTP 422 → `status: "err"`, `error` = "Cliente non trovato in SIRJ".
- Altri HTTP / errore di rete → `status: "err"`, `error` = messaggio.

Le chiavi legacy `lastQricambiId`/`lastSirjNumero`/`lastSirjAnno`/`lastError`
vengono rimosse: la loro funzione (mostrare l'ultimo import nel popup) è
sussunta da `importHistory[0]`.

**UI.** Il popup unificato mostra:

1. Header con nome estensione + gear impostazioni.
2. **Storico import** — lista scrollabile degli ultimi ~20 record (dal più
   recente). Ogni riga: data/ora compatta, cliente, auto, esito colorato
   (verde ok / arancio dup / rosso err), e `PR3 numero/anno` o messaggio errore.
3. Riassunto compatto delle 3 regole di pricing (sezione collassabile o ridotta —
   eredita lo stile dark del popup pricing-ext-v5).

Lo storico è **client-side** (per-profilo Chrome). Sufficiente per l'uso di Fede.

**Fuori scope (opzione futura):** un endpoint `GET /api/quote-import/history`
sul bridge `:5008` per uno storico autoritativo lato server, indipendente dal
profilo Chrome. Non incluso qui — YAGNI finché lo storico locale basta.

## Versioning

Versione di partenza dell'estensione unificata: **`1.0.0`** (segna il merge dei
due lineage, ex pricing 6.1 + ex import 0.5.0). Le stringhe di versione vanno
tenute in sync, come già richiesto dai CLAUDE.md delle due estensioni:
`manifest.json`, i `TAG` dei content script, `popup.html`, `options.html`,
commento in `defaults.js`.

## Testing

Nessuna delle due estensioni ha test automatici (vanilla JS, no build, no npm).
Il testing resta manuale, ma lo spec fissa una **checklist di verifica** che il
plan dovrà coprire:

1. Caricamento unpacked senza errori in `chrome://extensions` (no errori manifest,
   no errori console al boot dei content script).
2. Su una pagina preventivo Qricambi: un solo FAB iniettato; il menu espande due
   voci.
3. **⚡ Applica Pricing** applica le regole A/B/C esattamente come pricing-ext-v5
   v6.1 (confronto su un preventivo di prova prima/dopo il merge).
4. **→ Importa in SIRJ** importa come PR3 esattamente come quote-import-ext v0.5.0
   (200/409/422 + errore rete gestiti, toast corretti).
5. Storico: dopo un import si vede un nuovo record in cima alla lista del popup;
   l'esito (ok/dup/err) è colorato correttamente; superati 50 record il più
   vecchio cade.
6. Options page: salva e rilegge correttamente sia i parametri pricing sia la
   config backend dopo il refactoring di `DEFAULTS`.

## Tracciabilità & Rollback

### Branch / PR strategy

| PR | Cosa cambia | Perché è mergeable in sicurezza |
|---|---|---|
| PR unica | Merge dei file, `DEFAULTS` annidato, FAB unico, storico import, popup/options unificati | Estensione caricata unpacked: il merge non tocca produzione finché Fede non ricarica la cartella in Chrome. Nessun deploy automatico. |

Il lavoro è contenuto: niente servizi systemd, niente DB, niente `.env` toccato.
Una PR singola squash è adeguata (formato AR AUTO `feat(...): ... (#N)`).

### Punti di rollback

| Cosa rompe | Come tornare indietro |
|---|---|
| L'estensione unificata si comporta male | In `chrome://extensions` si ricarica la cartella `~/archive/pricing-ext-v5` e/o la `quote-import-ext` al tag pre-merge — i due lineage vecchi sono entrambi recuperabili. |
| Bug isolato post-merge | `git revert <sha>` su `main` di `quote-import-ext` + ricarica unpacked. |
| Schema / infra | Nessuno: nessuna migrazione, nessun servizio, nessun secret toccato. |

## Decisioni aperte rimandate al plan

- Meccanismo esatto di cablaggio FAB ↔ handler (`window.__AR_QRICAMBI` namespace
  vs `CustomEvent`).
- Layout preciso del popup unificato (storico sopra, regole sotto collassabili).
- Posizionamento `position:fixed` di summary widget + toast del pricing una volta
  estratti dal contenitore FAB (coordinate e z-index da fissare nel plan).
