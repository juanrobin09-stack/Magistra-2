// Numérotation des listes d'un DOCX. Word n'écrit ni le numéro ni la puce dans le texte du paragraphe : il les calcule
// à l'affichage d'après word/numbering.xml. Sans ce calcul, « 1. 2. 3. » ou « a) b) c) » disparaissent et les étapes d'une
// consigne deviennent des phrases sans lien (« l'étape 3 » est introuvable dans le texte transmis).
//
// Lecture bornée comme le reste de l'extraction : balayage linéaire (xmlScan), 9 niveaux au plus par liste, au plus
// DOCUMENT_LIMITS.maxNumberingEntries blocs examinés (listes, instances, styles), motifs de numérotation courts. Un fichier
// absent, illisible ou sans liste exploitable donne `null` : le document se lit alors comme sans numérotation.
//
// Limites volontaires : un paragraphe de cellule de tableau n'est pas numéroté (les lignes de tableau sont lues
// « cellule | cellule »), la numérotation « juridique » (isLgl) n'est pas appliquée, et l'indentation par niveau n'est pas
// rendue en espaces (l'extraction normalise les espaces en début de ligne) : le motif « 1.1 », « a) » porte la hiérarchie.

import { decodeXmlEntities } from './text.js';
import { DOCUMENT_LIMITS } from './types.js';
import { firstXmlBlock, indexOfOpenTag, xmlBlocks } from './xmlScan.js';

/** Un DOCX compte 9 niveaux de liste (ilvl 0 à 8). */
const MAX_LEVELS = 9;
/** Motif de numérotation (« %1.%2 ») : au-delà, tronqué (aucun motif réel n'approche cette longueur). */
const MAX_LEVEL_TEXT = 64;
/** Valeur de départ maximale d'une liste : borne les compteurs et la taille des numéros produits. */
const MAX_START = 1_000_000;
/** Une même lettre répétée au plus 9 fois (« aaaaaaaaa » = 235), puis chiffres. */
const MAX_LETTER_VALUE = 26 * 9;
const MAX_STYLE_DEPTH = 8;
const VAL = /\sw:val="([^"]*)"/;

const attrReader = (name: string) => {
  const re = new RegExp(`\\s${name}="([^"]*)"`);
  return (tag: string): string | undefined => re.exec(tag)?.[1];
};
const ILVL_ATTR = attrReader('w:ilvl');
const ABSTRACT_ID_ATTR = attrReader('w:abstractNumId');
const NUM_ID_ATTR = attrReader('w:numId');
const STYLE_ID_ATTR = attrReader('w:styleId');
const TYPE_ATTR = attrReader('w:type');

/** Valeur `w:val` de la première balise `<nom …>` de `xml` (fragment court), ou undefined. */
function childVal(xml: string, name: string): string | undefined {
  const at = indexOfOpenTag(xml, name, 0);
  if (at === -1) return undefined;
  const gt = xml.indexOf('>', at);
  if (gt === -1) return undefined;
  const m = VAL.exec(xml.slice(at, gt));
  return m ? decodeXmlEntities(m[1]) : undefined;
}

function parseLevelIndex(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d$/.test(raw)) return null;
  const level = Number(raw);
  return level < MAX_LEVELS ? level : null;
}

function parseStart(raw: string | undefined): number {
  const n = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_START) : 1;
}

interface LevelDef {
  format: string;
  /** Motif (« %1. », « %1.%2 », « %2) ») ; absent : « %n. » du niveau. */
  text?: string;
  start: number;
  /** Style de paragraphe rattaché à ce niveau (titres numérotés). */
  style?: string;
}

function parseLevel(body: string): LevelDef {
  const text = childVal(body, 'w:lvlText');
  return {
    format: childVal(body, 'w:numFmt') ?? 'decimal',
    text: text === undefined ? undefined : text.slice(0, MAX_LEVEL_TEXT),
    start: parseStart(childVal(body, 'w:start')),
    style: childVal(body, 'w:pStyle'),
  };
}

