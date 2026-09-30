// Services de la mise en page (AppLayout) offerts aux pages affichées dans sa zone principale (Outlet).

import { useOutletContext } from 'react-router-dom';

export interface AppShell {
  /** Ouvre « Outils pédagogiques » dans la barre latérale (et le tiroir sur mobile), le focus sur l'outil en cours. */
  openTools(): void;
}

/** Services de la mise en page ; null si la page est affichée seule (tests, autre mise en page). */
export function useAppShell(): AppShell | null {
  const context = useOutletContext<AppShell | null | undefined>();
  return context && typeof context.openTools === 'function' ? context : null;
}
