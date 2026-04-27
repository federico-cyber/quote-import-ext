// defaults.js — riusato pattern da pricing-ext-v5
const DEFAULTS = {
  backendUrl: "http://100.86.223.69:5008/api/quote-import",  // qricambi-bridge via Tailscale
  apiKey: "",                      // settato da options.html
  fabBgColor: "#2e7d32",           // verde (vs rosso pricing-ext-v5)
  fabLabel: "→ SIRJ",
  fabPosition: { right: "24px", bottom: "150px" },  // sopra il FAB pricing-ext-v5 (bottom:80px)
  fabZIndex: 1000000,                                 // sopra pricing (999999)
  injectionMaxAttempts: 8,
  injectionInitialDelayMs: 200,
  injectionMaxDelayMs: 30000,
};
