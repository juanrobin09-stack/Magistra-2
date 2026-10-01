import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { buildClozeDocument } from '../../shared/cloze';
import { defaultMessage, MagistraError } from '../../shared/errors';
import { normalizeExerciseLayout } from '../../shared/exerciseLayout';
import { checkCopyQuotes, checkOutputStructure } from '../../shared/outputChecks';
import { runGeneration } from '../../shared/pipeline';
import type { DocumentPassage, GenerationEvent, GenerationRequest } from '../../shared/types';
import { publicEvent } from '../../electron/connector/status.js';
import { collect } from './helpers';

function req(partial: Partial<GenerationRequest>): GenerationRequest {
  return { type: 'exercices', niveau: '4eme', matiere: 'mathematiques', sujet: 'Calcul', researchMode: 'documents', ...partial };
}

/** « **Question 1.** … » à « **Question n.** … », avec leurs 4 choix. */
function questions(n: number, start = 1): string {
  return Array.from({ length: n }, (_, i) => `**Question ${start + i}.** Combien font ${i} × 2 ?\n- A) 1\n- B) 2\n- C) 3\n- D) 4`).join('\n\n');
}

function exercises(n: number): string {
  return Array.from({ length: n }, (_, i) => `### Exercice ${i + 1}\n\nCalcule ${i} + 1.`).join('\n\n');
}

/** Borne absolue très large des tests de temps (machine chargée, CI lente) : un balayage quadratique la dépasse de loin. */
const BOUND_MS = 3000;

/** Plus courte durée (ms) de `runs` exécutions : un pic de charge de la machine ne fausse pas la mesure. */
function fastest(run: () => void, runs = 3): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * Temps linéaire : avec 4 fois plus de données, le temps est multiplié par 4 (par 16 pour un balayage quadratique) ; il
 * ne doit pas dépasser 8 fois celui de la taille de base (plancher de 50 ms : en dessous, la mesure ne dit rien), ni
 * BOUND_MS. Les textes sont construits hors mesure.
 */
function expectLinear(build: (n: number) => string, run: (input: string) => void, n: number): void {
  const small = build(n);
  const large = build(4 * n);
  const base = fastest(() => run(small));
  const scaled = fastest(() => run(large));
  expect(scaled).toBeLessThan(8 * Math.max(base, 50));
  expect(scaled).toBeLessThan(BOUND_MS);
}

