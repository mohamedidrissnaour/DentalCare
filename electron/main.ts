import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";

/**
 * DentaCare, application de bureau.
 *  - Mode « serveur » (poste principal) : démarre le serveur DentaCare intégré (API + base SQLite) et l'affiche.
 *    Les autres postes du réseau s'y connectent (application en mode « client » ou simple navigateur).
 *  - Mode « client » : ouvre l'interface du poste serveur (http://IP:5080).
 * Aucun démarrage automatique avec Windows, aucune clé de registre : l'utilisateur lance l'application.
 */
interface Config { mode: "server" | "client"; serverUrl?: string; port?: number }
const cfgFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig(): Config | null {
  try { return JSON.parse(fs.readFileSync(cfgFile(), "utf8")); } catch { return null; }
}
function writeConfig(c: Config) { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); }

/** Adresse de serveur acceptée : http(s)://hôte[:port], sans chemin ni identifiants. */
function normalizeUrl(u: unknown): string | null {
  try {
    const x = new URL(String(u).trim());
    if (!["http:", "https:"].includes(x.protocol) || x.username || x.password) return null;
    return x.origin;
  } catch { return null; }
}

let win: BrowserWindow | null = null;
let origin = "";
let stopServer: (() => Promise<void>) | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, show: false, title: "DentaCare", backgroundColor: "#F7F7F7",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => { win?.maximize(); win?.show(); });
  // Navigation limitée au serveur DentaCare ; les liens externes s'ouvrent dans le navigateur.
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:") || (origin && url.startsWith(origin))) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (origin && url.startsWith(origin + "/impression/")) return { action: "allow" };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => { win = null; });
}

async function openConnect(error?: string) {
  origin = "";
  await win!.loadFile(path.join(__dirname, "connect.html"), { query: error ? { error } : {} });
}

async function boot() {
  const cfg = readConfig();
  if (!cfg) return openConnect();
  if (cfg.mode === "client") {
    const url = normalizeUrl(cfg.serverUrl);
    if (!url) return openConnect("Adresse du poste serveur invalide.");
    try {
      const r = await fetch(url + "/health", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error();
    } catch { return openConnect(`Le poste serveur ${url} ne répond pas. Vérifiez qu'il est allumé et que DentaCare y est lancé.`); }
    origin = url;
    return win!.loadURL(url);
  }
  // Mode serveur : serveur intégré, données dans le profil Windows de l'utilisateur.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const server = require(path.join(__dirname, "..", "server", "index.cjs"));
  try {
    const port = cfg.port ?? 5080;
    const s = await server.startServer({
      dataDir: path.join(app.getPath("userData"), "data"), port, host: "0.0.0.0", webDir: path.join(__dirname, "..", "web"),
    });
    stopServer = s.stop;
    origin = `http://localhost:${port}`;
    await win!.loadURL(origin);
  } catch (e) {
    dialog.showErrorBox("DentaCare", `Le serveur n'a pas pu démarrer (port déjà utilisé ?).\n${(e as Error).message}`);
    await openConnect("Le serveur intégré n'a pas pu démarrer.");
  }
}

ipcMain.handle("dc:save-config", async (_e, c: Config) => {
  if (c?.mode === "client") {
    const url = normalizeUrl(c.serverUrl);
    if (!url) return { error: "Adresse invalide. Exemple : http://192.168.1.10:5080" };
    writeConfig({ mode: "client", serverUrl: url });
  } else writeConfig({ mode: "server", port: 5080 });
  app.relaunch(); app.exit(0);
  return { ok: true };
});
ipcMain.handle("dc:info", () => ({ mode: readConfig()?.mode ?? null, version: app.getVersion() }));
/** Impression silencieuse (sans boîte de dialogue) d'une page /impression/… du serveur DentaCare. */
ipcMain.handle("dc:print", async (_e, p: unknown) => {
  if (!origin || typeof p !== "string" || !/^\/impression\/[a-z]+(\/\d+)?(\?[a-z0-9=&-]*)?$/i.test(p)) return { error: "Adresse d'impression refusée." };
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await w.loadURL(origin + p);
    // Attendre que la page ait chargé ses données (elle positionne data-ready sur <body>).
    for (let i = 0; i < 50; i++) {
      if (await w.webContents.executeJavaScript("document.body.dataset.ready === '1'")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ok = await new Promise<boolean>((resolve) => w.webContents.print({ silent: true, printBackground: true }, (success) => resolve(success)));
    return ok ? { ok: true } : { error: "Impression impossible (imprimante indisponible ?)." };
  } finally { w.destroy(); }
});

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "DentaCare", submenu: [
      { label: "Changer de poste (serveur / client)…", click: () => { if (win) openConnect(); } },
      { type: "separator" }, { role: "reload", label: "Recharger" }, { role: "togglefullscreen", label: "Plein écran" },
      { type: "separator" }, { role: "quit", label: "Quitter" },
    ] },
    { label: "Édition", submenu: [{ role: "undo", label: "Annuler" }, { role: "redo", label: "Rétablir" }, { type: "separator" }, { role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { role: "selectAll", label: "Tout sélectionner" }] },
    { label: "Affichage", submenu: [{ role: "zoomIn", label: "Zoom +" }, { role: "zoomOut", label: "Zoom -" }, { role: "resetZoom", label: "Taille réelle" }] },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { buildMenu(); createWindow(); return boot(); });
  app.on("window-all-closed", async () => { if (stopServer) await stopServer().catch(() => undefined); app.quit(); });
}
