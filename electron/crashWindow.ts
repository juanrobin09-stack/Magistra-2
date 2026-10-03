// Arrêts répétés du processus d'affichage : fenêtre glissante plutôt que compteur à vie.

/** Fenêtre d'observation : une boucle de plantages stoppe vite, des plantages espacés de plusieurs jours non. */
export const RENDERER_CRASH_WINDOW_MS = 5 * 60_000;
/** Rechargements automatiques tolérés dans la fenêtre ; le suivant est fatal. */
export const RENDERER_MAX_RELOADS = 3;

/**
 * Enregistre un arrêt de l'affichage à l'instant `now` (la liste est modifiée sur place : les arrêts plus anciens que la
 * fenêtre sont oubliés). Renvoie true s'il faut recharger la page, false si c'est une boucle de plantages (fatal).
 */
export function recordRendererCrash(crashes: number[], now: number): boolean {
  while (crashes.length > 0 && now - crashes[0]! >= RENDERER_CRASH_WINDOW_MS) crashes.shift();
  crashes.push(now);
  return crashes.length <= RENDERER_MAX_RELOADS;
}
