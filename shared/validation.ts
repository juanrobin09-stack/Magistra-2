// Validation et nettoyage des demandes de génération (côté serveur ET côté application Windows).
// Protections techniques : tailles bornées, listes blanches, aucun champ hors de l'outil choisi.

import {
  defaultMatiereFor, isMatiere, isTypeContenu, TOOL_FIELDS, TOOL_REQUIRES_SUJET,
  type DifficulteExercice, type FormatSeance, type ProfilDifferenciation, type ProfilEleve, type TypeContenu, type TypeLettre,
} from './catalog.js';
import { MagistraError } from './errors.js';
import {
  BAREMES, BESOINS_PARTICULIERS, countUnit, isModaliteAvailable, LIMITES_NOMBRES, TONS, TYPES_EVALUATION,
  type Bareme, type BesoinParticulier, type TonRedaction, type TypeEvaluation,
} from './formats.js';
import { isNiveau } from './levels.js';
import {
  isResearchMode, RESEARCH_MODES, type DocKind, type DocumentPassage, type GenerationRecordDraft, type GenerationRequest, type Locator,
  type ResearchMode, type SourceKind, type SourceRef, type TeacherProfile,
} from './types.js';

export const REQUEST_LIMITS = {
  sujet: 300,
  discipline: 150,
  duree: 80,
  objectifs: 2_000,
  consignes: 3_000,
  contenuSource: 15_000,
  texteEleve: 20_000,
  maxPassages: 60,
  passageChars: 12_000,
  docName: 200,
  /** Plafond absolu des extraits de documents acceptés par requête. */
  documentsChars: 120_000,
  maxAppreciations: 40,
  bodyBytes: 1_000_000,
};

const DIFFICULTES: DifficulteExercice[] = ['facile', 'moyen', 'difficile', 'differencie'];
const FORMATS: FormatSeance[] = ['cm', 'td', 'tp', 'seminaire'];
const LETTRES: TypeLettre[] = ['comportement', 'absence', 'felicitations', 'reunion', 'incident', 'orientation', 'information'];
const PROFILS: ProfilEleve[] = ['excellent', 'bon', 'moyen', 'fragile', 'decrocheur'];
const DIFF_PROFILS: ProfilDifferenciation[] = ['renforce', 'standard', 'approfondissement'];
const DOC_KINDS: DocKind[] = ['pdf', 'docx', 'pptx', 'txt', 'md'];
const LOCATOR_TYPES: Locator['type'][] = ['pages', 'slides', 'section', 'paragraphs', 'lines'];
const RESEARCH_MODE_VALUES: ResearchMode[] = RESEARCH_MODES.map(m => m.value);
const EVALUATIONS: TypeEvaluation[] = TYPES_EVALUATION.map(t => t.value);
const BAREME_VALUES: Bareme[] = BAREMES.map(b => b.value);
const TON_VALUES: TonRedaction[] = TONS.map(t => t.value);
const BESOINS: BesoinParticulier[] = BESOINS_PARTICULIERS.map(b => b.value);
/** Identifiant de format enregistré avec une génération (liste ouverte : une application plus récente peut en ajouter). */
const MODALITE_ID = /^[a-z][a-z_]{0,39}$/;

/**
 * Retire les caractères de contrôle invisibles (sauf tabulation et retours à la ligne) et les demi-paires de substitution
 * isolées (un texte coupé au milieu d'un emoji : JSON refusé par certains fournisseurs d'IA, U+FFFD après un aller-retour
 * UTF-8). Une paire complète (« ch » de deux unités) est conservée.
 */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) continue;
    if (ch.length === 1 && code >= 0xd800 && code <= 0xdfff) continue;
    out += ch;
  }
  return out;
}

