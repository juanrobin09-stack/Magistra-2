// « Développer une séance » : à partir du plan d'une séquence (option « plan d'abord »), prépare la demande de l'outil
// « fiche de préparation » pour une séance choisie. Pur : aucune lecture du navigateur, jamais d'exception.
//
// Rien n'est lancé : la demande préparée REMPLIT le formulaire (mécanisme de « Reprendre cette demande », état du
// routeur), l'enseignant la relit, la modifie, puis génère. Le texte préparé ne passe jamais par l'adresse (limite de
// taille, historique du navigateur).
//
// Cohérence entre les étapes : la demande reprend les objectifs et la problématique de la séquence, la ligne du plan de la
// séance, et dit ce qui précède et ce qui suit, pour que la fiche s'inscrive dans la séquence au lieu d'être écrite seule.

import { PLAN_LIMITS, readPlanTable, sessionSpan, type PlanSession } from '@shared/planTable';
import type { GenerationRequest } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';
import type { ReusableRecord } from './reuse';

export { PLAN_LIMITS, sessionSpan, type PlanSession };

/**
 * Séances lues dans le tableau du plan (voir shared/planTable.ts) : bornées (200 000 caractères lus, 60 séances), liste
 * vide si le texte n'a pas de tableau des séances lisible.
 */
