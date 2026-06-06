// import.content.js — AR AUTO — Qricambi v1.1.5 (ISOLATED world)
// Riceve payload via window.postMessage da injected.js (MAIN world) e li salva
// in chrome.storage.local. Gestisce handler import (window.__AR_QRICAMBI.onImport),
// storico import e POST al backend AR AUTO.
(function () {
  const TAG = "[QUOTE-IMPORT v1.1.5]";
  console.log(TAG, "content script loaded (isolated)");

  // ── 0. Valore fallback clifor — letto da storage, default 5 ──────────
  // Inizializzato subito; se handleClick() viene invocato prima del callback
  // (improbabile ma possibile), usa comunque il default sicuro.
  let FALLBACK_CLIFOR_NUMERO = 5;
  chrome.storage.local.get({ fallbackCliforNumero: 5 }, ({ fallbackCliforNumero }) => {
    FALLBACK_CLIFOR_NUMERO = fallbackCliforNumero;
    console.log(TAG, "fallbackCliforNumero loaded:", FALLBACK_CLIFOR_NUMERO);
  });

  // ── 1. Listener postMessage dal main-world script ─────────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "AR_QUOTE_IMPORT" || !data.payload) return;
    chrome.storage.local.set({ lastPatchPayload: data.payload });
    console.log(TAG, "received payload from main-world ID=", data.payload.ID,
                "items=", data.payload.items.length);
  });

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

  async function handleClick() {
    const stored = await new Promise((resolve) =>
      chrome.storage.local.get(["lastPatchPayload"], resolve));
    const payload = stored.lastPatchPayload;
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
          (body.override_clifor_numero !== undefined || payload.override_clifor_numero !== undefined
            ? FALLBACK_CLIFOR_NUMERO : 0);
        const isFallback = usedOverride > 0;
        const status = isFallback ? "ok-fallback" : "ok";
        await appendToHistory({ ...baseRecord, status,
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        const suffix = isFallback ? `Override cliente SIRJ #${usedOverride}` : "";
        successModal({
          numero: body.sirj_numero,
          anno: body.sirj_anno,
          customer: baseRecord.customer,
          car: baseRecord.car,
          suffix,
        });
      } else if (res.status === 409) {
        await appendToHistory({ ...baseRecord, status: "dup",
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        toast(`Già importato: PR3 ${body.sirj_numero}/${body.sirj_anno}`, "warn");
      } else if (res.status === 422) {
        await appendToHistory({ ...baseRecord, status: "err",
          sirjNumero: null, sirjAnno: null, error: body.error || "Errore 422" });
        toast(`Errore: ${body.error || "cliente non trovato"}`, "err");
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

  // Modal centrale di conferma import riuscito (v1.1.5).
  // A differenza del toast (auto-dismiss 6s, angolo), questo oscura la pagina
  // e resta finché l'utente non clicca OK / preme Invio o Esc / clicca fuori:
  // impossibile non vedere il numero PR3 generato.
  function successModal({ numero, anno, customer, car, suffix }) {
    const GREEN = "#2e7d32";
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;
      background:rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    `;

    const card = document.createElement("div");
    card.style.cssText = `
      background:#fff;border-radius:14px;border-top:6px solid ${GREEN};
      padding:28px 36px 24px;max-width:440px;width:90%;
      box-shadow:0 12px 40px rgba(0,0,0,0.4);text-align:center;
    `;

    const check = document.createElement("div");
    check.textContent = "✓";
    check.style.cssText = `
      width:64px;height:64px;margin:0 auto 12px;border-radius:50%;
      background:${GREEN};color:#fff;font-size:38px;line-height:64px;font-weight:700;
    `;

    const title = document.createElement("div");
    title.textContent = "IMPORTATO IN SIRJ";
    title.style.cssText = `
      font-size:15px;font-weight:700;letter-spacing:1px;color:#555;margin-bottom:6px;
    `;

    const num = document.createElement("div");
    num.textContent = `PR3 ${numero}/${anno}`;
    num.style.cssText = `
      font-size:34px;font-weight:800;color:${GREEN};margin:4px 0 14px;
    `;

    const meta = document.createElement("div");
    meta.textContent = [customer, car].filter(Boolean).join(" · ");
    meta.style.cssText = `font-size:14px;color:#666;margin-bottom:4px;`;

    const btn = document.createElement("button");
    btn.textContent = "OK";
    btn.style.cssText = `
      margin-top:18px;background:${GREEN};color:#fff;border:none;
      padding:10px 40px;border-radius:8px;font-size:15px;font-weight:700;
      cursor:pointer;
    `;

    card.append(check, title, num, meta);
    if (suffix) {
      const note = document.createElement("div");
      note.textContent = suffix;
      note.style.cssText = `font-size:12px;color:#ef6c00;margin-top:4px;`;
      card.append(note);
    }
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
