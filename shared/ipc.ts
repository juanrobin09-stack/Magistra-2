// Contrat du pont sécurisé entre la fenêtre (renderer) et le processus principal Electron.
// Exposé par electron/preload.ts sous window.magistra. Aucun secret ne transite par ce pont :
// les clés éventuelles restent dans le processus principal (chiffrées sur le disque).

import type { HardwareInfo, Recommendation, TierId } from './ai/models.js';
import type { ConnectorAppStatus } from './localConnector.js';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, HistoryPage, ResearchMode, TeacherProfile, UsageStats,
} from './types.js';

export const IPC = {
  aiStatus: 'ai:status',
  aiRefresh: 'ai:refresh',
  /**
   * Installation OU mise à jour du moteur (Ollama). Argument facultatif : EngineInstallOptions.
   * `{ update: true }` = « Mettre à jour le moteur IA » (moteur trop ancien : AIStatus.engine.outdated).
   */
  aiInstallEngine: 'ai:install-engine',
  aiCancelEngineInstall: 'ai:cancel-engine-install',
  aiOpenEngineDownload: 'ai:open-engine-download',
  aiStartEngine: 'ai:start-engine',
  aiPullModel: 'ai:pull-model',
  aiCancelPull: 'ai:cancel-pull',
  aiSetConfig: 'ai:set-config',
  aiProgress: 'ai:progress',
  genStart: 'gen:start',
  genCancel: 'gen:cancel',
  genEvent: 'gen:event',
  genCapabilities: 'gen:capabilities',
  dataList: 'data:list',
  dataGet: 'data:get',
  dataSetFavorite: 'data:set-favorite',
  dataDelete: 'data:delete',
  dataStats: 'data:stats',
  dataClearAll: 'data:clear-all',
  profileGet: 'profile:get',
  profileSet: 'profile:set',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  docsList: 'docs:list',
  docsLoad: 'docs:load',
  docsSave: 'docs:save',
  docsDelete: 'docs:delete',
  openExternal: 'shell:open-external',
  appInfo: 'app:info',
  appReady: 'app:ready',
  appCheckUpdate: 'app:check-update',
  appInstallUpdate: 'app:install-update',
  appUpdateProgress: 'app:update-progress',
  /** Connecteur local (site web Magistra → IA de cet ordinateur) : état et navigateurs autorisés. */
  connectorStatus: 'connector:status',
  /** Retire l'autorisation d'un navigateur (argument : clientId). */
  connectorRevoke: 'connector:revoke',
  /** Active ou désactive le connecteur (argument : booléen). */
  connectorSetEnabled: 'connector:set-enabled',
  /** Évènement : l'état du connecteur a changé (nouvel appairage, retrait…) ; charge utile : ConnectorAppStatus. */
  connectorChanged: 'connector:changed',
} as const;

// ─── État de l'IA locale ────────────────────────────────────────────────────

export type EngineState = 'not_installed' | 'installed_stopped' | 'running' | 'unknown';

export interface TierStatus {
  id: TierId;
  label: string;
  description: string;
  model: string;
  modelDisplayName: string;
  license: string;
  downloadGB: number;
  installed: boolean;
  fit: 'recommended' | 'ok' | 'slow' | 'not_recommended';
  note: string;
}

export interface AIConfigPublic {
  /** « local » = Ollama sur cet ordinateur ; « remote » = serveur configuré par l'utilisateur. */
  mode: 'local' | 'remote';
  tier: TierId;
  /** Modèle personnalisé (mode avancé), prioritaire sur le niveau choisi. */
  customModel?: string;
  ollamaUrl: string;
  remote?: {
    kind: 'openai-compatible' | 'ollama';
    baseUrl: string;
    model: string;
    /** Indique seulement qu'une clé est enregistrée ; la clé elle-même n'est jamais renvoyée. */
    hasApiKey: boolean;
    label?: string;
  };
}

