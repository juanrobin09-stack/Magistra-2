// Contrôleur de Magistra locale (site web) : transitions d'état, vérification automatique SANS demande
// d'autorisation du navigateur, appairage, annulation, ouverture de l'application, retrait.

import { afterEach, describe, expect, it } from 'vitest';
import { CONNECTOR_PORTS, CONNECTOR_ROUTES, OPEN_APP_URL } from '@shared/localConnector';
import { createLocalEngineController, OPEN_APP_SEARCH_MS, type LocalEngineState } from '@/lib/localConnector/controller';
import { getEngineChoice, resetEngineChoiceMemory, setEngineChoice } from '@/lib/localConnector/engineChoice';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import type { LoopbackPermission } from '@/lib/localConnector/permission';
import { fakeClock, FakeConnector, READY_STATUS, type PortMode } from './fakeConnector';

const [P1, P2] = CONNECTOR_PORTS;

function setup(ports: Partial<Record<number, PortMode>> = { [P1]: 'magistra' }, initialPermission: LoopbackPermission = 'granted') {
  const clock = fakeClock();
  const connector = new FakeConnector(clock.now);
  for (const [port, mode] of Object.entries(ports)) connector.setPort(Number(port), mode!);
  const store = new MemoryPairingStore();
  let permission = initialPermission;
  const options = {
    origin: 'https://magistra-2.vercel.app',
    fetch: connector.fetch as typeof fetch,
    store,
    openUrl: connector.openUrl,
    permission: async () => permission,
    now: clock.now,
    sleep: clock.sleep,
  };
  const controller = createLocalEngineController(options);
  const kinds: LocalEngineState['kind'][] = [];
  controller.subscribe(() => kinds.push(controller.getSnapshot().kind));
  return {
    clock, connector, store, controller, kinds, options,
    setPermission(next: LoopbackPermission) {
      permission = next;
    },
  };
}

// Choix du moteur (mémoire : pas de localStorage dans ces tests) : oublié entre deux tests.
afterEach(() => resetEngineChoiceMemory());

/** Appairé et connecté (puis historique d'états remis à zéro). */
async function connected(ctx: ReturnType<typeof setup>) {
  await ctx.controller.connect();
  expect(ctx.controller.getSnapshot().kind).toBe('connected');
  ctx.kinds.length = 0;
  ctx.clock.sleeps.length = 0;
  ctx.connector.requests.length = 0;
  ctx.connector.openedUrls.length = 0;
}

describe('état initial et vérification automatique', () => {
  it('état initial : rien vérifié', () => {
    const { controller } = setup();
    expect(controller.getSnapshot()).toEqual({ kind: 'idle', paired: false, permission: 'unsupported' });
  });

  it('jamais appairé, autorisation à demander : AUCUNE requête (pas de demande du navigateur), « non détectée »', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'prompt');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'not-found', paired: false, permission: 'prompt' });
    expect(ctx.connector.requests).toHaveLength(0);
    expect(ctx.connector.openedUrls).toHaveLength(0);
  });

  it('jamais appairé, navigateur sans mécanisme d’autorisation : aucune requête automatique non plus', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'unsupported');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot().kind).toBe('not-found');
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('jamais appairé, autorisation déjà accordée : recherche → « Magistra trouvée » (version connue)', async () => {
    const ctx = setup({ [P2]: 'magistra' }, 'granted');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
    expect(ctx.kinds).toEqual(['checking', 'found']);
    expect(ctx.connector.requests.every(r => r.path === CONNECTOR_ROUTES.hello)).toBe(true);
  });

  it('jamais appairé, autorisation accordée, application absente : « non détectée »', async () => {
    const ctx = setup({}, 'granted');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'not-found', paired: false, permission: 'granted' });
  });

  it('autorisation refusée par le navigateur : état dédié, aucune requête', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'denied');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'permission-denied', permission: 'denied', error: { code: 'LOCAL_NETWORK_PERMISSION_DENIED' } });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('appairé : connecté (état du moteur) ; autorisation à redemander : explication d’abord, aucune requête', async () => {
    const ctx = setup();
    await connected(ctx);
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', paired: true, status: READY_STATUS, appVersion: '2.1.0' });
    ctx.connector.requests.length = 0;
    ctx.setPermission('prompt');
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'needs-permission', paired: true, permission: 'prompt' });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('appairé, navigateur sans mécanisme d’autorisation : vérifié automatiquement', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'unsupported');
    await connected(ctx);
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot().kind).toBe('connected');
  });

  it('appairé, application fermée : « app-closed » (appairage conservé)', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.setPort(P1, 'closed');
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'app-closed', paired: true, permission: 'granted', appVersion: '2.1.0' });
    expect(await ctx.controller.client.hasPairing()).toBe(true);
  });

  it('autorisation retirée dans l’application : appairage oublié, application trouvée, erreur expliquée', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.clients.clear();
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'found', paired: false, error: { code: 'CONNECTOR_UNPAIRED' } });
  });

  it('autorisation retirée : la cause reste affichée aux vérifications automatiques suivantes, une recherche de l’enseignant repart à neuf', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.clients.clear();
    await ctx.controller.refresh();
    const revoked = ctx.controller.getSnapshot();
    ctx.kinds.length = 0;
    // Relecture des capacités, retour sur une page : l'état (et sa cause) ne change pas, rien n'est republié.
    await ctx.controller.refresh();
    await ctx.controller.autoCheck();
    expect(ctx.controller.getSnapshot()).toBe(revoked);
    expect(ctx.kinds).toEqual([]);
    await ctx.controller.detect();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
  });

  it('autre erreur précédente (appairage refusé) : jamais reportée par une vérification automatique', async () => {
    const ctx = setup();
    ctx.connector.approve = false;
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot().error?.code).toBe('CONNECTOR_PAIRING_REFUSED');
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
  });

  it('refresh silencieux : aucun « Recherche… » affiché, aucune publication si rien ne change', async () => {
    const ctx = setup();
    await connected(ctx);
    await ctx.controller.refresh();
    await ctx.controller.refresh();
    expect(ctx.kinds).toEqual([]);
    ctx.connector.status = { ...READY_STATUS, busy: true };
    await ctx.controller.refresh();
    expect(ctx.kinds).toEqual(['connected']);
    expect(ctx.controller.getSnapshot().status?.busy).toBe(true);
  });

  it('vérifications automatiques simultanées : une seule recherche', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'granted');
    await Promise.all([ctx.controller.autoCheck(), ctx.controller.autoCheck(), ctx.controller.refresh()]);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.hello)).toHaveLength(CONNECTOR_PORTS.length);
  });
});

