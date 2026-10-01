// Extraction de texte des documents de l'enseignant, entièrement locale.
// Chaque passage conserve sa localisation exacte (page, diapositive, section, lignes)
// afin que les citations puissent être vérifiées par l'enseignant.

import JSZip from 'jszip';
import { MagistraError } from '../errors.js';
import { validateLocatorLabels } from '../validation.js';
import type { DocKind, Locator } from '../types.js';
import { cleanExtractedText, cleanPlainText, decodeText, decodeXmlEntities } from './text.js';
import { DOCUMENT_LIMITS, type DocumentUnit, type ExtractedDocument } from './types.js';
import { xmlBlocks, xmlOpenTags } from './xmlScan.js';

// ─── Interface minimale de pdf.js (injectée : build navigateur ou Node selon l'environnement) ──

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

export interface PdfJsLike {
  getDocument(params: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean; stopAtErrors?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?: () => void }>;
      /** Numéros de page imprimés définis par le PDF (« i », « ii », « 1 »…), ou null. */
      getPageLabels?: () => Promise<(string | null)[] | null>;
      destroy?: () => Promise<void>;
    }>;
  };
}

export interface ExtractInput {
  id: string;
  name: string;
  bytes: Uint8Array;
}

export interface ExtractDeps {
  pdfjs?: PdfJsLike;
}

const EXT_KIND: Record<string, DocKind> = {
  pdf: 'pdf', docx: 'docx', pptx: 'pptx', txt: 'txt', md: 'md', markdown: 'md', text: 'txt',
};

export function detectKind(name: string, bytes: Uint8Array): DocKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const kind = EXT_KIND[ext];
  if (!kind) return null;
  const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isZip = bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (kind === 'pdf' && !isPdf) return null;
  if ((kind === 'docx' || kind === 'pptx') && !isZip) return null;
  if ((kind === 'txt' || kind === 'md') && (isPdf || isZip || looksBinary(bytes))) return null;
  return kind;
}

/** Octets nuls dans le début du fichier (hors UTF-16 avec BOM) : ce n'est pas du texte. */
function looksBinary(bytes: Uint8Array): boolean {
  const utf16 = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
  if (utf16) return false;
  const end = Math.min(bytes.length, 4096);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

export async function extractDocument(input: ExtractInput, deps: ExtractDeps = {}): Promise<ExtractedDocument> {
  if (input.bytes.byteLength > DOCUMENT_LIMITS.maxFileBytes) {
    throw new MagistraError('DOCUMENT_TOO_LARGE', `« ${input.name} » dépasse ${Math.round(DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024)} Mo.`);
  }
  const ext = input.name.toLowerCase().split('.').pop() ?? '';
  if (!EXT_KIND[ext]) throw new MagistraError('DOCUMENT_UNSUPPORTED');
  const kind = detectKind(input.name, input.bytes);
  if (!kind) throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » est endommagé ou ne correspond pas à son extension.`);

  let doc: ExtractedDocument;
  try {
    switch (kind) {
      case 'pdf':
        if (!deps.pdfjs) throw new MagistraError('DOCUMENT_UNSUPPORTED', 'Lecture des PDF indisponible.');
        doc = await extractPdf(input, deps.pdfjs);
        break;
      case 'docx':
        doc = await extractDocx(input);
        break;
      case 'pptx':
        doc = await extractPptx(input);
        break;
      case 'md':
        doc = extractMarkdown(input);
        break;
      default:
        doc = extractPlainText(input);
    }
  } catch (err) {
    if (err instanceof MagistraError) throw err;
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new MagistraError('DOCUMENT_PROTECTED', `« ${input.name} » est protégé par un mot de passe.`);
    throw new MagistraError('DOCUMENT_UNREADABLE', `Document impossible à lire : « ${input.name} ».`, { cause: err });
  }

  if (doc.stats.chars === 0) {
    if (kind === 'pdf') throw new MagistraError('DOCUMENT_SCANNED', `« ${input.name} » ne contient pas de texte sélectionnable (document scanné).`);
    throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » ne contient aucun texte.`);
  }
  if (doc.stats.chars > DOCUMENT_LIMITS.maxCharsPerDocument) {
    throw new MagistraError('DOCUMENT_TOO_LARGE', `« ${input.name} » contient trop de texte pour être analysé.`);
  }
  return doc;
}

