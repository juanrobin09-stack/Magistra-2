import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { buildClozeDocument } from '../../shared/cloze';
import { defaultMessage, MagistraError } from '../../shared/errors';
import { checkOutputStructure } from '../../shared/outputChecks';
import { runGeneration } from '../../shared/pipeline';
import type { GenerationEvent, GenerationRequest } from '../../shared/types';
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
    expect(done?.content.startsWith(expected)).toBe(true);

    const failing = new MockProvider({ reply, chunkSize: 20, failAfterChunks: 3, failWith: new MagistraError('AI_TIMEOUT') });
    const error = (await collect(runGeneration(req({ modalite: 'qcm', nombreExercices: 2 }), { provider: failing, retryDelaysMs: [] })))
      .find((e): e is Extract<GenerationEvent, { type: 'error' }> => e.type === 'error');
    expect(error?.partial).toContain('**Question 1.** Combien font 3 × 4 ?\n- A) 7\n- B) 12');
  });
});
