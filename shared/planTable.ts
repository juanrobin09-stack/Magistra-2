// Lecture du tableau des séances d'un plan de séquence (option « plan d'abord » de l'outil Séquence) : numéro, titre et
// objectif de chaque séance. Source unique pour le contrôle du nombre de séances (shared/outputChecks.ts) et pour
// « Développer une séance » (src/lib/generation/plan.ts).
//
// Le texte lu est celui d'un petit modèle : barres initiales ou finales absentes, gras partout, ligne de séparation
// manquante, numéros « 1 », « Séance 1 », « S1 », « 1. »… La lecture est tolérante, jamais approximative : une ligne dont le
// numéro n'est pas sûr (« 1a », « 1h30 », « 1, 3, 5 ») est ignorée, et un texte sans tableau lisible donne une liste vide.
// Un plan peut contenir plusieurs tableaux (objectifs, compétences, chronologie…) : le tableau des séances est le meilleur
// candidat (voir scoreOf), pas le premier venu ; un tableau coupé en deux (séances 1-3 puis 4-6) est relu d'un seul tenant.
//
// Jamais d'exception. Entrée bornée (PLAN_LIMITS), temps linéaire : aucune expression régulière ne parcourt plus d'une
// cellule tronquée, et jamais deux « \s* » ne se suivent (ni quantificateurs imbriqués).
//
// Toute troncature d'un texte du plan passe par safeSlice (ou clipText, qui s'en sert) : jamais au milieu d'une paire de
// substitution UTF-16 (emoji, caractères rares).

/** Bornes de lecture : au-delà, le texte est ignoré (jamais une lenteur ni une liste démesurée). */
export const PLAN_LIMITS = {
  /** Caractères lus du document. */
  chars: 200_000,
  /** Séances lues (les suivantes sont ignorées ; un numéro plus grand n'est pas celui d'une séance). */
  sessions: 60,
  /** Colonnes lues par ligne. */
  columns: 16,
  /** Caractères lus d'une cellule. */
  cell: 600,
  /** Caractères lus d'un en-tête de colonne. */
  header: 80,
  /** Titre conservé d'une séance. */
  title: 200,
  /** Objectif conservé d'une séance. */
  objective: 400,
  /** Ligne du plan conservée (toutes les colonnes d'une séance, en clair). */
  line: 1_500,
  /** Nombre de séances qu'une même ligne peut regrouper (« Séances 3 à 6 »). */
  range: 12,
} as const;

export interface PlanSession {
  /** Numéro de la séance (de la première, si la ligne en regroupe plusieurs). */
  numero: number;
  /** Numéro de la dernière séance quand la ligne en regroupe plusieurs (« Séances 3 et 4 », « 3-4 »), sinon absent. */
  fin?: number;
  /** Titre (« thème » dans le supérieur) ; vide si illisible. */
  titre: string;
  /** Objectif de la ligne ; vide s'il n'y a pas de colonne « objectif » lisible. */
  objectif: string;
  /** Contenu de la colonne « Durée » de la ligne (« 55 min »), absent s'il n'y a pas de telle colonne ou si la cellule est vide. */
  duree?: string;
  /** La ligne du plan en clair, colonne par colonne (« Titre : … ; Activités : … »), hors numéro. */
  ligne: string;
}

/** Nombre de séances qu'une ligne couvre (1, ou davantage pour « Séances 3 et 4 »). */
export function sessionSpan(session: Pick<PlanSession, 'numero' | 'fin'>): number {
  return session.fin === undefined ? 1 : session.fin - session.numero + 1;
}

/** Numéros de séance couverts par ces lignes (chacun une seule fois : « Séances 3 et 4 » en couvrent deux). */
function coveredNumbers(sessions: readonly Pick<PlanSession, 'numero' | 'fin'>[]): Set<number> {
  const covered = new Set<number>();
  for (const session of sessions) {
    for (let n = session.numero; n <= (session.fin ?? session.numero); n++) covered.add(n);
  }
  return covered;
}

/** Nombre de séances que ces lignes couvrent. */
export function countSessions(sessions: readonly Pick<PlanSession, 'numero' | 'fin'>[]): number {
  return coveredNumbers(sessions).size;
}

