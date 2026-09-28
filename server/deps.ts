// Assemblage des dépendances du serveur à partir de la configuration.
// Chaque dépendance est injectable : les tests remplacent l'authentification, le stockage,
// le fournisseur d'IA et la recherche par des doublures.

import { createProvider } from '../shared/ai/factory.js';
import type { AIProvider } from '../shared/ai/provider.js';
import { MagistraError } from '../shared/errors.js';
import type { ResearchConfig, ResearchDeps } from '../shared/research/types.js';
import { createClerkVerifier, type TokenVerifier } from './auth.js';
import { InstanceGenerations } from './concurrency.js';
import { loadConfig, type Env, type ServerConfig } from './config.js';
import { fetchPublicPage } from './safeFetch.js';
import { MemoryStore, SupabaseStore, type GenerationStore } from './store.js';

export type Logger = (message: string, err?: unknown) => void;

export interface ServerDeps {
  config: ServerConfig;
  /** null = authentification non configurée (SERVER_MISCONFIGURED). */
  verifier: TokenVerifier | null;
  /** null = stockage non configuré (SERVER_MISCONFIGURED). */
  store: GenerationStore | null;
  /** Fournisseur d'IA ; lève AI_NOT_CONFIGURED si aucun serveur n'est configuré. */
  getProvider: () => AIProvider;
  research: { config: ResearchConfig; deps: ResearchDeps };
  now: () => Date;
  log: Logger;
  /** Détaille les problèmes de configuration dans les réponses (développement uniquement). */
  exposeConfigProblems: boolean;
  /** Cache du test de disponibilité de l'IA (/api/status). */
  healthCache: { at: number; ttl: number; value: unknown } | null;
  /** Générations en cours sur cette instance (plafonds MAX_CONCURRENT_GENERATIONS*). */
  activeGenerations: InstanceGenerations;
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

export function createServerDeps(env: Env, overrides: DepsOverrides = {}): ServerDeps {
  const config = loadConfig(env);
  const log = overrides.log ?? defaultLogger;
  const dev = overrides.dev === true;

  const verifier = overrides.verifier !== undefined
    ? overrides.verifier
    : config.clerk ? createClerkVerifier(config.clerk) : null;

  let store: GenerationStore | null;
  if (overrides.store !== undefined) {
    store = overrides.store;
  } else if (config.store === 'memory') {
    store = new MemoryStore();
    log('Stockage en mémoire (MAGISTRA_STORE=memory) : l’historique sera perdu au redémarrage.');
  } else if (config.supabase) {
    store = new SupabaseStore(config.supabase);
  } else if (dev) {
    store = new MemoryStore();
    log('Développement : Supabase non configuré, historique conservé en mémoire le temps de la session.');
  } else {
    store = null;
  }

  let provider: AIProvider | undefined;
  const getProvider = (): AIProvider => {
    if (overrides.providerFactory) return overrides.providerFactory();
    if (!config.ai.provider) throw new MagistraError('AI_NOT_CONFIGURED');
    provider ??= createProvider(config.ai.provider);
    return provider;
  };

  for (const problem of config.problems) {
    if ((overrides.store !== undefined || store?.kind === 'memory') && /SUPABASE/.test(problem)) continue;
    if (overrides.verifier !== undefined && /CLERK/.test(problem)) continue;
    if (overrides.providerFactory && /AI_/.test(problem)) continue;
    log(`Configuration : ${problem}`);
  }

  return {
    config,
    verifier,
    store,
    getProvider,
    research: overrides.research ?? {
      config: config.research,
      deps: { fetch: (input, init) => fetch(input, init), fetchPage: fetchPublicPage },
    },
    now: overrides.now ?? (() => new Date()),
    log,
    exposeConfigProblems: dev,
    healthCache: null,
    activeGenerations: new InstanceGenerations(),
  };
}

let processDeps: ServerDeps | undefined;

/** Dépendances construites une seule fois à partir de process.env (Vercel, serveur autonome). */
export function getProcessDeps(): ServerDeps {
  processDeps ??= createServerDeps(process.env);
  return processDeps;
}
