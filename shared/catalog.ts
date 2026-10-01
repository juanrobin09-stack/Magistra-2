// Référentiel métier : matières, outils de génération.
// Source unique partagée par l'interface, le serveur web et l'application Windows.

import { getCycle, getLevelGroup, type Cycle, type NiveauScolaire } from './levels.js';

export type Matiere =
  // Fondamentales
  | 'francais' | 'mathematiques' | 'histoire_geo' | 'emc'
  // Vie affective
  | 'evar' | 'evars'
  // Sciences primaire
  | 'sciences_primaire' | 'decouverte_monde'
  // Sciences collège/lycée
  | 'physique_chimie' | 'svt' | 'sciences_ingenieur' | 'nsi'
  // Langues
  | 'anglais' | 'espagnol' | 'allemand' | 'italien' | 'portugais' | 'chinois' | 'arabe' | 'latin' | 'grec'
  // Sciences humaines
  | 'philosophie' | 'ses' | 'hggsp' | 'droit_economie'
  // Arts & culture
  | 'arts_plastiques' | 'musique' | 'theatre' | 'cinema' | 'histoire_arts'
  // Sport
  | 'eps'
  // Technologie & pro
  | 'technologie' | 'sciences_numeriques' | 'management' | 'gestion'
  // Maternelle
  | 'langage_oral' | 'graphisme_ecriture' | 'nombres_formes' | 'temps_espace' | 'explorer_monde' | 'activites_artistiques' | 'activites_physiques'
  // Enseignement supérieur
  | 'informatique' | 'systemes_information' | 'statistiques' | 'economie' | 'droit' | 'science_politique'
  | 'sociologie' | 'psychologie' | 'sciences_education' | 'lettres' | 'linguistique' | 'histoire' | 'geographie'
  | 'physique' | 'chimie' | 'biologie' | 'sciences_terre' | 'medecine_sante' | 'communication' | 'arts'
  // Autre
  | 'autre';

export interface MatiereInfo {
  value: Matiere;
  label: string;
  emoji: string;
  cycles: Cycle[];
}

const ALL: Cycle[] = ['maternelle', 'cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'];

