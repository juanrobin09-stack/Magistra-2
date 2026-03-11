// =============================================
// NIVEAUX SCOLAIRES — De la TPS au Doctorat
// =============================================

export type NiveauScolaire =
  // Maternelle
  | 'maternelle_tps' | 'maternelle_ps' | 'maternelle_ms' | 'maternelle_gs'
  // Primaire
  | 'cp' | 'ce1' | 'ce2' | 'cm1' | 'cm2'
  // Collège
  | '6eme' | '5eme' | '4eme' | '3eme'
  // Lycée général & technologique
  | '2nde_gt' | '1ere_gen' | 'terminale_gen' | '1ere_techno' | 'terminale_techno'
  // Lycée professionnel
  | '2nde_pro' | '1ere_pro' | 'terminale_pro' | 'cap_1' | 'cap_2'
  // Supérieur
  | 'bts' | 'but' | 'cpge' | 'licence_1' | 'licence_2' | 'licence_3' | 'master_1' | 'master_2' | 'doctorat';

// =============================================
// MATIÈRES — 30+ matières complètes
// =============================================

export type Matiere =
  // Fondamentales
  | 'francais' | 'mathematiques' | 'histoire_geo' | 'emc'
  // Vie affective (nouveau 2025)
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
  // Sport & santé
  | 'eps'
  // Technologie & pro
  | 'technologie' | 'sciences_numeriques' | 'management' | 'gestion'
  // Maternelle spécifique
  | 'langage_oral' | 'graphisme_ecriture' | 'nombres_formes' | 'explorer_monde' | 'activites_artistiques' | 'activites_physiques'
  // Autre
  | 'autre';

export type TypeContenu =
  | 'cours' | 'exercices' | 'evaluation' | 'sequence' | 'fiche_prep'
  // New tools
  | 'appreciations' | 'progression' | 'differenciation' | 'lettre_parents' | 'cahier_journal' | 'corrige';

export type DifficulteExercice = 'facile' | 'moyen' | 'difficile' | 'differencie';

export interface GenerationRequest {
  type: TypeContenu;
  matiere: Matiere;
  niveau: NiveauScolaire;
  sujet: string;
  duree?: string;
  objectifs?: string;
  difficulte?: DifficulteExercice;
  consignesSupplementaires?: string;
  // New fields for specific tools
  nombreEleves?: number;
  trimestre?: '1' | '2' | '3';
  profilsEleves?: string; // for appreciations: "bon", "moyen", "difficulte"
  typeLettre?: 'comportement' | 'absence' | 'felicitations' | 'reunion' | 'incident' | 'orientation';
  texteEleve?: string; // for corrige: student text to correct
}

export interface GeneratedContent {
  id: string;
  type: TypeContenu;
  matiere: string; // stored as label string from API
  niveau: string;  // stored as label string from API
  sujet: string;
  contenu: string;
  createdAt: Date;
  isFavorite: boolean;
}

// =============================================
// DONNÉES DE RÉFÉRENCE
// =============================================

export const NIVEAUX: Record<string, { label: string; niveaux: { value: NiveauScolaire; label: string }[] }> = {
  maternelle: {
    label: 'Maternelle',
    niveaux: [
      { value: 'maternelle_tps', label: 'Toute Petite Section (TPS)' },
      { value: 'maternelle_ps', label: 'Petite Section (PS)' },
      { value: 'maternelle_ms', label: 'Moyenne Section (MS)' },
      { value: 'maternelle_gs', label: 'Grande Section (GS)' },
    ],
  },
  primaire: {
    label: 'Élémentaire',
    niveaux: [
      { value: 'cp', label: 'CP' },
      { value: 'ce1', label: 'CE1' },
      { value: 'ce2', label: 'CE2' },
      { value: 'cm1', label: 'CM1' },
      { value: 'cm2', label: 'CM2' },
    ],
  },
  college: {
    label: 'Collège',
    niveaux: [
      { value: '6eme', label: '6ème' },
      { value: '5eme', label: '5ème' },
      { value: '4eme', label: '4ème' },
      { value: '3eme', label: '3ème' },
    ],
  },
  lycee_general: {
    label: 'Lycée Général & Techno',
    niveaux: [
      { value: '2nde_gt', label: 'Seconde GT' },
      { value: '1ere_gen', label: 'Première Générale' },
      { value: 'terminale_gen', label: 'Terminale Générale' },
      { value: '1ere_techno', label: 'Première Technologique' },
      { value: 'terminale_techno', label: 'Terminale Technologique' },
    ],
  },
  lycee_pro: {
    label: 'Lycée Professionnel',
    niveaux: [
      { value: 'cap_1', label: 'CAP 1ère année' },
      { value: 'cap_2', label: 'CAP 2ème année' },
      { value: '2nde_pro', label: 'Seconde Pro' },
      { value: '1ere_pro', label: 'Première Pro' },
      { value: 'terminale_pro', label: 'Terminale Pro' },
    ],
  },
  superieur: {
    label: 'Supérieur',
    niveaux: [
      { value: 'bts', label: 'BTS' },
      { value: 'but', label: 'BUT (ex-DUT)' },
      { value: 'cpge', label: 'CPGE (Prépa)' },
      { value: 'licence_1', label: 'Licence 1' },
      { value: 'licence_2', label: 'Licence 2' },
      { value: 'licence_3', label: 'Licence 3' },
      { value: 'master_1', label: 'Master 1' },
      { value: 'master_2', label: 'Master 2' },
      { value: 'doctorat', label: 'Doctorat' },
    ],
  },
};

