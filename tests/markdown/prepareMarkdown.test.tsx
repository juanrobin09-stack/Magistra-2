import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Nodes, Root } from 'mdast';
import MarkdownView from '@/components/MarkdownView';
import { parseMarkdown, prepareMarkdown, splitMarkdownBlocks } from '@/lib/export/markdown';
import { buildClozeDocument } from '@shared/cloze';
import katex from 'katex';

function render(content: string): string {
  return renderToStaticMarkup(<MarkdownView content={content} />);
}

function nodesOfType(tree: Nodes, type: string): Nodes[] {
  const found: Nodes[] = tree.type === type ? [tree] : [];
  const children = 'children' in tree ? (tree.children as Nodes[]) : [];
  return found.concat(...children.map(child => nodesOfType(child, type)));
}

describe('formules \\( \\) et \\[ \\] : écran et export PDF', () => {
  it('parseMarkdown : \\( 3 \\times 4 \\) devient une formule, \\(12\\) du texte', () => {
    const tree = parseMarkdown('Calcule \\( 3 \\times 4 \\) puis \\(12\\).');
    expect(nodesOfType(tree, 'inlineMath').map(n => (n as { value: string }).value)).toEqual(['3 \\times 4']);
    expect(JSON.stringify(tree)).not.toContain('\\\\(');
    expect(nodesOfType(tree, 'text').map(n => (n as { value: string }).value).join('')).toContain('puis 12.');
  });

  it('parseMarkdown : « $ \\frac{1}{2} $ » est une formule, « 5 $ et 10 $ » reste un montant', () => {
    expect(nodesOfType(parseMarkdown('Formule $ \\frac{1}{2} $'), 'inlineMath')).toHaveLength(1);
    const money = parseMarkdown('Prix : 5 $ et 10 $.');
    expect(nodesOfType(money, 'inlineMath')).toHaveLength(0);
  });

  it('\\[ … \\] sur plusieurs lignes : un seul bloc de formule à l’écran (jamais coupé en deux)', () => {
    const content = 'Résous :\n\n\\[\nx^2 + 1\n\n= 0\n\\]\n\nPuis conclus.';
    const prepared = prepareMarkdown(content);
    expect(splitMarkdownBlocks(prepared).filter(b => b.includes('$$'))).toHaveLength(1);
    const html = render(content);
    expect(html.match(/class="math-display"/g)).toHaveLength(1);
    expect(html).not.toContain('\\[');
    expect(nodesOfType(parseMarkdown(content), 'math')).toHaveLength(1);
  });

  it('MarkdownView : \\( \\frac{3}{4} \\) rendu par KaTeX dans les choix d’un QCM', () => {
    const html = render('**Question 1.** Quelle fraction ?\nA) \\( \\frac{3}{4} \\)\nB) \\( \\frac{1}{2} \\)');
    expect(html.match(/class="math-inline"/g)).toHaveLength(2);
    expect(html).toContain('<li dir="auto">A) <span class="math-inline">');
    expect(html).not.toContain('\\(');
  });
});

describe('mise en page des QCM et vrai/faux : écran et export PDF', () => {
  it('question puis 4 choix un par ligne → paragraphe + liste de 4 éléments', () => {
    const tree: Root = parseMarkdown('**Question 1.** Q ?\nA) 7\nB) 12\nC) 34\nD) 1');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'list']);
    expect(nodesOfType(tree, 'listItem')).toHaveLength(4);
    const html = render('**Question 1.** Q ?\nA) 7\nB) 12\nC) 34\nD) 1');
    expect(html).toContain('<li dir="auto">A) 7</li>');
    expect(html).toContain('<li dir="auto">D) 1</li>');
  });

  it('deux affirmations consécutives → deux paragraphes', () => {
    const tree = parseMarkdown('**1.** Le Soleil est une étoile. ☐ Vrai ☐ Faux\n**2.** La Lune brille seule. ☐ Vrai ☐ Faux');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('lignes en retrait : jamais de bloc de code créé par la mise en page', () => {
    for (const content of [
      'Corrigé :\n    **Question 1.** B\n    **Question 2.** A',
      'Corrigé :\n\t**Question 1.** B\n\t**Question 2.** A',
      '**Question 1.** Combien font 3 × 4 ?\n    A) 7\n    B) 12\n    Réponse : B',
      'Voir aussi\n10. Suite\n    **Question 11.** Combien ?',
    ]) {
      expect(nodesOfType(parseMarkdown(content), 'code')).toHaveLength(0);
    }
    // Dans un élément de liste : choix en liste et « Réponse » dans l'élément, toujours sans code.
    const nested = parseMarkdown('10. Combien font 3 × 4 ?\n    A) 7\n    B) 12\n    Réponse : B');
    expect(nodesOfType(nested, 'code')).toHaveLength(0);
    expect(nodesOfType(nested, 'listItem')).toHaveLength(3);
  });
});

