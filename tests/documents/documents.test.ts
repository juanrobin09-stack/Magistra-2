import { beforeAll, describe, expect, it } from 'vitest';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDocument, describeDocument, type PdfJsLike } from '@shared/documents/extract';
import { selectPassages } from '@shared/documents/retrieve';
import type { ExtractedDocument } from '@shared/documents/types';
import { formatLocator } from '@shared/citations';
import { MagistraError } from '@shared/errors';
import { ACCEPT, extractFile, DOCUMENT_LIMITS } from '@/lib/documents';
import { encodeWindows1252, makeDocxWithHeadings, makeDocxWithoutHeadings, makePdf, makePptx, makeStandardFontPdf, withPageLabels } from './fixtures';

const pdfjs = pdfjsLegacy as unknown as PdfJsLike;
const utf8 = (text: string) => new TextEncoder().encode(text);

async function extract(name: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  return extractDocument({ id: `id-${name}`, name, bytes }, { pdfjs });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MagistraError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('extraction PDF', () => {
  let doc: ExtractedDocument;

  beforeAll(async () => {
    doc = await extract('sciences.pdf', makePdf([
      ['Chapitre 1 : la photosynthèse', 'Les végétaux captent la lumière.'],
      ['Chapitre 2 : la respiration cellulaire', 'Élève, forêt, cœur : accents conservés.'],
      ['Conclusion : H₂O et CO₂ circulent', 'Si x > 3 alors 2 * 3 = 6 (2025-2026).'],
    ]));
  });

  it('extrait le texte page par page avec la localisation exacte', () => {
    expect(doc.kind).toBe('pdf');
    expect(doc.stats.pages).toBe(3);
    expect(doc.units.map(u => u.locator)).toEqual([
      { type: 'pages', start: 1, end: 1 },
      { type: 'pages', start: 2, end: 2 },
      { type: 'pages', start: 3, end: 3 },
    ]);
    expect(doc.units[0].text).toBe('Chapitre 1 : la photosynthèse\nLes végétaux captent la lumière.');
    expect(doc.units[1].text).toContain('Élève, forêt, cœur : accents conservés.');
    expect(doc.units[2].text).toContain('Conclusion : H₂O et CO₂ circulent');
    expect(doc.units[2].text).toContain('Si x > 3 alors 2 * 3 = 6 (2025-2026).');
    expect(describeDocument(doc)).toBe('3 pages');
    expect(doc.warnings).toEqual([]);
  });

  it('numéros de page imprimés (/PageLabels) : cités tels que l’enseignant les lit, avec la position dans le PDF', async () => {
    const labelled = await extract('these.pdf', withPageLabels(
      makePdf([['Avant-propos.'], ['Sommaire.'], ['Introduction.'], ['Chapitre 1.']]),
      '0 << /S /r >> 2 << /S /D >>',
    ));
    expect(labelled.units.map(u => u.locator)).toEqual([
      { type: 'pages', start: 1, end: 1, labels: { start: 'i', end: 'i' } },
      { type: 'pages', start: 2, end: 2, labels: { start: 'ii', end: 'ii' } },
      { type: 'pages', start: 3, end: 3, labels: { start: '1', end: '1' } },
      { type: 'pages', start: 4, end: 4, labels: { start: '2', end: '2' } },
    ]);
    expect(formatLocator(labelled.units[2].locator)).toBe('page 1 (p. 3 du PDF)');
    // Passage couvrant plusieurs pages : étiquettes de début et de fin conservées à la fusion.
    const [passage] = selectPassages([labelled], 'avant-propos sommaire introduction chapitre', { budgetChars: 10_000 });
    expect(formatLocator(passage.locator)).toBe('pages i à 2 (p. 1 à 4 du PDF)');
    // Sans étiquettes, ou étiquettes identiques à la position : format habituel.
    expect(doc.units[0].locator.labels).toBeUndefined();
  });

  it('signale les pages sans texte sans les inventer', async () => {
    const mixed = await extract('mixte.pdf', makePdf([['Première page lisible.'], [], ['Troisième page lisible.']]));
    expect(mixed.units.map(u => u.locator.start)).toEqual([1, 3]);
    expect(mixed.warnings).toEqual(['1 page(s) sans texte sélectionnable (images ou scans) ont été ignorées.']);
  });

  it('lit un PDF à police standard non intégrée (Helvetica, accents WinAnsi)', async () => {
    const doc = await extract('circulaire.pdf', makeStandardFontPdf(['Circulaire de rentrée 2025-2026', 'Les élèves de 6e : x > 3.']));
    expect(doc.units[0].text).toBe('Circulaire de rentrée 2025-2026\nLes élèves de 6e : x > 3.');
  });

  it('refuse un PDF sans texte (scan) avec DOCUMENT_SCANNED', async () => {
    await expectCode(extract('scan.pdf', makePdf([[], []])), 'DOCUMENT_SCANNED');
  });

  it('refuse un PDF endommagé', async () => {
    const broken = utf8('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF');
    await expectCode(extract('abime.pdf', broken), 'DOCUMENT_UNREADABLE');
  });
});

describe('extraction DOCX', () => {
  it('découpe en sections sous les titres (Heading1 / Titre1), tableau inclus', async () => {
    const doc = await extract('sequence.docx', await makeDocxWithHeadings());
    expect(doc.kind).toBe('docx');
    expect(doc.units.map(u => u.locator)).toEqual([
      { type: 'paragraphs', start: 1, end: 1 },
      { type: 'section', start: 1, end: 1, title: 'Introduction' },
      { type: 'section', start: 2, end: 2, title: 'Évaluation' },
    ]);
    expect(doc.units[0].text).toBe('Préambule : document de travail.');
    expect(doc.units[1].text).toBe('Introduction\n\nLes élèves découvrent la démocratie.\n\nDeuxième paragraphe de l’introduction.');
    expect(doc.units[2].text).toContain('Critère | Points');
    expect(doc.units[2].text).toContain('x > 3 et a < b | 2');
    // Le paragraphe vide auto-fermant n'avale pas le paragraphe suivant.
    expect(doc.units[2].text).toContain('Dernier paragraphe : 2025-2026.');
    expect(doc.stats.sections).toBe(2);
    expect(doc.stats.paragraphs).toBe(9);
    expect(describeDocument(doc)).toBe('2 sections');
  });

  it('numérote les paragraphes quand il n’y a aucun titre', async () => {
    const doc = await extract('texte.docx', await makeDocxWithoutHeadings(10));
    expect(doc.units.map(u => u.locator)).toEqual([
      { type: 'paragraphs', start: 1, end: 8 },
      { type: 'paragraphs', start: 9, end: 10 },
    ]);
    expect(doc.units[1].text).toBe('Paragraphe numéro 9 : réflexion sur l’égalité.\n\nParagraphe numéro 10 : réflexion sur l’égalité.');
    expect(describeDocument(doc)).toBe('10 paragraphes');
  });
});

describe('extraction PPTX', () => {
  it('suit l’ordre de la présentation et ajoute les notes de l’orateur', async () => {
    const doc = await extract('revolution.pptx', await makePptx());
    expect(doc.kind).toBe('pptx');
    expect(doc.stats.slides).toBe(3);
    expect(doc.units.map(u => u.locator)).toEqual([
      { type: 'slides', start: 1, end: 1 },
      { type: 'slides', start: 2, end: 2 },
      { type: 'slides', start: 3, end: 3 },
    ]);
    expect(doc.units[0].text).toBe('La Révolution française\nCours de 4e — 2025-2026');
    expect(doc.units[1].text).toBe('Les causes\nCrise financière & inégalités\nNotes de l\'orateur : Penser à distribuer la frise chronologique.');
    expect(doc.units[2].text).toBe('Conclusion\nx > 3 ne s’applique pas ici');
    expect(describeDocument(doc)).toBe('3 diapositives');
  });
});

describe('extraction TXT et MD', () => {
  it('lit un TXT UTF-8 par blocs de lignes', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Ligne ${i + 1} : élève, être, où, œuvre.`);
    const doc = await extract('notes.txt', utf8(`${lines.join('\n')}\n`));
    expect(doc.kind).toBe('txt');
    expect(doc.stats.lines).toBe(50);
    expect(doc.units[0].locator).toEqual({ type: 'lines', start: 1, end: 40 });
    expect(doc.units[1].locator).toEqual({ type: 'lines', start: 41, end: 50 });
    expect(doc.units[0].text.split('\n')[0]).toBe('Ligne 1 : élève, être, où, œuvre.');
    expect(describeDocument(doc)).toBe('50 lignes');
  });

  it('compte une seule ligne pour un fichier d’une ligne terminé par un saut de ligne', async () => {
    const doc = await extract('une-ligne.txt', utf8('Une seule ligne.\n'));
    expect(doc.stats.lines).toBe(1);
    expect(describeDocument(doc)).toBe('1 ligne');
    const crlf = await extract('windows.txt', utf8('Première\r\nDeuxième\r\n'));
    expect(crlf.stats.lines).toBe(2);
    expect(crlf.units[0].locator).toEqual({ type: 'lines', start: 1, end: 2 });
  });

  it('décode un TXT Windows-1252 (accents)', async () => {
    const doc = await extract('ancien.txt', encodeWindows1252('Élève à l’école : « déjà vu », cœur, 10 €.\nDeuxième ligne ç.'));
    expect(doc.units[0].text).toBe('Élève à l’école : « déjà vu », cœur, 10 €.\nDeuxième ligne ç.');
  });

  it('décode un TXT UTF-16 (« Unicode » du Bloc-notes)', async () => {
    const text = 'Été, août, forêt.';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    [...text].forEach((c, i) => {
      bytes[2 + i * 2] = c.charCodeAt(0) & 0xff;
      bytes[3 + i * 2] = c.charCodeAt(0) >> 8;
    });
    const doc = await extract('unicode.txt', bytes);
    expect(doc.units[0].text).toBe(text);
  });

  it('découpe un MD en sections sans confondre un commentaire de code avec un titre', async () => {
    const md = 'Introduction libre.\n\n# Chapitre 1\n\nTexte du chapitre.\n\n```python\n# ceci n\'est pas un titre\nprint("x > 3")\n```\n\n## Exercices\n\n- Calculer 2 * 3.\n';
    const doc = await extract('cours.md', utf8(md));
    expect(doc.kind).toBe('md');
    expect(doc.units.map(u => u.locator)).toEqual([
      { type: 'lines', start: 1, end: 2 },
      { type: 'section', start: 1, end: 1, title: 'Chapitre 1' },
      { type: 'section', start: 2, end: 2, title: 'Exercices' },
    ]);
    expect(doc.units[1].text).toContain("# ceci n'est pas un titre");
    expect(doc.units[1].text).toContain('print("x > 3")');
    expect(doc.units[2].text).toBe('## Exercices\n\n- Calculer 2 * 3.');
    expect(doc.stats.lines).toBe(14);
    expect(describeDocument(doc)).toBe('2 sections');
  });
});

