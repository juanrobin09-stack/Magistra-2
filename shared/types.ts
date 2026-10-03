// Types de domaine partagés (navigateur, serveur web, application Windows).

import type {
  DifficulteExercice, FormatSeance, Matiere, ProfilDifferenciation, ProfilEleve, TypeContenu, TypeLettre,
} from './catalog.js';
import type { Bareme, BesoinParticulier, TonRedaction, TypeEvaluation } from './formats.js';
import type { NiveauScolaire } from './levels.js';
import type { ErrorCode } from './errors.js';
import type { EnginePlacement, EngineTimings } from './ai/timings.js';

export type ResearchMode = 'documents' | 'academic' | 'internet' | 'documents_internet';

export const RESEARCH_MODES: { value: ResearchMode; label: string; description: string; network: boolean }[] = [
  { value: 'documents', label: 'Mes documents uniquement', description: 'Aucune recherche externe. Fonctionne hors ligne.', network: false },
  { value: 'academic', label: 'Sources académiques', description: 'Vos documents + publications scientifiques (HAL, Crossref, OpenAlex) et sites officiels vérifiés.', network: true },
  { value: 'internet', label: 'Internet', description: 'Sites officiels vérifiés (UNESCO, Éduscol, ministères…) et Wikipédia, sans vos documents.', network: true },
  { value: 'documents_internet', label: 'Documents + Internet', description: 'Vos documents en priorité, complétés par les sites officiels vérifiés et Wikipédia.', network: true },
];

export function isResearchMode(value: unknown): value is ResearchMode {
  return typeof value === 'string' && RESEARCH_MODES.some(m => m.value === value);
}

/** Les documents de l'enseignant sont-ils utilisés dans ce mode ? */
export function modeUsesDocuments(mode: ResearchMode): boolean {
  return mode !== 'internet';
}

// ─── Profil enseignant ──────────────────────────────────────────────────────

export interface TeacherProfile {
  displayName: string;
  etablissement: string;
  cycle: string;
  niveaux: NiveauScolaire[];
  matierePrincipale: Matiere;
  matiereSecondaire?: Matiere;
  /** Discipline / spécialité libre (utile dans le supérieur : « Systèmes d'information », « Droit public »…). */
  discipline?: string;
}

// ─── Documents ──────────────────────────────────────────────────────────────

export type DocKind = 'pdf' | 'docx' | 'pptx' | 'txt' | 'md';

/** Emplacement précis d'un passage dans un document (base de toute citation). */
export interface Locator {
  type: 'pages' | 'slides' | 'section' | 'paragraphs' | 'lines';
  start: number;
  end: number;
  /** Titre de section, quand il existe réellement dans le document. */
  title?: string;
  /** Vrai si seul le début du passage a été transmis au modèle (budget de contexte). */
  partial?: boolean;
  /**
   * PDF : numéros de page imprimés (étiquettes du document, « xii », « 47 »), quand ils diffèrent
   * de la position de la page dans le fichier (`start`/`end`).
   */
  labels?: { start: string; end: string };
}

/** Passage de document sélectionné par la recherche locale et transmis au modèle. */
export interface DocumentPassage {
  docId: string;
  docName: string;
  kind: DocKind;
  locator: Locator;
  text: string;
}

// ─── Sources et citations ───────────────────────────────────────────────────

export type SourceKind = 'document' | 'hal' | 'crossref' | 'openalex' | 'web' | 'institutional' | 'wikipedia';

export interface SourceRef {
  /** Numéro de citation [n], attribué par le code — jamais par le modèle. */
  n: number;
  kind: SourceKind;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Document de l'enseignant : nom du fichier. */
  docName?: string;
  locator?: Locator;
}

// ─── Requête de génération ──────────────────────────────────────────────────

