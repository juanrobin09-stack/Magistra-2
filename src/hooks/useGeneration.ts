// Génération en flux : le texte apparaît progressivement (≈ 10 rendus par seconde au maximum),
// « Arrêter » interrompt réellement la génération (AbortController) en conservant le texte produit,
// « Recommencer » relance exactement la même requête.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toMagistraError } from '@shared/errors';
import type { Capabilities, GenerationEvent, GenerationRequest } from '@shared/types';
import type { GenerationClient } from '@/lib/runtime/types';
import {
  generationReducer, initialGenerationState, type GenerationFailure, type GenerationState,
} from '@/lib/generation/state';

/** Intervalle minimal entre deux rendus du texte streamé. */
export const STREAM_RENDER_INTERVAL_MS = 100;

/**
 * Après « Arrêter », la génération annulée peut mettre un instant à se terminer (démarrage du
 * moteur local en cours…). Une relance attend sa fin, au plus ce délai, au lieu d'échouer
 * aussitôt avec « Une génération est déjà en cours ».
 */
export const PREVIOUS_RUN_WAIT_MS = 15_000;

const NO_RESULT: GenerationFailure = {
  code: 'AI_BAD_RESPONSE',
  message: "La génération s'est arrêtée sans résultat. Réessayez.",
  retryable: true,
};

interface RunRefs {
  runId: number;
  controller: AbortController | null;
  buffer: string;
  timer: ReturnType<typeof setTimeout> | null;
  lastFlush: number;
  finalReceived: boolean;
  /** Promesse de la dernière génération lancée (résolue quand elle est réellement terminée). */
  pending: Promise<void> | null;
}

export interface UseGeneration {
  state: GenerationState;
  isRunning: boolean;
  start(request: GenerationRequest): void;
  stop(): void;
  /** Relance la dernière requête (« Recommencer » / « Réessayer »). */
  restart(): void;
  reset(): void;
}

export function useGeneration(client: GenerationClient, renderIntervalMs = STREAM_RENDER_INTERVAL_MS): UseGeneration {
  const [state, dispatch] = useReducer(generationReducer, undefined, initialGenerationState);
  const refs = useRef<RunRefs>({ runId: 0, controller: null, buffer: '', timer: null, lastFlush: 0, finalReceived: false, pending: null });

  const flush = useCallback((runId: number) => {
    const r = refs.current;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    if (r.runId !== runId) {
      r.buffer = '';
      return;
    }
    if (!r.buffer) return;
    const text = r.buffer;
    r.buffer = '';
    r.lastFlush = Date.now();
    dispatch({ type: 'append', runId, text });
  }, []);

  const start = useCallback((request: GenerationRequest) => {
    const r = refs.current;
    r.controller?.abort();
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.buffer = '';
    r.lastFlush = 0;
    r.finalReceived = false;
    const runId = r.runId + 1;
    r.runId = runId;
    const controller = new AbortController();
    r.controller = controller;
    dispatch({ type: 'start', runId, request });

    const onEvent = (event: GenerationEvent) => {
      if (refs.current.runId !== runId) return;
      if (event.type === 'delta') {
        r.buffer += event.text;
        const wait = renderIntervalMs - (Date.now() - r.lastFlush);
        if (wait <= 0) flush(runId);
        else if (!r.timer) r.timer = setTimeout(() => flush(runId), wait);
        return;
      }
      flush(runId);
      if (event.type === 'done' || event.type === 'error') r.finalReceived = true;
      dispatch({ type: 'event', runId, event });
    };

    const previous = r.pending;
    const launch = async () => {
      if (previous) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          previous.catch(() => undefined),
          new Promise<void>(resolve => {
            timer = setTimeout(resolve, PREVIOUS_RUN_WAIT_MS);
          }),
        ]);
        clearTimeout(timer);
        if (controller.signal.aborted) return;
      }
      await client.generate(request, onEvent, controller.signal);
    };
    const pending = launch();
    r.pending = pending.catch(() => undefined);
    pending.then(
      () => {
        if (refs.current.runId !== runId) return;
        flush(runId);
        if (!r.finalReceived && !controller.signal.aborted) dispatch({ type: 'fail', runId, error: NO_RESULT });
      },
      (err: unknown) => {
        if (refs.current.runId !== runId) return;
        flush(runId);
        if (controller.signal.aborted) return;
        const e = toMagistraError(err);
        dispatch({ type: 'fail', runId, error: { code: e.code, message: e.message, retryable: e.retryable } });
      },
    ).finally(() => {
      if (refs.current.controller === controller) refs.current.controller = null;
    });
  }, [client, flush, renderIntervalMs]);

  const stop = useCallback(() => {
    const r = refs.current;
    if (!r.controller) return;
    r.controller.abort();
    r.controller = null;
    flush(r.runId);
    dispatch({ type: 'abort', runId: r.runId });
  }, [flush]);

  const lastRequest = state.request;
  const restart = useCallback(() => {
    if (lastRequest) start(lastRequest);
  }, [lastRequest, start]);

  const reset = useCallback(() => {
    const r = refs.current;
    r.controller?.abort();
    r.controller = null;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.buffer = '';
    r.runId += 1;
    dispatch({ type: 'reset' });
  }, []);

  // Quitter la page interrompt la génération en cours.
  useEffect(() => {
    const r = refs.current;
    return () => {
      r.controller?.abort();
      r.controller = null;
      if (r.timer) clearTimeout(r.timer);
      r.timer = null;
    };
  }, []);

  return { state, isRunning: state.phase === 'running', start, stop, restart, reset };
}

// ─── Capacités du moteur ─────────────────────────────────────────────────────

export interface UseCapabilities {
  caps: Capabilities | null;
  loading: boolean;
  error: string | null;
  refresh(): void;
}

/** Capacités réelles du moteur (confidentialité, recherche disponible, IA prête…). */
export function useCapabilities(client: GenerationClient): UseCapabilities {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.capabilities().then(
      c => {
        if (cancelled) return;
        setCaps(c);
        setError(null);
        setLoading(false);
      },
      err => {
        if (cancelled) return;
        setError(toMagistraError(err).message);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setVersion(v => v + 1);
  }, []);

  return { caps, loading, error, refresh };
}
