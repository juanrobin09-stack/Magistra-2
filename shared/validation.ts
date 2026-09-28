// Validation et nettoyage des demandes de génération (côté serveur ET côté application Windows).
// Protections techniques : tailles bornées, listes blanches, aucun champ hors de l'outil choisi.

import {
  defaultMatiereFor, isMatiere, isTypeContenu, TOOL_FIELDS, TOOL_REQUIRES_SUJET,
  type DifficulteExercice, type FormatSeance, type ProfilDifferenciation, type ProfilEleve, type TypeLettre,
} from './catalog.js';
import { MagistraError } from './errors.js';
import { isNiveau } from './levels.js';
import { isResearchMode, type DocKind, type DocumentPassage, type GenerationRequest, type Locator, type TeacherProfile } from './types.js';

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

/** Retire les caractères de contrôle invisibles (sauf tabulation et retours à la ligne). */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) continue;
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

  req.documents = req.researchMode === 'internet' ? undefined : validatePassages(raw.documents);
  req.profile = validateProfile(raw.profile);

  if (TOOL_REQUIRES_SUJET[type] && !req.sujet) throw new MagistraError('INVALID_REQUEST', 'Indiquez un sujet.');
  if (type === 'corrige' && !req.texteEleve) throw new MagistraError('INVALID_REQUEST', 'Collez le travail à corriger.');
  if (type === 'differenciation' && !req.sujet && !req.contenuSource) {
    throw new MagistraError('INVALID_REQUEST', 'Indiquez un sujet ou collez le contenu à adapter.');
  }
  return req;
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
