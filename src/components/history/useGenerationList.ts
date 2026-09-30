import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationSummary } from '@shared/types';
import type { DataStore } from '@/lib/runtime/types';
import { adjustCursor, errorMessage, insertSorted, mergeUnique, PAGE_SIZE } from './logic';

interface ListState {
  status: 'loading' | 'ready' | 'error';
  items: GenerationSummary[];
  nextCursor?: string;
  error?: string;
}

/**
 * Liste paginée des générations (résumés uniquement) : chargement, erreur visible,
 * « Charger plus » via nextCursor, mises à jour locales après une action.
 */
export function useGenerationList(store: DataStore, favoritesOnly: boolean) {
  const [state, setState] = useState<ListState>({ status: 'loading', items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  /** Éléments retirés côté serveur depuis l'obtention du curseur (correction des curseurs de type offset). */
  const removedSinceCursor = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    store.listGenerations({ favoritesOnly, limit: PAGE_SIZE }).then(
      page => {
        if (cancelled) return;
        removedSinceCursor.current = 0;
        setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor });
        setLoadMoreError(null);
      },
      err => {
        if (!cancelled) setState(s => ({ ...s, status: 'error', error: errorMessage(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, favoritesOnly, reloadKey]);

  const reload = useCallback(() => {
    setState(s => ({ ...s, status: 'loading', error: undefined }));
    setReloadKey(k => k + 1);
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await store.listGenerations({
        favoritesOnly,
        cursor: adjustCursor(cursor, removedSinceCursor.current),
        limit: PAGE_SIZE,
      });
      removedSinceCursor.current = 0;
      setState(s => ({ ...s, items: mergeUnique(s.items, page.items), nextCursor: page.nextCursor }));
    } catch (err) {
      setLoadMoreError(errorMessage(err));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [store, favoritesOnly, state.nextCursor]);

  const updateItem = useCallback((id: string, patch: Partial<GenerationSummary>) => {
    setState(s => ({ ...s, items: s.items.map(i => (i.id === id ? { ...i, ...patch } : i)) }));
  }, []);

  /** Retire un élément supprimé côté serveur (`wasListed` : il faisait partie des pages chargées). */
  const removeItem = useCallback((id: string, wasListed: boolean) => {
    if (wasListed) removedSinceCursor.current += 1;
    setState(s => ({ ...s, items: s.items.filter(i => i.id !== id) }));
  }, []);

  const insertItem = useCallback((item: GenerationSummary) => {
    setState(s => ({ ...s, items: insertSorted(s.items, item) }));
  }, []);

  /** Le serveur a retiré (+1) ou rajouté (−1) un élément de cette liste sans que l'ordre local change. */
  const noteServerShift = useCallback((delta: number) => {
    removedSinceCursor.current = Math.max(0, removedSinceCursor.current + delta);
  }, []);

  const hasItem = useCallback((id: string) => state.items.some(i => i.id === id), [state.items]);

  return {
    status: state.status,
    items: state.items,
    error: state.error,
    nextCursor: state.nextCursor,
    loadingMore,
    loadMoreError,
    reload,
    loadMore,
    updateItem,
    removeItem,
    insertItem,
    noteServerShift,
    hasItem,
  };
}
