/* Test di annullaPricing (pricing.content.js) — quote-import-ext#34.
 *
 * ANNULLA conta come ripristinata solo una riga i cui campi in pagina sono
 * stati riscritti tutti (setVueInput === true). Una riga fallita resta nello
 * snapshot, cosi' ANNULLA si puo' ripetere.
 *
 * Estrae il blocco fra "async function annullaPricing" e "// onUndo: cablato"
 * e lo esegue in vm con setVueInput finto. Node puro, exit code 1 se fallisce.
 *   node tests/test_annulla_pricing.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const start = SRC.indexOf('async function annullaPricing');
const end = SRC.indexOf('// onUndo: cablato');
assert.ok(start > 0 && end > start, 'annullaPricing non trovata in pricing.content.js');

function makeEnv(esiti) {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    requestAnimationFrame: (cb) => setImmediate(cb),
    TAG: '[test]',
    __esiti: esiti,
  });
  vm.runInContext(
    'let undoInProgress = false; let lastSnapshot = { entries: [] };\n' +
    'async function setVueInput(input, value) { input.scritto = value; return __esiti(input); }\n' +
    SRC.slice(start, end) +
    '\nthis.annulla = annullaPricing;' +
    '\nthis.setSnap = (s) => { lastSnapshot = s; }; this.getSnap = () => lastSnapshot;', ctx);
  return ctx;
}

function riga(nome, nCampi = 2, connesso = true) {
  const fields = [];
  for (let i = 0; i < nCampi; i++) {
    fields.push({ input: { nome: `${nome}${i}`, isConnected: connesso }, orig: `v${i}` });
  }
  return { tr: null, fields };
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

(async () => {
  await test('tutte le scritture riuscite: righe ripristinate, snapshot vuoto', async () => {
    const e = makeEnv(() => true);
    e.setSnap({ entries: [riga('a'), riga('b')] });
    const r = await e.annulla();
    assert.deepStrictEqual({ ...r }, { restored: 2, skipped: 0, failed: 0 });
    assert.strictEqual(e.getSnap().entries.length, 0);
  });

  await test('#34 una scrittura fallita: la riga non e ripristinata e resta nello snapshot', async () => {
    const e = makeEnv((inp) => inp.nome !== 'b1');
    const a = riga('a'), b = riga('b');
    e.setSnap({ entries: [a, b] });
    const r = await e.annulla();
    assert.strictEqual(r.restored, 1, 'riga con scrittura fallita contata come ripristinata');
    assert.strictEqual(r.failed, 1);
    const resto = e.getSnap().entries;
    assert.ok(resto.length === 1 && resto[0] === b, 'la riga fallita va tenuta per riprovare');
  });

  await test('#34 tutte fallite: nessuna riga ripristinata', async () => {
    const e = makeEnv(() => false);
    e.setSnap({ entries: [riga('a'), riga('b')] });
    const r = await e.annulla();
    assert.strictEqual(r.restored, 0);
    assert.strictEqual(r.failed, 2);
    assert.strictEqual(e.getSnap().entries.length, 2);
  });

  await test('riga non piu in pagina: saltata, non fallita', async () => {
    const e = makeEnv(() => true);
    e.setSnap({ entries: [riga('a', 2, false)] });
    const r = await e.annulla();
    assert.deepStrictEqual({ ...r }, { restored: 0, skipped: 1, failed: 0 });
  });

  if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
  console.log('\ntutti i test ok');
})();
