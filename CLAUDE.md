# CLAUDE.md — quote-import-ext

Chrome MV3 extension che importa il preventivo Qricambi corrente in SIRJ
(`Codice_documento='PR3'`, `Magazzino=2` = filiale Siziano) tramite il backend
AR AUTO `AcquistiDashboard` (`POST /api/quote-import` su porta 5001).

## Architecture

Due content scripts in mondi diversi (MV3 isolated/main world separation):

1. **`injected.js` (MAIN world, document_start)**: gira nel contesto della
   pagina `app.qricambi.com`, override `window.fetch` + `XMLHttpRequest` per
   intercettare le `PATCH /api/Quote` che Vue invia ad ogni edit del preventivo.
   Quando intercetta un body con `ID` + `items[]`, posta tutto via
   `window.postMessage({source:"AR_QUOTE_IMPORT", payload})` al content script
   isolated. Niente `chrome.*` API qui (non disponibili in MAIN world).
2. **`content.js` (ISOLATED world, document_idle)**: ascolta i `postMessage` e
   salva il payload in `chrome.storage.local`. Inietta un FAB verde "→ SIRJ"
   con backoff esponenziale (sopra il FAB rosso di `pricing-ext-v5`). Click →
   modal di conferma con preview → `fetch` POST al backend con header
   `X-API-Key`. Toast verde/giallo/rosso per feedback (200/409/422 + errori).

Lo split è necessario perché in MV3 il content script ISOLATED **non vede** il
`window.fetch` originale della pagina (mondo isolato), quindi l'override deve
girare nel MAIN world.

## Files

| File | Mondo | Responsabilità |
|---|---|---|
| `manifest.json` | — | MV3, host `qricambi.com` + `100.86.223.69:5001` (Tailscale) + `192.168.1.49:5001` (LAN), 2 content_scripts |
| `injected.js` | MAIN | fetch + XHR override, postMessage al ISOLATED |
| `defaults.js` | ISOLATED | DEFAULTS (backendUrl, apiKey, FAB style/position/zIndex) |
| `content.js` | ISOLATED | listener postMessage + storage + FAB + click handler + toast |
| `popup.html`/`popup.js` | popup | mostra ultimo import (qricambi_id → sirj_numero) |
| `options.html`/`options.js` | options | config backendUrl + apiKey |

## Origine

Forkato strutturalmente da `~/projects/pricing-ext-v5` v6.1, ma logica diversa:
pricing-ext applica regole sconto su Vue input via `setVueInput` → quote-import-ext
intercetta PATCH e POSTa al backend AR AUTO, niente scrittura su Vue. Nessun
codice di `setVueInput` qui.

## Debug

```
F12 (sulla pagina Qricambi) → Console → filtro "QUOTE-IMPORT"
```

Log relevant:
- `[QUOTE-IMPORT MAIN v0.4.0] loaded — hooking fetch + XHR` → boot main-world
- `[QUOTE-IMPORT v0.4.0] content script loaded (isolated)` → boot isolated
- `[QUOTE-IMPORT MAIN v0.4.0] PATCH /api/Quote intercepted ID=NNNNN` → fetch
  hookato, payload salvato
- `[QUOTE-IMPORT v0.4.0] received payload from main-world ID=NNNNN` → bridge
  postMessage OK

## Config backend per Mac

| Da Mac in LAN AR AUTO (192.168.1.x) | da Mac via Tailscale |
|---|---|
| `http://192.168.1.49:5001/api/quote-import` | `http://100.86.223.69:5001/api/quote-import` |

`apiKey` = valore di `ARAUTO_API_KEY` in `/opt/arauto/.env` sul server.

## Versioning

Tutte le stringhe versione devono restare in sync: `manifest.json:version`,
`content.js` TAG, `injected.js` TAG.