interface AbstractList {
  levels: (LevelDef | undefined)[];
  styleLink?: string;
  numStyleLink?: string;
}

interface LevelOverride {
  start?: number;
  level?: LevelDef;
}

interface ListInstance {
  abstract: AbstractList;
  overrides: Map<number, LevelOverride>;
}

function parseAbstractLists(xml: string): Map<string, AbstractList> {
  const lists = new Map<string, AbstractList>();
  let seen = 0;
  for (const block of xmlBlocks(xml, 'w:abstractNum')) {
    if (++seen > DOCUMENT_LIMITS.maxNumberingEntries) break;
    if (block.selfClosing) continue;
    const id = ABSTRACT_ID_ATTR(xml.slice(block.start, block.innerStart));
    if (id === undefined) continue;
    const body = xml.slice(block.innerStart, block.innerEnd);
    const levels: (LevelDef | undefined)[] = new Array<LevelDef | undefined>(MAX_LEVELS).fill(undefined);
    for (const lvl of xmlBlocks(body, 'w:lvl')) {
      const index = parseLevelIndex(ILVL_ATTR(body.slice(lvl.start, lvl.innerStart)));
      if (index !== null && !lvl.selfClosing) levels[index] = parseLevel(body.slice(lvl.innerStart, lvl.innerEnd));
    }
    // Les liaisons à un style sont cherchées hors des niveaux : avant le premier `<w:lvl`.
    const firstLevel = indexOfOpenTag(body, 'w:lvl', 0);
    const head = firstLevel === -1 ? body : body.slice(0, firstLevel);
    lists.set(id, { levels, styleLink: childVal(head, 'w:styleLink'), numStyleLink: childVal(head, 'w:numStyleLink') });
  }
  return lists;
}

function parseListInstances(xml: string, abstracts: Map<string, AbstractList>): Map<string, ListInstance> {
  const instances = new Map<string, ListInstance>();
  let seen = 0;
  for (const block of xmlBlocks(xml, 'w:num')) {
    if (++seen > DOCUMENT_LIMITS.maxNumberingEntries) break;
    if (block.selfClosing) continue;
    const id = NUM_ID_ATTR(xml.slice(block.start, block.innerStart));
    const body = xml.slice(block.innerStart, block.innerEnd);
    const abstract = abstracts.get(childVal(body, 'w:abstractNumId') ?? '');
    if (id === undefined || !abstract) continue;
    const overrides = new Map<number, LevelOverride>();
    for (const o of xmlBlocks(body, 'w:lvlOverride')) {
      const index = parseLevelIndex(ILVL_ATTR(body.slice(o.start, o.innerStart)));
      if (index === null || o.selfClosing) continue;
      const inner = body.slice(o.innerStart, o.innerEnd);
      const rawStart = childVal(inner, 'w:startOverride');
      const lvl = firstXmlBlock(inner, 'w:lvl');
      overrides.set(index, {
        start: rawStart === undefined ? undefined : parseStart(rawStart),
        level: lvl && !lvl.selfClosing ? parseLevel(inner.slice(lvl.innerStart, lvl.innerEnd)) : undefined,
      });
    }
    instances.set(id, { abstract, overrides });
  }
  return instances;
}

/** Liste « définie par un style » (`numStyleLink`) : ses niveaux sont ceux de la liste qui porte ce `styleLink`. */
function resolveStyleLinks(abstracts: Map<string, AbstractList>): void {
  const byStyle = new Map<string, AbstractList>();
  for (const list of abstracts.values()) if (list.styleLink) byStyle.set(list.styleLink, list);
  for (const list of abstracts.values()) {
    if (!list.numStyleLink || list.levels.some(Boolean)) continue;
    const target = byStyle.get(list.numStyleLink);
    if (target && target !== list) list.levels = target.levels;
  }
}

interface StyleNumbering {
  basedOn?: string;
  numId?: string;
  ilvl?: number;
}

