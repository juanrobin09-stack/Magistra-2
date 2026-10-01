import { describe, expect, it } from 'vitest';
import { normalizeMathDelimiters } from '../../shared/markdownMath';

describe('normalizeMathDelimiters — formules \\( \\) et \\[ \\]', () => {
  it('\\( formule \\) → formule en ligne « $$…$$ » (espaces retirés)', () => {
    expect(normalizeMathDelimiters('Calcule \\( 3 \\times 4 \\) puis \\(\\frac{3}{4}\\).'))
      .toBe('Calcule $$3 \\times 4$$ puis $$\\frac{3}{4}$$.');
    expect(normalizeMathDelimiters('Soit \\(x^2\\) et \\(u_n\\).')).toBe('Soit $$x^2$$ et $$u_n$$.');
  });

  it('\\( nombre ou calcul simple \\) → texte simple (virgule décimale conservée)', () => {
    expect(normalizeMathDelimiters('Le résultat est \\(12\\).')).toBe('Le résultat est 12.');
    expect(normalizeMathDelimiters('On a \\( x = 3,5 \\) et \\(AB = 5\\) cm.')).toBe('On a x = 3,5 et AB = 5 cm.');
  });

  it('parenthèses échappées autour de texte : inchangées', () => {
    expect(normalizeMathDelimiters('Relis le texte \\(voir annexe\\).')).toBe('Relis le texte \\(voir annexe\\).');
  });

  it('\\[ formule \\] seule sur sa ligne → bloc « $$ » sur ses propres lignes', () => {
    expect(normalizeMathDelimiters('Résous :\n\\[ x^2+1=0 \\]\nPuis conclus.')).toBe('Résous :\n$$\nx^2+1=0\n$$\nPuis conclus.');
    expect(normalizeMathDelimiters('\\[ x + 1 = 0 \\]')).toBe('$$\nx + 1 = 0\n$$');
  });

  it('\\[ … \\] sur plusieurs lignes → un seul bloc, retrait conservé (élément de liste)', () => {
    expect(normalizeMathDelimiters('1. Calcule :\n   \\[\n   \\int_0^1 x\\,dx\n   = \\frac{1}{2}\n   \\]\n2. Suite'))
      .toBe('1. Calcule :\n   $$\n   \\int_0^1 x\\,dx\n   = \\frac{1}{2}\n   $$\n2. Suite');
  });

  it('\\[ formule \\] au milieu d’une ligne → formule en ligne', () => {
    expect(normalizeMathDelimiters('Soit \\[ f(x) = x^2 \\] sur ℝ.')).toBe('Soit $$f(x) = x^2$$ sur ℝ.');
  });

  it('crochets échappés sans formule : inchangés (\\[Date\\], \\[Source 1\\], \\[Nom de l’élève\\])', () => {
    const text = 'Le \\[Date\\], voir \\[Source 1\\] ; signé \\[Nom de l’élève\\].';
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it('$ formule $ avec espaces intérieurs → $formule$ ; montants en dollars inchangés', () => {
    expect(normalizeMathDelimiters('Formule $ \\frac{1}{2} $ ici.')).toBe('Formule $\\frac{1}{2}$ ici.');
    expect(normalizeMathDelimiters('Formule $\\sqrt{2} $.')).toBe('Formule $\\sqrt{2}$.');
    expect(normalizeMathDelimiters('Prix : 5 $ et 10 $.')).toBe('Prix : 5 $ et 10 $.');
    expect(normalizeMathDelimiters('Déjà juste : $x^2$ et $$\\frac{a}{b}$$.')).toBe('Déjà juste : $x^2$ et $$\\frac{a}{b}$$.');
  });

  it('jamais dans le code (bloc ou en ligne)', () => {
    const text = 'Voir `\\(x\\)` et `$ \\alpha $`.\n\n```latex\n\\[ x^2 \\]\n\\( \\frac{1}{2} \\)\n```\n\nFin \\(x^2\\).';
    expect(normalizeMathDelimiters(text)).toBe('Voir `\\(x\\)` et `$ \\alpha $`.\n\n```latex\n\\[ x^2 \\]\n\\( \\frac{1}{2} \\)\n```\n\nFin $$x^2$$.');
  });

  it('\\\\[2pt] d’un environnement aligned : jamais pris pour un délimiteur', () => {
    const text = '$$\n\\begin{aligned} a &= b \\\\[2pt] c &= d \\end{aligned}\n$$';
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it('idempotent, texte sans formule rendu tel quel', () => {
    const text = 'Calcule \\( 3 \\times 4 \\).\n\\[ x^2+1=0 \\]\nFormule $ \\frac{1}{2} $, \\(12\\), 5 $.';
    const once = normalizeMathDelimiters(text);
    expect(normalizeMathDelimiters(once)).toBe(once);
    expect(normalizeMathDelimiters('Aucun calcul ici.')).toBe('Aucun calcul ici.');
    expect(normalizeMathDelimiters('')).toBe('');
  });

  it('formule encore ouverte pendant la rédaction : laissée telle quelle jusqu’à sa fin', () => {
    expect(normalizeMathDelimiters('Soit \\[ x^2 + ')).toBe('Soit \\[ x^2 + ');
    expect(normalizeMathDelimiters('Soit \\( \\frac{1}')).toBe('Soit \\( \\frac{1}');
  });
});

describe('normalizeMathDelimiters — inégalités, blancs, pourcentages, citations', () => {
  it('inégalité « \\(a<b\\) » : toujours une formule, jamais du texte lu comme une balise HTML « <b et b> »', () => {
    expect(normalizeMathDelimiters('Si \\(a<b\\) et \\(b>0\\) alors \\(a<c\\).')).toBe('Si $$a<b$$ et $$b>0$$ alors $$a<c$$.');
    expect(normalizeMathDelimiters('On a \\( x > 2 \\) donc c > 0.')).toBe('On a $$x > 2$$ donc c > 0.');
    // Sans inégalité : texte simple, comme avant.
    expect(normalizeMathDelimiters('On a \\( x ≤ 3,5 \\).')).toBe('On a x ≤ 3,5.');
  });

  it('blanc d’un texte à trous dans une formule convertie : « \\_ » (jamais un indice refusé par KaTeX)', () => {
    const blank = '\\_'.repeat(8);
    expect(normalizeMathDelimiters('\\( 3 \\times 4 = (1) ________ \\)')).toBe(`$$3 \\times 4 = (1) ${blank}$$`);
    expect(normalizeMathDelimiters('\\(x = (2) ________\\)')).toBe(`$$x = (2) ${blank}$$`);
    expect(normalizeMathDelimiters('Le périmètre vaut $ 2 \\pi r = (3) ________ $.')).toBe(`Le périmètre vaut $2 \\pi r = (3) ${blank}$.`);
    expect(normalizeMathDelimiters('\\[ \\frac{(4) ________}{4} = 1 \\]')).toBe(`$$\n\\frac{(4) ${blank}}{4} = 1\n$$`);
    expect(normalizeMathDelimiters('Soit \\[ 3 + ___ = 5 \\] ici.')).toBe('Soit $$3 + \\_\\_\\_ = 5$$ ici.');
    // Déjà échappé, ou indice simple : inchangé.
    expect(normalizeMathDelimiters(`\\( x = (1) ${blank} \\)`)).toBe(`$$x = (1) ${blank}$$`);
    expect(normalizeMathDelimiters('\\( u_n + x_{1} \\)')).toBe('$$u_n + x_{1}$$');
  });

  it('« % » dans une formule convertie : « \\% » (jamais le début d’un commentaire qui coupe la formule)', () => {
    expect(normalizeMathDelimiters('Calcule \\( 20 % \\times 150 \\) puis conclus.')).toBe('Calcule $$20 \\% \\times 150$$ puis conclus.');
    expect(normalizeMathDelimiters('\\[ 20 % \\times 150 = 30 \\]')).toBe('$$\n20 \\% \\times 150 = 30\n$$');
    expect(normalizeMathDelimiters('Soit $ 15 % \\text{ de } 80 $.')).toBe('Soit $15 \\% \\text{ de } 80$.');
    // Déjà échappé : pas de double échappement ; calcul simple : texte, « % » littéral.
    expect(normalizeMathDelimiters('\\( 20 \\% \\times 150 \\)')).toBe('$$20 \\% \\times 150$$');
    expect(normalizeMathDelimiters('\\( 20 % de 150 \\)')).toBe('20 % de 150');
  });

  it('\\[ … \\] sur plusieurs lignes dans une citation : bloc « $$ » dans la citation, sans « > » dans la formule', () => {
    expect(normalizeMathDelimiters('> **Théorème de Pythagore**\n>\n> \\[\n> BC^2 = AB^2 + AC^2\n> \\]\n>\n> Suite.'))
      .toBe('> **Théorème de Pythagore**\n>\n> $$\n> BC^2 = AB^2 + AC^2\n> $$\n>\n> Suite.');
    expect(normalizeMathDelimiters('>> \\[\n>> a^2 = b\n>> \\]')).toBe('>> $$\n>> a^2 = b\n>> $$');
    // Au milieu d'une ligne de citation : formule en ligne, marqueurs des lignes suivantes retirés.
    expect(normalizeMathDelimiters('> Soit \\[ x^2\n> + 1 \\] ici.')).toBe('> Soit $$x^2 + 1$$ ici.');
    // Crochets échappés sans formule dans une citation : inchangés.
    expect(normalizeMathDelimiters('> \\[\n> Source\n> \\]')).toBe('> \\[\n> Source\n> \\]');
  });

  it('temps linéaire : « $ » suivi de milliers d’espaces, délimiteurs jamais fermés', () => {
    const time = (text: string) => {
      const start = performance.now();
      normalizeMathDelimiters(text);
      return performance.now() - start;
    };
    // Une recherche cubique dépasserait la seconde dès 2 000 espaces ; seuil absolu très large pour une machine chargée.
    const BOUND_MS = 3000;
    expect(time(`Prix : 5 $${' '.repeat(20_000)}|`)).toBeLessThan(BOUND_MS);
    // Même résultat qu'avant : espaces de tête ou de fin retirés d'une formule, montants inchangés.
    expect(normalizeMathDelimiters('Soit $ \\frac{1}{2} $ et 5 $ et 10 $.')).toBe('Soit $\\frac{1}{2}$ et 5 $ et 10 $.');
    expect(normalizeMathDelimiters('$\\alpha $ et $ \\beta$ et $\\gamma$')).toBe('$\\alpha$ et $\\beta$ et $\\gamma$');
    expect(normalizeMathDelimiters('Total : 12 $\t\t| 5 $')).toBe('Total : 12 $\t\t| 5 $');
    const n = 100_000;
    for (const text of [
      `Prix : 5 $${' '.repeat(n)}|`,
      `5 $${'\t'.repeat(n)}|`,
      '$ '.repeat(n / 2),
      '\\['.repeat(n / 2),
      '\\('.repeat(n / 2),
      `\\[${'a '.repeat(n / 2)}`,
      `> \\[${'\n>'.repeat(n / 2)}`,
    ]) {
      expect(time(text)).toBeLessThan(BOUND_MS);
    }
  });
});