function str(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new MagistraError('INVALID_REQUEST', `Champ « ${field} » invalide.`);
  const trimmed = stripControlChars(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new MagistraError('INVALID_REQUEST', `Le champ « ${field} » est trop long (${max} caractères maximum).`);
  return trimmed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Entier dans les bornes, sinon undefined (choix facultatif ignoré). */
function boundedInteger(value: unknown, bounds: { min: number; max: number }): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= bounds.min && value <= bounds.max ? value : undefined;
}

/** N'ajoute la clé que si la valeur existe (pas de clé « undefined » dans la demande). */
function setIfDefined<K extends keyof GenerationRequest>(req: GenerationRequest, key: K, value: GenerationRequest[K] | undefined): void {
  if (value !== undefined) req[key] = value;
}

const PAGE_LABEL = /^[\p{L}\p{N}][\p{L}\p{N}.\- ]{0,19}$/u;

/** Étiquettes de pages imprimées : conservées seulement si elles sont courtes et ordinaires. */
export function validateLocatorLabels(value: unknown): Locator['labels'] | undefined {
  const v = value as { start?: unknown; end?: unknown } | undefined;
  if (!v || typeof v !== 'object') return undefined;
  const start = typeof v.start === 'string' ? v.start.trim() : '';
  const end = typeof v.end === 'string' ? v.end.trim() : '';
  return PAGE_LABEL.test(start) && PAGE_LABEL.test(end) ? { start, end } : undefined;
}

function validateLocator(value: unknown): Locator {
  const v = value as Partial<Locator> | undefined;
  const type = oneOf(v?.type, LOCATOR_TYPES);
  const start = Number(v?.start);
  const end = Number(v?.end);
  if (!type || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 1_000_000) {
    throw new MagistraError('INVALID_REQUEST', 'Localisation de document invalide.');
  }
  const title = typeof v?.title === 'string' ? v.title.slice(0, 200) : undefined;
  const labels = type === 'pages' ? validateLocatorLabels(v?.labels) : undefined;
  return { type, start, end, ...(title ? { title } : {}), ...(labels ? { labels } : {}) };
}

function validatePassages(value: unknown): DocumentPassage[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new MagistraError('INVALID_REQUEST', 'Documents invalides.');
  if (value.length > REQUEST_LIMITS.maxPassages) throw new MagistraError('DOCUMENT_TOO_LARGE', 'Trop d’extraits de documents.');
  let total = 0;
  const out: DocumentPassage[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Extrait de document invalide.');
    const p = raw as Partial<DocumentPassage>;
    const text = str(p.text, REQUEST_LIMITS.passageChars, 'extrait');
    if (!text) continue;
    total += text.length;
    if (total > REQUEST_LIMITS.documentsChars) throw new MagistraError('DOCUMENT_TOO_LARGE', 'Les extraits de documents dépassent la taille autorisée.');
    out.push({
      docId: str(p.docId, 100, 'identifiant de document') ?? 'doc',
      docName: str(p.docName, REQUEST_LIMITS.docName, 'nom de document') ?? 'Document',
      kind: oneOf(p.kind, DOC_KINDS) ?? 'txt',
      locator: validateLocator(p.locator),
      text,
    });
  }
  return out.length ? out : undefined;
}

/** Nombre d'appréciations : 10 par défaut, sinon un entier entre 1 et 40 (sinon erreur explicite). */
function validateCount(value: unknown): number {
  if (value === undefined || value === null || value === '') return 10;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || Math.round(n) < 1 || Math.round(n) > REQUEST_LIMITS.maxAppreciations) {
    throw new MagistraError('INVALID_REQUEST', `Le nombre d'appréciations doit être compris entre 1 et ${REQUEST_LIMITS.maxAppreciations}.`);
  }
  return Math.round(n);
}

/**
 * Valide un profil enseignant reçu (JSON non fiable) : champs bornés, niveaux et matières en liste blanche,
 * champs inconnus ignorés. Renvoie null si l'entrée n'est pas un objet ; lève INVALID_REQUEST
 * (message lisible) si un champ texte est trop long ou d'un type incorrect.
 */
