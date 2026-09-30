// Texte à trous construit par Magistra (format « texte à trous » des outils Exercices et Évaluation).
//
// Le modèle écrit le texte COMPLET et entoure de doubles crochets chaque mot à faire trouver : « Le chat [[dort]] ».
// Magistra remplace chaque mot marqué par un blanc numéroté « (1) ________ », pendant la rédaction comme dans le
// document final, puis ajoute la banque de mots et le corrigé, toujours alignés sur les blancs.
// Constat avec un vrai petit modèle local (Ministral 3 3B) : il sait marquer un mot, mais laissait le mot visible à
// côté du blanc, sautait des numéros et donnait un corrigé qui ne correspondait pas aux blancs.

import type { GenerationRequest } from './types.js';

export const CLOZE_BLANK = '________';

/** Longueur maximale d'un mot marqué (un mot ou un groupe court). */
const MAX_MARK = 60;

/** Demande de texte à trous (le format a été validé pour l'outil, le niveau et la matière). */
export function isClozeRequest(req: Pick<GenerationRequest, 'type' | 'modalite'>): boolean {
  return (req.type === 'exercices' || req.type === 'evaluation') && req.modalite === 'texte_trous';
}

/** Mot marqué, sans mise en forme (« **dort** » → « dort ») ; null si la marque n'en est pas une. */
function markedWord(inner: string): string | null {
  if (/[[\]\n]/.test(inner)) return null;
  const word = inner.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return word && word.length <= MAX_MARK ? word : null;
}

/**
 * Remplacement au fil de la rédaction : chaque « [[mot]] » devient « (n) ________ » ; au-delà de `max` blancs, le mot
 * reste simplement écrit. Une marque coupée entre deux morceaux du flux est retenue jusqu'à sa fin.
 */
export class ClozeStream {
  readonly words: string[] = [];
  private pending = '';

  constructor(private readonly max?: number) {}

  push(chunk: string): string {
    this.pending += chunk;
    let out = '';
    for (;;) {
      const start = this.pending.indexOf('[[');
      if (start === -1) {
        // Un « [ » final peut commencer une marque : il attend le morceau suivant.
        const keep = this.pending.endsWith('[') ? 1 : 0;
        out += this.pending.slice(0, this.pending.length - keep);
        this.pending = this.pending.slice(this.pending.length - keep);
        return out;
      }
      out += this.pending.slice(0, start);
      const rest = this.pending.slice(start + 2);
      const end = rest.indexOf(']]');
      if (end === -1) {
        // Pas encore fermée : on attend la suite, sauf si ce ne peut plus être une marque (trop longue, fin de ligne).
        if (rest.length > MAX_MARK + 8 || rest.includes('\n')) {
          out += '[[';
          this.pending = rest;
          continue;
        }
        this.pending = this.pending.slice(start);
        return out;
      }
      out += this.replace(rest.slice(0, end));
      this.pending = rest.slice(end + 2);
    }
  }

  /** Fin du flux : ce qui était retenu est rendu tel quel. */
  end(): string {
    const rest = this.pending;
    this.pending = '';
    return rest;
  }

  private replace(inner: string): string {
    const word = markedWord(inner);
    if (word === null) return `[[${inner}]]`;
    if (this.max !== undefined && this.words.length >= this.max) return word;
    this.words.push(word);
    return `(${this.words.length}) ${CLOZE_BLANK}`;
  }
}

// ─── Document final ─────────────────────────────────────────────────────────

const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/;
/** Ligne-titre en gras, éventuellement suivie d'une précision entre parenthèses et de « : ». */
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*(?:\([^)]*\))?\s*:?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** Parties que Magistra rédige elle-même, alignées sur les blancs. */
const OWN_SECTION = /^(?:banque de mots|mots? à placer|corrigés?|correction)(?![a-zà-ÿ])/;

