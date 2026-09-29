// État de l'IA locale (application Windows) partagé par toutes les vues :
// carte « Activer l'IA » (tableau de bord, Générer, page de l'IA), réglages et indicateur de la barre latérale.
//
// Un seul abonnement à ai.onProgress est ouvert tant qu'au moins un composant utilise ce hook ;
// il est fermé quand le dernier composant est démonté. Hors application Windows, le hook renvoie null.
//
// « Activer l'IA » (activate) : UN clic, taille totale annoncée avant, puis enchaînement automatique des actions
// existantes — installation (ou mise à jour) du moteur, démarrage, téléchargement du modèle recommandé (installTier).
// L'enchaînement vit dans ce magasin partagé (et non dans un composant) : l'enseignant navigue librement pendant
// l'installation. Il est mémorisé côté processus principal (préférence aiSetupRequested) et reprend tout seul au
// lancement suivant de Magistra (resumeActivation) — jamais sans ce clic initial. Fenêtre rechargée pendant
// l'activation : l'opération en cours dans le processus principal (qui refuse un doublon, AI_BUSY ; installation du
// moteur annoncée par AIStatus.engine.installing) est attendue, puis l'enchaînement continue ; rien n'est téléchargé
// deux fois, et l'ancien moteur n'est jamais démarré pendant que l'installateur le remplace.
// Annulation : prise en compte à tout moment — pendant l'enregistrement de la demande, pendant la préparation du
// téléchargement du modèle (avant son départ), ou juste après un rechargement (avant tout évènement de progression).

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { TierId } from '@shared/ai/models';
import { MagistraError } from '@shared/errors';
import type { AIConfigUpdate, AIProgressEvent, AIStatus, EngineInstallOptions, Unsubscribe } from '@shared/ipc';
import type { Capabilities } from '@shared/types';
import { activationPlan, type ActivationOptions, type ActivationPlan, type ActivationStepId } from '@/lib/ai-ui/activation';
import { EMPTY_PROGRESS, isEngineBusy, isModelPulling, reduceProgress, type AIProgressState, type ProgressAction } from '@/lib/ai-ui/progress';
import { aiPhase, engineManagedByAdminText } from '@/lib/ai-ui/status';
import { useOptionalRuntime } from '@/lib/runtime/context';
import { fromIpcError, getBridge } from '@/lib/runtime/local';

export type AIErrorScope = 'status' | 'engine' | 'model' | 'config';

export interface AIPending {
  status: boolean;
  engine: boolean;
  start: boolean;
  model: boolean;
  config: boolean;
}

/**
 * Activation en un clic (« Activer l'IA ») :
 *  - idle : rien en cours ; running : enchaînement en cours ; done : IA prête à l'issue de l'activation ;
 *  - error : arrêt sur une erreur précise (`error`, message de l'étape) ; cancelled : annulée par l'enseignant.
 */
export interface AIActivation {
  state: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  /** Étape en cours (ou celle de l'arrêt). */
  step: ActivationStepId | null;
  /** Plan figé au lancement (tailles annoncées, niveau de modèle) : base de la progression globale. */
  plan: ActivationPlan | null;
  /** Reprise automatique au lancement de Magistra (activation demandée lors d'une session précédente). */
  resumed: boolean;
  error?: MagistraError;
}

export interface AISnapshot {
  status: AIStatus | null;
  progress: AIProgressState;
  errors: Partial<Record<AIErrorScope, MagistraError>>;
  pending: AIPending;
  /** L'enseignant installe le moteur lui-même depuis la page officielle : Magistra attend la fin. */
  manualInstall: boolean;
  /** L'installation en cours est une MISE À JOUR du moteur (moteur trop ancien). */
  engineUpdate?: boolean;
  activation: AIActivation;
  loadedAt: number;
}

