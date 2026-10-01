// Robustesse de l'extraction face à des fichiers piégés : temps linéaire (ReDoS) et décompression bornée.
// Les bornes de temps sont larges (CI lente) mais très en dessous de ce que les anciennes expressions rationnelles
// demandaient (plusieurs secondes à plusieurs minutes pour ces mêmes entrées).

import { afterEach, describe, expect, it } from 'vitest';
import { extractDocument, extractMarkdown, extractPlainText, parseDocxParagraphs, parseMarkdownHeading } from '@shared/documents/extract';
import { cleanExtractedText, cleanPlainText } from '@shared/documents/text';
import { DOCUMENT_LIMITS } from '@shared/documents/types';
import { decodeXmlEntities } from '@shared/documents/text';
import { MagistraError } from '@shared/errors';
import { forgeDeclaredSize, makeDocxBomb, makeDocxFromBody, makeDocxWithHeadings, makePptx, makePptxFromSlides, slideTextXml } from './fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const BOUND_MS = 1500;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

describe('ReDoS : titres Markdown (constat 3)', () => {
  it('une ligne « # a » + 200 000 espaces + « x » est traitée en temps linéaire', () => {
    const line = `# a${' '.repeat(200_000)}x`;
    const { value, ms } = timed(() => parseMarkdownHeading(line));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBe(line.slice(2).trimStart());
    const doc = timed(() => extractMarkdown({ id: 'm', name: 'piege.md', bytes: utf8(`${line}\nTexte.\n`) }));
    expect(doc.ms).toBeLessThan(BOUND_MS);
    expect(doc.value.units).toHaveLength(1);
    // Le titre cité reste borné à 160 caractères.
    expect(doc.value.units[0].locator).toMatchObject({ type: 'section', start: 1 });
    expect((doc.value.units[0].locator as { title?: string }).title).toHaveLength(160);
  });

  it('une longue suite de dièses ou d’espaces en fin de titre reste linéaire', () => {
    expect(timed(() => parseMarkdownHeading(`# Titre ${'#'.repeat(300_000)}`)).ms).toBeLessThan(BOUND_MS);
    expect(timed(() => parseMarkdownHeading(`# Titre${' #'.repeat(150_000)}`)).ms).toBeLessThan(BOUND_MS);
  });

  it('comportement conservé sur les titres usuels', () => {
    expect(parseMarkdownHeading('# Titre ##')).toBe('Titre');
    expect(parseMarkdownHeading('## T #x')).toBe('T #x');
    expect(parseMarkdownHeading('###### Niveau six')).toBe('Niveau six');
    expect(parseMarkdownHeading('####### sept dièses')).toBeNull();
    expect(parseMarkdownHeading('#   ')).toBeNull();
    expect(parseMarkdownHeading('#Pas de blanc')).toBeNull();
    expect(parseMarkdownHeading('Texte # courant')).toBeNull();
    // Les dièses collés au mot ne sont pas des dièses de fermeture (« C# » reste « C# »).
    expect(parseMarkdownHeading('# Le langage C#')).toBe('Le langage C#');
    expect(parseMarkdownHeading('#\tTitre\t')).toBe('Titre');
  });

  it('un titre dans un bloc de code n’en est pas un', () => {
    const md = '# Cours\n\n```\n# commentaire\n```\n\n## Suite\n';
    const doc = extractMarkdown({ id: 'm', name: 'c.md', bytes: utf8(md) });
    expect(doc.units.map(u => (u.locator as { title?: string }).title)).toEqual(['Cours', 'Suite']);
  });
});

