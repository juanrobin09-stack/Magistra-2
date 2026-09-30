// Texte à trous construit par Magistra (format « texte à trous » des outils Exercices et Évaluation).
//
// Le modèle écrit le texte COMPLET et entoure de doubles crochets chaque mot à faire trouver : « Le chat [[dort]] ».
// Magistra remplace chaque mot marqué par un blanc numéroté « (1) ________ », pendant la rédaction comme dans le
// document final, puis ajoute la banque de mots et le corrigé, toujours alignés sur les blancs.
// Constat avec un vrai petit modèle local (Ministral 3 3B) : il sait marquer un mot, mais laissait le mot visible à
// côté du blanc, sautait des numéros et donnait un corrigé qui ne correspondait pas aux blancs.
//
// Écarts du modèle pris en charge :
//  - marque mal fermée (« [[dort] ») : le mot devient quand même un blanc, sans annuler la marque suivante ;
//  - marque dans une formule ($…$) : blanc lisible par KaTeX ; dans du code, « [[0, 1]] » (liste imbriquée) reste du
//    code, mais « for i in [[range]](3) » reste un blanc ;
//  - mots à trouver mis en gras au lieu d'être marqués (jamais une étiquette, une consigne ou un en-tête de tableau) ;
//  - banque de mots et corrigé écrits quand même par le modèle, sous divers titres (« Réponses », « Solutions »,
//    « Mots à trouver », « Corrigé : a, b ») : sa banque est retirée ; de son corrigé, seules les réponses des blancs
//    sont remplacées par celles de Magistra, le reste (autres questions, barème, remédiation…) est gardé, sauf dans une
//    version élève seule.

import type { GenerationRequest } from './types.js';

export const CLOZE_BLANK = '________';

/**
 * Blanc dans une formule : « _ » y serait lu comme un indice (erreur KaTeX). « \_ » s'affiche comme un trait, dans
 * une formule comme dans du texte (si ce qui ressemblait à une formule n'en est finalement pas une).
 */
const MATH_BLANK = '\\_'.repeat(8);

/** Longueur maximale d'un mot marqué (un mot ou un groupe court). */
const MAX_MARK = 60;

/** Demande de texte à trous (le format a été validé pour l'outil, le niveau et la matière). */
export function isClozeRequest(req: Pick<GenerationRequest, 'type' | 'modalite'>): boolean {
  return (req.type === 'exercices' || req.type === 'evaluation') && req.modalite === 'texte_trous';
}

/** Où se trouve une marque : texte courant, code (bloc « ``` » ou `code`) ou formule ($…$). */
type MarkContext = 'text' | 'code' | 'math';

/** Mise en forme autour de tout le mot (« **dort** », « *dort* », « `print` »). */
const WRAPPED = /^(\*\*|__|\*|_|`)(?!\s)(.+?)(?<!\s)\1$/;

/** Retire la mise en forme qui entoure tout le mot, jamais un caractère du mot (« est_pair », « 3 * 4 », « __init__ »). */
function unwrapEmphasis(word: string): string {
  for (;;) {
    const m = WRAPPED.exec(word);
    // Nom spécial Python (« __init__ ») : ce n'est pas du gras.
    if (!m || m[2].includes(m[1]) || (m[1] === '__' && /^\w+$/.test(m[2]))) return word;
    if (m[1] === '`') return m[2].trim();
    word = m[2].trim();
  }
}

/** Mot marqué (« **dort** » → « dort ») ; null si la marque n'en est pas une. */
function markedWord(inner: string, context: MarkContext = 'text'): string | null {
  if (/[[\]\n]/.test(inner)) return null;
  let word = inner.replace(/\s+/g, ' ').trim();
  // Dans du code, « [[0, 1]] » est une liste imbriquée (Python, JavaScript…), pas un mot à trouver.
  if (context === 'code' && word.includes(',')) return null;
  if (context === 'text') word = unwrapEmphasis(word);
  return word && word.length <= MAX_MARK ? word : null;
}

/** Mot écrit tel quel, en code (`mot`). */
function inlineCode(word: string): string {
  return word.includes('`') ? `\`\` ${word} \`\`` : `\`${word}\``;
}

/** Écriture du mot dans la banque et le corrigé : formule entre « $ », code si « _ » ou « * » y feraient du gras. */
function keyForm(word: string, context: MarkContext): string {
  if (context === 'math' && /[\\^_{}]/.test(word)) return `$${word}$`;
  if (/(?:^|\s)[*_]+\S|\S[*_]+(?:\s|$)/.test(word)) return inlineCode(word);
  return word;
}

/**
 * Remplacement au fil de la rédaction : chaque « [[mot]] » devient « (n) ________ » ; au-delà de `max` blancs, le mot
 * reste simplement écrit. Une marque coupée entre deux morceaux du flux est retenue jusqu'à sa fin, comme un « $ » ou
 * un « ` » (formule, code) dont on ne connaît pas encore la suite.
 */
export class ClozeStream {
  readonly words: string[] = [];
  /** Écriture de chaque mot dans la banque et le corrigé (même ordre que `words`). */
  readonly keys: string[] = [];
  /** Blanc écrit pour chaque mot (même ordre que `words` ; forme propre aux formules). */
  readonly blanks: string[] = [];
  private pending = '';
  /** Bloc « ``` » ou « ~~~ » ouvert (`code` faux pour un bloc « markdown », qui n'est que du texte entouré). */
  private fence: { char: string; size: number; code: boolean } | null = null;
  /** Nombre d'accents graves qui ont ouvert le `code` en cours ; 0 hors code. */
  private codeSpan = 0;
  /** Formule ouverte : 1 pour « $ », 2 pour « $$ » ; 0 hors formule. */
  private math = 0;
  private lineStart = true;
  private previous = '';

