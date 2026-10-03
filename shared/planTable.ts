// Lecture du tableau des séances d'un plan de séquence (option « plan d'abord » de l'outil Séquence) : numéro, titre et
// objectif de chaque séance. Source unique pour le contrôle du nombre de séances (shared/outputChecks.ts) et pour
// « Développer une séance » (src/lib/generation/plan.ts).
//
// Le texte lu est celui d'un petit modèle : barres initiales ou finales absentes, gras partout, ligne de séparation
// manquante, numéros « 1 », « Séance 1 », « S1 », « 1. »… La lecture est tolérante, jamais approximative : une ligne dont le
// numéro n'est pas sûr (« 1a », « 1h30 ») est ignorée, et un texte sans tableau lisible donne une liste vide.
//
// Jamais d'exception. Entrée bornée (PLAN_LIMITS), temps linéaire : aucune expression régulière ne parcourt plus d'une
// cellule tronquée, et jamais deux « \s* » ne se suivent (ni quantificateurs imbriqués).

/** Bornes de lecture : au-delà, le texte est ignoré (jamais une lenteur ni une liste démesurée). */
export const PLAN_LIMITS = {
  /** Caractères lus du document. */
  chars: 200_000,
  /** Séances lues (les suivantes sont ignorées). */
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

/** Minuscules, sans accents (« Séance » → « seance »). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Texte d'une cellule sans mise en forme Markdown ni retour à la ligne HTML, espaces réduits. */
function plainCell(raw: string): string {
  return raw
    .slice(0, PLAN_LIMITS.cell)
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

/** Colonnes qui portent le numéro, par ordre de préférence : en-têtes numérotés, puis en-têtes « séance ». */
function numberColumns(headers: readonly string[]): number[] {
  const folded = headers.map(h => fold(h.slice(0, PLAN_LIMITS.header)));
  const strong: number[] = [];
  const weak: number[] = [];
  folded.forEach((h, i) => {
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
/** Seconde séance d'une ligne qui en regroupe plusieurs (« 3 et 4 », « 3-4 », « 3 à 4 »), suivie d'un séparateur ou de la fin (« 2 - 3 activités » n'en est pas une). */
const RANGE_RE = /^ ?(?:à|et|[-–—]) ?(\d{1,3})(?!\d)(?= ?(?:$|[:.)\-–—,;/]))/iu;
/** Séparateurs entre le numéro et le titre (« 1 : Titre », « 1. Titre », « 1 - Titre »). */
const LEADING_SEPARATORS_RE = /^[\s:.)\-–—,;/]+/;

interface NumberedCell {
  numero: number;
  fin?: number;
  /** Ce qui suit le numéro dans la cellule (titre possible), sans séparateur. */
  rest: string;
}

function readNumber(cell: string): NumberedCell | null {
  const head = cell.slice(0, 120);
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
    const to = Number(range[1]);
    if (to > numero && to - numero + 1 <= PLAN_LIMITS.range) {
      fin = to;
      rest = rest.slice(range[0].length);
    }
  }
  // Le reste de la cellule complet (la tête lue ne sert qu'à repérer le numéro), sans séparateur ni mot « séance » seul.
  const tail = cell.slice(head.length - rest.length).replace(LEADING_SEPARATORS_RE, '');
  return { numero, ...(fin !== undefined ? { fin } : {}), rest: /^s[ée]ances?$/i.test(tail) ? '' : tail };
}

/** Valeur sans contenu (« — », « - », « n/a ») : traitée comme une cellule vide. */
function isBlank(value: string): boolean {
  return value === '' || /^(?:[-–—.…]+|n\/?a|néant)$/i.test(value);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** En-tête d'une colonne qui n'est pas celle du titre (texte déjà sans accents ni majuscules). */
const NOT_A_TITLE_RE = /objectif|duree|temps|activit|evaluation|format|materiel|organisation|contenu|travail|modalit|competence|support/;

/** Séances lues dans les lignes d'un tableau dont la colonne `numberCol` porte le numéro. */
function readRows(headers: readonly string[], rows: readonly string[], numberCol: number): PlanSession[] {
  const folded = headers.map(h => fold(h.slice(0, PLAN_LIMITS.header)));
  const titleCol = folded.findIndex((h, i) => i !== numberCol && /titre|theme|intitule|sujet/.test(h));
  // Sans colonne « titre » : celle qui suit le numéro (« numéro | séance | … »), sauf si elle en dit autre chose (objectif,
  // durée…) ; sinon le titre est dans la cellule du numéro (« Séance 1 : Titre »).
  const next = numberCol + 1 < headers.length ? numberCol + 1 : -1;
  const fallbackTitleCol = titleCol >= 0 ? titleCol : next >= 0 && !NOT_A_TITLE_RE.test(folded[next]) ? next : -1;
  const objectiveCol = folded.findIndex((h, i) => i !== numberCol && h.includes('objectif'));
  const sessions: PlanSession[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (sessions.length >= PLAN_LIMITS.sessions) break;
    const cells = splitRow(row);
    const numbered = readNumber(cells[numberCol] ?? '');
    if (!numbered || seen.has(numbered.numero)) continue;
    seen.add(numbered.numero);
    const own = fallbackTitleCol >= 0 ? cells[fallbackTitleCol] ?? '' : '';
    const own2 = objectiveCol >= 0 ? cells[objectiveCol] ?? '' : '';
    const objectif = isBlank(own2) ? '' : clip(own2, PLAN_LIMITS.objective);
    // Sans titre lisible (tableau « séance | objectif | activités »), l'objectif tient lieu de titre dans la liste.
    const titre = clip(isBlank(own) ? numbered.rest || objectif : own, PLAN_LIMITS.title);
    const parts: string[] = [];
    cells.forEach((value, i) => {
      if (i === numberCol || isBlank(value)) return;
      const label = (headers[i] ?? '').slice(0, 40);
      parts.push(label ? `${label} : ${clip(value, 300)}` : clip(value, 300));
    });
    // Le titre venu du numéro (« Séance 1 : Titre ») n'a pas de colonne : il ouvre la ligne.
    if (isBlank(own) && numbered.rest) parts.unshift(`Titre : ${clip(numbered.rest, 300)}`);
    sessions.push({
      numero: numbered.numero,
      ...(numbered.fin !== undefined ? { fin: numbered.fin } : {}),
      titre,
      objectif,
      ligne: clip(parts.join(' ; '), PLAN_LIMITS.line),
    });
  }
  return sessions;
}

/** Séances d'un tableau (lignes consécutives contenant des barres), ou null si ce n'est pas le tableau des séances. */
function readTable(rows: readonly string[]): PlanSession[] | null {
  const headers = splitRow(rows[0]);
  if (headers.length < 2) return null;
  const separated = rows.length > 1 && isSeparator(splitRow(rows[1]));
  // Sans ligne de séparation, seules des barres de bordure disent que c'est un tableau (et non une phrase avec « | »).
  if (!separated && !rows[0].trim().startsWith('|')) return null;
  const columns = numberColumns(headers);
  if (columns.length === 0) return null;
  const body = rows.slice(separated ? 2 : 1);
  for (const column of columns) {
    const sessions = readRows(headers, body, column);
    if (sessions.length > 0) return sessions;
  }
  return null;
}

/**
 * Séances du tableau d'un plan : le premier tableau dont l'en-tête annonce un numéro de séance (« Séance », « N° »,
 * « Numéro ») et dont au moins une ligne en porte un. Dans l'ordre du tableau, au plus PLAN_LIMITS.sessions. Liste vide si
 * le texte n'a pas de tel tableau (ou n'est pas un texte) : jamais d'exception.
 */
export function readPlanTable(markdown: unknown): PlanSession[] {
  try {
    if (typeof markdown !== 'string' || markdown === '') return [];
    const text = markdown.length > PLAN_LIMITS.chars ? markdown.slice(0, PLAN_LIMITS.chars) : markdown;
    const lines = text.split('\n');
    let start = -1;
    for (let i = 0; i <= lines.length; i++) {
      const inTable = i < lines.length && lines[i].includes('|');
      if (inTable) {
        if (start < 0) start = i;
        continue;
      }
      if (start >= 0) {
        const sessions = readTable(lines.slice(start, i));
        if (sessions) return sessions;
        start = -1;
      }
    }
    return [];
  } catch {
    return [];
  }
}