export interface AIActions {
  /** Relit l'état (moteur, modèles, ordinateur). */
  refresh(): Promise<AIStatus | null>;
  /** Installe le moteur IA, ou le met à jour avec `{ update: true }` (toujours après un clic). */
  installEngine(options?: EngineInstallOptions): Promise<void>;
  cancelEngineInstall(): Promise<void>;
  openEngineDownload(): Promise<void>;
  startEngine(): Promise<boolean>;
  /** Télécharge un niveau puis l'utilise. */
  installTier(tier: TierId): Promise<void>;
  /** Utilise un niveau déjà installé. */
  selectTier(tier: TierId): Promise<AIConfigResult>;
  cancelPull(): Promise<void>;
  setConfig(update: AIConfigUpdate): Promise<AIConfigResult>;
  clearError(scope: AIErrorScope): void;
  /**
   * « Activer l'IA » (clic de l'enseignant, taille annoncée) : mémorise la demande (reprise au prochain lancement),
   * puis enchaîne moteur → démarrage → modèle recommandé, jusqu'à ce que l'IA soit prête. `engineUpdate` : le
   * registre a refusé le modèle (moteur trop ancien) — mise à jour du moteur d'abord, annoncée avec sa taille.
   * `manualEngine` : installation automatique du moteur en échec — page officielle ouverte, Magistra attend le moteur
   * puis poursuit avec le modèle (même activation, même progression).
   */
  activate(options?: ActivationOptions): Promise<void>;
  /**
   * Au chargement de la fenêtre (une fois) : reprend l'activation demandée lors d'une session précédente, ou
   * interrompue par un rechargement (l'opération encore en cours dans le processus principal est attendue).
   */
  resumeActivation(): Promise<void>;
  /** Annule l'activation (téléchargement du moteur ou du modèle) ; elle ne reprendra pas toute seule. */
  cancelActivation(): Promise<void>;
  /**
   * Après un arrêt sur erreur, la demande reste mémorisée (reprise au prochain lancement) : « Ne pas reprendre » la
   * retire, sans rien arrêter d'autre. L'activation est alors « interrompue » : rien ne repartira sans un nouveau clic.
   */
  forgetActivation(): Promise<void>;
  /** Referme le message de fin (« IA prête », annulation). */
  dismissActivation(): void;
}

export type AIController = AISnapshot & AIActions;

/** Résultat d'un changement de configuration : nouvel état, ou erreur compréhensible. */
export interface AIConfigResult {
  status: AIStatus | null;
  error: MagistraError | null;
}

// ─── Magasin partagé ────────────────────────────────────────────────────────

const IDLE_ACTIVATION: AIActivation = { state: 'idle', step: null, plan: null, resumed: false };

const INITIAL: AISnapshot = {
  status: null,
  progress: EMPTY_PROGRESS,
  errors: {},
  pending: { status: false, engine: false, start: false, model: false, config: false },
  manualInstall: false,
  activation: IDLE_ACTIVATION,
  loadedAt: 0,
};

let snapshot: AISnapshot = INITIAL;
const listeners = new Set<() => void>();
/** Attentes internes d'un changement d'état (enchaînement de l'activation), distinctes des abonnements des vues. */
const changeWaiters = new Set<() => void>();
let detachBridge: Unsubscribe | null = null;
let inflight: Promise<AIStatus | null> | null = null;
let engineCancelRequested = false;
let pullCancelRequested = false;
/** Annulation de l'activation demandée : vue par l'enchaînement après chaque étape. */
let activationCancelled = false;
/**
 * Numéro de la dernière demande (clic sur « Activer l'IA ») ou annulation : une activation dont la demande a été
 * annulée PENDANT son enregistrement (numéro changé entre-temps) ne démarre pas.
 */
let activationRequest = 0;
/** Reprise déjà examinée par cette page (un seul examen par chargement de la fenêtre). */
let resumeChecked = false;
/** Attente du moteur après une installation automatique, et intervalle des vérifications pendant l'attente. */
export const ENGINE_WAIT_MS = 60_000;
export const ENGINE_POLL_MS = 3_000;

function update(patch: Partial<AISnapshot> | ((s: AISnapshot) => Partial<AISnapshot>)): void {
  const next = typeof patch === 'function' ? patch(snapshot) : patch;
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
  for (const w of [...changeWaiters]) w();
}

function setPending(key: keyof AIPending, value: boolean): void {
  update(s => ({ pending: { ...s.pending, [key]: value } }));
}

function setError(scope: AIErrorScope, err: MagistraError | undefined): void {
  update(s => ({ errors: { ...s.errors, [scope]: err } }));
}

function dispatch(action: ProgressAction): void {
  update(s => ({ progress: reduceProgress(s.progress, action) }));
}

/** Installation du moteur en cours dans le processus principal, sans progression connue de cette page. */
const ENGINE_INSTALLING_MESSAGE = 'Installation du moteur IA en cours…';
const ENGINE_UPDATING_MESSAGE = 'Mise à jour du moteur IA en cours…';

