// content.js — quote-import-ext v0.1.0
(function () {
  const TAG = "[QUOTE-IMPORT v0.1.0]";
  console.log(TAG, "content script loaded");

  let lastPatchPayload = null;

  // ── 1. Fetch interceptor ─────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const [resource, init] = args;
    try {
      const url = typeof resource === "string" ? resource : resource.url;
      const method = (init?.method || "").toUpperCase();
      if (method === "PATCH" && url.includes("/api/Quote") && init?.body) {
        try {
          const parsed = typeof init.body === "string"
            ? JSON.parse(init.body)
            : null;
          if (parsed && parsed.ID && Array.isArray(parsed.items)) {
            lastPatchPayload = parsed;
            chrome.storage.local.set({ lastPatchPayload: parsed });
            console.log(TAG, "intercepted PATCH /api/Quote ID=", parsed.ID);
          }
        } catch (e) { /* non-JSON body, ignora */ }
      }
    } catch (e) { /* non rompere mai il fetch originale */ }
    return origFetch.apply(this, args);
  };

  // ── 2. FAB injection con backoff (riuso pattern pricing-ext-v5) ──────
  function injectFab(attempt) {
    if (document.getElementById("ar-quote-import-fab")) return;
    const btn = document.createElement("button");
    btn.id = "ar-quote-import-fab";
    btn.textContent = DEFAULTS.fabLabel;
    btn.style.cssText = `
      position:fixed;right:${DEFAULTS.fabPosition.right};
      bottom:${DEFAULTS.fabPosition.bottom};z-index:${DEFAULTS.fabZIndex || 1000000};
      background:${DEFAULTS.fabBgColor};color:white;border:0;
      padding:12px 18px;border-radius:30px;font-weight:600;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;font-size:14px;
    `;
    btn.onclick = handleClick;
    document.body.appendChild(btn);
    console.log(TAG, "FAB injected on attempt", attempt);
  }

  function startInjection() {
    let attempt = 1, delay = DEFAULTS.injectionInitialDelayMs;
    function tryInject() {
      if (document.body) { injectFab(attempt); return; }
      if (attempt++ >= DEFAULTS.injectionMaxAttempts) {
        console.warn(TAG, "Injection aborted after max attempts"); return;
      }
      delay = Math.min(delay * 2, DEFAULTS.injectionMaxDelayMs);
      setTimeout(tryInject, delay);
    }
    tryInject();
  }
  startInjection();

  // ── 3. Click handler: leggi payload, conferma, POST al backend ──────
  async function handleClick() {
    const stored = await new Promise((resolve) =>
      chrome.storage.local.get(["lastPatchPayload"], resolve));
    const payload = stored.lastPatchPayload;
    if (!payload) {
      alert("Nessun preventivo intercettato.\nModifica/salva il preventivo (anche un solo blur) e riprova.");
      return;
    }

    const cfg = await new Promise((resolve) =>
      chrome.storage.sync.get(DEFAULTS, resolve));
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

    btnLoading(true);
    try {
      const res = await fetch(cfg.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.status === 200) {
        chrome.storage.local.set({
          lastQricambiId: payload.ID,
          lastSirjNumero: body.sirj_numero,
          lastSirjAnno: body.sirj_anno,
          lastError: null,
        });
        toast(`✓ Importato come PR3 ${body.sirj_numero}/${body.sirj_anno}`, "ok");
      } else if (res.status === 409) {
        toast(`Già importato: PR3 ${body.sirj_numero}/${body.sirj_anno}`, "warn");
      } else if (res.status === 422) {
        toast(`Cliente non trovato in SIRJ. Codice Qricambi: ${body.customer_hint?.CustomerCode || "?"}`, "err");
      } else {
        chrome.storage.local.set({ lastError: body.error || res.statusText });
        toast(`Errore ${res.status}: ${body.error || res.statusText}`, "err");
      }
    } catch (e) {
      chrome.storage.local.set({ lastError: e.message });
      toast(`Errore rete: ${e.message}`, "err");
    } finally {
      btnLoading(false);
    }
  }

  function btnLoading(on) {
    const b = document.getElementById("ar-quote-import-fab");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "…" : DEFAULTS.fabLabel;
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
})();
