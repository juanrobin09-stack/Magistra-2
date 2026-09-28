// Configuration du serveur Magistra, lue depuis les variables d'environnement.
//
// Règles :
//  - aucune valeur secrète (clé Supabase service_role, clé Clerk, clé du serveur d'IA)
//    n'est jamais renvoyée au navigateur ni écrite dans les journaux ;
//  - une variable absente ou invalide ne fait jamais planter le serveur : elle est signalée
//    dans `problems` (journaux de l'administrateur) et la route concernée répond par une
//    erreur claire (AI_NOT_CONFIGURED, SERVER_MISCONFIGURED).

import type { ProviderConfig } from '../shared/ai/factory.js';
import { DEFAULT_OLLAMA_URL } from '../shared/ai/ollama.js';
import { DEFAULT_RETRY_DELAYS_MS } from '../shared/pipeline.js';
import type { ResearchConfig } from '../shared/research/types.js';
import { parseWebhookSecret } from './clerkWebhook.js';
import { REQUEST_LIMITS } from '../shared/validation.js';
import { normalizeTimeZone } from './time.js';

export type Env = Record<string, string | undefined>;

export interface ClerkConfig {
  secretKey?: string;
  jwtKey?: string;
  authorizedParties?: string[];
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export interface AIServerConfig {
  /** null = aucun serveur d'IA configuré (AI_NOT_CONFIGURED). */
  provider: ProviderConfig | null;
  /** Libellé affiché aux enseignants (« Serveur universitaire »…). */
  label: string;
  model?: string;
  contextTokens: number;
  maxOutputTokens: number;
  /** Durée maximale d'une génération complète (recherche + rédaction). */
  timeoutMs: number;
  /** Délai du test de disponibilité affiché par /api/status. */
  healthTimeoutMs: number;
  /** Attentes avant chaque nouvel essai automatique quand le serveur d'IA est surchargé ou indisponible (avant tout texte). */
  retryDelaysMs: readonly number[];
}

export interface ServerConfig {
  production: boolean;
  ai: AIServerConfig;
  research: ResearchConfig;
  /** Requêtes de génération par minute et par utilisateur (0 = protection désactivée). */
  rateLimitPerMinute: number;
  /** Requêtes de génération par minute pour tout le déploiement, tous utilisateurs confondus (0 = désactivé). */
  rateLimitGlobalPerMinute: number;
  /** Générations en cours par utilisateur, toutes instances confondues (0 = pas de limite). */
  maxConcurrentGenerationsPerUser: number;
  /** Générations en cours sur cette instance du serveur, tous utilisateurs confondus (0 = pas de limite). */
  maxConcurrentGenerations: number;
  clerk: ClerkConfig | null;
  /** Clé de vérification des webhooks Clerk (CLERK_WEBHOOK_SECRET) ; null = route /api/clerk-webhook désactivée. */
  clerkWebhookKey: Uint8Array | null;
  store: 'supabase' | 'memory';
  supabase: SupabaseConfig | null;
  defaultTimeZone: string;
  /** Taille maximale des extraits de documents que le navigateur peut envoyer (caractères). */
  maxDocumentChars: number;
  /** Problèmes de configuration, destinés aux journaux de l'administrateur uniquement. */
  problems: string[];
}

export const DEFAULTS = {
  aiLabel: "Serveur d'IA",
  contextTokens: 32_768,
  maxOutputTokens: 6_000,
  aiTimeoutSeconds: 280,
  healthTimeoutMs: 4_000,
  researchTimeoutMs: 8_000,
  rateLimitPerMinute: 10,
  rateLimitGlobalPerMinute: 120,
  maxConcurrentGenerationsPerUser: 2,
  maxConcurrentGenerations: 8,
  timeZone: 'Europe/Paris',
} as const;

/**
 * Marge ajoutée à la durée maximale d'une génération (AI_TIMEOUT_SECONDS) avant qu'une génération
 * jamais signalée comme terminée (instance arrêtée brutalement…) cesse de compter dans les limites
 * de concurrence : arrêt du modèle et sauvegarde dans l'historique (60 s au plus).
 */
export const GENERATION_SLOT_MARGIN_SECONDS = 90;

/** Durée (secondes) au-delà de laquelle une génération non libérée ne compte plus comme « en cours ». */
export function generationSlotTtlSeconds(config: Pick<ServerConfig, 'ai'>): number {
  return Math.ceil(config.ai.timeoutMs / 1_000) + GENERATION_SLOT_MARGIN_SECONDS;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function intVar(env: Env, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = clean(env[name]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} doit être un nombre entier entre ${min} et ${max} : valeur par défaut (${fallback}) utilisée.`);
    return fallback;
  }
  return n;
}

function boolVar(env: Env, name: string, fallback: boolean, problems: string[]): boolean {
  const raw = clean(env[name])?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'oui', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'non', 'off'].includes(raw)) return false;
  problems.push(`${name} doit valoir « true » ou « false » : valeur par défaut (${fallback}) utilisée.`);
  return fallback;
}

function httpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return raw.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Taille des extraits de documents acceptée, déduite de la fenêtre de contexte du modèle. */
export function maxDocumentCharsFor(contextTokens: number): number {
  const chars = Math.floor((contextTokens * 0.55 - 3_000) * 3.2);
  return Math.max(2_000, Math.min(REQUEST_LIMITS.documentsChars, chars));
}

function loadAI(env: Env, problems: string[]): AIServerConfig {
  const label = clean(env.AI_SERVER_LABEL)?.slice(0, 80) ?? DEFAULTS.aiLabel;
  const contextTokens = intVar(env, 'AI_CONTEXT_TOKENS', DEFAULTS.contextTokens, 2_048, 2_000_000, problems);
  const maxOutputTokens = intVar(env, 'AI_MAX_OUTPUT_TOKENS', DEFAULTS.maxOutputTokens, 256, 200_000, problems);
  const timeoutMs = intVar(env, 'AI_TIMEOUT_SECONDS', DEFAULTS.aiTimeoutSeconds, 10, 3_600, problems) * 1_000;
  const healthTimeoutMs = intVar(env, 'AI_HEALTH_TIMEOUT_MS', DEFAULTS.healthTimeoutMs, 500, 30_000, problems);
  const base = { label, contextTokens, maxOutputTokens, timeoutMs, healthTimeoutMs, retryDelaysMs: DEFAULT_RETRY_DELAYS_MS };

  const kindRaw = (clean(env.AI_PROVIDER) ?? 'openai-compatible').toLowerCase();
  const kind = kindRaw === 'ollama' ? 'ollama' : ['openai-compatible', 'openai', 'vllm'].includes(kindRaw) ? 'openai-compatible' : null;
  if (!kind) {
    problems.push(`AI_PROVIDER inconnu (« ${kindRaw.slice(0, 40)} ») : valeurs possibles « openai-compatible » ou « ollama ».`);
    return { ...base, provider: null };
  }
  const model = clean(env.AI_MODEL);
  const rawBase = clean(env.AI_BASE_URL);
  const baseUrl = httpUrl(rawBase);
  if (rawBase && !baseUrl) problems.push('AI_BASE_URL doit être une adresse http(s) valide, sans identifiants.');
  if (!model) {
    problems.push("AI_MODEL manquant : aucun serveur d'IA n'est configuré.");
    return { ...base, provider: null };
  }
  if (kind === 'ollama') {
    if (rawBase && !baseUrl) return { ...base, model, provider: null };
    return {
      ...base,
      model,
      provider: { kind: 'ollama', baseUrl: baseUrl ?? DEFAULT_OLLAMA_URL, model, label, contextTokens },
    };
  }
  if (!baseUrl) {
    if (!rawBase) problems.push("AI_BASE_URL manquant : aucun serveur d'IA n'est configuré.");
    return { ...base, model, provider: null };
  }
  return {
    ...base,
    model,
    provider: {
      kind: 'openai-compatible',
      baseUrl,
      model,
      apiKey: clean(env.AI_API_KEY),
      label,
      contextTokens,
      local: false,
    },
  };
}

function loadResearch(env: Env, problems: string[]): ResearchConfig {
  const rawSearx = clean(env.SEARXNG_URL);
  const searxngUrl = httpUrl(rawSearx);
  if (rawSearx && !searxngUrl) problems.push('SEARXNG_URL doit être une adresse http(s) valide : recherche web désactivée.');
  const mailto = clean(env.CROSSREF_MAILTO);
  const validMailto = mailto && /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,}$/i.test(mailto) ? mailto : undefined;
  if (mailto && !validMailto) problems.push('CROSSREF_MAILTO doit être une adresse électronique valide : ignorée.');
  return {
    academic: boolVar(env, 'RESEARCH_ACADEMIC', true, problems),
    wikipedia: boolVar(env, 'RESEARCH_WIKIPEDIA', true, problems),
    searxngUrl,
    crossrefMailto: validMailto,
    timeoutMs: intVar(env, 'RESEARCH_TIMEOUT_MS', DEFAULTS.researchTimeoutMs, 1_000, 60_000, problems),
  };
}

function loadClerk(env: Env, problems: string[]): ClerkConfig | null {
  const secretKey = clean(env.CLERK_SECRET_KEY);
  // Clé PEM : les hébergeurs stockent souvent les retours à la ligne sous la forme « \n ».
  const jwtKey = clean(env.CLERK_JWT_KEY)?.replace(/\\n/g, '\n');
  if (!secretKey && !jwtKey) {
    problems.push('CLERK_SECRET_KEY (ou CLERK_JWT_KEY) manquante : impossible de vérifier les sessions.');
    return null;
  }
  const parties = clean(env.CLERK_AUTHORIZED_PARTIES)
    ?.split(/[\s,]+/)
    .map(p => p.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return { secretKey, jwtKey, authorizedParties: parties && parties.length ? parties : undefined };
}

function loadClerkWebhook(env: Env, clerk: ClerkConfig | null, problems: string[]): Uint8Array | null {
  const raw = clean(env.CLERK_WEBHOOK_SECRET);
  if (!raw) {
    if (clerk) problems.push('CLERK_WEBHOOK_SECRET manquant : les données d’un compte supprimé depuis Clerk ne sont pas effacées automatiquement (voir README).');
    return null;
  }
  const key = parseWebhookSecret(raw);
  if (!key) problems.push('CLERK_WEBHOOK_SECRET invalide (format attendu : whsec_…) : webhook Clerk désactivé.');
  return key;
}

function loadSupabase(env: Env, problems: string[]): SupabaseConfig | null {
  const url = httpUrl(clean(env.SUPABASE_URL));
  const serviceRoleKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    problems.push('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires pour enregistrer l’historique.');
    return null;
  }
  return { url, serviceRoleKey };
}

export function loadConfig(env: Env): ServerConfig {
  const problems: string[] = [];
  const ai = loadAI(env, problems);
  const research = loadResearch(env, problems);
  const clerk = loadClerk(env, problems);
  const clerkWebhookKey = loadClerkWebhook(env, clerk, problems);
  const storeRaw = clean(env.MAGISTRA_STORE)?.toLowerCase();
  const store: ServerConfig['store'] = storeRaw === 'memory' ? 'memory' : 'supabase';
  if (storeRaw && storeRaw !== 'memory' && storeRaw !== 'supabase') problems.push('MAGISTRA_STORE doit valoir « supabase » ou « memory ».');
  const supabase = store === 'supabase' ? loadSupabase(env, problems) : null;
  const tzRaw = clean(env.DEFAULT_TIMEZONE);
  const defaultTimeZone = (tzRaw && normalizeTimeZone(tzRaw)) || DEFAULTS.timeZone;
  if (tzRaw && !normalizeTimeZone(tzRaw)) problems.push('DEFAULT_TIMEZONE inconnu : Europe/Paris utilisé.');

  return {
    production: env.NODE_ENV === 'production' || env.VERCEL === '1',
    ai,
    research,
    rateLimitPerMinute: intVar(env, 'RATE_LIMIT_PER_MINUTE', DEFAULTS.rateLimitPerMinute, 0, 10_000, problems),
    rateLimitGlobalPerMinute: intVar(env, 'RATE_LIMIT_GLOBAL_PER_MINUTE', DEFAULTS.rateLimitGlobalPerMinute, 0, 1_000_000, problems),
    maxConcurrentGenerationsPerUser: intVar(env, 'MAX_CONCURRENT_GENERATIONS_PER_USER', DEFAULTS.maxConcurrentGenerationsPerUser, 0, 100, problems),
    maxConcurrentGenerations: intVar(env, 'MAX_CONCURRENT_GENERATIONS', DEFAULTS.maxConcurrentGenerations, 0, 1_000, problems),
    clerk,
    clerkWebhookKey,
    store,
    supabase,
    defaultTimeZone,
    maxDocumentChars: maxDocumentCharsFor(ai.contextTokens),
    problems,
  };
}
