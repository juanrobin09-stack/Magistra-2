// Notation par défaut annoncée dans le formulaire (« Par défaut : … ») : elle dit ce que Magistra demandera
// réellement, selon l'outil, le niveau, le format et l'objectif. Les tests de cohérence construisent la vraie
// consigne (buildSystemPrompt) pour que le rappel ne puisse pas s'en écarter sans qu'un test échoue.

import { describe, expect, it } from 'vitest';
import { getMatieresForNiveau, type Matiere, type TypeContenu } from '@shared/catalog';
import { getModalite, modalitePrompt, modalitesFor } from '@shared/formats';
import { NIVEAUX, type NiveauScolaire } from '@shared/levels';
import { buildSystemPrompt } from '@shared/prompts/index';
import type { GenerationRequest } from '@shared/types';
import { createInitialForm, defaultNotation, FORMATS_BAREME_OFFICIEL, formDefaultNotation } from '@/lib/generation/request';

function req(type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere, extra: Partial<GenerationRequest> = {}): GenerationRequest {
  return { type, niveau, matiere, sujet: 'Un sujet', researchMode: 'internet', ...extra };
}

const prompt = (r: GenerationRequest) => buildSystemPrompt(r, false);
const hint = (r: GenerationRequest) => defaultNotation(r).hint;
const ALL_NIVEAUX = Object.values(NIVEAUX).flatMap(g => g.niveaux.map(n => n.value)).filter(n => !n.startsWith('maternelle'));

describe('defaultNotation — exercices : jamais de note sur 20 par défaut', () => {
  it('collège et lycée avec corrigé : barème indicatif dans le corrigé', () => {
    expect(defaultNotation(req('exercices', '4eme', 'mathematiques'))).toEqual({
      label: 'Selon le niveau', title: 'Barème indicatif', hint: 'Par défaut : barème indicatif dans le corrigé.',
    });
    expect(hint(req('exercices', 'terminale_gen', 'philosophie', { modalite: 'dissertation' }))).toBe('Par défaut : barème indicatif dans le corrigé.');
  });

  it('supérieur, version élève seule ou texte à trous : aucun barème imposé', () => {
    expect(hint(req('exercices', 'licence_1', 'droit'))).toBe('Par défaut : sans barème imposé.');
    expect(hint(req('exercices', '4eme', 'mathematiques', { sansCorrige: true }))).toBe('Par défaut : sans barème imposé.');
    expect(hint(req('exercices', '4eme', 'francais', { modalite: 'texte_trous' }))).toBe('Par défaut : sans barème imposé.');
  });

  it('école primaire : sans note, critères de réussite', () => {
    expect(hint(req('exercices', 'cm1', 'mathematiques'))).toBe('Par défaut : sans note (critères de réussite dans le corrigé).');
    expect(hint(req('exercices', 'cm1', 'mathematiques', { sansCorrige: true }))).toBe('Par défaut : sans barème imposé.');
  });

  it('à aucun niveau, avec ou sans corrigé, le rappel n’annonce une note sur 20', () => {
    for (const niveau of ALL_NIVEAUX) {
      const matiere = getMatieresForNiveau(niveau)[0].value;
      for (const sansCorrige of [false, true]) {
        expect(hint(req('exercices', niveau, matiere, { sansCorrige })), `${niveau} ${sansCorrige}`).not.toMatch(/sur 20/);
      }
    }
  });
});

