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
// `messages` = i messaggi di dati (payload, cliente, preventivo aperto); i segnali
// di controllo AR_QUOTE_SAVES (#47) e AR_QUOTE_OPEN_INTENT (#49) stanno in `all`.
const CONTROLLO = new Set(['AR_QUOTE_SAVES', 'AR_QUOTE_OPEN_INTENT']);
function makeSandbox({ fetchImpl }) {
  const all = [];
  const messages = [];
  const xhrs = [];
  const ctl = { sendThrows: false }; // test: send() che lancia in modo sincrono

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
    send(body) { if (ctl.sendThrows) throw new Error('InvalidStateError'); this.body = body; }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    // helper di test: simula la risposta del server
    _respond(status) {
      this.status = status;
      for (const fn of this._listeners['load'] || []) fn.call(this, {});
      this._emit('loadend');
    }
    // helper di test: evento terminale senza risposta (abort / error / timeout)
    _emit(type) {
      for (const fn of this._listeners[type] || []) fn.call(this, {});
    }
  }

  const win = {
    fetch: fetchImpl,
    XMLHttpRequest: FakeXHR,
    postMessage: (msg) => {
      all.push(msg);
      if (!CONTROLLO.has(msg.source)) messages.push(msg);
    },
  };
  const cons = { log: () => {}, error: () => {} };

  // eslint-disable-next-line no-new-func
  new Function('window', 'console', SCRIPT)(win, cons);

  return { win, messages, all, xhrs, ctl };
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

// ── E. Cliente del preventivo aperto (arauto#4911) ───────────────────────
const FIND_URL = 'https://app.qricambi.com/api/Quote/find/365954';
const CLIENTE = { CustomerName: 'AUTOFFICINA GIMA SNC', CustomerCode: '158' };
const customerMsgs = (messages) => messages.filter((m) => m.source === 'AR_QUOTE_CUSTOMER');
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeResponse(ok, body) {
  return { ok, status: ok ? 200 : 500,
           clone() { return { json: async () => body }; } };
}

test('fetch: GET find/<id> pubblica il customerdata del preventivo', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => fakeResponse(true, { ID: 365954, customerdata: CLIENTE }),
  });
  await win.fetch(FIND_URL);
  await flush();
  const m = customerMsgs(messages);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, '365954');
  assert.deepStrictEqual(m[0].customerdata, CLIENTE);
  assert.ok(messages.some((x) => x.source === 'AR_QUOTE_OPEN'), 'AR_QUOTE_OPEN sparito');
});

test('fetch: customerdata un livello sotto (data) viene trovato', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => fakeResponse(true, { data: { customerData: CLIENTE } }),
  });
  await win.fetch(FIND_URL);
  await flush();
  assert.deepStrictEqual(customerMsgs(messages)[0].customerdata, CLIENTE);
});

test('fetch: risposta senza customerdata → customerdata null', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => fakeResponse(true, { ID: 1, items: [] }),
  });
  await win.fetch(FIND_URL);
  await flush();
  const m = customerMsgs(messages);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].customerdata, null);
});

test('fetch: find/<id> in errore non pubblica il cliente', async () => {
  const { win, messages } = makeSandbox({
    fetchImpl: async () => fakeResponse(false, { customerdata: CLIENTE }),
  });
  await win.fetch(FIND_URL);
  await flush();
  assert.strictEqual(customerMsgs(messages).length, 0);
});

test('fetch: la Response restituita alla pagina è quella originale', async () => {
  const r = fakeResponse(true, { customerdata: CLIENTE });
  const { win } = makeSandbox({ fetchImpl: async () => r });
  assert.strictEqual(await win.fetch(FIND_URL), r);
});