export interface AIStatus {
  engine: {
    state: EngineState;
    version?: string;
    url: string;
    /** Chemin de l'exécutable détecté (affiché en mode avancé uniquement). */
    executable?: string;
    /**
     * Vrai si le moteur répond mais que sa version est inférieure à `minVersion` (ollamaVersionStatus()
     * de shared/ai/models.ts vaut 'outdated') : les modèles Magistra ne pourront pas s'installer (erreur 412
     * du registre → ENGINE_OUTDATED). L'interface propose alors « Mettre à jour le moteur IA »
     * (installEngine({ update: true })), ou « demandez au service informatique » si `managedByAdmin`.
     * Absent ou faux si la version est suffisante ou inconnue (version de développement, « inconnue »).
     */
    outdated?: boolean;
    /** Version minimale exigée par les modèles Magistra (MIN_OLLAMA_VERSION, ex. « 0.13.1 »). */
    minVersion?: string;
    /**
     * Vrai si Ollama est installé pour toute la machine (dossier Program Files, droits administrateur) :
     * l'enseignant ne peut ni le mettre à jour ni le réinstaller lui-même (message « demandez au service informatique »).
     */
    managedByAdmin?: boolean;
    /**
     * Vrai après l'échec réseau d'un téléchargement de modèle alors que Windows utilise un proxy (réseau
     * d'établissement) et qu'Ollama a été démarré sans lui (Ollama ignore le proxy du système : seule la variable
     * HTTPS_PROXY compte). L'interface peut proposer « Relancer le moteur IA » : startEngine({ restart: true }),
     * après accord de l'enseignant. Reprendre le téléchargement relance aussi le moteur (message d'erreur explicite).
     */
    proxyRestart?: boolean;
    /**
     * Installation (« install ») ou mise à jour (« update ») du moteur en cours dans le processus principal
     * (installEngine) : téléchargement, puis installateur officiel, qui arrête l'ancien moteur et n'émet rien. Une
     * fenêtre rechargée entre-temps l'attend au lieu de voir un moteur « arrêté » à démarrer (startEngine est alors
     * refusé : AI_BUSY). Absent sinon.
     */
    installing?: 'install' | 'update';
  };
  installedModels: { name: string; sizeGB: number }[];
  tiers: TierStatus[];
  selectedTier: TierId;
  /** Modèle réellement utilisé (niveau ou modèle personnalisé). */
  activeModel: string;
  activeLabel: string;
  ready: boolean;
  /** Message principal pour l'enseignant (« Prête », « Modèle non installé »…). */
  headline: string;
  hardware: HardwareInfo;
  recommendation: Recommendation;
  config: AIConfigPublic;
  /** Informations sur l'installateur Ollama (taille réelle si connue). */
  engineDownload: { sizeMB?: number; approxSizeMB: number; requiredDiskGB: number; platformSupported: boolean };
}

/**
 * Options de ai.installEngine() (canal IPC.aiInstallEngine).
 *  - update : mettre à jour un moteur déjà installé mais trop ancien. L'installateur officiel (même vérification
 *    SHA-256 que pour une première installation) arrête lui-même « ollama app.exe » et ollama.exe avant la copie.
 *    Refusé (ENGINE_OUTDATED, message « demandez au service informatique ») si le moteur est géré par
 *    l'administrateur (AIStatus.engine.managedByAdmin). Progression : mêmes évènements engine-* qu'une installation.
 */
export interface EngineInstallOptions {
  update?: boolean;
}

/**
 * Options de ai.startEngine() (canal IPC.aiStartEngine, argument facultatif).
 *  - restart : arrêter puis relancer le moteur de CET ordinateur (« ollama app.exe » et ollama.exe), avec le proxy
 *    du système transmis en HTTPS_PROXY (voir AIStatus.engine.proxyRestart). Toujours après un clic de l'enseignant.
 * Sans option : démarre le moteur s'il est arrêté. En cas d'échec, l'erreur donne la cause probable (journal du moteur,
 * antivirus, port occupé…) plutôt que de renvoyer simplement faux.
 */
export interface EngineStartOptions {
  restart?: boolean;
}

/**
 * Message affiché pendant le démarrage du moteur local (jusqu'à 2 minutes au premier lancement) : émis par
 * l'application Windows (génération, installation) et affiché par l'interface sous le bouton « Démarrage… ».
 */
export const ENGINE_STARTING_MESSAGE = 'Le moteur IA démarre, cela peut prendre une minute au premier lancement…';

export type AIProgressEvent =
  | { kind: 'engine-download'; receivedMB: number; totalMB?: number }
  | { kind: 'engine-install'; message: string }
  | { kind: 'engine-waiting'; message: string }
  | { kind: 'engine-ready'; version: string }
  | { kind: 'engine-error'; message: string }
  | { kind: 'model-pull'; tier?: TierId; model: string; status: string; completedMB?: number; totalMB?: number; percent?: number }
  | { kind: 'model-ready'; model: string }
  | { kind: 'model-error'; model: string; message: string };

export interface AIConfigUpdate {
  mode?: 'local' | 'remote';
  tier?: TierId;
  customModel?: string | null;
  ollamaUrl?: string;
  remote?: {
    kind: 'openai-compatible' | 'ollama';
    baseUrl: string;
    model: string;
    /** Nouvelle clé (facultative). Chaîne vide = supprimer la clé enregistrée. */
    apiKey?: string;
    label?: string;
  } | null;
}

// ─── Préférences locales ────────────────────────────────────────────────────

export interface LocalPreferences {
  defaultResearchMode: ResearchMode;
  /** URL SearXNG facultative (recherche web). */
  searxngUrl?: string;
  academicEnabled: boolean;
  wikipediaEnabled: boolean;
  /** Conserver le texte extrait des documents pour les réutiliser (jamais l'original). */
  keepDocuments: boolean;
  /**
   * Ancien assistant de premier démarrage (imposé tant que ce drapeau était faux). L'assistant n'est plus imposé :
   * le drapeau est conservé pour relire sans erreur les préférences déjà enregistrées.
   */
  setupCompleted: boolean;
  /**
   * L'enseignant a cliqué sur « Activer l'IA » (taille du téléchargement annoncée) et l'activation n'est pas terminée :
   * elle reprend toute seule au lancement suivant de Magistra (fermeture pendant le téléchargement, erreur réseau…).
   * Remis à faux quand l'IA est prête ou quand l'enseignant annule. JAMAIS vrai sans ce clic initial.
   */
  aiSetupRequested: boolean;
}

