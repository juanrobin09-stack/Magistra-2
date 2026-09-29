// Sécurité du processus principal : origine de l'application, expéditeur IPC, liens externes,
// et enregistrement réel des canaux IPC (module electron simulé).

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
    removeListener: (channel: string) => listeners.delete(channel),
  },
}));

import { IPC } from '../../shared/ipc.js';
import { registerIpcHandlers, type IpcContext } from '../../electron/ipc.js';
import {
  APP_ORIGIN, isSafeExternalUrl, isTrustedSender, isTrustedUrl, originOf, parseDevServerUrl, trustedOrigins,
  type TrustedWindowLike,
} from '../../electron/security.js';

function fakeWindow(id = 1, frameTreeNodeId = 10): TrustedWindowLike {
  return {
    isDestroyed: () => false,
    webContents: { id, isDestroyed: () => false, mainFrame: { frameTreeNodeId } },
  };
}

function event(url: string, opts: { senderId?: number; frameId?: number; parent?: unknown; noFrame?: boolean } = {}) {
  return {
    sender: { id: opts.senderId ?? 1 },
    senderFrame: opts.noFrame ? null : { url, parent: (opts.parent ?? null) as never, frameTreeNodeId: opts.frameId ?? 10 },
  };
}

describe('origines et expéditeur IPC', () => {
  const origins = trustedOrigins(null);

  it('traite app://magistra comme une origine (URL.origin vaut « null » pour ce schéma)', () => {
    expect(new URL('app://magistra/app').origin).toBe('null');
    expect(originOf('app://magistra/app/generate?x=1')).toBe(APP_ORIGIN);
    expect(isTrustedUrl('app://magistra/', origins)).toBe(true);
    expect(isTrustedUrl('app://evil/', origins)).toBe(false);
    expect(isTrustedUrl('https://magistra/', origins)).toBe(false);
  });

  it('accepte le cadre principal de la fenêtre Magistra', () => {
    expect(isTrustedSender(event('app://magistra/app'), fakeWindow(), origins)).toBe(true);
  });

  it('refuse une origine étrangère, un sous-cadre, une autre fenêtre ou un cadre détruit', () => {
    const win = fakeWindow();
    expect(isTrustedSender(event('https://evil.example/'), win, origins)).toBe(false);
    expect(isTrustedSender(event('file:///C:/Users/prof/AppData/Roaming/Magistra/ai-config.json'), win, origins)).toBe(false);
    expect(isTrustedSender(event('http://localhost:5173/'), win, origins)).toBe(false);
    expect(isTrustedSender(event('app://magistra/', { parent: {} }), win, origins)).toBe(false);
    expect(isTrustedSender(event('app://magistra/', { frameId: 11 }), win, origins)).toBe(false);
    expect(isTrustedSender(event('app://magistra/', { senderId: 2 }), win, origins)).toBe(false);
    expect(isTrustedSender(event('app://magistra/', { noFrame: true }), win, origins)).toBe(false);
    expect(isTrustedSender(event('app://magistra/'), null, origins)).toBe(false);
  });

  it("n'accepte le serveur de développement que s'il est configuré et local", () => {
    expect(parseDevServerUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(parseDevServerUrl('http://192.168.1.10:5173/')).toBeNull();
    expect(parseDevServerUrl('file:///tmp/index.html')).toBeNull();
    const dev = trustedOrigins(parseDevServerUrl('http://127.0.0.1:5173/'));
    expect(isTrustedSender(event('http://127.0.0.1:5173/app'), fakeWindow(), dev)).toBe(true);
    expect(isTrustedSender(event('http://127.0.0.1:5174/app'), fakeWindow(), dev)).toBe(false);
  });

  it("n'ouvre dans le navigateur que des liens http(s) sûrs", () => {
    expect(isSafeExternalUrl('https://www.education.gouv.fr/')).toBe(true);
    expect(isSafeExternalUrl('http://hal.science/hal-01234')).toBe(true);
    for (const url of [
      'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'smb://serveur/partage',
      'ms-msdt:/id', 'https://user:pass@evil.example/', 'https://exa mple.com/', 'https://example.com/\n', 'x'.repeat(3000), 42,
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });
});

describe('enregistrement des canaux IPC', () => {
  const win = fakeWindow();
  const store = {
    getPreferences: vi.fn(async () => ({ setupCompleted: true })),
    get: vi.fn(async () => null),
    setFavorite: vi.fn(async () => undefined),
  };
  const openExternal = vi.fn(async () => undefined);
  const onAppReady = vi.fn();

  beforeEach(() => {
    handlers.clear();
    listeners.clear();
    vi.clearAllMocks();
    registerIpcHandlers({
      getWindow: () => win,
      trustedOrigins: trustedOrigins(null),
      store: store as unknown as IpcContext['store'],
      ai: {} as IpcContext['ai'],
      generation: {} as IpcContext['generation'],
      appInfo: () => ({ version: '2.0.0', platform: 'win32', userDataPath: 'C:/x', isPackaged: true }),
      openExternal,
      onAppReady,
    });
  });

  it('enregistre tous les canaux invoqués du contrat', () => {
    const invoked = Object.values(IPC).filter(c => c !== IPC.aiProgress && c !== IPC.genEvent && c !== IPC.appReady);
    for (const channel of invoked) expect(handlers.has(channel), channel).toBe(true);
    expect(listeners.has(IPC.appReady)).toBe(true);
  });

  it('refuse un appel venant d’une origine étrangère (FORBIDDEN)', async () => {
    const call = handlers.get(IPC.prefsGet)!;
    await expect(call(event('https://evil.example/'))).rejects.toThrow(/^FORBIDDEN\|/);
    expect(store.getPreferences).not.toHaveBeenCalled();
    await expect(call(event('app://magistra/'))).resolves.toEqual({ setupCompleted: true });
  });

  it('ignore app:ready d’un expéditeur non autorisé', () => {
    listeners.get(IPC.appReady)!(event('https://evil.example/'));
    expect(onAppReady).not.toHaveBeenCalled();
    listeners.get(IPC.appReady)!(event('app://magistra/'));
    expect(onAppReady).toHaveBeenCalledTimes(1);
  });

  it('valide les arguments et renvoie « CODE|message » sans détail technique', async () => {
    const get = handlers.get(IPC.dataGet)!;
    await expect(get(event('app://magistra/'), '../../ai-config')).rejects.toThrow(/^INVALID_REQUEST\|Paramètre invalide/);
    expect(store.get).not.toHaveBeenCalled();
    const fav = handlers.get(IPC.dataSetFavorite)!;
    await expect(fav(event('app://magistra/'), 'abc', 'oui')).rejects.toThrow(/^INVALID_REQUEST\|/);
    store.getPreferences.mockRejectedValueOnce(Object.assign(new Error('EACCES: /home/prof/secret'), { code: 'EACCES' }));
    const err = await handlers.get(IPC.prefsGet)!(event('app://magistra/')).catch((e: Error) => e);
    expect(String((err as Error).message)).toBe('INTERNAL|Erreur inattendue. Réessayez.');
  });

  it('moteur IA : options { update } et { restart } validées puis transmises, expéditeur étranger refusé', async () => {
    const ai = {
      installEngine: vi.fn(async () => undefined),
      startEngineOrExplain: vi.fn(async () => true as const),
      restartEngine: vi.fn(async () => true as const),
    };
    handlers.clear();
    registerIpcHandlers({
      getWindow: () => win,
      trustedOrigins: trustedOrigins(null),
      store: store as unknown as IpcContext['store'],
      ai: ai as unknown as IpcContext['ai'],
      generation: {} as IpcContext['generation'],
      appInfo: () => ({ version: '2.0.0', platform: 'win32', userDataPath: 'C:/x', isPackaged: true }),
      openExternal,
      onAppReady,
    });
    const install = handlers.get(IPC.aiInstallEngine)!;
    await install(event('app://magistra/'));
    await install(event('app://magistra/'), { update: true });
    expect(ai.installEngine.mock.calls).toEqual([[{}], [{ update: true }]]);
    await expect(install(event('app://magistra/'), { update: true, url: 'https://evil.example/x.exe' })).rejects.toThrow(/^INVALID_REQUEST\|/);
    await expect(install(event('https://evil.example/'), { update: true })).rejects.toThrow(/^FORBIDDEN\|/);
    expect(ai.installEngine).toHaveBeenCalledTimes(2);

    const start = handlers.get(IPC.aiStartEngine)!;
    await expect(start(event('app://magistra/'))).resolves.toBe(true);
    await expect(start(event('app://magistra/'), { restart: true })).resolves.toBe(true);
    await expect(start(event('app://magistra/'), { restart: 'oui' })).rejects.toThrow(/^INVALID_REQUEST\|/);
    await expect(start(event('https://evil.example/'), { restart: true })).rejects.toThrow(/^FORBIDDEN\|/);
    expect(ai.startEngineOrExplain).toHaveBeenCalledTimes(1);
    expect(ai.restartEngine).toHaveBeenCalledTimes(1);
  });

  it('shell:open-external refuse les schémas dangereux', async () => {
    const open = handlers.get(IPC.openExternal)!;
    await expect(open(event('app://magistra/'), 'file:///etc/passwd')).resolves.toBe(false);
    await expect(open(event('app://magistra/'), 'javascript:alert(1)')).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    await expect(open(event('app://magistra/'), 'https://ollama.com/download')).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://ollama.com/download');
  });
});
