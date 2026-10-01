// Texte à trous construit par Magistra (format « texte à trous » des outils Exercices et Évaluation).
//
// Le modèle écrit le texte COMPLET et entoure de doubles crochets chaque mot à faire trouver : « Le chat [[dort]] ».
// Magistra remplace chaque mot marqué par un blanc numéroté « (1) ________ », pendant la rédaction comme dans le
// document final, puis ajoute la banque de mots et le corrigé, toujours alignés sur les blancs.
// Constat avec un vrai petit modèle local (Ministral 3 3B) : il sait marquer un mot, mais laissait le mot visible à
// côté du blanc, sautait des numéros et donnait un corrigé qui ne correspondait pas aux blancs.
//
// Écarts du modèle pris en charge :
//  - marque mal fermée (« [[dort] ») ou crochets en trop (« [[[dort]]] ») : le mot devient quand même un blanc, sans
//    annuler la marque suivante ;
//  - marque dans une formule (« $…$ », « $$…$$ », « \( … \) », « \[ … \] », « $ \frac… $ ») : blanc lisible par KaTeX
//    (mêmes formules que l'affichage, shared/markdownMath.ts ; un montant « 5 $ et 10 $ » ou « $2 … $3 » n'en est pas
//    une) ; dans du code, « [[0, 1]] » (liste imbriquée) reste du code, mais « for i in [[range]](3) » reste un blanc ;
//  - mots à trouver mis en gras au lieu d'être marqués (jamais une étiquette, une consigne, un numéro « **1.** » ou un
//    en-tête de tableau), sauf si le modèle a écrit ses propres blancs (« ________ », « ……… ») ;
//  - banque de mots et corrigé écrits quand même par le modèle, sous divers titres (« Réponses », « Solutions »,
//    « Mots à trouver », « Corrigé : a, b », « Corrigé et barème », « Answers », « Word bank », « Lösungen »…) : sa
//    banque est retirée ; de son corrigé, seules les réponses des blancs sont remplacées par celles de Magistra, le
//    reste (autres questions, barème, remédiation…) est gardé. Version élève seule : tout corrigé est retiré (seules
//    restent les étiquettes « Durée : … », « Barème : … » qui ne dévoilent aucune réponse) ; d'une partie mêlée
//    (« Correction et remédiation »), toute ligne qui dévoile une réponse des blancs.

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

/**
 * Écriture du mot dans la banque et le corrigé : formule entre « $ » ; en code si un caractère y serait lu comme de la
 * mise en forme (« * », même dans un mot : « n*2 » ; « _ » en bord de mot ; « ` », « ~ », « \ », « < ») ou s'il
 * commencerait une liste, une citation ou un titre en tête de la ligne de la banque (« * », « - », « + », « > », « # »,
 * « 1. »). « 3 * 4 » (étoile entre deux espaces) et « est_pair » restent tels quels.
 */
