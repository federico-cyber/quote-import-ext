// import.content.js — AR AUTO — Qricambi v1.2.3 (ISOLATED world)
// Riceve payload via window.postMessage da injected.js (MAIN world) e li salva
// in chrome.storage.local. Gestisce handler import (window.__AR_QRICAMBI.onImport),
// storico import e POST al backend AR AUTO.
(function () {
  const TAG = "[QUOTE-IMPORT v1.2.3]";
  console.log(TAG, "content script loaded (isolated)");

  // ── 0. Valore fallback clifor — letto da storage, default 5 ──────────
  // Inizializzato subito; se handleClick() viene invocato prima del callback
  // (improbabile ma possibile), usa comunque il default sicuro.
  let FALLBACK_CLIFOR_NUMERO = 5;
  chrome.storage.local.get({ fallbackCliforNumero: 5 }, ({ fallbackCliforNumero }) => {
    FALLBACK_CLIFOR_NUMERO = fallbackCliforNumero;
    console.log(TAG, "fallbackCliforNumero loaded:", FALLBACK_CLIFOR_NUMERO);
  });

  // ── 0b. Interruttore #49 — letto da storage, default acceso ─────────
  // true: il preventivo "aperto" si segna solo su find/<id> riuscita
  // (AR_QUOTE_OPEN, 2xx). false: come prima, gia' all'invio (AR_QUOTE_OPEN_INTENT).
  // Si legge al caricamento della pagina (dopo averlo cambiato nelle Opzioni
  // ricarica Qricambi).
  let quoteOpenSoloOk = true;
  chrome.storage.local.get({ quoteOpenSoloOk: true }, (s) => {
    quoteOpenSoloOk = !s || s.quoteOpenSoloOk !== false;
  });

  // ── 1. Listener postMessage dal main-world script ─────────────────────
  // Stato per-tab (quote-import-ext#30):
  //  - lastSeq: seq dell'ultimo payload accettato. injected.js numera le PATCH
  //    in ordine di INVIO; un payload con seq minore e' uno stato superato
  //    (risposta arrivata fuori ordine) e non deve sovrascrivere quello nuovo.
  //  - openQuoteId: ultimo preventivo visto aprire (GET /api/Quote/find/<id>) o
  //    salvare (PATCH confermata) in questa pagina.
  //  - lastOpenSeq: seq della find accettata per ultima. Due find sovrapposte
  //    possono rispondere al contrario: vale l'ultima INVIATA, non l'ultima
  //    arrivata.
  let lastSeq = 0;
  let openQuoteId = null;
  let lastOpenSeq = 0;

  function isNewer(prevSeq, nextSeq) {
    // messaggio senza seq (injected.js vecchio): non si puo' ordinare, si accetta
    if (!nextSeq) return true;
    return nextSeq > prevSeq;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;
    // #49: AR_QUOTE_OPEN parte solo su risposta 2xx; AR_QUOTE_OPEN_INTENT all'invio
    // (find in 404/5xx o prefetch inclusi). Ne vale uno solo, secondo l'interruttore.
    if (data.source === "AR_QUOTE_OPEN" || data.source === "AR_QUOTE_OPEN_INTENT") {
      const attivo = quoteOpenSoloOk ? "AR_QUOTE_OPEN" : "AR_QUOTE_OPEN_INTENT";
      if (data.source !== attivo || !data.id) return;
      if (!isNewer(lastOpenSeq, data.seq)) {
        console.log(TAG, "find", data.id, "seq", data.seq,
                    "piu' vecchia di", lastOpenSeq, "— scartata");
        return;
      }
      if (data.seq) lastOpenSeq = data.seq;
      openQuoteId = String(data.id);
      return;
    }
    if (data.source !== "AR_QUOTE_IMPORT" || !data.payload) return;
    if (!isNewer(lastSeq, data.seq)) {
      console.log(TAG, "payload ID=", data.payload.ID, "seq", data.seq,
                  "piu' vecchio di", lastSeq, "— scartato");
      return;
    }
    if (data.seq) lastSeq = data.seq;
    if (data.payload.ID) openQuoteId = String(data.payload.ID);
    chrome.storage.local.set({ lastPatchPayload: data.payload, lastPatchSeq: data.seq || 0 });
    console.log(TAG, "received payload from main-world ID=", data.payload.ID,
                "items=", data.payload.items.length);
  });

  // Il payload e' del preventivo aperto? 'match' | 'mismatch' | 'unknown'.
  function checkOpenQuote(payloadId) {
    const id = String(payloadId);
    const urlIds = idsFromHref(window.location && window.location.href);
    if (urlIds.length) {
      return urlIds.includes(id)
        ? { state: "match" } : { state: "mismatch", openIds: urlIds };
    }
    if (openQuoteId) {
      return openQuoteId === id
        ? { state: "match" } : { state: "mismatch", openIds: [openQuoteId] };
    }
    return { state: "unknown" };
  }

  // ── 2. Handler import: registrato su window.__AR_QRICAMBI per il menu FAB ──
  window.__AR_QRICAMBI = window.__AR_QRICAMBI || { onPricing: null, onImport: null };

  // Storico import: array FIFO (cap 50) in chrome.storage.local.importHistory
  async function appendToHistory(record) {
    const stored = await new Promise((resolve) =>
      chrome.storage.local.get({ importHistory: [] }, resolve));
    const history = Array.isArray(stored.importHistory) ? stored.importHistory : [];
    history.unshift(record);
    if (history.length > 50) history.length = 50;
    await new Promise((resolve) =>
      chrome.storage.local.set({ importHistory: history }, resolve));
  }

  // Dopo un import concluso (200 / 409) il payload non va piu' riproposto.
  // Si cancella solo se in storage c'e' ancora quello importato: una PATCH piu'
  // nuova confermata mentre la POST era in corso resta intatta.
  // Un errore qui non deve mai cambiare l'esito di un import gia' riuscito.
  async function clearImportedPayload(importedSeq) {
    try {
      const cur = await new Promise((resolve) =>
        chrome.storage.local.get(["lastPatchSeq"], resolve));
      if ((cur.lastPatchSeq || 0) !== importedSeq) return;
      await new Promise((resolve) =>
        chrome.storage.local.remove(["lastPatchPayload", "lastPatchSeq"], resolve));
    } catch (e) { console.log(TAG, "clear lastPatchPayload fallito:", e.message); }
  }

  async function handleClick() {
    const stored = await new Promise((resolve) =>
      chrome.storage.local.get(["lastPatchPayload", "lastPatchSeq"], resolve));
    const payload = stored.lastPatchPayload;
    const importedSeq = stored.lastPatchSeq || 0;
    if (!payload) {
      alert("Nessun preventivo intercettato.\nModifica/salva il preventivo (anche un solo blur) e riprova.");
      return;
    }

    const cfg = await new Promise((resolve) =>
      chrome.storage.local.get(DEFAULTS, resolve));
    if (!cfg.apiKey) {
      alert("Configura X-API-Key in Opzioni.");
      chrome.runtime.openOptionsPage();
      return;
    }

    // Il payload e' quello del preventivo aperto? Se no, l'import chiederebbe di
    // portare in SIRJ un preventivo diverso da quello che l'utente ha davanti.
    const open = checkOpenQuote(payload.ID);
    if (open.state === "mismatch") {
      const okMismatch = confirm(
        `ATTENZIONE: il preventivo aperto non coincide con quello intercettato.\n\n` +
        `Preventivo aperto: #${open.openIds.join(", #")}\n` +
        `Preventivo da importare: #${payload.ID} — ${payload.customerdata?.CustomerName || "(?)"}, ` +
        `${payload.car || "(?)"}\n\n` +
        `Importare in SIRJ il preventivo #${payload.ID}?`
      );
      if (!okMismatch) return;
    }

    // Override manuale codice cliente (configurabile in Opzioni, issue #9)
    // Se cfg.overrideCliforNumero > 0, lo inietta nel payload e bypassa il matching automatico.
    const manualOverride = Number(cfg.overrideCliforNumero) || 0;

    const itemsPreview = payload.items.map((it, i) =>
      `  ${i + 1}. ${it.code || "(no code)"} ${it.manufacturer || ""} — ${it.description || ""} (qty ${it.num}, €${it.price})`
    ).join("\n");
    const customer = payload.customerdata?.CustomerName || "(?)";
    const overrideNote = manualOverride > 0 ? `\nOverride cliente SIRJ: #${manualOverride} (da Opzioni)` : "";
    const ok = confirm(
      `Importare in SIRJ come PR3?\n\n` +
      `Cliente: ${customer} (Code ${payload.customerdata?.CustomerCode || "?"})${overrideNote}\n` +
      `Auto: ${payload.car || "(?)"}\n` +
      `Targa: ${(payload.lplatevin || []).join(" / ")}\n` +
      `Items (${payload.items.length}):\n${itemsPreview}\n` +
      `Totale: €${payload.total || 0}`
    );
    if (!ok) return;

    const baseRecord = {
      ts: Date.now(),
      qricambiId: payload.ID,
      customer: payload.customerdata?.CustomerName || "(?)",
      car: payload.car || "",
      itemsCount: payload.items.length,
      total: payload.total || 0,
    };

    async function postQuote(body) {
      const res = await fetch(cfg.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify(body),
      });
      return { res, body: await res.json() };
    }

    // Se è configurato un override manuale, lo aggiungiamo al payload prima del primo POST.
    const initialPayload = manualOverride > 0
      ? { ...payload, override_clifor_numero: manualOverride }
      : payload;

    // true solo se l'utente ha accettato il retry su cliente generico: il retry
    // invia un oggetto nuovo (payload resta senza override) e il bridge non
    // restituisce override_clifor_numero nel body 200 (issue #27).
    let fallbackUsed = false;

    try {
      let { res, body } = await postQuote(initialPayload);

      // Cliente non trovato → offri fallback su cliente generico SIRJ #5
      // (questo ramo scatta solo se manualOverride = 0, altrimenti il 422 è un errore reale)
      if (res.status === 422 && body.customer_hint && manualOverride === 0) {
        const qrCode = body.customer_hint?.CustomerCode || "?";
        const retry = confirm(
          `Cliente non trovato in SIRJ (codice Qricambi: ${qrCode}).\n\n` +
          `Importare comunque come cliente generico SIRJ #${FALLBACK_CLIFOR_NUMERO}?`
        );
        if (retry) {
          fallbackUsed = true;
          ({ res, body } = await postQuote({
            ...payload,
            override_clifor_numero: FALLBACK_CLIFOR_NUMERO,
          }));
        } else {
          await appendToHistory({ ...baseRecord, status: "err",
            sirjNumero: null, sirjAnno: null, error: "Cliente non trovato in SIRJ" });
          toast(`Cliente non trovato in SIRJ. Codice Qricambi: ${qrCode}`, "err");
          return;
        }
      }

      if (res.status === 200) {
        const usedOverride = manualOverride > 0 ? manualOverride :
          (fallbackUsed || payload.override_clifor_numero !== undefined
            ? FALLBACK_CLIFOR_NUMERO : 0);
        const isFallback = usedOverride > 0;
        const suffix = isFallback ? `Override cliente SIRJ #${usedOverride}` : "";
        const unmatched = Array.isArray(body.unmatched_articles) ? body.unmatched_articles : [];
        const unmatchedNote = unmatched.length
          ? `${unmatched.length} articoli non agganciati a un articolo SIRJ: ` +
            unmatched.map((u) => u.code || "(no code)").join(", ")
          : "";
        if (body.collision === true) {
          // Il bridge ha scritto il PR3 ma il numero è poi risultato occupato da
          // un altro documento (#929): il preventivo importato è perso, non è un
          // successo. Avviso giallo, stato dedicato, nessun modal verde (#29).
          const msg = `Collisione numerazione: il PR3 ${body.sirj_numero}/${body.sirj_anno} ` +
            `risulta occupato da un altro documento. Controlla in SIRJ prima di reimportare.`;
          await appendToHistory({ ...baseRecord, status: "collision",
            sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: msg });
          toast(msg, "warn");
          resultModal({
            tone: "warn",
            title: "COLLISIONE NUMERAZIONE",
            numero: body.sirj_numero,
            anno: body.sirj_anno,
            customer: baseRecord.customer,
            car: baseRecord.car,
            notes: ["Il numero risulta occupato da un altro documento: " +
                    "l'import potrebbe essere andato perso. Controlla in SIRJ.",
                    suffix, unmatchedNote],
          });
        } else {
          const status = isFallback ? "ok-fallback" : "ok";
          await appendToHistory({ ...baseRecord, status,
            sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
          await clearImportedPayload(importedSeq);
          resultModal({
            tone: "ok",
            title: "IMPORTATO IN SIRJ",
            numero: body.sirj_numero,
            anno: body.sirj_anno,
            customer: baseRecord.customer,
            car: baseRecord.car,
            notes: [suffix, unmatchedNote],
          });
        }
      } else if (res.status === 409) {
        await appendToHistory({ ...baseRecord, status: "dup",
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        await clearImportedPayload(importedSeq);
        toast(`Già importato: PR3 ${body.sirj_numero}/${body.sirj_anno}`, "warn");
      } else if (res.status === 422) {
        await appendToHistory({ ...baseRecord, status: "err",
          sirjNumero: null, sirjAnno: null, error: body.error || "Errore 422" });
        toast(`Errore: ${body.error || "cliente non trovato"}`, "err");
      } else if (res.status === 503 && body.esito_incerto === true) {
        // Commit a esito incerto: il PR3 potrebbe essere stato scritto. Non
        // ritentare alla cieca: va verificato in SIRJ (#29).
        const ref = body.sirj_numero != null
          ? `il PR3 ${body.sirj_numero}/${body.sirj_anno}` : "se esiste un PR3 per questo preventivo";
        const msg = `Esito incerto: verifica in SIRJ ${ref} prima di riprovare.`;
        await appendToHistory({ ...baseRecord, status: "esito-incerto",
          sirjNumero: body.sirj_numero ?? null, sirjAnno: body.sirj_anno ?? null, error: msg });
        toast(msg, "warn");
        resultModal({
          tone: "warn",
          title: "ESITO INCERTO",
          numero: body.sirj_numero,
          anno: body.sirj_anno,
          customer: baseRecord.customer,
          car: baseRecord.car,
          notes: [`Verifica in SIRJ ${ref} prima di riprovare: ` +
                  "reimportare alla cieca può creare un secondo PR3."],
        });
      } else {
        await appendToHistory({ ...baseRecord, status: "err",
          sirjNumero: null, sirjAnno: null, error: body.error || res.statusText });
        toast(`Errore ${res.status}: ${body.error || res.statusText}`, "err");
      }
    } catch (e) {
      await appendToHistory({ ...baseRecord, status: "err",
        sirjNumero: null, sirjAnno: null, error: e.message });
      toast(`Errore rete: ${e.message}`, "err");
    }
  }

  function toast(msg, kind) {
    const t = document.createElement("div");
    const colors = { ok: "#2e7d32", warn: "#ef6c00", err: "#c62828" };
    t.textContent = msg;
    t.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:99999;
      background:${colors[kind] || "#333"};color:white;
      padding:12px 18px;border-radius:6px;font-weight:600;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:400px;
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  // Modal centrale di esito import (v1.1.5, generalizzato per #29).
  // A differenza del toast (auto-dismiss 6s, angolo), questo oscura la pagina
  // e resta finché l'utente non clicca OK / preme Invio o Esc / clicca fuori:
  // impossibile non vedere il numero PR3.
  // tone "ok" = verde (import riuscito); tone "warn" = arancione/giallo (collisione
  // di numerazione, esito incerto): mai verde se l'esito non è certo (#29).
  // notes: righe di dettaglio, vuote ignorate.
  function resultModal({ tone, title: titleText, numero, anno, customer, car, notes }) {
    const COLOR = tone === "warn" ? "#ef6c00" : "#2e7d32";
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;
      background:rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    `;

    const card = document.createElement("div");
    card.style.cssText = `
      background:#fff;border-radius:14px;border-top:6px solid ${COLOR};
      padding:28px 36px 24px;max-width:440px;width:90%;
      box-shadow:0 12px 40px rgba(0,0,0,0.4);text-align:center;
    `;

    const check = document.createElement("div");
    check.textContent = tone === "warn" ? "!" : "✓";
    check.style.cssText = `
      width:64px;height:64px;margin:0 auto 12px;border-radius:50%;
      background:${COLOR};color:#fff;font-size:38px;line-height:64px;font-weight:700;
    `;

    const title = document.createElement("div");
    title.textContent = titleText;
    title.style.cssText = `
      font-size:15px;font-weight:700;letter-spacing:1px;color:#555;margin-bottom:6px;
    `;

    const num = document.createElement("div");
    num.textContent = numero != null ? `PR3 ${numero}/${anno}` : "PR3 da verificare";
    num.style.cssText = `
      font-size:34px;font-weight:800;color:${COLOR};margin:4px 0 14px;
    `;

    const meta = document.createElement("div");
    meta.textContent = [customer, car].filter(Boolean).join(" · ");
    meta.style.cssText = `font-size:14px;color:#666;margin-bottom:4px;`;

    const btn = document.createElement("button");
    btn.textContent = "OK";
    btn.style.cssText = `
      margin-top:18px;background:${COLOR};color:#fff;border:none;
      padding:10px 40px;border-radius:8px;font-size:15px;font-weight:700;
      cursor:pointer;
    `;

    card.append(check, title, num, meta);
    (notes || []).filter(Boolean).forEach((text) => {
      const note = document.createElement("div");
      note.textContent = text;
      note.style.cssText = `font-size:12px;color:#ef6c00;margin-top:4px;`;
      card.append(note);
    });
    card.append(btn);
    overlay.append(card);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); close(); }
    }
    btn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    btn.focus();
  }

  // ── 3. Registrazione handler per il menu FAB ────────────────────────
  window.__AR_QRICAMBI.onImport = handleClick;
})();
