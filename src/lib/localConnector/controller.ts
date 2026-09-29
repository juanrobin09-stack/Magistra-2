// État de Magistra locale (IA de l'ordinateur de l'enseignant, via l'application Windows) pour le SITE WEB : un seul
// contrôleur par page (WebRuntimeProvider), partagé par la carte du tableau de bord, les réglages et la page Générer.
//
// Règles :
//  - la vérification automatique (autoCheck, refresh) ne fait JAMAIS apparaître la demande d'autorisation du
//    navigateur : autorisation encore à demander ('prompt') → état 'needs-permission' si appairé (l'interface explique
//    avant de lancer la recherche), sinon 'not-found' sans rien sonder ; navigateur sans ce mécanisme ('unsupported')
//    et jamais appairé → rien n'est sondé non plus (aucune requête vers cet ordinateur sans action de l'enseignant) ;
//  - seules les actions de l'enseignant (detect, connect, openApp, disconnect) peuvent la faire apparaître ; si elle
//    reste sans réponse (bulle fermée ou ignorée : autorisation toujours à 'prompt', rien n'a répondu), l'état le dit
//    (NOT_ANSWERED_PERMISSION_MESSAGE) au lieu d'affirmer « application fermée » ou « non détectée » ;
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
  /**
   * Pendant l'appairage ('pairing') : code de vérification (« K7F-2QX ») que la boîte de consentement de l'application
   * affiche aussi.
   */
  pairingCode?: string;
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
/**
 * Après magistra://open, application trouvée mais moteur encore arrêté (ENGINE_NOT_RUNNING : l'application le démarre
 * à son lancement) : l'état est relu pendant ce délai au plus, pour ne pas rester « pas prête » à tort.
 */
export const OPEN_APP_ENGINE_START_MS = 20_000;

/**
 * Déconnexion alors que l'application n'a pas confirmé le retrait (fermée, injoignable, ou seule répond celle d'une
 * autre session Windows, qui ne connaît pas ce navigateur) : ce navigateur a oublié la connexion, mais l'application
 * de l'enseignant liste peut-être encore ce navigateur parmi ceux qu'elle autorise.
 */
export const UNPAIR_NOT_CONFIRMED_MESSAGE =
  'Ce navigateur a oublié la connexion à Magistra locale, mais votre application Magistra n’a pas confirmé le retrait (fermée ou injoignable) : retirez aussi l’autorisation dans Magistra → Réglages → « Site web Magistra ».';

/**
 * Recherche lancée par l'enseignant alors que le navigateur devait lui demander son autorisation, et restée sans
 * réponse (bulle fermée ou ignorée) : rien n'a pu être joint, l'application est peut-être ouverte. Un navigateur qui
 * expose l'autorisation sans l'appliquer, application fermée, donne le même constat (aucune réponse, toujours
 * 'prompt') : le texte couvre aussi ce cas.
 */
export const NOT_ANSWERED_PERMISSION_MESSAGE =
  'Magistra n’a pas pu être recherchée : votre navigateur n’a pas reçu votre accord. Relancez la recherche, puis acceptez sa demande. S’il ne vous demande rien, vérifiez que l’application Magistra est ouverte.';

const INITIAL_STATE: LocalEngineState = { kind: 'idle', paired: false, permission: 'unsupported' };

function notice(error: MagistraError | ErrorCode): { code: ErrorCode; message: string } {
  return typeof error === 'string' ? { code: error, message: defaultMessage(error) } : { code: error.code, message: error.message };
}

/** Construit un état avec un ordre de clés stable (comparaison par JSON). */
function makeState(
  kind: LocalEngineStateKind, paired: boolean, permission: LoopbackPermission,
  extra: { status?: ConnectorStatus; appVersion?: string; error?: { code: ErrorCode; message: string }; pairingCode?: string } = {},
): LocalEngineState {
  const state: LocalEngineState = { kind, paired, permission };
  if (extra.status) state.status = extra.status;
  if (extra.appVersion) state.appVersion = extra.appVersion;
  if (extra.error) state.error = extra.error;
  if (extra.pairingCode) state.pairingCode = extra.pairingCode;
  return state;
}

