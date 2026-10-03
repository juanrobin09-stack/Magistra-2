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
// Prudence avant tout : au moindre doute, aucun avertissement (un faux « 1 question au lieu des 10 » sur un document
// complet est pire que pas d'avertissement du tout). Seuls les éléments numérotés sont comptés (« ### Exercice 2 »,
// « **Question 3.** », « Séance 4 », « 5. » pour une appréciation) ; une numérotation absente, recommencée par partie
// ou répétée, un élément sans numéro sûr (« ### Problème — Le jardin », « Question 3a », « Exercice 2 bis »), des
// exercices différenciés (numérotés par niveau) ou des questions regroupées en exercices ne donnent lieu à aucun
// avertissement. Le corrigé n'est jamais compté : sous un titre « Corrigé », « Correction », « Réponses », « Barème »…,
// une numérotation qui reprend en arrière marque la fin du sujet ; un corrigé intercalé, qui rappelle l'élément en
// cours (« **Corrigé :** Question 3 : B ») puis laisse place à l'élément suivant (numéro qui continue la série),
// n'interrompt pas le compte.
//
// Temps linéaire, même sur une sortie dégénérée (lignes de milliers d'espaces) : jamais deux « \s* » à la suite dans
// une expression régulière.

import { CLOZE_BLANK, isClozeRequest } from './cloze.js';
import { countText, countUnit } from './formats.js';
import { getLevelGroup, SUPERIEUR_GROUPS } from './levels.js';
import { readPlanTable } from './planTable.js';
import type { GenerationRequest } from './types.js';

const ADVICE = 'vérifiez-le avant de l’utiliser, ou relancez la génération.';