  constructor(private readonly max?: number) {}

  push(chunk: string): string {
    this.pending += chunk;
    return this.drain(false);
  }

  /** Fin du flux : ce qui était retenu est rendu (une marque jamais fermée reste telle quelle). */
  end(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    const s = this.pending;
    let out = '';
    let i = 0;
    const emit = (text: string) => {
      out += text;
      for (const ch of text) {
        if (ch === '\n') {
          this.lineStart = true;
          this.codeSpan = 0;
          if (this.math === 1) this.math = 0;
        } else if (ch !== ' ' && ch !== '\t') {
          this.lineStart = false;
        }
      }
      this.previous = text.at(-1) ?? this.previous;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '[' && (s[i + 1] === '[' || (i + 1 === s.length && !final))) {
        // Un « [ » final peut commencer une marque : il attend le morceau suivant.
        if (i + 1 === s.length) break;
        const mark = this.mark(s, i + 2, final);
        if (mark === undefined) break;
        if (mark === null) {
          emit('[[');
          i += 2;
        } else {
          emit(mark.text);
          i = mark.next;
        }
        continue;
      }
      if (c === '`' || c === '~' || c === '$') {
        let run = 1;
        while (s[i + run] === c) run++;
        // La suite peut allonger la série (« `` » → « ``` ») ou dire si « $ » ouvre une formule.
        if (i + run === s.length && !final) break;
        const taken = this.delimiter(s, i, run, final);
        if (taken === 0) break;
        emit(s.slice(i, i + taken));
        i += taken;
        continue;
      }
      emit(c);
      i++;
    }
    this.pending = s.slice(i);
    return out;
  }

  /** Suite de « ` », « ~ » ou « $ » : met à jour le contexte ; renvoie le nombre de caractères à écrire (0 : attendre). */
  private delimiter(s: string, i: number, run: number, final: boolean): number {
    const c = s[i];
    if (c !== '$' && run >= 3 && this.lineStart) {
      if (this.fence === null) {
        // Ouverture d'un bloc : son langage (« python », « markdown »…) dit si c'est du code.
        const nl = s.indexOf('\n', i + run);
        if (nl === -1 && !final) return 0;
        const lineEnd = nl === -1 ? s.length : nl;
        const info = s.slice(i + run, lineEnd);
        if (c === '~' || !info.includes('`')) {
          this.fence = { char: c, size: run, code: !/^\s*(?:markdown|md)\b/i.test(info) };
          this.codeSpan = 0;
          this.math = 0;
          return lineEnd - i;
        }
      } else if (c === this.fence.char && run >= this.fence.size) {
        // Fermeture : rien d'autre sur la ligne (« ```python » dans un bloc « markdown » en ouvre un autre).
        const nl = s.indexOf('\n', i + run);
        if (nl === -1 && !final) return 0;
        if (!s.slice(i + run, nl === -1 ? s.length : nl).trim()) {
          this.fence = null;
          return run;
        }
      }
    }
    if (this.fence?.code) return run;
    if (c === '`') {
      if (!this.math) {
        if (!this.codeSpan) this.codeSpan = run;
        else if (this.codeSpan === run) this.codeSpan = 0;
      }
    } else if (c === '$' && !this.codeSpan && this.previous !== '\\') {
      if (!this.math) {
        // « $ » suivi d'une espace : un montant (« 5 $ »), pas une formule ; « $$ » ouvre une formule centrée.
        if (run >= 2) this.math = 2;
        else if (!/\s/.test(s[i + run] ?? ' ')) this.math = 1;
      } else if (this.math === 1 || run >= 2) {
        this.math = 0;
      }
    }
    return run;
  }

  private context(): MarkContext {
    return this.fence?.code || this.codeSpan ? 'code' : this.math ? 'math' : 'text';
  }

  /** Marque commençant à `from` (après « [[ ») : remplacement, null si ce n'en est pas une, undefined pour attendre. */
  private mark(s: string, from: number, final: boolean): { text: string; next: number } | null | undefined {
    const limit = Math.min(s.length, from + MAX_MARK + 9);
    let j = from;
    while (j < limit && s[j] !== '[' && s[j] !== ']' && s[j] !== '\n') j++;
    if (j === limit) {
      // Pas encore fermée : on attend la suite, sauf si ce ne peut plus être une marque (trop longue, fin du texte).
      return j === s.length && !final && j - from <= MAX_MARK + 8 ? undefined : null;
    }
    // Fin de ligne ou nouveau « [ » avant la fermeture : ce « [[ » n'ouvre pas une marque (la suivante reste valable).
    if (s[j] !== ']') return null;
    const context = this.context();
    let next = j + 2;
    if (s[j + 1] !== ']') {
      if (j + 1 === s.length && !final) return undefined;
      // Marque fermée par un seul crochet (« [[dort] sur ») ; jamais dans du code (« [[0]*3 for … »).
      if (context === 'code') return null;
      next = j + 1;
    }
    const text = this.replace(s.slice(from, j), context);
    return text === null ? null : { text, next };
  }

  private replace(inner: string, context: MarkContext): string | null {
    const word = markedWord(inner, context);
    if (word === null) return null;
    if (this.max !== undefined && this.words.length >= this.max) return context === 'text' ? word : inner;
    this.words.push(word);
    this.keys.push(keyForm(word, context));
    const blank = `(${this.words.length}) ${context === 'math' ? MATH_BLANK : CLOZE_BLANK}`;
    this.blanks.push(blank);
    return blank;
  }
}