function applyStatus(status: AIStatus): void {
  update(s => {
    let progress = s.progress;
    // Une fois le moteur détecté, l'attente d'installation est terminée.
    if (status.engine.state === 'running' && progress.engine && ['ready', 'waiting', 'cancelled'].includes(progress.engine.stage)) {
      progress = reduceProgress(progress, { kind: 'engine-clear' });
    }
    const installing = status.engine.installing;
    if (installing && (!progress.engine || progress.engine.stage === 'error')) {
      // Fenêtre rechargée pendant l'installateur du moteur (qui n'émet rien) : affichée comme telle, jamais comme un
      // moteur « arrêté » à démarrer ; ses évènements (moteur prêt, erreur) prendront le relais.
      progress = reduceProgress(progress, { kind: 'engine-install', message: installing === 'update' ? ENGINE_UPDATING_MESSAGE : ENGINE_INSTALLING_MESSAGE });
    } else if (!installing && !s.pending.engine && progress.engine?.stage === 'install') {
      // Installation terminée sans que cette page en ait reçu la fin : plus d'installation affichée sans fin.
      progress = reduceProgress(progress, { kind: 'engine-clear' });
    }
    if (progress.model?.stage === 'ready') progress = reduceProgress(progress, { kind: 'model-clear' });
    return {
      status,
      progress,
      loadedAt: Date.now(),
      errors: { ...s.errors, status: undefined },
      manualInstall: status.engine.state === 'not_installed' ? s.manualInstall : false,
    };
  });
}

function loadStatus(): Promise<AIStatus | null> {
  const bridge = getBridge();
  if (!bridge) return Promise.resolve(null);
  if (inflight) return inflight;
  setPending('status', true);
  // Premier chargement : état connu ; ensuite : nouvelle détection complète.
  const request = snapshot.status ? bridge.ai.refresh() : bridge.ai.status();
  inflight = request
    .then(
      status => {
        applyStatus(status);
        return status;
      },
      err => {
        update(s => ({ loadedAt: Date.now(), errors: { ...s.errors, status: fromIpcError(err) } }));
        return null;
      },
    )
    .finally(() => {
      inflight = null;
      setPending('status', false);
    });
  return inflight;
}

/** Après une action : attend la vérification en cours puis en relance une nouvelle. */
async function refreshAfterAction(): Promise<AIStatus | null> {
  if (inflight) await inflight;
  return loadStatus();
}

function onBridgeEvent(event: AIProgressEvent): void {
  dispatch(event);
  if (event.kind === 'engine-ready') {
    update({ manualInstall: false });
    setError('engine', undefined);
    void refreshAfterAction();
  } else if (event.kind === 'model-ready') {
    setError('model', undefined);
    void refreshAfterAction();
  }
}

function attachBridge(): void {
  if (detachBridge) return;
  const bridge = getBridge();
  if (!bridge) return;
  const off = bridge.ai.onProgress(onBridgeEvent);
  // Retour dans la fenêtre (par exemple après une installation manuelle) : nouvelle vérification.
  const onFocus = () => {
    if (Date.now() - snapshot.loadedAt > 3000) void loadStatus();
  };
  window.addEventListener('focus', onFocus);
  detachBridge = () => {
    off();
    window.removeEventListener('focus', onFocus);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  attachBridge();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachBridge) {
      detachBridge();
      detachBridge = null;
    }
  };
}

function subscribeNothing(): () => void {
  return () => undefined;
}

function getSnapshot(): AISnapshot {
  return snapshot;
}

function getInitialSnapshot(): AISnapshot {
  return INITIAL;
}

function isAbort(err: MagistraError): boolean {
  return err.code === 'GENERATION_ABORTED';
}

// ─── Activation en un clic ──────────────────────────────────────────────────

function setActivation(patch: Partial<AIActivation>): void {
  update(s => ({ activation: { ...s.activation, ...patch } }));
}

/** Mémorise (ou retire) la demande d'activation côté processus principal ; un échec n'arrête pas l'activation. */
async function rememberActivation(requested: boolean): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  try {
    await bridge.prefs.set({ aiSetupRequested: requested });
  } catch {
    // Préférence non enregistrée : l'activation continue ; seule sa reprise au prochain lancement serait perdue.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

/** Attend le prochain changement de l'état partagé (évènement de progression, état relu…), ou `ms` au plus. */
function waitForChange(ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      window.clearTimeout(timer);
      changeWaiters.delete(done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    changeWaiters.add(done);
  });
}