describe('defaultNotation — évaluation', () => {
  it('sans format : sur 20, ou sans note pour un diagnostic ; positionnement à l’école primaire', () => {
    expect(hint(req('evaluation', '4eme', 'mathematiques'))).toBe('Par défaut : note sur 20.');
    expect(defaultNotation(req('evaluation', '4eme', 'mathematiques', { typeEvaluation: 'diagnostique' }))).toEqual({
      label: 'Selon l’objectif', title: 'Sans note', hint: 'Par défaut : sans note (évaluation diagnostique).',
    });
    expect(hint(req('evaluation', 'master_1', 'informatique', { typeEvaluation: 'diagnostique' }))).toBe('Par défaut : sans note (évaluation diagnostique).');
    expect(hint(req('evaluation', 'cm2', 'mathematiques'))).toBe('Par défaut : positionnement sans note.');
    expect(hint(req('evaluation', 'cm2', 'mathematiques', { typeEvaluation: 'diagnostique' }))).toBe('Par défaut : positionnement sans note.');
  });

  it('sujet type brevet d’histoire-géographie : barème officiel (HG sur 40, EMC sur 20), qui prime sur l’objectif', () => {
    const brevet = req('evaluation', '3eme', 'histoire_geo', { modalite: 'sujet_brevet' });
    expect(defaultNotation(brevet)).toEqual({
      label: 'Selon l’épreuve',
      title: 'Barème officiel de l’épreuve',
      hint: 'Par défaut : barème officiel de l’épreuve (histoire-géographie sur 40, EMC sur 20).',
    });
    expect(hint({ ...brevet, typeEvaluation: 'diagnostique' })).toBe(
      'Par défaut : barème officiel de l’épreuve (histoire-géographie sur 40, EMC sur 20). Le format de l’épreuve prime sur l’objectif diagnostique.',
    );
  });

  it('autres sujets type examen : note sur 20 sur le modèle de l’épreuve, jamais « sans note » annoncé pour un diagnostic', () => {
    for (const r of [
      req('evaluation', 'terminale_gen', 'philosophie', { modalite: 'sujet_bac' }),
      req('evaluation', '1ere_gen', 'mathematiques', { modalite: 'sujet_bac' }),
      req('evaluation', 'terminale_pro', 'francais', { modalite: 'sujet_bac_pro' }),
      req('evaluation', '3eme', 'francais', { modalite: 'sujet_brevet' }),
    ]) {
      expect(hint(r)).toBe('Par défaut : note sur 20, sur le modèle de l’épreuve.');
      expect(hint({ ...r, typeEvaluation: 'diagnostique' })).not.toMatch(/sans note/);
    }
  });

  it('autres formats (interrogation, partiel) : l’objectif diagnostique garde « sans note »', () => {
    expect(hint(req('evaluation', '4eme', 'mathematiques', { modalite: 'interro', typeEvaluation: 'diagnostique' }))).toBe('Par défaut : sans note (évaluation diagnostique).');
    expect(hint(req('evaluation', 'licence_2', 'droit', { modalite: 'partiel' }))).toBe('Par défaut : note sur 20.');
  });

  it('les formats au barème officiel existent et sont des formats d’évaluation', () => {
    for (const value of FORMATS_BAREME_OFFICIEL) expect(getModalite(value)?.tools).toContain('evaluation');
  });
});

describe('defaultNotation — correction d’une copie', () => {
  it('note indicative sur 20, positionnement sans note à l’école primaire', () => {
    expect(hint(req('corrige', '4eme', 'francais'))).toBe('Par défaut : note indicative sur 20.');
    expect(hint(req('corrige', 'ce2', 'francais'))).toBe('Par défaut : positionnement sans note.');
  });
});

describe('formDefaultNotation — seuls les champs transmis comptent', () => {
  it('objectif gardé d’un autre outil, format sans objet à ce niveau : ignorés', () => {
    const base = createInitialForm(null, { type: 'exercices' });
    expect(formDefaultNotation({ ...base, niveau: '4eme', matiere: 'mathematiques', typeEvaluation: 'diagnostique' }).hint)
      .toBe('Par défaut : barème indicatif dans le corrigé.');
    const evaluation = { ...base, type: 'evaluation' as const, niveau: '4eme' as const, matiere: 'histoire_geo' as const, modalite: 'sujet_brevet' };
    expect(formDefaultNotation(evaluation).hint).toBe('Par défaut : note sur 20.');
    expect(formDefaultNotation({ ...evaluation, niveau: '3eme' }).hint).toBe('Par défaut : barème officiel de l’épreuve (histoire-géographie sur 40, EMC sur 20).');
  });
});

