// Client de génération du site web : serveur en ligne OU Magistra locale selon le choix de l'enseignant.
// Jamais de repli silencieux du local vers le serveur ; résultat local enregistré dans l'historique du compte.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES } from '@shared/apiContract';
import { MagistraError } from '@shared/errors';
import { CONNECTOR_PORTS, CONNECTOR_ROUTES, LOCAL_ENGINE_SITE_MESSAGES } from '@shared/localConnector';
import type { Capabilities, GenerationEvent, GenerationRecordDraft, GenerationRequest } from '@shared/types';
import { STOPPED_BY_APP_MESSAGE } from '@/lib/localConnector/client';
import { createLocalEngineController } from '@/lib/localConnector/controller';
import { resetEngineChoiceMemory, setEngineChoice } from '@/lib/localConnector/engineChoice';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import type { LoopbackPermission } from '@/lib/localConnector/permission';
import {
  appSupportsToolOptions, HybridGenerationClient, ignoredToolOptions, ignoredToolOptionsMessage, localAppTooOldMessage,
  LOCAL_NEEDS_PERMISSION_MESSAGE, LOCAL_NOT_CONNECTED_MESSAGE, LOCAL_PRIVACY_MESSAGE, LOCAL_SAVE_FAILED_MESSAGE, localCapabilities,
  recentMatiere, requestedToolOptions, substitutedRequestMessage, TOOL_OPTIONS_MIN_APP_VERSION,
} from '@/lib/runtime/hybrid';
import type { GenerationClient } from '@/lib/runtime/types';
import { ApiDataStore } from '@/lib/runtime/web';
import { DEFAULT_EVENTS, fakeClock, FakeConnector, READY_STATUS, RECORD } from './fakeConnector';

const [P1] = CONNECTOR_PORTS;

const REQUEST: GenerationRequest = {
  type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'La fable', researchMode: 'documents',
  documents: [{ docId: 'd1', docName: 'fables.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 1 }, text: 'Le corbeau et le renard…' }],
};

const SERVER_CAPS: Capabilities = {
  maxDocumentChars: 20_000,
  research: { academic: true, web: true, institutional: true, wikipedia: true },
  privacy: { level: 'server', message: 'Serveur en ligne.' },
  engineLabel: 'OVHcloud AI Endpoints',
  ready: true,
  providerInfo: { label: 'OVHcloud AI Endpoints', thirdParty: true },
};

function fakeServer() {
  const calls: string[] = [];
  const server: GenerationClient = {
    kind: 'web',
    capabilities: vi.fn(async () => {
      calls.push('capabilities');
      return SERVER_CAPS;
    }),
    generate: vi.fn(async (_request: GenerationRequest, onEvent: (event: GenerationEvent) => void) => {
      calls.push('generate');
      onEvent({ type: 'done', content: 'Serveur', sources: [], truncated: false, internetUsed: false, saved: true, id: 'srv-1', model: 'm' });
    }),
  };
  return { server, calls };
}

function setup() {
  const clock = fakeClock();
  const connector = new FakeConnector(clock.now);
  connector.setPort(P1, 'magistra');
  const store = new MemoryPairingStore();
  let permission: LoopbackPermission = 'granted';
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
  const { server, calls } = fakeServer();
  const saved: GenerationRecordDraft[] = [];
  const saveDraft = vi.fn(async (draft: GenerationRecordDraft) => {
    saved.push(draft);
    return { id: 'gen-42' };
  });
  const client = new HybridGenerationClient(server, controller, saveDraft);
  return {
    clock, connector, controller, server, serverCalls: calls, saveDraft, saved, client,
    setPermission(next: LoopbackPermission) {
      permission = next;
    },
    /** Nouvelle page : même appairage mémorisé, contrôleur neuf (rien vérifié). */
    reload() {
      const local = createLocalEngineController(options);
      return { local, client: new HybridGenerationClient(server, local, saveDraft) };
    },
  };
}

async function collect(client: GenerationClient): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  await client.generate(REQUEST, e => events.push(e), new AbortController().signal);
  return events;
}

beforeEach(() => {
  resetEngineChoiceMemory();
});

afterEach(() => {
  resetEngineChoiceMemory();
  vi.unstubAllGlobals();
});

describe('choix du moteur au moment de l’appel', () => {
  it('jamais appairé, aucun choix : serveur en ligne (capacités du serveur, route « server »)', async () => {
    const ctx = setup();
    expect(await ctx.client.capabilities()).toEqual({ ...SERVER_CAPS, route: 'server' });
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('appairé, aucun choix : Magistra locale — même avant toute vérification du contrôleur', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    const page = ctx.reload();
    expect(page.local.getSnapshot()).toMatchObject({ kind: 'idle', paired: false });
    expect(await page.client.route()).toBe('local-connector');
    expect(await collect(page.client)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'done', saved: true, id: 'gen-42' })]));
    expect(ctx.serverCalls).toEqual([]);
  });

  it('le choix explicite est relu à chaque appel', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    expect((await ctx.client.capabilities()).route).toBe('local-connector');
    setEngineChoice('server');
    expect((await ctx.client.capabilities()).route).toBe('server');
    expect(await collect(ctx.client)).toEqual([expect.objectContaining({ type: 'done', id: 'srv-1' })]);
    setEngineChoice('local');
    await collect(ctx.client);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
  });
});