/** Nombre de mots marqués valides d'un texte (mêmes règles que le remplacement). */
function countMarks(text: string): number {
  const stream = new ClozeStream();
  stream.push(text);
  stream.end();
  return stream.words.length;
}

/** Marques remplacées par leur mot, sans blanc (le texte garde tout son contenu). */
function unwrapMarks(text: string): string {
  const stream = new ClozeStream(0);
  return stream.push(text) + stream.end();
}

// ─── Structure du document ──────────────────────────────────────────────────

const MARKDOWN_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
/** Ligne-titre en gras, éventuellement suivie d'une précision entre parenthèses et de « : ». */
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*(?:\([^)]*\))?\s*:?\s*$/;
/** Étiquette en début de ligne suivie de son contenu : « **Réponses :** a, b », « Corrigé : a, b ». */
const LABEL_LINE = /^\s*(?:\*\*|__)?([^:*_\n]{1,40}?)(?:\*\*|__)?\s*(?:\([^)]*\))?\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(\S.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)]|\(\d+\))\s+\S/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Lignes d'un bloc de code (« ``` » ou « ~~~ », lignes d'ouverture et de fermeture comprises). */
function codeLines(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (open === null) {
      const opens = m !== null && (m[1][0] === '~' || !m[2].includes('`'));
      if (opens) open = m[1];
      mask.push(opens);
    } else {
      mask.push(true);
      if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = null;
    }
  }
  return mask;
}

/** Titre (« # », ligne tout en gras) : null si la ligne n'en est pas un. */
function headingLevel(line: string): { level: number; title: string } | null {
  const md = MARKDOWN_HEADING.exec(line);
  if (md) return { level: md[1].length, title: md[2] };
  const bold = BOLD_LINE.exec(line);
  return bold ? { level: 7, title: bold[1] } : null;
}

/** Titre ou étiquette : rang 1 à 6 pour « # », 7 pour une ligne tout en gras, 8 pour une étiquette suivie d'un contenu. */
function headingOf(line: string): { rank: number; title: string } | null {
  const heading = headingLevel(line);
  if (heading) return { rank: heading.level, title: heading.title };
  // Élément de liste ou ligne de tableau (« 1. Réponse : chat ») : du contenu, jamais un titre.
  const label = LIST_ITEM.test(line) || TABLE_ROW.test(line) ? null : LABEL_LINE.exec(line);
  return label ? { rank: 8, title: label[1] } : null;
}