describe('checkOutputStructure — exercices, questions, affirmations', () => {
  it('7 questions sur 10 demandées : avertissement clair', () => {
    const doc = `${questions(7)}\n\n## Corrigé\n\n${Array.from({ length: 10 }, (_, i) => `- Question ${i + 1} : B`).join('\n')}`;
    expect(checkOutputStructure(req({ modalite: 'questions_cours', nombreExercices: 10 }), doc)).toEqual([
      'Le document contient 7 questions au lieu des 10 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
  });

  it('nombre exact : aucun avertissement ; « Exercice 1 » répété dans le corrigé non compté deux fois', () => {
    expect(checkOutputStructure(req({ modalite: 'qcm', nombreExercices: 5 }), `${questions(5)}\n\n**Corrigé**\n\nQuestion 1 : B`)).toEqual([]);
    const doc = `${exercises(5)}\n\n## Corrigé\n\n${exercises(5)}`;
    expect(checkOutputStructure(req({ nombreExercices: 5 }), doc)).toEqual([]);
  });

  it('corrigé qui annonce plus d’exercices que le sujet : seul le sujet est compté', () => {
    const doc = `${exercises(3)}\n\n## Corrigé\n\n${exercises(5)}`;
    expect(checkOutputStructure(req({ nombreExercices: 5 }), doc)).toEqual([
      'Le document contient 3 exercices au lieu des 5 demandés : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
  });

  it('corrigé intercalé après chaque exercice : le compte continue', () => {
    const doc = Array.from({ length: 4 }, (_, i) => `### Exercice ${i + 1}\n\nÉnoncé.\n\n#### Corrigé\n\nRéponse.`).join('\n\n');
    expect(checkOutputStructure(req({ nombreExercices: 4 }), doc)).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 6 }), doc)).toEqual([
      'Le document contient 4 exercices au lieu des 6 demandés : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
  });

  it('au moindre doute, aucun avertissement', () => {
    // Mise en page sans numérotation reconnaissable.
    expect(checkOutputStructure(req({ nombreExercices: 5 }), '1. Calcule 3 + 4.\n2. Calcule 5 × 6.')).toEqual([]);
    // Exercices différenciés (numérotés par niveau).
    expect(checkOutputStructure(req({ nombreExercices: 6, difficulte: 'differencie' }), exercises(3))).toEqual([]);
    // Questions regroupées dans des exercices (numérotation qui recommence).
    const nested = `### Exercice 1\n\n${questions(3)}\n\n### Exercice 2\n\n${questions(3)}`;
    expect(checkOutputStructure(req({ modalite: 'questions_cours', nombreExercices: 10 }), nested)).toEqual([]);
    // Numérotation recommencée par partie, sans corrigé annoncé.
    expect(checkOutputStructure(req({ modalite: 'qcm', nombreExercices: 10 }), `## Partie A\n\n${questions(3)}\n\n## Partie B\n\n${questions(3)}`)).toEqual([]);
    // Travail d'un seul tenant, ateliers : rien à compter.
    expect(checkOutputStructure(req({ modalite: 'dictee', nombreExercices: 5 }), exercises(1))).toEqual([]);
  });

  it('« Exercice 10 » compte pour 10 (et non 1), « Exercices 1 à 3 » pour trois', () => {
    const doc = Array.from({ length: 10 }, (_, i) => `**Exercice ${i + 1}** — calcul`).join('\n\n');
    expect(checkOutputStructure(req({ nombreExercices: 10 }), doc)).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 5 }), '## Exercices 1 à 3 : calcul\n\nÉnoncés.\n\n## Exercice 4\n\n## Exercice 5')).toEqual([]);
  });

  it('vrai/faux : 5 affirmations sur 8 (cases « ☐ Vrai »), consigne et corrigé non comptés', () => {
    const items = Array.from({ length: 5 }, (_, i) => `**${i + 1}.** Affirmation ${i + 1}. ☐ Vrai ☐ Faux — Justification : …`).join('\n\n');
    const doc = `Coche ☐ Vrai ou ☐ Faux, puis justifie.\n\n${items}\n\n## Corrigé\n\n1. ☐ Vrai ☒ Faux`;
    expect(checkOutputStructure(req({ modalite: 'vrai_faux', nombreExercices: 8 }), doc)).toEqual([
      'Le document contient 5 affirmations au lieu des 8 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(req({ modalite: 'vrai_faux', nombreExercices: 5 }), doc)).toEqual([]);
    // Cases à cocher sous chaque affirmation, consigne « Réponds par ☐ Vrai ou ☐ Faux » non comptée.
    const below = Array.from({ length: 6 }, (_, i) => `**${i + 1}.** Affirmation ${i + 1}.\n☐ Vrai ☐ Faux`).join('\n\n');
    expect(checkOutputStructure(req({ modalite: 'vrai_faux', nombreExercices: 8 }), `Réponds par ☐ Vrai ou ☐ Faux.\n\n${below}`)).toEqual([
      'Le document contient 6 affirmations au lieu des 8 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    // Tableau : une ligne par affirmation.
    const table = `| N° | Affirmation | Réponse |\n| --- | --- | --- |\n${Array.from({ length: 8 }, (_, i) => `| ${i + 1} | Affirmation ${i + 1} | ☐ Vrai ☐ Faux |`).join('\n')}`;
    expect(checkOutputStructure(req({ modalite: 'vrai_faux', nombreExercices: 8 }), table)).toEqual([]);
  });
});

describe('checkOutputStructure — séquence, appréciations, texte à trous', () => {
  const sequence = (n: number) => `| Séance | Titre |\n| --- | --- |\n| 1 | Découverte |\n\n${Array.from({ length: n }, (_, i) => `### Séance ${i + 1} : étape`).join('\n\n')}`;

  it('4 séances détaillées sur 6 demandées', () => {
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 6 }), sequence(4))).toEqual([
      'La séquence compte 4 séances au lieu des 6 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 4 }), sequence(4))).toEqual([]);
  });

  it('« Séance 10 » compte pour 10, « Séances 3 et 4 » pour deux', () => {
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 10 }), sequence(10))).toEqual([]);
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 4 }), '### Séance 1\n\n### Séance 2\n\n### Séances 3 et 4 : projet')).toEqual([]);
  });

  it('8 appréciations numérotées sur 10 (défaut) ; « commentaires » dans le supérieur ; numérotation « 1. » répétée', () => {
    const text = (i: number) => `Élève sérieux et investi, qui participe volontiers à l’oral (${i}). Il doit maintenant soigner ses écrits.`;
    const list = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. ${text(i)}`).join('\n');
    expect(checkOutputStructure(req({ type: 'appreciations' }), list(8))).toEqual([
      'Le document contient 8 appréciations au lieu des 10 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(req({ type: 'appreciations', nombreAppreciations: 8 }), list(8))).toEqual([]);
    expect(checkOutputStructure(req({ type: 'appreciations', niveau: 'licence_1', nombreAppreciations: 5 }), list(3))).toEqual([
      'Le document contient 3 commentaires au lieu des 5 demandés : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    // Intitulé seul (« ### Appréciation 1 »), texte à la ligne suivante.
    const labelled = (n: number) => Array.from({ length: n }, (_, i) => `### Appréciation ${i + 1}\n\n${text(i)}`).join('\n\n');
    expect(checkOutputStructure(req({ type: 'appreciations' }), labelled(10))).toEqual([]);
    expect(checkOutputStructure(req({ type: 'appreciations' }), labelled(9))).toHaveLength(1);
    // Tous numérotés « 1. » (numérotation laissée au Markdown) : les textes sont comptés.
    const lazy = (n: number) => Array.from({ length: n }, (_, i) => `1. ${text(i)}`).join('\n');
    expect(checkOutputStructure(req({ type: 'appreciations' }), lazy(10))).toEqual([]);
    expect(checkOutputStructure(req({ type: 'appreciations' }), lazy(7))).toHaveLength(1);
  });

  it('appréciations : une liste de conseils n’est jamais comptée comme des appréciations', () => {
    const text = (i: number) => `Élève discret mais appliqué, dont les résultats progressent ce trimestre (${i}). Il gagnerait à participer davantage.`;
    const unnumbered = Array.from({ length: 10 }, (_, i) => text(i)).join('\n\n');
    const tips = '## Conseils de personnalisation\n\n1. Ajoutez un exemple précis tiré du travail de l’élève pour chaque appréciation.\n2. Adaptez le conseil final au profil et aux résultats réels de l’élève concerné.';
    const numbered = Array.from({ length: 10 }, (_, i) => `**${i + 1}.** ${text(i)}`).join('\n\n');
    expect(checkOutputStructure(req({ type: 'appreciations' }), `${numbered}\n\n${tips}`)).toEqual([]);
    // Appréciations non numérotées suivies d'une liste numérotée (conseils, exemples courts) : aucun avertissement.
    expect(checkOutputStructure(req({ type: 'appreciations' }), `${unnumbered}\n\n1. Ajoutez un exemple précis tiré du travail de l’élève pour chaque texte.\n2. Adaptez le conseil final au profil réel de l’élève.`)).toEqual([]);
    expect(checkOutputStructure(req({ type: 'appreciations' }), `${unnumbered}\n\n1. Exemple.\n2. Conseil.`)).toEqual([]);
    // Une seule appréciation demandée, ou texte non numéroté : rien à compter.
    expect(checkOutputStructure(req({ type: 'appreciations', nombreAppreciations: 1 }), numbered)).toEqual([]);
    expect(checkOutputStructure(req({ type: 'appreciations' }), unnumbered)).toEqual([]);
  });

  it('texte à trous : 6 blancs sur 12 demandés (compte des blancs du document final)', () => {
    const cloze = req({ matiere: 'francais', modalite: 'texte_trous', nombreExercices: 12 });
    const doc = buildClozeDocument('Le [[chat]] [[dort]] sur le [[tapis]]. Le [[chien]] [[aboie]] dans la [[cour]].', { max: 12, withKey: true });
    expect(checkOutputStructure(cloze, doc)).toEqual([
      'Le texte à trous compte 6 mots à compléter au lieu des 12 demandés : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure({ ...cloze, nombreExercices: 6 }, doc)).toEqual([]);
    expect(checkOutputStructure(cloze, 'Un texte sans aucun mot marqué.')).toEqual([
      'Le texte à trous ne contient aucun mot à compléter : relancez la génération.',
    ]);
    // Blancs posés par le modèle lui-même : non comptables, aucun avertissement.
    expect(checkOutputStructure(cloze, 'Le chat _____ sur le tapis.')).toEqual([]);
    // Blancs posés dans une formule (soulignés échappés pour KaTeX) : comptés comme les autres.
    const maths = buildClozeDocument('Si $x = [[3]]$ alors $2x = [[6]]$.', { max: 2, withKey: true });
    expect(maths).toContain('(1) \\_\\_\\_\\_\\_\\_\\_\\_');
    expect(checkOutputStructure({ ...cloze, matiere: 'mathematiques', nombreExercices: 2 }, maths)).toEqual([]);
  });

  it('autres outils ou document vide : aucun contrôle', () => {
    expect(checkOutputStructure(req({ type: 'cours' }), exercises(2))).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 5 }), '')).toEqual([]);
  });

  it('messages transmis tels quels par le connecteur local (aucun motif filtré)', () => {
    const messages = [
      ...checkOutputStructure(req({ modalite: 'qcm', nombreExercices: 10 }), questions(7)),
      ...checkOutputStructure(req({ type: 'sequence', nombreSeances: 6 }), sequence(4)),
      defaultMessage('CONTENT_CHECK'),
    ];
    expect(messages).toHaveLength(3);
    for (const message of messages) {
      const event: GenerationEvent = { type: 'warning', code: 'CONTENT_CHECK', message };
      expect(publicEvent(event)).toEqual(event);
    }
  });
});