function countChars(units: DocumentUnit[]): number {
  return units.reduce((n, u) => n + u.text.length, 0);
}

// ─── PDF ──────────────────────────────────────────────────────────────────

function pdfFontSize(item: PdfTextItem): number {
  return Math.abs(item.transform?.[0] ?? item.height ?? 10) || 10;
}

export function pdfItemsToText(items: unknown[]): string {
  let out = '';
  let prev: PdfTextItem | null = null;
  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string') continue;
    if (prev && !prev.hasEOL && item.str && !/\s/.test(out.charAt(out.length - 1)) && !/^\s/.test(item.str)) {
      const prevEnd = (prev.transform?.[4] ?? 0) + (prev.width ?? 0);
      const x = item.transform?.[4] ?? prevEnd;
      const dy = Math.abs((item.transform?.[5] ?? 0) - (prev.transform?.[5] ?? 0));
      const fontSize = pdfFontSize(item);
      const prevSize = pdfFontSize(prev);
      const big = Math.max(fontSize, prevSize);
      const gap = x - prevEnd;
      // Exposant ou indice (CO₂, mc², 10⁸) : corps nettement plus petit, légèrement décalé, et qui prolonge
      // la ligne horizontalement. Une vraie ligne suivante revient à gauche ou est décalée d'au moins une demi-ligne.
      const script = Math.min(fontSize, prevSize) < big * 0.85 && dy < big * 0.5 && gap >= -big * 0.25;
      if (dy >= 1 && !script) out += '\n';
      else if (script && gap < big * 0.3) {
        // collé : « CO2 », « mc2 »
      } else if (gap > fontSize * 0.15) out += ' ';
    }
    out += item.str;
    if (item.hasEOL) out += '\n';
    prev = item;
  }
  return out;
}

/**
 * Clé d'une ligne qui ressemble à un en-tête ou un pied de page courant (« Lycée Jean Moulin - SVT - Chapitre 3 »,
 * « Année 2025-2026 - Page 3/6 »), ou null. Volontairement étroit : il faut un numéro de page, un séparateur
 * (« - », « | ») ou une année ; sinon la ligne (« Exercice 3 », en-tête de tableau…) n'est jamais considérée.
 * Les chiffres ne sont neutralisés que pour une ligne portant un numéro de page.
 */
function runningLineKey(line: string): string | null {
  const t = line.trim();
  if (t.length < 12 || t.length > 120) return null;
  const pageMarker = /\bpages?\s*\d+|\b\d+\s*\/\s*\d+\b|\bp\.\s*\d+/i.test(t);
  const separator = /\s[-–—|·•]\s|©|\b(?:19|20)\d\d\b/.test(t);
  if (!pageMarker && !separator) return null;
  const spaced = t.replace(/\s+/g, ' ').toLowerCase();
  return pageMarker ? spaced.replace(/\d+/g, '#') : spaced;
}

const MIN_PAGES_FOR_RUNNING_LINES = 4;

/**
 * Retire des pages l'en-tête / le pied de page répétés (première ou dernière ligne identique sur au moins 60 % des
 * pages, 4 pages minimum). La première occurrence est conservée : le modèle voit l'établissement et le titre une
 * fois, sans qu'ils diluent la recherche dans chaque page. Une page n'est jamais vidée.
 */
export function stripRunningLines(pages: string[]): string[] {
  if (pages.length < MIN_PAGES_FOR_RUNNING_LINES) return pages;
  const lines = pages.map(p => p.split('\n'));
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.length < 2) continue;
    for (const key of new Set([runningLineKey(l[0]), runningLineKey(l[l.length - 1])])) {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const repeated = new Set([...counts].filter(([, n]) => n >= threshold).map(([key]) => key));
  if (repeated.size === 0) return pages;
  const seen = new Set<string>();
  const drop = (key: string | null): boolean => {
    if (!key || !repeated.has(key)) return false;
    if (!seen.has(key)) {
      seen.add(key);
      return false;
    }
    return true;
  };
  return pages.map((page, i) => {
    const l = lines[i];
    if (l.length < 2) return page;
    const dropFirst = drop(runningLineKey(l[0]));
    const dropLast = drop(runningLineKey(l[l.length - 1]));
    const kept = l.slice(dropFirst ? 1 : 0, dropLast ? l.length - 1 : l.length).join('\n').trim();
    return kept || page;
  });
}