/** Titre ramené à l'essentiel (minuscules, sans mise en forme, numérotation ni parenthèses), et ses parties « A : B ». */
function titleParts(title: string): { whole: string; first: string; last: string } {
  const parts = title
    .replace(/[*_#«»"“”`]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(?:\d+|[ivx]+|[a-z])\s*[.)–-]\s*/i, '')
    .toLowerCase()
    .split(/\s*:\s*|\s+[–—-]\s+/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { whole: parts.join(' '), first: parts[0] ?? '', last: parts.at(-1) ?? '' };
}

const QUALIFIER = String.raw`(?:\s+(?:du|de|des|d['’]|de la|de l['’]|à|au|aux|pour|dans|sur)(?![a-zà-ÿ]).*)?`;
/** Banque de mots écrite par le modèle (Magistra écrit la sienne). */
const BANK_TITLE = new RegExp(String.raw`^(?:banque de mots|liste (?:des|de) mots|(?:les )?mots? (?:à placer|à utiliser|à trouver|à compléter|manquants|de la banque))${QUALIFIER}$`);
/** Corrigé écrit par le modèle. « Solutions » ou « Réponses » seulement en titre entier (« Solutions et mélanges » est un titre du cours). */
const KEY_TITLE = new RegExp(String.raw`^(?:corrigés?|correction|éléments de correction|réponses?|réponses? attendues?|solutions?|texte (?:à trous )?complété)(?:\s+(?:détaillée?s?|complète?s?|proposée?s?))?${QUALIFIER}$`);
const KEY_WORD = /(?:^|\s)(?:corrigés?|correction|réponses?|solutions?)(?![a-zà-ÿ])/;
/** Contenu à garder même dans une partie « corrigé » : remédiation, barème, critères, prolongement… */
const OTHER_CONTENT = /remédiation|barème|critères?|grilles?|compétences?|prolongements?|durée|différenciation|conseils?|objectifs?|remarques?|pour aller plus loin|trace écrite|bilan|auto-?évaluation|erreurs?|matériel|prérequis/;

/** Partie propre au modèle : sa banque de mots, son corrigé, ou un corrigé mêlé d'autre chose (« Correction et remédiation »). */
type OwnKind = 'bank' | 'key' | 'mixed';

function ownKind(title: string): OwnKind | null {
  const { whole, first, last } = titleParts(title);
  if (!whole) return null;
  if (OTHER_CONTENT.test(whole)) return KEY_WORD.test(whole) ? 'mixed' : null;
  if (BANK_TITLE.test(whole) || BANK_TITLE.test(first) || BANK_TITLE.test(last)) return 'bank';
  if (KEY_TITLE.test(whole) || KEY_TITLE.test(last) || /^(?:corrigés?|correction)$/.test(first)) return 'key';
  return null;
}

/** Titre qui clôt une partie du modèle : autre partie du modèle, ou contenu à garder (« ### Pistes de remédiation »). */
function closesSection(title: string): boolean {
  return ownKind(title) !== null || OTHER_CONTENT.test(titleParts(title).whole);
}

/** Élément qui peut faire partie d'une liste de réponses : puce, numéro, ligne de tableau, « (1) … ». */
function answerLike(line: string): boolean {
  return LIST_ITEM.test(line) || TABLE_ROW.test(line);
}

/** Nombre de mots d'un texte. */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Contenu d'une ligne de banque : les mots, séparés par « , », « ; », « · », « – »… */
function listItems(text: string): string[] {
  return text
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .split(/\s*(?:[,;·•/|]|\s[–—-]\s)\s*/)
    .map(item => item.replace(/^\(?\d+\)?[.)]?\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean);
}

/**
 * Ligne de banque de mots : rien que des mots ou des groupes courts, ou rien que des mots marqués (« [[a]] – [[b]] ») ;
 * jamais une phrase du texte (« Le chat [[dort]], le [[chien]] joue. »).
 */
function bankLine(line: string): boolean {
  if (TABLE_DELIMITER.test(line)) return true;
  const items = listItems(line);
  if (!items.length) return false;
  if (line.includes('[[')) return items.every(item => /^\[\[[^\]]*\]\]?[.;]?$/.test(item));
  const sentence = /[.!?…]\s*$/.test(line.trim());
  return items.every(item => wordCount(item) <= (sentence ? 2 : 5));
}

interface Section {
  kind: OwnKind;
  /** Rang du titre (voir headingOf). */
  rank: number;
  end: number;
}

/**
 * Partie propre au modèle qui commence à la ligne `start`, et sa fin. Un corrigé n'est reconnu qu'après la première
 * ligne du texte à trous (`textStart`), ou s'il contient lui-même des mots marqués : un titre « Solutions » avant le
 * texte appartient au cours.
 */
function ownSectionAt(lines: readonly string[], code: readonly boolean[], start: number, textStart: number): Section | null {
  const heading = headingOf(lines[start]);
  if (!heading) return null;
  const kind = ownKind(heading.title);
  if (kind === null) return null;
  if (kind === 'bank') {
    // Banque : le titre et les lignes de mots qui le suivent, jusqu'à la première ligne rédigée (le texte peut suivre
    // sans ligne vide) ; étiquette « Mots à placer : a, b » : sa ligne et les puces qui suivent.
    if (heading.rank === 8 && !bankLine(LABEL_LINE.exec(lines[start])![2])) return null;
    let end = start + 1;
    if (heading.rank <= 7) {
      while (end < lines.length && !lines[end].trim() && !code[end]) end++;
      const first = end;
      while (end < lines.length && lines[end].trim() && !code[end] && !RULE.test(lines[end]) && !headingLevel(lines[end]) && bankLine(lines[end])) end++;
      // Titre suivi d'un paragraphe rédigé : il annonçait le texte lui-même.
      if (end === first && end < lines.length && lines[end].trim() && !code[end] && !RULE.test(lines[end]) && !headingLevel(lines[end])) return null;
    } else {
      while (end < lines.length && LIST_ITEM.test(lines[end]) && !code[end] && bankLine(lines[end])) end++;
    }
    return { kind, rank: heading.rank, end };
  }
  const end = sectionEnd(lines, code, start, heading.rank);
  const content = [...(heading.rank === 8 ? [LABEL_LINE.exec(lines[start])![2]] : []), ...lines.slice(start + 1, end)]
    .filter(line => line.trim());
  // Avant le texte (ou à sa hauteur) : un corrigé ne se reconnaît qu'à ses propres mots marqués, jamais à un paragraphe
  // rédigé qui en contient (c'est alors le texte à trous lui-même, sous un titre « Solutions » du cours).
  if (start <= textStart && (!content.some(line => line.includes('[['))
    || content.some(line => !answerLike(line) && line.includes('[[') && wordCount(line) > 8))) return null;
  // Espace de réponse de l'élève (« **Réponse :** » suivi de « 1. ………… ») : ce n'est pas un corrigé.
  if (content.length && content.every(answerSpace)) return null;
  // « Solution : mélange homogène… » (définition du cours) : une étiquette ambiguë n'annonce un corrigé que suivie
  // d'une liste de réponses.
  if (heading.rank === 8 && /^(?:réponses?|solutions?)/.test(titleParts(heading.title).whole) && !answerList(content[0])) return null;
  return { kind, rank: heading.rank, end };
}

/** Ligne à compléter par l'élève (« ………… », « 1. ________ », « Nom : ……… ») : rien d'écrit après le numéro ou l'étiquette. */
function answerSpace(line: string): boolean {
  const rest = line
    .replace(/^\s*(?:[-*+•]|\d+[.)]|\(\d+\)|[a-z][.)])\s+/i, '')
    .replace(/^[^:\n]{1,40}:/, '');
  return !/[\p{L}\d]/u.test(rest);
}

/** Contenu d'une étiquette qui ressemble à des réponses : mots marqués, « (1) … », ou plusieurs mots courts. */
function answerList(text: string): boolean {
  if (text.includes('[[') || /^\s*\(?\d+[.)]/.test(text)) return true;
  const items = listItems(text);
  return items.length >= 2 && items.every(item => wordCount(item) <= 5 && /\p{L}/u.test(item));
}

