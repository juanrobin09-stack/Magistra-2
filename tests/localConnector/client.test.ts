// Client du connecteur local (site web → application Windows) face à un faux connecteur conforme au protocole :
// recherche sans adresse, autorisation du navigateur, appairage (aucun secret dans l'URL), preuve exigée sur chaque
// réponse signée, 401 → oubli de l'appairage, flux NDJSON, arrêt, port mémorisé mais ports re-sondés.

import { describe, expect, it, vi } from 'vitest';
import { isAbortError } from '@shared/errors';
import {
  CONNECTOR_FORMATS, CONNECTOR_HEADERS, CONNECTOR_LIMITS, CONNECTOR_PORTS, CONNECTOR_PROTOCOL_VERSION, CONNECTOR_ROUTES, PAIR_CODE_RE, parseAppUrl,
} from '@shared/localConnector';
import type { GenerationEvent, GenerationRequest } from '@shared/types';
import {
  APP_UPDATE_REQUIRED_MESSAGE, LocalConnectorClient, PAGE_RELOAD_REQUIRED_MESSAGE, PAIRING_NOT_RECEIVED_MESSAGE, STREAM_INTERRUPTED_MESSAGE,
  UNEXPECTED_REPLY_MESSAGE, UNRECOGNIZED_BY_APP_MESSAGE, type LocalConnectorClientOptions,
} from '@/lib/localConnector/client';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import type { LoopbackPermission } from '@/lib/localConnector/permission';
import { DEFAULT_EVENTS, fakeClock, FakeConnector, READY_STATUS, SITE_ORIGIN, type PortMode } from './fakeConnector';

const [P1, P2, P3] = CONNECTOR_PORTS;

