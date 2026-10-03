// Construction de la demande de génération à partir du formulaire.
// Règle d'or : seuls les champs PRÉVUS par l'outil choisi (TOOL_FIELDS) et visibles au niveau choisi
// sont transmis. Aucun paramètre fantôme (valeur par défaut cachée, champ d'un autre outil).

import {
  defaultMatiereFor, isMatiereAvailableFor, isTypeContenu, PROFILS_DIFFERENCIATION, TOOL_FIELDS, TOOL_REQUIRES_SUJET,
  getMatiereLabel,
  type DifficulteExercice, type FormatSeance, type Matiere, type ProfilDifferenciation, type ProfilEleve, type TypeContenu,
  type TypeLettre,
} from '@shared/catalog';
import { isClozeRequest } from '@shared/cloze';
import { rankChunks, type QueryPart } from '@shared/documents/retrieve';
import {
  BESOINS_PARTICULIERS, countUnit, isModaliteAvailable, modalitesFor,
  type Bareme, type BesoinParticulier, type CountUnit, type TonRedaction, type TypeEvaluation,
} from '@shared/formats';
import { getLevelGroup, isNiveau, isSuperieur, type NiveauScolaire } from '@shared/levels';
import { modeUsesDocuments, type DocumentPassage, type GenerationRequest, type ResearchMode, type TeacherProfile } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';

/** Champs du formulaire (hors niveau / matière, toujours présents). */
export type FormField =
  | 'sujet' | 'discipline' | 'duree' | 'objectifs' | 'consignes' | 'difficulte' | 'format'
  | 'trimestre' | 'profilEleve' | 'nombreAppreciations' | 'profilsDifferenciation'
  | 'contenuSource' | 'typeLettre' | 'texteEleve'
  | 'modalite' | 'typeEvaluation' | 'bareme' | 'sansCorrige' | 'nombreExercices' | 'nombreSeances' | 'planSeulement' | 'ton' | 'besoins';

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
  /** Format normé (shared/formats.ts) ; '' = au choix de Magistra. Transmis seulement s'il convient à l'outil, au niveau et à la matière. */
  modalite: string;
  /** '' = non précisé (rien n'est transmis), comme les autres choix facultatifs ci-dessous. */
  typeEvaluation: TypeEvaluation | '';
  bareme: Bareme | '';
  /** Vrai : version élève seule, sans corrigé. */
  sansCorrige: boolean;
  nombreExercices: number | '';
  nombreSeances: number | '';
  /** Vrai : séquence en deux temps, le plan d'abord (puis « Développer une séance »). Faux : séquence complète. */
  planSeulement: boolean;
  ton: TonRedaction | '';
  besoins: BesoinParticulier[];
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
    modalite: '',
    typeEvaluation: '',
    bareme: '',
    sansCorrige: false,
    nombreExercices: '',
    nombreSeances: '',
    planSeulement: false,
    ton: '',
    besoins: [],
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

/** Champs sans objet en maternelle : ni note, ni corrigé écrit, ni évaluation chiffrée. */
const NOT_IN_MATERNELLE: ReadonlySet<string> = new Set(['bareme', 'typeEvaluation', 'sansCorrige']);

/**
 * Champs sans objet avec un format donné : masqués, donc jamais transmis.
 * Livret scolaire (bac) : appréciation annuelle pour le jury, aucun trimestre ne s'y rapporte.
 */
const HIDDEN_BY_MODALITE: ReadonlyMap<string, readonly FormField[]> = new Map([
  ['livret_bac', ['trimestre']],
]);

/**
 * Champs affichés (et donc transmis) pour un outil à un niveau donné.
 * - « Discipline / intitulé de l'UE » et « Format » (CM/TD/TP/séminaire) : supérieur uniquement ;
 * - « Trimestre » : pas de sens dans le supérieur, ni pour une appréciation annuelle (livret scolaire) choisie comme
 *   format (`modalite`) ;
 * - notation, objectif de l'évaluation, corrigé : pas en maternelle ;
 * - format normé : seulement s'il en existe pour cet outil, ce niveau et cette matière (`matiere` fournie) ;
 * - nombre d'exercices : pas pour un travail d'un seul tenant (dissertation, dictée…) choisi comme format (`modalite`).
 * Un format gardé d'un autre outil, niveau ou matière ne masque rien (il n'est pas transmis).
 */
