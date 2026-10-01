// Texte à trous construit par Magistra : le modèle marque les mots à trouver ([[mot]]) ; Magistra pose les blancs
// numérotés, la banque de mots et le corrigé, alignés, au fil de la rédaction comme dans le document final.

import katex from 'katex';
import type { Nodes } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/lib/export/markdown';
import { MockProvider } from '../../shared/ai/mock';
import { buildCloze, buildClozeDocument, CLOZE_BLANK, ClozeStream, clozeWarning, isClozeRequest } from '../../shared/cloze';
import { unwrapDocumentFence } from '../../shared/markdownFence';
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

// ─── Correctifs de la revue : corrigé du modèle, formules, crochets, pointillés, titres étrangers ─────────────────

/** Tout ce qui suit la ligne de la banque de mots de Magistra (là où aucune réponse ne doit rester, version élève). */
const afterBank = (doc: string) => doc.split('### Banque de mots\n\n')[1]?.split('\n').slice(1).join('\n') ?? '';

function nodesOf(tree: Nodes, type: string): Nodes[] {
  const found: Nodes[] = tree.type === type ? [tree] : [];
  const children = 'children' in tree ? (tree.children as Nodes[]) : [];
  return found.concat(...children.map(child => nodesOf(child, type)));
}

/** Formules du document tel qu'affiché (MarkdownView, export PDF) : chacune doit passer KaTeX sans erreur. */
function renderedFormulas(doc: string): string[] {
  const tree = parseMarkdown(doc);
  return [...nodesOf(tree, 'inlineMath'), ...nodesOf(tree, 'math')].map(node => (node as { value: string }).value);
}

const MATH_BLANK = '\\_'.repeat(8);

/** Découpages du flux : un seul morceau, chaque coupure possible, un caractère à la fois (même résultat). */
function everyCut(text: string, max?: number): { out: string; words: string[] } {
  const whole = streamed(text, [], max);
  for (let i = 1; i < text.length; i++) expect(streamed(text, [i], max).out, `coupure à ${i}`).toBe(whole.out);
  expect(streamed(text, Array.from({ length: text.length - 1 }, (_, i) => i + 1), max).out).toBe(whole.out);
  return whole;
}

