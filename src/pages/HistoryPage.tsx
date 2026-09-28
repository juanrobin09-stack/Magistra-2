import HistoryView from '@/components/history/HistoryView';

/** Historique : toutes les générations, paginées, avec recherche et actions. */
export default function HistoryPage() {
  return <HistoryView favoritesOnly={false} />;
}