export function validateProfile(value: unknown): TeacherProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Partial<TeacherProfile>;
  return {
    displayName: str(p.displayName, 120, 'nom') ?? '',
    etablissement: str(p.etablissement, 200, 'établissement') ?? '',
    cycle: str(p.cycle, 40, 'cycle') ?? '',
    niveaux: Array.isArray(p.niveaux) ? p.niveaux.filter(isNiveau).slice(0, 40) : [],
    matierePrincipale: isMatiere(p.matierePrincipale) ? p.matierePrincipale : 'autre',
    matiereSecondaire: isMatiere(p.matiereSecondaire) && p.matiereSecondaire !== p.matierePrincipale ? p.matiereSecondaire : undefined,
    discipline: str(p.discipline, REQUEST_LIMITS.discipline, 'spécialité'),
  };
}

/** Profil relu depuis un stockage (navigateur, cache) : invalide ou illisible → null, jamais d'exception. */
export function safeStoredProfile(value: unknown): TeacherProfile | null {
  try {
    return validateProfile(value);
  } catch {
    return null;
  }
}

/**
 * Valide une demande reçue (JSON non fiable) et ne conserve que les champs utiles à l'outil choisi.
 * Lève MagistraError('INVALID_REQUEST') avec un message explicite en cas de problème.
 */
export function validateGenerationRequest(input: unknown): GenerationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MagistraError('INVALID_REQUEST');
  const raw = input as Record<string, unknown>;
  if (!isTypeContenu(raw.type)) throw new MagistraError('INVALID_REQUEST', 'Type de contenu inconnu.');
  if (!isNiveau(raw.niveau)) throw new MagistraError('INVALID_REQUEST', 'Niveau inconnu.');
  const type = raw.type;
  const niveau = raw.niveau;
  const matiere = isMatiere(raw.matiere) ? raw.matiere : defaultMatiereFor(niveau);
  const fields = TOOL_FIELDS[type];
  const allowed = (f: string) => fields.includes(f);

  const req: GenerationRequest = {
    type,
    niveau,
    matiere,
    discipline: str(raw.discipline, REQUEST_LIMITS.discipline, 'discipline'),
    sujet: allowed('sujet') ? str(raw.sujet, REQUEST_LIMITS.sujet, 'sujet') ?? '' : '',
    researchMode: isResearchMode(raw.researchMode) ? raw.researchMode : 'documents',
  };

  if (allowed('duree')) req.duree = str(raw.duree, REQUEST_LIMITS.duree, 'durée');
  if (allowed('objectifs')) req.objectifs = str(raw.objectifs, REQUEST_LIMITS.objectifs, 'objectifs');
  if (allowed('consignes')) req.consignes = str(raw.consignes, REQUEST_LIMITS.consignes, 'consignes');
  if (allowed('difficulte')) req.difficulte = oneOf(raw.difficulte, DIFFICULTES);
  if (allowed('format')) req.format = oneOf(raw.format, FORMATS);
  if (allowed('trimestre')) req.trimestre = oneOf(raw.trimestre, ['1', '2', '3'] as const);
  if (allowed('profilEleve')) req.profilEleve = oneOf(raw.profilEleve, PROFILS) ?? 'bon';
  if (allowed('nombreAppreciations')) req.nombreAppreciations = validateCount(raw.nombreAppreciations);
  if (allowed('profilsDifferenciation')) {
    const list = Array.isArray(raw.profilsDifferenciation)
      ? [...new Set(raw.profilsDifferenciation.filter((p): p is ProfilDifferenciation => DIFF_PROFILS.includes(p as ProfilDifferenciation)))]
      : [];
    req.profilsDifferenciation = list.length ? list : [...DIFF_PROFILS];
  }
  if (allowed('contenuSource')) req.contenuSource = str(raw.contenuSource, REQUEST_LIMITS.contenuSource, 'contenu à adapter');
  if (allowed('typeLettre')) req.typeLettre = oneOf(raw.typeLettre, LETTRES) ?? 'information';
  if (allowed('texteEleve')) req.texteEleve = str(raw.texteEleve, REQUEST_LIMITS.texteEleve, 'travail à corriger');
  // Options des outils : une valeur inconnue ou hors de propos (format d'une autre matière, nombre hors bornes) est
  // ignorée, comme les autres choix facultatifs ; la génération se fait alors sans cette précision.
  if (allowed('modalite') && isModaliteAvailable(raw.modalite, type, niveau, matiere)) req.modalite = raw.modalite;
  // Livret scolaire : appréciations annuelles, sans trimestre (un site ou un historique plus ancien peut l'envoyer).
  if (req.modalite === 'livret_bac') delete req.trimestre;
  if (allowed('typeEvaluation')) setIfDefined(req, 'typeEvaluation', oneOf(raw.typeEvaluation, EVALUATIONS));
  if (allowed('bareme')) setIfDefined(req, 'bareme', oneOf(raw.bareme, BAREME_VALUES));
  if (allowed('sansCorrige') && raw.sansCorrige === true) req.sansCorrige = true;
  // Travail d'un seul tenant (dissertation, dictée…) : un nombre d'exercices n'a pas de sens, il est ignoré.
  if (allowed('nombreExercices') && countUnit(req.modalite) !== null) {
    setIfDefined(req, 'nombreExercices', boundedInteger(raw.nombreExercices, LIMITES_NOMBRES.exercices));
  }
  if (allowed('nombreSeances')) setIfDefined(req, 'nombreSeances', boundedInteger(raw.nombreSeances, LIMITES_NOMBRES.seances));
  // Séquence en deux temps (plan d'abord) : booléen strict, comme « sansCorrige » ; ignoré hors de l'outil séquence.
  if (allowed('planSeulement') && raw.planSeulement === true) req.planSeulement = true;
  if (allowed('ton')) setIfDefined(req, 'ton', oneOf(raw.ton, TON_VALUES));
  if (allowed('besoins') && Array.isArray(raw.besoins)) {
    const besoins = BESOINS.filter(b => (raw.besoins as unknown[]).includes(b));
    if (besoins.length) req.besoins = besoins;
  }

  req.documents = req.researchMode === 'internet' ? undefined : validatePassages(raw.documents);
  req.profile = validateProfile(raw.profile);

  if (TOOL_REQUIRES_SUJET[type] && !req.sujet) throw new MagistraError('INVALID_REQUEST', 'Indiquez un sujet.');
  if (type === 'corrige' && !req.texteEleve) throw new MagistraError('INVALID_REQUEST', 'Collez le travail à corriger.');
  if (type === 'differenciation' && !req.sujet && !req.contenuSource) {
    throw new MagistraError('INVALID_REQUEST', 'Indiquez un sujet ou collez le contenu à adapter.');
  }
  return req;
}