describe('corrigé du modèle « Corrigé et barème », points, version élève seule', () => {
  const P = 'Les plantes vertes réalisent la [[photosynthèse]] grâce à la [[lumière]] captée par les feuilles ; '
    + 'l’eau est puisée par les [[racines]].';
  const ANSWERS = /photosynth|lumière|racines/i;

  const cases: [string, string][] = [
    ['liste avec points', '## Corrigé et barème\n\n1. photosynthèse (1 pt)\n2. lumière (1 pt)\n3. racines (1 pt)'],
    ['tableau avec colonne de points', '## Corrigé et barème\n\n| N° | Réponse | Points |\n|---|---|---|\n| 1 | photosynthèse | 1 |\n| 2 | lumière | 1 |\n| 3 | racines | 1 |'],
    ['« (1) … → 1 point »', '## Corrigé et barème\n\n- (1) photosynthèse → 1 point\n- (2) lumière → 1 point\n- (3) racines → 1 point'],
    ['barème annoncé en étiquette avant les réponses', '## Corrigé et barème\n\n**Barème :** 1 point par mot juste.\n\n1. photosynthèse\n2. lumière\n3. racines'],
    ['critères de réussite', '### Corrigé et critères de réussite\n\n- photosynthèse – 1 pt\n- lumière – 1 pt\n- racines – 1 pt'],
    ['« mot : 1 point »', '## Corrigé\n\n- photosynthèse : 1 point\n- lumière : 1 point\n- racines : 1 point'],
  ];

  it.each(cases)('version élève seule (%s) : aucune réponse après la banque', (_, key) => {
    const doc = buildClozeDocument(`${P}\n\n${key}`, { max: 3, withKey: false });
    expect(bankOf(doc)).toBe('lumière · photosynthèse · racines');
    expect(afterBank(doc)).not.toMatch(ANSWERS);
    expect(doc).not.toMatch(/Corrigé|- \(1\)/);
  });

  it.each(cases)('version avec corrigé (%s) : réponses du modèle retirées, corrigé de Magistra une seule fois', (_, key) => {
    const doc = buildClozeDocument(`${P}\n\n${key}`, { max: 3, withKey: true });
    expect(doc).not.toMatch(/\(1 pt\)|→ 1 point|\| photosynthèse \||^\d\. photosynthèse|– 1 pt/m);
    expect(keyOf(doc)).toEqual(['- (1) photosynthèse', '- (2) lumière', '- (3) racines']);
  });

  it('le barème en étiquette reste (sans réponse), dans les deux versions', () => {
    const key = '## Corrigé et barème\n\n**Barème :** 1 point par mot juste.\n\n1. photosynthèse\n2. chlorophylle\n3. racines';
    expect(buildClozeDocument(`${P}\n\n${key}`, { withKey: false })).toContain('**Barème :** 1 point par mot juste.');
    const doc = buildClozeDocument(`${P}\n\n${key}`, { withKey: true });
    expect(doc).toContain('## Corrigé et barème\n\n**Barème :** 1 point par mot juste.\n\n- (1) photosynthèse');
    // Réponse fausse du modèle retirée avec les bonnes.
    expect(doc).not.toMatch(/chlorophylle/);
  });

  it('« Correction et remédiation » : texte complété retiré de la version élève, la remédiation reste', () => {
    const mixed = `${P}\n\n## Correction et remédiation\n\nLes plantes vertes réalisent la **photosynthèse** grâce à la **lumière**.\n`
      + 'L’eau est puisée par les **racines**.\n\n1. photosynthèse : fabrication de matière organique.\n\n'
      + 'Remédiation : revoir le schéma des échanges de la feuille.';
    const student = buildClozeDocument(mixed, { withKey: false });
    expect(afterBank(student)).not.toMatch(ANSWERS);
    expect(student).toContain('## Correction et remédiation');
    expect(student).toContain('Remédiation : revoir le schéma des échanges de la feuille.');
    const teacher = buildClozeDocument(mixed, { withKey: true });
    expect(teacher).toContain('Remédiation : revoir le schéma des échanges de la feuille.');
    expect(keyOf(teacher)).toEqual(['- (1) photosynthèse', '- (2) lumière', '- (3) racines']);
  });

  it('pipeline, sans corrigé : la partie « Corrigé et barème » du modèle ne passe pas dans le document final', async () => {
    const req = validateGenerationRequest({
      type: 'evaluation', niveau: '5eme', matiere: 'svt', sujet: 'La nutrition des plantes', researchMode: 'documents',
      modalite: 'texte_trous', nombreExercices: 3, sansCorrige: true,
    }) as GenerationRequest;
    const reply = `${P}\n\n## Corrigé et barème\n1. photosynthèse (1 pt)\n2. lumière (1 pt)\n3. racines (1 pt)`;
    const events = await collect(runGeneration(req, { provider: new MockProvider({ reply, chunkSize: 7 }) }));
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(afterBank(done.content)).not.toMatch(ANSWERS);
  });

  it('points annoncés : un corrigé par partie (« (2 pts) ») est remplacé une seule fois, sans ligne du modèle', () => {
    const text = 'La [[photosynthèse]] a lieu dans les [[chloroplastes]] grâce à la [[chlorophylle]] et au [[dioxyde de carbone]].';
    const doc = buildClozeDocument(`${text}\n\n## Corrigé\n**Partie 1**\n1. photosynthèse (2 pts)\n2. chloroplastes (2 pts)\n\n`
      + '**Partie 2**\n3. chlorophylle\n4. dioxyde de carbone (4 pts)', { withKey: true });
    expect(doc).not.toMatch(/pts\)|\*\*Partie 1\*\*/);
    expect(keyOf(doc)).toEqual(['- (1) photosynthèse', '- (2) chloroplastes', '- (3) chlorophylle', '- (4) dioxyde de carbone']);
  });

  it('étiquette de corrigé avec une réponse fausse : retirée, la suite du corrigé reste', () => {
    const T = 'La plante produit de l’[[énergie]] grâce à la [[lumière]]. Le poisson respire par des [[branchies]].';
    const doc = buildClozeDocument(`${T}\n\n**Corrigé :** énergie, feuilles, branchies\nQuestion 2 : les branchies captent le dioxygène.`, { withKey: true });
    expect(doc).not.toMatch(/feuilles/);
    expect(doc).toContain('Question 2 : les branchies captent le dioxygène.');
    expect(keyOf(doc)).toEqual(['- (1) énergie', '- (2) lumière', '- (3) branchies']);
    // Partie mêlée d'une version avec corrigé : une ligne qui ne donne pas que des réponses reste.
    const mixed = buildClozeDocument(`${T}\n\n## Correction et remédiation\n\n- énergie, confusion fréquente avec le dioxygène chez les élèves`, { withKey: true });
    expect(mixed).toContain('- énergie, confusion fréquente avec le dioxygène chez les élèves');
  });
});

