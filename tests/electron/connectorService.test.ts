// Connecteur local côté application : URL magistra:// (ouvrir, appairer), boîte de consentement (texte exact,
// réactivation, remplacement, limite par minute), réglage « activé », retrait d'un navigateur, ports occupés.
// Boîte de consentement simulée ; vrai serveur HTTP sur un port éphémère.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buildPairingUrl, OFFICIAL_WEB_ORIGINS, PAIR_CODE_RE, parseAppUrl, type ConnectorAppStatus } from '../../shared/localConnector.js';
import type { Capabilities } from '../../shared/types.js';
import type { SecretCipher } from '../../electron/aiConfig.js';
import { pairCode, randomToken } from '../../electron/connector/crypto.js';
import { withFileLock } from '../../electron/jsonFile.js';
import {
  appUrlFromArgv, DEV_DISABLED_PROBLEM, LocalConnector, NO_PORT_PROBLEM, PROTOCOL_HANDLER_ARGS, type ConnectorGenerationHost, type ConsentRequest, type LocalConnectorDeps,
} from '../../electron/connector/service.js';
import { originTraps, unicodeTraps } from './officialOrigins.js';

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

  it('commande inscrite « "<exe>" -- "%1" » : aucune option après « -- » ; l’URL doit y être SEULE (sinon URL piégée ignorée)', () => {
    // Windows remplace %1 tel quel : une URL piégée par des guillemets se retrouve en plusieurs arguments.
    expect(PROTOCOL_HANDLER_ARGS).toEqual(['--']);
    const url = 'magistra://pair?v=2&id=AAAAAAAAAAAAAAAAAAAAAA&challenge=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&origin=https%3A%2F%2Fmagistra-2.vercel.app';
    expect(appUrlFromArgv(['Magistra.exe', '--', url])).toBe(url);
    // Deuxième instance : options ajoutées par Chromium AVANT « -- ».
    expect(appUrlFromArgv(['Magistra.exe', '--allow-file-access-from-files', '--', 'magistra://open'])).toBe('magistra://open');
    expect(appUrlFromArgv(['Magistra.exe', '--', 'magistra://open', '--gpu-launcher=cmd /c calc.exe &&', '--no-sandbox'])).toBeNull();
    expect(appUrlFromArgv(['Magistra.exe', '--', 'magistra://open', 'magistra://pair'])).toBeNull();
    expect(appUrlFromArgv(['Magistra.exe', 'magistra://open', '--'])).toBeNull();
    expect(appUrlFromArgv(['Magistra.exe', '--', 'https://evil.example'])).toBeNull();
    expect(appUrlFromArgv(['Magistra.exe', '--'])).toBeNull();
  });

  it('l’application inscrit ET vérifie le schéma avec ces arguments (jamais « "<exe>" "%1" » sans « -- »)', () => {
    const main = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
    const calls = [...main.matchAll(/\b(?:setAs|is)DefaultProtocolClient\(([^)]*)\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
    expect(calls).toEqual(['CONNECTOR_URL_SCHEME, process.execPath, args', 'CONNECTOR_URL_SCHEME, process.execPath, args']);
    expect(main).toContain('const args = [...PROTOCOL_HANDLER_ARGS];');
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

  it('désactivation : effet IMMÉDIAT — serveur fermé et générations du site arrêtées avant la fin de l’écriture du réglage (lente ou impossible)', async () => {
    const c = connector();
    await c.init();
    await c.start();
    expect(c.port).not.toBeNull();
    // Écriture retenue (verrou d'antivirus, file d'écritures).
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>(resolve => (started = resolve));
    const held = withFileLock(path.join(dir, 'local-connector.json'), () => new Promise<void>(resolve => {
      release = resolve;
      started();
    }));
    await running;
    const disabling = c.setEnabled(false);
    await vi.waitFor(() => expect(c.port).toBeNull(), { timeout: 2_000 });
    expect(generation.cancelExternalAll).toHaveBeenCalled();
    release();
    await held;
    expect(await disabling).toMatchObject({ enabled: false, listening: false });
    expect(JSON.parse(readFileSync(path.join(dir, 'local-connector.json'), 'utf8'))).toMatchObject({ enabled: false });
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
    const url = pairUrl();
    await c.handleAppUrl(url, focus);
    const parsed = parseAppUrl(url);
    if (parsed?.kind !== 'pair') throw new Error('URL magistra://pair attendue');
    expect(requests[0]).toEqual({
      origin: ORIGIN,
      site: 'magistra-2.vercel.app',
      message: 'Autoriser magistra-2.vercel.app à utiliser l’intelligence locale de cet ordinateur ?',
      detail: expect.stringContaining('demandes de génération'),
      code: pairCode(parsed.challenge),
      reenables: false,
    });
    // Code de vérification de CETTE demande (le site affiche le même) : une demande que l'enseignant n'a pas faite
    // depuis le site ne correspond à aucun code affiché.
    expect(requests[0].code).toMatch(PAIR_CODE_RE);
    expect(requests[0].detail).toContain(`Code de vérification : ${requests[0].code}.`);
    expect(requests[0].detail).toContain('si vous n’avez pas demandé cette connexion à l’instant, cliquez sur « Refuser »');
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

describe('URL magistra://pair : origines officielles (OFFICIAL_WEB_ORIGINS), exactes', () => {
  it.each([...OFFICIAL_WEB_ORIGINS])('%s : fenêtre au premier plan, boîte au texte exact (nom d’hôte), demande en attente', async origin => {
    const requests: ConsentRequest[] = [];
    const focus = vi.fn();
    const c = connector({
      allowedOrigins: [...OFFICIAL_WEB_ORIGINS],
      askConsent: async request => {
        requests.push(request);
        return true;
      },
    });
    await c.init();
    await c.start();
    await c.handleAppUrl(pairUrl(origin), focus);
    const host = new URL(origin).host;
    expect(focus).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ origin, site: host, message: `Autoriser ${host} à utiliser l’intelligence locale de cet ordinateur ?` });
    expect(c.pairing.pending).toMatchObject({ origin, state: 'approved' });
    expect(logs.filter(l => l.includes('ignorée'))).toEqual([]);
  });

  it('le nouveau domaine : boîte « Autoriser www.mag-istra.fr à utiliser l’intelligence locale de cet ordinateur ? »', async () => {
    const requests: ConsentRequest[] = [];
    const c = connector({ allowedOrigins: [...OFFICIAL_WEB_ORIGINS], askConsent: async request => (requests.push(request), false) });
    await c.init();
    await c.handleAppUrl(pairUrl('https://www.mag-istra.fr'), vi.fn());
    expect(requests.map(r => r.message)).toEqual(['Autoriser www.mag-istra.fr à utiliser l’intelligence locale de cet ordinateur ?']);
    expect(c.pairing.pending).toMatchObject({ origin: 'https://www.mag-istra.fr', state: 'refused' });
  });

  it.each([...OFFICIAL_WEB_ORIGINS])('variantes piégées de %s (apex, http, port, identifiants, sous-domaine, suffixe, préfixe, casse, point final, punycode, Unicode…) : aucune boîte, aucune fenêtre', async official => {
    const askConsent = vi.fn(async () => true);
    const focus = vi.fn();
    const c = connector({ allowedOrigins: [...OFFICIAL_WEB_ORIGINS], askConsent });
    await c.init();
    const traps = [...originTraps(official), ...unicodeTraps(official)];
    expect(traps.length).toBeGreaterThan(70);
    for (const trap of traps) await c.handleAppUrl(pairUrl(trap), focus);
    expect(askConsent).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(c.pairing.pending).toBeNull();
    // Chaque variante est ignorée, pour l'une des deux raisons : forme inattendue (origine mal formée) ou site non autorisé.
    const ignored = logs.filter(l => l.includes('forme inattendue') || l.includes('site non autorisé'));
    expect(ignored).toHaveLength(traps.length);
    expect(logs).toHaveLength(traps.length);
  });

  it('l’apex et un sous-domaine, bien formés, sont refusés comme « site non autorisé » (journal : le nom d’hôte seulement)', async () => {
    const askConsent = vi.fn(async () => true);
    const c = connector({ allowedOrigins: [...OFFICIAL_WEB_ORIGINS], askConsent });
    await c.init();
    await c.handleAppUrl(pairUrl('https://mag-istra.fr'), vi.fn());
    await c.handleAppUrl(pairUrl('https://app.www.mag-istra.fr'), vi.fn());
    await c.handleAppUrl(pairUrl('https://www.mag-istra.fr:8443'), vi.fn());
    expect(askConsent).not.toHaveBeenCalled();
    expect(logs).toEqual([
      'Demande de connexion ignorée : site non autorisé (mag-istra.fr).',
      'Demande de connexion ignorée : site non autorisé (app.www.mag-istra.fr).',
      'Demande de connexion ignorée : site non autorisé (www.mag-istra.fr:8443).',
    ]);
  });

  it('une demande en attente pour l’une des deux origines n’est pas reprise pour l’autre', async () => {
    const requests: ConsentRequest[] = [];
    const c = connector({ allowedOrigins: [...OFFICIAL_WEB_ORIGINS], askConsent: async request => (requests.push(request), true) });
    await c.init();
    await c.handleAppUrl(pairUrl('https://www.mag-istra.fr'), vi.fn());
    await c.handleAppUrl(pairUrl('https://magistra-2.vercel.app'), vi.fn());
    expect(requests.map(r => r.origin)).toEqual(['https://www.mag-istra.fr', 'https://magistra-2.vercel.app']);
    expect(c.pairing.pending).toMatchObject({ origin: 'https://magistra-2.vercel.app' });
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
