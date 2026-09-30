// Texte à trous construit par Magistra : le modèle marque les mots à trouver ([[mot]]) ; Magistra pose les blancs
// numérotés, la banque de mots et le corrigé, alignés, au fil de la rédaction comme dans le document final.

import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { buildCloze, buildClozeDocument, CLOZE_BLANK, ClozeStream, clozeWarning, isClozeRequest } from '../../shared/cloze';
import { runGeneration, type NewGenerationRecord } from '../../shared/pipeline';
import { buildSystemPrompt, buildUserPrompt } from '../../shared/prompts/index';
import type { GenerationEvent, GenerationRequest } from '../../shared/types';
import { validateGenerationRequest } from '../../shared/validation';
import { collect } from './helpers';

const TEXT = 'La respiration permet de produire de l’[[énergie]]. Les poissons respirent grâce à leurs [[branchies]], '
  + 'les mammifères grâce à leurs [[poumons]]. Les végétaux échangent des gaz par les [[**stomates**]] de leurs feuilles.';

const blank = (n: number) => `(${n}) ${CLOZE_BLANK}`;

function streamed(text: string, cuts: number[], max?: number): { out: string; words: string[] } {
  const stream = new ClozeStream(max);
  let out = '';
  let from = 0;
  for (const cut of [...cuts, text.length]) {
    out += stream.push(text.slice(from, cut));
    from = cut;
  }
  return { out: out + stream.end(), words: stream.words };
}

describe('ClozeStream (au fil de la rédaction)', () => {
  it('chaque mot marqué devient un blanc numéroté, dans l’ordre ; la mise en forme du mot est retirée', () => {
    const { out, words } = streamed(TEXT, []);
    expect(words).toEqual(['énergie', 'branchies', 'poumons', 'stomates']);
    expect(out).toContain(`produire de l’${blank(1)}.`);
    expect(out).toContain(`par les ${blank(4)} de leurs feuilles.`);
    expect(out).not.toMatch(/\[\[|\]\]|énergie|branchies/);
  });

  it('même résultat quel que soit le découpage du flux (marque coupée à n’importe quel endroit)', () => {
    const whole = streamed(TEXT, []).out;
    for (let i = 1; i < TEXT.length; i++) expect(streamed(TEXT, [i]).out, `coupure à ${i}`).toBe(whole);
    // Découpage fin : un caractère à la fois.
    expect(streamed(TEXT, Array.from({ length: TEXT.length - 1 }, (_, i) => i + 1)).out).toBe(whole);
  });

  it('au-delà du nombre demandé, le mot reste écrit (pas de blanc en trop)', () => {
    const { out, words } = streamed(TEXT, [], 2);
    expect(words).toEqual(['énergie', 'branchies']);
    expect(out).toContain('grâce à leurs poumons.');
    expect(out).toContain('par les stomates de leurs feuilles.');
    expect(out).not.toContain(blank(3));
  });

  it('ce qui n’est pas une marque passe tel quel : citations, liens, crochets simples, marque non fermée', () => {
    const text = 'Voir [S1] et [le cours](https://exemple.fr/a) ; [Date] ; tableau[i] ; [[a\nb]] ; fin [[ouverte';
    const { out, words } = streamed(text, [3, 17, 40]);
    expect(words).toEqual([]);
    expect(out).toBe(text);
  });

  it('marque mal fermée (« [[dort] ») : blanc quand même, sans annuler la marque suivante', () => {
    const text = 'Le chat [[dort] sur le canapé pendant que le [[chien]] joue avec la [[balle]].';
    const whole = streamed(text, []);
    expect(whole.words).toEqual(['dort', 'chien', 'balle']);
    expect(whole.out).toBe(`Le chat ${blank(1)} sur le canapé pendant que le ${blank(2)} joue avec la ${blank(3)}.`);
    for (let i = 1; i < text.length; i++) expect(streamed(text, [i]).out, `coupure à ${i}`).toBe(whole.out);
    expect(streamed(text, Array.from({ length: text.length - 1 }, (_, i) => i + 1)).out).toBe(whole.out);
  });

  it('« [[ » jamais fermé : la marque suivante reste un blanc', () => {
    const { out, words } = streamed('voir [[ci-dessous et plus loin le [[mot]] ici.', [9, 30]);
    expect(words).toEqual(['mot']);
    expect(out).toBe(`voir [[ci-dessous et plus loin le ${blank(1)} ici.`);
  });

  it('formule ($…$, $$…$$) : blanc lisible par KaTeX ; « 5 $ » n’ouvre pas de formule ; même résultat à toute coupure', () => {
    const text = 'On a $x^2 = [[4]]$, puis $$\\frac{[[3]]}{4}$$ ; prix : 5 $ et le [[prix]] final.';
    const whole = streamed(text, []);
    expect(whole.words).toEqual(['4', '3', 'prix']);
    expect(whole.out).toContain(`le ${blank(3)} final`);
    for (const formula of whole.out.match(/\$\$?[^$]+\$\$?/g) ?? []) {
      expect(() => katex.renderToString(formula.replace(/\$/g, ''), { throwOnError: true }), formula).not.toThrow();
    }
    for (let i = 1; i < text.length; i++) expect(streamed(text, [i]).out, `coupure à ${i}`).toBe(whole.out);
  });

  it('code : une liste imbriquée « [[0, 1]] » reste du code, un blanc dans le code reste possible ; même résultat à toute coupure', () => {
    const text = 'Le [[tableau]] :\n```python\nm = [[0, 1]]\ngrille = [[0]*3 for _ in range(3)]\nfor i in [[range]](3):\n```\nfin et `x = [[1, 2]]`.';
    const whole = streamed(text, []);
    expect(whole.words).toEqual(['tableau', 'range']);
    expect(whole.out).toContain('m = [[0, 1]]\ngrille = [[0]*3 for _ in range(3)]');
    expect(whole.out).toContain(`for i in ${blank(2)}(3):`);
    expect(whole.out).toContain('`x = [[1, 2]]`');
    for (let i = 1; i < text.length; i++) expect(streamed(text, [i]).out, `coupure à ${i}`).toBe(whole.out);
  });
});

