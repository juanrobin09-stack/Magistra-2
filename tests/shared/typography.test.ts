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

describe('normalizeFrenchTypography : sortie dégénérée', () => {
  const elapsed = (fn: () => void) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  // Un modèle qui boucle peut sortir des dizaines de milliers de blancs ou de débuts de balise sans fin : le temps doit
  // rester linéaire (quelques millisecondes ; seuil très large).
  const degenerate: Array<[string, string]> = [
    ['ligne d’espaces', `Corrigé : B\n${' '.repeat(100_000)}\nFin`],
    ['ligne de tabulations', `${'\t'.repeat(100_000)}x`],
    ['séparateur de tableau suivi d’espaces', `-- ${' '.repeat(100_000)}x`],
    ['séparateur de tableau suivi de tabulations', `--${'\t'.repeat(100_000)}x`],
    ['barre verticale suivie d’espaces', `|${' '.repeat(100_000)}x`],
    ['« <a » répété sans « > »', '<a'.repeat(60_000)],
    ['« <br » répété sans « > »', '<br'.repeat(40_000)],
    ['« \\( » jamais fermé', '\\('.repeat(100_000)],
    ['« \\[ » jamais fermé', '\\['.repeat(100_000)],
    ['« \\\\[ » (saut de ligne LaTeX) répété', '\\\\['.repeat(60_000)],
    ['« \\[ » suivi de « \\\\ » répétés', `\\[${'\\\\'.repeat(60_000)}`],
    ['« ]( » jamais fermé', ']('.repeat(100_000)],
  ];

  it.each(degenerate)('%s : temps borné', (_name, input) => {
    expect(input.length).toBeGreaterThanOrEqual(100_000);
    expect(elapsed(() => fr(input))).toBeLessThan(3000);
  });

  it('un saut de ligne LaTeX « \\\\[2pt] » ou « \\\\(b) » ne ferme ni n’ouvre une formule : elle reste protégée en entier', () => {
    const display = '\\[ f : x \\mapsto y \\\\[2pt] g : y \\mapsto z \\]';
    const inline = 'Soit \\( f : x \\mapsto y \\\\(b) g : y \\mapsto z \\) ici : fin';
    expect(fr(display)).toBe(display);
    expect(fr(inline)).toBe(`Soit \\( f : x \\mapsto y \\\\(b) g : y \\mapsto z \\) ici${NB}: fin`);
    expect(fr(`Voici : ${display} Fin : ok`)).toBe(`Voici${NB}: ${display} Fin${NB}: ok`);
  });

  it('une ligne d’espaces ne gêne pas le reste du texte', () => {
    const out = fr(`Corrigé : B\n${' '.repeat(100_000)}\nFin : C`);
    expect(out.startsWith(`Corrigé${NB}: B\n`)).toBe(true);
    expect(out.endsWith(`Fin${NB}: C`)).toBe(true);
  });

  it('lignes de séparation de tableau, avec ou sans espaces superflus : toujours protégées', () => {
    const rows = ['|---|---|', '| --- | --- |', '|   :---   |   ---:   |', '---|---', '  --  ', '\t:--:\t|\t:--:\t', ':---: | :---:'];
    for (const row of rows) expect(fr(`a ? b\n${row}\nc ? d`), row).toBe(`a${NB}? b\n${row}\nc${NB}? d`);
    // Une ligne qui n'est pas un séparateur reste du texte courant.
    expect(fr('a | -- | b : c')).toBe(`a | -- | b${NB}: c`);
  });

  it('balises, formules et destinations de liens complètes : toujours protégées', () => {
    const samples = [
      '<a href="https://exemple.fr/a?b=c : d">lien</a>',
      '<img src="x.png" alt="a : b ?" />',
      '\\(a : b ?\\) et \\[c : d !\\]',
      '\\[\nx : y ?\n\\]',
      '[texte](https://exemple.fr/a?b=c) et ![i](chemin/a : b.png)',
    ];
    for (const sample of samples) expect(fr(sample), sample).toBe(sample);
    // Une ouverture jamais fermée n'étend pas la protection au reste du texte.
    expect(fr('<a puis mot : fin')).toBe(`<a puis mot${NB}: fin`);
    expect(fr('\\( puis mot : fin')).toBe(`\\( puis mot${NB}: fin`);
    expect(fr('texte ]( puis mot : fin')).toBe(`texte ]( puis mot${NB}: fin`);
  });
});
