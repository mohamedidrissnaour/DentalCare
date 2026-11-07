// Écran de configuration du poste (serveur / client).
const err = new URLSearchParams(location.search).get("error");
    if (err) { const e = document.getElementById("err"); e.textContent = err; e.style.display = "block"; }
    document.getElementById("f").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const mode = document.querySelector("input[name=mode]:checked").value;
      const r = await window.dcDesktop.saveConfig({ mode, serverUrl: document.getElementById("url").value });
      if (r && r.error) { const e = document.getElementById("err"); e.textContent = r.error; e.style.display = "block"; }
    });
