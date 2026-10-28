// defaults.js — single source of truth per l'estensione unificata "AR AUTO — Qricambi".
// Caricato prima di fab.js / pricing.content.js / import.content.js (content scripts)
// e di options.js / popup.js (pagine estensione).
// Version: 1.2.0
const DEFAULTS = {
  // ── Regole pricing (ex pricing-ext-v5 v6.1) ─────────────────────────
  regADelta: 20,
  regACapThreshold: 80,
  regACapValue: 70,
  regCThreshold: 78,
  regCMarkup: 77,
  regBMultiplier: 2.0,
  regBDiscount: 30,
  uiRoundStep: 5,
  uiThresholdLow: 10,
  uiThresholdHigh: 35,
  // ── Backend import SIRJ (ex quote-import-ext v0.5.0) ────────────────
  backendUrl: "http://100.86.223.69:5008/api/quote-import",
  apiKey: "",
  overrideCliforNumero: 0,  // 0 = nessun override (usa matching automatico)
  fallbackCliforNumero: 5,  // cliente generico SIRJ se il matching automatico fallisce (issue #10)
  // ── FAB injection (usate da fab.js) ─────────────────────────────────
  fabZIndex: 1000000,
  injectionMaxAttempts: 8,
  injectionInitialDelayMs: 200,
  injectionMaxDelayMs: 30000,
  // ── Pricing+Import combinato (fab.js onBoth) ────────────────────────
  // Nessuna attesa fissa (#31): l'import parte dopo la scrittura di
  // chrome.storage.local.lastPatchPayload (PATCH /api/Quote confermata da Qricambi).
  // bothWaitMs = timeout massimo di attesa di quella scrittura, dopo il pricing;
  // bothSettleMs = quiete richiesta dall'ultima scrittura (PATCH ravvicinate).
  bothWaitMs: 15000,
  bothSettleMs: 600,
};

// Numeri a 4+ cifre nell'URL (path, query, hash): candidati ID del preventivo
// aperto. Il formato esatto dell'URL Qricambi non e' documentato: se non c'e'
// nessun candidato l'URL non dice nulla. Unica copia, usata dall'import
// (checkOpenQuote) e dal pricing (scegliPreventivo, fascia del cliente).
function idsFromHref(href) {
  const rest = String(href || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]*/i, "");
  const ids = [];
  const re = /(?<=[\/=&?#])(\d{4,})(?=[\/&?#]|$)/g;
  let m;
  while ((m = re.exec(rest))) ids.push(m[1]);
  return ids;
}