const FENCE_RE = /^\s*(```+|~~~+)/;
/** Blanc numéroté posé par Magistra dans un texte à trous (shared/cloze.ts), y compris dans une formule (« \_ »). */
const CLOZE_BLANK_RE = new RegExp(`\\((\\d{1,3})\\) (?:${CLOZE_BLANK}|(?:\\\\_){8})`, 'g');
/** Blanc tracé par le modèle lui-même : « ___ », « \_\_\_ », « ……… », « ........ », « . . . . ». */
const HANDMADE_BLANK_RE = /_{3,}|(?:\\_){3,}|…{2,}|(?:\.[ \u00a0]?){4,}/;
/** Filet horizontal (« --- », « *** », « ___ ») : pas un blanc. */
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** Case « Vrai » à cocher d'une affirmation (☐ Vrai, - [ ] Vrai…). */
const TRUE_CHECKBOX_RE = /(?:☐|□|▢|◻|\[\s?\])\s*(?:(?:\*\*|__)\s*)?Vrai(?!\p{L})/iu;
/** Consigne générale (« Coche ☐ Vrai ou ☐ Faux », « Réponds par… ») : ce n'est pas une affirmation. */
const INSTRUCTION_RE = /(?<!\p{L})(?:coch|entour|r[ée]pond|indiqu)/iu;
/**
 * Numéro en tête de ligne : « 3. », « **3.** », « - 3) », « 3 — », « Affirmation 3 : ». Jamais le début d'un calcul
 * (« 12 : 4 = 3 », « 45 - 12 = 33 », « 3.5 est un décimal ») : « : » et « - » ne suivent un numéro qu'après le mot
 * « Affirmation », et « . » ou « ) » jamais un chiffre.
 */
const LEADING_NUMBER_RE =
  /^\s*(?:[-*+]\s+)?(?:(?:\*\*|__)\s*)?(?:affirmation\s+(?:n[°o]\s*)?(\d{1,2})\s*(?:[.):—–-]|\*\*|__)|(\d{1,2})(?:[.)](?!\d)|\s*(?:[—–]|\*\*|__)))/iu;
/** Appréciation numérotée : « 1. », « **2.** », « ### 3 », « **Appréciation 4** : », « Élève 5 ». */
const APPRECIATION_RE =
  /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:(?:\*\*|__)\s*)?(?:(?:appr[ée]ciation|commentaire|[ée]l[èe]ve)\s+(?:n[°o]\s*)?)?(\d{1,2})\s*(?:[.):—–-]|\*\*|__|$)/iu;
/** Longueur minimale d'une appréciation (2 à 3 phrases) : une ligne plus courte n'en est pas sûrement une. */
const MIN_APPRECIATION_CHARS = 60;
/** Titre d'une partie annexe après les appréciations (conseils, remarques…) : la suite n'est plus comptée. */
const NOTES_TITLE_RE = /(?<!\p{L})(?:conseils?|remarques?|notes?|astuces?|personnalis\p{L}*|utilisation)(?!\p{L})/iu;
/** Titre d'un corrigé (début du titre, après une éventuelle numérotation « 3. », « IV – »…). */
const ANSWER_KEY_RE =
  /^(?:proposition\s+de\s+)?(?:corrig|correction|solutions?(?!\p{L})|r[ée]ponses?(?!\p{L})|[ée]l[ée]ments?\s+de\s+(?:r[ée]ponse|correction)|bar[èe]me)/iu;
/**
 * « Corrigé : », « Solutions », « Réponses : » seuls sur leur ligne (sans « # » ni gras). Jamais « Réponse : » au
 * singulier : c'est le plus souvent la place laissée à la réponse de l'élève sous chaque question.
 */
const BARE_ANSWER_KEY_RE = /^\s*((?:corrig|correction|solutions?|r[ée]ponses)[^:.!?]{0,30}?)\s*(?::\s*)?$/iu;

/** Début de ligne avant le mot compté : titre « # », puce, gras ou italique. */
const LINE_START = String.raw`^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:(?:\*\*|__|\*|_)\s*)?`;
/** Numéro après le mot compté : « Exercice 2 », « Exercice n° 2 ». */
const NUMBER_RE = /^\s+(?:n[°o]\s*)?(\d{1,2})/iu;
/** Sous-numéro (« 3a », « 3 b) », « 2 bis ») : impossible de savoir s'il désigne un élément de plus. */
const SUB_NUMBER_RE = /^(?:[\p{L}\d]|\s?\p{L}[).]|\s+(?:bis|ter)(?!\p{L}))/iu;
/** Second numéro : « 3 et 4 », « 1 à 3 », « 3-4 », « 3 – 4 ». */
const SECOND_NUMBER_RE = /^(\s*)(à|et|[-–—])(\s*)(\d{1,2})(?![\p{L}\d])/iu;
/** Barème ou durée après un tiret (« Exercice 2 – 4 points », « Séance 3 – 55 min ») : pas un second numéro. */
const UNIT_RE = /^\s*(?:pts?|points?|min(?:utes?)?|h|heures?)(?![\p{L}\d])/iu;

/** Numéros désignés par une ligne, 'doute' si elle désigne un élément sans numéro sûr, null si elle n'en désigne pas. */
type LineNumbers = number[] | 'doute' | null;

/**
 * Lecture des lignes qui commencent par un mot compté (après un titre « # », une puce ou du gras) :
 *  - « Exercice 2 », « Exercice n° 2 » → [2] ; « Exercice 2 – 4 points » → [2] (barème) ;
 *  - « Séances 3 et 4 », « Séance 3-4 » → [3, 4] ; « Exercices 1 à 3 » → [1, 2, 3] ;
 *  - « ### Problème — Le jardin », « Étude de cas : … » (élément sans numéro), « Question 3a », « Question 3 b) »,
 *    « Exercice 2 bis » (sous-numéro), « Séance 3 – 4 … » (intervalle ou titre ?), « Exercices 1, 2 et 3 » → 'doute' ;
 *  - « ## Exercices » (simple titre) ou ligne qui ne commence pas par le mot → null.
 */
function numberedLine(words: string): (line: string) => LineNumbers {
  const start = new RegExp(`${LINE_START}(?:${words})(s?)(?![\\p{L}\\d])`, 'iu');
  return line => {
    const word = start.exec(line);
    if (!word) return null;
    const plural = word[1] !== '';
    const rest = line.slice(word[0].length);
    const number = NUMBER_RE.exec(rest);
    if (!number) return plural ? null : 'doute';
    const from = Number(number[1]);
    const after = rest.slice(number[0].length);
    if (from < 1 || SUB_NUMBER_RE.test(after)) return 'doute';
    const second = SECOND_NUMBER_RE.exec(after);
    if (!second) return plural ? 'doute' : [from];
    const joint = second[2].toLowerCase();
    if (!plural && joint !== 'à' && joint !== 'et') {
      if (UNIT_RE.test(after.slice(second[0].length))) return [from];
      if (second[1] || second[3]) return 'doute';
    }
    const to = Number(second[4]);
    if (to <= from || to - from > 20) return 'doute';
    if (joint === 'et') return [from, to];
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
  };
}

/** Lignes du texte, null pour celles d'un bloc de code (marqueurs compris) : l'indice d'une ligne reste celui du texte. */
function linesOutsideCode(text: string): (string | null)[] {
  let fence: string | null = null;
  return text.split('\n').map(line => {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return null;
    }
    if (marker) {
      fence = marker;
      return null;
    }
    return line;
  });
}

/** Lignes du document hors blocs de code. */
function proseLines(document: string): string[] {
  return linesOutsideCode(document).filter((line): line is string => line !== null);
}

/** Texte d'une ligne-titre (titre « # » ou ligne tout en gras), sinon undefined. */
function titleOf(line: string): string | undefined {
  return /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)?.[1] ?? /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*(?::\s*)?$/.exec(line)?.[1];
}

/** Vrai si la ligne est le titre d'un corrigé (titre « # », ligne tout en gras, ou « Corrigé : » seul sur sa ligne). */
function isAnswerKeyTitle(line: string): boolean {
  const title = titleOf(line) ?? BARE_ANSWER_KEY_RE.exec(line)?.[1];
  if (title === undefined) return false;
  const text = title.replace(/[*_#«»"“”]/g, ' ').replace(/^\s*(?:\d{1,2}|[IVX]{1,4}|[A-Z])\s*[.)–—:-]\s*/, '').trim();
  return ANSWER_KEY_RE.test(text);
}

interface CountOptions {
  /** Le document peut contenir un corrigé qui reprend la numérotation (exercices, questions…). */
  answerKey: boolean;
}

/** Nombre d'éléments numérotés distincts, ou null si le document ne permet pas de compter sans risque d'erreur. */
function countNumbered(document: string, numbersOf: (line: string) => LineNumbers, options: CountOptions): number | null {
  const seen = new Set<number>();
  let max = 0;
  let inKey = false;
  for (const line of proseLines(document)) {
    const numbers = numbersOf(line);
    if (numbers === null) {
      if (options.answerKey && isAnswerKeyTitle(line)) inKey = true;
      continue;
    }
    if (numbers === 'doute') {
      // Élément sans numéro sûr dans le sujet : impossible de compter sans se tromper (dans le corrigé : ignoré).
      if (inKey) continue;
      return null;
    }
    if (options.answerKey) {
      if (inKey) {
        // Corrigé qui reprend la numérotation en arrière : le sujet est terminé.
        if (numbers[0] < max) break;
        // Corrigé intercalé qui rappelle l'élément en cours (« Question 3 : B ») : on reste dans le corrigé.
        if (numbers[0] === max) continue;
        // Élément suivant : le sujet continue.
        inKey = false;
      } else if (numbers.some(n => seen.has(n))) {
        // Numérotation recommencée ou répétée hors corrigé (par partie, par niveau…) : impossible de compter sans se
        // tromper.
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
 * Appréciations numérotées. Ne comptent sûrement que les textes d'au moins MIN_APPRECIATION_CHARS caractères (sur la
 * ligne du numéro, ou sur la suivante après un intitulé seul « ### Appréciation 1 ») : une liste de conseils ou de
 * remarques n'est pas prise pour des appréciations, pas plus que ce qui suit un titre « Conseils », « Remarques »…
 * Un texte numéroté plus court (« 7. Excellent trimestre, bravo ! ») compte s'il comble un trou de la série (le 7 entre
 * le 6 et le 8) ; après la série, ou avec une numérotation « 1. » partout, il rend le compte incertain (null). Des
 * textes non numérotés plus nombreux que les textes numérotés : la numérotation n'est pas celle des appréciations
 * (null).
 */
function countAppreciations(document: string): number | null {
  const lines = proseLines(document);
  const seen = new Set<number>();
  /** Numéros des textes trop courts pour être sûrement des appréciations. */
  const short: number[] = [];
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
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === '') next++;
      if (next < lines.length && !APPRECIATION_RE.test(lines[next]) && titleOf(lines[next]) === undefined) {
        text = plainText(lines[next]);
        i = next;
      }
    }
    if (n < 1) continue;
    if (text.length < MIN_APPRECIATION_CHARS) {
      if (text.length >= 3) short.push(n);
      continue;
    }
    if (seen.has(n)) restarted = true;
    seen.add(n);
    matched++;
  }
  if (seen.size === 0 || loose > matched) return null;
  // Tous numérotés « 1. » (numérotation laissée au Markdown) : on compte les textes, sauf si un texte court s'y mêle
  // (appréciation brève ou liste annexe ? impossible de trancher).
  if (seen.size === 1) return short.length ? null : matched;
  // Numérotation recommencée (deux séries, liste annexe…) : impossible de compter sans se tromper.
  if (restarted) return null;
  const max = Math.max(...seen);
  // Texte court numéroté après la série (« 10. Bravo ! » après le 9) : appréciation brève ou note ? Aucun avertissement.
  if (short.some(n => n > max)) return null;
  // Texte court qui comble un trou de la série (le 7 entre le 6 et le 8) : une appréciation brève. Ceux dont le numéro
  // est déjà pris (liste annexe qui recommence à 1) ne comptent pas.
  return seen.size + new Set(short.filter(n => !seen.has(n))).size;
}

/**
 * Affirmations d'un vrai/faux : numéros distincts des lignes qui portent une case « Vrai » à cocher (« **3.** … ☐ Vrai
 * ☐ Faux ») ; sans numéro sur ces lignes (cases sous chaque affirmation, tableau), les lignes à cocher elles-mêmes,
 * hors consigne générale, jusqu'au premier titre de corrigé. Le corrigé se reconnaît comme pour countNumbered (un
 * corrigé intercalé n'interrompt pas le compte). 0 : aucune affirmation à cocher ; null : compte incertain (lignes
 * numérotées et non numérotées mêlées, numérotation recommencée, lignes à cocher après un corrigé sans numéros).
 */
function countTrueFalse(document: string): number | null {
  const numbered = new Set<number>();
  let max = 0;
  let unnumbered = 0;
  let inKey = false;
  let sawKey = false;
  let unnumberedAfterKey = false;
  for (const line of proseLines(document)) {
    if (isAnswerKeyTitle(line)) {
      inKey = sawKey = true;
      continue;
    }
    if (!TRUE_CHECKBOX_RE.test(line)) continue;
    const match = LEADING_NUMBER_RE.exec(line);
    const number = match ? Number(match[1] ?? match[2]) : 0;
    if (number > 0) {
      if (inKey) {
        if (number < max) break;
        if (number === max) continue;
        inKey = false;
      } else if (numbered.has(number)) {
        return null;
      }
      numbered.add(number);
      max = Math.max(max, number);
    } else if (!INSTRUCTION_RE.test(line)) {
      if (sawKey) unnumberedAfterKey = true;
      else unnumbered++;
    }
  }
  if (numbered.size) return unnumbered ? null : numbered.size;
  return unnumberedAfterKey ? null : unnumbered;
}

/** Le modèle a tracé ses propres blancs (hors code et filets horizontaux). */
function hasHandmadeBlanks(document: string): boolean {
  return proseLines(document).some(line => !RULE_RE.test(line) && HANDMADE_BLANK_RE.test(line));
}

function checkCloze(req: GenerationRequest, document: string): string | null {
  if (!isClozeRequest(req)) return null;
  const blanks = new Set([...document.matchAll(CLOZE_BLANK_RE)].map(m => m[1]));
  if (blanks.size === 0) {
    // Des blancs tracés autrement (« _____ », « ……… », « ........ ») ne se comptent pas : aucun avertissement.
    return hasHandmadeBlanks(document) ? null : 'Le texte à trous ne contient aucun mot à compléter : relancez la génération.';
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
      found = countNumbered(document, numberedLine(words), { answerKey: true });
      break;
    }
    case 'question': {
      // Questions regroupées en exercices : leur numérotation recommence souvent d'un exercice à l'autre.
      const exercise = numberedLine('exercice');
      if (proseLines(document).some(line => Array.isArray(exercise(line)))) return null;
      found = countNumbered(document, numberedLine('question'), { answerKey: true });
      break;
    }
    case 'problème':
      found = countNumbered(document, numberedLine('probl[èe]me'), { answerKey: true });
      break;
    case 'affirmation': {
      const statements = countTrueFalse(document);
      found = statements === 0 ? countNumbered(document, numberedLine('affirmation'), { answerKey: true }) : statements;
      break;
    }
    default:
      // Activités, ateliers, jeux : pas de numérotation imposée.
      return null;
  }
  if (found === null || found === wanted) return null;
  return `Le document contient ${countText(found, unit)} au lieu des ${wanted} demandé${unit.feminine ? 'e' : ''}s : ${ADVICE}`;
}

/**
 * Plan d'une séquence (option « plan d'abord ») : les séances se comptent dans les lignes numérotées du tableau (une ligne
 * par séance, « Séances 3 et 4 » comptent pour deux), jamais d'après des titres « Séance n » : un plan ne détaille pas ses
 * séances, et une mention dans le texte (« évaluation en séance 6 ») ne doit pas fausser le compte. Aucun tableau lisible :
 * aucun avertissement (compte incertain).
 */
function countPlanRows(document: string): number | null {
  const covered = new Set<number>();
  for (const session of readPlanTable(document)) {
    for (let n = session.numero; n <= (session.fin ?? session.numero); n++) covered.add(n);
  }
  return covered.size || null;
}

function checkSeances(req: GenerationRequest, document: string): string | null {
  const wanted = req.nombreSeances;
  if (req.type !== 'sequence' || !wanted) return null;
  if (req.planSeulement) {
    const rows = countPlanRows(document);
    if (rows === null || rows === wanted) return null;
    return `Le plan compte ${rows} séance${rows > 1 ? 's' : ''} au lieu des ${wanted} demandées : ${ADVICE}`;
  }
  const found = countNumbered(document, numberedLine('s[ée]ance'), { answerKey: false });
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

// ─── Citations de la copie (outil « corriger ») ─────────────────────────────

/** Citation d'au moins ce nombre de mots : en dessous, un mot isolé entre guillemets n'est pas un extrait de la copie. */
const MIN_QUOTE_WORDS = 5;
/** Fragment d'une citation à retrouver (entre deux « […] ») : en dessous, trop court pour être sûr. */
const MIN_FRAGMENT_WORDS = 3;
const MAX_QUOTE_CHARS = 400;
const MAX_QUOTES_CHECKED = 60;
const FRENCH_QUOTE_RE = /«([^«»\n]+)»/g;
const CURLY_QUOTE_RE = /“([^“”\n]+)”/g;
const STRAIGHT_QUOTE_RE = /"([^"\n]+)"/g;
/** Coupure d'une citation : « […] », « [...] », « … », « ... ». */
const ELLIPSIS_RE = /\[\s*(?:…|\.{2,})\s*\]|…|\.{3,}/g;
/** Contexte conservé de part et d'autre d'une citation pour reconnaître une correction proposée. */
const QUOTE_CONTEXT_CHARS = 80;
/** Flèche juste avant la citation (« à jouer » → « ont joué »), « -> » et « => » compris ; un « > » seul est une citation Markdown. */
const ARROW_BEFORE_RE = /(?:→|⇒|⟶|➔|➜|->|=>)[\s*_(]*$/;
/** Mot qui annonce une correction proposée, et non un passage de la copie (texte déjà passé par `quoteForm`). */
const PROPOSAL_BEFORE_RE = /(?:^| )(?:corrections?|corrig(?:e|ee)s?|propos(?:e|ee)s?|propositions?|reformulations?|reecritures?|suggestions?|sugger(?:e|ee)s?|attendue?s?|on attend(?:ait)?|il fallait|il faudrait|ecrire|ecrivez|devient|remplac(?:er|ez) par|plutot)(?: est| serait| devrait etre)?$/;
/** « ont joué » (au lieu de « à jouer ») : la citation qui précède est la correction, celle qui suit est la copie. */
const REPLACED_AFTER_RE = /^[\s*_),;]*\(?\s*(?:au lieu d|à la place d|plutôt qu|et non\b|et pas\b)/i;

/** Minuscules, sans accents ni ponctuation, apostrophes et espaces unifiés : « L’élève, » et « l'eleve » se valent. */
function quoteForm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function wordsOf(form: string): number {
  return form ? form.split(' ').length : 0;
}

/** Code en ligne (`…`), avec ses accents graves : jamais une citation de la copie. */
const INLINE_CODE_RE = /(`+[^`\n]*?`+)/;
/** Barre verticale de tableau Markdown (« \| » est un « | » ordinaire dans une cellule). */
const PIPE_RE = /(?<!\\)\|/;
/** Cellule de la ligne de séparation d'un tableau : « --- », « :--- », « :---: ». */
const SEPARATOR_CELL_RE = /^:?-+:?$/;
/** Lignes parcourues à partir de la première d'un tableau pour trouver sa ligne de séparation. */
const MAX_TABLE_PREAMBLE = 3;
/** Texte d'en-tête de colonne plus long : une cellule ordinaire (première ligne d'un tableau sans séparateur), pas un intitulé. */
const MAX_HEADER_CHARS = 60;
/** Mot d'un en-tête de colonne qui annonce une correction proposée (texte déjà passé par `quoteForm`) : « Correction proposée », « Version corrigée », « Forme correcte », « Bonne réponse », « Version améliorée », « Réécrit », « Rectifié », « À écrire », « Remplacement »… */
const CORRECTION_HEADER_RE = /(?:^| )(?:corrections?|corrig(?:e|ee)s?|correctes?|propos(?:e|ee)s?|propositions?|reformulations?|reecrit(?:ures?|es?|s)?|rectifi(?:e|ee|cation)s?|amelior(?:e|ee|ation)s?|suggestions?|sugger(?:e|ee)s?|attendue?s?|ecrire|remplac[a-z]*|bonnes? reponses?|nouvelles? versions?)(?: |$)/;
/** Forme d'en-tête qui désigne la copie malgré un mot de correction : « Avant correction », « Avant la reformulation », « Sans relecture », « Non corrigé », « Non rectifié », « Pas correct », « Version originale », « Texte initial », « À corriger ». Un « avant », « sans », « non » ou « pas » seul n'en est pas un (« Corrigé (sans fautes) », « Correction (non exhaustive) »). */
const ORIGINAL_HEADER_RE = /(?:^| )(?:(?:avant|sans) (?:(?:la|les|sa|ses|toute|toutes) )?(?:corrections?|relectures?|reformulations?|reecritures?|rectifications?|ameliorations?|revisions?|remplacements?|suggestions?|propositions?)|(?:non|pas) (?:corrige|rectifie|ameliore|reecrit|reformule|correct)(?:e|ee|es|s)?|a corriger|(?:origina|initia)(?:ux|ls?|les?))(?: |$)/;
/** Mot qui désigne la copie : un en-tête mixte (« Erreur et correction », « Phrase de l'élève (corrigée) ») garde le passage de la copie dans sa colonne, qui reste vérifiée. */
const COPY_HEADER_RE = /(?:^| )(?:passages?|extraits?|citations?|copies?|erreurs?|eleves?)(?: |$)/;

