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
function makeSandbox({ onPricing, onImport }) {
  const clock = makeClock();
  const listeners = new Set();
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
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
  };
  class MutationObserver { observe() {} }
  const win = { __AR_QRICAMBI: { onPricing, onImport } };
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
  return { win, clock, alerts, writePatch, listenerCount: () => listeners.size };
}

const GOOD = () => ({ tot: 3, ok: 3, skip: 0,
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

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok   -', name); }
    catch (e) { failed++; console.log('FAIL -', name, '\n      ', e.message); }
  }
  console.log(`\n${cases.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
