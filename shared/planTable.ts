// Lecture du tableau des séances d'un plan de séquence (option « plan d'abord » de l'outil Séquence) : numéro, titre et
// objectif de chaque séance. Source unique pour le contrôle du nombre de séances (shared/outputChecks.ts) et pour
// « Développer une séance » (src/lib/generation/plan.ts).
//
// Le texte lu est celui d'un petit modèle : barres initiales ou finales absentes, gras partout, ligne de séparation
// manquante, numéros « 1 », « Séance 1 », « S1 », « 1. »… La lecture est tolérante, jamais approximative : une ligne dont le
// numéro n'est pas sûr (« 1a », « 1h30 », « 1, 3, 5 ») est ignorée, et un texte sans tableau lisible donne une liste vide.
// Un plan peut contenir plusieurs tableaux (objectifs, compétences, chronologie…) : le tableau des séances est le meilleur
// candidat (voir betterCandidate), pas le premier venu.
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

/** En-tête de colonne qui renvoie à des séances sans en être la liste (« Séances concernées », « Séances associées »). */
const REFERENCE_HEADER_RE = /concern|associe/;

/** Colonnes qui portent le numéro, par ordre de préférence : en-têtes numérotés, puis en-têtes « séance ». */
function numberColumns(headers: readonly string[]): number[] {
  const folded = headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header)));
  const strong: number[] = [];
  const weak: number[] = [];
  folded.forEach((h, i) => {
    if (isNumberHeader(h)) strong.push(i);
    else if (h.includes('seance') && !REFERENCE_HEADER_RE.test(h)) weak.push(i);
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

interface NumberedCell {
  numero: number;
  fin?: number;
  /** Ce qui suit le numéro dans la cellule (titre possible), sans séparateur. */
  rest: string;
  /** Le reste n'est que d'autres numéros (« 1, 3, 5 », « 1-2 ; 3-4 ») : une liste de renvois, pas une séance. */
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

function readNumber(cell: string): NumberedCell | null {
  const head = safeSlice(cell, 120);
  const match = NUMBER_RE.exec(head);
  if (!match) return null;
  const numero = Number(match[1]);
  if (!Number.isInteger(numero) || numero < 1) return null;
  let rest = head.slice(match[0].length);
  const total = OF_TOTAL_RE.exec(rest);
  if (total) rest = rest.slice(total[0].length);
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
  const tail = cell.slice(head.length - rest.length).replace(LEADING_SEPARATORS_RE, '');
  return {
    numero,
    ...(fin !== undefined ? { fin } : {}),
    rest: /^s[ée]ances?$/i.test(tail) ? '' : tail,
    list: isNumberList(tail),
  };
}

/** Valeur sans contenu (« — », « - », « n/a ») : traitée comme une cellule vide. */
function isBlank(value: string): boolean {
  return value === '' || /^(?:[-–—.…]+|n\/?a|néant)$/i.test(value);
}

/** En-tête d'une colonne qui n'est pas celle du titre (texte déjà sans accents ni majuscules). */
const NOT_A_TITLE_RE = /objectif|duree|temps|activit|evaluation|format|materiel|organisation|contenu|travail|modalit|competence|support/;
/** En-tête d'une colonne de titre (texte déjà sans accents ni majuscules). */
const TITLE_HEADER_RE = /titre|theme|intitule|sujet/;
/** En-tête d'une colonne qui décrit ce qui se fait pendant la séance, sans en être le titre. */
const CONTENT_HEADER_RE = /objectif|activit|contenu|deroul/;

interface ReadRows {
  sessions: PlanSession[];
  /** Lignes écartées parce que leur numéro est une liste de numéros (« 1, 3, 5 »). */
  lists: number;
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
  const sessions: PlanSession[] = [];
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
    const objectif = isBlank(cellObjective) ? '' : clipText(cellObjective, PLAN_LIMITS.objective);
    // Sans titre lisible (tableau « séance | objectif | activités »), l'objectif tient lieu de titre dans la liste.
    const titre = clipText(isBlank(cellTitle) ? numbered.rest || objectif : cellTitle, PLAN_LIMITS.title);
    // Chaque colonne sans sa ponctuation finale : la ligne est assemblée par « ; » (jamais « gazeux. ; Savoir »).
    const parts: string[] = [];
    cells.forEach((value, i) => {
      if (i === numberCol || isBlank(value)) return;
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
      ligne: clipText(parts.join(' ; '), PLAN_LIMITS.line),
    });
  }
  return { sessions, lists };
}

// ─── Choix du tableau des séances ───────────────────────────────────────────

/** Un tableau lu, avec de quoi le comparer aux autres tableaux du même plan. */
interface Candidate {
  sessions: PlanSession[];
  /** Critères, du plus important au moins important (voir scoreOf) : plus grand = meilleur. */
  score: number[];
}

/**
 * Critères d'un tableau, du plus important au moins important :
 *  1. en-tête fort (numéro dans la première colonne, ou intitulé « N° », « Numéro ») ET colonne de titre, de thème,
 *     d'objectif ou d'activités : un tableau « N° | Événement » (chronologie) n'est pas un plan ;
 *  2. autant de lignes consécutives à partir de 1 que de séances demandées ;
 *  3. le plus de séances numérotées consécutivement à partir de 1 (un tableau « N° | Objectif » de trois objectifs, placé
 *     avant le tableau synoptique de six séances, ne le remplace pas) ;
 *  4. le plus de séances lues ; 5. une vraie colonne de titre plutôt que seulement des objectifs.
 * À égalité, le premier tableau du texte.
 */
function scoreOf(headers: readonly string[], numberCol: number, sessions: readonly PlanSession[], requested: number | undefined): number[] {
  const folded = headers.map(h => fold(safeSlice(h, PLAN_LIMITS.header)));
  const strong = numberCol === 0 || isNumberHeader(folded[numberCol]);
  const others = folded.filter((_, i) => i !== numberCol);
  const titled = others.some(h => TITLE_HEADER_RE.test(h)) ? 2 : others.some(h => CONTENT_HEADER_RE.test(h)) ? 1 : 0;
  const covered = coveredNumbers(sessions);
  let run = 0;
  while (covered.has(run + 1)) run++;
  return [strong && titled > 0 ? 1 : 0, requested !== undefined && run === requested ? 1 : 0, run, covered.size, titled];
}

/** `a` est-il strictement meilleur que `b` ? (comparaison critère par critère) */
function betterCandidate(a: Candidate, b: Candidate): boolean {
  for (let i = 0; i < a.score.length; i++) {
    if (a.score[i] !== b.score[i]) return a.score[i] > b.score[i];
  }
  return false;
}

/** Séances d'un tableau (lignes consécutives contenant des barres), ou null si ce n'est pas un tableau de séances. */
function readTable(rows: readonly string[], requested: number | undefined): Candidate | null {
  const headers = splitRow(rows[0]);
  if (headers.length < 2) return null;
  const separated = rows.length > 1 && isSeparator(splitRow(rows[1]));
  // Sans ligne de séparation, seules des barres de bordure disent que c'est un tableau (et non une phrase avec « | »).
  if (!separated && !rows[0].trim().startsWith('|')) return null;
  const columns = numberColumns(headers);
  if (columns.length === 0) return null;
  const body = rows.slice(separated ? 2 : 1);
  for (const column of columns) {
    const { sessions, lists } = readRows(headers, body, column);
    // Colonne de renvois (« Compétence | Séances concernées » : « 1, 3 », « 1-2 ; 3-4 ») : pas le tableau des séances.
    if (sessions.length === 0 || lists >= sessions.length) continue;
    return { sessions, score: scoreOf(headers, column, sessions, requested) };
  }
  return null;
}

/**
 * Séances du tableau d'un plan : parmi les tableaux dont l'en-tête annonce un numéro de séance (« Séance », « N° »,
 * « Numéro ») et dont au moins une ligne en porte un, le tableau des séances (voir scoreOf : pas forcément le premier du
 * texte). `requested` : nombre de séances demandé, s'il l'a été. Dans l'ordre du tableau, au plus PLAN_LIMITS.sessions,
 * numéros de 1 à PLAN_LIMITS.sessions. Liste vide si le texte n'a pas de tel tableau (ou n'est pas un texte) : jamais
 * d'exception.
 */
export function readPlanTable(markdown: unknown, requested?: number): PlanSession[] {
  try {
    if (typeof markdown !== 'string' || markdown === '') return [];
    const wanted = typeof requested === 'number' && Number.isInteger(requested) && requested >= 1 && requested <= PLAN_LIMITS.sessions
      ? requested
      : undefined;
    const lines = safeSlice(markdown, PLAN_LIMITS.chars).split('\n');
    let best: Candidate | null = null;
    let start = -1;
    for (let i = 0; i <= lines.length; i++) {
      const inTable = i < lines.length && lines[i].includes('|');
      if (inTable) {
        if (start < 0) start = i;
        continue;
      }
      if (start >= 0) {
        const found = readTable(lines.slice(start, i), wanted);
        if (found && (!best || betterCandidate(found, best))) best = found;
        start = -1;
      }
    }
    return best ? best.sessions : [];
  } catch {
    return [];
  }
}
