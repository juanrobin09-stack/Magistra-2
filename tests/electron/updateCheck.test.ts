// « Rechercher une mise à jour » : comparaison de versions, réponse de l'API GitHub (404, malformée, trop grosse),
// lien hors du dépôt officiel refusé, redirections, erreurs réseau ; canal IPC (expéditeur vérifié) et preload.
// fetch simulé : aucun accès réseau réel.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const exposed: Record<string, unknown> = {};
const invoke = vi.fn(async (..._args: unknown[]) => 'ok');

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: () => undefined,
    removeHandler: (channel: string) => handlers.delete(channel),
    removeListener: () => undefined,
  },
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; } },
  ipcRenderer: { invoke: (...args: unknown[]) => invoke(...args), send: () => undefined, on: () => undefined, removeListener: () => undefined },
}));

import type { FetchLike } from '../../shared/ai/provider.js';
import { IPC, type MagistraBridge } from '../../shared/ipc.js';
import { registerIpcHandlers, type IpcContext } from '../../electron/ipc.js';
import { trustedOrigins } from '../../electron/security.js';
import {
  checkForUpdate, compareVersions, parseVersion, RELEASES_API_URL, releasePageUrl, UPDATE_CHECK_OFFLINE_MESSAGE,
  UPDATE_CHECK_UNAVAILABLE_MESSAGE,
} from '../../electron/updateCheck.js';

const PAGE = 'https://github.com/juanrobin09-stack/magistra-2/releases/tag/v2.1.0';

function release(tag: unknown, url: unknown = PAGE): Response {
  return Response.json({ tag_name: tag, html_url: url, name: 'Magistra', assets: [] });
}

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  };
  return { fetch, calls };
}

