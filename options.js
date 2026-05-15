// options.js — estensione unificata "AR AUTO — Qricambi"
// DEFAULTS è caricato da defaults.js. Tutto lo storage è chrome.storage.local.

// Chiavi dei soli parametri pricing (usate dal reset, che NON tocca backendUrl/apiKey).
const PRICING_KEYS = [
  'regADelta', 'regACapThreshold', 'regACapValue',
  'regCThreshold', 'regCMarkup', 'regBMultiplier', 'regBDiscount',
  'uiRoundStep', 'uiThresholdLow', 'uiThresholdHigh',
];

// Regole di validazione: [min, max, descrizione]
const VALIDATION_RULES = {
  'reg-a-delta':         [0,   50,  'Delta Sconto (0–50pp)'],
  'reg-a-cap-threshold': [50,  99,  'Soglia Cap Fornitore (50–99%)'],
  'reg-a-cap-value':     [0,   99,  'Sconto Fisso Cap (0–99%)'],
  'reg-c-threshold':     [50,  99,  'Soglia Attivazione C (50–99%)'],
  'reg-c-markup':        [1,   200, 'Percentuale Ricarico (1–200%)'],
  'reg-b-multiplier':    [1.1, 10,  'Moltiplicatore Listino (1.1–10)'],
  'reg-b-discount':      [0,   99,  'Sconto Cliente B (0–99%)'],
  'ui-round-step':       [1,   20,  'Passo Arrotondamento (1–20)'],
  'ui-threshold-low':    [0,   99,  'Soglia Utile Basso (0–99%)'],
  'ui-threshold-high':   [0,   200, 'Soglia Utile Alto (0–200%)'],
};

function loadSettings() {
  chrome.storage.local.get(DEFAULTS, (s) => {
    document.getElementById('reg-a-delta').value = s.regADelta;
    document.getElementById('reg-a-cap-threshold').value = s.regACapThreshold;
    document.getElementById('reg-a-cap-value').value = s.regACapValue;
    document.getElementById('reg-c-threshold').value = s.regCThreshold;
    document.getElementById('reg-c-markup').value = s.regCMarkup;
    document.getElementById('reg-b-multiplier').value = s.regBMultiplier;
    document.getElementById('reg-b-discount').value = s.regBDiscount;
    document.getElementById('ui-round-step').value = s.uiRoundStep;
    document.getElementById('ui-threshold-low').value = s.uiThresholdLow;
    document.getElementById('ui-threshold-high').value = s.uiThresholdHigh;
    document.getElementById('backendUrl').value = s.backendUrl;
    document.getElementById('apiKey').value = s.apiKey;
    clearAllErrors();
  });
}

function clearAllErrors() {
  document.querySelectorAll('input[type="number"]').forEach(el => { el.style.borderColor = ''; });
  document.querySelectorAll('.validation-error').forEach(el => el.remove());
}

function showFieldError(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  input.style.borderColor = 'var(--red)';
  const existing = input.parentElement.querySelector('.validation-error');
  if (existing) existing.remove();
  const err = document.createElement('span');
  err.className = 'validation-error';
  err.style.cssText = 'color: var(--red); font-size: 11px; font-family: "DM Mono", monospace;';
  err.textContent = message;
  input.parentElement.appendChild(err);
}

function validateAll() {
  clearAllErrors();
  let valid = true;
  for (const [id, [min, max, label]] of Object.entries(VALIDATION_RULES)) {
    const input = document.getElementById(id);
    if (!input) continue;
    const v = parseFloat(input.value);
    if (isNaN(v)) { showFieldError(id, `${label}: valore non valido`); valid = false; }
    else if (v < min || v > max) { showFieldError(id, `${label}: deve essere tra ${min} e ${max}`); valid = false; }
  }
  const cThresh = parseFloat(document.getElementById('reg-c-threshold').value);
  const capThresh = parseFloat(document.getElementById('reg-a-cap-threshold').value);
  if (!isNaN(cThresh) && !isNaN(capThresh) && cThresh >= capThresh) {
    showFieldError('reg-c-threshold', 'Soglia C deve essere < Soglia Cap A (' + capThresh + '%)');
    valid = false;
  }
  return valid;
}

function flashStatus(text, isError) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.style.color = isError ? 'var(--red)' : '';
  status.className = 'status-msg show';
  setTimeout(() => {
    status.className = 'status-msg';
    status.style.color = '';
    status.textContent = 'Impostazioni salvate con successo!';
  }, isError ? 3000 : 2500);
}

function saveSettings() {
  if (!validateAll()) { flashStatus('Correggi gli errori prima di salvare.', true); return; }
  const getNum = (id) => parseFloat(document.getElementById(id).value);
  const settings = {
    regADelta:        getNum('reg-a-delta'),
    regACapThreshold: getNum('reg-a-cap-threshold'),
    regACapValue:     getNum('reg-a-cap-value'),
    regCThreshold:    getNum('reg-c-threshold'),
    regCMarkup:       getNum('reg-c-markup'),
    regBMultiplier:   getNum('reg-b-multiplier'),
    regBDiscount:     getNum('reg-b-discount'),
    uiRoundStep:      getNum('ui-round-step'),
    uiThresholdLow:   getNum('ui-threshold-low'),
    uiThresholdHigh:  getNum('ui-threshold-high'),
    backendUrl:       document.getElementById('backendUrl').value.trim(),
    apiKey:           document.getElementById('apiKey').value.trim(),
  };
  chrome.storage.local.set(settings, () => flashStatus('Impostazioni salvate con successo!', false));
}

function resetSettings() {
  if (!confirm('Ripristinare i parametri PRICING ai default? (backendUrl e API key non vengono toccati)')) return;
  const pricingDefaults = {};
  for (const k of PRICING_KEYS) pricingDefaults[k] = DEFAULTS[k];
  chrome.storage.local.set(pricingDefaults, () => {
    loadSettings();
    flashStatus('Parametri pricing ripristinati!', false);
  });
}

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('reset-btn').addEventListener('click', resetSettings);