/** Citation d'un texte, avec un peu du texte qui la précède et la suit sur sa ligne. */
interface QuotedSegment {
  text: string;
  before: string;
  after: string;
  /** Intitulé de la colonne du tableau où se trouve la citation, quand il est connu. */
  column?: string;
}

/** En-tête d'un tableau : ses cellules et l'indice de sa ligne dans le texte (les lignes qui suivent sont des données). */
interface TableHeader {
  row: number;
  cells: string[];
}

/** Cellules d'une ligne de tableau, sans les barres de bord. */
function tableCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(PIPE_RE).map(cell => cell.trim());
}

/** Ligne de séparation d'un tableau (« |---|:---:| »). */
function isSeparatorRow(row: string): boolean {
  return PIPE_RE.test(row) && tableCells(row).every(cell => SEPARATOR_CELL_RE.test(cell));
}

/**
 * En-tête du tableau dont la première ligne à barres verticales est `start` : la ligne qui précède la ligne de
 * séparation, cherchée sur quelques lignes seulement ; sans séparateur (sortie d'un petit modèle), la première ligne si
 * une autre ligne à barres la suit. undefined pour une ligne isolée.
 */
function tableHeaderAt(lines: (string | null)[], start: number): TableHeader | undefined {
  const first = lines[start];
  if (typeof first !== 'string') return undefined;
  let previous = first;
  for (let k = start + 1; k <= start + MAX_TABLE_PREAMBLE; k++) {
    const line = lines[k];
    if (typeof line !== 'string' || !PIPE_RE.test(line)) break;
    if (isSeparatorRow(line)) return { row: k - 1, cells: tableCells(previous) };
    previous = line;
  }
  const next = lines[start + 1];
  return typeof next === 'string' && PIPE_RE.test(next) ? { row: start, cells: tableCells(first) } : undefined;
}

