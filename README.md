# AR AUTO — Quote Import (Qricambi → SIRJ PR3)

Estensione Chrome che importa il preventivo Qricambi corrente come `PR3`
(preventivo filiale Siziano, Magazzino=2) in SIRJ, tramite il backend
`AcquistiDashboard` di AR AUTO.

## Setup

1. Apri `chrome://extensions`, abilita **Developer mode**.
2. **Load unpacked** → seleziona questa cartella.
3. Apri le **Opzioni** dell'estensione (click destro sull'icona → Options):
   - **Backend URL**: `http://100.86.223.69:5001/api/quote-import` (via Tailscale)
     o `http://192.168.1.49:5001/api/quote-import` (LAN AR AUTO)
   - **X-API-Key**: valore di `ARAUTO_API_KEY` in `/opt/arauto/.env` sul server
   - Salva.

## Uso

1. Apri un preventivo su `app.qricambi.com/?activetab=quote_edit&id=...`.
2. **Modifica e salva almeno una volta** (anche un blur su un campo basta) —
   Vue manda `PATCH /api/Quote` col preventivo completo, l'estensione lo
   intercetta e lo memorizza.
3. Premi il FAB verde **"→ SIRJ"** in basso a destra (sopra il FAB rosso di
   pricing-ext-v5 se installato).
4. Conferma il dialog di preview (cliente, auto, items, totale).
5. Toast verde di conferma con `PR3 NNNN/2026`.

## Toast colorati

- 🟢 **verde** — `✓ Importato come PR3 N/2026` (HTTP 200)
- 🟡 **giallo** — `Già importato: PR3 N/2026` (HTTP 409 idempotenza)
- 🔴 **rosso** — `Cliente non trovato in SIRJ` (HTTP 422) o errore di rete

## Requirements

- Chrome 111+ (per il supporto `world: "MAIN"` nei content_scripts).
- Backend `AcquistiDashboard` raggiungibile sulla porta 5001 (LAN o Tailscale).
- `ARAUTO_API_KEY` configurato nelle opzioni dell'estensione.

## Limiti noti

- Il preventivo deve essere stato salvato/modificato **almeno una volta** in
  questa sessione browser per essere intercettato (l'estensione hooka la
  PATCH, non fa pull periodico).
- Cliente non in `clifor` (P.IVA/CF/email/CustomerCode tutti miss) → errore
  422. Va creato in SIRJ desktop prima dell'import.
- Articoli con codice non in `parmag` mag=2 → riga manuale (`Precodice='.'`,
  `Parte=<code Qricambi raw>[:15]`).
- Match articoli: tenta normalizzazione (strip prefix manufacturer, separatori)
  ma in caso di codici molto fuori standard può non matchare → riga manuale.

## Debug

F12 sulla pagina Qricambi → Console → filtra `QUOTE-IMPORT`. Vedi i log dei due
mondi (MAIN per fetch interception, ISOLATED per FAB + storage).
