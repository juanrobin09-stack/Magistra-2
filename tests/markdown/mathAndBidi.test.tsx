import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownView from '@/components/MarkdownView';
import { protectDecimalCommas } from '@/lib/mathText';

const render = (content: string) => renderToStaticMarkup(<MarkdownView content={content} />);

describe('MarkdownView — virgule décimale (KaTeX)', () => {
  it('« 2,5 » ne contient plus d\'espace après la virgule', () => {
    const html = render('Valeurs : $2,5$ et $3,14$');
    expect(html).not.toContain('katex-error');
    // KaTeX insère une espace (mspace) après une virgule de ponctuation : absente de « 2{,}5 ».
    expect(html).not.toContain('mspace');
  });

  it('les listes « 1,2,3 » gardent leurs espaces', () => {
    expect(render('$1,2,3$')).toContain('mspace');
  });

  it('protectDecimalCommas : décimaux isolés seulement, \\text{…} intact', () => {
    expect(protectDecimalCommas('3,5 + 12,25')).toBe('3{,}5 + 12{,}25');
    expect(protectDecimalCommas('1,2,3')).toBe('1,2,3');
    expect(protectDecimalCommas('\\text{2,5 kg}')).toBe('\\text{2,5 kg}');
    expect(protectDecimalCommas('\\SI{3,5}{m}')).toBe('\\SI{3{,}5}{m}');
  });
});

describe('MarkdownView — macros chimie et unités', () => {
  it('\\ce{…} (mhchem) se rend sans erreur rouge', () => {
    const html = render('$\\ce{2H2 + O2 -> 2H2O}$');
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('#cc0000');
  });

  it('\\SI, \\num et \\unit dégradent en texte simple, sans rouge', () => {
    for (const tex of ['\\SI{3}{m}', '\\num{1200}', '\\unit{m}']) {
      const html = render(`$${tex}$`);
      expect(html).not.toContain('katex-error');
      expect(html).not.toContain('#cc0000');
    }
  });

  it('une construction inconnue reste lisible, sans couleur d\'erreur rouge', () => {
    const html = render('$\\begin{tabular}{c} a \\end{tabular}$');
    expect(html).not.toContain('#cc0000');
  });
});

describe('MarkdownView — direction du texte (arabe)', () => {
  it('p, li, titres, citations et cellules portent dir="auto"', () => {
    const html = render('# عنوان\n\nمرحبا بالعالم.\n\n- بند أول\n\n> اقتباس\n\n| أ | B |\n| --- | :-: |\n| ب | c |');
    expect(html).toContain('<h1 dir="auto">');
    expect(html).toContain('<p dir="auto">مرحبا بالعالم.</p>');
    expect(html).toContain('<li dir="auto">بند أول</li>');
    expect(html).toContain('<blockquote dir="auto">');
    expect(html).toContain('<th dir="auto">');
    expect(html).toContain('<td dir="auto" style="text-align:center">c</td>');
    expect(html).toContain('tabindex="0" dir="auto"');
  });

  it('le français garde dir="auto" sans attribut parasite (node)', () => {
    const html = render('Bonjour à tous.');
    expect(html).toContain('<p dir="auto">Bonjour à tous.</p>');
    expect(html).not.toContain('node=');
  });
});