function keyForm(word: string, context: MarkContext): string {
  if (context === 'math' && /[\\^_{}]/.test(word)) return `$${word}$`;
  if (/[`~\\<]|\*(?!\s)|(?<!\s)\*|(?:^|\s)_+\S|\S_+(?:\s|$)/.test(word) || /^(?:[-+*>#]|\d{1,9}[.)])(?:\s|$)/.test(word)) {
    return inlineCode(word);
  }
  return word;
}

/** Formule ouverte : « $ », « $$ », « \( » (sur une ligne) ou « \[ » (sur plusieurs lignes) ; '' hors formule. */
type Formula = '' | '$' | '$$' | '\\(' | '\\[';

/** Bloc « ``` » ou « ~~~ » ouvert (`code` faux pour un bloc « markdown », qui n'est que du texte entouré). */
interface Fence {
  char: string;
  size: number;
  code: boolean;
  /** Bloc « markdown » englobant d'un bloc de code intérieur (« ```python » dans « ```markdown »). */
  parent: Fence | null;
}

/**
 * « $ » seul à `i` : même lecture que l'affichage (shared/markdownMath.ts puis remark-math et guardMath,
 * src/lib/export/markdown.ts). Le « $ » suivant sur la ligne le ferme. C'est une formule (`math`) si rien ne colle aux
 * « $ » de l'intérieur et qu'aucun chiffre ne suit la fermeture (règle de Pandoc), ou si l'intérieur, entouré
 * d'espaces, contient une commande LaTeX (« $ \frac{1}{2} $ ») ; sinon deux montants (`text` : « 5 $ et 10 $ »,
 * « $2 … $3 »). Sans fermeture sur la ligne : `lone`. undefined : attendre la suite du flux.
 */
function inlineDollar(s: string, i: number, final: boolean): 'math' | 'text' | 'lone' | undefined {
  const stop = Math.min(s.length, i + 1001);
  let k = i + 1;
  while (k < stop && s[k] !== '\n' && (s[k] !== '$' || s[k - 1] === '\\')) k++;
  if (k === stop) return stop < s.length || final ? 'lone' : undefined;
  if (s[k] === '\n') return 'lone';
  if (k + 1 === s.length && !final) return undefined;
  // « $$ » ne ferme pas une formule ouverte par « $ ».
  if (s[k + 1] === '$') return 'lone';
  const span = s.slice(i + 1, k);
  const digitAfter = /\d/.test(s[k + 1] ?? '');
  if (/^\s|\s$/.test(span)) return /\\[a-zA-Z]/.test(span) && !digitAfter ? 'math' : 'text';
  return digitAfter ? 'text' : 'math';
}

/**
 * Fermeture d'une formule « \( » (« \) » sur la même ligne, à 1000 caractères au plus) ou « \[ » (« \] », à 4000
 * caractères au plus), comme shared/markdownMath.ts. true : trouvée ; false : absente ; undefined : attendre la suite.
 * La dernière recherche de chaque sorte est gardée : des « \( » ou « \[ » jamais fermés ne font pas relire tout le texte
 * (la première fermeture après une position l'est aussi pour toute position entre les deux).
 */
class CloseFinder {
  private last = { inline: { from: -1, at: -1 }, display: { from: -1, at: -1 } };

  constructor(private readonly s: string) {}

  /** Première fin (« \) » ou fin de ligne pour `inline`, « \] » sinon) à partir de `from` ; -1 : aucune. */
  private next(kind: 'inline' | 'display', from: number): number {
    const s = this.s;
    const last = this.last[kind];
    if (last.from !== -1 && from >= last.from && (last.at === -1 || from <= last.at)) return last.at;
    let at = -1;
    if (kind === 'display') {
      at = s.indexOf('\\]', from);
      while (at !== -1 && s[at - 1] === '\\') at = s.indexOf('\\]', at + 1);
    } else {
      for (let k = from; k < s.length && at === -1; k++) {
        if (s[k] === '\n' || (s[k] === '\\' && s[k + 1] === ')' && s[k - 1] !== '\\')) at = k;
      }
    }
    this.last[kind] = { from, at };
    return at;
  }

  inline(from: number, final: boolean): boolean | undefined {
    const at = this.next('inline', from);
    if (at !== -1) return this.s[at] !== '\n' && at - from <= 1000;
    return this.s.length - from > 1000 || final ? false : undefined;
  }

  display(from: number, final: boolean): boolean | undefined {
    const at = this.next('display', from);
    if (at !== -1) return at - from <= 4000;
    return this.s.length - from > 4000 || final ? false : undefined;
  }
}

/**
 * Remplacement au fil de la rédaction : chaque « [[mot]] » devient « (n) ________ » ; au-delà de `max` blancs, le mot
 * reste simplement écrit. Une marque coupée entre deux morceaux du flux est retenue jusqu'à sa fin, comme un « $ », un
 * « \( » ou un « ` » (formule, code) dont on ne connaît pas encore la suite (au plus jusqu'à la fin de la ligne, ou
 * jusqu'au « \] » d'une formule « \[ »).
 * Les numéros affichés pendant la rédaction ne comptent que les mots marqués : dans le document final, des mots en gras
 * pris comme mots à trouver (petit modèle qui n'a pas tout marqué) ou une banque du modèle retirée peuvent les décaler.
 */
export class ClozeStream {
  readonly words: string[] = [];
  /** Écriture de chaque mot dans la banque et le corrigé (même ordre que `words`). */
  readonly keys: string[] = [];
  /** Blanc écrit pour chaque mot (même ordre que `words` ; forme propre aux formules). */
  readonly blanks: string[] = [];
  private pending = '';
  private fence: Fence | null = null;
  /** Nombre d'accents graves qui ont ouvert le `code` en cours ; 0 hors code. */
  private codeSpan = 0;
  private math: Formula = '';
  /** Entre deux « $ » qui ne forment pas une formule (« 5 $ et 10 $ ») : le second ne rouvre rien. */
  private dollarText = false;
  /** Crochets simples ouverts et pas encore fermés sur la ligne (« [voir [[mot]]] » : le dernier « ] » est gardé). */
  private brackets = 0;
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
          this.dollarText = false;
          this.brackets = 0;
          if (this.math === '$' || this.math === '\\(') this.math = '';
        } else if (ch !== ' ' && ch !== '\t') {
          this.lineStart = false;
          if (ch === '[') this.brackets++;
          else if (ch === ']' && this.brackets > 0) this.brackets--;
        }
      }
      this.previous = text.at(-1) ?? this.previous;
    };
    const closes = new CloseFinder(s);
    while (i < s.length) {
      const c = s[i];
      if (c === '[') {
        let run = 1;
        while (s[i + run] === '[') run++;
        // Des « [ » en fin de morceau peuvent commencer une marque : ils attendent le morceau suivant.
        if (i + run === s.length && !final) break;
        if (run === 1) {
          emit(c);
          i++;
          continue;
        }
        const mark = this.markAt(s, i, run, final);
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
      if (c === '\\' && !this.fence?.code && !this.codeSpan && this.previous !== '\\') {
        // « \( », « \[ » : peut-être une formule ; la suite le dira.
        if (i + 1 === s.length && !final) break;
        const taken = this.backslash(s, i, final, closes);
        if (taken === 0) break;
        emit(s.slice(i, i + taken));
        i += taken;
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

  /**
   * « \ » hors code : « \( » ou « \[ » ouvre une formule si sa fermeture suit (« \) » sur la même ligne, « \] » dans
   * les 4000 caractères, comme shared/markdownMath.ts) ; « \) », « \] » la ferment. Renvoie le nombre de caractères
   * à écrire (0 : attendre la suite).
   */
  private backslash(s: string, i: number, final: boolean, closes: CloseFinder): number {
    const n = s[i + 1];
    if ((n === ')' && this.math === '\\(') || (n === ']' && this.math === '\\[')) {
      this.math = '';
      return 2;
    }
    if ((n !== '(' && n !== '[') || this.math) return 1;
    const found = n === '(' ? closes.inline(i + 2, final) : closes.display(i + 2, final);
    if (found === undefined) return 0;
    if (!found) return 1;
    this.math = n === '(' ? '\\(' : '\\[';
    return 2;
  }

  /** Suite de « ` », « ~ » ou « $ » : met à jour le contexte ; renvoie le nombre de caractères à écrire (0 : attendre). */
  private delimiter(s: string, i: number, run: number, final: boolean): number {
    const c = s[i];
    if (c !== '$' && run >= 3 && this.lineStart) {
      const nl = s.indexOf('\n', i + run);
      if (nl === -1 && !final) return 0;
      const lineEnd = nl === -1 ? s.length : nl;
      const info = s.slice(i + run, lineEnd);
      const fence = this.fence;
      if (fence && c === fence.char && run >= fence.size && !info.trim()) {
        // Fermeture : rien d'autre sur la ligne ; un bloc de code intérieur rend la main au bloc « markdown » englobant.
        this.fence = fence.parent;
        return run;
      }
      const markdown = /^\s*(?:markdown|md)\b/i.test(info);
      // Ouverture d'un bloc : son langage (« python », « markdown »…) dit si c'est du code. Dans un bloc « markdown »
      // (du texte entouré), « ```python » ou « ~~~ » ouvre un bloc de code intérieur ; « ``` » seul le referme.
      const opens = (c === '~' || !info.includes('`'))
        && (fence === null || (!fence.code && !markdown && (c !== fence.char || info.trim() !== '')));
      if (opens) {
        this.fence = { char: c, size: run, code: !markdown, parent: fence };
        this.codeSpan = 0;
        this.math = '';
        this.dollarText = false;
        return lineEnd - i;
      }
    }
    if (this.fence?.code) return run;
    if (c === '`') {
      if (!this.math) {
        if (!this.codeSpan) this.codeSpan = run;
        else if (this.codeSpan === run) this.codeSpan = 0;
      }
    } else if (c === '$' && !this.codeSpan && this.previous !== '\\') {
      // Dans « \( … \) » ou « \[ … \] », un « $ » n'ouvre ni ne ferme rien.
      if (this.math === '\\(' || this.math === '\\[') return run;
      if (this.dollarText) {
        this.dollarText = false;
      } else if (this.math === '$' || (this.math === '$$' && run >= 2)) {
        this.math = '';
      } else if (!this.math) {
        if (run >= 2) {
          this.math = '$$';
        } else {
          const kind = inlineDollar(s, i, final);
          if (kind === undefined) return 0;
          if (kind === 'math') this.math = '$';
          else if (kind === 'text') this.dollarText = true;
        }
      }
    }
    return run;
  }

  private context(): MarkContext {
    return this.fence?.code || this.codeSpan ? 'code' : this.math ? 'math' : 'text';
  }

  /**
   * « [[ » (ou plus) à `i` : marque, null si ce n'en est pas une, undefined pour attendre. Dans le texte, des crochets
   * en trop (« [[[dort]]] », « [[dort]]] ») sont retirés avec la marque ; jamais dans du code (« [[[0]]] » est une
   * liste) ni dans une formule.
   */
  private markAt(s: string, i: number, run: number, final: boolean): { text: string; next: number } | null | undefined {
    const text = this.context() === 'text';
    return text && run > 2 ? this.mark(s, i + run, final, true) : this.mark(s, i + 2, final, false);
  }

  /**
   * Marque commençant à `from` (après « [[ ») : remplacement, null si ce n'en est pas une, undefined pour attendre.
   * `extra` : des « [ » en trop précédaient la marque (elle doit alors être fermée par « ]] »).
   */
  private mark(s: string, from: number, final: boolean, extra: boolean): { text: string; next: number } | null | undefined {
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
      if (context === 'code' || extra) return null;
      next = j + 1;
    } else if (context === 'text' && (extra || this.brackets === 0)) {
      // « ]] » suivi d'autres « ] » (sauf s'ils ferment un « [ » ouvert plus tôt sur la ligne).
      while (s[next] === ']') next++;
      if (next === s.length && !final) return undefined;
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

/**
 * Titre ramené à l'essentiel (minuscules, sans mise en forme, numérotation, parenthèses ni symbole ou émoji autour :
 * « ### ✅ 1. Corrigé » → « corrigé »), et ses parties « A : B ».
 */
function titleParts(title: string): { whole: string; first: string; last: string } {
  const parts = title
    .replace(/[*_#«»"“”`]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^(?:\d+|[ivx]+|[a-z])\s*[.)–-]\s*/i, '')
    .toLowerCase()
    .split(/\s*:\s*|\s+[–—-]\s+/)
    .map(part => part.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  return { whole: parts.join(' '), first: parts[0] ?? '', last: parts.at(-1) ?? '' };
}

/** Mot de liaison d'une précision de titre (« Corrigé de l'exercice 2 », « Answers to exercise 1 », « Lösungen zu… »). */
const LINK = String.raw`(?:(?:du|de|des|de la|à|au|aux|pour|dans|sur|to|for|of|del|para|zu|zum|zur|für|per)(?![\p{L}])|d['’]|de l['’])`;
/** Précision quelconque après un titre sans ambiguïté (« Corrigé pour l'enseignant »). */
const QUALIFIER = String.raw`(?:\s+${LINK}.*)?`;
/** Précision qui nomme l'exercice (« Réponses de l'exercice 2 », « Solutions du texte à trous », « Answers to the test »). */
const EXERCISE_QUALIFIER = String.raw`(?:\s+${LINK}\s*(?:(?:le|la|les|the|el|los|las|die|der|das|den|il|lo|gli|i)\s+|l['’]\s*)?`
  + String.raw`(?:texte|exercices?|questions?|activités?|évaluation|devoir|fiche|élèves?|enseignants?|professeurs?|partie|consigne|`
  + String.raw`exercises?|activit(?:y|ies)|text|worksheet|test|quiz|teachers?|students?|tasks?|ejercicios?|preguntas?|actividad(?:es)?|`
  + String.raw`texto|aufgaben?|übungen?|fragen?|esercizi[oi]?|domande)(?![\p{L}]).*)?`;
/** Précision de forme (« Corrigé détaillé », « Réponses attendues », « Correct answers »). */
const KEY_SUFFIX = String.raw`(?:\s+(?:détaillée?s?|complète?s?|proposée?s?|attendue?s?|correcte?s?|possibles?|type))?`;
/** Banque de mots écrite par le modèle (Magistra écrit la sienne), aussi dans la langue étudiée. */
const BANK_TITLE = new RegExp(String.raw`^(?:banque de mots|liste (?:des|de) mots|(?:les )?mots? (?:à placer|à utiliser|à trouver|à compléter|manquants|de la banque)`
  + String.raw`|word (?:bank|box|list)|words? to (?:use|place|find|complete)|missing words|banco de palabras|palabras (?:que faltan|para completar)`
  + String.raw`|wortliste|wortkasten|lösungswörter|wörter zum einsetzen|banca (?:di|delle) parole|parole (?:da inserire|mancanti))${QUALIFIER}$`, 'u');
/** Corrigé écrit par le modèle, sous un titre qui ne peut rien annoncer d'autre. */
const KEY_TITLE = new RegExp(String.raw`^(?:corrigés?|éléments de correction|texte (?:à trous )?complété|answer keys?|clave de respuestas|lösungsschlüssel|musterlösungen?)`
  + String.raw`${KEY_SUFFIX}${QUALIFIER}$`, 'u');
/**
 * Titre qui annonce un corrigé ou autre chose : « Réponse de l'organisme à l'effort », « Solution de sulfate de cuivre »,
 * « Correction de la vision » sont des titres du cours. Corrigé seulement en titre entier ou avec une précision qui
 * nomme l'exercice ; et jamais suivi d'un paragraphe rédigé qui contient des mots marqués (voir ownSectionAt).
 */
const AMBIGUOUS_KEY = String.raw`(?:réponses?|solutions?|corrections?|(?:correct |expected |model )?answers?|keys?|respuestas?|soluci(?:ón|ones)|lösungen?|antworten|risposte|soluzioni|clave|chiave)`;
const AMBIGUOUS_TITLE = new RegExp(String.raw`^${AMBIGUOUS_KEY}${KEY_SUFFIX}${EXERCISE_QUALIFIER}$`, 'u');
const AMBIGUOUS_START = new RegExp(String.raw`^${AMBIGUOUS_KEY}(?![\p{L}])`, 'u');
const KEY_WORD = /(?:^|\s)(?:corrigés?|corrections?|réponses?|solutions?|answers?|respuestas?|soluci(?:ón|ones)|lösungen?|antworten|risposte|soluzioni)(?![\p{L}])/u;
/** Contenu à garder même dans une partie « corrigé » : remédiation, barème, critères, prolongement… */
const OTHER_CONTENT = /remédiation|barème|critères?|grilles?|compétences?|prolongements?|durée|différenciation|conseils?|objectifs?|remarques?|pour aller plus loin|trace écrite|bilan|auto-?évaluation|erreurs?|matériel|prérequis|remediation|scoring|rubrics?|mark(?:ing)? scheme|criteria/;
/** Barème et critères de notation : ils accompagnent le corrigé (« Corrigé et barème » reste un corrigé). */
const SCORING = /barèmes?|critères?|grilles?|points?|scoring|rubrics?|mark(?:ing)? scheme|criteria/g;

/** Partie propre au modèle : sa banque de mots, son corrigé, ou un corrigé mêlé d'autre chose (« Correction et remédiation »). */
type OwnKind = 'bank' | 'key' | 'mixed';

function ownKind(title: string): OwnKind | null {
  const { whole, first, last } = titleParts(title);
  if (!whole) return null;
  if (OTHER_CONTENT.test(whole)) {
    if (!KEY_WORD.test(whole)) return null;
    // « Corrigé et barème », « Correction et critères de réussite » : un corrigé (retiré entier d'une version élève).
    return OTHER_CONTENT.test(whole.replace(SCORING, ' ')) ? 'mixed' : 'key';
  }
  if (BANK_TITLE.test(whole) || BANK_TITLE.test(first) || BANK_TITLE.test(last)) return 'bank';
  const key = (part: string) => KEY_TITLE.test(part) || AMBIGUOUS_TITLE.test(part);
  if (key(whole) || key(last) || /^(?:corrigés?|correction)$/.test(first)) return 'key';
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
  // Longue énumération (« - O₂, CO₂, dioxyde de carbone, …, expiration. ») : une banque, même terminée par un point
  // (constaté avec un vrai petit modèle, dont la banque était restée en double).
  if (items.length >= 4 && items.every(item => wordCount(item) <= 4)) return true;
  return items.every(item => wordCount(item) <= (sentence ? 2 : 5));
}

interface Section {
  kind: OwnKind;
  /** Rang du titre (voir headingOf). */
  rank: number;
  end: number;
}

/** Mot marqué valide (« [[mot]] », « [[mot] »). */
const MARK = /\[\[[^[\]\n]{1,60}\]/;

/**
 * Phrase rédigée qui contient des mots marqués (« Le cœur bat plus [[vite]] et la respiration… ») : c'est le texte à
 * trous, jamais une liste de réponses (« [[a]], [[b]] », « 1. [[a]] »).
 */
function markedProse(line: string): boolean {
  if (answerLike(line) || !MARK.test(line)) return false;
  return (line.replace(/\[\[[^[\]\n]*\]\]?/g, ' ').match(/\p{L}{2,}/gu) ?? []).length >= 5;
}

/**
 * Lignes du texte lues une seule fois : chaque partie du modèle se juge ensuite sans relire son contenu (un modèle qui
 * boucle sur « Réponse : … » ne rend pas la construction quadratique).
 */
interface Scan {
  lines: readonly string[];
  code: readonly boolean[];
  /** Première ligne du texte à trous (voir ownSectionAt). */
  textStart: number;
  /** Fins de parties déjà calculées (voir sectionEnd). */
  ends: Map<number, number>;
  /**
   * Nombre de lignes avant la ligne i : avec un mot marqué ; phrase rédigée avec des mots marqués ; avec un mot marqué
   * pour la première fois ; non vides ; non vides et pas un espace de réponse.
   */
  marks: Int32Array;
  prose: Int32Array;
  fresh: Int32Array;
  filled: Int32Array;
  written: Int32Array;
}

function scanLines(lines: readonly string[], textStart: number): Scan {
  const code = codeLines(lines);
  const count = (test: (line: string, i: number) => boolean) => {
    const sums = new Int32Array(lines.length + 1);
    lines.forEach((line, i) => { sums[i + 1] = sums[i] + (test(line, i) ? 1 : 0); });
    return sums;
  };
  const seen = new Set<string>();
  return {
    lines, code, textStart, ends: new Map(),
    marks: count(line => MARK.test(line)),
    prose: count((line, i) => !code[i] && markedProse(line)),
    fresh: count(line => {
      let fresh = false;
      for (const m of line.matchAll(/\[\[([^[\]\n]{1,60})\]/g)) {
        const word = normalizeAnswer(m[1]);
        if (!seen.has(word)) fresh = true;
        seen.add(word);
      }
      return fresh;
    }),
    filled: count(line => line.trim() !== ''),
    written: count(line => line.trim() !== '' && !answerSpace(line)),
  };
}

/**
 * Partie propre au modèle qui commence à la ligne `start`, et sa fin. Un corrigé n'est reconnu qu'après la première
 * ligne du texte à trous (`textStart`), ou s'il contient lui-même des mots marqués : un titre « Solutions » avant le
 * texte appartient au cours.
 */
function ownSectionAt(scan: Scan, start: number): Section | null {
  const { lines, code, textStart } = scan;
  const heading = headingOf(lines[start]);
  if (!heading) return null;
  const kind = ownKind(heading.title);
  if (kind === null) return null;
  const label = heading.rank === 8 ? LABEL_LINE.exec(lines[start])![2] : null;
  if (kind === 'bank') {
    // Banque : le titre et les lignes de mots qui le suivent, jusqu'à la première ligne rédigée (le texte peut suivre
    // sans ligne vide) ; étiquette « Mots à placer : a, b » : sa ligne et les puces qui suivent.
    if (label !== null && !bankLine(label)) return null;
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
  const ambiguous = AMBIGUOUS_START.test(titleParts(heading.title).whole);
  // « Solution : mélange homogène… » (définition du cours) : une étiquette ambiguë n'annonce un corrigé que suivie
  // d'une liste de réponses.
  if (label !== null && ambiguous && !answerList(label)) return null;
  const end = sectionEnd(scan, start, heading.rank);
  // Contenu : le texte de l'étiquette et les lignes qui suivent le titre (comptes faits une fois pour toutes).
  const within = (sums: Int32Array, labelCounts: boolean) => sums[end] - sums[start + 1] + (label !== null && labelCounts ? 1 : 0);
  // Avant le texte (ou à sa hauteur) : un corrigé ne se reconnaît qu'à ses propres mots marqués, jamais suivi d'un
  // paragraphe rédigé qui en contient (c'est alors le texte à trous lui-même, sous un titre « Solutions » du cours).
  // Titre ambigu (« Solution », « Réponse ») : de même, sauf si ce paragraphe ne marque que des mots déjà marqués plus
  // haut (texte complété par le modèle).
  if (start <= textStart && !within(scan.marks, label !== null && MARK.test(label))) return null;
  if ((start <= textStart || (ambiguous && scan.fresh[end] - scan.fresh[start] > 0))
    && within(scan.prose, label !== null && markedProse(label))) return null;
  // Espace de réponse de l'élève (« **Réponse :** » suivi de « 1. ………… ») : ce n'est pas un corrigé.
  if (within(scan.filled, true) && !within(scan.written, label !== null && !answerSpace(label))) return null;
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
 * sous-parties « Partie 1 », « Partie 2 » et ses étiquettes « Barème : … », « Durée : … » en font partie). Sous une
 * ligne en gras ou une étiquette : le premier bloc qui suit, puis seulement des blocs de réponses (listes, tableaux,
 * sous-titres), jamais un paragraphe rédigé ni une étiquette de contenu à garder (« Durée : … ») ; le titre en gras
 * qui annonce ce paragraphe (« **Exercice 2** ») part avec lui, même quand le paragraphe le suit sans ligne vide.
 * Toujours clos par un séparateur « --- » ou un titre de contenu à garder (remédiation, barème, durée…).
 *
 * `ends` garde la fin trouvée pour les étiquettes qui se suivent (« Réponse : … » répété par un modèle qui boucle) :
 * une étiquette qui ne clôt pas la partie laisse le même état qu'au début d'une partie d'étiquette, sa fin est donc la
 * même (sans cela, chaque étiquette relisait toute la suite : temps quadratique).
 */
function sectionEnd(scan: Scan, start: number, rank: number): number {
  const { lines, code, ends } = scan;
  const known = rank === 8 ? ends.get(start) : undefined;
  if (known !== undefined) return known;
  let seenContent = rank === 8;
  let afterBlank = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (code[i]) {
      if (rank >= 7 && seenContent && (afterBlank || rank === 8)) {
        end = i;
        break;
      }
      seenContent = true;
      afterBlank = false;
      continue;
    }
    if (!line.trim()) {
      if (seenContent) afterBlank = true;
      continue;
    }
    if (RULE.test(line)) {
      end = i;
      break;
    }
    const heading = headingOf(line);
    if (heading && (heading.rank === 8
      // Étiquette : fait partie du corrigé, sauf un contenu à garder (« Durée : … ») après une ligne en gras ou une étiquette.
      ? rank >= 7 && OTHER_CONTENT.test(titleParts(heading.title).whole)
      : closesSection(heading.title) || (heading.rank <= 6 && (rank >= 7 || heading.rank <= rank)))) {
      end = i;
      break;
    }
    if (rank >= 7 && seenContent) {
      // Paragraphe rédigé : fin du corrigé, avec les titres en gras qui l'annoncent (« **Exercice 2** »). Des mots
      // marqués dans un paragraphe annoncé par un tel titre : l'exercice suivant, même sans ligne vide ; sans titre
      // (texte complété du modèle sur plusieurs lignes), ils restent dans le corrigé.
      const prose = (afterBlank || rank === 8) && !answerLike(line) && !(heading && heading.rank >= 7);
      const title = prose || markedProse(line) ? titleStart(lines, start, i) : i;
      if (prose || title < i) {
        end = title;
        break;
      }
    }
    seenContent = true;
    afterBlank = false;
  }
  if (rank === 8) {
    for (let j = start + 1; j < end && !code[j] && headingOf(lines[j])?.rank === 8; j++) ends.set(j, end);
  }
  return end;
}

/** Premier des titres en gras (et lignes vides) qui précèdent directement la ligne `i`, après `start` ; `i` sans titre. */
function titleStart(lines: readonly string[], start: number, i: number): number {
  let b = i;
  while (b - 1 > start && (!lines[b - 1].trim() || headingLevel(lines[b - 1])?.level === 7)) b--;
  while (b < i && !lines[b].trim()) b++;
  return b;
}

interface Segment {
  kind: OwnKind | null;
  rank: number;
  lines: string[];
}

/** Découpe le texte en parties : texte de l'exercice (kind null) et parties propres au modèle. */
function splitOwnSections(lines: readonly string[], textStart: number): Segment[] {
  const scan = scanLines(lines, textStart);
  const segments: Segment[] = [];
  let body: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const section = scan.code[i] ? null : ownSectionAt(scan, i);
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
const SPAN_OR_BOLD = /`[^`\n]*`|\$(?!\s)[^$\n]*?(?<!\s)\$|\[\[[^[\]\n]{0,60}\]\]|\*\*(?!\s)([^*[\]\n]{1,60}?)(?<!\s)\*\*/g;

/** Mot en gras en tête de ligne qui est une consigne ou une étiquette, pas un mot du texte (« **Complète** le texte »). */
const LEADING_LABEL = /^(?:consignes?|compl[eè]te[sz]?|complétez|remplis(?:sez)?|utilise[sz]?|place[sz]?|choisis(?:sez)?|retrouve[sz]?|écris|écrivez|lis|lisez|observe[sz]?|relie[sz]?|souligne[sz]?|entoure[sz]?|recopie[sz]?|réponds|répondez|indique[sz]?|exercice|question|partie|document|texte|étape|remarque|attention|rappel|astuce|aide|indice|note|nom|prénom|classe|date|durée|barème|compétences?|objectifs?|exemples?|phrases?|items?|affirmations?|numéros?|n°|énoncés?)(?![a-zà-ÿ])/i;

/** Numéro d'un élément (« 1. », « a) », « (2) », « iv. ») : jamais un mot à trouver. */
const ENUMERATOR = /^(?:\(?(?:\d+|[a-z]|[ivx]{1,4})[.)°]|\(\d+\))$/i;

/** Groupe en gras d'une ligne de texte qui peut être un mot à trouver (jamais une étiquette, une consigne ni un numéro). */
function boldKeyword(line: string, match: string, inner: string, offset: number): boolean {
  const label = inner.trim();
  if (wordCount(inner) > 4 || ENUMERATOR.test(label)) return false;
  // Étiquette : « **Consigne :** … », « **Consigne** : … », « - **Poumons** : … », « **Exercice 1** – … ».
  if (/[:：]\s*$/.test(inner) || /^\s*(?:[:：]|[–—]|-\s)/.test(line.slice(offset + match.length))) return false;
  const atStart = /^\s*(?:(?:[-*+•]|\d+[.)])\s+)?$/.test(line.slice(0, offset));
  // En tête de ligne : consigne ou étiquette (« **Complète** », « **Exemple 1** »), numéro sans ponctuation
  // (« **1** Nous… ») ou suivi d'un tiret (« **Phrase 2 –** »).
  return !(atStart && (LEADING_LABEL.test(label) || /^(?:\d+|[a-z])$/i.test(label) || /[.)–—-]$/.test(label)));
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

/**
 * Blanc écrit par le modèle : traits (« ________ », « \_\_\_\_ ») ou pointillés (« ……… », « .......... »), jamais des
 * points de suspension (« … », « ... », « Il réfléchit.... »).
 */
const OWN_BLANK = /_{4,}|(?:\\_){4,}|(?<![\p{L}\p{N}.…])(?:…{2,}|(?:[.…]\s?){4,})/gu;

/**
 * Le modèle a écrit ses propres blancs dans le texte (« La (1) ________ produit », « la ……… pour fabriquer ») : son
 * document est gardé tel quel. Ni une ligne à compléter par l'élève (« 1. ……… »), ni un champ après une étiquette
 * (« Nom : ……… Prénom : ……… », « Réponse : ________ ») n'en sont.
 */
function hasOwnBlanks(text: string): boolean {
  const lines = text.split('\n');
  const code = codeLines(lines);
  return lines.some((line, i) => !code[i] && !RULE.test(line) && !answerSpace(line)
    && [...line.matchAll(OWN_BLANK)].some(m => !/[:：]\s*$/.test(line.slice(0, m.index))));
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

/** Points annoncés après une réponse : « (1 pt) », « [2 points] », « → 1 point », « – 0,5 pt », « 1 pt ». */
const POINTS = /\s*(?:[([]\s*\d+(?:[.,]\d+)?\s*(?:pts?|points?)\s*[)\]]|(?:[:→=–—/-]+\s*)?\d+(?:[.,]\d+)?\s*(?:pts?|points?)\.?)\s*$/i;

/** Réponse sans les points annoncés après elle (« photosynthèse (1 pt) » → « photosynthèse » ; « 2 points » reste). */
function withoutPoints(text: string): string {
  const stripped = text.replace(POINTS, '');
  return /[\p{L}\p{N}]/u.test(stripped) ? stripped : text;
}

/** Cellule de points d'un tableau (« 1 », « 0,5 pt ») : ni une réponse, ni du texte. */
const POINTS_CELL = /^\d+(?:[.,]\d+)?\s*(?:pts?|points?)?$/i;

/**
 * Lecture des lignes du corrigé du modèle : `mixed`, partie mêlée d'une version avec corrigé (seules les lignes qui ne
 * donnent que des réponses des blancs) ; `key`, vrai corrigé (aussi les lignes « (n) … », le texte complété, une
 * réponse fausse parmi les bonnes) ; `student`, version élève seule : de plus, toute ligne qui dévoile une réponse.
 */
type AnswerMode = 'mixed' | 'key' | 'student';

/**
 * Réponses des blancs, en forme comparable, et de quoi repérer dans une ligne (mot entier) celles d'au moins trois
 * lettres (« a », « à », « ou », « où » d'un texte sur les homophones sont partout).
 */
interface Known {
  set: ReadonlySet<string>;
  patterns: readonly RegExp[];
}

function knownAnswers(words: readonly string[]): Known {
  const set = new Set(words.map(normalizeAnswer).filter(Boolean));
  const patterns = [...set].filter(word => /\p{L}{3}/u.test(word))
    .map(word => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u'));
  return { set, patterns };
}

/** Nombre de réponses différentes des blancs citées dans une ligne (mots entiers, sans mise en forme). */
function mentions(line: string, known: Known): number {
  const text = line.normalize('NFC').replace(/[*_`$«»"“”\\[\]]/g, ' ').toLowerCase();
  return known.patterns.filter(pattern => pattern.test(text)).length;
}

/**
 * Version élève seule : ligne qui dévoile une réponse des blancs, en gras ou marquée (« l'**énergie** »), en tête
 * (« 1. photosynthèse : processus… », « | photosynthèse | … | ») ou avec une autre (texte complété sans mise en forme).
 */
function revealsAnswer(line: string, known: Known): boolean {
  for (const m of line.matchAll(/\[\[([^[\]\n]+)\]\]?|\*\*([^*\n]+)\*\*|__([^_\n]+)__/g)) {
    if (known.set.has(normalizeAnswer(withoutPoints(m[1] ?? m[2] ?? m[3])))) return true;
  }
  const head = TABLE_ROW.test(line)
    ? tableCells(line).map(cell => cell.replace(/[*_`]/g, '')).find(cell => cell && !/^(?:\(?\d+\)?[.)]?|[a-z][.)])$/i.test(cell)) ?? ''
    : line.trim().replace(/^(?:[-*+•]|\d+[.)]|\(\d+\)|[a-z][.)])\s+/i, '').split(/\s*(?:[:→=(,;]|\s[–—-]\s)/)[0];
  return known.set.has(normalizeAnswer(withoutPoints(head))) || mentions(line, known) >= 2;
}

/**
 * Ligne du corrigé du modèle qui donne la réponse d'un blanc : « 1. énergie », « (2) branchies », « | (1) | énergie | »,
 * « Réponses : énergie, branchies », « 1. photosynthèse (1 pt) ». Voir AnswerMode.
 */
function isBlankAnswer(line: string, known: Known, mode: AnswerMode): boolean {
  const strict = mode !== 'mixed';
  const trimmed = line.trim();
  if (!trimmed || RULE.test(trimmed) || TABLE_DELIMITER.test(trimmed)) return false;
  if (mode === 'student' && revealsAnswer(trimmed, known)) return true;
  const isKnown = (text: string) => known.set.has(normalizeAnswer(withoutPoints(text)));
  if (TABLE_ROW.test(trimmed)) {
    const cells = tableCells(trimmed).filter(Boolean);
    const first = (cells[0] ?? '').replace(/[*_`]/g, '');
    if (strict && /^\(\d+\)$/.test(first)) return true;
    const rest = (/^(?:\(?\d+\)?[.)]?|[a-z][.)])$/i.test(first) ? cells.slice(1) : cells)
      // Colonne de points (« | 1 | énergie | 1 pt | ») : ni une réponse, ni du texte.
      .filter(cell => isKnown(cell) || !POINTS_CELL.test(cell));
    const matched = rest.filter(isKnown);
    if (!matched.length) return false;
    return rest.every(cell => matched.includes(cell) || (strict && wordCount(cell) <= 3));
  }
  if (strict) {
    // Texte complété par le modèle : mots des blancs marqués, ou en gras (au moins deux).
    const shown = [...trimmed.matchAll(/\[\[([^[\]\n]+)\]\]|\*\*([^*\n]+)\*\*/g)].map(m => m[1] ?? m[2]);
    const hits = shown.filter(isKnown).length;
    if (hits >= 2 || (hits >= 1 && trimmed.includes('[['))) return true;
  }
  // Points retirés avant l'étiquette : « lumière : 2 points » est une réponse, pas l'étiquette « lumière ».
  let content = withoutPoints(trimmed.replace(/^(?:[-*+•]|\d+[.)]|[a-z][.)])\s+/i, ''));
  if (strict && /^(?:\*\*)?\(\d+\)/.test(content)) return true;
  const label = /^(?:\*\*|__)?[^:*]{1,40}?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/.exec(content);
  if (label) content = label[1];
  const items = listItems(withoutPoints(content)).filter(item => normalizeAnswer(item));
  if (!items.length) return false;
  const found = items.filter(isKnown).length;
  if (found === items.length) return true;
  // Corrigé : une réponse fausse du modèle parmi les bonnes (« énergie, feuilles, branchies ») ne reste pas.
  return strict && items.length >= 2 && found * 2 >= items.length && items.every(item => isKnown(item) || wordCount(item) <= 3);
}

/** Élément d'une liste de réponses : puce, numéro, ligne de tableau, ou ligne d'un seul mot court. */
function answerItem(line: string): boolean {
  if (answerLike(line)) return !TABLE_DELIMITER.test(line);
  return !headingLevel(line) && !/:\s*$/.test(line) && wordCount(line) <= 4;
}

/** Réponse courte (un mot ou un groupe de trois mots au plus), une fois retirés puce, numéro, points et cellules de numéro. */
function shortAnswer(line: string): boolean {
  if (TABLE_ROW.test(line)) return tableCells(line).every(cell => wordCount(withoutPoints(cell)) <= 3);
  return wordCount(withoutPoints(line.replace(/^\s*(?:[-*+•]|\d+[.)]|\(\d+\))\s+/, ''))) <= 3;
}

/**
 * Lignes du corrigé du modèle qui portent sur les blancs. Dans un vrai corrigé (`key`, `student`), une liste ou un
 * tableau dont la plupart des éléments sont des réponses des blancs est retiré en entier (réponses courtes seulement) :
 * une réponse fausse du modèle (« 2. feuilles ») ne reste pas à côté du corrigé de Magistra.
 */
function blankAnswerLines(lines: readonly string[], known: Known, mode: AnswerMode, rank: number): boolean[] {
  const strict = mode !== 'mixed';
  const code = codeLines(lines);
  const remove = lines.map((line, i) => {
    if (code[i]) return false;
    if (i === 0) return rank === 8 && isBlankAnswer(line, known, mode);
    return isBlankAnswer(line, known, mode);
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

/** Étiquette d'un contenu à garder (« Durée : 20 minutes », « Barème : 1 point par mot »). */
function otherLabel(line: string): boolean {
  const heading = headingOf(line);
  return heading?.rank === 8 && OTHER_CONTENT.test(titleParts(heading.title).whole);
}

/**
 * Partie propre au modèle, réécrite : sa banque est retirée (Magistra écrit la sienne) ; dans son corrigé, les réponses
 * des blancs sont retirées et, s'il reste autre chose (réponses d'autres questions, barème…), le corrigé des blancs de
 * Magistra (`key`) prend leur place ; sans rien d'autre, tout est retiré (Magistra met son corrigé à la fin).
 * Version élève seule (`withKey` faux) : tout corrigé est retiré, sauf ses étiquettes de contenu à garder (« Durée :
 * … », « Barème : … ») qui ne citent aucune réponse ; d'une partie mêlée (« Correction et remédiation »), toute ligne
 * qui dévoile une réponse des blancs (voir AnswerMode), quel que soit son titre.
 */
function renderOwnSection(segment: Segment, words: readonly string[], key: readonly string[] | null, withKey: boolean): { text: string; placed: boolean } {
  if (segment.kind === 'bank') return { text: '', placed: false };
  const known = knownAnswers(words);
  if (segment.kind === 'key' && !withKey) {
    const code = codeLines(segment.lines);
    const kept = segment.lines.filter((line, i) => i > 0 && !code[i] && otherLabel(line)
      && !isBlankAnswer(line, known, 'student') && mentions(line, known) === 0);
    return { text: kept.join('\n\n'), placed: false };
  }
  const strict = segment.kind === 'key';
  const mode: AnswerMode = !withKey ? 'student' : strict ? 'key' : 'mixed';
  const remove = blankAnswerLines(segment.lines, known, mode, segment.rank);
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
    k % 2 ? part : part.replace(/\[\[\s*\]\]/g, '').replace(/\[\[([^[\]\n]+)\]\]/g, '$1').replace(/\[\[(?=[^\s[\]])/g, '')
  )).join(''))).join('\n');
}

/** Séparateurs devenus consécutifs (partie retirée entre deux « --- ») fusionnés, lignes vides en trop retirées. */
function tidy(text: string): string {
  const lines = text.split('\n');
  const code = codeLines(lines);
  const out: string[] = [];
  // Dernière ligne non vide écrite (sans relire tout ce qui précède à chaque séparateur).
  let previous: string | undefined;
  lines.forEach((line, i) => {
    if (!code[i]) {
      if (RULE.test(line) && (previous === undefined || RULE.test(previous))) return;
      if (!line.trim() && out.length && !out[out.length - 1].trim()) return;
    }
    out.push(line);
    if (line.trim()) previous = line;
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