// Cycle identifiers for filtering
type Cycle = 'maternelle' | 'cycle2' | 'cycle3' | 'college' | 'lycee' | 'lycee_pro' | 'superieur';

function getNiveauCycle(niveau: NiveauScolaire): Cycle {
  if (niveau.startsWith('maternelle')) return 'maternelle';
  if (['cp', 'ce1', 'ce2'].includes(niveau)) return 'cycle2';           // Cycle 2
  if (['cm1', 'cm2'].includes(niveau)) return 'cycle3';                  // Cycle 3 primaire
  if (['6eme', '5eme', '4eme', '3eme'].includes(niveau)) return 'college';
  if (['2nde_gt', '1ere_gen', 'terminale_gen', '1ere_techno', 'terminale_techno'].includes(niveau)) return 'lycee';
  if (['cap_1', 'cap_2', '2nde_pro', '1ere_pro', 'terminale_pro'].includes(niveau)) return 'lycee_pro';
  return 'superieur';
}

interface MatiereInfo {
  value: Matiere;
  label: string;
  emoji: string;
  cycles: Cycle[]; // in which cycles this subject appears
}

const ALL_MATIERES: MatiereInfo[] = [
  // === MATERNELLE (domaines du programme) ===
  { value: 'langage_oral', label: 'Mobiliser le langage — Oral', emoji: '🗣️', cycles: ['maternelle'] },
  { value: 'graphisme_ecriture', label: 'Mobiliser le langage — Écrit / Graphisme', emoji: '✏️', cycles: ['maternelle'] },
  { value: 'nombres_formes', label: 'Nombres, formes et grandeurs', emoji: '🔷', cycles: ['maternelle'] },
  { value: 'explorer_monde', label: 'Explorer le monde', emoji: '🌱', cycles: ['maternelle'] },
  { value: 'activites_artistiques', label: 'Activités artistiques', emoji: '🎨', cycles: ['maternelle'] },
  { value: 'activites_physiques', label: 'Agir, s\'exprimer avec son corps', emoji: '🤸', cycles: ['maternelle'] },

  // === FONDAMENTALES (élémentaire → supérieur) ===
  { value: 'francais', label: 'Français', emoji: '📖', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'mathematiques', label: 'Mathématiques', emoji: '🔢', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'histoire_geo', label: 'Histoire-Géographie', emoji: '🌍', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'emc', label: 'EMC (Enseignement moral et civique)', emoji: '⚖️', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro'] },

  // === VIE AFFECTIVE (nouveau programme 2025) ===
  { value: 'evar', label: 'EVAR (Vie affective et relationnelle)', emoji: '💛', cycles: ['maternelle', 'cycle2', 'cycle3'] },
  { value: 'evars', label: 'EVARS (Vie affective, relationnelle et sexualité)', emoji: '💛', cycles: ['college', 'lycee', 'lycee_pro'] },

  // === SCIENCES ===
  { value: 'decouverte_monde', label: 'Questionner le monde', emoji: '🔍', cycles: ['cycle2'] },
  { value: 'sciences_primaire', label: 'Sciences et technologie', emoji: '🔬', cycles: ['cycle3'] },
  { value: 'physique_chimie', label: 'Physique-Chimie', emoji: '⚛️', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'svt', label: 'SVT', emoji: '🧬', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'sciences_ingenieur', label: 'Sciences de l\'ingénieur (SI)', emoji: '🏗️', cycles: ['lycee', 'superieur'] },
  { value: 'sciences_numeriques', label: 'SNT (Sciences numériques)', emoji: '🖥️', cycles: ['lycee'] },
  { value: 'nsi', label: 'NSI (Numérique et sciences informatiques)', emoji: '💻', cycles: ['lycee', 'superieur'] },
  { value: 'technologie', label: 'Technologie', emoji: '⚙️', cycles: ['college', 'lycee_pro'] },

  // === LANGUES VIVANTES ===
  { value: 'anglais', label: 'Anglais', emoji: '🇬🇧', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'espagnol', label: 'Espagnol', emoji: '🇪🇸', cycles: ['college', 'lycee', 'lycee_pro', 'superieur'] },
  { value: 'allemand', label: 'Allemand', emoji: '🇩🇪', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'superieur'] },
  { value: 'italien', label: 'Italien', emoji: '🇮🇹', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'portugais', label: 'Portugais', emoji: '🇵🇹', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'chinois', label: 'Chinois', emoji: '🇨🇳', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'arabe', label: 'Arabe', emoji: '🇸🇦', cycles: ['college', 'lycee', 'superieur'] },
  { value: 'latin', label: 'Latin (LCA)', emoji: '🏛️', cycles: ['college', 'lycee'] },
  { value: 'grec', label: 'Grec ancien (LCA)', emoji: '🏺', cycles: ['college', 'lycee'] },

  // === SCIENCES HUMAINES ===
  { value: 'philosophie', label: 'Philosophie', emoji: '🤔', cycles: ['lycee', 'superieur'] },
  { value: 'ses', label: 'SES', emoji: '📊', cycles: ['lycee', 'superieur'] },
  { value: 'hggsp', label: 'HGGSP (Géopolitique)', emoji: '🗺️', cycles: ['lycee'] },
  { value: 'droit_economie', label: 'Droit et économie', emoji: '📜', cycles: ['lycee', 'lycee_pro', 'superieur'] },

  // === ARTS ===
  { value: 'arts_plastiques', label: 'Arts Plastiques', emoji: '🎨', cycles: ['cycle2', 'cycle3', 'college', 'lycee'] },
  { value: 'musique', label: 'Éducation musicale', emoji: '🎵', cycles: ['cycle2', 'cycle3', 'college', 'lycee'] },
  { value: 'histoire_arts', label: 'Histoire des arts', emoji: '🖼️', cycles: ['college', 'lycee'] },
  { value: 'theatre', label: 'Théâtre', emoji: '🎭', cycles: ['lycee', 'superieur'] },
  { value: 'cinema', label: 'Cinéma-Audiovisuel', emoji: '🎬', cycles: ['lycee', 'superieur'] },

  // === SPORT ===
  { value: 'eps', label: 'EPS', emoji: '🏃', cycles: ['cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro'] },

  // === PRO / TECHNO ===
  { value: 'management', label: 'Management / STMG', emoji: '💼', cycles: ['lycee', 'lycee_pro', 'superieur'] },
  { value: 'gestion', label: 'Gestion-Finance / Compta', emoji: '🧮', cycles: ['lycee', 'lycee_pro', 'superieur'] },

  // === CATCH-ALL ===
  { value: 'autre', label: 'Autre matière', emoji: '📝', cycles: ['maternelle', 'cycle2', 'cycle3', 'college', 'lycee', 'lycee_pro', 'superieur'] },
];