describe('contrôles de format', () => {
  it('refuse une extension incohérente avec le contenu', async () => {
    const docx = await makeDocxWithoutHeadings(2);
    const pdf = makePdf([['Texte']]);
    await expectCode(extract('rapport.pdf', docx), 'DOCUMENT_UNREADABLE');
    await expectCode(extract('cours.docx', pdf), 'DOCUMENT_UNREADABLE');
    await expectCode(extract('diapos.pptx', utf8('pas un zip')), 'DOCUMENT_UNREADABLE');
    await expectCode(extract('notes.txt', pdf), 'DOCUMENT_UNREADABLE');
    await expectCode(extract('programme.md', new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])), 'DOCUMENT_UNREADABLE');
  });

  it('refuse un format non pris en charge et un fichier vide', async () => {
    await expectCode(extract('tableur.xlsx', utf8('x')), 'DOCUMENT_UNSUPPORTED');
    await expectCode(extract('vide.txt', new Uint8Array()), 'DOCUMENT_UNREADABLE');
  });

  it('extractFile lit un fichier local (sans envoi) et attribue un identifiant unique', async () => {
    expect(ACCEPT).toBe('.pdf,.docx,.pptx,.txt,.md');
    expect(DOCUMENT_LIMITS.maxFileBytes).toBeGreaterThan(0);
    const file = new File([utf8('Bonjour les élèves.\n')], 'bonjour.txt', { type: 'text/plain' });
    const a = await extractFile(file);
    const b = await extractFile(file);
    expect(a.units[0].text).toBe('Bonjour les élèves.');
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    const docx = new File([new Uint8Array(await makeDocxWithHeadings())], 'sequence.docx');
    expect((await extractFile(docx)).stats.sections).toBe(2);
    await expect(extractFile(new File([utf8('x')], 'image.png'))).rejects.toMatchObject({ code: 'DOCUMENT_UNSUPPORTED' });
  });
});