describe('numéros de version', () => {
  it('semver, préfixe « v » toléré', () => {
    expect(parseVersion('2.0.0')).toEqual({ major: 2, minor: 0, patch: 0, prerelease: [] });
    expect(parseVersion('v2.1.3')).toEqual({ major: 2, minor: 1, patch: 3, prerelease: [] });
    expect(parseVersion('V10.0.1-beta.2+build.7')).toEqual({ major: 10, minor: 0, patch: 1, prerelease: ['beta', '2'] });
    for (const bad of ['2.1', 'v2', '2.1.0.4', 'latest', '02.1.0', '', ' ', 'v2.1.0 ; rm -rf', 42, null, undefined, '1'.repeat(80)]) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });

  it('ordre semver (pré-versions comprises)', () => {
    const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!));
    expect(cmp('2.0.0', '2.0.0')).toBe(0);
    expect(cmp('v2.0.0', '2.0.0')).toBe(0);
    expect(cmp('2.0.1', '2.0.0')).toBe(1);
    expect(cmp('2.1.0', '2.0.9')).toBe(1);
    expect(cmp('10.0.0', '9.9.9')).toBe(1);
    expect(cmp('1.9.9', '2.0.0')).toBe(-1);
    expect(cmp('2.1.0-beta.1', '2.1.0')).toBe(-1);
    expect(cmp('2.1.0-beta.2', '2.1.0-beta.10')).toBe(-1);
    expect(cmp('2.1.0-alpha', '2.1.0-beta')).toBe(-1);
    expect(cmp('2.1.0-beta', '2.1.0-beta.1')).toBe(-1);
    expect(cmp('2.1.0-1', '2.1.0-alpha')).toBe(-1);
    expect(cmp('2.1.0-beta.1', '2.0.0')).toBe(1);
  });

  it('lien de version : uniquement le dépôt officiel sur github.com', () => {
    expect(releasePageUrl(PAGE)).toBe(PAGE);
    for (const bad of [
      'https://github.com/juanrobin09-stack/autre-depot/releases/tag/v2.1.0',
      'https://github.com/pirate/magistra-2/releases/tag/v2.1.0',
      'https://evil.example/juanrobin09-stack/magistra-2/releases/tag/v2.1.0',
      'http://github.com/juanrobin09-stack/magistra-2/releases/tag/v2.1.0',
      'https://github.com.evil.example/juanrobin09-stack/magistra-2/releases/',
      'https://user:pass@github.com/juanrobin09-stack/magistra-2/releases/tag/v2.1.0',
      'https://github.com/juanrobin09-stack/magistra-2/releases/../../pirate/releases/tag/v9',
      'https://github.com/juanrobin09-stack/magistra-2/releases/%2e%2e/%2e%2e/pirate/tag/v9',
      'https://github.com/juanrobin09-stack/magistra-2/releases/',
      'javascript:alert(1)',
      42,
    ]) {
      expect(releasePageUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('recherche d’une mise à jour', () => {
  it('nouvelle version : lien vers la page de la version ; une seule requête, adresse fixe, sans redirection automatique', async () => {
    const { fetch, calls } = fakeFetch(() => release('v2.1.0'));
    await expect(checkForUpdate({ fetch, currentVersion: '2.0.0' })).resolves.toEqual({
      currentVersion: '2.0.0', latestVersion: '2.1.0', upToDate: false, url: PAGE,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RELEASES_API_URL);
    expect(calls[0].init?.redirect).toBe('manual');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0].init?.headers).get('user-agent')).toMatch(/^Magistra\/2\.0\.0 /);
  });

  it('à jour (même version, ou version publiée plus ancienne) : pas de lien', async () => {
    for (const tag of ['v2.0.0', '2.0.0', 'v1.9.0', 'v2.0.0-rc.1']) {
      const { fetch } = fakeFetch(() => release(tag));
      const result = await checkForUpdate({ fetch, currentVersion: '2.0.0' });
      expect(result, tag).toMatchObject({ currentVersion: '2.0.0', upToDate: true });
      expect(result.url, tag).toBeUndefined();
    }
  });

  it('aucune version publiée (404) : « aucune version » et non une erreur', async () => {
    const { fetch } = fakeFetch(() => new Response('{"message":"Not Found"}', { status: 404 }));
    await expect(checkForUpdate({ fetch, currentVersion: '2.0.0' })).resolves.toEqual({
      currentVersion: '2.0.0', latestVersion: null, upToDate: true,
    });
  });

  it('pas de connexion : message clair', async () => {
    const { fetch } = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    });
    await expect(checkForUpdate({ fetch, currentVersion: '2.0.0' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: UPDATE_CHECK_OFFLINE_MESSAGE });
    expect(UPDATE_CHECK_OFFLINE_MESSAGE).toBe('Vérification impossible (pas de connexion Internet ?)');
  });

  it('délai de 10 s : la requête est interrompue', async () => {
    const { fetch } = fakeFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('délai', 'TimeoutError')), { once: true });
    }));
    await expect(checkForUpdate({ fetch, currentVersion: '2.0.0', timeoutMs: 30 })).rejects.toMatchObject({ message: UPDATE_CHECK_OFFLINE_MESSAGE });
  });

  it('réponse malformée, erreur du service ou lien hors du dépôt : refus, aucun lien renvoyé', async () => {
    const cases: [string, () => Response][] = [
      ['JSON invalide', () => new Response('<html>proxy</html>', { status: 200 })],
      ['objet vide', () => Response.json({})],
      ['tableau', () => Response.json([])],
      ['tag non semver', () => release('nightly')],
      ['tag absent', () => release(undefined)],
      ['lien d’un autre dépôt', () => release('v9.0.0', 'https://github.com/pirate/magistra-2/releases/tag/v9.0.0')],
      ['lien hors github.com', () => release('v9.0.0', 'https://evil.example/magistra.exe')],
      ['lien absent', () => release('v9.0.0', null)],
      ['limite de requêtes (403)', () => new Response('{"message":"rate limit"}', { status: 403 })],
      ['erreur serveur (502)', () => new Response('bad gateway', { status: 502 })],
    ];
    for (const [label, respond] of cases) {
      const { fetch } = fakeFetch(respond);
      await expect(checkForUpdate({ fetch, currentVersion: '2.0.0' }), label).rejects.toMatchObject({
        code: 'NETWORK_ERROR', message: UPDATE_CHECK_UNAVAILABLE_MESSAGE,
      });
    }
  });

  it('réponse trop volumineuse : refusée (annoncée ou réelle)', async () => {
    const huge = JSON.stringify({ tag_name: 'v2.1.0', html_url: PAGE, body: 'x'.repeat(600_000) });
    const declared = fakeFetch(() => new Response(huge, { headers: { 'content-length': String(huge.length) } }));
    await expect(checkForUpdate({ fetch: declared.fetch, currentVersion: '2.0.0' })).rejects.toMatchObject({ message: UPDATE_CHECK_UNAVAILABLE_MESSAGE });
    const streamed = fakeFetch(() => new Response(new Blob([huge]).stream()));
    await expect(checkForUpdate({ fetch: streamed.fetch, currentVersion: '2.0.0' })).rejects.toMatchObject({ message: UPDATE_CHECK_UNAVAILABLE_MESSAGE });
  });

  it('redirection : suivie dans api.github.com seulement', async () => {
    const moved = 'https://api.github.com/repositories/123456/releases/latest';
    const inside = fakeFetch(url => (url === RELEASES_API_URL
      ? new Response(null, { status: 301, headers: { location: moved } })
      : release('v2.1.0')));
    await expect(checkForUpdate({ fetch: inside.fetch, currentVersion: '2.0.0' })).resolves.toMatchObject({ upToDate: false, url: PAGE });
    expect(inside.calls.map(c => c.url)).toEqual([RELEASES_API_URL, moved]);
    expect(inside.calls.every(c => c.init?.redirect === 'manual')).toBe(true);

    for (const location of ['https://evil.example/releases/latest', 'http://api.github.com/repos/x/y/releases/latest', 'https://api.github.com.evil.example/', '']) {
      const outside = fakeFetch(url => (url === RELEASES_API_URL
        ? new Response(null, { status: 302, headers: location ? { location } : {} })
        : release('v9.9.9')));
      await expect(checkForUpdate({ fetch: outside.fetch, currentVersion: '2.0.0' }), location).rejects.toMatchObject({ message: UPDATE_CHECK_UNAVAILABLE_MESSAGE });
      expect(outside.calls, location).toHaveLength(1);
    }

    const loop = fakeFetch(() => new Response(null, { status: 301, headers: { location: moved } }));
    await expect(checkForUpdate({ fetch: loop.fetch, currentVersion: '2.0.0' })).rejects.toMatchObject({ message: UPDATE_CHECK_UNAVAILABLE_MESSAGE });
    expect(loop.calls.length).toBeLessThanOrEqual(4);
  });
});

