// Assemblage des dépendances du serveur à partir de la configuration.
// Chaque dépendance est injectable : les tests remplacent l'authentification, le stockage,
// le fournisseur d'IA et la recherche par des doublures.

import { createProvider } from '../shared/ai/factory.js';
import { sameModel } from '../shared/ai/ollama.js';
import { fetchOllamaRemoteHost, isOllamaCloudName, ollamaDestination } from '../shared/ai/ollamaRemote.js';
import { addressKind, providerInfoFor } from '../shared/ai/presets.js';
import type { AIProvider, FetchLike } from '../shared/ai/provider.js';
import type { AuthMode, ModeInfo } from '../shared/apiContract.js';
import { MagistraError, type ErrorCode } from '../shared/errors.js';
import type { ResearchConfig, ResearchDeps } from '../shared/research/types.js';
import type { ProviderInfo } from '../shared/types.js';
import { createClerkVerifier, type TokenVerifier } from './auth.js';
import { InstanceGenerations } from './concurrency.js';
import { DEFAULTS, loadConfig, type Env, type ServerConfig } from './config.js';
import { FileStore } from './fileStore.js';
import { LocalAIDetector, LOCAL_AI_HINT, type LocalAIDetectorOptions, type LocalAIResult } from './localAI.js';
import { loadOrCreateAccessToken, PersonalAccess, protectDataDir, resolveAuth, type ListenContext } from './personal.js';
import { fetchPublicPage } from './safeFetch.js';
import { MemoryStore, SupabaseStore, type GenerationStore } from './store.js';
import { createWindowsReleaseCache, type WindowsReleaseCache } from './windowsRelease.js';

export type Logger = (message: string, err?: unknown) => void;

/** IA utilisée pour une requête : fournisseur, libellé et fiche de transparence. */
export interface ActiveAI {
  provider: AIProvider;
  /** Libellé affiché (AI_SERVER_LABEL, prestataire, ou « IA locale (Ollama – Magistra Léger) »). */
  label: string;
  model: string;
  /** Taille de contexte réellement utilisée (tokens). */
  contextTokens: number;
  /** Durée maximale d'une génération (AI_TIMEOUT_SECONDS ; 30 min par défaut pour une IA locale détectée). */
  timeoutMs: number;
  /** Prestataire qui reçoit les textes (sans URL ni clé). */
  providerInfo?: ProviderInfo;
  /** Origine : variables AI_* (ou préréglage), détection automatique d'une IA locale, doublure de test. */
  origin: 'configuration' | 'detection' | 'override';
}

export interface ServerDeps {
  config: ServerConfig;
  /** Mode d'authentification effectif (GET /api/mode). */
  auth: AuthMode;
  /** null = authentification non configurée (SERVER_MISCONFIGURED). */
  verifier: TokenVerifier | null;
  /** Mode personnel : jeton, contrôles Host / Origin, adresse d'accès ; null sinon. */
  personal: PersonalAccess | null;
  /** Démarrage refusé (mode personnel impossible, jeton impossible à créer…) : le serveur autonome s'arrête. */
  startupError?: string;
  /** Réponse de GET /api/mode (publique, sans secret). */
  modeInfo: ModeInfo;
  /** null = stockage non configuré (SERVER_MISCONFIGURED). */
  store: GenerationStore | null;
  /** Fournisseur d'IA ; lève AI_NOT_CONFIGURED (ou la cause précise) si aucun serveur n'est utilisable. */
  getProvider: () => Promise<AIProvider>;
  /** IA utilisée (configuration, préréglage ou détection automatique) ; lève une MagistraError sinon. */
  resolveAI: () => Promise<ActiveAI>;
  /** Détection automatique d'une IA locale (null si la configuration désigne déjà un serveur, ou sur Vercel). */
  localAI: LocalAIDetector | null;
  /** À appeler après une génération échouée : oublie la détection et l'état mis en cache si l'IA a disparu. */
  onGenerationError: (code: ErrorCode) => void;
  research: { config: ResearchConfig; deps: ResearchDeps };
  now: () => Date;
  log: Logger;
  /** Détaille les problèmes de configuration dans les réponses (développement uniquement). */
  exposeConfigProblems: boolean;
  /** Cache du test de disponibilité de l'IA (/api/status). */
  healthCache: { at: number; ttl: number; value: unknown } | null;
  /** Générations en cours sur cette instance (plafonds MAX_CONCURRENT_GENERATIONS*). */
  activeGenerations: InstanceGenerations;
  /** Accès à l'API GitHub pour GET /api/windows-release (tests : réponses simulées). */
  releasesFetch: FetchLike;
  /** Cache mémoire de la dernière version Windows (10 min), propre à cette instance. */
  releasesCache: WindowsReleaseCache;
}