// ─── Génération à enregistrer (POST /api/generation) ────────────────────────
//
// Une génération faite par Magistra locale (application Windows, à la demande du site via le connecteur) revient au
// navigateur dans l'évènement « done » (champ `record`), puis le site l'enregistre dans l'historique du compte. Le
// serveur ne l'a PAS produite : tout le contenu est une entrée non fiable, revalidée ici champ par champ (listes
// blanches, tailles bornées, caractères de contrôle retirés). L'identifiant, la date, le favori et l'utilisateur ne
// sont jamais lus dans le corps : le stockage les attribue, sous l'utilisateur du jeton vérifié.

/** Bornes d'une génération à enregistrer (au-delà : INVALID_REQUEST, rien n'est tronqué en silence). */
export const RECORD_LIMITS = {
  /** Sujet affiché dans l'historique (sujet saisi ≤ 300, ou libellé construit par displaySujet). */
  sujet: 400,
  contenu: 200_000,
  discipline: REQUEST_LIMITS.discipline,
  /**
   * Nom du modèle : même borne que les noms acceptés par l'application Windows (modèle personnalisé ou distant, jusqu'à
   * 200 caractères : electron/validate.ts) — sinon chaque génération locale d'un tel modèle serait refusée en entier.
   */
  model: 200,
  maxSources: 100,
  /** Numéro de citation [n] le plus grand accepté. */
  maxSourceNumber: 999,
  sourceTitle: 500,
  maxAuthors: 20,
  author: 200,
  venue: 300,
  doi: 200,
  url: 2_000,
  docName: REQUEST_LIMITS.docName,
  /** Titre de section d'un emplacement de document (même borne que validateLocator). */
  locatorTitle: 200,
  /** Noms des documents utilisés, conservés dans les paramètres (DOCUMENT_LIMITS.maxDocuments = 12). */
  maxDocumentNames: 20,
} as const;