describe('ReDoS : nettoyage du texte (constat 4)', () => {
  for (const [label, pad] of [['espaces', ' '], ['tabulations', '\t'], ['espaces insécables', ' ']] as const) {
    it(`cleanPlainText : « a » + 200 000 ${label} + « x » (et en fin de ligne)`, () => {
      const run = pad.repeat(200_000);
      const { value, ms } = timed(() => cleanPlainText(`a${run}x\nfin${run}\n\n\n\nsuite`));
      expect(ms).toBeLessThan(BOUND_MS);
      // Espaces internes conservés, espaces de fin de ligne retirés, 3 sauts de ligne ou plus réduits à 2.
      expect(value).toBe(`a${run}x\nfin\n\nsuite`);
    });
  }

  it('cleanPlainText garde sa sémantique (indentation, fin de ligne, lignes vides, caractères de contrôle)', () => {
    expect(cleanPlainText('\n\n  def f():\n      return 1  \t\n\n\n\n\nfin \u0001 \n\n')).toBe('  def f():\n      return 1\n\nfin');
    expect(cleanPlainText('a\u0000b')).toBe('ab');
    expect(cleanPlainText('   ')).toBe('');
  });

  it('cleanExtractedText reste linéaire sur une longue suite d’espaces', () => {
    const { value, ms } = timed(() => cleanExtractedText(`a${' '.repeat(200_000)}\n${' '.repeat(100_000)}b${'\t'.repeat(100_000)}\nc`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBe('a\nb\nc');
  });

  it('extractPlainText et extractMarkdown : même entrée piégée, import rapide et texte correct', () => {
    const text = `a${' '.repeat(200_000)}x\nsuite`;
    const txt = timed(() => extractPlainText({ id: 't', name: 'piege.txt', bytes: utf8(text) }));
    const md = timed(() => extractMarkdown({ id: 'm', name: 'piege.md', bytes: utf8(`# Titre\n${text}`) }));
    expect(txt.ms).toBeLessThan(BOUND_MS);
    expect(md.ms).toBeLessThan(BOUND_MS);
    expect(txt.value.units[0].text).toBe(text);
    expect(md.value.units[0].text).toBe(`# Titre\n${text}`);
  });
});

// ─── XML jamais refermé (constat 6) ─────────────────────────────────────────────

/** Ancienne implémentation (expressions rationnelles paresseuses), gardée ici comme référence de comportement. */
function legacyRunText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>|<w:noBreakHyphen\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:noBreakHyphen')) out += '-';
    else out += '\n';
  }
  return out;
}

