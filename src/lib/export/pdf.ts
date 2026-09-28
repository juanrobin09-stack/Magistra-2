// Export PDF fidèle : le Markdown est analysé en arbre (unified + remark-parse + GFM + maths),
// puis chaque nœud est dessiné avec jsPDF et les polices DejaVu (Unicode complet).
//
// Garantie : le texte n'est JAMAIS réécrit. Tirets, « > », « * », « < », indices, accents et
// symboles mathématiques sont conservés à l'identique (texte extractible identique).
// Seules exceptions, documentées :
//   - les émojis pictographiques absents des polices (🎓, 🚀, ✅…) sont retirés, ainsi que les
//     caractères invisibles qui les accompagnent (sélecteurs de variante, liants) ; un pictogramme
//     présent dans la police (⚠, ✔, ☑, ©…) est conservé ;
//   - un caractère absent de toutes les polices (idéogrammes CJK par exemple) est remplacé par
//     sa forme de compatibilité Unicode (NFKC) si elle existe, sinon par « � » ;
//   - les formules $…$ sont converties en texte Unicode (x^2 → x², \frac{a}{b} → a/b) ; une formule
//     non convertible est reproduite telle quelle (source TeX).
//
// Taille : jsPDF ne garde que les glyphes utilisés, mais recopie la table « post » complète
// (noms de 6 000 glyphes). On la remplace par une table « post » version 3 (sans noms), ce qui
// divise environ par deux le poids de chaque police intégrée (≈ 50 Ko → ≈ 23 Ko).

import { jsPDF } from 'jspdf';
import { autoTable, type CellDef, type CellInput, type RowInput } from 'jspdf-autotable';
import type {
  Blockquote, Code, Heading, List, Nodes, PhrasingContent, Root, RootContent, Table, TableCell,
} from 'mdast';
import type { ExportDoc } from './index';
import { formatExportDate, metaLine } from './format';
import { parseMarkdown } from './markdown';
import { texToUnicode } from './tex';

// ─── Polices ─────────────────────────────────────────────────────────────────

export type FontData = ArrayBuffer | Uint8Array;
export type FontKey = 'regular' | 'bold' | 'italic' | 'bolditalic' | 'mono';

/** Polices TTF injectées (DejaVu Sans / DejaVu Sans Mono). Les trois dernières sont facultatives. */
export interface PdfFonts {
  regular: FontData;
  bold: FontData;
  italic?: FontData;
  bolditalic?: FontData;
  mono?: FontData;
}

const FACES: Record<FontKey, { family: string; style: string; file: string }> = {
  regular: { family: 'DejaVuSans', style: 'normal', file: 'DejaVuSans.ttf' },
  bold: { family: 'DejaVuSans', style: 'bold', file: 'DejaVuSans-Bold.ttf' },
  italic: { family: 'DejaVuSans', style: 'italic', file: 'DejaVuSans-Oblique.ttf' },
  bolditalic: { family: 'DejaVuSans', style: 'bolditalic', file: 'DejaVuSans-BoldOblique.ttf' },
  mono: { family: 'DejaVuSansMono', style: 'normal', file: 'DejaVuSansMono.ttf' },
};

const binaryCache = new WeakMap<object, string>();

/** Chaîne binaire (jsPDF reconnaît la signature TrueType et évite un aller-retour base64). */
function toBinaryString(data: FontData): string {
  const cached = binaryCache.get(data);
  if (cached) return cached;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  binaryCache.set(data, out);
  return out;
}

interface TtfMetadata {
  characterToGlyph(code: number): number;
  post?: { raw?: () => ArrayLike<number> | null };
}

/** Remplace la table « post » (noms de glyphes, inutiles dans un PDF) par sa version 3 compacte. */
function shrinkPostTable(meta: TtfMetadata): void {
  const post = meta.post;
  if (!post?.raw) return;
  const original = post.raw();
  if (!original || original.length < 32) return;
  const compact = Array.from(original).slice(0, 32);
  compact[0] = 0;
  compact[1] = 3;
  compact[2] = 0;
  compact[3] = 0;
  post.raw = () => compact.slice();
}

const INVISIBLE = new Set([0x00ad, 0x200b, 0x200c, 0x200e, 0x200f, 0x2060, 0xfeff]);
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

function isEmojiComponent(cp: number): boolean {
  return cp === 0x200d || cp === 0xfe0e || cp === 0xfe0f || cp === 0x20e3
    || (cp >= 0x1f3fb && cp <= 0x1f3ff) // teintes de peau
    || (cp >= 0x1f1e6 && cp <= 0x1f1ff) // indicateurs régionaux (drapeaux)
    || (cp >= 0xe0020 && cp <= 0xe007f); // étiquettes
}

interface Seg {
  text: string;
  key: FontKey;
}

export interface PdfExportStats {
  /** Émojis retirés (absents des polices). */
  emojiRemoved: number;
  /** Caractères remplacés par « � » (absents de toutes les polices). */
  unsupported: number;
}

class FontBook {
  private readonly doc: jsPDF;
  private readonly data: PdfFonts;
  private readonly metas = new Map<FontKey, TtfMetadata>();
  private readonly fonts = new Map<FontKey, ReturnType<jsPDF['getFont']>>();
  private readonly coverage = new Map<string, boolean>();
  private readonly charWidths = new Map<string, number>();
  readonly stats: PdfExportStats = { emojiRemoved: 0, unsupported: 0 };

  constructor(doc: jsPDF, data: PdfFonts) {
    this.doc = doc;
    this.data = data;
  }

