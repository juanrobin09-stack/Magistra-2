// Analyse Markdown commune à l'affichage (MarkdownView), à l'impression et à l'export PDF.
// - remarkSafeMarkdown : neutralise le HTML brut sans perdre de sens et évite de prendre
//   des montants en dollars pour des formules ;
// - prepareMarkdown : formules « \( \) », « \[ \] » et mise en page des QCM corrigées avant l'analyse ;
// - parseMarkdown : arbre mdast (GFM + maths) prêt pour le rendu PDF ;
// - splitMarkdownBlocks : découpage en blocs de premier niveau pour un rendu progressif mémoïsé.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Nodes, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';
import { normalizeExerciseLayout } from '@shared/exerciseLayout';
import { normalizeMathDelimiters } from '@shared/markdownMath';

type AnyNode = Nodes;

/** Éléments dont le contenu est supprimé avec la balise (jamais affiché, jamais exécuté). */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title', 'head',
  'svg', 'math', 'select', 'button', 'form', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas',
]);

/** Balises HTML connues : retirées, leur texte éventuel est conservé. */
const KNOWN_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'b', 'base', 'bdi', 'bdo', 'big', 'blockquote', 'body',
  'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'dialog',
  'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'html', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main',
  'map', 'mark', 'meta', 'meter', 'nav', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre',
  'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span', 'strike', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'tt', 'u',
  'ul', 'var', 'wbr', ...DROP_WITH_CONTENT,
]);

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
};

const TAG_RE = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)\s*(\/?)\s*>$/;
const ANY_TAG_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;

interface TagInfo {
  name: string;
  closing: boolean;
}

function parseTag(value: string): TagInfo | null {
  const m = TAG_RE.exec(value.trim());
  if (!m) return null;
  return { name: m[2].toLowerCase(), closing: m[1] === '/' };
}

function isComment(value: string): boolean {
  return /^<!--[\s\S]*-->$/.test(value.trim());
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d: string) => safeCodePoint(parseInt(d, 10)) ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => safeCodePoint(parseInt(h, 16)) ?? m)
    .replace(/&amp;/g, '&');
}

function safeCodePoint(cp: number): string | null {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
}

/** Contenu textuel d'un bloc HTML connu (balises retirées, <br> → saut de ligne). */
function htmlBlockToText(value: string): string | null {
  const first = /^\s*<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(value);
  if (first && DROP_WITH_CONTENT.has(first[1].toLowerCase())) return '';
  if (/^\s*<!--/.test(value)) {
    const rest = value.replace(/<!--[\s\S]*?(-->|$)/g, '').trim();
    if (!rest) return '';
  }
  // Toutes les balises doivent être des éléments HTML connus ; sinon on garde le texte littéral.
  const tags = value.match(ANY_TAG_RE) ?? [];
  const allKnown = tags.every(t => t.startsWith('<!--') || (parseTag(t) !== null && KNOWN_TAGS.has(parseTag(t)!.name)));
  if (!allKnown) return null;
  let text = value;
  for (const name of DROP_WITH_CONTENT) {
    text = text.replace(new RegExp(`<${name}\\b[\\s\\S]*?(<\\/${name}\\s*>|$)`, 'gi'), '');
  }
  text = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|summary|blockquote|pre|table|ul|ol|dt|dd)\s*>/gi, '\n')
    .replace(ANY_TAG_RE, '');
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function toScript(text: string, table: Record<string, string>): string | null {
  const chars = [...text];
  return chars.length > 0 && chars.every(c => c in table) ? chars.map(c => table[c]).join('') : null;
}

/** Traite le HTML en ligne d'une liste d'enfants (paragraphe, titre, cellule…). */
function sanitizeInline(children: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== 'html') {
      out.push(node);
      continue;
    }
    const value = node.value;
    if (isComment(value)) continue;
    const tag = parseTag(value);
    if (!tag || !KNOWN_TAGS.has(tag.name)) {
      // Pas une balise HTML : c'est du texte (ex. « 3<x et x>2 »), on le garde tel quel.
      out.push({ type: 'text', value });
      continue;
    }
    if (tag.name === 'br') {
      out.push({ type: 'break' });
      continue;
    }
    if (!tag.closing && DROP_WITH_CONTENT.has(tag.name)) {
      // Supprime tout jusqu'à la balise fermante correspondante.
      let j = i + 1;
      while (j < children.length) {
        const n = children[j];
        if (n.type === 'html') {
          const t = parseTag(n.value);
          if (t && t.closing && t.name === tag.name) break;
        }
        j++;
      }
      i = j;
      continue;
    }
    if (!tag.closing && (tag.name === 'sub' || tag.name === 'sup')) {
      const text = children[i + 1];
      const close = children[i + 2];
      const closeTag = close && close.type === 'html' ? parseTag(close.value) : null;
      if (text && text.type === 'text' && closeTag && closeTag.closing && closeTag.name === tag.name) {
        const converted = toScript(text.value, tag.name === 'sub' ? SUB : SUP);
        out.push({ type: 'text', value: converted ?? text.value });
        i += 2;
        continue;
      }
    }
    // Balise connue (b, span, sub…) : retirée, le texte voisin est conservé.
  }
  return mergeTexts(out);
}

function mergeTexts(nodes: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === 'text' && last && last.type === 'text' && !node.position && !last.position) {
      (last as Text).value += node.value;
    } else {
      out.push(node);
    }
  }
  return out;
}

