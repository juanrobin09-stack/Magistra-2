// Session de la fenêtre (partition dédiée) : réseau bloqué sans condition (workers partagés compris),
// protocole app:// enregistré sur cette session, permissions et téléchargements. Session Electron simulée.

import { describe, expect, it } from 'vitest';
import { APP_SCHEME, isAllowedWindowRequest, trustedOrigins } from '../../electron/security.js';
import {
  configureWindowSession, denyAllPermissions, NETWORK_URL_PATTERNS, WINDOW_PARTITION, type SessionLike,
} from '../../electron/windowSession.js';

type BeforeRequestListener = (details: { url: string; webContentsId?: number; resourceType?: string }, callback: (r: { cancel?: boolean }) => void) => void;
type PermissionRequest = (wc: unknown, permission: string, callback: (granted: boolean) => void, details: { requestingUrl: string }) => void;
type PermissionCheck = (wc: unknown, permission: string, requestingOrigin: string) => boolean;
type DownloadListener = (event: { preventDefault(): void; defaultPrevented?: boolean }, item: { getURL(): string }) => void;

function fakeSession() {
  const state = {
    filter: null as { urls: string[] } | null,
    beforeRequest: null as BeforeRequestListener | null,
    handled: [] as { scheme: string; handler: (r: Request) => Promise<Response> }[],
    permissionRequest: null as PermissionRequest | null,
    permissionCheck: null as PermissionCheck | null,
    device: null as (() => boolean) | null,
    spellChecker: null as boolean | null,
    spellLanguages: null as string[] | null,
    dictionaryUrl: null as string | null,
    willDownload: null as DownloadListener | null,
  };
  const ses = {
    setPermissionRequestHandler: (h: PermissionRequest) => (state.permissionRequest = h),
    setPermissionCheckHandler: (h: PermissionCheck) => (state.permissionCheck = h),
    setDevicePermissionHandler: (h: () => boolean) => (state.device = h),
    setSpellCheckerEnabled: (v: boolean) => (state.spellChecker = v),
    setSpellCheckerLanguages: (l: string[]) => (state.spellLanguages = l),
    setSpellCheckerDictionaryDownloadURL: (u: string) => (state.dictionaryUrl = u),
    on: (event: string, listener: DownloadListener) => {
      if (event === 'will-download') state.willDownload = listener;
    },
    webRequest: {
      onBeforeRequest: (filter: { urls: string[] }, listener: BeforeRequestListener) => {
        state.filter = filter;
        state.beforeRequest = listener;
      },
    },
    protocol: {
      handle: (scheme: string, handler: (r: Request) => Promise<Response>) => state.handled.push({ scheme, handler }),
    },
  };
  return { ses: ses as unknown as SessionLike, state };
}

function decide(listener: BeforeRequestListener | null, details: { url: string; webContentsId?: number; resourceType?: string }): boolean | undefined {
  let cancel: boolean | undefined;
  listener?.(details, r => (cancel = r.cancel));
  return cancel;
}

describe('réseau de la fenêtre', () => {
  it('application installée : aucune requête réseau autorisée', () => {
    for (const url of ['https://example.com/', 'http://127.0.0.1:11434/api/version', 'ws://localhost:5173/', 'wss://evil.example/']) {
      expect(isAllowedWindowRequest(url, null), url).toBe(false);
    }
  });

  it('développement : uniquement le serveur Vite (HTTP et WebSocket de rechargement)', () => {
    const dev = 'http://127.0.0.1:5173/';
    expect(isAllowedWindowRequest('http://127.0.0.1:5173/src/main.tsx', dev)).toBe(true);
    expect(isAllowedWindowRequest('ws://127.0.0.1:5173/?token=abc', dev)).toBe(true);
    expect(isAllowedWindowRequest('http://127.0.0.1:5174/', dev)).toBe(false);
    expect(isAllowedWindowRequest('http://localhost:5173/', dev)).toBe(false);
    expect(isAllowedWindowRequest('https://127.0.0.1:5173/', dev)).toBe(false);
    expect(isAllowedWindowRequest('wss://127.0.0.1:5173/', dev)).toBe(false);
    expect(isAllowedWindowRequest('http://127.0.0.1:11434/api/tags', dev)).toBe(false);
    expect(isAllowedWindowRequest('http://127.0.0.1:5173@evil.example/', dev)).toBe(false);
    expect(isAllowedWindowRequest('https://example.com/', dev)).toBe(false);
  });
});

