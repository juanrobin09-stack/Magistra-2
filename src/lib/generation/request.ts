// Construction de la demande de génération à partir du formulaire.
// Règle d'or : seuls les champs PRÉVUS par l'outil choisi (TOOL_FIELDS) et visibles au niveau choisi
// sont transmis. Aucun paramètre fantôme (valeur par défaut cachée, champ d'un autre outil).

import {
  defaultMatiereFor, isMatiereAvailableFor, isTypeContenu, PROFILS_DIFFERENCIATION, TOOL_FIELDS, TOOL_REQUIRES_SUJET,
  getMatiereLabel,
  type DifficulteExercice, type FormatSeance, type Matiere, type ProfilDifferenciation, type ProfilEleve, type TypeContenu,
  type TypeLettre,
} from '@shared/catalog';
import { rankChunks } from '@shared/documents/retrieve';
import { isNiveau, isSuperieur, type NiveauScolaire } from '@shared/levels';
import { modeUsesDocuments, type DocumentPassage, type GenerationRequest, type ResearchMode, type TeacherProfile } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';

/** Champs du formulaire (hors niveau / matière, toujours présents). */
export type FormField =
  | 'sujet' | 'discipline' | 'duree' | 'objectifs' | 'consignes' | 'difficulte' | 'format'
  | 'trimestre' | 'profilEleve' | 'nombreAppreciations' | 'profilsDifferenciation'
  | 'contenuSource' | 'typeLettre' | 'texteEleve';

export type Trimestre = '1' | '2' | '3';

/** État brut du formulaire : tout est conservé (on peut changer d'outil sans perdre sa saisie). */
export interface GenerateForm {
  type: TypeContenu;
  niveau: NiveauScolaire;
  matiere: Matiere;
  discipline: string;
  sujet: string;
  duree: string;
  objectifs: string;
  consignes: string;
  /** '' = aucune difficulté choisie (rien n'est transmis). */
  difficulte: DifficulteExercice | '';
  /** '' = aucun format choisi (rien n'est transmis). */
  format: FormatSeance | '';
  trimestre: Trimestre;
  profilEleve: ProfilEleve;
  /** Saisie brute : le champ peut être vide pendant la frappe. */
  nombreAppreciations: string;
  profilsDifferenciation: ProfilDifferenciation[];
  contenuSource: string;
  typeLettre: TypeLettre;
  texteEleve: string;
}

export const DEFAULT_APPRECIATIONS = 10;
export const MIN_APPRECIATIONS = 1;
export const MAX_APPRECIATIONS = REQUEST_LIMITS.maxAppreciations;
export const DEFAULT_NIVEAU: NiveauScolaire = '6eme';
/** Budget de caractères utilisé tant que les capacités du moteur ne sont pas connues. */
export const DEFAULT_DOCUMENT_BUDGET = 40_000;

// ─── Paramètres d'URL ───────────────────────────────────────────────────────

/** ?type= invalide ou absent → « cours ». */
export function resolveInitialType(param: string | null | undefined): TypeContenu {
  return isTypeContenu(param) ? param : 'cours';
}

/** ?sujet= prérempli, nettoyé et borné. */
export function resolveInitialSujet(param: string | null | undefined): string {
  if (!param) return '';
  return param.replaceAll('\u0000', '').trim().slice(0, REQUEST_LIMITS.sujet);
}

// ─── Valeurs par défaut ─────────────────────────────────────────────────────

/** Trimestre en cours selon la date (septembre-novembre : T1, décembre-mars : T2, avril-août : T3). */
export function defaultTrimestre(date: Date = new Date()): Trimestre {
  const m = date.getMonth(); // 0 = janvier
  if (m >= 8 && m <= 10) return '1';
  if (m === 11 || m <= 2) return '2';
  return '3';
}

/** Matière à retenir pour un niveau : la matière courante si elle existe, sinon celles du profil, sinon la première disponible. */
export function pickMatiere(niveau: NiveauScolaire, preferred: (Matiere | undefined | null)[]): Matiere {
  for (const m of preferred) {
    if (m && isMatiereAvailableFor(m, niveau)) return m;
  }
  return defaultMatiereFor(niveau);
}

export function createInitialForm(
  profile: TeacherProfile | null | undefined,
  params: { type?: string | null; sujet?: string | null } = {},
  now: Date = new Date(),
): GenerateForm {
  const niveau = profile?.niveaux?.find(n => isNiveau(n)) ?? DEFAULT_NIVEAU;
  return {
    type: resolveInitialType(params.type),
    niveau,
    matiere: pickMatiere(niveau, [profile?.matierePrincipale, profile?.matiereSecondaire]),
    discipline: (profile?.discipline ?? '').slice(0, REQUEST_LIMITS.discipline),
    sujet: resolveInitialSujet(params.sujet),
    duree: '',
    objectifs: '',
    consignes: '',
    difficulte: '',
    format: '',
    trimestre: defaultTrimestre(now),
    profilEleve: 'bon',
    nombreAppreciations: String(DEFAULT_APPRECIATIONS),
    profilsDifferenciation: PROFILS_DIFFERENCIATION.map(p => p.value),
    contenuSource: '',
    typeLettre: 'information',
    texteEleve: '',
  };
}

