import { describe, expect, it } from 'vitest';
import { matchesSearch } from '@/lib/runtime/history';
import type { GenerationSummary } from '@shared/types';

function item(patch: Partial<GenerationSummary>): GenerationSummary {
  return {
    id: 'a', createdAt: '2026-09-01T10:00:00Z', type: 'cours', niveau: '4eme', matiere: 'francais',
    sujet: 'La poésie', excerpt: '', isFavorite: false, ...patch,
  } as GenerationSummary;
}

describe('recherche dans l’historique', () => {
  it('insensible aux accents et à la casse', () => {
    expect(matchesSearch(item({}), 'francais POESIE')).toBe(true);
    expect(matchesSearch(item({ niveau: '6eme' }), '6ème')).toBe(true);
  });

  it('supérieur : le libellé affiché (« Examen », « TD ») est trouvé, en plus du libellé générique', () => {
    const exam = item({ type: 'evaluation', niveau: 'master_1', matiere: 'economie', sujet: 'Macroéconomie' });
    expect(matchesSearch(exam, 'examen')).toBe(true);
    expect(matchesSearch(exam, 'evaluation')).toBe(true);
    const td = item({ type: 'exercices', niveau: 'licence_2', matiere: 'mathematiques', sujet: 'Intégrales' });
    expect(matchesSearch(td, 'td')).toBe(true);
    expect(matchesSearch(td, 'examen')).toBe(false);
  });
});