export function parsePlan(markdown: string): PlanSession[] {
  return readPlanTable(markdown);
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

/** Intitulés de rubrique (texte déjà sans accents ni majuscules) : seuls, ou suivis de « : » (« Objectifs de la séquence : »). */
const LABELS: Readonly<Record<keyof PlanContext, RegExp>> = {
  problematique: /^problematique(?: [a-z'’ ]{0,40}?)?(?= ?(?::|$))/,
  objectifs: /^(?:objectifs?|acquis d.apprentissage)(?: [a-z'’ ]{0,40}?)?(?= ?(?::|$))/,
};

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

function isHeadingLine(line: string): boolean {
  const t = line.trimStart();
  return line.length - t.length <= 3 && /^#{1,6}(?: |$)/.test(t);
}

/** Minuscules, sans accents. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Rubrique annoncée par le début d'une ligne, et la longueur de son intitulé. */
function labelOf(text: string): { kind: keyof PlanContext; length: number } | null {
  const head = fold(text.slice(0, 60));
  for (const kind of ['problematique', 'objectifs'] as const) {
    const match = LABELS[kind].exec(head);
    if (match) return { kind, length: match[0].length };
  }
  return null;
}

/** Texte tronqué à `max` caractères au dernier espace, suivi de « … » (jamais au milieu d'une paire de substitution). */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  let end = cut.length;
  while (end > 0 && ' .,;:!?(-–—'.includes(cut[end - 1])) end--;
  if (end > 0 && cut.charCodeAt(end - 1) >= 0xd800 && cut.charCodeAt(end - 1) <= 0xdbff) end--;
  return `${cut.slice(0, end)}…`;
}

/**
 * Texte qui suit un intitulé de rubrique : lignes jusqu'au titre ou à la rubrique suivante, au tableau ou à la fin du
 * paragraphe (une liste, elle, peut contenir des lignes vides). Les puces sont jointes par « ; ».
 */
function textAfter(lines: readonly string[], from: number): string {
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
    if (isHeadingLine(raw) || raw.includes('|') || labelOf(plainLine(trimmed))) break;
    const item = LIST_ITEM_RE.test(trimmed);
    if (item) items = true;
    pieces.push(plainLine(item ? trimmed.replace(LIST_ITEM_RE, '') : trimmed));
  }
  return pieces.filter(Boolean).join(items ? ' ; ' : ' ');
}

/**
 * Problématique et objectifs de la séquence, lus dans le plan : rubrique en titre (« ## Problématique »), ou ligne
 * « **Objectifs :** … » (texte sur la ligne, ou ce qui suit). Les lignes de tableau ne sont jamais prises pour une
 * rubrique. Rubrique absente ou illisible : texte vide. Jamais d'exception.
 */
export function extractPlanContext(markdown: string): PlanContext {
  const found: PlanContext = { problematique: '', objectifs: '' };
  try {
    if (typeof markdown !== 'string') return found;
    const lines = (markdown.length > PLAN_LIMITS.chars ? markdown.slice(0, PLAN_LIMITS.chars) : markdown)
      .split('\n')
      .map(line => (line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line));
    for (let i = 0; i < lines.length && !(found.problematique && found.objectifs); i++) {
      if (lines[i].includes('|')) continue;
      const text = plainLine(lines[i]);
      const label = text ? labelOf(text) : null;
      if (!label || found[label.kind]) continue;
      const inline = text.slice(label.length).replace(/^[\s:–—-]+/, '');
      const value = (inline || textAfter(lines, i + 1)).replace(/\s+/g, ' ').trim();
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
  /** Nombre de séances de la séquence : le plus grand numéro lu, ou le nombre demandé s'il est plus grand. */
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
  researchMode?: string;
}

const stored = (value: unknown, max: number): string => (typeof value === 'string' ? oneLine(value).slice(0, max) : '');

/** Origine du plan : la demande de séquence qui l'a produit (résultat affiché juste après la génération). */
export function planOriginFromRequest(
  req: Pick<GenerationRequest, 'niveau' | 'matiere' | 'discipline' | 'sujet' | 'objectifs' | 'researchMode'>,
): PlanOrigin {
  return {
    niveau: req.niveau,
    matiere: req.matiere,
    ...(req.discipline ? { discipline: req.discipline } : {}),
    sujet: req.sujet,
    ...(req.objectifs ? { objectifs: req.objectifs } : {}),
    researchMode: req.researchMode,
  };
}

/** Origine du plan : la génération enregistrée (Historique), dont les paramètres viennent du stockage (relus un à un). */
export function planOriginFromRecord(record: ReusableRecord): PlanOrigin {
  const params = record.params ?? {};
  const objectifs = stored(params.objectifs, REQUEST_LIMITS.objectifs);
  const discipline = stored(record.discipline, REQUEST_LIMITS.discipline);
  const researchMode = typeof params.researchMode === 'string' ? params.researchMode : '';
  return {
    niveau: String(record.niveau),
    matiere: String(record.matiere),
    ...(discipline ? { discipline } : {}),
    sujet: stored(record.sujet, REQUEST_LIMITS.sujet),
    ...(objectifs ? { objectifs } : {}),
    ...(researchMode ? { researchMode } : {}),
  };
}

/**
 * Plan d'une séquence relu pour « Développer une séance » : séances du tableau, objectifs et problématique. null si le
 * texte n'a aucune séance lisible (rien n'est alors proposé : jamais d'erreur affichée). `requested` : nombre de séances
 * demandé, s'il l'a été (« séance 4 sur 6 » même si le tableau en a perdu).
 */
export function readPlan(markdown: string, requested?: number): ReadPlan | null {
  const sessions = parsePlan(markdown);
  if (sessions.length === 0) return null;
  const last = Math.max(...sessions.map(s => s.fin ?? s.numero));
  const asked = typeof requested === 'number' && Number.isInteger(requested) && requested <= PLAN_LIMITS.sessions ? requested : 0;
  return { sessions, context: extractPlanContext(markdown), total: Math.max(last, asked) };
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

/** Longueurs maximales des parties variables des consignes : avec le sujet (300 au plus), le total reste sous REQUEST_LIMITS.consignes. */
const CONSIGNES_CAPS = { context: 700, line: 900, neighbour: 250 } as const;

/**
 * Consignes de la fiche (gabarit fixe) : « Séance N sur n d'une séquence « <sujet> ». Objectifs et problématique de la
 * séquence : …. Ligne du plan : …. Séance précédente : … Séance suivante : … Respecte ce plan. » Les parties variables
 * sont tronquées proprement pour que le tout reste dans REQUEST_LIMITS.consignes ; le gabarit, lui, n'est jamais coupé.
 */
export function developConsignes(origin: PlanOrigin, plan: ReadPlan, index: number): string {
  const session = plan.sessions[index];
  const previous = plan.sessions[index - 1];
  const next = plan.sessions[index + 1];
  const objectifs = plan.context.objectifs || oneLine(origin.objectifs ?? '');
  const context = [objectifs && `objectifs : ${objectifs}`, plan.context.problematique && `problématique : ${plan.context.problematique}`]
    .filter(Boolean).join(' ; ') || 'non précisés dans le plan';
  const line = oneLine(session.ligne) || sessionMention(session, 200);
  const label = sessionLabel(session);
  const before = previous ? sessionMention(previous, CONSIGNES_CAPS.neighbour) : 'aucune (première séance de la séquence)';
  const after = next ? sessionMention(next, CONSIGNES_CAPS.neighbour) : 'aucune (dernière séance de la séquence)';
  const text = `${label.charAt(0).toUpperCase()}${label.slice(1)} sur ${plan.total} d'une séquence « ${clipText(oneLine(origin.sujet), REQUEST_LIMITS.sujet)} ». `
    + `Objectifs et problématique de la séquence : ${clipText(context, CONSIGNES_CAPS.context)}. `
    + `Ligne du plan : ${clipText(line, CONSIGNES_CAPS.line)}. `
    + `Séance précédente : ${before}. Séance suivante : ${after}. Respecte ce plan.`;
  // Garde-fou : les bornes ci-dessus tiennent largement sous la limite, ce test ne sert que si elles changent un jour.
  return clipText(text, REQUEST_LIMITS.consignes);
}

/** Ce que reçoit la page « Générer » (état du routeur) : formulaire prérempli et phrase de rappel. */
export interface DevelopPrefill {
  reuse: ReusableRecord;
  /** Rappel affiché au-dessus du formulaire à la place de « Demande reprise depuis l'historique ». */
  reuseNotice: string;
}

/**
 * Demande de l'outil « fiche de préparation » pour la séance `index` du plan : même niveau, matière et discipline ; sujet
 * « <sujet> — séance N : <titre> » ; objectifs de la ligne du plan s'ils sont lisibles ; consignes qui conservent la cohérence
 * de la séquence (developConsignes). Tout est borné aux limites d'une demande (REQUEST_LIMITS). Indice hors liste : null.
 */
export function buildDevelopPrefill(origin: PlanOrigin, plan: ReadPlan, index: number): DevelopPrefill | null {
  const session = plan.sessions[index];
  if (!session) return null;
  const objectifs = clipText(oneLine(session.objectif), REQUEST_LIMITS.objectifs);
  const params: Record<string, unknown> = {
    consignes: developConsignes(origin, plan, index),
    ...(objectifs ? { objectifs } : {}),
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
    reuseNotice: `Demande préparée à partir du plan (${sessionLabel(session)} sur ${plan.total} de la séquence « ${clipText(oneLine(origin.sujet), 120)} ») : relisez et modifiez les paramètres avant de générer, rien n'est généré automatiquement.`,
  };
}
