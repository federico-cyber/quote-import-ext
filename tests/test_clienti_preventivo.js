// Test della mappa clientiPreventivo e del listener dei messaggi di pricing.content.js
// (#71): la mappa tiene solo gli ultimi 20 preventivi e il listener accetta solo
// messaggi della stessa finestra E della stessa origine.
// Esecuzione: node tests/test_clienti_preventivo.js
'use strict';
const assert = require('assert');
const vm = require('vm');
const { estrai } = require('./_estrai');

const ORIGIN = 'https://app.qricambi.com';
function env() {
  const win = { location: { origin: ORIGIN } };
  const ctx = vm.createContext({
    window: win, location: { href: ORIGIN + '/q/1' },
    clientiPreventivo: new Map(), ultimoPreventivo: null,
  });
  vm.runInContext(estrai('ricordaCliente') + '\n' + estrai('onMessaggioPreventivo')
    + '\nthis.ricordaCliente = ricordaCliente; this.onMsg = onMessaggioPreventivo;', ctx);
  return { win, ctx, post: (data, o = {}) => ctx.onMsg({ source: win, origin: ORIGIN, data, ...o }) };
}

const cases = [];
const test = (n, f) => cases.push([n, f]);

test('la mappa tiene solo gli ultimi 20 preventivi (il piu vecchio esce)', () => {
  const { ctx } = env();
  for (let i = 1; i <= 25; i++) ctx.ricordaCliente(String(i), { n: i });
  assert.strictEqual(ctx.clientiPreventivo.size, 20);
  assert.ok(!ctx.clientiPreventivo.has('5') && ctx.clientiPreventivo.has('6') && ctx.clientiPreventivo.has('25'));
});

test('un id rivisto torna in coda e non viene espulso per primo', () => {
  const { ctx } = env();
  for (let i = 1; i <= 20; i++) ctx.ricordaCliente(String(i), { n: i });
  ctx.ricordaCliente('1', { n: 'nuovo' });
  ctx.ricordaCliente('21', { n: 21 });
  assert.ok(ctx.clientiPreventivo.has('1') && !ctx.clientiPreventivo.has('2'));
  assert.strictEqual(ctx.clientiPreventivo.get('1').n, 'nuovo');
});

test('messaggio AR_QUOTE_CUSTOMER della pagina: ricordato', () => {
  const { ctx, post } = env();
  post({ source: 'AR_QUOTE_CUSTOMER', id: 7, customerdata: { c: 1 } });
  assert.strictEqual(ctx.ultimoPreventivo.id, '7');
  assert.deepStrictEqual(ctx.clientiPreventivo.get('7'), { c: 1 });
});

test('messaggio AR_QUOTE_IMPORT della pagina: ricordato', () => {
  const { ctx, post } = env();
  post({ source: 'AR_QUOTE_IMPORT', payload: { ID: 9, customerdata: { c: 2 } } });
  assert.strictEqual(ctx.ultimoPreventivo.id, '9');
  assert.ok(ctx.clientiPreventivo.has('9'));
});

test('altra origine o altra finestra: ignorato', () => {
  const { ctx, post, win } = env();
  post({ source: 'AR_QUOTE_CUSTOMER', id: 1, customerdata: {} }, { origin: 'https://evil.example' });
  ctx.onMsg({ source: {}, origin: ORIGIN, data: { source: 'AR_QUOTE_CUSTOMER', id: 2, customerdata: {} } });
  assert.strictEqual(ctx.ultimoPreventivo, null);
  assert.strictEqual(ctx.clientiPreventivo.size, 0);
  assert.ok(win);
});

let failed = 0;
for (const [n, f] of cases) {
  try { f(); console.log('ok    ' + n); } catch (e) { failed++; console.error('FAIL  ' + n + '\n      ' + e.message); }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
