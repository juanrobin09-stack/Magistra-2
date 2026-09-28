// Suivi de l'installation (moteur IA, modèles) à partir des évènements du processus principal.
// Réducteur pur : l'état affiché ne dépend que de la suite d'évènements reçus.

import type { TierId } from '@shared/ai/models';
import type { AIProgressEvent } from '@shared/ipc';
import { progressPercent } from './format';

export interface EngineProgressState {
  stage: 'starting' | 'download' | 'install' | 'waiting' | 'ready' | 'error' | 'cancelled';
  receivedMB?: number;
  totalMB?: number;
  message?: string;
  version?: string;
}

export interface ModelProgressState {
  stage: 'starting' | 'pull' | 'ready' | 'error' | 'cancelled';
  model: string;
  tier?: TierId;
  status?: string;
  completedMB?: number;
  totalMB?: number;
  percent?: number;
  message?: string;
}

export interface AIProgressState {
  engine: EngineProgressState | null;
  model: ModelProgressState | null;
}

export const EMPTY_PROGRESS: AIProgressState = { engine: null, model: null };

/** Évènements du processus principal + actions de l'interface (début, annulation, remise à zéro). */
export type ProgressAction =
  | AIProgressEvent
  | { kind: 'engine-start' }
  | { kind: 'engine-cancelled' }
  | { kind: 'engine-clear' }
  | { kind: 'model-start'; model: string; tier?: TierId }
  | { kind: 'model-cancelled' }
  | { kind: 'model-clear' };

export function reduceProgress(state: AIProgressState, action: ProgressAction): AIProgressState {
  const engine = state.engine;
  const model = state.model;
  switch (action.kind) {
    case 'engine-start':
      return { ...state, engine: { stage: 'starting' } };
    case 'engine-download':
      return {
        ...state,
        engine: { stage: 'download', receivedMB: action.receivedMB, totalMB: action.totalMB ?? engine?.totalMB },
      };
    case 'engine-install':
      return { ...state, engine: { ...engine, stage: 'install', message: action.message } };
    case 'engine-waiting':
      return { ...state, engine: { ...engine, stage: 'waiting', message: action.message } };
    case 'engine-ready':
      return { ...state, engine: { stage: 'ready', version: action.version } };
    case 'engine-error':
      // Après une annulation demandée par l'enseignant, l'erreur qui suit n'en est pas une.
      if (engine?.stage === 'cancelled') return state;
      return { ...state, engine: { ...engine, stage: 'error', message: action.message } };
    case 'engine-cancelled':
      return { ...state, engine: { stage: 'cancelled' } };
    case 'engine-clear':
      return { ...state, engine: null };

    case 'model-start':
      return { ...state, model: { stage: 'starting', model: action.model, tier: action.tier } };
    case 'model-pull': {
      if (model?.stage === 'cancelled') return state;
      const same = model && model.model === action.model;
      const completedMB = action.completedMB ?? (same ? model.completedMB : undefined);
      const totalMB = action.totalMB ?? (same ? model.totalMB : undefined);
      const computed = progressPercent({ percent: action.percent, completed: action.completedMB, total: action.totalMB });
      return {
        ...state,
        model: {
          stage: 'pull',
          model: action.model,
          tier: action.tier ?? (same ? model.tier : undefined),
          status: action.status,
          completedMB,
          totalMB,
          percent: computed ?? (same ? model.percent : undefined),
        },
      };
    }
    case 'model-ready':
      return { ...state, model: { ...(model?.model === action.model ? model : {}), stage: 'ready', model: action.model, percent: 100 } };
    case 'model-error':
      if (model?.stage === 'cancelled') return state;
      return {
        ...state,
        model: { ...(model?.model === action.model ? model : {}), stage: 'error', model: action.model, message: action.message },
      };
    case 'model-cancelled':
      return model ? { ...state, model: { ...model, stage: 'cancelled' } } : state;
    case 'model-clear':
      return { ...state, model: null };
    default:
      return state;
  }
}

export function isEngineBusy(p: EngineProgressState | null): boolean {
  return p !== null && (p.stage === 'starting' || p.stage === 'download' || p.stage === 'install');
}

export function isModelPulling(p: ModelProgressState | null): boolean {
  return p !== null && (p.stage === 'starting' || p.stage === 'pull');
}