/** Styles de paragraphe qui portent une numérotation ou en héritent (`basedOn`) ; les autres ne sont pas gardés. */
function parseStyleNumbering(xml: string): Map<string, StyleNumbering> {
  const styles = new Map<string, StyleNumbering>();
  let seen = 0;
  for (const block of xmlBlocks(xml, 'w:style')) {
    if (++seen > DOCUMENT_LIMITS.maxNumberingEntries) break;
    if (block.selfClosing) continue;
    const open = xml.slice(block.start, block.innerStart);
    const id = STYLE_ID_ATTR(open);
    const type = TYPE_ATTR(open);
    if (id === undefined || (type !== undefined && type !== 'paragraph')) continue;
    const body = xml.slice(block.innerStart, block.innerEnd);
    const basedOn = childVal(body, 'w:basedOn');
    const numPr = firstXmlBlock(body, 'w:numPr');
    const inner = numPr && !numPr.selfClosing ? body.slice(numPr.innerStart, numPr.innerEnd) : '';
    const numId = childVal(inner, 'w:numId');
    if (basedOn === undefined && numId === undefined) continue;
    styles.set(id, { basedOn, numId, ilvl: parseLevelIndex(childVal(inner, 'w:ilvl')) ?? undefined });
  }
  return styles;
}

// ─── Formats de numéro ─────────────────────────────────────────────────────

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

function roman(n: number): string {
  let out = '';
  for (const [value, symbol] of ROMAN) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

/** Numéro de Word : « a » à « z », puis « aa », « bb »… (la lettre est répétée, pas combinée). */
function letters(n: number): string {
  return String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return n >= 1 && n <= MAX_LETTER_VALUE ? letters(n) : String(n);
    case 'upperLetter':
      return n >= 1 && n <= MAX_LETTER_VALUE ? letters(n).toUpperCase() : String(n);
    case 'lowerRoman':
      return n >= 1 && n <= 3999 ? roman(n) : String(n);
    case 'upperRoman':
      return n >= 1 && n <= 3999 ? roman(n).toUpperCase() : String(n);
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'none':
    case 'bullet':
      return '';
    default:
      // decimal et formats que l'extraction ne sait pas rendre (ordinaux en lettres, numérotations asiatiques…).
      return String(n);
  }
}

// ─── Numérotation d'un document ────────────────────────────────────────────

export interface DocxNumbering {
  /**
   * Préfixe (« 1. », « a) », « - ») du paragraphe `<w:p>…</w:p>` donné, « » s'il n'est pas dans une liste. À appeler pour
   * chaque paragraphe, dans l'ordre du document, même vide : un paragraphe de liste vide occupe quand même un numéro.
   */
  prefix(paragraphXml: string): string;
}

interface ParagraphList {
  numId?: string;
  ilvl?: number;
  style?: string;
}

/** Propriétés de liste du paragraphe : `numPr` et style, lus dans son `<w:pPr>` seulement (pas dans une modification suivie). */
function readParagraphList(block: string): ParagraphList | null {
  const open = indexOfOpenTag(block, 'w:pPr', 0);
  if (open === -1) return null;
  // `<w:pPr>` est le premier enfant du paragraphe : un autre, plus loin, appartient à un paragraphe imbriqué.
  const afterParagraphTag = block.indexOf('>') + 1;
  if (afterParagraphTag < open && block.slice(afterParagraphTag, open).trim()) return null;
  const gt = block.indexOf('>', open);
  if (gt === -1 || block.charCodeAt(gt - 1) === 47 /* / */) return null;
  let end = block.indexOf('</w:pPr>', gt);
  // Les anciennes propriétés d'une modification suivie (`<w:pPrChange>`) ne sont pas celles du paragraphe.
  const change = indexOfOpenTag(block, 'w:pPrChange', gt);
  if (change !== -1 && (end === -1 || change < end)) end = change;
  if (end === -1) return null;
  const props = block.slice(gt + 1, end);
  const numPr = firstXmlBlock(props, 'w:numPr');
  const inner = numPr && !numPr.selfClosing ? props.slice(numPr.innerStart, numPr.innerEnd) : '';
  const rawLevel = childVal(inner, 'w:ilvl');
  const ilvl = rawLevel === undefined ? undefined : parseLevelIndex(rawLevel);
  // Niveau hors des 9 niveaux possibles : numérotation inutilisable, le paragraphe est lu sans numéro.
  if (ilvl === null) return null;
  return { numId: childVal(inner, 'w:numId'), ilvl, style: childVal(props, 'w:pStyle') };
}

