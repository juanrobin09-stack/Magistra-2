import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownView from '@/components/MarkdownView';
import { splitMarkdownBlocks, parseMarkdown } from '@/lib/export/markdown';

function render(content: string, className?: string): string {
  return renderToStaticMarkup(<MarkdownView content={content} className={className} />);
}

describe('MarkdownView', () => {
  it('enveloppe le contenu dans .prose-content (+ classe facultative)', () => {
    expect(render('Bonjour')).toMatch(/^<div class="prose-content"><p dir="auto">Bonjour<\/p>/);
    expect(render('Bonjour', 'extra')).toMatch(/^<div class="prose-content extra">/);
  });

  it('rend les tableaux GFM dans un conteneur à défilement horizontal', () => {
    const html = render('| Étape | Durée |\n| :--- | ---: |\n| Accueil | 5 min |\n| x > 3 | 2 * 3 = 6 |');
    expect(html).toContain('<div class="table-wrap" role="region" aria-label="Tableau" tabindex="0" dir="auto"><table>');
    expect(html).toContain('<th dir="auto" style="text-align:left">Étape</th>');
    expect(html).toContain('<td dir="auto" style="text-align:right">5 min</td>');
    expect(html).toContain('<td dir="auto" style="text-align:left">x &gt; 3</td>');
    expect(html).toContain('2 * 3 = 6');
  });

  it('rend les listes à puces, numérotées et imbriquées', () => {
    const html = render('- un\n- deux\n  - imbriqué\n\n1. premier\n2. second\n\nParagraphe.\n\n5. commence à 5');
    expect(html).toMatch(/<ul>\s*<li dir="auto">un<\/li>/);
    expect(html).toContain('<li dir="auto">imbriqué</li>');
    expect(html).toMatch(/<ol>\s*<li dir="auto">premier<\/li>/);
    expect(html).toContain('<ol start="5">');
  });

  it('rend les listes de tâches avec des cases non modifiables', () => {
    const html = render('- [ ] à faire\n- [x] fait');
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('class="task-list-item"');
    expect(html).toMatch(/<input type="checkbox" readonly="" disabled="" aria-label="Tâche à faire"\/>/i);
    expect(html).toMatch(/<input type="checkbox" readonly="" disabled="" aria-label="Tâche faite" checked=""\/>/i);
  });

  it('rend citations, code en ligne, blocs de code, titres h1 à h6, séparateurs, barré', () => {
    const html = render('# T1\n## T2\n### T3\n#### T4\n##### T5\n###### T6\n\n> Une citation\n\nDu `code` ici.\n\n```js\nconst a = 1 < 2;\n```\n\n---\n\n~~barré~~');
    for (let i = 1; i <= 6; i++) expect(html).toContain(`<h${i} dir="auto">T${i}</h${i}>`);
    expect(html).toMatch(/<blockquote dir="auto">\s*<p dir="auto">Une citation<\/p>\s*<\/blockquote>/);
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<pre tabindex="0"><code class="language-js">const a = 1 &lt; 2;\n</code></pre>');
    expect(html).toContain('<hr/>');
    expect(html).toContain('<del>barré</del>');
  });

  it('rend les mathématiques avec KaTeX (en ligne et en bloc)', () => {
    const html = render('Aire : $\\pi r^2$\n\n$$\n\\frac{a}{b}\n$$');
    expect(html).toContain('<span class="math-inline"><span class="katex">');
    expect(html).toContain('<div class="math-display"><span class="katex-display">');
    expect(html).toContain('<annotation encoding="application/x-tex">\\pi r^2</annotation>');
    // Classes de KaTeX 0.18 (celles de la feuille de style importée).
    expect(html).toContain('katex-base');
  });

  it('ne prend pas les montants en dollars pour des formules', () => {
    const html = render('Le livre coûte 5 $ et le cahier 10 $.');
    expect(html).toContain('Le livre coûte 5 $ et le cahier 10 $.');
    expect(html).not.toContain('katex');
  });

  it("n'exécute ni n'affiche le HTML dangereux", () => {
    const html = render('Avant\n\n<script>alert("x")</script>\n\nTexte <script>alert(1)</script> fin <img src=x onerror="alert(2)"> et <iframe src="https://example.org"></iframe>\n\n<div onclick="alert(3)">Bloc</div>');
    expect(html).not.toMatch(/<script|<img|<iframe|onerror|onclick/i);
    expect(html).not.toContain('alert');
    expect(html).toContain('Avant');
    expect(html).toContain('Bloc');
  });

  it('conserve le texte qui ressemble à du HTML sans en être (« 3<x et x>2 »)', () => {
    const html = render('Si 3<x et x>2 alors H<sub>2</sub>O.');
    expect(html).toContain('Si 3&lt;x et x&gt;2 alors H₂O.');
  });

  it('ouvre les liens externes dans un nouvel onglet, sans accès à la page d’origine', () => {
    const html = render('[Éduscol](https://eduscol.education.fr) et https://www.education.gouv.fr');
    expect(html).toContain('<a href="https://eduscol.education.fr" title="https://eduscol.education.fr" target="_blank" rel="noopener noreferrer">Éduscol</a>');
    expect(html).toContain('href="https://www.education.gouv.fr"');
  });

  it('neutralise les protocoles dangereux et les liens relatifs', () => {
    const html = render('[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](/app/settings) [e](file:///C:/x)');
    expect(html).not.toMatch(/href="(javascript|data|vbscript|file|\/app)/i);
    expect(html).toContain('<span class="md-link-disabled">a</span>');
    expect(html).toContain('<span class="md-link-disabled">d</span>');
  });

  it("n'effectue aucune requête pour les images (texte de remplacement affiché)", () => {
    const html = render('![Schéma de la cellule](https://example.org/cellule.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('[Image : Schéma de la cellule]');
  });

  it('traduit les notes de bas de page', () => {
    const html = render('Texte[^1].\n\n[^1]: La note.');
    expect(html).toContain('Notes');
    expect(html).toContain('La note.');
  });
});

describe('découpage progressif', () => {
  it('découpe en blocs de premier niveau et reconstitue exactement le texte', () => {
    const md = '# Titre\n\nParagraphe\nsur deux lignes.\n\n- a\n\n- b\n\n  suite de b\n\n```\ncode\n\n\nfin\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const blocks = splitMarkdownBlocks(md);
    expect(blocks.join('')).toBe(md);
    expect(blocks).toHaveLength(4);
    expect(blocks[1]).toContain('suite de b');
    expect(blocks[2]).toBe('```\ncode\n\n\nfin\n```\n\n');
  });

  it('rend le document d’un seul tenant s’il contient des définitions ou des notes', () => {
    expect(splitMarkdownBlocks('Voir [lien][x].\n\n[x]: https://example.org')).toHaveLength(1);
    expect(splitMarkdownBlocks('Texte[^1].\n\n[^1]: Note.')).toHaveLength(1);
  });

  const TRICKY = [
    '# Plan\n\n1. Un\n2. Deux\n\nTexte avec $x^2$.\n\n> Citation\n> sur deux lignes\n\n- [ ] tâche',
    '1. premier\n\n2. deuxième (liste lâche)\n\n   suite indentée\n\n3. troisième\n\nParagraphe final.',
    '- a\n  - b\n\n    paragraphe de b\n\n- c\n\nTexte',
    '```python\ndef f():\n\n\n    return 1\n```\n\nAprès le code.\n\n~~~\n# pas un titre\n\nx\n~~~\n\nFin.',
    '$$\n\\frac{a}{b}\n\n= c\n$$\n\nAprès la formule.',
    '<!--\ncommentaire\n\nsur plusieurs lignes\n-->\n\nTexte visible.',
    'Titre\n=====\n\nSous-titre\n----------\n\nTexte.',
    '> a\n\n> b\n\n>> c\n\nTexte',
    '| a | b |\n| - | - |\n| 1 | 2 |\n\nTexte\n| c | d |\n| - | - |\n| 3 | 4 |',
    'Paragraphe\n\n    code indenté\n\n    suite du code\n\nFin',
    '* a\n\n* b\n\n+ autre liste\n\nTexte',
    '---\n\n***\n\nTexte\n\n___',
  ];

  it.each(TRICKY.map((md, i) => [i, md]))('exemple %i : même HTML en blocs que d’un seul tenant', (_i, md) => {
    const strip = (html: string) => html.replace(/^<div class="prose-content">|<\/div>$/g, '').replace(/\n/g, '');
    const blocks = splitMarkdownBlocks(md as string);
    expect(blocks.join('')).toBe(md);
    // Rendu du document entier sans découpage (bloc unique grâce à une définition neutre en fin).
    const whole = strip(renderToStaticMarkup(<MarkdownView content={`${md}\n\n[zz-neutre]: https://example.org`} />));
    const pieces = blocks.map(b => strip(renderToStaticMarkup(<MarkdownView content={b} />))).join('');
    expect(pieces).toBe(whole);
  });

  it('découpe rapidement un long document (streaming)', () => {
    const section = '## Partie\n\nUn paragraphe avec **gras** et $x^2$.\n\n- point un\n- point deux\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n';
    const doc = section.repeat(200);
    const t = performance.now();
    const blocks = splitMarkdownBlocks(doc);
    const elapsed = performance.now() - t;
    expect(blocks.join('')).toBe(doc);
    expect(blocks.length).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(50);
  });

  it('supporte un contenu vide ou en cours de génération', () => {
    expect(render('')).toBe('<div class="prose-content"></div>');
    expect(render('```js\nconst a =')).toContain('const a =');
    expect(render('| a | b |\n| -')).toContain('| a | b |');
  });

  it('parseMarkdown neutralise le HTML pour l’export', () => {
    const tree = parseMarkdown('<script>x</script>\n\nTexte <b>gras</b>');
    expect(JSON.stringify(tree)).not.toContain('script');
    expect(JSON.stringify(tree)).not.toContain('"html"');
  });
});