describe('formules converties : jamais de texte perdu ni d’erreur KaTeX (écran et export PDF)', () => {
  const values = (tree: Nodes, type: string) => nodesOfType(tree, type).map(n => (n as { value: string }).value);
  const text = (tree: Nodes) => values(tree, 'text').join('');

  it('inégalités « \\(a<b\\) et \\(b>0\\) » : formules complètes, rien n’est pris pour une balise HTML', () => {
    const tree = parseMarkdown('Si \\(a<b\\) et \\(b>0\\) alors \\(a<c\\).');
    expect(values(tree, 'inlineMath')).toEqual(['a<b', 'b>0', 'a<c']);
    expect(text(tree)).toBe('Si  et  alors .');
    const prose = parseMarkdown('On a \\(a<b\\) donc c > 0.');
    expect(values(prose, 'inlineMath')).toEqual(['a<b']);
    expect(text(prose)).toBe('On a  donc c > 0.');
    expect(render('Comparer : \\(a<b\\) ou \\(a>b\\)').match(/class="math-inline"/g)).toHaveLength(2);
  });

  it('texte à trous en maths : chaque formule (\\( \\), \\[ \\], « $ … $ ») est valide pour KaTeX', () => {
    const model = [
      '1. \\( 3 \\times 4 = [[12]] \\)',
      '2. Pour tout réel \\(x\\), on a \\( (x+1)^2 = x^2 + [[2x]] + 1 \\).',
      '3. Le périmètre vaut $ 2 \\pi r = [[2\\pi r]] $.',
      '4. On a \\(x = [[5]]\\).',
      '',
      '\\[',
      '\\frac{[[3]]}{4} + \\frac{1}{4} = 1',
      '\\]',
    ].join('\n');
    const tree = parseMarkdown(buildClozeDocument(model, { max: 10, withKey: true }));
    const formulas = [...values(tree, 'inlineMath'), ...values(tree, 'math')];
    const blank = '\\_'.repeat(8);
    expect(formulas.filter(tex => tex.includes(blank))).toHaveLength(5);
    for (const tex of formulas) expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' })).not.toThrow();
  });

  it('« % » dans une formule convertie : la suite de la formule est affichée', () => {
    const [tex] = values(parseMarkdown('Calcule \\( 20 % \\times 150 \\) puis conclus.'), 'inlineMath');
    expect(tex).toBe('20 \\% \\times 150');
    expect(katex.renderToString(tex, { throwOnError: true })).toContain('150');
  });

  it('\\[ … \\] dans une citation : bloc de formule dans la citation, sans « > »', () => {
    const tree = parseMarkdown('> **Théorème de Pythagore**\n>\n> \\[\n> BC^2 = AB^2 + AC^2\n> \\]\n>\n> Suite.');
    expect(tree.children.map(n => n.type)).toEqual(['blockquote']);
    expect(values(tree, 'math')).toEqual(['BC^2 = AB^2 + AC^2']);
    expect(nodesOfType(tree, 'inlineMath')).toHaveLength(0);
  });
});