/** Get subjects filtered for a given level */
export function getMatieresForNiveau(niveau: NiveauScolaire): { value: Matiere; label: string; emoji: string }[] {
  const cycle = getNiveauCycle(niveau);
  return ALL_MATIERES
    .filter(m => m.cycles.includes(cycle))
    .map(({ value, label, emoji }) => ({ value, label, emoji }));
}

/** Full list (unfiltered) for history display etc. */
export const MATIERES = ALL_MATIERES.map(({ value, label, emoji }) => ({ value, label, emoji }));

export interface TypeContenuInfo {
  value: TypeContenu;
  label: string;
  description: string;
  icon: string;
  category: 'creation' | 'outils';
}

export const TYPE_CONTENU: TypeContenuInfo[] = [
  // === Création de contenu pédagogique ===
  { value: 'cours', label: 'Cours', description: 'Un cours structuré et complet', icon: '✦', category: 'creation' },
  { value: 'exercices', label: 'Exercices', description: 'Série d\'exercices progressifs', icon: '◈', category: 'creation' },
  { value: 'evaluation', label: 'Évaluation', description: 'Contrôle + corrigé + barème', icon: '◎', category: 'creation' },
  { value: 'sequence', label: 'Séquence', description: 'Séquence multi-séances', icon: '⬡', category: 'creation' },
  { value: 'fiche_prep', label: 'Fiche de prep', description: 'Fiche de préparation', icon: '◇', category: 'creation' },
  { value: 'progression', label: 'Progression', description: 'Progression annuelle complète', icon: '📅', category: 'creation' },
  // === Outils enseignant ===
  { value: 'appreciations', label: 'Appréciations', description: 'Bulletins trimestriels', icon: '💬', category: 'outils' },
  { value: 'differenciation', label: 'Différenciation', description: 'Adapter pour DYS, allophones, HPI', icon: '🎯', category: 'outils' },
  { value: 'lettre_parents', label: 'Courrier parents', description: 'Lettres et communications', icon: '✉️', category: 'outils' },
  { value: 'cahier_journal', label: 'Cahier journal', description: 'Journée type détaillée', icon: '📓', category: 'outils' },
  { value: 'corrige', label: 'Corrigé annoté', description: 'Corriger un travail d\'élève', icon: '🔍', category: 'outils' },
];

