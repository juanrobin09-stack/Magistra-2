// État de Magistra locale (IA de l'ordinateur de l'enseignant, via l'application Windows) pour le SITE WEB : un seul
// contrôleur par page (WebRuntimeProvider), partagé par la carte du tableau de bord, les réglages et la page Générer.
//
// Règles :
//  - la vérification automatique (autoCheck, refresh) ne fait JAMAIS apparaître la demande d'autorisation du
//    navigateur : autorisation encore à demander ('prompt') → état 'needs-permission' si appairé (l'interface explique
//    avant de lancer la recherche), sinon 'not-found' sans rien sonder ; navigateur sans ce mécanisme ('unsupported')
//    et jamais appairé → rien n'est sondé non plus (aucune requête vers cet ordinateur sans action de l'enseignant) ;
//  - seules les actions de l'enseignant (detect, connect, openApp, disconnect) peuvent la faire apparaître ;
//  - l'opération la plus récente l'emporte : le résultat d'une vérification dépassée n'est jamais affiché ; une
//    vérification automatique ne remplace jamais un appairage ou une recherche en cours ;
//  - l'état n'est publié que s'il change (pas de rendu inutile, pas de boucle « état → capacités → état »).

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { defaultMessage, isAbortError, toMagistraError, type ErrorCode, type MagistraError } from '@shared/errors';
import { OPEN_APP_URL, type ConnectorStatus } from '@shared/localConnector';
import { defaultSleep, LocalConnectorClient, openMagistraUrl, type LocalConnectorClientOptions } from './client';
import { adoptLocalChoiceAfterPairing } from './engineChoice';
import { queryLoopbackPermission, type LoopbackPermission } from './permission';

export type LocalEngineStateKind =
  | 'idle'               // rien vérifié encore
  | 'checking'           // « Recherche de Magistra sur cet ordinateur… »
  | 'needs-permission'   // le navigateur demandera l'autorisation : expliquer avant (bouton « Rechercher Magistra… »)
  | 'permission-denied'  // autorisation refusée par le navigateur : expliquer comment l'accorder
  | 'not-found'          // aucune application trouvée (jamais appairé) : [Réessayer] [Télécharger Magistra]
  | 'found'              // application trouvée, pas encore appairée : [Connecter Magistra locale]
  | 'pairing'            // en attente de l'accord dans l'application
  | 'connected'          // appairé et joignable (status présent)
  | 'app-closed';        // appairé mais injoignable : [Ouvrir Magistra] [Réessayer]

export interface LocalEngineState {
  kind: LocalEngineStateKind;
  /** Un appairage est enregistré dans ce navigateur. */
  paired: boolean;
  /** Autorisation du navigateur (lue sans la demander ; 'unsupported' tant qu'elle n'a pas été lue). */
  permission: LoopbackPermission;
  /** Présent quand kind === 'connected'. */
  status?: ConnectorStatus;
  /** Version de l'application trouvée (hello), si connue. */
  appVersion?: string;
  /** Dernière erreur utile (appairage refusé/expiré, autorisation retirée, permission refusée…). */
  error?: { code: ErrorCode; message: string };
}

export interface LocalEngineController {
  getSnapshot(): LocalEngineState;
  subscribe(listener: () => void): () => void;
  /** Vérification automatique (au montage) : ne déclenche JAMAIS la demande d'autorisation du navigateur. */
  autoCheck(): Promise<void>;
  /**
   * Recherche demandée par l'enseignant (peut déclencher la demande d'autorisation du navigateur : quand
   * `state.permission` vaut 'prompt', l'interface l'explique AVANT d'appeler detect).
   */
  detect(): Promise<void>;
  /** Appairage demandé par l'enseignant : ouvre magistra://pair et attend l'accord (2 min au plus). */
  connect(): Promise<void>;
  cancelPairing(): void;
  /** Ouvre l'application (magistra://open) puis la recherche pendant 60 s au plus. */
  openApp(): Promise<void>;
  /** Retire l'autorisation (DELETE /v1/pair, puis oubli local même si l'application est fermée). */
  disconnect(): Promise<void>;
  /**
   * Nouvel état du moteur (appairé), sans « Recherche… » à l'écran ; comme autoCheck, ne déclenche jamais la demande
   * d'autorisation du navigateur. Sans effet pendant un appairage ou une recherche demandée par l'enseignant.
   */
  refresh(): Promise<void>;
  readonly client: LocalConnectorClient;
}

/** Recherche de l'application après magistra://open. */
export const OPEN_APP_SEARCH_MS = 60_000;
/** Intervalle entre deux recherches après magistra://open. */
export const OPEN_APP_POLL_MS = 1_500;

const INITIAL_STATE: LocalEngineState = { kind: 'idle', paired: false, permission: 'unsupported' };