const REQUEST: GenerationRequest = {
  type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'La fable', researchMode: 'documents',
  documents: [{ docId: 'd1', docName: 'fables.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 1 }, text: 'Le corbeau et le renard…' }],
};

function setup(ports: Partial<Record<number, PortMode>> = { [P1]: 'magistra' }, initialPermission: LoopbackPermission = 'granted', extra: Partial<LocalConnectorClientOptions> = {}) {
  const clock = fakeClock();
  const connector = new FakeConnector(clock.now);
  for (const [port, mode] of Object.entries(ports)) connector.setPort(Number(port), mode!);
  const store = new MemoryPairingStore();
  let permission = initialPermission;
  const permissionCalls: number[] = [];
  const options: LocalConnectorClientOptions = {
    origin: SITE_ORIGIN,
    fetch: connector.fetch as typeof fetch,
    store,
    openUrl: connector.openUrl,
    permission: async () => {
      permissionCalls.push(1);
      return permission;
    },
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  };
  const client = new LocalConnectorClient(options);
  return {
    clock, connector, store, client, options, permissionCalls,
    setPermission(next: LoopbackPermission) {
      permission = next;
    },
    /** Nouvelle session (rechargement de la page) : même appairage mémorisé, aucune preuve encore reçue. */
    reload() {
      return new LocalConnectorClient(options);
    },
  };
}

async function pairClient(ctx: ReturnType<typeof setup>): Promise<void> {
  await ctx.client.pair(new AbortController().signal);
}

async function collect(client: LocalConnectorClient, signal = new AbortController().signal, onEvent?: (e: GenerationEvent) => void) {
  const events: GenerationEvent[] = [];
  await client.generate(REQUEST, e => {
    events.push(e);
    onEvent?.(e);
  }, signal);
  return events;
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message?: string; name?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { code?: string; message?: string };
  }
  throw new Error('La promesse aurait dû échouer.');
}

describe('hello : recherche sans adresse', () => {
  it('aucune application : null ; les trois ports dédiés sont sondés avec des requêtes sûres', async () => {
    const ctx = setup({});
    expect(await ctx.client.hello()).toBeNull();
    expect(ctx.connector.requests.map(r => `${r.method} ${r.port}${r.path}`).sort()).toEqual(
      CONNECTOR_PORTS.map(p => `GET ${p}${CONNECTOR_ROUTES.hello}`).sort(),
    );
    for (const r of ctx.connector.requests) {
      expect(r.init).toMatchObject({
        mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', targetAddressSpace: 'loopback',
      });
      expect(Object.keys(r.headers)).toEqual([]);
    }
  });

  it('application sur le deuxième port : trouvée, version connue', async () => {
    const ctx = setup({ [P2]: 'magistra' });
    expect(await ctx.client.hello()).toEqual({ port: P2, hello: { app: 'magistra', protocol: 2, version: '2.1.0' } });
  });

  it('autre programme sur un port (réponse qui n’est pas Magistra) : ignoré', async () => {
    const ctx = setup({ [P2]: 'magistra' });
    ctx.connector.intercept = (port, path) => (port === P1 && path === CONNECTOR_ROUTES.hello
      ? new Response(JSON.stringify({ app: 'autre', protocol: 2, version: '1.0.0' }), { headers: { 'Content-Type': 'application/json' } })
      : undefined);
    expect((await ctx.client.hello())?.port).toBe(P2);
    ctx.connector.intercept = port => (port === P2 ? new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) : undefined);
    ctx.connector.setPort(P2, 'closed');
    expect(await ctx.client.hello()).toBeNull();
  });

  it('réponse démesurée : ignorée', async () => {
    const ctx = setup({});
    ctx.connector.intercept = (port) => {
      if (port === P2) return new Response(JSON.stringify({ app: 'magistra', protocol: 2, version: '2.0.0', pad: 'x'.repeat(40_000) }), { headers: { 'Content-Type': 'application/json' } });
      return undefined;
    };
    expect(await ctx.client.hello()).toBeNull();
  });

  it('application Magistra d’une autre version du protocole : jamais utilisée, mais jamais « pas encore détectée » — mettre Magistra à jour, ou recharger la page', async () => {
    const helloOf = (protocol: unknown) => new Response(JSON.stringify({ app: 'magistra', protocol, version: '9.0.0' }), { headers: { 'Content-Type': 'application/json' } });
    // Ancienne application (protocole 1 : accusé, signature et preuve non liés au port) : à mettre à jour.
    const old = setup({});
    old.connector.intercept = (port, path) => (port === P1 && path === CONNECTOR_ROUTES.hello ? helloOf(1) : undefined);
    expect(await rejection(old.client.hello())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: APP_UPDATE_REQUIRED_MESSAGE });
    // Application plus récente que cette page (site pas encore rechargé après sa mise à jour).
    const newer = setup({});
    newer.connector.intercept = (port, path) => (port === P3 && path === CONNECTOR_ROUTES.hello ? helloOf(CONNECTOR_PROTOCOL_VERSION + 1) : undefined);
    expect(await rejection(newer.client.hello())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: PAGE_RELOAD_REQUIRED_MESSAGE });
    // Rien ne lui est jamais envoyé d'autre que hello.
    expect(newer.connector.requests.every(r => r.path === CONNECTOR_ROUTES.hello)).toBe(true);
    // Une application compatible sur un autre port l'emporte ; protocole mal formé : simple programme inconnu.
    const both = setup({ [P2]: 'magistra' });
    both.connector.intercept = (port, path) => (port === P1 && path === CONNECTOR_ROUTES.hello ? helloOf(1) : undefined);
    expect((await both.client.hello())?.port).toBe(P2);
    for (const bad of [0, -1, 1.5, '1', null]) {
      const odd = setup({});
      odd.connector.intercept = (port, path) => (port === P1 && path === CONNECTOR_ROUTES.hello ? helloOf(bad) : undefined);
      expect(await odd.client.hello(), String(bad)).toBeNull();
    }
  });

  it('autorisation refusée par le navigateur : erreur précise, aucune requête', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'denied');
    expect(await rejection(ctx.client.hello())).toMatchObject({ code: 'LOCAL_NETWORK_PERMISSION_DENIED' });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('demande du navigateur refusée pendant la recherche : erreur précise', async () => {
    const ctx = setup({}, 'prompt');
    ctx.connector.intercept = () => {
      ctx.setPermission('denied');
      return undefined;
    };
    expect(await rejection(ctx.client.hello())).toMatchObject({ code: 'LOCAL_NETWORK_PERMISSION_DENIED' });
  });

  it('autorisation accordée APRÈS la coupure par l’application de la connexion retenue par le navigateur (> 10 s) : recherche refaite aussitôt', async () => {
    const ctx = setup({ [P2]: 'magistra' }, 'prompt');
    let held = CONNECTOR_PORTS.length;
    ctx.connector.intercept = () => {
      if (held === 0) return undefined;
      held--;
      // Chromium ouvre la connexion avant sa question ; l'application la ferme au bout de 10 s ; l'enseignant accepte
      // ensuite : la requête retenue échoue, sans nouvel envoi du navigateur.
      ctx.setPermission('granted');
      throw new TypeError('Failed to fetch');
    };
    expect(await ctx.client.hello()).toEqual({ port: P2, hello: { app: 'magistra', protocol: 2, version: '2.1.0' } });
    expect(ctx.connector.calls(CONNECTOR_ROUTES.hello).length).toBeGreaterThan(CONNECTOR_PORTS.length);
  });

  it('demande du navigateur restée sans réponse (toujours « prompt ») : aucun nouvel essai, null', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'prompt');
    ctx.connector.intercept = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await ctx.client.hello()).toBeNull();
    expect(ctx.connector.calls(CONNECTOR_ROUTES.hello)).toHaveLength(CONNECTOR_PORTS.length);
  });

  it('navigateur qui expose l’autorisation SANS l’appliquer (réponse reçue, toujours « prompt ») : traitée comme absente jusqu’à la fin de la visite', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'prompt');
    expect(await ctx.client.readPermission()).toBe('prompt');
    expect((await ctx.client.hello())?.port).toBe(P1);
    expect(await ctx.client.readPermission()).toBe('unsupported');
    // Jamais retenu au-delà de la visite : si la protection s'applique un jour, sa demande sera expliquée d'abord.
    expect(await ctx.reload().readPermission()).toBe('prompt');
    // Navigateur qui l'applique : la réponse n'arrive qu'après l'accord (« granted ») ; réinitialisée : « prompt ».
    const enforced = setup({ [P1]: 'magistra' }, 'prompt');
    enforced.connector.intercept = () => {
      enforced.setPermission('granted');
      return undefined;
    };
    await enforced.client.hello();
    enforced.setPermission('prompt');
    expect(await enforced.client.readPermission()).toBe('prompt');
  });

  it('port qui ne répond jamais : abandonné après 1,5 s', async () => {
    const ctx = setup({ [P1]: 'hang', [P2]: 'hang', [P3]: 'hang' });
    const started = Date.now();
    expect(await ctx.client.hello()).toBeNull();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1_400);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('interruption : AbortError', async () => {
    const ctx = setup({ [P1]: 'hang' });
    const abort = new AbortController();
    const pending = ctx.client.hello(abort.signal);
    abort.abort();
    expect(isAbortError(await rejection(pending))).toBe(true);
  });
});

