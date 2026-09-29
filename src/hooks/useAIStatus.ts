// État de l'IA locale (application Windows) partagé par toutes les vues :
// assistant de premier démarrage, réglages et indicateur de la barre latérale.
//
// Un seul abonnement à ai.onProgress est ouvert tant qu'au moins un composant utilise ce hook ;
// il est fermé quand le dernier composant est démonté. Hors application Windows, le hook renvoie null.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { TierId } from '@shared/ai/models';
import { MagistraError } from '@shared/errors';
import type { AIConfigUpdate, AIProgressEvent, AIStatus, EngineInstallOptions, Unsubscribe } from '@shared/ipc';
import type { Capabilities } from '@shared/types';
import { EMPTY_PROGRESS, reduceProgress, type AIProgressState, type ProgressAction } from '@/lib/ai-ui/progress';
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

export interface AISnapshot {
  status: AIStatus | null;
  progress: AIProgressState;
  errors: Partial<Record<AIErrorScope, MagistraError>>;
  pending: AIPending;
  /** L'enseignant installe le moteur lui-même depuis la page officielle : Magistra attend la fin. */
  manualInstall: boolean;
  /** L'installation en cours est une MISE À JOUR du moteur (moteur trop ancien). */
  engineUpdate?: boolean;
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
}

export type AIController = AISnapshot & AIActions;

/** Résultat d'un changement de configuration : nouvel état, ou erreur compréhensible. */
export interface AIConfigResult {
  status: AIStatus | null;
  error: MagistraError | null;
}

// ─── Magasin partagé ────────────────────────────────────────────────────────

const INITIAL: AISnapshot = {
  status: null,
  progress: EMPTY_PROGRESS,
  errors: {},
  pending: { status: false, engine: false, start: false, model: false, config: false },
  manualInstall: false,
  loadedAt: 0,
};

let snapshot: AISnapshot = INITIAL;
const listeners = new Set<() => void>();
let detachBridge: Unsubscribe | null = null;
let inflight: Promise<AIStatus | null> | null = null;
let engineCancelRequested = false;
let pullCancelRequested = false;

function update(patch: Partial<AISnapshot> | ((s: AISnapshot) => Partial<AISnapshot>)): void {
  const next = typeof patch === 'function' ? patch(snapshot) : patch;
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
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

function applyStatus(status: AIStatus): void {
  update(s => {
    let progress = s.progress;
    // Une fois le moteur détecté, l'attente d'installation est terminée.
    if (status.engine.state === 'running' && progress.engine && ['ready', 'waiting', 'cancelled'].includes(progress.engine.stage)) {
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