// =============================================
// HELPERS
// =============================================

export function getNiveauLabel(niveau: NiveauScolaire | string): string {
  for (const group of Object.values(NIVEAUX)) {
    const found = group.niveaux.find(n => n.value === niveau);
    if (found) return found.label;
  }
  return niveau;
}

export function getMatiereLabel(matiere: Matiere | string): string {
  return MATIERES.find(m => m.value === matiere)?.label ?? matiere;
}

export function getMatiereEmoji(matiere: Matiere | string): string {
  return MATIERES.find(m => m.value === matiere)?.emoji ?? '📝';
}

/** Suggested subjects per matiere to help teachers get started */
export const SUJETS_SUGGESTIONS: Partial<Record<Matiere, string[]>> = {
  francais: ['La conjugaison du passé composé', 'Les types de phrases', 'Étude d\'un conte', 'La dissertation', 'Le commentaire littéraire', 'L\'accord du participe passé'],
  mathematiques: ['Les fractions', 'Le théorème de Pythagore', 'Les fonctions affines', 'La proportionnalité', 'Les probabilités', 'Les nombres décimaux'],
  histoire_geo: ['La Révolution française', 'La Seconde Guerre mondiale', 'L\'Union européenne', 'Les espaces productifs', 'La décolonisation'],
  physique_chimie: ['L\'énergie électrique', 'La structure de l\'atome', 'Les forces', 'Les réactions chimiques', 'L\'optique'],
  svt: ['La cellule', 'La reproduction', 'L\'évolution', 'Le système immunitaire', 'La nutrition des plantes'],
  anglais: ['Present perfect vs Simple past', 'Describing a picture', 'Writing an email', 'Debating pros and cons'],
  philosophie: ['La liberté', 'La justice', 'Le bonheur', 'La conscience', 'L\'art et la beauté'],
  langage_oral: ['Les comptines et jeux de doigts', 'Raconter une histoire', 'Le vocabulaire des émotions', 'Décrire une image'],
  nombres_formes: ['Compter jusqu\'à 10', 'Les formes géométriques', 'Petit / grand / moyen', 'Algorithmes et suites logiques'],
  explorer_monde: ['Les 5 sens', 'Les saisons', 'Les animaux de la ferme', 'Se repérer dans l\'espace'],
  ses: ['Le marché et la formation des prix', 'Les inégalités sociales', 'Le chômage', 'La socialisation'],
  emc: ['Le harcèlement scolaire', 'Les symboles de la République', 'L\'égalité fille-garçon', 'Les droits de l\'enfant'],
};
