// options.js
chrome.storage.sync.get(DEFAULTS, (s) => {
  document.getElementById("backendUrl").value = s.backendUrl;
  document.getElementById("apiKey").value = s.apiKey;
});
document.getElementById("save").onclick = () => {
  const cfg = {
    backendUrl: document.getElementById("backendUrl").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
  };
  chrome.storage.sync.set(cfg, () => {
    document.getElementById("saved").textContent = "✓ salvato";
    setTimeout(() => document.getElementById("saved").textContent = "", 1500);
  });
};
