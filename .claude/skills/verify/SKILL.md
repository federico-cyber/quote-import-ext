---
name: verify
description: Come verificare end-to-end una modifica a quote-import-ext (estensione Chrome MV3 Qricambi); usala prima di aprire/mergiare una PR su questo repo.
---

## Superficie

Estensione Chrome MV3, no build step, nessun package.json/CI. Content script su
`*.qricambi.com` (pagina Vue 3 reale, autenticata, produzione) + FAB con 2 azioni:
"Applica Pricing" (pura, locale) e "Importa in SIRJ" (POST verso il bridge
`:5008`, che scrive PR3 in SIRJ). **Non esiste un ambiente di staging Qricambi**:
non si può guidare "Applica Pricing"/"Importa in SIRJ" senza una sessione reale
su qricambi.com e senza rischiare una scrittura verso SIRJ (vedi "Non
verificabile"). Ciò che si può guidare headless è il **caricamento
dell'estensione** in Chromium.

## Setup

Nessuna install: JS vanilla, zero dipendenze npm. Serve solo:
- `node` (>=18) per i test.
- Un Chromium con supporto `--load-extension` in `--headless=new` (verificato:
  `playwright` python, già installato — `pip show playwright`; in alternativa
  `puppeteer`/`chromium-cli` se disponibili). Nessuna `.env` in worktree: il
  backend URL/API key sono in `chrome.storage.local`, configurati dal popup,
  non da file.

## Verifica del branch

1. **Sintassi** di ogni content/background script (rileva errori che
   bloccherebbero il caricamento in `chrome://extensions`):
   ```
   for f in injected.js defaults.js fab.js pricing.content.js import.content.js options.js popup.js; do
     node --check "$f" || echo "FAIL $f"
   done
   ```
   Atteso: nessun `FAIL`, nessun output (silenzio = OK).

2. **manifest.json valido**:
   ```
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"
   ```
   Atteso: `manifest OK`.

3. **Caricamento smoke-test in Chromium headless** (prova che l'estensione si
   installa senza errori, senza toccare qricambi.com):
   ```
   python3 - <<'PY'
   import asyncio
   from playwright.async_api import async_playwright
   EXT = "."  # eseguire dalla root del repo/worktree
   JS = """() => { function c(r,a){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)c(e.shadowRoot,a)});a.push(r.textContent||'')}
   const a=[]; c(document,a); return a.join('\\n'); }"""
   async def main():
       async with async_playwright() as p:
           ctx = await p.chromium.launch_persistent_context(
               "/tmp/qie-verify-profile", headless=False,
               args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
                     "--headless=new", "--no-sandbox"])
           page = await ctx.new_page()
           await page.goto("chrome://extensions/", timeout=10000)
           await page.wait_for_timeout(1500)
           text = await page.evaluate(JS)
           print("EXTENSION_LOADED:", "AR AUTO" in text and "Qricambi" in text)
           print("HAS_ERRORS_TEXT:", "Errors" in text)
           await ctx.close()
   asyncio.run(main())
   PY
   rm -rf /tmp/qie-verify-profile
   ```
   Atteso: `EXTENSION_LOADED: True`, `HAS_ERRORS_TEXT: False`. Il profilo
   temporaneo non serve fermare nessun processo per PID (playwright chiude
   `ctx` da solo); se resta un profilo orfano in `/tmp/`, `rm -rf` è
   sufficiente (nessun dato, non è un servizio in ascolto).

## Verifica live dopo il deploy

Non c'è un deploy server-side: l'estensione si "deploya" solo ricaricandola in
`chrome://extensions` sulla macchina di Fede (mai pubblicarla sullo store).
Verifica di sola lettura possibile dopo un aggiornamento manuale:
- `chrome://extensions` → card "AR AUTO — Qricambi" → nessun badge "Errors".
- Console pagina Qricambi reale (F12) → filtra `[AR-PRICING` / `[QUOTE-IMPORT` /
  `[AR-QR-FAB` → nessun errore rosso dopo un click sul FAB (solo lettura della
  console, nessuna azione che scriva se non è quella che Fede sta già facendo).
- Bridge `:5008` (se in esecuzione): `curl -s http://192.168.1.41:5008/api/quote-import` (o
  l'equivalente endpoint di health, se esiste) solo con **GET**, mai POST — e solo
  per confermare che il servizio risponde, non per inviare un preventivo.

## Test

```
node tests/test_injected_confirm.js
node tests/test_calcola_riga.js
```
Atteso: `9 passed, 0 failed` e `tutti i test ok` (exit 0 entrambi). Nessuna CI:
questi due comandi sono l'intera suite.

## Che aspetto ha un FAIL

- `node --check` stampa un `SyntaxError` → l'estensione non si carica affatto
  in Chrome (schermata "Errors" rossa su `chrome://extensions`).
- `EXTENSION_LOADED: False` o `HAS_ERRORS_TEXT: True` → manifest/permessi rotti
  o script che lancia un'eccezione al load.
- Un test node esce con `failed` > 0 → l'invariante che il test copre
  (conferma server prima del postMessage, o sconto sempre intero) è stata
  violata dal diff.

## Vincoli AR AUTO

Solo letture verso servizi/DB di produzione: mai POST/PUT/PATCH/DELETE verso
`:5008` o verso qricambi.com, mai scritture SIRJ (porta 8180 = produzione,
mai; sirjdbdemo/8080 solo lettura). Niente invio email/Telegram/WhatsApp/
notifiche. Niente restart di unit, `git pull` in dir di deploy, deploy Pages o
publish. Mai pubblicare l'estensione sullo store. Processi avviati per la
verifica (profilo Chromium temporaneo) si chiudono da soli (`ctx.close()`);
se serve un kill manuale, solo per PID esplicito, mai `pkill` per pattern.

## Non verificabile

- **FAB "Applica Pricing" / "Importa in SIRJ" su una pagina preventivo reale**:
  richiede una sessione autenticata su `*.qricambi.com` (produzione, dati
  cliente reali) e il flusso "Importa in SIRJ" scriverebbe una PR3 in SIRJ
  (produzione, vietato). Non esiste una fixture/staging Qricambi da guidare in
  headless. Verificabile solo manualmente da Fede sul suo Chrome, o via i due
  test node che coprono le invarianti pure (conferma server, sconto intero).
- **`setVueInput` a 4 livelli** (reattività Vue 3): dipende dal DOM Vue reale
  della pagina preventivo, non riproducibile in una fixture headless senza
  reimplementare parte dell'app Qricambi.
