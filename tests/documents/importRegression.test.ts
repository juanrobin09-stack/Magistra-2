import { describe, expect, it } from 'vitest';
import { extractDocument, type PdfJsLike } from '@shared/documents/extract';
import { selectPassages } from '@shared/documents/retrieve';
import { decodeText, tokenize } from '@shared/documents/text';
import type { ExtractedDocument } from '@shared/documents/types';
import { encodeWindows1252, makeDocxFromBody, makePptxFromSlides, slideTextXml } from './fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const allText = (doc: ExtractedDocument) => doc.units.map(unit => unit.text).join('\n');
const multilingual = 'Élève, cœur — 日本語の語彙 — Привет мир — مرحبا بالعالم — αβγ — 한글';
const xmlText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pdfWithText(pages: string[]): PdfJsLike {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: async (page: number) => ({
          getTextContent: async () => ({ items: [{ str: pages[page - 1], hasEOL: true }] }),
        }),
      }),
    }),
  };
}

function pagedDocument(pages: string[]): ExtractedDocument {
  return {
    id: 'vocabulaire', name: 'vocabulaire.pdf', kind: 'pdf',
    units: pages.map((text, index) => ({ locator: { type: 'pages', start: index + 1, end: index + 1 }, text })),
    stats: { pages: pages.length, chars: pages.join('').length }, warnings: [],
  };
}

describe('imports multilingues : contenu conservé dans chaque format', () => {
  for (const extension of ['txt', 'md']) {
    it(`${extension.toUpperCase()} : UTF-8 valide, emoji et U+FFFD ne déclenchent pas un repli d’encodage`, async () => {
      const text = `${multilingual}\nCaractère de remplacement : �. Emoji : 📚.`;
      const doc = await extractDocument({ id: extension, name: `source.${extension}`, bytes: utf8(text) });
      expect(allText(doc)).toBe(text);
      expect(doc.stats.chars).toBe(text.length);
    });
  }

  it('un seul accent Windows-1252 à la fin d’un long fichier est quand même décodé', async () => {
    const text = `${'Texte sans accent. '.repeat(200)}Été.`;
    const doc = await extractDocument({ id: 'ancien', name: 'ancien.txt', bytes: encodeWindows1252(text) });
    expect(allText(doc)).toBe(text);
  });

  it('Windows-1252 : les caractères C1 deviennent les accents et la ponctuation prévus sur tous les runtimes', () => {
    const bytes = new Uint8Array([0x8c, 0x75, 0x76, 0x72, 0x65, 0x20, 0x96, 0x20, 0x39, 0x35, 0x20, 0x80, 0x99]);
    expect(decodeText(bytes)).toBe('Œuvre – 95 €™');
    expect(decodeText(utf8('UTF-8 valide : \u0092, œ et €.'))).toBe('UTF-8 valide : \u0092, œ et €.');
  });

  it('UTF-16 BE : conserve les paires de substitution et les caractères japonais', async () => {
    const text = `${multilingual} 📚`;
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xfe, 0xff]);
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) >> 8;
      bytes[3 + i * 2] = text.charCodeAt(i) & 0xff;
    }
    expect(decodeText(bytes)).toBe(text);
    const doc = await extractDocument({ id: 'utf16', name: 'unicode.txt', bytes });
    expect(allText(doc)).toBe(text);
  });

  it('PDF : les caractères d’une couche texte multilingue restent intacts', async () => {
    const doc = await extractDocument(
      { id: 'pdf', name: 'source.pdf', bytes: utf8('%PDF-1.7') },
      { pdfjs: pdfWithText([multilingual]) },
    );
    expect(allText(doc)).toBe(multilingual);
  });

  it('DOCX : conserve les écritures et les cellules des tableaux', async () => {
    const bytes = await makeDocxFromBody(
      `<w:p><w:r><w:t>${xmlText(multilingual)}</w:t></w:r></w:p>`
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>猫</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>chat</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    const doc = await extractDocument({ id: 'docx', name: 'source.docx', bytes });
    expect(allText(doc)).toContain(multilingual);
    expect(allText(doc)).toContain('猫 | chat');
    expect(doc.stats.chars).toBe(doc.units.reduce((sum, unit) => sum + unit.text.length, 0));
  });

  it('PPTX : conserve les écritures sans confondre leur ordre', async () => {
    const bytes = await makePptxFromSlides([slideTextXml([multilingual]), slideTextXml(['猫 — chat'])]);
    const doc = await extractDocument({ id: 'pptx', name: 'source.pptx', bytes });
    expect(doc.units.map(unit => unit.text)).toEqual([multilingual, '猫 — chat']);
    expect(doc.units.map(unit => unit.locator.start)).toEqual([1, 2]);
  });
});