describe('cohérence avec la consigne envoyée au modèle (sans notation choisie)', () => {
  it('exercices : le rappel suit exactement ce que la consigne demande (barème indicatif, critères, rien)', () => {
    const cases: [NiveauScolaire, Matiere, string | undefined][] = [
      ['cm1', 'mathematiques', undefined], ['4eme', 'mathematiques', undefined], ['4eme', 'francais', 'texte_trous'],
      ['2nde_gt', 'francais', 'qcm'], ['licence_1', 'droit', undefined], ['master_1', 'informatique', 'qcm'],
    ];
    for (const [niveau, matiere, modalite] of cases) {
      for (const sansCorrige of [false, true]) {
        const r = req('exercices', niveau, matiere, { modalite, ...(sansCorrige ? { sansCorrige } : {}) });
        const text = prompt(r);
        const label = `${niveau} ${modalite ?? ''} ${sansCorrige}`;
        // Jamais de note sur 20 demandée par défaut pour des exercices.
        expect(text.replaceAll('pas de note sur 20', ''), label).not.toMatch(/sur 20|exactement 20/);
        const h = hint(r);
        expect(text.includes('barème indicatif'), label).toBe(h.includes('barème indicatif'));
        if (h.includes('critères de réussite')) expect(text, label).toContain('critères de réussite ; pas de note sur 20');
      }
    }
  });

  it('évaluation sans format : « note sur 20 » ou « sans note », comme la consigne', () => {
    for (const [niveau, matiere] of [['4eme', 'mathematiques'], ['terminale_gen', 'ses'], ['licence_2', 'droit']] as [NiveauScolaire, Matiere][]) {
      const sommative = req('evaluation', niveau, matiere);
      expect(hint(sommative)).toBe('Par défaut : note sur 20.');
      expect(prompt(sommative)).toMatch(/note sur 20|total sur 20/);
      const diagnostic = req('evaluation', niveau, matiere, { typeEvaluation: 'diagnostique' });
      expect(hint(diagnostic)).toContain('sans note');
      expect(prompt(diagnostic)).toMatch(/sans (?:points|barème) ni note/);
    }
    const primaire = req('evaluation', 'cm2', 'mathematiques');
    expect(hint(primaire)).toContain('positionnement sans note');
    expect(prompt(primaire)).toContain('Pas de note sur 20.');
  });

  it('correction d’une copie : la note annoncée est celle de la consigne', () => {
    expect(prompt(req('corrige', '4eme', 'francais', { texteEleve: 'Copie' }))).toContain('Note indicative sur 20');
    expect(prompt(req('corrige', 'ce2', 'francais', { texteEleve: 'Copie' }))).toContain('sans note sur 20');
  });

  it('sujets type examen : chaque total officiel de la consigne du format (« notée sur N points ») est annoncé', () => {
    let checked = 0;
    for (const niveau of ALL_NIVEAUX) {
      for (const { value: matiere } of getMatieresForNiveau(niveau)) {
        for (const format of modalitesFor('evaluation', niveau, matiere)) {
          if (!FORMATS_BAREME_OFFICIEL.includes(format.value)) continue;
          checked++;
          const text = modalitePrompt(format.value, { niveau, matiere });
          const totals = [...text.matchAll(/notée? sur (\d+) points/g)].map(m => Number(m[1]));
          const h = hint(req('evaluation', niveau, matiere, { modalite: format.value }));
          const label = `${format.value} ${niveau} ${matiere}`;
          if (totals.some(n => n !== 20)) {
            for (const n of totals) expect(h, label).toContain(`sur ${n}`);
          } else {
            expect(h, label).toBe('Par défaut : note sur 20, sur le modèle de l’épreuve.');
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