/** Positions, croissantes, des barres de tableau d'une ligne (« \| » exclu). */
function pipePositions(line: string): number[] {
  const positions: number[] = [];
  for (let at = line.indexOf('|'); at !== -1; at = line.indexOf('|', at + 1)) {
    if (line[at - 1] !== '\\') positions.push(at);
  }
  return positions;
}

/** Nombre d'éléments de la liste croissante `sorted` strictement inférieurs à `limit` (recherche dichotomique). */
function countBelow(sorted: readonly number[], limit: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < limit) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Rang de la cellule où tombe une position de la ligne de tableau (les barres de bord ne comptent pas). Les barres de la
 * ligne ne sont repérées qu'à la première demande, une seule fois : le coût d'une ligne de millions de barres ne se
 * paie pas à chaque citation.
 */
function cellLocator(line: string): (at: number) => number {
  let pipes: number[] | undefined;
  let edge = 0;
  return at => {
    if (!pipes) {
      pipes = pipePositions(line);
      edge = /^\s*\|/.test(line) ? 1 : 0;
    }
    return countBelow(pipes, at) - edge;
  };
}

/**
 * Citations (entre « », “ ” ou " ") d'un texte hors blocs de code, les `limit` premières ; une ligne aux guillemets droits
 * dépareillés est ignorée. Une citation d'un tableau Markdown garde l'intitulé de sa colonne : l'en-tête est lu une fois
 * par tableau, pas par citation (temps linéaire, même pour un tableau de milliers de lignes).
 */