describe('recherche demandée par l’enseignant', () => {
  it('autorisation à demander : la recherche a lieu (la demande du navigateur peut s’afficher)', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'prompt');
    await ctx.controller.autoCheck();
    expect(ctx.connector.requests).toHaveLength(0);
    ctx.connector.intercept = () => {
      ctx.setPermission('granted'); // l'enseignant accepte la demande du navigateur
      return undefined;
    };
    await ctx.controller.detect();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
    expect(ctx.kinds).toContain('checking');
  });

  it('demande du navigateur refusée : état « autorisation refusée »', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'prompt');
    ctx.connector.intercept = () => {
      ctx.setPermission('denied');
      throw new TypeError('Failed to fetch');
    };
    await ctx.controller.detect();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'permission-denied', error: { code: 'LOCAL_NETWORK_PERMISSION_DENIED' } });
  });

  it('application absente : « non détectée »', async () => {
    const ctx = setup({});
    await ctx.controller.detect();
    expect(ctx.controller.getSnapshot().kind).toBe('not-found');
    expect(ctx.kinds).toEqual(['checking', 'not-found']);
  });
});

describe('connexion (appairage)', () => {
  it('trouvée → en attente de l’accord → connectée ; une seule URL magistra://pair', async () => {
    const ctx = setup();
    await ctx.controller.autoCheck();
    ctx.kinds.length = 0;
    const first = ctx.controller.connect();
    const second = ctx.controller.connect();
    expect(ctx.controller.getSnapshot().kind).toBe('found'); // publication après la lecture de l'autorisation
    await Promise.all([first, second]);
    expect(ctx.kinds).toEqual(['pairing', 'connected']);
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', paired: true, status: READY_STATUS });
    expect(ctx.connector.openedUrls).toHaveLength(1);
    expect(ctx.connector.openedUrls[0]).toMatch(/^magistra:\/\/pair\?/);
  });

  it('appairage réussi sans choix enregistré : Magistra locale devient le choix — l’appairage perdu ne mène jamais au serveur', async () => {
    const ctx = setup();
    expect(getEngineChoice(false)).toBe('server');
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot().kind).toBe('connected');
    // Autorisation retirée plus tard dans l'application : l'appairage est oublié, le choix reste Magistra locale.
    ctx.connector.clients.clear();
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'found', paired: false, error: { code: 'CONNECTOR_UNPAIRED' } });
    expect(getEngineChoice(false)).toBe('local');
  });

  it('appairage réussi alors que le serveur en ligne était choisi explicitement : ce choix n’est pas modifié', async () => {
    const ctx = setup();
    setEngineChoice('server');
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot().kind).toBe('connected');
    expect(getEngineChoice(true)).toBe('server');
  });

  it('appairage refusé : aucun choix enregistré', async () => {
    const ctx = setup();
    ctx.connector.approve = false;
    await ctx.controller.connect();
    expect(getEngineChoice(false)).toBe('server');
    expect(getEngineChoice(true)).toBe('local');
  });

  it('vérification automatique pendant l’appairage : ignorée (l’attente reste affichée)', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = 3;
    let during: LocalEngineState['kind'] | null = null;
    ctx.clock.onSleep = count => {
      if (count === 1) {
        void ctx.controller.autoCheck();
        void ctx.controller.refresh();
        void ctx.controller.detect();
        void ctx.controller.openApp();
      }
      if (count === 2) during = ctx.controller.getSnapshot().kind;
    };
    await ctx.controller.connect();
    expect(during).toBe('pairing');
    expect(ctx.controller.getSnapshot().kind).toBe('connected');
    expect(ctx.connector.openedUrls.filter(u => u === OPEN_APP_URL)).toHaveLength(0);
  });

  it('refus dans l’application : application trouvée, erreur expliquée', async () => {
    const ctx = setup();
    ctx.connector.approve = false;
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'found', paired: false, error: { code: 'CONNECTOR_PAIRING_REFUSED' } });
  });

  it('délai dépassé : application trouvée, erreur « expirée »', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'found', error: { code: 'CONNECTOR_PAIRING_EXPIRED' } });
  });

  it('application introuvable pendant 2 minutes : « non détectée »', async () => {
    const ctx = setup({});
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'not-found', paired: false, error: { code: 'CONNECTOR_UNREACHABLE' } });
  });

  it('annulation : retour à « Magistra trouvée », sans erreur, rien d’enregistré', async () => {
    const ctx = setup();
    await ctx.controller.autoCheck();
    ctx.connector.answerAfterPolls = null;
    ctx.clock.onSleep = count => {
      if (count === 2) ctx.controller.cancelPairing();
    };
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
    expect(await ctx.controller.client.hasPairing()).toBe(false);
  });

  it('autorisation du navigateur refusée : état dédié, application jamais ouverte', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'denied');
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot().kind).toBe('permission-denied');
    expect(ctx.connector.openedUrls).toHaveLength(0);
  });
});

