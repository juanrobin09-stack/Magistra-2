import HistoryView from '@/components/history/HistoryView';

/** Favoris : mêmes fonctions que l'Historique (recherche, exports, suppression), filtrées sur les favoris. */
export default function FavoritesPage() {
  return <HistoryView favoritesOnly />;
}
