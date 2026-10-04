// Sécurité du processus principal : origine de l'application, expéditeur IPC, liens externes,
// et enregistrement réel des canaux IPC (module electron simulé).

import { readFileSync } from 'node:fs';
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
import { OFFICIAL_WEB_ORIGINS } from '../../shared/localConnector.js';
import { registerIpcHandlers, type IpcContext } from '../../electron/ipc.js';
import {
  APP_ORIGIN, isSafeExternalUrl, isSafeMailtoUrl, isTrustedSender, isTrustedUrl, originOf, parseDevServerUrl, trustedOrigins,
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

  it('le site Magistra (nouveau domaine, ancienne adresse, leurs pages) n’est jamais une origine de l’application : aucun accès IPC, même avec le serveur de développement', () => {
    const win = fakeWindow();
    const dev = trustedOrigins(parseDevServerUrl('http://localhost:5173/'));
    for (const site of OFFICIAL_WEB_ORIGINS) {
      for (const url of [site, `${site}/`, `${site}/app`, `${site}/telecharger`, `${site}/mentions-legales`]) {
        expect(isTrustedUrl(url, origins), url).toBe(false);
        expect(isTrustedUrl(url, dev), url).toBe(false);
        expect(isTrustedSender(event(url), win, origins), url).toBe(false);
        expect(isTrustedSender(event(url), win, dev), url).toBe(false);
      }
    }
    // Les origines de confiance restent app://magistra (et le serveur de développement local) : rien d'autre.
    expect(origins).toEqual([APP_ORIGIN]);
    expect(dev).toEqual([APP_ORIGIN, 'http://localhost:5173']);
  });

  it('liens vers le site Magistra : navigateur du système (jamais la fenêtre), comme tout lien http(s) sûr ; adresses piégées avec identifiants refusées', () => {
    // Décision de electron/main.ts (will-navigate, setWindowOpenHandler) : lien sûr ET hors des origines de confiance.
    const opensInSystemBrowser = (url: string) => isSafeExternalUrl(url) && !isTrustedUrl(url, origins);
    for (const site of OFFICIAL_WEB_ORIGINS) {
      for (const url of [`${site}/`, `${site}/telecharger`, `${site}/mentions-legales`, `${site}/#magistra-windows`]) expect(opensInSystemBrowser(url), url).toBe(true);
      const host = new URL(site).host;
      for (const url of [`https://user@${host}/`, `https://user:mot@${host}/`, `https://${host}@evil.example/`, `${site}/\n`, `${site}/ telecharger`, `javascript:alert('${host}')`, `file:///${host}`]) {
        expect(opensInSystemBrowser(url), url).toBe(false);
      }
    }
    const main = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('if ((isSafeExternalUrl(url) && !isTrustedUrl(url, origins)) || isSafeMailtoUrl(url)) {');
    expect(main.match(/openExternalSafely\(/g)?.length).toBeGreaterThanOrEqual(3);
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

  it("n'ouvre dans la messagerie du système que l'adresse de contact simple (« mailto: » sans paramètre)", () => {
    expect(isSafeMailtoUrl('mailto:juanrobin89@gmail.com')).toBe(true);
    expect(isSafeMailtoUrl('mailto:aide.magistra+rgpd@exemple.univ-test.fr')).toBe(true);
    for (const url of [
      'mailto:juanrobin89@gmail.com?subject=x', 'mailto:juanrobin89@gmail.com?attach=C:\\Windows\\win.ini', 'mailto:a@b.fr,c@d.fr',
      'mailto:', 'mailto:sans-arobase', 'mailto:a@b', 'mailto:a@b.fr\n', 'mailto:a@b.fr ', 'mailto:a b@c.fr', 'mailto:%0d@b.fr?bcc=x@y.fr',
      `mailto:${'x'.repeat(400)}@exemple.fr`, 'https://exemple.fr/', 'javascript:alert(1)', 'file:///C:/Windows/win.ini', 42, null,
    ]) {
      expect(isSafeMailtoUrl(url)).toBe(false);
    }
    // Ce n'est pas un lien http(s) : l'ouverture par le pont (isSafeExternalUrl) reste réservée à http(s).
    expect(isSafeExternalUrl('mailto:juanrobin89@gmail.com')).toBe(false);
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
  const connectorStatus = { enabled: true, listening: true, persistent: true, clients: [] };
  const connector = {
    status: vi.fn(() => connectorStatus),
    revoke: vi.fn(async (_clientId: string) => connectorStatus),
    setEnabled: vi.fn(async (_enabled: boolean) => connectorStatus),
  };

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
      connector,
    });
  });

  it('enregistre tous les canaux invoqués du contrat', () => {
    // Évènements du processus principal vers la fenêtre (aucun gestionnaire) et signal app:ready (écouteur).
    const events: string[] = [IPC.aiProgress, IPC.genEvent, IPC.connectorChanged, IPC.appUpdateProgress, IPC.appReady];
    const invoked = Object.values(IPC).filter(c => !events.includes(c));
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
      connector,
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

  it('connecteur local : identifiant de navigateur et booléen validés, expéditeur étranger refusé', async () => {
    const clientId = 'AAAAAAAAAAAAAAAAAAAAAA';
    await expect(handlers.get(IPC.connectorStatus)!(event('app://magistra/'))).resolves.toEqual(connectorStatus);
    const revoke = handlers.get(IPC.connectorRevoke)!;
    await expect(revoke(event('app://magistra/'), clientId)).resolves.toEqual(connectorStatus);
    expect(connector.revoke).toHaveBeenCalledWith(clientId);
    for (const bad of ['../../ai-config', '', 'A'.repeat(23), 'A'.repeat(64), 42, null, { clientId }]) {
      await expect(revoke(event('app://magistra/'), bad)).rejects.toThrow(/^INVALID_REQUEST\|/);
    }
    await expect(revoke(event('https://magistra-2.vercel.app/'), clientId)).rejects.toThrow(/^FORBIDDEN\|/);
    expect(connector.revoke).toHaveBeenCalledTimes(1);

    const setEnabled = handlers.get(IPC.connectorSetEnabled)!;
    await setEnabled(event('app://magistra/'), false);
    expect(connector.setEnabled).toHaveBeenCalledWith(false);
    for (const bad of ['false', 0, 1, null, undefined, { enabled: true }]) {
      await expect(setEnabled(event('app://magistra/'), bad)).rejects.toThrow(/^INVALID_REQUEST\|/);
    }
    await expect(setEnabled(event('https://evil.example/'), true)).rejects.toThrow(/^FORBIDDEN\|/);
    expect(connector.setEnabled).toHaveBeenCalledTimes(1);
    // Aucun évènement IPC n'est accepté dans ce sens : connector:changed n'est émis que par le processus principal.
    expect(handlers.has(IPC.connectorChanged)).toBe(false);
  });

  it('le site Magistra n’a aucun accès IPC (nouveau domaine, ancienne adresse), mais ses liens s’ouvrent dans le navigateur du système', async () => {
    const open = handlers.get(IPC.openExternal)!;
    for (const site of OFFICIAL_WEB_ORIGINS) {
      await expect(open(event(`${site}/`), `${site}/telecharger`)).rejects.toThrow(/^FORBIDDEN\|/);
      await expect(handlers.get(IPC.prefsGet)!(event(`${site}/`))).rejects.toThrow(/^FORBIDDEN\|/);
      await expect(handlers.get(IPC.connectorSetEnabled)!(event(`${site}/`), true)).rejects.toThrow(/^FORBIDDEN\|/);
    }
    expect(openExternal).not.toHaveBeenCalled();
    expect(store.getPreferences).not.toHaveBeenCalled();
    expect(connector.setEnabled).not.toHaveBeenCalled();
    for (const site of OFFICIAL_WEB_ORIGINS) await expect(open(event('app://magistra/'), `${site}/telecharger`)).resolves.toBe(true);
    expect(openExternal.mock.calls).toEqual(OFFICIAL_WEB_ORIGINS.map(site => [`${site}/telecharger`]));
    openExternal.mockClear();
    for (const bad of ['https://www.mag-istra.fr@evil.example/', 'https://user@www.mag-istra.fr/', 'https://www.mag-istra.fr:443@evil.example/']) {
      await expect(open(event('app://magistra/'), bad)).resolves.toBe(false);
    }
    expect(openExternal).not.toHaveBeenCalled();
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
