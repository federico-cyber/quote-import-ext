/* Test dei rami di risposta del POST import in handleClick (import.content.js) — quote-import-ext#29.
 *
 * Invarianti sotto test (contratto del bridge qricambi-bridge/quote_import_routes.py):
 *  1. 200 con body.collision === true: il PR3 e' stato scritto ma il numero e' poi
 *     stato occupato da un altro documento. Il modal NON e' quello verde di successo,
 *     lo storico registra status 'collision', il toast e' 'warn' (arancione).
 *  2. 200 con body.unmatched_articles non vuoto: il modal di successo segnala gli
 *     articoli non agganciati (lo storico resta 'ok': il PR3 esiste).
 *  3. 503 con body.esito_incerto === true: il commit potrebbe essere andato a buon
 *     fine. Avviso giallo col numero PR3 (sirj_numero/sirj_anno) da verificare in SIRJ,
 *     storico 'esito-incerto', mai il messaggio generico 'Errore 503'.
 *  4. popup.js mostra i due stati nuovi nello storico (testo + classe CSS).
 *
 * import.content.js e popup.js sono legati a chrome/DOM: li eseguiamo interi in vm con
 * chrome.storage, fetch, confirm e document stubbati (nessuna rete reale), come
 * test_import_fallback.js. Node puro, exit code 1 se qualcosa fallisce.
 *   node tests/test_import_response_branches.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'import.content.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

const GREEN = '#2e7d32';
const ORANGE = '#ef6c00';

const PAYLOAD = {
  ID: 4242,
  customerdata: { CustomerName: 'Mario Rossi', CustomerCode: 'X9' },
  car: 'Fiat Panda', lplatevin: ['AB123CD'], total: 100,
  items: [{ code: 'C1', manufacturer: 'M', description: 'd', num: 1, price: 100 }],
};

function fakeEl() {
  return {
    children: [], style: {}, textContent: '', className: '',
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, focus() {}, remove() {},
  };
}
function walk(el, out = []) {
  out.push(el);
  el.children.forEach((c) => walk(c, out));
  return out;
}

async function runImport(response) {
  const store = {
    lastPatchPayload: PAYLOAD, importHistory: [], fallbackCliforNumero: 5,
    apiKey: 'k', backendUrl: 'http://bridge.invalid/import', overrideCliforNumero: 0,
  };
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
          list.forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
      } },
    },
    alert() {},
    confirm: () => true,
    fetch: async () => ({ status: response.status, statusText: 'x', json: async () => response.body }),
    document: { createElement: fakeEl, body, addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0,
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  vm.runInNewContext(SRC, ctx);
  await ctx.window.__AR_QRICAMBI.onImport();
  const els = body.children.flatMap((c) => walk(c));
  return {
    history: store.importHistory,
    texts: els.map((e) => e.textContent).filter(Boolean),
    css: els.map((e) => e.style.cssText || '').join('\n'),
    // il toast e' l'unico elemento posizionato in alto a destra
    toasts: els.filter((e) => (e.style.cssText || '').includes('top:20px')),
  };
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

const R200_OK = { status: 200, body: { status: 'ok', sirj_numero: 777, sirj_anno: 2026 } };

(async () => {
  await test('200 + collision -> storico "collision", toast warn, modal non verde', async () => {
    const r = await runImport({ status: 200, body: { ...R200_OK.body, collision: true } });
    assert.strictEqual(r.history.length, 1);
    assert.strictEqual(r.history[0].status, 'collision');
    assert.strictEqual(r.history[0].sirjNumero, 777);
    assert.strictEqual(r.history[0].sirjAnno, 2026);
    assert.ok(r.toasts.length >= 1, 'nessun toast');
    assert.ok(r.toasts.every((t) => t.style.cssText.includes(ORANGE)), 'toast non warn');
    assert.ok(!r.css.includes(GREEN), 'il modal di collisione non deve essere verde');
    assert.ok(!r.texts.includes('IMPORTATO IN SIRJ'), 'titolo di successo su una collisione');
    assert.ok(r.texts.some((t) => t.includes('777/2026')), 'manca il numero PR3: ' + JSON.stringify(r.texts));
  });

  await test('200 + unmatched_articles -> il modal segnala gli articoli non agganciati', async () => {
    const r = await runImport({ status: 200, body: { ...R200_OK.body,
      unmatched_articles: [{ code: 'ZZ-1', manufacturer: 'ACME', description: 'filtro' },
                           { code: 'ZZ-2', manufacturer: 'ACME', description: 'olio' }] } });
    assert.strictEqual(r.history[0].status, 'ok', 'il PR3 esiste: lo stato resta ok');
    const all = r.texts.join(' | ');
    assert.ok(all.includes('IMPORTATO IN SIRJ'), 'il successo resta segnalato');
    assert.ok(all.includes('ZZ-1') && all.includes('ZZ-2'), 'codici non agganciati assenti: ' + all);
    assert.ok(/non agganciat/i.test(all), 'manca la dicitura: ' + all);
  });

  await test('200 senza collision/unmatched -> invariato (ok, modal verde, nessun avviso)', async () => {
    const r = await runImport(R200_OK);
    assert.strictEqual(r.history[0].status, 'ok');
    assert.ok(r.css.includes(GREEN));
    assert.ok(!/non agganciat/i.test(r.texts.join(' ')));
  });

  await test('503 + esito_incerto -> storico "esito-incerto" e avviso col numero PR3', async () => {
    const r = await runImport({ status: 503, body: {
      error: 'esito incerto: verifica in SIRJ il PR3 n. 888/2026 prima di riprovare',
      esito_incerto: true, sirj_numero: 888, sirj_anno: 2026, trace_id: 't' } });
    assert.strictEqual(r.history.length, 1);
    assert.strictEqual(r.history[0].status, 'esito-incerto');
    assert.strictEqual(r.history[0].sirjNumero, 888);
    assert.strictEqual(r.history[0].sirjAnno, 2026);
    const all = r.texts.join(' | ');
    assert.ok(all.includes('888/2026'), 'manca il numero PR3: ' + all);
    assert.ok(/SIRJ/.test(all), 'manca l invito a verificare in SIRJ');
    assert.ok(!/Errore 503/.test(all), 'messaggio generico "Errore 503" ancora presente');
    assert.ok(r.toasts.every((t) => t.style.cssText.includes(ORANGE)), 'toast non warn');
    assert.ok(!r.css.includes(GREEN), 'avviso verde su esito incerto');
  });

  await test('503 senza esito_incerto -> errore generico come prima', async () => {
    const r = await runImport({ status: 503, body: { error: 'down' } });
    assert.strictEqual(r.history[0].status, 'err');
    assert.ok(r.texts.some((t) => t.includes('Errore 503')));
  });

  await test('popup: collision ed esito-incerto hanno testo e classe dedicati', async () => {
    const container = fakeEl();
    const ctx = {
      Date,
      document: {
        getElementById: (id) => (id === 'history' ? container : fakeEl()),
        createElement: fakeEl,
      },
      chrome: { storage: { local: { get(_k, cb) { cb({ importHistory: [
        { ts: 1, customer: 'A', itemsCount: 1, total: 1, status: 'collision', sirjNumero: 777, sirjAnno: 2026, error: 'x' },
        { ts: 2, customer: 'B', itemsCount: 1, total: 1, status: 'esito-incerto', sirjNumero: 888, sirjAnno: 2026, error: 'y' },
      ] }); } } }, runtime: {} },
      window: {},
    };
    vm.runInNewContext(POPUP_SRC, ctx);
    const rows = container.children;
    const outcome = (row) => row.children[2];
    assert.strictEqual(rows.length, 2);
    assert.ok(outcome(rows[0]).textContent.includes('777/2026') && /collision|collisione/i.test(outcome(rows[0]).textContent),
      outcome(rows[0]).textContent);
    assert.ok(outcome(rows[1]).textContent.includes('888/2026') && /verifica/i.test(outcome(rows[1]).textContent),
      outcome(rows[1]).textContent);
    assert.ok(!outcome(rows[1]).textContent.startsWith('✗'));
    assert.strictEqual(rows[0].className, 'hist-row collision');
    assert.strictEqual(rows[1].className, 'hist-row esito-incerto');
  });

  if (failed) { console.log(`\n${failed} test FALLITI`); process.exit(1); }
  console.log('\ntutti i test ok');
})();
