// Extraction de texte des documents de l'enseignant, entièrement locale.
// Chaque passage conserve sa localisation exacte (page, diapositive, section, lignes)
// afin que les citations puissent être vérifiées par l'enseignant.

import JSZip from 'jszip';
import { MagistraError } from '../errors.js';
import { validateLocatorLabels } from '../validation.js';
import type { DocKind, Locator } from '../types.js';
import { cleanExtractedText, cleanPlainText, decodeText, decodeXmlEntities } from './text.js';
import { DOCUMENT_LIMITS, type DocumentUnit, type ExtractedDocument } from './types.js';

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

function pdfItemsToText(items: unknown[]): string {
  let out = '';
  let prev: PdfTextItem | null = null;
  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string') continue;
    if (prev && !prev.hasEOL && item.str && !/\s$/.test(out) && !/^\s/.test(item.str)) {
      const prevEnd = (prev.transform?.[4] ?? 0) + (prev.width ?? 0);
      const x = item.transform?.[4] ?? prevEnd;
      const sameLine = Math.abs((item.transform?.[5] ?? 0) - (prev.transform?.[5] ?? 0)) < 1;
      const fontSize = Math.abs(item.transform?.[0] ?? item.height ?? 10) || 10;
      if (!sameLine) out += '\n';
      else if (x - prevEnd > fontSize * 0.15) out += ' ';
    }
    out += item.str;
    if (item.hasEOL) out += '\n';
    prev = item;
  }
  return out;
}

export async function extractPdf(input: ExtractInput, pdfjs: PdfJsLike): Promise<ExtractedDocument> {
  // pdf.js peut transférer (détacher) le tampon : on lui passe une copie.
  const data = new Uint8Array(input.bytes);
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const units: DocumentUnit[] = [];
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
      const label = validateLocatorLabels({ start: labels?.[p - 1] ?? '', end: labels?.[p - 1] ?? '' });
      const printed = label && label.start !== String(p) ? { labels: label } : {};
      units.push({ locator: { type: 'pages', start: p, end: p, ...printed }, text });
    }
  } finally {
    await pdf.destroy?.();
  }
  if (emptyPages > 0 && units.length > 0) {
    warnings.push(`${emptyPages} page(s) sans texte sélectionnable (images ou scans) ont été ignorées.`);
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

function docxRunText(xml: string): string {
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

export function parseDocxParagraphs(documentXml: string): DocxParagraph[] {
  // Les lignes de tableau deviennent un paragraphe « cellule | cellule | cellule ».
  const flattened = documentXml.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, row => {
    const cells = [...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(c => docxRunText(c[0]).replace(/\s+/g, ' ').trim());
    const escaped = cells.join(' | ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>`;
  });
  const paragraphs: DocxParagraph[] = [];
  // Paragraphe vide auto-fermant (<w:p w:rsidR="…"/>) d'abord : sinon il avalerait le paragraphe suivant.
  for (const m of flattened.matchAll(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const block = m[0];
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
  const hasHeadings = paragraphs.some(p => p.headingLevel !== undefined);
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

export async function extractDocx(input: ExtractInput): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(input.bytes);
  const file = zip.file('word/document.xml');
  if (!file) throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » n'est pas un document Word valide.`);
  const xml = await file.async('string');
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

function slideText(xml: string): string {
  const paragraphs: string[] = [];
  for (const m of xml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)) {
    const text = [...m[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(t => decodeXmlEntities(t[1])).join('');
    if (text.trim()) paragraphs.push(text.trim());
  }
  return paragraphs.join('\n');
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
  for (const m of xml.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /\sId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\sTarget="([^"]+)"/.exec(m[0])?.[1];
    const type = /\sType="([^"]+)"/.exec(m[0])?.[1] ?? '';
    if (id && target) map.set(id, { target: decodeXmlEntities(target), type });
  }
  return map;
}

export async function extractPptx(input: ExtractInput): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(input.bytes);
  const presentation = await zip.file('ppt/presentation.xml')?.async('string');
  const presRels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!presentation || !presRels) throw new MagistraError('DOCUMENT_UNREADABLE', `« ${input.name} » n'est pas une présentation PowerPoint valide.`);

  const rels = parseRels(presRels);
  const slidePaths: string[] = [];
  for (const m of presentation.matchAll(/<p:sldId\s[^>]*>/g)) {
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const rel = rid ? rels.get(rid) : undefined;
    if (rel) slidePaths.push(resolveRel('ppt', rel.target));
  }
  if (slidePaths.length === 0) {
    // Repli : ordre numérique des fichiers de diapositives.
    slidePaths.push(
      ...Object.keys(zip.files)
        .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10)),
    );
  }

  const units: DocumentUnit[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    let text = slideText(xml);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const relsPath = `${dir}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;
    const slideRelsXml = await zip.file(relsPath)?.async('string');
    if (slideRelsXml) {
      const notesRel = [...parseRels(slideRelsXml).values()].find(r => r.type.endsWith('/notesSlide'));
      if (notesRel) {
        const notesXml = await zip.file(resolveRel(dir, notesRel.target))?.async('string');
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
    stats: { slides: slidePaths.length, chars: countChars(units) },
    warnings: [],
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
    const heading = !inCode ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) {
      if (!current && preamble.length) {
        units.push(...linesToBlocks(preamble).map(u => ({ ...u, text: cleanPlainText(u.text) })).filter(u => u.text));
        preamble = [];
      }
      pushCurrent();
      section++;
      current = { title: heading[2].slice(0, 160), startLine: 0, lines: [line], index: section };
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
