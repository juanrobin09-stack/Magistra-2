// Formats de travail normés (« type d'exercice », « format de l'épreuve », « forme du cours »…) et options des outils
// (objectif de l'évaluation, notation, corrigé, nombre d'exercices ou de séances, ton, besoins particuliers).
// Source unique partagée par l'interface, le serveur web et l'application Windows : chaque format n'est proposé (et
// accepté par la validation) que pour les outils, niveaux et matières où il a un sens, d'après les programmes et les
// épreuves en vigueur (brevet et baccalauréat, session 2026). Chaque format porte sa consigne pour le modèle : la
// structure attendue, sans jamais inventer de document, d'extrait d'auteur ni de référence réglementaire.

import type { Matiere, TypeContenu } from './catalog.js';
import { getLevelGroup, type LevelGroup, type NiveauScolaire } from './levels.js';

// ─── Options simples ────────────────────────────────────────────────────────

export type TypeEvaluation = 'diagnostique' | 'formative' | 'sommative';
export type Bareme = 'sur20' | 'sur10' | 'competences';
export type TonRedaction = 'encourageant' | 'exigeant' | 'factuel';
export type BesoinParticulier = 'dys' | 'tdah' | 'allophone' | 'tsa' | 'deficience_visuelle' | 'hpi';

export const TYPES_EVALUATION: {
  value: TypeEvaluation;
  label: string;
  description: string;
  prompt: string;
  /**
   * Consigne sans corrigé ni partie réservée à l'enseignant, pour une version élève seule (et, si l'objectif prévoit
   * un corrigé commenté, pour un texte à trous, dont Magistra établit le corrigé).
   */
  promptSansCorrige?: string;
}[] = [
  {
    value: 'diagnostique',
    label: 'Diagnostique',
    description: 'Avant la séquence : repérer les acquis et les besoins',
    // Sans notation choisie, la structure de l'évaluation est elle-même sans note (shared/prompts/tools.ts).
    prompt: 'OBJECTIF : évaluation diagnostique, avant l’apprentissage. Elle repère les acquis et les représentations des élèves : questions courtes sur les prérequis, puis, pour l’enseignant, un tableau « réponse ou erreur observée → besoin repéré → piste de remédiation ».',
    promptSansCorrige: 'OBJECTIF : évaluation diagnostique, avant l’apprentissage. Elle repère les acquis et les représentations des élèves : questions courtes sur les prérequis.',
  },
  {
    value: 'formative',
    label: 'Formative',
    description: 'Pendant l’apprentissage : faire le point, sans enjeu',
    prompt: 'OBJECTIF : évaluation formative, pendant l’apprentissage. Elle aide l’élève à se situer : critères de réussite explicites, auto-évaluation possible, corrigé commenté qui explique les erreurs fréquentes et indique quoi retravailler.',
    promptSansCorrige: 'OBJECTIF : évaluation formative, pendant l’apprentissage. Elle aide l’élève à se situer : critères de réussite explicites et grille d’auto-évaluation (je sais faire / pas encore) à remplir par l’élève.',
  },
  {
    value: 'sommative',
    label: 'Sommative',
    description: 'En fin de séquence : mesurer les acquis',
    prompt: 'OBJECTIF : évaluation sommative, en fin de séquence : elle mesure les acquis sur l’ensemble des objectifs travaillés, du plus simple au plus exigeant.',
  },
];

export const BAREMES: { value: Bareme; label: string; description: string; prompt: string }[] = [
  { value: 'sur20', label: 'Sur 20', description: 'Note chiffrée sur 20', prompt: 'NOTATION : note sur 20 ; les points de chaque question sont indiqués et leur total fait exactement 20.' },
  { value: 'sur10', label: 'Sur 10', description: 'Note chiffrée sur 10', prompt: 'NOTATION : note sur 10 ; les points de chaque question sont indiqués et leur total fait exactement 10.' },
  {
    value: 'competences',
    label: 'Par compétences',
    description: 'Positionnement sans note',
    prompt: 'NOTATION : par compétences, sans note chiffrée. Chaque question est rattachée à une compétence ; grille de positionnement à 4 niveaux (maîtrise insuffisante, fragile, satisfaisante, très bonne maîtrise) avec les indicateurs observables de chaque niveau.',
  },
];

export const TONS: { value: TonRedaction; label: string; prompt: string }[] = [
  { value: 'encourageant', label: 'Encourageant', prompt: 'TON : très encourageant ; valorise chaque progrès, même modeste, et termine par une note d’élan.' },
  { value: 'exigeant', label: 'Exigeant', prompt: 'TON : exigeant mais respectueux ; nomme clairement ce qui manque et ce qui est attendu, sans jamais blesser.' },
  { value: 'factuel', label: 'Factuel', prompt: 'TON : neutre et factuel ; des constats précis et des conseils, sans adjectif superflu.' },
];

export const BESOINS_PARTICULIERS: { value: BesoinParticulier; label: string; description: string; prompt: string }[] = [
  {
    value: 'dys',
    label: 'DYS',
    description: 'Troubles des apprentissages (lecture, écriture, calcul)',
    prompt: 'Élèves DYS : consignes courtes (une action par phrase), mise en page aérée, mots-clés en gras, réduction de la copie (textes à trous, réponses à entourer), exemples résolus, temps ou quantité adaptés.',
  },
  {
    value: 'tdah',
    label: 'TDAH',
    description: 'Attention, concentration',
    prompt: 'Élèves avec un trouble de l’attention : tâches découpées en étapes courtes et numérotées, repères visuels de progression, pauses actives prévues, consignes rappelées en tête de chaque étape.',
  },
  {
    value: 'allophone',
    label: 'Allophones',
    description: 'Français langue seconde (FLS)',
    prompt: 'Élèves allophones : lexique essentiel illustré ou expliqué simplement, phrases courtes au présent, structures de réponse proposées (« Je pense que… parce que… »), supports visuels décrits.',
  },
  {
    value: 'tsa',
    label: 'TSA',
    description: 'Troubles du spectre de l’autisme',
    prompt: 'Élèves avec TSA : déroulé prévisible et annoncé, consignes explicites et littérales (sans implicite ni second degré), un seul changement à la fois, critères de réussite visibles.',
  },
  {
    value: 'deficience_visuelle',
    label: 'Malvoyance',
    description: 'Déficience visuelle',
    prompt: 'Élèves malvoyants : contenus lisibles en gros caractères, pas d’information portée seulement par la couleur ou l’image (descriptions textuelles), tableaux simples, alternatives orales.',
  },
  {
    value: 'hpi',
    label: 'Haut potentiel',
    description: 'Besoin de défi et d’autonomie',
    prompt: 'Élèves à haut potentiel : tâches ouvertes à plusieurs solutions, défis de transfert, autonomie dans la démarche, moins de répétition.',
  },
];