describe('pair : appairage', () => {
  it('URL magistra://pair sans secret ; preuve de réception, puis vérificateur dans le corps seulement après l’accord ; preuve finale', async () => {
    const ctx = setup({ [P1]: 'magistra' });
    await pairClient(ctx);

    expect(ctx.connector.openedUrls).toHaveLength(1);
    const url = ctx.connector.openedUrls[0];
    const parsed = parseAppUrl(url);
    expect(parsed).toMatchObject({ kind: 'pair', origin: SITE_ORIGIN });
    if (!parsed || parsed.kind !== 'pair') throw new Error('URL d’appairage attendue');
    const posts = ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST');
    // Premier temps (sans secret) : 202, 202, puis accord (« consented ») ; second temps : fin d'appairage.
    expect(posts).toHaveLength(4);
    for (const probe of posts.slice(0, 3)) expect(JSON.parse(probe.body)).toEqual({ pairingId: parsed.pairingId });
    const body = JSON.parse(posts[3].body) as { pairingId: string; verifier: string; clientPublicKey: string };
    expect(Object.keys(body).sort()).toEqual(['clientPublicKey', 'pairingId', 'verifier']);
    expect(body.pairingId).toBe(parsed.pairingId);
    expect(body.verifier).toMatch(CONNECTOR_FORMATS.verifier);
    expect(body.clientPublicKey).toMatch(CONNECTOR_FORMATS.publicKey);
    expect(url).not.toContain(body.verifier);
    // Le défi n'existe que dans l'URL : aucune requête HTTP ne le porte (c'est lui qui prouve la réception de l'URL).
    for (const r of ctx.connector.requests) {
      expect(`${r.path}${JSON.stringify(r.headers)}`).not.toContain(body.verifier);
      expect(`${r.path}${JSON.stringify(r.headers)}${r.body}`).not.toContain(parsed.challenge);
    }
    expect(posts.filter(r => r.body.includes(body.verifier))).toEqual([posts[3]]);
    for (const post of posts) expect(post.headers['content-type']).toBe('application/json');
    // Essais toutes les 1,5 s tant que l'enseignant n'a pas répondu.
    expect(ctx.clock.sleeps).toEqual([1_500, 1_500]);

    const stored = await ctx.store.load();
    expect(stored).toMatchObject({ port: P1, pairedAt: new Date(ctx.clock.now()).toISOString() });
    expect(stored!.clientId).toMatch(CONNECTOR_FORMATS.clientId);
    expect(stored!.key.extractable).toBe(false);
    expect(ctx.connector.clients.has(stored!.clientId)).toBe(true);
    // Preuve immédiate : GET /v1/status signé après l'accord.
    const statusCalls = ctx.connector.calls(CONNECTOR_ROUTES.status);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0].headers[CONNECTOR_HEADERS.client.toLowerCase()]).toBe(stored!.clientId);
    expect(await ctx.client.hasPairing()).toBe(true);
  });

  it('code de vérification : donné AVANT l’ouverture de magistra://pair, identique à celui de la boîte de l’application', async () => {
    const ctx = setup({ [P1]: 'magistra' });
    const codes: { code: string; urlsOpened: number }[] = [];
    await ctx.client.pair(new AbortController().signal, code => codes.push({ code, urlsOpened: ctx.connector.openedUrls.length }));
    expect(codes).toEqual([{ code: ctx.connector.consentCodes[0], urlsOpened: 0 }]);
    expect(codes[0].code).toMatch(PAIR_CODE_RE);
    // Chaque demande a son code (dérivé de son défi).
    const again: string[] = [];
    await ctx.client.pair(new AbortController().signal, code => again.push(code));
    expect(again[0]).toBe(ctx.connector.consentCodes[1]);
    expect(again[0]).not.toBe(codes[0].code);
  });

  it('application fermée au départ : magistra://pair l’ouvre, recherche toutes les secondes, puis appairage', async () => {
    const ctx = setup({});
    ctx.clock.onSleep = count => {
      if (count === 3) ctx.connector.setPort(P2, 'magistra');
    };
    ctx.connector.receivesUrls = true;
    // La demande est reçue au lancement (URL passée à l'application qui démarre).
    await pairClient(ctx);
    expect(ctx.clock.sleeps.slice(0, 3)).toEqual([1_000, 1_000, 1_000]);
    expect(ctx.clock.sleeps.slice(3)).toEqual([1_500, 1_500]);
    expect((await ctx.store.load())?.port).toBe(P2);
  });

  it('refus dans l’application : CONNECTOR_PAIRING_REFUSED, rien d’enregistré', async () => {
    const ctx = setup();
    ctx.connector.approve = false;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_REFUSED' });
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('demande expirée (410) : CONNECTOR_PAIRING_EXPIRED', async () => {
    const ctx = setup();
    ctx.connector.expired = true;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED' });
  });

  it('aucune réponse de l’enseignant : abandon après 2 minutes (CONNECTOR_PAIRING_EXPIRED)', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    const err = await rejection(pairClient(ctx));
    expect(err).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED', message: 'La demande de connexion a expiré : recommencez.' });
    const waited = ctx.clock.sleeps.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(120_000);
    expect(waited).toBeLessThan(122_000);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST').length).toBeGreaterThan(70);
  });

  it('application jamais trouvée : CONNECTOR_UNREACHABLE après 2 minutes', async () => {
    const ctx = setup({});
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_UNREACHABLE' });
    expect(ctx.clock.sleeps.every(ms => ms === 1_000)).toBe(true);
  });

  it('application trouvée mais demande jamais reçue : message précis', async () => {
    const ctx = setup();
    ctx.connector.receivesUrls = false;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED', message: PAIRING_NOT_RECEIVED_MESSAGE });
  });

  it('demande remplacée (autre onglet) après avoir été reconnue : CONNECTOR_PAIRING_EXPIRED', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    ctx.clock.onSleep = count => {
      if (count === 2) ctx.connector.demand = null;
    };
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED' });
  });

  it('annulation pendant l’attente : AbortError, rien d’enregistré', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    const abort = new AbortController();
    ctx.clock.onSleep = count => {
      if (count === 2) abort.abort();
    };
    expect(isAbortError(await rejection(ctx.client.pair(abort.signal)))).toBe(true);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('autre application Magistra (autre session Windows) sur le premier port : appairage avec la bonne', async () => {
    const ctx = setup({ [P1]: 'other-magistra', [P2]: 'magistra' });
    await pairClient(ctx);
    expect((await ctx.store.load())?.port).toBe(P2);
  });

  it('programme qui accepte tout sur le premier port (accusé inventé) : ignoré, ne reçoit JAMAIS le vérificateur ni la clé', async () => {
    const ctx = setup({ [P1]: 'impostor', [P2]: 'magistra' });
    await pairClient(ctx);
    const stored = await ctx.store.load();
    expect(stored?.port).toBe(P2);
    expect(ctx.connector.clients.has(stored!.clientId)).toBe(true);
    const toImpostor = ctx.connector.requests.filter(r => r.port === P1);
    expect(toImpostor.filter(r => r.path === CONNECTOR_ROUTES.pair).length).toBeGreaterThan(0);
    for (const r of toImpostor) {
      expect(r.path === CONNECTOR_ROUTES.hello || r.path === CONNECTOR_ROUTES.pair).toBe(true);
      if (r.path === CONNECTOR_ROUTES.pair) expect(Object.keys(JSON.parse(r.body))).toEqual(['pairingId']);
    }
    const finish = ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST').filter(r => r.body.includes('verifier'));
    expect(finish.map(r => r.port)).toEqual([P2]);
  });

  it('seul le programme de ce port : accusé inventé → rien n’est envoyé au-delà du premier temps, abandon après 2 minutes', async () => {
    const ctx = setup({ [P1]: 'impostor' });
    const err = await rejection(pairClient(ctx));
    expect(err).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED', message: PAIRING_NOT_RECEIVED_MESSAGE });
    const pairs = ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST');
    expect(pairs.length).toBeGreaterThan(50);
    for (const r of pairs) expect(Object.keys(JSON.parse(r.body))).toEqual(['pairingId']);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.status)).toEqual([]);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it.each(['none', 'wrong'] as const)('accusé de réception %s (même avec l’accord) : port ignoré, vérificateur jamais envoyé', async (ackMode) => {
    const ctx = setup();
    ctx.connector.ackMode = ackMode;
    ctx.connector.answerAfterPolls = 0;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED', message: PAIRING_NOT_RECEIVED_MESSAGE });
    for (const r of ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST')) expect(Object.keys(JSON.parse(r.body))).toEqual(['pairingId']);
    expect(ctx.connector.clients.size).toBe(0);
  });

  it('le vérificateur ne part qu’après l’accord : tant que 202, uniquement le premier temps', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = null;
    const abort = new AbortController();
    ctx.clock.onSleep = count => {
      if (count === 5) abort.abort();
    };
    expect(isAbortError(await rejection(ctx.client.pair(abort.signal)))).toBe(true);
    const pairs = ctx.connector.calls(CONNECTOR_ROUTES.pair, 'POST');
    expect(pairs.length).toBe(5);
    for (const r of pairs) expect(Object.keys(JSON.parse(r.body))).toEqual(['pairingId']);
  });

  it('demande perdue entre l’accord et la fin d’appairage (autre onglet) : CONNECTOR_PAIRING_EXPIRED', async () => {
    const ctx = setup();
    ctx.connector.answerAfterPolls = 0;
    ctx.connector.intercept = (_port, path, method) => {
      if (path !== CONNECTOR_ROUTES.pair || method !== 'POST') return undefined;
      const last = ctx.connector.requests.at(-1)!;
      return last.body.includes('verifier') ? new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x', retryable: false } }), { status: 404, headers: { 'Content-Type': 'application/json' } }) : undefined;
    };
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_PAIRING_EXPIRED' });
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('clé différente de chaque côté (protocole incompatible) : preuve fausse → appairage oublié aussitôt', async () => {
    const ctx = setup();
    ctx.connector.deriveWrongKey = true;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: UNEXPECTED_REPLY_MESSAGE });
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('clé publique du connecteur invalide : refusée, rien d’enregistré', async () => {
    const ctx = setup();
    ctx.connector.badConnectorKey = true;
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: UNEXPECTED_REPLY_MESSAGE });
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('autorisation du navigateur refusée : erreur avant toute ouverture de l’application', async () => {
    const ctx = setup({ [P1]: 'magistra' }, 'denied');
    expect(await rejection(pairClient(ctx))).toMatchObject({ code: 'LOCAL_NETWORK_PERMISSION_DENIED' });
    expect(ctx.connector.openedUrls).toEqual([]);
    expect(ctx.connector.requests).toEqual([]);
  });

  it('reconnexion : l’ancienne autorisation de ce navigateur est retirée de l’application', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const first = (await ctx.store.load())!.clientId;
    await pairClient(ctx);
    const second = (await ctx.store.load())!.clientId;
    expect(second).not.toBe(first);
    expect(ctx.connector.clients.has(first)).toBe(false);
    expect(ctx.connector.clients.has(second)).toBe(true);
  });
});