describe('capacités de Magistra locale', () => {
  it('connectée : IA locale annoncée, libellé du modèle, limites de l’application, aucun prestataire', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    const caps = await ctx.client.capabilities();
    expect(caps).toEqual({
      maxDocumentChars: READY_STATUS.capabilities.maxDocumentChars,
      research: READY_STATUS.capabilities.research,
      privacy: { level: 'local', message: LOCAL_PRIVACY_MESSAGE },
      route: 'local-connector',
      engineLabel: 'Magistra locale — Magistra Standard',
      ready: true,
    });
    expect(caps.providerInfo).toBeUndefined();
  });

  it('injoignable : non prête (CONNECTOR_UNREACHABLE), JAMAIS de repli vers le serveur', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.setPort(P1, 'closed');
    const caps = await ctx.client.capabilities();
    expect(caps).toMatchObject({ ready: false, route: 'local-connector', notReady: { code: 'CONNECTOR_UNREACHABLE' } });
    expect(ctx.serverCalls).toEqual([]);
  });

  it('application réglée sur un serveur distant : non prête (LOCAL_ENGINE_REMOTE)', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.status = { ...READY_STATUS, engine: { ...READY_STATUS.engine, local: false, label: 'Serveur d’IA distant' } };
    expect(await ctx.client.capabilities()).toMatchObject({ ready: false, notReady: { code: 'LOCAL_ENGINE_REMOTE' } });
  });

  it('modèle absent : cause précise de l’application ; occupée : avertissement non bloquant', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.status = {
      ...READY_STATUS,
      engine: { ...READY_STATUS.engine, ready: false, notReady: { code: 'MODEL_NOT_INSTALLED', message: 'Modèle à installer dans Magistra.' } },
    };
    expect(await ctx.client.capabilities()).toMatchObject({ ready: false, notReady: { code: 'MODEL_NOT_INSTALLED', message: 'Modèle à installer dans Magistra.' } });
    ctx.connector.status = { ...READY_STATUS, busy: true };
    expect(await ctx.client.capabilities()).toMatchObject({ ready: true, aiWarning: { code: 'GENERATION_BUSY' } });
  });

  it('autorisation du navigateur à redemander : non prête, explication, aucune demande automatique', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    // Autre page : l'autorisation du navigateur a été réinitialisée entre-temps.
    ctx.setPermission('prompt');
    const page = ctx.reload();
    ctx.connector.requests.length = 0;
    const caps = await page.client.capabilities();
    expect(caps).toMatchObject({
      ready: false, route: 'local-connector', notReady: { code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: LOCAL_NEEDS_PERMISSION_MESSAGE },
    });
    expect(page.local.getSnapshot().kind).toBe('needs-permission');
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('choix local sans appairage : non prête, invitation à connecter (jamais le serveur)', async () => {
    const ctx = setup();
    setEngineChoice('local');
    const caps = await ctx.client.capabilities();
    expect(caps).toMatchObject({ ready: false, route: 'local-connector', notReady: { code: 'CONNECTOR_UNPAIRED', message: LOCAL_NOT_CONNECTED_MESSAGE } });
    expect(ctx.serverCalls).toEqual([]);
  });

  it('chaque état du contrôleur donne une capacité non prête et explicite', () => {
    for (const kind of ['idle', 'checking', 'needs-permission', 'permission-denied', 'not-found', 'found', 'pairing', 'app-closed'] as const) {
      const caps = localCapabilities({ kind, paired: kind === 'app-closed', permission: 'granted' });
      expect(caps.ready).toBe(false);
      expect(caps.route).toBe('local-connector');
      expect(caps.privacy.level).toBe('local');
      expect(caps.notReady?.message).toMatch(/\S/);
      expect(caps.notReady?.message).not.toMatch(/localhost|127\.0\.0\.1|ollama|47831/i);
    }
  });
});