export interface DepsOverrides {
  verifier?: TokenVerifier | null;
  store?: GenerationStore | null;
  providerFactory?: () => AIProvider;
  research?: { config: ResearchConfig; deps: ResearchDeps };
  now?: () => Date;
  log?: Logger;
  /** Mode développement : stockage en mémoire si Supabase n'est pas configuré, messages détaillés. */
  dev?: boolean;
  /**
   * Adresse et port d'écoute (serveur autonome, serveur de développement) : le mode personnel n'est possible que sur
   * la boucle locale. Absent (fonctions Vercel, autre hébergeur) : mode personnel impossible. En développement,
   * l'hôte par défaut de Vite (localhost) est supposé.
   */
  listen?: { host?: string | null; port?: number };
  /** Racine du projet (dossier de données par défaut <racine>/.magistra-data). */
  projectRoot?: string;
  /** Détection de l'IA locale (tests : adresses et fetch simulés). */
  localAI?: LocalAIDetectorOptions;
  /** Requêtes vers GitHub de GET /api/windows-release (tests : réponses simulées, aucun accès réseau). */
  releasesFetch?: FetchLike;
}

/** Journal serveur : jamais de jeton, de clé ni de contenu d'enseignant ; seulement un résumé de la cause. */
export const defaultLogger: Logger = (message, err) => {
  if (err === undefined) {
    console.error(`[magistra] ${message}`);
    return;
  }
  const cause = (err as { cause?: unknown })?.cause ?? err;
  const detail = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message?: unknown }).message)
      : String(cause);
  console.error(`[magistra] ${message} — ${detail.slice(0, 500)}`);
};

/** Pannes après lesquelles l'IA détectée est recherchée de nouveau (arrêtée, désinstallée, modèle supprimé…). */
const REDETECT_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'AI_SERVER_UNREACHABLE', 'AI_SERVER_UNAVAILABLE', 'ENGINE_NOT_RUNNING', 'MODEL_NOT_INSTALLED', 'AI_BAD_RESPONSE',
]);

/** Message montré quand la détection automatique n'a rien trouvé (sans adresse interne). */
function notDetectedError(result: LocalAIResult): MagistraError {
  let message: string;
  if (result.found) {
    message = "Aucune IA n'est branchée.";
  } else if (result.engine === 'ollama' && result.onlyRemoteModels) {
    message = "Aucune IA n'est encore branchée : Ollama est installé sur la machine du serveur Magistra, mais seulement avec des modèles "
      + "en ligne (Ollama Cloud), que Magistra n'utilise pas automatiquement car les textes partiraient sur Internet. Installez un modèle "
      + 'local avec « ollama pull ministral-3:8b », puis rechargez cette page.';
  } else if (result.engine === 'ollama') {
    message = "Aucune IA n'est encore branchée : Ollama est installé sur la machine du serveur Magistra, mais aucun modèle. "
      + 'Installez-en un avec « ollama pull ministral-3:8b », puis rechargez cette page.';
  } else if (result.engine === 'lmstudio') {
    message = "Aucune IA n'est encore branchée : LM Studio est démarré sur la machine du serveur Magistra, mais aucun modèle de conversation n'y est disponible.";
  } else {
    message = "Aucune IA n'est encore branchée : aucune IA locale (Ollama, LM Studio) n'a été trouvée sur la machine du serveur Magistra. "
      + `Pour en brancher une : ${LOCAL_AI_HINT}, ou choisissez un service d'IA dans le fichier .env (AI_PRESET, ou AI_BASE_URL et AI_MODEL).`;
  }
  return new MagistraError('AI_NOT_CONFIGURED', message);
}

