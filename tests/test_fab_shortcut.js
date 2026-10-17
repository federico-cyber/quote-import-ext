/* Test degli shortcut tastiera di fab.js (Alt+Shift+P/I/B) — quote-import-ext#28.
 *
 * Invariante sotto test: gli shortcut passano per la STESSA guardia del menu
 * (una sola esecuzione alla volta, errori in console.error, nessuna promise
 * rifiutata non gestita). Due keydown ravvicinati non devono lanciare due volte
 * onPricing/onImport: il secondo Applica Pricing partirebbe sui valori gia
 * ritoccati e ANNULLA ripristinerebbe quelli, non gli originali.
 *
 * Stesso stile di tests/test_injected_confirm.js: node puro, zero dipendenze,
 * fab.js caricato con new Function e DOM/window finti, exit code 1 se fallisce.
 *   node tests/test_fab_shortcut.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'fab.js'), 'utf8');

// ── DOM finto: solo quello che fab.js tocca ──────────────────────────────
class FakeEl {
  constructor() {
    this.disabled = false;
    this.listeners = {};
    this.children = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  querySelector(sel) { return (this.children[sel] = this.children[sel] || new FakeEl()); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  appendChild() {}
  click() { return Promise.all((this.listeners.click || []).map((fn) => fn({ currentTarget: this }))); }
}

function makeSandbox() {
  const logs = { log: [], warn: [], error: [] };
  const cons = {
    log: (...a) => logs.log.push(a),
    warn: (...a) => logs.warn.push(a),
    error: (...a) => logs.error.push(a),
  };
  const docListeners = {};
  const created = [];   // [0] = <style>, [1] = il FAB (ordine di creazione in fab.js)
  const document = {
    readyState: 'complete',
    body: new FakeEl(),
    head: new FakeEl(),
    createElement: () => { const el = new FakeEl(); created.push(el); return el; },
    getElementById: () => ({}),   // FAB gia presente: niente injection/retry
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
  };
  const win = {};
  class FakeObserver { observe() {} }
  const DEFAULTS = { fabZIndex: 1, bothWaitMs: 0, injectionMaxAttempts: 1,
    injectionInitialDelayMs: 1, injectionMaxDelayMs: 1 };

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'console', 'DEFAULTS', 'MutationObserver',
    SCRIPT)(win, document, { href: 'https://app.qricambi.com/x' }, cons, DEFAULTS, FakeObserver);

  const menuItem = (sel) => created[1].querySelector(sel);
  let prevented = 0;
  function keydown(key) {
    const ev = {
      altKey: true, shiftKey: true, key, target: { tagName: 'BODY' },
      preventDefault: () => { prevented++; }, stopPropagation() {},
    };
    for (const fn of docListeners.keydown || []) fn(ev);
    return ev;
  }
  return { win, logs, keydown, menuItem, prevented: () => prevented };
}

// promise controllabile dal test
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('doppio keydown ravvicinato su P: onPricing parte una volta sola', async () => {
  const s = makeSandbox();
  const d = deferred();
  let calls = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { calls++; await d.promise; };
  s.keydown('p');
  s.keydown('p');
  await tick();
  assert.strictEqual(calls, 1, `onPricing lanciato ${calls} volte invece di 1`);
  d.resolve();
});

test('doppio keydown ravvicinato su I: onImport parte una volta sola', async () => {
  const s = makeSandbox();
  const d = deferred();
  let calls = 0;
  s.win.__AR_QRICAMBI.onImport = async () => { calls++; await d.promise; };
  s.keydown('i');
  s.keydown('i');
  await tick();
  assert.strictEqual(calls, 1, `onImport lanciato ${calls} volte invece di 1`);
  d.resolve();
});

test('shortcut diverso durante un handler in corso viene ignorato (guardia condivisa)', async () => {
  const s = makeSandbox();
  const d = deferred();
  let pricing = 0, both = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { pricing++; await d.promise; };
  s.win.__AR_QRICAMBI.onBoth = async () => { both++; };
  s.keydown('p');
  s.keydown('b');
  await tick();
  assert.strictEqual(pricing, 1);
  assert.strictEqual(both, 0, 'onBoth partito mentre onPricing era in corso');
  d.resolve();
});

test('handler che lancia: console.error con TAG e nessuna unhandledRejection', async () => {
  const s = makeSandbox();
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    s.win.__AR_QRICAMBI.onImport = async () => { throw new Error('boom'); };
    s.keydown('i');
    await tick(); await tick();
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  assert.strictEqual(unhandled.length, 0, 'promise rifiutata non gestita dallo shortcut');
  const withTag = s.logs.error.filter((a) => String(a[0]).includes('[AR-QR-FAB'));
  assert.ok(withTag.length >= 1, 'console.error(TAG, ...) non chiamato');
  assert.ok(withTag[0].some((x) => x instanceof Error && x.message === 'boom'),
    'errore originale non passato a console.error');
});

test('handler sincrono che lancia: catturato, nessuna eccezione dal listener', async () => {
  const s = makeSandbox();
  s.win.__AR_QRICAMBI.onPricing = () => { throw new Error('sync'); };
  assert.doesNotThrow(() => s.keydown('p'));
  await tick();
  assert.ok(s.logs.error.some((a) => String(a[0]).includes('[AR-QR-FAB')));
});

test('dopo il completamento un nuovo keydown riesegue (calls === 2)', async () => {
  const s = makeSandbox();
  let calls = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { calls++; };
  s.keydown('p');
  await tick();
  s.keydown('p');
  await tick();
  assert.strictEqual(calls, 2);
});

test('dopo un errore la guardia si rilascia: un nuovo keydown riesegue', async () => {
  const s = makeSandbox();
  let calls = 0;
  s.win.__AR_QRICAMBI.onImport = async () => { calls++; throw new Error('x'); };
  s.keydown('i');
  await tick(); await tick();
  s.keydown('i');
  await tick();
  assert.strictEqual(calls, 2, 'guardia rimasta bloccata dopo un errore');
});

test('click sul menu durante uno shortcut in corso non rilancia onPricing', async () => {
  const s = makeSandbox();
  const d = deferred();
  let calls = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { calls++; await d.promise; };
  s.keydown('p');
  const item = s.menuItem('#ar-qr-menu-pricing');
  await item.click();
  assert.strictEqual(calls, 1, 'il menu ha rilanciato onPricing durante lo shortcut');
  d.resolve();
});

test('shortcut durante un click di menu in corso non rilancia onPricing', async () => {
  const s = makeSandbox();
  const d = deferred();
  let calls = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { calls++; await d.promise; };
  const item = s.menuItem('#ar-qr-menu-pricing');
  const clicked = item.click();
  s.keydown('p');
  await tick();
  assert.strictEqual(calls, 1, 'lo shortcut ha rilanciato onPricing durante il menu');
  d.resolve();
  await clicked;
});

test('shortcut senza handler registrato: warn, nessun blocco', async () => {
  const s = makeSandbox();
  s.keydown('p');
  assert.ok(s.logs.warn.length >= 1);
  let calls = 0;
  s.win.__AR_QRICAMBI.onPricing = async () => { calls++; };
  s.keydown('p');
  await tick();
  assert.strictEqual(calls, 1, 'guardia rimasta bloccata dopo handler non registrato');
});

test('keydown preventDefault come prima', async () => {
  const s = makeSandbox();
  s.win.__AR_QRICAMBI.onPricing = async () => {};
  s.keydown('p');
  await tick();
  assert.strictEqual(s.prevented(), 1);
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log(`ok    ${name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${name}\n      ${e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