describe('génération locale', () => {
  it('extraits de documents envoyés UNIQUEMENT au connecteur ; résultat enregistré ; done { saved, id } sans record', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    const events = await collect(ctx.client);
    expect(ctx.serverCalls).toEqual([]);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
    expect(ctx.saved).toEqual([{ ...RECORD, sources: [], params: { ...RECORD.params } }]);
    expect(JSON.stringify(ctx.saved)).not.toContain('corbeau');
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: 'done', saved: true, id: 'gen-42', content: '# La fable\n\nTexte.' });
    expect('record' in done).toBe(false);
    expect(events.slice(0, -1)).toEqual(DEFAULT_EVENTS.slice(0, -1));
  });

  it('enregistrement impossible : avertissement STORAGE_ERROR puis done non enregistré (contenu conservé)', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.saveDraft.mockRejectedValueOnce(new MagistraError('STORAGE_ERROR'));
    let events = await collect(ctx.client);
    expect(events.slice(-2)).toEqual([
      { type: 'warning', code: 'STORAGE_ERROR', message: LOCAL_SAVE_FAILED_MESSAGE },
      expect.objectContaining({ type: 'done', saved: false, id: undefined, content: '# La fable\n\nTexte.' }),
    ]);
    expect('record' in events.at(-1)!).toBe(false);

    ctx.saveDraft.mockRejectedValueOnce(new MagistraError('UNAUTHENTICATED'));
    events = await collect(ctx.client);
    expect(events.at(-2)).toMatchObject({ type: 'warning', code: 'STORAGE_ERROR', message: expect.stringContaining('Session expirée : reconnectez-vous') });
  });

  it('génération locale réussie alors que l’état affiché était « application fermée » : état relu (jamais « fermée » à côté du résultat)', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    // Page Générer ouverte application fermée ; l'enseignant lance Magistra depuis le menu Démarrer, puis « Générer ».
    ctx.connector.setPort(P1, 'closed');
    await ctx.controller.refresh();
    expect(ctx.controller.getSnapshot().kind).toBe('app-closed');
    ctx.connector.setPort(P1, 'magistra');
    ctx.clock.advance(60_000);
    const events = await collect(ctx.client);
    expect(events.at(-1)).toMatchObject({ type: 'done', saved: true });
    await vi.waitFor(() => expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', status: READY_STATUS }));
  });

  it('« done » sans génération à enregistrer : non enregistré, signalé', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.events = DEFAULT_EVENTS.map(e => (e.type === 'done' ? { ...e, record: undefined } : e));
    const events = await collect(ctx.client);
    expect(ctx.saveDraft).not.toHaveBeenCalled();
    expect(events.slice(-2)).toEqual([
      { type: 'warning', code: 'STORAGE_ERROR', message: LOCAL_SAVE_FAILED_MESSAGE },
      expect.objectContaining({ type: 'done', saved: false }),
    ]);
  });

  it('erreur locale : évènement d’erreur, AUCUN nouvel essai sur le serveur, état relu', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.setPort(P1, 'closed');
    ctx.clock.advance(60_000); // preuve périmée : nouvelle vérification avant l'envoi
    const events = await collect(ctx.client);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
    expect(ctx.serverCalls).toEqual([]);
    expect(ctx.saveDraft).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ctx.controller.getSnapshot().kind).toBe('app-closed'));
  });

  it('messages de l’application qui nomment le moteur, un port ou un chemin : jamais affichés tels quels (texte neutre)', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    // Application ancienne ou filtre incomplet : la seconde barrière du site s'applique à chaque évènement.
    ctx.connector.events = [
      { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'Recherche impossible : le port 8080 ne répond pas.' },
      { type: 'error', code: 'ENGINE_NOT_RUNNING', message: 'Le moteur IA ne démarre pas. Un antivirus bloque peut-être Ollama (ollama.exe). Dernière erreur : « ~\\AppData\\Local\\Programs\\x\\lib ».', retryable: true },
    ];
    const events = await collect(ctx.client);
    expect(events).toEqual([
      { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'Recherche Internet indisponible : génération à partir des autres sources.' },
      { type: 'error', code: 'ENGINE_NOT_RUNNING', message: LOCAL_ENGINE_SITE_MESSAGES.ENGINE_NOT_RUNNING, retryable: true },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/ollama|port 8080|AppData/i);
    // Moteur trop ancien : le message générique du code cite lui-même le moteur.
    ctx.connector.events = [{ type: 'error', code: 'ENGINE_OUTDATED', message: '', retryable: false }];
    expect(await collect(ctx.client)).toEqual([{ type: 'error', code: 'ENGINE_OUTDATED', message: LOCAL_ENGINE_SITE_MESSAGES.ENGINE_OUTDATED, retryable: false }]);
  });

  it('génération arrêtée par l’application (autorisation retirée) : erreur explicite, jamais « interrompue » comme un Arrêter ; état relu', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    const refresh = vi.spyOn(ctx.controller, 'refresh');
    ctx.connector.events = [
      { type: 'delta', text: 'Le corbeau' },
      { type: 'error', code: 'GENERATION_ABORTED', message: 'Génération interrompue.', retryable: true, partial: 'Le corbeau' },
    ];
    const events = await collect(ctx.client);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STOPPED_BY_APP_MESSAGE, retryable: true, partial: 'Le corbeau' });
    expect(refresh).toHaveBeenCalled();
    // Arrêt demandé par l'enseignant sur ce site : « interrompue », comme toujours.
    const controller = new AbortController();
    const mine: GenerationEvent[] = [];
    await ctx.client.generate(REQUEST, e => {
      mine.push(e);
      if (e.type === 'delta') controller.abort();
    }, controller.signal);
    expect(mine.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });

  it('erreur de l’application (409 occupée) : transmise telle quelle', async () => {
    const ctx = setup();
    await ctx.controller.connect();
    ctx.connector.generateError = { status: 409, code: 'GENERATION_BUSY', message: 'Une génération est déjà en cours dans Magistra.' };
    expect(await collect(ctx.client)).toEqual([
      { type: 'error', code: 'GENERATION_BUSY', message: 'Une génération est déjà en cours dans Magistra.', retryable: true },
    ]);
    expect(ctx.serverCalls).toEqual([]);
  });
});