describe('titres du cours jamais pris pour un corrigé (« Réponse de… », « Solution de… »)', () => {
  const SVT = '## L’effort physique\n\nPendant un effort, les muscles consomment plus de [[dioxygène]] et de [[glucose]].\n\n'
    + '## Réponse de l’organisme à l’effort\n\nLe cœur bat plus [[vite]] et la respiration [[s’accélère]] pour apporter plus de dioxygène.\n\n'
    + '## Compétences travaillées\n\n- Mettre en relation des données.';

  it('SVT : la partie reste un texte à trous, dans les deux versions', () => {
    const student = buildCloze(SVT, { withKey: false });
    expect(student.words).toEqual(['dioxygène', 'glucose', 'vite', 's’accélère']);
    expect(student.content).toContain('## Réponse de l’organisme à l’effort');
    const teacher = buildCloze(SVT, { withKey: true });
    expect(teacher.words).toHaveLength(4);
    expect(teacher.content).toContain(`## Réponse de l’organisme à l’effort\n\nLe cœur bat plus ${blank(3)} et la respiration ${blank(4)} pour`);
    expect(teacher.content.split('### Banque de mots')[0]).not.toMatch(/vite|s’accélère/);
    expect(teacher.content.trimEnd().endsWith('### Corrigé\n\n- (1) dioxygène\n- (2) glucose\n- (3) vite\n- (4) s’accélère')).toBe(true);
    // Sous « Réponses », le texte complété du modèle (mêmes mots marqués que plus haut) reste son corrigé.
    const completed = buildCloze(`${SVT}\n\n## Réponses\n\nPendant un effort, les muscles consomment plus de [[dioxygène]] et de [[glucose]].`, { withKey: false });
    expect(completed.words).toHaveLength(4);
    expect(completed.content).not.toContain('## Réponses');
  });

  it('chimie : « Solution de sulfate de cuivre », « Correction de la vision » restent du cours ; un vrai corrigé sous un titre qui nomme l’exercice reste reconnu', () => {
    const doc = buildCloze('Le [[soluté]] est dissous.\n\n## Solution de sulfate de cuivre\n\nElle est [[bleue]] et contient des ions [[cuivre]].\n\n'
      + '## Correction de la vision\n\nUne lentille [[convergente]] corrige l’hypermétropie de l’œil.', { withKey: false });
    expect(doc.words).toEqual(['soluté', 'bleue', 'cuivre', 'convergente']);
    expect(doc.content).toContain('## Solution de sulfate de cuivre');
    expect(doc.content).toContain('## Correction de la vision');

    const T = 'La plante produit de l’[[énergie]] grâce à la [[lumière]].';
    for (const title of ['## Réponses de l’exercice', '## Solutions du texte à trous', '## Correction de l’exercice 1', '## Réponses aux questions']) {
      const key = buildClozeDocument(`${T}\n\n${title}\n\n1. énergie\n2. lumière`, { withKey: true });
      expect(key, title).not.toMatch(/^1\. énergie/m);
      expect(key, title).not.toContain(title);
      expect(keyOf(key), title).toEqual(['- (1) énergie', '- (2) lumière']);
    }
  });
});

