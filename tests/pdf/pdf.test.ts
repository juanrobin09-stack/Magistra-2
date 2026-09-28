import { beforeAll, describe, expect, it } from 'vitest';
import { markdownToPdf, pdfStats, requiredFonts, PDF_LAYOUT, type PdfFonts } from '@/lib/export/pdf';
import { texToUnicode, TEX_OUTPUT_CHARACTERS } from '@/lib/export/tex';
import { extractPdf, loadTestFonts, textLines, type ExtractedPdf } from './helpers';

// Chaînes qui doivent rester EXACTEMENT identiques dans le PDF.
const REQUIRED = [
  '2025-2026',
  'x > 3',
  '2 * 3 = 6',
  '-5 + 10',
  'a < b',
  'H₂O',
  'CO₂',
  'é è à ç œ',
  '≤ ≥ ≠ ≈ √ π ∑ ∞ ± × ÷ → ∈ ∀ ∃ α β γ Δ',
];

const SAMPLE = `# Les fractions — séance 1

Année scolaire 2025-2026, classe de 6e.

## Paragraphes

${REQUIRED.join('\n\n')}

Une phrase avec du **gras**, de l'*italique*, du ***gras italique***, du \`code en ligne\` et ~~un texte barré~~.
Un lien : [Éduscol](https://eduscol.education.fr) et une adresse nue https://www.education.gouv.fr/.

## Listes

${REQUIRED.map(s => `- ${s}`).join('\n')}

1. Premier numéro
2. Deuxième numéro
   - Sous-point imbriqué
     - Troisième niveau
3. Troisième numéro

- [ ] Tâche à faire
- [x] Tâche faite

## Tableau

| Expression | Valeur |
| :--- | ---: |
${REQUIRED.map((s, i) => `| ${s} | ${i + 1} |`).join('\n')}
| **Total** | 45 |

### Titre de niveau 3

#### Titre de niveau 4

> Citation : « La mémoire est la sentinelle de l'esprit. »

\`\`\`
if (x > 3 && y < 2) {
	z = 2 * 3; // tabulation conservée
}
\`\`\`

Formule en ligne : $x^2 + \\frac{a}{b} \\leq \\sqrt{\\pi}$ et une formule non convertible : $\\binom{n}{k}$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

---

Fin du document.
`;

let fonts: PdfFonts;
let sample: ExtractedPdf;