export interface StoredDocument {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md';
  description: string;
  savedAt: string;
  /** Texte extrait (unités localisées), jamais le fichier original. */
  units: { locator: { type: 'pages' | 'slides' | 'section' | 'paragraphs' | 'lines'; start: number; end: number; title?: string }; text: string }[];
  chars: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  userDataPath: string;
  isPackaged: boolean;
}

/** Résultat de la vérification des versions : aucun téléchargement d’installateur. */
export interface UpdateCheckResult {
  /** Version installée. */
  currentVersion: string;
  /** Dernière version publiée ; null si aucune version n'est publiée pour l'instant. */
  latestVersion: string | null;
  upToDate: boolean;
  /** Page de la nouvelle version (github.com, dépôt officiel), présente seulement si une mise à jour existe. */
  url?: string;
  /** Fichiers exacts de la même version stable, validés dans le processus principal. */
  installer?: { name: string; url: string; checksumsUrl: string; size: number };
}

export interface UpdateProgress {
  phase: 'idle' | 'downloading' | 'verifying' | 'installing';
  percent: number;
}

export type Unsubscribe = () => void;

/** API exposée à la fenêtre par le preload (window.magistra). */
export interface MagistraBridge {
  readonly isElectron: true;
  app: {
    info(): Promise<AppInfo>;
    /** Signale que l'interface est chargée (test de démarrage automatisé). */
    ready(): void;
    openExternal(url: string): Promise<boolean>;
    /** Vérifie la version sur GitHub ; ne transmet aucun document. */
    checkForUpdate(): Promise<UpdateCheckResult>;
    /** Facultatif pour la compatibilité avec les anciens ponts. Aucun argument contrôlé par la fenêtre. */
    installUpdate?(): Promise<boolean>;
    onUpdateProgress?(listener: (progress: UpdateProgress) => void): Unsubscribe;
  };
  ai: {
    status(): Promise<AIStatus>;
    refresh(): Promise<AIStatus>;
    /**
     * Installe le moteur (Ollama), ou le met à jour avec `{ update: true }` (voir EngineInstallOptions).
     * Toujours après un clic de l'enseignant ; progression via onProgress (engine-download → engine-install
     * → engine-waiting → engine-ready | engine-error).
     */
    installEngine(options?: EngineInstallOptions): Promise<void>;
    cancelEngineInstall(): Promise<void>;
    openEngineDownload(): Promise<void>;
    /** Démarre (ou, avec `{ restart: true }`, relance) le moteur local : voir EngineStartOptions. */
    startEngine(options?: EngineStartOptions): Promise<boolean>;
    pullModel(target: { tier?: TierId; model?: string }): Promise<void>;
    cancelPull(): Promise<void>;
    setConfig(update: AIConfigUpdate): Promise<AIStatus>;
    onProgress(listener: (event: AIProgressEvent) => void): Unsubscribe;
  };
  generation: {
    capabilities(): Promise<Capabilities>;
    start(request: GenerationRequest): Promise<{ jobId: string }>;
    cancel(jobId: string): Promise<void>;
    onEvent(listener: (payload: { jobId: string; event: GenerationEvent }) => void): Unsubscribe;
  };
  data: {
    list(query: { favoritesOnly?: boolean; cursor?: string; limit?: number }): Promise<HistoryPage>;
    get(id: string): Promise<GenerationRecord | null>;
    setFavorite(id: string, value: boolean): Promise<void>;
    delete(id: string): Promise<void>;
    stats(): Promise<UsageStats>;
    clearAll(): Promise<void>;
  };
  profile: {
    get(): Promise<TeacherProfile | null>;
    set(profile: TeacherProfile | null): Promise<void>;
  };
  prefs: {
    get(): Promise<LocalPreferences>;
    set(update: Partial<LocalPreferences>): Promise<LocalPreferences>;
  };
  documents: {
    list(): Promise<Omit<StoredDocument, 'units'>[]>;
    load(id: string): Promise<StoredDocument | null>;
    save(doc: StoredDocument): Promise<void>;
    delete(id: string): Promise<void>;
  };
  /** Connecteur local : le site web Magistra utilise l'IA de cet ordinateur (navigateurs autorisés). */
  connector: {
    status(): Promise<ConnectorAppStatus>;
    revoke(clientId: string): Promise<ConnectorAppStatus>;
    setEnabled(enabled: boolean): Promise<ConnectorAppStatus>;
    onChange(listener: (status: ConnectorAppStatus) => void): Unsubscribe;
  };
}

export const DEFAULT_PREFERENCES: LocalPreferences = {
  defaultResearchMode: 'documents',
  academicEnabled: true,
  wikipediaEnabled: true,
  keepDocuments: false,
  setupCompleted: false,
  aiSetupRequested: false,
};
