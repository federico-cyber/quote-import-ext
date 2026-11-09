/* Sconto SIRJ del cliente nel Pricing (arauto#5739).
 *
 * Invarianti sotto test:
 *  - riga con regola SIRJ (precodice o famiglia): sconto SIRJ sul listino
 *    Qricambi, vendita al centesimo, anche con sconto decimale (27,8);
 *  - riga a netto: vendita = netto; senza listino o con listino sotto il netto,
 *    listino = netto e sconto 0;
 *  - prezzo SIRJ sotto l'acquisto o riga senza listino: regole di sempre;
 *  - articolo non in SIRJ, senza regola o riga illeggibile: regole di sempre
 *    con `punti` in meno su ogni sconto (Fede, 09/11/2026: «togli un ulteriore 20»);
 *  - cliente fuori flag (sirj null): calcolaRiga di sempre, identica;
 *  - esitoSconti: solo 404 e attivo:false prezzano come sempre; ogni altro
 *    esito per un cliente nella flag e' un errore (nessun prezzo scritto);
 *  - eseguiConIndici con gli sconti: righe SIRJ senza riscrittura dello sconto,
 *    righe senza sconto SIRJ gialle (ar-row-nosirj).
 *
 * Stessa estrazione di test_calcola_riga.js e test_vendita_senza_input.js.
 *   node tests/test_sconti_sirj.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');
const DEFAULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'defaults.js'), 'utf8');
const calcStart = SRC.indexOf('function scontoIntero');
const calcEnd = SRC.indexOf('// ── fine calcolaRiga');
assert.ok(calcStart > 0 && calcEnd > calcStart, 'blocco calcolaRiga non trovato');
const cicloStart = SRC.indexOf('async function eseguiConIndici');
const cicloEnd = SRC.indexOf('// ── ANNULLA');
assert.ok(cicloStart > 0 && cicloEnd > cicloStart, 'eseguiConIndici non trovata');

function estrai(nome) {
  const start = SRC.indexOf(`function ${nome}(`);
  assert.ok(start >= 0, `${nome} non trovata in pricing.content.js`);
  const end = SRC.indexOf('\n  }\n', start);
  return SRC.slice(start, end + 4);
}

const ctx = vm.createContext({ URL });
vm.runInContext(DEFAULTS_SRC, ctx);
vm.runInContext(SRC.slice(calcStart, calcEnd) +
  '\nthis.f = { calcolaRiga, prezzoRiga, esitoSconti, urlSconti, esitoFascia, tolleranzaSconto };', ctx);
const { calcolaRiga, prezzoRiga, esitoSconti, urlSconti, esitoFascia, tolleranzaSconto } = ctx.f;

const DEF = {
  regADelta: 20, regACapThreshold: 80, regACapValue: 70,
  regCThreshold: 78, regCMarkup: 77,
  regBMultiplier: 2.0, regBDiscount: 30, uiRoundStep: 5,
  uiThresholdLow: 10, uiThresholdHigh: 35, regBSottoCosto: true,
};
const plain = (o) => JSON.parse(JSON.stringify(o));
const sirj = (riga, punti = 20) => ({ punti, riga });

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

(async () => {
  // ── prezzoRiga ──────────────────────────────────────────────────────────
  await test('cliente fuori flag: identica a calcolaRiga', () => {
    for (const [a, l] of [[25, 100], [10, 100], [8, 0], [50, 40]]) {
      const atteso = { ...plain(calcolaRiga(a, l, DEF, null)), tipo: null };
      assert.deepStrictEqual(plain(prezzoRiga(a, l, DEF, null, null)), atteso);
    }
  });

  await test('famiglia 30% su listino 100: vendita 70, sconto 30, niente ritocco', () => {
    const r = prezzoRiga(50, 100, DEF, null, sirj({ fonte: 'famiglia', sconto: 30, sconti: [30, 0, 0] }));
    assert.strictEqual(r.tipo, 'sirj');
    assert.strictEqual(r.scontoCliente, 30);
    assert.strictEqual(r.listinoFin, 100);
    assert.strictEqual(r.prezzoClienteTarget, 70);
    assert.strictEqual(r.recuperoApplicato, false);
  });

  await test('sconto decimale 27,8 su listino 8,74: vendita al centesimo', () => {
    const r = prezzoRiga(3, 8.74, DEF, null, sirj({ fonte: 'precodice', sconto: 27.8 }));
    assert.strictEqual(r.tipo, 'sirj');
    assert.strictEqual(r.scontoCliente, 27.8);
    assert.strictEqual(r.prezzoClienteTarget, 6.31); // 8,74 × 0,722 = 6,31028
  });

  await test('precodice+famiglia vale come sconto SIRJ', () => {
    assert.strictEqual(prezzoRiga(10, 100, DEF, null, sirj({ fonte: 'precodice+famiglia', sconto: 40 })).tipo, 'sirj');
  });

  await test('sconto SIRJ sotto l\'acquisto: regole di sempre, tipo sottoCosto', () => {
    const r = prezzoRiga(50, 100, DEF, null, sirj({ fonte: 'famiglia', sconto: 60 }));
    assert.strictEqual(r.tipo, 'sottoCosto');
    assert.deepStrictEqual({ ...plain(r), tipo: null }, { ...plain(calcolaRiga(50, 100, DEF, null)), tipo: null });
  });

  await test('vendita SIRJ uguale all\'acquisto: resta SIRJ (non sotto)', () => {
    assert.strictEqual(prezzoRiga(70, 100, DEF, null, sirj({ fonte: 'famiglia', sconto: 30 })).tipo, 'sirj');
  });

  await test('sconto SIRJ senza listino: regole di sempre, tipo senzaListino', () => {
    for (const l of [0, null, NaN]) {
      const r = prezzoRiga(8, l, DEF, null, sirj({ fonte: 'famiglia', sconto: 30 }));
      assert.strictEqual(r.tipo, 'senzaListino');
      assert.strictEqual(r.regola, 'B');
    }
  });

  await test('netto: vendita = netto, sconto ricavato dal listino Qricambi', () => {
    const r = prezzoRiga(30, 100, DEF, null, sirj({ fonte: 'netto', netto: 45 }));
    assert.strictEqual(r.tipo, 'netto');
    assert.strictEqual(r.prezzoClienteTarget, 45);
    assert.strictEqual(r.listinoFin, 100);
    assert.strictEqual(r.scontoCliente, 55);
  });

  await test('netto con listino assente o sotto il netto: listino = netto, sconto 0', () => {
    for (const l of [0, 40, null]) {
      const r = prezzoRiga(30, l, DEF, null, sirj({ fonte: 'netto', netto: 45.678 }));
      assert.strictEqual(r.tipo, 'netto');
      assert.strictEqual(r.prezzoClienteTarget, 45.68);
      assert.strictEqual(r.listinoFin, 45.68);
      assert.strictEqual(r.scontoCliente, 0);
    }
  });

  await test('netto sotto l\'acquisto: regole di sempre, tipo sottoCosto', () => {
    assert.strictEqual(prezzoRiga(50, 100, DEF, null, sirj({ fonte: 'netto', netto: 45 })).tipo, 'sottoCosto');
  });

  await test('nessuna regola: regole di sempre meno 20 punti (55 → 35)', () => {
    const normale = calcolaRiga(25, 100, DEF, null);
    assert.strictEqual(normale.scontoCliente, 55);
    const r = prezzoRiga(25, 100, DEF, null, sirj({ fonte: 'nessuna_regola', sconto: null }));
    assert.strictEqual(r.tipo, 'senzaRegola');
    assert.strictEqual(r.scontoCliente, 35);
    assert.strictEqual(r.recuperoApplicato, false, 'i punti senza regola non sono la fascia di recupero');
    assert.ok(r.prezzoClienteTarget > normale.prezzoClienteTarget);
  });

  await test('non in SIRJ, fonte sconosciuta, riga vuota o sconto illeggibile: come nessuna regola', () => {
    for (const riga of [{ fonte: 'non_in_sirj' }, { fonte: 'boh', sconto: 30 }, {}, null,
                        { fonte: 'famiglia', sconto: null }, { fonte: 'famiglia', sconto: 'x' },
                        { fonte: 'famiglia', sconto: 100 }, { fonte: 'netto', netto: 0 },
                        { fonte: 'famiglia', sconto: '' }, { fonte: 'famiglia', sconto: '30' },
                        { fonte: 'netto', netto: '' }]) {
      const r = prezzoRiga(25, 100, DEF, null, sirj(riga));
      assert.strictEqual(r.tipo, 'senzaRegola', JSON.stringify(riga));
      assert.strictEqual(r.scontoCliente, 35, JSON.stringify(riga));
    }
  });

  await test('meno 20 su sconti bassi: mai sotto 0 (15 → 0), regola B 30 → 10', () => {
    const basso = prezzoRiga(80, 100, DEF, null, sirj({ fonte: 'non_in_sirj' }));
    assert.strictEqual(basso.scontoCliente, 0);
    const b = prezzoRiga(8, 0, DEF, null, sirj({ fonte: 'non_in_sirj' }));
    assert.strictEqual(b.regola, 'B');
    assert.strictEqual(b.scontoCliente, 10);
  });

  await test('punti 0: nessuna riduzione, tipo senzaRegola', () => {
    const r = prezzoRiga(25, 100, DEF, null, sirj({ fonte: 'nessuna_regola' }, 0));
    assert.strictEqual(r.tipo, 'senzaRegola');
    assert.strictEqual(r.scontoCliente, 55);
  });

  await test('fascia di recupero: lo sconto SIRJ la ignora, la riga senza regola usa i punti', () => {
    const REC = { soglia: 55, punti: 5 };
    assert.strictEqual(prezzoRiga(30, 100, DEF, REC, sirj({ fonte: 'famiglia', sconto: 60 })).scontoCliente, 60);
    assert.strictEqual(prezzoRiga(25, 100, DEF, REC, sirj({ fonte: 'nessuna_regola' })).scontoCliente, 35);
  });

  // ── esitoSconti ─────────────────────────────────────────────────────────
  const INV = [{ code: 'A1', manufacturer: 'BOSCH' }, { code: 'B2', manufacturer: 'HOFFER' }];
  const OK = { attivo: true, numero: 5, listino: 101, punti_senza_regola: 20,
    righe: [{ code: 'A1', fonte: 'famiglia', sconto: 30 }, { code: 'B2', fonte: 'non_in_sirj' }] };
  await test('200 attivo: righe e punti', () => {
    const e = esitoSconti(200, OK, INV);
    assert.strictEqual(e.stato, 'attivo');
    assert.strictEqual(e.punti, 20);
    assert.strictEqual(e.righe.length, 2);
  });
  await test('cliente fuori flag o bridge senza la rotta: spento', () => {
    assert.strictEqual(esitoSconti(200, { attivo: false }, INV).stato, 'spento');
    assert.strictEqual(esitoSconti(404, null, INV).stato, 'spento');
  });
  await test('risposta 200 malformata: errore', () => {
    for (const b of [{ ...OK, punti_senza_regola: undefined }, { ...OK, punti_senza_regola: -1 },
                     { ...OK, punti_senza_regola: 2.5 }, { ...OK, punti_senza_regola: '20' },
                     { ...OK, righe: [OK.righe[0]] }, { ...OK, righe: null }, null, 'x', {},
                     { ...OK, righe: [OK.righe[1], OK.righe[0]] }, { ...OK, righe: [OK.righe[0], null] },
                     { ...OK, righe: [OK.righe[0], { fonte: 'famiglia', sconto: 30 }] }]) {
      assert.strictEqual(esitoSconti(200, b, INV).stato, 'errore', JSON.stringify(b));
    }
  });
  await test('SIRJ giù, timeout, chiave sbagliata, body rifiutato: errore con motivo', () => {
    for (const [st, re] of [[503, /503/], [0, /non raggiungibile/], [504, /lento/], [401, /401/],
                            [400, /400/], [422, /422/], [500, /500/]]) {
      const e = esitoSconti(st, { error: 'x' }, INV);
      assert.strictEqual(e.stato, 'errore');
      assert.ok(re.test(e.motivo), `${st}: ${e.motivo}`);
    }
  });

  await test('urlSconti accanto a fascia-cliente', () => {
    assert.strictEqual(urlSconti('http://100.86.223.69:5008/api/quote-import'),
      'http://100.86.223.69:5008/api/quote-import/sconti-cliente');
    assert.strictEqual(urlSconti('http://192.168.1.41:5008'), 'http://192.168.1.41:5008/api/quote-import/sconti-cliente');
    assert.strictEqual(urlSconti(''), null);
  });

  await test('esitoFascia porta il numero del cliente (solo intero > 0)', () => {
    const b = { attivo: true, numero: 5, ragione_sociale: 'PRIVATO', listino: 101, recupero: false };
    assert.strictEqual(esitoFascia(200, b, true).numero, 5);
    assert.strictEqual(esitoFascia(200, { ...b, recupero: true, soglia: 55, punti: 5 }, true).numero, 5);
    for (const n of ['5', 0, -1, 5.5, null]) assert.strictEqual(esitoFascia(200, { ...b, numero: n }, true).numero, null);
  });

  // ── eseguiConIndici con gli sconti ─────────────────────────────────────
  // Qricambi finto: scrivere la Vendita ricava lo sconto dal listino (2 decimali).
  function mkInput(value) { return { value: String(value), isConnected: true }; }
  function mkTd(valore, conInput) {
    const inp = conInput ? mkInput(valore) : null;
    return { textContent: String(valore), querySelector: (s) => (s === 'input' ? inp : null), inp };
  }
  function mkCodice(code) {
    const chip = { textContent: ` ${code} ` };
    return { textContent: `${code} content_copy`, chip, querySelector: (s) => (s === '.chip__content' ? chip : null) };
  }
  function mkTr(acq, lis, sc, code = '') {
    const td = [mkTd(acq, false), mkTd(lis, true), mkTd(sc, true), mkTd('0', true), mkTd('1', false), mkCodice(code)];
    const utile = { textContent: '-', style: {} };
    const classi = new Set(['ar-row-nosirj']); // colore rimasto dal giro prima
    return {
      td, utile, classi,
      querySelectorAll: (s) => (s === 'td' ? td : []),
      querySelector: (s) => (s === '.ar-utile-cell' ? utile : null),
      classList: { add: (...c) => c.forEach(x => classi.add(x)), remove: (...c) => c.forEach(x => classi.delete(x)) },
    };
  }
  const COL = { acquisto: 0, listino: 1, sconto: 2, vendita: 3, pezzi: 4, codice: 5 };
  function esegui(righe, sconti) {
    const scritture = [];
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0,
      TAG: '[test]', S: DEF, __s: scritture, __righe: righe,
    });
    vm.runInContext(
      'let lastSnapshot = { entries: [] };\n' +
      'async function setVueInput(input, value) { __s.push([input, String(value)]); input.value = String(value);\n' +
      '  for (const tr of __righe) if (tr.td[3].inp === input) {\n' +
      '    const l = parseFloat(tr.td[1].inp.value); tr.td[2].inp.value = String(Math.round((1 - parseFloat(value) / l) * 10000) / 100); }\n' +
      '  return true; }\n' +
      estrai('parseNum') + '\n' + estrai('leggiCella') + '\n' + estrai('inputDiCella') + '\n' + estrai('testoCodice') + '\n' +
      SRC.slice(calcStart, calcEnd) + '\n' + SRC.slice(cicloStart, cicloEnd) +
      '\nthis.run = (s) => eseguiConIndici({ querySelectorAll: () => __righe }, ' + JSON.stringify(COL) + ', null, null, s);', c);
    return c.run(sconti).then((res) => ({ res, scritture }));
  }

  await test('riga SIRJ decimale: vendita esatta, sconto non riscritto, riga ok e non gialla', async () => {
    const tr = mkTr('3.00', '8.74', '0', 'BP1234');
    const perRiga = new Map([[tr, { code: 'BP1234', riga: { fonte: 'famiglia', sconto: 27.8 } }]]);
    const { res, scritture } = await esegui([tr], { punti: 20, perRiga });
    assert.strictEqual(res.ok, 1, JSON.stringify(res.skipReasons));
    assert.strictEqual(tr.td[3].inp.value, '6.31');
    const sullo_sconto = scritture.filter(([i]) => i === tr.td[2].inp).length;
    assert.strictEqual(sullo_sconto, 1, 'sconto riscritto dopo la vendita');
    assert.strictEqual(res.dettagli[0].tipo, 'sirj');
    assert.ok(!tr.classi.has('ar-row-nosirj'), 'riga SIRJ colorata di giallo');
  });

  await test('riga senza voce (codice vuoto) e riga nessuna_regola: meno 20 e gialle', async () => {
    const a = mkTr('25.00', '100.00', '0');
    const b = mkTr('25.00', '100.00', '0', 'X9');
    const perRiga = new Map([[b, { code: 'X9', riga: { fonte: 'nessuna_regola' } }]]);
    const { res } = await esegui([a, b], { punti: 20, perRiga });
    assert.strictEqual(res.ok, 2, JSON.stringify(res.skipReasons));
    for (const tr of [a, b]) {
      assert.strictEqual(tr.td[2].inp.value, '35');
      assert.ok(tr.classi.has('ar-row-nosirj'));
    }
    assert.deepStrictEqual(plain(res.dettagli.map(d => d.tipo)), ['senzaRegola', 'senzaRegola']);
  });

  await test('senza sconti (cliente fuori flag): giallo tolto, regole di sempre', async () => {
    const tr = mkTr('25.00', '100.00', '0');
    const { res } = await esegui([tr], null);
    assert.strictEqual(res.ok, 1);
    assert.strictEqual(tr.td[2].inp.value, '55');
    assert.ok(!tr.classi.has('ar-row-nosirj'));
    assert.strictEqual(res.dettagli[0].tipo, null);
  });

  await test('listino 2,00 e sconto 27,8: Qricambi ricava 28, entro tolleranza (riga ok)', async () => {
    const tr = mkTr('1.00', '2.00', '0', 'GUARN');
    const perRiga = new Map([[tr, { code: 'GUARN', riga: { fonte: 'famiglia', sconto: 27.8 } }]]);
    const { res } = await esegui([tr], { punti: 20, perRiga });
    assert.strictEqual(tr.td[3].inp.value, '1.44');
    assert.strictEqual(tr.td[2].inp.value, '28');
    assert.strictEqual(res.ok, 1, JSON.stringify(res.skipReasons));
  });

  await test('sconto ricavato da Qricambi lontano da quello SIRJ: riga non confermata', async () => {
    const tr = mkTr('30.00', '100.00', '0', 'L1');
    const perRiga = new Map([[tr, { code: 'L1', riga: { fonte: 'famiglia', sconto: 30 } }]]);
    const p = esegui([tr], { punti: 20, perRiga });
    tr.td[1].inp.value = '90.00'; // Qricambi ricava lo sconto da 90: 22,22
    const { res } = await p;
    assert.strictEqual(res.ok, 0);
    assert.strictEqual(res.skipReasons.venditaNonConfermata, 1);
  });

  await test('riga cambiata dopo la lettura (codice diverso o riga nuova con codice): saltata, niente scritture', async () => {
    const cambiata = mkTr('25.00', '100.00', '0', 'NUOVO');
    const nuova = mkTr('25.00', '100.00', '0', 'Z1');
    const perRiga = new Map([[cambiata, { code: 'VECCHIO', riga: { fonte: 'famiglia', sconto: 30 } }]]);
    const { res, scritture } = await esegui([cambiata, nuova], { punti: 20, perRiga });
    assert.strictEqual(res.ok, 0);
    assert.strictEqual(res.skipReasons.scontoNonLetto, 2);
    assert.strictEqual(scritture.length, 0);
  });

  await test('tolleranzaSconto: 0,1 sui listini alti, 0,5/listino sui bassi', () => {
    assert.strictEqual(tolleranzaSconto(1000), 0.1);
    assert.ok(Math.abs(tolleranzaSconto(2) - 0.27) < 1e-9);
  });

  // ── leggiSconti: blocchi da 60, primo errore ferma tutto ───────────────
  function mkLeggi(rispondi) {
    const chiamate = [];
    const c = vm.createContext({
      URL, AbortController, setTimeout, clearTimeout, console: { log() {}, warn() {} },
      TAG: '[test]', chrome: { runtime: { getManifest: () => ({ version: '9.9.9' }) } },
      S: { backendUrl: 'http://100.86.223.69:5008/api/quote-import', apiKey: 'k' },
      fetch: async (url, opt) => {
        const body = JSON.parse(opt.body);
        chiamate.push({ url, headers: opt.headers, body });
        const r = await rispondi(body, chiamate.length);
        if (r === 'rete') throw new Error('rete');
        return { status: r[0], json: async () => { if (r[1] === undefined) throw new Error('no json'); return r[1]; } };
      },
    });
    vm.runInContext(SRC.slice(calcStart, calcEnd) + '\n' + estrai('versioneEstensione') + '\n' +
      SRC.slice(SRC.indexOf('const SCONTI_TIMEOUT_MS'), SRC.indexOf('function toastFascia')) +
      '\nthis.leggi = leggiSconti;', c);
    return { leggi: c.leggi, chiamate };
  }
  const righe = (n) => Array.from({ length: n }, (_, i) => ({ code: `C${i}`, manufacturer: 'BOSCH' }));
  const attivo = (body) => [200, { attivo: true, numero: body.numero, punti_senza_regola: 20,
    righe: body.righe.map(r => ({ ...r, fonte: 'famiglia', sconto: 30 })) }];

  await test('leggiSconti: 130 righe in 3 blocchi, ordine conservato, body e header', async () => {
    const { leggi, chiamate } = mkLeggi(attivo);
    const e = await leggi(5, righe(130));
    assert.strictEqual(e.stato, 'attivo');
    assert.strictEqual(e.punti, 20);
    assert.deepStrictEqual(chiamate.map(x => x.body.righe.length), [60, 60, 10]);
    assert.deepStrictEqual(plain(e.righe.map(r => r.code)), righe(130).map(r => r.code));
    assert.strictEqual(chiamate[0].url, 'http://100.86.223.69:5008/api/quote-import/sconti-cliente');
    assert.strictEqual(chiamate[0].headers['X-API-Key'], 'k');
    assert.strictEqual(chiamate[0].body.numero, 5);
    assert.strictEqual(chiamate[0].body.ext_version, '9.9.9');
  });

  await test('leggiSconti: errore al secondo blocco ferma tutto e torna l\'errore', async () => {
    const { leggi, chiamate } = mkLeggi((b, n) => (n === 2 ? [503, { error: 'SIRJ' }] : attivo(b)));
    const e = await leggi(5, righe(130));
    assert.strictEqual(e.stato, 'errore');
    assert.ok(/503/.test(e.motivo));
    assert.strictEqual(chiamate.length, 2);
  });

  await test('leggiSconti: flag spenta al secondo blocco dopo un blocco attivo = errore', async () => {
    const { leggi } = mkLeggi((b, n) => (n === 2 ? [200, { attivo: false }] : attivo(b)));
    const e = await leggi(5, righe(70));
    assert.strictEqual(e.stato, 'errore');
    assert.ok(/cambiata/.test(e.motivo));
  });

  await test('leggiSconti: rete giù, corpo non JSON, flag spenta', async () => {
    assert.strictEqual((await mkLeggi(() => 'rete').leggi(5, righe(3))).stato, 'errore');
    assert.strictEqual((await mkLeggi(() => [502, undefined]).leggi(5, righe(3))).stato, 'errore');
    assert.strictEqual((await mkLeggi(() => [200, { attivo: false }]).leggi(5, righe(3))).stato, 'spento');
  });

  // ── cablaggio ──────────────────────────────────────────────────────────
  await test('errore sugli sconti: esegui ritorna prima di eseguiConIndici, toast senza prezzi', () => {
    const corpo = SRC.slice(SRC.indexOf('async function esegui('), SRC.indexOf('function righeDaPrezzare'));
    const iErr = corpo.indexOf("sconti.stato === 'errore'");
    const iCiclo = corpo.indexOf('eseguiConIndici(');
    assert.ok(iErr > 0 && iCiclo > iErr, 'controllo dell\'errore dopo il ciclo di scrittura');
    assert.ok(/Nessun prezzo scritto/.test(SRC));
    assert.ok(/S\.scontoSirjCliente !== false/.test(corpo), 'interruttore scontoSirjCliente non letto in esegui');
    assert.ok(/codici delle righe non letti/.test(corpo), 'righe senza nessun codice non trattate come errore');
    assert.ok(/ar-row-nosirj/.test(SRC.slice(SRC.indexOf('async function annullaPricing'))), 'ANNULLA non toglie il giallo');
  });

  console.log(failed ? `\n${failed} test falliti` : '\ntutti i test passano');
  process.exit(failed ? 1 : 0);
})();
