import { describe, expect, it } from 'vitest';
import { ALL_MATIERES, getMatieresForNiveau } from '../../shared/catalog';
import { getSujetSuggestions } from '../../shared/suggestions';
import { modalitesFor } from '../../shared/formats';
import { ALL_NIVEAUX } from '../../shared/levels';

describe('suggestions de sujets', () => {
  it('adaptées à la classe exacte, pas seulement au cycle', () => {
    expect(getSujetSuggestions('mathematiques', '6eme')).not.toContain('Le théorème de Pythagore');
    expect(getSujetSuggestions('mathematiques', '6eme')).not.toContain('Les fonctions affines');
    expect(getSujetSuggestions('mathematiques', '4eme')).toContain('Le théorème de Pythagore');
    expect(getSujetSuggestions('mathematiques', '3eme')).toContain('Les fonctions affines');
    expect(getSujetSuggestions('mathematiques', 'cp')).not.toContain('Les nombres décimaux');
    expect(getSujetSuggestions('histoire_geo', 'cm2')).not.toContain('Les Gaulois');
    expect(getSujetSuggestions('philosophie', 'terminale_gen')).toContain('La liberté');
    expect(getSujetSuggestions('philosophie', '2nde_gt')).not.toContain('La liberté');
    expect(getSujetSuggestions('francais', 'terminale_gen')).not.toContain('La poésie du XIXe siècle');
  });

  it('chaque classe courante a au moins une suggestion dans sa matière principale', () => {
    for (const niveau of ['cp', 'ce1', 'cm1', '6eme', '5eme', '4eme', '3eme', '2nde_gt', '1ere_gen'] as const) {
      expect(getSujetSuggestions('mathematiques', niveau).length, niveau).toBeGreaterThan(0);
    }
  });

  it('aucune suggestion vide ou dupliquée, pour toutes les classes et matières', () => {
    for (const niveau of ALL_NIVEAUX) {
      for (const m of ALL_MATIERES) {
        const list = getSujetSuggestions(m.value, niveau);
        expect(list.every(s => s.trim().length > 0)).toBe(true);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });
});

describe('lycée professionnel : Physique-Chimie (maths-sciences)', () => {
  const PRO = ['cap_1', 'cap_2', '2nde_pro', '1ere_pro', 'terminale_pro'] as const;

  it('proposée à tous les niveaux de la voie professionnelle, avec les formats scientifiques et sans épreuve de bac général', () => {
    for (const niveau of PRO) {
      expect(getMatieresForNiveau(niveau).map(m => m.value), niveau).toContain('physique_chimie');
      expect(getSujetSuggestions('physique_chimie', niveau).length, niveau).toBeGreaterThanOrEqual(8);
    }
    const formats = modalitesFor('evaluation', 'terminale_pro', 'physique_chimie').map(m => m.value);
    expect(formats).toContain('demarche_experimentale');
    expect(formats).not.toContain('sujet_bac');
    expect(formats).not.toContain('sujet_bac_pro');
  });

  it('le libellé et le collège / lycée général ne changent pas', () => {
    expect(getMatieresForNiveau('terminale_pro').find(m => m.value === 'physique_chimie')?.label).toBe('Physique-Chimie');
    expect(getMatieresForNiveau('3eme').map(m => m.value)).toContain('physique_chimie');
    expect(getMatieresForNiveau('terminale_gen').map(m => m.value)).toContain('physique_chimie');
  });
});

describe('anciens libellés stockés (première version de Magistra)', () => {
  it('reconnus comme les clés actuelles : libellé, emoji et regroupement', async () => {
    const { getMatiereLabel, getMatiereEmoji, resolveMatiere } = await import('../../shared/catalog');
    const { getNiveauLabel, resolveNiveau } = await import('../../shared/levels');
    expect(resolveMatiere("Sciences de l'ingénieur (SI)")).toBe('sciences_ingenieur');
    expect(resolveMatiere('Sciences de l’ingénieur (SI)')).toBe('sciences_ingenieur');
    expect(resolveMatiere('Arts Plastiques')).toBe('arts_plastiques');
    expect(resolveMatiere('Management / STMG')).toBe('management');
    expect(resolveMatiere('Gestion-Finance / Compta')).toBe('gestion');
    expect(resolveMatiere('Mathématiques')).toBe('mathematiques');
    expect(getMatiereLabel('Management / STMG')).toBe('Management');
    expect(getMatiereEmoji('Arts Plastiques')).not.toBe('📝');
    expect(resolveMatiere('Matière inconnue')).toBeUndefined();
    expect(getMatiereLabel('Matière inconnue')).toBe('Matière inconnue');
    expect(resolveNiveau('BUT (ex-DUT)')).toBe('but');
    expect(getNiveauLabel('BUT (ex-DUT)')).toBe('BUT');
    expect(resolveNiveau('6ème')).toBe('6eme');
  });

  it('statistiques : ancien libellé et clé actuelle comptent ensemble', async () => {
    const { topMatiereOf } = await import('../../server/store');
    expect(topMatiereOf({ 'Mathématiques': 3, mathematiques: 2, francais: 4 })).toEqual({ matiere: 'mathematiques', count: 5 });
    expect(topMatiereOf({ 'Management / STMG': 2, management: 1, droit: 2 })).toEqual({ matiere: 'management', count: 3 });
    expect(topMatiereOf({})).toBeUndefined();
    const { computeStats } = await import('../../src/lib/runtime/history');
    const at = '2026-01-01T10:00:00Z';
    const stats = computeStats([
      { createdAt: at, isFavorite: false, matiere: 'Mathématiques' },
      { createdAt: at, isFavorite: false, matiere: 'mathematiques' },
      { createdAt: at, isFavorite: false, matiere: 'francais' },
    ]);
    expect(stats.topMatiere).toEqual({ matiere: 'mathematiques', count: 2 });
  });
});
