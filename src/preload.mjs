import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desk", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  listDatasets: () => ipcRenderer.invoke("datasets:list"),
  runSync: (opts) => ipcRenderer.invoke("sync:run", opts),
  getStatus: () => ipcRenderer.invoke("status:get"),
  chooseDir: () => ipcRenderer.invoke("choose:dir"),
  openPath: (p) => ipcRenderer.invoke("open:path", p),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  tikuHome: () => ipcRenderer.invoke("tiku:home"),
  naoku: (pathname, params) => ipcRenderer.invoke("naoku:query", { pathname, params }),
  onSyncProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("sync:progress", listener);
    return () => ipcRenderer.removeListener("sync:progress", listener);
  },
  onConfigChanged: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("config:changed", listener);
    return () => ipcRenderer.removeListener("config:changed", listener);
  },
});
