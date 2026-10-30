// Test di injectUtileColumn (issue #61): il td UTILE deve stare nella stessa colonna logica
// del th UTILE anche quando le righe del body hanno una cella in piu' del thead (bottone X
// senza <th>, offset > 0 in mappaColonne). L'IIFE di pricing.content.js non esporta nulla: le due
// funzioni vengono estratte dal sorgente e girano su un mini-DOM (niente jsdom nel repo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');

function estrai(nome) {
  const start = src.indexOf(`function ${nome}(`);
  assert.ok(start >= 0, `${nome} non trovata in pricing.content.js`);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > start, `fine di ${nome} non trovata`);
  return src.slice(start, end + 4);
}

// ── Mini-DOM: solo cio' che usano mappaColonne e injectUtileColumn ──
class El {
  constructor(tag, text = '') {
    this.tag = tag; this.children = []; this.parent = null;
    this.className = ''; this.id = ''; this.style = {}; this._text = text;
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v; this.children = []; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    const i = this.children.indexOf(ref);
    assert.ok(i >= 0, 'insertBefore: nodo di riferimento non figlio');
    c.parent = this; this.children.splice(i, 0, c); return c;
  }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  matchesSimple(sel) {
    const not = sel.match(/^(.*?):not\(#([\w-]+)\)$/);
    if (not) return this.matchesSimple(not[1]) && this.id !== not[2];
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tag === sel;
  }
  querySelectorAll(sel) {
    const out = new Set();
    for (const alt of sel.split(',').map(s => s.trim())) {
      const [first, ...rest] = alt.split(/\s+/);
      let set = this.descendants().filter(n => n.matchesSimple(first));
      for (const s of rest) set = [...new Set(set.flatMap(n => n.descendants().filter(d => d.matchesSimple(s))))];
      set.forEach(n => out.add(n));
    }
    return this.descendants().filter(n => out.has(n));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function costruisciTabella({ extraSinistra }) {
  const table = new El('table');
  const thead = table.appendChild(new El('thead'));
  const trH = thead.appendChild(new El('tr'));
  ['Descrizione', 'Acquisto', 'Listino', 'Sconto', 'Vendita', 'Azioni']
    .forEach(t => trH.appendChild(new El('th', t)));
  const tbody = table.appendChild(new El('tbody'));
  [['Pastiglie', '10', '30', '20', '24', 'azioni'], ['Disco', '40', '90', '25', '67', 'azioni']].forEach(r => {
    const tr = tbody.appendChild(new El('tr'));
    if (extraSinistra) tr.appendChild(new El('td', 'X'));
    r.forEach(v => tr.appendChild(new El('td', v)));
  });
  const doc = { getElementById: id => table.descendants().find(n => n.id === id) || null,
                createElement: tag => new El(tag) };
  return { table, trH, doc };
}

function caricaFunzioni(doc) {
  return new Function('document', 'TAG', 'console',
    `${estrai('mappaColonne')}\n${estrai('injectUtileColumn')}\nreturn { mappaColonne, injectUtileColumn };`
  )(doc, '[T]', { log() {} });
}

function verificaAllineamento({ table, trH }, extraSinistra) {
  const idxTh = trH.children.findIndex(c => c.id === 'ar-col-utile');
  assert.ok(idxTh >= 0, 'th UTILE assente');
  assert.equal(trH.children[idxTh + 1].textContent, 'Azioni', 'th UTILE deve precedere Azioni');
  for (const tr of table.querySelectorAll('tbody tr')) {
    const idxTd = tr.children.findIndex(c => c.className === 'ar-utile-cell');
    assert.equal(idxTd, idxTh + (extraSinistra ? 1 : 0), 'td UTILE nella colonna logica del th UTILE');
    assert.equal(tr.children[idxTd + 1].textContent, 'azioni', 'td UTILE immediatamente prima della cella Azioni');
  }
}

test('offset>0: il td UTILE sta nella stessa colonna logica del th UTILE (issue #61)', () => {
  const t = costruisciTabella({ extraSinistra: true });
  const { mappaColonne, injectUtileColumn } = caricaFunzioni(t.doc);
  const prima = mappaColonne(t.table);
  assert.deepEqual(prima, { descrizione: 1, acquisto: 2, listino: 3, sconto: 4, vendita: 5 });
  injectUtileColumn(t.table, prima);
  verificaAllineamento(t, true);
  // le colonne a sinistra di UTILE non si muovono: vendita resta la cella Vendita
  for (const tr of t.table.querySelectorAll('tbody tr')) {
    assert.equal(tr.children[prima.vendita].textContent, tr === t.table.querySelector('tbody tr') ? '24' : '67');
  }
});

test('offset>0: mappaColonne al click successivo restituisce gli stessi indici', () => {
  const t = costruisciTabella({ extraSinistra: true });
  const { mappaColonne, injectUtileColumn } = caricaFunzioni(t.doc);
  const prima = mappaColonne(t.table);
  injectUtileColumn(t.table, prima);
  assert.deepEqual(mappaColonne(t.table), prima);
  injectUtileColumn(t.table, prima); // idempotente: nessuna seconda cella UTILE
  assert.equal(t.table.querySelectorAll('.ar-utile-cell').length, 2);
  verificaAllineamento(t, true);
});

test('offset=0 (controllo): comportamento invariato', () => {
  const t = costruisciTabella({ extraSinistra: false });
  const { mappaColonne, injectUtileColumn } = caricaFunzioni(t.doc);
  const prima = mappaColonne(t.table);
  assert.deepEqual(prima, { descrizione: 0, acquisto: 1, listino: 2, sconto: 3, vendita: 4 });
  injectUtileColumn(t.table, prima);
  verificaAllineamento(t, false);
  assert.deepEqual(mappaColonne(t.table), prima);
});

test('riga corta (colspan, nessun dato): il td UTILE finisce in coda come prima', () => {
  const t = costruisciTabella({ extraSinistra: true });
  const corta = t.table.querySelector('tbody').appendChild(new El('tr'));
  corta.appendChild(new El('td', 'Nessun dato'));
  const { mappaColonne, injectUtileColumn } = caricaFunzioni(t.doc);
  injectUtileColumn(t.table, mappaColonne(t.table));
  assert.equal(corta.children[1].className, 'ar-utile-cell');
});