describe('checkOutputStructure — corrigé intercalé, numéros incertains (jamais de faux avertissement)', () => {
  const vf = (n: number) => req({ modalite: 'vrai_faux', nombreExercices: n });
  const statement = (i: number) => `**${i}.** Le nombre ${i} est pair. ☐ Vrai ☐ Faux`;
  const shortfall = (found: number, unit: string, wanted: number, e = 'e') =>
    `Le document contient ${found} ${unit} au lieu des ${wanted} demandé${e}s : vérifiez-le avant de l’utiliser, ou relancez la génération.`;

  it('corrigé après chaque élément, qui rappelle son numéro : tous les éléments comptés', () => {
    // QCM : « **Corrigé :** » puis « - Question i : B — … » (forme de corrigé demandée par le prompt).
    const qcm = Array.from({ length: 10 }, (_, i) => `**Question ${i + 1}.** Combien font ${i} × 2 ?\nA) 1\nB) 2\nC) 3\nD) 4\n\n**Corrigé :**\n- Question ${i + 1} : B — explication`).join('\n\n');
    expect(checkOutputStructure(req({ modalite: 'qcm', nombreExercices: 10 }), normalizeExerciseLayout(qcm))).toEqual([]);
    const exos = Array.from({ length: 5 }, (_, i) => `### Exercice ${i + 1}\n\nCalcule ${i} + 1.\n\n**Corrigé**\n\nExercice ${i + 1} : ${i + 1}.`).join('\n\n');
    expect(checkOutputStructure(req({ nombreExercices: 5 }), normalizeExerciseLayout(exos))).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 7 }), normalizeExerciseLayout(exos))).toEqual([shortfall(5, 'exercices', 7, '')]);
    // Vrai/faux : « **Corrigé** » puis « Vrai, car… », ou rappel de l'affirmation avec ses cases.
    const tf = Array.from({ length: 8 }, (_, i) => `${statement(i + 1)}\n\n**Corrigé**\n\nVrai, car ${i + 1} est pair.`).join('\n\n');
    expect(checkOutputStructure(vf(8), normalizeExerciseLayout(tf))).toEqual([]);
    const tfBoxes = Array.from({ length: 8 }, (_, i) => `${statement(i + 1)}\n\n**Corrigé**\n\n${i + 1}. ☐ Vrai ☒ Faux`).join('\n\n');
    expect(checkOutputStructure(vf(8), normalizeExerciseLayout(tfBoxes))).toEqual([]);
    // Corrigé final : le compte s'arrête toujours à sa numérotation, qui reprend en arrière.
    const final = `${questions(7)}\n\n## Corrigé\n\n${Array.from({ length: 7 }, (_, i) => `- Question ${i + 1} : B`).join('\n')}`;
    expect(checkOutputStructure(req({ modalite: 'qcm', nombreExercices: 10 }), final)).toEqual([shortfall(7, 'questions', 10)]);
    const finalTf = `${Array.from({ length: 5 }, (_, i) => statement(i + 1)).join('\n\n')}\n\n## Corrigé\n\n${Array.from({ length: 5 }, (_, i) => `${i + 1}. ☐ Vrai ☒ Faux`).join('\n')}`;
    expect(checkOutputStructure(vf(8), finalTf)).toEqual([shortfall(5, 'affirmations', 8)]);
  });

  it('« Réponse : » (place laissée à l’élève) n’est pas un titre de corrigé', () => {
    const numbered = Array.from({ length: 8 }, (_, i) => `${statement(i + 1)}\n\nRéponse :\n\n………………………………`).join('\n\n');
    expect(checkOutputStructure(vf(8), normalizeExerciseLayout(numbered))).toEqual([]);
    const unnumbered = Array.from({ length: 8 }, (_, i) => `- Le nombre ${i} est pair. ☐ Vrai ☐ Faux\n\nRéponse :\n\n………………`).join('\n\n');
    expect(checkOutputStructure(vf(8), unnumbered)).toEqual([]);
    expect(checkOutputStructure(vf(10), unnumbered)).toEqual([shortfall(8, 'affirmations', 10)]);
  });

  it('élément sans numéro, sous-numéro ou numéros recommencés par partie : aucun avertissement', () => {
    const td = '## Exercice 1\n\nÉnoncé.\n\n## Exercice 2\n\nÉnoncé.\n\n## Étude de cas : l’entreprise Durand\n\nÉnoncé.';
    expect(checkOutputStructure(req({ niveau: 'licence_2', nombreExercices: 3 }), td)).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 5 }), `${exercises(4)}\n\n### Problème — Le jardin\n\nÉnoncé.`)).toEqual([]);
    const sub = ['1', '2', '3a', '3b', '4', '5'].map(n => `**Question ${n}.** Explique.`).join('\n\n');
    expect(checkOutputStructure(req({ modalite: 'questions_cours', nombreExercices: 5 }), sub)).toEqual([]);
    const subSpaced = ['1', '2', '3 a)', '3 b)', '4'].map(n => `**Question ${n}** Explique.`).join('\n\n');
    expect(checkOutputStructure(req({ modalite: 'questions_cours', nombreExercices: 5 }), subSpaced)).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 4 }), `${exercises(2)}\n\n### Exercice 2 bis\n\nÉnoncé.\n\n### Exercice 3`)).toEqual([]);
    const parts = `## Partie A\n\n${Array.from({ length: 4 }, (_, i) => statement(i + 1)).join('\n\n')}\n\n## Partie B\n\n${Array.from({ length: 4 }, (_, i) => statement(i + 1)).join('\n\n')}`;
    expect(checkOutputStructure(vf(8), parts)).toEqual([]);
  });

  it('séances regroupées « Séance 3-4 », « Séance 3 et 4 » : deux séances ; barème « Exercice 2 – 4 points » : un exercice', () => {
    const seq = (title: string) => `### Séance 1 : Découverte\n\n### Séance 2 : Recherche\n\n### ${title} : Atelier (2 h)\n\n### Séance 5 : Bilan`;
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 5 }), seq('Séance 3-4'))).toEqual([]);
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 5 }), seq('Séance 3 et 4'))).toEqual([]);
    // « Séance 3 – 4 » (tirets espacés) : intervalle ou titre ? Aucun avertissement.
    expect(checkOutputStructure(req({ type: 'sequence', nombreSeances: 6 }), seq('Séance 3 – 4'))).toEqual([]);
    const graded = (n: number) => Array.from({ length: n }, (_, i) => `### Exercice ${i + 1} – ${i + 2} points\n\nÉnoncé.`).join('\n\n');
    expect(checkOutputStructure(req({ nombreExercices: 5 }), graded(5))).toEqual([]);
    expect(checkOutputStructure(req({ nombreExercices: 5 }), graded(3))).toEqual([shortfall(3, 'exercices', 5, '')]);
  });

  it('vrai/faux : affirmations qui commencent par un calcul (« 12 : 4 = 3 ») jamais prises pour des numéros', () => {
    const calculations = ['12 : 4 = 3', '15 : 3 = 6', 'Le double de 25 est 50.', '12 : 3 = 4', '45 - 12 = 33', '3.5 est un nombre entier.', '7 × 8 = 56', '10 - 4 = 5'];
    const bulleted = calculations.map(text => `- ${text} ☐ Vrai ☐ Faux`).join('\n');
    expect(checkOutputStructure(req({ niveau: 'cm1', modalite: 'vrai_faux', nombreExercices: 8 }), bulleted)).toEqual([]);
    const bare = calculations.map(text => `${text} ☐ Vrai ☐ Faux`).join('\n\n');
    expect(checkOutputStructure(req({ niveau: 'cm1', modalite: 'vrai_faux', nombreExercices: 8 }), bare)).toEqual([]);
    // Numérotées comme le demande le prompt : comptées par leur numéro.
    const numbered = calculations.map((text, i) => `**${i + 1}.** ${text} ☐ Vrai ☐ Faux`).join('\n\n');
    expect(checkOutputStructure(req({ niveau: 'cm1', modalite: 'vrai_faux', nombreExercices: 8 }), numbered)).toEqual([]);
    expect(checkOutputStructure(req({ niveau: 'cm1', modalite: 'vrai_faux', nombreExercices: 10 }), numbered)).toEqual([shortfall(8, 'affirmations', 10)]);
    const labelled = Array.from({ length: 5 }, (_, i) => `Affirmation ${i + 1} : ${calculations[i]} ☐ Vrai ☐ Faux`).join('\n\n');
    expect(checkOutputStructure(vf(8), labelled)).toEqual([shortfall(5, 'affirmations', 8)]);
    // Lignes numérotées et non numérotées mêlées : compte incertain.
    expect(checkOutputStructure(vf(10), `${numbered}\n\n- Le ciel est vert. ☐ Vrai ☐ Faux`)).toEqual([]);
  });

  it('appréciation courte numérotée dans la série : comptée ; numérotation « 1. » avec un texte court entre deux : aucun avertissement', () => {
    const text = (i: number) => `Élève sérieux et investi, qui participe volontiers à l’oral (${i}). Il doit maintenant soigner ses écrits.`;
    const terse = 'Excellent trimestre, élève moteur. Bravo, continuez !';
    const body = (i: number) => (i === 7 ? terse : text(i));
    const appreciations = req({ type: 'appreciations', nombreAppreciations: 10 });
    expect(checkOutputStructure(appreciations, Array.from({ length: 10 }, (_, i) => `${i + 1}. ${body(i + 1)}`).join('\n'))).toEqual([]);
    expect(checkOutputStructure(appreciations, Array.from({ length: 10 }, (_, i) => `### Appréciation ${i + 1}\n\n${body(i + 1)}`).join('\n\n'))).toEqual([]);
    expect(checkOutputStructure(appreciations, Array.from({ length: 10 }, (_, i) => `**Élève ${i + 1}** : ${body(i + 1)}`).join('\n\n'))).toEqual([]);
    expect(checkOutputStructure(appreciations, Array.from({ length: 10 }, (_, i) => `1. ${body(i + 1)}`).join('\n'))).toEqual([]);
    // Dernière appréciation brève (après la série des textes longs) : aucun avertissement non plus.
    expect(checkOutputStructure(appreciations, Array.from({ length: 10 }, (_, i) => `${i + 1}. ${i === 9 ? terse : text(i + 1)}`).join('\n'))).toEqual([]);
    // Toujours un avertissement s'il en manque vraiment une (le texte court ne comble aucun trou).
    const nine = Array.from({ length: 9 }, (_, i) => `${i + 1}. ${body(i + 1)}`).join('\n');
    expect(checkOutputStructure(appreciations, nine)).toEqual([
      'Le document contient 9 appréciations au lieu des 10 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
  });

  it('texte à trous : blancs en pointillés ou soulignés échappés tracés par le modèle → aucun avertissement', () => {
    const cloze = req({ matiere: 'francais', modalite: 'texte_trous', nombreExercices: 10 });
    expect(checkOutputStructure(cloze, '1. Le chat ………… (dormir) sur le tapis.\n2. Nous ........ (finir) nos devoirs.')).toEqual([]);
    expect(checkOutputStructure(cloze, '1. Le chat . . . . (dormir).')).toEqual([]);
    expect(checkOutputStructure(cloze, '1. Le chat \\_\\_\\_\\_ (dormir).')).toEqual([]);
    // Points de suspension ordinaires, filet horizontal, code : pas des blancs.
    for (const text of ['Le chat dort… puis s’éveille...', 'Texte.\n\n___\n\nSuite.', 'Texte.\n\n```\n_____\n```']) {
      expect(checkOutputStructure(cloze, text)).toEqual(['Le texte à trous ne contient aucun mot à compléter : relancez la génération.']);
    }
  });

  it('temps linéaire : lignes de milliers d’espaces', () => {
    const time = (r: GenerationRequest, text: string) => {
      const start = performance.now();
      checkOutputStructure(r, text);
      return performance.now() - start;
    };
    // Une recherche quadratique dépasserait la seconde dès 5 000 espaces ; seuil absolu très large pour une machine chargée.
    expect(time(vf(5), `Corrigé${' '.repeat(60_000)}x`)).toBeLessThan(BOUND_MS);
    const n = 100_000;
    const sp = ' '.repeat(n);
    const requests = [vf(5), req({ modalite: 'qcm', nombreExercices: 5 }), req({ type: 'sequence', nombreSeances: 5 }), req({ type: 'appreciations' })];
    for (const text of [`Corrigé${sp}x`, `☐${sp}x`, `**a**${sp}x`, `${sp}x`, `### Exercice${sp}x`, `**1.**${sp}x ☐ Vrai`, '1.\n'.repeat(n / 3)]) {
      for (const r of requests) expect(time(r, text)).toBeLessThan(BOUND_MS);
    }
  });
});