function listenContext(overrides: DepsOverrides): ListenContext {
  const dev = overrides.dev === true;
  if (overrides.listen !== undefined) return { dev, host: overrides.listen.host ?? null };
  return dev ? { dev, host: 'localhost' } : {};
}

export function createServerDeps(env: Env, overrides: DepsOverrides = {}): ServerDeps {
  const config = loadConfig(env, { projectRoot: overrides.projectRoot });
  const log = overrides.log ?? defaultLogger;
  const dev = overrides.dev === true;

  // Windows : dossier de données (jeton d'accès, historique) réservé à l'utilisateur par son ACL, une seule fois et
  // avant toute écriture ; sans effet ailleurs (droits POSIX 0600 / 0700 posés à la création des fichiers).
  let dataDirProtected = false;
  const protectData = () => {
    if (dataDirProtected) return;
    dataDirProtected = true;
    const warning = protectDataDir(config.dataDir);
    if (warning) log(warning);
  };

  // ─── Authentification ───
  let auth: AuthMode;
  let startupError: string | undefined;
  let personal: PersonalAccess | null = null;
  if (overrides.verifier !== undefined) {
    auth = overrides.verifier ? 'clerk' : 'none';
  } else {
    const resolved = resolveAuth(env, listenContext(overrides), config.problems);
    auth = resolved.mode;
    startupError = resolved.refusal;
    if (resolved.note) log(resolved.note);
    if (auth === 'personal') {
      protectData();
      try {
        personal = new PersonalAccess(loadOrCreateAccessToken(config.dataDir).token, { port: overrides.listen?.port });
      } catch {
        auth = 'none';
        startupError = `Mode personnel impossible : le jeton d'accès n'a pas pu être créé dans le dossier de données (${config.dataDir}). `
          + "Vérifiez MAGISTRA_DATA_DIR et les droits d'écriture.";
      }
    }
  }
  const verifier = overrides.verifier !== undefined
    ? overrides.verifier
    : auth === 'personal' && personal
      ? personal.verifier
      : auth === 'clerk' && config.clerk ? createClerkVerifier(config.clerk) : null;

  // ─── Stockage (fichiers par défaut en mode personnel : l'historique survit au redémarrage) ───
  let store: GenerationStore | null;
  const storeKind = config.storeExplicit ? config.store : auth === 'personal' ? 'file' : config.store;
  if (overrides.store !== undefined) {
    store = overrides.store;
  } else if (storeKind === 'memory') {
    store = new MemoryStore();
    log('Stockage en mémoire (MAGISTRA_STORE=memory) : l’historique sera perdu au redémarrage.');
  } else if (storeKind === 'file') {
    protectData();
    store = new FileStore(config.dataDir, { warn: message => log(message) });
    log(`Historique enregistré dans des fichiers : ${config.dataDir}`);
  } else if (config.supabase) {
    store = new SupabaseStore(config.supabase);
  } else if (dev) {
    store = new MemoryStore();
    log('Développement : Supabase non configuré, historique conservé en mémoire le temps de la session.');
  } else {
    store = null;
  }

  // ─── IA : configuration (AI_* ou préréglage), sinon détection d'une IA locale ───
  const localAI = config.ai.autodetect && !overrides.providerFactory
    ? new LocalAIDetector({
        ...overrides.localAI,
        contextTokens: config.ai.explicit.contextTokens,
        label: config.ai.explicit.label,
        timeZone: config.defaultTimeZone,
      })
    : null;
  let configured: AIProvider | undefined;
  let detected: { key: string; provider: AIProvider } | undefined;
  // Ollama configuré sur une adresse locale ou privée, modèle sans suffixe « cloud » : Ollama peut quand même le
  // relayer vers un autre hôte (remote_host de /api/tags, réponse locale). Vérifié au plus toutes les 30 s ; si la
  // liste est illisible, la fiche de la configuration reste utilisée (le fournisseur échouera de toute façon).
  let remoteCheck: { at: number; info: ProviderInfo | undefined } | undefined;
  const configuredProviderInfo = async (): Promise<ProviderInfo | undefined> => {
    const p = config.ai.provider;
    const fallback = config.ai.providerInfo;
    if (!p || p.kind !== 'ollama' || !p.baseUrl || isOllamaCloudName(p.model)) return fallback;
    const where = addressKind(p.baseUrl);
    if (where !== 'loopback' && where !== 'private') return fallback;
    if (remoteCheck && Date.now() - remoteCheck.at < 30_000) return remoteCheck.info ?? fallback;
    const host = await fetchOllamaRemoteHost((input, init) => fetch(input, init), p.baseUrl, p.model, { apiKey: p.apiKey, sameModel });
    if (host === null) return remoteCheck?.info ?? fallback;
    const info = host ? ollamaDestination(p.model, host, config.ai.explicit.label) : undefined;
    if (info?.thirdParty && !remoteCheck?.info) {
      log(`Le modèle « ${p.model.slice(0, 80)} » n'est pas exécuté par ce serveur Ollama : il relaie les textes vers « ${info.label} » `
        + "(l'interface l'annonce). Pour une IA locale, choisissez un modèle installé sur ce serveur.");
    }
    remoteCheck = { at: Date.now(), info };
    return info ?? fallback;
  };
  const resolveAI = async (): Promise<ActiveAI> => {
    if (overrides.providerFactory) {
      const provider = overrides.providerFactory();
      return {
        provider,
        label: provider.label || config.ai.label,
        model: provider.model,
        contextTokens: provider.contextTokens,
        timeoutMs: config.ai.timeoutMs,
        ...(config.ai.providerInfo ? { providerInfo: config.ai.providerInfo } : {}),
        origin: 'override',
      };
    }
    if (config.ai.provider) {
      configured ??= createProvider(config.ai.provider);
      const providerInfo = await configuredProviderInfo();
      return {
        provider: configured,
        label: config.ai.label,
        model: configured.model,
        contextTokens: configured.contextTokens,
        timeoutMs: config.ai.timeoutMs,
        ...(providerInfo ? { providerInfo } : {}),
        origin: 'configuration',
      };
    }
    if (localAI) {
      const found = await localAI.detect();
      if (!found.found) throw notDetectedError(found);
      const key = JSON.stringify(found.provider);
      if (!detected || detected.key !== key) detected = { key, provider: createProvider(found.provider) };
      return {
        provider: detected.provider,
        label: found.label,
        model: found.model,
        contextTokens: found.contextTokens,
        // IA de cette machine : la rédaction peut être lente sans carte graphique.
        timeoutMs: config.ai.explicit.timeoutMs ?? DEFAULTS.localAiTimeoutSeconds * 1_000,
        providerInfo: providerInfoFor(found.provider.baseUrl ?? '', config.ai.explicit.label),
        origin: 'detection',
      };
    }
    throw new MagistraError(config.ai.unavailable?.code ?? 'AI_NOT_CONFIGURED', config.ai.unavailable?.message);
  };

  const modeInfo: ModeInfo = {
    auth,
    ...(auth === 'clerk' && config.clerkPublishableKey ? { clerkPublishableKey: config.clerkPublishableKey } : {}),
    ...(config.adminContact ? { adminContact: config.adminContact } : {}),
    // Fiche statique du prestataire (sans URL ni clé) : l'interface nomme le destinataire des textes dès le premier
    // rendu, même si /api/status tarde ou échoue. Jamais en démonstration (aucune IA n'y est utilisée).
    ...(auth !== 'none' && config.ai.providerInfo ? { providerInfo: config.ai.providerInfo } : {}),
  };
  if (auth === 'clerk' && overrides.verifier === undefined && !config.clerkPublishableKey) {
    config.problems.push('Clé publiable Clerk absente côté serveur (VITE_CLERK_PUBLISHABLE_KEY ou CLERK_PUBLISHABLE_KEY) : '
      + "GET /api/mode ne peut pas la transmettre ; l'interface dépend alors de la clé intégrée au moment de « npm run build ».");
  }

  for (const problem of config.problems) {
    if ((overrides.store !== undefined || store?.kind === 'memory' || store?.kind === 'file') && /SUPABASE/.test(problem)) continue;
    if ((overrides.verifier !== undefined || auth === 'personal') && /CLERK/.test(problem)) continue;
    if (overrides.providerFactory && /AI_/.test(problem)) continue;
    log(`Configuration : ${problem}`);
  }

  const deps: ServerDeps = {
    config,
    auth,
    verifier,
    personal,
    ...(startupError ? { startupError } : {}),
    modeInfo,
    store,
    getProvider: async () => (await resolveAI()).provider,
    resolveAI,
    localAI,
    onGenerationError: code => {
      if (!REDETECT_CODES.has(code)) return;
      localAI?.invalidate();
      deps.healthCache = null;
    },
    research: overrides.research ?? {
      config: config.research,
      deps: { fetch: (input, init) => fetch(input, init), fetchPage: fetchPublicPage },
    },
    now: overrides.now ?? (() => new Date()),
    log,
    exposeConfigProblems: dev,
    healthCache: null,
    activeGenerations: new InstanceGenerations(),
    releasesFetch: overrides.releasesFetch ?? ((input, init) => fetch(input, init)),
    releasesCache: createWindowsReleaseCache(),
  };
  return deps;
}