export const NOMBRES_EXERCICES = [3, 5, 8, 10, 12] as const;
export const NOMBRES_SEANCES = [3, 4, 5, 6, 8, 10] as const;
export const LIMITES_NOMBRES = { exercices: { min: 1, max: 15 }, seances: { min: 2, max: 12 } } as const;

// ─── Formats de travail ─────────────────────────────────────────────────────

export interface ModaliteContext {
  niveau: NiveauScolaire;
  matiere: Matiere;
  group: LevelGroup;
}

export interface ModaliteInfo {
  value: string;
  label: string;
  description: string;
  tools: readonly TypeContenu[];
  /** Groupes de niveaux concernés (absent : tous sauf la maternelle). */
  groups?: readonly LevelGroup[];
  /** Classes précises (épreuves de fin de cycle : 3e, 1re, terminale). */
  niveaux?: readonly NiveauScolaire[];
  /** Matières concernées (absent : toutes). */
  matieres?: readonly Matiere[];
  /** Consigne de structure transmise au modèle. */
  prompt: string | ((ctx: ModaliteContext) => string);
  /**
   * Ce que compte « Nombre de… » (outil Exercices) avec ce format ; absent : les exercices. 'single' : un travail d'un
   * seul tenant (dissertation, dictée, étude de cas…), qui ne se multiplie pas : aucun nombre n'est proposé ni transmis.
   */
  count?: CountUnit | 'single';
}

/** Ce qui se compte : « 1 question », « 10 questions » (numérotées), et les nombres proposés (dans LIMITES_NOMBRES). */
export interface CountUnit {
  one: string;
  many: string;
  feminine?: true;
  options: readonly number[];
}

const EXERCICES: CountUnit = { one: 'exercice', many: 'exercices', options: NOMBRES_EXERCICES };
const ACTIVITES: CountUnit = { one: 'activité', many: 'activités', feminine: true, options: [2, 3, 4, 5, 6] };
const QUESTIONS: CountUnit = { one: 'question', many: 'questions', feminine: true, options: [5, 8, 10, 12, 15] };
const AFFIRMATIONS: CountUnit = { one: 'affirmation', many: 'affirmations', feminine: true, options: [4, 6, 8, 10, 12] };
const MOTS_A_COMPLETER: CountUnit = { one: 'mot à compléter', many: 'mots à compléter', options: [5, 8, 10, 12, 15] };
const PROBLEMES: CountUnit = { one: 'problème', many: 'problèmes', options: [1, 2, 3, 4] };
const ATELIERS: CountUnit = { one: 'atelier', many: 'ateliers', options: [2, 3, 4, 5, 6] };
const JEUX: CountUnit = { one: 'jeu', many: 'jeux', options: [1, 2, 3, 4] };

const SUP: LevelGroup[] = ['bts_but', 'cpge', 'licence', 'master', 'doctorat'];
const SCOLAIRE: LevelGroup[] = ['elementaire', 'college', 'lycee', 'lycee_pro'];
const SECONDAIRE: LevelGroup[] = ['college', 'lycee', 'lycee_pro'];
const SECONDAIRE_SUP: LevelGroup[] = [...SECONDAIRE, ...SUP];
const TOUS: LevelGroup[] = [...SCOLAIRE, ...SUP];

const FRANCAIS: Matiere[] = ['francais', 'lettres'];
const LANGUES: Matiere[] = ['anglais', 'espagnol', 'allemand', 'italien', 'portugais', 'chinois', 'arabe'];
const LANGUES_ANCIENNES: Matiere[] = ['latin', 'grec'];
const HISTOIRE_GEO: Matiere[] = ['histoire_geo', 'histoire', 'geographie', 'hggsp'];
const MATHS: Matiere[] = ['mathematiques', 'statistiques'];
const SCIENCES: Matiere[] = [
  'physique_chimie', 'svt', 'sciences_primaire', 'decouverte_monde', 'technologie', 'sciences_ingenieur',
  'physique', 'chimie', 'biologie', 'sciences_terre', 'medecine_sante',
];
const NUMERIQUE: Matiere[] = ['nsi', 'sciences_numeriques', 'informatique', 'systemes_information', 'technologie', 'sciences_ingenieur'];
const ECO_GESTION: Matiere[] = ['ses', 'economie', 'gestion', 'management', 'droit_economie'];
const DROIT: Matiere[] = ['droit', 'droit_economie'];
const SCIENCES_HUMAINES_SUP: Matiere[] = [
  'philosophie', 'lettres', 'histoire', 'geographie', 'economie', 'droit', 'science_politique', 'sociologie',
  'psychologie', 'sciences_education', 'communication', 'arts', 'linguistique',
];
const DOCUMENTS: Matiere[] = [
  ...HISTOIRE_GEO, 'emc', 'ses', 'svt', 'physique_chimie', 'sciences_primaire', 'decouverte_monde', 'histoire_arts',
  'droit_economie', 'management', 'economie', 'sociologie', 'science_politique', 'geographie', 'biologie', 'sciences_terre',
];

const TRAVAIL: TypeContenu[] = ['exercices', 'evaluation'];
const TRAVAIL_CORRIGE: TypeContenu[] = ['exercices', 'evaluation', 'corrige'];

/** Texte support d'un exercice sur texte : jamais un faux extrait attribué à un auteur. */
const TEXTE_SUPPORT = 'Texte support : l’extrait fourni dans les sources s’il y en a un ; sinon, un emplacement [Texte à coller] avec la nature et la longueur de l’extrait à choisir (œuvre, passage). N’invente jamais un extrait attribué à un auteur réel.';

/** Longueur usuelle d'une dictée selon la classe (le modèle vise cette longueur, sans avoir à compter les mots). */
function longueurDictee(niveau: NiveauScolaire): string {
  switch (niveau) {
    case 'cp': return 'deux ou trois phrases courtes (15 à 30 mots)';
    case 'ce1': return '30 à 50 mots';
    case 'ce2': return '40 à 60 mots';
    case 'cm1': return '60 à 80 mots';
    case 'cm2': return '70 à 100 mots';
    case '6eme': return '80 à 110 mots';
    case '5eme': return '90 à 120 mots';
    case '4eme': return '100 à 130 mots';
    case '3eme': return '110 à 150 mots';
    default: return '100 à 150 mots';
  }
}

