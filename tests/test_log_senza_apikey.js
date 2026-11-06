/* loadSettings (pricing.content.js): il log delle impostazioni non stampa la apiKey
 * (quote-import-ext#71, gruppo 1).
 *
 * Invariante: a ogni Applica Pricing loadSettings logga le impostazioni; la X-API-Key
 * del bridge (ARAUTO_API_KEY) non deve finire in console (F12 e' lo strumento di debug
 * indicato dalla documentazione). Le altre impostazioni restano visibili, e S continua
 * a contenere la chiave per le chiamate al bridge.
 *
 * Estrae `async function loadSettings` fino al blocco "CLIENTE DEL PREVENTIVO" e lo
 * esegue in vm con chrome.storage e console finti. Node puro, exit code 1 se fallisce.
 *   node tests/test_log_senza_apikey.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const DEFAULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'defaults.js'), 'utf8');
const i = SRC.indexOf('async function loadSettings');
const j = SRC.indexOf('// ── CLIENTE DEL PREVENTIVO');
assert.ok(i > 0 && j > i, 'blocco loadSettings non trovato in pricing.content.js');
const BLOCCO = SRC.slice(i, j);

const CHIAVE = 'segretissima-key-9f3a1c';

async function esegui(stored) {
  const righe = [];
  const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const ctx = vm.createContext({
    console: { log: (...a) => righe.push(fmt(a)), warn: (...a) => righe.push(fmt(a)) },
    chrome: { storage: { local: { get: (defaults, cb) => cb({ ...defaults, ...stored }) } } },
    TAG: '[test]',
  });
  vm.runInContext(DEFAULTS_SRC, ctx);
  vm.runInContext('let S = { ...DEFAULTS };\n' + BLOCCO + '\nthis.run = loadSettings; this.getS = () => S;', ctx);
  await ctx.run();
  return { righe, S: ctx.getS() };
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('il log di loadSettings non contiene la apiKey', async () => {
  const { righe } = await esegui({ apiKey: CHIAVE, backendUrl: 'http://x:5008/api/quote-import' });
  assert.ok(righe.length > 0, 'loadSettings deve loggare qualcosa');
  for (const r of righe) assert.ok(!r.includes(CHIAVE), `la chiave compare nel log: ${r}`);
});

test('il log resta utile: mostra ancora le impostazioni di pricing', async () => {
  const { righe } = await esegui({ apiKey: CHIAVE, regBMultiplier: 1.77 });
  assert.ok(righe.some((r) => r.includes('regBMultiplier')), 'le impostazioni non sono piu loggate');
});

test('S conserva la apiKey per le chiamate al bridge', async () => {
  const { S } = await esegui({ apiKey: CHIAVE });
  assert.strictEqual(S.apiKey, CHIAVE);
});

(async () => {
  let fail = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok  -', name); }
    catch (e) { fail++; console.error('FAIL -', name, '\n    ', e.message); }
  }
  console.log(`\n${cases.length - fail}/${cases.length} test passati`);
  process.exit(fail ? 1 : 0);
})();
