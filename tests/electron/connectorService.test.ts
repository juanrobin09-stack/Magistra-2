// Connecteur local côté application : URL magistra:// (ouvrir, appairer), boîte de consentement (texte exact,
// réactivation, remplacement, limite par minute), réglage « activé », retrait d'un navigateur, ports occupés.
// Boîte de consentement simulée ; vrai serveur HTTP sur un port éphémère.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buildPairingUrl, type ConnectorAppStatus } from '../../shared/localConnector.js';
import type { Capabilities } from '../../shared/types.js';
import type { SecretCipher } from '../../electron/aiConfig.js';
import { randomToken } from '../../electron/connector/crypto.js';
import {
  appUrlFromArgv, DEV_DISABLED_PROBLEM, LocalConnector, NO_PORT_PROBLEM, type ConnectorGenerationHost, type ConsentRequest, type LocalConnectorDeps,
} from '../../electron/connector/service.js';

const ORIGIN = 'https://magistra-2.vercel.app';

function fakeCipher(): SecretCipher {
  return {
    isAvailable: () => true,
    encrypt: plain => Buffer.from(plain, 'utf8').reverse().toString('base64'),
    decrypt: enc => Buffer.from(enc, 'base64').reverse().toString('utf8'),
  };
}

const CAPABILITIES: Capabilities = {
  maxDocumentChars: 10_000,
  research: { academic: true, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'local', message: 'IA locale' },
  engineLabel: 'Magistra Standard',
  ready: true,
};

function pairUrl(origin = ORIGIN): string {
  return buildPairingUrl({ pairingId: randomToken(16), challenge: randomToken(32), origin });
}

let dir: string;
let logs: string[];
let changes: ConnectorAppStatus[];
let generation: ConnectorGenerationHost & { cancelExternalAll: Mock<() => void>; cancelOwner: Mock<(owner: string) => void> };
let connectors: LocalConnector[];
let blockers: NetServer[];

function connector(over: Partial<LocalConnectorDeps> = {}): LocalConnector {
  const c = new LocalConnector({
    file: path.join(dir, 'local-connector.json'),
    cipher: fakeCipher(),
    version: '2.1.0',
    allowedOrigins: [ORIGIN],
    ports: [0],
    generation,
    askConsent: async () => false,
    onChange: status => changes.push(status),
    log: message => logs.push(message),
    ...over,
  });
  connectors.push(c);
  return c;
}

async function occupiedPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const s = createNetServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  blockers.push(s);
  return { port: (s.address() as { port: number }).port, release: () => new Promise<void>(r => s.close(() => r())) };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-connector-svc-'));
  logs = [];
  changes = [];
  connectors = [];
  blockers = [];
  generation = {
    startExternal: vi.fn(() => {
      throw new Error('non utilisé');
    }),
    cancelExternal: vi.fn(() => false),
    cancelOwner: vi.fn<(owner: string) => void>(),
    cancelExternalAll: vi.fn<() => void>(),
    capabilities: async () => CAPABILITIES,
    busy: false,
  };
});

afterEach(async () => {
  await Promise.all(connectors.map(c => c.stop()));
  await Promise.all(blockers.map(s => new Promise<void>(r => (s.listening ? s.close(() => r()) : r()))));
  rmSync(dir, { recursive: true, force: true });
});

describe('URL magistra:// sur la ligne de commande', () => {
  it('première URL du schéma après l’exécutable, casse du schéma indifférente', () => {
    expect(appUrlFromArgv(['C:\\Magistra\\Magistra.exe', 'magistra://open'])).toBe('magistra://open');
    expect(appUrlFromArgv(['Magistra.exe', '--allow-file-access', 'MAGISTRA://pair?v=1', 'magistra://open'])).toBe('MAGISTRA://pair?v=1');
    expect(appUrlFromArgv(['magistra://open'])).toBeNull();
    expect(appUrlFromArgv(['electron', '.', 'https://magistra-2.vercel.app'])).toBeNull();
    expect(appUrlFromArgv([])).toBeNull();
  });
});

