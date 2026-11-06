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
 *  5. (#65) timeout ~60 s sul POST: la richiesta viene abortita (AbortController),
 *     lo storico registra 'esito-incerto', toast warn + modal arancione ESITO INCERTO,
 *     e la guardia di runAction (fab.js) si rilascia senza reload. Stesso esito per
 *     una risposta >=500 con corpo non JSON (502/504 di proxy). I rami 200/409/422/503
 *     restano quelli di prima.
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

// idsFromHref vive in defaults.js (caricato prima di import.content.js).
const { idsFromHref, backendUrlProblem } = (() => {
  const c = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'defaults.js'), 'utf8'), c);
  return { idsFromHref: vm.runInContext('idsFromHref', c), backendUrlProblem: vm.runInContext('backendUrlProblem', c) };
})();


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

// Timer finti: il test decide quando scatta il timeout del POST (nessuna attesa reale).
function makeTimers() {
  const list = [];
  let nextId = 1;
  return {
    list,
    setTimeout(fn, ms) { const id = nextId++; list.push({ id, fn, ms, done: false }); return id; },
    clearTimeout(id) { const t = list.find((x) => x.id === id); if (t) t.done = true; },
    // fa scattare i timer "lunghi" (il timeout del POST, ~60 s), non il toast da 6 s
    fireLong() {
      list.filter((t) => !t.done && t.ms >= 30000).forEach((t) => { t.done = true; t.fn(); });
    },
    longPending: () => list.filter((t) => !t.done && t.ms >= 30000).length,
  };
}

// fetch che non risponde mai: si ferma solo se il chiamante passa un signal e lo abortisce
function hangingFetch() {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      const sig = init && init.signal;
      if (!sig) return;   // senza signal resta appeso per sempre
      sig.addEventListener('abort', () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  fn.calls = calls;
  return fn;
}

function setupImport(fetchImpl, sharedWindow) {
  const store = {
    lastPatchPayload: PAYLOAD, importHistory: [], fallbackCliforNumero: 5,
    apiKey: 'k', backendUrl: 'http://localhost:5008/api/quote-import', overrideCliforNumero: 0,
  };
  const body = fakeEl();
  const timers = makeTimers();
  const ctx = {
    console: { log() {} },
    DEFAULTS: { apiKey: '', backendUrl: '', overrideCliforNumero: 0 },
    idsFromHref,
    AbortController,
    backendUrlProblem,
    URL,
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
        remove(keys, cb) { [].concat(keys).forEach((k) => { delete store[k]; }); if (cb) cb(); },
      } },
    },
    alert() {},
    confirm: () => true,
    fetch: fetchImpl,
    document: { createElement: fakeEl, body, addEventListener() {}, removeEventListener() {} },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  ctx.window = sharedWindow || ctx;
  ctx.window.addEventListener = () => {};
  vm.runInNewContext(SRC, ctx);
  const collect = () => {
    const els = body.children.flatMap((c) => walk(c));
    return {
      history: store.importHistory,
      texts: els.map((e) => e.textContent).filter(Boolean),
      css: els.map((e) => e.style.cssText || '').join('\n'),
      // il toast e' l'unico elemento posizionato in alto a destra
      toasts: els.filter((e) => (e.style.cssText || '').includes('top:20px')),
    };
  };
  return { ctx, store, timers, collect };
}

async function runImport(response, fetchImpl) {
  const { ctx, collect } = setupImport(fetchImpl || (async () => ({
    status: response.status, statusText: 'x',
    json: response.json || (async () => response.body),
  })));
  await ctx.window.__AR_QRICAMBI.onImport();
  return collect();
}