/**
 * Moteur utilisable (installé et assez récent ; éventuellement arrêté) ? Jamais pendant son installation : l'ancien
 * exécutable, encore présent, n'est pas « un moteur arrêté » que l'on pourrait démarrer.
 */
function engineUsable(status: AIStatus): boolean {
  const phase = aiPhase(status);
  return !status.engine.installing && phase !== 'engine_missing' && phase !== 'engine_outdated';
}

/**
 * Attend le moteur en revérifiant régulièrement : après l'installateur automatique (au plus ENGINE_WAIT_MS), ou sans
 * limite pendant une installation depuis la page officielle (hors Windows). null si l'enseignant annule.
 */
async function waitForEngine(limitMs: number | null): Promise<AIStatus | null> {
  const started = Date.now();
  for (;;) {
    if (activationCancelled) return null;
    const status = await refreshAfterAction();
    if (status && engineUsable(status)) return status;
    if (limitMs !== null && Date.now() - started >= limitMs) {
      throw new MagistraError(
        'ENGINE_NOT_RUNNING',
        "Le moteur IA est installé mais ne répond pas encore. Réessayez dans quelques instants ; si le problème continue, redémarrez l'ordinateur.",
      );
    }
    await wait(ENGINE_POLL_MS);
  }
}

/**
 * Fenêtre rechargée pendant l'activation : l'installation du moteur ou le téléchargement du modèle continue dans le
 * processus principal, qui a refusé le doublon (AI_BUSY). On l'attend — ses évènements de progression arrivent
 * toujours à l'écran — jusqu'à sa fin (prêt, erreur, annulation), en revérifiant l'état de l'IA régulièrement (aucun
 * évènement pendant l'exécution de l'installateur du moteur). null si l'enseignant annule.
 */
async function waitForOperationElsewhere(scope: 'engine' | 'model'): Promise<'ready' | 'error' | 'cancelled' | null> {
  actions.clearError(scope);
  let checkedAt = 0;
  for (;;) {
    if (activationCancelled) return null;
    const stage = snapshot.progress[scope]?.stage;
    if (stage === 'ready' || stage === 'error' || stage === 'cancelled') return stage;
    // État de l'IA relu au plus toutes les ENGINE_POLL_MS (pas à chaque évènement de progression).
    if (Date.now() - checkedAt >= ENGINE_POLL_MS) {
      checkedAt = Date.now();
      const status = await refreshAfterAction();
      if (activationCancelled) return null;
      if (status && (scope === 'engine' ? engineUsable(status) : status.ready)) return 'ready';
    }
    // Réveil au premier évènement (fin du téléchargement…), sinon nouvelle vérification après ENGINE_POLL_MS.
    await waitForChange(ENGINE_POLL_MS);
  }
}

/**
 * Installation du moteur menée ailleurs (fenêtre rechargée pendant l'installation, mise à jour lancée depuis les
 * réglages) : attendue jusqu'à sa fin, puis le moteur prêt. undefined si l'activation s'arrête (annulation, erreur
 * précise déjà affichée).
 */
async function followEngineInstallElsewhere(): Promise<AIStatus | null | undefined> {
  const end = await waitForOperationElsewhere('engine');
  if (!(await endOfOperationElsewhere('engine', end))) return undefined;
  return waitForEngine(ENGINE_WAIT_MS);
}

/** Fin d'une opération attendue ailleurs : erreur précise (message du processus principal) ou annulation. */
async function endOfOperationElsewhere(scope: 'engine' | 'model', end: 'ready' | 'error' | 'cancelled' | null): Promise<boolean> {
  if (end === null) return false;
  if (end === 'cancelled') {
    await markActivationCancelled();
    return false;
  }
  if (end === 'error') {
    const progress = snapshot.progress[scope];
    const message = progress?.stage === 'error' ? progress.message : undefined;
    stopActivation(new MagistraError(scope === 'engine' ? 'ENGINE_NOT_INSTALLED' : 'MODEL_NOT_INSTALLED', message));
    return false;
  }
  return true;
}

