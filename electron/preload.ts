import { contextBridge, ipcRenderer } from "electron";

// API minimale exposée à l'interface (aucun accès Node.js direct).
contextBridge.exposeInMainWorld("dcDesktop", {
  isDesktop: true,
  info: () => ipcRenderer.invoke("dc:info"),
  saveConfig: (c: { mode: "server" | "client"; serverUrl?: string }) => ipcRenderer.invoke("dc:save-config", c),
  print: (path: string) => ipcRenderer.invoke("dc:print", path),
});