describe('session de la fenêtre', () => {
  const handler = async () => new Response('ok');

  it('partition dédiée, en mémoire', () => {
    expect(WINDOW_PARTITION).toBe('magistra-ui');
    expect(WINDOW_PARTITION.startsWith('persist:')).toBe(false);
  });

  it('annule toute requête http/https/ws/wss, y compris celles d’un worker partagé sans webContentsId', () => {
    const { ses, state } = fakeSession();
    configureWindowSession(ses, { origins: trustedOrigins(null), devServerUrl: null, appProtocolHandler: handler });
    expect(state.filter).toEqual({ urls: NETWORK_URL_PATTERNS });
    expect(NETWORK_URL_PATTERNS).toEqual(['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']);
    // Page de la fenêtre.
    expect(decide(state.beforeRequest, { url: 'https://example.com/', webContentsId: 1, resourceType: 'xhr' })).toBe(true);
    // SharedWorker / service worker : aucune page rattachée (l'ancien filtre les laissait passer).
    expect(decide(state.beforeRequest, { url: 'https://example.com/exfiltration', resourceType: 'xhr' })).toBe(true);
    expect(decide(state.beforeRequest, { url: 'http://127.0.0.1:11434/api/chat' })).toBe(true);
    expect(decide(state.beforeRequest, { url: 'wss://evil.example/socket' })).toBe(true);
  });

  it('enregistre app:// sur CETTE session (et non sur la session par défaut)', () => {
    const { ses, state } = fakeSession();
    configureWindowSession(ses, { origins: trustedOrigins(null), devServerUrl: null, appProtocolHandler: handler });
    expect(state.handled).toEqual([{ scheme: APP_SCHEME, handler }]);
  });

  it('développement : seul le serveur Vite est joignable, app:// non enregistré', () => {
    const { ses, state } = fakeSession();
    const dev = 'http://127.0.0.1:5173/';
    configureWindowSession(ses, { origins: trustedOrigins(dev), devServerUrl: dev });
    expect(state.handled).toEqual([]);
    expect(decide(state.beforeRequest, { url: 'http://127.0.0.1:5173/@vite/client', webContentsId: 1 })).toBe(false);
    expect(decide(state.beforeRequest, { url: 'ws://127.0.0.1:5173/?token=x', webContentsId: 1 })).toBe(false);
    expect(decide(state.beforeRequest, { url: 'https://example.com/' })).toBe(true);
    expect(decide(state.beforeRequest, { url: 'http://127.0.0.1:11434/api/tags', webContentsId: 1 })).toBe(true);
  });

  it('permissions : seul le presse-papiers pour l’application ; correcteur et téléchargements tiers désactivés', () => {
    const { ses, state } = fakeSession();
    configureWindowSession(ses, { origins: trustedOrigins(null), devServerUrl: null, appProtocolHandler: handler });
    const ask = (permission: string, requestingUrl: string) => {
      let granted: boolean | undefined;
      state.permissionRequest?.(null, permission, g => (granted = g), { requestingUrl });
      return granted;
    };
    expect(ask('clipboard-sanitized-write', 'app://magistra/app/generate')).toBe(true);
    expect(ask('clipboard-sanitized-write', 'https://evil.example/')).toBe(false);
    expect(ask('media', 'app://magistra/')).toBe(false);
    expect(ask('geolocation', 'app://magistra/')).toBe(false);
    expect(state.permissionCheck?.(null, 'clipboard-sanitized-write', 'app://magistra')).toBe(true);
    expect(state.permissionCheck?.(null, 'notifications', 'app://magistra')).toBe(false);
    expect(state.device?.()).toBe(false);
    expect(state.spellChecker).toBe(false);
    expect(state.spellLanguages).toEqual([]);
    expect(state.dictionaryUrl).toBe('http://127.0.0.1:9/');

    const download = (url: string) => {
      let prevented = false;
      state.willDownload?.({ preventDefault: () => (prevented = true) }, { getURL: () => url });
      return !prevented;
    };
    expect(download('blob:app://magistra/1234-5678')).toBe(true);
    expect(download('data:text/markdown;base64,IyBUaXRyZQ==')).toBe(true);
    expect(download('https://example.com/malware.exe')).toBe(false);
    expect(download('blob:https://evil.example/1234')).toBe(false);
  });

  it('session par défaut (réseau du processus principal) : toute permission refusée', () => {
    const { ses, state } = fakeSession();
    denyAllPermissions(ses);
    let granted: boolean | undefined;
    state.permissionRequest?.(null, 'clipboard-sanitized-write', g => (granted = g), { requestingUrl: 'app://magistra/' });
    expect(granted).toBe(false);
    expect(state.permissionCheck?.(null, 'clipboard-sanitized-write', 'app://magistra')).toBe(false);
    expect(state.device?.()).toBe(false);
  });
});