function stopActivation(error: MagistraError): void {
  // La demande reste mémorisée : l'activation reprendra au prochain lancement (souvent une coupure réseau).
  setActivation({ state: 'error', error });
}

async function markActivationCancelled(): Promise<void> {
  setActivation({ state: 'cancelled', error: undefined });
  await rememberActivation(false);
}

/**
 * Enchaînement : moteur (installation, mise à jour ou attente de l'installation manuelle) → démarrage → modèle.
 * Chaque étape réutilise l'action existante (mêmes messages d'erreur précis, mêmes évènements de progression) ;
 * l'état est relu après chacune. Au plus quatre tours (une fois chaque étape) : jamais de boucle sans fin.
 * Options du premier tour : `engineUpdate` (modèle refusé par le registre, moteur trop ancien : mise à jour d'abord),
 * `manualEngine` (installation depuis la page officielle, après l'échec de l'installation automatique).
 */
async function runActivation(resumed: boolean, options: ActivationOptions = {}): Promise<void> {
  activationCancelled = false;
  let worked = false;
  update(s => ({ activation: { ...s.activation, state: 'running', step: null, resumed, error: undefined } }));
  try {
    let status = await refreshAfterAction();
    for (let round = 0; round < 4; round += 1) {
      if (activationCancelled) return;
      if (!status) {
        stopActivation(snapshot.errors.status ?? new MagistraError('INTERNAL'));
        return;
      }
      if (status.ready) {
        // Reprise d'une activation déjà aboutie (téléchargement terminé avant la fermeture) : aucun message.
        setActivation({ state: worked || !resumed ? 'done' : 'idle', step: null });
        await rememberActivation(false);
        return;
      }
      const plan = activationPlan(status, round === 0 ? options : {});
      if (!plan) {
        // Serveur IA distant, modèle personnalisé ou moteur sur un autre ordinateur (options avancées) : rien à
        // activer sur cet ordinateur — et rien à reprendre à chaque lancement.
        setActivation({ state: 'idle', step: null });
        await rememberActivation(false);
        return;
      }
      // Le plan du premier tour (tailles annoncées) sert de base à la progression globale.
      if (round === 0) setActivation({ plan });
      worked = true;

      if (plan.engine === 'admin') {
        setActivation({ step: 'engine' });
        stopActivation(new MagistraError('ENGINE_OUTDATED', engineManagedByAdminText(status)));
        return;
      }
      if (status.engine.installing) {
        // Installation (ou mise à jour) du moteur déjà en cours dans le processus principal (fenêtre rechargée
        // pendant l'installateur) : attendue, jamais relancée ni concurrencée par un démarrage de l'ancien moteur.
        setActivation({ step: 'engine' });
        const next = await followEngineInstallElsewhere();
        if (next === undefined) return;
        status = next;
        continue;
      }
      if (plan.engine === 'install' || plan.engine === 'update' || plan.engine === 'manual') {
        setActivation({ step: 'engine' });
        if (plan.engine === 'manual') {
          if (resumed) {
            // Reprise au lancement : la page officielle n'est pas rouverte d'office (bouton sur la carte) ; Magistra
            // attend l'installation, comme avant la fermeture.
            update({ manualInstall: true });
            dispatch({ kind: 'engine-waiting', message: "En attente de l'installation du moteur IA…" });
          } else {
            await actions.openEngineDownload();
            if (snapshot.errors.engine) {
              stopActivation(snapshot.errors.engine);
              return;
            }
          }
          status = await waitForEngine(null);
        } else {
          await actions.installEngine(plan.engine === 'update' ? { update: true } : undefined);
          if (activationCancelled) return;
          if (snapshot.errors.engine?.code === 'AI_BUSY') {
            // Installation déjà en cours (fenêtre rechargée) : attendue, jamais relancée.
            const next = await followEngineInstallElsewhere();
            if (next === undefined) return;
            status = next;
            continue;
          }
          if (snapshot.errors.engine) {
            stopActivation(snapshot.errors.engine);
            return;
          }
          // Installation annulée ailleurs (réglages) : l'activation s'arrête aussi.
          if (snapshot.progress.engine?.stage === 'cancelled') {
            await markActivationCancelled();
            return;
          }
          status = snapshot.status && engineUsable(snapshot.status) ? snapshot.status : await waitForEngine(ENGINE_WAIT_MS);
        }
        continue;
      }
      if (plan.engine === 'start') {
        setActivation({ step: 'engine' });
        const ok = await actions.startEngine();
        if (activationCancelled) return;
        if (!ok && snapshot.errors.engine?.code === 'AI_BUSY') {
          // Installation du moteur commencée entre-temps (réglages, autre fenêtre) : attendue, jamais concurrencée.
          const next = await followEngineInstallElsewhere();
          if (next === undefined) return;
          status = next;
          continue;
        }
        if (!ok) {
          stopActivation(snapshot.errors.engine ?? new MagistraError('ENGINE_NOT_RUNNING'));
          return;
        }
        status = snapshot.status;
        continue;
      }

      setActivation({ step: 'model' });
      await actions.installTier(plan.tier);
      if (activationCancelled) return;
      if (snapshot.errors.model?.code === 'AI_BUSY') {
        // Téléchargement déjà en cours (fenêtre rechargée) : attendu, jamais relancé.
        const end = await waitForOperationElsewhere('model');
        if (!(await endOfOperationElsewhere('model', end))) return;
        status = await refreshAfterAction();
        continue;
      }
      if (snapshot.progress.model?.stage === 'cancelled') {
        await markActivationCancelled();
        return;
      }
      if (snapshot.errors.model) {
        stopActivation(snapshot.errors.model);
        return;
      }
      status = snapshot.status;
    }
    stopActivation(new MagistraError(
      'MODEL_NOT_INSTALLED',
      "L'intelligence artificielle n'est pas encore prête. Réessayez ; si le problème continue, ouvrez les options avancées de l'IA.",
    ));
  } catch (err) {
    stopActivation(err instanceof MagistraError ? err : fromIpcError(err));
  }
}

