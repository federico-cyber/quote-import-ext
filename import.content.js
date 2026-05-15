// import.content.js — AR AUTO — Qricambi v1.0.0 (ISOLATED world)
// Riceve payload via window.postMessage da injected.js (MAIN world) e li salva
// in chrome.storage.local. Gestisce handler import (window.__AR_QRICAMBI.onImport),
// storico import e POST al backend AR AUTO.
(function () {
  const TAG = "[QUOTE-IMPORT v1.0.0]";
  console.log(TAG, "content script loaded (isolated)");

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

    const itemsPreview = payload.items.map((it, i) =>
      `  ${i + 1}. ${it.code || "(no code)"} ${it.manufacturer || ""} — ${it.description || ""} (qty ${it.num}, €${it.price})`
    ).join("\n");
    const customer = payload.customerdata?.CustomerName || "(?)";
    const ok = confirm(
      `Importare in SIRJ come PR3?\n\n` +
      `Cliente: ${customer} (Code ${payload.customerdata?.CustomerCode || "?"})\n` +
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

    const FALLBACK_CLIFOR_NUMERO = 5;

    async function postQuote(body) {
      const res = await fetch(cfg.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify(body),
      });
      return { res, body: await res.json() };
    }

    try {
      let { res, body } = await postQuote(payload);

      // Cliente non trovato → offri fallback su cliente generico SIRJ #5
      if (res.status === 422 && body.customer_hint) {
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
        const isFallback = body.override_clifor_numero !== undefined ||
          payload.override_clifor_numero !== undefined;
        const status = isFallback ? "ok-fallback" : "ok";
        await appendToHistory({ ...baseRecord, status,
          sirjNumero: body.sirj_numero, sirjAnno: body.sirj_anno, error: null });
        const suffix = isFallback ? ` (cliente generico #${FALLBACK_CLIFOR_NUMERO})` : "";
        toast(`✓ Importato come PR3 ${body.sirj_numero}/${body.sirj_anno}${suffix}`, "ok");
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

  // ── 3. Registrazione handler per il menu FAB ────────────────────────
  window.__AR_QRICAMBI.onImport = handleClick;
})();