function sujetBrevet({ matiere }: ModaliteContext): string {
  switch (matiere) {
    case 'francais':
      return 'FORMAT : sujet de type brevet (français). Travail sur un texte littéraire (et éventuellement une image) : questions de compréhension et d’interprétation, questions de grammaire et de compétences linguistiques, une réécriture ; une dictée ; puis une rédaction au choix entre un sujet d’imagination et un sujet de réflexion. ' + TEXTE_SUPPORT;
    case 'mathematiques':
      return 'FORMAT : sujet de type brevet (mathématiques). Une partie d’automatismes à traiter sans calculatrice (questions flash), puis des exercices indépendants couvrant plusieurs domaines (nombres et calculs, géométrie, fonctions, statistiques et probabilités, algorithmique), dont un problème avec prise d’initiative.';
    case 'histoire_geo':
      return 'FORMAT : sujet de type brevet (histoire-géographie). Un exercice d’analyse et de compréhension de document(s), un développement construit répondant à une question, et un exercice mobilisant un croquis, un schéma ou des repères chronologiques et spatiaux.';
    case 'emc':
      return 'FORMAT : sujet de type brevet (EMC). Une situation pratique de la vie collective, avec des documents : questions guidant l’identification du problème, des valeurs et des règles en jeu, puis une réponse argumentée.';
    default:
      return 'FORMAT : sujet de type brevet (sciences). Exercices à partir de documents mobilisant le raisonnement scientifique (physique-chimie, SVT ou technologie) : extraire, interpréter, argumenter.';
  }
}

function sujetBac({ matiere, niveau }: ModaliteContext): string {
  const techno = niveau === '1ere_techno' || niveau === 'terminale_techno';
  switch (matiere) {
    case 'francais':
      return techno
        ? 'FORMAT : sujet de type baccalauréat de français (voie technologique). Au choix : un commentaire de texte, OU une contraction de texte suivie d’un essai. ' + TEXTE_SUPPORT
        : 'FORMAT : sujet de type baccalauréat de français (voie générale). Au choix : un commentaire de texte, OU une dissertation sur une œuvre et son parcours au programme. ' + TEXTE_SUPPORT;
    case 'philosophie':
      return 'FORMAT : sujet de type baccalauréat de philosophie. Au choix : deux sujets de dissertation OU une explication de texte. ' + TEXTE_SUPPORT;
    case 'mathematiques':
      return niveau === '1ere_gen' || niveau === '1ere_techno'
        ? 'FORMAT : sujet de type épreuve anticipée de mathématiques (première). Une partie d’automatismes sous forme de QCM sans justification, puis des exercices de raisonnement.'
        : 'FORMAT : sujet de type baccalauréat de mathématiques. Exercices indépendants et contextualisés couvrant le programme, du plus guidé au plus ouvert.';
    case 'ses':
      return 'FORMAT : sujet de type baccalauréat de SES. Au choix : une dissertation appuyée sur un dossier documentaire, OU une épreuve composée (mobilisation des connaissances, étude d’un document, raisonnement appuyé sur un dossier).';
    case 'hggsp':
      return 'FORMAT : sujet de type baccalauréat d’HGGSP. Une dissertation (choix entre deux sujets), puis une étude critique d’un ou deux documents.';
    case 'svt':
      return 'FORMAT : sujet de type baccalauréat de SVT. Un exercice de mobilisation des connaissances (réponse argumentée et structurée), puis un exercice de raisonnement scientifique à partir de documents.';
    case 'physique_chimie':
      return 'FORMAT : sujet de type baccalauréat de physique-chimie. Exercices indépendants et contextualisés : modélisation, calculs, exploitation de données expérimentales, esprit critique sur les résultats.';
    case 'nsi':
      return 'FORMAT : sujet de type baccalauréat de NSI. Exercices indépendants : structures de données, algorithmique, bases de données, réseaux et programmation en Python.';
    case 'histoire_geo':
      return 'FORMAT : sujet d’histoire-géographie de niveau baccalauréat. Une composition, puis une étude critique de document(s) ou une production graphique.';
    default:
      return 'FORMAT : sujet de niveau baccalauréat, construit sur les attendus de l’épreuve de la discipline (structure, durée, barème indicatif).';
  }
}

/**
 * Tous les formats, dans l'ordre d'affichage (formats propres à une discipline d'abord, puis formats généraux).
 * « value » est stable : il est enregistré dans l'historique et transmis par le site à l'application Windows.
 */
