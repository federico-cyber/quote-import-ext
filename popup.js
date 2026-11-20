// popup.js — estensione unificata "AR AUTO — Qricambi"
// Rende lo storico import da chrome.storage.local.importHistory.

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function outcomeText(rec) {
  if (rec.status === 'ok')  return `✓ PR3 ${rec.sirjNumero}/${rec.sirjAnno}`;
  if (rec.status === 'ok-fallback') return `✓ PR3 ${rec.sirjNumero}/${rec.sirjAnno} (cliente generico)`;
  if (rec.status === 'dup') return `↺ già importato: PR3 ${rec.sirjNumero}/${rec.sirjAnno}`;
  if (rec.status === 'collision') return `⚠ collisione numerazione: PR3 ${rec.sirjNumero}/${rec.sirjAnno} occupato da un altro documento, verifica in SIRJ`;
  if (rec.status === 'esito-incerto') {
    const ref = rec.sirjNumero != null ? `PR3 ${rec.sirjNumero}/${rec.sirjAnno}` : 'il PR3';
    return `⚠ esito incerto: verifica in SIRJ ${ref} prima di riprovare`;
  }
  return `✗ ${rec.error || 'errore'}`;
}

function renderHistory(history) {
  const container = document.getElementById('history');
  container.textContent = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nessun import registrato.';
    container.appendChild(empty);
    return;
  }
  history.slice(0, 20).forEach((rec) => {
    const row = document.createElement('div');
    row.className = `hist-row ${rec.status}`;

    const line1 = document.createElement('div');
    line1.className = 'hist-line1';
    const customer = document.createElement('span');
    customer.className = 'hist-customer';
    customer.textContent = rec.customer || '(?)';
    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = fmtTime(rec.ts);
    line1.appendChild(customer);
    line1.appendChild(time);

    const line2 = document.createElement('div');
    line2.className = 'hist-line2';
    const carPart = rec.car ? `${rec.car} · ` : '';
    line2.textContent = `${carPart}${rec.itemsCount} articoli · €${rec.total}`;

    const outcome = document.createElement('div');
    outcome.className = `hist-outcome ${rec.status}`;
    outcome.textContent = outcomeText(rec);

    row.appendChild(line1);
    row.appendChild(line2);
    row.appendChild(outcome);
    container.appendChild(row);
  });
}

// Numero da mostrare: quello salvato nelle Opzioni se e' un numero finito, altrimenti il default.
function numRegola(s, k) {
  const raw = s && s[k];
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return DEFAULTS[k];  // Number(null) e' 0
  const v = Number(raw);
  return Number.isFinite(v) ? v : DEFAULTS[k];
}
const fmtNum = (n) => String(+n.toFixed(2));

// Le tre regole di prezzo coi parametri veri (Opzioni), non con numeri scritti a mano
// nell'HTML che divergono appena si cambia un'impostazione.
function renderRegole(s) {
  const container = document.getElementById('rules');
  if (!container) return;
  container.textContent = '';
  const soglia = numRegola(s, 'regCThreshold');
  const righe = [
    ['Regola A', ` — con listino sopra l'acquisto (sconto ≤ ${fmtNum(soglia)}pp): sconto cliente = sconto fornitore `,
      `− ${fmtNum(numRegola(s, 'regADelta'))}pp`, '.'],
    ['Regola C', ` — listino + sconto > ${fmtNum(soglia)}pp: prezzo cliente = netto `,
      `× ${fmtNum(1 + numRegola(s, 'regCMarkup') / 100)}`, '.'],
    ['Regola B', ' — senza listino, o listino non sopra l\'acquisto: listino fittizio = netto ',
      `× ${fmtNum(numRegola(s, 'regBMultiplier'))}`, ', sconto ',
      `${fmtNum(numRegola(s, 'regBDiscount'))}%`, '.'],
  ];
  for (const [titolo, ...pezzi] of righe) {
    const row = document.createElement('div');
    row.className = 'rule';
    const b = document.createElement('b');
    b.textContent = titolo;
    row.appendChild(b);
    // pezzi alterna testo (span) e valore (code)
    pezzi.forEach((p, i) => {
      const c = document.createElement(i % 2 === 0 ? 'span' : 'code');
      c.textContent = p;
      row.appendChild(c);
    });
    container.appendChild(row);
  }
}
// ── fine renderRegole

chrome.storage.local.get(DEFAULTS, (s) => renderRegole(s));

chrome.storage.local.get({ importHistory: [] }, (s) => {
  const history = Array.isArray(s.importHistory) ? s.importHistory : [];
  renderHistory(history);
});

document.getElementById('open-options').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('options.html'));
});
