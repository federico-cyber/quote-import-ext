// defaults.js — single source of truth per l'estensione unificata "AR AUTO — Qricambi".
// Caricato prima di fab.js / pricing.content.js / import.content.js (content scripts)
// e di options.js / popup.js (pagine estensione).
// Version: 1.0.0
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
  // ── FAB injection (usate da fab.js) ─────────────────────────────────
  fabZIndex: 1000000,
  injectionMaxAttempts: 8,
  injectionInitialDelayMs: 200,
  injectionMaxDelayMs: 30000,
  // ── Pricing+Import combinato (fab.js onBoth) ────────────────────────
  // Attesa dopo pricing prima di lanciare l'import: il PATCH /api/Quote
  // intercettato da injected.js deve aver popolato lastPatchPayload.
  bothWaitMs: 1800,
};
