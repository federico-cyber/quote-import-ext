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

test('regola B: senza listino → listino fittizio, sconto 30', () => {
  const r = calcolaRiga(12.345, 0, DEF);
  assert.strictEqual(r.regola, 'B');
  assert.strictEqual(r.scontoCliente, 30); // listino al centesimo: vedi test #24 regola B
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

// ── #24: Qricambi tiene la Vendita al centesimo e ne ricava lo sconto ──
// Lo sconto intero resta intero solo se listino × (100 − sconto) è divisibile
// per 100, cioè se la vendita esatta cade sul centesimo.
function assertVenditaAlCentesimo(r, listinoOrig, ctxMsg) {
  const cents = Math.round(r.listinoFin * 100);
  assert.ok(Math.abs(r.listinoFin * 100 - cents) < 1e-6,
    `listino non al centesimo: ${r.listinoFin} (${ctxMsg})`);
  assert.strictEqual((cents * (100 - r.scontoCliente)) % 100, 0,
    `vendita non al centesimo: ${r.listinoFin} × (1 − ${r.scontoCliente}%) (${ctxMsg})`);
  assert.ok(Math.abs(r.prezzoClienteTarget * 100 - Math.round(r.prezzoClienteTarget * 100)) < 1e-6,
    `prezzoClienteTarget non al centesimo: ${r.prezzoClienteTarget} (${ctxMsg})`);
  // Qricambi ricalcola lo sconto dalla vendita: deve tornare l'intero.
  const scontoRicalcolato = Math.round((1 - r.prezzoClienteTarget / r.listinoFin) * 10000) / 100;
  assert.strictEqual(scontoRicalcolato, r.scontoCliente,
    `Qricambi ricalcolerebbe ${scontoRicalcolato} invece di ${r.scontoCliente} (${ctxMsg})`);
  if (listinoOrig > 0) {
    const ritocco = cents - Math.round(listinoOrig * 100);
    assert.ok(ritocco >= 0 && ritocco < 20,
      `ritocco listino fuori da 0-19 cent: ${ritocco} (${ctxMsg})`);
  }
}

test('#24 caso reale: 2,86 / 8,74 → listino 8,80, sconto 45, vendita 4,84', () => {
  const r = calcolaRiga(2.86, 8.74, DEF);
  assert.strictEqual(r.scontoCliente, 45);
  assert.strictEqual(r.listinoFin, 8.80);
  assert.strictEqual(r.prezzoClienteTarget, 4.84);
});

test('#24 caso reale: listino 80,25 sconto 50 → 80,26, vendita 40,13', () => {
  const r = calcolaRiga(24, 80.25, DEF); // fornitore 70% → cliente 50
  assert.strictEqual(r.scontoCliente, 50);
  assert.strictEqual(r.listinoFin, 80.26);
  assert.strictEqual(r.prezzoClienteTarget, 40.13);
});

test('#24 listino già compatibile → nessun ritocco', () => {
  const r = calcolaRiga(139.9, 349.75, DEF); // sconto 40, vendita 209,85 esatta
  assert.strictEqual(r.scontoCliente, 40);
  assert.strictEqual(r.listinoFin, 349.75);
  assert.strictEqual(r.prezzoClienteTarget, 209.85);
});

test('#24 regola B: listino fittizio ritoccato al passo giusto', () => {
  const r = calcolaRiga(12.345, 0, DEF); // 24,69 × 0,70 = 17,283
  assert.strictEqual(r.regola, 'B');
  assert.strictEqual(r.scontoCliente, 30);
  assert.strictEqual(r.listinoFin, 24.70);
  assert.strictEqual(r.prezzoClienteTarget, 17.29);
});

test('#24 sweep con i default → vendita sempre al centesimo, ritocco < 0,20', () => {
  for (let lis = 1; lis <= 500; lis += 7.13) {
    const lisC = Math.round(lis * 100) / 100;
    for (let pct = 0.01; pct <= 1.2; pct += 0.013) {
      const acq = Math.round(lisC * pct * 100) / 100;
      if (acq <= 0) continue;
      assertVenditaAlCentesimo(calcolaRiga(acq, lisC, DEF), lisC, `acq=${acq} lis=${lisC}`);
    }
  }
});

test('#24 config non intera (step 1, cap 71, B 33) → vendita al centesimo, ritocco < 0,20', () => {
  const S = { ...DEF, uiRoundStep: 1, regACapValue: 71, regBDiscount: 33 };
  for (let lis = 1; lis <= 300; lis += 3.37) {
    const lisC = Math.round(lis * 100) / 100;
    for (let pct = 0.05; pct <= 1.0; pct += 0.031) {
      const acq = Math.round(lisC * pct * 100) / 100;
      if (acq <= 0) continue;
      const r = calcolaRiga(acq, lisC, S);
      assertScontoIntero(r, `acq=${acq} lis=${lisC}`);
      assertVenditaAlCentesimo(r, lisC, `acq=${acq} lis=${lisC}`);
    }
  }
  const b = calcolaRiga(7, 0, S);
  assertScontoIntero(b, 'B');
  assertVenditaAlCentesimo(b, 0, 'B');
});

if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
console.log('\ntutti i test ok');
