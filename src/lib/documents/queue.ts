// File d'attente à concurrence bornée : les documents sont analysés deux par deux, pas tous à la fois.
// Chaque fichier lu (jusqu'à 60 Mo) est copié en mémoire pendant son analyse : 12 fichiers lancés ensemble
// saturent la mémoire d'un PC modeste.

/** Nombre de documents analysés en même temps. */
export const EXTRACTION_CONCURRENCY = 2;

/**
 * Exécute les tâches dans l'ordre, `limit` au plus en même temps, et se termine quand toutes sont finies.
 * Une tâche qui échoue n'arrête pas les autres : chaque tâche rend compte de sa propre erreur.
 */
export async function runLimited(tasks: ReadonlyArray<() => Promise<unknown>>, limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        await task();
      } catch {
        // Voir ci-dessus : l'erreur est déjà traitée par la tâche.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
}
