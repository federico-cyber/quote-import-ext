/* Test di calcolaRiga (pricing.content.js) — quote-import-ext#21.
 *
 * Invariante sotto test: lo sconto cliente scritto da Alt+Shift+P è sempre
 * un intero di 1-2 cifre (0-99), qualunque siano acquisto/listino e anche con
 * parametri di configurazione non interi.
 *
 * pricing.content.js è un IIFE legato al DOM: estraiamo solo il blocco puro
 * fra "function scontoIntero" e "// ── fine calcolaRiga" e lo eseguiamo in vm.
 * Node puro, zero dipendenze, exit code 1 se qualcosa fallisce.
 *   node tests/test_calcola_riga.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const start = SRC.indexOf('function scontoIntero');
const end = SRC.indexOf('// ── fine calcolaRiga');
assert.ok(start > 0 && end > start, 'blocco calcolaRiga non trovato in pricing.content.js');

const ctx = {};
vm.runInNewContext(SRC.slice(start, end) + '\nthis.calcolaRiga = calcolaRiga;', ctx);
const { calcolaRiga } = ctx;

// Stessi valori di defaults.js
const DEF = {
  regADelta: 20, regACapThreshold: 80, regACapValue: 70,
  regCThreshold: 78, regCMarkup: 77,
  regBMultiplier: 2.0, regBDiscount: 30, uiRoundStep: 5,
};

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

function assertScontoIntero(r, ctxMsg) {
  assert.ok(Number.isInteger(r.scontoCliente),
    `sconto non intero: ${r.scontoCliente} (${ctxMsg})`);
  assert.ok(r.scontoCliente >= 0 && r.scontoCliente <= 99,
    `sconto fuori da 0-99: ${r.scontoCliente} (${ctxMsg})`);
}

test('regola A normale: 60% fornitore → 40', () => {
  const r = calcolaRiga(40, 100, DEF);
  assert.strictEqual(r.regola, 'A');
  assert.strictEqual(r.scontoCliente, 40);
  assert.strictEqual(r.prezzoClienteTarget, 60);
});

test('regola C: 90% fornitore → ricarico 77 sul netto, floor a 5', () => {
  const r = calcolaRiga(10, 100, DEF);
  assert.strictEqual(r.regola, 'C');
  assert.strictEqual(r.scontoCliente, 80); // raw 82.3 → floor 80
});

test('regola B: senza listino → listino fittizio al centesimo, sconto 30', () => {
  const r = calcolaRiga(12.345, 0, DEF);
  assert.strictEqual(r.regola, 'B');
  assert.strictEqual(r.listinoFin, 24.69);
  assert.strictEqual(r.scontoCliente, 30);
});

test('regola A: sconto negativo → 0', () => {
  const r = calcolaRiga(95, 100, DEF);
  assert.strictEqual(r.scontoCliente, 0);
});

test('config non intera (step 2.5, cap 70.5, B 33.3) → sconto sempre intero', () => {
  const S = { ...DEF, uiRoundStep: 2.5, regACapValue: 70.5, regBDiscount: 33.3 };
  for (const [acq, lis] of [[43, 100], [19, 100], [10, 100], [7, 0]]) {
    assertScontoIntero(calcolaRiga(acq, lis, S), `acq=${acq} lis=${lis}`);
  }
});

test('sweep acquisto/listino con i default → sempre intero 0-99', () => {
  for (let lis = 1; lis <= 500; lis += 7.13) {
    for (let pct = 0.01; pct <= 1.2; pct += 0.013) {
      const acq = Math.round(lis * pct * 100) / 100;
      if (acq <= 0) continue;
      assertScontoIntero(calcolaRiga(acq, lis, DEF), `acq=${acq} lis=${lis}`);
    }
  }
});

if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
console.log('\ntutti i test ok');