export interface GenerationRequest {
  type: TypeContenu;
  niveau: NiveauScolaire;
  matiere: Matiere;
  discipline?: string;
  sujet: string;
  duree?: string;
  objectifs?: string;
  consignes?: string;
  difficulte?: DifficulteExercice;
  format?: FormatSeance;
  nombreAppreciations?: number;
  trimestre?: '1' | '2' | '3';
  profilEleve?: ProfilEleve;
  profilsDifferenciation?: ProfilDifferenciation[];
  contenuSource?: string;
  typeLettre?: TypeLettre;
  texteEleve?: string;
  /** Format normé propre à l'outil, au niveau et à la matière (identifiant de MODALITES, shared/formats.ts). */
  modalite?: string;
  typeEvaluation?: TypeEvaluation;
  bareme?: Bareme;
  /** Vrai : version élève seule, sans corrigé (exercices, évaluation). Absent : corrigé inclus. */
  sansCorrige?: boolean;
  nombreExercices?: number;
  nombreSeances?: number;
  ton?: TonRedaction;
  besoins?: BesoinParticulier[];
  researchMode: ResearchMode;
  documents?: DocumentPassage[];
  profile?: TeacherProfile | null;
}

// ─── Historique ─────────────────────────────────────────────────────────────

export interface GenerationRecord {
  id: string;
  createdAt: string; // ISO 8601
  type: TypeContenu;
  niveau: NiveauScolaire | string;
  matiere: Matiere | string;
  discipline?: string;
  sujet: string;
  contenu: string;
  isFavorite: boolean;
  sources: SourceRef[];
  /** Paramètres utiles pour retrouver le contexte (sans le texte des documents). */
  params: Record<string, unknown>;
  truncated?: boolean;
  internetUsed?: boolean;
  model?: string;
}

/**
 * Génération prête à enregistrer (sans identifiant ni date, attribués par le stockage). Produite par la pipeline ;
 * transmise au site dans l'évènement « done » quand la génération a eu lieu dans l'application Windows à la demande
 * du site (connecteur local) : le site l'enregistre alors dans l'historique du compte (POST /api/generation).
 */
export type GenerationRecordDraft = Omit<GenerationRecord, 'id' | 'createdAt' | 'isFavorite'>;

export interface GenerationSummary {
  id: string;
  createdAt: string;
  type: TypeContenu;
  niveau: NiveauScolaire | string;
  matiere: Matiere | string;
  discipline?: string;
  sujet: string;
  isFavorite: boolean;
  excerpt: string;
}

export interface HistoryPage {
  items: GenerationSummary[];
  nextCursor?: string;
}

export interface UsageStats {
  total: number;
  favorites: number;
  today: number;
  week: number;
  topMatiere?: { matiere: string; count: number };
}

// ─── Évènements de génération (streaming) ───────────────────────────────────

export type GenerationStage = 'research' | 'context' | 'loading_model' | 'generating' | 'finalizing';

/**
 * Mesures d'une génération, jointes à l'évènement « done » (champ facultatif) pour la fenêtre « Détails de vitesse ».
 * Uniquement des nombres et des énumérations : jamais le prompt, le contenu, un nom de fichier ni une requête. Affichées
 * pour la session seulement : jamais enregistrées dans l'historique.
 */
export interface GenerationMetrics {
  /** Durée de la génération, de la demande validée à la fin (sauvegarde comprise). */
  totalMs: number;
  /** Préparation : sélection des passages de documents et recherche de sources. */
  prepMs?: number;
  /** Attente de la fin du chargement du modèle (préchargement), après la préparation. */
  waitModelMs?: number;
  /** Durée de chargement du modèle annoncée par le moteur pour le préchargement (souvent recouverte par la préparation). */
  preloadLoadMs?: number;
  /** Délai avant l'apparition du premier mot, depuis le début de la génération. */
  firstWordMs?: number;
  /** Durées mesurées par le moteur (moteur de l'ordinateur seulement). */
  engine?: EngineTimings;
  /** Carte graphique ou processeur (moteur de l'ordinateur seulement). */
  placement?: EnginePlacement;
  /** Taille de contexte demandée au moteur (num_ctx). */
  contextTokens: number;
  /** Jetons du prompt final (estimation). */
  promptTokens?: number;
  /** Plafond de jetons demandé pour la réponse. */
  outputBudgetTokens?: number;
}

