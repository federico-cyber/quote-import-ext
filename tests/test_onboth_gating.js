/* Test di fab.js onBoth (Pricing + Import) — issue #31.
 *
 * Invarianti sotto test (scelta di Fede «Fermati su errori»):
 *  - onBoth NON chiama onImport se il pricing non e' andato a buon fine:
 *    esito assente, errore, tot=0, ok=0, oppure anche UNA SOLA riga saltata o
 *    fallita (skip / skipReasons.*: noAcquisto, noScontoInp, rollbackB, setFailed);
 *  - niente attesa fissa: l'import parte solo dopo una VERA scrittura di
 *    chrome.storage.local.lastPatchPayload (listener chrome.storage.onChanged,
 *    registrato prima del pricing) e dopo una breve finestra di quiete;
 *  - nessuna scrittura entro il timeout (PATCH rifiutata/mai partita) -> niente
 *    import e un avviso chiaro all'utente.
 *
 * Stile di tests/test_injected_confirm.js: node puro, zero dipendenze,
 * exit code 1 se qualcosa fallisce.
 *   node tests/test_onboth_gating.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const FAB = fs.readFileSync(path.join(ROOT, 'fab.js'), 'utf8');
const DEFAULTS_SRC = fs.readFileSync(path.join(ROOT, 'defaults.js'), 'utf8');
// defaults.js dichiara `const DEFAULTS`: lo valutiamo cosi' com'e' (valori reali).
// eslint-disable-next-line no-new-func
const DEFAULTS = new Function(DEFAULTS_SRC + '\nreturn DEFAULTS;')();

const flush = () => new Promise((r) => setImmediate(r));

// ── Timer finti: il tempo avanza solo quando lo decide il test ───────────
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn, id }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.values()].filter((t) => t.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id);
        now = due.at;
        due.fn();
      }
      now = target;
      await flush();
    },
    pending() { return timers.size; },
  };
}

// ── Sandbox: DOM minimo + chrome.storage.onChanged finto ─────────────────
function makeSandbox({ onPricing, onImport, storage = {} }) {
  const clock = makeClock();
  const listeners = new Set();
  const msgListeners = new Set();
  const alerts = [];

  const el = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelector: () => el(), appendChild() {},
    set innerHTML(v) {}, set textContent(v) {}, disabled: false,
  });
  const document = {
    createElement: () => el(),
    getElementById: () => null,
    addEventListener() {},
    body: el(), head: el(), readyState: 'complete',
  };
  const chrome = {
    storage: {
      // get(defaults, cb): chiavi di `storage` (interruttori dalle Opzioni) sopra i default
      local: { get: (defs, cb) => cb({ ...defs, ...storage }) },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
  };
  class MutationObserver { observe() {} }
  const win = {
    __AR_QRICAMBI: { onPricing, onImport },
    addEventListener: (t, fn) => { if (t === 'message') msgListeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') msgListeners.delete(fn); },
  };
  const cons = { log() {}, warn() {}, error() {} };

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'chrome', 'DEFAULTS', 'console', 'location',
    'MutationObserver', 'setTimeout', 'clearTimeout', 'alert', FAB)(
    win, document, chrome, DEFAULTS, cons, { href: 'https://app.qricambi.com/q/1' },
    MutationObserver, clock.setTimeout, clock.clearTimeout, (m) => alerts.push(m));

  // Simula la scrittura di lastPatchPayload fatta da import.content.js.
  const writePatch = (key = 'lastPatchPayload', area = 'local') => {
    for (const fn of [...listeners]) fn({ [key]: { newValue: { ID: 1, items: [] } } }, area);
  };
  // Simula un postMessage di injected.js (MAIN): AR_QUOTE_SAVES con valori assoluti.
  const saves = (inflight, sentSeq, confirmedSeq) => {
    const data = { source: 'AR_QUOTE_SAVES', inflight, sentSeq, confirmedSeq };
    for (const fn of [...msgListeners]) fn({ source: win, data });
  };
  return { win, clock, alerts, writePatch, saves,
           listenerCount: () => listeners.size, msgListenerCount: () => msgListeners.size };
}

const GOOD = () => ({ tot: 3, ok: 3, skip: 0, cambiate: 3,
  skipReasons: { noAcquisto: 0, noScontoInp: 0, rollbackB: 0, setFailed: 0 }, dettagli: [],
  fascia: { stato: 'normale', righeRecupero: 0 } });

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// Esegue onBoth con un pricing che ritorna `res` e lascia scorrere abbondante
// tempo (dopo ogni eventuale scrittura): serve a provare che NON si importa.
async function runBlocked(res) {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => res,
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.writePatch(); // anche con una scrittura confermata: il pricing e' fallito
  await s.clock.advance(DEFAULTS.bothWaitMs + 5000);
  await p;
  return { imports, alerts: s.alerts };
}

// ── 1-4. Pricing fallito / parziale -> NIENTE import ─────────────────────
test('onBoth non importa se onPricing ritorna {ok:0, tot:3}', async () => {
  const r = await runBlocked({ ok: 0, tot: 3, skip: 3, skipReasons: { setFailed: 3 }, dettagli: [] });
  assert.strictEqual(r.imports, 0, 'onImport chiamato con 0 righe aggiornate');
  assert.ok(r.alerts.length >= 1, "nessun avviso all'utente");
});

test('onBoth non importa se onPricing ritorna tot:0 (nessuna riga)', async () => {
  const r = await runBlocked({ ok: 0, tot: 0, skip: 0, skipReasons: {}, dettagli: [] });
  assert.strictEqual(r.imports, 0, 'onImport chiamato senza righe');
});

test('onBoth non importa se onPricing lancia', async () => {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => { throw new Error('boom'); },
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush(); s.writePatch();
  await s.clock.advance(DEFAULTS.bothWaitMs + 5000);
  await p;
  assert.strictEqual(imports, 0, 'onImport chiamato dopo un errore del pricing');
});

test('onBoth non importa se onPricing ritorna un esito di errore', async () => {
  const r = await runBlocked({ ok: 0, tot: 0, skip: 0, skipReasons: {}, dettagli: [], error: 'x' });
  assert.strictEqual(r.imports, 0);
});

test('onBoth non importa se onPricing non ritorna alcun esito (fail-safe)', async () => {
  const r = await runBlocked(undefined);
  assert.strictEqual(r.imports, 0, 'esito assente trattato come successo');
});

for (const reason of ['rollbackB', 'setFailed', 'noAcquisto', 'noScontoInp']) {
  test(`onBoth non importa se anche una sola riga e' saltata (${reason}=1, ok>0)`, async () => {
    const res = GOOD();
    res.ok = 2; res.tot = 3; res.skipReasons[reason] = 1; // skip omesso: conta skipReasons
    delete res.skip;
    const r = await runBlocked(res);
    assert.strictEqual(r.imports, 0, `onImport chiamato con riga saltata (${reason})`);
    assert.ok(r.alerts.length >= 1, "nessun avviso all'utente");
  });
}

test('onBoth non importa se skip>0 (ok>0)', async () => {
  const res = GOOD(); res.ok = 2; res.skip = 1;
  const r = await runBlocked(res);
  assert.strictEqual(r.imports, 0);
});

// ── 5. Successo: import solo dopo la vera scrittura, niente attesa fissa ──
// arauto#4911: fascia del cliente non verificata = niente import automatico.
for (const [nome, fascia] of [
  ['errore (server giu\')', { stato: 'errore', motivo: 'server non raggiungibile' }],
  ['sconosciuto (cliente non noto)', { stato: 'sconosciuto', motivo: 'cliente non riconosciuto in SIRJ' }],
  ['assente', undefined],
  ['stato inatteso', { stato: 'boh' }],
]) {
  test(`onBoth non importa se la fascia e' ${nome}`, async () => {
    const r = await runBlocked({ ...GOOD(), fascia });
    assert.strictEqual(r.imports, 0);
    assert.strictEqual(r.alerts.length, 1);
    assert.ok(/fascia sconto del cliente non verificata/.test(r.alerts[0]), r.alerts[0]);
    if (fascia && fascia.motivo) assert.ok(r.alerts[0].includes(fascia.motivo), r.alerts[0]);
  });
}

for (const stato of ['recupero', 'normale', 'spento']) {
  test(`onBoth importa con fascia '${stato}'`, async () => {
    let imports = 0;
    const s = makeSandbox({
      onPricing: async () => ({ ...GOOD(), fascia: { stato, righeRecupero: 1 } }),
      onImport: async () => { imports++; },
    });
    const p = s.win.__AR_QRICAMBI.onBoth();
    await flush();
    s.writePatch();
    await s.clock.advance(DEFAULTS.bothWaitMs + 5000);
    await p;
    assert.strictEqual(imports, 1);
    assert.strictEqual(s.alerts.length, 0);
  });
}

test('onBoth con ok>0 e nessuno skip importa UNA volta, solo dopo la scrittura (PATCH lenta 3000 ms)', async () => {
  let imports = 0;
  const s = makeSandbox({ onPricing: async () => GOOD(), onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();

  await s.clock.advance(1800);
  assert.strictEqual(imports, 0, 'import dopo 1800 ms senza alcuna scrittura: attesa fissa ancora presente');
  await s.clock.advance(1200); // t=3000
  assert.strictEqual(imports, 0, 'import prima della scrittura di lastPatchPayload');

  s.writePatch(); // la PATCH lenta e' stata confermata e salvata
  await s.clock.advance(DEFAULTS.bothSettleMs - 1);
  assert.strictEqual(imports, 0, 'import prima della finestra di quiete');
  await s.clock.advance(1);
  await p;
  assert.strictEqual(imports, 1, 'onImport non chiamato (o chiamato piu di una volta) dopo la scrittura');
  assert.strictEqual(s.listenerCount(), 0, 'listener onChanged non rimosso');
});

test("onBoth: scrittura avvenuta DURANTE il pricing (PATCH veloce) non va persa", async () => {
  let imports = 0, s;
  s = makeSandbox({
    onPricing: async () => { s.writePatch(); return GOOD(); },
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await s.clock.advance(DEFAULTS.bothSettleMs);
  await p;
  assert.strictEqual(imports, 1, 'scrittura arrivata durante il pricing ignorata');
});

test('onBoth: PATCH multiple ravvicinate -> importa dopo l\'ULTIMA (finestra di quiete)', async () => {
  let imports = 0;
  const s = makeSandbox({ onPricing: async () => GOOD(), onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.writePatch();
  await s.clock.advance(DEFAULTS.bothSettleMs - 100);
  s.writePatch(); // seconda PATCH prima che la quiete scada: riparte la finestra
  await s.clock.advance(DEFAULTS.bothSettleMs - 100);
  assert.strictEqual(imports, 0, 'import prima della quiete dopo la seconda PATCH');
  await s.clock.advance(100);
  await p;
  assert.strictEqual(imports, 1);
});

test('onBoth ignora storage.onChanged di altre chiavi o di altre aree', async () => {
  let imports = 0;
  const s = makeSandbox({ onPricing: async () => GOOD(), onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.writePatch('importHistory');
  s.writePatch('lastPatchPayload', 'sync');
  await s.clock.advance(DEFAULTS.bothWaitMs + 5000);
  await p;
  assert.strictEqual(imports, 0, 'import scattato da una scrittura non pertinente');
});

// ── 6. Timeout: nessuna scrittura -> niente import + errore chiaro ───────
test('onBoth senza scrittura entro il timeout non importa e avvisa', async () => {
  let imports = 0;
  const s = makeSandbox({ onPricing: async () => GOOD(), onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  await s.clock.advance(DEFAULTS.bothWaitMs - 1);
  assert.strictEqual(s.alerts.length, 0, 'avviso prima del timeout');
  await s.clock.advance(1);
  await p;
  assert.strictEqual(imports, 0, 'onImport chiamato senza alcuna scrittura confermata');
  assert.ok(s.alerts.length >= 1, 'nessun avviso al timeout');
  assert.strictEqual(s.listenerCount(), 0, 'listener onChanged non rimosso al timeout');
  assert.strictEqual(s.clock.pending(), 0, 'timer residui dopo il timeout');
});

// ── 7. Nessuna modifica (#46): avviso SUBITO, niente import ───────────────
// Preventivo gia' prezzato: il pricing non cambia nessuna riga, Qricambi non manda
// PATCH. `cambiate` (righe davvero cambiate) = 0 -> messaggio subito, non dopo
// bothWaitMs, e nessun import anche se in storage c'e' un lastPatchPayload.
test('#46 onBoth con cambiate=0: avviso subito (senza attendere bothWaitMs) e niente import', async () => {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => ({ ...GOOD(), cambiate: 0 }),
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush(); // nessun avanzamento del tempo: l'avviso deve essere gia' qui
  assert.strictEqual(s.alerts.length, 1, 'avviso assente (o in attesa del timeout)');
  await p;
  assert.strictEqual(imports, 0, 'import eseguito con zero righe cambiate');
  assert.ok(/nessuna modifica/i.test(s.alerts[0]), s.alerts[0]);
  assert.ok(/Importa in SIRJ/.test(s.alerts[0]), s.alerts[0]);
  assert.ok(!/non ha confermato il salvataggio/.test(s.alerts[0]), 'messaggio del timeout');
  assert.strictEqual(s.listenerCount(), 0, 'listener onChanged non rimosso');
  assert.strictEqual(s.clock.pending(), 0, 'timer residui');
});

test('#46 cambiate=0: nemmeno con un lastPatchPayload scritto prima si importa', async () => {
  let imports = 0, s;
  s = makeSandbox({
    onPricing: async () => { s.writePatch(); return { ...GOOD(), cambiate: 0 }; },
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await s.clock.advance(DEFAULTS.bothWaitMs + 5000);
  await p;
  assert.strictEqual(imports, 0);
  assert.strictEqual(s.alerts.length, 1);
});

test('#46 cambiate>0 senza PATCH: nessun avviso "nessuna modifica", resta l\'attesa del salvataggio', async () => {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => ({ ...GOOD(), cambiate: 1 }),
    onImport: async () => { imports++; },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  assert.strictEqual(s.alerts.length, 0, 'avviso prematuro con righe cambiate');
  await s.clock.advance(DEFAULTS.bothWaitMs);
  await p;
  assert.strictEqual(imports, 0);
  assert.ok(/non ha confermato il salvataggio/.test(s.alerts[0]), s.alerts[0]);
});

test('#46 conteggio assente (esito vecchio): non si deduce "niente cambiato", si attende come prima', async () => {
  let imports = 0;
  const res = GOOD(); delete res.cambiate;
  const s = makeSandbox({ onPricing: async () => res, onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.writePatch();
  await s.clock.advance(DEFAULTS.bothSettleMs);
  await p;
  assert.strictEqual(imports, 1);
  assert.strictEqual(s.alerts.length, 0);
});

// ── 8. Salvataggi in volo (#47, interruttore importAttendeInVolo) ──────────
// Scenario del bug: PATCH1 confermata e scritta, PATCH2 inviata subito dopo ma lenta.
// La quiete di 600 ms dalla scrittura di PATCH1 scade con PATCH2 ancora in volo:
// senza il conteggio si importa con prezzi misti.
async function scenarioPatchLenta(opts) {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => GOOD(), onImport: async () => { imports++; }, ...opts,
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.saves(1, 100, 0);          // PATCH1 inviata
  s.saves(0, 100, 100);        // PATCH1 confermata...
  s.writePatch();              // ...e scritta in storage
  s.saves(1, 200, 100);        // PATCH2 inviata subito dopo (lenta)
  return { s, p, imports: () => imports };
}

test('#47 con PATCH2 in volo la quiete di 600 ms NON basta: nessun import', async () => {
  const { s, p, imports } = await scenarioPatchLenta();
  await s.clock.advance(DEFAULTS.bothSettleMs + 3000); // PATCH2 lenta: 3,6 s
  assert.strictEqual(imports(), 0, 'import con un salvataggio ancora in volo (prezzi misti)');
  s.saves(0, 200, 200);        // PATCH2 confermata
  s.writePatch();
  await s.clock.advance(DEFAULTS.bothSettleMs - 1);
  assert.strictEqual(imports(), 0, 'import prima della quiete a zero in volo');
  await s.clock.advance(1);
  await p;
  assert.strictEqual(imports(), 1, 'import non partito a zero in volo');
  assert.strictEqual(s.alerts.length, 0);
  assert.strictEqual(s.listenerCount(), 0);
  assert.strictEqual(s.msgListenerCount(), 0, 'listener message non rimosso');
  assert.strictEqual(s.clock.pending(), 0);
});

test('#47 in volo che non scende mai: allo scadere di bothWaitMs alert e MAI import', async () => {
  const { s, p, imports } = await scenarioPatchLenta();
  await s.clock.advance(DEFAULTS.bothWaitMs - 1);
  assert.strictEqual(s.alerts.length, 0, 'avviso prima del timeout');
  await s.clock.advance(1);
  await p;
  assert.strictEqual(imports(), 0, 'import allo scadere con un salvataggio in volo');
  assert.strictEqual(s.alerts.length, 1);
  assert.ok(/ancora salvando/.test(s.alerts[0]), s.alerts[0]);
  assert.strictEqual(s.clock.pending(), 0);
  assert.strictEqual(s.msgListenerCount(), 0);
});

test('#47 PATCH2 rifiutata (ultima inviata non confermata): niente import, avviso chiaro', async () => {
  const { s, p, imports } = await scenarioPatchLenta();
  s.saves(0, 200, 100);        // PATCH2 conclusa con errore: confermata resta la 1
  await s.clock.advance(DEFAULTS.bothSettleMs);
  await p;
  assert.strictEqual(imports(), 0, 'import con ultimo salvataggio rifiutato');
  assert.strictEqual(s.alerts.length, 1);
  assert.ok(/rifiutato/.test(s.alerts[0]), s.alerts[0]);
});

test('#47 un nuovo salvataggio durante la quiete la azzera (nessun import anticipato)', async () => {
  let imports = 0;
  const s = makeSandbox({ onPricing: async () => GOOD(), onImport: async () => { imports++; } });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.saves(0, 100, 100); s.writePatch();
  await s.clock.advance(DEFAULTS.bothSettleMs - 100);
  s.saves(1, 200, 100);                    // parte PATCH2 a 500 ms dalla quiete
  await s.clock.advance(1000);
  assert.strictEqual(imports, 0);
  s.saves(0, 200, 200); s.writePatch();
  await s.clock.advance(DEFAULTS.bothSettleMs);
  await p;
  assert.strictEqual(imports, 1);
});

test('#47 interruttore SPENTO: comportamento di prima (quiete dalla scrittura, anche con PATCH in volo), nessun listener message', async () => {
  const { s, p, imports } = await scenarioPatchLenta({ storage: { importAttendeInVolo: false } });
  assert.strictEqual(s.msgListenerCount(), 0, 'listener message registrato a interruttore spento');
  await s.clock.advance(DEFAULTS.bothSettleMs);
  await p;
  assert.strictEqual(imports(), 1, 'a interruttore spento deve valere la sola quiete di prima');
  assert.strictEqual(s.alerts.length, 0);
});

test('#47 interruttore SPENTO: al timeout vale la scrittura gia vista (come prima)', async () => {
  let imports = 0;
  const s = makeSandbox({
    onPricing: async () => GOOD(), onImport: async () => { imports++; },
    storage: { importAttendeInVolo: false },
  });
  const p = s.win.__AR_QRICAMBI.onBoth();
  await flush();
  s.writePatch();
  s.saves(1, 100, 0); // un salvataggio in volo non si vede, a interruttore spento
  // quiete sempre rinnovata (scritture ogni 500 ms) fino al timeout: si arriva a bothWaitMs
  for (let t = 0; t < DEFAULTS.bothWaitMs; t += 500) { s.writePatch(); await s.clock.advance(500); }
  await p;
  assert.strictEqual(imports, 1, 'al timeout a interruttore spento deve valere la scrittura vista');
});

test('#47 default: importAttendeInVolo e quoteOpenSoloOk sono true in defaults.js', async () => {
  assert.strictEqual(DEFAULTS.importAttendeInVolo, true);
  assert.strictEqual(DEFAULTS.quoteOpenSoloOk, true);
});

(async () => {
  let failed = 0;
  let finished = false;
  // Una promise mai risolta (attesa che nessun timer finto sblocca) farebbe uscire
  // node con codice 0 senza riepilogo: lo si segnala come fallimento.
  process.on('exit', () => {
    if (!finished) { console.log('FAIL - run interrotto: un test e rimasto in attesa'); process.exitCode = 1; }
  });
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok   -', name); }
    catch (e) { failed++; console.log('FAIL -', name, '\n      ', e.message); }
  }
  finished = true;
  console.log(`\n${cases.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
