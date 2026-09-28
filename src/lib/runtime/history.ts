// Outils communs à l'historique : extraits, pagination, statistiques, recherche sans accents.

import { getMatiereLabel, getToolLabel, isTypeContenu, resolveMatiere } from '@shared/catalog';
import { getNiveauLabel, isNiveau } from '@shared/levels';
import type { GenerationRecord, GenerationSummary, HistoryPage, UsageStats } from '@shared/types';

export function excerptOf(markdown: string, max = 240): string {
  const text = markdown
    .replace(/^>.*$/gm, '')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function paginate(items: GenerationSummary[], cursor?: string, limit = 50): HistoryPage {
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 200);
  const page = items.slice(start, start + size);
  const next = start + size < items.length ? String(start + size) : undefined;
  return { items: page, nextCursor: next };
}

export function computeStats(records: Pick<GenerationRecord, 'createdAt' | 'isFavorite' | 'matiere'>[], now = new Date()): UsageStats {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const counts = new Map<string, number>();
  let today = 0;
  let week = 0;
  let favorites = 0;
  for (const r of records) {
    const t = new Date(r.createdAt).getTime();
    if (t >= startOfToday) today++;
    if (t >= weekAgo) week++;
    if (r.isFavorite) favorites++;
    // Ancien libellé stocké (« Mathématiques ») et clé actuelle (« mathematiques ») comptent ensemble.
    const raw = String(r.matiere ?? '');
    const m = raw ? resolveMatiere(raw) ?? raw : '';
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { total: records.length, favorites, today, week, topMatiere: top ? { matiere: top[0], count: top[1] } : undefined };
}

export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Recherche insensible aux accents sur sujet, matière, niveau, type et extrait. */
export function matchesSearch(item: GenerationSummary, query: string): boolean {
  const q = normalizeSearch(query.trim());
  if (!q) return true;
  const niveau = typeof item.niveau === 'string' ? item.niveau : '';
  const haystack = normalizeSearch([
    item.sujet,
    getMatiereLabel(item.matiere),
    item.discipline ?? '',
    getNiveauLabel(niveau),
    // Libellé générique ET libellé affiché pour ce niveau (« Évaluation » / « Examen », « Exercices » / « TD »).
    isTypeContenu(item.type) ? getToolLabel(item.type) : '',
    isTypeContenu(item.type) && isNiveau(niveau) ? getToolLabel(item.type, niveau) : '',
    item.excerpt,
  ].join(' '));
  return q.split(/\s+/).every(term => haystack.includes(term));
}