export const ALL_MATIERES: MatiereInfo[] = [
  // === MATERNELLE (domaines du programme en vigueur depuis la rentrée 2026 ; clés inchangées pour l'historique) ===
  // « Le développement et la structuration du langage oral et écrit » : un domaine, deux matières (oral ; écrit et graphisme).
  { value: 'langage_oral', label: 'Développement et structuration du langage — Oral', emoji: '🗣️', cycles: ['maternelle'] },
  { value: 'graphisme_ecriture', label: 'Développement et structuration du langage — Écrit / Graphisme', emoji: '✏️', cycles: ['maternelle'] },
  { value: 'nombres_formes', label: 'Acquérir les premiers outils mathématiques', emoji: '🔷', cycles: ['maternelle'] },
  { value: 'temps_espace', label: "Se repérer dans le temps et l'espace", emoji: '🧭', cycles: ['maternelle'] },
  { value: 'explorer_monde', label: 'Découvrir le monde du vivant, de la matière et des objets', emoji: '🌱', cycles: ['maternelle'] },
  { value: 'activites_artistiques', label: "Agir, s'exprimer, comprendre à travers les activités artistiques", emoji: '🎨', cycles: ['maternelle'] },
  { value: 'activites_physiques', label: "Agir, s'exprimer, comprendre à travers les activités physiques", emoji: '🤸', cycles: ['maternelle'] },

  // === FONDAMENTALES ===
  { value: 'francais', label: 'Français', emoji: '📖', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'mathematiques', label: 'Mathématiques', emoji: '🔢', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'histoire_geo', label: 'Histoire-Géographie', emoji: '🌍', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro'] },
  { value: 'emc', label: 'EMC (Enseignement moral et civique)', emoji: '⚖️', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro'] },

  // === VIE AFFECTIVE ===
  { value: 'evar', label: 'EVAR (Vie affective et relationnelle)', emoji: '💛', cycles: ['maternelle', 'cycle2', 'cycle3'] },
  { value: 'evars', label: 'EVARS (Vie affective, relationnelle et sexualité)', emoji: '💛', cycles: ['college', 'lycee', 'lycee_pro'] },

  // === SCIENCES ===
  { value: 'decouverte_monde', label: 'Questionner le monde', emoji: '🔍', cycles: ['cycle2'] },
  { value: 'sciences_primaire', label: 'Sciences et technologie', emoji: '🔬', cycles: ['cycle3'] },
  { value: 'physique_chimie', label: 'Physique-Chimie', emoji: '⚛️', cycles: ['college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'svt', label: 'SVT', emoji: '🧬', cycles: ['college', 'lycee'] },
  { value: 'sciences_ingenieur', label: "Sciences de l'ingénieur", emoji: '🏗️', cycles: ['lycee', 'superieur'] },
  { value: 'sciences_numeriques', label: 'SNT (Sciences numériques)', emoji: '🖥️', cycles: ['lycee'] },
  { value: 'nsi', label: 'NSI (Numérique et sciences informatiques)', emoji: '💻', cycles: ['lycee'] },
  { value: 'technologie', label: 'Technologie', emoji: '⚙️', cycles: ['college', 'lycee_pro'] },

  // === LANGUES VIVANTES ET ANCIENNES ===
  { value: 'anglais', label: 'Anglais', emoji: '🇬🇧', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'espagnol', label: 'Espagnol', emoji: '🇪🇸', cycles: ['college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'allemand', label: 'Allemand', emoji: '🇩🇪', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'superieur'] },
  { value: 'italien', label: 'Italien', emoji: '🇮🇹', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'portugais', label: 'Portugais', emoji: '🇵🇹', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'chinois', label: 'Chinois', emoji: '🇨🇳', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'arabe', label: 'Arabe', emoji: '🇸🇦', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'latin', label: 'Latin (LCA)', emoji: '🏛️', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'grec', label: 'Grec ancien (LCA)', emoji: '🏺', cycles: ['college', 'lycee', 'superieur'] },

  // === SCIENCES HUMAINES (secondaire) ===
  { value: 'philosophie', label: 'Philosophie', emoji: '🤔', cycles: ['lycee', 'superieur'] },
  { value: 'ses', label: 'SES', emoji: '📊', cycles: ['lycee'] },
  { value: 'hggsp', label: 'HGGSP (Géopolitique)', emoji: '🗺️', cycles: ['lycee'] },
  { value: 'droit_economie', label: 'Droit et économie', emoji: '📜', cycles: ['lycee', 'lycee_pro'] },

  // === ARTS ===
  { value: 'arts_plastiques', label: 'Arts plastiques', emoji: '🎨', cycles: ['cycle2', 'cycle3', 'college', 'lycee'] },
  { value: 'musique', label: 'Éducation musicale', emoji: '🎵', cycles: ['cycle2', 'cycle3', 'college', 'lycee'] },
  { value: 'histoire_arts', label: 'Histoire des arts', emoji: '🖼️', cycles: ['college', 'lycee'] },
  { value: 'theatre', label: 'Théâtre', emoji: '🎭', cycles: ['lycee', 'superieur'] },
  { value: 'cinema', label: 'Cinéma-Audiovisuel', emoji: '🎬', cycles: ['lycee', 'superieur'] },

  // === SPORT ===
  { value: 'eps', label: 'EPS', emoji: '🏃', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },

  // === PRO / TECHNO ===
  { value: 'management', label: 'Management', emoji: '💼', cycles: ['lycee', 'lycee_pro', 'superieur'] },
  { value: 'gestion', label: 'Gestion, finance, comptabilité', emoji: '🧮', cycles: ['lycee', 'lycee_pro', 'superieur'] },

  // === ENSEIGNEMENT SUPÉRIEUR ===
  { value: 'informatique', label: 'Informatique', emoji: '💻', cycles: ['superieur'] },
  { value: 'systemes_information', label: "Systèmes d'information", emoji: '🗄️', cycles: ['superieur'] },
  { value: 'statistiques', label: 'Statistiques et science des données', emoji: '📈', cycles: ['superieur'] },
  { value: 'economie', label: 'Économie', emoji: '💶', cycles: ['superieur'] },
  { value: 'droit', label: 'Droit', emoji: '⚖️', cycles: ['superieur'] },
  { value: 'science_politique', label: 'Science politique', emoji: '🏛️', cycles: ['superieur'] },
  { value: 'sociologie', label: 'Sociologie', emoji: '👥', cycles: ['superieur'] },
  { value: 'psychologie', label: 'Psychologie', emoji: '🧠', cycles: ['superieur'] },
  { value: 'sciences_education', label: "Sciences de l'éducation", emoji: '🎓', cycles: ['superieur'] },
  { value: 'lettres', label: 'Lettres et littératures', emoji: '📚', cycles: ['superieur'] },
  { value: 'linguistique', label: 'Linguistique', emoji: '🔤', cycles: ['superieur'] },
  { value: 'histoire', label: 'Histoire', emoji: '📜', cycles: ['superieur'] },
  { value: 'geographie', label: 'Géographie', emoji: '🗺️', cycles: ['superieur'] },
  { value: 'physique', label: 'Physique', emoji: '🔭', cycles: ['superieur'] },
  { value: 'chimie', label: 'Chimie', emoji: '🧪', cycles: ['superieur'] },
  { value: 'biologie', label: 'Biologie', emoji: '🧬', cycles: ['superieur'] },
  { value: 'sciences_terre', label: 'Sciences de la Terre et environnement', emoji: '🌋', cycles: ['superieur'] },
  { value: 'medecine_sante', label: 'Médecine et santé', emoji: '🩺', cycles: ['superieur'] },
  { value: 'communication', label: 'Information et communication', emoji: '📣', cycles: ['superieur'] },
  { value: 'arts', label: 'Arts et esthétique', emoji: '🎨', cycles: ['superieur'] },

  // === AUTRE ===
  { value: 'autre', label: 'Autre matière', emoji: '📝', cycles: ALL },
];

export function isMatiere(value: unknown): value is Matiere {
  return typeof value === 'string' && ALL_MATIERES.some(m => m.value === value);
}

/** Matières proposées pour un niveau donné. */
export function getMatieresForNiveau(niveau: NiveauScolaire): { value: Matiere; label: string; emoji: string }[] {
  const cycle = getCycle(niveau);
  return ALL_MATIERES.filter(m => m.cycles.includes(cycle)).map(({ value, label, emoji }) => ({ value, label, emoji }));
}

export function isMatiereAvailableFor(matiere: Matiere, niveau: NiveauScolaire): boolean {
  return getMatieresForNiveau(niveau).some(m => m.value === matiere);
}

/** Première matière disponible pour ce niveau (utile quand la matière courante n'existe pas à ce niveau). */
export function defaultMatiereFor(niveau: NiveauScolaire, preferred?: Matiere): Matiere {
  if (preferred && isMatiereAvailableFor(preferred, niveau)) return preferred;
  // Dans le supérieur, aucune discipline n'est « naturelle » : « Autre » + discipline libre plutôt que « Français ».
  if (getCycle(niveau) === 'superieur') return 'autre';
  return getMatieresForNiveau(niveau)[0]?.value ?? 'autre';
}

export const MATIERES = ALL_MATIERES.map(({ value, label, emoji }) => ({ value, label, emoji }));

/** Accepte un code (« francais ») ou un ancien libellé stocké (« Français »). */
/**
 * Anciens libellés enregistrés par la première version de Magistra (qui stockait le libellé, pas la clé)
 * et qui diffèrent des libellés actuels. Les autres anciens libellés sont identiques aux libellés actuels.
 */
const LEGACY_MATIERE_LABELS: Record<string, Matiere> = {
  "sciences de l'ingénieur (si)": 'sciences_ingenieur',
  'arts plastiques': 'arts_plastiques',
  'management / stmg': 'management',
  'gestion-finance / compta': 'gestion',
  // Domaines de maternelle d'avant la rentrée 2026 (« Explorer le monde » a été scindé en deux domaines) et anciens
  // libellés abrégés, remplacés par les intitulés des domaines du programme de 2026.
  'mobiliser le langage — oral': 'langage_oral',
  'mobiliser le langage — écrit / graphisme': 'graphisme_ecriture',
  'nombres, formes et grandeurs': 'nombres_formes',
  'explorer le monde': 'explorer_monde',
  'activités artistiques': 'activites_artistiques',
  "agir, s'exprimer avec son corps": 'activites_physiques',
};

const normalizeLabel = (label: string) => label.trim().toLowerCase().replaceAll('’', "'");

/** Clé de matière à partir d'une clé, d'un libellé actuel ou d'un ancien libellé stocké. */
export function resolveMatiere(value: Matiere | string): Matiere | undefined {
  if (isMatiere(value)) return value;
  const label = normalizeLabel(String(value));
  return ALL_MATIERES.find(m => normalizeLabel(m.label) === label)?.value ?? LEGACY_MATIERE_LABELS[label];
}

export function getMatiereLabel(matiere: Matiere | string): string {
  const key = resolveMatiere(matiere);
  return ALL_MATIERES.find(m => m.value === key)?.label ?? String(matiere);
}

export function getMatiereEmoji(matiere: Matiere | string): string {
  const key = resolveMatiere(matiere);
  return ALL_MATIERES.find(m => m.value === key)?.emoji ?? '📝';
}

// =============================================
// OUTILS DE GÉNÉRATION
// =============================================

export type TypeContenu =
  | 'cours' | 'exercices' | 'evaluation' | 'sequence' | 'fiche_prep'
  | 'appreciations' | 'progression' | 'differenciation' | 'lettre_parents' | 'cahier_journal' | 'corrige';

export const ALL_TYPES: TypeContenu[] = [
  'cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression',
  'appreciations', 'differenciation', 'lettre_parents', 'cahier_journal', 'corrige',
];

export function isTypeContenu(value: unknown): value is TypeContenu {
  return typeof value === 'string' && (ALL_TYPES as string[]).includes(value);
}

export interface TypeContenuInfo {
  value: TypeContenu;
  label: string;
  description: string;
  icon: string;
  category: 'creation' | 'outils';
}

export const TYPE_CONTENU: TypeContenuInfo[] = [
  { value: 'cours', label: 'Cours', description: 'Un cours structuré et complet', icon: '✦', category: 'creation' },
  { value: 'exercices', label: 'Exercices', description: "Série d'exercices progressifs avec corrigé", icon: '◈', category: 'creation' },
  { value: 'evaluation', label: 'Évaluation', description: 'Sujet + corrigé + barème', icon: '◎', category: 'creation' },
  { value: 'sequence', label: 'Séquence', description: 'Séquence multi-séances', icon: '⬡', category: 'creation' },
  { value: 'fiche_prep', label: 'Fiche de prep', description: 'Fiche de préparation de séance', icon: '◇', category: 'creation' },
  { value: 'progression', label: 'Progression', description: 'Progression annuelle', icon: '📅', category: 'creation' },
  { value: 'appreciations', label: 'Appréciations', description: 'Appréciations de bulletins', icon: '💬', category: 'outils' },
  { value: 'differenciation', label: 'Différenciation', description: 'Adapter un exercice à plusieurs profils', icon: '🎯', category: 'outils' },
  { value: 'lettre_parents', label: 'Courrier parents', description: 'Lettres et communications aux familles', icon: '✉️', category: 'outils' },
  { value: 'cahier_journal', label: 'Cahier journal', description: 'Journée de classe détaillée', icon: '📓', category: 'outils' },
  { value: 'corrige', label: 'Corrigé annoté', description: "Corriger un travail d'élève", icon: '🔍', category: 'outils' },
];

/** Libellés adaptés à l'enseignement supérieur (la terminologie scolaire n'y a pas de sens). */
const SUP_TOOL_TEXT: Record<TypeContenu, { label: string; description: string }> = {
  cours: { label: 'Cours', description: 'Cours magistral (CM) structuré et problématisé' },
  exercices: { label: 'TD / Exercices', description: "Sujets de TD progressifs avec éléments de correction" },
  evaluation: { label: 'Examen', description: 'Sujet de partiel ou d’examen + corrigé + grille' },
  sequence: { label: 'Plan de module', description: 'Organisation d’une UE en séances (CM, TD, TP)' },
  fiche_prep: { label: 'Fiche de séance', description: 'Déroulé d’une séance de CM, TD ou TP' },
  progression: { label: 'Syllabus', description: 'Plan de cours semestriel (syllabus)' },
  appreciations: { label: 'Commentaires', description: "Commentaires d'évaluation pour les étudiants" },
  differenciation: { label: 'Adaptations', description: 'Parcours différenciés et aménagements' },
  lettre_parents: { label: 'Message étudiants', description: 'Message ou courrier aux étudiants' },
  cahier_journal: { label: 'Planning de séances', description: 'Planning détaillé d’une journée d’enseignement' },
  corrige: { label: 'Correction de copie', description: "Correction annotée d'une copie d'étudiant" },
};

const SECONDARY_TOOL_TEXT: Partial<Record<TypeContenu, { label: string; description: string }>> = {
  cahier_journal: { label: 'Planning de journée', description: 'Journée de cours détaillée' },
};

export function getToolInfo(type: TypeContenu, niveau?: NiveauScolaire): TypeContenuInfo {
  const base = TYPE_CONTENU.find(t => t.value === type) ?? TYPE_CONTENU[0];
  if (!niveau) return base;
  const group = getLevelGroup(niveau);
  if (['bts_but', 'cpge', 'licence', 'master', 'doctorat'].includes(group)) {
    return { ...base, ...SUP_TOOL_TEXT[type] };
  }
  if (group !== 'maternelle' && group !== 'elementaire' && SECONDARY_TOOL_TEXT[type]) {
    return { ...base, ...SECONDARY_TOOL_TEXT[type]! };
  }
  return base;
}

export function getToolLabel(type: TypeContenu | string, niveau?: NiveauScolaire): string {
  if (!isTypeContenu(type)) return String(type);
  return getToolInfo(type, niveau).label;
}

// Les idées de sujets (getSujetSuggestions, pickSuggestions) sont dans shared/suggestions.ts : leurs données sont
// volumineuses et ne doivent pas alourdir ce référentiel, chargé partout.

// =============================================
// PARAMÈTRES SPÉCIFIQUES AUX OUTILS
// =============================================

export type DifficulteExercice = 'facile' | 'moyen' | 'difficile' | 'differencie';
export type FormatSeance = 'cm' | 'td' | 'tp' | 'seminaire';
export type TypeLettre = 'comportement' | 'absence' | 'felicitations' | 'reunion' | 'incident' | 'orientation' | 'information';
export type ProfilEleve = 'excellent' | 'bon' | 'moyen' | 'fragile' | 'decrocheur';
export type ProfilDifferenciation = 'renforce' | 'standard' | 'approfondissement';

export const DIFFICULTES: { value: DifficulteExercice; label: string }[] = [
  { value: 'facile', label: 'Facile' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'difficile', label: 'Difficile' },
  { value: 'differencie', label: 'Différencié (3 niveaux)' },
];

export const FORMATS_SEANCE: { value: FormatSeance; label: string }[] = [
  { value: 'cm', label: 'Cours magistral (CM)' },
  { value: 'td', label: 'Travaux dirigés (TD)' },
  { value: 'tp', label: 'Travaux pratiques (TP)' },
  { value: 'seminaire', label: 'Séminaire' },
];

export const TYPES_LETTRE: { value: TypeLettre; label: string; description: string }[] = [
  { value: 'comportement', label: 'Comportement', description: 'Signalement de comportement' },
  { value: 'absence', label: 'Absences', description: 'Absences répétées' },
  { value: 'felicitations', label: 'Félicitations', description: 'Encouragements' },
  { value: 'reunion', label: 'Réunion', description: 'Proposition de rendez-vous' },
  { value: 'incident', label: 'Incident', description: "Signalement d'un incident" },
  { value: 'orientation', label: 'Orientation', description: 'Information orientation' },
  { value: 'information', label: 'Information', description: 'Sortie, projet, organisation' },
];

export const PROFILS_ELEVE: { value: ProfilEleve; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'bon', label: 'Bon niveau' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'fragile', label: 'Fragile / en difficulté' },
  { value: 'decrocheur', label: 'Décrocheur' },
];

export const PROFILS_DIFFERENCIATION: { value: ProfilDifferenciation; label: string; description: string }[] = [
  { value: 'renforce', label: 'Accompagnement renforcé', description: 'Besoins particuliers, DYS, allophones, ULIS' },
  { value: 'standard', label: 'Standard', description: 'Niveau attendu du groupe' },
  { value: 'approfondissement', label: 'Approfondissement', description: 'Élèves avancés, HPI' },
];

/**
 * Champs de formulaire pertinents par outil : tout autre champ est ignoré (pas de paramètres fantômes).
 * « modalite » : format normé propre à l'outil, au niveau et à la matière (shared/formats.ts).
 */
export const TOOL_FIELDS: Record<TypeContenu, readonly string[]> = {
  cours: ['sujet', 'duree', 'objectifs', 'consignes', 'format', 'modalite'],
  exercices: ['sujet', 'objectifs', 'consignes', 'difficulte', 'format', 'modalite', 'nombreExercices', 'bareme', 'sansCorrige'],
  evaluation: ['sujet', 'duree', 'objectifs', 'consignes', 'difficulte', 'modalite', 'typeEvaluation', 'bareme', 'sansCorrige'],
  sequence: ['sujet', 'duree', 'objectifs', 'consignes', 'modalite', 'nombreSeances'],
  fiche_prep: ['sujet', 'duree', 'objectifs', 'consignes', 'format', 'modalite'],
  progression: ['sujet', 'consignes', 'modalite'],
  appreciations: ['sujet', 'trimestre', 'profilEleve', 'nombreAppreciations', 'consignes', 'modalite', 'ton'],
  differenciation: ['sujet', 'contenuSource', 'profilsDifferenciation', 'consignes', 'besoins'],
  lettre_parents: ['typeLettre', 'consignes', 'modalite'],
  cahier_journal: ['sujet', 'duree', 'consignes'],
  corrige: ['sujet', 'texteEleve', 'consignes', 'modalite', 'bareme'],
};

/** Familles d'outils, dans l'ordre de la barre latérale (« Outils pédagogiques »). */
export const TOOL_GROUPS: { id: 'preparer' | 'evaluer' | 'accompagner'; label: string; tools: TypeContenu[] }[] = [
  { id: 'preparer', label: 'Préparer', tools: ['cours', 'sequence', 'fiche_prep', 'progression', 'cahier_journal'] },
  { id: 'evaluer', label: 'Entraîner et évaluer', tools: ['exercices', 'evaluation', 'corrige', 'appreciations'] },
  { id: 'accompagner', label: 'Accompagner', tools: ['differenciation', 'lettre_parents'] },
];

/** L'outil exige-t-il un sujet saisi par l'enseignant ? */
export const TOOL_REQUIRES_SUJET: Record<TypeContenu, boolean> = {
  cours: true, exercices: true, evaluation: true, sequence: true, fiche_prep: true,
  progression: false, appreciations: false, differenciation: false, lettre_parents: false,
  cahier_journal: false, corrige: false,
};