beforeAll(async () => {
  fonts = loadTestFonts();
  sample = await extractPdf(markdownToPdf({
    title: 'Les fractions — séance 1',
    content: SAMPLE,
    meta: { type: 'Cours', niveau: '6e', matiere: 'Mathématiques', date: '2026-09-28' },
  }, fonts), 'sample');
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('export PDF : fidélité du texte', () => {
  it('conserve exactement chaque chaîne exigée (paragraphe, liste et cellule de tableau)', () => {
    const lines = textLines(sample);
    for (const s of REQUIRED) {
      // Paragraphe seul sur sa ligne, élément de liste (après la puce) et cellule de tableau.
      expect(lines, `paragraphe « ${s} »`).toContain(s);
      expect(countOccurrences(sample.text, s), `occurrences de « ${s} »`).toBeGreaterThanOrEqual(3);
    }
    const tableItems = sample.items.filter(i => REQUIRED.includes(i.str) && i.size < 9.5);
    expect(new Set(tableItems.map(i => i.str))).toEqual(new Set(REQUIRED));
  });

  it("n'altère ni les tirets, ni « > », ni « * », ni « < »", () => {
    expect(sample.text).not.toContain('2025•2026');
    expect(sample.text).not.toContain('•5 + 10');
    expect(sample.text).toContain('if (x > 3 && y < 2) {');
    expect(sample.text).toContain('z = 2 * 3; // tabulation conservée');
  });

  it("affiche l'en-tête : titre, niveau · matière · type, date", () => {
    const first = sample.pages[0];
    expect(first).toContain('Les fractions — séance 1');
    // Le premier titre identique au titre de l'en-tête n'est pas répété.
    expect(countOccurrences(first, 'Les fractions — séance 1')).toBe(1);
    expect(first).toContain('6e · Mathématiques · Cours');
    expect(first).toContain('28 septembre 2026');
  });

  it('dessine les titres avec des tailles distinctes et décroissantes', () => {
    const sizeOf = (text: string) => sample.items.find(i => i.str === text)?.size ?? 0;
    const h2 = sizeOf('Paragraphes');
    const h3 = sizeOf('Titre de niveau 3');
    const h4 = sizeOf('Titre de niveau 4');
    const body = sizeOf('Fin du document.');
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThan(h4);
    expect(h4).toBeGreaterThan(body);
    expect(sample.items.find(i => i.str === 'Paragraphes')?.fontName).not.toBe(sample.items.find(i => i.str === 'Fin du document.')?.fontName);
  });

  it('dessine les puces, les numéros, l’imbrication et les cases à cocher', () => {
    const lines = textLines(sample);
    expect(lines).toContain('• 2025-2026');
    expect(lines).toContain('1. Premier numéro');
    expect(lines).toContain('3. Troisième numéro');
    expect(lines).toContain('◦ Sous-point imbriqué');
    expect(lines).toContain('▪ Troisième niveau');
    expect(lines).toContain('☐ Tâche à faire');
    expect(lines).toContain('☑ Tâche faite');
    const bullet = sample.items.find(i => i.str === '•');
    const nested = sample.items.find(i => i.str === '◦');
    expect(bullet && nested && nested.x > bullet.x).toBe(true);
  });

  it('rend le tableau : en-têtes, cellules, gras', () => {
    expect(sample.items.some(i => i.str === 'Expression')).toBe(true);
    expect(sample.items.some(i => i.str === 'Valeur')).toBe(true);
    expect(sample.items.some(i => i.str === 'Total')).toBe(true);
    expect(sample.items.some(i => i.str === '45')).toBe(true);
    expect(sample.text).not.toContain('| ---');
  });

  it('rend le style en ligne, les liens (texte + adresse cliquable), la citation et le code', () => {
    const lines = textLines(sample);
    expect(sample.text).toContain('gras');
    expect(sample.text).toContain('code en ligne');
    expect(lines.some(l => l.includes('Éduscol (https://eduscol.education.fr)'))).toBe(true);
    expect(sample.links.map(l => l.url)).toContain('https://eduscol.education.fr');
    expect(sample.text).toContain('Citation : « La mémoire est la sentinelle de l\'esprit. »');
    const code = sample.items.find(i => i.str.startsWith('if (x > 3'));
    expect(code?.fontName).not.toBe(sample.items.find(i => i.str === 'Fin du document.')?.fontName);
  });

  it('convertit les formules simples en Unicode et conserve la source des autres', () => {
    expect(sample.text).toContain('x² + a/b ≤ √π');
    expect(sample.text).toContain('$\\binom{n}{k}$');
    expect(sample.text).toContain('∑ᵢ₌₁ⁿ i = n(n+1)/2');
  });

  it('respecte les marges (retour à la ligne mesuré avec la police réellement utilisée)', () => {
    const right = PDF_LAYOUT.PAGE_W - PDF_LAYOUT.MARGIN_X + 1;
    for (const item of sample.items) {
      expect(item.x, item.str).toBeGreaterThanOrEqual(PDF_LAYOUT.MARGIN_X - 1);
      expect(item.x + item.width, item.str).toBeLessThanOrEqual(right);
    }
  });

  it('numérote les pages « Page n / N »', () => {
    sample.pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} / ${sample.numPages}`));
  });
});

describe('export PDF : pagination et documents longs', () => {
  it('produit plusieurs pages avec sauts de page et en-tête courant', async () => {
    const paragraphs = Array.from({ length: 70 }, (_, i) => `Paragraphe ${i + 1} : l'élève compare x > 3 et a < b, puis calcule 2 * 3 = 6 en 2025-2026.`);
    const table = ['| N° | Consigne |', '| --- | --- |', ...Array.from({ length: 60 }, (_, i) => `| ${i + 1} | Ligne de tableau ${i + 1} avec -5 + 10 |`)];
    const pdf = markdownToPdf({ title: 'Progression annuelle', content: [...paragraphs, '', ...table].join('\n\n').replace(/\n\n\|/g, '\n|') }, fonts);
    const out = await extractPdf(pdf, 'long');
    expect(out.numPages).toBeGreaterThanOrEqual(3);
    for (let i = 1; i <= 70; i++) expect(out.text).toContain(`Paragraphe ${i} : l'élève compare x > 3 et a < b, puis calcule 2 * 3 = 6 en 2025-2026.`);
    for (let i = 1; i <= 60; i++) expect(out.text).toContain(`Ligne de tableau ${i} avec -5 + 10`);
    out.pages.forEach((page, i) => {
      expect(page).toContain(`Page ${i + 1} / ${out.numPages}`);
      if (i > 0) expect(page).toContain('Progression annuelle');
    });
    // Aucune ligne ne déborde en bas de page (hors pied de page).
    for (const item of out.items) {
      if (item.str.startsWith('Page ')) continue;
      expect(item.y).toBeGreaterThanOrEqual(PDF_LAYOUT.MARGIN_BOTTOM - 12);
    }
  });

  it('coupe un mot trop long sans perdre de caractère', async () => {
    const url = `https://example.org/${'segment-'.repeat(20)}fin`;
    const out = await extractPdf(markdownToPdf({ title: 'URL', content: `Adresse : ${url}` }, fonts));
    expect(out.text.replace(/\n/g, '')).toContain(url);
  });
});

describe('export PDF : émojis et caractères spéciaux', () => {
  it('retire seulement les émojis absents de la police', async () => {
    const pdf = markdownToPdf({
      title: 'Bilan 🎓',
      content: '## 🎯 Objectifs\n\nBravo 🎓 à tous ✅ !\n\n⚠️ Attention : H₂O ≠ CO₂.\n\n- 🚀 Décollage à 2025-2026\n\n| Emoji | Texte |\n| --- | --- |\n| 👨\u200d🏫 | x > 3 |',
    }, fonts);
    const out = await extractPdf(pdf, 'emoji');
    const lines = textLines(out);
    expect(lines).toContain('Objectifs');
    expect(lines).toContain('Bravo à tous !');
    expect(lines).toContain('⚠ Attention : H₂O ≠ CO₂.');
    expect(lines).toContain('• Décollage à 2025-2026');
    expect(out.text).toContain('Bilan');
    expect(out.text).toContain('x > 3');
    expect(out.text).not.toMatch(/\p{Extended_Pictographic}(?<!⚠)/u);
    expect(out.text).not.toContain('\ufffd');
    expect(pdfStats(pdf).emojiRemoved).toBeGreaterThanOrEqual(5);
    expect(pdfStats(pdf).unsupported).toBe(0);
  });

  it('dispose de tous les caractères produits par la conversion des formules', async () => {
    const chars = [...new Set(TEX_OUTPUT_CHARACTERS.replace(/\s/g, ''))].join(' ');
    const pdf = markdownToPdf({ title: 'Symboles', content: chars }, fonts);
    const out = await extractPdf(pdf);
    expect(pdfStats(pdf).unsupported).toBe(0);
    expect(out.text).not.toContain('\ufffd');
  });

  it('dessine les espaces insécables et les guillemets français (sans coupure de ligne)', async () => {
    const source = 'Il dit\u00a0: «\u202fBonjour\u202f» ; 10\u00a0000\u00a0€.';
    const pdf = markdownToPdf({ title: 'Typo', content: source }, fonts);
    const out = await extractPdf(pdf);
    // pdf.js restitue les espaces insécables comme des espaces ordinaires à l'extraction.
    expect(out.text).toContain(source.replace(/[\u00a0\u202f]/g, ' '));
    expect(pdfStats(pdf).unsupported).toBe(0);
  });

  it('ne prend pas les montants en dollars pour des formules', async () => {
    const out = await extractPdf(markdownToPdf({ title: 'Prix', content: 'Le livre coûte 5 $ et le cahier 10 $.' }, fonts));
    expect(out.text).toContain('Le livre coûte 5 $ et le cahier 10 $.');
  });
});

describe('export PDF : taille des fichiers', () => {
  it('intègre des sous-ensembles de polices compacts', async () => {
    const small = markdownToPdf({ title: 'Court', content: 'Bonjour.' }, fonts);
    const smallBytes = small.output('arraybuffer').byteLength;
    const sampleBytes = sample.bytes;
    // Normal + gras seulement : quelques dizaines de Ko.
    expect(smallBytes).toBeLessThan(80_000);
    // Cinq polices (normal, gras, italique, gras italique, chasse fixe) : bien moins d'1 Mo.
    expect(sampleBytes).toBeLessThan(250_000);
    console.info(`Taille PDF — court : ${(smallBytes / 1024).toFixed(1)} Ko ; exemple complet (${sample.numPages} p.) : ${(sampleBytes / 1024).toFixed(1)} Ko`);
  });

  it('ne demande que les polices nécessaires', () => {
    expect(requiredFonts('Bonjour **tout** le monde').sort()).toEqual(['bold', 'regular']);
    expect(requiredFonts('Un *mot*')).toContain('italic');
    expect(requiredFonts('**un *mot***')).toContain('bolditalic');
    expect(requiredFonts('`code`')).toContain('mono');
    expect(requiredFonts('$x^2$')).not.toContain('mono');
    expect(requiredFonts('$\\binom{n}{k}$')).toContain('mono');
  });

  it('fonctionne sans les polices facultatives (repli sur DejaVu Sans)', async () => {
    const pdf = markdownToPdf({ title: 'Repli', content: '*italique* et `code` : x > 3' }, { regular: fonts.regular, bold: fonts.bold });
    const out = await extractPdf(pdf);
    expect(out.text).toContain('italique');
    expect(out.text).toContain('x > 3');
  });
});

describe('texToUnicode', () => {
  it.each([
    ['x^2', 'x²'],
    ['x_1 + x_2', 'x₁ + x₂'],
    ['H_2O', 'H₂O'],
    ['\\frac{a}{b}', 'a/b'],
    ['\\frac{x+1}{2}', '(x+1)/2'],
    ['\\sqrt{x}', '√x'],
    ['\\sqrt{x+1}', '√(x+1)'],
    ['\\sqrt[3]{8}', '∛8'],
    ['\\alpha + \\beta = \\gamma', 'α + β = γ'],
    ['\\Delta = b^2 - 4ac', 'Δ = b² - 4ac'],
    ['a \\leq b \\geq c \\neq d \\approx e', 'a ≤ b ≥ c ≠ d ≈ e'],
    ['\\forall x \\in \\mathbb{R}, \\exists y', '∀ x ∈ ℝ, ∃ y'],
    ['\\sum_{i=1}^{n} i', '∑ᵢ₌₁ⁿ i'],
    ['\\lim_{x \\to 0} f(x)', 'lim_(x→0) f(x)'],
    ['e^{i\\pi} = -1', 'e^(iπ) = -1'],
    ['90^\\circ', '90°'],
    ['\\text{aire} = \\pi r^2', 'aire = π r²'],
    ['3 \\times 4 \\div 2 \\pm 1', '3 × 4 ÷ 2 ± 1'],
    ['\\left( \\frac{1}{2} \\right)', '( 1/2 )'],
    ['10\\,000', '10 000'],
  ])('%s → %s', (tex, expected) => {
    expect(texToUnicode(tex)).toBe(expected);
  });

  it.each(['\\binom{n}{k}', '\\begin{cases} x \\\\ y \\end{cases}', 'a & b', '\\unknowncommand{x}', '\\frac{1}'])(
    'renvoie null pour %s (source conservée)',
    tex => expect(texToUnicode(tex)).toBeNull(),
  );
});