export const MODALITES: ModaliteInfo[] = [
  // ── Épreuves de fin de cycle ──
  {
    value: 'sujet_brevet', label: 'Sujet type brevet', description: 'Structure de l’épreuve du brevet', tools: ['evaluation'],
    niveaux: ['3eme'], matieres: ['francais', 'mathematiques', 'histoire_geo', 'emc', 'physique_chimie', 'svt', 'technologie'],
    prompt: sujetBrevet,
  },
  {
    value: 'sujet_bac', label: 'Sujet type bac', description: 'Structure de l’épreuve du baccalauréat', tools: ['evaluation'],
    niveaux: ['1ere_gen', '1ere_techno', 'terminale_gen', 'terminale_techno'],
    matieres: ['francais', 'philosophie', 'mathematiques', 'ses', 'hggsp', 'svt', 'physique_chimie', 'nsi', 'histoire_geo'],
    prompt: sujetBac,
  },
  {
    value: 'partiel', label: 'Partiel', description: 'Sujet d’examen universitaire', tools: ['evaluation'], groups: SUP,
    prompt: 'FORMAT : sujet de partiel. En-tête (UE, durée, documents autorisés), questions de cours, exercices ou cas, barème par question.',
  },
  {
    value: 'interro', label: 'Interrogation courte', description: '10 à 20 minutes, l’essentiel', tools: ['evaluation'], groups: SECONDAIRE_SUP,
    prompt: 'FORMAT : interrogation écrite courte (10 à 20 minutes) : 3 à 6 questions ciblées sur l’essentiel, barème simple.',
  },

  // ── Français et lettres ──
  {
    value: 'dissertation', label: 'Dissertation', description: 'Sujet, problématique, plan, rédaction', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', ...SUP], matieres: ['francais', 'philosophie', 'ses', 'hggsp', ...SCIENCES_HUMAINES_SUP, 'autre'],
    prompt: ({ group }) => `FORMAT : dissertation. Un sujet (question ou citation à discuter) conforme aux attendus de la discipline${SUP.includes(group) ? ' et du niveau universitaire' : ''}. Corrigé méthodologique : analyse des termes du sujet, problématique, plan détaillé en deux ou trois parties avec arguments et exemples précis, introduction rédigée (accroche, définition des termes, problématique, annonce du plan) et conclusion rédigée (réponse, ouverture).`,
  },
  {
    value: 'commentaire', label: 'Commentaire de texte', description: 'Projet de lecture et plan', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', ...SUP], matieres: ['francais', 'lettres', ...LANGUES_ANCIENNES],
    prompt: `FORMAT : commentaire littéraire. ${TEXTE_SUPPORT} Consigne, éventuellement un parcours de lecture. Corrigé : introduction (présentation et situation du texte, projet de lecture, annonce du plan), développement en deux ou trois parties argumentées et illustrées par des citations analysées, conclusion (bilan, ouverture).`,
  },
  {
    value: 'contraction_essai', label: 'Contraction + essai', description: 'Voie technologique', tools: TRAVAIL_CORRIGE, count: 'single',
    niveaux: ['2nde_gt', '1ere_techno'], matieres: ['francais'],
    prompt: `FORMAT : contraction de texte suivie d’un essai. ${TEXTE_SUPPORT} Consigne de contraction au quart de la longueur du texte (marge admise indiquée), puis un sujet d’essai lié au thème. Corrigé : une contraction modèle et le plan détaillé de l’essai.`,
  },
  {
    value: 'explication_lineaire', label: 'Explication linéaire', description: 'Préparation à l’oral', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee'], matieres: ['francais'],
    prompt: `FORMAT : explication linéaire (oral). ${TEXTE_SUPPORT} Mouvements du texte et projet de lecture ; corrigé qui suit le texte dans l’ordre (citations, procédés, interprétations), avec introduction et conclusion ; une question de grammaire sur une phrase de l’extrait.`,
  },
  {
    value: 'comprehension', label: 'Compréhension de texte', description: 'Questions sur un texte', tools: TRAVAIL, count: QUESTIONS,
    groups: ['elementaire', 'college', 'lycee_pro'], matieres: FRANCAIS,
    prompt: `FORMAT : compréhension et interprétation d’un texte. ${TEXTE_SUPPORT} Aux niveaux élémentaire et collège, un texte court écrit pour l’exercice (présenté comme tel) convient. Questions de compréhension littérale, puis d’interprétation (procédés d’écriture, effets sur le lecteur), réponses justifiées par des citations du texte.`,
  },
  {
    value: 'grammaire', label: 'Étude de la langue', description: 'Grammaire, conjugaison, orthographe', tools: TRAVAIL,
    groups: SCOLAIRE, matieres: FRANCAIS,
    prompt: 'FORMAT : étude de la langue. Exercices de grammaire, de conjugaison, d’orthographe ou de lexique, en contexte (phrases tirées d’un même court texte) ; terminologie grammaticale conforme aux programmes ; corrigé expliqué.',
  },
  {
    value: 'dictee', label: 'Dictée', description: 'Texte, difficultés ciblées, grille', tools: TRAVAIL, count: 'single',
    groups: ['elementaire', 'college', 'lycee_pro'], matieres: ['francais'],
    prompt: ({ niveau }) => `FORMAT : dictée, en quatre parties. 1. « Texte de la dictée » : un texte suivi de ${longueurDictee(niveau)}, écrit en entier et parfaitement correct, que l’enseignant lit tel quel : aucun verbe à conjuguer entre parenthèses, aucun blanc, tous les accords faits ; c’est le texte de référence : relis-le mot à mot (participes passés, pluriels, homophones) pour qu’il soit sans aucune faute ; il n’est pas un corrigé et figure toujours. 2. « Difficultés ciblées » : trois à cinq points (accords, homophones, terminaisons verbales), chacun avec le mot du texte et la règle en une phrase exacte (par exemple : « elles sont parties » — avec l’auxiliaire être, le participe passé s’accorde avec le sujet). 3. « Mots au tableau » : noms propres et mots rares. 4. « Dictée aménagée » : le même texte avec des blancs sur les difficultés ciblées, pour les élèves en difficulté. Puis une grille de correction.`,
  },
  {
    value: 'reecriture', label: 'Réécriture', description: 'Transformer un passage', tools: TRAVAIL, count: 'single',
    groups: ['college', 'lycee_pro'], matieres: ['francais'],
    prompt: 'FORMAT : réécriture. Un court passage à réécrire en changeant une contrainte (personne, nombre, temps, genre, discours rapporté), avec la consigne exacte et le nombre de modifications attendues ; corrigé avec les modifications en gras.',
  },
  {
    value: 'redaction', label: 'Rédaction', description: 'Production écrite guidée', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['elementaire', 'college', 'lycee_pro'], matieres: FRANCAIS,
    prompt: 'FORMAT : production écrite. Un sujet précis (situation, destinataire, type de texte, longueur attendue), des critères de réussite explicites et une grille d’évaluation (contenu, organisation, langue).',
  },

  // ── Philosophie ──
  {
    value: 'explication_texte', label: 'Explication de texte', description: 'Thèse, enjeu, structure', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', ...SUP], matieres: ['philosophie'],
    prompt: `FORMAT : explication de texte philosophique. ${TEXTE_SUPPORT} Corrigé : thème, thèse, enjeu, structure argumentative, explication suivie, intérêt philosophique.`,
  },

  // ── Histoire-géographie, EMC, SES ──
  {
    value: 'developpement_construit', label: 'Développement construit', description: 'Réponse organisée et argumentée', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['college', 'lycee_pro'], matieres: ['histoire_geo'],
    prompt: 'FORMAT : développement construit. Une question précise et sa consigne (texte structuré de deux ou trois paragraphes) ; corrigé : réponse organisée (courte introduction, paragraphes argumentés, notions clés définies, exemples précis, repères datés), conclusion.',
  },
  {
    value: 'composition', label: 'Composition', description: 'Problématique et plan détaillé', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', ...SUP], matieres: ['histoire_geo', 'hggsp', 'histoire', 'geographie'],
    prompt: 'FORMAT : composition. Un sujet problématisé ; corrigé : analyse du sujet (termes, bornes chronologiques et spatiales), problématique, plan détaillé en deux ou trois parties avec arguments, exemples et repères précis, introduction et conclusion rédigées.',
  },
  {
    value: 'etude_critique', label: 'Étude critique de documents', description: 'Présenter, analyser, critiquer', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', ...SUP], matieres: ['histoire_geo', 'hggsp', 'histoire', 'geographie', 'science_politique'],
    prompt: 'FORMAT : étude critique de document(s). Document(s) décrits ou reproduits (issus des sources, ou construits pour l’exercice et présentés comme tels), consigne guidant la présentation (nature, auteur, date, contexte), l’analyse et la critique (portée, limites) ; corrigé organisé.',
  },
  {
    value: 'croquis', label: 'Croquis / schéma', description: 'Légende organisée, figurés', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: SECONDAIRE_SUP, matieres: ['histoire_geo', 'hggsp', 'geographie'],
    prompt: 'FORMAT : croquis ou schéma cartographique. Sujet, fond de carte à fournir par l’enseignant, informations à représenter ; corrigé : légende organisée en parties titrées, figurés choisis (surfaces, points, lignes, flèches) et leur justification, titre.',
  },
  {
    value: 'reperes', label: 'Repères', description: 'Frise et carte à compléter', tools: TRAVAIL, count: 'single',
    groups: ['elementaire', 'college', 'lycee_pro'], matieres: ['histoire_geo'],
    prompt: 'FORMAT : repères chronologiques et spatiaux. Frise chronologique à compléter (dates, périodes) et carte à légender (lieux, espaces), décrites précisément ; corrigé complet.',
  },
  {
    value: 'situation_pratique', label: 'Situation pratique', description: 'Problème de la vie collective', tools: TRAVAIL, count: 'single',
    groups: SECONDAIRE, matieres: ['emc'],
    prompt: 'FORMAT : situation pratique (EMC). Une situation concrète de la vie collective (classe, établissement, commune) qui pose un problème ; questions guidant l’identification du problème, des valeurs et des règles en jeu (droits, devoirs, principes de la République), puis la proposition argumentée d’une solution ; corrigé.',
  },
  {
    value: 'debat', label: 'Débat argumenté', description: 'Rôles, règles, grille de l’oral', tools: TRAVAIL, count: 'single',
    groups: SCOLAIRE, matieres: ['emc', 'francais', 'philosophie', 'ses'],
    prompt: 'FORMAT : débat argumenté ou réglé. Question de débat, rôles, règles de prise de parole, documents d’appui, fiche de préparation des arguments, grille d’évaluation de l’oral.',
  },
  {
    value: 'epreuve_composee', label: 'Épreuve composée', description: 'Connaissances, document, raisonnement', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee'], matieres: ['ses'],
    prompt: 'FORMAT : épreuve composée (SES). Trois parties : mobilisation des connaissances ; étude d’un document statistique (issu des sources, ou construit pour l’exercice et présenté comme tel) ; raisonnement appuyé sur un dossier documentaire ; corrigé et barème indicatif.',
  },

  // ── Mathématiques et numérique ──
  {
    value: 'automatismes', label: 'Automatismes', description: 'Calcul mental, questions flash', tools: TRAVAIL, count: QUESTIONS,
    groups: ['elementaire', 'college', 'lycee', 'lycee_pro'], matieres: ['mathematiques'],
    prompt: 'FORMAT : automatismes. Série de questions flash courtes, sans calculatrice, en temps limité (durée totale indiquée, 10 à 20 minutes), couvrant selon le niveau calcul, fractions, pourcentages, proportionnalité, lecture graphique, équations ; corrigé avec la réponse et le « bon réflexe ».',
  },
  {
    value: 'demonstration', label: 'Démonstration', description: 'Raisonnement justifié pas à pas', tools: TRAVAIL_CORRIGE,
    groups: ['college', 'lycee', ...SUP], matieres: ['mathematiques', 'physique', 'statistiques'],
    prompt: 'FORMAT : démonstration. Énoncé précis (hypothèses, conclusion à établir), questions intermédiaires qui guident le raisonnement ; le corrigé rédige une démonstration complète, chaque étape justifiée par une propriété ou un théorème nommé.',
  },
  {
    value: 'algorithmique', label: 'Algorithmique', description: 'Scratch au collège, Python ensuite', tools: TRAVAIL_CORRIGE,
    groups: SECONDAIRE_SUP, matieres: ['mathematiques', ...NUMERIQUE],
    prompt: ({ group }) => `FORMAT : algorithmique et programmation. ${group === 'college' ? 'Au collège, programmes par blocs (type Scratch) décrits en texte.' : 'Langage Python.'} Énoncés avec entrées, sorties et exemples ; corrigé : code commenté, vérifié sur un exemple.`,
  },

  // ── Sciences ──
  {
    value: 'demarche_experimentale', label: 'Démarche expérimentale', description: 'Hypothèse, protocole, conclusion', tools: TRAVAIL, count: 'single',
    groups: TOUS, matieres: SCIENCES,
    prompt: 'FORMAT : démarche expérimentale ou d’investigation. Situation déclenchante, question scientifique, hypothèses à formuler, protocole à proposer (matériel, étapes, témoin, mesures), résultats à interpréter, conclusion ; consignes de sécurité si une manipulation est réelle.',
  },
  {
    value: 'schema', label: 'Schéma à compléter', description: 'Légendes, titre, flèches', tools: TRAVAIL,
    groups: TOUS, matieres: [...SCIENCES, 'geographie'],
    prompt: 'FORMAT : schéma à légender ou à compléter. Description précise du schéma (éléments, flèches, emplacement des légendes numérotées) ; corrigé avec les légendes et le titre attendus.',
  },

  // ── Langues vivantes et anciennes ──
  {
    value: 'comprehension_ecrite', label: 'Compréhension écrite', description: 'Texte en langue cible', tools: TRAVAIL, count: QUESTIONS,
    groups: TOUS, matieres: LANGUES,
    prompt: 'FORMAT : compréhension de l’écrit. Un texte original rédigé dans la langue cible au niveau du CECRL visé (indique-le, de A1 à C1), questions de compréhension globale puis détaillée, relevés, une question d’expression personnelle ; corrigé.',
  },
  {
    value: 'comprehension_orale', label: 'Compréhension de l’oral', description: 'Script à lire ou enregistrer', tools: TRAVAIL, count: QUESTIONS,
    groups: TOUS, matieres: LANGUES,
    prompt: 'FORMAT : compréhension de l’oral. Script complet d’un document audio à lire ou à enregistrer (dialogue ou monologue, durée indiquée), niveau du CECRL, questions avant, pendant et après l’écoute ; corrigé.',
  },
  {
    value: 'expression_ecrite', label: 'Expression écrite', description: 'Sujet, nombre de mots, grille', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: TOUS, matieres: LANGUES,
    prompt: 'FORMAT : expression écrite en langue cible. Sujet rédigé dans la langue cible, nombre de mots attendu, niveau du CECRL visé, aides lexicales ; grille d’évaluation (réalisation de la tâche, cohérence, richesse et correction de la langue).',
  },
  {
    value: 'expression_orale', label: 'Expression orale', description: 'En continu ou en interaction', tools: TRAVAIL, count: 'single',
    groups: TOUS, matieres: LANGUES,
    prompt: 'FORMAT : expression orale en continu ou en interaction. Consigne, temps de préparation et de parole, pistes lexicales, grille d’évaluation de l’oral selon le CECRL.',
  },
  {
    value: 'traduction', label: 'Traduction', description: 'Version ou thème', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['college', 'lycee', ...SUP], matieres: [...LANGUES, ...LANGUES_ANCIENNES],
    prompt: `FORMAT : traduction (version ou thème). ${TEXTE_SUPPORT} Aides lexicales et difficultés ciblées ; corrigé : traduction proposée et commentaire des choix de traduction.`,
  },

  // ── Droit, économie, gestion ──
  {
    value: 'cas_pratique', label: 'Cas pratique', description: 'Faits, problème de droit, solution', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', 'lycee_pro', ...SUP], matieres: DROIT,
    prompt: 'FORMAT : cas pratique juridique. Faits précis et question(s) de droit ; corrigé selon le syllogisme juridique : qualification des faits, problème de droit, règle applicable, application aux faits, solution. Ne cite un numéro d’article ou une décision que si tu en es certain ou s’il figure dans les sources.',
  },
  {
    value: 'commentaire_arret', label: 'Commentaire d’arrêt', description: 'Fiche d’arrêt, sens, valeur, portée', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: SUP, matieres: ['droit'],
    prompt: 'FORMAT : commentaire d’arrêt. Décision support : celle des sources, sinon un emplacement [Décision à coller] (n’invente jamais de décision). Corrigé : fiche d’arrêt (faits, procédure, prétentions, problème de droit, solution), problématique, plan en deux parties et deux sous-parties (sens, valeur, portée).',
  },
  {
    value: 'etude_cas', label: 'Étude de cas', description: 'Situation, annexes, questions', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: ['lycee', 'lycee_pro', ...SUP], matieres: [...ECO_GESTION, ...DROIT, ...NUMERIQUE, 'medecine_sante', 'sciences_education', 'psychologie', 'communication', 'autre'],
    prompt: 'FORMAT : étude de cas. Présentation d’une organisation ou d’une situation (fictive et présentée comme telle), annexes avec des données chiffrées cohérentes entre elles, dossier de questions progressives ; éléments de corrigé détaillés.',
  },
  {
    value: 'note_synthese', label: 'Note de synthèse', description: 'Dossier documentaire, plan', tools: TRAVAIL_CORRIGE, count: 'single',
    groups: SUP, prompt: 'FORMAT : note de synthèse. Dossier documentaire (les sources fournies ; sinon, la liste des documents à réunir), consigne (longueur, destinataire) ; corrigé : plan en deux parties, reformulation neutre, renvoi aux documents.',
  },

  // ── Formats généraux ──
  {
    value: 'application', label: 'Application', description: 'Entraînement progressif', tools: TRAVAIL, groups: TOUS,
    prompt: 'FORMAT : exercices d’application. Exercices courts et progressifs qui font appliquer directement la notion (du geste simple à la combinaison de savoir-faire), chacun avec une consigne unique et claire.',
  },
  {
    value: 'qcm', label: 'QCM', description: 'Une bonne réponse sur quatre', tools: TRAVAIL, count: QUESTIONS, groups: TOUS,
    prompt: 'FORMAT : QCM. Chaque question porte sur un seul point et propose 4 réponses (A, B, C, D) dont une seule exacte. Pour chaque question : détermine d’abord la réponse exacte (refais le calcul ou le raisonnement), écris-la telle quelle comme l’un des 4 choix, puis trois distracteurs faux, plausibles et fondés sur les erreurs fréquentes ; ni « toutes les réponses », ni piège de formulation. Présentation (forme seulement, contenu à adapter au sujet) : « **Question 1.** Combien font 3 × 4 ? », puis un choix par ligne : « A) 7 », « B) 12 », « C) 34 », « D) 1 ». Le corrigé donne pour chaque question la lettre exacte et une explication d’une ligne (« Question 1 : B — 3 × 4 = 12 »).',
  },
  {
    value: 'vrai_faux', label: 'Vrai / faux justifié', description: 'Affirmations à justifier', tools: TRAVAIL, count: AFFIRMATIONS, groups: TOUS,
    prompt: 'FORMAT : vrai ou faux, avec justification. Affirmations nettes, chacune vraie ou fausse sans ambiguïté (ni piège, ni double négation), autant de vraies que de fausses, dans un ordre mélangé ; l’élève coche puis justifie en une phrase. Présentation (forme seulement) : « **1.** [affirmation] ☐ Vrai ☐ Faux — Justification : … ». Le corrigé donne pour chaque affirmation « Vrai » ou « Faux » et la justification attendue (pour une affirmation fausse, l’énoncé correct).',
  },
  {
    value: 'texte_trous', label: 'Texte à trous', description: 'Mots-clés à compléter', tools: TRAVAIL, count: MOTS_A_COMPLETER, groups: SCOLAIRE,
    prompt: 'FORMAT : texte à trous. Écris le texte COMPLET, suivi, cohérent et exact sur la notion, au niveau de la classe, et entoure de doubles crochets chaque mot-clé à faire trouver, et seulement eux (aucun gras ni italique dans le texte) : un mot ou un groupe très court par paire de crochets, au plus deux par phrase. Forme seulement : « Le chat [[dort]] sur le canapé pendant que le [[chien]] joue. » Magistra remplace ensuite chaque mot entre doubles crochets par un blanc numéroté, puis ajoute la banque de mots et le corrigé : ne les écris pas, et n’écris aucun blanc toi-même.',
  },
  {
    value: 'questions_cours', label: 'Questions de cours', description: 'Restitution des connaissances', tools: TRAVAIL, count: QUESTIONS, groups: SECONDAIRE_SUP,
    prompt: 'FORMAT : questions de cours (restitution des connaissances). Questions précises et courtes (définir, citer, expliquer, donner un exemple) ; corrigé rédigé comme une trace écrite.',
  },
  {
    value: 'probleme', label: 'Problème', description: 'Situation complexe, démarche', tools: TRAVAIL_CORRIGE, count: PROBLEMES, groups: TOUS,
    matieres: [...MATHS, ...SCIENCES, ...NUMERIQUE, ...ECO_GESTION, 'autre'],
    prompt: 'FORMAT : problème. Situation contextualisée et réaliste, données complètes et cohérentes, questions enchaînées du plus guidé au plus autonome, une question finale de synthèse ou de prise d’initiative ; corrigé avec la démarche complète.',
  },
  {
    value: 'etude_documents', label: 'Étude de documents', description: 'Prélever, analyser, relier', tools: TRAVAIL_CORRIGE, count: 'single', groups: TOUS,
    matieres: DOCUMENTS,
    prompt: 'FORMAT : étude de documents. Un à trois documents reproduits ou décrits précisément (issus des sources, ou construits pour l’exercice et présentés comme tels : jamais une fausse citation ni une fausse statistique attribuée à une source réelle) ; questions de prélèvement, puis d’analyse, puis de mise en relation avec les connaissances ; corrigé.',
  },
  {
    value: 'oral', label: 'Oral', description: 'Exposé, lecture, interaction', tools: TRAVAIL, count: 'single', groups: TOUS,
    prompt: 'FORMAT : activité orale. Consigne de prise de parole (exposé, lecture expressive, interaction), temps de préparation et de parole, supports autorisés, grille d’évaluation de l’oral (contenu, clarté, posture, langue).',
  },
  {
    value: 'projet', label: 'Mini-projet', description: 'Cahier des charges, livrables', tools: TRAVAIL, count: 'single',
    groups: SECONDAIRE_SUP, prompt: 'FORMAT : mini-projet. Cahier des charges, livrables, étapes et jalons, répartition des rôles, critères et grille d’évaluation.',
  },

  // ── Maternelle (exercices = activités) ──
  {
    value: 'ateliers', label: 'Ateliers', description: 'Manipulation, en autonomie ou dirigés', tools: ['exercices', 'fiche_prep'], count: ATELIERS,
    groups: ['maternelle', 'elementaire'],
    prompt: 'FORMAT : ateliers. Pour chaque atelier : matériel, organisation (autonome ou dirigé, nombre d’élèves), consigne orale courte, critères de réussite observables, variantes plus simple et plus difficile ; rotation des groupes décrite.',
  },
  {
    value: 'jeux', label: 'Jeux', description: 'Règle, matériel, variantes', tools: ['exercices'], count: JEUX, groups: ['maternelle', 'elementaire'],
    prompt: 'FORMAT : jeux pédagogiques. Pour chaque jeu : but, matériel, règle expliquée simplement, déroulement, ce que l’enseignant observe, variantes.',
  },

  // ── Cours ──
  {
    value: 'synthese', label: 'Fiche de synthèse', description: 'L’essentiel sur une page', tools: ['cours'], groups: TOUS,
    prompt: 'FORME : fiche de synthèse d’une page. L’essentiel en encadrés courts : définitions, notions clés, méthodes, exemples types, erreurs à éviter. Pas de déroulé de séance.',
  },
  {
    value: 'trace_ecrite', label: 'Trace écrite', description: 'À copier dans le cahier', tools: ['cours'], groups: ['elementaire', 'college', 'lycee_pro'],
    prompt: 'FORME : trace écrite à copier dans le cahier. Courte et claire, mots-clés en gras, un exemple, un schéma décrit si utile ; phrases adaptées à l’âge des élèves.',
  },
  {
    value: 'plan_detaille', label: 'Plan détaillé', description: 'Parties, idées clés, exemples', tools: ['cours'], groups: ['lycee', ...SUP],
    prompt: 'FORME : plan détaillé du cours : parties et sous-parties titrées, idées clés, définitions et exemples, sans rédaction intégrale.',
  },
  {
    value: 'carte_mentale', label: 'Carte mentale', description: 'Notion centrale et branches', tools: ['cours'], groups: TOUS,
    prompt: 'FORME : carte mentale, sous forme de liste imbriquée : la notion centrale, 4 à 6 branches principales, des sous-branches (quatre niveaux au plus), mots-clés courts.',
  },
  {
    value: 'classe_inversee', label: 'Classe inversée', description: 'Capsule à la maison, activités en classe', tools: ['cours', 'sequence'],
    groups: SECONDAIRE_SUP,
    prompt: 'FORME : classe inversée. À la maison : une capsule (script d’une vidéo de 5 minutes au plus ou texte court) et 3 questions de vérification ; en classe : des activités de groupe pour appliquer et approfondir, puis une synthèse.',
  },
  {
    value: 'diaporama', label: 'Diaporama', description: 'Diapositives et notes', tools: ['cours'], groups: TOUS,
    prompt: 'FORME : diaporama de 8 à 15 diapositives. Pour chacune : un titre, 3 à 5 points courts, et les notes de l’enseignant (ce qu’il dit, la question à poser).',
  },

  // ── Séquence, séance, progression ──
  {
    value: 'investigation', label: 'Démarche d’investigation', description: 'Problème, hypothèses, expérience', tools: ['sequence', 'fiche_prep'],
    groups: ['elementaire', 'college', 'lycee', 'lycee_pro'], matieres: [...SCIENCES, 'mathematiques'],
    prompt: 'FORME : démarche d’investigation : situation-problème, questionnement, hypothèses des élèves, investigation (expérience, observation, recherche documentaire), confrontation, structuration des connaissances.',
  },
  {
    value: 'projet_sequence', label: 'Pédagogie de projet', description: 'Une production finale', tools: ['sequence'], groups: TOUS,
    prompt: 'FORME : pédagogie de projet : une production finale concrète, des étapes qui y mènent, des rôles, des jalons et une évaluation du projet et des apprentissages.',
  },
  {
    value: 'decouverte', label: 'Découverte', description: 'Introduire une notion', tools: ['fiche_prep'], groups: ['maternelle', ...TOUS],
    prompt: 'TYPE DE SÉANCE : découverte d’une notion (situation d’entrée, recherche, mise en commun, institutionnalisation).',
  },
  {
    value: 'entrainement', label: 'Entraînement', description: 'Consolider, automatiser', tools: ['fiche_prep'], groups: ['maternelle', ...TOUS],
    prompt: 'TYPE DE SÉANCE : entraînement (rappel, exercices progressifs, correction collective, bilan).',
  },
  {
    value: 'remediation', label: 'Remédiation', description: 'Reprendre ce qui n’est pas acquis', tools: ['fiche_prep'], groups: ['maternelle', ...TOUS],
    prompt: 'TYPE DE SÉANCE : remédiation (identification des erreurs, nouvelle approche de la notion, exercices ciblés par besoin, vérification).',
  },
  {
    value: 'seance_evaluation', label: 'Évaluation', description: 'Séance d’évaluation', tools: ['fiche_prep'], groups: TOUS,
    prompt: 'TYPE DE SÉANCE : séance d’évaluation (consignes, déroulé, aménagements, correction et retour aux élèves).',
  },
  {
    value: 'tp', label: 'TP', description: 'Manipulation et compte rendu', tools: ['fiche_prep'], groups: SECONDAIRE_SUP, matieres: [...SCIENCES, ...NUMERIQUE],
    prompt: 'TYPE DE SÉANCE : travaux pratiques (consignes de sécurité, matériel, protocole, relevés, compte rendu attendu).',
  },
  {
    value: 'periode', label: 'Une période', description: 'Entre deux vacances', tools: ['progression'], groups: ['maternelle', ...SCOLAIRE],
    prompt: 'FORME : progression sur une seule période (entre deux vacances scolaires, 6 à 8 semaines), semaine par semaine.',
  },
  {
    value: 'spiralee', label: 'Spiralée', description: 'Notions revues plusieurs fois', tools: ['progression'], groups: SCOLAIRE,
    matieres: ['mathematiques', 'francais', ...LANGUES],
    prompt: 'FORME : progression spiralée : chaque notion est abordée plusieurs fois dans l’année, à des niveaux d’approfondissement croissants ; le tableau indique pour chaque passage ce qui est nouveau.',
  },

  // ── Appréciations ──
  {
    value: 'conseil_classe', label: 'Conseil de classe', description: 'Avis du professeur principal', tools: ['appreciations'], groups: ['college', 'lycee', 'lycee_pro'],
    prompt: 'FORME : appréciations générales du conseil de classe (professeur principal) : bilan de l’ensemble des disciplines, comportement et investissement, conseil pour la suite. Sans mention de félicitations, de compliments ou d’avertissement, que seul le conseil de classe décide.',
  },
  {
    value: 'livret_bac', label: 'Livret scolaire (bac)', description: 'Appréciation annuelle pour le jury', tools: ['appreciations'],
    niveaux: ['1ere_gen', '1ere_techno', 'terminale_gen', 'terminale_techno', '1ere_pro', 'terminale_pro'],
    prompt: 'FORME : appréciations annuelles du livret scolaire (consulté par le jury du baccalauréat) : bilan de l’année, compétences et méthodes, régularité, potentiel ; registre sobre et précis.',
  },

  // ── Courrier ──
  {
    value: 'mail', label: 'Courriel / ENT', description: 'Message électronique', tools: ['lettre_parents'], groups: [...TOUS, 'maternelle'],
    prompt: 'FORME : courriel ou message de l’ENT : objet explicite, message court et structuré, sans en-tête postal.',
  },
  {
    value: 'carnet', label: 'Mot dans le carnet', description: 'Quelques lignes', tools: ['lettre_parents'], groups: ['maternelle', 'elementaire', 'college'],
    prompt: 'FORME : mot dans le carnet de liaison : quatre à six lignes, une information ou une demande claire, signature.',
  },
];