/** Longueur de la suite de séances 1, 2, 3… que ces lignes couvrent sans trou (0 si la séance 1 manque). */
export function leadingRun(sessions: readonly Pick<PlanSession, 'numero' | 'fin'>[]): number {
  const covered = coveredNumbers(sessions);
  let run = 0;
  while (covered.has(run + 1)) run++;
  return run;
}

// ─── Troncature sûre ────────────────────────────────────────────────────────

/**
 * Début du texte, de `max` caractères au plus, jamais coupé au milieu d'une paire de substitution (« 😀 » = deux unités) :
 * une demi-paire n'est pas un texte valide (JSON refusé par certains fournisseurs d'IA, U+FFFD après un aller-retour UTF-8).
 */
export function safeSlice(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = Math.max(0, max);
  const last = end > 0 ? text.charCodeAt(end - 1) : 0;
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/**
 * Extrait `text[from, to[` dont aucune extrémité ne coupe une paire de substitution : une demi-paire de tête est écartée,
 * une demi-paire de fin aussi (un contexte lu autour d'une citation, par exemple).
 */
export function safeSpan(text: string, from: number, to: number): string {
  let start = Math.max(0, from);
  let end = Math.min(text.length, to);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start)) && isHighSurrogate(text.charCodeAt(start - 1))) start++;
  if (end < text.length && end > start && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end--;
  return start < end ? text.slice(start, end) : '';
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;
/** Demi-paire de substitution : une unité haute sans basse après elle, ou une basse sans haute avant elle. */
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * Texte sans demi-paire de substitution (flux du modèle coupé au milieu d'un emoji) : une paire complète est conservée,
 * comme le fait la validation d'une demande (stripControlChars). Temps linéaire.
 */
export function stripLoneSurrogates(text: string): string {
  return text.replace(LONE_SURROGATE_RE, '');
}

/**
 * Texte tronqué à `max` caractères au dernier espace, suivi de « … » (le résultat ne dépasse jamais `max`) ; un texte
 * assez court est rendu tel quel. Jamais au milieu d'une paire de substitution (safeSlice).
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = safeSlice(text, Math.max(0, max - 1));
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  let end = cut.length;
  while (end > 0 && ' .,;:!?(-–—'.includes(cut[end - 1])) end--;
  if (end > 0 && cut.charCodeAt(end - 1) >= 0xd800 && cut.charCodeAt(end - 1) <= 0xdbff) end--;
  return `${cut.slice(0, end)}…`;
}

/** Ponctuation de fin de phrase (et espaces) : « . », « ! », « ? », « … », « ; », « : ». */
const END_PUNCTUATION = /[\s.!?…;:]/u;

/** Texte sans la ponctuation finale ni les espaces de fin (assemblé ensuite par un séparateur : jamais de ponctuation doublée). */
export function stripEndPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && END_PUNCTUATION.test(text[end - 1])) end--;
  return text.slice(0, end);
}

// ─── Cellules et lignes ─────────────────────────────────────────────────────