describe('pipeline — contrôle du nombre d’éléments et mise en page', () => {
  const threeOfFive = '### Exercice 1\n\nCalcule 2 + 2.\n\n### Exercice 2\n\nCalcule 3 + 3.\n\n### Exercice 3\n\nCalcule 4 + 4.';

  it('réponse complète avec 3 exercices sur 5 : avertissement CONTENT_CHECK avant « done »', async () => {
    const events = await collect(runGeneration(req({ nombreExercices: 5 }), { provider: new MockProvider({ reply: threeOfFive }) }));
    const types = events.map(e => (e.type === 'warning' ? `warning:${e.code}` : e.type));
    expect(types.indexOf('warning:CONTENT_CHECK')).toBeGreaterThan(-1);
    expect(types.indexOf('warning:CONTENT_CHECK')).toBeLessThan(types.indexOf('done'));
    const warning = events.find((e): e is Extract<GenerationEvent, { type: 'warning' }> => e.type === 'warning' && e.code === 'CONTENT_CHECK');
    expect(warning?.message).toMatch(/^Le document contient 3 exercices au lieu des 5 demandés/);
  });

  it('réponse tronquée : seulement l’avertissement de troncature', async () => {
    const events = await collect(runGeneration(req({ nombreExercices: 5 }), { provider: new MockProvider({ reply: threeOfFive, finishReason: 'length' }) }));
    const codes = events.filter(e => e.type === 'warning').map(e => (e as Extract<GenerationEvent, { type: 'warning' }>).code);
    expect(codes).toEqual(['GENERATION_TRUNCATED']);
  });

  it('nombre exact : aucun avertissement', async () => {
    const events = await collect(runGeneration(req({ nombreExercices: 3 }), { provider: new MockProvider({ reply: threeOfFive }) }));
    expect(events.filter(e => e.type === 'warning')).toEqual([]);
  });

  it('choix de QCM mis en liste dans le document final et dans le texte partiel', async () => {
    const reply = '**Question 1.** Combien font 3 × 4 ?\nA) 7\nB) 12\nC) 34\nD) 1\n**Question 2.** Suite ?\nA) 1\nB) 2';
    const expected = '**Question 1.** Combien font 3 × 4 ?\n- A) 7\n- B) 12\n- C) 34\n- D) 1\n\n**Question 2.** Suite ?\n- A) 1\n- B) 2';
    const done = (await collect(runGeneration(req({ modalite: 'qcm', nombreExercices: 2 }), { provider: new MockProvider({ reply }) })))
      .find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    // Espaces insécables avant « ? » (typographie française) comparées comme des espaces.
    expect(done?.content.replace(/\u00a0/g, ' ').startsWith(expected)).toBe(true);

    const failing = new MockProvider({ reply, chunkSize: 20, failAfterChunks: 3, failWith: new MagistraError('AI_TIMEOUT') });
    const error = (await collect(runGeneration(req({ modalite: 'qcm', nombreExercices: 2 }), { provider: failing, retryDelaysMs: [] })))
      .find((e): e is Extract<GenerationEvent, { type: 'error' }> => e.type === 'error');
    expect(error?.partial?.replace(/\u00a0/g, ' ')).toContain('**Question 1.** Combien font 3 × 4 ?\n- A) 7\n- B) 12');
  });
});