export function visibleFields(tool: TypeContenu, niveau: NiveauScolaire, matiere?: Matiere, modalite?: string): Set<FormField> {
  const sup = isSuperieur(niveau);
  const maternelle = getLevelGroup(niveau) === 'maternelle';
  const chosen = matiere && isModaliteAvailable(modalite, tool, niveau, matiere) ? modalite : undefined;
  const single = !!chosen && countUnit(chosen) === null;
  const hiddenByFormat = (chosen && HIDDEN_BY_MODALITE.get(chosen)) || [];
  const fields = new Set<FormField>();
  for (const f of TOOL_FIELDS[tool] as readonly string[]) {
    if (f === 'format' && !sup) continue;
    if (f === 'trimestre' && sup) continue;
    if (maternelle && NOT_IN_MATERNELLE.has(f)) continue;
    if (f === 'modalite' && matiere && modalitesFor(tool, niveau, matiere).length === 0) continue;
    if (f === 'nombreExercices' && single) continue;
    if (hiddenByFormat.includes(f as FormField)) continue;
    fields.add(f as FormField);
  }
  if (sup) fields.add('discipline');
  return fields;
}

/**
 * Nombre choisi, s'il fait partie des nombres proposés pour ce qui se compte (un nombre gardé d'un autre format,
 * « 12 » questions devenues des problèmes par exemple, revient à « Auto ») : ce qui est affiché est ce qui est transmis.
 */
export function chosenCount(value: number | '', unit: CountUnit): number | '' {
  return typeof value === 'number' && unit.options.includes(value) ? value : '';
}

// ─── Plan d'abord (grosse séquence) ─────────────────────────────────────────

/** À partir de ce nombre de séances, le formulaire suggère de commencer par le plan (jamais de bascule automatique). */
export const PLAN_ADVICE_MIN_SEANCES = 5;

/** Durée « très longue » : plusieurs semaines, une dizaine d'heures ou plus, un mois, un trimestre, un semestre, l'année. */
const LONG_PERIOD_RE = /(?<![\p{L}\d])(?:mois|trimestres?|semestres?|ann[ée]e)(?![\p{L}\d])/iu;
const WEEKS_RE = /(\d{1,3}) ?(?:semaines?|sem\.?)(?![\p{L}])/iu;
const HOURS_RE = /(\d{1,3}) ?(?:heures?|h)(?![\p{L}])/iu;
/** Seuils de la durée saisie en texte libre (REQUEST_LIMITS.duree : 80 caractères au plus). */
const LONG_WEEKS = 3;
const LONG_HOURS = 10;

/**
 * La séquence demandée est-elle assez grosse pour que le formulaire propose de commencer par le plan ? Oui à partir de
 * PLAN_ADVICE_MIN_SEANCES séances, ou si la durée saisie est très longue (3 semaines, 10 heures, un mois, un trimestre…).
 * Texte libre : tout ce qui n'est pas reconnu compte pour « pas long » (aucun conseil, aucun effet sur la demande).
 */