export async function extractPdf(input: ExtractInput, pdfjs: PdfJsLike): Promise<ExtractedDocument> {
  // pdf.js peut transférer (détacher) le tampon : on lui passe une copie.
  const data = new Uint8Array(input.bytes);
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const pageTexts: { page: number; text: string }[] = [];
  const warnings: string[] = [];
  const pages = Math.min(pdf.numPages, DOCUMENT_LIMITS.maxPdfPages);
  if (pdf.numPages > pages) warnings.push(`Seules les ${pages} premières pages ont été analysées.`);
  let emptyPages = 0;
  // Numéros imprimés : une citation « page 47 » doit correspondre à ce que l'enseignant lit sur la page.
  const labels = await pdf.getPageLabels?.().catch(() => null) ?? null;
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = cleanExtractedText(pdfItemsToText(content.items));
      page.cleanup?.();
      if (!text) {
        emptyPages++;
        continue;
      }
      pageTexts.push({ page: p, text });
    }
  } finally {
    await pdf.destroy?.();
  }
  const rawChars = pageTexts.reduce((n, t) => n + t.text.length, 0);
  // Une couche de texte réduite à des numéros de page ou à un filigrane n'est pas un document lisible.
  if (pageTexts.length >= 3 && rawChars / pageTexts.length < 5) {
    throw new MagistraError('DOCUMENT_SCANNED', `« ${input.name} » ne contient pas de texte sélectionnable (document scanné).`);
  }
  const cleaned = stripRunningLines(pageTexts.map(t => t.text));
  const units: DocumentUnit[] = pageTexts.map(({ page: p }, i) => {
    const label = validateLocatorLabels({ start: labels?.[p - 1] ?? '', end: labels?.[p - 1] ?? '' });
    const printed = label && label.start !== String(p) ? { labels: label } : {};
    return { locator: { type: 'pages' as const, start: p, end: p, ...printed }, text: cleaned[i] };
  });
  if (emptyPages > 0 && units.length > 0) {
    warnings.push(`${emptyPages} page(s) sans texte sélectionnable (images ou scans) ont été ignorées.`);
  }
  if (pageTexts.length >= 3) {
    const sparse = pageTexts.filter(t => t.text.length < 30).length;
    if (rawChars / pageTexts.length < 40 || sparse / pageTexts.length > 0.5) {
      warnings.push('Ce PDF contient très peu de texte sélectionnable : s’il s’agit d’un scan, utilisez un PDF avec texte ou une reconnaissance de caractères (OCR).');
    }
  }
  return {
    id: input.id,
    name: input.name,
    kind: 'pdf',
    units,
    stats: { pages: pdf.numPages, chars: countChars(units) },
    warnings,
  };
}

// ─── DOCX ─────────────────────────────────────────────────────────────────

interface DocxParagraph {
  text: string;
  headingLevel?: number;
}

const HEADING_STYLE = /^(heading|titre|title|berschrift|kop)\s*(\d)?$/i;

const XML_SPACE = /\s/;
const DOCX_EMPTY_RUN = /<w:(?:tab|br|cr|noBreakHyphen)\s*\/>/y;

/** Texte d'un bloc DOCX (balayage linéaire : un `<w:t>` jamais refermé ne fait pas reparcourir tout le reste). */
function docxRunText(xml: string): string {
  let out = '';
  let unclosed = false;
  let i = xml.indexOf('<w:');
  while (i !== -1) {
    const next = xml.charAt(i + 4);
    if (xml.startsWith('<w:t', i) && (next === '>' || XML_SPACE.test(next))) {
      // <w:t> ou <w:t xml:space="preserve"> : sans </w:t> plus loin, aucun <w:t> suivant ne peut se refermer.
      if (!unclosed) {
        const gt = xml.indexOf('>', i);
        if (gt === -1) break;
        const close = xml.indexOf('</w:t>', gt + 1);
        if (close === -1) unclosed = true;
        else {
          out += decodeXmlEntities(xml.slice(gt + 1, close));
          i = xml.indexOf('<w:', close + 6);
          continue;
        }
      }
    } else {
      DOCX_EMPTY_RUN.lastIndex = i;
      const m = DOCX_EMPTY_RUN.exec(xml);
      if (m) {
        if (m[0].startsWith('<w:tab')) out += '\t';
        else if (m[0].startsWith('<w:noBreakHyphen')) out += '-';
        else out += '\n';
      }
    }
    i = xml.indexOf('<w:', i + 3);
  }
  return out;
}