/**
 * Fin d'un corrigé du modèle. Sous un titre « # » : jusqu'au titre suivant de même niveau ou supérieur (ses
 * sous-parties « Partie 1 », « Partie 2 » en font partie). Sous une ligne en gras ou une étiquette : le premier bloc
 * qui suit, puis seulement des blocs de réponses (listes, tableaux, sous-titres), jamais un paragraphe rédigé.
 * Toujours clos par un séparateur « --- » ou un titre de contenu à garder (remédiation, barème, durée…).
 */
function sectionEnd(lines: readonly string[], code: readonly boolean[], start: number, rank: number): number {
  let seenContent = rank === 8;
  let afterBlank = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (code[i]) {
      if (rank >= 7 && seenContent && (afterBlank || rank === 8)) return i;
      seenContent = true;
      afterBlank = false;
      continue;
    }
    if (!line.trim()) {
      if (seenContent) afterBlank = true;
      continue;
    }
    if (RULE.test(line)) return i;
    const heading = headingOf(line);
    // Une étiquette (« Réponse attendue : … ») fait partie du corrigé, sauf un contenu à garder (« Durée : … »).
    if (heading && (heading.rank === 8 ? OTHER_CONTENT.test(titleParts(heading.title).whole) : closesSection(heading.title))) return i;
    if (heading && heading.rank <= 6 && (rank >= 7 || heading.rank <= rank)) return i;
    if (rank >= 7 && seenContent && (afterBlank || rank === 8) && !answerLike(line) && !(heading && heading.rank >= 7)) return i;
    seenContent = true;
    afterBlank = false;
  }
  return lines.length;
}

interface Segment {
  kind: OwnKind | null;
  rank: number;
  lines: string[];
}

/** Découpe le texte en parties : texte de l'exercice (kind null) et parties propres au modèle. */
function splitOwnSections(lines: readonly string[], textStart: number): Segment[] {
  const code = codeLines(lines);
  const segments: Segment[] = [];
  let body: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const section = code[i] ? null : ownSectionAt(lines, code, i, textStart);
    if (!section) {
      body.push(lines[i]);
      i++;
      continue;
    }
    segments.push({ kind: null, rank: 0, lines: body });
    body = [];
    segments.push({ kind: section.kind, rank: section.rank, lines: lines.slice(i, section.end) });
    i = section.end;
  }
  segments.push({ kind: null, rank: 0, lines: body });
  return segments;
}

// ─── Mots en gras au lieu de marqués ────────────────────────────────────────

/**
 * Code en ligne, formule, mot déjà marqué (laissés tels quels), ou groupe en gras (sans crochet) ; comme en Markdown,
 * pas d'espace juste à l'intérieur des « ** » (sinon la fin d'un gras et le début du suivant seraient appariés).
 */
