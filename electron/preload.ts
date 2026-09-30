// Pont sécurisé exposé à la fenêtre sous window.magistra (contrat : MagistraBridge, shared/ipc.ts).
// Construit en CommonJS (dist-electron/preload.cjs) pour le bac à sable : seul require('electron') est utilisé.
// Aucune API Electron n'est exposée telle quelle : uniquement des fonctions qui appellent des canaux précis.
// Les écouteurs ne reçoivent jamais l'objet évènement IPC (qui donnerait accès à ipcRenderer).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AIProgressEvent, type MagistraBridge } from '../shared/ipc.js';
import type { ConnectorAppStatus } from '../shared/localConnector.js';
import type { GenerationEvent } from '../shared/types.js';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  if (typeof listener !== 'function') throw new TypeError('Écouteur invalide.');
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const bridge: MagistraBridge = {
  isElectron: true,
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    ready: () => {
      ipcRenderer.send(IPC.appReady);
    },
    openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
    checkForUpdate: () => ipcRenderer.invoke(IPC.appCheckUpdate),
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    refresh: () => ipcRenderer.invoke(IPC.aiRefresh),
    // Argument transmis seulement s'il est fourni : installEngine() reste un appel sans argument.
    installEngine: options => ipcRenderer.invoke(IPC.aiInstallEngine, ...(options ? [options] : [])),
    cancelEngineInstall: () => ipcRenderer.invoke(IPC.aiCancelEngineInstall),
    openEngineDownload: () => ipcRenderer.invoke(IPC.aiOpenEngineDownload),
    startEngine: options => ipcRenderer.invoke(IPC.aiStartEngine, ...(options ? [options] : [])),
    pullModel: target => ipcRenderer.invoke(IPC.aiPullModel, target),
    cancelPull: () => ipcRenderer.invoke(IPC.aiCancelPull),
    setConfig: update => ipcRenderer.invoke(IPC.aiSetConfig, update),
    onProgress: listener => subscribe<AIProgressEvent>(IPC.aiProgress, listener),
  },
  generation: {
    capabilities: () => ipcRenderer.invoke(IPC.genCapabilities),
    start: request => ipcRenderer.invoke(IPC.genStart, request),
    cancel: jobId => ipcRenderer.invoke(IPC.genCancel, jobId),
    onEvent: listener => subscribe<{ jobId: string; event: GenerationEvent }>(IPC.genEvent, listener),
  },
  data: {
    list: query => ipcRenderer.invoke(IPC.dataList, query),
    get: id => ipcRenderer.invoke(IPC.dataGet, id),
    setFavorite: (id, value) => ipcRenderer.invoke(IPC.dataSetFavorite, id, value),
    delete: id => ipcRenderer.invoke(IPC.dataDelete, id),
    stats: () => ipcRenderer.invoke(IPC.dataStats),
    clearAll: () => ipcRenderer.invoke(IPC.dataClearAll),
  },
  profile: {
    get: () => ipcRenderer.invoke(IPC.profileGet),
    set: profile => ipcRenderer.invoke(IPC.profileSet, profile),
  },
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefsGet),
    set: update => ipcRenderer.invoke(IPC.prefsSet, update),
  },
  documents: {
    list: () => ipcRenderer.invoke(IPC.docsList),
    load: id => ipcRenderer.invoke(IPC.docsLoad, id),
    save: doc => ipcRenderer.invoke(IPC.docsSave, doc),
    delete: id => ipcRenderer.invoke(IPC.docsDelete, id),
  },
  connector: {
    status: () => ipcRenderer.invoke(IPC.connectorStatus),
    revoke: clientId => ipcRenderer.invoke(IPC.connectorRevoke, clientId),
    setEnabled: enabled => ipcRenderer.invoke(IPC.connectorSetEnabled, enabled),
    onChange: listener => subscribe<ConnectorAppStatus>(IPC.connectorChanged, listener),
  },
};

contextBridge.exposeInMainWorld('magistra', bridge);
