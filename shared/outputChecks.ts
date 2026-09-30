// Contrôle du nombre d'éléments produits : exercices, questions, affirmations, problèmes, séances, appréciations, mots
// à compléter.
//
// Les prompts exigent « EXACTEMENT n …, numérotés de 1 à n », mais un petit modèle ignore souvent le nombre : 7
// questions au lieu de 10, 4 séances détaillées au lieu de 6, 6 mots à compléter au lieu de 12. L'enseignant ne s'en
// apercevait qu'en comptant, parfois après l'impression. checkOutputStructure compare le document final au nombre
// demandé et renvoie des avertissements compréhensibles (évènement « warning », code CONTENT_CHECK) : jamais bloquant,
// aucun appel supplémentaire au modèle. La pipeline ne l'appelle que pour une réponse terminée normalement (une réponse
// tronquée a déjà son propre avertissement).
//
// Prudence avant tout : au moindre doute, aucun avertissement. Seuls les éléments numérotés sont comptés (« ### Exercice
// 2 », « **Question 3.** », « Séance 4 », « 5. » pour une appréciation) ; une numérotation absente, recommencée par
// partie, des exercices différenciés (numérotés par niveau) ou des questions regroupées en exercices ne donnent lieu à
// aucun avertissement. Le corrigé n'est jamais compté : sous un titre « Corrigé », « Correction », « Réponses »,
// « Barème »…, une numérotation qui reprend depuis le début marque la fin du sujet ; un corrigé intercalé (suivi de
// l'exercice suivant, dont le numéro continue la série) n'interrompt pas le compte.

import { CLOZE_BLANK, isClozeRequest } from './cloze.js';
import { countText, countUnit } from './formats.js';
import { getLevelGroup, SUPERIEUR_GROUPS } from './levels.js';
import type { GenerationRequest } from './types.js';

const ADVICE = 'vérifiez-le avant de l’utiliser, ou relancez la génération.';

const FENCE_RE = /^\s*(```+|~~~+)/;
/** Blanc numéroté posé par Magistra dans un texte à trous (shared/cloze.ts). */
const CLOZE_BLANK_RE = new RegExp(`\\((\\d{1,3})\\) ${CLOZE_BLANK}`, 'g');
/** Case « Vrai » à cocher d'une affirmation (☐ Vrai, - [ ] Vrai…). */
const TRUE_CHECKBOX_RE = /(?:☐|□|▢|◻|\[\s?\])\s*(?:\*\*|__)?\s*Vrai(?!\p{L})/iu;
/** Consigne générale (« Coche ☐ Vrai ou ☐ Faux », « Réponds par… ») : ce n'est pas une affirmation. */
const INSTRUCTION_RE = /(?<!\p{L})(?:coch|entour|r[ée]pond|indiqu)/iu;
/** Numéro en tête de ligne : « 3. », « **3.** », « - 3) », « Affirmation 3 : ». */
const LEADING_NUMBER_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:affirmation\s+)?(\d{1,2})\s*(?:[.):—–-]|\*\*|__)/iu;
/** Appréciation numérotée : « 1. », « **2.** », « ### 3 », « **Appréciation 4** : », « Élève 5 ». */
const APPRECIATION_RE =
  /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:(?:appr[ée]ciation|commentaire|[ée]l[èe]ve)\s+(?:n[°o]\s*)?)?(\d{1,2})\s*(?:[.):—–-]|\*\*|__|$)/iu;
/** Longueur minimale d'une appréciation (2 à 3 phrases) : une ligne plus courte n'en est pas une. */
const MIN_APPRECIATION_CHARS = 60;
/** Titre d'une partie annexe après les appréciations (conseils, remarques…) : la suite n'est plus comptée. */
const NOTES_TITLE_RE = /(?<!\p{L})(?:conseils?|remarques?|notes?|astuces?|personnalis\p{L}*|utilisation)(?!\p{L})/iu;
/** Titre d'un corrigé (début du titre, après une éventuelle numérotation « 3. », « IV – »…). */
const ANSWER_KEY_RE =
  /^(?:proposition\s+de\s+)?(?:corrig|correction|solutions?(?!\p{L})|r[ée]ponses?(?!\p{L})|[ée]l[ée]ments?\s+de\s+(?:r[ée]ponse|correction)|bar[èe]me)/iu;

/**
 * Ligne qui commence par l'élément numéroté (après un titre « # », une puce ou du gras) : « Exercice 2 », « Exercice
 * n° 2 », ou au pluriel avec plusieurs numéros (« Séances 3 et 4 », « Exercices 1 à 3 »).
 */
function numberedLineRe(words: string): RegExp {
  return new RegExp(
    `^\\s*(?:#{1,6}\\s+)?(?:[-*+]\\s+)?(?:\\*\\*|__|\\*|_)?\\s*(?:${words})`
      + '(?:\\s+(?:n[°o]\\s*)?(\\d{1,2})|s\\s+(\\d{1,2})\\s*(?:à|-|–|et)\\s*(\\d{1,2}))(?![\\p{L}\\d])',
    'iu',
  );
}