describe('démarrage et réglage « activé »', () => {
  it('écoute au démarrage ; état sans adresse ni port', async () => {
    const c = connector();
    await c.init();
    await c.start();
    expect(c.port).toBeGreaterThan(0);
    const status = c.status();
    expect(status).toEqual({ enabled: true, listening: true, persistent: true, clients: [] });
    expect(JSON.stringify(status)).not.toContain(String(c.port));
    expect(changes.at(-1)).toMatchObject({ listening: true });
  });

  it('désactivation : n’écoute plus, générations du site arrêtées, réglage conservé au redémarrage', async () => {
    const c = connector();
    await c.init();
    await c.start();
    const status = await c.setEnabled(false);
    expect(status).toMatchObject({ enabled: false, listening: false });
    expect(status.problem).toBeUndefined();
    expect(c.port).toBeNull();
    expect(generation.cancelExternalAll).toHaveBeenCalled();
    expect(changes.at(-1)).toMatchObject({ enabled: false, listening: false });

    const next = connector();
    await next.init();
    await next.start();
    expect(next.status()).toMatchObject({ enabled: false, listening: false });
    expect((await next.setEnabled(true)).listening).toBe(true);
  });

  it('aucun port dédié libre : cause affichée (sans port), nouvel essai automatique', async () => {
    const blocker = await occupiedPort();
    const c = connector({ ports: [blocker.port], retryMs: 40 });
    await c.init();
    await c.start();
    expect(c.status()).toMatchObject({ enabled: true, listening: false, problem: NO_PORT_PROBLEM });
    expect(NO_PORT_PROBLEM).not.toMatch(/\d/);
    await blocker.release();
    const deadline = Date.now() + 3_000;
    while (!c.status().listening && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    expect(c.status()).toEqual({ enabled: true, listening: true, persistent: true, clients: [] });
    expect(changes.at(-1)).toMatchObject({ listening: true });
  });

  it('option de développement : connecteur éteint pour ce lancement', async () => {
    const c = connector({ disabledForSession: true });
    await c.init();
    await c.start();
    expect(c.status()).toMatchObject({ enabled: true, listening: false, problem: DEV_DISABLED_PROBLEM });
  });

  it('arrêt de l’application : plus d’écoute, demande d’appairage annulée, générations du site arrêtées', async () => {
    let seenSignal: AbortSignal | null = null;
    const c = connector({
      askConsent: (_r, signal) => {
        seenSignal = signal;
        return new Promise(resolve => signal.addEventListener('abort', () => resolve(false)));
      },
    });
    await c.init();
    await c.start();
    const pending = c.handleAppUrl(pairUrl(), () => undefined);
    await vi.waitFor(() => expect(seenSignal).not.toBeNull());
    await c.stop();
    await pending;
    expect(seenSignal!.aborted).toBe(true);
    expect(c.pairing.pending).toBeNull();
    expect(c.status().listening).toBe(false);
    expect(generation.cancelExternalAll).toHaveBeenCalled();
  });
});

describe('URL magistra:// et consentement', () => {
  it('forme inattendue : ignorée (journal seulement) ; « open » : fenêtre au premier plan', async () => {
    const askConsent = vi.fn(async () => true);
    const focus = vi.fn();
    const c = connector({ askConsent });
    await c.init();
    for (const raw of ['magistra://format-disk', 'magistra://pair?v=1', 'https://magistra-2.vercel.app', 42, `magistra://open?x=1`]) {
      await c.handleAppUrl(raw, focus);
    }
    expect(focus).not.toHaveBeenCalled();
    expect(askConsent).not.toHaveBeenCalled();
    expect(logs.filter(l => l.includes('forme inattendue'))).toHaveLength(5);
    await c.handleAppUrl('magistra://open/', focus);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('site non officiel : aucune boîte, aucune fenêtre, journal seulement', async () => {
    const askConsent = vi.fn(async () => true);
    const focus = vi.fn();
    const c = connector({ askConsent });
    await c.init();
    await c.handleAppUrl(pairUrl('https://evil.example'), focus);
    await c.handleAppUrl(pairUrl('http://localhost:5173'), focus);
    expect(askConsent).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(c.pairing.pending).toBeNull();
    expect(logs.some(l => l.includes('site non autorisé (evil.example)'))).toBe(true);
  });

  it('site officiel : fenêtre au premier plan puis boîte au texte exact ; accord ou refus appliqué à la demande', async () => {
    const requests: ConsentRequest[] = [];
    let answer = true;
    const focus = vi.fn();
    const c = connector({
      askConsent: async request => {
        expect(focus).toHaveBeenCalled();
        requests.push(request);
        return answer;
      },
    });
    await c.init();
    await c.start();
    await c.handleAppUrl(pairUrl(), focus);
    expect(requests[0]).toEqual({
      origin: ORIGIN,
      site: 'magistra-2.vercel.app',
      message: 'Autoriser magistra-2.vercel.app à utiliser l’intelligence locale de cet ordinateur ?',
      detail: expect.stringContaining('demandes de génération'),
      reenables: false,
    });
    expect(requests[0].detail).toContain('aucun accès à vos fichiers, à vos autres applications ni aux réglages');
    expect(requests[0].detail).toContain('Magistra → Réglages → « Site web Magistra »');
    expect(requests[0].detail).not.toContain('réactivera');
    expect(c.pairing.pending).toMatchObject({ state: 'approved', origin: ORIGIN });

    answer = false;
    await c.handleAppUrl(pairUrl(), focus);
    expect(c.pairing.pending).toMatchObject({ state: 'refused' });
  });

  it('connecteur désactivé : la boîte le dit, l’accord le réactive', async () => {
    const requests: ConsentRequest[] = [];
    const c = connector({
      askConsent: async request => {
        requests.push(request);
        return true;
      },
    });
    await c.init();
    await c.start();
    await c.setEnabled(false);
    await c.handleAppUrl(pairUrl(), () => undefined);
    expect(requests[0].reenables).toBe(true);
    expect(requests[0].detail).toContain('« Autoriser » le réactivera');
    expect(c.status()).toMatchObject({ enabled: true, listening: true });
    expect(c.pairing.pending).toMatchObject({ state: 'approved' });
  });

  it('nouvelle demande pendant qu’une boîte est ouverte : l’ancienne boîte se ferme, sa réponse est ignorée', async () => {
    const signals: AbortSignal[] = [];
    const c = connector({
      askConsent: (_request, signal) => {
        signals.push(signal);
        // L'enseignant ne répond pas : la boîte ne se ferme que si la demande est remplacée.
        if (signals.length === 1) return new Promise(resolve => signal.addEventListener('abort', () => resolve(true)));
        return Promise.resolve(false);
      },
    });
    await c.init();
    const first = c.handleAppUrl(pairUrl(), () => undefined);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const secondUrl = pairUrl();
    await c.handleAppUrl(secondUrl, () => undefined);
    await first;
    expect(signals[0].aborted).toBe(true);
    // La « réponse » de la boîte fermée (true) ne s'est appliquée à aucune demande.
    expect(c.pairing.pending).toMatchObject({ pairingId: new URL(secondUrl).searchParams.get('id'), state: 'refused' });
  });

  it('au plus 3 boîtes par minute ; même demande reçue deux fois : une seule boîte', async () => {
    const askConsent = vi.fn(async () => false);
    const focus = vi.fn();
    const c = connector({ askConsent });
    await c.init();
    const url = pairUrl();
    await c.handleAppUrl(url, focus);
    await c.handleAppUrl(url, focus);
    expect(askConsent).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) await c.handleAppUrl(pairUrl(), focus);
    expect(askConsent).toHaveBeenCalledTimes(3);
    expect(logs.some(l => l.includes('trop de demandes'))).toBe(true);
  });

  it('boîte impossible à afficher : la demande est retirée (jamais acceptée par défaut)', async () => {
    const c = connector({
      askConsent: async () => {
        throw new Error('pas de fenêtre');
      },
    });
    await c.init();
    await c.handleAppUrl(pairUrl(), () => undefined);
    expect(c.pairing.pending).toBeNull();
  });
});

describe('navigateurs autorisés', () => {
  it('retrait : génération éventuelle arrêtée, liste mise à jour, fenêtre prévenue', async () => {
    const c = connector();
    await c.init();
    const info = await c.clients.add({ origin: ORIGIN, browser: 'Google Chrome', key: Buffer.alloc(32, 3) });
    expect(c.status().clients).toEqual([info]);
    changes.length = 0;
    const status = await c.revoke(info.clientId);
    expect(generation.cancelOwner).toHaveBeenCalledWith(info.clientId);
    expect(status.clients).toEqual([]);
    expect(changes.at(-1)?.clients).toEqual([]);
    // Retrait d'un navigateur inconnu : sans effet, sans erreur.
    await expect(c.revoke(randomToken(16))).resolves.toMatchObject({ clients: [] });
  });
});
