/* manifest.json e docs/privacy.html (quote-import-ext#71, gruppo 1).
 *
 *  - manifest: nessun permesso non usato. activeTab non serve (nessun chrome.tabs /
 *    chrome.scripting / chrome.action programmatico; i content script hanno `matches`
 *    e le chiamate al bridge sono coperte da host_permissions).
 *  - privacy: la policy descrive la lettura del cliente al Pricing (POST a
 *    /fascia-cliente senza clic su Importa), non solo l'import.
 * Node puro, exit code 1 se fallisce.
 *   node tests/test_manifest_privacy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const privacy = fs.readFileSync(path.join(ROOT, 'docs', 'privacy.html'), 'utf8');
const testo = privacy.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('manifest: permissions = solo storage (activeTab tolto)', () => {
  assert.deepStrictEqual(manifest.permissions, ['storage']);
});

test('manifest: nessun file usa API che richiederebbero activeTab/tabs/scripting', () => {
  const sorgenti = ['injected.js', 'defaults.js', 'fab.js', 'pricing.content.js',
    'import.content.js', 'options.js', 'popup.js'];
  for (const f of sorgenti) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/chrome\.(tabs|scripting|action)\b/.test(src), `${f} usa chrome.tabs/scripting/action`);
  }
});

test('privacy: descrive la lettura del cliente al Pricing e la fascia sconto', () => {
  assert.ok(/Applica Pricing/i.test(testo), 'manca il riferimento ad Applica Pricing');
  assert.ok(/fascia/i.test(testo), 'manca la fascia sconto del cliente');
  assert.ok(/fascia-cliente/.test(testo), 'manca l\'endpoint fascia-cliente');
});

test('privacy: non afferma piu che i dati si leggono solo all\'import', () => {
  assert.ok(!/del preventivo solo quando l'utente avvia l'import/i.test(testo));
});

test('privacy: data di aggiornamento posteriore al 15 maggio 2026', () => {
  assert.ok(!/Aggiornata il 15 maggio 2026/.test(testo), 'data di aggiornamento non aggiornata');
});

let fail = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log('ok  -', name); }
  catch (e) { fail++; console.error('FAIL -', name, '\n    ', e.message); }
}
console.log(`\n${cases.length - fail}/${cases.length} test passati`);
process.exit(fail ? 1 : 0);
