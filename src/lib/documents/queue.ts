// File d'attente à concurrence bornée : les documents sont analysés deux par deux, pas tous à la fois.
// Chaque fichier lu (jusqu'à 60 Mo) est copié en mémoire pendant son analyse : 12 fichiers lancés ensemble
// saturent la mémoire d'un PC modeste. La borne vaut pour toutes les tâches confiées au même limiteur, quel que
// soit le nombre de dépôts successifs.

/** Nombre de documents analysés en même temps. */
export const EXTRACTION_CONCURRENCY = 2;

/** Lance une tâche dès qu'une place se libère ; la promesse rendue se règle quand cette tâche est finie. */
export type Limiter = (task: () => Promise<unknown>) => Promise<void>;

/**
 * Limiteur partagé : `limit` tâches au plus en même temps, dans l'ordre d'arrivée, d'où qu'elles viennent.
 * Une tâche qui échoue n'arrête pas les autres : chaque tâche rend compte de sa propre erreur.
 */
export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, limit);
  const waiting: (() => void)[] = [];
  let running = 0;
  return async task => {
    if (running < max) running++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      await task();
    } catch {
      // Voir ci-dessus : l'erreur est déjà traitée par la tâche.
    } finally {
      // La place libérée passe directement à la tâche suivante, sans jamais dépasser la limite.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