const escapeXmlText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parseDocxParagraphs(documentXml: string): DocxParagraph[] {
  // Les lignes de tableau deviennent un paragraphe « cellule | cellule | cellule ».
  let flattened = '';
  let pos = 0;
  for (const row of xmlBlocks(documentXml, 'w:tr')) {
    if (row.selfClosing) continue;
    const cells: string[] = [];
    for (const cell of xmlBlocks(documentXml, 'w:tc', row.innerStart, row.innerEnd)) {
      cells.push(docxRunText(documentXml.slice(cell.start, cell.end)).replace(/\s+/g, ' ').trim());
    }
    flattened += `${documentXml.slice(pos, row.start)}<w:p><w:r><w:t>${escapeXmlText(cells.join(' | '))}</w:t></w:r></w:p>`;
    pos = row.end;
  }
  flattened += documentXml.slice(pos);
  const paragraphs: DocxParagraph[] = [];
  // Les paragraphes vides auto-fermants (<w:p w:rsidR="…"/>) sont reconnus à part : ils n'avalent pas le suivant.
  for (const m of xmlBlocks(flattened, 'w:p')) {
    if (m.selfClosing) continue;
    const block = flattened.slice(m.start, m.end);
    const text = docxRunText(block).replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(block)?.[1] ?? '';
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(block)?.[1];
    let headingLevel: number | undefined;
    const hm = HEADING_STYLE.exec(style.replace(/[-_]/g, ''));
    if (hm) headingLevel = hm[2] ? parseInt(hm[2], 10) : 1;
    else if (outline !== undefined) headingLevel = parseInt(outline, 10) + 1;
    paragraphs.push({ text, headingLevel });
  }
  return paragraphs;
}

/** Regroupe des paragraphes en unités : sections sous titres, sinon blocs de paragraphes numérotés. */
function paragraphsToUnits(paragraphs: DocxParagraph[]): { units: DocumentUnit[]; sections: number } {
  const units: DocumentUnit[] = [];
  // Un seul style de titre (le « Titre » de Word, intertitres en gras manuel) ne structure rien : tout le document
  // serait UNE section citée par le titre du fichier. Il en faut au moins deux ; sinon blocs de paragraphes.
  const hasHeadings = paragraphs.filter(p => p.headingLevel !== undefined).length >= 2;
  if (!hasHeadings) {
    const BLOCK = 8;
    for (let i = 0; i < paragraphs.length; i += BLOCK) {
      const slice = paragraphs.slice(i, i + BLOCK);
      units.push({
        locator: { type: 'paragraphs', start: i + 1, end: i + slice.length },
        text: slice.map(p => p.text).join('\n\n'),
      });
    }
    return { units, sections: 0 };
  }
  let sectionIndex = 0;
  let current: { title?: string; start: number; texts: string[] } | null = null;
  let preamble: string[] = [];
  const flush = () => {
    if (current && current.texts.length) {
      units.push({
        locator: { type: 'section', start: current.start, end: current.start, title: current.title },
        text: current.texts.join('\n\n'),
      });
    }
  };
  for (const p of paragraphs) {
    if (p.headingLevel !== undefined) {
      if (!current && preamble.length) {
        units.push({ locator: { type: 'paragraphs', start: 1, end: preamble.length }, text: preamble.join('\n\n') });
        preamble = [];
      }
      flush();
      sectionIndex++;
      current = { title: p.text.slice(0, 160), start: sectionIndex, texts: [p.text] };
    } else if (current) {
      current.texts.push(p.text);
    } else {
      preamble.push(p.text);
    }
  }
  if (!current && preamble.length) {
    units.push({ locator: { type: 'paragraphs', start: 1, end: preamble.length }, text: preamble.join('\n\n') });
  }
  flush();
  return { units, sections: sectionIndex };
}

// ─── Zip (DOCX / PPTX) : lecture bornée ───────────────────────────────────

