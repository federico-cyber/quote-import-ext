---
name: verify
description: Come verificare end-to-end una modifica a quote-import-ext (estensione Chrome MV3 Qricambi); usala prima di aprire/mergiare una PR su questo repo.
---

## Superficie

Estensione Chrome MV3, no build step, nessun package.json/CI. Content script su
`*.qricambi.com` (pagina Vue 3 reale, autenticata, produzione) + FAB con 2 azioni:
"Applica Pricing" (pura, locale) e "Importa in SIRJ" (POST verso il bridge
`:5008`, che scrive PR3 in SIRJ). **Non esiste un ambiente di staging Qricambi**:
non si guida la pagina reale senza una sessione su qricambi.com e senza rischiare una
scrittura verso SIRJ (vedi "Non verificabile"). Si guidano headless il **caricamento
dell'estensione** e il **flusso del FAB** su una pagina fixture con un bridge finto
(sezione «Le tre regole del verify-runner»).

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

## Le tre regole del verify-runner (claude-config#805)

### 1. Dati reali: non applicabile all'estensione, come si copre

L'estensione non legge nessun DB né API di produzione: legge il **DOM di Qricambi**
(sessione autenticata, dati di clienti veri, nessun utente read-only né staging) e posta il
payload al bridge `:5008`, che è codice del repo `arauto` e scrive PR3 in SIRJ (vietato).
Quindi qui «dati reali» non si può soddisfare in headless e **non è un passo mancante**:
- La logica sul payload si prova con la fixture `ID`/`items`/`customerdata`/`car`/`lplatevin`/`total`
  dei test node e dello script UI sotto, che hanno la forma esatta del PATCH `/api/Quote`.
- Se il diff introduce un ramo che dipende dalla forma dei dati Qricambi (campo vuoto,
  `customerdata` assente, codice con punti), aggiungi il caso alla fixture di
  `tests/test_calcola_riga.js` / dello script UI, e dichiara in ANOMALIE che il confronto
  con una pagina Qricambi vera lo fa solo Fede nel suo Chrome (sezione «Non verificabile»).
- Mai guidare qricambi.com reale né il bridge `:5008`: sono produzione.

### 2. Flag: l'estensione non ne ha

Verificato con `grep -nE "process\.env|getenv|FEATURE|_ENABLED" *.js` sui file di
prodotto: nessuna feature flag né env (nessun backend, nessun `.env`). Le uniche
impostazioni stanno in `chrome.storage.local` (`defaults.js`). Il gate che fa le veci della
flag è `apiKey`: vuota, «Importa in SIRJ» si ferma con l'alert «Configura X-API-Key in
Opzioni» e non fa nessuna POST. Lo script UI sotto imposta `apiKey` dalla pagina Opzioni
(acceso) e, come controllo «spento», prova il ramo senza payload confermato (PATCH 500 ->
«Nessun preventivo intercettato», zero POST). Se il diff introduce una voce nuova in
`DEFAULTS` che abilita un comportamento, la ricetta va estesa per accenderla e spegnerla
dalla pagina Opzioni nello stesso modo.

### 3. Azioni dalla UI, bridge finto su file temporaneo, due viewport

I bottoni del FAB che fanno una POST («Importa in SIRJ», «Pricing + Import») si cliccano
davvero in Chromium headless con l'estensione caricata, su una pagina fixture servita su
`https://verify.qricambi.com/` da `ctx.route` (nessuna rete verso Qricambi) e con un
**bridge finto** su `127.0.0.1:15008` (stdlib, risponde 200 `sirj_numero` 99999, non
scrive niente, tiene le POST in memoria). `backendUrl`/`apiKey` si impostano dalla UI
della pagina Opzioni, come farebbe Fede. Lo script lancia un timeout se manca la
modale «PR3 99999/2026»; stampa le POST ricevute dal bridge con `X-API-Key`. Screenshot a
390 e 1440 px in `/tmp/qie-verify/`. Eseguire dalla root del worktree:

