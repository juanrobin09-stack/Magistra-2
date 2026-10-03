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
  clipText, countSessions, PLAN_LIMITS, readPlanTable, safeSlice, sessionSpan, stripEndPunctuation, type PlanSession,
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
  problematique: /^problematique(?: [a-z'’ ]{0,40}?)?(?: ?\([^)]{0,80}\))?(?= ?(?::|$))/,
  objectifs: /^(?:objectifs?|acquis d.apprentissage)(?: [a-z'’ ]{0,40}?)?(?: ?\([^)]{0,80}\))?(?= ?(?::|$))/,
};
/** Caractères d'une ligne lus pour reconnaître un intitulé (le plus long : mot, 40 lettres, parenthèse de 80 caractères). */
const LABEL_HEAD_CHARS = 140;

const LIST_ITEM_RE = /^(?:[-+•*] |\d{1,2}[.)] )/;

/** Ligne sans titre « # », citation, puce ni gras : le texte seul. */
function plainLine(line: string): string {
  return line
    .normalize('NFC')
    .trim()
    .replace(/^>+ ?/, '')
    .replace(/^#{1,6} /, '')
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

/** Minuscules, sans accents. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Rubrique annoncée par le début d'une ligne (déjà sans numérotation : labelLine), et la longueur de son intitulé. */
function labelOf(text: string): { kind: keyof PlanContext; length: number } | null {
  const head = fold(safeSlice(text, LABEL_HEAD_CHARS));
  for (const kind of ['problematique', 'objectifs'] as const) {
    const match = LABELS[kind].exec(head);
    if (match) return { kind, length: match[0].length };
  }
  return null;
}

/**
 * Texte qui suit un intitulé de rubrique : lignes jusqu'au titre ou à la rubrique suivante, au tableau ou à la fin du
 * paragraphe (une liste, elle, peut contenir des lignes vides). Les puces sont jointes par « ; », chacune sans sa
 * ponctuation finale. Un élément de liste qui commence lui-même par le nom de la rubrique (« 1. Objectif : situer » sous
 * « Objectifs ») est un élément, pas une nouvelle rubrique.
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
    const lines = safeSlice(markdown, PLAN_LIMITS.chars)
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
   * Nombre de séances de la séquence : le plus grand du nombre de séances lues et du nombre demandé, jamais davantage (un
   * numéro isolé et démesuré du tableau n'annonce pas « séance 2 sur 365 »).
   */
  total: number;
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
  /** Durée saisie par l'enseignant pour la séquence. */
  duree?: string;
  /** Démarche (format) choisie pour la séquence : identifiant du catalogue (shared/formats.ts). */
  modalite?: string;
  researchMode?: string;
}

const stored = (value: unknown, max: number): string => (typeof value === 'string' ? safeSlice(oneLine(value), max).trimEnd() : '');

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
  return { sessions, context: extractPlanContext(markdown), total: Math.max(countSessions(sessions), asked ?? 0) };
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
 * « sur 6 » : le nombre de séances de la séquence, tant que cette séance en fait partie. Un numéro au-delà du total (tableau
 * dont des lignes manquent) n'annonce jamais un total plus petit que lui, ni inventé : le total est alors omis.
 */
function ofTotal(plan: ReadPlan, session: PlanSession): string {
  return (session.fin ?? session.numero) <= plan.total ? ` sur ${plan.total}` : '';
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

/**
 * Consignes de la fiche (gabarit fixe) : « Séance N sur n d'une séquence « <sujet> ». Objectifs et problématique de la
 * séquence : …. Démarche, durée et consignes de l'enseignant pour la séquence (s'il en a donné). Ligne du plan : ….
 * Séance précédente : … Séance suivante : … Respecte ce plan. » Les parties variables sont tronquées proprement pour que
 * le tout reste dans REQUEST_LIMITS.consignes ; le gabarit, lui, n'est jamais coupé. Chaque phrase se termine par un seul
 * signe (jamais « ?. » ni « .. »). Ce qui n'est pas lisible dans le plan est omis : jamais « non précisé ».
 */
export function developConsignes(origin: PlanOrigin, plan: ReadPlan, index: number): string {
  const session = plan.sessions[index];
  const previous = plan.sessions[index - 1];
  const next = plan.sessions[index + 1];
  const objectifs = plan.context.objectifs || oneLine(origin.objectifs ?? '');
  const context = joinClauses([objectifs && `objectifs : ${objectifs}`, plan.context.problematique && `problématique : ${plan.context.problematique}`]);
  const demarche = getModalite(origin.modalite)?.label;
  const duree = oneLine(origin.duree ?? '');
  const teacher = oneLine(origin.consignes ?? '');
  const line = oneLine(session.ligne) || sessionMention(session, 200);
  const label = sessionLabel(session);
  const before = previous ? sessionMention(previous, CONSIGNES_CAPS.neighbour) : 'aucune (première séance de la séquence)';
  const after = next ? sessionMention(next, CONSIGNES_CAPS.neighbour) : 'aucune (dernière séance de la séquence)';
  const sentences = [
    `${label.charAt(0).toUpperCase()}${label.slice(1)}${ofTotal(plan, session)} d'une séquence « ${clipText(oneLine(origin.sujet), REQUEST_LIMITS.sujet)} ».`,
    context && sentence(`Objectifs et problématique de la séquence : ${clipText(context, CONSIGNES_CAPS.context)}`),
    demarche && sentence(`Démarche choisie pour la séquence : ${demarche}`),
    duree && sentence(`Durée prévue pour la séquence : ${clipText(duree, REQUEST_LIMITS.duree)}`),
    teacher && sentence(`Consignes de l'enseignant pour la séquence : ${clipText(teacher, CONSIGNES_CAPS.teacher)}`),
    sentence(`Ligne du plan : ${clipText(line, CONSIGNES_CAPS.line)}`),
    sentence(`Séance précédente : ${before}`),
    sentence(`Séance suivante : ${after}`),
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
 * « <sujet> — séance N : <titre> » ; objectifs de la ligne du plan s'ils sont lisibles ; démarche de la séquence quand elle
 * s'applique aussi à une fiche ; consignes qui conservent la cohérence de la séquence (developConsignes). Tout est borné
 * aux limites d'une demande (REQUEST_LIMITS). Indice hors liste : null.
 */
export function buildDevelopPrefill(origin: PlanOrigin, plan: ReadPlan, index: number): DevelopPrefill | null {
  const session = plan.sessions[index];
  if (!session) return null;
  const objectifs = clipText(oneLine(session.objectif), REQUEST_LIMITS.objectifs);
  const modalite = isNiveau(origin.niveau) && isMatiere(origin.matiere) && isModaliteAvailable(origin.modalite, 'fiche_prep', origin.niveau, origin.matiere)
    ? origin.modalite
    : undefined;
  const params: Record<string, unknown> = {
    consignes: developConsignes(origin, plan, index),
    ...(objectifs ? { objectifs } : {}),
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