/** Octets décompressés encore autorisés pour un fichier ; partagé par toutes les lectures de ce fichier. */
interface ZipBudget {
  name: string;
  remaining: number;
}

const tooLargeUnzipped = (name: string) => new MagistraError('DOCUMENT_TOO_LARGE', `« ${name} » est trop volumineux une fois décompressé.`);
const tooManyEntries = (name: string) => new MagistraError('DOCUMENT_TOO_LARGE', `« ${name} » contient trop d'éléments : fichier refusé.`);

/**
 * Nombre d'entrées de l'annuaire central du zip, compté sans rien décompresser (22 octets de lecture par
 * en-tête) ; null si l'annuaire n'est pas lisible (JSZip décidera alors seul).
 */
function countZipEntries(bytes: Uint8Array, limit: number): number | null {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) return null;
  let count = 0;
  while (offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    if (++count > limit) return count;
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return count;
}

async function openZip(input: ExtractInput): Promise<JSZip> {
  // JSZip charge tout l'annuaire en mémoire (≈ 10 Ko par entrée) : on refuse avant, sur le compte de l'annuaire.
  const declared = countZipEntries(input.bytes, DOCUMENT_LIMITS.maxZipEntries);
  if (declared !== null && declared > DOCUMENT_LIMITS.maxZipEntries) throw tooManyEntries(input.name);
  const zip = await JSZip.loadAsync(input.bytes);
  if (Object.keys(zip.files).length > DOCUMENT_LIMITS.maxZipEntries) throw tooManyEntries(input.name);
  return zip;
}

interface ZipStream {
  on(event: 'data', cb: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'error', cb: (err: unknown) => void): ZipStream;
  on(event: 'end', cb: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

/**
 * Lit une entrée XML du zip en comptant les octets décompressés au fil de l'eau : la taille annoncée par le zip
 * est modifiable par un fichier piégé, seul le compte réel fait foi. Au-delà de la limite par entrée ou du budget
 * du fichier, la lecture s'arrête immédiatement (rien de plus n'est décompressé).
 */
async function readZipText(zip: JSZip, path: string, budget: ZipBudget): Promise<string | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  const cap = Math.min(DOCUMENT_LIMITS.maxXmlEntryBytes, budget.remaining);
  const declared = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > cap) throw tooLargeUnzipped(budget.name);
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let settled = false;
    const stream = (entry as unknown as { internalStream(type: 'uint8array'): ZipStream }).internalStream('uint8array');
    stream
      .on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > cap) {
          settled = true;
          stream.pause();
          reject(tooLargeUnzipped(budget.name));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', err => {
        if (settled) return;
        settled = true;
        reject(err);
      })
      .on('end', () => {
        if (settled) return;
        settled = true;
        const all = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          all.set(c, at);
          at += c.length;
        }
        resolve(all);
      })
      .resume();
  });
  budget.remaining -= bytes.length;
  return new TextDecoder('utf-8').decode(bytes);
}

export async function extractDocx(input: ExtractInput): Promise<ExtractedDocument> {
  const zip = await openZip(input);
  const xml = await readZipText(zip, 'word/document.xml', { name: input.name, remaining: DOCUMENT_LIMITS.maxUncompressedBytes });
  if (xml === undefined) throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » n'est pas un document Word valide.`);
  const paragraphs = parseDocxParagraphs(xml);
  const { units, sections } = paragraphsToUnits(paragraphs);
  return {
    id: input.id,
    name: input.name,
    kind: 'docx',
    units: units.map(u => ({ ...u, text: cleanExtractedText(u.text) })),
    stats: { sections: sections || undefined, paragraphs: paragraphs.length, chars: countChars(units) },
    warnings: [],
  };
}

// ─── PPTX ─────────────────────────────────────────────────────────────────

/** Paragraphes `<a:p>` de `xml[from..to]` : un texte par ligne. */
function paragraphLines(xml: string, from: number, to: number): string[] {
  const lines: string[] = [];
  for (const p of xmlBlocks(xml, 'a:p', from, to)) {
    if (p.selfClosing) continue;
    let text = '';
    for (const t of xmlBlocks(xml, 'a:t', p.innerStart, p.innerEnd)) text += decodeXmlEntities(xml.slice(t.innerStart, t.innerEnd));
    if (text.trim()) lines.push(text.trim());
  }
  return lines;
}

