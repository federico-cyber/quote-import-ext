// popup.js
chrome.storage.local.get(["lastQricambiId", "lastSirjNumero", "lastSirjAnno", "lastError"], (s) => {
  const status = document.getElementById("status");
  const last = document.getElementById("last");
  if (s.lastQricambiId && s.lastSirjNumero) {
    status.className = "row ok";
    status.textContent = `Ultimo: Qricambi #${s.lastQricambiId} → SIRJ PR3 ${s.lastSirjNumero}/${s.lastSirjAnno}`;
  } else {
    status.textContent = "Nessun import in questa sessione.";
  }
  if (s.lastError) {
    last.className = "row err";
    last.textContent = `Errore: ${s.lastError}`;
  }
});
document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();
