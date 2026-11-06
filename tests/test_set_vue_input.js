/* Test di setVueInput / valuesEqual (pricing.content.js) — quote-import-ext#66.
 *
 * Invariante sotto test: la verifica post-scrittura di setVueInput confronta i
 * prezzi in centesimi esatti. Se Vue riscrive "0.03" al posto di "0.02" la
 * scrittura NON e' verificata (ritorna false e viene ritentata/segnalata); prima
 * la tolleranza < 0.01 considerava uguali valori distanti un centesimo e il
 * prezzo sbagliato finiva in PR3 SIRJ. Le grafie dello stesso valore
 * (4,81 / 4.81, 4.8 / 4.80, 55 / 55.00) restano uguali. Decisione di Fede su #66
 * (opzione a, centesimi esatti).
 *
 * Si esegue la setVueInput vera, estratta da pricing.content.js, in vm con un
 * input finto "bloccato": una scrittura (execCommand/nativeSetter) non cambia il
 * valore, come quando Vue lo rimette com'era. Node puro.
 *   node tests/test_set_vue_input.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const start = SRC.indexOf('async function setVueInput(');
assert.ok(start >= 0, 'setVueInput non trovata in pricing.content.js');
const end = SRC.indexOf('\n  }\n', start);
assert.ok(end > start, 'fine di setVueInput non trovata');
const FN = SRC.slice(start, end + 4);

class FakeHTMLInputElement {}
Object.defineProperty(FakeHTMLInputElement.prototype, 'value', {
  get() { return this._v; },
  set(x) { if (!this.bloccato) this._v = String(x); },
});

function mkInput(valore, bloccato) {
  const inp = Object.create(FakeHTMLInputElement.prototype);
  inp._v = String(valore);
  inp.bloccato = bloccato;
  inp.focus = () => {};
  inp.select = () => {};
  inp.dispatchEvent = () => true;
  inp.closest = () => null;
  inp.parentElement = null;
  return inp;
}

const ctx = {
  TAG: '[t]',
  console: { log() {} },
  document: { execCommand: () => true },
  HTMLInputElement: FakeHTMLInputElement,
  InputEvent: function InputEvent() {},
  Event: function Event() {},
  requestAnimationFrame: (cb) => setImmediate(cb),
  Promise, Object, String, parseFloat, isNaN, Math,
};
vm.runInNewContext(FN + '\nthis.setVueInput = setVueInput;', ctx);
const { setVueInput } = ctx;

// Vue "tiene" il valore attuale: scrivere `scritto` ritorna true solo se lo
// considera uguale a `attuale`.
const verificata = (attuale, scritto) => setVueInput(mkInput(attuale, true), scritto);

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

(async () => {
  await test('0.02 vs 0.03: non uguali', async () => {
    assert.strictEqual(await verificata('0.03', '0.02'), false);
  });
  await test('8.74 vs 8.75: non uguali', async () => {
    assert.strictEqual(await verificata('8.75', '8.74'), false);
  });
  await test('0.10 vs 0.11: non uguali', async () => {
    assert.strictEqual(await verificata('0.11', '0.10'), false);
  });
  await test('0,02 (virgola) vs 0,03: non uguali', async () => {
    assert.strictEqual(await verificata('0,03', '0,02'), false);
  });
  await test('4,81 vs 4.81: uguali', async () => {
    assert.strictEqual(await verificata('4.81', '4,81'), true);
  });
  await test('4.8 vs 4.80: uguali', async () => {
    assert.strictEqual(await verificata('4.80', '4.8'), true);
  });
  await test('55 vs 55.00: uguali', async () => {
    assert.strictEqual(await verificata('55.00', '55'), true);
  });
  await test('valore non numerico: confronto testuale invariato', async () => {
    assert.strictEqual(await verificata(' abc ', 'abc'), true);
    assert.strictEqual(await verificata('abd', 'abc'), false);
  });
  await test('input libero: la scrittura viene verificata', async () => {
    const inp = mkInput('1.00', false);
    assert.strictEqual(await setVueInput(inp, '4,81'), true);
    assert.strictEqual(inp.value, '4,81');
  });
  if (failed) { console.log(`\n${failed} test FALLITI`); process.exit(1); }
  console.log('\ntutti i test verdi');
})();