describe('titres en anglais, espagnol, allemand, avec émoji', () => {
  const T = 'Every day, Tom [[wakes up]] at seven. He [[brushes]] his teeth and [[takes]] the bus.';

  it.each([
    ['**Answers:** + liste', `${T}\n\n**Answers:**\n1. wakes up\n2. brushes\n3. takes`],
    ['### Answer Key', `${T}\n\n### Answer Key\n\n1. wakes up\n2. brushes\n3. takes`],
    ['### Respuestas', `${T}\n\n### Respuestas\n\n1. wakes up\n2. brushes\n3. takes`],
    ['### Lösungen', `${T}\n\n### Lösungen\n\n- wakes up\n- brushes\n- takes`],
    ['### ✅ Corrigé', `${T}\n\n### ✅ Corrigé\n\n- wakes up\n- brushes\n- takes`],
    ['**Answers:** 1. [[…]]', `${T}\n\n**Answers:** 1. [[wakes up]] 2. [[brushes]] 3. [[takes]]`],
    ['**Word bank:** avant le texte', `**Word bank:** [[wakes up]] – [[brushes]] – [[takes]]\n\n${T}`],
    ['### Word bank', `### Word bank\n\nwakes up · brushes · takes\n\n${T}`],
  ])('version élève seule : sa partie « %s » est retirée', (_, output) => {
    const doc = buildCloze(output, { max: 3, withKey: false });
    expect(doc.words).toEqual(['wakes up', 'brushes', 'takes']);
    expect(doc.content.startsWith(`Every day, Tom ${blank(1)} at seven.`)).toBe(true);
    expect(bankOf(doc.content)).toBe('brushes · takes · wakes up');
    expect(afterBank(doc.content)).not.toMatch(/wakes|brushes|takes|Answer|Respuestas|Lösungen|Corrigé|Word bank/);
  });

  it('« Key vocabulary », « **Key:** the key opens the door. » gardés ; « **Key:** » suivi des réponses retiré', () => {
    const doc = buildClozeDocument(`### Key vocabulary\n\n- a key, a lock\n\n**Key:** the key opens the door.\n\n${T}\n\n**Key:** wakes up, brushes, takes`, { withKey: false });
    expect(doc).toContain('### Key vocabulary\n\n- a key, a lock');
    expect(doc).toContain('**Key:** the key opens the door.');
    expect(afterBank(doc)).not.toMatch(/Key|wakes/);
  });
});

describe('mots en gras : numéros jamais pris pour des mots à trouver', () => {
  const VERBS = '**Consigne :** Conjugue les verbes au présent.\n\n**1.** Nous [[mangeons]] une pomme.\n**2.** Vous [[finissez]] vos devoirs.\n**3.** Ils [[prennent]] le bus.';

  it('« **1.** » en tête de ligne gardé ; numéros du direct et du document final identiques', () => {
    const doc = buildCloze(VERBS, { max: 10, withKey: true });
    expect(doc.words).toEqual(['mangeons', 'finissez', 'prennent']);
    expect(doc.content).toContain(`**1.** Nous ${blank(1)} une pomme.`);
    expect(doc.content).toContain(`**3.** Ils ${blank(3)} le bus.`);
    expect(streamed(VERBS, [], 10).words).toEqual(doc.words);
  });

  it('« **a)** », « **(2)** », « **Exemple 1** », « **Phrase 2 –** » : jamais des blancs', () => {
    const text = '**a)** Le [[chat]] dort.\n**(2)** Le [[chien]] joue.\n**Exemple 1** Le lapin **mange**.\n**Phrase 2 –** La [[souris]] court.';
    expect(buildCloze(text, { withKey: true }).words).toEqual(['chat', 'chien', 'mange', 'souris']);
    // Aucun mot marqué : seuls les mots en gras du texte deviennent des blancs.
    expect(buildCloze('**1.** Le **chat** dort sur le canapé.\n**2.** Le chien joue.', { withKey: true }).words).toEqual(['chat']);
  });
});

describe('blancs écrits en pointillés par le modèle', () => {
  const DOTTED = '**Banque de mots :** lumière – chlorophylle – dioxygène\n\n'
    + 'Les plantes vertes utilisent l’énergie de la ……………… pour fabriquer leur matière. Ce processus s’appelle la **photosynthèse**. '
    + 'Il a lieu grâce à la ……………… et libère du ………………\n\n**Corrigé :** 1. lumière 2. chlorophylle 3. dioxygène';

  it('pointillés « ……… » ou « (1) .......... » : document gardé tel quel, sans avertissement ; points de suspension, lignes de réponse et champs « Nom : ……… » n’en sont pas', () => {
    const doc = buildCloze(DOTTED, { max: 3, withKey: false });
    expect(doc).toEqual({ content: DOTTED, words: [] });
    expect(clozeWarning(doc, 3)).toBeNull();
    const numbered = DOTTED.replace('de la ………………', 'de la (1) ..............');
    expect(buildCloze(numbered, { withKey: true })).toEqual({ content: numbered, words: [] });

    for (const intro of ['Il réfléchit… puis répond...', 'Nom : ……………… Prénom : ………………', 'Réponse : ………………', '1. ……………………']) {
      const bold = buildCloze(`${intro}\n\nLes plantes réalisent la **photosynthèse** grâce à la **lumière**.`, { withKey: true });
      expect(bold.words, intro).toEqual(['photosynthèse', 'lumière']);
    }
  });
});