// ─── Disponibilité ──────────────────────────────────────────────────────────

function applies(format: ModaliteInfo, type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere): boolean {
  if (!format.tools.includes(type)) return false;
  const group = getLevelGroup(niveau);
  if (format.niveaux && !format.niveaux.includes(niveau)) return false;
  if (format.groups && !format.groups.includes(group)) return false;
  // Sans précision de niveau : tous les niveaux sauf la maternelle (ni copie, ni note, ni exercice écrit).
  if (!format.niveaux && !format.groups && group === 'maternelle') return false;
  return !format.matieres || format.matieres.includes(matiere);
}

/** Formats proposés pour cet outil, à ce niveau, dans cette matière (dans l'ordre d'affichage). */
export function modalitesFor(type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere): ModaliteInfo[] {
  return MODALITES.filter(f => applies(f, type, niveau, matiere));
}

/** Le format existe-t-il et convient-il à cet outil, ce niveau et cette matière ? */
export function isModaliteAvailable(value: unknown, type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere): value is string {
  return typeof value === 'string' && MODALITES.some(f => f.value === value && applies(f, type, niveau, matiere));
}

export function getModalite(value: string | undefined): ModaliteInfo | undefined {
  return value ? MODALITES.find(f => f.value === value) : undefined;
}

