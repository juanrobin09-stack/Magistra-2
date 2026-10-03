// Reprise après un chargement de fichier raté (évènement `vite:preloadError`).
//
// Nouvelle version déployée pendant que la page est ouverte : un fichier de l'ancienne version (nom à empreinte) n'existe
// plus et le chargement d'une page ou d'un module échoue. Le seul remède est de recharger la page, une seule fois par
// minute (horodatage en sessionStorage) : jamais de boucle de rechargement, quelle que soit la durée de l'échec.
// On ne recharge que dans ce cas précis. Hors ligne, ou si le rechargement a déjà eu lieu, l'évènement n'est pas
// neutralisé : Vite relance l'erreur d'origine, que l'application affiche (message d'erreur, ErrorBoundary) sans perdre
// l'état de la page.

const RELOAD_KEY = 'magistra_preload_reload';
const RELOAD_WINDOW_MS = 60_000;

export interface PreloadRecoveryEnv {
  now: () => number;
  /** Faux seulement si le navigateur sait qu'il est hors ligne. */
  isOnline: () => boolean;
  /** Peut lever (stockage bloqué) : dans ce cas on ne recharge pas. */
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  reload: () => void;
}

const browserEnv: PreloadRecoveryEnv = {
  now: () => Date.now(),
  isOnline: () => navigator.onLine !== false,
  storage: () => sessionStorage,
  reload: () => window.location.reload(),
};

/** Recharge la page si c'est utile et sûr ; retourne vrai quand le rechargement est lancé (l'évènement est alors neutralisé). */
export function recoverFromPreloadError(event: Event, env: PreloadRecoveryEnv = browserEnv): boolean {
  if (!env.isOnline()) return false;
  try {
    const storage = env.storage();
    const now = env.now();
    const last = Number(storage.getItem(RELOAD_KEY));
    // Horodatage futur (horloge reculée) : il ne bloque pas, il est remplacé par l'heure courante.
    if (last > 0 && now - last >= 0 && now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  event.preventDefault();
  env.reload();
  return true;
}

export function installPreloadRecovery(target: EventTarget = window, env: PreloadRecoveryEnv = browserEnv): void {
  target.addEventListener('vite:preloadError', event => {
    recoverFromPreloadError(event, env);
  });
}