/** Toutes les origines de source connues (Record : un nouveau SourceKind oublié ici ne compile pas). */
const SOURCE_KINDS: Readonly<Record<SourceKind, true>> = {
  document: true, hal: true, crossref: true, openalex: true, web: true, institutional: true, wikipedia: true,
};

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_KINDS, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRecord(message: string): MagistraError {
  return new MagistraError('INVALID_REQUEST', message);
}

/** Booléen facultatif : absent → undefined ; présent → true ou false exactement. */
function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw invalidRecord(`Champ « ${field} » invalide.`);
  return value;
}

/** « Plan d'abord » : booléen strict, et seulement pour une séquence (les autres outils n'ont pas cette option). */
function optionalPlanSeulement(value: unknown, type: TypeContenu): boolean | undefined {
  const planSeulement = optionalBoolean(value, 'plan d’abord');
  if (planSeulement !== undefined && !TOOL_FIELDS[type].includes('planSeulement')) throw invalidRecord('Champ « plan d’abord » invalide.');
  return planSeulement;
}

/** Entier facultatif dans [min, max] (jamais converti depuis une chaîne). */
function optionalInteger(value: unknown, min: number, max: number, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalidRecord(`Champ « ${field} » invalide.`);
  }
  return value;
}

/** Identifiant de format facultatif (liste ouverte, forme stricte) : toute autre valeur est refusée. */
function optionalModaliteId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !MODALITE_ID.test(value)) throw invalidRecord('Champ « format » invalide.');
  return value;
}

/** Valeur facultative d'une liste blanche : toute autre valeur est refusée (jamais remplacée en silence). */
function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  const v = oneOf(value, allowed);
  if (v === undefined) throw invalidRecord(`Champ « ${field} » invalide.`);
  return v;
}

/** Liste facultative de textes courts, dédoublonnée ; vide → undefined. */
function optionalTextList(value: unknown, maxItems: number, maxChars: number, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) throw invalidRecord(`Champ « ${field} » invalide.`);
  const out: string[] = [];
  for (const item of value) {
    const text = str(item, maxChars, field);
    if (text !== undefined && !out.includes(text)) out.push(text);
  }
  return out.length ? out : undefined;
}

/** Liste facultative de valeurs d'une liste blanche, dédoublonnée ; vide → undefined. */
function optionalOneOfList<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > allowed.length) throw invalidRecord(`Champ « ${field} » invalide.`);
  const out: T[] = [];
  for (const item of value) {
    const v = oneOf(item, allowed);
    if (v === undefined) throw invalidRecord(`Champ « ${field} » invalide.`);
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : undefined;
}

/** Adresse http(s) d'une source (lien affiché dans le contenu et l'historique) : jamais javascript:, data:… */
function sourceUrl(value: unknown): string | undefined {
  const url = str(value, RECORD_LIMITS.url, 'adresse de la source');
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidRecord('Adresse de source invalide.');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw invalidRecord('Adresse de source invalide.');
  }
  return url;
}

/**
 * Emplacement d'un passage cité : mêmes règles que pour une demande (validateLocator), sans troncature du titre de
 * section, plus l'indication « extrait » (`partial`), posée par la pipeline et affichée dans la liste des sources.
 */
function recordLocator(value: unknown): Locator {
  if (!isPlainObject(value)) throw invalidRecord('Localisation de document invalide.');
  const { type, start, end, labels } = validateLocator(value);
  const title = str(value.title, RECORD_LIMITS.locatorTitle, 'titre de section');
  return { type, start, end, ...(title ? { title } : {}), ...(labels ? { labels } : {}), ...(value.partial === true ? { partial: true } : {}) };
}

