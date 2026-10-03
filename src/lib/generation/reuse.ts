// Historique : paramètres enregistrés d'une génération (affichage) et « Reprendre cette demande »
// (formulaire prérempli). Les paramètres viennent du stockage : ils sont revalidés un par un.

import {
  DIFFICULTES, FORMATS_SEANCE, isMatiere, isTypeContenu, PROFILS_DIFFERENCIATION, PROFILS_ELEVE, TYPES_LETTRE,
  type DifficulteExercice, type FormatSeance, type ProfilDifferenciation, type ProfilEleve, type TypeLettre,
} from '@shared/catalog';
import {
  BAREMES, BESOINS_PARTICULIERS, countLabel, countUnit, getModalite, LIMITES_NOMBRES, modaliteFieldLabel, TONS, TYPES_EVALUATION,
  type Bareme, type BesoinParticulier, type TonRedaction, type TypeEvaluation,
} from '@shared/formats';
import { getLevelGroup, isNiveau, isSuperieur } from '@shared/levels';
import { REQUEST_LIMITS } from '@shared/validation';
import { RESEARCH_MODES, type GenerationRecord, type ResearchMode, type TeacherProfile } from '@shared/types';
import { createInitialForm, pickMatiere, type GenerateForm, type Trimestre } from './request';

/** Ce qu'il faut pour reprendre une demande (sans le contenu généré). */
export type ReusableRecord = Pick<GenerationRecord, 'type' | 'niveau' | 'matiere' | 'discipline' | 'sujet' | 'params'>;

export interface ReusedRequest {
  form: GenerateForm;
  researchMode: ResearchMode | null;
  /** Ce qui n'a pas pu être repris (travail d'élève, documents) : dit à l'enseignant. */
  notes: string[];
  /** Rappel affiché à la place de « Demande reprise depuis l'historique » (séance préparée à partir d'un plan). */
  notice?: string;
}

/**
 * État du routeur d'une navigation vers « Générer » avec un formulaire à préremplir : « Reprendre cette demande »
 * (Historique) ou « Développer une séance » (plan d'une séquence, src/lib/generation/plan.ts). Jamais dans l'adresse :
 * ni limite de taille, ni texte de l'enseignant dans l'historique du navigateur.
 */
export interface ReuseState {
  reuse?: ReusableRecord;
  /** Phrase de rappel propre à l'origine de la demande (facultative). */
  reuseNotice?: string;
}

function isReusableRecord(value: unknown): value is ReusableRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<Record<keyof ReusableRecord, unknown>>;
  return typeof record.type === 'string' && typeof record.sujet === 'string';
}

/** Formulaire à reprendre selon l'état du routeur (null : rien à reprendre, ou état illisible : jamais d'exception). */
export function reusedFromState(state: unknown, profile: TeacherProfile | null | undefined): ReusedRequest | null {
  const reuse = typeof state === 'object' && state !== null ? (state as ReuseState).reuse : undefined;
  if (!isReusableRecord(reuse)) return null;
  const notice = (state as ReuseState).reuseNotice;
  try {
    const reused = formFromRecord(reuse, profile);
    return typeof notice === 'string' && notice.trim() ? { ...reused, notice: notice.slice(0, 500) } : reused;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const oneOf = <T extends string>(value: unknown, list: readonly { value: T }[]): T | undefined =>
  list.find(item => item.value === value)?.value;
const labelOf = (value: unknown, list: readonly { value: string; label: string }[]): string | undefined =>
  list.find(item => item.value === value)?.label;
const documentNames = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((d): d is string => typeof d === 'string' && d.length > 0).slice(0, 20) : [];

function isResearchMode(value: unknown): value is ResearchMode {
  return RESEARCH_MODES.some(m => m.value === value);
}

function isTrimestre(value: unknown): value is Trimestre {
  return value === '1' || value === '2' || value === '3';
}

/** Entier enregistré dans les bornes, sinon '' (« automatique »). */
function countOf(value: unknown, bounds: { min: number; max: number }): number | '' {
  return typeof value === 'number' && Number.isInteger(value) && value >= bounds.min && value <= bounds.max ? value : '';
}

/** Séquence demandée en deux temps (plan d'abord) : seul l'outil Séquence a cette option, tout autre enregistrement l'ignore. */
export function isPlanFirst(record: Pick<ReusableRecord, 'type' | 'params'>): boolean {
  return record.type === 'sequence' && record.params?.planSeulement === true;
}

/** Paramètres enregistrés, lisibles (seulement ceux qui existent). */
export function describeRecordParams(record: ReusableRecord): { label: string; value: string }[] {
  const p = record.params ?? {};
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value && value.trim()) rows.push({ label, value });
  };
  add('Sources', RESEARCH_MODES.find(m => m.value === p.researchMode)?.label);
  add('Durée', text(p.duree, 200));
  add('Objectifs', text(p.objectifs, 2_000));
  add('Consignes', text(p.consignes, 3_000));
  add('Difficulté', labelOf(p.difficulte, DIFFICULTES));
  add('Format', labelOf(p.format, FORMATS_SEANCE));
  add('Trimestre', isTrimestre(p.trimestre) ? `${p.trimestre}${p.trimestre === '1' ? 'er' : 'e'} trimestre` : undefined);
  add('Profil', labelOf(p.profilEleve, PROFILS_ELEVE));
  add('Nombre demandé', typeof p.nombreAppreciations === 'number' ? String(p.nombreAppreciations) : undefined);
  if (Array.isArray(p.profilsDifferenciation)) {
    add('Profils', p.profilsDifferenciation.map(v => labelOf(v, PROFILS_DIFFERENCIATION)).filter(Boolean).join(', '));
  }
  add('Type de courrier', labelOf(p.typeLettre, TYPES_LETTRE));
  if (isTypeContenu(record.type)) {
    const sup = isNiveau(record.niveau) && isSuperieur(record.niveau);
    add(modaliteFieldLabel(record.type, sup), typeof p.modalite === 'string' ? getModalite(p.modalite)?.label : undefined);
  }
  add('Objectif', labelOf(p.typeEvaluation, TYPES_EVALUATION));
  add('Notation', labelOf(p.bareme, BAREMES));
  add('Corrigé', p.sansCorrige === true ? 'non (version élève seule)' : undefined);
  // « Nombre de questions » pour un QCM… ; rien pour un travail d'un seul tenant (dissertation, dictée…).
  const unit = countUnit(typeof p.modalite === 'string' ? p.modalite : undefined, isNiveau(record.niveau) ? getLevelGroup(record.niveau) : undefined);
  if (unit) add(countLabel(unit), countOf(p.nombreExercices, LIMITES_NOMBRES.exercices) ? String(p.nombreExercices) : undefined);
  add('Nombre de séances', countOf(p.nombreSeances, LIMITES_NOMBRES.seances) ? String(p.nombreSeances) : undefined);
  add("Plan d'abord", isPlanFirst(record) ? 'oui' : undefined);
  add('Ton', labelOf(p.ton, TONS));
  if (Array.isArray(p.besoins)) {
    add('Besoins particuliers', p.besoins.map(v => labelOf(v, BESOINS_PARTICULIERS)).filter(Boolean).join(', '));
  }
  const source = text(p.contenuSource, REQUEST_LIMITS.contenuSource);
  add('Contenu adapté', source.length > 300 ? `${source.slice(0, 299)}…` : source);
  if (typeof p.texteEleveLength === 'number') {
    add('Travail corrigé', `non conservé (${p.texteEleveLength.toLocaleString('fr-FR')} caractères)`);
  }
  add('Documents', documentNames(p.documents).join(', '));
  return rows;
}