describe('buildClozeDocument (document final)', () => {
  const MODEL_OUTPUT = [
    '## Exercice : la respiration (5e)',
    '',
    '### Texte',
    '',
    TEXT,
    '',
    '---',
    '',
    '### **Banque de mots**',
    'poumons, énergie, stomates, branchies',
    '',
    '---',
    '',
    '#### **Corrigé**',
    '| (1) | énergie |',
    '| (2) | feuilles |',
    '',
    '---',
    '',
    '#### Compétences travaillées',
    '- Identifier les organes respiratoires.',
  ].join('\n');

  it('blancs, banque de mots après le texte, corrigé aligné à la fin ; la banque et le corrigé du modèle sont remplacés', () => {
    const doc = buildClozeDocument(MODEL_OUTPUT, { withKey: true });
    expect(doc).toContain(`de l’${blank(1)}.`);
    expect(doc).not.toMatch(/\[\[|feuilles \|/);
    // Banque de mots (ordre alphabétique) juste après le texte, avant les compétences.
    expect(doc).toMatch(/### Banque de mots\n\nbranchies · énergie · poumons · stomates/);
    expect(doc.indexOf('### Banque de mots')).toBeGreaterThan(doc.indexOf(blank(4)));
    expect(doc.indexOf('### Banque de mots')).toBeLessThan(doc.indexOf('Compétences travaillées'));
    // Corrigé de Magistra, à la fin, exactement aligné sur les blancs.
    expect(doc.trimEnd().endsWith('### Corrigé\n\n- (1) énergie\n- (2) branchies\n- (3) poumons\n- (4) stomates')).toBe(true);
    expect(doc.match(/Banque de mots/g)).toHaveLength(1);
    expect(doc.match(/Corrigé/g)).toHaveLength(1);
    // Séparateurs devenus consécutifs fusionnés.
    expect(doc).not.toMatch(/---\s*\n\s*---/);
  });

  it('version élève seule : banque de mots, aucun corrigé', () => {
    const doc = buildClozeDocument(MODEL_OUTPUT, { withKey: false });
    expect(doc).toContain('### Banque de mots');
    expect(doc).not.toMatch(/Corrigé|\(1\) énergie/);
  });

  it('nombre demandé : autant de blancs, de mots dans la banque et de lignes au corrigé', () => {
    const doc = buildClozeDocument(TEXT, { max: 3, withKey: true });
    expect(doc).toContain(blank(3));
    expect(doc).not.toContain(blank(4));
    expect(doc).toContain('par les stomates de leurs feuilles.');
    expect(doc).toMatch(/### Banque de mots\n\nbranchies · énergie · poumons\n/);
    expect(doc).toMatch(/- \(3\) poumons\n$/);
  });

  it('petit modèle qui met une partie des mots en gras au lieu de les marquer (sortie réelle d’un 3B) : mots en gras du même paragraphe comptés ; sa banque et son corrigé « **Corrigé** (…) : » remplacés', () => {
    const output = [
      '#### **Séquence 1 : Les besoins en oxygène**',
      '**Complète** le texte avec les mots qui conviennent :',
      'La respiration est un processus **essentiel** pour les êtres vivants : elle fournit de l’**énergie** aux cellules.',
      'Le sang transporte l’oxygène vers les [[muscles]].',
      '',
      'Un paragraphe sans mot marqué garde son **gras**.',
      '',
      '**Corrigé** (à fournir par l’enseignant après vérification) :',
      '1. essentiel',
      '2. énergie',
      '',
      '---',
      '**Banque de mots** (pour l’enseignant) :',
      '- muscles, énergie',
    ].join('\n');
    const doc = buildClozeDocument(output, { max: 8, withKey: true });
    expect(doc).toContain(`processus ${blank(1)} pour`);
    expect(doc).toContain(`de l’${blank(2)} aux cellules`);
    expect(doc).toContain(`vers les ${blank(3)}.`);
    // Titre et consigne jamais transformés ; paragraphe sans mot marqué inchangé.
    expect(doc).toContain('#### **Séquence 1 : Les besoins en oxygène**');
    expect(doc).toContain('**Complète** le texte');
    expect(doc).toContain('garde son **gras**');
    expect(doc).not.toMatch(/à fournir par l’enseignant|pour l’enseignant|1\. essentiel/);
    expect(doc).toMatch(/### Corrigé\n\n- \(1\) essentiel\n- \(2\) énergie\n- \(3\) muscles\n$/);
  });

  it('présentation : pas de gras autour d’un blanc, blancs collés séparés', () => {
    const doc = buildClozeDocument('L’**[[air]]** entre par le **[[nez]]**, puis [[la]][[trachée]].', { withKey: false });
    expect(doc).toContain(`L’${blank(1)} entre par le ${blank(2)}, puis ${blank(3)} ${blank(4)}.`);
  });

  it('aucun mot marqué : le document du modèle est gardé (seuls d’éventuels doubles crochets sont retirés)', () => {
    const plain = '### Texte\n\nLa (1) ________ produit de l’énergie.\n\n### Corrigé\n\n(1) [[respiration]]';
    expect(buildClozeDocument(plain, { withKey: true })).toBe(plain.replace('[[respiration]]', 'respiration'));
  });
});

/** Partie « Banque de mots » du document : les mots, tels qu'affichés. */
const bankOf = (doc: string) => /### Banque de mots\n\n([^\n]*)/.exec(doc)?.[1];
/** Corrigé de Magistra : ses lignes « - (n) mot ». */
const keyOf = (doc: string) => doc.match(/^- \(\d+\) .*$/gm) ?? [];

describe('buildClozeDocument : mots en gras au lieu de marqués', () => {
  it('étiquette en gras (« **Consigne :** », « **Consigne** : »), consigne en tête (« **Complète** ») : jamais un blanc', () => {
    for (const intro of ['**Consigne :** Complète le texte avec les mots de la banque.', '**Consigne** : complète avec les mots.', '**Complète** le texte avec les mots qui conviennent.']) {
      const doc = buildClozeDocument(`${intro}\nLa respiration fournit de l’[[énergie]] aux cellules.`, { withKey: true });
      expect(doc, intro).toContain(intro);
      expect(bankOf(doc), intro).toBe('énergie');
      expect(keyOf(doc), intro).toEqual(['- (1) énergie']);
    }
  });

  it('tableau : en-têtes en gras gardés, seul le mot marqué devient un blanc', () => {
    const doc = buildClozeDocument('| **Organe** | **Rôle** |\n|---|---|\n| [[poumons]] | échanges |', { withKey: true });
    expect(doc).toContain('| **Organe** | **Rôle** |');
    expect(doc).toContain(`| ${blank(1)} | échanges |`);
    expect(bankOf(doc)).toBe('poumons');
  });

  it('étiquette d’un élément de liste (« - **Poumons** : … ») gardée', () => {
    expect(buildClozeDocument('- **Poumons** : lieu des [[échanges]] gazeux.', { withKey: true }))
      .toContain(`- **Poumons** : lieu des ${blank(1)} gazeux.`);
  });

  it('nombre demandé : les mots marqués passent avant les mots en gras (aucune réponse laissée visible)', () => {
    const doc = buildClozeDocument('**Consigne** : complète avec les mots.\nLe chat [[dort]], le [[chien]] joue, la [[souris]] court.', { max: 3, withKey: true });
    expect(doc).toContain(`Le chat ${blank(1)}, le ${blank(2)} joue, la ${blank(3)} court.`);
    expect(bankOf(doc)).toBe('chien · dort · souris');
    const withBold = buildClozeDocument('Le **chat** [[dort]], le [[chien]] joue, la [[souris]] court.', { max: 3, withKey: true });
    expect(withBold).toContain(`Le **chat** ${blank(1)}, le ${blank(2)} joue, la ${blank(3)} court.`);
    // Sans nombre demandé, le mot en gras d’une phrase du texte compte.
    expect(buildClozeDocument('Le chat **dort** et le [[chien]] joue.', { withKey: true })).toContain(`Le chat ${blank(1)} et le ${blank(2)} joue.`);
  });

  it('aucun mot marqué mais les mots à trouver en gras (petit modèle) : blancs, banque et corrigé ; sa ligne de réponses est retirée', () => {
    const output = '**Consigne :** Complète le texte.\n\nLes plantes vertes fabriquent leur matière grâce à la **photosynthèse**. '
      + 'Elles captent la **lumière** avec la **chlorophylle**.\n\n**Réponses :** photosynthèse, lumière, chlorophylle';
    const result = buildCloze(output, { max: 5, withKey: true });
    expect(result.words).toEqual(['photosynthèse', 'lumière', 'chlorophylle']);
    expect(result.content).toContain('**Consigne :** Complète le texte.');
    expect(result.content).toContain(`grâce à la ${blank(1)}. Elles captent la ${blank(2)} avec la ${blank(3)}.`);
    expect(bankOf(result.content)).toBe('chlorophylle · lumière · photosynthèse');
    expect(result.content).not.toMatch(/Réponses/);
    expect(keyOf(result.content)).toEqual(['- (1) photosynthèse', '- (2) lumière', '- (3) chlorophylle']);
    expect(clozeWarning(result, 5)).toBe('Le modèle n\'a marqué que 3 mots à trouver sur les 5 demandés.');
  });

  it('ni mot marqué, ni mot en gras : texte gardé tel quel, avec un avertissement (aucun s’il a écrit ses propres blancs)', () => {
    const plain = buildCloze('Les plantes fabriquent leur matière grâce à la photosynthèse.', { withKey: true });
    expect(plain).toEqual({ content: 'Les plantes fabriquent leur matière grâce à la photosynthèse.', words: [] });
    expect(clozeWarning(plain)).toMatch(/aucun mot à trouver/);
    const own = buildCloze('La (1) ________ produit de l’**énergie**.', { withKey: true });
    expect(own.content).toBe('La (1) ________ produit de l’**énergie**.');
    expect(clozeWarning(own)).toBeNull();
    expect(clozeWarning(buildCloze(TEXT, { max: 4, withKey: true }), 4)).toBeNull();
  });
});

describe('buildClozeDocument : banque et corrigé écrits par le modèle', () => {
  const T = 'La plante produit de l’[[énergie]] grâce à la [[lumière]]. Le poisson respire par des [[branchies]].';

  it.each([
    ['### Solutions', `${T}\n\n### Solutions\n\n1. énergie\n2. branchies`],
    ['## Réponses attendues', `${T}\n\n## Réponses attendues\n\n- énergie`],
    ['Réponses : (1) [[…]]', `${T}\n\nRéponses : (1) [[énergie]], (2) [[lumière]]`],
    ['**Corrigé :** a, b, c', `${T}\n\n**Corrigé :** énergie, lumière, branchies`],
    ['**Réponses :** + liste', `${T}\n\n**Réponses :**\n1. énergie\n2. lumière`],
    ['**Mots à trouver :**', `${T}\n\n**Mots à trouver :** énergie, lumière`],
    ['**Mots à placer :** avant le texte', `**Mots à placer :** [[énergie]] – [[branchies]]\n\n${T}`],
    ['**Texte complété :**', `${T}\n\n**Texte complété :**\nLa plante produit de l’**énergie** grâce à la **lumière**. Le poisson respire par des branchies.`],
  ])('version élève seule : sa partie « %s » est retirée, aucune réponse ne reste', (_, output) => {
    const doc = buildClozeDocument(output, { max: 3, withKey: false });
    expect(doc.match(/### Banque de mots/g)).toHaveLength(1);
    expect(doc).not.toMatch(/Solutions|Réponses|Corrigé|Mots à|complété|\*\*énergie|\n1\. énergie|- énergie/);
    expect(doc.startsWith(`La plante produit de l’${blank(1)} grâce à la ${blank(2)}. Le poisson respire par des ${blank(3)}.`)).toBe(true);
    expect(bankOf(doc)).toBe('branchies · énergie · lumière');
  });

  it('titres et phrases du cours jamais pris pour un corrigé', () => {
    const doc = buildClozeDocument([
      '### Solutions et mélanges', '', 'Une [[solution]] est un mélange homogène. La correction des erreurs est importante.', '',
      '**Solution :** mélange homogène d’un soluté dans un solvant.', '',
      '**Question 1** : pourquoi ?', '', '**Réponse :**', '', '1. ……………………', '', 'Réponse : ………………',
    ].join('\n'), { withKey: false });
    for (const kept of ['### Solutions et mélanges', 'La correction des erreurs est importante.', '**Solution :** mélange homogène', '**Réponse :**', '1. ……………………', 'Réponse : ………………']) {
      expect(doc, kept).toContain(kept);
    }
  });

  it('banque du modèle suivie du texte sans ligne vide : seule la banque est retirée', () => {
    const doc = buildClozeDocument('### Banque de mots\nchat · chien\nLe [[chat]] dort et le [[chien]] joue.', { withKey: true });
    expect(doc.startsWith(`Le ${blank(1)} dort et le ${blank(2)} joue.\n\n### Banque de mots\n\nchat · chien\n`)).toBe(true);
    // Un titre « Mots à compléter » qui annonce le texte lui-même : gardé.
    expect(buildClozeDocument('### Mots à compléter\n\nLe [[chat]] dort.', { withKey: true })).toContain(`### Mots à compléter\n\nLe ${blank(1)} dort.`);
  });

  it('ce qui suit le corrigé du modèle est gardé : durée, prolongement, remédiation, barème', () => {
    const a = buildClozeDocument(`${T}\n\n**Corrigé :**\n1. branchies\n\n**Durée conseillée :** 15 minutes.\n\nProlongement : chercher d’autres organes.`, { withKey: true });
    expect(a).toContain('**Durée conseillée :** 15 minutes.\n\nProlongement : chercher d’autres organes.');
    expect(a).not.toMatch(/1\. branchies/);
    expect(a.match(/Corrigé/g)).toHaveLength(1);

    const remediation = `${T}\n\n## Correction et remédiation\n\n| Réponse | Besoin repéré | Piste de remédiation |\n|---|---|---|\n`
      + '| oxygène au lieu d’énergie | confusion gaz / énergie | reprendre le schéma |\n\n### Barème\n\n1 point par mot trouvé.';
    for (const withKey of [true, false]) {
      const b = buildClozeDocument(remediation, { withKey });
      expect(b, `withKey ${withKey}`).toContain('## Correction et remédiation\n\n| Réponse | Besoin repéré | Piste de remédiation |');
      expect(b, `withKey ${withKey}`).toContain('| oxygène au lieu d’énergie | confusion gaz / énergie | reprendre le schéma |');
      expect(b, `withKey ${withKey}`).toContain('### Barème\n\n1 point par mot trouvé.');
    }

    const c = buildClozeDocument(`${T}\n\n## Corrigé\n1. énergie\n\n### Pistes de remédiation\n| Erreur | Piste |\n|---|---|\n| lumière oubliée | revoir la photosynthèse |`, { withKey: true });
    expect(c).toContain('### Pistes de remédiation\n| Erreur | Piste |\n|---|---|\n| lumière oubliée | revoir la photosynthèse |');
    expect(c).not.toMatch(/^## Corrigé|1\. énergie/m);
    expect(keyOf(c)).toEqual(['- (1) énergie', '- (2) lumière', '- (3) branchies']);
  });

  it('réponses fausses du modèle (liste ou tableau) retirées avec les bonnes', () => {
    const list = buildClozeDocument(`${T}\n\n## Corrigé\n\n1. énergie\n2. feuilles\n3. branchies`, { withKey: true });
    expect(list).not.toMatch(/feuilles|^## Corrigé/m);
    const table = buildClozeDocument(`${T}\n\n## Corrigé\n\n| N° | Réponse | Points |\n|---|---|---|\n| 1 | énergie | 1 pt |\n| 2 | oxygène | 1 pt |`, { withKey: true });
    expect(table).not.toMatch(/oxygène|N° \||^## Corrigé/m);
    expect(keyOf(table)).toEqual(['- (1) énergie', '- (2) lumière', '- (3) branchies']);
  });

  const EVALUATION = [
    '## Partie 1 – Texte à trous (8 points)', '',
    'La respiration produit de l’[[énergie]]. Le poisson respire par des [[branchies]].', '',
    '## Partie 2 – Questions (12 points)', '',
    '1. Pourquoi un poisson meurt-il hors de l’eau ? (6 pts)', '2. Cite deux organes de la respiration humaine. (6 pts)', '',
    '## Corrigé', '',
    '**Partie 1**', '1. énergie', '2. feuilles', '',
    '**Partie 2**', '1. Hors de l’eau, les branchies s’affaissent et ne captent plus le dioxygène.', '2. Les poumons, la trachée.',
  ].join('\n');

  it('évaluation : le corrigé des autres questions est gardé, les réponses des blancs y sont remplacées par celles de Magistra', () => {
    const doc = buildClozeDocument(EVALUATION, { withKey: true });
    expect(doc).toContain('## Corrigé\n\n**Partie 1**\n\n- (1) énergie\n- (2) branchies\n\n**Partie 2**\n1. Hors de l’eau, les branchies s’affaissent');
    expect(doc).toContain('2. Les poumons, la trachée.');
    expect(doc).not.toMatch(/feuilles|### Corrigé/);
    expect(doc.match(/Corrigé/g)).toHaveLength(1);
    expect(doc.indexOf('### Banque de mots')).toBeLessThan(doc.indexOf('## Partie 2'));
  });

  it('évaluation : corrigé du modèle sans les réponses des blancs, celles de Magistra y sont ajoutées ; version élève seule : aucun corrigé', () => {
    const noBlanks = EVALUATION.replace('**Partie 1**\n1. énergie\n2. feuilles\n\n', '');
    const doc = buildClozeDocument(noBlanks, { withKey: true });
    expect(doc).toContain('## Corrigé\n\n**Texte à trous**\n\n- (1) énergie\n- (2) branchies\n\n**Partie 2**');
    expect(doc.match(/Corrigé/g)).toHaveLength(1);
    const student = buildClozeDocument(EVALUATION, { withKey: false });
    expect(student).not.toMatch(/Corrigé|Hors de l’eau|feuilles|- \(1\)/);
    expect(student).toContain('2. Cite deux organes de la respiration humaine. (6 pts)');
  });

  it('corrigé du modèle rédigé en étiquettes (« Réponse attendue : … ») : gardé entier, jamais laissé dans la version élève', () => {
    const output = `${T}\n\n## Corrigé\n\n**Question 1**\nRéponse attendue : les branchies s’affaissent hors de l’eau.\n\n`
      + '**Question 2**\nRéponse attendue : les poumons.\n\nDurée : 20 minutes.';
    const student = buildClozeDocument(output, { withKey: false });
    expect(student).not.toMatch(/Corrigé|Question|Réponse attendue/);
    expect(student).toContain('Durée : 20 minutes.');
    const doc = buildClozeDocument(output, { withKey: true });
    expect(doc).toContain('## Corrigé\n\n**Texte à trous**\n\n- (1) énergie\n- (2) lumière\n- (3) branchies\n\n**Question 1**');
    expect(doc).toContain('**Question 2**\nRéponse attendue : les poumons.\n\nDurée : 20 minutes.');
  });
});

describe('buildClozeDocument : formules, code, mots avec « _ » ou « * »', () => {
  it('mot marqué dans une formule : formule valide pour KaTeX, mot en clair dans la banque et le corrigé', () => {
    const doc = buildClozeDocument('On a $x^2 = [[4]]$ et $\\frac{[[x^2]]}{2}$ ; le [[carré]] vaut ça.', { withKey: true });
    const formulas = doc.match(/\$[^$\n]+\$/g) ?? [];
    expect(formulas).toHaveLength(4);
    for (const formula of formulas) {
      expect(() => katex.renderToString(formula.slice(1, -1), { throwOnError: true }), formula).not.toThrow();
    }
    expect(doc).toContain(`le ${blank(3)} vaut ça.`);
    expect(bankOf(doc)).toBe('4 · carré · $x^2$');
    expect(keyOf(doc)).toEqual(['- (1) 4', '- (2) $x^2$', '- (3) carré']);
  });

  it('code : liste imbriquée gardée, commentaire « # Correction » jamais pris pour un titre, bloc refermé avant la banque', () => {
    const doc = buildClozeDocument([
      'Le [[tableau]] est parcouru.', '', '```python', '# Correction automatique', 'm = [[0, 1]]', 'for i in [[range]](3):', '', '    print(i)', '```', '',
      'La [[boucle]] parcourt.',
    ].join('\n'), { withKey: true });
    expect(doc).toContain(`\`\`\`python\n# Correction automatique\nm = [[0, 1]]\nfor i in ${blank(2)}(3):\n\n    print(i)\n\`\`\``);
    expect(doc).toContain(`La ${blank(3)} parcourt.\n\n### Banque de mots\n\nboucle · range · tableau`);
    expect(doc.trimEnd().endsWith('### Corrigé\n\n- (1) tableau\n- (2) range\n- (3) boucle')).toBe(true);
    // Dernier blanc dans le code : banque après la fermeture du bloc.
    const last = buildClozeDocument('```python\nfor i in [[range]](3):\n\n    print(i)\n```\nSuite.', { withKey: false });
    expect(last).toContain('    print(i)\n```\nSuite.\n\n### Banque de mots');
  });

  it('« _ » et « * » d’une réponse gardés (« est_pair », « __init__ », « 3 * 4 ») ; seul le gras autour du mot est retiré', () => {
    const doc = buildClozeDocument('La fonction [[est_pair]] teste ; la méthode [[__init__]] crée ; on calcule [[3 * 4]] ; le chat [[**dort**]].', { withKey: true });
    expect(keyOf(doc)).toEqual(['- (1) est_pair', '- (2) `__init__`', '- (3) 3 * 4', '- (4) dort']);
    expect(bankOf(doc)).toBe('`__init__` · 3 * 4 · dort · est_pair');
  });

  it('doubles crochets restés seuls (marque trop longue ou jamais fermée) : retirés du document', () => {
    const doc = buildClozeDocument('Le [[chat]] dort. [[La voisine qui habite au bout de la rue garde toujours son chat noir]] ; fin [[ouverte', { withKey: false });
    expect(doc).toContain(`Le ${blank(1)} dort. La voisine qui habite au bout de la rue garde toujours son chat noir ; fin ouverte`);
    expect(doc).not.toContain('[[');
  });
});

describe('pipeline : texte à trous', () => {
  const REQ = validateGenerationRequest({
    type: 'exercices', niveau: '5eme', matiere: 'svt', sujet: 'La respiration', researchMode: 'documents',
    modalite: 'texte_trous', nombreExercices: 5,
  }) as GenerationRequest;

  it('demande reconnue seulement pour le format texte à trous (exercices, évaluation)', () => {
    expect(REQ.modalite).toBe('texte_trous');
    expect(isClozeRequest(REQ)).toBe(true);
    expect(isClozeRequest({ type: 'evaluation', modalite: 'texte_trous' })).toBe(true);
    expect(isClozeRequest({ type: 'exercices', modalite: 'qcm' })).toBe(false);
    expect(isClozeRequest({ type: 'cours', modalite: 'texte_trous' })).toBe(false);
  });

  it('consignes : marquer les mots entre doubles crochets, sans écrire ni blancs, ni banque, ni corrigé', () => {
    const sys = buildSystemPrompt(REQ, false);
    expect(sys).toMatch(/EXACTEMENT 5 mots à compléter, chacun entre doubles crochets/);
    expect(sys).toMatch(/« Le chat \[\[dort\]\] sur le canapé pendant que le \[\[chien\]\] joue\. »/);
    expect(sys).toMatch(/ajoute la banque de mots et le corrigé : ne les écris pas/);
    expect(sys).toMatch(/des doubles crochets \[\[ … \]\] autour de chaque mot à faire trouver/);
    expect(sys).not.toMatch(/N'utilise des crochets \[ … \] que pour/);
    expect(sys).not.toMatch(/Termine par une partie « Corrigé »/);
    expect(buildUserPrompt(REQ, [])).toMatch(/- Nombre de mots à compléter : 5/);
    // Les autres formats gardent la règle habituelle des crochets.
    const qcm = buildSystemPrompt({ ...REQ, modalite: 'qcm' }, false);
    expect(qcm).toMatch(/N'utilise des crochets \[ … \] que pour/);
    expect(qcm).toMatch(/Termine par une partie « Corrigé »/);
  });

  it('affichage en direct sans marque ; document final et historique avec banque de mots et corrigé alignés', async () => {
    const saved: NewGenerationRecord[] = [];
    const events = await collect(runGeneration(REQ, {
      provider: new MockProvider({ reply: `### Texte\n\n${TEXT}`, chunkSize: 5 }),
      save: async record => {
        saved.push(record);
        return { id: 'gen_trous' };
      },
    }));
    const deltas = events.filter((e): e is Extract<GenerationEvent, { type: 'delta' }> => e.type === 'delta').map(e => e.text).join('');
    expect(deltas).not.toMatch(/\[\[|\]\]/);
    expect(deltas).toContain(blank(4));
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.content).toContain('### Banque de mots\n\nbranchies · énergie · poumons · stomates');
    expect(done.content).toMatch(/### Corrigé\n\n- \(1\) énergie\n- \(2\) branchies\n- \(3\) poumons\n- \(4\) stomates/);
    expect(saved[0].contenu).toBe(done.content);
  });

  it('version élève seule : aucun corrigé dans le document final', async () => {
    const events = await collect(runGeneration({ ...REQ, sansCorrige: true }, { provider: new MockProvider({ reply: TEXT }) }));
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.content).toContain('### Banque de mots');
    expect(done.content).not.toContain('Corrigé');
  });

  it('autre format : texte du modèle inchangé (aucune transformation)', async () => {
    const events = await collect(runGeneration({ ...REQ, modalite: 'application' }, { provider: new MockProvider({ reply: 'Écris [[x]].' }) }));
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.content).toBe('Écris [[x]].');
  });
});