/**
 * Lignes à afficher au démarrage (serveur autonome, npm run dev) : mode d'authentification, stockage, IA utilisée
 * (détection comprise) et, en mode personnel, l'adresse d'accès avec le jeton (terminal uniquement, jamais dans un
 * journal d'erreurs). `port` : port réellement écouté.
 */
export async function describeStartup(deps: ServerDeps, port?: number): Promise<string[]> {
  const lines: string[] = [];
  if (deps.startupError) return [`DÉMARRAGE REFUSÉ : ${deps.startupError}`];
  if (deps.auth === 'clerk') lines.push('Authentification : comptes Clerk.');
  else if (deps.auth === 'personal') lines.push('Mode personnel (sans compte) : un seul utilisateur, accès réservé à cet ordinateur.');
  else lines.push("Aucune authentification configurée : l'interface reste en démonstration (aucune IA n'est utilisée). Voir .env.example.");
  const ai = deps.config.ai;
  if (ai.provider) {
    lines.push(`IA : ${ai.label}, modèle « ${ai.provider.model} »${ai.preset ? ` (préréglage ${ai.preset})` : ''}.`);
    if (ai.providerInfo?.thirdParty) {
      lines.push(`Les demandes et extraits de documents des enseignants sont envoyés à ${ai.providerInfo.label} (${ai.providerInfo.country ?? 'pays non précisé'}) : l'interface l'annonce.`);
    }
  } else if (deps.localAI) {
    const found = await deps.localAI.detect();
    if (found.found) {
      lines.push(found.summary, ...found.warnings);
    } else {
      // Moteur présent sans modèle utilisable : sa cause précise ; sinon la marche à suivre.
      lines.push(found.engine ? found.summary : `Aucune IA locale détectée : ${LOCAL_AI_HINT}.`);
      lines.push("Ou choisissez un service d'IA dans le fichier .env : AI_PRESET (par exemple « ovhcloud », gratuit), ou AI_BASE_URL et AI_MODEL.");
    }
  } else if (ai.unavailable) {
    lines.push(`IA non branchée : ${ai.unavailable.message}`);
  }
  if (deps.personal) {
    lines.push("Ouvrez Magistra avec cette adresse (elle contient votre clé d'accès secrète : ne la partagez pas) :");
    lines.push(`  ${deps.personal.accessUrl(port ?? deps.personal.listeningPort)}`);
  }
  return lines;
}

let processDeps: ServerDeps | undefined;

/** Dépendances construites une seule fois à partir de process.env (Vercel, serveur autonome). */
export function getProcessDeps(): ServerDeps {
  processDeps ??= createServerDeps(process.env);
  return processDeps;
}
