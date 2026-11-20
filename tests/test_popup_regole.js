// Test delle regole di pricing mostrate nel popup (#71): i numeri vengono da
// chrome.storage (Opzioni) e da DEFAULTS, non sono scritti nell'HTML.
// Esecuzione: node tests/test_popup_regole.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { caricaDefaults } = require('./_estrai');

const POPUP_SRC = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');

function el() {
  return {
    children: [], style: {}, textContent: '', className: '',
    appendChild(c) { this.children.push(c); }, addEventListener() {},
  };
}
const testo = (e) => e.textContent + e.children.map(testo).join('');

function popup(salvato) {
  const rules = el();
  const ctx = vm.createContext({
    Date, DEFAULTS: caricaDefaults(),
    document: { getElementById: (id) => (id === 'rules' ? rules : el()), createElement: el },
    chrome: { storage: { local: { get(k, cb) {
      cb(Array.isArray(k) || 'importHistory' in k ? { importHistory: [] } : { ...k, ...salvato });
    } } }, runtime: {} },
    window: {},
  });
  vm.runInContext(POPUP_SRC, ctx);
  return rules.children.map(testo);
}

const cases = [];
const test = (n, f) => cases.push([n, f]);

test('con i default: i numeri sono quelli di DEFAULTS (20pp, 78pp, x1.77, x2, 30%)', () => {
  const [a, c, b] = popup({});
  assert.ok(/Regola A.*≤ 78pp.*− 20pp/.test(a), a);
  assert.ok(/Regola C.*> 78pp.*× 1\.77/.test(c), c);
  assert.ok(/Regola B.*× 2, sconto 30%/.test(b), b);
});

test('con Opzioni cambiate: il popup mostra i valori salvati', () => {
  const [a, c, b] = popup({ regADelta: 15, regCThreshold: 80, regCMarkup: 60, regBMultiplier: 2.5, regBDiscount: 25 });
  assert.ok(/≤ 80pp.*− 15pp/.test(a), a);
  assert.ok(/> 80pp.*× 1\.6/.test(c), c);
  assert.ok(/× 2\.5, sconto 25%/.test(b), b);
});

test('valore salvato rotto: cade sul default, mai NaN', () => {
  const t = popup({ regADelta: 'abc', regCMarkup: null }).join(' ');
  assert.ok(!/NaN/.test(t), t);
  assert.ok(/− 20pp/.test(t) && /× 1\.77/.test(t), t);
});

test('popup.html: niente numeri delle regole scritti a mano, defaults.js caricato prima di popup.js', () => {
  assert.ok(!/× 1\.77|78pp|− 20pp/.test(POPUP_HTML), 'numeri hardcoded nell\'HTML');
  assert.ok(POPUP_HTML.indexOf('defaults.js') > 0 && POPUP_HTML.indexOf('defaults.js') < POPUP_HTML.indexOf('popup.js'));
});

let failed = 0;
for (const [n, f] of cases) {
  try { f(); console.log('ok    ' + n); } catch (e) { failed++; console.error('FAIL  ' + n + '\n      ' + e.message); }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