// Termina entro `ms` reali o fallisce: un import appeso non deve bloccare il test runner.
function withDeadline(promise, ms, what) {
  let t;
  const dead = new Promise((_r, rej) => { t = setTimeout(() => rej(new Error(what)), ms); });
  return Promise.race([promise, dead]).finally(() => clearTimeout(t));
}
const tick = () => new Promise((r) => setImmediate(r));

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

  await test('409 + status collision -> storico "collision", toast warn di collisione, non "Già importato"', async () => {
    const r = await runImport({ status: 409, body: { status: 'collision', sirj_numero: 777, sirj_anno: 2026 } });
    assert.strictEqual(r.history.length, 1);
    assert.strictEqual(r.history[0].status, 'collision');
    assert.strictEqual(r.history[0].sirjNumero, 777);
    assert.strictEqual(r.history[0].sirjAnno, 2026);
    assert.ok(r.toasts.length >= 1, 'nessun toast');
    assert.ok(r.toasts.every((t) => t.style.cssText.includes(ORANGE)), 'toast non warn');
    const all = r.texts.join(' | ');
    assert.ok(!all.includes('Già importato'), 'collisione presentata come duplicato: ' + all);
    assert.ok(/collisione/i.test(all) && all.includes('777/2026'), 'manca avviso di collisione: ' + all);
    assert.ok(!r.css.includes(GREEN), 'avviso verde su collisione');
  });

  await test('409 + status ok/converted/expired (o senza status) -> invariato: storico "dup", toast "Già importato"', async () => {
    for (const body of [{ status: 'ok', sirj_numero: 5, sirj_anno: 2026 }, { sirj_numero: 5, sirj_anno: 2026 },
                        { status: 'converted', sirj_numero: 5, sirj_anno: 2026 },
                        { status: 'expired', sirj_numero: 5, sirj_anno: 2026 }]) {
      const r = await runImport({ status: 409, body });
      assert.strictEqual(r.history[0].status, 'dup', JSON.stringify(body));
      assert.ok(r.texts.some((t) => t.includes('Già importato: PR3 5/2026')), JSON.stringify(r.texts));
    }
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

  // ── #65: timeout del POST ed esito incerto ─────────────────────────────
  const assertEsitoIncerto = (r) => {
    assert.strictEqual(r.history.length, 1);
    assert.strictEqual(r.history[0].status, 'esito-incerto');
    assert.strictEqual(r.history[0].sirjNumero, null);
    assert.ok(r.toasts.length >= 1, 'nessun toast');
    assert.ok(r.toasts.every((t) => t.style.cssText.includes(ORANGE)), 'toast non warn');
    const all = r.texts.join(' | ');
    assert.ok(all.includes('ESITO INCERTO'), 'manca il modal ESITO INCERTO: ' + all);
    assert.ok(/Verifica in SIRJ/.test(all), 'manca l invito a verificare in SIRJ: ' + all);
    assert.ok(/secondo PR3/.test(all), 'manca l avviso sul secondo PR3: ' + all);
    assert.ok(!/Errore rete/.test(all), '"Errore rete" su un esito incerto: ' + all);
    assert.ok(r.css.includes(ORANGE) && !r.css.includes(GREEN), 'il modal deve essere arancione, mai verde');
  };

  await test('timeout: fetch mai risolto -> abort dopo ~60 s e stato "esito-incerto"', async () => {
    const f = hangingFetch();
    const { ctx, timers, collect } = setupImport(f);
    const done = ctx.window.__AR_QRICAMBI.onImport();
    await tick();
    assert.strictEqual(f.calls.length, 1, 'il POST non e partito');
    assert.ok(f.calls[0].init.signal, 'il POST non ha un AbortSignal');
    const t = timers.list.find((x) => x.ms >= 30000);
    assert.ok(t, 'nessun timer di timeout: ' + JSON.stringify(timers.list.map((x) => x.ms)));
    assert.ok(t.ms >= 55000 && t.ms <= 65000, 'timeout atteso ~60 s, trovato ' + t.ms + ' ms');
    timers.fireLong();
    await withDeadline(done, 500, 'onImport non termina dopo il timeout (lock fab mai rilasciato)');
    assertEsitoIncerto(collect());
  });

  await test('timeout: il timer si cancella a risposta arrivata (nessun abort tardivo)', async () => {
    const { ctx, timers } = setupImport(async () => ({
      status: 200, statusText: 'x', json: async () => R200_OK.body }));
    await ctx.window.__AR_QRICAMBI.onImport();
    assert.strictEqual(timers.longPending(), 0, 'timer di timeout ancora armato dopo la risposta');
  });

  await test('504 con corpo HTML -> "esito-incerto", modal ESITO INCERTO, niente "Errore rete"', async () => {
    const r = await runImport({ status: 504, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    assertEsitoIncerto(r);
  });

  await test('502 con corpo vuoto -> "esito-incerto"', async () => {
    const r = await runImport({ status: 502, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
    assertEsitoIncerto(r);
  });

  await test('non JSON con status < 500 -> invariato (errore rete generico, non esito incerto)', async () => {
    const r = await runImport({ status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    assert.strictEqual(r.history[0].status, 'err');
    assert.ok(r.texts.some((t) => t.includes('Errore rete')));
  });

  await test('409 e 422 restano quelli di prima', async () => {
    const r409 = await runImport({ status: 409, body: { sirj_numero: 5, sirj_anno: 2026 } });
    assert.strictEqual(r409.history[0].status, 'dup');
    assert.ok(r409.texts.some((t) => t.includes('Già importato: PR3 5/2026')));
    const r422 = await runImport({ status: 422, body: { error: 'cliente non valido' } });
    assert.strictEqual(r422.history[0].status, 'err');
    assert.strictEqual(r422.history[0].error, 'cliente non valido');
    assert.ok(r422.texts.some((t) => t.includes('Errore: cliente non valido')));
  });

  await test('500 con corpo JSON -> errore generico (non scambiato per esito incerto)', async () => {
    const r = await runImport({ status: 500, body: { error: 'boom' } });
    assert.strictEqual(r.history[0].status, 'err');
    assert.ok(r.texts.some((t) => t.includes('Errore 500: boom')));
  });

  await test('fab: dopo il timeout actionRunning si rilascia e le voci di menu si riabilitano', async () => {
    const FAB = fs.readFileSync(path.join(__dirname, '..', 'fab.js'), 'utf8');
    class FakeFabEl {
      constructor() {
        this.disabled = false; this.listeners = {}; this.children = {};
        this.classList = { add() {}, remove() {}, toggle() {} };
      }
      querySelector(sel) { return (this.children[sel] = this.children[sel] || new FakeFabEl()); }
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
      appendChild() {}
      click() { return Promise.all((this.listeners.click || []).map((fn) => fn({ currentTarget: this }))); }
    }
    const created = [];
    const fabDoc = {
      readyState: 'complete', body: new FakeFabEl(), head: new FakeFabEl(),
      createElement: () => { const el = new FakeFabEl(); created.push(el); return el; },
      getElementById: () => ({}), addEventListener() {},
    };
    const win = {};
    class FakeObserver { observe() {} }
    const cons = { log() {}, warn() {}, error() {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'console', 'DEFAULTS', 'MutationObserver', FAB)(
      win, fabDoc, { href: 'https://app.qricambi.com/x' }, cons,
      { fabZIndex: 1, bothWaitMs: 0, injectionMaxAttempts: 1, injectionInitialDelayMs: 1, injectionMaxDelayMs: 1 },
      FakeObserver);
    const f = hangingFetch();
    const { timers, collect } = setupImport(f, win);
    const item = created[1].querySelector('#ar-qr-menu-import');
    const pricing = created[1].querySelector('#ar-qr-menu-pricing');
    const click = item.click();
    await tick();
    assert.strictEqual(item.disabled, true, 'voce non disabilitata durante l import');
    assert.strictEqual(pricing.disabled, true);
    timers.fireLong();
    await withDeadline(click, 500, 'runAction non termina dopo il timeout');
    assert.strictEqual(item.disabled, false, 'voce Importa ancora disabilitata dopo il timeout');
    assert.strictEqual(pricing.disabled, false, 'voce Pricing ancora disabilitata dopo il timeout');
    assert.strictEqual(collect().history[0].status, 'esito-incerto');
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
