// defaults.js — single source of truth per l'estensione unificata "AR AUTO — Qricambi".
// Caricato prima di fab.js / pricing.content.js / import.content.js (content scripts)
// e di options.js / popup.js (pagine estensione).
// Version: 1.2.11
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
  // Interruttori di rollback (v1.2.1): spenti dalle Opzioni = comportamento di prima,
  // senza nuova release. importAttendeInVolo si legge a ogni Pricing + Import;
  // quoteOpenSoloOk al caricamento della pagina Qricambi (poi ricaricarla).
  // #47: Pricing + Import importa solo a zero salvataggi in volo (oltre alla quiete
  // di bothSettleMs) e mai se l'ultimo salvataggio non e' confermato. Spento: solo
  // quiete dall'ultima scrittura, come prima.
  importAttendeInVolo: true,
  // #49: il preventivo "aperto" (mismatch all'import) si segna solo su una
  // GET find/<id> riuscita (2xx). Spento: lo si segna all'invio, come prima.
  quoteOpenSoloOk: true,
  // #34 (v1.2.3): listino non sopra l'acquisto -> Regola B invece di Regola A
  // (che venderebbe sotto costo). Spento: Regola A come prima. Vale dal prossimo pricing.
  regBSottoCosto: true,
  // #59: la fascia sconto del cliente (arauto#4911) si legge sempre dal cliente
  // scelto nel form del preventivo, anche non salvato. L'interruttore
  // `fasciaClienteDalForm` (1.2.6-1.2.7) non c'e' piu' (#63): un `false` salvato
  // nelle Opzioni con la 1.2.6, quando era il default, copriva il default nuovo e
  // lasciava il Pricing a chiedere di salvare un preventivo che non si salva.
};

// Indirizzi a cui l'estensione puo' inviare: gli stessi di manifest.json:host_permissions
// (tests/test_import_backend_url_guard.js verifica che coincidano). Un backendUrl fuori
// da questi non arriva mai a fetch (#68): Chrome lo bloccherebbe comunque, ma con un
// errore di rete opaco invece che con il motivo.
const BACKEND_HOST_PATTERNS = [
  "*://*.qricambi.com/*",
  "http://100.86.223.69:5008/*",
  "http://192.168.1.41:5008/*",
  "http://localhost:5008/*",
];

// null se `value` e' un indirizzo valido per il backend, altrimenti il motivo (stringa).
// Unica copia, usata dall'import (handleClick) e dalle Opzioni (salvataggio).
function backendUrlProblem(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "l'indirizzo e' vuoto";
  let u;
  try { u = new URL(raw); } catch (e) { return "non e' un indirizzo completo (serve http://host:porta/percorso)"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "deve iniziare con http:// o https://";
  if (u.username || u.password) return "non deve contenere utente e password";
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const ammesso = BACKEND_HOST_PATTERNS.some((pat) => {
    const m = /^(\*|https?):\/\/([^\/:]+)(?::(\d+))?\/\*$/.exec(pat);
    if (!m) return false;
    const [, schema, host, pPort] = m;
    if (schema !== "*" && schema + ":" !== u.protocol) return false;
    if (pPort && pPort !== port) return false;
    return host.startsWith("*.")
      ? (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)))
      : u.hostname === host;
  });
  return ammesso ? null : "indirizzo non ammesso (" + u.protocol + "//" + u.host + "): ammessi solo quelli dei permessi dell'estensione";
}

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