/** Minuscules, sans accents (« Séance » → « seance »). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Texte d'une cellule sans mise en forme Markdown ni retour à la ligne HTML, espaces réduits. */
function plainCell(raw: string): string {
  return safeSlice(raw, PLAN_LIMITS.cell)
    .replace(/<br\s?\/?>/gi, ' ')
    .replace(/\\\|/g, '|')
    .replace(/\*+|`+|~~/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cellules d'une ligne de tableau (barres initiale et finale facultatives, « \| » = une barre ordinaire). */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).slice(0, PLAN_LIMITS.columns).map(plainCell);
}

/** Ligne de séparation d'un tableau (« --- », « :---: ») : toutes les cellules. */
function isSeparator(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
}

/** En-tête de colonne numérotée sans ambiguïté : « N° », « No », « Numéro », « # ». */
function isNumberHeader(folded: string): boolean {
  return folded.includes('numero') || /(?:^|[^a-z])n[°º˚]/.test(folded) || /^(?:n|no|num)\.?$/.test(folded) || folded === '#';
}

/** En-tête de colonne qui renvoie à des séances sans en être la liste (« Séances concernées », « Séances associées », « Séances liées »). */
const REFERENCE_HEADER_RE = /concern|associe|(?:^|[^a-z])lie(?:e|es|s)?(?![a-z])/;

/** Colonnes qui portent le numéro, par ordre de préférence : en-têtes numérotés, puis en-têtes « séance ». */
function numberColumns(headers: readonly string[]): number[] {
  const folded = headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header)));
  const strong: number[] = [];
  const weak: number[] = [];
  folded.forEach((h, i) => {
    if (REFERENCE_HEADER_RE.test(h)) return;
    if (isNumberHeader(h)) strong.push(i);
    else if (h.includes('seance')) weak.push(i);
  });
  return [...strong, ...weak].slice(0, 3);
}

/**
 * Numéro en tête d'une cellule : « 1 », « Séance 1 », « séance n° 1 », « S1 », « 1. », « 1/6 », « 1ère séance »,
 * « Séances 3 et 4 », « 3-4 ». Jamais un numéro suivi de lettres ou de chiffres (« 1a », « 1h30 », « 12,5 »).
 */
const NUMBER_RE = /^(?:(?:s[ée]ances?|s[ée]?)\.? ?)?(?:(?:n[°º˚]|no|num[ée]ro) ?)?(\d{1,3})(?!\d)(?:(?:[èe]re|er|re|[èe]me|e)(?![\p{L}\d]))?(?![\p{L}])(?![,.]\d)/iu;
/** Total après le numéro (« 1/6 »). */
const OF_TOTAL_RE = /^ ?\/ ?\d{1,3}(?![\p{L}\d])/u;
/**
 * Seconde séance d'une ligne qui en regroupe plusieurs (« 3 et 4 », « 3-4 », « 3 à 4 »), suivie d'un séparateur ou de la
 * fin (« 2 - 3 activités » n'en est pas une). Le connecteur est capturé : « et » ne relie que deux séances qui se suivent.
 */
const RANGE_RE = /^ ?(à|et|[-–—]) ?(\d{1,3})(?!\d)(?= ?(?:$|[:.)\-–—,;/]))/iu;
/** Séparateurs entre le numéro et le titre (« 1 : Titre », « 1. Titre », « 1 - Titre »). */
const LEADING_SEPARATORS_RE = /^[\s:.)\-–—,;/]+/;
/** Séparateur qui annonce un titre : ce qui suit en est un, même fait de chiffres seuls (« Séance 1 : 12 »). */
const TITLE_SEPARATOR_RE = /[:.)\-–—]/;

interface NumberedCell {
  numero: number;
  fin?: number;
  /** Ce qui suit le numéro dans la cellule (titre possible), sans séparateur. */
  rest: string;
  /** Le reste n'est que d'autres numéros qui ne se suivent pas (« 1, 3, 5 », « 1-2 ; 3-4 ») : une liste de renvois, pas une séance. */
  list: boolean;
}

/** Reste de cellule composé seulement de numéros et de liens (« 3, 5 », « 3-4 », « 3 et 5 ») : au moins un numéro. */
function isNumberList(tail: string): boolean {
  let numbers = 0;
  for (const token of tail.split(/[\s,;/\-–—]+/)) {
    if (token === '') continue;
    if (/^\d{1,3}$/.test(token)) numbers++;
    else if (!/^(?:et|à|a)$/i.test(token)) return false;
  }
  return numbers > 0;
}

/** Numéros qui suivent le premier dans une suite simple (« , 2 et 3 »), ni étendue ni titre ; null si le reste n'est pas une telle suite. */
function followingNumbers(tail: string): number[] | null {
  const next = /\s*(?:[,;]|et(?=\s))\s*(\d{1,3})(?!\d)/y;
  const numbers: number[] = [];
  let end = 0;
  for (let found = next.exec(tail); found && numbers.length <= PLAN_LIMITS.sessions; found = next.exec(tail)) {
    numbers.push(Number(found[1]));
    end = next.lastIndex;
  }
  return numbers.length > 0 && numbers.length <= PLAN_LIMITS.sessions && tail.slice(end).trim() === '' ? numbers : null;
}

function readNumber(cell: string): NumberedCell | null {
  const head = safeSlice(cell, 120);
  const match = NUMBER_RE.exec(head);
  if (!match) return null;
  const numero = Number(match[1]);
  if (!Number.isInteger(numero) || numero < 1) return null;
  let rest = head.slice(match[0].length);
  const total = OF_TOTAL_RE.exec(rest);
  if (total) rest = rest.slice(total[0].length);
  // Plusieurs numéros qui se suivent (« Séances 1, 2 et 3 », « 3, 4, 5 ») : une ligne qui regroupe ces séances. Qui ne se
  // suivent pas (« 1, 3, 5 ») : un renvoi à des séances, pas une séance.
  const following = followingNumbers(cell.slice(head.length - rest.length));
  if (following) {
    const all = [numero, ...following];
    const consecutive = all.every((n, i) => i === 0 || n === all[i - 1] + 1);
    return consecutive && all.length <= PLAN_LIMITS.range
      ? { numero, fin: all[all.length - 1], rest: '', list: false }
      : { numero, rest: '', list: true };
  }
  let fin: number | undefined;
  const range = RANGE_RE.exec(rest);
  if (range) {
    const to = Number(range[2]);
    const adjacent = to === numero + 1;
    if (to > numero && to - numero + 1 <= PLAN_LIMITS.range && (adjacent || range[1].toLowerCase() !== 'et')) {
      fin = to;
      rest = rest.slice(range[0].length);
    }
  }
  // Le reste de la cellule complet (la tête lue ne sert qu'à repérer le numéro), sans séparateur ni mot « séance » seul.
  const tail = cell.slice(head.length - rest.length);
  const lead = LEADING_SEPARATORS_RE.exec(tail)?.[0] ?? '';
  const body = tail.slice(lead.length);
  return {
    numero,
    ...(fin !== undefined ? { fin } : {}),
    rest: /^s[ée]ances?$/i.test(body) ? '' : body,
    // Jamais une liste quand un « : » ou un tiret annonce un titre (« Séance 1 : 12 » : la séance 1 s'intitule « 12 »).
    list: !TITLE_SEPARATOR_RE.test(lead) && isNumberList(body),
  };
}

/** Valeur sans contenu (« — », « - », « n/a ») : traitée comme une cellule vide. */
function isBlank(value: string): boolean {
  return value === '' || /^(?:[-–—.…]+|n\/?a|néant)$/i.test(value);
}

/** En-tête d'une colonne qui n'est pas celle du titre (texte déjà sans accents ni majuscules). */
const NOT_A_TITLE_RE = /objectif|duree|temps|activit|evaluation|format|materiel|organisation|travail|modalit|competence|support/;
/** En-tête d'une colonne de titre (texte déjà sans accents ni majuscules). */
const TITLE_HEADER_RE = /titre|theme|thematique|intitule|sujet/;
/** En-tête de la colonne de durée (texte déjà sans accents ni majuscules). */
const DURATION_HEADER_RE = /duree|^temps(?![a-z])/;
/** Cellule de texte (et non un nombre, une date, un tiret) : au moins trois lettres de suite. */
const TEXT_CELL_RE = /\p{L}{3}/u;

/** Remplissage d'une colonne : cellules non vides, et parmi elles celles qui sont du texte. */
interface ColumnFill {
  filled: number;
  text: number;
}

interface ReadRows {
  sessions: PlanSession[];
  /** Lignes écartées parce que leur numéro est une liste de renvois (« 1, 3, 5 »). */
  lists: number;
  /** Remplissage de chaque colonne (celle du numéro comprise, jamais comptée). */
  columns: ColumnFill[];
}

/** Durée d'une cellule « Durée » : le texte seul (« 55 min »), une durée sans unité sous un en-tête « minutes » prend « min ». */
function durationText(cell: string, folded: string): string {
  const text = clipText(stripEndPunctuation(cell), 80);
  return /^\d{1,3}$/.test(text) && /(?:^|[^a-z])min/.test(folded) ? `${text} min` : text;
}

/** Séances lues dans les lignes d'un tableau dont la colonne `numberCol` porte le numéro. */
function readRows(headers: readonly string[], rows: readonly string[], numberCol: number): ReadRows {
  const folded = headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header)));
  const titleCol = folded.findIndex((h, i) => i !== numberCol && TITLE_HEADER_RE.test(h));
  // Sans colonne « titre » : celle qui suit le numéro (« numéro | séance | … »), sauf si elle en dit autre chose (objectif,
  // durée…) ; sinon le titre est dans la cellule du numéro (« Séance 1 : Titre »).
  const next = numberCol + 1 < headers.length ? numberCol + 1 : -1;
  const fallbackTitleCol = titleCol >= 0 ? titleCol : next >= 0 && !NOT_A_TITLE_RE.test(folded[next]) ? next : -1;
  const objectiveCol = folded.findIndex((h, i) => i !== numberCol && h.includes('objectif'));
  const durationCol = folded.findIndex((h, i) => i !== numberCol && DURATION_HEADER_RE.test(h));
  const sessions: PlanSession[] = [];
  const columns: ColumnFill[] = headers.map(() => ({ filled: 0, text: 0 }));
  const seen = new Set<number>();
  let lists = 0;
  for (const row of rows) {
    if (sessions.length >= PLAN_LIMITS.sessions) break;
    const cells = splitRow(row);
    const numbered = readNumber(cells[numberCol] ?? '');
    if (!numbered) continue;
    if (numbered.list) {
      lists++;
      continue;
    }
    // Numéro qui n'est pas celui d'une séance (« 365 ») : ligne ignorée, jamais un total démesuré (« séance 2 sur 365 »).
    if ((numbered.fin ?? numbered.numero) > PLAN_LIMITS.sessions || seen.has(numbered.numero)) continue;
    seen.add(numbered.numero);
    const cellTitle = fallbackTitleCol >= 0 ? cells[fallbackTitleCol] ?? '' : '';
    const cellObjective = objectiveCol >= 0 ? cells[objectiveCol] ?? '' : '';
    const cellDuration = durationCol >= 0 ? cells[durationCol] ?? '' : '';
    const objectif = isBlank(cellObjective) ? '' : clipText(cellObjective, PLAN_LIMITS.objective);
    const duree = isBlank(cellDuration) ? '' : durationText(cellDuration, folded[durationCol]);
    // Sans titre lisible (tableau « séance | objectif | activités »), l'objectif tient lieu de titre dans la liste.
    const titre = clipText(isBlank(cellTitle) ? numbered.rest || objectif : cellTitle, PLAN_LIMITS.title);
    // Chaque colonne sans sa ponctuation finale : la ligne est assemblée par « ; » (jamais « gazeux. ; Savoir »).
    const parts: string[] = [];
    cells.forEach((value, i) => {
      if (i === numberCol || isBlank(value)) return;
      const column = columns[i];
      if (column) {
        column.filled++;
        if (TEXT_CELL_RE.test(value)) column.text++;
      }
      const text = stripEndPunctuation(value);
      if (!text) return;
      const label = safeSlice(headers[i] ?? '', 40);
      parts.push(label ? `${label} : ${clipText(text, 300)}` : clipText(text, 300));
    });
    // Le titre venu du numéro (« Séance 1 : Titre ») n'a pas de colonne : il ouvre la ligne.
    const own = stripEndPunctuation(numbered.rest);
    if (isBlank(cellTitle) && own) parts.unshift(`Titre : ${clipText(own, 300)}`);
    sessions.push({
      numero: numbered.numero,
      ...(numbered.fin !== undefined ? { fin: numbered.fin } : {}),
      titre,
      objectif,
      ...(duree ? { duree } : {}),
      ligne: clipText(parts.join(' ; '), PLAN_LIMITS.line),
    });
  }
  return { sessions, lists, columns };
}

// ─── Choix du tableau des séances ───────────────────────────────────────────

/** Un tableau lu, avec de quoi le comparer aux autres tableaux du même plan. */
interface Candidate {
  headers: string[];
  /** En-têtes sans accents ni majuscules, jointes : deux tableaux de même forme ont la même signature. */
  signature: string;
  numberCol: number;
  sessions: PlanSession[];
  columns: ColumnFill[];
  /** Première et dernière ligne du tableau dans le texte. */
  start: number;
  end: number;
}

/**
 * Colonnes d'un plan de séquence (texte déjà sans accents ni majuscules) : titre, thème, objectif, activités, durée,
 * évaluation, organisation… Une colonne de texte hors de cette liste compte aussi, à un niveau plus faible (voir scoreOf) :
 * la liste ne ferme pas la porte à un en-tête inattendu.
 */
const PLAN_COLUMN_RE = new RegExp([
  'titre', 'theme', 'thematique', 'intitule', 'sujet', 'objectif', 'activit', 'contenu', 'deroul', 'duree', 'evaluation', 'organisation',
  'format', 'travail', 'support', 'notion', 'question', 'problematique', 'competence', 'description', 'etape', 'phase', 'capacite',
  'materiel', 'modalite', 'demarche', 'ressource', 'consigne', 'differenciation', 'prerequis', '^temps(?![a-z])',
].join('|'));

/** Poids d'une colonne de plan reconnue dans la richesse d'un tableau, devant celui d'une colonne de texte quelconque (voir scoreOf). */
const COLUMN_POINTS = 4;

/**
 * Critères d'un tableau, du plus important au moins important (plus grand = meilleur) :
 *  1. le nombre de séances demandé est connu, la suite de séances 1…n du tableau lui est exactement égale, et le tableau
 *     nomme ses séances (colonne de titre, de thème, d'intitulé, de sujet, ou en-tête « Séance ») : un tableau « N° | Objectif »
 *     de six objectifs n'est pas le tableau de six séances, même si six séances ont été demandées ;
 *  2. la richesse, en points : colonnes de plan reconnues (titre, objectif, activités, durée… ; au plus quatre), plus une
 *     colonne si le numéro est dans la première colonne (la consigne de l'outil le demande), plus deux si l'en-tête de cette
 *     colonne est « Séance » (à partir de trois séances lues, ou si leur nombre est celui qui est demandé : un tableau
 *     « Séance | Évaluation » de deux lignes est un rappel, pas le plan), plus un point par colonne de texte non reconnue
 *     (au plus trois) : un tableau « N° | Objectif » (objectifs numérotés) ou « N° | Événement » (chronologie) est moins
 *     riche que le tableau « Séance | Titre | Objectif… » ;
 *  3. la plus longue suite de séances 1…n ;
 *  4. le plus de séances lues ;
 *  5. une vraie colonne de titre plutôt que seulement des objectifs ou des activités.
 * À égalité, le premier tableau du texte.
 */
function scoreOf(candidate: Candidate, requested: number | undefined): number[] {
  const folded = candidate.headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header)));
  let known = 0;
  let weak = 0;
  folded.forEach((h, i) => {
    if (i === candidate.numberCol) return;
    if (PLAN_COLUMN_RE.test(h)) known++;
    else {
      const fill = candidate.columns[i];
      if (fill && fill.filled > 0 && fill.text * 2 >= fill.filled) weak++;
    }
  });
  const covered = coveredNumbers(candidate.sessions);
  const run = leadingRun(candidate.sessions);
  const first = candidate.numberCol === 0;
  const exact = requested !== undefined && run === requested;
  const seance = first && folded[0].includes('seance') && (covered.size >= 3 || exact);
  const titled = folded.some((h, i) => i !== candidate.numberCol && TITLE_HEADER_RE.test(h));
  const richness = (Math.min(4, known) + (first ? 1 : 0) + (seance ? 2 : 0)) * COLUMN_POINTS + Math.min(3, weak);
  return [exact && (titled || seance) ? 1 : 0, richness, run, covered.size, titled ? 1 : 0];
}

/** `a` est-il strictement meilleur que `b` ? (comparaison critère par critère) */
function betterScore(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Séances d'un tableau (lignes consécutives contenant des barres), ou null si ce n'est pas un tableau de séances. */
function readTable(rows: readonly string[], start: number): Candidate | null {
  const headers = splitRow(rows[0]);
  if (headers.length < 2) return null;
  const separated = rows.length > 1 && isSeparator(splitRow(rows[1]));
  // Sans ligne de séparation, seules des barres de bordure disent que c'est un tableau (et non une phrase avec « | »).
  if (!separated && !rows[0].trim().startsWith('|')) return null;
  const columns = numberColumns(headers);
  if (columns.length === 0) return null;
  const body = rows.slice(separated ? 2 : 1);
  for (const column of columns) {
    const read = readRows(headers, body, column);
    // Colonne de renvois (« Séances | 1, 3, 5 », « 1-2 ; 3-4 ») : pas le tableau des séances.
    if (read.sessions.length === 0 || read.lists >= read.sessions.length) continue;
    return {
      headers,
      signature: headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header))).join('|'),
      numberCol: column,
      sessions: read.sessions,
      columns: read.columns,
      start,
      end: start + rows.length - 1,
    };
  }
  return null;
}

/** Lignes de texte au plus entre deux parties d'un même tableau coupé (« Suite du tableau », titre de section). */
const SPLIT_GAP_LINES = 6;

/** Dernier numéro de séance couvert par les lignes du tableau. */
function lastNumber(candidate: Candidate): number {
  const last = candidate.sessions[candidate.sessions.length - 1];
  return last.fin ?? last.numero;
}

/**
 * Tableaux voisins de même forme (mêmes en-têtes, même colonne de numéro) dont le second reprend la numérotation du premier
 * (séances 1-3, puis 4-6) : un plan coupé en deux tableaux est lu d'un seul tenant.
 */
function mergeSplitTables(found: readonly Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const table of found) {
    const previous = merged[merged.length - 1];
    if (
      previous && previous.sessions.length < PLAN_LIMITS.sessions && previous.signature === table.signature && previous.numberCol === table.numberCol
      && table.start - previous.end - 1 <= SPLIT_GAP_LINES && table.sessions[0].numero === lastNumber(previous) + 1
    ) {
      merged[merged.length - 1] = {
        ...previous,
        sessions: [...previous.sessions, ...table.sessions].slice(0, PLAN_LIMITS.sessions),
        columns: previous.columns.map((fill, i) => ({ filled: fill.filled + (table.columns[i]?.filled ?? 0), text: fill.text + (table.columns[i]?.text ?? 0) })),
        end: table.end,
      };
    } else {
      merged.push(table);
    }
  }
  return merged;
}

/**
 * Séances du tableau d'un plan : parmi les tableaux dont l'en-tête annonce un numéro de séance (« Séance », « N° »,
 * « Numéro ») et dont au moins une ligne en porte un, le tableau des séances (voir scoreOf : pas forcément le premier du
 * texte ; deux tableaux qui se suivent et dont la numérotation continue n'en font qu'un). `requested` : nombre de séances
 * demandé, s'il l'a été. Dans l'ordre du tableau, au plus PLAN_LIMITS.sessions, numéros de 1 à PLAN_LIMITS.sessions. Liste
 * vide si le texte n'a pas de tel tableau (ou n'est pas un texte) : jamais d'exception.
 */
export function readPlanTable(markdown: unknown, requested?: number): PlanSession[] {
  try {
    if (typeof markdown !== 'string' || markdown === '') return [];
    const wanted = typeof requested === 'number' && Number.isInteger(requested) && requested >= 1 && requested <= PLAN_LIMITS.sessions
      ? requested
      : undefined;
    // Demi-paire de substitution d'un flux coupé : retirée dès l'entrée, elle ne traverse pas jusqu'au formulaire.
    const lines = stripLoneSurrogates(safeSlice(markdown, PLAN_LIMITS.chars)).split('\n');
    const found: Candidate[] = [];
    let start = -1;
    for (let i = 0; i <= lines.length; i++) {
      const inTable = i < lines.length && lines[i].includes('|');
      if (inTable) {
        if (start < 0) start = i;
        continue;
      }
      if (start >= 0) {
        const table = readTable(lines.slice(start, i), start);
        if (table) found.push(table);
        start = -1;
      }
    }
    let best: Candidate | null = null;
    let bestScore: number[] = [];
    for (const table of mergeSplitTables(found)) {
      const score = scoreOf(table, wanted);
      if (!best || betterScore(score, bestScore)) {
        best = table;
        bestScore = score;
      }
    }
    return best ? best.sessions : [];
  } catch {
    return [];
  }
}
