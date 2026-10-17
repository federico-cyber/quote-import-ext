/* Test del fallback cliente generico in handleClick (import.content.js) — quote-import-ext#27.
 *
 * Invariante sotto test: dopo un retry accettato sul cliente generico SIRJ #5
 * (1a risposta 422 con customer_hint, 2a risposta 200) lo storico registra
 * 'ok-fallback' con sirjNumero/sirjAnno e il successModal mostra la riga
 * 'Override cliente SIRJ #5'. Il bridge NON restituisce override_clifor_numero
 * nel body 200: l'esito non può dipendere da quel campo.
 *
 * import.content.js è un IIFE legato a chrome/DOM: lo eseguiamo intero in vm
 * con chrome.storage, fetch, confirm e document stubbati (nessuna rete reale),
 * poi invochiamo window.__AR_QRICAMBI.onImport() come farebbe il FAB.
 * Node puro, zero dipendenze, exit code 1 se qualcosa fallisce.
 *   node tests/test_import_fallback.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'import.content.js'), 'utf8');

const PAYLOAD = {
  ID: 4242,
  customerdata: { CustomerName: 'Mario Rossi', CustomerCode: 'X9' },
  car: 'Fiat Panda', lplatevin: ['AB123CD'], total: 100,
  items: [{ code: 'C1', manufacturer: 'M', description: 'd', num: 1, price: 100 }],
};

function fakeEl() {
  const el = {
    children: [], style: {}, textContent: '',
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, focus() {}, remove() {},
  };
  return el;
}
function allText(el, out = []) {
  if (el.textContent) out.push(el.textContent);
  el.children.forEach((c) => allText(c, out));
  return out;
}

// Esegue handleClick con la sequenza di risposte fetch data; ritorna storico + modal.
async function runImport({ responses, overrideCliforNumero = 0, confirms = [true, true] }) {
  const store = {
    lastPatchPayload: PAYLOAD,
    importHistory: [],
    fallbackCliforNumero: 5,
    apiKey: 'k', backendUrl: 'http://bridge.invalid/import',
    overrideCliforNumero,
  };
  const sent = [];
  const body = fakeEl();
  const ctx = {
    console: { log() {} },
    DEFAULTS: { apiKey: '', backendUrl: '', overrideCliforNumero: 0 },
    chrome: {
      runtime: { openOptionsPage() {} },
      storage: { local: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : Object.keys(keys);
          list.forEach((k) => { out[k] = k in store ? store[k] : (keys[k]); });
          if (typeof keys === 'object' && !Array.isArray(keys)) {
            Object.keys(keys).forEach((k) => { if (k in store) out[k] = store[k]; });
          }
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) { [].concat(keys).forEach((k) => delete store[k]); if (cb) cb(); },
      } },
    },
    alert() {},
    confirm: () => confirms.shift(),
    fetch: async (url, opts) => {
      sent.push(JSON.parse(opts.body));
      const r = responses.shift();
      return { status: r.status, statusText: 'x', json: async () => r.body };
    },
    document: {
      createElement: fakeEl, body,
      addEventListener() {}, removeEventListener() {},
    },
    setTimeout: () => 0,
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  vm.runInNewContext(SRC, ctx);
  await ctx.window.__AR_QRICAMBI.onImport();
  return { history: store.importHistory, modalText: body.children.flatMap((c) => allText(c)), sent };
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

const R422 = { status: 422, body: { error: 'cliente', customer_hint: { CustomerCode: 'X9' } } };
const R200 = { status: 200, body: { status: 'ok', sirj_numero: 777, sirj_anno: 2026 } };

(async () => {
  await test('retry accettato su cliente generico -> ok-fallback + riga override nel modal', async () => {
    const r = await runImport({ responses: [{ ...R422 }, { ...R200 }] });
    assert.strictEqual(r.sent.length, 2, 'attesi 2 POST (422 poi retry)');
    assert.strictEqual(r.sent[1].override_clifor_numero, 5, 'il retry deve inviare override 5');
    assert.strictEqual(r.history.length, 1);
    assert.strictEqual(r.history[0].status, 'ok-fallback');
    assert.strictEqual(r.history[0].sirjNumero, 777);
    assert.strictEqual(r.history[0].sirjAnno, 2026);
    assert.ok(r.modalText.includes('Override cliente SIRJ #5'),
      'modal senza riga override: ' + JSON.stringify(r.modalText));
  });

  await test('import normale senza 422 resta ok, senza riga override', async () => {
    const r = await runImport({ responses: [{ ...R200 }] });
    assert.strictEqual(r.sent.length, 1);
    assert.strictEqual(r.history[0].status, 'ok');
    assert.ok(!r.modalText.some((t) => t.includes('Override cliente')));
  });

  await test('override manuale da Opzioni -> ok-fallback con il suo numero', async () => {
    const r = await runImport({ responses: [{ ...R200 }], overrideCliforNumero: 12 });
    assert.strictEqual(r.history[0].status, 'ok-fallback');
    assert.ok(r.modalText.includes('Override cliente SIRJ #12'));
  });

  await test('retry rifiutato -> err, nessun secondo POST', async () => {
    const r = await runImport({ responses: [{ ...R422 }], confirms: [true, false] });
    assert.strictEqual(r.sent.length, 1);
    assert.strictEqual(r.history[0].status, 'err');
  });

  if (failed) { console.log(`\n${failed} test FALLITI`); process.exit(1); }
  console.log('\ntutti i test ok');
})();