test('xhr: GET find/<id> 200 (testo) pubblica il customerdata', async () => {
  const { win, messages, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const x = new win.XMLHttpRequest();
  x.open('GET', FIND_URL);
  x.send();
  x.responseType = '';
  x.responseText = JSON.stringify({ customerdata: CLIENTE });
  xhrs[0]._respond(200);
  assert.deepStrictEqual(customerMsgs(messages)[0].customerdata, CLIENTE);
});

test('xhr: GET find/<id> 200 (json) pubblica il customerdata', async () => {
  const { win, messages, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const x = new win.XMLHttpRequest();
  x.open('GET', FIND_URL);
  x.send();
  x.responseType = 'json';
  x.response = { customerdata: CLIENTE };
  xhrs[0]._respond(200);
  assert.deepStrictEqual(customerMsgs(messages)[0].customerdata, CLIENTE);
});

test('xhr: GET find/<id> 404 o testo non JSON non pubblica il cliente', async () => {
  const { win, messages, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const a = new win.XMLHttpRequest();
  a.open('GET', FIND_URL); a.send();
  a.responseText = JSON.stringify({ customerdata: CLIENTE });
  xhrs[0]._respond(404);
  const b = new win.XMLHttpRequest();
  b.open('GET', FIND_URL); b.send();
  b.responseText = '<html>';
  xhrs[1]._respond(200);
  assert.strictEqual(customerMsgs(messages).length, 0);
});

// ── F. Preventivo aperto: AR_QUOTE_OPEN solo su risposta 2xx (#49) ───────
// All'invio parte solo AR_QUOTE_OPEN_INTENT (il segnale di prima, che
// import.content.js usa a interruttore `quoteOpenSoloOk` spento).
const openMsgs = (m) => m.filter((x) => x.source === 'AR_QUOTE_OPEN');
const intentMsgs = (m) => m.filter((x) => x.source === 'AR_QUOTE_OPEN_INTENT');

test('#49 fetch: find/<id> 200 pubblica AR_QUOTE_OPEN con l\'id', async () => {
  const { win, all } = makeSandbox({
    fetchImpl: async () => fakeResponse(true, { ID: 365954, customerdata: CLIENTE }),
  });
  await win.fetch(FIND_URL);
  await flush();
  assert.deepStrictEqual(openMsgs(all).map((m) => m.id), ['365954']);
});

for (const status of [404, 500, 503]) {
  test(`#49 fetch: find/<id> ${status} NON pubblica AR_QUOTE_OPEN (solo l'intento)`, async () => {
    const { win, all } = makeSandbox({
      fetchImpl: async () => ({ ok: false, status, clone() { return { json: async () => ({}) }; } }),
    });
    await win.fetch(FIND_URL);
    await flush();
    assert.strictEqual(openMsgs(all).length, 0,
      'AR_QUOTE_OPEN pubblicato per una find fallita');
    assert.strictEqual(intentMsgs(all).length, 1, 'segnale di intento mancante');
  });
}

test('#49 fetch: find/<id> in errore di rete NON pubblica AR_QUOTE_OPEN', async () => {
  const { win, all } = makeSandbox({ fetchImpl: async () => { throw new Error('rete'); } });
  await assert.rejects(() => win.fetch(FIND_URL), /rete/);
  assert.strictEqual(openMsgs(all).length, 0);
});

test('#49 fetch: AR_QUOTE_OPEN non parte prima della risposta', async () => {
  let release;
  const pending = new Promise((resolve) => { release = () => resolve(fakeResponse(true, {})); });
  const { win, all } = makeSandbox({ fetchImpl: () => pending });
  const p = win.fetch(FIND_URL);
  await Promise.resolve();
  assert.strictEqual(openMsgs(all).length, 0, 'AR_QUOTE_OPEN postato prima della risposta');
  assert.strictEqual(intentMsgs(all).length, 1);
  release();
  await p;
  assert.strictEqual(openMsgs(all).length, 1);
});

test('#49 xhr: find/<id> 200 pubblica AR_QUOTE_OPEN; 404 e 500 no', async () => {
  const { win, all, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  for (const st of [200, 404, 500]) {
    const x = new win.XMLHttpRequest();
    x.open('GET', FIND_URL); x.send();
    x.responseText = JSON.stringify({ customerdata: CLIENTE });
    xhrs[xhrs.length - 1]._respond(st);
  }
  assert.strictEqual(openMsgs(all).length, 1, 'AR_QUOTE_OPEN deve partire solo per la risposta 200');
  assert.strictEqual(intentMsgs(all).length, 3);
});

test('#49 xhr: due find sovrapposte portano il seq di invio, anche se rispondono al contrario', async () => {
  const { win, all, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const urlA = FIND_URL.replace(/\d+$/, '111');
  const urlB = FIND_URL.replace(/\d+$/, '222');
  for (const u of [urlA, urlB]) {
    const x = new win.XMLHttpRequest();
    x.open('GET', u); x.send();
    x.responseText = JSON.stringify({ customerdata: CLIENTE });
  }
  xhrs[xhrs.length - 1]._respond(200); // risponde prima B (inviata dopo)
  xhrs[xhrs.length - 2]._respond(200);
  const intent = intentMsgs(all).map((m) => [m.id, m.seq]);
  const open = openMsgs(all).map((m) => [m.id, m.seq]);
  assert.ok(intent[1][1] > intent[0][1], 'seq non crescente in ordine di invio: ' + JSON.stringify(intent));
  assert.deepStrictEqual(open, [intent[1], intent[0]], 'seq della conferma diverso da quello dell intento');
});

// ── G. Salvataggi in volo (#47) ──────────────────────────────────────────
// AR_QUOTE_SAVES porta valori ASSOLUTI {inflight, sentSeq, confirmedSeq}.
const savesMsgs = (all) => all.filter((m) => m.source === 'AR_QUOTE_SAVES');
const lastSaves = (all) => savesMsgs(all)[savesMsgs(all).length - 1];

function deferredFetch() {
  const calls = [];
  const impl = () => new Promise((resolve, reject) => calls.push({ resolve, reject }));
  return { impl, calls };
}

test('#47 fetch: in volo sale all\'invio e scende su risposta ok', async () => {
  const d = deferredFetch();
  const { win, all } = makeSandbox({ fetchImpl: d.impl });
  const p = win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(lastSaves(all).inflight, 1);
  d.calls[0].resolve({ ok: true, status: 200 });
  await p;
  const l = lastSaves(all);
  assert.strictEqual(l.inflight, 0);
  assert.strictEqual(l.confirmedSeq, l.sentSeq, 'ultima PATCH confermata ma confirmedSeq != sentSeq');
});

for (const status of [422, 500]) {
  test(`#47 fetch: in volo scende anche su risposta ${status} (e non risulta confermata)`, async () => {
    const d = deferredFetch();
    const { win, all } = makeSandbox({ fetchImpl: d.impl });
    const p = win.fetch(PATCH_URL, PATCH_INIT());
    d.calls[0].resolve({ ok: false, status });
    await p;
    const l = lastSaves(all);
    assert.strictEqual(l.inflight, 0, 'contatore bloccato dopo una risposta negativa');
    assert.ok(l.sentSeq > l.confirmedSeq, 'PATCH rifiutata risulta confermata');
  });
}

test('#47 fetch: in volo scende su errore di rete', async () => {
  const d = deferredFetch();
  const { win, all } = makeSandbox({ fetchImpl: d.impl });
  const p = win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(lastSaves(all).inflight, 1);
  d.calls[0].reject(new Error('network down'));
  await assert.rejects(() => p, /network down/);
  assert.strictEqual(lastSaves(all).inflight, 0, 'contatore bloccato dopo errore di rete');
});

test('#47 fetch: due PATCH sovrapposte, in volo = 2 poi 1 poi 0; ultima rifiutata non e confermata', async () => {
  const d = deferredFetch();
  const { win, all } = makeSandbox({ fetchImpl: d.impl });
  const p1 = win.fetch(PATCH_URL, PATCH_INIT());
  const p2 = win.fetch(PATCH_URL, PATCH_INIT());
  assert.strictEqual(lastSaves(all).inflight, 2);
  d.calls[0].resolve({ ok: true, status: 200 });
  await p1;
  assert.strictEqual(lastSaves(all).inflight, 1);
  d.calls[1].resolve({ ok: false, status: 500 });
  await p2;
  const l = lastSaves(all);
  assert.strictEqual(l.inflight, 0);
  assert.ok(l.sentSeq > l.confirmedSeq, 'la seconda (ultima inviata) e stata rifiutata');
});

test('#47 fetch: GET e PATCH non valide non entrano nel conteggio', async () => {
  const { win, all } = makeSandbox({ fetchImpl: async () => ({ ok: true, status: 200 }) });
  await win.fetch(PATCH_URL, { method: 'GET' });
  await win.fetch(PATCH_URL, { method: 'PATCH', body: '{"x":1}' });
  assert.strictEqual(savesMsgs(all).length, 0);
});

test('#47 xhr: in volo scende su load ok / load 500 / abort / error / timeout', async () => {
  const { win, all, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const casi = [['respond', 200], ['respond', 500], ['emit', 'abort'], ['emit', 'error'], ['emit', 'timeout']];
  for (const [kind, v] of casi) {
    const x = new win.XMLHttpRequest();
    x.open('PATCH', PATCH_URL); x.send(JSON.stringify(PAYLOAD));
    assert.strictEqual(lastSaves(all).inflight, 1, `non in volo dopo send (${v})`);
    const cur = xhrs[xhrs.length - 1];
    if (kind === 'respond') cur._respond(v); else cur._emit(v);
    assert.strictEqual(lastSaves(all).inflight, 0, `contatore bloccato dopo ${v}`);
  }
});

test('#47 xhr: load seguito da loadend scala una volta sola', async () => {
  const { win, all, xhrs } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const a = new win.XMLHttpRequest(); a.open('PATCH', PATCH_URL); a.send(JSON.stringify(PAYLOAD));
  const b = new win.XMLHttpRequest(); b.open('PATCH', PATCH_URL); b.send(JSON.stringify(PAYLOAD));
  assert.strictEqual(lastSaves(all).inflight, 2);
  xhrs[0]._respond(200); // emette load + loadend
  assert.strictEqual(lastSaves(all).inflight, 1, 'doppio decremento (load + loadend)');
});

test('#47 xhr: send() che lancia in modo sincrono non lascia il contatore a 1', async () => {
  const { win, all, ctl } = makeSandbox({ fetchImpl: async () => ({ ok: true }) });
  const x = new win.XMLHttpRequest();
  x.open('PATCH', PATCH_URL);
  ctl.sendThrows = true;
  assert.throws(() => x.send(JSON.stringify(PAYLOAD)), /InvalidStateError/);
  assert.strictEqual(lastSaves(all).inflight, 0);
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