describe('status : requêtes signées et preuve', () => {
  it('sans appairage : CONNECTOR_UNPAIRED, aucune requête', async () => {
    const ctx = setup();
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED' });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('état du moteur : requête signée, vérifiée par le connecteur, preuve vérifiée par le client', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.requests.length = 0;
    expect(await ctx.client.status()).toEqual(READY_STATUS);
    const [req] = ctx.connector.requests;
    expect(req).toMatchObject({ port: P1, method: 'GET', path: CONNECTOR_ROUTES.status, body: '' });
    expect(req.headers[CONNECTOR_HEADERS.timestamp.toLowerCase()]).toBe(String(ctx.clock.now()));
    expect(req.headers[CONNECTOR_HEADERS.nonce.toLowerCase()]).toMatch(CONNECTOR_FORMATS.nonce);
    expect(req.headers[CONNECTOR_HEADERS.signature.toLowerCase()]).toMatch(CONNECTOR_FORMATS.mac);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers['content-type']).toBeUndefined();
    // Nonce unique par requête.
    await ctx.client.status();
    const nonces = ctx.connector.requests.map(r => r.headers[CONNECTOR_HEADERS.nonce.toLowerCase()]);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('réponse SANS preuve (autre programme) : CONNECTOR_UNREACHABLE, appairage conservé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.proofMode = 'none';
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE' });
    expect(await ctx.client.hasPairing()).toBe(true);
  });

  it('preuve FAUSSE : CONNECTOR_UNREACHABLE, appairage conservé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.proofMode = 'wrong';
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE' });
    expect(await ctx.client.hasPairing()).toBe(true);
  });

  it('imposteur sur le port mémorisé, application sur un autre port : tous les ports sont re-sondés', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.setPort(P1, 'impostor').setPort(P3, 'magistra');
    expect(await ctx.client.status()).toEqual(READY_STATUS);
    expect((await ctx.store.load())?.port).toBe(P3);
    // Port mémorisé : essayé en premier ensuite.
    ctx.connector.requests.length = 0;
    await ctx.client.status();
    expect(ctx.connector.requests.map(r => `${r.port}${r.path}`)).toEqual([`${P3}${CONNECTOR_ROUTES.status}`]);
  });

  it('application fermée : CONNECTOR_UNREACHABLE (appairage conservé) ; rouverte sur un autre port : retrouvée', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.setPort(P1, 'closed');
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE' });
    expect(await ctx.client.hasPairing()).toBe(true);
    ctx.connector.setPort(P2, 'magistra');
    expect(await ctx.client.status()).toEqual(READY_STATUS);
    expect((await ctx.store.load())?.port).toBe(P2);
  });

  it('autorisation retirée dans l’application (401 CONNECTOR_UNPAIRED) : appairage oublié', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.revokeAll();
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED' });
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('autre application Magistra (ne connaît pas ce navigateur) : l’appairage n’est PAS oublié si la bonne répond', async () => {
    const ctx = setup({ [P1]: 'magistra' });
    await pairClient(ctx);
    // L'application de l'enseignant redémarre sur P2 ; celle d'une autre session Windows occupe P1.
    ctx.connector.setPort(P1, 'other-magistra').setPort(P2, 'magistra');
    expect(await ctx.client.status()).toEqual(READY_STATUS);
    expect((await ctx.store.load())?.port).toBe(P2);
  });

  it('PC partagé : SA Magistra fermée, celle d’une autre session répond 401 sans marque de retrait → appairage GARDÉ, cause expliquée', async () => {
    const ctx = setup({ [P1]: 'magistra' });
    await pairClient(ctx);
    // L'application de l'enseignant est fermée ; celle d'un collègue (autre session Windows) écoute sur P2.
    ctx.connector.setPort(P1, 'closed').setPort(P2, 'other-magistra');
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED', message: UNRECOGNIZED_BY_APP_MESSAGE });
    expect(await ctx.client.hasPairing()).toBe(true);
    // L'autre application a même repris le port mémorisé : toujours gardé.
    ctx.connector.setPort(P1, 'other-magistra').setPort(P2, 'closed');
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED', message: UNRECOGNIZED_BY_APP_MESSAGE });
    expect(await ctx.client.hasPairing()).toBe(true);
    // L'enseignant rouvre sa Magistra : reconnue sans nouvel appairage.
    ctx.connector.setPort(P3, 'magistra');
    expect(await ctx.client.status()).toEqual(READY_STATUS);
    expect((await ctx.store.load())?.port).toBe(P3);
  });

  it('401 avec une marque de retrait fausse, ou sans marque (application qui a perdu ses autorisations) : appairage gardé', async () => {
    for (const mode of ['wrong', 'none'] as const) {
      const ctx = setup();
      await pairClient(ctx);
      ctx.connector.revokedMarkMode = mode;
      ctx.connector.revokeAll();
      expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED', message: UNRECOGNIZED_BY_APP_MESSAGE });
      expect(await ctx.client.hasPairing()).toBe(true);
    }
  });

  it('autorisation accordée APRÈS la coupure de la connexion retenue (> 10 s) : état relu aussitôt, jamais « fermée » à tort', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const client = ctx.reload();
    ctx.setPermission('prompt');
    // Première série : GET /v1/status sur le port mémorisé puis recherche sur chaque port, toutes retenues puis coupées.
    let held = 1 + CONNECTOR_PORTS.length;
    ctx.connector.intercept = () => {
      if (held === 0) return undefined;
      held--;
      ctx.setPermission('granted');
      throw new TypeError('Failed to fetch');
    };
    expect(await client.status()).toEqual(READY_STATUS);
  });

  it('appairé, seule une application Magistra d’une autre version répond (mise à jour du site) : « mettez Magistra à jour », jamais « fermée »', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const client = ctx.reload();
    ctx.connector.setPort(P1, 'closed');
    ctx.connector.intercept = (port, path) => (port === P2 && path === CONNECTOR_ROUTES.hello
      ? new Response(JSON.stringify({ app: 'magistra', protocol: 1, version: '1.9.0' }), { headers: { 'Content-Type': 'application/json' } })
      : undefined);
    expect(await rejection(client.status())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: APP_UPDATE_REQUIRED_MESSAGE });
    expect(await client.hasPairing()).toBe(true);
    // Aucune requête signée vers elle.
    expect(ctx.connector.requests.filter(r => r.port === P2).every(r => r.path === CONNECTOR_ROUTES.hello)).toBe(true);
  });

  it('autorisation du navigateur refusée : erreur précise, aucune requête', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.requests.length = 0;
    ctx.setPermission('denied');
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'LOCAL_NETWORK_PERMISSION_DENIED' });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('réponse prouvée mais illisible : réponse inattendue (mettre à jour Magistra)', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.status = { version: '2.1.0' } as never;
    expect(await rejection(ctx.client.status())).toMatchObject({ code: 'CONNECTOR_UNREACHABLE', message: UNEXPECTED_REPLY_MESSAGE });
  });

  it('état non prêt : cause précise conservée ; message démesuré remplacé par le message du code', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.status = {
      ...READY_STATUS,
      engine: {
        ready: false, local: true, label: 'Magistra Standard',
        notReady: { code: 'MODEL_NOT_INSTALLED', message: 'Le modèle « Magistra Standard » n’est pas installé.' },
        warning: { code: 'AI_BUSY', message: 'x'.repeat(5_000) },
      },
    };
    const status = await ctx.client.status();
    expect(status.engine.notReady).toEqual({ code: 'MODEL_NOT_INSTALLED', message: 'Le modèle « Magistra Standard » n’est pas installé.' });
    expect(status.engine.warning).toEqual({ code: 'AI_BUSY', message: "Le serveur d'IA est surchargé. Réessayez dans quelques instants." });
  });
});