export function isLargeSequence(nombreSeances: number | '', duree: string): boolean {
  if (typeof nombreSeances === 'number' && nombreSeances >= PLAN_ADVICE_MIN_SEANCES) return true;
  const text = duree.slice(0, REQUEST_LIMITS.duree);
  if (LONG_PERIOD_RE.test(text)) return true;
  const weeks = WEEKS_RE.exec(text);
  if (weeks && Number(weeks[1]) >= LONG_WEEKS) return true;
  const hours = HOURS_RE.exec(text);
  return Boolean(hours && Number(hours[1]) >= LONG_HOURS);
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
  const fields = visibleFields(tool, form.niveau, form.matiere);
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
  const matiere = isMatiereAvailableFor(form.matiere, niveau) ? form.matiere : defaultMatiereFor(niveau);
  const fields = visibleFields(tool, niveau, matiere, form.modalite);
  const has = (f: FormField) => fields.has(f);
  const req: GenerationRequest = {
    type: tool,
    niveau,
    matiere,
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
  // Format gardé d'un autre outil, niveau ou matière : transmis seulement s'il convient à la demande actuelle.
  if (has('modalite') && isModaliteAvailable(form.modalite, tool, niveau, matiere)) set('modalite', form.modalite);
  if (has('typeEvaluation') && form.typeEvaluation) set('typeEvaluation', form.typeEvaluation);
  if (has('bareme') && form.bareme) set('bareme', form.bareme);
  if (has('sansCorrige') && form.sansCorrige) set('sansCorrige', true);
  if (has('nombreExercices')) {
    const unit = countUnit(req.modalite, getLevelGroup(niveau));
    const count = unit ? chosenCount(form.nombreExercices, unit) : '';
    if (count) set('nombreExercices', count);
  }
  if (has('nombreSeances') && form.nombreSeances) set('nombreSeances', form.nombreSeances);
  // Formulaire d'une version antérieure (sans ce champ) : séquence complète.
  if (has('planSeulement') && form.planSeulement === true) set('planSeulement', true);
  if (has('ton') && form.ton) set('ton', form.ton);
  // Formulaire d'une version antérieure (sans ce champ) : aucun besoin.
  const besoins = form.besoins ?? [];
  if (has('besoins') && besoins.length) set('besoins', BESOINS_PARTICULIERS.map(b => b.value).filter(v => besoins.includes(v)));

  if (modeUsesDocuments(researchMode) && documents && documents.length > 0) {
    req.documents = fitPassagesToLimits(documents, buildWeightedPassageQuery(form, tool));
  }
  req.profile = profile ?? null;
  return req;
}

// ─── Notation par défaut ────────────────────────────────────────────────────

/**
 * Sujets type examen national (brevet, baccalauréat, bac professionnel) : Magistra en reprend la structure et le
 * barème (points des parties, maîtrise de la langue). Sans notation choisie, c'est ce barème qui s'applique, même pour
 * une évaluation diagnostique : le format de l'épreuve prime sur l'objectif.
 */
export const FORMATS_BAREME_OFFICIEL: readonly string[] = ['sujet_brevet', 'sujet_bac', 'sujet_bac_pro'];

/** Barèmes officiels qui ne tiennent pas en une note sur 20 (consigne du format : shared/formats.ts). */
const BAREME_OFFICIEL_DETAIL: Readonly<Record<string, Partial<Record<Matiere, string>>>> = {
  sujet_brevet: { histoire_geo: 'histoire-géographie sur 40, EMC sur 20' },
};

/** Notation que Magistra demandera si l'enseignant n'en choisit aucune. */
export interface DefaultNotation {
  /** Libellé du choix par défaut. */
  label: string;
  /** Cette notation en quelques mots (infobulle du choix par défaut). */
  title: string;
  /** Rappel affiché sous les choix : « Par défaut : … ». */
  hint: string;
}

type NotationRequest = Pick<GenerationRequest, 'type' | 'niveau' | 'matiere' | 'modalite' | 'typeEvaluation' | 'sansCorrige'>;

/**
 * Notation par défaut d'une demande, telle que la consigne de l'outil la demande (shared/prompts/tools.ts) :
 * - correction d'une copie : positionnement sans note à l'école primaire, note indicative sur 20 ailleurs ;
 * - exercices : jamais de note sur 20 imposée. Barème indicatif dans le corrigé au collège et au lycée, critères de
 *   réussite sans note à l'école primaire ; aucun barème imposé dans le supérieur (éléments de correction), pour une
 *   version élève seule ou pour un texte à trous (corrigé établi par Magistra) ;
 * - évaluation : positionnement sans note à l'école primaire ; barème de l'épreuve pour un sujet type examen
 *   (FORMATS_BAREME_OFFICIEL), qui prime sur l'objectif ; sans note pour une évaluation diagnostique ; sur 20 sinon.
 */
export function defaultNotation(req: NotationRequest): DefaultNotation {
  const group = getLevelGroup(req.niveau);
  const primary = group === 'maternelle' || group === 'elementaire';
  const byLevel = (title: string, hint: string): DefaultNotation => ({ label: 'Selon le niveau', title, hint: `Par défaut : ${hint}.` });
  const positionnement = byLevel('Positionnement sans note', 'positionnement sans note');

  if (req.type === 'corrige') return primary ? positionnement : byLevel('Note indicative sur 20', 'note indicative sur 20');

  if (req.type === 'exercices') {
    const withKey = !req.sansCorrige && !isClozeRequest(req);
    if (withKey && primary) return byLevel('Sans note', 'sans note (critères de réussite dans le corrigé)');
    if (withKey && !isSuperieur(req.niveau)) return byLevel('Barème indicatif', 'barème indicatif dans le corrigé');
    return byLevel('Sans barème imposé', 'sans barème imposé');
  }

  if (primary) return positionnement;
  if (req.modalite && FORMATS_BAREME_OFFICIEL.includes(req.modalite)) {
    const detail = BAREME_OFFICIEL_DETAIL[req.modalite]?.[req.matiere];
    const notation = detail ? `barème officiel de l’épreuve (${detail})` : 'note sur 20, sur le modèle de l’épreuve';
    const objective = req.typeEvaluation === 'diagnostique' ? ' Le format de l’épreuve prime sur l’objectif diagnostique.' : '';
    return {
      label: 'Selon l’épreuve',
      title: detail ? 'Barème officiel de l’épreuve' : 'Note sur 20 (modèle de l’épreuve)',
      hint: `Par défaut : ${notation}.${objective}`,
    };
  }
  if (req.typeEvaluation === 'diagnostique') {
    return { label: 'Selon l’objectif', title: 'Sans note', hint: 'Par défaut : sans note (évaluation diagnostique).' };
  }
  return byLevel('Note sur 20', 'note sur 20');
}

/**
 * Notation par défaut de la demande que le formulaire enverrait : seuls les champs transmis comptent (un objectif ou
 * un format gardé d'un autre outil, niveau ou matière est ignoré). Documents et mode de recherche n'y changent rien.
 */
export function formDefaultNotation(form: GenerateForm): DefaultNotation {
  return defaultNotation(buildGenerationRequest(form, form.type, null, null, 'internet'));
}

/** Part du texte collé (texte à adapter, copie d'élève) reprise dans la requête quand le sujet ne dit presque rien. */
const SOURCE_QUERY_CHARS = 300;
/** En dessous, sujet + objectifs sont jugés trop courts pour décrire ce que les documents doivent éclairer. */
const SHORT_TOPIC_CHARS = 40;
/** Poids des morceaux de la requête : le sujet décrit ce que les documents doivent éclairer, les consignes beaucoup moins. */
const QUERY_WEIGHTS = { sujet: 3, discipline: 1.5, source: 2, objectifs: 1, consignes: 1 } as const;

/**
 * Morceaux pondérés de la requête qui sert à choisir les passages utiles des documents : sujet, discipline, objectifs
 * et consignes (champs de l'outil uniquement). Pour la différenciation et la correction, le sujet est facultatif :
 * quand il (avec les objectifs) tient en moins de 40 caractères, le début du texte à adapter ou de la copie complète
 * la requête, sinon elle se réduirait au nom de la matière. La requête ne sert qu'au classement des passages : elle
 * n'est transmise à personne.
 */
export function buildWeightedPassageQuery(form: GenerateForm, tool: TypeContenu = form.type): QueryPart[] {
  const fields = visibleFields(tool, form.niveau, form.matiere);
  const parts: QueryPart[] = [];
  for (const f of ['sujet', 'discipline', 'objectifs', 'consignes'] as const) {
    const text = fields.has(f) ? form[f].trim() : '';
    if (text) parts.push({ text, weight: QUERY_WEIGHTS[f] });
  }
  const topicLength = (['sujet', 'objectifs'] as const)
    .filter(f => fields.has(f))
    .reduce((n, f) => n + form[f].trim().length, 0);
  if (topicLength < SHORT_TOPIC_CHARS) {
    for (const f of ['contenuSource', 'texteEleve'] as const) {
      if (!fields.has(f)) continue;
      const excerpt = form[f].slice(0, SOURCE_QUERY_CHARS * 4).replace(/\s+/g, ' ').trim().slice(0, SOURCE_QUERY_CHARS);
      if (excerpt) parts.push({ text: excerpt, weight: QUERY_WEIGHTS.source });
    }
  }
  return parts.length > 0 ? parts : [{ text: getMatiereLabel(form.matiere), weight: 1 }];
}

/** Même requête, en un seul texte (sujet + discipline + objectifs + consignes). */
export function buildPassageQuery(form: GenerateForm, tool: TypeContenu = form.type): string {
  return buildWeightedPassageQuery(form, tool).map(p => p.text).join(' ');
}

/**
 * Garantit que les extraits respectent les limites acceptées par le serveur
 * (nombre d'extraits, taille par extrait, taille totale). Au-delà, les plus pertinents sont gardés,
 * dans l'ordre de lecture.
 */
export function fitPassagesToLimits(passages: DocumentPassage[], query: string | readonly QueryPart[], limits = REQUEST_LIMITS): DocumentPassage[] {
  const trimmed = passages
    .map(p => ({ ...p, text: p.text.length > limits.passageChars ? p.text.slice(0, limits.passageChars) : p.text }))
    .filter(p => p.text.trim().length > 0);
  const total = trimmed.reduce((n, p) => n + p.text.length, 0);
  if (trimmed.length <= limits.maxPassages && total <= limits.documentsChars) return trimmed;

  const ranked = rankChunks(trimmed.map((p, i) => ({ ...p, order: i })), query, undefined, undefined, { dropGenericQueryWords: true })
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