const SPAN_OR_BOLD = /`[^`\n]*`|\$(?!\s)[^$\n]*?(?<!\s)\$|\[\[[^\]\n]*\]\]|\*\*(?!\s)([^*[\]\n]{1,60}?)(?<!\s)\*\*/g;

/** Mot en gras en tête de ligne qui est une consigne ou une étiquette, pas un mot du texte (« **Complète** le texte »). */
const LEADING_LABEL = /^(?:consignes?|compl[eè]te[sz]?|complétez|remplis(?:sez)?|utilise[sz]?|place[sz]?|choisis(?:sez)?|retrouve[sz]?|écris|écrivez|lis|lisez|observe[sz]?|relie[sz]?|souligne[sz]?|entoure[sz]?|recopie[sz]?|réponds|répondez|indique[sz]?|exercice|question|partie|document|texte|étape|remarque|attention|rappel|astuce|aide|indice|note|nom|prénom|classe|date|durée|barème|compétences?|objectifs?)(?![a-zà-ÿ])/i;

/** Groupe en gras d'une ligne de texte qui peut être un mot à trouver (jamais une étiquette ni une consigne). */
function boldKeyword(line: string, match: string, inner: string, offset: number): boolean {
  if (wordCount(inner) > 4) return false;
  // Étiquette : « **Consigne :** … », « **Consigne** : … », « - **Poumons** : … », « **Exercice 1** – … ».
  if (/[:：]\s*$/.test(inner) || /^\s*(?:[:：]|[–—]|-\s)/.test(line.slice(offset + match.length))) return false;
  const atStart = /^\s*(?:(?:[-*+•]|\d+[.)])\s+)?$/.test(line.slice(0, offset));
  return !(atStart && LEADING_LABEL.test(inner.trim()));
}

/** Mots en gras d'une ligne de texte changés en mots marqués, tant que `take` l'accepte (nombre demandé). */
function boldToMarks(line: string, take: () => boolean): string {
  // Jamais dans un titre, une ligne tout en gras, une consigne terminée par « : » ni un tableau (en-têtes, étiquettes).
  if (headingLevel(line) || /:\s*$/.test(line) || TABLE_ROW.test(line)) return line;
  return line.replace(SPAN_OR_BOLD, (match: string, inner: string | undefined, offset: number) => (
    inner !== undefined && boldKeyword(line, match, inner, offset) && take() ? `[[${inner}]]` : match
  ));
}

/**
 * Un petit modèle met parfois en gras une partie des mots à trouver au lieu de les marquer : dans un paragraphe qui
 * contient déjà un mot marqué (ou dans tout le texte, `all`, s'il n'en a marqué aucun), les mots en gras des lignes de
 * texte sont traités comme des mots à trouver. `budget` : nombre de mots en gras à prendre au plus (les vrais mots
 * marqués passent d'abord : un mot en gras ne prend jamais le numéro d'un mot marqué).
 */
function markBoldKeywords(text: string, options: { all: boolean; budget?: number }): string {
  const lines = text.split('\n');
  const code = codeLines(lines);
  let budget = options.budget ?? Infinity;
  const take = () => budget-- > 0;
  const out = [...lines];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && lines[i].trim() && !code[i]) continue;
    const paragraph = lines.slice(start, i);
    if (options.all || paragraph.some(line => line.includes('[['))) {
      for (let k = start; k < i; k++) out[k] = boldToMarks(lines[k], take);
    }
    start = i + 1;
  }
  return out.join('\n');
}

/** Première ligne qui porte un mot à trouver (mot marqué, ou mot en gras s'il n'y a aucune marque). */
function firstTextLine(lines: readonly string[], bold: boolean): number {
  const code = codeLines(lines);
  const index = lines.findIndex((line, i) => (
    bold ? !code[i] && boldToMarks(line, () => true) !== line : /\[\[[^[\]\n]{1,60}\]/.test(line)
  ));
  return index === -1 ? lines.length : index;
}

/** Le modèle a écrit ses propres blancs (« (1) ________ ») : son document est gardé tel quel. */
function hasOwnBlanks(text: string): boolean {
  const lines = text.split('\n');
  const code = codeLines(lines);
  return lines.some((line, i) => !code[i] && !RULE.test(line) && /_{4,}|(?:\\_){4,}/.test(line));
}

// ─── Corrigé du modèle ──────────────────────────────────────────────────────

/** Forme comparable d'une réponse : minuscules, sans mise en forme, ponctuation ni article autour. */
function normalizeAnswer(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[*_`$«»"“”\\]/g, '')
    .replace(/^[\s.,;:!?()–—-]+|[\s.,;:!?()–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^(?:l['’]|d['’]|(?:le|la|les|un|une|des|du|de la|de l['’])\s+)/, '');
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

/**
 * Ligne du corrigé du modèle qui donne la réponse d'un blanc : « 1. énergie », « (2) branchies », « | (1) | énergie | »,
 * « Réponses : énergie, branchies ». `strict` (vrai corrigé) : aussi toute ligne numérotée « (n) », qui renvoie aux blancs.
 */
function isBlankAnswer(line: string, known: ReadonlySet<string>, strict: boolean): boolean {
  const trimmed = line.trim();
  if (!trimmed || RULE.test(trimmed) || TABLE_DELIMITER.test(trimmed)) return false;
  if (TABLE_ROW.test(trimmed)) {
    const cells = tableCells(trimmed).filter(Boolean);
    const first = (cells[0] ?? '').replace(/[*_`]/g, '');
    if (strict && /^\(\d+\)$/.test(first)) return true;
    const rest = /^(?:\(?\d+\)?[.)]?|[a-z][.)])$/i.test(first) ? cells.slice(1) : cells;
    const matched = rest.filter(cell => known.has(normalizeAnswer(cell)));
    if (!matched.length) return false;
    return rest.every(cell => matched.includes(cell) || (strict && wordCount(cell) <= 3));
  }
  if (strict) {
    // Texte complété par le modèle : mots des blancs marqués, ou en gras (au moins deux).
    const shown = [...trimmed.matchAll(/\[\[([^[\]\n]+)\]\]|\*\*([^*\n]+)\*\*/g)].map(m => normalizeAnswer(m[1] ?? m[2]));
    const hits = shown.filter(word => known.has(word)).length;
    if (hits >= 2 || (hits >= 1 && trimmed.includes('[['))) return true;
  }
  let content = trimmed.replace(/^(?:[-*+•]|\d+[.)]|[a-z][.)])\s+/i, '');
  if (strict && /^(?:\*\*)?\(\d+\)/.test(content)) return true;
  const label = /^(?:\*\*|__)?[^:*]{1,40}?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/.exec(content);
  if (label) content = label[1];
  const items = listItems(content).map(normalizeAnswer).filter(Boolean);
  return items.length > 0 && items.every(item => known.has(item));
}

/** Élément d'une liste de réponses : puce, numéro, ligne de tableau, ou ligne d'un seul mot court. */
function answerItem(line: string): boolean {
  if (answerLike(line)) return !TABLE_DELIMITER.test(line);
  return !headingLevel(line) && !/:\s*$/.test(line) && wordCount(line) <= 4;
}

/** Réponse courte (un mot ou un groupe de trois mots au plus), une fois retirés puce, numéro et cellules de numéro. */
function shortAnswer(line: string): boolean {
  if (TABLE_ROW.test(line)) return tableCells(line).every(cell => wordCount(cell) <= 3);
  return wordCount(line.replace(/^\s*(?:[-*+•]|\d+[.)]|\(\d+\))\s+/, '')) <= 3;
}

/**
 * Lignes du corrigé du modèle qui portent sur les blancs. Dans un vrai corrigé (`strict`), une liste ou un tableau
 * dont la plupart des éléments sont des réponses des blancs est retiré en entier (réponses courtes seulement) : une
 * réponse fausse du modèle (« 2. feuilles ») ne reste pas à côté du corrigé de Magistra.
 */
function blankAnswerLines(lines: readonly string[], known: ReadonlySet<string>, strict: boolean, rank: number): boolean[] {
  const code = codeLines(lines);
  const remove = lines.map((line, i) => {
    if (code[i]) return false;
    if (i === 0) return rank === 8 && isBlankAnswer(line, known, strict);
    return isBlankAnswer(line, known, strict);
  });
  if (strict) {
    let run: number[] = [];
    const closeRun = () => {
      const found = run.filter(i => remove[i]).length;
      if (found && found * 2 >= run.length) for (const i of run) if (shortAnswer(lines[i])) remove[i] = true;
      run = [];
    };
    lines.forEach((line, i) => {
      if (i === 0 || code[i]) return closeRun();
      // Lignes vides, séparation et en-tête d'un tableau : ni réponse, ni fin de la liste.
      if (!line.trim() || TABLE_DELIMITER.test(line) || (TABLE_ROW.test(line) && TABLE_DELIMITER.test(lines[i + 1] ?? ''))) return;
      if (answerItem(line)) run.push(i);
      else closeRun();
    });
    closeRun();
  }
  // Tableau dont toutes les lignes de réponse sont retirées : son en-tête et sa ligne de séparation aussi.
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW.test(lines[i]) || code[i]) continue;
    let end = i;
    while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
    const rows = Array.from({ length: end - i }, (_, k) => i + k);
    const data = rows.filter(r => !TABLE_DELIMITER.test(lines[r]) && !(r + 1 < end && TABLE_DELIMITER.test(lines[r + 1])));
    if (data.length && data.every(r => remove[r])) for (const r of rows) remove[r] = true;
    i = end;
  }
  return remove;
}

/** Rang d'une ligne de structure (titre « # », ligne en gras, « Partie 1 : ») ; null pour une ligne de contenu. */
function structureRank(line: string): number | null {
  const heading = headingLevel(line);
  if (heading) return heading.level;
  return /:\s*$/.test(line) && !LIST_ITEM.test(line) && line.trim().length <= 60 ? 8 : null;
}

/** Retire les titres restés sans contenu (leur partie ne contenait que des réponses des blancs). */
function dropEmptyHeadings(lines: readonly string[]): string[] {
  const code = codeLines(lines);
  const out: string[] = [];
  // Rang de l'élément gardé qui suit : 0 pour la fin, Infinity pour du contenu.
  let next = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    const rank = code[i] ? null : structureRank(line);
    if (rank === null) {
      next = Infinity;
    } else if (next <= rank) {
      continue;
    } else {
      next = rank;
    }
    out.push(line);
  }
  return out.reverse();
}

function hasContent(lines: readonly string[]): boolean {
  const code = codeLines(lines);
  return lines.some((line, i) => line.trim() && (code[i] || structureRank(line) === null));
}

/**
 * Partie propre au modèle, réécrite : sa banque est retirée (Magistra écrit la sienne) ; dans son corrigé, les réponses
 * des blancs sont retirées et, s'il reste autre chose (réponses d'autres questions, barème…), le corrigé des blancs de
 * Magistra (`key`) prend leur place ; sans rien d'autre, tout est retiré (Magistra met son corrigé à la fin). Version
 * élève seule (`withKey` faux) : tout corrigé est retiré ; d'une partie mêlée (« Correction et remédiation »), seules
 * les réponses des blancs.
 */
function renderOwnSection(segment: Segment, words: readonly string[], key: readonly string[] | null, withKey: boolean): { text: string; placed: boolean } {
  if (segment.kind === 'bank' || (segment.kind === 'key' && !withKey)) return { text: '', placed: false };
  const known = new Set(words.map(normalizeAnswer));
  const strict = segment.kind === 'key';
  const remove = blankAnswerLines(segment.lines, known, strict, segment.rank);
  const kept = segment.lines.filter((_, i) => !remove[i]);
  if (!hasContent(dropEmptyHeadings(kept))) return { text: '', placed: false };
  let lines = kept;
  let placed = false;
  if (strict && key) {
    // Corrigé des blancs de Magistra à la place des réponses du modèle (ou en tête de son corrigé s'il n'en donnait pas).
    const first = remove.indexOf(true);
    let at = first === -1 ? 1 : remove.slice(0, first).filter(r => !r).length;
    // Jamais au milieu d'un tableau : après ses lignes gardées.
    while (at > 0 && at < kept.length && TABLE_ROW.test(kept[at - 1]) && TABLE_ROW.test(kept[at])) at++;
    const inserted = first === -1 ? ['', '**Texte à trous**', '', ...key, ''] : ['', ...key, ''];
    lines = [...kept.slice(0, at), ...inserted, ...kept.slice(at)];
    placed = true;
  }
  return { text: unwrapMarks(dropEmptyHeadings(lines).join('\n')), placed };
}

// ─── Document final ─────────────────────────────────────────────────────────

/** Doubles crochets restés seuls dans le texte (marque trop longue, jamais fermée) : retirés, hors code et formules. */
function dropStrayBrackets(text: string): string {
  const lines = text.split('\n');
  const code = codeLines(lines);
  return lines.map((line, i) => (code[i] || !line.includes('[[') ? line : line.split(/(`[^`\n]*`|\$[^$\n]*\$)/).map((part, k) => (
    k % 2 ? part : part.replace(/\[\[([^[\]\n]+)\]\]/g, '$1').replace(/\[\[(?=[^\s[])/g, '')
  )).join(''))).join('\n');
}

/** Séparateurs devenus consécutifs (partie retirée entre deux « --- ») fusionnés, lignes vides en trop retirées. */
function tidy(text: string): string {
  const lines = text.split('\n');
  const code = codeLines(lines);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!code[i]) {
      if (RULE.test(line)) {
        const previous = out.findLast(l => l.trim());
        if (previous === undefined || RULE.test(previous)) return;
      }
      if (!line.trim() && out.length && !out[out.length - 1].trim()) return;
    }
    out.push(line);
  });
  while (out.length && (!out[out.length - 1].trim() || RULE.test(out[out.length - 1]))) out.pop();
  return out.join('\n');
}

/** Repère d'une partie du modèle mise de côté pendant la pose des blancs. */
const slot = (n: number) => `\u{E000}${n}\u{E000}`;
const SLOT = /^\u{E000}(\d+)\u{E000}$/u;

/** Texte à trous final et mots à trouver, dans l'ordre des blancs (aucun : le texte du modèle est rendu tel quel). */
export interface ClozeDocument {
  content: string;
  words: string[];
}

/** Un essai de construction (mots marqués, ou mots en gras si le modèle n'en a marqué aucun) ; null sans aucun blanc. */
function tryBuild(text: string, options: { max?: number; withKey: boolean }, bold: boolean): ClozeDocument | null {
  const lines = text.split('\n');
  const segments = splitOwnSections(lines, firstTextLine(lines, bold));
  const own: Segment[] = [];
  const bodyLines: string[] = [];
  for (const segment of segments) {
    if (segment.kind === null) {
      bodyLines.push(...segment.lines);
    } else {
      bodyLines.push('', segment.kind === 'bank' ? '' : slot(own.length), '');
      if (segment.kind !== 'bank') own.push(segment);
    }
  }
  const body = bodyLines.join('\n');
  const budget = options.max === undefined ? undefined : Math.max(0, options.max - countMarks(body));
  const stream = new ClozeStream(options.max);
  const shaped = (stream.push(markBoldKeywords(body, { all: bold, budget })) + stream.end())
    // Mot marqué dans du gras (« **[[air]]** ») : blanc sans gras ; blancs collés (« [[a]][[b]] ») : espacés (jamais
    // « range(3) » dans du code).
    .replace(/\*\*(\(\d+\) ________)\*\*/g, '$1')
    .replace(/________(?=\(\d+\) (?:________|\\_))/g, '________ ');
  if (stream.words.length === 0) return null;

  const key = stream.keys.map((w, i) => `- (${i + 1}) ${w}`);
  let placed = !options.withKey;
  const rendered = own.map(segment => {
    const result = renderOwnSection(segment, stream.words, placed ? null : key, options.withKey);
    placed ||= result.placed;
    return result.text;
  });
  const restore = (part: string[]) => dropStrayBrackets(part.map(line => {
    const m = SLOT.exec(line);
    return m ? rendered[Number(m[1])] : line;
  }).join('\n'));

  // Banque de mots juste après le paragraphe (ou le bloc de code) du dernier blanc.
  const out = shaped.split('\n');
  const code = codeLines(out);
  const lastBlank = stream.blanks[stream.blanks.length - 1];
  let cut = out.findLastIndex(line => line.includes(lastBlank)) + 1;
  while (cut < out.length && (out[cut].trim() || code[cut])) cut++;
  const bank = stream.words
    .map((word, i) => ({ word, key: stream.keys[i] }))
    .sort((a, b) => a.word.localeCompare(b.word, 'fr', { sensitivity: 'base' }))
    .map(entry => entry.key);
  const parts = [
    tidy(restore(out.slice(0, cut))).replace(/^(?:[ \t]*\n)+/, '').trimEnd(),
    `### Banque de mots\n\n${bank.join(' · ')}`,
  ];
  const after = tidy(restore(out.slice(cut))).trim();
  if (after) parts.push(after);
  if (!placed) parts.push(`### Corrigé\n\n${key.join('\n')}`);
  return { content: `${parts.join('\n\n')}\n`, words: [...stream.words] };
}

/**
 * Document final : blancs numérotés, banque de mots (ordre alphabétique) juste après le paragraphe du dernier blanc,
 * corrigé à la fin (sauf version élève seule). Sans aucun mot marqué, les mots en gras du texte sont pris comme mots
 * à trouver (petit modèle qui n'a pas marqué), sauf si le modèle a écrit ses propres blancs. Sans aucun blanc, le
 * document du modèle est rendu tel quel (seuls les doubles crochets sont retirés).
 */
export function buildCloze(text: string, options: { max?: number; withKey: boolean }): ClozeDocument {
  return tryBuild(text, options, false)
    ?? (hasOwnBlanks(text) ? null : tryBuild(text, options, true))
    ?? { content: dropStrayBrackets(unwrapMarks(text)), words: [] };
}

export function buildClozeDocument(text: string, options: { max?: number; withKey: boolean }): string {
  return buildCloze(text, options).content;
}

/** Avertissement à montrer à l'enseignant : aucun blanc posé, ou moins de mots à trouver que demandé ; null sinon. */
export function clozeWarning(doc: ClozeDocument, max?: number): string | null {
  const n = doc.words.length;
  if (n === 0) {
    return hasOwnBlanks(doc.content) ? null : "Le modèle n'a marqué aucun mot à trouver : le texte est rendu sans blancs. Relancez la génération.";
  }
  if (max !== undefined && n < max) {
    return `Le modèle n'a marqué que ${n} mot${n > 1 ? 's' : ''} à trouver sur les ${max} demandés.`;
  }
  return null;
}