describe('generate : flux NDJSON', () => {
  it('nouvelle session : preuve (status) AVANT l’envoi du contenu ; évènements dans l’ordre, record conservé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const client = ctx.reload();
    ctx.connector.requests.length = 0;
    const events = await collect(client);
    expect(ctx.connector.requests.map(r => r.path)).toEqual([CONNECTOR_ROUTES.status, CONNECTOR_ROUTES.generate]);
    expect(events).toEqual(DEFAULT_EVENTS);
    const post = ctx.connector.calls(CONNECTOR_ROUTES.generate)[0];
    expect(JSON.parse(post.body)).toEqual(REQUEST);
    expect(post.headers['content-type']).toBe('application/json');
  });

  it('aucun port ne prouve détenir la clé : le contenu n’est JAMAIS envoyé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const client = ctx.reload();
    ctx.connector.setPort(P1, 'impostor');
    const events = await collect(client);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
    for (const r of ctx.connector.requests) expect(r.body).not.toContain('corbeau');
  });

  it('preuve récente réutilisée ; au-delà de 30 s, nouvelle preuve avant l’envoi', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.requests.length = 0;
    await collect(ctx.client);
    expect(ctx.connector.requests.map(r => r.path)).toEqual([CONNECTOR_ROUTES.generate]);
    ctx.connector.requests.length = 0;
    ctx.clock.advance(31_000);
    await collect(ctx.client);
    expect(ctx.connector.requests.map(r => r.path)).toEqual([CONNECTOR_ROUTES.status, CONNECTOR_ROUTES.generate]);
  });

  it('réponse de génération sans preuve : rien n’est lu du flux, CONNECTOR_UNREACHABLE', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.proofMode = 'none';
    const events = await collect(ctx.client);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
  });

  it('erreurs prouvées avant le flux (409) : code et message de l’application', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.generateError = { status: 409, code: 'GENERATION_BUSY', message: 'Une génération est déjà en cours dans Magistra.' };
    expect(await collect(ctx.client)).toEqual([
      { type: 'error', code: 'GENERATION_BUSY', message: 'Une génération est déjà en cours dans Magistra.', retryable: true },
    ]);
    ctx.connector.generateError = { status: 409, code: 'LOCAL_ENGINE_REMOTE', message: 'Réglée sur un serveur distant.' };
    expect(await collect(ctx.client)).toEqual([{ type: 'error', code: 'LOCAL_ENGINE_REMOTE', message: 'Réglée sur un serveur distant.', retryable: false }]);
  });

  it('autorisation retirée entre-temps (401) : CONNECTOR_UNPAIRED et appairage oublié', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.revokeAll();
    expect(await collect(ctx.client)).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNPAIRED' })]);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('port repris entre la preuve et l’envoi par l’application d’une autre session (401 sans marque) : appairage gardé, rien de lu', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.setPort(P1, 'other-magistra');
    expect(await collect(ctx.client)).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
    expect(await ctx.client.hasPairing()).toBe(true);
  });

  it('arrêt demandé : connexion fermée, POST /v1/cancel signé avec l’identifiant de la génération', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.events = [{ type: 'status', stage: 'generating', message: 'Rédaction…' }, { type: 'delta', text: 'Début' }];
    ctx.connector.holdStream = true;
    const abort = new AbortController();
    const events = await collect(ctx.client, abort.signal, e => {
      if (e.type === 'delta') abort.abort();
    });
    expect(events.map(e => e.type)).toEqual(['status', 'delta', 'error']);
    expect(events.at(-1)).toMatchObject({ code: 'GENERATION_ABORTED' });
    expect(ctx.connector.streamsClosedByBrowser).toBe(1);
    await vi.waitFor(() => expect(ctx.connector.cancelled).toHaveLength(1));
    expect(ctx.connector.cancelled[0]).toMatch(CONNECTOR_FORMATS.jobId);
    const cancel = ctx.connector.calls(CONNECTOR_ROUTES.cancel)[0];
    expect(JSON.parse(cancel.body)).toEqual({ jobId: ctx.connector.cancelled[0] });
  });

  it('flux coupé : message propre à l’application Magistra (jamais « serveur »)', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.events = [{ type: 'delta', text: 'Début' }];
    // Fin du flux sans évènement final.
    let events = await collect(ctx.client);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STREAM_INTERRUPTED_MESSAGE, retryable: true });
    // Erreur réseau pendant la lecture.
    ctx.connector.cutStream = true;
    events = await collect(ctx.client);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STREAM_INTERRUPTED_MESSAGE, retryable: true });
  });

  it('demande trop volumineuse : refusée sans rien envoyer', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.requests.length = 0;
    const big = { ...REQUEST, contenuSource: 'x'.repeat(CONNECTOR_LIMITS.generateBodyBytes) };
    const events: GenerationEvent[] = [];
    await ctx.client.generate(big, e => events.push(e), new AbortController().signal);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'DOCUMENT_TOO_LARGE' })]);
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('sans appairage ou déjà interrompue : une seule erreur, aucune requête', async () => {
    const ctx = setup();
    expect(await collect(ctx.client)).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNPAIRED' })]);
    await pairClient(ctx);
    ctx.connector.requests.length = 0;
    const abort = new AbortController();
    abort.abort();
    expect(await collect(ctx.client, abort.signal)).toEqual([expect.objectContaining({ type: 'error', code: 'GENERATION_ABORTED' })]);
    expect(ctx.connector.requests).toHaveLength(0);
  });
});