  /** Police réellement disponible pour un style demandé (repli : gras → normal). */
  resolve(key: FontKey): FontKey {
    if (key === 'regular' || key === 'bold') return key;
    if (this.data[key]) return key;
    return key === 'bolditalic' ? 'bold' : 'regular';
  }

  private font(key: FontKey): ReturnType<jsPDF['getFont']> {
    const k = this.resolve(key);
    const existing = this.fonts.get(k);
    if (existing) return existing;
    const face = FACES[k];
    const data = this.data[k];
    if (!data) throw new Error(`Police manquante : ${k}`);
    this.doc.addFileToVFS(face.file, toBinaryString(data));
    this.doc.addFont(face.file, face.family, face.style);
    this.doc.setFont(face.family, face.style);
    const font = this.doc.getFont();
    const meta = font.metadata as TtfMetadata;
    shrinkPostTable(meta);
    this.metas.set(k, meta);
    this.fonts.set(k, font);
    return font;
  }

  /** Enregistre la police (utile avant un tableau : jspdf-autotable fait appel à setFont). */
  prepare(key: FontKey): void {
    this.font(key);
  }

  family(key: FontKey): { family: string; style: string } {
    const k = this.resolve(key);
    return { family: FACES[k].family, style: FACES[k].style };
  }

  covers(key: FontKey, cp: number): boolean {
    const k = this.resolve(key);
    const id = `${k}:${cp}`;
    const known = this.coverage.get(id);
    if (known !== undefined) return known;
    this.font(k);
    const meta = this.metas.get(k)!;
    const ok = cp <= 0xffff && meta.characterToGlyph(cp) > 0;
    this.coverage.set(id, ok);
    return ok;
  }

  use(key: FontKey, size: number): void {
    const font = this.font(key);
    this.doc.setFont(font.fontName, font.fontStyle);
    this.doc.setFontSize(size);
  }

  width(text: string, key: FontKey, size: number): number {
    if (!text) return 0;
    const font = this.font(key);
    return this.doc.getStringUnitWidth(text, { font, fontSize: size }) * size;
  }

  charWidth(ch: string, key: FontKey, size: number): number {
    const id = `${key}|${size}|${ch}`;
    let w = this.charWidths.get(id);
    if (w === undefined) {
      w = this.width(ch, key, size);
      this.charWidths.set(id, w);
    }
    return w;
  }

  /**
   * Prépare un texte pour la police : chaque caractère est dessiné avec une police qui le contient
   * (style demandé, sinon DejaVu Sans normal ; `single` : style demandé uniquement, pour les cellules
   * de tableau). Voir l'en-tête du fichier pour les seules exceptions.
   * Les retours à la ligne doivent être traités par l'appelant.
   */
  segment(text: string, key: FontKey, single = false): Seg[] {
    const out: Seg[] = [];
    const push = (s: string, k: FontKey) => {
      const last = out[out.length - 1];
      if (last && last.key === k) last.text += s;
      else out.push({ text: s, key: k });
    };
    const pick = (cp: number): FontKey | null => {
      if (this.covers(key, cp)) return key;
      if (!single && this.covers('regular', cp)) return 'regular';
      return null;
    };
    for (const ch of text.normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x09) {
        push(' ', pick(0x20) ?? key);
        continue;
      }
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || INVISIBLE.has(cp)) continue;
      if (isEmojiComponent(cp)) continue;
      const direct = cp <= 0xffff ? pick(cp) : null;
      if (direct) {
        push(ch, direct);
        continue;
      }
      if (EXTENDED_PICTOGRAPHIC.test(ch)) {
        this.stats.emojiRemoved++;
        continue;
      }
      const compat = ch.normalize('NFKC');
      const compatChars = [...compat];
      if (compat !== ch && compatChars.every(c => (c.codePointAt(0) ?? 0) <= 0xffff && pick(c.codePointAt(0)!))) {
        for (const c of compatChars) push(c, pick(c.codePointAt(0)!)!);
        continue;
      }
      this.stats.unsupported++;
      push('\ufffd', pick(0xfffd) ?? key);
    }
    return out;
  }

  /** Texte dessiné d'une seule police (cellules de tableau), mêmes règles que `segment`. */
  plain(text: string, key: FontKey): string {
    return text
      .split('\n')
      .map(line => this.segment(line, key, true).map(s => s.text).join(''))
      .join('\n');
  }
}

// ─── Mise en page ────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 62;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;
const BODY_SIZE = 10.5;
const LINE_FACTOR = 1.45;
const ASCENT = 0.928;
const GLYPH_HEIGHT = 1.164;

/** Dimensions utilisées (exposées pour les tests). */
export const PDF_LAYOUT = { PAGE_W, PAGE_H, MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM, CONTENT_W, BODY_SIZE } as const;

const COLORS = {
  text: [28, 28, 40] as RGB,
  muted: [92, 92, 114] as RGB,
  heading: [46, 32, 104] as RGB,
  accent: [124, 98, 214] as RGB,
  link: [36, 72, 184] as RGB,
  codeBg: [243, 241, 250] as RGB,
  codeText: [38, 30, 66] as RGB,
  quoteBar: [176, 160, 232] as RGB,
  quoteText: [60, 60, 82] as RGB,
  rule: [206, 200, 228] as RGB,
  tableHead: [236, 231, 252] as RGB,
  zebra: [248, 247, 253] as RGB,
  tableLine: [196, 192, 220] as RGB,
};

