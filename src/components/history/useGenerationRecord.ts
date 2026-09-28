import { useCallback, useEffect, useState } from 'react';
import type { GenerationRecord } from '@shared/types';
import type { DataStore } from '@/lib/runtime/types';
import { errorMessage, isNotFound } from './logic';

export type RecordState =
  | { id: string; status: 'loading' }
  | { id: string; status: 'ready'; record: GenerationRecord }
  | { id: string; status: 'error'; error: string; notFound: boolean };

/** Contenu complet d'une génération (la liste ne contient que des résumés). */
export function useGenerationRecord(store: DataStore, id: string | null) {
  const [state, setState] = useState<RecordState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    store.getGeneration(id).then(
      record => {
        if (!cancelled) setState({ id, status: 'ready', record });
      },
      err => {
        if (!cancelled) setState({ id, status: 'error', error: errorMessage(err), notFound: isNotFound(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, id, reloadKey]);

  const retry = useCallback(() => {
    if (!id) return;
    setState({ id, status: 'loading' });
    setReloadKey(k => k + 1);
  }, [id]);

  /** Mise à jour locale (bascule optimiste du favori…). */
  const patch = useCallback((targetId: string, changes: Partial<GenerationRecord>) => {
    setState(s => (s && s.id === targetId && s.status === 'ready' ? { ...s, record: { ...s.record, ...changes } } : s));
  }, []);

  // Tant que la réponse pour l'identifiant courant n'est pas arrivée, on affiche le chargement.
  const current: RecordState | null = !id ? null : state && state.id === id ? state : { id, status: 'loading' };
  return { state: current, retry, patch };
}
