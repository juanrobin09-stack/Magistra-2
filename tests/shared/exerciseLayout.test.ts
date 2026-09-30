import { describe, expect, it } from 'vitest';
import { normalizeExerciseLayout } from '../../shared/exerciseLayout';

const QCM = '**Question 1.** Combien font 3 × 4 ?\nA) 7\nB) 12\nC) 34\nD) 1\n**Question 2.** Combien font 2 × 5 ?\nA) 10\nB) 7\nC) 25\nD) 3';

describe('normalizeExerciseLayout — QCM, vrai/faux, questions numérotées', () => {
  it('choix « A) … » un par ligne → liste à puces ; question suivante séparée par une ligne vide', () => {
    expect(normalizeExerciseLayout(QCM)).toBe(
      '**Question 1.** Combien font 3 × 4 ?\n- A) 7\n- B) 12\n- C) 34\n- D) 1\n\n**Question 2.** Combien font 2 × 5 ?\n- A) 10\n- B) 7\n- C) 25\n- D) 3',
    );
  });

  it('choix « a. », « (b) » et minuscules reconnus ; un choix isolé n’est pas une liste', () => {
    expect(normalizeExerciseLayout('Consigne :\na. Calcule.\n(b) Explique.')).toBe('Consigne :\n- a. Calcule.\n- (b) Explique.');
    expect(normalizeExerciseLayout('Texte\nA) seul choix\nSuite')).toBe('Texte\nA) seul choix\nSuite');
  });

  it('choix sous une question en liste numérotée : rangés dans son élément', () => {
    expect(normalizeExerciseLayout('1. Combien font 3 × 4 ?\nA) 7\nB) 12\n2. Combien font 2 × 5 ?\nA) 10\nB) 7'))
      .toBe('1. Combien font 3 × 4 ?\n   - A) 7\n   - B) 12\n2. Combien font 2 × 5 ?\n   - A) 10\n   - B) 7');
  });

  it('texte collé au dernier choix (« Réponse : … ») : séparé, sinon il serait dans la puce', () => {
    expect(normalizeExerciseLayout('- A) 7\n- B) 12\nRéponse : B')).toBe('- A) 7\n- B) 12\n\nRéponse : B');
  });

  it('affirmations « **1.** … ☐ Vrai ☐ Faux » et lignes de corrigé « Question 1 : B » : un paragraphe chacune', () => {
    expect(normalizeExerciseLayout('**1.** Le Soleil est une étoile. ☐ Vrai ☐ Faux\n**2.** La Lune émet sa lumière. ☐ Vrai ☐ Faux'))
      .toBe('**1.** Le Soleil est une étoile. ☐ Vrai ☐ Faux\n\n**2.** La Lune émet sa lumière. ☐ Vrai ☐ Faux');
    expect(normalizeExerciseLayout('### Corrigé\nQuestion 1 : B — 3 × 4 = 12\nQuestion 2 : A — 2 × 5 = 10'))
      .toBe('### Corrigé\nQuestion 1 : B — 3 × 4 = 12\n\nQuestion 2 : A — 2 × 5 = 10');
  });

  it('déjà bien formé : inchangé (puces, lignes vides, titres, retours à la ligne forcés)', () => {
    const ok = '### Question 1\nCombien font 3 × 4 ?\n\n- A) 7\n- B) 12\n\n**Question 2.** Suite\n\n1. premier\n2. second';
    expect(normalizeExerciseLayout(ok)).toBe(ok);
    const breaks = '**1.** Première affirmation.  \n**2.** Seconde affirmation.';
    expect(normalizeExerciseLayout(breaks)).toBe(breaks);
  });

  it('jamais dans un bloc de code, une formule $$ ou un tableau', () => {
    const code = '```\nA) 7\nB) 12\n**2.** x\n```';
    expect(normalizeExerciseLayout(code)).toBe(code);
    const math = '$$\na) x = 1\nb) y = 2\n$$';
    expect(normalizeExerciseLayout(math)).toBe(math);
    const table = '| Choix | Réponse |\n| --- | --- |\n| A) 7 | faux |\n| B) 12 | vrai |';
    expect(normalizeExerciseLayout(table)).toBe(table);
  });

  it('idempotent', () => {
    const samples = [
      QCM,
      '1. Combien font 3 × 4 ?\nA) 7\nB) 12\n2. Suivante\nA) 1\nB) 2\nRéponse : A',
      '**1.** Vrai ou faux ? ☐ Vrai ☐ Faux\n**2.** Autre ☐ Vrai ☐ Faux\nQuestion 3 : x',
    ];
    for (const sample of samples) {
      const once = normalizeExerciseLayout(sample);
      expect(normalizeExerciseLayout(once)).toBe(once);
    }
  });

  it('texte d’une seule ligne ou vide : rendu tel quel', () => {
    expect(normalizeExerciseLayout('A) 7')).toBe('A) 7');
    expect(normalizeExerciseLayout('')).toBe('');
  });
});