export type GenerationEvent =
  | { type: 'status'; stage: GenerationStage; message: string }
  | { type: 'sources'; sources: SourceRef[]; internetUsed: boolean }
  | { type: 'warning'; code: ErrorCode; message: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      content: string;
      sources: SourceRef[];
      truncated: boolean;
      internetUsed: boolean;
      saved: boolean;
      id?: string;
      model: string;
      /** Mesures de vitesse (facultatif : une application plus ancienne ne l'envoie pas, un client plus ancien l'ignore). */
      metrics?: GenerationMetrics;
      /**
       * Génération à enregistrer par le site (connecteur local uniquement : PipelineDeps.includeRecord). Retiré par le
       * client du site avant l'affichage ; jamais présent quand `saved` est vrai.
       */
      record?: GenerationRecordDraft;
    }
  | {
      type: 'error';
      code: ErrorCode;
      message: string;
      retryable: boolean;
      /** Texte déjà produit avant l'interruption, APRÈS vérification des citations (jamais le texte brut). */
      partial?: string;
    };

/** Informations de confidentialité affichées honnêtement à l'utilisateur. */
export interface PrivacyInfo {
  level: 'local' | 'remote' | 'server' | 'demo';
  message: string;
}

/** Code et message précis (en français, sans secret ni trace technique) sur l'état de l'IA. */
export interface AINotice {
  code: ErrorCode;
  message: string;
}

/**
 * Prestataire d'IA qui reçoit les textes, affiché honnêtement à l'enseignant (transparence).
 * Construit côté serveur par providerInfoFor() (shared/ai/presets.ts).
 * Ne contient JAMAIS l'URL de base (AI_BASE_URL) ni aucune clé : seulement un nom lisible et des faits publics.
 */
export interface ProviderInfo {
  /** Nom du prestataire ou du service (« OVHcloud AI Endpoints », « IA locale du serveur Magistra »…). */
  label: string;
  /** Vrai si les textes partent chez un tiers (service en ligne) ; faux pour une IA locale ou du réseau local. */
  thirdParty: boolean;
  /** Pays ou lieu d'hébergement, s'il est connu (« France (Gravelines) »). */
  country?: string;
  /** Conservation des données par le prestataire, telle qu'il l'annonce. */
  retention?: string;
  /** Utilisation des textes pour entraîner des modèles, telle que le prestataire l'annonce. */
  training?: string;
  /** Page publique du prestataire (conditions, confidentialité) : jamais l'adresse de l'API. */
  privacyUrl?: string;
}

export interface Capabilities {
  /** Taille maximale (caractères) des extraits de documents envoyés au modèle. */
  maxDocumentChars: number;
  /** Sources réellement interrogeables (Wikipédia peut être désactivé dans les réglages ou sur le serveur). */
  research: { academic: boolean; web: boolean; institutional: boolean; wikipedia: boolean };
  privacy: PrivacyInfo;
  engineLabel: string;
  ready: boolean;
  /**
   * Cause précise quand `ready` est faux (AI_NOT_CONFIGURED, MODEL_NOT_INSTALLED, AI_AUTH_FAILED,
   * AI_SERVER_UNREACHABLE, AI_QUOTA_EXCEEDED…) : à afficher tel quel à la place d'un texte générique.
   * Absent quand `ready` est vrai.
   */
  notReady?: AINotice;
  /**
   * Avertissement NON bloquant quand `ready` est vrai : AI_STATUS_UNKNOWN (état non vérifié, la génération
   * reste possible), MODEL_NOT_INSTALLED (modèle absent de la liste du serveur, mais peut-être un alias), AI_BUSY.
   */
  aiWarning?: AINotice;
  /** Prestataire qui reçoit les textes (web) : à annoncer clairement quand `thirdParty` est vrai. */
  providerInfo?: ProviderInfo;
  /**
   * Site web uniquement : moteur qui traitera la prochaine génération — « local-connector » = Magistra locale (IA de
   * l'ordinateur de l'enseignant, via l'application Windows) ; « server » = serveur Magistra en ligne. Jamais de
   * bascule silencieuse de l'un à l'autre : seul un choix explicite de l'enseignant change cette valeur.
   */
  route?: 'local-connector' | 'server';
}
