/* Test di eseguiConIndici (pricing.content.js) — quote-import-ext#56.
 *
 * Una riga con la colonna Vendita mappata ma senza casella (input) nella cella
 * non va scritta ne' contata "ok": e' saltata con motivo proprio (noVenditaInp),
 * prima di qualsiasi setVueInput su listino/sconto. Decisione di Fede 24/10/2026
 * (projects#75, opzione a). Le righe normali restano invariate.
 *
 * Estrae da pricing.content.js le funzioni pure/di ciclo e le esegue in vm con un
 * mini-DOM e un setVueInput finto che registra le scritture. Node puro.
 *   node tests/test_vendita_senza_input.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');

function estrai(nome) {
  const start = SRC.indexOf(`function ${nome}(`);
  assert.ok(start >= 0, `${nome} non trovata in pricing.content.js`);
  const end = SRC.indexOf('\n  }\n', start);
  assert.ok(end > start, `fine di ${nome} non trovata`);
  return SRC.slice(start, end + 4);
}

const calcStart = SRC.indexOf('function scontoIntero');
const calcEnd = SRC.indexOf('// ── fine calcolaRiga');
assert.ok(calcStart > 0 && calcEnd > calcStart, 'blocco calcolaRiga non trovato');
const cicloStart = SRC.indexOf('async function eseguiConIndici');
const cicloEnd = SRC.indexOf('// ── ANNULLA');
assert.ok(cicloStart > 0 && cicloEnd > cicloStart, 'eseguiConIndici non trovata');

const DEF = {
  regADelta: 20, regACapThreshold: 80, regACapValue: 70,
  regCThreshold: 78, regCMarkup: 77,
  regBMultiplier: 2.0, regBDiscount: 30, uiRoundStep: 5,
  uiThresholdLow: 10, uiThresholdHigh: 35, regBSottoCosto: true,
};

// ── mini-DOM ──
function mkInput(value) { return { value: String(value), isConnected: true }; }
function mkTd(valore, conInput) {
  const inp = conInput ? mkInput(valore) : null;
  return { textContent: String(valore), querySelector: (s) => (s === 'input' ? inp : null), inp };
}
function mkTr(td) {
  const utile = { textContent: '-', style: {} };
  const classi = new Set();
  return {
    td, utile, classi,
    querySelectorAll: (s) => (s === 'td' ? td : []),
    querySelector: (s) => (s === '.ar-utile-cell' ? utile : null),
    classList: { add: (...c) => c.forEach(x => classi.add(x)), remove: (...c) => c.forEach(x => classi.delete(x)) },
  };
}
// colonne: 0 acquisto, 1 listino, 2 sconto, 3 vendita, 4 pezzi
const COL = { acquisto: 0, listino: 1, sconto: 2, vendita: 3, pezzi: 4 };
function riga({ vendita = 'input' } = {}) {
  const td = [mkTd('10.00', false), mkTd('30.00', true), mkTd('20', true),
    vendita === 'input' ? mkTd('24.00', true) : mkTd('24.00', false), mkTd('1', false)];
  return mkTr(td);
}

function esegui(righe, col = COL) {
  const scritture = [];
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    TAG: '[test]', S: DEF, __scritture: scritture, __righe: righe,
  });
  vm.runInContext(
    'let lastSnapshot = { entries: [] };\n' +
    'async function setVueInput(input, value) { __scritture.push(input); input.value = String(value); return true; }\n' +
    estrai('parseNum') + '\n' + estrai('leggiCella') + '\n' + estrai('inputDiCella') + '\n' +
    SRC.slice(calcStart, calcEnd) + '\n' + SRC.slice(cicloStart, cicloEnd) +
    '\nthis.run = (c) => eseguiConIndici({ querySelectorAll: () => __righe }, c, null, null);' +
    '\nthis.getSnap = () => lastSnapshot;', ctx);
  return ctx.run(col).then((res) => ({ res, scritture, ctx }));
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

(async () => {
  await test('#56 Vendita mappata senza casella: saltata con motivo noVenditaInp, mai scritta', async () => {
    const r = riga({ vendita: 'senza-input' });
    const { res, scritture, ctx } = await esegui([r]);
    assert.strictEqual(res.ok, 0, 'riga senza casella Vendita contata ok');
    assert.strictEqual(res.skip, 1);
    assert.strictEqual(res.skipReasons.noVenditaInp, 1);
    assert.strictEqual(scritture.length, 0, 'nessun setVueInput su listino/sconto');
    assert.strictEqual(r.td[1].inp.value, '30.00', 'listino toccato');
    assert.strictEqual(r.td[2].inp.value, '20', 'sconto toccato');
    assert.strictEqual(r.utile.textContent, '-', 'utile calcolato su una vendita mai scritta');
    assert.strictEqual(ctx.getSnap().entries.length, 0, 'riga senza scritture finita nello snapshot di ANNULLA');
  });

  await test('riga normale con casella Vendita: ok, scrive sconto/listino/vendita, motivo a 0', async () => {
    const r = riga();
    const { res, scritture } = await esegui([r]);
    assert.strictEqual(res.ok, 1);
    assert.strictEqual(res.skip, 0);
    assert.strictEqual(res.skipReasons.noVenditaInp || 0, 0);
    assert.ok(scritture.includes(r.td[2].inp), 'sconto non scritto');
    assert.ok(scritture.includes(r.td[3].inp), 'vendita non scritta');
    assert.notStrictEqual(r.utile.textContent, '-');
  });

  await test('colonna Vendita non mappata: comportamento invariato (riga ok)', async () => {
    const r = riga();
    const { res } = await esegui([r], { acquisto: 0, listino: 1, sconto: 2, vendita: null, pezzi: 4 });
    assert.strictEqual(res.ok, 1);
    assert.strictEqual(res.skip, 0);
    assert.strictEqual(res.skipReasons.noVenditaInp || 0, 0);
  });

  await test('mix: una riga normale e una senza casella Vendita', async () => {
    const { res } = await esegui([riga(), riga({ vendita: 'senza-input' })]);
    assert.strictEqual(res.tot, 2);
    assert.strictEqual(res.ok, 1);
    assert.strictEqual(res.skip, 1);
    assert.strictEqual(res.skipReasons.noVenditaInp, 1);
  });

  await test('motivo visibile nel riepilogo: toast con e senza righe ok, e default del ritorno a vuoto', async () => {
    const n = SRC.split('res.skipReasons.noVenditaInp ? toastLine(').length - 1;
    assert.strictEqual(n, 2, `toast con noVenditaInp: ${n} su 2`);
    assert.ok(/skipReasons: \{[^}]*noVenditaInp: 0/.test(SRC.slice(SRC.indexOf('async function esegui('), cicloStart)),
      'noVenditaInp assente dal ritorno a vuoto di esegui');
  });

  if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
  console.log('\ntutti i test ok');
})();
