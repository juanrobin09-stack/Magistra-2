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