function headingTitle(title: string): string {
  return title
    .replace(/[*_#«»"“”:]/g, ' ')
    .replace(/^\s*(?:\d+|[a-z])\s*[.)–-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Niveau d'un titre : 1 à 6 pour « # », 7 pour une ligne tout en gras ; null si la ligne n'est pas un titre. */
function headingLevel(line: string): { level: number; title: string } | null {
  const md = MARKDOWN_HEADING.exec(line);
  if (md) return { level: md[1].length, title: md[2] };
  const bold = BOLD_LINE.exec(line);
  return bold ? { level: 7, title: bold[1] } : null;
}

/** Retire la banque de mots et le corrigé rédigés par le modèle (Magistra les remplace par les siens). */
function removeOwnSections(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipping: number | null = null;
  for (const line of lines) {
    const heading = headingLevel(line);
    if (skipping !== null) {
      const ends = RULE.test(line) || (heading !== null && (heading.level <= skipping || skipping === 7));
      if (!ends) continue;
      skipping = null;
    }
    if (heading && OWN_SECTION.test(headingTitle(heading.title))) {
      skipping = heading.level;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/** Séparateurs devenus consécutifs (partie retirée entre deux « --- ») fusionnés, lignes vides en trop retirées. */
function tidy(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (RULE.test(line)) {
      const previous = out.findLast(l => l.trim());
      if (previous === undefined || RULE.test(previous)) continue;
    }
    out.push(line);
  }
  while (out.length && (!out[out.length - 1].trim() || RULE.test(out[out.length - 1]))) out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Mot déjà marqué (laissé tel quel), ou groupe en gras dans une ligne de texte (sans crochet) ; comme en Markdown, pas
 * d'espace juste à l'intérieur des « ** » (sinon la fin d'un gras et le début du suivant seraient appariés).
 */
const MARK_OR_BOLD = /\[\[[^\]\n]*\]\]|\*\*(?!\s)([^*[\]\n]{1,60}?)(?<!\s)\*\*/g;

/**
 * Un petit modèle met parfois en gras une partie des mots à trouver au lieu de les marquer : dans un paragraphe qui
 * contient déjà un mot marqué, les mots en gras des lignes de texte sont traités comme des mots à trouver (jamais
 * dans un titre, une ligne tout en gras ou une consigne terminée par « : »).
 */
function markBoldKeywords(text: string): string {
  return text.split(/\n{2,}/).map(paragraph => {
    if (!paragraph.includes('[[')) return paragraph;
    return paragraph.split('\n').map(line => {
      if (headingLevel(line) || /:\s*$/.test(line)) return line;
      return line.replace(MARK_OR_BOLD, (match, inner: string | undefined) => (
        inner !== undefined && inner.trim().split(/\s+/).length <= 4 ? `[[${inner}]]` : match
      ));
    }).join('\n');
  }).join('\n\n');
}

/**
 * Document final : blancs numérotés, banque de mots (ordre alphabétique) juste après le paragraphe du dernier blanc,
 * corrigé à la fin (sauf version élève seule). Sans aucune marque dans le texte, le document du modèle est rendu tel
 * quel (seuls les doubles crochets sont retirés).
 */
export function buildClozeDocument(text: string, options: { max?: number; withKey: boolean }): string {
  const stream = new ClozeStream(options.max);
  const body = (stream.push(markBoldKeywords(removeOwnSections(text))) + stream.end())
    // Mot marqué dans du gras (« **[[air]]** ») : blanc sans gras ; blancs collés (« [[a]][[b]] ») : espacés.
    .replace(/\*\*(\(\d+\) ________)\*\*/g, '$1')
    .replace(/________\(/g, '________ (');
  if (stream.words.length === 0) {
    return text.replace(/\[\[([^\n]*?)\]\]/g, (match, inner: string) => markedWord(inner) ?? match);
  }

  const lastBlank = `(${stream.words.length}) ${CLOZE_BLANK}`;
  const at = body.lastIndexOf(lastBlank);
  const paragraphEnd = body.indexOf('\n\n', at);
  const cut = paragraphEnd === -1 ? body.length : paragraphEnd;
  const bank = [...stream.words].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  const parts = [
    tidy(body.slice(0, cut)).trimEnd(),
    `### Banque de mots\n\n${bank.join(' · ')}`,
  ];
  const after = tidy(body.slice(cut)).trim();
  if (after) parts.push(after);
  if (options.withKey) parts.push(`### Corrigé\n\n${stream.words.map((w, i) => `- (${i + 1}) ${w}`).join('\n')}`);
  return `${parts.join('\n\n')}\n`;
}