function isParent(node: AnyNode): node is Parent & AnyNode {
  return Array.isArray((node as Parent).children);
}

const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link', 'linkReference']);

function transformTree(node: AnyNode, source: string | null): void {
  if (!isParent(node)) return;
  const parent = node as Parent;
  if (PHRASING_PARENTS.has(node.type)) {
    parent.children = sanitizeInline(guardMath(parent.children as PhrasingContent[], source));
  } else {
    const next: RootContent[] = [];
    for (const child of parent.children as RootContent[]) {
      if (child.type === 'html') {
        const text = htmlBlockToText(child.value);
        if (text === null) next.push({ type: 'paragraph', children: [{ type: 'text', value: child.value }] });
        else if (text) next.push({ type: 'paragraph', children: textWithBreaks(text) });
        continue;
      }
      next.push(child);
    }
    parent.children = next as Parent['children'];
  }
  for (const child of parent.children as AnyNode[]) transformTree(child, source);
}

function textWithBreaks(text: string): PhrasingContent[] {
  const parts = text.split('\n');
  const out: PhrasingContent[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: 'break' });
    if (part) out.push({ type: 'text', value: part });
  });
  return out;
}

/**
 * Règle de Pandoc pour `$…$` : pas d'espace juste après le `$` ouvrant ni juste avant le `$`
 * fermant, et pas de chiffre juste après le `$` fermant. Sinon ce n'est pas une formule
 * (« 5 $ et 10 $ ») et le texte d'origine est restitué.
 */
function guardMath(children: PhrasingContent[], source: string | null): PhrasingContent[] {
  if (!source) return children;
  return children.map(node => {
    if (node.type !== 'inlineMath') return node;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return node;
    const raw = source.slice(start, end);
    if (!raw.startsWith('$') || raw.startsWith('$$')) return node;
    const after = source[end] ?? '';
    if (/^\$\s/.test(raw) || /\s\$$/.test(raw) || /\d/.test(after)) return { type: 'text', value: raw } as Text;
    return node;
  });
}

/** Plugin unified : HTML brut neutralisé sans perte de sens, `$` monétaires préservés. */
export function remarkSafeMarkdown() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : null;
    transformTree(tree, source);
  };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkSafeMarkdown);

/**
 * Texte prêt pour l'analyse, à l'écran comme à l'export : formules écrites « \( … \) », « \[ … \] » ou « $ \frac… $ »
 * converties pour remark-math (shared/markdownMath.ts), choix de QCM et questions numérotées mis en page
 * (shared/exerciseLayout.ts : déjà fait par la pipeline, utile pendant la rédaction et pour l'historique ancien).
 * Le texte enregistré n'est pas modifié.
 */
export function prepareMarkdown(content: string): string {
  return normalizeExerciseLayout(normalizeMathDelimiters(content));
}

/** Arbre mdast complet (GFM + maths + HTML neutralisé). */
export function parseMarkdown(content: string): Root {
  const source = prepareMarkdown(content);
  const tree = processor.parse(source);
  return processor.runSync(tree, source) as Root;
}

// ─── Découpage progressif ─────────────────────────────────────────────────

const FENCE_OPEN = /^\s*(`{3,})[^`]*$|^\s*(~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(\s|$)/;
/** Blocs HTML qui peuvent contenir des lignes vides (types 1 à 5 de CommonMark). */
const HTML_BLOCKS: [RegExp, RegExp][] = [
  [/^ {0,3}<(script|pre|style|textarea)(\s|>|$)/i, /<\/(script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [/^ {0,3}<![A-Za-z]/, />/],
];

/**
 * Découpe le Markdown en blocs indépendants dont le rendu séparé est identique au rendu du
 * document entier, par un simple balayage des lignes (quelques millisecondes, même pendant la
 * génération). Règle prudente : on ne coupe qu'après une ligne vide, devant une ligne qui commence
 * en colonne 0 et n'est pas un élément de liste, hors bloc de code, formule `$$` ou bloc HTML.
 * Un document contenant des définitions de liens ou des notes (qui relient des blocs) est rendu
 * d'un seul tenant.
 */
export function splitMarkdownBlocks(content: string): string[] {
  if (!content) return [];
  if (/^ {0,3}\[[^\]\n]+\]:/m.test(content)) return [content];
  const blocks: string[] = [];
  let start = 0;
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let htmlEnd: RegExp | null = null;
  let inMath = false;
  let previousBlank = false;
  for (const line of content.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      previousBlank = false;
      continue;
    }
    if (htmlEnd) {
      if (htmlEnd.test(line)) htmlEnd = null;
      previousBlank = false;
      continue;
    }
    if (inMath) {
      if (/^\s*\$\$\s*$/.test(line)) inMath = false;
      previousBlank = false;
      continue;
    }
    const blank = line.trim() === '';
    if (!blank && previousBlank && lineStart > start && /^\S/.test(line) && !LIST_ITEM.test(line)) {
      blocks.push(content.slice(start, lineStart));
      start = lineStart;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? open[2];
      fence = { char: marker[0], length: marker.length };
    } else if (/^ {0,3}\$\$/.test(line)) {
      if (!line.trim().slice(2).includes('$$')) inMath = true;
    } else {
      for (const [opening, closing] of HTML_BLOCKS) {
        if (opening.test(line)) {
          if (!closing.test(line)) htmlEnd = closing;
          break;
        }
      }
    }
    previousBlank = blank;
  }
  blocks.push(content.slice(start));
  return blocks;
}