/**
 * Ce que compte le « Nombre de… » de l'outil Exercices avec ce format (les exercices par défaut, les activités en
 * maternelle), ou null pour un travail d'un seul tenant : le nombre n'est alors ni proposé, ni transmis, ni demandé.
 */
export function countUnit(modalite: string | undefined, group?: LevelGroup): CountUnit | null {
  const count = getModalite(modalite)?.count;
  if (count === 'single') return null;
  return count ?? (group === 'maternelle' ? ACTIVITES : EXERCICES);
}

/** « Nombre d'exercices », « Nombre de questions »… */
export function countLabel(unit: CountUnit): string {
  return /^[aeéèêiîoôu]/i.test(unit.many) ? `Nombre d'${unit.many}` : `Nombre de ${unit.many}`;
}

/** « 1 question », « 10 questions ». */
export function countText(n: number, unit: CountUnit): string {
  return `${n} ${n > 1 ? unit.many : unit.one}`;
}

/** Consigne du format pour le modèle (vide si le format est inconnu). */
export function modalitePrompt(value: string | undefined, ctx: Omit<ModaliteContext, 'group'>): string {
  const format = getModalite(value);
  if (!format) return '';
  return typeof format.prompt === 'string' ? format.prompt : format.prompt({ ...ctx, group: getLevelGroup(ctx.niveau) });
}

