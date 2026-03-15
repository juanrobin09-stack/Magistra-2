import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Config (API keys, Supabase credentials)
  getConfig: (key: string) => ipcRenderer.invoke('config:get', key),
  getConfigRaw: (key: string) => ipcRenderer.invoke('config:get-raw', key),
  setConfig: (key: string, value: string) => ipcRenderer.invoke('config:set', key, value),
  hasConfig: (key: string) => ipcRenderer.invoke('config:has', key),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
