// Texte à trous construit par Magistra : le modèle marque les mots à trouver ([[mot]]) ; Magistra pose les blancs
// numérotés, la banque de mots et le corrigé, alignés, au fil de la rédaction comme dans le document final.

import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { buildClozeDocument, CLOZE_BLANK, ClozeStream, isClozeRequest } from '../../shared/cloze';
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