function recordSource(value: unknown): SourceRef {
  if (!isPlainObject(value)) throw invalidRecord('Source invalide.');
  const n = optionalInteger(value.n, 1, RECORD_LIMITS.maxSourceNumber, 'numéro de source');
  if (n === undefined) throw invalidRecord('Numéro de source manquant.');
  if (!isSourceKind(value.kind)) throw invalidRecord('Type de source inconnu.');
  const title = str(value.title, RECORD_LIMITS.sourceTitle, 'titre de la source');
  if (!title) throw invalidRecord('Titre de source manquant.');
  const authors = optionalTextList(value.authors, RECORD_LIMITS.maxAuthors, RECORD_LIMITS.author, 'auteurs');
  const year = optionalInteger(value.year, 0, 9_999, 'année');
  const venue = str(value.venue, RECORD_LIMITS.venue, 'revue');
  const doi = str(value.doi, RECORD_LIMITS.doi, 'DOI');
  const url = sourceUrl(value.url);
  const docName = str(value.docName, RECORD_LIMITS.docName, 'nom de document');
  const locator = value.locator === undefined || value.locator === null ? undefined : recordLocator(value.locator);
  return {
    n,
    kind: value.kind,
    title,
    ...(authors ? { authors } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(doi ? { doi } : {}),
    ...(url ? { url } : {}),
    ...(docName ? { docName } : {}),
    ...(locator ? { locator } : {}),
  };
}

function recordSources(value: unknown): SourceRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidRecord('Sources invalides.');
  if (value.length > RECORD_LIMITS.maxSources) throw invalidRecord(`Trop de sources (${RECORD_LIMITS.maxSources} au plus).`);
  return value.map(recordSource);
}

/**
 * Paramètres conservés avec une génération : UNIQUEMENT les clés produites par recordParams (shared/pipeline.ts),
 * avec les types et bornes de la demande d'origine. Une clé inconnue est ignorée (application Windows plus récente
 * que le site : l'enregistrement reste possible) ; une clé connue de type ou de valeur inattendus est refusée.
 * Jamais le texte des documents ni le travail d'un élève (seule sa longueur).
 */
function recordParams(value: unknown, type: TypeContenu): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw invalidRecord('Paramètres de la génération invalides.');
  const params: Record<string, unknown> = {
    researchMode: optionalOneOf(value.researchMode, RESEARCH_MODE_VALUES, 'mode de recherche'),
    duree: str(value.duree, REQUEST_LIMITS.duree, 'durée'),
    objectifs: str(value.objectifs, REQUEST_LIMITS.objectifs, 'objectifs'),
    consignes: str(value.consignes, REQUEST_LIMITS.consignes, 'consignes'),
    difficulte: optionalOneOf(value.difficulte, DIFFICULTES, 'difficulté'),
    format: optionalOneOf(value.format, FORMATS, 'format'),
    trimestre: optionalOneOf(value.trimestre, ['1', '2', '3'] as const, 'trimestre'),
    profilEleve: optionalOneOf(value.profilEleve, PROFILS, 'profil d’élève'),
    nombreAppreciations: optionalInteger(value.nombreAppreciations, 1, REQUEST_LIMITS.maxAppreciations, 'nombre d’appréciations'),
    profilsDifferenciation: optionalOneOfList(value.profilsDifferenciation, DIFF_PROFILS, 'profils de différenciation'),
    typeLettre: optionalOneOf(value.typeLettre, LETTRES, 'type de lettre'),
    contenuSource: str(value.contenuSource, REQUEST_LIMITS.contenuSource, 'contenu à adapter'),
    modalite: optionalModaliteId(value.modalite),
    typeEvaluation: optionalOneOf(value.typeEvaluation, EVALUATIONS, 'objectif de l’évaluation'),
    bareme: optionalOneOf(value.bareme, BAREME_VALUES, 'notation'),
    sansCorrige: optionalBoolean(value.sansCorrige, 'sans corrigé'),
    nombreExercices: optionalInteger(value.nombreExercices, LIMITES_NOMBRES.exercices.min, LIMITES_NOMBRES.exercices.max, 'nombre d’exercices'),
    nombreSeances: optionalInteger(value.nombreSeances, LIMITES_NOMBRES.seances.min, LIMITES_NOMBRES.seances.max, 'nombre de séances'),
    planSeulement: optionalPlanSeulement(value.planSeulement, type),
    ton: optionalOneOf(value.ton, TON_VALUES, 'ton'),
    besoins: optionalOneOfList(value.besoins, BESOINS, 'besoins particuliers'),
    texteEleveLength: optionalInteger(value.texteEleveLength, 1, REQUEST_LIMITS.texteEleve, 'longueur du travail corrigé'),
    documents: optionalTextList(value.documents, RECORD_LIMITS.maxDocumentNames, RECORD_LIMITS.docName, 'documents'),
  };
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
}

