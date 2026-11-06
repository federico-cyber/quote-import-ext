/* Test della guardia sull'indirizzo del server (backendUrl) — quote-import-ext#68.
 *
 * Invarianti sotto test:
 *  1. backendUrlProblem (defaults.js) rifiuta vuoto, solo spazi, relativo, schema
 *     diverso da http/https e host fuori da manifest.host_permissions; accetta
 *     l'indirizzo normale e gli altri host ammessi. Torna null se valido, altrimenti
 *     il motivo (stringa).
 *  2. La lista degli host ammessi in defaults.js coincide con host_permissions di
 *     manifest.json (se cambia uno, cambia l'altro).
 *  3. handleClick (import.content.js) con indirizzo non valido: nessuna fetch,
 *     alert col motivo, openOptionsPage, nessuna conferma all'utente, payload
 *     intatto (si puo' riprovare dopo aver corretto). Con apiKey vuota resta il
 *     messaggio di prima. Con l'indirizzo normale l'invio parte e il payload
 *     inviato e' identico a quello intercettato.
 *  4. options.js: salvando un backendUrl non valido NON scrive in chrome.storage
 *     e mostra l'errore; con uno valido salva.
 *
 * import.content.js e options.js sono legati a chrome/DOM: li eseguiamo interi in
 * vm con chrome, fetch, alert, confirm e document stubbati (nessuna rete reale).
 * Node puro, zero dipendenze, exit code 1 se fallisce.
 *   node tests/test_import_backend_url_guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DEFAULTS_SRC = fs.readFileSync(path.join(ROOT, 'defaults.js'), 'utf8');
const IMPORT_SRC = fs.readFileSync(path.join(ROOT, 'import.content.js'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Simboli di defaults.js (caricato prima di import.content.js / options.js).
const fromDefaults = (name) => {
  const c = vm.createContext({ URL });
  vm.runInContext(DEFAULTS_SRC, c);
  return vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, c);
};
const idsFromHref = fromDefaults('idsFromHref');
const backendUrlProblem = fromDefaults('backendUrlProblem');
const DEFAULTS = fromDefaults('DEFAULTS');

const VALIDO = 'http://100.86.223.69:5008/api/quote-import';
const A = 4711;
const PAYLOAD = {
  ID: A,
  customerdata: { CustomerName: 'Cliente', CustomerCode: 'C1' },
  car: 'Auto', lplatevin: ['AB123CD'], total: 100,
  items: [{ code: 'C1', manufacturer: 'M', description: 'd', num: 1, price: 100 }],
};

function fakeEl() {
  return {
    children: [], style: {}, textContent: '',
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, focus() {}, remove() {},
  };
}

// ── harness di import.content.js ────────────────────────────────────────
function makeImportEnv({ backendUrl = VALIDO, apiKey = 'k' } = {}) {
  const store = {
    importHistory: [], fallbackCliforNumero: 5, apiKey, backendUrl,
    overrideCliforNumero: 0, lastPatchPayload: PAYLOAD, lastPatchSeq: 1,
  };
  const sent = [];       // { url, body } per ogni fetch
  const alerts = [];
  const confirms = [];
  const calls = { openOptionsPage: 0 };
  const listeners = [];
  const ctx = {
    console: { log() {} },
    DEFAULTS: { apiKey: '', backendUrl: '', overrideCliforNumero: 0 },
    idsFromHref,
    backendUrlProblem,
    URL,
    AbortController,
    clearTimeout() {},
    chrome: {
      runtime: { openOptionsPage() { calls.openOptionsPage++; } },
      storage: { local: {
        get(keys, cb) {
          const out = {};
          if (typeof keys === 'string') keys = [keys];
          if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
          else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); if (cb) cb(); },
      } },
    },
    alert: (m) => alerts.push(m),
    confirm: (m) => { confirms.push(m); return true; },
    fetch: async (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return { status: 200, statusText: 'OK', json: async () => ({ sirj_numero: 1, sirj_anno: 2026 }) };
    },
    document: { createElement: fakeEl, body: fakeEl(), addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0,
    location: { href: `https://app.qricambi.com/quote/${A}` },
  };
  ctx.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  vm.createContext(ctx);
  ctx.window = vm.runInContext('globalThis', ctx);
  vm.runInContext(IMPORT_SRC, ctx);
  return { store, sent, alerts, confirms, calls, click: () => ctx.window.__AR_QRICAMBI.onImport() };
}

// ── harness di options.js ───────────────────────────────────────────────
function makeOptionsEnv({ backendUrl }) {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, value: '', checked: false, style: {}, textContent: '', className: '',
    parentElement: { querySelector: () => null, appendChild() {} },
    addEventListener(type, fn) { this[`on_${type}`] = fn; },
  });
  const writes = [];
  const store = {};
  const document = {
    getElementById: el,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, remove() {} }),
    addEventListener() {},
  };
  const ctx = {
    document, DEFAULTS, confirm: () => true, URL, backendUrlProblem,
    setTimeout: () => 0,
    chrome: { storage: { local: {
      get(keys, cb) { cb({ ...DEFAULTS, ...store }); },
      set(obj, cb) { writes.push(obj); Object.assign(store, obj); if (cb) cb(); },
    } } },
  };
  vm.createContext(ctx);
  // DEFAULTS e' const nel suo script: qui lo passiamo gia' pronto nel contesto.
  vm.runInContext(OPTIONS_SRC, ctx);
  // campi numerici validi (come dopo loadSettings)
  const mappa = {
    'reg-a-delta': 'regADelta', 'reg-a-cap-threshold': 'regACapThreshold', 'reg-a-cap-value': 'regACapValue',
    'reg-c-threshold': 'regCThreshold', 'reg-c-markup': 'regCMarkup', 'reg-b-multiplier': 'regBMultiplier',
    'reg-b-discount': 'regBDiscount', 'ui-round-step': 'uiRoundStep', 'ui-threshold-low': 'uiThresholdLow',
    'ui-threshold-high': 'uiThresholdHigh', overrideCliforNumero: 'overrideCliforNumero',
    fallbackCliforNumero: 'fallbackCliforNumero',
  };
  for (const [id, k] of Object.entries(mappa)) el(id).value = String(DEFAULTS[k]);
  el('backendUrl').value = backendUrl;
  el('apiKey').value = 'chiave';
  return { writes, status: el('status'), save: () => el('save-btn').on_click() };
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// ── 1. helper ───────────────────────────────────────────────────────────
test('backendUrlProblem esiste in defaults.js', () => {
  assert.strictEqual(typeof backendUrlProblem, 'function');
});

const NON_VALIDI = [
  ['vuoto', ''],
  ['solo spazi', '   '],
  ['undefined', undefined],
  ['relativo', '/api/quote-import'],
  ['senza schema', '100.86.223.69:5008/api/quote-import'],
  ['schema ftp', 'ftp://100.86.223.69:5008/api/quote-import'],
  ['schema javascript', 'javascript:alert(1)'],
  ['host fuori dai permessi', 'https://evil.example/api/quote-import'],
  ['host che finisce come uno ammesso', 'https://evilqricambi.com/api'],
  ['sottodominio finto', 'https://qricambi.com.evil.example/api'],
  ['porta diversa su host ammesso', 'http://100.86.223.69:9999/api/quote-import'],
  ['schema https su host solo http', 'https://100.86.223.69:5008/api/quote-import'],
  ['credenziali nell\'URL', 'http://user:pw@evil.example:5008/api'],
];
for (const [nome, v] of NON_VALIDI) {
  test(`helper: ${nome} -> rifiutato con un motivo`, () => {
    const r = backendUrlProblem(v);
    assert.strictEqual(typeof r, 'string', `atteso un motivo, ottenuto ${r}`);
    assert.ok(r.length > 0);
  });
}

const VALIDI = [
  ['indirizzo normale', VALIDO],
  ['con spazi attorno', `  ${VALIDO}  `],
  ['LAN', 'http://192.168.1.41:5008/api/quote-import'],
  ['localhost', 'http://localhost:5008/api/quote-import'],
  ['qricambi.com', 'https://app.qricambi.com/api/quote-import'],
];
for (const [nome, v] of VALIDI) {
  test(`helper: ${nome} -> accettato`, () => {
    assert.strictEqual(backendUrlProblem(v), null);
  });
}

// ── 2. coerenza col manifest ────────────────────────────────────────────
test('gli host ammessi coincidono con manifest.host_permissions', () => {
  const lista = fromDefaults('BACKEND_HOST_PATTERNS');
  assert.ok(Array.isArray(lista), 'BACKEND_HOST_PATTERNS non esportata da defaults.js');
  assert.deepStrictEqual([...lista].sort(), [...MANIFEST.host_permissions].sort());
});

// ── 3. handleClick ──────────────────────────────────────────────────────
for (const [nome, v] of NON_VALIDI.filter(([, x]) => typeof x === 'string')) {
  test(`handleClick con indirizzo ${nome}: nessuna fetch, alert, Opzioni aperte`, async () => {
    const e = makeImportEnv({ backendUrl: v });
    await e.click();
    assert.strictEqual(e.sent.length, 0, 'fetch partita con indirizzo non valido');
    assert.strictEqual(e.alerts.length, 1, 'atteso un alert col motivo');
    assert.ok(/indirizzo/i.test(e.alerts[0]), 'alert senza motivo: ' + e.alerts[0]);
    assert.strictEqual(e.calls.openOptionsPage, 1, 'Opzioni non aperte');
    assert.strictEqual(e.confirms.length, 0, 'chiesta conferma prima di bloccare');
    assert.ok(e.store.lastPatchPayload, 'payload perso: non si potrebbe riprovare');
  });
}

test('handleClick con indirizzo normale: invio come oggi, payload identico', async () => {
  const e = makeImportEnv();
  await e.click();
  assert.strictEqual(e.sent.length, 1);
  assert.strictEqual(e.sent[0].url, VALIDO);
  assert.deepStrictEqual(e.sent[0].body, PAYLOAD);
  assert.strictEqual(e.alerts.length, 0);
  assert.strictEqual(e.calls.openOptionsPage, 0);
});

test('handleClick: indirizzo con spazi attorno -> fetch verso l\'indirizzo ripulito', async () => {
  const e = makeImportEnv({ backendUrl: `  ${VALIDO}  ` });
  await e.click();
  assert.strictEqual(e.sent.length, 1);
  assert.strictEqual(e.sent[0].url, VALIDO);
});

test('handleClick con apiKey vuota: resta il messaggio di prima (anche con indirizzo non valido)', async () => {
  const e = makeImportEnv({ apiKey: '', backendUrl: '' });
  await e.click();
  assert.strictEqual(e.sent.length, 0);
  assert.deepStrictEqual(e.alerts, ['Configura X-API-Key in Opzioni.']);
  assert.strictEqual(e.calls.openOptionsPage, 1);
});

// ── 4. Opzioni ──────────────────────────────────────────────────────────
for (const [nome, v] of NON_VALIDI.filter(([, x]) => typeof x === 'string')) {
  test(`Opzioni: salvataggio con indirizzo ${nome} rifiutato, storage non scritto`, () => {
    const o = makeOptionsEnv({ backendUrl: v });
    o.save();
    assert.strictEqual(o.writes.length, 0, 'scritto in chrome.storage.local con indirizzo non valido');
    assert.ok(/indirizzo|corregg/i.test(o.status.textContent), 'nessun errore mostrato: ' + o.status.textContent);
  });
}

test('Opzioni: indirizzo valido -> salva (backendUrl ripulito)', () => {
  const o = makeOptionsEnv({ backendUrl: `  ${VALIDO}  ` });
  o.save();
  assert.strictEqual(o.writes.length, 1);
  assert.strictEqual(o.writes[0].backendUrl, VALIDO);
  assert.strictEqual(o.writes[0].apiKey, 'chiave');
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); passed++; console.log(`ok    ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
