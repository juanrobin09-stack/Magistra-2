// Preload : pont window.magistra conforme au contrat, canaux IPC exacts, désabonnement des écouteurs.

import { beforeAll, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const invoke = vi.fn(async (..._args: unknown[]) => 'ok');
const send = vi.fn();
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; } },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: (...args: unknown[]) => send(...args),
    on: (channel: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(fn);
    },
    removeListener: (channel: string, fn: (...args: unknown[]) => void) => listeners.get(channel)?.delete(fn),
  },
}));

import { IPC, type MagistraBridge } from '../../shared/ipc.js';

let bridge: MagistraBridge;

beforeAll(async () => {
  await import('../../electron/preload.js');
  bridge = exposed.magistra as MagistraBridge;
});

describe('pont window.magistra', () => {
  it('expose exactement les groupes du contrat MagistraBridge', () => {
    expect(Object.keys(exposed)).toEqual(['magistra']);
    expect(bridge.isElectron).toBe(true);
    expect(Object.keys(bridge).sort()).toEqual(['ai', 'app', 'data', 'documents', 'generation', 'isElectron', 'prefs', 'profile']);
    expect(Object.keys(bridge.ai).sort()).toEqual(['cancelEngineInstall', 'cancelPull', 'installEngine', 'onProgress', 'openEngineDownload', 'pullModel', 'refresh', 'setConfig', 'startEngine', 'status']);
    expect(Object.keys(bridge.data).sort()).toEqual(['clearAll', 'delete', 'get', 'list', 'setFavorite', 'stats']);
  });

  it('chaque méthode appelle le canal prévu, avec ses arguments', async () => {
    const calls: [() => unknown, string, unknown[]][] = [
      [() => bridge.app.info(), IPC.appInfo, []],
      [() => bridge.app.openExternal('https://hal.science'), IPC.openExternal, ['https://hal.science']],
      [() => bridge.ai.status(), IPC.aiStatus, []],
      [() => bridge.ai.refresh(), IPC.aiRefresh, []],
      [() => bridge.ai.installEngine(), IPC.aiInstallEngine, []],
      [() => bridge.ai.cancelEngineInstall(), IPC.aiCancelEngineInstall, []],
      [() => bridge.ai.openEngineDownload(), IPC.aiOpenEngineDownload, []],
      [() => bridge.ai.startEngine(), IPC.aiStartEngine, []],
      [() => bridge.ai.pullModel({ tier: 'leger' }), IPC.aiPullModel, [{ tier: 'leger' }]],
      [() => bridge.ai.cancelPull(), IPC.aiCancelPull, []],
      [() => bridge.ai.setConfig({ tier: 'qualite' }), IPC.aiSetConfig, [{ tier: 'qualite' }]],
      [() => bridge.generation.capabilities(), IPC.genCapabilities, []],
      [() => bridge.generation.cancel('job-1'), IPC.genCancel, ['job-1']],
      [() => bridge.data.list({ limit: 10 }), IPC.dataList, [{ limit: 10 }]],
      [() => bridge.data.get('a'), IPC.dataGet, ['a']],
      [() => bridge.data.setFavorite('a', true), IPC.dataSetFavorite, ['a', true]],
      [() => bridge.data.delete('a'), IPC.dataDelete, ['a']],
      [() => bridge.data.stats(), IPC.dataStats, []],
      [() => bridge.data.clearAll(), IPC.dataClearAll, []],
      [() => bridge.profile.get(), IPC.profileGet, []],
      [() => bridge.profile.set(null), IPC.profileSet, [null]],
      [() => bridge.prefs.get(), IPC.prefsGet, []],
      [() => bridge.prefs.set({ keepDocuments: true }), IPC.prefsSet, [{ keepDocuments: true }]],
      [() => bridge.documents.list(), IPC.docsList, []],
      [() => bridge.documents.load('d'), IPC.docsLoad, ['d']],
      [() => bridge.documents.delete('d'), IPC.docsDelete, ['d']],
    ];
    for (const [fn, channel, args] of calls) {
      invoke.mockClear();
      await fn();
      expect(invoke).toHaveBeenCalledWith(channel, ...args);
    }
    bridge.app.ready();
    expect(send).toHaveBeenCalledWith(IPC.appReady);
  });

  it('les écouteurs reçoivent la charge utile seule et se désabonnent', () => {
    const received: unknown[] = [];
    const off = bridge.generation.onEvent(payload => received.push(payload));
    const [wrapped] = [...listeners.get(IPC.genEvent)!];
    const fakeIpcEvent = { sender: { send: () => undefined } };
    wrapped(fakeIpcEvent, { jobId: 'j', event: { type: 'delta', text: 'x' } });
    expect(received).toEqual([{ jobId: 'j', event: { type: 'delta', text: 'x' } }]);
    off();
    off();
    expect(listeners.get(IPC.genEvent)!.size).toBe(0);

    const progress: unknown[] = [];
    const offProgress = bridge.ai.onProgress(e => progress.push(e));
    [...listeners.get(IPC.aiProgress)!][0](fakeIpcEvent, { kind: 'model-ready', model: 'm' });
    expect(progress).toEqual([{ kind: 'model-ready', model: 'm' }]);
    offProgress();
    expect(listeners.get(IPC.aiProgress)!.size).toBe(0);
  });
});