function quotedSegments(content: string, limit: number): QuotedSegment[] {
  const found: QuotedSegment[] = [];
  const lines = linesOutsideCode(content);
  let inTable = false;
  let header: TableHeader | undefined;
  for (let i = 0; i < lines.length && found.length < limit; i++) {
    const line = lines[i];
    if (line === null || !PIPE_RE.test(line)) {
      inTable = false;
      header = undefined;
    } else if (!inTable) {
      inTable = true;
      header = tableHeaderAt(lines, i);
    }
    if (line === null) continue;
    const columns = header && i > header.row ? header.cells : undefined;
    const cellOf = cellLocator(line);
    let offset = 0;
    line.split(INLINE_CODE_RE).forEach((part, k) => {
      const base = offset;
      offset += part.length;
      if (k % 2 === 1) return;
      const collect = (m: RegExpMatchArray) => {
        if (found.length >= limit || m[1].length > MAX_QUOTE_CHARS) return;
        const start = m.index ?? 0;
        found.push({
          text: m[1],
          before: part.slice(Math.max(0, start - QUOTE_CONTEXT_CHARS), start),
          after: part.slice(start + m[0].length, start + m[0].length + QUOTE_CONTEXT_CHARS),
          column: columns?.[cellOf(base + start)],
        });
      };
      for (const re of [FRENCH_QUOTE_RE, CURLY_QUOTE_RE]) {
        for (const m of part.matchAll(re)) collect(m);
      }
      if ((part.match(/"/g)?.length ?? 0) % 2 === 0) {
        for (const m of part.matchAll(STRAIGHT_QUOTE_RE)) collect(m);
      }
    });
  }
  return found;
}

/**
 * Vrai quand l'en-tête d'une colonne de tableau annonce une correction proposée (« Correction proposée », « Corrigé »,
 * « Forme correcte », « Remplacement »…), pas un extrait de la copie : un intitulé qui désigne aussi la copie (« Avant
 * correction », « Erreur et correction ») n'en est pas un.
 */
function isCorrectionHeader(header: string | undefined): boolean {
  if (header === undefined || header.length > MAX_HEADER_CHARS) return false;
  const form = quoteForm(header);
  return CORRECTION_HEADER_RE.test(form) && !ORIGINAL_HEADER_RE.test(form) && !COPY_HEADER_RE.test(form);
}

/** Vrai quand la citation est la correction proposée (après une flèche ou « correction : », avant « au lieu de », dans une colonne « Correction »…), pas un extrait de la copie. */
function isProposedCorrection({ before, after, column }: QuotedSegment): boolean {
  return ARROW_BEFORE_RE.test(before) || PROPOSAL_BEFORE_RE.test(quoteForm(before)) || REPLACED_AFTER_RE.test(after) || isCorrectionHeader(column);
}

/**
 * Avertissement (texte pour l'enseignant) quand la correction annotée cite, entre guillemets, des passages qui ne figurent
 * pas TELS QUELS dans le travail fourni (`copy`) : un petit modèle reformule ou invente l'extrait qu'il annote. [] si
 * tout est retrouvé ou en cas de doute : citation de moins de 5 mots, extrait coupé par « […] » (chaque morceau d'au moins
 * 3 mots est cherché), texte déjà présent dans `reference` (consignes, sujet de la demande, textes des sources fournies),
 * correction proposée entre guillemets (après « → », « correction proposée : », « on attend », « plutôt »…, suivie de
 * « au lieu de », ou seule dans la colonne d'un tableau dont l'en-tête annonce une correction : « Correction proposée »,
 * « Corrigé », « Forme correcte », « Version améliorée », « Reformulation », « Remplacement », « Attendu », « À écrire » ;
 * les colonnes « Passage », « Extrait », « Citation », « Copie » restent vérifiées, comme un intitulé mixte : « Erreur et
 * correction »), blocs de code ignorés.
 * Jamais bloquant, ne modifie pas le contenu ; accents, majuscules, apostrophes et ponctuation sont indifférents.
 */
export function checkCopyQuotes(content: string, copy: string, reference: readonly (string | undefined)[] = []): string[] {
  if (typeof content !== 'string' || typeof copy !== 'string' || !copy.trim()) return [];
  try {
    const haystack = ` ${quoteForm(copy)} `;
    // Textes de référence normalisés à la première citation introuvable seulement : les sources peuvent être longues.
    let known: string[] | undefined;
    const knownTexts = () => known ??= reference.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map(r => ` ${quoteForm(r)} `);
    const present = (form: string, text: string) => text.includes(` ${form} `);
    let missing = 0;
    for (const segment of quotedSegments(content, MAX_QUOTES_CHECKED)) {
      const whole = quoteForm(segment.text);
      if (wordsOf(whole) < MIN_QUOTE_WORDS) continue;
      const fragments = segment.text.split(ELLIPSIS_RE).map(quoteForm).filter(f => wordsOf(f) >= MIN_FRAGMENT_WORDS);
      if (fragments.length === 0) continue;
      if (fragments.every(f => present(f, haystack))) continue;
      if (isProposedCorrection(segment)) continue;
      if (knownTexts().some(text => present(whole, text))) continue;
      missing++;
    }
    if (missing === 0) return [];
    return [missing === 1
      ? 'Une citation de la copie n’a pas été retrouvée telle quelle dans le travail fourni : vérifiez-la avant de transmettre la correction.'
      : `${missing} citations de la copie n’ont pas été retrouvées telles quelles dans le travail fourni : vérifiez-les avant de transmettre la correction.`];
  } catch {
    // Un contrôle facultatif ne doit jamais empêcher de rendre le contenu.
    return [];
  }
}
