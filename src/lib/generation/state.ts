// État d'une génération en flux (logique pure, testable sans React).

import type { ErrorCode } from '@shared/errors';
import type { GenerationEvent, GenerationRequest, GenerationStage, SourceRef } from '@shared/types';

export type GenerationPhase = 'idle' | 'running' | 'done' | 'error' | 'aborted';

export type DoneEvent = Extract<GenerationEvent, { type: 'done' }>;

export interface GenerationWarning {
  code: ErrorCode;
  message: string;
}

export interface GenerationFailure {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface GenerationState {
  phase: GenerationPhase;
  /** Identifiant de l'exécution courante : les évènements d'une exécution précédente sont ignorés. */
  runId: number;
  /** Instantané de la requête qui a produit (ou produit) le résultat affiché. */
  request: GenerationRequest | null;
  /** Texte streamé, puis contenu final (citations vérifiées) une fois terminé. */
  text: string;
  stage: GenerationStage | null;
  status: string | null;
  warnings: GenerationWarning[];
  sources: SourceRef[];
  internetUsed: boolean;
  result: DoneEvent | null;
  error: GenerationFailure | null;
}

export type GenerationAction =
  | { type: 'start'; runId: number; request: GenerationRequest }
  | { type: 'append'; runId: number; text: string }
  | { type: 'event'; runId: number; event: GenerationEvent }
  | { type: 'abort'; runId: number }
  | { type: 'fail'; runId: number; error: GenerationFailure }
  | { type: 'reset' };

export const ABORTED_MESSAGE = 'Génération interrompue.';

export function initialGenerationState(): GenerationState {
  return {
    phase: 'idle',
    runId: 0,
    request: null,
    text: '',
    stage: null,
    status: null,
    warnings: [],
    sources: [],
    internetUsed: false,
    result: null,
    error: null,
  };
}

function addWarning(list: GenerationWarning[], w: GenerationWarning): GenerationWarning[] {
  return list.some(x => x.code === w.code && x.message === w.message) ? list : [...list, w];
}

export function generationReducer(state: GenerationState, action: GenerationAction): GenerationState {
  if (action.type === 'reset') return { ...initialGenerationState(), runId: state.runId };
  if (action.type === 'start') {
    return { ...initialGenerationState(), phase: 'running', runId: action.runId, request: action.request };
  }
  if (action.runId !== state.runId) return state;

  switch (action.type) {
    case 'append':
      if (state.phase !== 'running' || !action.text) return state;
      return { ...state, text: state.text + action.text };

    case 'abort':
      if (state.phase !== 'running') return state;
      return { ...state, phase: 'aborted', stage: null, status: null };

    case 'fail':
      if (state.phase !== 'running') return state;
      return { ...state, phase: 'error', stage: null, status: null, error: action.error };

    case 'event':
      return applyEvent(state, action.event);

    default:
      return state;
  }
}

function applyEvent(state: GenerationState, event: GenerationEvent): GenerationState {
  // Un résultat final arrivé juste après « Arrêter » est conservé : il a peut-être déjà été enregistré.
  if (event.type === 'done' && (state.phase === 'running' || state.phase === 'aborted')) {
    return {
      ...state,
      phase: 'done',
      text: event.content,
      stage: null,
      status: null,
      sources: event.sources,
      internetUsed: event.internetUsed,
      result: event,
      error: null,
    };
  }
  if (state.phase !== 'running') return state;

  switch (event.type) {
    case 'status':
      return { ...state, stage: event.stage, status: event.message };
    case 'sources':
      return { ...state, sources: event.sources, internetUsed: event.internetUsed };
    case 'warning':
      return { ...state, warnings: addWarning(state.warnings, { code: event.code, message: event.message }) };
    case 'delta':
      return event.text ? { ...state, text: state.text + event.text } : state;
    case 'error':
      // Le texte partiel renvoyé par le moteur a déjà ses citations vérifiées : il remplace le texte brut reçu.
      if (event.code === 'GENERATION_ABORTED') {
        return { ...state, phase: 'aborted', stage: null, status: null, text: event.partial ?? state.text };
      }
      return {
        ...state,
        text: event.partial ?? state.text,
        phase: 'error',
        stage: null,
        status: null,
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };
    default:
      return state;
  }
}