describe('formules « \\( … \\) », « \\[ … \\] », « $ \\frac… $ » et montants', () => {
  const FORMULAS = [
    'Pour tout réel \\(x\\), on a \\( (x+1)^2 = x^2 + [[2x]] + 1 \\).',
    '\\[\n\\frac{[[3]]}{4} + \\frac{1}{4} = 1\n\\]',
    'On calcule $ \\frac{[[3]]}{4} + \\frac{1}{4} = 1 $.',
    'On a \\(x = [[5]]\\) et \\[ 3 \\times 4 = [[12]] \\] puis $$\\sqrt{[[9]]}$$.',
    'Le périmètre vaut $ 2 \\pi r = [[2\\pi r]] $.',
  ];

  it.each(FORMULAS)('blanc lisible par KaTeX, à l’écran comme à l’export : %s', text => {
    const doc = buildClozeDocument(text, { withKey: true });
    expect(doc).toContain(`(1) ${MATH_BLANK}`);
    expect(doc).not.toContain(`(1) ${CLOZE_BLANK}`);
    for (const tex of renderedFormulas(doc)) {
      expect(() => katex.renderToString(tex, { throwOnError: true }), tex).not.toThrow();
    }
    everyCut(text);
  });

  it('mot d’une formule : écrit en formule dans la banque et le corrigé', () => {
    const doc = buildClozeDocument(FORMULAS[4], { withKey: true });
    expect(bankOf(doc)).toBe('$2\\pi r$');
    expect(keyOf(doc)).toEqual(['- (1) $2\\pi r$']);
  });

  it('montants (« $2 … $3 », « $5, …, $10 », « 5 $ et 10 $ ») : blanc du texte, sans barre oblique affichée', () => {
    for (const text of [
      'It costs $2 and the [[ride]] costs $3 more than the [[bus]].',
      'Prices: $5, [[cheap]], $10.',
      'Prix : 5 $ pour le [[cahier]] et 10 $ pour le livre.',
    ]) {
      const doc = buildClozeDocument(text, { withKey: false });
      expect(doc, text).toContain(`(1) ${CLOZE_BLANK}`);
      expect(doc, text).not.toContain('\\_');
      expect(renderedFormulas(doc), text).toEqual([]);
      everyCut(text);
    }
    // Une vraie formule reste une formule.
    expect(buildClozeDocument('$x = [[5]]$ et $[[y]]$2', { withKey: false })).toContain(`$x = (1) ${MATH_BLANK}$`);
  });
});

describe('crochets en trop, marque vide', () => {
  it.each(['[[[dort]]]', '[[[dort]]', '[[dort]]]'])('« %s » : un blanc, aucun crochet restant, à toute coupure', mark => {
    const text = `Le chat ${mark} sur le canapé et le [[chien]] joue.`;
    const doc = buildCloze(text, { withKey: false });
    expect(doc.words).toEqual(['dort', 'chien']);
    expect(doc.content).toContain(`Le chat ${blank(1)} sur le canapé et le ${blank(2)} joue.`);
    expect(doc.content).not.toMatch(/[[\]]/);
    expect(everyCut(text).words).toEqual(['dort', 'chien']);
  });

  it('« [[]] » retiré ; « [[[0]]] » dans du code et « [voir [[mot]]] » gardés', () => {
    expect(buildClozeDocument('Le chat [[]] dort et le [[chien]] joue.', { withKey: false })).not.toContain(']]');
    const code = buildClozeDocument('Le [[tableau]] :\n\n```python\nm = [[[0]]]\n```', { withKey: false });
    expect(code).toContain('m = [[[0]]]');
    expect(buildClozeDocument('Le chat dort [voir le [[panier]]] ici.', { withKey: false })).toContain(`[voir le ${blank(1)}] ici.`);
  });
});