/** Formulaire prérempli à partir d'une génération de l'historique. */
export function formFromRecord(record: ReusableRecord, profile: TeacherProfile | null | undefined): ReusedRequest {
  const p = record.params ?? {};
  const base = createInitialForm(profile, { type: isTypeContenu(record.type) ? record.type : null, sujet: record.sujet });
  const niveau = isNiveau(record.niveau) ? record.niveau : base.niveau;
  const form: GenerateForm = {
    ...base,
    niveau,
    matiere: pickMatiere(niveau, [isMatiere(record.matiere) ? record.matiere : undefined, base.matiere]),
    discipline: text(record.discipline, REQUEST_LIMITS.discipline) || base.discipline,
    duree: text(p.duree, REQUEST_LIMITS.duree),
    objectifs: text(p.objectifs, REQUEST_LIMITS.objectifs),
    consignes: text(p.consignes, REQUEST_LIMITS.consignes),
    difficulte: oneOf<DifficulteExercice>(p.difficulte, DIFFICULTES) ?? '',
    format: oneOf<FormatSeance>(p.format, FORMATS_SEANCE) ?? '',
    trimestre: isTrimestre(p.trimestre) ? p.trimestre : base.trimestre,
    profilEleve: oneOf<ProfilEleve>(p.profilEleve, PROFILS_ELEVE) ?? base.profilEleve,
    nombreAppreciations: typeof p.nombreAppreciations === 'number' ? String(p.nombreAppreciations) : base.nombreAppreciations,
    profilsDifferenciation: Array.isArray(p.profilsDifferenciation)
      ? PROFILS_DIFFERENCIATION.map(d => d.value).filter((v: ProfilDifferenciation) => (p.profilsDifferenciation as unknown[]).includes(v))
      : base.profilsDifferenciation,
    contenuSource: text(p.contenuSource, REQUEST_LIMITS.contenuSource),
    typeLettre: oneOf<TypeLettre>(p.typeLettre, TYPES_LETTRE) ?? base.typeLettre,
    texteEleve: '',
    // Format inconnu (application plus récente) : ignoré ; format hors de propos : ignoré à l'envoi (request.ts).
    modalite: typeof p.modalite === 'string' && getModalite(p.modalite) ? p.modalite : '',
    typeEvaluation: oneOf<TypeEvaluation>(p.typeEvaluation, TYPES_EVALUATION) ?? '',
    bareme: oneOf<Bareme>(p.bareme, BAREMES) ?? '',
    sansCorrige: p.sansCorrige === true,
    nombreExercices: countOf(p.nombreExercices, LIMITES_NOMBRES.exercices),
    nombreSeances: countOf(p.nombreSeances, LIMITES_NOMBRES.seances),
    planSeulement: isPlanFirst(record),
    ton: oneOf<TonRedaction>(p.ton, TONS) ?? '',
    besoins: Array.isArray(p.besoins)
      ? BESOINS_PARTICULIERS.map(b => b.value).filter((v: BesoinParticulier) => (p.besoins as unknown[]).includes(v))
      : [],
  };
  if (form.profilsDifferenciation.length === 0) form.profilsDifferenciation = base.profilsDifferenciation;

  const notes: string[] = [];
  if (typeof p.texteEleveLength === 'number' && form.type === 'corrige') {
    notes.push("Le travail corrigé n'est pas conservé dans l'historique : collez-le à nouveau.");
  }
  const docs = documentNames(p.documents);
  if (docs.length > 0) notes.push(`Ajoutez à nouveau vos documents si nécessaire : ${docs.join(', ')}.`);
  return { form, researchMode: isResearchMode(p.researchMode) ? p.researchMode : null, notes };
}
