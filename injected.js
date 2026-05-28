// injected.js — gira nel MAIN world (manifest world:"MAIN", run_at:document_start)
// Hookera window.fetch + XMLHttpRequest PRIMA che Vue catturi i riferimenti.
// Quando intercetta PATCH /api/Quote, posta il payload via window.postMessage al
// content script ISOLATED che salva in chrome.storage.local.
(function () {
  const TAG = "[QUOTE-IMPORT MAIN v1.1.1]";
  console.log(TAG, "loaded — hooking fetch + XHR");

  function maybePost(method, url, body) {
    try {
      if ((method || "").toUpperCase() !== "PATCH") return;
      if (!url || !url.includes("/api/Quote")) return;
      if (!body) return;
      const parsed = typeof body === "string" ? JSON.parse(body) : null;
      if (parsed && parsed.ID && Array.isArray(parsed.items)) {
        window.postMessage({ source: "AR_QUOTE_IMPORT", payload: parsed }, "*");
        console.log(TAG, "PATCH /api/Quote intercepted ID=", parsed.ID, "items=", parsed.items.length);
      }
    } catch (e) { /* non rompere mai la chiamata originale */ }
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
    try {
      const url = typeof resource === "string" ? resource : resource?.url;
      const method = (init?.method || "GET").toUpperCase();
      logTouch("fetch", method, url);
      maybePost(method, url, init?.body);
    } catch (e) { /* no-op */ }
    return origFetch.apply(this, args);
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
        maybePost(_method, _url, body);
      } catch (e) { /* no-op */ }
      return origSend.apply(this, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