let activationTask: Promise<void> | null = null;

/** Une seule activation à la fois ; après une annulation, la suivante attend la fin de la précédente. */
function startActivation(resumed: boolean, options: ActivationOptions = {}): Promise<void> {
  if (activationTask && !activationCancelled) return activationTask;
  const previous = activationTask;
  const task = (async () => {
    if (previous) await previous.catch(() => undefined);
    await runActivation(resumed, options);
  })();
  activationTask = task;
  void task.finally(() => {
    if (activationTask === task) activationTask = null;
  });
  return task;
}

// ─── Actions ────────────────────────────────────────────────────────────────

const actions: AIActions = {
  refresh: () => refreshAfterAction(),

  async installEngine(options) {
    const bridge = getBridge();
    if (!bridge) return;
    const isUpdate = options?.update === true;
    engineCancelRequested = false;
    update(s => ({ manualInstall: false, engineUpdate: isUpdate, errors: { ...s.errors, engine: undefined } }));
    setPending('engine', true);
    dispatch({ kind: 'engine-start' });
    try {
      // Sans option : appel inchangé (aucun argument transmis au pont).
      await (isUpdate ? bridge.ai.installEngine({ update: true }) : bridge.ai.installEngine());
    } catch (err) {
      const e = fromIpcError(err);
      if (!engineCancelRequested && !isAbort(e)) {
        setError('engine', e);
        dispatch({ kind: 'engine-error', message: e.message });
      } else {
        dispatch({ kind: 'engine-cancelled' });
      }
    } finally {
      setPending('engine', false);
    }
    const status = await refreshAfterAction();
    const stage = snapshot.progress.engine?.stage;
    // Installateur terminé mais moteur pas encore détecté : on attend (vérification automatique).
    if (status && status.engine.state === 'not_installed' && (stage === 'starting' || stage === 'download' || stage === 'install')) {
      dispatch({ kind: 'engine-waiting', message: 'Finalisation de l’installation du moteur IA…' });
    }
  },

  async cancelEngineInstall() {
    const bridge = getBridge();
    if (!bridge) return;
    engineCancelRequested = true;
    try {
      await bridge.ai.cancelEngineInstall();
    } catch {
      // L'annulation est de toute façon reflétée dans l'interface.
    }
    update({ manualInstall: false });
    dispatch({ kind: 'engine-cancelled' });
  },

  async openEngineDownload() {
    const bridge = getBridge();
    if (!bridge) return;
    setError('engine', undefined);
    try {
      await bridge.ai.openEngineDownload();
      update({ manualInstall: true });
      dispatch({ kind: 'engine-waiting', message: "En attente de l'installation du moteur IA…" });
    } catch (err) {
      setError('engine', fromIpcError(err));
    }
  },

  async startEngine() {
    const bridge = getBridge();
    if (!bridge) return false;
    setError('engine', undefined);
    setPending('start', true);
    let ok = false;
    try {
      ok = await bridge.ai.startEngine();
      if (!ok) {
        setError('engine', new MagistraError(
          'ENGINE_NOT_RUNNING',
          "Le moteur IA n'a pas pu démarrer. Réessayez dans quelques secondes ; si le problème continue, redémarrez l'ordinateur.",
        ));
      }
    } catch (err) {
      setError('engine', fromIpcError(err));
    } finally {
      setPending('start', false);
    }
    await refreshAfterAction();
    return ok;
  },

  async installTier(tier) {
    const bridge = getBridge();
    if (!bridge) return;
    const before = snapshot.status;
    const info = before?.tiers.find(t => t.id === tier);
    const model = info?.model ?? '';
    const configUpdate: AIConfigUpdate = { tier, ...(before?.config.customModel ? { customModel: null } : {}) };
    // Si l'IA actuelle fonctionne, on la garde pendant le téléchargement et on change à la fin.
    const switchFirst = !(before?.ready && before.config.mode === 'local');
    pullCancelRequested = false;
    update(s => ({ errors: { ...s.errors, model: undefined } }));
    setPending('model', true);
    dispatch({ kind: 'model-start', model, tier });
    try {
      if (switchFirst) {
        const s = await bridge.ai.setConfig(configUpdate);
        applyStatus(s);
      }
      // Annulé pendant le changement de configuration (le processus principal relit tout l'état : jusqu'à quelques
      // secondes) : le téléchargement n'était pas encore parti — il ne part pas. Plusieurs Go sans accord, jamais.
      if (pullCancelRequested) throw new MagistraError('GENERATION_ABORTED', 'Téléchargement annulé.');
      await bridge.ai.pullModel({ tier });
      if (pullCancelRequested) {
        dispatch({ kind: 'model-cancelled' });
      } else {
        if (!switchFirst) applyStatus(await bridge.ai.setConfig(configUpdate));
        if (snapshot.progress.model?.stage !== 'ready') dispatch({ kind: 'model-ready', model });
      }
    } catch (err) {
      const e = fromIpcError(err);
      if (pullCancelRequested || isAbort(e)) {
        dispatch({ kind: 'model-cancelled' });
      } else {
        setError('model', e);
        dispatch({ kind: 'model-error', model, message: e.message });
      }
    } finally {
      setPending('model', false);
    }
    await refreshAfterAction();
  },

  async selectTier(tier) {
    const customModel = snapshot.status?.config.customModel;
    return actions.setConfig({ tier, ...(customModel ? { customModel: null } : {}) });
  },

  async cancelPull() {
    const bridge = getBridge();
    if (!bridge) return;
    pullCancelRequested = true;
    dispatch({ kind: 'model-cancelled' });
    try {
      await bridge.ai.cancelPull();
    } catch {
      // ignore : l'état « interrompu » est déjà affiché
    }
  },

  async setConfig(configUpdate) {
    const bridge = getBridge();
    if (!bridge) return { status: null, error: new MagistraError('INTERNAL') };
    setError('config', undefined);
    setPending('config', true);
    try {
      const status = await bridge.ai.setConfig(configUpdate);
      applyStatus(status);
      return { status, error: null };
    } catch (err) {
      const error = fromIpcError(err);
      setError('config', error);
      return { status: null, error };
    } finally {
      setPending('config', false);
    }
  },

  clearError(scope) {
    setError(scope, undefined);
    if (scope === 'engine' && snapshot.progress.engine?.stage === 'error') dispatch({ kind: 'engine-clear' });
    if (scope === 'model' && snapshot.progress.model?.stage === 'error') dispatch({ kind: 'model-clear' });
  },

  async activate(options) {
    if (!getBridge()) return;
    const request = ++activationRequest;
    setActivation({ state: 'running', step: null, resumed: false, error: undefined });
    // Mémorisée AVANT tout téléchargement : fermer Magistra pendant l'installation ne perd pas la demande.
    await rememberActivation(true);
    // « Annuler » cliqué pendant cet enregistrement (disque lent, antivirus) : la demande a déjà été retirée, rien ne
    // démarre — jamais « Activation interrompue » suivie d'un téléchargement.
    if (request !== activationRequest) return;
    await startActivation(false, options ?? {});
  },

  async resumeActivation() {
    const bridge = getBridge();
    if (!bridge) return;
    // Une fois par chargement de la fenêtre. Après un rechargement pendant l'activation, l'enchaînement reprend :
    // l'opération encore en cours dans le processus principal est attendue (AI_BUSY), jamais relancée.
    if (resumeChecked) return;
    resumeChecked = true;
    const requested = await bridge.prefs.get().then(prefs => prefs.aiSetupRequested === true, () => false);
    if (requested) await startActivation(true);
  },

  async cancelActivation() {
    activationCancelled = true;
    activationRequest += 1;
    const s = snapshot;
    // Étape en cours de l'activation : son opération est arrêtée même sans progression connue de cette page (fenêtre
    // rechargée : téléchargement ou installation attendus dans le processus principal, avant tout évènement).
    // Sans rien en cours, ces arrêts ne font rien côté processus principal.
    const running = s.activation.state === 'running';
    const stops: Promise<void>[] = [];
    if ((running && s.activation.step === 'engine')
      || s.pending.engine || isEngineBusy(s.progress.engine) || s.progress.engine?.stage === 'waiting' || s.manualInstall) {
      stops.push(actions.cancelEngineInstall());
    }
    if ((running && s.activation.step === 'model') || s.pending.model || isModelPulling(s.progress.model)) stops.push(actions.cancelPull());
    await Promise.all(stops);
    // Opération lancée hors activation (page officielle ouverte depuis la page de l'IA…) : arrêtée, sans « Activation
    // interrompue » pour une activation qui n'avait pas commencé ; une demande restée après une erreur est retirée.
    if (running || s.activation.state === 'error') await markActivationCancelled();
  },

  async forgetActivation() {
    if (snapshot.activation.state === 'running') return;
    activationRequest += 1;
    await markActivationCancelled();
  },

  dismissActivation() {
    if (snapshot.activation.state !== 'running') setActivation(IDLE_ACTIVATION);
  },
};

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useIsLocal(): boolean {
  const runtime = useOptionalRuntime();
  if (runtime) return runtime.mode === 'local';
  return getBridge() !== null;
}

