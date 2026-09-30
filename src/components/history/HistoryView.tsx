import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Heart, History, Loader2, Search, Sparkles } from 'lucide-react';
import type { GenerationRecord } from '@shared/types';
import { useRuntime } from '@/lib/runtime/context';
import { matchesSearch } from '@/lib/runtime/history';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ErrorBanner from '@/components/ui/ErrorBanner';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import GenerationDetail from './GenerationDetail';
import GenerationListItem from './GenerationListItem';
import { errorMessage, summaryFromRecord } from './logic';
import { useGenerationList } from './useGenerationList';
import { useGenerationRecord } from './useGenerationRecord';

/** Nombre maximal de contenus parcourus automatiquement par une recherche. */
const SEARCH_SCAN_LIMIT = 500;

interface HistoryViewProps {
  /** Favoris : uniquement les contenus marqués comme favoris. */
  favoritesOnly: boolean;
}

function isMobileLayout(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches;
}

/** Historique et Favoris : liste paginée + détail, avec recherche, actions et erreurs visibles. */
export default function HistoryView({ favoritesOnly }: HistoryViewProps) {
  const { store } = useRuntime();
  const list = useGenerationList(store, favoritesOnly);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedId = searchParams.get('id');
  const detail = useGenerationRecord(store, selectedId);
  const { toast, showToast, dismissToast } = useToast();

  const [query, setQuery] = useState('');
  const [favoritePending, setFavoritePending] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GenerationRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetailOnLoad = useRef(false);
  const focusListOnReturn = useRef(false);
  /** Garde synchrone : un double-clic ne peut jamais envoyer deux appels concurrents. */
  const favoriteBusy = useRef(false);

  const fromList = Boolean((location.state as { fromList?: boolean } | null)?.fromList);
  const title = favoritesOnly ? 'Favoris' : 'Historique';
  const HeaderIcon = favoritesOnly ? Heart : History;

  // En Favoris, un contenu retiré des favoris disparaît de la liste (et réapparaît si on annule).
  const visible = favoritesOnly ? list.items.filter(i => i.isFavorite) : list.items;
  const filtered = query.trim() ? visible.filter(i => matchesSearch(i, query)) : visible;

  // Recherche : les pages suivantes sont chargées automatiquement pour chercher dans tout l'historique
  // (au plus SEARCH_SCAN_LIMIT contenus, les plus récents d'abord).
  const searching = query.trim().length > 0;
  const { status: listStatus, nextCursor, loadingMore, loadMoreError, loadMore } = list;
  const scanned = list.items.length;
  useEffect(() => {
    if (!searching || listStatus !== 'ready' || !nextCursor || loadingMore || loadMoreError) return;
    if (scanned >= SEARCH_SCAN_LIMIT) return;
    void loadMore();
  }, [searching, listStatus, nextCursor, loadingMore, loadMoreError, scanned, loadMore]);

  // Sur mobile, le titre du contenu reçoit le focus quand il s'affiche (la liste est alors masquée).
  const detailReady = detail.state?.status === 'ready';
  useEffect(() => {
    if (detailReady && focusDetailOnLoad.current) {
      focusDetailOnLoad.current = false;
      detailHeadingRef.current?.focus();
    }
  }, [detailReady, selectedId]);

  // Retour à la liste : le titre de la liste reçoit le focus une fois la sélection effacée.
  useEffect(() => {
    if (!selectedId && focusListOnReturn.current) {
      focusListOnReturn.current = false;
      listHeadingRef.current?.focus();
    }
  }, [selectedId]);

  const onOpen = useCallback((id: string) => {
    if (id !== selectedId && isMobileLayout()) focusDetailOnLoad.current = true;
  }, [selectedId]);

  const clearSelection = useCallback((viaHistory: boolean) => {
    if (viaHistory && fromList) {
      navigate(-1);
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('id');
        return next;
      }, { replace: true });
    }
    focusListOnReturn.current = true;
  }, [fromList, navigate, setSearchParams]);

  const toggleFavorite = useCallback(async (record: GenerationRecord) => {
    if (favoriteBusy.current) return;
    favoriteBusy.current = true;
    const id = record.id;
    const next = !record.isFavorite;
    const listed = list.hasItem(id);
    setFavoritePending(id);
    // Bascule optimiste…
    list.updateItem(id, { isFavorite: next });
    detail.patch(id, { isFavorite: next });
    try {
      await store.setFavorite(id, next);
      if (favoritesOnly) {
        if (listed) list.noteServerShift(next ? -1 : 1);
        else if (next) list.insertItem(summaryFromRecord({ ...record, isFavorite: true }));
      }
      showToast(next ? 'Ajouté aux favoris.' : 'Retiré des favoris.', 'success');
    } catch (err) {
      // …annulée en cas d'échec.
      list.updateItem(id, { isFavorite: !next });
      detail.patch(id, { isFavorite: !next });
      showToast(`Favori non modifié : ${errorMessage(err)}`, 'error');
    } finally {
      favoriteBusy.current = false;
      setFavoritePending(null);
    }
  }, [favoritesOnly, list, detail, store, showToast]);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setDeletingId(target.id);
    try {
      await store.deleteGeneration(target.id);
      list.removeItem(target.id, list.hasItem(target.id));
      if (selectedId === target.id) clearSelection(false);
      showToast('Contenu supprimé.', 'success');
    } catch (err) {
      showToast(`Suppression impossible : ${errorMessage(err)}`, 'error');
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget, store, list, selectedId, clearSelection, showToast]);

  const countLabel = (() => {
    if (list.status !== 'ready') return '';
    const n = visible.length;
    const more = list.nextCursor ? '+' : '';
    if (favoritesOnly) return `${n}${more} favori${n > 1 || more ? 's' : ''}`;
    return `${n}${more} contenu${n > 1 || more ? 's' : ''}`;
  })();

  return (
    <div className="h-full flex">
      {/* ── Liste ── */}
      <section
        aria-label={`Liste : ${title}`}
        className={`${selectedId ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[360px] lg:shrink-0 lg:border-r border-white/5`}
      >
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <HeaderIcon size={18} className={`text-accent ${favoritesOnly ? 'fill-accent' : ''}`} aria-hidden="true" />
            <h1 ref={listHeadingRef} tabIndex={-1} className="text-xl text-white focus:outline-none" style={{ fontFamily: 'var(--font-display)' }}>
              {title}
            </h1>
          </div>
          <p className="text-xs text-mg-300" aria-live="polite">{countLabel}</p>
        </div>

        <div className="px-5 pb-4">
          <label htmlFor={`search-${favoritesOnly ? 'fav' : 'hist'}`} className="sr-only">
            Rechercher dans {favoritesOnly ? 'les favoris' : 'l’historique'}
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mg-300" aria-hidden="true" />
            <input
              id={`search-${favoritesOnly ? 'fav' : 'hist'}`}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Sujet, matière, niveau, outil…"
              className="input-field pl-9 py-2 text-sm"
              autoComplete="off"
            />
          </div>
          {query.trim() && list.status === 'ready' && (
            <p className="text-xs text-mg-300 mt-2" role="status">
              {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
              {list.nextCursor
                ? (list.loadingMore ? ' — recherche dans tout l’historique…' : ` parmi les ${visible.length} contenus les plus récents`)
                : ''}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {list.status === 'loading' && (
            <div className="space-y-2 px-2" role="status" aria-label="Chargement de la liste">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-[68px] rounded-lg animate-shimmer" aria-hidden="true" />
              ))}
            </div>
          )}

          {list.status === 'error' && (
            <div className="px-2">
              <ErrorBanner message={`Impossible de charger ${favoritesOnly ? 'vos favoris' : 'votre historique'}. ${list.error ?? ''}`} onRetry={list.reload} />
            </div>
          )}

          {list.status === 'ready' && visible.length === 0 && !list.nextCursor && (
            <div className="text-center py-12 px-4">
              <HeaderIcon size={32} className="text-mg-300 mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm text-mg-200">{favoritesOnly ? 'Aucun favori pour le moment' : 'Aucune génération pour le moment'}</p>
              <p className="text-xs text-mg-300 mt-1 mb-4">
                {favoritesOnly
                  ? 'Ouvrez un contenu de l’historique et cliquez sur le cœur pour le retrouver ici.'
                  : 'Vos contenus générés apparaîtront ici automatiquement.'}
              </p>
              <Link to={favoritesOnly ? '/app/history' : '/app/generate'} className="btn-secondary text-xs py-2 px-4 inline-flex">
                {favoritesOnly ? <><History size={12} aria-hidden="true" /> Voir l’historique</> : <><Sparkles size={12} aria-hidden="true" /> Générer un contenu</>}
              </Link>
            </div>
          )}

          {list.status === 'ready' && visible.length > 0 && filtered.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-sm text-mg-200">Aucun résultat pour « {query.trim()} »</p>
              {list.nextCursor && <p className="text-xs text-mg-300 mt-1">Chargez plus de contenus pour étendre la recherche.</p>}
            </div>
          )}

          {list.status === 'ready' && filtered.length > 0 && (
            <ul className="space-y-1.5">
              {filtered.map(item => (
                <GenerationListItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  replace={Boolean(selectedId)}
                  fromList={selectedId ? fromList : true}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}

          {list.status === 'ready' && list.nextCursor && (
            <div className="px-2 pt-3 space-y-2">
              {list.loadMoreError && <ErrorBanner message={`Chargement impossible. ${list.loadMoreError}`} />}
              <button
                type="button"
                onClick={() => void list.loadMore()}
                disabled={list.loadingMore}
                className="btn-secondary w-full justify-center text-sm py-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {list.loadingMore ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Chargement…</> : 'Charger plus'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Détail ── */}
      <section
        aria-label="Contenu sélectionné"
        className={`${selectedId ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}
      >
        {detail.state ? (
          <GenerationDetail
            key={detail.state.id}
            state={detail.state}
            favoritePending={favoritePending === detail.state.id}
            deleting={deletingId === detail.state.id}
            headingRef={detailHeadingRef}
            onToggleFavorite={record => void toggleFavorite(record)}
            onRequestDelete={setDeleteTarget}
            onBack={() => clearSelection(true)}
            onRetry={detail.retry}
            notify={showToast}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={40} className="text-mg-300 mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm text-mg-200">
                {favoritesOnly ? 'Sélectionnez un favori pour l’afficher' : 'Sélectionnez un contenu pour l’afficher'}
              </p>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        danger
        title="Supprimer ce contenu ?"
        message={deleteTarget ? `« ${deleteTarget.sujet} » sera définitivement supprimé de votre historique${deleteTarget.isFavorite ? ' et de vos favoris' : ''}. Cette action est irréversible.` : ''}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