describe('corrigé en gras après chaque exercice', () => {
  const TWO = '**Exercice 1**\nLe [[chat]] dort sur le [[canapé]] du salon depuis ce matin.\n\n**Corrigé**\n1. chat\n2. canapé\n\n'
    + '**Exercice 2**\nLe [[chien]] joue avec la [[balle]] rouge dans le jardin.\n\n**Corrigé**\n1. chien\n2. balle';

  it.each([
    ['**Exercice 2**', '\n', TWO],
    ['**Exercice 2 : les animaux**', '\n', TWO.replace('**Exercice 2**', '**Exercice 2 : les animaux**')],
    ['**Exercice 2**', '\n\n', TWO.replace('**Exercice 2**\n', '**Exercice 2**\n\n')],
  ])('%s n’est pas avalé par le corrigé qui le précède', (title, gap, text) => {
    const student = buildCloze(text, { withKey: false });
    expect(student.words).toEqual(['chat', 'canapé', 'chien', 'balle']);
    expect(bankOf(student.content)).toBe('balle · canapé · chat · chien');
    expect(student.content).toContain(`${title}${gap}Le ${blank(3)} joue avec la ${blank(4)}`);
    expect(afterBank(student.content)).not.toMatch(/chat|chien/);
    const teacher = buildClozeDocument(text, { withKey: true });
    expect(teacher).not.toContain('Le chien joue avec la balle');
    expect(keyOf(teacher)).toEqual(['- (1) chat', '- (2) canapé', '- (3) chien', '- (4) balle']);
    // Texte complété du modèle sur plusieurs lignes, sans titre entre elles : tout reste dans son corrigé.
    const completed = buildCloze(`${text}\n\n**Corrigé**\nLe [[chat]] dort sur le [[canapé]] du salon depuis ce matin.\n`
      + 'Le [[chien]] joue avec la [[balle]] rouge dans le jardin.', { withKey: false });
    expect(completed.words).toHaveLength(4);
    expect(afterBank(completed.content)).not.toMatch(/chat|chien/);
  });
});

describe('banque de mots : réponses actives en Markdown écrites en code', () => {
  it('opérateurs Python (« * », « ** », « - ») et expressions (« n*2 », « x**2 ») : une seule ligne, sans liste ni gras', () => {
    const doc = buildClozeDocument('En Python, `a [[*]] b` multiplie, `a [[**]] b` élève à la puissance, `a [[-]] b` soustrait, '
      + '`a [[//]] b` divise et `a [[%]] b` donne le reste.\n\n```python\nn = [[n*2]]\ni = [[i*i]]\nx = [[x**2]]\n```', { withKey: true });
    const line = bankOf(doc)!;
    const tree = parseMarkdown(line);
    expect(tree.children.map(child => child.type)).toEqual(['paragraph']);
    for (const type of ['emphasis', 'strong', 'list']) expect(nodesOf(tree, type), type).toHaveLength(0);
    const code = nodesOf(tree, 'inlineCode').map(node => (node as { value: string }).value);
    for (const word of ['*', '**', '-', 'n*2', 'i*i', 'x**2']) expect(code, word).toContain(word);
  });
});

describe('bloc de code dans un document entouré de « ```markdown »', () => {
  it('le direct garde le code intact et numérote comme le document final', () => {
    const text = '```markdown\nUne [[liste]] se parcourt.\n```python\nm = [[0, 1], [2, 3]]\nfor i in [[range]](3):\n```\n'
      + 'La fonction [[len]] donne la taille.\n```';
    const final = buildCloze(unwrapDocumentFence(text, { complete: true }), { withKey: true });
    for (const cuts of [[], Array.from({ length: Math.ceil(text.length / 3) }, (_, i) => (i + 1) * 3).filter(n => n < text.length)]) {
      const live = streamed(text, cuts);
      expect(live.out).toContain('m = [[0, 1], [2, 3]]');
      expect(live.words).toEqual(['liste', 'range', 'len']);
      expect(live.words).toEqual(final.words);
    }
  });
});

describe('temps de construction', () => {
  it('modèle qui boucle sur une étiquette (« Réponse : … », « Corrigé : … », « Solution : … ») : temps linéaire', () => {
    const inputs = [
      `Le [[chat]] dort.\n\n${'Réponse : le chat dort\n'.repeat(5000)}`,
      `${'Corrigé : le chat dort\n'.repeat(5000)}\nLe [[chat]] dort.`,
      'Solution : un mélange homogène\n'.repeat(3000),
      `Le [[chat]] dort.\n\n${'Le prix est de 5 $ ou \\( et \\[ ; '.repeat(1500)}`,
      `${'Le [[chat]] dort. **Corrigé** 1. chat\n---\n'.repeat(1500)}`,
      '[[[x '.repeat(8000),
    ];
    for (const input of inputs) {
      expect(input.length).toBeGreaterThan(30_000);
      const t0 = performance.now();
      buildCloze(input, { max: 20, withKey: true });
      buildCloze(input, { withKey: false });
      // Seuil absolu très large pour une machine chargée ou un démarrage à froid : seul un temps non borné le dépasse.
      expect(performance.now() - t0, input.slice(0, 40)).toBeLessThan(6000);
    }
  });
});