function notice(error: MagistraError | ErrorCode): { code: ErrorCode; message: string } {
  return typeof error === 'string' ? { code: error, message: defaultMessage(error) } : { code: error.code, message: error.message };
}

/** Construit un état avec un ordre de clés stable (comparaison par JSON). */
function makeState(
  kind: LocalEngineStateKind, paired: boolean, permission: LoopbackPermission,
  extra: { status?: ConnectorStatus; appVersion?: string; error?: { code: ErrorCode; message: string } } = {},
): LocalEngineState {
  const state: LocalEngineState = { kind, paired, permission };
  if (extra.status) state.status = extra.status;
  if (extra.appVersion) state.appVersion = extra.appVersion;
  if (extra.error) state.error = extra.error;
  return state;
}

function sameState(a: LocalEngineState, b: LocalEngineState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createLocalEngineController(options: LocalConnectorClientOptions = {}): LocalEngineController {
  const readPermissionRaw = options.permission ?? (() => queryLoopbackPermission());
  const openUrl = options.openUrl ?? openMagistraUrl;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const client = new LocalConnectorClient({ ...options, permission: readPermissionRaw, openUrl, now, sleep });

  let state: LocalEngineState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  /** Numéro de l'opération la plus récente : seul son résultat est publié. */
  let seq = 0;
  /** Action de l'enseignant en cours (recherche, ouverture, retrait) et son signal d'interruption. */
  let userOp: { seq: number; abort: AbortController } | null = null;
  /** Appairage en cours. */
  let pairing: { abort: AbortController; promise: Promise<void> } | null = null;
  /** Vérification automatique en cours (partagée entre les appelants). */
  let automatic: Promise<void> | null = null;

  function publish(next: LocalEngineState): void {
    if (sameState(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function readPermission(): Promise<LoopbackPermission> {
    try {
      const value = await readPermissionRaw();
      return value === 'granted' || value === 'prompt' || value === 'denied' ? value : 'unsupported';
    } catch {
      return 'unsupported';
    }
  }

  /** Démarre une action de l'enseignant : interrompt la précédente (recherche), rend les résultats antérieurs caducs. */
  function beginUserOp(): { seq: number; signal: AbortSignal } {
    userOp?.abort.abort();
    const abort = new AbortController();
    seq += 1;
    userOp = { seq, abort };
    return { seq, signal: abort.signal };
  }

  function endUserOp(opSeq: number): void {
    if (userOp?.seq === opSeq) userOp = null;
  }

  // ─── Évaluation ───────────────────────────────────────────────────────────

  function permissionDeniedState(paired: boolean): LocalEngineState {
    return makeState('permission-denied', paired, 'denied', { error: notice('LOCAL_NETWORK_PERMISSION_DENIED') });
  }

  /** Appairé : état du moteur (GET /v1/status prouvé). */
  async function evaluatePaired(signal?: AbortSignal): Promise<LocalEngineState> {
    try {
      const status = await client.status(signal);
      return makeState('connected', true, await readPermission(), { status, appVersion: status.version });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      const e = toMagistraError(err, 'CONNECTOR_UNREACHABLE');
      const permission = await readPermission();
      const paired = await client.hasPairing();
      if (e.code === 'LOCAL_NETWORK_PERMISSION_DENIED' || permission === 'denied') return permissionDeniedState(paired);
      // Autorisation retirée dans l'application (appairage oublié par le client) : l'application, elle, répond.
      if (e.code === 'CONNECTOR_UNPAIRED') return makeState('found', paired, permission, { appVersion: state.appVersion, error: notice(e) });
      if (!paired) return makeState('not-found', false, permission, { error: notice(e) });
      if (e.code === 'CONNECTOR_UNREACHABLE' && e.message === defaultMessage('CONNECTOR_UNREACHABLE')) {
        return makeState('app-closed', true, permission, { appVersion: state.appVersion });
      }
      return makeState('app-closed', true, permission, { appVersion: state.appVersion, error: notice(e) });
    }
  }

  /** Jamais appairé : présence de l'application (GET /v1/hello). */
  async function evaluateUnpaired(signal?: AbortSignal): Promise<LocalEngineState> {
    try {
      const found = await client.hello(signal);
      const permission = await readPermission();
      if (found) return makeState('found', false, permission, { appVersion: found.hello.version });
      return permission === 'denied' ? permissionDeniedState(false) : makeState('not-found', false, permission);
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      const e = toMagistraError(err, 'CONNECTOR_UNREACHABLE');
      if (e.code === 'LOCAL_NETWORK_PERMISSION_DENIED') return permissionDeniedState(false);
      return makeState('not-found', false, await readPermission(), { error: notice(e) });
    }
  }

  /**
   * État complet. `interactive` : action de l'enseignant (la demande d'autorisation du navigateur peut apparaître) ;
   * sinon, rien n'est sondé qui pourrait la faire apparaître.
   */
  async function evaluate(interactive: boolean, signal?: AbortSignal): Promise<LocalEngineState> {
    const paired = await client.hasPairing();
    const permission = await readPermission();
    if (permission === 'denied') return permissionDeniedState(paired);
    if (!interactive) {
      if (paired && permission === 'prompt') return makeState('needs-permission', true, permission, { appVersion: state.appVersion });
      // Jamais appairé : aucune requête vers cet ordinateur sans action de l'enseignant, sauf autorisation déjà
      // accordée (aucune demande possible).
      if (!paired && permission !== 'granted') return makeState('not-found', false, permission);
    }
    return paired ? evaluatePaired(signal) : evaluateUnpaired(signal);
  }

  // ─── Vérifications automatiques ───────────────────────────────────────────

  function automaticCheck(): Promise<void> {
    if (pairing || userOp) return Promise.resolve();
    if (automatic) return automatic;
    seq += 1;
    const opSeq = seq;
    if (state.kind === 'idle') publish({ ...state, kind: 'checking' });
    const run = runAutomatic(opSeq).finally(() => {
      if (automatic === run) automatic = null;
    });
    automatic = run;
    return run;
  }

  /**
   * Autorisation retirée dans l'application : la cause (« Ce navigateur n'est plus autorisé… ») reste affichée aux
   * vérifications automatiques suivantes tant que l'application est trouvée sans appairage. Sinon elle disparaîtrait
   * aussitôt : la vérification suivante (relecture des capacités déclenchée par ce changement d'état, retour sur une
   * page) ne voit plus qu'un navigateur jamais appairé. Une action de l'enseignant (recherche, connexion) repart d'un
   * état neuf.
   */
  function keepUnpairedNotice(next: LocalEngineState): LocalEngineState {
    const previous = state.error;
    if (previous?.code !== 'CONNECTOR_UNPAIRED' || next.kind !== 'found' || next.paired || next.error) return next;
    return makeState(next.kind, next.paired, next.permission, { appVersion: next.appVersion, error: previous });
  }

  async function runAutomatic(opSeq: number): Promise<void> {
    try {
      const next = keepUnpairedNotice(await evaluate(false));
      if (opSeq === seq) publish(next);
    } catch {
      // evaluate ne lève pas hors interruption ; par prudence, l'état reste cohérent.
      if (opSeq === seq && state.kind === 'checking') publish(makeState('not-found', state.paired, state.permission));
    }
  }

  // ─── Actions de l'enseignant ──────────────────────────────────────────────

  async function detect(): Promise<void> {
    if (pairing) return;
    const op = beginUserOp();
    publish(makeState('checking', state.paired, state.permission, { appVersion: state.appVersion }));
    try {
      const next = await evaluate(true, op.signal);
      if (op.seq === seq) publish(next);
    } catch (err) {
      if (op.seq === seq && !op.signal.aborted) {
        publish(makeState(state.paired ? 'app-closed' : 'not-found', state.paired, await readPermission(), { error: notice(toMagistraError(err)) }));
      }
    } finally {
      endUserOp(op.seq);
    }
  }

  function connect(): Promise<void> {
    if (pairing) return pairing.promise;
    const op = beginUserOp();
    const abort = new AbortController();
    const before = state;
    const promise = (async () => {
      try {
        const paired = await client.hasPairing();
        const permission = await readPermission();
        if (permission === 'denied') {
          if (op.seq === seq) publish(permissionDeniedState(paired));
          return;
        }
        if (op.seq === seq) publish(makeState('pairing', paired, permission, { appVersion: before.appVersion }));
        await client.pair(abort.signal);
        // Magistra locale devient le choix explicite (sauf choix déjà enregistré) : perdre l'appairage plus tard ne
        // fera jamais passer les générations au serveur en ligne sans l'accord de l'enseignant.
        adoptLocalChoiceAfterPairing();
        const next = await evaluatePaired();
        if (op.seq === seq) publish(next);
      } catch (err) {
        if (op.seq !== seq) return;
        const paired = await client.hasPairing();
        if (abort.signal.aborted || isAbortError(err)) {
          // Annulé par l'enseignant : retour à l'état précédent (ou état réel si l'appairage a abouti entre-temps).
          const next = paired
            ? await evaluatePaired().catch(() => makeState('app-closed', true, state.permission))
            : makeState(before.kind === 'found' ? 'found' : 'not-found', false, await readPermission(), { appVersion: before.appVersion });
          if (op.seq === seq) publish(next);
          return;
        }
        const e = toMagistraError(err, 'CONNECTOR_UNREACHABLE');
        const permission = await readPermission();
        if (e.code === 'LOCAL_NETWORK_PERMISSION_DENIED' || permission === 'denied') {
          publish(permissionDeniedState(paired));
        } else if (paired) {
          // L'appairage a abouti mais l'application ne répond plus, ou ancien appairage conservé.
          publish(makeState('app-closed', true, permission, { appVersion: before.appVersion, error: notice(e) }));
        } else if (e.code === 'CONNECTOR_PAIRING_REFUSED' || e.code === 'CONNECTOR_PAIRING_EXPIRED') {
          // L'application a répondu : elle est bien là.
          publish(makeState('found', false, permission, { appVersion: before.appVersion, error: notice(e) }));
        } else if (e.code === 'CONNECTOR_UNREACHABLE' && e.message === defaultMessage('CONNECTOR_UNREACHABLE')) {
          publish(makeState('not-found', false, permission, { error: notice(e) }));
        } else {
          publish(makeState(before.kind === 'found' ? 'found' : 'not-found', false, permission, { appVersion: before.appVersion, error: notice(e) }));
        }
      } finally {
        endPairing(abort);
        endUserOp(op.seq);
      }
    })();
    pairing = { abort, promise };
    return promise;
  }

  function endPairing(abort: AbortController): void {
    if (pairing?.abort === abort) pairing = null;
  }

  function cancelPairing(): void {
    pairing?.abort.abort();
  }

  async function openApp(): Promise<void> {
    if (pairing) return;
    const op = beginUserOp();
    try {
      openUrl(OPEN_APP_URL);
    } catch {
      // Ouverture impossible : la recherche dira si l'application est déjà ouverte.
    }
    publish(makeState('checking', state.paired, state.permission, { appVersion: state.appVersion }));
    const deadline = now() + OPEN_APP_SEARCH_MS;
    try {
      for (;;) {
        const next = await evaluate(true, op.signal);
        if (op.seq !== seq) return;
        const searching = (next.kind === 'app-closed' || next.kind === 'not-found') && !next.error;
        if (!searching || now() >= deadline) {
          publish(next);
          return;
        }
        await sleep(OPEN_APP_POLL_MS, op.signal);
        if (op.signal.aborted || op.seq !== seq) return;
      }
    } catch (err) {
      if (op.seq === seq && !op.signal.aborted && !isAbortError(err)) {
        publish(makeState(state.paired ? 'app-closed' : 'not-found', state.paired, await readPermission(), { error: notice(toMagistraError(err)) }));
      }
    } finally {
      endUserOp(op.seq);
    }
  }

  async function disconnect(): Promise<void> {
    const op = beginUserOp();
    // Appairage en cours : interrompu, et terminé AVANT le retrait (il ne doit pas réenregistrer une clé ensuite).
    const pending = pairing;
    if (pending) {
      pending.abort.abort();
      await pending.promise;
    }
    try {
      await client.unpair();
    } catch {
      // unpair oublie l'appairage local dans tous les cas ; une erreur du magasin n'empêche pas la suite.
    }
    try {
      const permission = await readPermission();
      let next = makeState('not-found', false, permission);
      if (permission === 'denied') {
        next = permissionDeniedState(false);
      } else if (permission !== 'prompt') {
        // Action de l'enseignant, autorisation déjà acquise (ou sans objet) : l'application est-elle toujours là ?
        const found = await client.hello(op.signal).catch(() => null);
        if (found) next = makeState('found', false, permission, { appVersion: found.hello.version });
      }
      if (op.seq === seq) publish(makeState(next.kind, await client.hasPairing(), next.permission, { appVersion: next.appVersion, error: next.error }));
    } finally {
      endUserOp(op.seq);
    }
  }

  const controller: LocalEngineController = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    autoCheck: automaticCheck,
    detect,
    connect,
    cancelPairing,
    openApp,
    disconnect,
    refresh: automaticCheck,
    client,
  };
  return controller;
}

// ─── React ──────────────────────────────────────────────────────────────────

/** Fourni par WebRuntimeProvider (site web, utilisateur connecté) ; null ailleurs. */
export const LocalEngineContext = createContext<LocalEngineController | null>(null);

function subscribeNothing(): () => void {
  return () => undefined;
}

function initialSnapshot(): LocalEngineState {
  return INITIAL_STATE;
}

/** null hors du site web (mode personnel, démonstration, application Windows). */
export function useLocalEngine(): { state: LocalEngineState; controller: LocalEngineController } | null {
  const controller = useContext(LocalEngineContext);
  const state = useSyncExternalStore(controller ? controller.subscribe : subscribeNothing, controller ? controller.getSnapshot : initialSnapshot);
  return useMemo(() => (controller ? { state, controller } : null), [controller, state]);
}
