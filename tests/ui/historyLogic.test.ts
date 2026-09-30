import { describe, expect, it } from 'vitest';
import {
  adjustCursor, exportDocFor, formatDate, insertSorted, mergeUnique, summaryFromRecord, timeAgo, toolLabelFor,
} from '@/components/history/logic';
import type { GenerationSummary } from '@shared/types';
import { makeRecord } from './helpers';

const summary = (id: string, createdAt: string): GenerationSummary => ({
  id, createdAt, type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: id, isFavorite: false, excerpt: '',
});

describe('pagination', () => {
  it('corrige un curseur de type décalage après des suppressions', () => {
    expect(adjustCursor('30', 0)).toBe('30');
    expect(adjustCursor('30', 2)).toBe('28');
    expect(adjustCursor('1', 5)).toBe('0');
  });

  it('ne touche pas à un curseur opaque (clé de pagination)', () => {
    expect(adjustCursor('2026-09-28T10:00:00Z|abc', 3)).toBe('2026-09-28T10:00:00Z|abc');
  });

  it('fusionne une page sans doublon', () => {
    const a = [summary('a', '2026-09-28T10:00:00Z'), summary('b', '2026-09-28T09:00:00Z')];
    const merged = mergeUnique(a, [summary('b', '2026-09-28T09:00:00Z'), summary('c', '2026-09-28T08:00:00Z')]);
    expect(merged.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('insère un élément à sa place chronologique', () => {
    const list = [summary('a', '2026-09-28T10:00:00Z'), summary('c', '2026-09-28T08:00:00Z')];
    expect(insertSorted(list, summary('b', '2026-09-28T09:00:00Z')).map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(insertSorted(list, summary('z', '2026-09-27T09:00:00Z')).map(i => i.id)).toEqual(['a', 'c', 'z']);
    expect(insertSorted(list, summary('a', '2026-09-28T10:00:00Z'))).toBe(list);
  });
});

describe('affichage', () => {
  it('libellé d’outil adapté au niveau, y compris pour les anciens libellés stockés', () => {
    expect(toolLabelFor({ type: 'exercices', niveau: 'licence_2' })).toBe('TD / Exercices');
    expect(toolLabelFor({ type: 'evaluation', niveau: 'master_1' })).toBe('Examen');
    expect(toolLabelFor({ type: 'exercices', niveau: 'cp' })).toBe('Exercices');
    expect(toolLabelFor({ type: 'exercices', niveau: 'Licence 2' })).toBe('Exercices');
  });

  it('« il y a » calculé à partir d’une heure fournie (rendu pur)', () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe("À l'instant");
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('Il y a 5 min');
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('Il y a 3 h');
    expect(timeAgo(new Date(now - 26 * 3_600_000).toISOString(), now)).toBe('Hier');
    expect(timeAgo(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('Il y a 3 jours');
    expect(timeAgo('pas une date', now)).toBe('');
  });

  it('date lisible en français', () => {
    expect(formatDate('2026-03-12T10:00:00Z')).toMatch(/12 mars 2026/);
    expect(formatDate('invalide')).toBe('');
  });

  it('document d’export : titre, contenu et métadonnées lisibles', () => {
    const record = makeRecord(1, { type: 'exercices', niveau: 'licence_1', matiere: 'droit', discipline: 'Droit public', sujet: 'Les sources du droit' });
    const doc = exportDocFor(record);
    expect(doc.title).toBe('Les sources du droit');
    expect(doc.content).toBe(record.contenu);
    expect(doc.meta.type).toBe('TD / Exercices');
    expect(doc.meta.niveau).toBe('Licence 1');
    expect(doc.meta.matiere).toBe('Droit — Droit public');
  });

  it('résumé construit à partir d’un enregistrement complet', () => {
    const s = summaryFromRecord(makeRecord(2, { isFavorite: true }));
    expect(s).toMatchObject({ id: 'gen-2', isFavorite: true, sujet: 'Sujet 2' });
    expect(s.excerpt).toContain('Contenu numéro 2');
    expect(s).not.toHaveProperty('contenu');
  });
});