describe('sélection : les requêtes sans alphabet latin retrouvent leur document', () => {
  it('le traitement historique français reste inchangé', () => {
    expect(tokenize('Les élèves étudient la photosynthèse chez les végétaux'))
      .toEqual(['elev', 'etudient', 'photosynthes', 'vegetal']);
    expect(tokenize("L’école, cœur, 2025-2026 et l'égalité."))
      .toEqual(['ecol', 'coeur', '2025', '2026', 'egal']);
  });

  for (const [label, query, relevant] of [
    ['japonais', '猫', '猫は魚を食べます。動物の語彙を学びましょう。'],
    ['chinois', '猫', '这是一只猫。我们学习动物的词汇。'],
    ['cyrillique', 'животные', 'Сегодня мы изучаем животные и их названия.'],
    ['arabe', 'حيوانات', 'ندرس اليوم حيوانات وأسماءها في المدرسة.'],
    ['grec', 'ζώα', 'Σήμερα μελετάμε ζώα και τα ονόματά τους.'],
  ]) {
    it(`${label} : sélectionne la page pertinente même avec un budget d’une page`, () => {
      const irrelevant = 'Une page générale sans rapport avec le thème demandé.';
      const doc = pagedDocument([irrelevant, relevant]);
      const passages = selectPassages([doc], query, { budgetChars: Math.max(irrelevant.length, relevant.length) + 2 });
      expect(passages).toHaveLength(1);
      expect(passages[0].locator.start).toBe(2);
      expect(passages[0].text).toBe(relevant);
    });
  }
});

describe('diagnostics : le document annoncé doit correspondre au texte réellement lu', () => {
  it('DOCX : compte les caractères après le nettoyage des césures et espaces', async () => {
    const bytes = await makeDocxFromBody('<w:p><w:r><w:t>Une  phrase avec une cé\u00adsure.</w:t></w:r></w:p>');
    const doc = await extractDocument({ id: 'clean', name: 'nettoye.docx', bytes });
    expect(doc.units[0].text).toBe('Une phrase avec une césure.');
    expect(doc.stats.chars).toBe(doc.units[0].text.length);
  });

  it('DOCX : un texte entièrement supprimé par le nettoyage ne devient pas une source prête', async () => {
    const bytes = await makeDocxFromBody('<w:p><w:r><w:t>\u00ad</w:t></w:r></w:p>');
    await expect(extractDocument({ id: 'empty', name: 'vide.docx', bytes }))
      .rejects.toMatchObject({ code: 'DOCUMENT_UNREADABLE' });
  });

  it('PDF : de courtes fiches japonaises avec du texte ne sont pas diagnostiquées comme des scans', async () => {
    const doc = await extractDocument(
      { id: 'cards', name: 'cartes.pdf', bytes: utf8('%PDF-1.7') },
      { pdfjs: pdfWithText(['猫', '犬', '鳥']) },
    );
    expect(doc.units.map(unit => unit.text)).toEqual(['猫', '犬', '鳥']);
  });

  it('PPTX : signale les diapositives sans texte au lieu de présenter une lecture intégrale', async () => {
    const bytes = await makePptxFromSlides([slideTextXml(['Texte lisible']), slideTextXml([]), slideTextXml(['Dernière diapositive'])]);
    const doc = await extractDocument({ id: 'partial', name: 'mixte.pptx', bytes });
    expect(doc.units.map(unit => unit.locator.start)).toEqual([1, 3]);
    expect(doc.warnings.length).toBeGreaterThan(0);
  });
});
