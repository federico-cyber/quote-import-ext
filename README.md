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