/**
 * Texte d'une diapositive. Une ligne de tableau (`<a:tr>`) devient une ligne « cellule | cellule | cellule », comme
 * dans les DOCX : sans cela chaque cellule serait une ligne et « 1/2 = 0,5 = 50 % » perdrait son lien.
 */
function slideText(xml: string): string {
  const lines: string[] = [];
  let pos = 0;
  for (const table of xmlBlocks(xml, 'a:tbl')) {
    if (table.selfClosing) continue;
    lines.push(...paragraphLines(xml, pos, table.start));
    for (const row of xmlBlocks(xml, 'a:tr', table.innerStart, table.innerEnd)) {
      if (row.selfClosing) continue;
      const cells: string[] = [];
      // Une cellule fusionnée ou vide reste une cellule vide : les colonnes restent alignées.
      for (const cell of xmlBlocks(xml, 'a:tc', row.innerStart, row.innerEnd)) {
        cells.push(paragraphLines(xml, cell.innerStart, cell.innerEnd).join(' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.some(Boolean)) lines.push(cells.join(' | '));
    }
    pos = table.end;
  }
  lines.push(...paragraphLines(xml, pos, xml.length));
  return lines.join('\n');
}

function resolveRel(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${baseDir}/${target}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function parseRels(xml: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  for (const tag of xmlOpenTags(xml, 'Relationship')) {
    const id = /\sId="([^"]+)"/.exec(tag)?.[1];
    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\sType="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (id && target) map.set(id, { target: decodeXmlEntities(target), type });
  }
  return map;
}

export async function extractPptx(input: ExtractInput): Promise<ExtractedDocument> {
  const zip = await openZip(input);
  const budget: ZipBudget = { name: input.name, remaining: DOCUMENT_LIMITS.maxUncompressedBytes };
  const presentation = await readZipText(zip, 'ppt/presentation.xml', budget);
  const presRels = await readZipText(zip, 'ppt/_rels/presentation.xml.rels', budget);
  if (!presentation || !presRels) throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » n'est pas une présentation PowerPoint valide.`);

  const rels = parseRels(presRels);
  // Une diapositive citée plusieurs fois par la présentation n'est lue (et comptée) qu'une fois.
  const slideSet = new Set<string>();
  for (const tag of xmlOpenTags(presentation, 'p:sldId')) {
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
    const rel = rid ? rels.get(rid) : undefined;
    if (rel) slideSet.add(resolveRel('ppt', rel.target));
  }
  let slidePaths = [...slideSet];
  if (slidePaths.length === 0) {
    // Repli : ordre numérique des fichiers de diapositives.
    slidePaths = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
  }
  const totalSlides = slidePaths.length;
  const warnings: string[] = [];
  if (totalSlides > DOCUMENT_LIMITS.maxSlides) {
    slidePaths = slidePaths.slice(0, DOCUMENT_LIMITS.maxSlides);
    warnings.push(`Seules les ${DOCUMENT_LIMITS.maxSlides} premières diapositives ont été analysées.`);
  }

  const units: DocumentUnit[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const xml = await readZipText(zip, path, budget);
    if (!xml) continue;
    let text = slideText(xml);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const relsPath = `${dir}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;
    const slideRelsXml = await readZipText(zip, relsPath, budget);
    if (slideRelsXml) {
      const notesRel = [...parseRels(slideRelsXml).values()].find(r => r.type.endsWith('/notesSlide'));
      if (notesRel) {
        const notesXml = await readZipText(zip, resolveRel(dir, notesRel.target), budget);
        const notes = notesXml ? slideText(notesXml).replace(/^\d+$/gm, '').trim() : '';
        if (notes) text += `\nNotes de l'orateur : ${notes}`;
      }
    }
    text = cleanExtractedText(text);
    if (text) units.push({ locator: { type: 'slides', start: i + 1, end: i + 1 }, text });
  }
  return {
    id: input.id,
    name: input.name,
    kind: 'pptx',
    units,
    stats: { slides: totalSlides, chars: countChars(units) },
    warnings,
  };
}

// ─── TXT / MD ─────────────────────────────────────────────────────────────

