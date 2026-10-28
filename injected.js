// injected.js — gira nel MAIN world (manifest world:"MAIN", run_at:document_start)
// Hookera window.fetch + XMLHttpRequest PRIMA che Vue catturi i riferimenti.
// Quando intercetta PATCH /api/Quote, ATTENDE la conferma del server (res.ok per
// fetch, status 2xx per XHR) e solo allora posta il payload via window.postMessage
// al content script ISOLATED che salva in chrome.storage.local.
// Il payload pubblicato e' identico a quello inviato a Qricambi: cambia solo
// QUANDO viene pubblicato, non COSA (issue arauto#1990).
(function () {
  const TAG = "[QUOTE-IMPORT MAIN v1.2.0]";
  console.log(TAG, "loaded — hooking fetch + XHR");

  // Estrae il payload di una PATCH /api/Quote dal corpo della richiesta.
  // NON pubblica nulla: si limita a preparare il candidato. La pubblicazione
  // avviene solo dopo la risposta positiva del server (vedi publishConfirmed).
  function extractQuotePayload(method, url, body) {
    try {
      if ((method || "").toUpperCase() !== "PATCH") return null;
      if (!url || !url.includes("/api/Quote")) return null;
      if (!body) return null;
      const parsed = typeof body === "string" ? JSON.parse(body) : null;
      if (parsed && parsed.ID && Array.isArray(parsed.items)) return parsed;
      return null;
    } catch (e) { /* non rompere mai la chiamata originale */ }
    return null;
  }

  // Pubblica il payload verso il content script ISOLATED. Va chiamata SOLO
  // quando Qricambi ha confermato il salvataggio (issue arauto#1990): prima
  // il payload veniva pubblicato all'atto della send, cioe' sull'INTENTO di
  // scrittura, e un preventivo mai salvato su Qricambi poteva comunque
  // finire importato in SIRJ come PR3.
  //
  // Ordine (quote-import-ext#30): ogni PATCH riceve un `seq` crescente al momento
  // dell'INVIO. Due PATCH ravvicinate possono essere confermate fuori ordine; se
  // la risposta della piu' vecchia arriva dopo quella della piu' nuova NON si
  // pubblica, altrimenti lastPatchPayload resterebbe lo stato superato.
  let lastSentSeq = 0;
  let lastPublishedSeq = 0;
  function nextSeq() {
    lastSentSeq = Math.max(lastSentSeq + 1, Date.now() * 1000);
    return lastSentSeq;
  }

  function publishConfirmed(parsed, seq) {
    try {
      if (seq < lastPublishedSeq) {
        console.log(TAG, "PATCH /api/Quote ID=", parsed.ID,
                    "confermata fuori ordine: gia' pubblicato uno stato piu' recente — scartata");
        return;
      }
      lastPublishedSeq = seq;
      window.postMessage({ source: "AR_QUOTE_IMPORT", payload: parsed, seq }, "*");
      console.log(TAG, "PATCH /api/Quote CONFERMATA dal server ID=", parsed.ID,
                  "items=", parsed.items.length);
    } catch (e) { /* no-op */ }
  }

  // Segnala al content script quale preventivo la pagina sta aprendo
  // (GET /api/Quote/find/<id>): serve a import.content.js per accorgersi che il
  // preventivo aperto non e' quello dell'ultimo payload confermato.
  // Ritorna l'id aperto (o null) perche' il chiamante ne legga poi la risposta.
  function noteOpenedQuote(method, url) {
    try {
      if ((method || "").toUpperCase() !== "GET" || !url) return null;
      const m = /\/api\/quote\/find\/(\d+)/i.exec(String(url));
      if (m) {
        window.postMessage({ source: "AR_QUOTE_OPEN", id: m[1] }, "*");
        return m[1];
      }
    } catch (e) { /* no-op */ }
    return null;
  }

  // Cliente del preventivo aperto (arauto#4911): pricing.content.js lo manda al
  // bridge per sapere se il cliente e' su una fascia sconto di recupero. Il
  // `customerdata` e' lo stesso campo che la PATCH porta e che l'import usa;
  // la forma della risposta di find/<id> viene dal bundle, non da una pagina
  // reale: si cerca il campo anche un livello sotto (data/result).
  function customerdataDi(obj) {
    if (!obj || typeof obj !== "object") return null;
    for (const o of [obj, obj.data, obj.result]) {
      if (!o || typeof o !== "object") continue;
      const cd = o.customerdata || o.customerData;
      if (cd && typeof cd === "object" && !Array.isArray(cd)) return cd;
    }
    return null;
  }

  function publishCustomer(id, body) {
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      const cd = customerdataDi(parsed);
      window.postMessage({ source: "AR_QUOTE_CUSTOMER", id, customerdata: cd }, "*");
      console.log(TAG, "GET quote/find/" + id + ": customerdata",
                  cd ? "presente" : "ASSENTE (chiavi: " + Object.keys(parsed || {}).join(",") + ")");
    } catch (e) { /* risposta non JSON: il pricing prezza senza fascia */ }
  }

  function logRejected(via, status, parsed) {
    console.log(TAG, `via=${via} PATCH /api/Quote NON confermata (status=${status}) ` +
                `ID=${parsed && parsed.ID} — payload NON pubblicato`);
  }

  // diagnostic helper: mostra ogni chiamata a /api/Quote per capire se la pagina
  // usa fetch, XHR, o altro endpoint quando dichiarano "salva preventivo"
  function logTouch(via, method, url) {
    if (url && url.includes("/api/Quote")) {
      console.log(TAG, `via=${via} ${method} ${url}`);
    }
  }

  // ── fetch override ───────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const [resource, init] = args;
    let pending = null;
    let seq = 0;
    let findId = null;
    try {
      const url = typeof resource === "string" ? resource : resource?.url;
      const method = (init?.method || "GET").toUpperCase();
      logTouch("fetch", method, url);
      findId = noteOpenedQuote(method, url);
      // Il body va letto ora (dopo, init potrebbe non essere piu' disponibile),
      // ma il payload resta in sospeso finche' il server non risponde.
      pending = extractQuotePayload(method, url, init?.body);
      if (pending) seq = nextSeq();
    } catch (e) { /* no-op */ }
    // Se la fetch va in errore di rete, l'eccezione si propaga come prima e
    // il payload non viene mai pubblicato.
    const res = await origFetch.apply(this, args);
    try {
      if (pending) {
        if (res && res.ok) publishConfirmed(pending, seq);
        else logRejected("fetch", res && res.status, pending);
      }
      // clone(): il body originale resta intatto per la pagina
      if (findId && res && res.ok) {
        res.clone().json().then((b) => publishCustomer(findId, b), () => {});
      }
    } catch (e) { /* no-op */ }
    return res;
  };

  // ── XMLHttpRequest override ─────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _method = "GET", _url = "";
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _method = (method || "GET").toUpperCase();
      _url = url || "";
      return origOpen.apply(this, arguments);
    };
    const origSend = xhr.send;
    xhr.send = function (body) {
      try {
        logTouch("xhr", _method, _url);
        const findId = noteOpenedQuote(_method, _url);
        if (findId) {
          xhr.addEventListener("load", function () {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return;
              const rt = xhr.responseType;
              publishCustomer(findId, rt === "json" ? xhr.response
                                      : (!rt || rt === "text") ? xhr.responseText : null);
            } catch (e) { /* no-op */ }
          });
        }
        const pending = extractQuotePayload(_method, _url, body);
        if (pending) {
          const seq = nextSeq();
          // 'load' scatta solo a risposta ricevuta: su abort/errore di rete
          // non scatta affatto e il payload non viene mai pubblicato.
          xhr.addEventListener("load", function () {
            try {
              if (xhr.status >= 200 && xhr.status < 300) publishConfirmed(pending, seq);
              else logRejected("xhr", xhr.status, pending);
            } catch (e) { /* no-op */ }
          });
        }
      } catch (e) { /* no-op */ }
      return origSend.apply(this, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