describe('options des outils et version de l’application Windows (protocole inchangé)', () => {
  /** Texte à trous de 10 mots, version élève seule : ignorés sans erreur par une application d'avant 2.0.3. */
  const OPTIONS_REQUEST: GenerationRequest = {
    type: 'exercices', niveau: '6eme', matiere: 'francais', sujet: 'Les accords', researchMode: 'documents',
    modalite: 'texte_trous', nombreExercices: 10, sansCorrige: true,
  };
  const APPLIED = { researchMode: 'documents', modalite: 'texte_trous', nombreExercices: 10, sansCorrige: true };

  /** Version annoncée par l'application (hello et état signé). */
  function setAppVersion(connector: FakeConnector, version: string) {
    connector.version = version;
    connector.status = { ...structuredClone(READY_STATUS), version };
  }

  /**
   * Génération à enregistrer telle que l'application la renvoie : outil, niveau et matière de la demande qu'elle a
   * traitée (par défaut, ceux de la demande envoyée), paramètres.
   */
  function recordParams(
    connector: FakeConnector, params: Record<string, unknown>,
    treated: Pick<GenerationRequest, 'type' | 'niveau' | 'matiere'> = OPTIONS_REQUEST,
  ) {
    const { type, niveau, matiere } = treated;
    connector.events = DEFAULT_EVENTS.map(e => (e.type === 'done' ? { ...e, record: { ...RECORD, type, niveau, matiere, sources: [], params } } : e));
  }

  async function run(client: GenerationClient, request: GenerationRequest = OPTIONS_REQUEST): Promise<GenerationEvent[]> {
    const events: GenerationEvent[] = [];
    await client.generate(request, e => events.push(e), new AbortController().signal);
    return events;
  }

  it('application 2.0.2 : demande refusée AVANT l’envoi (aucune génération, aucun corrigé), message de mise à jour', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', appVersion: '2.0.2' });
    const events = await run(ctx.client);
    const message = localAppTooOldMessage(['modalite', 'sansCorrige', 'nombreExercices']);
    expect(events).toEqual([{ type: 'error', code: 'CONNECTOR_UNREACHABLE', message, retryable: true }]);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
    expect(ctx.saveDraft).not.toHaveBeenCalled();
    expect(ctx.serverCalls).toEqual([]);
    // Les choix de l'enseignant et la version nécessaire (réinstaller la même version ne suffit pas).
    expect(message).toBe("Vos choix (format, version élève seule, nombre demandé) demandent Magistra pour Windows 2.0.3 ou plus récente, et l'application de cet ordinateur est plus ancienne : installez la dernière version (Réglages → « Magistra pour Windows »), puis réessayez, ou générez sans ces choix.");
    expect(message).not.toMatch(/localhost|127\.0\.0\.1|ollama|47831/i);
    // L'état affiché reste « connectée » : l'application sert toujours les demandes sans ces options.
    expect(ctx.controller.getSnapshot().kind).toBe('connected');
  });

  it('application 2.0.2, demande sans ces options : envoyée comme avant (les anciennes applications restent utilisables)', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    const events = await collect(ctx.client);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', saved: true, id: 'gen-42' });
    expect(events.filter(e => e.type === 'warning')).toEqual([]);
  });

  it('application 2.0.3 (et pré-version de 2.0.3) : envoyée, options appliquées, aucun avertissement', async () => {
    for (const version of ['2.0.3', '2.0.3-beta.1', '2.1.0']) {
      const ctx = setup();
      setAppVersion(ctx.connector, version);
      recordParams(ctx.connector, APPLIED);
      await ctx.controller.connect();
      const statusCalls = ctx.connector.calls(CONNECTOR_ROUTES.status).length;
      const events = await run(ctx.client);
      expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
      expect(JSON.parse(ctx.connector.calls(CONNECTOR_ROUTES.generate)[0].body)).toMatchObject({ modalite: 'texte_trous', sansCorrige: true, nombreExercices: 10 });
      // Version connue et suffisante : aucune relecture de l'état avant l'envoi.
      expect(ctx.connector.calls(CONNECTOR_ROUTES.status)).toHaveLength(statusCalls);
      expect(events.filter(e => e.type === 'warning' || e.type === 'error')).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: 'done', saved: true, id: 'gen-42' });
    }
  });

  it('version affichée périmée (application mise à jour depuis) : relue avant de refuser, puis envoyée', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    // L'enseignant installe la mise à jour, puis clique sur « Réessayer » : l'état affiché dit encore 2.0.2.
    setAppVersion(ctx.connector, '2.0.3');
    recordParams(ctx.connector, APPLIED);
    expect(ctx.controller.getSnapshot().appVersion).toBe('2.0.2');
    const events = await run(ctx.client);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', saved: true });
    expect(ctx.controller.getSnapshot()).toMatchObject({ kind: 'connected', appVersion: '2.0.3' });
  });

  it('version pas encore lue (nouvelle page) : lue avant l’envoi ; 2.0.2 → refusée', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    const page = ctx.reload();
    expect(page.local.getSnapshot().appVersion).toBeUndefined();
    const events = await run(page.client);
    expect(events).toEqual([
      { type: 'error', code: 'CONNECTOR_UNREACHABLE', message: localAppTooOldMessage(['modalite', 'sansCorrige', 'nombreExercices']), retryable: true },
    ]);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
  });

  it('application fermée au moment de la relecture : jamais « mettez à jour » à tort, l’erreur de connexion est transmise', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    ctx.connector.setPort(P1, 'closed');
    ctx.clock.advance(60_000);
    const events = await run(ctx.client);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
    expect(events[0]).not.toMatchObject({ message: localAppTooOldMessage(['modalite', 'sansCorrige', 'nombreExercices']) });
    expect(events[0]).not.toMatchObject({ message: expect.stringContaining('plus récente') });
  });

  it('version illisible : envoyée ; options absentes des paramètres renvoyés → avertissement AVANT « done », contenu gardé', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, 'dev');
    recordParams(ctx.connector, { researchMode: 'documents' });
    await ctx.controller.connect();
    const events = await run(ctx.client);
    expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
    const message = ignoredToolOptionsMessage(['modalite', 'sansCorrige', 'nombreExercices']);
    expect(events.slice(-2)).toEqual([
      { type: 'warning', code: 'CONNECTOR_UNREACHABLE', message },
      expect.objectContaining({ type: 'done', saved: true, id: 'gen-42', content: '# La fable\n\nTexte.' }),
    ]);
    expect(message).toContain('format, version élève seule, nombre demandé');
    expect(message).toContain('peut contenir un corrigé');
  });

  it('options appliquées d’après les paramètres renvoyés, ou paramètres absents : aucun avertissement', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, 'dev');
    await ctx.controller.connect();
    recordParams(ctx.connector, APPLIED);
    expect((await run(ctx.client)).filter(e => e.type === 'warning')).toEqual([]);
    // Pas de génération à enregistrer : seul l'avertissement d'enregistrement (rien n'est affirmé sur les options).
    ctx.connector.events = DEFAULT_EVENTS.map(e => (e.type === 'done' ? { ...e, record: undefined } : e));
    expect((await run(ctx.client)).filter(e => e.type === 'warning')).toEqual([{ type: 'warning', code: 'STORAGE_ERROR', message: LOCAL_SAVE_FAILED_MESSAGE }]);
  });

  it('serveur en ligne choisi : options envoyées au serveur, aucune vérification de l’application', async () => {
    const ctx = setup();
    setAppVersion(ctx.connector, '2.0.2');
    await ctx.controller.connect();
    setEngineChoice('server');
    ctx.connector.requests.length = 0;
    expect(await run(ctx.client)).toEqual([expect.objectContaining({ type: 'done', id: 'srv-1' })]);
    expect(ctx.connector.requests).toHaveLength(0);
  });

  it('application 2.0.2 : le refus nomme le choix de l’enseignant (ton, besoins particuliers…), jamais une liste fixe', async () => {
    const cases: [Partial<GenerationRequest>, string][] = [
      [{ type: 'appreciations', ton: 'exigeant' }, 'Votre choix (ton) demande Magistra pour Windows 2.0.3 ou plus récente'],
      [{ type: 'differenciation', besoins: ['dys'] }, 'Votre choix (besoins particuliers) demande Magistra pour Windows 2.0.3 ou plus récente'],
      [{ type: 'evaluation', typeEvaluation: 'sommative' }, "Votre choix (objectif de l'évaluation) demande"],
      [{ type: 'sequence', nombreSeances: 5 }, 'Votre choix (nombre de séances) demande'],
      [{ type: 'appreciations', ton: 'factuel', bareme: 'sur20' }, 'Vos choix (notation, ton) demandent Magistra pour Windows 2.0.3 ou plus récente'],
    ];
    for (const [fields, expected] of cases) {
      const ctx = setup();
      setAppVersion(ctx.connector, '2.0.2');
      await ctx.controller.connect();
      const request: GenerationRequest = { type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'Trimestre 1', researchMode: 'documents', ...fields };
      const events = await run(ctx.client, request);
      expect(events).toEqual([{ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: expect.stringContaining(expected), retryable: true }]);
      const { message } = events[0] as Extract<GenerationEvent, { type: 'error' }>;
      expect(message).not.toContain('format');
      expect(message).toMatch(/ou générez sans ce(s)? choix\.$/);
      expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
    }
  });

  describe('matière récente « Se repérer dans le temps et l’espace » (inconnue avant 2.0.3)', () => {
    const TEMPS_ESPACE: GenerationRequest = {
      type: 'cours', niveau: 'maternelle_ms', matiere: 'temps_espace', sujet: 'Les jours de la semaine', researchMode: 'documents',
    };
    const REFUSAL =
      "La matière « Se repérer dans le temps et l'espace » demande Magistra pour Windows 2.0.3 ou plus récente, et l'application de cet ordinateur est plus ancienne : installez la dernière version (Réglages → « Magistra pour Windows »), puis réessayez, ou choisissez le serveur en ligne.";

    it('application 2.0.2, aucune option : refusée AVANT l’envoi (jamais rédigée pour « Mobiliser le langage — Oral »), la matière est nommée', async () => {
      const ctx = setup();
      setAppVersion(ctx.connector, '2.0.2');
      await ctx.controller.connect();
      expect(requestedToolOptions(TEMPS_ESPACE)).toEqual([]);
      const events = await run(ctx.client, TEMPS_ESPACE);
      expect(events).toEqual([{ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: REFUSAL, retryable: true }]);
      expect(localAppTooOldMessage([], 'temps_espace')).toBe(REFUSAL);
      expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
      expect(ctx.saveDraft).not.toHaveBeenCalled();
      expect(ctx.serverCalls).toEqual([]);
    });

    it('version pas encore lue (nouvelle page), fiche de préparation GS : lue avant l’envoi ; 2.0.2 → refusée', async () => {
      const ctx = setup();
      setAppVersion(ctx.connector, '2.0.2');
      await ctx.controller.connect();
      const page = ctx.reload();
      const request: GenerationRequest = { ...TEMPS_ESPACE, type: 'fiche_prep', niveau: 'maternelle_gs' };
      expect(await run(page.client, request)).toEqual([{ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: REFUSAL, retryable: true }]);
      expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(0);
    });

    it('matière récente et une option : les deux sont nommées', async () => {
      const ctx = setup();
      setAppVersion(ctx.connector, '2.0.2');
      await ctx.controller.connect();
      const events = await run(ctx.client, { ...TEMPS_ESPACE, modalite: 'atelier' });
      expect(events).toEqual([{
        type: 'error', code: 'CONNECTOR_UNREACHABLE', retryable: true,
        message: expect.stringMatching(/^La matière « Se repérer dans le temps et l'espace » et votre choix \(format\) demandent Magistra pour Windows 2\.0\.3 ou plus récente/),
      }]);
    });

    it('application 2.0.3 : envoyée, enregistrée sous la matière choisie, aucun avertissement', async () => {
      const ctx = setup();
      setAppVersion(ctx.connector, '2.0.3');
      recordParams(ctx.connector, { researchMode: 'documents' }, TEMPS_ESPACE);
      await ctx.controller.connect();
      const events = await run(ctx.client, TEMPS_ESPACE);
      expect(JSON.parse(ctx.connector.calls(CONNECTOR_ROUTES.generate)[0].body)).toMatchObject({ matiere: 'temps_espace' });
      expect(events.filter(e => e.type === 'warning' || e.type === 'error')).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: 'done', saved: true, id: 'gen-42' });
      expect(ctx.saved).toEqual([expect.objectContaining({ matiere: 'temps_espace' })]);
    });

    it('version inconnue, matière remplacée par l’application : avertissement AVANT « done », JAMAIS enregistrée sous l’autre matière', async () => {
      const ctx = setup();
      setAppVersion(ctx.connector, 'dev');
      // Application 2.0.2 : « temps_espace » inconnu → première matière du niveau, sans erreur.
      recordParams(ctx.connector, { researchMode: 'documents' }, { ...TEMPS_ESPACE, matiere: 'langage_oral' });
      await ctx.controller.connect();
      const events = await run(ctx.client, TEMPS_ESPACE);
      expect(ctx.connector.calls(CONNECTOR_ROUTES.generate)).toHaveLength(1);
      const message = substitutedRequestMessage(TEMPS_ESPACE, { ...RECORD, type: 'cours', niveau: 'maternelle_ms', matiere: 'langage_oral' });
      expect(message).toBe(
        "La matière « Se repérer dans le temps et l'espace » n'est pas connue de l'application Magistra de cet ordinateur, trop ancienne : le contenu a été rédigé pour « Mobiliser le langage — Oral ». Il n'a pas été enregistré dans l'historique. Installez Magistra pour Windows 2.0.3 ou plus récente (Réglages → « Magistra pour Windows »), puis relancez la génération.",
      );
      expect(events.slice(-2)).toEqual([
        { type: 'warning', code: 'CONNECTOR_UNREACHABLE', message },
        expect.objectContaining({ type: 'done', saved: false, id: undefined, content: '# La fable\n\nTexte.' }),
      ]);
      expect('record' in events.at(-1)!).toBe(false);
      expect(ctx.saveDraft).not.toHaveBeenCalled();
    });
  });

  it('matière, outil ou niveau remplacés, et matières récentes (fonctions pures)', () => {
    expect(recentMatiere({ ...REQUEST, niveau: 'maternelle_gs', matiere: 'temps_espace' })).toBe('temps_espace');
    expect(recentMatiere({ ...REQUEST, niveau: 'maternelle_gs', matiere: 'langage_oral' })).toBeNull();
    expect(recentMatiere(REQUEST)).toBeNull();

    expect(substitutedRequestMessage(REQUEST, RECORD)).toBeNull();
    expect(substitutedRequestMessage(REQUEST, undefined)).toBeNull();
    expect(substitutedRequestMessage(REQUEST, ['francais'])).toBeNull();
    // Champ absent ou illisible : rien n'est affirmé.
    expect(substitutedRequestMessage(REQUEST, { ...RECORD, matiere: undefined, niveau: 6 })).toBeNull();
    // Matière inconnue du site : jamais recopiée telle quelle dans le message.
    const unknown = substitutedRequestMessage(REQUEST, { ...RECORD, matiere: 'x<script>' });
    expect(unknown).toContain('rédigé pour une autre matière');
    expect(unknown).not.toContain('script');
    expect(substitutedRequestMessage(REQUEST, { ...RECORD, type: 'exercices' })).toMatch(/ne correspond pas à l'outil ou au niveau demandés\. Il n'a pas été enregistré/);
    expect(substitutedRequestMessage(REQUEST, { ...RECORD, niveau: '5eme' })).toMatch(/l'outil ou au niveau/);

    expect(localAppTooOldMessage(['ton'])).toBe(
      "Votre choix (ton) demande Magistra pour Windows 2.0.3 ou plus récente, et l'application de cet ordinateur est plus ancienne : installez la dernière version (Réglages → « Magistra pour Windows »), puis réessayez, ou générez sans ce choix.",
    );
    expect(localAppTooOldMessage(['besoins', 'modalite'])).toMatch(/^Vos choix \(format, besoins particuliers\) demandent .* ou générez sans ces choix\.$/);
    expect(localAppTooOldMessage(['modalite', 'bareme'], 'temps_espace')).toMatch(/^La matière « Se repérer dans le temps et l'espace » et vos choix \(format, notation\) demandent .* ou choisissez le serveur en ligne\.$/);
    for (const message of [localAppTooOldMessage(['sansCorrige']), localAppTooOldMessage([], 'temps_espace'), ignoredToolOptionsMessage(['ton'])]) {
      expect(message).toContain(`Magistra pour Windows ${TOOL_OPTIONS_MIN_APP_VERSION} ou plus récente`);
    }
  });

  it('options renseignées, versions et options non appliquées (fonctions pures)', () => {
    expect(requestedToolOptions(REQUEST)).toEqual([]);
    expect(requestedToolOptions({ ...REQUEST, sansCorrige: false, besoins: [], ton: undefined })).toEqual([]);
    expect(requestedToolOptions({ ...REQUEST, bareme: 'sur20', besoins: ['dys'], typeEvaluation: 'sommative', ton: 'encourageant', nombreSeances: 5 }))
      .toEqual(['nombreSeances', 'typeEvaluation', 'bareme', 'ton', 'besoins']);
    expect(requestedToolOptions(OPTIONS_REQUEST)).toEqual(['modalite', 'sansCorrige', 'nombreExercices']);

    expect(appSupportsToolOptions('2.0.2')).toBe(false);
    expect(appSupportsToolOptions('1.9.9')).toBe(false);
    expect(appSupportsToolOptions('2.0.2-rc.1')).toBe(false);
    expect(appSupportsToolOptions('2.0.3')).toBe(true);
    expect(appSupportsToolOptions('2.0.3-beta.1')).toBe(true);
    expect(appSupportsToolOptions('10.0.0')).toBe(true);
    expect(appSupportsToolOptions(undefined)).toBeNull();
    expect(appSupportsToolOptions('dev')).toBeNull();

    expect(ignoredToolOptions(OPTIONS_REQUEST, { researchMode: 'documents' })).toEqual(['modalite', 'sansCorrige', 'nombreExercices']);
    expect(ignoredToolOptions(OPTIONS_REQUEST, APPLIED)).toEqual([]);
    expect(ignoredToolOptions(OPTIONS_REQUEST, { ...APPLIED, sansCorrige: undefined })).toEqual(['sansCorrige']);
    expect(ignoredToolOptions(OPTIONS_REQUEST, undefined)).toEqual([]);
    expect(ignoredToolOptions(OPTIONS_REQUEST, ['modalite'])).toEqual([]);
    expect(ignoredToolOptions(REQUEST, { researchMode: 'documents' })).toEqual([]);

    expect(ignoredToolOptionsMessage(['bareme'])).toMatch(/^Votre choix \(notation\) n'a pas été appliqué : /);
    expect(ignoredToolOptionsMessage(['bareme'])).not.toContain('corrigé');
    expect(ignoredToolOptionsMessage(['besoins', 'modalite'])).toMatch(/^Vos choix \(format, besoins particuliers\) n'ont pas été appliqués : /);
  });
});

describe('ApiDataStore.saveGenerationDraft', () => {
  it('POST /api/generation { record } avec le jeton de session → { id }', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'gen-7' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = new ApiDataStore(async () => 'jeton', 'user_1');
    const draft = { ...RECORD, sources: [], params: { ...RECORD.params } } as GenerationRecordDraft;
    expect(await store.saveGenerationDraft(draft)).toEqual({ id: 'gen-7' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(API_ROUTES.generation);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ record: draft });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Authorization')).toBe('Bearer jeton');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('réponse sans identifiant : STORAGE_ERROR ; erreur du serveur : code conservé', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })));
    const store = new ApiDataStore(async () => 'jeton', 'user_1');
    const draft = { ...RECORD, sources: [], params: {} } as GenerationRecordDraft;
    await expect(store.saveGenerationDraft(draft)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Contenu vide.' } }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await expect(store.saveGenerationDraft(draft)).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'Contenu vide.' });
  });
});
