import { beforeAll, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { markdownToPdf, pdfStats, PDF_LAYOUT, type PdfFonts } from '@/lib/export/pdf';
import { extractPdf, loadTestFonts, textLines } from './helpers';

let fonts: PdfFonts;
beforeAll(() => {
  fonts = loadTestFonts();
});

const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('export PDF : cas limites', () => {
  it('gère les imbrications (code et tableau dans une liste, citation imbriquée, <br>)', async () => {
    const md = [
      '## Consignes avec `code` et [lien](https://example.org)',
      '',
      '1. ```',
      '   x = 2 * 3',
      '   ```',
      '2. Tableau dans une liste :',
      '',
      '   | a | b |',
      '   | - | - |',
      '   | x > 3 | a < b |',
      '',
      '> Citation',
      '>',
      '> > Citation imbriquée avec une liste :',
      '> > - point -5 + 10',
      '',
      'Ligne un<br>ligne deux  ',
      'ligne trois',
      '',
      '$$',
      '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
      '$$',
      '',
      'Note[^1].',
      '',
      '[^1]: Le texte de la note 2025-2026.',
    ].join('\n');
    const pdf = markdownToPdf({ title: 'Cas limites', content: md }, fonts);
    const out = await extractPdf(pdf, 'edge');
    const text = flat(out.text);
    for (const s of ['Consignes avec code et lien (https://example.org)', 'x = 2 * 3', 'Tableau dans une liste :', 'x > 3', 'a < b',
      'Citation', 'Citation imbriquée avec une liste :', 'point -5 + 10', 'Ligne un', 'ligne deux', 'ligne trois',
      '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', 'Note[1].', '[1] Le texte de la note 2025-2026.']) {
      expect(text, s).toContain(s);
    }
    const lines = textLines(out);
    expect(lines).toContain('Ligne un');
    expect(lines).toContain('ligne deux');
    expect(lines.some(l => l.startsWith('1.'))).toBe(true);
    expect(pdfStats(pdf).unsupported).toBe(0);
  });

  it('accepte un document vide ou composé uniquement d’émojis', async () => {
    const empty = await extractPdf(markdownToPdf({ title: '', content: '' }, fonts));
    expect(empty.numPages).toBe(1);
    expect(empty.text).toContain('Document sans titre');
    const emoji = await extractPdf(markdownToPdf({ title: 'Émojis', content: '# 🎉\n\n🎓🚀✅\n\n- 👍' }, fonts));
    expect(emoji.text).toContain('Émojis');
    expect(emoji.text).not.toContain('�');
  });

  it('garde un tableau large lisible (8 colonnes) sans perte de texte', async () => {
    const head = Array.from({ length: 8 }, (_, i) => `Colonne ${i + 1}`);
    const row = Array.from({ length: 8 }, (_, i) => `valeur ${i + 1}`);
    const md = `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n| ${row.join(' | ')} |`;
    const out = await extractPdf(markdownToPdf({ title: 'Tableau large', content: md }, fonts), 'wide');
    const text = flat(out.text);
    for (let i = 1; i <= 8; i++) {
      expect(text).toMatch(new RegExp(`Colonne ?${i}`));
      expect(text).toMatch(new RegExp(`valeur ?${i}`));
    }
    for (const item of out.items) expect(item.x + item.width).toBeLessThanOrEqual(PDF_LAYOUT.PAGE_W - PDF_LAYOUT.MARGIN_X + 1);
  });

  it('coupe un long bloc de code sur plusieurs pages en conservant chaque ligne et chaque espace', async () => {
    const code = Array.from({ length: 120 }, (_, i) => `ligne_${i + 1} = ${i} * 2 > 3  # commentaire`).join('\n');
    const pdf = markdownToPdf({ title: 'Code long', content: `\`\`\`python\n${code}\n\`\`\`` }, fonts);
    const out = await extractPdf(pdf, 'code');
    expect(out.numPages).toBeGreaterThanOrEqual(2);
    // pdf.js fusionne les espaces consécutifs à l'extraction : on compare hors espaces multiples…
    for (let i = 1; i <= 120; i++) expect(out.text).toContain(`ligne_${i} = ${i - 1} * 2 > 3 # commentaire`);
    // … et on vérifie dans le flux PDF que les deux espaces (glyphe 3) sont bien dessinés.
    const raw = Buffer.from(pdf.output('arraybuffer'));
    let doubleSpaces = 0;
    for (const m of raw.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let content: string;
      try {
        content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
      } catch {
        continue;
      }
      for (const run of content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
        if (/^(?:[0-9A-Fa-f]{4})*?00030003/.test(run[1])) doubleSpaces++;
      }
    }
    expect(doubleSpaces).toBe(120);
  });
});