describe('unpair', () => {
  it('retire l’autorisation dans l’application (DELETE signé) puis oublie l’appairage', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const clientId = (await ctx.store.load())!.clientId;
    await ctx.client.unpair();
    expect(ctx.connector.calls(CONNECTOR_ROUTES.pair, 'DELETE')).toHaveLength(1);
    expect(ctx.connector.clients.has(clientId)).toBe(false);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('SA Magistra fermée, celle d’une autre session ouverte : son 401 (sans marque) ne confirme PAS le retrait', async () => {
    const ctx = setup({ [P1]: 'magistra' });
    await pairClient(ctx);
    ctx.connector.setPort(P1, 'closed').setPort(P2, 'other-magistra');
    expect(await ctx.client.unpair()).toBe(false);
    expect(await ctx.client.hasPairing()).toBe(false);
    // L'application de l'enseignant autorise toujours ce navigateur : l'avertissement est justifié.
    expect(ctx.connector.clients.size).toBe(1);
    // Même avec le port mémorisé repris par l'autre application.
    const again = setup({ [P1]: 'magistra' });
    await pairClient(again);
    again.connector.setPort(P1, 'other-magistra');
    expect(await again.client.unpair()).toBe(false);
  });

  it('retrait déjà fait dans l’application (marque de retrait valide) : confirmé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.revokeAll();
    expect(await ctx.client.unpair()).toBe(true);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('autorisation à demander : le navigateur retient DELETE jusqu’à la réponse de l’enseignant (accord après 7 s) → retrait confirmé', async () => {
    const ctx = setup();
    await pairClient(ctx);
    const clientId = (await ctx.store.load())!.clientId;
    ctx.setPermission('prompt');
    // Navigateur qui applique la protection : chaque requête reste retenue tant que l'enseignant n'a pas répondu à
    // sa question ; interrompue si le site l'abandonne.
    let answered = false;
    const release: (() => void)[] = [];
    const client = new LocalConnectorClient({
      ...ctx.options,
      fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (!answered) {
          await new Promise<void>((resolve, reject) => {
            release.push(resolve);
            init.signal?.addEventListener('abort', () => reject(new TypeError('Failed to fetch')), { once: true });
          });
        }
        return ctx.connector.fetch(input, init);
      }) as typeof fetch,
    });
    vi.useFakeTimers();
    try {
      const result = client.unpair();
      await vi.advanceTimersByTimeAsync(7_000);
      answered = true;
      ctx.setPermission('granted');
      for (const resolve of release.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(ctx.connector.calls(CONNECTOR_ROUTES.pair, 'DELETE')).toHaveLength(1);
    expect(ctx.connector.clients.has(clientId)).toBe(false);
    expect(await ctx.client.hasPairing()).toBe(false);
  });

  it('application fermée : appairage oublié quand même', async () => {
    const ctx = setup();
    await pairClient(ctx);
    ctx.connector.setPort(P1, 'closed');
    await ctx.client.unpair();
    expect(await ctx.client.hasPairing()).toBe(false);
  });
});
