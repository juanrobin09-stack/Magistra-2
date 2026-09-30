// Services de la mise en page (AppLayout) offerts aux pages affichées dans sa zone principale (Outlet).

import { useOutletContext } from 'react-router-dom';
import type { NiveauScolaire } from '@shared/levels';

export interface AppShell {
  /** Ouvre « Outils pédagogiques » dans la barre latérale (et le tiroir sur mobile), le focus sur l'outil en cours. */
  openTools(): void;
  /**
   * Niveau du formulaire de la page Générer : les libellés des outils de la barre latérale suivent ce niveau, comme la
   * page (« TD / Exercices », « Examen »… dans le supérieur). null : niveau du profil.
   */
  setToolNiveau(niveau: NiveauScolaire | null): void;
}

/** Services de la mise en page ; null si la page est affichée seule (tests, autre mise en page). */
export function useAppShell(): AppShell | null {
  const context = useOutletContext<AppShell | null | undefined>();
  return context && typeof context.openTools === 'function' && typeof context.setToolNiveau === 'function' ? context : null;
}

/**
 * Mise en page large (barre latérale fixe) : même seuil que le point de rupture « lg » de Tailwind, en rem, pour que
 * le code et le CSS changent de mise en page ensemble, même quand la taille de police du navigateur a été agrandie.
 */
export const WIDE_LAYOUT_QUERY = '(min-width: 64rem)';

/** Mise en page étroite : barre latérale en tiroir, ouverte par le bouton « Menu ». Faux sans matchMedia (tests). */
export function isDrawerLayout(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_LAYOUT_QUERY).matches;
}