describe('canal IPC app:check-update et pont', () => {
  const win = {
    isDestroyed: () => false,
    webContents: { id: 1, isDestroyed: () => false, mainFrame: { frameTreeNodeId: 10 } },
  };
  const event = (url: string) => ({ sender: { id: 1 }, senderFrame: { url, parent: null, frameTreeNodeId: 10 } });
  const baseContext = (over: Partial<IpcContext> = {}): IpcContext => ({
    getWindow: () => win,
    trustedOrigins: trustedOrigins(null),
    store: {} as IpcContext['store'],
    ai: {} as IpcContext['ai'],
    generation: {} as IpcContext['generation'],
    appInfo: () => ({ version: '2.0.0', platform: 'win32', userDataPath: 'C:/x', isPackaged: true }),
    openExternal: async () => undefined,
    onAppReady: () => undefined,
    connector: {} as IpcContext['connector'],
    ...over,
  });

  beforeEach(() => handlers.clear());

  it('refuse un expéditeur étranger, répond à la fenêtre Magistra', async () => {
    const check = vi.fn(async () => ({ currentVersion: '2.0.0', latestVersion: '2.1.0', upToDate: false, url: PAGE }));
    registerIpcHandlers(baseContext({ checkForUpdate: check }));
    const call = handlers.get(IPC.appCheckUpdate)!;
    await expect(call(event('https://evil.example/'))).rejects.toThrow(/^FORBIDDEN\|/);
    expect(check).not.toHaveBeenCalled();
    await expect(call(event('app://magistra/app/settings'))).resolves.toEqual({ currentVersion: '2.0.0', latestVersion: '2.1.0', upToDate: false, url: PAGE });
  });

  it('erreur transmise sous la forme « CODE|message » (sans détail technique)', async () => {
    registerIpcHandlers(baseContext({ checkForUpdate: () => checkForUpdate({ fetch: fakeFetch(() => { throw new TypeError('getaddrinfo ENOTFOUND api.github.com'); }).fetch, currentVersion: '2.0.0' }) }));
    await expect(handlers.get(IPC.appCheckUpdate)!(event('app://magistra/'))).rejects.toThrow(`NETWORK_ERROR|${UPDATE_CHECK_OFFLINE_MESSAGE}`);
  });

  describe('preload', () => {
    let bridge: MagistraBridge;
    beforeAll(async () => {
      await import('../../electron/preload.js');
      bridge = exposed.magistra as MagistraBridge;
    });

    it('window.magistra.app.checkForUpdate appelle le canal app:check-update, sans argument', async () => {
      expect(Object.keys(bridge.app).sort()).toEqual(['checkForUpdate', 'info', 'openExternal', 'ready']);
      invoke.mockClear();
      await bridge.app.checkForUpdate();
      expect(invoke).toHaveBeenCalledWith(IPC.appCheckUpdate);
    });
  });
});