/** Changement de niveau : la matière est conservée si elle existe au nouveau niveau, sinon réinitialisée. */
export function withNiveau(form: GenerateForm, niveau: NiveauScolaire, profile?: TeacherProfile | null): GenerateForm {
  return {
    ...form,
    niveau,
    matiere: pickMatiere(niveau, [form.matiere, profile?.matierePrincipale, profile?.matiereSecondaire]),
  };
}

// ─── Champs visibles ────────────────────────────────────────────────────────

/**
 * Champs affichés (et donc transmis) pour un outil à un niveau donné.
 * - « Discipline / intitulé de l'UE » et « Format » (CM/TD/TP/séminaire) : supérieur uniquement ;
 * - « Trimestre » : pas de sens dans le supérieur.
 */
export function visibleFields(tool: TypeContenu, niveau: NiveauScolaire): Set<FormField> {
  const sup = isSuperieur(niveau);
  const fields = new Set<FormField>();
  for (const f of TOOL_FIELDS[tool] as readonly string[]) {
    if (f === 'format' && !sup) continue;
    if (f === 'trimestre' && sup) continue;
    fields.add(f as FormField);
  }
  if (sup) fields.add('discipline');
  return fields;
}

// ─── Nombre d'appréciations ─────────────────────────────────────────────────

/** Nombre d'appréciations réellement demandé (borné 1..40), ou null si la saisie est vide ou invalide. */
export function appreciationCount(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_APPRECIATIONS, Math.max(MIN_APPRECIATIONS, Math.round(n)));
}

/** Bornage à la sortie du champ : la saisie vide reste vide (l'enseignant est invité à la compléter). */
export function normalizeAppreciationInput(raw: string): string {
  const n = appreciationCount(raw);
  return n === null ? '' : String(n);
}

/** « Magistra rédigera N appréciations » : N est exactement le nombre qui sera demandé. */
export function appreciationSummary(raw: string, sup: boolean): string {
  const count = appreciationCount(raw);
  if (count === null) return `Indiquez un nombre entre ${MIN_APPRECIATIONS} et ${MAX_APPRECIATIONS}.`;
  const noun = sup ? (count > 1 ? 'commentaires' : 'commentaire') : count > 1 ? 'appréciations' : 'appréciation';
  const typed = Number(raw.replace(',', '.'));
  const bound = typed > MAX_APPRECIATIONS ? ` (maximum ${MAX_APPRECIATIONS})` : typed < MIN_APPRECIATIONS ? ` (minimum ${MIN_APPRECIATIONS})` : '';
  return `Magistra rédigera ${count} ${noun}${bound}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface FormProblem {
  field: FormField;
  message: string;
}

const TEXT_LIMITS: Partial<Record<FormField, { max: number; label: string }>> = {
  sujet: { max: REQUEST_LIMITS.sujet, label: 'Le sujet' },
  discipline: { max: REQUEST_LIMITS.discipline, label: 'La discipline' },
  duree: { max: REQUEST_LIMITS.duree, label: 'La durée' },
  objectifs: { max: REQUEST_LIMITS.objectifs, label: 'Les objectifs' },
  consignes: { max: REQUEST_LIMITS.consignes, label: 'Les consignes' },
  contenuSource: { max: REQUEST_LIMITS.contenuSource, label: 'Le contenu à adapter' },
  texteEleve: { max: REQUEST_LIMITS.texteEleve, label: 'Le travail à corriger' },
};

export function fieldLimit(field: FormField): number | undefined {
  return TEXT_LIMITS[field]?.max;
}

/** Tous les problèmes bloquants du formulaire pour l'outil courant (liste vide = prêt). */
export function validateForm(form: GenerateForm): FormProblem[] {
  const tool = form.type;
  const fields = visibleFields(tool, form.niveau);
  const problems: FormProblem[] = [];
  const text = (f: FormField) => String(form[f as keyof GenerateForm] ?? '').trim();

  if (fields.has('sujet') && TOOL_REQUIRES_SUJET[tool] && !text('sujet')) {
    problems.push({ field: 'sujet', message: 'Indiquez un sujet.' });
  }
  if (tool === 'corrige' && !text('texteEleve')) {
    problems.push({ field: 'texteEleve', message: 'Collez le travail à corriger.' });
  }
  if (tool === 'differenciation') {
    if (form.profilsDifferenciation.length === 0) {
      problems.push({ field: 'profilsDifferenciation', message: 'Sélectionnez au moins un profil.' });
    }
    if (!text('sujet') && !text('contenuSource')) {
      problems.push({ field: 'contenuSource', message: 'Indiquez un sujet ou collez le contenu à adapter.' });
    }
  }
  if (fields.has('nombreAppreciations') && appreciationCount(form.nombreAppreciations) === null) {
    problems.push({
      field: 'nombreAppreciations',
      message: `Indiquez un nombre d'appréciations entre ${MIN_APPRECIATIONS} et ${MAX_APPRECIATIONS}.`,
    });
  }
  for (const [field, limit] of Object.entries(TEXT_LIMITS) as [FormField, { max: number; label: string }][]) {
    if (!fields.has(field)) continue;
    if (text(field).length > limit.max) {
      problems.push({ field, message: `${limit.label} dépasse ${limit.max.toLocaleString('fr-FR')} caractères.` });
    }
  }
  return problems;
}