```
mkdir -p /tmp/qie-verify && rm -rf /tmp/qie-verify/profile
python3 - <<'PY'
import json, os, sys, threading, glob
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright

EXT = os.getcwd()
OUT = "/tmp/qie-verify"
HITS = []
class Bridge(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        HITS.append({"key": self.headers.get("X-API-Key"), "ID": body.get("ID"), "items": len(body["items"])})
        out = json.dumps({"sirj_numero": 99999, "sirj_anno": 2026}).encode()
        self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
srv = HTTPServer(("127.0.0.1", 15008), Bridge)
threading.Thread(target=srv.serve_forever, daemon=True).start()

PAYLOAD = {"ID": 4711, "items": [{"code": "MOT.X-CLEAN+", "manufacturer": "ACME", "description": "Filtro", "num": 2, "price": 12.5}],
           "customerdata": {"CustomerName": "Mario Rossi", "CustomerCode": "C123"}, "car": "Fiat Panda", "lplatevin": ["AB123CD"], "total": 25}
PAGE = "<!doctype html><title>fixture</title><button id=save>Salva</button><script>document.getElementById('save').onclick=()=>fetch('/api/Quote',{method:'PATCH',body:JSON.stringify(%s)})</script>" % json.dumps(PAYLOAD)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(OUT + "/profile", headless=False,
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new", "--no-sandbox", "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights"])
    patch_status = {"v": 200}
    def route(r):
        if r.request.method == "PATCH": r.fulfill(status=patch_status["v"], body="{}")
        else: r.fulfill(status=200, content_type="text/html", body=PAGE)
    ctx.route("https://verify.qricambi.com/**", route)
    import time
    ext_id = None
    for _ in range(40):  # Preferences viene scritto con ritardo da Chromium
        try:
            prefs = json.load(open(OUT + "/profile/Default/Preferences"))
            ext_id = next(k for k, v in prefs["extensions"]["settings"].items() if v.get("path") == EXT)
            break
        except (OSError, ValueError, KeyError, StopIteration):
            time.sleep(0.5)
    assert ext_id, "id estensione non trovato"
    print("ext_id", ext_id)
    # Controllo negativo: PATCH rifiutata (500) -> nessun payload, nessuna POST al bridge
    patch_status["v"] = 500
    ng = ctx.new_page(); ngm = []
    ng.on("dialog", lambda d: (ngm.append(d.message.split("\n")[0]), d.accept()))
    ng.goto("https://verify.qricambi.com/"); ng.click("#save"); ng.wait_for_timeout(500)
    ng.click("#ar-qr-fab-btn"); ng.click("#ar-qr-menu-import"); ng.wait_for_timeout(500)
    print("CONTROLLO PATCH 500:", ngm, "bridge hits:", len(HITS)); ng.close()
    patch_status["v"] = 200
    opt = ctx.new_page()
    opt.goto(f"chrome-extension://{ext_id}/options.html")
    opt.fill("#backendUrl", "http://127.0.0.1:15008/api/quote-import")
    opt.fill("#apiKey", "verify-key")
    opt.click("#save-btn")
    opt.wait_for_timeout(500); opt.close()
    for w, h in ((390, 844), (1440, 900)):
        pg = ctx.new_page(); pg.set_viewport_size({"width": w, "height": h})
        msgs = []
        pg.on("dialog", lambda d: (msgs.append(d.message.split("\n")[0]), d.accept()))
        pg.goto("https://verify.qricambi.com/")
        pg.click("#save"); pg.wait_for_timeout(500)
        pg.click("#ar-qr-fab-btn"); pg.click("#ar-qr-menu-import")
        pg.wait_for_selector("text=PR3 99999/2026", timeout=8000)
        pg.screenshot(path=f"{OUT}/import-{w}.png")
        print(w, "dialog:", msgs, "| modale PR3 visibile | bridge hits:", len(HITS), HITS[-1])
        pg.close()
    ctx.close()
srv.shutdown()
PY
```
Atteso (provato il 2026-10-09, Playwright 1.58):
```
CONTROLLO PATCH 500: ['Nessun preventivo intercettato.'] bridge hits: 0
390 dialog: ['Importare in SIRJ come PR3?'] | modale PR3 visibile | bridge hits: 1 {'key': 'verify-key', ...}
1440 dialog: ['Importare in SIRJ come PR3?'] | modale PR3 visibile | bridge hits: 2 {'key': 'verify-key', ...}
```
Poi `rm -rf /tmp/qie-verify`. Note: il flag `--disable-features=LocalNetworkAccessChecks,...`
serve solo perché una pagina «pubblica» chiama un bridge su loopback (in produzione lo
copre il permesso di rete locale del Chrome di Fede); il bridge finto manda anche gli
header CORS. Il bridge finto muore con lo script (`srv.shutdown()`); se lo script si
interrompe, libera la porta 15008 fermando il PID che mostra `ss -ltnp | grep 15008`.
Se il diff tocca solo logica pricing (`pricing.content.js`) la pagina fixture non ha la
tabella Vue: la regola pricing resta coperta da `tests/test_calcola_riga.js`.

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
`:5008` o verso qricambi.com (le POST dello script UI vanno solo al bridge finto
`127.0.0.1:15008`, che le scarta), mai scritture SIRJ (porta 8180 = produzione,
mai; sirjdbdemo/8080 solo lettura). Niente invio email/Telegram/WhatsApp/
notifiche. Niente restart di unit, `git pull` in dir di deploy, deploy Pages o
publish. Mai pubblicare l'estensione sullo store. Processi avviati per la
verifica (profilo Chromium temporaneo) si chiudono da soli (`ctx.close()`);
se serve un kill manuale, solo per PID esplicito, mai `pkill` per pattern.

## Non verificabile

- **Pagina preventivo Qricambi reale**: sessione autenticata su `*.qricambi.com`
  (produzione, dati cliente veri) e bridge `:5008` che scrive PR3 in SIRJ (vietato).
  La fixture e il bridge finto provano il flusso del FAB e le POST, non il DOM di Qricambi.
  Verificabile solo da Fede sul suo Chrome.
- **`setVueInput` a 4 livelli** (reattività Vue 3) e la tabella pricing: dipendono dal
  DOM Vue reale della pagina preventivo, non riproducibili in una fixture headless senza
  reimplementare parte dell'app Qricambi.
