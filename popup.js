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

chrome.storage.local.get({ importHistory: [] }, (s) => {
  const history = Array.isArray(s.importHistory) ? s.importHistory : [];
  renderHistory(history);
});

document.getElementById('open-options').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('options.html'));
});
