// Titre de l'onglet propre à chaque vue : les lecteurs d'écran l'annoncent et l'historique du
// navigateur reste lisible.

import { useEffect } from 'react';

export const APP_TITLE = 'Magistra — assistant pédagogique IA';

/** Titre des pages de l'espace enseignant, selon l'adresse. */
export function appPageTitle(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  if (path.endsWith('/generate')) return 'Générer';
  if (path.endsWith('/history')) return 'Historique';
  if (path.endsWith('/favorites')) return 'Favoris';
  if (path.endsWith('/settings')) return 'Réglages';
  return 'Tableau de bord';
}

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} — Magistra` : APP_TITLE;
  }, [title]);
}
