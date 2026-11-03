/* Cliente scelto nel form del preventivo (quote-import-ext#59).
 *
 * Invarianti sotto test (clienteDalForm, injected.js):
 *  - legge `quoteToEdit.customerdata` dall'unico componente QuoteEdit visibile,
 *    anche annidato, prima di qualsiasi salvataggio;
 *  - nessun QuoteEdit visibile, o piu' di uno → form non letto (trovato: false);
 *  - cliente vuoto (null, {}, campi del matching tutti vuoti) → customerdata null;
 *  - passa solo i campi semplici, CustomerCode/Vat/TaxID/Email come stringa.
 *
 * Estrae il blocco fra "const CAMPI_CLIENTE" e "// ── fine clienteDalForm"
 * e lo esegue in vm con alberi Vue finti. Node puro, exit code 1 se fallisce.
 *   node tests/test_cliente_form.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'injected.js'), 'utf8');
const start = SRC.indexOf('const CAMPI_CLIENTE');
const end = SRC.indexOf('// ── fine clienteDalForm');
assert.ok(start > 0 && end > start, 'clienteDalForm non trovata in injected.js');
const ctx = vm.createContext({});
vm.runInContext(SRC.slice(start, end) + '\nthis.clienteDalForm = clienteDalForm;', ctx);
const { clienteDalForm } = ctx;

const el = (visibile = true, connesso = true) =>
  ({ isConnected: connesso, getClientRects: () => (visibile ? [{}] : []) });
const nodo = (name, figli = [], extra = {}) =>
  ({ $options: { name }, $el: el(), $children: figli, ...extra });
const quoteEdit = (quoteToEdit, $el = el()) => ({ $options: { name: 'QuoteEdit' }, $el, $children: [], quoteToEdit });
const albero = (...figli) => nodo('v-app', [nodo('Layout', [nodo('Page', figli)])]);

const GIMA = { CustomerCode: '158', CustomerName: 'AUTOFFICINA GIMA SNC', ID: 105572, n: 24 };

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

test('cliente scelto nel form (non salvato) → letto, col numero del preventivo', () => {
  const r = clienteDalForm(albero(quoteEdit({ ID: 390061, customerdata: GIMA })));
  assert.strictEqual(r.trovato, true);
  assert.strictEqual(r.id, '390061');
  assert.strictEqual(r.customerdata.CustomerCode, '158');
  assert.strictEqual(r.customerdata.CustomerName, 'AUTOFFICINA GIMA SNC');
});

test('solo campi semplici; i campi del matching numerici diventano stringhe', () => {
  const cd = { CustomerCode: 158, Vat: 1234567890, Email: 'a@b.it', ID: 9,
    Account: { User: { Name: 'x' } }, Tags: ['a'], Fn() {} };
  const r = clienteDalForm(albero(quoteEdit({ ID: 1, customerdata: cd })));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.customerdata)),
    { CustomerCode: '158', Vat: '1234567890', Email: 'a@b.it', ID: 9 });
});

for (const [nome, cd] of [
  ['null', null],
  ['oggetto vuoto', {}],
  ['campi del matching vuoti', { CustomerCode: '', Vat: '  ', TaxID: null, Email: '', CustomerName: '', ID: 0 }],
  ['array', []],
  ['segnaposto 0 / false', { CustomerCode: 0, Vat: '0', Email: false, CustomerName: '' }],
]) {
  test(`form senza cliente (${nome}) → trovato, customerdata null`, () => {
    const r = clienteDalForm(albero(quoteEdit({ ID: 390061, customerdata: cd })));
    assert.strictEqual(r.trovato, true);
    assert.strictEqual(r.customerdata, null);
  });
}

test('nessun QuoteEdit nella pagina → form non letto', () => {
  const r = clienteDalForm(albero(nodo('QuoteList')));
  assert.strictEqual(r.trovato, false);
  assert.ok(/non trovato/.test(r.motivo));
});

test('QuoteEdit nascosto o staccato dal documento → ignorato', () => {
  const r = clienteDalForm(albero(
    quoteEdit({ ID: 1, customerdata: GIMA }, el(false)),
    quoteEdit({ ID: 2, customerdata: GIMA }, el(true, false)),
    quoteEdit({ ID: 3, customerdata: GIMA }, { nodeType: 8 })));
  assert.strictEqual(r.trovato, false);
});

test('un QuoteEdit visibile e uno nascosto → legge quello visibile', () => {
  const r = clienteDalForm(albero(
    quoteEdit({ ID: 1, customerdata: { CustomerCode: '77' } }, el(false)),
    quoteEdit({ ID: 2, customerdata: GIMA })));
  assert.strictEqual(r.id, '2');
  assert.strictEqual(r.customerdata.CustomerCode, '158');
});

test('due QuoteEdit visibili → form non letto (non si sceglie a caso)', () => {
  const r = clienteDalForm(albero(
    quoteEdit({ ID: 1, customerdata: GIMA }), quoteEdit({ ID: 2, customerdata: GIMA })));
  assert.strictEqual(r.trovato, false);
  assert.ok(/piu' preventivi/.test(r.motivo));
});

test('QuoteEdit contenitore (senza quoteToEdit) con dentro il form → legge il form', () => {
  // Struttura vera di Qricambi (03/11/2026): QuoteEdit della scheda > v-tab-item > QuoteEdit col preventivo.
  const contenitore = quoteEdit(undefined);
  contenitore.$children = [nodo('v-tab-item', [quoteEdit({ ID: 390061, customerdata: GIMA })])];
  const r = clienteDalForm(albero(contenitore));
  assert.strictEqual(r.trovato, true);
  assert.strictEqual(r.id, '390061');
  assert.strictEqual(r.customerdata.CustomerCode, '158');
});

test('cliente scritto a mano (solo nome, senza codice) → passa il nome', () => {
  const r = clienteDalForm(albero(quoteEdit({ ID: 1, customerdata: { CustomerCode: null, CustomerName: 'GIMA' } })));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.customerdata)), { CustomerName: 'GIMA' });
});

test('QuoteEdit senza quoteToEdit → form non letto', () => {
  assert.strictEqual(clienteDalForm(albero(quoteEdit(null))).trovato, false);
});

test('radice assente → form non letto', () => {
  assert.strictEqual(clienteDalForm(undefined).trovato, false);
});

if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
console.log('\ntutti i test ok');
