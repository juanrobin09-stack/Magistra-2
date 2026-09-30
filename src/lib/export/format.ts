// Petites fonctions de présentation communes à l'export PDF et à l'impression.

export interface ExportMeta {
  type?: string;
  niveau?: string;
  matiere?: string;
  date?: string;
}

/** « Niveau · Matière · Type » (éléments absents ignorés). */
export function metaLine(meta: ExportMeta | undefined): string {
  if (!meta) return '';
  return [meta.niveau, meta.matiere, meta.type]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

/** Date lisible en français ; une date non reconnue est affichée telle quelle. */
export function formatExportDate(value: string | undefined, now: Date = new Date()): string {
  const format = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (!value || !value.trim()) return format(now);
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed);
    if (!Number.isNaN(d.getTime())) return format(d);
  }
  return trimmed;
}
