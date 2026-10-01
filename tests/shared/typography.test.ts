// Typographie française du document final : espaces insécables avant « : ; ! ? » et dans les guillemets « ».

import { describe, expect, it } from 'vitest';
import { finalizeCitations } from '../../shared/citations';
import { normalizeFrenchTypography as fr } from '../../shared/typography';
import { checkOutputStructure } from '../../shared/outputChecks';
import type { GenerationRequest, SourceRef } from '../../shared/types';

const NB = ' ';

describe('normalizeFrenchTypography', () => {
  it('espace insécable avant « : », « ; », « ! » et « ? »', () => {
    expect(fr('Corrigé : B')).toBe(`Corrigé${NB}: B`);
    expect(fr('Vraiment ? Oui ! Peut-être ; non.')).toBe(`Vraiment${NB}? Oui${NB}! Peut-être${NB}; non.`);
    expect(fr('**Corrigé** : B et **Réponse :** C')).toBe(`**Corrigé**${NB}: B et **Réponse${NB}:** C`);
    expect(fr('Fin :')).toBe(`Fin${NB}:`);
    // Plusieurs espaces ou tabulations : une seule espace insécable.
    expect(fr('mot  \t: suite')).toBe(`mot${NB}: suite`);
  });

  it('espaces insécables à l’intérieur des guillemets français', () => {
    expect(fr('Il dit « mot » puis « autre chose ».')).toBe(`Il dit «${NB}mot${NB}» puis «${NB}autre chose${NB}».`);
    // Rien n'est inséré quand il n'y a pas d'espace.
    expect(fr('« mot » et «mot»')).toBe(`«${NB}mot${NB}» et «mot»`);
  });

  it('laisse intacts code, formules, adresses, tableaux, citations, HTML et heures', () => {
    const samples = [
      '`a : b ?` et ```x : y``` ',
      '```python\nx = f(a : b)\nprint("a : b !")\n```',
      '$a : b ?$ puis $$x : y$$ et \\(c : d\\) et \\[e : f\\]',
      'Voir https://exemple.fr/page?x=1 ! ou www.exemple.fr/a?b=c ;',
      '| Colonne | Autre |\n| :--- | :---: |\n| a | b |',
      '12:30 puis 5:3, (1) ________ et [S1] [S2, S3]',
      '![x](https://exemple.fr/a?b=1) et [texte](https://exemple.fr/a?b=c)',
      '<span title="a : b ?">x</span>',
    ];
    for (const sample of samples) expect(fr(sample)).toBe(sample);
    // Le reste de la même ligne est bien traité.
    expect(fr('`a : b` et mot : x')).toBe(`\`a : b\` et mot${NB}: x`);
  });

  it('idempotente', () => {
    const text = '## Titre : un\n\nCorrigé : B ; « mot » ?\n\n```\nc : d\n```\n\n| :--- |\n| a : b |\n\nhttps://a.fr/?x ! fin';
    const once = fr(text);
    expect(fr(once)).toBe(once);
    expect(once).not.toBe(text);
  });

  it('un texte sans ponctuation à espacer est rendu tel quel', () => {
    expect(fr('Texte simple, sans rien.\n\n- liste\n- 12:30')).toBe('Texte simple, sans rien.\n\n- liste\n- 12:30');
    expect(fr('')).toBe('');
  });

  it('la vérification des citations et le contrôle du nombre d’éléments donnent le même résultat avec ou sans insécables', () => {
    const provided: SourceRef[] = [{ n: 1, kind: 'document', title: 'c.pdf', docName: 'c.pdf', locator: { type: 'pages', start: 1, end: 2 } }];
    const plain = '### Exercice 1\n\nCorrigé : B [S1]\n\n### Exercice 2\n\nVrai ? Oui [S1]';
    const typeset = fr(plain);
    expect(typeset).not.toBe(plain);
    const a = finalizeCitations(plain, provided, { flagUncited: true });
    const b = finalizeCitations(typeset, provided, { flagUncited: true });
    expect(b.content.replaceAll(NB, ' ')).toBe(a.content);
    expect(b.used).toEqual(a.used);
    const req: GenerationRequest = { type: 'exercices', niveau: '4eme', matiere: 'mathematiques', sujet: 'Calcul', researchMode: 'documents', nombreExercices: 3 };
    expect(checkOutputStructure(req, typeset)).toEqual(checkOutputStructure(req, plain));
  });
});
