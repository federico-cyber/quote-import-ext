/* Test di injected.js (hook fetch/XHR) — arauto#1990.
 *
 * Invariante sotto test: il payload di una PATCH /api/Quote viene pubblicato
 * via postMessage (→ chrome.storage.local.lastPatchPayload → import in SIRJ)
 * SOLO dopo che Qricambi ha CONFERMATO il salvataggio con una risposta positiva.
 * Se la PATCH fallisce, o non e' ancora tornata, niente postMessage: l'utente
 * non deve poter importare in SIRJ un preventivo mai salvato su Qricambi.
 *
 * Stesso stile di arauto/clienti-portal/tests/test_ocr_extract_plate.js:
 * node puro, zero dipendenze, exit code 1 se qualcosa fallisce.
 *   node tests/test_injected_confirm.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'injected.js'), 'utf8');

const PAYLOAD = {
  ID: 4711,
  items: [
    { code: 'MOT.X-CLEAN+', manufacturer: 'ACME', description: 'Filtro', num: 2, price: 12.5 },
  ],
  customerdata: { CustomerName: 'Mario Rossi', CustomerCode: 'C123' },
  car: 'Fiat Panda',
  lplatevin: ['AB123CD'],
  total: 25,
};

// ── Sandbox minimale: window con fetch + XMLHttpRequest fittizi ──────────
function makeSandbox({ fetchImpl }) {
  const messages = [];
  const xhrs = [];

  class FakeXHR {
    constructor() {
      this._listeners = {};
      this.status = 0;
      this.method = null;
      this.url = null;
      this.body = null;
      xhrs.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.body = body; }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    // helper di test: simula la risposta del server
    _respond(status) {
      this.status = status;
      for (const fn of this._listeners['load'] || []) fn.call(this, {});
    }
  }

  const win = {
    fetch: fetchImpl,
    XMLHttpRequest: FakeXHR,
    postMessage: (msg) => messages.push(msg),
  };
  const cons = { log: () => {}, error: () => {} };

  // eslint-disable-next-line no-new-func
  new Function('window', 'console', SCRIPT)(win, cons);

  return { win, messages, xhrs };
}

const PATCH_URL = 'https://app.qricambi.com/api/Quote';
const PATCH_INIT = () => ({ method: 'PATCH', body: JSON.stringify(PAYLOAD) });

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// ── A. fetch: PATCH rifiutata dal server → NIENTE postMessage ────────────
test('fetch: PATCH con risposta 500 non pubblica il payload', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(messages.length, 0,
    'payload pubblicato nonostante la PATCH sia fallita (500)');
});

test('fetch: PATCH con risposta 422 non pubblica il payload', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => ({ ok: false, status: 422 }),
  });
  await win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(messages.length, 0,
    'payload pubblicato nonostante la PATCH sia stata rifiutata (422)');
});

test('fetch: PATCH che va in errore di rete non pubblica il payload', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => { throw new Error('network down'); },
  });
  await assert.rejects(() => win.fetch(PATCH_URL, PATCH_INIT()), /network down/);
  assert.strictEqual(messages.length, 0,
    'payload pubblicato nonostante la fetch sia andata in errore di rete');
});

// ── B. Ordering: niente pubblicazione prima che il server risponda ───────
test('fetch: nessuna pubblicazione finche il server non ha risposto', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200 });
  });
  const { win, messages } = makeSandbox({ fetchImpl: () => pending });

  const p = win.fetch(PATCH_URL, PATCH_INIT());
  await Promise.resolve(); // lascia girare eventuali microtask
  assert.strictEqual(messages.length, 0,
    'payload pubblicato all-atto della send, prima che Qricambi confermasse');

  release();
  await p;
  assert.strictEqual(messages.length, 1,
    'payload non pubblicato dopo la conferma positiva del server');
});

// ── C. Happy path: contenuto del messaggio invariato ─────────────────────
test('fetch: PATCH 200 pubblica il payload identico a quello inviato', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const res = await win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(res.status, 200,
    'la Response originale deve essere restituita invariata');
  assert.strictEqual(messages.length, 1, 'payload non pubblicato dopo conferma 200');
  assert.strictEqual(messages[0].source, 'AR_QUOTE_IMPORT');
  assert.deepStrictEqual(messages[0].payload, PAYLOAD,
    'il payload pubblicato non e piu identico a quello inviato a Qricambi');
});

test('fetch: una GET su /api/Quote non pubblica nulla', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  await win.fetch(PATCH_URL, { method: 'GET' });
  assert.strictEqual(messages.length, 0, 'una GET non deve pubblicare nulla');
});

// ── D. XHR: stesso invariante ────────────────────────────────────────────
test('xhr: PATCH con status 500 non pubblica il payload', async () => {
  const { win, messages, xhrs } = makeSandbox({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const x = new win.XMLHttpRequest();
  x.open('PATCH', PATCH_URL);
  x.send(JSON.stringify(PAYLOAD));
  assert.strictEqual(messages.length, 0,
    'payload pubblicato all-atto della xhr.send, prima della risposta del server');
  xhrs[0]._respond(500);
  assert.strictEqual(messages.length, 0,
    'payload pubblicato nonostante la PATCH XHR sia fallita (500)');
});

test('xhr: PATCH con status 200 pubblica il payload identico', async () => {
  const { win, messages, xhrs } = makeSandbox({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const x = new win.XMLHttpRequest();
  x.open('PATCH', PATCH_URL);
  x.send(JSON.stringify(PAYLOAD));
  assert.strictEqual(messages.length, 0, 'pubblicato prima della risposta');
  xhrs[0]._respond(200);
  assert.strictEqual(messages.length, 1, 'payload non pubblicato dopo conferma 200');
  assert.deepStrictEqual(messages[0].payload, PAYLOAD);
});

test('xhr: PATCH mai risposta (abort/rete) non pubblica il payload', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const x = new win.XMLHttpRequest();
  x.open('PATCH', PATCH_URL);
  x.send(JSON.stringify(PAYLOAD));
  // nessun evento 'load': la richiesta non e mai stata confermata
  assert.strictEqual(messages.length, 0,
    'payload pubblicato per una PATCH XHR mai confermata dal server');
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log(`ok    ${name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${name}\n      ${e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