function linesToBlocks(lines: string[], offset = 0): DocumentUnit[] {
  const units: DocumentUnit[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = (endIdx: number) => {
    if (buf.length && buf.some(l => l.trim())) {
      units.push({ locator: { type: 'lines', start: start + 1 + offset, end: endIdx + offset }, text: buf.join('\n') });
    }
    buf = [];
    start = -1;
  };
  lines.forEach((line, i) => {
    if (start < 0) start = i;
    buf.push(line);
    if ((!line.trim() && buf.length >= 12) || buf.length >= 40) flush(i + 1);
  });
  flush(lines.length);
  return units;
}

/** Lignes du texte ; le saut de ligne final ne crée pas de ligne supplémentaire (« a\n » = 1 ligne). */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function extractPlainText(input: ExtractInput): ExtractedDocument {
  const text = decodeText(input.bytes).replace(/\r\n?/g, '\n');
  const lines = splitLines(text);
  const units = linesToBlocks(lines).map(u => ({ ...u, text: cleanPlainText(u.text) })).filter(u => u.text);
  return {
    id: input.id,
    name: input.name,
    kind: 'txt',
    units,
    stats: { lines: lines.length, chars: countChars(units) },
    warnings: [],
  };
}

/**
 * Titre d'une ligne Markdown « ## Titre » (dièses de fermeture retirés : « # Titre ## » → « Titre »), ou null.
 * Lecture linéaire, sans expression rationnelle à retour arrière : une ligne de 200 000 espaces ne fige rien.
 */
export function parseMarkdownHeading(line: string): string | null {
  let level = 0;
  while (level < 7 && line.charCodeAt(level) === 35) level++;
  if (level === 0 || level > 6 || !XML_SPACE.test(line.charAt(level))) return null;
  const text = line.trimEnd();
  let start = level;
  while (start < text.length && XML_SPACE.test(text.charAt(start))) start++;
  if (start >= text.length) return null;
  let title = text.slice(start);
  let end = title.length;
  while (end > 0 && title.charCodeAt(end - 1) === 35) end--;
  if (end > 0 && end < title.length && XML_SPACE.test(title.charAt(end - 1))) title = title.slice(0, end).trimEnd();
  return title;
}

export function extractMarkdown(input: ExtractInput): ExtractedDocument {
  const text = decodeText(input.bytes).replace(/\r\n?/g, '\n');
  const lines = splitLines(text);
  const units: DocumentUnit[] = [];
  let section = 0;
  let current: { title?: string; startLine: number; lines: string[]; index: number } | null = null;
  let preamble: string[] = [];
  let inCode = false;
  const pushCurrent = () => {
    if (current) {
      const body = cleanPlainText(current.lines.join('\n'));
      if (body) units.push({ locator: { type: 'section', start: current.index, end: current.index, title: current.title }, text: body });
    }
  };
  lines.forEach(line => {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    const heading = !inCode ? parseMarkdownHeading(line) : null;
    if (heading !== null) {
      if (!current && preamble.length) {
        units.push(...linesToBlocks(preamble).map(u => ({ ...u, text: cleanPlainText(u.text) })).filter(u => u.text));
        preamble = [];
      }
      pushCurrent();
      section++;
      current = { title: heading.slice(0, 160), startLine: 0, lines: [line], index: section };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  });
  if (!current && preamble.length) {
    units.push(...linesToBlocks(preamble).map(u => ({ ...u, text: cleanPlainText(u.text) })).filter(u => u.text));
  }
  pushCurrent();
  return {
    id: input.id,
    name: input.name,
    kind: 'md',
    units,
    stats: { sections: section || undefined, lines: lines.length, chars: countChars(units) },
    warnings: [],
  };
}

export function describeDocument(doc: ExtractedDocument): string {
  const s = doc.stats;
  if (s.pages !== undefined) return `${s.pages} page${s.pages > 1 ? 's' : ''}`;
  if (s.slides !== undefined) return `${s.slides} diapositive${s.slides > 1 ? 's' : ''}`;
  if (s.sections) return `${s.sections} section${s.sections > 1 ? 's' : ''}`;
  if (s.paragraphs !== undefined) return `${s.paragraphs} paragraphe${s.paragraphs > 1 ? 's' : ''}`;
  if (s.lines !== undefined) return `${s.lines} ligne${s.lines > 1 ? 's' : ''}`;
  return `${s.chars} caractères`;
}

export type { Locator };
