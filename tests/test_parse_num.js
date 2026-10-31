/* Test di parseNum / leggiCella (pricing.content.js) — quote-import-ext#32.
 *
 * Invariante sotto test: i numeri in formato italiano ("1.234,56") sono letti
 * con il punto come separatore delle migliaia e la virgola come decimale
 * (scelta di Fede su #32); un punto singolo è sempre decimale ("1234.56",
 * "1.255": #48, Qricambi scrive il numero JS grezzo); il segno
 * meno vale solo in prima posizione ("-% 30" = -30), mai in mezzo ("10 - 20").
 *
 * pricing.content.js è un IIFE legato al DOM: estraiamo solo i blocchi puri
 * parseNum e leggiCella e li eseguiamo in vm.
 * Node puro, zero dipendenze, exit code 1 se qualcosa fallisce.
 *   node tests/test_parse_num.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const pStart = SRC.indexOf('function parseNum');
const pEnd = SRC.indexOf('// ── VUE 3 COMPATIBLE INPUT SETTER');
const lStart = SRC.indexOf('function leggiCella');
const lEnd = SRC.indexOf('function inputDiCella');
assert.ok(pStart > 0 && pEnd > pStart, 'blocco parseNum non trovato in pricing.content.js');
assert.ok(lStart > 0 && lEnd > lStart, 'blocco leggiCella non trovato in pricing.content.js');

const ctx = {};
vm.runInNewContext(
  SRC.slice(pStart, pEnd) + '\n' + SRC.slice(lStart, lEnd) +
  '\nthis.parseNum = parseNum; this.leggiCella = leggiCella;', ctx);
const { parseNum, leggiCella } = ctx;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

test('#32 "1.234,56" → 1234.56 (punto migliaia, virgola decimale)', () => {
  assert.strictEqual(parseNum('1.234,56'), 1234.56);
});
test('#32 "1.234.567,89" → 1234567.89', () => {
  assert.strictEqual(parseNum('1.234.567,89'), 1234567.89);
});
test('#32 "1234.56" → 1234.56 (punto decimale senza migliaia)', () => {
  assert.strictEqual(parseNum('1234.56'), 1234.56);
});
test('#32 "12,5" → 12.5 e "1234,56" → 1234.56 (solo virgola = decimale)', () => {
  assert.strictEqual(parseNum('12,5'), 12.5);
  assert.strictEqual(parseNum('1234,56'), 1234.56);
});
test('#32 "€ 1.234,00" → 1234 (simbolo valuta ignorato)', () => {
  assert.strictEqual(parseNum('€ 1.234,00'), 1234);
});
test('#48 punto singolo = decimale anche con 3 cifre: "1.234" → 1.234, "1.255" → 1.255', () => {
  assert.strictEqual(parseNum('1.234'), 1.234);
  assert.strictEqual(parseNum('1.255'), 1.255);
  assert.strictEqual(parseNum('12.345'), 12.345);
});
test('#32 più punti = migliaia: "1.234.567" → 1234567', () => {
  assert.strictEqual(parseNum('1.234.567'), 1234567);
});
// Valori letti il 31/10/2026 da un preventivo vero su Qricambi (casella <input>
// di Acquisto, Ricarico, Listino, Sconto, Vendita) e dall'elenco preventivi (totale
// con IVA sopra i 1.000 €): Qricambi scrive il numero JS grezzo, punto decimale e
// nessun separatore delle migliaia.
test('#48 formato reale di Qricambi: "220", "38.86", "470", "35", "305.5", "1007.60"', () => {
  assert.strictEqual(parseNum('220'), 220);
  assert.strictEqual(parseNum('38.86'), 38.86);
  assert.strictEqual(parseNum('470'), 470);
  assert.strictEqual(parseNum('35'), 35);
  assert.strictEqual(parseNum('305.5'), 305.5);
  assert.strictEqual(parseNum('1007.60'), 1007.6);
});
test('#48 leggiCella su <input> con 3 decimali: "4.125" → 4.125, non 4125', () => {
  const td = { querySelector: () => ({ value: '4.125' }), textContent: '€' };
  assert.strictEqual(leggiCella(td), 4.125);
});
test('#32 punto singolo che resta decimale: "12.5", "0.123", "1234.567", "100.00"', () => {
  assert.strictEqual(parseNum('12.5'), 12.5);
  assert.strictEqual(parseNum('0.123'), 0.123);
  assert.strictEqual(parseNum('1234.567'), 1234.567);
  assert.strictEqual(parseNum('100.00'), 100);
});
test('#32 formato inverso "1,234.56" (virgola migliaia) → 1234.56', () => {
  assert.strictEqual(parseNum('1,234.56'), 1234.56);
});
test('#32 interi e zero', () => {
  assert.strictEqual(parseNum('0'), 0);
  assert.strictEqual(parseNum('42'), 42);
});
test('#32 sconto "-% 30" → -30 e "+% 40" → 40 (segno in prima posizione)', () => {
  assert.strictEqual(parseNum('-% 30'), -30);
  assert.strictEqual(parseNum('+% 40'), 40);
  assert.strictEqual(parseNum('-1.234,50'), -1234.5);
});
test('#32 "10 - 20" non è negativo (il meno in mezzo non è un segno)', () => {
  const n = parseNum('10 - 20');
  assert.ok(n !== null && n >= 0, `atteso non negativo, ottenuto ${n}`);
  assert.strictEqual(n, 10);
});
test('#32 input vuoti o non numerici → null', () => {
  assert.strictEqual(parseNum(null), null);
  assert.strictEqual(parseNum(undefined), null);
  assert.strictEqual(parseNum(''), null);
  assert.strictEqual(parseNum('abc'), null);
  assert.strictEqual(parseNum('-'), null);
});

// leggiCella: ricade su parseNum(td.textContent) quando manca l'input.
test('#32 leggiCella su cella con testo it-IT ≥ 1000 EUR → valore corretto', () => {
  const td = { querySelector: () => null, textContent: '1.234,56 €' };
  assert.strictEqual(leggiCella(td), 1234.56);
});
test('#32 leggiCella con input a 0 ricade sul testo it-IT', () => {
  const td = { querySelector: () => ({ value: '0' }), textContent: '2.500,00' };
  assert.strictEqual(leggiCella(td), 2500);
});

if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
console.log('\ntutti i test ok');
