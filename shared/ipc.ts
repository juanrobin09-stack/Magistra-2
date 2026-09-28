// Contrat du pont sécurisé entre la fenêtre (renderer) et le processus principal Electron.
// Exposé par electron/preload.ts sous window.magistra. Aucun secret ne transite par ce pont :
// les clés éventuelles restent dans le processus principal (chiffrées sur le disque).

import type { HardwareInfo, Recommendation, TierId } from './ai/models.js';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, HistoryPage, ResearchMode, TeacherProfile, UsageStats,
} from './types.js';

export const IPC = {
  aiStatus: 'ai:status',
  aiRefresh: 'ai:refresh',
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
  setupCompleted: boolean;
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

/** Résultat de « Rechercher une mise à jour » (à la demande uniquement : rien n'est téléchargé). */
export interface UpdateCheckResult {
  /** Version installée. */
  currentVersion: string;
  /** Dernière version publiée ; null si aucune version n'est publiée pour l'instant. */
  latestVersion: string | null;
  upToDate: boolean;
  /** Page de la nouvelle version (github.com, dépôt officiel), présente seulement si une mise à jour existe. */
  url?: string;
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
    /** Recherche une nouvelle version (une requête vers GitHub, au clic seulement). */
    checkForUpdate(): Promise<UpdateCheckResult>;
  };
  ai: {
    status(): Promise<AIStatus>;
    refresh(): Promise<AIStatus>;
    installEngine(): Promise<void>;
    cancelEngineInstall(): Promise<void>;
    openEngineDownload(): Promise<void>;
    startEngine(): Promise<boolean>;
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
}

export const DEFAULT_PREFERENCES: LocalPreferences = {
  defaultResearchMode: 'documents',
  academicEnabled: true,
  wikipediaEnabled: true,
  keepDocuments: false,
  setupCompleted: false,
};
