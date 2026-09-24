// injected.js — gira nel MAIN world (manifest world:"MAIN", run_at:document_start)
// Hookera window.fetch + XMLHttpRequest PRIMA che Vue catturi i riferimenti.
// Quando intercetta PATCH /api/Quote, ATTENDE la conferma del server (res.ok per
// fetch, status 2xx per XHR) e solo allora posta il payload via window.postMessage
// al content script ISOLATED che salva in chrome.storage.local.
// Il payload pubblicato e' identico a quello inviato a Qricambi: cambia solo
// QUANDO viene pubblicato, non COSA (issue arauto#1990).
(function () {
  const TAG = "[QUOTE-IMPORT MAIN v1.1.8]";
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
  function publishConfirmed(parsed) {
    try {
      window.postMessage({ source: "AR_QUOTE_IMPORT", payload: parsed }, "*");
      console.log(TAG, "PATCH /api/Quote CONFERMATA dal server ID=", parsed.ID,
                  "items=", parsed.items.length);
    } catch (e) { /* no-op */ }
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
    try {
      const url = typeof resource === "string" ? resource : resource?.url;
      const method = (init?.method || "GET").toUpperCase();
      logTouch("fetch", method, url);
      // Il body va letto ora (dopo, init potrebbe non essere piu' disponibile),
      // ma il payload resta in sospeso finche' il server non risponde.
      pending = extractQuotePayload(method, url, init?.body);
    } catch (e) { /* no-op */ }
    // Se la fetch va in errore di rete, l'eccezione si propaga come prima e
    // il payload non viene mai pubblicato.
    const res = await origFetch.apply(this, args);
    try {
      if (pending) {
        if (res && res.ok) publishConfirmed(pending);
        else logRejected("fetch", res && res.status, pending);
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
        const pending = extractQuotePayload(_method, _url, body);
        if (pending) {
          // 'load' scatta solo a risposta ricevuta: su abort/errore di rete
          // non scatta affatto e il payload non viene mai pubblicato.
          xhr.addEventListener("load", function () {
            try {
              if (xhr.status >= 200 && xhr.status < 300) publishConfirmed(pending);
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