/** Numéros désignés par une ligne numérotée (« Séances 3 et 4 » → 3, 4 ; « Exercices 1 à 3 » → 1, 2, 3). */
function numbersOf(match: RegExpExecArray): number[] {
  if (match[1] !== undefined) return [Number(match[1])];
  const from = Number(match[2]);
  const to = Number(match[3]);
  if (to <= from || to - from > 20) return [from, to];
  return Array.from({ length: to - from + 1 }, (_, k) => from + k);
}

/** Lignes du document hors blocs de code. */
function proseLines(document: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of document.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** Texte d'une ligne-titre (titre « # » ou ligne tout en gras), sinon undefined. */
function titleOf(line: string): string | undefined {
  return /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)?.[1] ?? /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(line)?.[1];
}

/** Vrai si la ligne est le titre d'un corrigé (titre « # », ligne tout en gras, ou « Corrigé : » seul sur sa ligne). */
function isAnswerKeyTitle(line: string): boolean {
  const title = titleOf(line) ?? /^\s*((?:corrig|correction|r[ée]ponses?|solutions?)[^:.!?]{0,30}?)\s*:?\s*$/iu.exec(line)?.[1];
  if (title === undefined) return false;
  const text = title.replace(/[*_#«»"“”]/g, ' ').replace(/^\s*(?:\d{1,2}|[IVX]{1,4}|[A-Z])\s*[.)–—:-]\s*/, '').trim();
  return ANSWER_KEY_RE.test(text);
}

interface CountOptions {
  /** Le document peut contenir un corrigé qui reprend la numérotation (exercices, questions…). */
  answerKey: boolean;
}

/** Nombre d'éléments numérotés distincts, ou null si le document ne permet pas de compter sans risque d'erreur. */
function countNumbered(document: string, re: RegExp, options: CountOptions): number | null {
  const seen = new Set<number>();
  let max = 0;
  let inKey = false;
  for (const line of proseLines(document)) {
    const match = re.exec(line);
    if (!match) {
      if (options.answerKey && isAnswerKeyTitle(line)) inKey = true;
      continue;
    }
    const numbers = numbersOf(match).filter(n => n > 0);
    if (!numbers.length) continue;
    if (options.answerKey) {
      if (inKey) {
        // Corrigé qui reprend la numérotation : le sujet est terminé. Sinon, corrigé intercalé : on continue.
        if (numbers[0] <= max) break;
        inKey = false;
      } else if (numbers[0] === 1 && seen.has(1)) {
        // Numérotation recommencée hors corrigé (par partie, par niveau…) : impossible de compter sans se tromper.
        return null;
      }
    }
    for (const n of numbers) {
      seen.add(n);
      max = Math.max(max, n);
    }
  }
  return seen.size || null;
}

/** Texte d'une ligne sans mise en forme Markdown. */
function plainText(line: string): string {
  return line.replace(/[*_#>`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Appréciations numérotées. Ne comptent que les textes d'au moins MIN_APPRECIATION_CHARS caractères (sur la ligne du
 * numéro, ou sur la suivante après un intitulé seul « ### Appréciation 1 ») : une liste de conseils ou de remarques
 * n'est pas prise pour des appréciations, pas plus que ce qui suit un titre « Conseils », « Remarques »… Des textes
 * non numérotés plus nombreux que les textes numérotés : la numérotation n'est pas celle des appréciations (null).
 */
function countAppreciations(document: string): number | null {
  const lines = proseLines(document);
  const seen = new Set<number>();
  let matched = 0;
  let loose = 0;
  let restarted = false;
  for (let i = 0; i < lines.length; i++) {
    const match = APPRECIATION_RE.exec(lines[i]);
    if (!match) {
      const title = titleOf(lines[i]);
      if (title === undefined) {
        if (plainText(lines[i]).length >= MIN_APPRECIATION_CHARS) loose++;
      } else if (seen.size && NOTES_TITLE_RE.test(title)) {
        break;
      }
      continue;
    }
    const n = Number(match[1]);
    let text = plainText(lines[i].slice(match[0].length));
    if (text.length < 3) {
      // Intitulé seul : le texte est sur la ligne suivante (qui n'est alors pas un texte isolé).
      const next = lines.findIndex((line, k) => k > i && line.trim() !== '');
      if (next !== -1 && !APPRECIATION_RE.test(lines[next]) && titleOf(lines[next]) === undefined) {
        text = plainText(lines[next]);
        i = next;
      }
    }
    if (n < 1 || text.length < MIN_APPRECIATION_CHARS) continue;
    if (seen.has(n)) restarted = true;
    seen.add(n);
    matched++;
  }
  if (seen.size === 0 || loose > matched) return null;
  // Tous numérotés « 1. » (numérotation laissée au Markdown) : on compte les textes.
  if (seen.size === 1) return matched;
  // Numérotation recommencée (deux séries, liste annexe…) : impossible de compter sans se tromper.
  return restarted ? null : seen.size;
}

/**
 * Affirmations d'un vrai/faux, avant le corrigé : numéros distincts des lignes qui portent une case « Vrai » à cocher
 * (« **3.** … ☐ Vrai ☐ Faux ») ; sans numéro sur ces lignes (cases sous chaque affirmation, tableau), les lignes à
 * cocher elles-mêmes, hors consigne générale.
 */
function countTrueFalse(document: string): number | null {
  const numbered = new Set<number>();
  let unnumbered = 0;
  for (const line of proseLines(document)) {
    if (isAnswerKeyTitle(line)) break;
    if (!TRUE_CHECKBOX_RE.test(line)) continue;
    const number = LEADING_NUMBER_RE.exec(line)?.[1];
    if (number !== undefined && Number(number) > 0) numbered.add(Number(number));
    else if (!INSTRUCTION_RE.test(line)) unnumbered++;
  }
  return numbered.size || unnumbered || null;
}

function checkCloze(req: GenerationRequest, document: string): string | null {
  if (!isClozeRequest(req)) return null;
  const blanks = new Set([...document.matchAll(CLOZE_BLANK_RE)].map(m => m[1]));
  if (blanks.size === 0) {
    // Des blancs posés autrement (« _____ ») ne se comptent pas : aucun avertissement.
    return /_{3,}/.test(document) ? null : 'Le texte à trous ne contient aucun mot à compléter : relancez la génération.';
  }
  const unit = countUnit(req.modalite);
  const wanted = req.nombreExercices;
  if (!unit || !wanted || blanks.size >= wanted) return null;
  return `Le texte à trous compte ${countText(blanks.size, unit)} au lieu des ${wanted} demandés : ${ADVICE}`;
}

function checkExercices(req: GenerationRequest, document: string): string | null {
  const wanted = req.nombreExercices;
  // Exercices différenciés : numérotés par niveau (★, ★★, ★★★), le compte n'a pas de sens.
  if (req.type !== 'exercices' || !wanted || req.difficulte === 'differencie' || isClozeRequest(req)) return null;
  const group = getLevelGroup(req.niveau);
  const unit = countUnit(req.modalite, group);
  if (!unit) return null;
  let found: number | null;
  switch (unit.one) {
    case 'exercice': {
      // Dans le supérieur, les problèmes et études de cas comptent parmi les exercices (prompt de l'outil).
      const words = SUPERIEUR_GROUPS.includes(group)
        ? 'exercice|probl[èe]me|[ée]tude\\s+de\\s+cas|cas\\s+pratique'
        : 'exercice|probl[èe]me';
      found = countNumbered(document, numberedLineRe(words), { answerKey: true });
      break;
    }
    case 'question': {
      // Questions regroupées en exercices : leur numérotation recommence souvent d'un exercice à l'autre.
      const exercise = numberedLineRe('exercice');
      if (proseLines(document).some(line => exercise.test(line))) return null;
      found = countNumbered(document, numberedLineRe('question'), { answerKey: true });
      break;
    }
    case 'problème':
      found = countNumbered(document, numberedLineRe('probl[èe]me'), { answerKey: true });
      break;
    case 'affirmation':
      found = countTrueFalse(document) ?? countNumbered(document, numberedLineRe('affirmation'), { answerKey: true });
      break;
    default:
      // Activités, ateliers, jeux : pas de numérotation imposée.
      return null;
  }
  if (found === null || found === wanted) return null;
  return `Le document contient ${countText(found, unit)} au lieu des ${wanted} demandé${unit.feminine ? 'e' : ''}s : ${ADVICE}`;
}

function checkSeances(req: GenerationRequest, document: string): string | null {
  const wanted = req.nombreSeances;
  if (req.type !== 'sequence' || !wanted) return null;
  const found = countNumbered(document, numberedLineRe('s[ée]ance'), { answerKey: false });
  if (found === null || found === wanted) return null;
  return `La séquence compte ${found} séance${found > 1 ? 's' : ''} au lieu des ${wanted} demandées : ${ADVICE}`;
}

function checkAppreciations(req: GenerationRequest, document: string): string | null {
  if (req.type !== 'appreciations') return null;
  const wanted = req.nombreAppreciations ?? 10;
  if (wanted <= 1) return null;
  const found = countAppreciations(document);
  if (found === null || found === wanted) return null;
  const group = getLevelGroup(req.niveau);
  const [noun, feminine] = SUPERIEUR_GROUPS.includes(group) || group === 'maternelle' ? ['commentaire', false] : ['appréciation', true];
  return `Le document contient ${found} ${noun}${found > 1 ? 's' : ''} au lieu des ${wanted} demandé${feminine ? 'e' : ''}s : ${ADVICE}`;
}

/**
 * Avertissements (texte pour l'enseignant) quand le document final ne compte pas le nombre d'éléments demandé ; []
 * si tout concorde ou si le compte est incertain. `document` : le document final, avant l'ajout des sources utilisées.
 */
export function checkOutputStructure(req: GenerationRequest, document: string): string[] {
  if (typeof document !== 'string' || !document.trim()) return [];
  try {
    return [checkCloze, checkExercices, checkSeances, checkAppreciations]
      .map(check => check(req, document))
      .filter((message): message is string => message !== null);
  } catch {
    // Un contrôle facultatif ne doit jamais empêcher de rendre le contenu.
    return [];
  }
}