/** Libellé du groupe de formats selon l'outil (« Type d'exercice », « Format de l'épreuve »…). */
export function modaliteFieldLabel(type: TypeContenu, sup: boolean): string {
  switch (type) {
    case 'cours': return 'Forme du cours';
    case 'evaluation': return sup ? 'Format de l’examen' : 'Format de l’épreuve';
    case 'sequence': return sup ? 'Démarche' : 'Démarche de la séquence';
    case 'fiche_prep': return 'Type de séance';
    case 'progression': return 'Forme de la progression';
    case 'appreciations': return 'Destination';
    case 'lettre_parents': return 'Forme du message';
    case 'corrige': return 'Type de travail corrigé';
    default: return sup ? 'Type de TD' : 'Type d’exercice';
  }
}

/** Libellé du choix par défaut (aucun format imposé) : ce que Magistra produit alors. */
export function defaultModaliteLabel(type: TypeContenu): string {
  switch (type) {
    case 'cours': return 'Cours complet';
    case 'evaluation': return 'Contrôle classique';
    case 'sequence': return 'Classique';
    case 'fiche_prep': return 'Au choix';
    case 'progression': return 'Annuelle';
    case 'appreciations': return 'Bulletin';
    case 'lettre_parents': return 'Courrier';
    case 'corrige': return 'Au choix';
    default: return 'Variés';
  }
}
