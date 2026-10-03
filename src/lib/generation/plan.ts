// « Développer une séance » : à partir du plan d'une séquence (option « plan d'abord »), prépare la demande de l'outil
// « fiche de préparation » pour une séance choisie. Pur : aucune lecture du navigateur, jamais d'exception.
//
// Rien n'est lancé : la demande préparée REMPLIT le formulaire (mécanisme de « Reprendre cette demande », état du
// routeur), l'enseignant la relit, la modifie, puis génère. Le texte préparé ne passe jamais par l'adresse (limite de
// taille, historique du navigateur).
//
// Cohérence entre les étapes : la demande reprend les objectifs et la problématique de la séquence, la ligne du plan de la
// séance, et dit ce qui précède et ce qui suit, pour que la fiche s'inscrive dans la séquence au lieu d'être écrite seule.

import { isMatiere } from '@shared/catalog';
import { getModalite, isModaliteAvailable } from '@shared/formats';
import { isNiveau } from '@shared/levels';
import {
  clipText, countSessions, leadingRun, PLAN_LIMITS, readPlanTable, safeSlice, sessionSpan, stripEndPunctuation, stripLoneSurrogates, type PlanSession,
} from '@shared/planTable';
import type { GenerationRequest } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';
import type { ReusableRecord } from './reuse';

export { PLAN_LIMITS, sessionSpan, type PlanSession };

/**
 * Séances lues dans le tableau du plan (voir shared/planTable.ts) : bornées (200 000 caractères lus, 60 séances), liste
 * vide si le texte n'a pas de tableau des séances lisible. `requested` : nombre de séances demandé, s'il l'a été (aide à
 * reconnaître le tableau des séances parmi les autres tableaux du plan).
 */
export function parsePlan(markdown: string, requested?: number): PlanSession[] {
  return readPlanTable(markdown, requested);
}

// ─── Objectifs et problématique de la séquence ──────────────────────────────

export interface PlanContext {
  /** Problématique de la séquence (vide si le plan n'en a pas). */
  problematique: string;
  /** Objectifs (ou acquis d'apprentissage dans le supérieur) de la séquence, sur une ligne ; vide si absents. */
  objectifs: string;
}

/** Longueur conservée d'une rubrique (problématique, objectifs). */
const CONTEXT_CHARS = 600;
/** Lignes lues sous une rubrique. */
const CONTEXT_LINES = 15;
/** Caractères lus d'une ligne : au-delà, la ligne est coupée (jamais une lecture lente sur une ligne démesurée). */
const MAX_LINE_CHARS = 2_000;

/**
 * Intitulés de rubrique (texte déjà sans accents ni majuscules) : seuls, ou suivis de « : » (« Objectifs de la séquence : »),
 * avec ou sans précision entre parenthèses (« Objectifs de la séquence (compétences visées) »).
 */