/**
 * État de l'IA locale et actions associées. Renvoie null hors de l'application Windows.
 * Le chargement est automatique ; l'état est rafraîchi après chaque action.
 */
export function useAIStatus(): AIController | null {
  const enabled = useIsLocal();
  const snap = useSyncExternalStore(enabled ? subscribe : subscribeNothing, enabled ? getSnapshot : getInitialSnapshot);

  useEffect(() => {
    if (!enabled) return;
    if (!snapshot.status || Date.now() - snapshot.loadedAt > 2000) void loadStatus();
  }, [enabled]);

  return useMemo(() => (enabled ? { ...snap, ...actions } : null), [enabled, snap]);
}

export interface CapabilitiesState {
  capabilities: Capabilities | null;
  error: MagistraError | null;
  loading: boolean;
  reload(): void;
}

/**
 * Capacités du mode courant (IA disponible, recherche, confidentialité).
 * `refreshKey` permet de relire les capacités quand la configuration change.
 */
export function useCapabilities(options: { enabled?: boolean; refreshKey?: string } = {}): CapabilitiesState {
  const runtime = useOptionalRuntime();
  const client = runtime?.client ?? null;
  const enabled = options.enabled !== false && client !== null;
  const [nonce, setNonce] = useState(0);
  const key = `${nonce}|${options.refreshKey ?? ''}`;
  const [result, setResult] = useState<{ key: string; capabilities: Capabilities | null; error: MagistraError | null } | null>(null);

  useEffect(() => {
    if (!enabled || !client) return;
    let cancelled = false;
    client.capabilities().then(
      capabilities => {
        if (!cancelled) setResult({ key, capabilities, error: null });
      },
      err => {
        if (cancelled) return;
        const error = err instanceof MagistraError ? err : fromIpcError(err);
        setResult({ key, capabilities: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, client, key]);

  return useMemo(() => ({
    // On garde les dernières capacités connues pendant une nouvelle lecture.
    capabilities: result?.capabilities ?? null,
    error: result?.key === key ? result.error : null,
    loading: enabled && result?.key !== key,
    reload: () => setNonce(n => n + 1),
  }), [result, key, enabled]);
}