/**
 * Numérotation d'un DOCX d'après `word/numbering.xml` (et `word/styles.xml` pour les listes portées par un style de
 * paragraphe), ou null si le document n'a aucune liste exploitable. Les compteurs sont tenus par liste (`numId`) et par
 * niveau : un niveau repart de sa valeur de départ après un paragraphe d'un niveau supérieur.
 */
export function createNumbering(numberingXml: string, stylesXml?: string): DocxNumbering | null {
  const abstracts = parseAbstractLists(numberingXml);
  resolveStyleLinks(abstracts);
  const instances = parseListInstances(numberingXml, abstracts);
  if (instances.size === 0) return null;
  const styles = stylesXml ? parseStyleNumbering(stylesXml) : new Map<string, StyleNumbering>();
  const counters = new Map<string, (number | undefined)[]>();
  const styleCache = new Map<string, StyleNumbering>();

  /** Liste et niveau portés par un style, d'après le style lui-même puis ceux dont il hérite. */
  const styleList = (id: string): StyleNumbering => {
    const cached = styleCache.get(id);
    if (cached) return cached;
    const found: StyleNumbering = {};
    let current: string | undefined = id;
    for (let depth = 0; current !== undefined && depth < MAX_STYLE_DEPTH; depth++) {
      const style = styles.get(current);
      if (!style) break;
      found.numId ??= style.numId;
      found.ilvl ??= style.ilvl;
      current = style.basedOn;
    }
    styleCache.set(id, found);
    return found;
  };

  const levelOf = (list: ListInstance, ilvl: number): LevelDef | undefined => list.overrides.get(ilvl)?.level ?? list.abstract.levels[ilvl];
  const startOf = (list: ListInstance, ilvl: number): number => list.overrides.get(ilvl)?.start ?? levelOf(list, ilvl)?.start ?? 1;

  return {
    prefix(paragraphXml) {
      const props = readParagraphList(paragraphXml);
      if (!props) return '';
      const fromStyle = props.style === undefined ? undefined : styleList(props.style);
      const numId = props.numId ?? fromStyle?.numId;
      // numId 0 : le paragraphe retire explicitement la numérotation (même celle de son style).
      const list = numId === undefined || numId === '0' ? undefined : instances.get(numId);
      if (numId === undefined || !list) return '';
      let ilvl = props.ilvl ?? (props.numId === undefined ? fromStyle?.ilvl : undefined);
      if (ilvl === undefined && props.style !== undefined) {
        const linked = list.abstract.levels.findIndex(level => level?.style === props.style);
        if (linked !== -1) ilvl = linked;
      }
      ilvl ??= 0;
      const level = levelOf(list, ilvl);
      if (!level) return '';

      let counts = counters.get(numId);
      if (!counts) {
        counts = new Array<number | undefined>(MAX_LEVELS).fill(undefined);
        counters.set(numId, counts);
      }
      const current = counts[ilvl];
      counts[ilvl] = current === undefined ? startOf(list, ilvl) : current + 1;
      for (let deeper = ilvl + 1; deeper < MAX_LEVELS; deeper++) counts[deeper] = undefined;

      if (level.format === 'bullet') return '- ';
      const text = level.text ?? `%${ilvl + 1}.`;
      const label = text
        .replace(/%([1-9])/g, (_, digit: string) => {
          const referenced = Number(digit) - 1;
          return formatNumber(counts[referenced] ?? startOf(list, referenced), levelOf(list, referenced)?.format ?? 'decimal');
        })
        .trim();
      return label ? `${label} ` : '';
    },
  };
}