const LABELS: Readonly<Record<keyof PlanContext, RegExp>> = {
  problematique: /^problematiques?(?: [a-z'’ ]{0,40}?)?(?: ?\([^)]{0,80}\))?(?= ?(?::|$))/,
  objectifs: /^(?:objectifs?|acquis d.apprentissage)(?: [a-z'’ ]{0,40}?)?(?: ?\([^)]{0,80}\))?(?= ?(?::|$))/,
};
/**
 * Mots qui, dans la queue d'un intitulé, en font celui d'une autre partie du plan (texte déjà sans accents ni majuscules) :
 * « Objectifs de l'évaluation » n'est pas « Objectifs de la séquence ».
 */
const OTHER_PART_RE = /evaluation|seance|diagnostique/;
/** Caractères d'une ligne lus pour reconnaître un intitulé (le plus long : mot, 40 lettres, parenthèse de 80 caractères). */
const LABEL_HEAD_CHARS = 140;

const LIST_ITEM_RE = /^(?:[-+•*] |\d{1,2}[.)] )/;

/**
 * Ligne sans titre « # » (ni dièses de fermeture : « ## Problématique ## »), citation, puce, gras (« ** », « <b> ») : le
 * texte seul.
 */
function plainLine(line: string): string {
  let text = line.normalize('NFC').trim().replace(/^>+ ?/, '');
  if (/^#{1,6} /.test(text)) text = text.replace(/^#{1,6} /, '').replace(/ #+$/, '');
  return text
    .replace(/<\/?(?:b|strong|i|em|u)>/gi, '')
    .replace(/\*+|`+|~~/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-+•] /, '');
}

/** Décor de tête de ligne devant un intitulé : puces, emoji, guillemets, chiffres cerclés. */
const LEADING_DECOR_RE = /^(?:[^\p{L}\p{N}]|\p{No})+/u;
/** Numérotation de tête : « 1. », « 2) », « 2.1 », « 3 - », « I. », « iv) », « a) ». */
const NUMBERING_RE = /^(?:\d{1,2}(?:\.\d{1,2}){1,3}\s+|(?:\d{1,2}(?:\.\d{1,2}){0,3}|[ivx]{1,5}|[a-d])(?:[.)]|\s[-–—:])\s*)/iu;

/** Ligne de rubrique possible : le texte seul (plainLine), sans numérotation, puce ni emoji de tête (« ## 1. Problématique », « 🎯 Objectifs »). */
function labelLine(line: string): string {
  let text = plainLine(line);
  for (let pass = 0; pass < 3; pass++) {
    const before = text;
    text = text.replace(LEADING_DECOR_RE, '').replace(NUMBERING_RE, '');
    if (text === before) break;
  }
  return text;
}

function isHeadingLine(line: string): boolean {
  const t = line.trimStart();
  return line.length - t.length <= 3 && /^#{1,6}(?: |$)/.test(t);
}

/** Texte courant : ASCII, lettres latines (jusqu'à U+024F), guillemets et tirets usuels : le repli se fait d'un seul bloc, sans changer l'alignement. */
const LATIN_TEXT_RE = /^[\u0020-\u007e\u00a0-\u024f\u2018\u2019\u201c\u201d\u2013\u2014\u2026]*$/;

/**
 * Minuscules, sans accents, point de code pour point de code : le texte replié a exactement la longueur du texte d'origine,
 * pour que la longueur d'un intitulé mesurée sur l'un serve à couper l'autre. Un caractère dont le repli change la longueur
 * (jamo hangul, marque combinante isolée) est conservé tel quel.
 */
function fold(text: string): string {
  const fold1 = (value: string) => value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  if (LATIN_TEXT_RE.test(text)) return fold1(text);
  let out = '';
  for (const char of text) {
    const folded = fold1(char);
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

/** Rubrique annoncée par le début d'une ligne (déjà sans numérotation : labelLine), et la longueur de son intitulé. */
function labelOf(text: string): { kind: keyof PlanContext; length: number } | null {
  const head = fold(safeSlice(text, LABEL_HEAD_CHARS));
  for (const kind of ['problematique', 'objectifs'] as const) {
    const match = LABELS[kind].exec(head);
    // Sans la parenthèse : « Objectifs de la séquence (évaluation comprise) » reste celui de la séquence.
    if (match && !OTHER_PART_RE.test(match[0].replace(/\([^)]*\)/, ''))) return { kind, length: match[0].length };
  }
  return null;
}

/** Longueur maximale (caractères) du libellé d'une ligne « Libellé : valeur ». */
const FIELD_LABEL_CHARS = 60;
/** Nombre de mots au plus d'un libellé de champ en gras / sans mise en forme. */
const FIELD_LABEL_WORDS = { bold: 8, plain: 5 } as const;

/**
 * Ligne qui ouvre un autre champ d'un plan compact (« **Durée :** 6 séances », « Niveau : 5ème », « **Évaluation
 * diagnostique :** ») : un court libellé, puis « : ». Une phrase qui contient un « : » (« Comment faire : voici ? ») n'en
 * est pas une. Sans mise en forme, la valeur doit suivre sur la même ligne (« capable de : » seul annonce une liste).
 */
function isFieldLine(trimmed: string): boolean {
  const bold = /^(?:\*\*|__|<b>|<strong>)/i.test(trimmed);
  const text = plainLine(trimmed);
  const colon = text.indexOf(':');
  if (colon < 1 || colon > FIELD_LABEL_CHARS) return false;
  const value = text.slice(colon + 1);
  if (value !== '' && !value.startsWith(' ')) return false;
  const label = text.slice(0, colon).trimEnd();
  if (/[?!;]/.test(label) || label.split(' ').length > FIELD_LABEL_WORDS[bold ? 'bold' : 'plain']) return false;
  if (bold) return true;
  return value.trim() !== '' && !/[,.]/.test(label) && !text.endsWith('?');
}

/**
 * Texte qui suit un intitulé de rubrique : lignes jusqu'au titre ou à la rubrique suivante, au tableau, à un autre champ
 * (plan compact : « **Durée :** 6 séances ») ou à la fin du paragraphe (une liste, elle, peut contenir des lignes vides ;
 * une fois la liste commencée, toute ligne qui n'est pas une puce l'arrête, sauf la suite indentée d'une puce). Les puces
 * sont jointes par « ; », chacune sans sa ponctuation finale. Un élément de liste qui commence lui-même par le nom de la
 * rubrique (« 1. Objectif : situer » sous « Objectifs ») est un élément, pas une nouvelle rubrique.
 */
function textAfter(lines: readonly string[], from: number, kind: keyof PlanContext): string {
  const pieces: string[] = [];
  let items = false;
  let j = from;
  while (j < lines.length && lines[j].trim() === '' && j - from < 3) j++;
  for (; j < lines.length && pieces.length < CONTEXT_LINES; j++) {
    const raw = lines[j];
    const trimmed = raw.trim();
    if (trimmed === '') {
      const next = lines.slice(j + 1, j + 4).find(l => l.trim() !== '');
      if (!items || next === undefined || !LIST_ITEM_RE.test(next.trim())) break;
      continue;
    }
    const item = LIST_ITEM_RE.test(trimmed);
    if (isHeadingLine(raw) || raw.includes('|')) break;
    const label = labelOf(labelLine(trimmed));
    if (label && (label.kind !== kind || !item)) break;
    if (!item) {
      // Autre champ du plan : en gras toujours ; sans mise en forme une fois du texte lu (la première ligne sous
      // l'intitulé est la rubrique elle-même, même si elle contient un « : »).
      if (isFieldLine(trimmed) && (pieces.length > 0 || /^(?:\*\*|__|<b>|<strong>)/i.test(trimmed))) break;
      if (items) {
        if (!/^\s{2,}/.test(raw)) break;
        pieces[pieces.length - 1] = `${pieces[pieces.length - 1]} ${plainLine(trimmed)}`;
        continue;
      }
    }
    if (item) items = true;
    pieces.push(plainLine(item ? trimmed.replace(LIST_ITEM_RE, '') : trimmed));
  }
  return items
    ? pieces.map(stripEndPunctuation).filter(Boolean).join(' ; ')
    : pieces.filter(Boolean).join(' ');
}

/**
 * Problématique et objectifs de la séquence, lus dans le plan : rubrique en titre (« ## Problématique », « ## 2. Objectifs
 * de la séquence », « Objectifs (compétences visées) », « II. OBJECTIFS ») ou ligne « **Objectifs :** … » (texte sur la
 * ligne, ou ce qui suit). Les lignes de tableau ne sont jamais prises pour une rubrique. Rubrique absente ou illisible :
 * texte vide. Jamais d'exception.
 */
export function extractPlanContext(markdown: string): PlanContext {
  const found: PlanContext = { problematique: '', objectifs: '' };
  try {
    if (typeof markdown !== 'string') return found;
    // Demi-paire de substitution d'un flux coupé : retirée dès l'entrée, elle ne traverse pas jusqu'au formulaire.
    const lines = stripLoneSurrogates(safeSlice(markdown, PLAN_LIMITS.chars))
      .split('\n')
      .map(line => safeSlice(line, MAX_LINE_CHARS));
    for (let i = 0; i < lines.length && !(found.problematique && found.objectifs); i++) {
      if (lines[i].includes('|')) continue;
      const text = labelLine(lines[i]);
      const label = text ? labelOf(text) : null;
      if (!label || found[label.kind]) continue;
      const inline = text.slice(label.length).replace(/^[\s:–—-]+/, '');
      const value = (inline || textAfter(lines, i + 1, label.kind)).replace(/\s+/g, ' ').trim();
      if (value) found[label.kind] = clipText(value, CONTEXT_CHARS);
    }
  } catch {
    // Texte imprévu : ce qui a été lu est conservé, le reste est vide.
  }
  return found;
}

// ─── Plan lu ────────────────────────────────────────────────────────────────

export interface ReadPlan {
  sessions: PlanSession[];
  context: PlanContext;
  /**
   * Nombre de séances de la séquence : celui de l'enseignant s'il en a demandé un (ou la suite 1…n lue, si elle est plus
   * longue), sinon le nombre de séances lues ; jamais davantage que le plus grand du nombre de séances lues et du nombre
   * demandé (un numéro isolé et démesuré du tableau n'annonce pas « séance 2 sur 365 »).
   */
  total: number;
  /**
   * `total` est-il sûr, assez pour être annoncé (« séance 2 sur 6 », « dernière séance ») ? Oui quand un nombre de séances
   * valide a été demandé, ou quand les numéros du tableau se suivent de 1 à n. Non quand il a un trou (1, 2, 4) ou une
   * ligne isolée (1 à 6, puis 58) sans nombre demandé : le total lu serait faux (« séance 1 sur 3 » alors qu'une séance 4
   * existe).
   */
  totalKnown: boolean;
}

/** Ce qu'il faut savoir de la séquence pour préparer ses séances (la demande qui a produit le plan). */
export interface PlanOrigin {
  niveau: string;
  matiere: string;
  discipline?: string;
  sujet: string;
  /** Objectifs saisis par l'enseignant, repris faute d'objectifs lisibles dans le plan. */
  objectifs?: string;
  /** Consignes saisies par l'enseignant pour la séquence (« documents audio uniquement »), reprises dans la demande de la fiche. */
  consignes?: string;
  /** Durée saisie par l'enseignant pour la séquence (texte libre : durée d'une séance ou de la séquence, voir durations). */
  duree?: string;
  /** Démarche (format) choisie pour la séquence : identifiant du catalogue (shared/formats.ts). */
  modalite?: string;
  researchMode?: string;
}

const stored = (value: unknown, max: number): string => (typeof value === 'string' ? safeSlice(stripLoneSurrogates(oneLine(value)), max).trimEnd() : '');

/** Origine du plan : la demande de séquence qui l'a produit (résultat affiché juste après la génération). */
export function planOriginFromRequest(
  req: Pick<GenerationRequest, 'niveau' | 'matiere' | 'discipline' | 'sujet' | 'objectifs' | 'consignes' | 'duree' | 'modalite' | 'researchMode'>,
): PlanOrigin {
  return {
    niveau: req.niveau,
    matiere: req.matiere,
    ...(req.discipline ? { discipline: req.discipline } : {}),
    sujet: req.sujet,
    ...(req.objectifs ? { objectifs: req.objectifs } : {}),
    ...(req.consignes ? { consignes: req.consignes } : {}),
    ...(req.duree ? { duree: req.duree } : {}),
    ...(req.modalite ? { modalite: req.modalite } : {}),
    researchMode: req.researchMode,
  };
}

/** Origine du plan : la génération enregistrée (Historique), dont les paramètres viennent du stockage (relus un à un). */
export function planOriginFromRecord(record: ReusableRecord): PlanOrigin {
  const params = record.params ?? {};
  const objectifs = stored(params.objectifs, REQUEST_LIMITS.objectifs);
  const consignes = stored(params.consignes, REQUEST_LIMITS.consignes);
  const duree = stored(params.duree, REQUEST_LIMITS.duree);
  const discipline = stored(record.discipline, REQUEST_LIMITS.discipline);
  const modalite = typeof params.modalite === 'string' && getModalite(params.modalite) ? params.modalite : '';
  const researchMode = typeof params.researchMode === 'string' ? params.researchMode : '';
  return {
    niveau: String(record.niveau),
    matiere: String(record.matiere),
    ...(discipline ? { discipline } : {}),
    sujet: stored(record.sujet, REQUEST_LIMITS.sujet),
    ...(objectifs ? { objectifs } : {}),
    ...(consignes ? { consignes } : {}),
    ...(duree ? { duree } : {}),
    ...(modalite ? { modalite } : {}),
    ...(researchMode ? { researchMode } : {}),
  };
}

/** Nombre de séances demandé exploitable (entier de 1 à PLAN_LIMITS.sessions), sinon undefined. */
function requestedCount(requested: unknown): number | undefined {
  return typeof requested === 'number' && Number.isInteger(requested) && requested >= 1 && requested <= PLAN_LIMITS.sessions
    ? requested
    : undefined;
}

/**
 * Plan d'une séquence relu pour « Développer une séance » : séances du tableau, objectifs et problématique. null si le
 * texte n'a aucune séance lisible (rien n'est alors proposé : jamais d'erreur affichée). `requested` : nombre de séances
 * demandé, s'il l'a été (« séance 4 sur 6 » même si le tableau en a perdu).
 */
export function readPlan(markdown: string, requested?: number): ReadPlan | null {
  const asked = requestedCount(requested);
  const sessions = parsePlan(markdown, asked);
  if (sessions.length === 0) return null;
  const read = countSessions(sessions);
  const highest = Math.max(...sessions.map(session => session.fin ?? session.numero));
  return {
    sessions,
    context: extractPlanContext(markdown),
    // Nombre demandé : le total de l'enseignant (une ligne isolée du tableau, « 58 », ne le change pas) ; sinon les séances lues.
    total: asked !== undefined ? Math.max(asked, leadingRun(sessions)) : read,
    totalKnown: asked !== undefined || highest === read,
  };
}

// ─── Demande préparée ───────────────────────────────────────────────────────

/** « séance 3 », « séances 3 et 4 », « séances 3 à 6 ». */
export function sessionLabel(session: Pick<PlanSession, 'numero' | 'fin'>): string {
  if (session.fin === undefined) return `séance ${session.numero}`;
  return `séances ${session.numero} ${session.fin === session.numero + 1 ? 'et' : 'à'} ${session.fin}`;
}

/** Texte sur une ligne, espaces réduits. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * « sur 6 » : le nombre de séances de la séquence, tant que cette séance en fait partie. Un total qui n'est pas sûr
 * (numérotation du tableau à trous, sans nombre demandé) est omis pour toutes les séances ; un numéro au-delà du total
 * n'annonce jamais un total plus petit que lui, ni inventé : le total est alors omis.
 */
function ofTotal(plan: ReadPlan, session: PlanSession): string {
  return plan.totalKnown && lastOf(session) <= plan.total ? ` sur ${plan.total}` : '';
}

/** Dernier numéro de séance couvert par cette ligne du plan. */
const lastOf = (session: Pick<PlanSession, 'numero' | 'fin'>): number => session.fin ?? session.numero;

/** Séance lue juste avant (`-1`) ou juste après (`1`) celle-ci d'après les numéros (pas la place dans le tableau), s'il y en a une. */
function neighbour(plan: ReadPlan, session: PlanSession, direction: -1 | 1): PlanSession | undefined {
  let best: PlanSession | undefined;
  for (const other of plan.sessions) {
    if (other === session) continue;
    if (direction < 0) {
      if (lastOf(other) < session.numero && (!best || lastOf(other) > lastOf(best))) best = other;
    } else if (other.numero > lastOf(session) && (!best || other.numero < best.numero)) {
      best = other;
    }
  }
  return best;
}

/**
 * Phrase sur la séance voisine. Une voisine qui suit directement est « précédente » / « suivante » ; une voisine lue plus
 * loin (numéro manquant entre les deux) est dite « figurant au plan » ; sans voisine, « aucune » seulement quand c'est
 * démontré (`edge` : première séance, ou dernière d'un total sûr), sinon la phrase est omise : jamais une absence affirmée
 * sans preuve.
 */
function neighbourSentence(name: 'précédente' | 'suivante', other: PlanSession | undefined, session: PlanSession, edge: string): string {
  if (!other) return edge ? sentence(`Séance ${name} : aucune (${edge})`) : '';
  const adjacent = name === 'précédente' ? lastOf(other) + 1 === session.numero : other.numero === lastOf(session) + 1;
  return sentence(`Séance ${name}${adjacent ? '' : ' figurant au plan'} : ${sessionMention(other, CONSIGNES_CAPS.neighbour)}`);
}

/** « séance 2 — Titre » (titre absent : « séance 2 »), borné. */
function sessionMention(session: PlanSession, max: number): string {
  const title = oneLine(session.titre);
  return clipText(title ? `${sessionLabel(session)} — ${title}` : sessionLabel(session), max);
}

/** Sujet de la fiche : « <sujet de la séquence> — séance N : <titre> », jamais au-delà de REQUEST_LIMITS.sujet. */
export function developSujet(sujet: string, session: PlanSession): string {
  const title = oneLine(session.titre);
  const suffix = ` — ${sessionLabel(session)}${title ? ` : ${clipText(title, 120)}` : ''}`;
  const base = oneLine(sujet);
  return base.length + suffix.length <= REQUEST_LIMITS.sujet ? `${base}${suffix}` : `${clipText(base, REQUEST_LIMITS.sujet - suffix.length)}${suffix}`;
}

/**
 * Longueurs maximales des parties variables des consignes. Avec le sujet (300 au plus), la durée (80), la démarche (40), les
 * phrases du gabarit (moins de 700 caractères au total) et les deux séances voisines, le total reste sous
 * REQUEST_LIMITS.consignes (3 000) ; le test de limites le vérifie avec des textes démesurés.
 */
const CONSIGNES_CAPS = { context: 650, teacher: 450, line: 650, neighbour: 180 } as const;

/**
 * Phrase terminée par un seul signe : les « . », « ; », « : » et espaces de fin d'origine sont retirés, puis un point est
 * ajouté, sauf après « ? », « ! » ou « … » (une problématique reste une question, une coupe reste visible) : jamais « ?. »
 * ni « .. » ni « …. ».
 */
function sentence(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s.;:]/.test(text[end - 1])) end--;
  const body = text.slice(0, end);
  return /[?!…]$/.test(body) ? body : `${body}.`;
}

/** Éléments joints par « ; » : chacun sans sa ponctuation finale, sauf le dernier (la phrase s'en charge). */
function joinClauses(parts: readonly string[]): string {
  const kept = parts.filter(Boolean);
  return kept.map((part, i) => (i < kept.length - 1 ? stripEndPunctuation(part) : part)).join(' ; ');
}

// ─── Durée ──────────────────────────────────────────────────────────────────

/** Durée d'une séance au plus (minutes) : au-delà, la durée saisie est celle de la séquence. */
const MAX_SESSION_MINUTES = 240;
const MINUTES_UNIT = '(?:min|mn|minutes?)';
/** « environ 1 heure », « ~55 min » : approximation devant la durée. */
const APPROX = '(?:(?:environ|à peu près) |[~≈] ?)?';
/** « par séance », « chacune » : précision qui laisse une durée de séance. */
const PER_SESSION = '(?: (?:par|la|chaque) s[ée]ance| chacune)?';
const MINUTES_RE = new RegExp(`^${APPROX}(\\d{1,3}) ?${MINUTES_UNIT}${PER_SESSION}$`, 'i');
const HOURS_RE = new RegExp(`^${APPROX}(\\d{1,2})(?:[.,](\\d{1,2}))? ?(?:h|heures?)(?: ?(\\d{1,2}) ?${MINUTES_UNIT}?)?${PER_SESSION}$`, 'i');
/** Durée qui parle de la séquence entière : semaines, mois, trimestre, année, jours, nombre de séances, période. */
const LONG_DURATION_RE = /(?<![\p{L}\d])(?:semaines?|sem\.?|mois|trimestres?|semestres?|ann[ée]es?|jours?|s[ée]ances?|p[ée]riodes?|vacances)(?![\p{L}\d])/iu;

/**
 * Nature de la durée saisie pour la séquence : « séance » (minutes ou heures, 4 h au plus : « 55 minutes », « 1h30 »),
 * « longue » (semaines, mois, plus de 4 h, nombre de séances : la séquence entière), sinon « autre » (illisible : ni l'une
 * ni l'autre n'est affirmé). Le champ Durée du formulaire de séquence est un texte libre : « 55 minutes » ou « 2 heures »
 * y décrivent aussi bien une séance que la séquence.
 */
function durationKind(text: string): 'séance' | 'longue' | 'autre' {
  const clean = oneLine(text);
  let minutes: number | null = null;
  const m = MINUTES_RE.exec(clean);
  if (m) minutes = Number(m[1]);
  const h = m ? null : HOURS_RE.exec(clean);
  if (h) minutes = Number(h[1]) * 60 + (h[2] ? Math.round(Number(`0.${h[2]}`) * 60) : 0) + Number(h[3] ?? 0);
  if (minutes !== null) return minutes < 1 ? 'autre' : minutes <= MAX_SESSION_MINUTES ? 'séance' : 'longue';
  return LONG_DURATION_RE.test(clean) ? 'longue' : 'autre';
}

/**
 * Durée de la fiche et phrase des consignes. Le champ Durée de la fiche reçoit la durée de la ligne du plan (colonne
 * « Durée »), à défaut la durée saisie pour la séquence quand elle ressemble à une durée de séance. Une durée longue reste
 * dite « Durée prévue pour la séquence » ; une durée illisible reçoit une étiquette neutre : jamais celle d'une séance ou de
 * la séquence sans preuve. Une durée de séance reprise dans le champ n'est pas répétée dans les consignes.
 */
function durations(origin: PlanOrigin, session: PlanSession): { field: string; sentence: string } {
  const own = oneLine(session.duree ?? '');
  const given = clipText(oneLine(origin.duree ?? ''), REQUEST_LIMITS.duree);
  const kind = given ? durationKind(given) : null;
  const field = own || (kind === 'séance' ? given : '');
  if (!given || kind === 'séance') return { field, sentence: '' };
  const label = kind === 'longue' ? 'Durée prévue pour la séquence' : 'Durée indiquée dans la demande de séquence';
  return { field, sentence: sentence(`${label} : ${given}`) };
}

/**
 * Consignes de la fiche (gabarit fixe) : « Séance N sur n d'une séquence « <sujet> ». Objectifs et problématique de la
 * séquence : …. Démarche, durée et consignes de l'enseignant pour la séquence (s'il en a donné). Ligne du plan : ….
 * Séance précédente : … Séance suivante : … Respecte ce plan. » (« sur n » seulement quand le total est sûr ; « aucune »
 * seulement pour la séance 1 et pour la dernière séance d'un total sûr). Les parties variables sont tronquées proprement pour que
 * le tout reste dans REQUEST_LIMITS.consignes ; le gabarit, lui, n'est jamais coupé. Chaque phrase se termine par un seul
 * signe (jamais « ?. » ni « .. »). Ce qui n'est pas lisible dans le plan est omis : jamais « non précisé ».
 */
export function developConsignes(origin: PlanOrigin, plan: ReadPlan, index: number): string {
  const session = plan.sessions[index];
  const objectifs = plan.context.objectifs || oneLine(origin.objectifs ?? '');
  const context = joinClauses([objectifs && `objectifs : ${objectifs}`, plan.context.problematique && `problématique : ${plan.context.problematique}`]);
  const demarche = getModalite(origin.modalite)?.label;
  const teacher = oneLine(origin.consignes ?? '');
  const line = oneLine(session.ligne) || sessionMention(session, 200);
  const label = sessionLabel(session);
  // « Aucune » seulement quand c'est démontré : première séance si elle porte le numéro 1, dernière si elle porte le total.
  const first = session.numero === 1 ? 'première séance de la séquence' : '';
  const last = plan.totalKnown && lastOf(session) === plan.total ? 'dernière séance de la séquence' : '';
  const sentences = [
    `${label.charAt(0).toUpperCase()}${label.slice(1)}${ofTotal(plan, session)} d'une séquence « ${clipText(oneLine(origin.sujet), REQUEST_LIMITS.sujet)} ».`,
    context && sentence(`Objectifs et problématique de la séquence : ${clipText(context, CONSIGNES_CAPS.context)}`),
    demarche && sentence(`Démarche choisie pour la séquence : ${demarche}`),
    durations(origin, session).sentence,
    teacher && sentence(`Consignes de l'enseignant pour la séquence : ${clipText(teacher, CONSIGNES_CAPS.teacher)}`),
    sentence(`Ligne du plan : ${clipText(line, CONSIGNES_CAPS.line)}`),
    neighbourSentence('précédente', neighbour(plan, session, -1), session, first),
    neighbourSentence('suivante', neighbour(plan, session, 1), session, last),
    'Respecte ce plan.',
  ];
  // Garde-fou : les bornes ci-dessus tiennent largement sous la limite, ce test ne sert que si elles changent un jour.
  return clipText(sentences.filter(Boolean).join(' '), REQUEST_LIMITS.consignes);
}

/** Ce que reçoit la page « Générer » (état du routeur) : formulaire prérempli et phrase de rappel. */
export interface DevelopPrefill {
  reuse: ReusableRecord;
  /** Rappel affiché au-dessus du formulaire à la place de « Demande reprise depuis l'historique ». */
  reuseNotice: string;
}

/**
 * Demande de l'outil « fiche de préparation » pour la séance `index` du plan : même niveau, matière et discipline ; sujet
 * « <sujet> — séance N : <titre> » ; objectifs et durée de la ligne du plan s'ils sont lisibles (à défaut, la durée saisie si
 * c'est celle d'une séance) ; démarche de la séquence quand elle s'applique aussi à une fiche ; consignes qui conservent la
 * cohérence de la séquence (developConsignes). Tout est borné
 * aux limites d'une demande (REQUEST_LIMITS). Indice hors liste : null.
 */
export function buildDevelopPrefill(origin: PlanOrigin, plan: ReadPlan, index: number): DevelopPrefill | null {
  const session = plan.sessions[index];
  if (!session) return null;
  const objectifs = clipText(oneLine(session.objectif), REQUEST_LIMITS.objectifs);
  const modalite = isNiveau(origin.niveau) && isMatiere(origin.matiere) && isModaliteAvailable(origin.modalite, 'fiche_prep', origin.niveau, origin.matiere)
    ? origin.modalite
    : undefined;
  const { field: duree } = durations(origin, session);
  const params: Record<string, unknown> = {
    consignes: developConsignes(origin, plan, index),
    ...(objectifs ? { objectifs } : {}),
    ...(duree ? { duree } : {}),
    ...(modalite ? { modalite } : {}),
    ...(origin.researchMode ? { researchMode: origin.researchMode } : {}),
  };
  return {
    reuse: {
      type: 'fiche_prep',
      niveau: origin.niveau,
      matiere: origin.matiere,
      ...(origin.discipline ? { discipline: origin.discipline } : {}),
      sujet: developSujet(origin.sujet, session),
      params,
    },
    reuseNotice: `Demande préparée à partir du plan (${sessionLabel(session)}${ofTotal(plan, session)} de la séquence « ${clipText(oneLine(origin.sujet), 120)} ») : relisez et modifiez les paramètres avant de générer, rien n'est généré automatiquement.`,
  };
}