describe('temps de construction : longues suites d’espaces et de crochets', () => {
  const elapsed = (fn: () => void) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it('lignes d’espaces ou de tabulations (modèle qui boucle) : temps borné, quelle que soit la forme', () => {
    const base = 'Le [[chat]] dort.\n';
    // 190 espaces : sous le seuil de repli de buildCloze, c'est le motif lui-même qui est mis à l'épreuve
    // (un motif quadratique mettrait plusieurs secondes par ligne).
    const inputs = [
      `${base}${`${' '.repeat(190)}\n`.repeat(12)}Fin`,
      `${base}${`${'\t'.repeat(190)}x\n`.repeat(12)}Fin`,
      `${base}\n## Corrigé\n${`${' '.repeat(190)}:\n`.repeat(12)}Fin`,
      `${base}${' '.repeat(5000)}\nFin`,
      `${base}${' '.repeat(5000)}x\nFin`,
      `${base}${' '.repeat(5000)}:\nFin`,
      `${base}\n## Corrigé\n${' '.repeat(60_000)}x\nFin`,
      `${base}${'a  '.repeat(3000)}\nFin`,
    ];
    for (const input of inputs) {
      expect(elapsed(() => buildClozeDocument(input, { max: 10, withKey: true })), input.slice(0, 30)).toBeLessThan(3000);
    }
  });

  it('étiquettes et titres en gras toujours reconnus, avec ou sans espaces superflus', () => {
    for (const [plain, spaced] of [
      ['Corrigé : chat', 'Corrigé    :     chat'],
      ['**Corrigé** : chat', '  **Corrigé**\t\t :   chat'],
      ['**Corrigé**', '**Corrigé**     '],
    ]) {
      const a = buildClozeDocument(`Le [[chat]] dort.\n\n${plain}`, { max: 10, withKey: true });
      const b = buildClozeDocument(`Le [[chat]] dort.\n\n${spaced}`, { max: 10, withKey: true });
      // Le corrigé du modèle est remplacé par celui de Magistra, un seul : l'étiquette a bien été reconnue.
      expect(a.match(/Corrigé/g)).toHaveLength(1);
      expect(a).toContain('### Corrigé');
      expect(b).toBe(a);
    }
  });

  it('flux : des dizaines de milliers de « [ » poussés par petits morceaux (temps linéaire, texte conservé)', () => {
    const text = '['.repeat(100_000);
    const stream = new ClozeStream(10);
    let out = '';
    const ms = elapsed(() => {
      for (let i = 0; i < text.length; i += 20) out += stream.push(text.slice(i, i + 20));
      out += stream.end();
    });
    expect(ms).toBeLessThan(3000);
    expect(out).toBe(text);
  });

  it('flux : « [[[mot]]] » (crochets en trop) reste reconnu', () => {
    const stream = new ClozeStream();
    const out = stream.push('Le [[[chat]]] dort.') + stream.end();
    expect(stream.words).toEqual(['chat']);
    expect(out).toContain(blank(1));
    expect(out).not.toContain('[');
  });
});

describe('sortie réelle d’un petit modèle (Ministral 3B) : banque de mots en longue énumération', () => {
  it('« **Banque de mots** (…) : » suivi d’une liste terminée par un point : remplacée, jamais en double', () => {
    const raw = [
      '### **Exercice : La respiration**',
      '',
      'La respiration est un processus [[essentiel]] pour les êtres vivants. L’oxygène [[O₂]] est utilisé par les cellules.',
      '',
      '---',
      '',
      '**Banque de mots** (à afficher aux élèves après correction) :',
      '- O₂, CO₂, réaction chimique, alvéoles, échange gazeux, dioxyde de carbone, poumons, expiration.',
    ].join('\n');
    for (const withKey of [true, false]) {
      const doc = buildClozeDocument(raw, { max: 8, withKey });
      expect(doc.match(/Banque de mots/g), `withKey=${withKey}`).toHaveLength(1);
      expect(doc).not.toMatch(/dioxyde de carbone|à afficher aux élèves/);
      expect(doc).toMatch(/### Banque de mots\n\nessentiel · O₂/);
    }
  });
});
