// Logique pure partagée par l'Historique, les Favoris et le Tableau de bord (testable sans navigateur).

import { getMatiereLabel, getToolLabel } from '@shared/catalog';
import { toMagistraError } from '@shared/errors';
import { getNiveauLabel, isNiveau, type NiveauScolaire } from '@shared/levels';
import type { GenerationRecord, GenerationSummary } from '@shared/types';
import { unwrapDocumentFence } from '@/lib/generation/result';
import { excerptOf } from '@/lib/runtime/history';

export const PAGE_SIZE = 30;

/** Message lisible par un enseignant, sans détail technique. */
export function errorMessage(err: unknown): string {
  return toMagistraError(err).message;
}

export function isNotFound(err: unknown): boolean {
  return toMagistraError(err).code === 'NOT_FOUND';
}

/** Niveau exploitable par le référentiel (les anciens enregistrements stockaient parfois un libellé). */
export function niveauCode(niveau: string): NiveauScolaire | undefined {
  return isNiveau(niveau) ? niveau : undefined;
}

/** Libellé d'outil adapté au niveau (« TD / Exercices » dans le supérieur…). */
export function toolLabelFor(item: Pick<GenerationSummary, 'type' | 'niveau'>): string {
  return getToolLabel(item.type, niveauCode(String(item.niveau)));
}

export function niveauLabelFor(item: Pick<GenerationSummary, 'niveau'>): string {
  return getNiveauLabel(String(item.niveau ?? ''));
}

export function formatDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** « Il y a 5 min », « Hier »… — `now` est fourni par l'appelant (pas d'horloge lue pendant le rendu). */
export function timeAgo(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Hier';
  if (d < 7) return `Il y a ${d} jours`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Ajoute une page à la liste sans doublon (une génération créée entre-temps décale les pages). */
export function mergeUnique(current: GenerationSummary[], page: GenerationSummary[]): GenerationSummary[] {
  const seen = new Set(current.map(i => i.id));
  return [...current, ...page.filter(i => !seen.has(i.id))];
}

/** Insère un élément à sa place (du plus récent au plus ancien), s'il n'est pas déjà présent. */
export function insertSorted(current: GenerationSummary[], item: GenerationSummary): GenerationSummary[] {
  if (current.some(i => i.id === item.id)) return current;
  const t = new Date(item.createdAt).getTime();
  const index = current.findIndex(i => new Date(i.createdAt).getTime() < t);
  if (index < 0) return [...current, item];
  return [...current.slice(0, index), item, ...current.slice(index)];
}

/**
 * Curseur de la page suivante après des suppressions.
 * Un curseur purement numérique est un décalage (offset) : chaque élément retiré avant lui
 * le décale d'un cran, sans correction la page suivante sauterait des éléments.
 * Tout autre curseur (clé de pagination) n'est pas affecté.
 */
export function adjustCursor(cursor: string, removed: number): string {
  if (removed === 0 || !/^\d+$/.test(cursor)) return cursor;
  return String(Math.max(0, parseInt(cursor, 10) - removed));
}

export function summaryFromRecord(record: GenerationRecord): GenerationSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    niveau: record.niveau,
    matiere: record.matiere,
    discipline: record.discipline,
    sujet: record.sujet,
    isFavorite: record.isFavorite,
    excerpt: excerptOf(record.contenu),
  };
}

/** Document prêt à exporter (PDF, Markdown, impression). */
export function exportDocFor(record: GenerationRecord) {
  return {
    title: record.sujet,
    content: unwrapDocumentFence(record.contenu),
    meta: {
      type: toolLabelFor(record),
      niveau: niveauLabelFor(record),
      matiere: [getMatiereLabel(record.matiere), record.discipline].filter(Boolean).join(' — '),
      // Date ISO : le module d'export la met en forme lui-même.
      date: record.createdAt,
    },
  };
}
