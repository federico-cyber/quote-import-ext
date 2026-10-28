/* Test della guardia sul payload importato — quote-import-ext#30.
 *
 * Invarianti sotto test:
 *  1. handleClick (import.content.js) NON importa in silenzio un payload che
 *     non appartiene al preventivo aperto: se l'ID del payload non coincide con
 *     quello del preventivo aperto (URL della pagina, o ultimo preventivo aperto
 *     visto da injected.js) chiede conferma mostrando i DUE preventivi e fa la
 *     POST solo se l'utente dice si'.
 *  2. Due PATCH ravvicinate con risposte fuori ordine: lastPatchPayload resta
 *     quello dell'ULTIMO invio, non dell'ultima risposta arrivata (injected.js
 *     pubblica in ordine di invio, import.content.js scarta i messaggi piu' vecchi).
 *  3. Dopo un import concluso (200 o 409) lastPatchPayload viene azzerato; negli
 *     altri esiti (422, rete, annullato) resta, cosi' si puo' riprovare.
 *
 * import.content.js e injected.js sono IIFE legati a chrome/DOM: li eseguiamo
 * interi in vm/new Function con chrome.storage, fetch, confirm e window stubbati
 * (nessuna rete reale). Node puro, zero dipendenze, exit code 1 se fallisce.
 *   node tests/test_import_payload_guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// idsFromHref vive in defaults.js (caricato prima di import.content.js).
const idsFromHref = (() => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'defaults.js'), 'utf8'), c);
  return vm.runInContext('idsFromHref', c);
})();


const IMPORT_SRC = fs.readFileSync(path.join(__dirname, '..', 'import.content.js'), 'utf8');
const INJECTED_SRC = fs.readFileSync(path.join(__dirname, '..', 'injected.js'), 'utf8');

function quote(id, extra = {}) {
  return {
    ID: id,
    customerdata: { CustomerName: `Cliente ${id}`, CustomerCode: `C${id}` },
    car: `Auto ${id}`, lplatevin: ['AB123CD'], total: 100,
    items: [{ code: 'C1', manufacturer: 'M', description: 'd', num: 1, price: 100 }],
    ...extra,
  };
}
const A = 4711;
const B = 9999;

function fakeEl() {
  return {
    children: [], style: {}, textContent: '',
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, focus() {}, remove() {},
  };
}

// ── harness di import.content.js ────────────────────────────────────────
function makeImportEnv({ href = 'https://app.qricambi.com/', stored = quote(A), storedSeq = 0,
                         responses = [{ status: 200, body: { sirj_numero: 1, sirj_anno: 2026 } }],
                         confirms = [true, true] } = {}) {
  const store = {
    importHistory: [], fallbackCliforNumero: 5,
    apiKey: 'k', backendUrl: 'http://bridge.invalid/import', overrideCliforNumero: 0,
  };
  if (stored) { store.lastPatchPayload = stored; store.lastPatchSeq = storedSeq; }
  const sent = [];
  const confirmTexts = [];
  const alerts = [];
  const listeners = [];
  const removed = [];
  const body = fakeEl();
  const ctx = {
    console: { log() {} },
    DEFAULTS: { apiKey: '', backendUrl: '', overrideCliforNumero: 0 },
    idsFromHref,
    chrome: {
      runtime: { openOptionsPage() {} },
      storage: { local: {
        get(keys, cb) {
          const out = {};
          if (typeof keys === 'string') keys = [keys];
          if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
          else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { removed.push(k); delete store[k]; });
          if (cb) cb();
        },
      } },
    },
    alert: (m) => alerts.push(m),
    confirm: (m) => { confirmTexts.push(m); return confirms.length ? confirms.shift() : true; },
    fetch: async (url, opts) => {
      sent.push(JSON.parse(opts.body));
      const r = responses.shift();
      if (r.throw) throw new Error(r.throw);
      return { status: r.status, statusText: 'x', json: async () => r.body };
    },
    document: { createElement: fakeEl, body, addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0,
    location: { href },
  };
  ctx.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  vm.createContext(ctx);
  // `window` deve essere l'oggetto globale del contesto (event.source === window)
  const globalObj = vm.runInContext('globalThis', ctx);
  ctx.window = globalObj;
  vm.runInContext(IMPORT_SRC, ctx);
  // simula un postMessage di injected.js (MAIN) verso il content script
  const post = (data) => listeners.forEach((fn) => fn({ source: globalObj, data }));
  return { ctx, store, sent, confirmTexts, alerts, removed, post,
           click: () => ctx.window.__AR_QRICAMBI.onImport() };
}

// ── harness di injected.js ──────────────────────────────────────────────
function makeInjectedEnv() {
  const messages = [];
  const pendingFetch = [];
  const win = {
    fetch: (url, init) => new Promise((resolve) => pendingFetch.push({ url, init, resolve })),
    XMLHttpRequest: function () {},
    postMessage: (m) => messages.push(m),
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'console', INJECTED_SRC)(win, { log() {}, error() {} });
  return { win, messages, pendingFetch };
}

const PATCH_URL = 'https://app.qricambi.com/api/Quote';
const patchInit = (p) => ({ method: 'PATCH', body: JSON.stringify(p) });

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// ── 1. preventivo aperto diverso da quello intercettato ─────────────────
test('URL su B, payload di A: chiede conferma coi due preventivi e, se rifiutata, niente POST', async () => {
  const e = makeImportEnv({ href: `https://app.qricambi.com/quote/${B}`, confirms: [false] });
  await e.click();
  assert.strictEqual(e.sent.length, 0, 'POST partita col payload di A mentre e aperto B');
  assert.strictEqual(e.confirmTexts.length, 1, 'attesa una sola conferma (quella di mismatch)');
  const t = e.confirmTexts[0];
  assert.ok(t.includes(String(A)) && t.includes(String(B)),
    'la conferma non mostra entrambi i preventivi: ' + t);
});

test('URL su B, payload di A: conferma accettata -> importa A (dopo la conferma normale)', async () => {
  const e = makeImportEnv({ href: `https://app.qricambi.com/quote/${B}`, confirms: [true, true] });
  await e.click();
  assert.strictEqual(e.confirmTexts.length, 2, 'attese conferma mismatch + conferma import');
  assert.strictEqual(e.sent.length, 1);
  assert.strictEqual(e.sent[0].ID, A);
});

test('URL su A, payload di A: nessuna conferma extra', async () => {
  const e = makeImportEnv({ href: `https://app.qricambi.com/quote/${A}` });
  await e.click();
  assert.strictEqual(e.confirmTexts.length, 1, 'conferma di mismatch spuria su preventivo coincidente');
  assert.strictEqual(e.sent.length, 1);
});

test('URL senza ID: non si puo dire, nessuna conferma extra (resta quella dell import)', async () => {
  const e = makeImportEnv({ href: 'https://app.qricambi.com/?activetab=quote' });
  await e.click();
  assert.strictEqual(e.confirmTexts.length, 1);
  assert.strictEqual(e.sent.length, 1);
});

test('apertura di B vista da injected.js (find/B), payload di A: conferma mismatch', async () => {
  const e = makeImportEnv({ confirms: [false] });
  e.post({ source: 'AR_QUOTE_OPEN', id: B });
  await e.click();
  assert.strictEqual(e.sent.length, 0, 'POST partita col payload di A con B aperto');
  assert.ok(e.confirmTexts[0].includes(String(B)), e.confirmTexts[0]);
});

test('PATCH confermata di B dopo l apertura di A: B e il preventivo aperto, niente conferma extra', async () => {
  const e = makeImportEnv({ stored: null });
  e.post({ source: 'AR_QUOTE_OPEN', id: A });
  e.post({ source: 'AR_QUOTE_IMPORT', payload: quote(B), seq: 10 });
  await e.click();
  assert.strictEqual(e.confirmTexts.length, 1, 'conferma di mismatch spuria dopo salvataggio di B');
  assert.strictEqual(e.sent[0].ID, B);
});

// ── 2. risposte fuori ordine ────────────────────────────────────────────
test('content script: un payload piu vecchio (seq minore) arrivato dopo non sovrascrive', async () => {
  const e = makeImportEnv({ stored: null });
  e.post({ source: 'AR_QUOTE_IMPORT', payload: quote(A, { total: 222 }), seq: 2 });
  e.post({ source: 'AR_QUOTE_IMPORT', payload: quote(A, { total: 111 }), seq: 1 });
  assert.strictEqual(e.store.lastPatchPayload.total, 222,
    'vince l ultima risposta (seq1) invece dell ultimo invio (seq2)');
});

test('injected.js: due PATCH con risposte fuori ordine non pubblicano mai lo stato piu vecchio dopo il piu nuovo', async () => {
  const e = makeInjectedEnv();
  const p1 = e.win.fetch(PATCH_URL, patchInit(quote(A, { total: 111 })));
  const p2 = e.win.fetch(PATCH_URL, patchInit(quote(A, { total: 222 })));
  // il server risponde prima alla seconda PATCH (inviata dopo), poi alla prima
  e.pendingFetch[1].resolve({ ok: true, status: 200 });
  await p2;
  e.pendingFetch[0].resolve({ ok: true, status: 200 });
  await p1;
  const published = e.messages.filter((m) => m.source === 'AR_QUOTE_IMPORT');
  assert.ok(published.length >= 1, 'nessuna pubblicazione');
  assert.strictEqual(published[published.length - 1].payload.total, 222,
    'l ultima pubblicazione e quella della PATCH inviata PRIMA (111)');
});

test('injected.js: ogni pubblicazione porta un seq crescente in ordine di invio', async () => {
  const e = makeInjectedEnv();
  const p1 = e.win.fetch(PATCH_URL, patchInit(quote(A, { total: 1 })));
  const p2 = e.win.fetch(PATCH_URL, patchInit(quote(A, { total: 2 })));
  e.pendingFetch[0].resolve({ ok: true, status: 200 });
  e.pendingFetch[1].resolve({ ok: true, status: 200 });
  await Promise.all([p1, p2]);
  const published = e.messages.filter((m) => m.source === 'AR_QUOTE_IMPORT');
  assert.strictEqual(published.length, 2);
  assert.ok(published[0].seq < published[1].seq, 'seq non crescente: ' + JSON.stringify(published.map((m) => m.seq)));
});

test('injected.js: GET /api/Quote/find/<id> segnala il preventivo aperto', async () => {
  const e = makeInjectedEnv();
  const p = e.win.fetch('https://app.qricambi.com/api/Quote/find/' + B, { method: 'GET' });
  e.pendingFetch[0].resolve({ ok: true, status: 200 });
  await p;
  const open = e.messages.filter((m) => m.source === 'AR_QUOTE_OPEN');
  assert.strictEqual(open.length, 1, 'nessun messaggio AR_QUOTE_OPEN');
  assert.strictEqual(String(open[0].id), String(B));
});

// ── 3. azzeramento dopo import concluso ─────────────────────────────────
test('import 200: lastPatchPayload azzerato', async () => {
  const e = makeImportEnv({ responses: [{ status: 200, body: { sirj_numero: 7, sirj_anno: 2026 } }] });
  await e.click();
  assert.strictEqual(e.store.lastPatchPayload, undefined, 'payload ancora in storage dopo import 200');
});

test('import 409 (gia importato): lastPatchPayload azzerato', async () => {
  const e = makeImportEnv({ responses: [{ status: 409, body: { sirj_numero: 7, sirj_anno: 2026 } }] });
  await e.click();
  assert.strictEqual(e.store.lastPatchPayload, undefined, 'payload ancora in storage dopo 409');
});

test('import 422/500/rete o annullato: lastPatchPayload resta (si puo riprovare)', async () => {
  for (const responses of [
    [{ status: 500, body: { error: 'boom' } }],
    [{ status: 422, body: { error: 'x' } }],
    [{ throw: 'rete giu' }],
  ]) {
    const e = makeImportEnv({ responses });
    await e.click();
    assert.ok(e.store.lastPatchPayload, 'payload perso dopo un esito non concluso: ' + JSON.stringify(responses));
  }
  const e = makeImportEnv({ confirms: [false] });
  await e.click();
  assert.ok(e.store.lastPatchPayload, 'payload perso dopo conferma rifiutata');
});

test('import 200 mentre arriva una PATCH piu nuova: il payload nuovo NON viene cancellato', async () => {
  const e = makeImportEnv({ storedSeq: 1, responses: [{ status: 200, body: { sirj_numero: 7, sirj_anno: 2026 } }] });
  e.post({ source: 'AR_QUOTE_IMPORT', payload: quote(A, { total: 1 }), seq: 1 });
  const p = e.click();
  await Promise.resolve();
  e.post({ source: 'AR_QUOTE_IMPORT', payload: quote(A, { total: 555 }), seq: 5 });
  await p;
  assert.ok(e.store.lastPatchPayload && e.store.lastPatchPayload.total === 555,
    'cancellato un payload piu nuovo di quello importato');
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