describe('ouverture de l’application', () => {
  it('magistra://open puis recherche jusqu’au démarrage de l’application', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.setPort(P1, 'closed');
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot().kind).toBe('app-closed');
    ctx.clock.onSleep = count => {
      if (count === 3) ctx.connector.setPort(P2, 'magistra');
    };
    await ctx.controller.openApp();
    expect(ctx.connector.openedUrls).toEqual([OPEN_APP_URL]);
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', paired: true });
    expect(ctx.clock.sleeps).toEqual([1_500, 1_500, 1_500]);
  });

  it('application qui ne démarre pas : abandon après 60 s', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.setPort(P1, 'closed');
    await ctx.controller.openApp();
    expect(ctx.controller.getSnapshot().kind).toBe('app-closed');
    const waited = ctx.clock.sleeps.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(OPEN_APP_SEARCH_MS);
    expect(waited).toBeLessThan(OPEN_APP_SEARCH_MS + 2_000);
  });

  it('jamais appairé : l’application trouvée après ouverture → « Magistra trouvée »', async () => {
    const ctx = setup({});
    ctx.connector.onOpen = () => ctx.connector.setPort(P1, 'magistra');
    await ctx.controller.openApp();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'found', paired: false });
  });

  it('nouvelle action pendant la recherche : la recherche s’arrête, son résultat n’est pas affiché', async () => {
    const ctx = setup({});
    const search = ctx.controller.openApp();
    await new Promise(resolve => setTimeout(resolve, 0));
    ctx.connector.setPort(P1, 'magistra');
    await ctx.controller.detect();
    await search;
    expect(ctx.controller.getSnapshot().kind).toBe('found');
    expect(ctx.clock.sleeps.length).toBeLessThan(5);
  });
});

describe('déconnexion', () => {
  it('retire l’autorisation (DELETE) et oublie l’appairage ; l’application reste trouvée', async () => {
    const ctx = setup();
    await connected(ctx);
    const clientId = (await ctx.store.load())!.clientId;
    await ctx.controller.disconnect();
    expect(ctx.connector.calls(CONNECTOR_ROUTES.pair, 'DELETE')).toHaveLength(1);
    expect(ctx.connector.clients.has(clientId)).toBe(false);
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
  });

  it('application fermée : appairage oublié quand même', async () => {
    const ctx = setup();
    await connected(ctx);
    ctx.connector.setPort(P1, 'closed');
    await ctx.controller.disconnect();
    expect(ctx.controller.getSnapshot()).toEqual({ kind: 'not-found', paired: false, permission: 'granted' });
    expect(await ctx.controller.client.hasPairing()).toBe(false);
  });

  it('pendant un appairage : l’appairage est interrompu et rien ne reste enregistré', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    let disconnecting: Promise<void> | null = null;
    ctx.clock.onSleep = count => {
      if (count === 2) disconnecting = ctx.controller.disconnect();
    };
    await ctx.controller.connect();
    await disconnecting;
    expect(ctx.controller.getSnapshot().paired).toBe(false);
    expect(ctx.controller.getSnapshot().kind).toBe('found');
    expect(await ctx.controller.client.hasPairing()).toBe(false);
  });
});
