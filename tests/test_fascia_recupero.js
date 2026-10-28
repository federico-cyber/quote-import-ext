/* Fascia sconto di recupero nel pricing (arauto#4911).
 *
 * Invarianti sotto test:
 *  - con un cliente su fascia di recupero ogni sconto >= soglia perde `punti`
 *    punti (55 → 50, 60 → 55), sotto soglia nulla cambia; la vendita resta al
 *    centesimo (#24) e lo sconto non supera mai quello senza recupero;
 *  - senza recupero (null) calcolaRiga è identica a prima;
 *  - ogni dubbio sulla fascia (cliente non noto, ambiguo, server giù, flag
 *    spenta) prezza come prima: solo `stato: 'recupero'` porta la regola.
 *
 * Stessa estrazione di test_calcola_riga.js: il blocco puro fra
 * "function scontoIntero" e "// ── fine calcolaRiga", eseguito in vm.
 *   node tests/test_fascia_recupero.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const start = SRC.indexOf('function scontoIntero');
const end = SRC.indexOf('// ── fine calcolaRiga');
assert.ok(start > 0 && end > start, 'blocco calcolaRiga non trovato in pricing.content.js');

const ctx = { URL };
vm.runInNewContext(SRC.slice(start, end) +
  '\nthis.f = { calcolaRiga, scegliPreventivo, urlFascia, esitoFascia };', ctx);
const { calcolaRiga, scegliPreventivo, urlFascia, esitoFascia } = ctx.f;

const DEF = {
  regADelta: 20, regACapThreshold: 80, regACapValue: 70,
  regCThreshold: 78, regCMarkup: 77,
  regBMultiplier: 2.0, regBDiscount: 30, uiRoundStep: 5,
};
const REC = { soglia: 55, punti: 5 };

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

function venditaAlCentesimo(r) {
  const cent = Math.round(r.listinoFin * 100) * (100 - r.scontoCliente);
  return cent % 100 === 0;
}

// ── calcolaRiga con recupero ─────────────────────────────────────────────
for (const [nome, acq, lis, S, atteso, normale, applicato] of [
  ['A: 55 → 50', 25, 100, DEF, 50, 55, true],
  ['A: 60 → 55', 20, 100, DEF, 55, 60, true],
  ['A: 54 resta 54 (step 1)', 26, 100, { ...DEF, uiRoundStep: 1 }, 54, 54, false],
  ['A cap: 70 → 65', 15, 100, DEF, 65, 70, true],
  ['C: 80 → 75', 10, 100, DEF, 75, 80, true],
  ['A: 40 resta 40', 40, 100, DEF, 40, 40, false],
  ['B: 30 resta 30', 7, 0, DEF, 30, 30, false],
]) {
  test(`recupero ${nome}`, () => {
    const n = calcolaRiga(acq, lis, S, null);
    const r = calcolaRiga(acq, lis, S, REC);
    assert.strictEqual(n.scontoCliente, normale, 'sconto senza recupero');
    assert.strictEqual(r.scontoCliente, atteso, 'sconto con recupero');
    assert.strictEqual(r.recuperoApplicato, applicato);
    assert.strictEqual(r.regola, n.regola);
    assert.ok(venditaAlCentesimo(r), 'vendita non al centesimo');
  });
}

test('senza recupero il risultato è identico a quello di prima', () => {
  for (const [acq, lis] of [[25, 100], [10, 100], [7, 0], [8.74, 19.4]]) {
    const prima = calcolaRiga(acq, lis, DEF);
    const ora = calcolaRiga(acq, lis, DEF, null);
    assert.deepStrictEqual(
      { ...ora, recuperoApplicato: undefined }, { ...prima, recuperoApplicato: undefined });
    assert.strictEqual(ora.recuperoApplicato, false);
  }
});

test('sweep: col recupero lo sconto non supera mai quello normale, vendita al centesimo', () => {
  let ridotte = 0;
  for (let lis = 1; lis <= 400; lis += 6.71) {
    const lisC = Math.round(lis * 100) / 100;
    for (let pct = 0.01; pct <= 1.2; pct += 0.017) {
      const acq = Math.round(lisC * pct * 100) / 100;
      if (acq <= 0) continue;
      const n = calcolaRiga(acq, lisC, DEF, null);
      const r = calcolaRiga(acq, lisC, DEF, REC);
      const msg = `acq=${acq} lis=${lisC} n=${n.scontoCliente} r=${r.scontoCliente}`;
      assert.ok(Number.isInteger(r.scontoCliente), msg);
      assert.ok(r.scontoCliente <= n.scontoCliente, msg);
      assert.ok(venditaAlCentesimo(r), msg);
      if (n.scontoCliente >= 57) {
        assert.ok(r.scontoCliente <= n.scontoCliente - 3, msg);
        ridotte++;
      }
      if (n.scontoCliente < 53) assert.strictEqual(r.scontoCliente, n.scontoCliente, msg);
    }
  }
  assert.ok(ridotte > 100, `sweep troppo povero: ${ridotte}`);
});

// ── scelta del preventivo e del cliente ──────────────────────────────────
const GIMA = { CustomerCode: '158' };
test('preventivo dall\'URL col cliente noto', () => {
  const m = new Map([['365954', GIMA]]);
  const r = scegliPreventivo('https://app.qricambi.com/quote/365954?x=1', '111111', m);
  assert.strictEqual(r.id, '365954');
  assert.deepStrictEqual(r.customerdata, GIMA);
});
test('URL senza id → ultimo preventivo visto', () => {
  const m = new Map([['111111', GIMA]]);
  const r = scegliPreventivo('https://app.qricambi.com/?activetab=quote', '111111', m);
  assert.strictEqual(r.id, '111111');
  assert.deepStrictEqual(r.customerdata, GIMA);
});
test('id nell\'URL senza cliente noto → nessun customerdata (mai quello di un altro preventivo)', () => {
  const m = new Map([['111111', GIMA]]);
  const r = scegliPreventivo('https://app.qricambi.com/quote/222222', '111111', m);
  assert.strictEqual(r.id, '222222');
  assert.strictEqual(r.customerdata, null);
});
test('niente URL né preventivi visti → id null', () => {
  const r = scegliPreventivo('https://app.qricambi.com/', null, new Map());
  assert.strictEqual(r.id, null);
  assert.strictEqual(r.customerdata, null);
});

// ── indirizzo dell'endpoint ──────────────────────────────────────────────
test('urlFascia accanto all\'import configurato', () => {
  assert.strictEqual(urlFascia('http://100.86.223.69:5008/api/quote-import'),
    'http://100.86.223.69:5008/api/quote-import/fascia-cliente');
  assert.strictEqual(urlFascia('http://localhost:5008/api/quote-import/'),
    'http://localhost:5008/api/quote-import/fascia-cliente');
  assert.strictEqual(urlFascia('http://192.168.1.41:5008'),
    'http://192.168.1.41:5008/api/quote-import/fascia-cliente');
  assert.strictEqual(urlFascia(''), null);
  assert.strictEqual(urlFascia('non un url'), null);
});

// ── esito della chiamata ─────────────────────────────────────────────────
const OK_REC = { attivo: true, numero: 158, ragione_sociale: 'AUTOFFICINA GIMA SNC',
  listino: 1106, recupero: true, fascia_origine: 106, soglia: 55, punti: 5 };
test('200 recupero → regola con soglia e punti del server', () => {
  const e = esitoFascia(200, OK_REC, true);
  assert.strictEqual(e.stato, 'recupero');
  assert.deepStrictEqual({ ...e.recupero }, { soglia: 55, punti: 5 });
  assert.strictEqual(e.nome, 'AUTOFFICINA GIMA SNC');
  assert.strictEqual(e.listino, 1106);
});
test('200 recupero senza soglia/punti → errore, prezzi normali', () => {
  for (const b of [{ ...OK_REC, soglia: undefined }, { ...OK_REC, punti: 0 },
                   { ...OK_REC, punti: 'x' }]) {
    assert.strictEqual(esitoFascia(200, b, true).stato, 'errore');
  }
});
test('200 fascia normale → nessuna regola', () => {
  const e = esitoFascia(200, { ...OK_REC, listino: 106, recupero: false, fascia_origine: null }, true);
  assert.strictEqual(e.stato, 'normale');
  assert.strictEqual(e.recupero, undefined);
});
test('flag del server spenta → spento', () => {
  assert.strictEqual(esitoFascia(200, { attivo: false, recupero: false }, false).stato, 'spento');
});
test('400 senza cliente letto → sconosciuto, chiede di salvare', () => {
  const e = esitoFascia(400, { error: 'customerdata' }, false);
  assert.strictEqual(e.stato, 'sconosciuto');
  assert.ok(/salva il preventivo/.test(e.motivo));
});
test('400 con cliente mandato → errore (non «salva e rilancia»)', () => {
  assert.strictEqual(esitoFascia(400, { error: 'x' }, true).stato, 'errore');
});
test('422 non trovato / ambiguo → sconosciuto col motivo giusto', () => {
  assert.ok(/non riconosciuto/.test(esitoFascia(422, { ambiguous: false }, true).motivo));
  assert.ok(/più anagrafiche/.test(esitoFascia(422, { ambiguous: true, candidates: [] }, true).motivo));
});
test('401, 500, rete giù, corpo non JSON → errore, prezzi normali', () => {
  assert.strictEqual(esitoFascia(401, { error: 'unauthorized' }, true).stato, 'errore');
  assert.strictEqual(esitoFascia(500, null, true).stato, 'errore');
  const giu = esitoFascia(0, null, true);
  assert.strictEqual(giu.stato, 'errore');
  assert.ok(/non raggiungibile/.test(giu.motivo));
  assert.strictEqual(esitoFascia(200, null, true).stato, 'errore');
});

if (failed) { console.log(`\n${failed} test falliti`); process.exit(1); }
console.log('\ntutti i test ok');