function legacyParagraphs(documentXml: string): { text: string; headingLevel?: number }[] {
  const flattened = documentXml.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, row => {
    const cells = [...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(c => legacyRunText(c[0]).replace(/\s+/g, ' ').trim());
    const escaped = cells.join(' | ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>`;
  });
  const out: { text: string; headingLevel?: number }[] = [];
  for (const m of flattened.matchAll(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const block = m[0];
    const text = legacyRunText(block).replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(block)?.[1] ?? '';
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(block)?.[1];
    let headingLevel: number | undefined;
    const hm = /^(heading|titre|title|berschrift|kop)\s*(\d)?$/i.exec(style.replace(/[-_]/g, ''));
    if (hm) headingLevel = hm[2] ? parseInt(hm[2], 10) : 1;
    else if (outline !== undefined) headingLevel = parseInt(outline, 10) + 1;
    out.push({ text, headingLevel });
  }
  return out;
}

describe('ReDoS : XML DOCX / PPTX jamais refermé (constat 6)', () => {
  it('200 000 <w:p> jamais refermés : analyse rapide', () => {
    const { value, ms } = timed(() => parseDocxParagraphs(`<w:body>${'<w:p>'.repeat(200_000)}</w:body>`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toEqual([]);
  });

  it('200 000 <w:tr> jamais refermés, 200 000 <w:p><w:t>x jamais refermés, 200 000 <w:tc>', () => {
    for (const xml of ['<w:tr>'.repeat(200_000), '<w:p><w:t>x'.repeat(200_000), `<w:tr>${'<w:tc>'.repeat(200_000)}</w:tr>`, '<w:p>'.repeat(100_000) + '<w:t>y</w:t></w:p>']) {
      const { ms } = timed(() => parseDocxParagraphs(`<w:body>${xml}</w:body>`));
      expect(ms).toBeLessThan(BOUND_MS);
    }
  });

  it('200 000 <w:t> non refermés dans un paragraphe n’empêchent pas de lire les paragraphes voisins', () => {
    const xml = `<w:p><w:r><w:t>Bonjour</w:t></w:r></w:p><w:p>${'<w:t>'.repeat(200_000)}<w:tab/></w:p><w:p><w:r><w:t>Au revoir</w:t></w:r></w:p>`;
    const { value, ms } = timed(() => parseDocxParagraphs(xml));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value.map(p => p.text)).toEqual(['Bonjour', 'Au revoir']);
  });

  it('PPTX : 200 000 <a:p> et <a:t> jamais refermés dans une diapositive', async () => {
    for (const body of ['<a:p>'.repeat(200_000), '<a:p><a:t>x'.repeat(200_000), '<a:tbl><a:tr>'.repeat(100_000)]) {
      const slide = `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
      const bytes = await makePptxFromSlides([slide, slideTextXml(['Diapositive suivante'])]);
      const t0 = performance.now();
      const doc = await extractDocument({ id: 'p', name: 'piege.pptx', bytes });
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(doc.units.map(u => u.text)).toEqual(['Diapositive suivante']);
    }
  });

  it('même sortie que les anciennes expressions rationnelles sur des XML bien formés (comparaison à la référence)', async () => {
    // Fixture réelle (titres, tableau, paragraphe vide auto-fermant).
    const real = await makeDocxWithHeadings();
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(real)).file('word/document.xml')!.async('string');
    expect(parseDocxParagraphs(xml)).toEqual(legacyParagraphs(xml));

    // XML bien formés variés, produits de façon déterministe.
    const frag = [
      '<w:p><w:r><w:t>Premier</w:t></w:r></w:p>',
      '<w:p w:rsidR="00A1"><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">Un titre </w:t></w:r><w:r><w:t>à &amp; é</w:t></w:r></w:p>',
      '<w:p/>',
      '<w:p w:rsidR="1" w:rsidRDefault="2"/>',
      '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Plan</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>suite</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>ligne</w:t></w:r></w:p>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b &lt; c</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>',
      '<w:p><w:r><w:noBreakHyphen/><w:t>dix</w:t><w:cr/></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t></w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Titre"/></w:pPr><w:r><w:t>Titre seul</w:t></w:r></w:p>',
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 60; n++) {
      const body = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => frag[Math.floor(rnd() * frag.length)]).join('');
      const doc = `<w:document><w:body>${body}</w:body></w:document>`;
      expect(parseDocxParagraphs(doc), doc).toEqual(legacyParagraphs(doc));
    }
  });
});

// ─── Bombe de décompression (constats 5 et 13) ──────────────────────────────────

describe('DOCX / PPTX : décompression bornée (constats 5 et 13)', () => {
  const saved = { ...DOCUMENT_LIMITS };
  afterEach(() => Object.assign(DOCUMENT_LIMITS, saved));

  async function expectTooLarge(promise: Promise<unknown>): Promise<MagistraError> {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MagistraError);
    expect((err as MagistraError).code).toBe('DOCUMENT_TOO_LARGE');
    return err as MagistraError;
  }

  it('un .docx de quelques Ko qui se décompresse au-delà de la limite est refusé vite, avec un message clair', async () => {
    const bomb = await makeDocxBomb(DOCUMENT_LIMITS.maxXmlEntryBytes + 10 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const t0 = performance.now();
    const err = await expectTooLarge(extractDocument({ id: 'b', name: 'bombe.docx', bytes: bomb }));
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(err.message).toBe('« bombe.docx » est trop volumineux une fois décompressé.');
  });

  it('même bombe dans une diapositive de .pptx', async () => {
    DOCUMENT_LIMITS.maxXmlEntryBytes = 2 * 1024 * 1024;
    const big = `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:t>${'a'.repeat(4 * 1024 * 1024)}</a:t></a:p></p:sld>`;
    const bytes = await makePptxFromSlides([slideTextXml(['Normale']), big]);
    await expectTooLarge(extractDocument({ id: 'b', name: 'bombe.pptx', bytes }));
  });

  it('la taille annoncée par le zip peut mentir : seul le compte réel des octets décompressés fait foi', async () => {
    DOCUMENT_LIMITS.maxXmlEntryBytes = 1024 * 1024;
    const real = await makeDocxBomb(6 * 1024 * 1024);
    const forged = forgeDeclaredSize(real, 'word/document.xml', 1000);
    await expectTooLarge(extractDocument({ id: 'b', name: 'menteur.docx', bytes: forged }));
  });

  it('le total décompressé d’un même fichier est borné (diapositives nombreuses)', async () => {
    DOCUMENT_LIMITS.maxUncompressedBytes = 600 * 1024;
    DOCUMENT_LIMITS.maxXmlEntryBytes = 600 * 1024;
    const slide = (n: number) => slideTextXml([`Diapositive ${n}`, 'x'.repeat(100 * 1024)]);
    const bytes = await makePptxFromSlides(Array.from({ length: 12 }, (_, i) => slide(i + 1)));
    await expectTooLarge(extractDocument({ id: 'b', name: 'long.pptx', bytes }));
  });

  it('trop d’entrées dans le zip : refusé', async () => {
    DOCUMENT_LIMITS.maxZipEntries = 50;
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Bonjour</w:t></w:r></w:p></w:body></w:document>');
    for (let i = 0; i < 60; i++) zip.file(`word/media/image${i}.png`, 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expectTooLarge(extractDocument({ id: 'b', name: 'beaucoup.docx', bytes }));
  });

  it('une présentation qui cite plusieurs fois la même diapositive ne la lit et ne la compte qu’une fois', async () => {
    const bytes = await makePptxFromSlides([slideTextXml(['Théorème de Thalès', 'Rapports de longueurs'])], Array.from({ length: 500 }, () => 1));
    const doc = await extractDocument({ id: 'p', name: 'repete.pptx', bytes });
    expect(doc.stats.slides).toBe(1);
    expect(doc.units).toHaveLength(1);
    expect(doc.units[0].text).toBe('Théorème de Thalès\nRapports de longueurs');
  });

  it('au-delà de la limite de diapositives : les premières sont analysées, avec un avertissement', async () => {
    DOCUMENT_LIMITS.maxSlides = 5;
    const bytes = await makePptxFromSlides(Array.from({ length: 8 }, (_, i) => slideTextXml([`Diapositive ${i + 1}`])));
    const doc = await extractDocument({ id: 'p', name: 'long.pptx', bytes });
    expect(doc.units.map(u => u.locator.start)).toEqual([1, 2, 3, 4, 5]);
    expect(doc.stats.slides).toBe(8);
    expect(doc.warnings).toEqual(['Seules les 5 premières diapositives ont été analysées.']);
  });

  it('les documents normaux ne sont pas touchés', async () => {
    const docx = await extractDocument({ id: 'd', name: 'sequence.docx', bytes: await makeDocxWithHeadings() });
    expect(docx.stats.sections).toBe(2);
    const pptx = await extractDocument({ id: 'p', name: 'revolution.pptx', bytes: await makePptx() });
    expect(pptx.units).toHaveLength(3);
    expect(pptx.warnings).toEqual([]);
    const small = await extractDocument({ id: 's', name: 's.docx', bytes: await makeDocxFromBody('<w:p><w:r><w:t>Bonjour</w:t></w:r></w:p>') });
    expect(small.units[0].text).toBe('Bonjour');
  });
});