/** Notice « autorisation du navigateur restée sans réponse ». */
function notAnsweredNotice(): { code: ErrorCode; message: string } {
  return { code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: NOT_ANSWERED_PERMISSION_MESSAGE };
}

function isNotAnsweredNotice(error: LocalEngineState['error']): boolean {
  return error?.code === 'LOCAL_NETWORK_PERMISSION_DENIED' && error.message === NOT_ANSWERED_PERMISSION_MESSAGE;
}

function sameState(a: LocalEngineState, b: LocalEngineState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createLocalEngineController(options: LocalConnectorClientOptions = {}): LocalEngineController {
  const openUrl = options.openUrl ?? openMagistraUrl;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const client = new LocalConnectorClient({ ...options, permission: options.permission ?? (() => queryLoopbackPermission()), openUrl, now, sleep });

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

  /** Autorisation du navigateur, lue par le client ('prompt' d'un navigateur qui ne l'applique pas : 'unsupported'). */
  function readPermission(): Promise<LoopbackPermission> {
    return client.readPermission();
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
    // Appairage constaté (appelée seulement pour un navigateur appairé) : Magistra locale devient le choix explicite,
    // sauf choix déjà enregistré — même si l'enregistrement a échoué lors de l'appairage (stockage plein ou refusé :
    // le choix vaut alors au moins pour cette visite) ou si le choix a disparu depuis. Une autorisation retirée ensuite
    // (401 : appairage oublié) ne fait jamais passer la génération suivante au serveur en ligne d'elle-même.
    adoptLocalChoiceAfterPairing();
    try {
      const status = await client.status(signal);
      return makeState('connected', true, await readPermission(), { status, appVersion: status.version });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      const e = toMagistraError(err, 'CONNECTOR_UNREACHABLE');
      const permission = await readPermission();
      const paired = await client.hasPairing();
      if (e.code === 'LOCAL_NETWORK_PERMISSION_DENIED' || permission === 'denied') return permissionDeniedState(paired);
      if (e.code === 'CONNECTOR_UNPAIRED') {
        // Retrait prouvé par l'application (appairage oublié par le client) : l'application, elle, répond.
        if (!paired) return makeState('found', false, permission, { appVersion: state.appVersion, error: notice(e) });
        // Une application Magistra répond sans reconnaître ce navigateur ni prouver l'avoir retiré (autre session
        // Windows, la sienne fermée ; ou la sienne qui a perdu ses autorisations) : appairage gardé, cause expliquée.
        return makeState('app-closed', true, permission, { appVersion: state.appVersion, error: notice(e) });
      }
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
    const next = paired ? await evaluatePaired(signal) : await evaluateUnpaired(signal);
    // Demande du navigateur restée sans réponse : rien n'a répondu et l'autorisation vaut toujours 'prompt'. La cause
    // probable est dite (jamais « application fermée » ni « téléchargez-la » à tort) ; appairé, la génération reste
    // bloquée derrière l'explication.
    const unanswered = permission === 'prompt' && next.permission === 'prompt' && !next.error
      && (next.kind === 'not-found' || next.kind === 'app-closed');
    if (!unanswered) return next;
    return makeState(next.paired ? 'needs-permission' : 'not-found', next.paired, 'prompt', { appVersion: next.appVersion, error: notAnsweredNotice() });
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
   * Causes gardées par les vérifications automatiques suivantes (une action de l'enseignant — recherche, connexion —
   * repart d'un état neuf) ; sinon elles disparaîtraient aussitôt, la vérification suivante (relecture des capacités
   * déclenchée par ce changement d'état, retour sur une page) ne sondant rien ou ne voyant plus la cause :
   *  - autorisation retirée dans l'application (« Ce navigateur n'est plus autorisé… »), tant que l'application est
   *    trouvée sans appairage : la vérification suivante ne voit plus qu'un navigateur jamais appairé ;
   *  - demande du navigateur restée sans réponse, tant que l'autorisation est toujours à demander (même état).
   */
  function keepNotice(next: LocalEngineState): LocalEngineState {
    const previous = state.error;
    if (!previous || next.error || next.kind !== state.kind || next.paired !== state.paired) return next;
    const keep = previous.code === 'CONNECTOR_UNPAIRED'
      ? next.kind === 'found' && !next.paired
      : isNotAnsweredNotice(previous) && next.permission === 'prompt';
    return keep ? makeState(next.kind, next.paired, next.permission, { appVersion: next.appVersion, error: previous }) : next;
  }

  async function runAutomatic(opSeq: number): Promise<void> {
    try {
      const next = keepNotice(await evaluate(false));
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
        // « En attente de l'accord » publié avec le code de vérification, juste avant l'ouverture de magistra://pair.
        await client.pair(abort.signal, code => {
          if (op.seq === seq && !abort.signal.aborted) publish(makeState('pairing', paired, permission, { appVersion: before.appVersion, pairingCode: code }));
        });
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
        const plainUnreachable = e.code === 'CONNECTOR_UNREACHABLE' && e.message === defaultMessage('CONNECTOR_UNREACHABLE');
        if (e.code === 'LOCAL_NETWORK_PERMISSION_DENIED' || permission === 'denied') {
          publish(permissionDeniedState(paired));
        } else if (plainUnreachable && permission === 'prompt') {
          // Rien n'a répondu et la demande du navigateur est restée sans réponse : c'est elle qu'il faut accepter.
          publish(makeState(paired ? 'needs-permission' : 'not-found', paired, permission, { appVersion: before.appVersion, error: notAnsweredNotice() }));
        } else if (paired) {
          // L'appairage a abouti mais l'application ne répond plus, ou ancien appairage conservé.
          publish(makeState('app-closed', true, permission, { appVersion: before.appVersion, error: notice(e) }));
        } else if (e.code === 'CONNECTOR_PAIRING_REFUSED' || e.code === 'CONNECTOR_PAIRING_EXPIRED') {
          // L'application a répondu : elle est bien là.
          publish(makeState('found', false, permission, { appVersion: before.appVersion, error: notice(e) }));
        } else if (plainUnreachable) {
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
    let engineDeadline: number | null = null;
    try {
      for (;;) {
        const next = await evaluate(true, op.signal);
        if (op.seq !== seq) return;
        const searching = (next.kind === 'app-closed' || next.kind === 'not-found') && !next.error;
        // Application ouverte à l'instant : son moteur démarre peut-être encore. L'état « connectée » est montré tout
        // de suite, puis relu jusqu'à ce que le moteur soit prêt (ou qu'il reste arrêté au-delà du délai).
        const engineStarting = next.kind === 'connected' && next.status?.engine.notReady?.code === 'ENGINE_NOT_RUNNING';
        if (engineStarting) engineDeadline ??= now() + OPEN_APP_ENGINE_START_MS;
        const waiting = searching || (engineStarting && now() < engineDeadline!);
        if (!waiting || now() >= deadline) {
          publish(next);
          return;
        }
        if (engineStarting) publish(next);
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
    let revoked = false;
    try {
      revoked = await client.unpair();
    } catch {
      // unpair oublie l'appairage local dans tous les cas ; une erreur du magasin n'empêche pas la suite.
    }
    // Retrait non confirmé par l'application : l'enseignant est prévenu (jamais « retirée » à tort).
    const unconfirmed = revoked ? undefined : { code: 'CONNECTOR_UNREACHABLE' as const, message: UNPAIR_NOT_CONFIRMED_MESSAGE };
    try {
      const permission = await readPermission();
      let next = makeState('not-found', false, permission, { error: unconfirmed });
      if (permission === 'denied') {
        next = permissionDeniedState(false);
      } else if (permission !== 'prompt') {
        // Action de l'enseignant, autorisation déjà acquise (ou sans objet) : l'application est-elle toujours là ?
        const found = await client.hello(op.signal).catch(() => null);
        if (found) next = makeState('found', false, permission, { appVersion: found.hello.version, error: unconfirmed });
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