const HEADINGS: Record<number, { size: number; key: FontKey; color: RGB; before: number; after: number; rule?: RGB }> = {
  1: { size: 18, key: 'bold', color: COLORS.heading, before: 16, after: 8, rule: COLORS.accent },
  2: { size: 15, key: 'bold', color: COLORS.heading, before: 14, after: 6, rule: COLORS.rule },
  3: { size: 12.5, key: 'bold', color: COLORS.text, before: 11, after: 4 },
  4: { size: 11.25, key: 'bold', color: COLORS.text, before: 9, after: 3 },
  5: { size: 10.5, key: 'bolditalic', color: COLORS.text, before: 8, after: 2 },
  6: { size: 10, key: 'italic', color: COLORS.muted, before: 8, after: 2 },
};

const BULLETS = ['•', '◦', '▪'];

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  math?: boolean;
  link?: string;
  color?: RGB;
}

interface Piece {
  text: string;
  style: InlineStyle;
  hardBreak?: boolean;
}

interface Part {
  text: string;
  key: FontKey;
  size: number;
  style: InlineStyle;
  width: number;
}

interface Word {
  parts: Part[];
  width: number;
  /** Style de l'espace qui précède le mot (null : pas d'espace). */
  spaceBefore: InlineStyle | null;
}

interface Line {
  runs: Part[];
  width: number;
}

interface Box {
  x: number;
  width: number;
}

interface BlockContext {
  tight: boolean;
  color: RGB;
  depth: number;
}

function sameStyle(a: InlineStyle, b: InlineStyle): boolean {
  return Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic)
    && Boolean(a.code) === Boolean(b.code) && Boolean(a.strike) === Boolean(b.strike)
    && Boolean(a.math) === Boolean(b.math) && a.link === b.link && a.color === b.color;
}

function decorated(style: InlineStyle): boolean {
  return Boolean(style.link || style.code || style.strike);
}

function keyFor(style: InlineStyle): FontKey {
  if (style.code) return 'mono';
  if (style.math) return style.bold ? 'bold' : 'regular';
  if (style.bold && style.italic) return 'bolditalic';
  if (style.bold) return 'bold';
  if (style.italic) return 'italic';
  return 'regular';
}

function baseKeyStyle(key: FontKey): InlineStyle {
  return { bold: key === 'bold' || key === 'bolditalic', italic: key === 'italic' || key === 'bolditalic' };
}

function safeLink(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : undefined;
}

/** Le libellé du lien est-il déjà l'adresse (lien automatique) ? */
function sameTarget(label: string, url: string): boolean {
  const norm = (v: string) => v.trim().replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '').toLowerCase();
  return norm(label) === norm(url);
}

function normalizeTitle(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes.map(n => {
    if (n.type === 'text' || n.type === 'inlineCode' || n.type === 'html') return n.value;
    if (n.type === 'inlineMath') return n.value;
    if ('children' in n) return plainText(n.children as PhrasingContent[]);
    return '';
  }).join('');
}

/** Formule en ligne : Unicode si possible, sinon source TeX telle quelle. */
function inlineMathPiece(value: string, style: InlineStyle): Piece {
  const converted = texToUnicode(value);
  if (converted !== null) return { text: converted, style: { ...style, math: true } };
  return { text: `$${value}$`, style: { ...style, code: true } };
}

class PdfWriter {
  readonly doc: jsPDF;
  readonly fonts: FontBook;
  private y = MARGIN_TOP;
  private readonly bars: { x: number; startY: number }[] = [];
  private pendingMarker: { text: string; x: number; key: FontKey } | null = null;
  private readonly definitions = new Map<string, string>();

  constructor(doc: jsPDF, fonts: FontBook) {
    this.doc = doc;
    this.fonts = fonts;
  }

  // ── Pages ──────────────────────────────────────────────────────────────

  private get bottom(): number {
    return PAGE_H - MARGIN_BOTTOM;
  }

  private ensure(height: number): void {
    if (this.y + height > this.bottom + 0.01 && this.y > MARGIN_TOP + 0.5) this.newPage();
  }

  private newPage(): void {
    for (const bar of this.bars) this.drawBar(bar.x, bar.startY, this.y);
    this.doc.addPage();
    this.y = MARGIN_TOP;
    for (const bar of this.bars) bar.startY = this.y;
  }

  /** Après un tableau qui a ajouté des pages : filets de citation sur les pages intermédiaires. */
  private pagesAdded(fromPage: number, toPage: number, startY: number): void {
    if (toPage === fromPage || this.bars.length === 0) return;
    for (let p = fromPage; p < toPage; p++) {
      this.doc.setPage(p);
      for (const bar of this.bars) this.drawBar(bar.x, p === fromPage ? startY : MARGIN_TOP, this.bottom);
    }
    this.doc.setPage(toPage);
    for (const bar of this.bars) bar.startY = MARGIN_TOP;
  }

  private space(amount: number): void {
    if (this.y > MARGIN_TOP + 0.5) this.y += amount;
  }

  private drawBar(x: number, from: number, to: number): void {
    if (to - from < 1) return;
    this.doc.setDrawColor(...COLORS.quoteBar);
    this.doc.setLineWidth(2.2);
    this.doc.line(x, from, x, to);
  }