describe('checkCopyQuotes — citations de la copie (outil « corriger »)', () => {
  const COPY = 'La plante respire par ses feuilles grâce aux stomates. L’eau est absorbée par les racines et monte jusqu’aux feuilles. '
    + 'Le chloroplaste produit du glucose grâce à la lumière du soleil.';

  it('citation exacte : aucun avertissement', () => {
    expect(checkCopyQuotes('Bien : « La plante respire par ses feuilles grâce aux stomates ».', COPY)).toEqual([]);
    expect(checkCopyQuotes('Bien : "L’eau est absorbée par les racines" ok.', COPY)).toEqual([]);
    expect(checkCopyQuotes('Bien : “Le chloroplaste produit du glucose grâce à la lumière” ok.', COPY)).toEqual([]);
  });

  it('citation inventée : un avertissement, au singulier ; plusieurs : au pluriel avec le nombre', () => {
    const one = checkCopyQuotes('Erreur : « la plante respire par ses racines et ses fleurs ».', COPY);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/^Une citation de la copie n’a pas été retrouvée telle quelle/);
    const two = checkCopyQuotes('« la plante respire par ses racines et ses fleurs » puis « le soleil produit de l’eau avec le vent froid ».', COPY);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatch(/^2 citations de la copie n’ont pas été retrouvées telles quelles/);
  });

  it('accents, majuscules, apostrophes et ponctuation sans importance', () => {
    expect(checkCopyQuotes('« LA PLANTE RESPIRE par ses feuilles, grâce aux stomates ! »', COPY)).toEqual([]);
    expect(checkCopyQuotes('« L\'eau est absorbee par les racines »', COPY)).toEqual([]);
    expect(checkCopyQuotes('« la plante respire par ses feuilles grace aux stomates »', COPY.replace(/é/g, 'e'))).toEqual([]);
  });

  it('extrait coupé par […] : chaque morceau est cherché', () => {
    expect(checkCopyQuotes('« La plante respire par ses feuilles […] la lumière du soleil »', COPY)).toEqual([]);
    expect(checkCopyQuotes('« La plante respire par ses feuilles ... la lumière du soleil »', COPY)).toEqual([]);
    expect(checkCopyQuotes('« La plante respire par ses feuilles […] le vent froid de la nuit »', COPY)).toHaveLength(1);
  });

  it('citation de moins de 5 mots, ou texte sans guillemets : aucun avertissement', () => {
    expect(checkCopyQuotes('« la plante respire mal »', COPY)).toEqual([]);
    expect(checkCopyQuotes('Mot « inventé » ici, et « un autre mot ».', COPY)).toEqual([]);
    expect(checkCopyQuotes('La plante respire par ses racines et ses fleurs sans guillemets.', COPY)).toEqual([]);
  });

  it('citation dans un bloc de code : ignorée', () => {
    expect(checkCopyQuotes('```\n« la plante respire par ses racines et ses fleurs »\n```', COPY)).toEqual([]);
    expect(checkCopyQuotes('`« la plante respire par ses racines et ses fleurs »`', COPY)).toEqual([]);
  });

  it('copie vide, guillemets droits dépareillés, texte déjà présent dans la demande : aucun avertissement', () => {
    expect(checkCopyQuotes('« la plante respire par ses racines et ses fleurs »', '')).toEqual([]);
    expect(checkCopyQuotes('Elle a écrit "la plante respire par ses racines et ses fleurs, puis', COPY)).toEqual([]);
    expect(checkCopyQuotes('« respectez la consigne donnée dans le sujet du devoir »', COPY, ['Respectez la consigne donnée dans le sujet du devoir.'])).toEqual([]);
  });

  it('temps linéaire sur un texte démesuré', () => {
    const copy = COPY.repeat(500);
    const build = (n: number) => `${'« la plante respire par ses racines et ses fleurs » '.repeat(n)}\n${'"'.repeat(2 * n + 1)}`;
    expect(checkCopyQuotes(build(20_000), copy)).toHaveLength(1);
    expectLinear(build, text => void checkCopyQuotes(text, copy), 20_000);
  });

  describe('correction proposée entre guillemets', () => {
    const WRONG = 'La plante respire par ses feuilles grâce aux stomates et les racines respirent à boire de l’eau';
    const copy = `${WRONG}.`;
    const FIXED = 'La plante respire par ses feuilles grâce aux stomates et les racines boivent de l’eau';

    it('citation de la copie puis correction après une flèche : aucun avertissement', () => {
      for (const arrow of ['→', '->', '=>', '⇒']) {
        expect(checkCopyQuotes(`- « ${WRONG} » ${arrow} « ${FIXED} »`, copy), arrow).toEqual([]);
      }
      expect(checkCopyQuotes(`- "${WRONG}" → "${FIXED}"`, copy)).toEqual([]);
      expect(checkCopyQuotes(`- “${WRONG}” → **« ${FIXED} »**`, copy)).toEqual([]);
    });

    it('correction annoncée par un mot (« correction proposée », « on attend », « plutôt »…)', () => {
      const leads = [
        'Correction proposée : ', '- **Correction proposée :** ', 'Correction : ', 'Proposition de correction : ', 'Corrigé : ',
        'On attend ', 'On attendait plutôt ', 'Il fallait écrire ', 'Écrire plutôt ', 'Reformulation suggérée : ', 'Remplacer par ',
        'La phrase devient ', '| Correction proposée | ', 'La forme attendue est ',
      ];
      for (const lead of leads) {
        expect(checkCopyQuotes(`Erreur : « ${WRONG} ».\n${lead}« ${FIXED} ».`, copy), lead).toEqual([]);
      }
    });

    it('correction écrite avant « au lieu de » : la citation de la copie qui suit est toujours vérifiée', () => {
      expect(checkCopyQuotes(`« ${FIXED} » (au lieu de « ${WRONG} »).`, copy)).toEqual([]);
      expect(checkCopyQuotes(`« ${FIXED} » et non « ${WRONG} ».`, copy)).toEqual([]);
      expect(checkCopyQuotes(`« ${FIXED} » au lieu de « la plante respire par ses racines et ses fleurs ».`, copy)).toHaveLength(1);
    });

    it('citation inventée : l’avertissement reste, avec ou sans correction à côté', () => {
      const invented = 'la plante respire par ses racines et ses fleurs';
      expect(checkCopyQuotes(`- « ${invented} » → « ${FIXED} »`, copy)).toHaveLength(1);
      expect(checkCopyQuotes(`Correction proposée : « ${FIXED} ».\nErreur : « ${invented} ».`, copy)).toHaveLength(1);
      // Une flèche ou un mot de correction ailleurs dans la ligne n'excuse pas une citation inventée.
      expect(checkCopyQuotes(`→ voir l’erreur de l’élève, qui écrit « ${invented} ».`, copy)).toHaveLength(1);
      expect(checkCopyQuotes(`Correction : l’élève a écrit « ${invented} ».`, copy)).toHaveLength(1);
      expect(checkCopyQuotes(`On attendait mieux que « ${invented} ».`, copy)).toHaveLength(1);
      expect(checkCopyQuotes(`Il a écrit plutôt que « ${invented} ».`, copy)).toHaveLength(1);
      // Citation Markdown (« > ») : pas une flèche.
      expect(checkCopyQuotes(`> « ${invented} »`, copy)).toHaveLength(1);
    });

    it('texte d’une source fournie : retrouvé dans la référence', () => {
      const support = 'La photosynthèse est la transformation de l’énergie lumineuse en énergie chimique par les chloroplastes.';
      const content = 'Rappel : « la photosynthèse est la transformation de l’énergie lumineuse en énergie chimique ».';
      expect(checkCopyQuotes(content, COPY)).toHaveLength(1);
      expect(checkCopyQuotes(content, COPY, [undefined, support])).toEqual([]);
    });
  });

  describe('correction proposée seule dans la cellule d’un tableau « Passage | Correction proposée »', () => {
    const WRONG = 'La plante respire par ses feuilles grâce aux stomates et les racines respirent à boire de l’eau';
    const FIXED = 'La plante respire par ses feuilles grâce aux stomates et les racines boivent de l’eau';
    const INVENTED = 'la plante respire par ses racines et ses fleurs';
    const copy = `${WRONG}.`;
    /** Tableau à deux lignes de données : en-tête, séparation, puis les lignes. */
    const table = (header: string, ...rows: string[]) => [header, '|---|---|', ...rows].join('\n');

    it('en-tête qui annonce une correction : la citation de cette colonne n’est pas cherchée dans la copie', () => {
      const headers = [
        'Correction proposée', 'Corrigé', 'Proposition', 'Reformulation', 'Remplacement', 'Remplacer par', 'Attendu', 'Réponse attendue',
        'Version corrigée', 'À écrire', 'Texte corrigé', '**Correction proposée**', 'CORRECTION PROPOSÉE', 'Correction proposee',
      ];
      for (const header of headers) {
        expect(checkCopyQuotes(table(`| Passage | ${header} |`, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
      }
    });

    it('colonnes « Passage », « Extrait », « Citation », « Copie » : toujours vérifiées', () => {
      for (const header of ['Passage', 'Extrait', 'Citation', 'Copie', 'Passage de la copie', 'Phrase de l’élève']) {
        const head = `| ${header} | Correction proposée |`;
        expect(checkCopyQuotes(table(head, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
        expect(checkCopyQuotes(table(head, `| « ${INVENTED} » | « ${FIXED} » |`), copy), header).toHaveLength(1);
      }
    });

    it('une citation inventée dans la colonne de la correction n’excuse pas celle de la copie, et inversement', () => {
      const head = '| Passage | Correction proposée |';
      expect(checkCopyQuotes(table(head, `| « ${INVENTED} » | « ${INVENTED} » |`), copy)).toHaveLength(1);
      expect(checkCopyQuotes(table(head, `| « ${WRONG} » | « ${FIXED} » |`, `| « ${INVENTED} » | « ${FIXED} » |`), copy)).toHaveLength(1);
    });

    it('colonne repérée par son rang : correction en première colonne, colonnes supplémentaires, barres de bord facultatives', () => {
      const first = '| Correction proposée | Passage |';
      expect(checkCopyQuotes(table(first, `| « ${FIXED} » | « ${WRONG} » |`), copy)).toEqual([]);
      expect(checkCopyQuotes(table(first, `| « ${FIXED} » | « ${INVENTED} » |`), copy)).toHaveLength(1);
      const three = '| N° | Passage | Correction proposée |';
      expect(checkCopyQuotes(table(three, `| 1 | « ${WRONG} » | « ${FIXED} » |`), copy)).toEqual([]);
      expect(checkCopyQuotes(table(three, `| 1 | « ${INVENTED} » | « ${FIXED} » |`), copy)).toHaveLength(1);
      const bare = (separator: string, row: string) => `Passage | Correction proposée\n${separator}\n${row}`;
      expect(checkCopyQuotes(bare('--- | ---', `« ${WRONG} » | « ${FIXED} »`), copy)).toEqual([]);
      expect(checkCopyQuotes(bare(':--- | ---:', `« ${INVENTED} » | « ${FIXED} »`), copy)).toHaveLength(1);
      expect(checkCopyQuotes(`| Passage | Correction proposée\n|:---:|---:\n| « ${WRONG} » | « ${FIXED} »`, copy)).toEqual([]);
    });

    it('colonne sans intitulé, ligne plus longue que l’en-tête : la citation reste vérifiée', () => {
      expect(checkCopyQuotes(table('| Passage | |', `| « ${WRONG} » | « ${FIXED} » |`), copy)).toHaveLength(1);
      expect(checkCopyQuotes(table('| Passage | Correction proposée |', `| « ${WRONG} » | | « ${FIXED} » |`), copy)).toHaveLength(1);
    });

    it('cellules vides : le rang des colonnes est conservé', () => {
      const head = '| Passage | Correction proposée |';
      expect(checkCopyQuotes(table(head, `| | « ${FIXED} » |`), copy)).toEqual([]);
      expect(checkCopyQuotes(table(head, `| « ${WRONG} » | |`, '| | |'), copy)).toEqual([]);
      expect(checkCopyQuotes(table('| | Correction proposée |', `| | « ${FIXED} » |`), copy)).toEqual([]);
      expect(checkCopyQuotes(table(head, `| « ${INVENTED} » | |`), copy)).toHaveLength(1);
    });

    it('tableau sans ligne de séparation : la première ligne est l’en-tête', () => {
      const head = '| Passage | Correction proposée |';
      expect(checkCopyQuotes(`${head}\n| « ${WRONG} » | « ${FIXED} » |`, copy)).toEqual([]);
      expect(checkCopyQuotes(`${head}\n| « ${INVENTED} » | « ${FIXED} » |`, copy)).toHaveLength(1);
      // Ligne isolée : aucun en-tête connu, la citation reste vérifiée.
      expect(checkCopyQuotes(`| « ${WRONG} » | « ${FIXED} » |`, copy)).toHaveLength(1);
      // Première ligne qui n'est pas un intitulé (cellule longue) : pas une colonne de correction.
      expect(checkCopyQuotes(`| La correction de la copie est faite à la main par l’enseignant | Autre |\n| « ${INVENTED} » | |`, copy)).toHaveLength(1);
    });

    it('intitulés qui désignent la copie malgré le mot « correction » : colonne vérifiée', () => {
      const headers = [
        'Avant correction', 'Avant corrections', 'AVANT CORRECTION', 'Correction avant relecture', 'Sans correction', 'Texte à corriger',
        'Version initiale', 'Non corrigé', 'Non corrigée', 'Non corrigés', 'Texte original', 'Proposition originale', 'Texte initial corrigé',
      ];
      for (const header of headers) {
        expect(checkCopyQuotes(table(`| ${header} | Après correction |`, `| « ${INVENTED} » | « ${FIXED} » |`), copy), header).toHaveLength(1);
        expect(checkCopyQuotes(table(`| ${header} | Après correction |`, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
      }
    });

    it('« avant », « sans », « non » dans un intitulé qui ne désigne pas la copie : la colonne reste une correction', () => {
      const headers = ['Phrase corrigée (sans fautes)', 'Correction (non exhaustive)', 'Corrigé : à écrire avant la fin', 'Correction sans faute', 'Version corrigée, non définitive'];
      for (const header of headers) {
        expect(checkCopyQuotes(table(`| Passage | ${header} |`, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
        expect(checkCopyQuotes(table(`| Passage | ${header} |`, `| « ${INVENTED} » | « ${FIXED} » |`), copy), header).toHaveLength(1);
        expect(checkCopyQuotes(table(`| ${header} | Passage |`, `| « ${FIXED} » | « ${INVENTED} » |`), copy), header).toHaveLength(1);
      }
    });

    it('autres intitulés d’une correction : « Forme correcte », « Bonne réponse », « Version améliorée », « Réécrit », « Rectifié »…', () => {
      const headers = [
        'Forme correcte', 'Formes correctes', 'Réponse correcte', 'Formulation correcte', 'Bonne réponse', 'Version améliorée', 'Phrase améliorée',
        'Nouvelle version', 'Réécrit', 'Réécriture', 'Phrase réécrite', 'Rectifié', 'Phrase rectifiée', 'FORME CORRECTE', 'Forme correcte (à retenir)',
      ];
      for (const header of headers) {
        expect(checkCopyQuotes(table(`| Passage | ${header} |`, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
        expect(checkCopyQuotes(table(`| Passage | ${header} |`, `| « ${INVENTED} » | « ${FIXED} » |`), copy), header).toHaveLength(1);
        expect(checkCopyQuotes(table(`| ${header} | Passage |`, `| « ${FIXED} » | « ${INVENTED} » |`), copy), header).toHaveLength(1);
        expect(checkCopyQuotes(table(`| ${header} | Passage |`, `| « ${FIXED} » | « ${WRONG} » |`), copy), header).toEqual([]);
      }
    });

    it('intitulés qui ne sont pas une correction : « Forme incorrecte », « À améliorer », « À rectifier », « À réécrire »', () => {
      for (const header of ['Forme incorrecte', 'Formes incorrectes', 'À améliorer', 'À rectifier', 'À réécrire']) {
        expect(checkCopyQuotes(table(`| N° | ${header} |`, `| 1 | « ${INVENTED} » |`), copy), header).toHaveLength(1);
      }
    });

    it('intitulé mixte (mot de la copie et mot de correction) : la colonne reste vérifiée', () => {
      const headers = [
        'Erreur et correction', 'Erreur → correction', 'Phrase de l’élève (corrigée)', 'Passage corrigé', 'Extrait et proposition', 'Citation corrigée',
        'Copie corrigée', 'Élève : correction', 'Original / réécriture', 'Texte de l’élève et reformulation', 'ERREUR ET CORRECTION',
      ];
      for (const header of headers) {
        expect(checkCopyQuotes(table(`| N° | ${header} |`, `| 1 | « ${INVENTED} » |`), copy), header).toHaveLength(1);
        expect(checkCopyQuotes(table(`| N° | ${header} |`, `| 1 | « ${WRONG} » |`), copy), header).toEqual([]);
        // L'autre colonne, qui annonce seule une correction, reste ignorée.
        expect(checkCopyQuotes(table(`| ${header} | Correction proposée |`, `| « ${WRONG} » | « ${FIXED} » |`), copy), header).toEqual([]);
        expect(checkCopyQuotes(table(`| ${header} | Correction proposée |`, `| « ${INVENTED} » | « ${FIXED} » |`), copy), header).toHaveLength(1);
      }
    });

    it('chaque tableau a son en-tête ; hors tableau (ligne vide, bloc de code), la correction n’est plus reconnue', () => {
      const first = table('| Passage | Correction proposée |', `| « ${WRONG} » | « ${FIXED} » |`);
      const second = table('| Correction proposée | Passage |', `| « ${FIXED} » | « ${WRONG} » |`);
      expect(checkCopyQuotes(`${first}\n\n${second}`, copy)).toEqual([]);
      expect(checkCopyQuotes(`${first}\n\n${second.replace(`« ${WRONG} »`, `« ${INVENTED} »`)}`, copy)).toHaveLength(1);
      expect(checkCopyQuotes(`${first}\n\nVoir aussi « ${FIXED} ».`, copy)).toHaveLength(1);
      // Le bloc de code coupe le tableau : la ligne qui suit n'a plus d'en-tête.
      expect(checkCopyQuotes(`${first}\n\`\`\`\n| a | b |\n\`\`\`\n| « ${WRONG} » | « ${FIXED} » |`, copy)).toEqual([
        'Une citation de la copie n’a pas été retrouvée telle quelle dans le travail fourni : vérifiez-la avant de transmettre la correction.',
      ]);
    });

    it('barre échappée (« \\| ») et code en ligne dans la ligne : le rang de la colonne ne se décale pas', () => {
      const piped = 'La plante respire par ses feuilles | grâce aux stomates et les racines respirent à boire de l’eau';
      const head = '| Passage | Correction proposée |';
      expect(checkCopyQuotes(table(head, `| « ${piped.replace('|', '\\|')} » | « ${FIXED} » |`), piped)).toEqual([]);
      expect(checkCopyQuotes(table(head, `| \`x\` « ${WRONG} » | « ${FIXED} » |`), copy)).toEqual([]);
    });

    it('très gros tableau : l’en-tête vaut pour toutes les lignes, à n’importe quelle distance, en temps linéaire', () => {
      const big = (n: number) => [
        '| N° | Passage | Correction proposée |', '|---|---|---|',
        ...Array.from({ length: n }, (_, i) => `| ${i} | mot | mot |`),
        `| ${n} | « ${WRONG} » | « ${FIXED} » |`,
      ].join('\n');
      expect(checkCopyQuotes(big(20_000), copy)).toEqual([]);
      expect(checkCopyQuotes(big(20_000).replace(`« ${WRONG} »`, `« ${INVENTED} »`), copy)).toHaveLength(1);
      expectLinear(big, text => void checkCopyQuotes(text, copy), 10_000);
      // Une seule ligne démesurée : le rang de la colonne n'est calculé que pour les citations réellement vérifiées.
      const wide = (n: number) => `| Passage | Correction proposée |\n|---|---|\n| ${`« ${WRONG} » | `.repeat(n)}« ${FIXED} » |`;
      expect(checkCopyQuotes(wide(20_000), copy)).toEqual([]);
      expectLinear(wide, text => void checkCopyQuotes(text, copy), 10_000);
    });

    it('ligne démesurée de barres suivie de nombreuses citations inventées : le rang des colonnes ne coûte pas une lecture de la ligne par citation', () => {
      const quotes = Array.from({ length: 70 }, (_, i) => `« ${INVENTED} ${i} »`).join(' ');
      const text = `| Passage | Correction proposée |\n|---|---|\n${'|'.repeat(2_000_000)} ${quotes}`;
      const start = performance.now();
      const warnings = checkCopyQuotes(text, copy);
      expect(performance.now() - start).toBeLessThan(BOUND_MS);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^60 citations/);
    });

    it('tableau très large : le rang de la colonne reste exact (barres de bord facultatives, barres échappées)', () => {
      const columns = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
      const head = [...columns(150), 'Passage', 'Correction proposée', ...columns(50)];
      const cells = (passage: string, fixed: string) => [...columns(150).map(() => 'x \\| y'), passage, fixed, ...columns(50).map(() => '')];
      const build = (passage: string, fixed: string, edges: boolean) => {
        const row = (list: string[]) => (edges ? `| ${list.join(' | ')} |` : list.join(' | '));
        return [row(head), row(head.map(() => '---')), row(cells(passage, fixed))].join('\n');
      };
      for (const edges of [true, false]) {
        expect(checkCopyQuotes(build(`« ${WRONG} »`, `« ${FIXED} »`, edges), copy), String(edges)).toEqual([]);
        expect(checkCopyQuotes(build(`« ${INVENTED} »`, `« ${FIXED} »`, edges), copy), String(edges)).toHaveLength(1);
        expect(checkCopyQuotes(build(`« ${WRONG} »`, `« ${INVENTED} »`, edges), copy), String(edges)).toEqual([]);
      }
    });
  });
});

describe('pipeline — outil « corriger » : citations de la copie', () => {
  const COPY = 'Le texte explique que la plante respire par ses feuilles. Ensuite il dit que l’eau monte par les racines jusqu’en haut.';
  const corrige = (partial: Partial<GenerationRequest> = {}) => req({ type: 'corrige', texteEleve: COPY, sujet: 'La plante', ...partial });
  const contentChecks = (events: GenerationEvent[]) =>
    events.filter((e): e is Extract<GenerationEvent, { type: 'warning' }> => e.type === 'warning' && e.code === 'CONTENT_CHECK');

  it('citation inventée : avertissement CONTENT_CHECK non bloquant, contenu inchangé', async () => {
    const reply = 'Correction.\n\n- Erreur : « la plante respire par ses racines et ses fleurs » (voir copie).\n- Bien : « la plante respire par ses feuilles ».';
    const events = await collect(runGeneration(corrige(), { provider: new MockProvider({ reply }) }));
    const warnings = contentChecks(events);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/citation de la copie/);
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.content).toContain('la plante respire par ses racines et ses fleurs');
  });

  it('correction proposée entre guillemets : aucun avertissement, citation inventée toujours signalée', async () => {
    const proposed = 'Erreur : « la plante respire par ses feuilles » → « la plante respire grâce à ses feuilles vertes ».\nCorrection proposée : « l’eau monte par les racines jusqu’en haut du tronc ».';
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: proposed }) })))).toEqual([]);
    const invented = 'Erreur : « la plante respire par ses racines et ses fleurs » → « la plante respire par ses feuilles vertes ».';
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: invented }) })))).toHaveLength(1);
  });

  it('correction proposée seule dans la cellule d’un tableau : aucun avertissement, citation inventée toujours signalée', async () => {
    const head = '| Passage | Correction proposée |\n|---|---|\n';
    const proposed = `${head}| « la plante respire par ses feuilles » | « la plante respire grâce à ses feuilles vertes » |`;
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: proposed }) })))).toEqual([]);
    const invented = `${head}| « la plante respire par ses racines et ses fleurs » | « la plante respire grâce à ses feuilles vertes » |`;
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: invented }) })))).toHaveLength(1);
  });

  it('texte d’une source fournie cité entre guillemets : retrouvé, pas d’avertissement', async () => {
    const support = 'La photosynthèse est la transformation de l’énergie lumineuse en énergie chimique par les chloroplastes des feuilles.';
    const doc: DocumentPassage = { docId: 'cours.pdf', docName: 'cours.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 1 }, text: support };
    const reply = 'Rappel du cours : « la photosynthèse est la transformation de l’énergie lumineuse en énergie chimique » [S1].';
    expect(contentChecks(await collect(runGeneration(corrige({ documents: [doc] }), { provider: new MockProvider({ reply }) })))).toEqual([]);
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: reply.replace(' [S1]', '') }) })))).toHaveLength(1);
  });

  it('citations exactes : aucun avertissement ; autre outil : jamais de contrôle', async () => {
    const exact = 'Bien : « la plante respire par ses feuilles ». Aussi « l’eau monte par les racines jusqu’en haut ».';
    expect(contentChecks(await collect(runGeneration(corrige(), { provider: new MockProvider({ reply: exact }) })))).toEqual([]);
    const invented = 'Cours : « la plante respire par ses racines et ses fleurs ».';
    expect(contentChecks(await collect(runGeneration(req({ type: 'cours', sujet: 'La plante' }), { provider: new MockProvider({ reply: invented }) })))).toEqual([]);
  });
});
