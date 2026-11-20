/* Helper condiviso dei test: ritaglia da pricing.content.js (un IIFE legato al
 * DOM, che non esporta nulla) le funzioni da eseguire in vm.
 *
 * Il confine e' un marcatore ESPLICITO di fine funzione nel sorgente,
 * `// ── fine <nome>`, non la prima chiusura indentata a 2 spazi: un blocco
 * interno con la stessa indentazione, o un cambio di indentazione, non
 * tronca piu' il ritaglio in silenzio. Chi aggiunge una funzione estratta dai
 * test mette il marcatore subito dopo la sua chiusura.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pricing.content.js'), 'utf8');

// Da `function <nome>(` (o `async function <nome>(`) al marcatore `// ── fine <nome>`.
function estrai(nome, src = SRC) {
  const re = new RegExp(`(?:async )?function ${nome}\\(`);
  const m = re.exec(src);
  assert.ok(m, `${nome} non trovata in pricing.content.js`);
  const marcatore = `// ── fine ${nome}`;
  const end = src.indexOf(marcatore, m.index);
  assert.ok(end > m.index, `marcatore "${marcatore}" non trovato dopo ${nome} in pricing.content.js`);
  return src.slice(m.index, end);
}

// Blocco fra due marcatori/ancore del sorgente (estremi esclusi dall'ancora finale).
function tra(da, a, src = SRC) {
  const i = src.indexOf(da);
  const j = src.indexOf(a, i + 1);
  assert.ok(i >= 0 && j > i, `blocco "${da}" … "${a}" non trovato in pricing.content.js`);
  return src.slice(i, j);
}

module.exports = { SRC, estrai, tra };
