// Utilitaires partagés par les champs du formulaire de génération.

export const LABEL_CLASS = 'block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider';
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-mg-800';

export function fieldIds(id: string) {
  return { label: `${id}-label`, hint: `${id}-hint`, error: `${id}-error` };
}

/** aria-describedby pour un champ (aide + erreur éventuelle). */
export function describedBy(id: string, hint: boolean, error: boolean): string | undefined {
  const ids = fieldIds(id);
  const parts = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}