// ─── Requête ────────────────────────────────────────────────────────────────

function clean(value: string, max: number): string | undefined {
  const trimmed = value.replaceAll('\u0000', '').trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Construit la demande envoyée au moteur, UNIQUEMENT avec les champs de l'outil `tool`.
 * Les clés absentes ne sont pas créées (pas de `undefined` qui traînent).
 */
export function buildGenerationRequest(
  form: GenerateForm,
  tool: TypeContenu,
  profile: TeacherProfile | null | undefined,
  documents: DocumentPassage[] | null | undefined,
  researchMode: ResearchMode,
): GenerationRequest {
  const niveau = form.niveau;
  const fields = visibleFields(tool, niveau);
  const has = (f: FormField) => fields.has(f);
  const req: GenerationRequest = {
    type: tool,
    niveau,
    matiere: isMatiereAvailableFor(form.matiere, niveau) ? form.matiere : defaultMatiereFor(niveau),
    sujet: has('sujet') ? clean(form.sujet, REQUEST_LIMITS.sujet) ?? '' : '',
    researchMode,
  };

  const set = <K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K] | undefined) => {
    if (value !== undefined) req[key] = value;
  };

  if (has('discipline')) set('discipline', clean(form.discipline, REQUEST_LIMITS.discipline));
  if (has('duree')) set('duree', clean(form.duree, REQUEST_LIMITS.duree));
  if (has('objectifs')) set('objectifs', clean(form.objectifs, REQUEST_LIMITS.objectifs));
  if (has('consignes')) set('consignes', clean(form.consignes, REQUEST_LIMITS.consignes));
  if (has('difficulte') && form.difficulte) set('difficulte', form.difficulte);
  if (has('format') && form.format) set('format', form.format);
  if (has('trimestre')) set('trimestre', form.trimestre);
  if (has('profilEleve')) set('profilEleve', form.profilEleve);
  if (has('nombreAppreciations')) set('nombreAppreciations', appreciationCount(form.nombreAppreciations) ?? DEFAULT_APPRECIATIONS);
  if (has('profilsDifferenciation')) {
    const chosen = PROFILS_DIFFERENCIATION.map(p => p.value).filter(v => form.profilsDifferenciation.includes(v));
    set('profilsDifferenciation', chosen);
  }
  if (has('contenuSource')) set('contenuSource', clean(form.contenuSource, REQUEST_LIMITS.contenuSource));
  if (has('typeLettre')) set('typeLettre', form.typeLettre);
  if (has('texteEleve')) set('texteEleve', clean(form.texteEleve, REQUEST_LIMITS.texteEleve));

  if (modeUsesDocuments(researchMode) && documents && documents.length > 0) {
    req.documents = fitPassagesToLimits(documents, buildPassageQuery(form, tool));
  }
  req.profile = profile ?? null;
  return req;
}

/**
 * Texte servant à choisir les passages utiles des documents :
 * sujet + discipline + objectifs + consignes (champs de l'outil uniquement).
 */
export function buildPassageQuery(form: GenerateForm, tool: TypeContenu = form.type): string {
  const fields = visibleFields(tool, form.niveau);
  const parts = (['sujet', 'discipline', 'objectifs', 'consignes'] as const)
    .filter(f => fields.has(f))
    .map(f => form[f].trim())
    .filter(Boolean);
  const query = parts.join(' ').trim();
  return query || getMatiereLabel(form.matiere);
}

/**
 * Garantit que les extraits respectent les limites acceptées par le serveur
 * (nombre d'extraits, taille par extrait, taille totale). Au-delà, les plus pertinents sont gardés,
 * dans l'ordre de lecture.
 */
export function fitPassagesToLimits(passages: DocumentPassage[], query: string, limits = REQUEST_LIMITS): DocumentPassage[] {
  const trimmed = passages
    .map(p => ({ ...p, text: p.text.length > limits.passageChars ? p.text.slice(0, limits.passageChars) : p.text }))
    .filter(p => p.text.trim().length > 0);
  const total = trimmed.reduce((n, p) => n + p.text.length, 0);
  if (trimmed.length <= limits.maxPassages && total <= limits.documentsChars) return trimmed;

  const ranked = rankChunks(trimmed.map((p, i) => ({ ...p, order: i })), query)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const keep = new Set<number>();
  let used = 0;
  for (const p of ranked) {
    if (keep.size >= limits.maxPassages) break;
    if (used + p.text.length > limits.documentsChars) continue;
    keep.add(p.order);
    used += p.text.length;
  }
  return trimmed.filter((_, i) => keep.has(i));
}