/**
 * Contenu Markdown produit : caractères de contrôle retirés, mais ni rogné ni retouché (une indentation initiale ou
 * le saut de ligne final font partie du document, identique à celui affiché à l'enseignant).
 */
function recordContent(value: unknown): string {
  if (value === undefined || value === null) throw invalidRecord('Contenu vide : rien à enregistrer.');
  if (typeof value !== 'string') throw invalidRecord('Champ « contenu » invalide.');
  const content = stripControlChars(value);
  if (!content.trim()) throw invalidRecord('Contenu vide : rien à enregistrer.');
  if (content.length > RECORD_LIMITS.contenu) {
    throw invalidRecord(`Le champ « contenu » est trop long (${RECORD_LIMITS.contenu} caractères maximum).`);
  }
  return content;
}

/**
 * Valide une génération à enregistrer (corps `record` de POST /api/generation, JSON non fiable) et renvoie une copie
 * propre : type, niveau et matière connus, sujet et contenu non vides et bornés, sources et paramètres en liste
 * blanche, caractères de contrôle retirés. Les champs inconnus (id, createdAt, isFavorite, userId…) sont ignorés.
 * Lève MagistraError('INVALID_REQUEST') avec un message explicite sinon.
 */
export function validateGenerationRecordDraft(input: unknown): GenerationRecordDraft {
  if (!isPlainObject(input)) throw invalidRecord('Contenu à enregistrer invalide.');
  if (!isTypeContenu(input.type)) throw invalidRecord('Type de contenu inconnu.');
  if (!isNiveau(input.niveau)) throw invalidRecord('Niveau inconnu.');
  if (!isMatiere(input.matiere)) throw invalidRecord('Matière inconnue.');
  const sujet = str(input.sujet, RECORD_LIMITS.sujet, 'sujet');
  if (!sujet) throw invalidRecord('Sujet manquant.');
  const contenu = recordContent(input.contenu);
  const discipline = str(input.discipline, RECORD_LIMITS.discipline, 'discipline');
  const truncated = optionalBoolean(input.truncated, 'contenu tronqué');
  const internetUsed = optionalBoolean(input.internetUsed, 'recherche Internet utilisée');
  const model = str(input.model, RECORD_LIMITS.model, 'modèle');
  return {
    type: input.type,
    niveau: input.niveau,
    matiere: input.matiere,
    ...(discipline ? { discipline } : {}),
    sujet,
    contenu,
    sources: recordSources(input.sources),
    params: recordParams(input.params, input.type),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(internetUsed !== undefined ? { internetUsed } : {}),
    ...(model ? { model } : {}),
  };
}

/** Sujet affiché dans l'historique quand l'outil n'en exige pas. */
export function displaySujet(req: GenerationRequest, toolLabel: string, niveauLabel: string, matiereLabel: string): string {
  if (req.sujet) return req.sujet;
  if (req.type === 'appreciations') {
    return `${toolLabel} — ${matiereLabel}, ${niveauLabel}${req.trimestre ? `, T${req.trimestre}` : ''} (${req.profilEleve ?? 'bon'})`;
  }
  if (req.type === 'lettre_parents') return `${toolLabel} — ${req.typeLettre ?? 'information'}`;
  return `${toolLabel} — ${matiereLabel}, ${niveauLabel}`;
}
