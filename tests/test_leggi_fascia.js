/* leggiFascia con l'opzione fasciaClienteDalForm (quote-import-ext#59).
 *
 * Invarianti sotto test:
 *  - opzione spenta o override > 0: nessuna richiesta al form, body come prima;
 *  - opzione accesa: il cliente del form va al bridge (anche cambiato rispetto
 *    al salvato); form senza cliente → senzaCliente (bridge con flag spenta → spento);
 *  - form che non risponde entro il timeout → ripiego sul cliente salvato;
 *  - una risposta con un reqId diverso non viene presa.
 *
 * Estrae da pricing.content.js il blocco fra "// ── LETTURA FASCIA" e
 * "// ── fine leggiFascia" e il blocco puro di calcolaRiga, e li esegue in vm
 * con window/fetch finti. Node puro, exit code 1 se fallisce.
 *   node tests/test_leggi_fascia.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const DEFAULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'defaults.js'), 'utf8');
const blocco = (da, a) => {
  const i = SRC.indexOf(da), j = SRC.indexOf(a);
  assert.ok(i > 0 && j > i, `blocco ${da} non trovato in pricing.content.js`);
  return SRC.slice(i, j);
};
const LETTURA = blocco('// ── LETTURA FASCIA', '// ── fine leggiFascia');
const PURO = blocco('function scontoIntero', '// ── fine calcolaRiga');

const GIMA = { CustomerCode: '158', CustomerName: 'AUTOFFICINA GIMA SNC' };
const ALTRO = { CustomerCode: '77' };
const HREF = 'https://app.qricambi.com/#/quote/390061';

// form: risposta di injected.js ({trovato, id, customerdata}), 'muto' = nessuna risposta,
// 'altroReq' = risposta con un reqId sbagliato. bridge(body) → [status, json].
function makeEnv({ S, form = 'muto', salvato = null, bridge }) {
  const listeners = new Set();
  const richieste = [], chiamate = [];
  const win = {
    addEventListener: (t, fn) => listeners.add(fn),
    removeEventListener: (t, fn) => listeners.delete(fn),
    postMessage: (msg) => {
      richieste.push(msg);
      if (msg.source !== 'AR_FORM_CUSTOMER_REQ' || form === 'muto') return;
      const reqId = form === 'altroReq' ? 'xxx' : msg.reqId;
      const dati = form === 'altroReq' ? { trovato: true, id: '390061', customerdata: GIMA } : form;
      setImmediate(() => {
        for (const fn of [...listeners]) fn({ source: win, data: { source: 'AR_FORM_CUSTOMER', reqId, ...dati } });
      });
    },
  };
  const ctx = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, setImmediate,
    console: { log() {}, warn() {} },
    window: win,
    location: { href: HREF },
    TAG: '[test]',
    S: { backendUrl: 'http://x:5008/api/quote-import', apiKey: 'k', overrideCliforNumero: 0, ...S },
    ultimoPreventivo: salvato ? { id: '390061', href: HREF } : null,
    clientiPreventivo: new Map(salvato ? [['390061', salvato]] : []),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      chiamate.push(body);
      const [status, json] = bridge(body);
      return { status, json: async () => json };
    },
  });
  vm.runInContext(DEFAULTS_SRC, ctx);
  vm.runInContext(PURO + LETTURA + '\nthis.leggiFascia = leggiFascia;', ctx);
  return { leggi: () => ctx.leggiFascia(), richieste, chiamate };
}

// Bridge con la fascia accesa: GIMA in recupero, altri normali, senza cliente 400.
const BRIDGE = (body) => {
  if (body.override_clifor_numero) return [200, { attivo: true, recupero: false, numero: body.override_clifor_numero, listino: 3506 }];
  const cd = body.customerdata;
  if (!cd) return [400, { error: 'serve customerdata' }];
  if (cd.CustomerCode === '158') {
    return [200, { attivo: true, recupero: true, numero: 158, ragione_sociale: 'GIMA', listino: 1106, soglia: 55, punti: 5 }];
  }
  return [200, { attivo: true, recupero: false, numero: 77, ragione_sociale: 'ALTRO', listino: 3506 }];
};
const BRIDGE_SPENTO = () => [200, { attivo: false, recupero: false }];
const formCon = (cd) => ({ trovato: true, id: '390061', customerdata: cd });
const richiesteForm = (e) => e.richieste.filter((m) => m.source === 'AR_FORM_CUSTOMER_REQ').length;

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('opzione spenta: nessuna richiesta al form, cliente non salvato → sconosciuto come prima', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: false }, form: formCon(GIMA), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 0);
  assert.deepStrictEqual(e.chiamate, [{ customerdata: null }]);
  assert.strictEqual(r.stato, 'sconosciuto');
  assert.ok(/salva il preventivo/.test(r.motivo));
});

test('opzione accesa: cliente scelto nel form non salvato → recupero', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: formCon(GIMA), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 1);
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
  assert.deepStrictEqual({ ...r.recupero }, { soglia: 55, punti: 5 });
});

test('opzione accesa: cliente cambiato nel form → va al bridge quello del form', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: formCon(GIMA), salvato: ALTRO, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
});

test('opzione accesa: form senza cliente → senzaCliente', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: formCon(null), salvato: ALTRO, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(r.stato, 'senzaCliente');
  assert.ok(/non c'è ancora un cliente/.test(r.motivo));
});

test('opzione accesa: form senza cliente ma fascia spenta sul bridge → spento (pricing normale)', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: formCon(null), bridge: BRIDGE_SPENTO });
  assert.strictEqual((await e.leggi()).stato, 'spento');
});

test('opzione accesa: form muto (timeout) → cliente salvato con la nota', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: 'muto', salvato: GIMA, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
  assert.ok(/ultimo salvataggio/.test(r.nota));
});

test('opzione accesa: risposta con reqId diverso ignorata → ripiego (nessun cliente)', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: 'altroReq', bridge: BRIDGE });
  const r = await e.leggi();
  assert.deepStrictEqual(e.chiamate, [{ customerdata: null }]);
  assert.strictEqual(r.stato, 'sconosciuto');
  assert.strictEqual(r.motivo, 'cliente del preventivo non letto');
});

test('opzione accesa con override > 0: nessuna richiesta al form, body override', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true, overrideCliforNumero: 42 }, form: formCon(null), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 0);
  assert.deepStrictEqual(e.chiamate, [{ override_clifor_numero: 42 }]);
  assert.strictEqual(r.stato, 'normale');
});

test('opzione accesa: form senza cliente e bridge giù → senzaCliente', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: true }, form: formCon(null), bridge: () => { throw new Error('rete'); } });
  assert.strictEqual((await e.leggi()).stato, 'senzaCliente');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
  }
  if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
  console.log('\ntutti i test ok');
})();