// ─── Sélection des passages ─────────────────────────────────────────────────

function pagedDoc(id: string, name: string, pages: string[]): ExtractedDocument {
  return {
    id,
    name,
    kind: 'pdf',
    units: pages.map((text, i) => ({ locator: { type: 'pages', start: i + 1, end: i + 1 }, text })),
    stats: { pages: pages.length, chars: pages.reduce((n, p) => n + p.length, 0) },
    warnings: [],
  };
}

const filler = (i: number) => `Page ${i} : considérations générales sur l'organisation de la classe, le rythme des séances et la progression annuelle. `.repeat(6);

describe('selectPassages', () => {
  const pages = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    return n >= 14 && n <= 18
      ? `Page ${n} : la photosynthèse transforme l'énergie lumineuse ; la chlorophylle capte la lumière et la photosynthèse produit du glucose. `.repeat(4)
      : filler(n);
  });
  const manuel = pagedDoc('manuel', 'Manuel SVT.pdf', pages);
  const relevantLength = pages.slice(13, 18).reduce((n, p) => n + p.length, 0);

  it('regroupe les pages contiguës pertinentes (pages 14 à 18) et respecte le budget', () => {
    const budget = relevantLength + 5 * 2;
    const passages = selectPassages([manuel], 'photosynthèse chlorophylle', { budgetChars: budget });
    expect(passages).toHaveLength(1);
    expect(passages[0].locator).toEqual({ type: 'pages', start: 14, end: 18 });
    expect(formatLocator(passages[0].locator)).toBe('pages 14 à 18');
    expect(passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(budget);
  });

  it('ne dépasse jamais le budget, séparateurs compris', () => {
    for (const budget of [500, 1_000, 2_345, 5_000, 9_999, 20_000]) {
      const passages = selectPassages([manuel], 'photosynthèse', { budgetChars: budget });
      expect(passages.reduce((n, p) => n + p.text.length, 0), `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('garde au moins un passage par document, dans l’ordre des documents', () => {
    const autre = pagedDoc('zz-autre', 'Programme.pdf', Array.from({ length: 5 }, (_, i) => filler(i + 1)));
    const passages = selectPassages([autre, manuel], 'photosynthèse chlorophylle', { budgetChars: relevantLength });
    const docs = passages.map(p => p.docId);
    expect(docs).toContain('zz-autre');
    expect(docs).toContain('manuel');
    expect(docs[0]).toBe('zz-autre');
    expect(passages.some(p => p.docId === 'manuel' && p.locator.start >= 14 && p.locator.end <= 18)).toBe(true);
  });

  it('inclut tout le document s’il tient dans le budget', () => {
    const court = pagedDoc('court', 'Fiche.pdf', ['Page un.', 'Page deux.', 'Page trois.']);
    const passages = selectPassages([court], 'sans rapport', { budgetChars: 10_000 });
    expect(passages).toEqual([
      { docId: 'court', docName: 'Fiche.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 3 }, text: 'Page un.\n\nPage deux.\n\nPage trois.' },
    ]);
  });

  it('cite les sections séparément et garde leur titre', async () => {
    const doc = await extract('sequence.docx', await makeDocxWithHeadings());
    const passages = selectPassages([doc], 'démocratie', { budgetChars: 100_000 });
    expect(passages.map(p => formatLocator(p.locator))).toEqual(['paragraphe 1', 'section « Introduction »', 'section « Évaluation »']);
  });
});

describe('formatLocator sur les localisations extraites', () => {
  it('formate pages, diapositives, sections, paragraphes et lignes', async () => {
    const pdf = await extract('a.pdf', makePdf([['Un'], ['Deux']]));
    const pptx = await extract('b.pptx', await makePptx());
    const docx = await extract('c.docx', await makeDocxWithoutHeadings(10));
    const txt = await extract('d.txt', utf8(Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1}`).join('\n')));
    const md = await extract('e.md', utf8('# Les fractions égales\n\nTexte.'));
    expect(formatLocator(pdf.units[1].locator)).toBe('page 2');
    expect(formatLocator({ type: 'pages', start: 14, end: 18 })).toBe('pages 14 à 18');
    expect(formatLocator(pptx.units[0].locator)).toBe('diapositive 1');
    expect(formatLocator({ ...pptx.units[0].locator, end: 3 })).toBe('diapositives 1 à 3');
    expect(formatLocator(docx.units[0].locator)).toBe('paragraphes 1 à 8');
    expect(formatLocator(txt.units[0].locator)).toBe('lignes 1 à 12');
    expect(formatLocator(md.units[0].locator)).toBe('section « Les fractions égales »');
  });
});

describe('TXT / MD : le texte de l’enseignant garde son indentation (non-régression)', () => {
  it('le code Python d’un fichier Markdown est transmis avec son indentation et ses docstrings', async () => {
    const md = '# TP récursivité\n\n```python\ndef fact(n):\n    """Factorielle."""\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n```\n';
    const doc = await extractDocument({ id: 'md1', name: 'tp.md', bytes: new TextEncoder().encode(md) });
    const all = doc.units.map(u => u.text).join('\n');
    expect(all).toContain('def fact(n):\n    """Factorielle."""\n    if n <= 1:\n        return 1');
  });

  it('un fichier texte garde tabulations et alignements', async () => {
    const txt = 'Nom\tNote\nAlice\t15\n    retrait conservé\n';
    const doc = await extractDocument({ id: 't1', name: 'notes.txt', bytes: new TextEncoder().encode(txt) });
    expect(doc.units.map(u => u.text).join('\n')).toBe('Nom\tNote\nAlice\t15\n    retrait conservé');
  });
});