  private currentPage(): number {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  // ── Texte en ligne ──────────────────────────────────────────────────────

  private flatten(nodes: readonly PhrasingContent[], style: InlineStyle, out: Piece[] = []): Piece[] {
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push({ text: node.value, style });
          break;
        case 'emphasis':
          this.flatten(node.children, { ...style, italic: true }, out);
          break;
        case 'strong':
          this.flatten(node.children, { ...style, bold: true }, out);
          break;
        case 'delete':
          this.flatten(node.children, { ...style, strike: true }, out);
          break;
        case 'inlineCode':
          out.push({ text: node.value, style: { ...style, code: true } });
          break;
        case 'break':
          out.push({ text: '', style, hardBreak: true });
          break;
        case 'inlineMath':
          out.push(inlineMathPiece(node.value, style));
          break;
        case 'link': {
          const url = safeLink(node.url);
          this.flatten(node.children, url ? { ...style, link: url } : style, out);
          if (url && !sameTarget(plainText(node.children), url)) {
            out.push({ text: ` (${url})`, style: { ...style, color: COLORS.muted, link: url } });
          }
          break;
        }
        case 'linkReference': {
          const url = safeLink(this.definitions.get(node.identifier));
          this.flatten(node.children, url ? { ...style, link: url } : style, out);
          if (url && !sameTarget(plainText(node.children), url)) {
            out.push({ text: ` (${url})`, style: { ...style, color: COLORS.muted, link: url } });
          }
          break;
        }
        case 'image':
        case 'imageReference': {
          const alt = node.alt ? `Image : ${node.alt}` : 'Image';
          out.push({ text: `[${alt}]`, style: { ...style, color: COLORS.muted } });
          break;
        }
        case 'footnoteReference':
          out.push({ text: `[${node.label ?? node.identifier}]`, style });
          break;
        case 'html':
          out.push({ text: node.value, style });
          break;
        default:
          break;
      }
    }
    return out;
  }

  private words(pieces: Piece[], size: number): (Word | 'BR')[] {
    const tokens: (Word | 'BR')[] = [];
    let current: Word | null = null;
    let pendingSpace: InlineStyle | null = null;
    const flush = () => {
      if (current && current.parts.length) tokens.push(current);
      current = null;
    };
    for (const piece of pieces) {
      if (piece.hardBreak) {
        flush();
        tokens.push('BR');
        pendingSpace = null;
        continue;
      }
      const partSize = piece.style.code ? size * 0.9 : size;
      const key = keyFor(piece.style);
      // Seuls les espaces ordinaires sont des points de coupure (les espaces insécables restent).
      for (const chunk of piece.text.split(/([ \t\n\r\f\v]+)/)) {
        if (!chunk) continue;
        if (/^[ \t\n\r\f\v]+$/.test(chunk)) {
          flush();
          pendingSpace = piece.style;
          continue;
        }
        const segs = this.fonts.segment(chunk, key);
        if (segs.length === 0) continue;
        if (!current) {
          current = { parts: [], width: 0, spaceBefore: pendingSpace };
          pendingSpace = null;
        }
        const word: Word = current;
        for (const seg of segs) {
          const width = this.fonts.width(seg.text, seg.key, partSize);
          const last = word.parts[word.parts.length - 1];
          if (last && last.key === seg.key && last.size === partSize && sameStyle(last.style, piece.style)) {
            last.text += seg.text;
            last.width += width;
          } else {
            word.parts.push({ text: seg.text, key: seg.key, size: partSize, style: piece.style, width });
          }
          word.width += width;
        }
      }
    }
    flush();
    return tokens;
  }

  /** Coupe un mot plus long que la ligne (URL, formule) caractère par caractère. */
  private splitLongWord(word: Word, maxWidth: number): Word[] {
    const chunks: Word[] = [];
    let cur: Word = { parts: [], width: 0, spaceBefore: word.spaceBefore };
    for (const part of word.parts) {
      for (const ch of part.text) {
        const w = this.fonts.charWidth(ch, part.key, part.size);
        if (cur.width + w > maxWidth && cur.width > 0) {
          chunks.push(cur);
          cur = { parts: [], width: 0, spaceBefore: null };
        }
        const last = cur.parts[cur.parts.length - 1];
        if (last && last.key === part.key && last.size === part.size && last.style === part.style) {
          last.text += ch;
          last.width += w;
        } else {
          cur.parts.push({ ...part, text: ch, width: w });
        }
        cur.width += w;
      }
    }
    if (cur.parts.length) chunks.push(cur);
    return chunks;
  }

  private lines(tokens: (Word | 'BR')[], maxWidth: number): Line[] {
    const lines: Line[] = [];
    let line: Line = { runs: [], width: 0 };
    const addParts = (parts: Part[]) => {
      for (const part of parts) {
        const last = line.runs[line.runs.length - 1];
        if (last && last.key === part.key && last.size === part.size && sameStyle(last.style, part.style)) {
          last.text += part.text;
          last.width += part.width;
        } else {
          line.runs.push({ ...part });
        }
        line.width += part.width;
      }
    };
    const place = (word: Word) => {
      if (line.runs.length === 0) {
        addParts(word.parts);
        return;
      }
      const prev = line.runs[line.runs.length - 1];
      const next = word.parts[0];
      let space: { mode: 'prev' | 'next' | 'gap'; width: number } | null = null;
      if (word.spaceBefore) {
        const s = word.spaceBefore;
        if (sameStyle(prev.style, s) && sameStyle(s, next.style)) space = { mode: 'prev', width: this.fonts.width(' ', prev.key, prev.size) };
        else if (!decorated(prev.style)) space = { mode: 'prev', width: this.fonts.width(' ', prev.key, prev.size) };
        else if (!decorated(next.style)) space = { mode: 'next', width: this.fonts.width(' ', next.key, next.size) };
        else space = { mode: 'gap', width: this.fonts.width(' ', 'regular', prev.size) };
      }
      const spaceWidth = space?.width ?? 0;
      if (line.width + spaceWidth + word.width <= maxWidth + 0.01) {
        if (space?.mode === 'prev') {
          prev.text += ' ';
          prev.width += space.width;
          line.width += space.width;
        } else if (space?.mode === 'next') {
          word.parts[0] = { ...next, text: ` ${next.text}`, width: next.width + space.width };
          word.width += space.width;
        } else if (space?.mode === 'gap') {
          line.runs.push({ text: '', key: 'regular', size: prev.size, style: {}, width: space.width });
          line.width += space.width;
        }
        addParts(word.parts);
      } else {
        lines.push(line);
        line = { runs: [], width: 0 };
        addParts(word.parts);
      }
    };
    for (const token of tokens) {
      if (token === 'BR') {
        lines.push(line);
        line = { runs: [], width: 0 };
        continue;
      }
      if (token.width > maxWidth) {
        const chunks = this.splitLongWord(token, maxWidth);
        chunks.forEach((chunk, i) => {
          if (i > 0 && line.runs.length) {
            lines.push(line);
            line = { runs: [], width: 0 };
          }
          place(chunk);
        });
        continue;
      }
      place(token);
    }
    if (line.runs.length) lines.push(line);
    return lines;
  }

  private drawRuns(line: Line, x0: number, baseline: number, color: RGB): void {
    let x = x0;
    for (const run of line.runs) {
      if (run.text) {
        const { style, size } = run;
        if (style.code) {
          const pad = 1.4;
          this.doc.setFillColor(...COLORS.codeBg);
          this.doc.rect(x - pad, baseline - size * 0.86, run.width + pad * 2, size * 1.14, 'F');
        }
        this.fonts.use(run.key, size);
        const fill = style.color ?? (style.link ? COLORS.link : style.code ? COLORS.codeText : color);
        this.doc.setTextColor(...fill);
        this.doc.text(run.text, x, baseline);
        if (style.link && !style.color) {
          this.doc.setDrawColor(...COLORS.link);
          this.doc.setLineWidth(0.5);
          this.doc.line(x, baseline + size * 0.14, x + run.width, baseline + size * 0.14);
        }
        if (style.link) this.doc.link(x, baseline - size * 0.9, run.width, size * 1.15, { url: style.link });
        if (style.strike) {
          this.doc.setDrawColor(...fill);
          this.doc.setLineWidth(0.6);
          this.doc.line(x, baseline - size * 0.3, x + run.width, baseline - size * 0.3);
        }
      }
      x += run.width;
    }
  }

  private drawMarker(baseline: number, size: number, color: RGB): void {
    const marker = this.pendingMarker;
    if (!marker) return;
    this.pendingMarker = null;
    for (const seg of this.fonts.segment(marker.text, marker.key)) {
      this.fonts.use(seg.key, size);
      this.doc.setTextColor(...color);
      this.doc.text(seg.text, marker.x, baseline);
    }
  }

  private baselineFor(top: number, size: number, lineHeight: number): number {
    return top + (lineHeight - GLYPH_HEIGHT * size) / 2 + ASCENT * size;
  }

  /** Paragraphe (ou titre) : coupe les lignes avec la police et la taille réellement dessinées. */
  private inline(
    pieces: Piece[],
    box: Box,
    opts: { size: number; color: RGB; lineFactor?: number; align?: 'left' | 'center'; keepWithNext?: number },
  ): number {
    const tokens = this.words(pieces, opts.size);
    const lines = this.lines(tokens, box.width);
    const lineHeight = opts.size * (opts.lineFactor ?? LINE_FACTOR);
    if (opts.keepWithNext) this.ensure(lineHeight * Math.min(lines.length, 2) + opts.keepWithNext);
    for (const line of lines) {
      this.ensure(lineHeight);
      const baseline = this.baselineFor(this.y, opts.size, lineHeight);
      this.drawMarker(baseline, BODY_SIZE, COLORS.text);
      const x = opts.align === 'center' ? box.x + Math.max(0, (box.width - line.width) / 2) : box.x;
      this.drawRuns(line, x, baseline, opts.color);
      this.y += lineHeight;
    }
    return lines.length;
  }

  // ── Blocs ───────────────────────────────────────────────────────────────

  header(doc: ExportDoc): void {
    const title = doc.title?.trim() || 'Document sans titre';
    this.inline([{ text: title, style: { bold: true } }], { x: MARGIN_X, width: CONTENT_W }, { size: 20, color: COLORS.heading, lineFactor: 1.25 });
    this.y += 4;
    const meta = metaLine(doc.meta);
    if (meta) this.inline([{ text: meta, style: {} }], { x: MARGIN_X, width: CONTENT_W }, { size: 9.5, color: COLORS.muted, lineFactor: 1.4 });
    this.inline([{ text: formatExportDate(doc.meta?.date), style: {} }], { x: MARGIN_X, width: CONTENT_W }, { size: 9.5, color: COLORS.muted, lineFactor: 1.4 });
    this.y += 6;
    this.doc.setDrawColor(...COLORS.accent);
    this.doc.setLineWidth(1.2);
    this.doc.line(MARGIN_X, this.y, MARGIN_X + CONTENT_W, this.y);
    this.y += 16;
  }

  content(tree: Root, title: string): void {
    for (const node of tree.children) {
      if (node.type === 'definition') this.definitions.set(node.identifier, node.url);
    }
    let nodes = tree.children;
    // Un premier titre strictement identique au titre de l'en-tête n'est pas répété (texte déjà présent).
    const first = nodes.find(n => n.type !== 'definition' && n.type !== 'html');
    if (first && first.type === 'heading' && first.depth === 1 && normalizeTitle(plainText(first.children)) === normalizeTitle(title)) {
      nodes = nodes.filter(n => n !== first);
    }
    this.blocks(nodes, { x: MARGIN_X, width: CONTENT_W }, { tight: false, color: COLORS.text, depth: 0 });
  }

  private blocks(nodes: readonly RootContent[], box: Box, ctx: BlockContext): void {
    for (const node of nodes) this.block(node, box, ctx);
  }

  private block(node: RootContent, box: Box, ctx: BlockContext): void {
    switch (node.type) {
      case 'heading':
        this.heading(node, box);
        break;
      case 'paragraph': {
        const pieces = this.flatten(node.children, {});
        if (this.inline(pieces, box, { size: BODY_SIZE, color: ctx.color }) > 0) this.y += ctx.tight ? 2 : 7;
        break;
      }
      case 'list':
        this.list(node, box, ctx);
        break;
      case 'blockquote':
        this.blockquote(node, box, ctx);
        break;
      case 'code':
        if (node.lang === 'math') this.mathBlock(node.value, box);
        else this.codeBlock(node, box);
        break;
      case 'math':
        this.mathBlock(node.value, box);
        break;
      case 'table':
        this.table(node, box);
        break;
      case 'thematicBreak':
        this.space(6);
        this.ensure(10);
        this.doc.setDrawColor(...COLORS.rule);
        this.doc.setLineWidth(0.8);
        this.doc.line(box.x, this.y + 3, box.x + box.width, this.y + 3);
        this.y += 14;
        break;
      case 'footnoteDefinition': {
        const label: Piece = { text: `[${node.label ?? node.identifier}] `, style: { bold: true } };
        const [first, ...rest] = node.children;
        if (first && first.type === 'paragraph') {
          this.inline([label, ...this.flatten(first.children, {})], box, { size: BODY_SIZE * 0.92, color: ctx.color });
          this.y += 4;
          this.blocks(rest, box, ctx);
        } else {
          this.inline([label], box, { size: BODY_SIZE * 0.92, color: ctx.color });
          this.blocks(node.children, box, ctx);
        }
        break;
      }
      case 'html':
        if (this.inline([{ text: node.value, style: {} }], box, { size: BODY_SIZE, color: ctx.color }) > 0) this.y += 7;
        break;
      default:
        // definition, yaml… : rien à dessiner.
        break;
    }
  }

  private heading(node: Heading, box: Box): void {
    const spec = HEADINGS[node.depth] ?? HEADINGS[6];
    const pieces = this.flatten(node.children, baseKeyStyle(spec.key));
    const visible = pieces.some(p => p.hardBreak || this.fonts.segment(p.text, 'regular').some(s => s.text.trim()));
    if (!visible) return;
    this.space(spec.before);
    const bodyLine = BODY_SIZE * LINE_FACTOR;
    const drawn = this.inline(pieces, box, {
      size: spec.size, color: spec.color, lineFactor: 1.3, keepWithNext: spec.after + bodyLine * 2,
    });
    if (drawn === 0) return;
    if (spec.rule) {
      this.y += 2;
      this.doc.setDrawColor(...spec.rule);
      this.doc.setLineWidth(node.depth === 1 ? 1 : 0.6);
      this.doc.line(box.x, this.y, box.x + box.width, this.y);
      this.y += 4;
    }
    this.y += spec.after;
  }

  private list(node: List, box: Box, ctx: BlockContext): void {
    const ordered = Boolean(node.ordered);
    const start = node.start ?? 1;
    const loose = Boolean(node.spread) || node.children.some(item => item.spread);
    const markers = node.children.map((item, i) => {
      if (item.checked === true) return '☑';
      if (item.checked === false) return '☐';
      return ordered ? `${start + i}.` : BULLETS[ctx.depth % BULLETS.length];
    });
    const widest = Math.max(...markers.map(m => this.fonts.width(m, 'regular', BODY_SIZE)), 0);
    const indent = Math.max(16, widest + 7);
    const childCtx: BlockContext = { tight: !loose, color: ctx.color, depth: ctx.depth + 1 };
    node.children.forEach((item, i) => {
      const markerWidth = this.fonts.width(markers[i], 'regular', BODY_SIZE);
      const x = ordered ? box.x + indent - 6 - markerWidth : box.x + Math.max(2, (indent - 6 - markerWidth) / 2);
      this.pendingMarker = { text: markers[i], x, key: 'regular' };
      this.blocks(item.children, { x: box.x + indent, width: box.width - indent }, childCtx);
      if (this.pendingMarker) {
        // Élément vide : le marqueur seul.
        const lineHeight = BODY_SIZE * LINE_FACTOR;
        this.ensure(lineHeight);
        this.drawMarker(this.baselineFor(this.y, BODY_SIZE, lineHeight), BODY_SIZE, COLORS.text);
        this.y += lineHeight;
      }
      if (loose && i < node.children.length - 1) this.y += 2;
    });
    this.y += ctx.depth === 0 ? 5 : 1;
  }

  private blockquote(node: Blockquote, box: Box, ctx: BlockContext): void {
    this.space(2);
    this.ensure(BODY_SIZE * LINE_FACTOR);
    const bar = { x: box.x + 1.5, startY: this.y };
    this.bars.push(bar);
    this.blocks(node.children, { x: box.x + 14, width: box.width - 14 }, { ...ctx, color: COLORS.quoteText });
    this.bars.pop();
    this.drawBar(bar.x, bar.startY, Math.max(bar.startY, this.y - 5));
    this.y += 4;
  }

  /** Bloc à chasse fixe sur fond gris : le texte est conservé caractère pour caractère. */
  private monoBlock(source: string, box: Box): void {
    const size = 8.8;
    const lineHeight = size * 1.42;
    const pad = 6;
    const innerWidth = box.width - pad * 2;
    const visual: Seg[][] = [];
    for (const rawLine of source.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')) {
      // Tabulations : colonnes de 4.
      let expanded = '';
      for (const ch of rawLine) {
        expanded += ch === '\t' ? ' '.repeat(4 - (expanded.length % 4)) : ch;
      }
      let current: Seg[] = [];
      let width = 0;
      for (const seg of this.fonts.segment(expanded, 'mono')) {
        for (const ch of seg.text) {
          const w = this.fonts.charWidth(ch, seg.key, size);
          if (width + w > innerWidth && width > 0) {
            visual.push(current);
            current = [];
            width = 0;
          }
          const last = current[current.length - 1];
          if (last && last.key === seg.key) last.text += ch;
          else current.push({ text: ch, key: seg.key });
          width += w;
        }
      }
      visual.push(current);
    }
    this.space(3);
    this.ensure(pad + lineHeight);
    this.drawMarker(this.baselineFor(this.y + pad, size, lineHeight), BODY_SIZE, COLORS.text);
    // Un seul fond par page (pas de bandes entre les lignes), puis le texte par-dessus.
    let index = 0;
    let first = true;
    while (index < visual.length) {
      const top = this.y;
      const padTop = first ? pad : pad / 2;
      const available = this.bottom - top - padTop;
      let count = Math.max(1, Math.floor(available / lineHeight));
      count = Math.min(count, visual.length - index);
      const last = index + count >= visual.length;
      const height = padTop + count * lineHeight + (last ? pad : pad / 2);
      this.doc.setFillColor(...COLORS.codeBg);
      this.doc.rect(box.x, top, box.width, height, 'F');
      let lineTop = top + padTop;
      for (const segs of visual.slice(index, index + count)) {
        const baseline = this.baselineFor(lineTop, size, lineHeight);
        let x = box.x + pad;
        for (const seg of segs) {
          this.fonts.use(seg.key, size);
          this.doc.setTextColor(...COLORS.codeText);
          this.doc.text(seg.text, x, baseline);
          x += this.fonts.width(seg.text, seg.key, size);
        }
        lineTop += lineHeight;
      }
      index += count;
      this.y = top + height;
      first = false;
      if (!last) this.newPage();
    }
    this.y += 8;
  }

  private codeBlock(node: Code, box: Box): void {
    this.monoBlock(node.value, box);
  }

  private mathBlock(value: string, box: Box): void {
    const converted = texToUnicode(value);
    if (converted === null || converted.includes('\n')) {
      this.monoBlock(value, box);
      return;
    }
    this.space(3);
    if (this.inline([{ text: converted, style: { math: true } }], box, { size: 11.5, color: COLORS.text, align: 'center' }) > 0) {
      this.y += 7;
    }
  }

  private cell(cell: TableCell | undefined, header: boolean, align: 'left' | 'center' | 'right' | null | undefined): CellInput {
    if (!cell) return '';
    const children = cell.children;
    // Une cellule entièrement en gras ou en italique garde ce style (une seule police par cellule).
    let key: FontKey = header ? 'bold' : 'regular';
    const only = children.length === 1 ? children[0] : null;
    if (only && only.type === 'strong') key = 'bold';
    if (only && only.type === 'emphasis') key = header ? 'bolditalic' : 'italic';
    const text = this.cellText(children);
    const resolved = this.fonts.resolve(key);
    this.fonts.prepare(resolved);
    const content = this.fonts.plain(text, resolved);
    const { style } = this.fonts.family(resolved);
    const def: CellDef = {
      content,
      styles: { fontStyle: style as 'normal' | 'bold' | 'italic' | 'bolditalic', ...(align ? { halign: align } : {}) },
    };
    return def;
  }

  private cellText(nodes: readonly PhrasingContent[]): string {
    return nodes.map(n => {
      switch (n.type) {
        case 'text':
        case 'inlineCode':
        case 'html':
          return n.value;
        case 'inlineMath': {
          const converted = texToUnicode(n.value);
          return converted ?? `$${n.value}$`;
        }
        case 'break':
          return '\n';
        case 'link': {
          const label = this.cellText(n.children);
          const url = safeLink(n.url);
          return url && !sameTarget(label, url) ? `${label} (${url})` : label;
        }
        case 'image':
          return n.alt ? `[Image : ${n.alt}]` : '[Image]';
        case 'footnoteReference':
          return `[${n.label ?? n.identifier}]`;
        default:
          return 'children' in n ? this.cellText(n.children as PhrasingContent[]) : '';
      }
    }).join('').replace(/[ \t]+/g, ' ').trim();
  }

  private table(node: Table, box: Box): void {
    const rows = node.children;
    if (rows.length === 0) return;
    const columns = Math.max(...rows.map(r => r.children.length));
    const aligns = node.align ?? [];
    const toRow = (cells: TableCell[], header: boolean): RowInput =>
      Array.from({ length: columns }, (_, i) => this.cell(cells[i], header, aligns[i]));
    const head = [toRow(rows[0].children, true)];
    const body = rows.slice(1).map(r => toRow(r.children, false));
    this.fonts.prepare('regular');
    this.fonts.prepare('bold');
    this.space(4);
    this.ensure(BODY_SIZE * 4);
    this.drawMarker(this.baselineFor(this.y, BODY_SIZE, BODY_SIZE * LINE_FACTOR), BODY_SIZE, COLORS.text);
    const startPage = this.currentPage();
    const startY = this.y;
    autoTable(this.doc, {
      head,
      body,
      startY: this.y,
      margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: box.x, right: PAGE_W - box.x - box.width },
      tableWidth: 'auto',
      theme: 'grid',
      styles: {
        font: FACES.regular.family,
        fontStyle: 'normal',
        fontSize: 9,
        cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
        textColor: COLORS.text,
        lineColor: COLORS.tableLine,
        lineWidth: 0.5,
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.heading, fontStyle: 'bold' },
      bodyStyles: { fillColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: COLORS.zebra },
      showHead: 'everyPage',
      rowPageBreak: 'auto',
    });
    const finalY = (this.doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? this.y;
    const endPage = this.currentPage();
    this.pagesAdded(startPage, endPage, startY);
    this.y = finalY + 10;
  }

  // ── Finitions ───────────────────────────────────────────────────────────

  decoratePages(title: string): void {
    const total = this.doc.getNumberOfPages();
    const shortTitle = this.truncate(title, CONTENT_W * 0.8, 8.5);
    for (let page = 1; page <= total; page++) {
      this.doc.setPage(page);
      const footer = `Page ${page} / ${total}`;
      this.fonts.use('regular', 8.5);
      this.doc.setTextColor(...COLORS.muted);
      const w = this.fonts.width(footer, 'regular', 8.5);
      this.doc.text(footer, (PAGE_W - w) / 2, PAGE_H - 30);
      if (page > 1 && shortTitle) {
        let x = MARGIN_X;
        for (const seg of this.fonts.segment(shortTitle, 'regular')) {
          this.fonts.use(seg.key, 8.5);
          this.doc.text(seg.text, x, 36);
          x += this.fonts.width(seg.text, seg.key, 8.5);
        }
        this.doc.setDrawColor(...COLORS.rule);
        this.doc.setLineWidth(0.5);
        this.doc.line(MARGIN_X, 42, MARGIN_X + CONTENT_W, 42);
      }
    }
  }

  private truncate(text: string, maxWidth: number, size: number): string {
    const clean = this.fonts.segment(text, 'regular').map(s => s.text).join('').trim();
    if (this.fonts.width(clean, 'regular', size) <= maxWidth) return clean;
    let out = '';
    for (const ch of clean) {
      if (this.fonts.width(`${out}${ch}…`, 'regular', size) > maxWidth) break;
      out += ch;
    }
    return `${out.trimEnd()}…`;
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Polices nécessaires pour un contenu donné (estimation par excès), afin de ne télécharger
 * que celles-ci dans le navigateur. Une police absente est de toute façon remplacée par
 * DejaVu Sans (normal ou gras) : le texte reste intact.
 */
export function requiredFonts(content: string): FontKey[] {
  const need = new Set<FontKey>(['regular', 'bold']);
  const visit = (node: Nodes, bold: boolean, italic: boolean) => {
    switch (node.type) {
      case 'heading':
        if (node.depth === 5) need.add('bolditalic');
        if (node.depth === 6) need.add('italic');
        break;
      case 'strong':
        if (italic) need.add('bolditalic');
        bold = true;
        break;
      case 'emphasis':
        need.add(bold ? 'bolditalic' : 'italic');
        italic = true;
        break;
      case 'tableCell':
      case 'tableRow':
        break;
      case 'inlineCode':
        need.add('mono');
        break;
      case 'code':
        if (node.lang !== 'math' || texToUnicode(node.value) === null) need.add('mono');
        break;
      case 'inlineMath':
      case 'math':
        if (texToUnicode(node.value) === null) need.add('mono');
        break;
      default:
        break;
    }
    if (node.type === 'heading' && node.depth <= 5) bold = true;
    if (node.type === 'table') {
      // En-têtes en gras : une cellule d'en-tête en italique utilise le gras italique.
      const header = node.children[0];
      if (header?.children.some(c => c.children.some(x => x.type === 'emphasis'))) need.add('bolditalic');
    }
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child, bold, italic);
  };
  visit(parseMarkdown(content ?? ''), false, false);
  return [...need];
}

/** Construit le PDF (fonction pure, testable en Node). */
export function markdownToPdf(doc: ExportDoc, fonts: PdfFonts): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
  const book = new FontBook(pdf, fonts);
  const writer = new PdfWriter(pdf, book);
  const title = doc.title?.trim() || 'Document sans titre';
  const meta = metaLine(doc.meta);
  pdf.setProperties({
    title,
    subject: meta || 'Contenu pédagogique',
    creator: 'Magistra',
    keywords: [doc.meta?.type, doc.meta?.niveau, doc.meta?.matiere].filter(Boolean).join(', '),
  });
  pdf.setLanguage('fr');
  writer.header(doc);
  writer.content(parseMarkdown(doc.content ?? ''), title);
  writer.decoratePages(title);
  (pdf as jsPDF & { magistraStats?: PdfExportStats }).magistraStats = { ...book.stats };
  return pdf;
}

/** Statistiques de la dernière construction (émojis retirés, caractères non pris en charge). */
export function pdfStats(pdf: jsPDF): PdfExportStats {
  return (pdf as jsPDF & { magistraStats?: PdfExportStats }).magistraStats ?? { emojiRemoved: 0, unsupported: 0 };
}
