import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Nodes, Root } from 'mdast';
import MarkdownView from '@/components/MarkdownView';
import { parseMarkdown, prepareMarkdown, splitMarkdownBlocks } from '@/lib/export/markdown';

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
    expect(html).toContain('<li>A) <span class="math-inline">');
    expect(html).not.toContain('\\(');
  });
});

describe('mise en page des QCM et vrai/faux : écran et export PDF', () => {
  it('question puis 4 choix un par ligne → paragraphe + liste de 4 éléments', () => {
    const tree: Root = parseMarkdown('**Question 1.** Q ?\nA) 7\nB) 12\nC) 34\nD) 1');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'list']);
    expect(nodesOfType(tree, 'listItem')).toHaveLength(4);
    const html = render('**Question 1.** Q ?\nA) 7\nB) 12\nC) 34\nD) 1');
    expect(html).toContain('<li>A) 7</li>');
    expect(html).toContain('<li>D) 1</li>');
  });

  it('deux affirmations consécutives → deux paragraphes', () => {
    const tree = parseMarkdown('**1.** Le Soleil est une étoile. ☐ Vrai ☐ Faux\n**2.** La Lune brille seule. ☐ Vrai ☐ Faux');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'paragraph']);
  });
});
