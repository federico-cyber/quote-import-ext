/* leggiFascia: cliente dal form del preventivo (quote-import-ext#59, #63).
 *
 * Invarianti sotto test:
 *  - override > 0: nessuna richiesta al form, body override;
 *  - il cliente del form va sempre al bridge (anche cambiato rispetto al
 *    salvato), anche se le Opzioni hanno salvato il vecchio interruttore a false;
 *    form senza cliente → senzaCliente (bridge con flag spenta → spento);
 *  - il body porta ext_version e fonte per il log del bridge;
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
    S: { backendUrl: 'http://localhost:5008/api/quote-import', apiKey: 'k', overrideCliforNumero: 0, ...S },
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
  return { leggi: () => ctx.leggiFascia(), problema: (u) => ctx.backendUrlProblem(u), richieste, chiamate };
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

test('vecchio interruttore salvato a false: il form si legge lo stesso (#63)', async () => {
  const e = makeEnv({ S: { fasciaClienteDalForm: false }, form: formCon(GIMA), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 1);
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
});

test('il body porta versione e fonte del cliente per il log del bridge', async () => {
  const e = makeEnv({ S: {}, form: formCon(GIMA), bridge: BRIDGE });
  await e.leggi();
  assert.strictEqual(e.chiamate[0].fonte, 'form');
  assert.ok('ext_version' in e.chiamate[0]);
});

test('cliente scelto nel form non salvato → recupero', async () => {
  const e = makeEnv({ S: {}, form: formCon(GIMA), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 1);
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
  assert.deepStrictEqual({ ...r.recupero }, { soglia: 55, punti: 5 });
});

test('cliente cambiato nel form → va al bridge quello del form', async () => {
  const e = makeEnv({ S: {}, form: formCon(GIMA), salvato: ALTRO, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
});

test('form senza cliente → senzaCliente', async () => {
  const e = makeEnv({ S: {}, form: formCon(null), salvato: ALTRO, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(r.stato, 'senzaCliente');
  assert.ok(/non c'è ancora un cliente/.test(r.motivo));
});

test('form senza cliente ma fascia spenta sul bridge → spento (pricing normale)', async () => {
  const e = makeEnv({ S: {}, form: formCon(null), bridge: BRIDGE_SPENTO });
  assert.strictEqual((await e.leggi()).stato, 'spento');
});

test('form muto (timeout) → cliente salvato con la nota', async () => {
  const e = makeEnv({ S: {}, form: 'muto', salvato: GIMA, bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(e.chiamate[0].customerdata.CustomerCode, '158');
  assert.strictEqual(r.stato, 'recupero');
  assert.ok(/ultimo salvataggio/.test(r.nota));
});

test('risposta con reqId diverso ignorata → ripiego (nessun cliente)', async () => {
  const e = makeEnv({ S: {}, form: 'altroReq', bridge: BRIDGE });
  const r = await e.leggi();
  assert.deepStrictEqual(e.chiamate, [{ customerdata: null, ext_version: null, fonte: 'nessuno' }]);
  assert.strictEqual(r.stato, 'sconosciuto');
  assert.strictEqual(r.motivo, 'cliente del preventivo non letto');
});

test('override > 0: nessuna richiesta al form, body override', async () => {
  const e = makeEnv({ S: { overrideCliforNumero: 42 }, form: formCon(null), bridge: BRIDGE });
  const r = await e.leggi();
  assert.strictEqual(richiesteForm(e), 0);
  assert.deepStrictEqual(e.chiamate, [{ override_clifor_numero: 42, ext_version: null, fonte: 'override' }]);
  assert.strictEqual(r.stato, 'normale');
});

test('form senza cliente e bridge giù → senzaCliente', async () => {
  const e = makeEnv({ S: {}, form: formCon(null), bridge: () => { throw new Error('rete'); } });
  assert.strictEqual((await e.leggi()).stato, 'senzaCliente');
});

test('backendUrl fuori dai permessi, vuoto o relativo: errore col motivo e fetch non chiamato (#75)', async () => {
  for (const url of ['http://evil.example:5008/api/quote-import', '', '   ', '/relativo']) {
    const e = makeEnv({ S: { backendUrl: url }, form: formCon(GIMA), bridge: BRIDGE });
    const r = await e.leggi();
    assert.strictEqual(r.stato, 'errore', JSON.stringify(url));
    assert.ok(r.motivo.includes(e.problema(url)), `motivo senza il testo di backendUrlProblem: ${r.motivo}`);
    assert.strictEqual(e.chiamate.length, 0, `fetch chiamato per ${JSON.stringify(url)}`);
  }
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
