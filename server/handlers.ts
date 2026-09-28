// Logique des routes /api/*, indépendante de l'hébergeur (Vercel, serveur Node autonome, Vite).
// Contrat : shared/apiContract.ts.
//
// Ordre des vérifications pour chaque requête :
//   méthode autorisée → serveur configuré → jeton Clerk vérifié (identité = claim « sub »)
//   → paramètres validés → opération filtrée par l'utilisateur du jeton.

import type { ServerStatus } from '../shared/apiContract.js';
import { isMagistraError, MagistraError, toMagistraError, type ErrorCode } from '../shared/errors.js';
import { runGeneration } from '../shared/pipeline.js';
import type { GenerationEvent, TeacherProfile } from '../shared/types.js';
import { validateGenerationRequest } from '../shared/validation.js';
import { authenticate } from './auth.js';
import { verifyWebhook, WEBHOOK_BODY_LIMIT } from './clerkWebhook.js';
import { generationSlotTtlSeconds } from './config.js';
import type { ServerDeps } from './deps.js';
import { isValidUserId, requireUuid } from './ids.js';
import { sanitizeProfile } from './profile.js';
import { HISTORY_LIMITS, type GenerationAdmission, type GenerationStore } from './store.js';
import { normalizeTimeZone } from './time.js';

export type RouteName = 'status' | 'generate' | 'history' | 'generation' | 'stats' | 'profile' | 'account' | 'clerk-webhook';

export const ROUTE_METHODS: Record<RouteName, readonly string[]> = {
  status: ['GET'],
  generate: ['POST'],
  history: ['GET'],
  generation: ['GET', 'PATCH', 'DELETE'],
  stats: ['GET'],
  profile: ['GET', 'PUT'],
  account: ['DELETE'],
  'clerk-webhook': ['POST'],
};

export function isRouteName(value: string): value is RouteName {
  return Object.prototype.hasOwnProperty.call(ROUTE_METHODS, value);
}

/** « /api/history » ou « /api/history/ » → « history » ; toute autre forme → null. */
export function routeFromPath(pathname: string): RouteName | null {
  const match = /^\/api\/([a-z]+(?:-[a-z]+)*)\/?$/.exec(pathname);
  return match && isRouteName(match[1]) ? match[1] : null;
}

export interface ApiRequest {
  method: string;
  query: URLSearchParams;
  /** En-têtes HTTP (noms en minuscules). */
  headers: Record<string, string | string[] | undefined>;
  /** Lit et analyse le corps JSON (taille bornée). */
  readJson(): Promise<unknown>;
  /**
   * Lit le corps brut (au plus `limit` octets). `exact` est faux si l'hébergeur l'avait déjà analysé
   * (Vercel avec ses « helpers ») : le texte est alors reconstitué par JSON.stringify.
   */
  readRaw(limit: number): Promise<{ text: string; exact: boolean }>;
  /** Annulé quand le client ferme la connexion. */
  signal: AbortSignal;
}

export type ApiResult =
  | { type: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | {
      type: 'stream';
      events: AsyncIterable<GenerationEvent>;
      /**
       * Libère les ressources de la génération (idempotent). Le flux les libère lui-même en se
       * terminant ; l'adaptateur HTTP l'appelle en plus quoi qu'il arrive, même si le flux n'a jamais été lu.
       */
      close?: () => Promise<void>;
    };

/** Durée de la fenêtre anti-abus (secondes). */
export const RATE_WINDOW_SECONDS = 60;

/** Attente maximale de la libération d'une génération en fin de flux ; au-delà, l'expiration prend le relais. */
const RELEASE_TIMEOUT_MS = 5_000;

/** Statuts HTTP propres au serveur web (le code GENERATION_BUSY sert aussi à l'application Windows). */
const HTTP_STATUS_OVERRIDES: Partial<Record<ErrorCode, number>> = {
  GENERATION_BUSY: 429,
};

/** Délai conseillé avant une nouvelle tentative (en-tête Retry-After, secondes). */
const RETRY_AFTER_SECONDS: Partial<Record<ErrorCode, number>> = {
  RATE_LIMITED: 20,
  GENERATION_BUSY: 30,
  AI_BUSY: 15,
};

function json(body: unknown, status = 200, headers?: Record<string, string>): ApiResult {
  return { type: 'json', status, body, ...(headers ? { headers } : {}) };
}

export function errorResult(err: unknown, log?: (message: string, err?: unknown) => void): ApiResult {
  const e = toMagistraError(err);
  const status = HTTP_STATUS_OVERRIDES[e.code] ?? e.status;
  if (log && (status >= 500 || !isMagistraError(err))) log(`Erreur ${e.code}`, err);
  const retryAfter = RETRY_AFTER_SECONDS[e.code];
  return json({ error: e.toJSON() }, status, retryAfter ? { 'Retry-After': String(retryAfter) } : undefined);
}

export function methodNotAllowed(allowed: readonly string[]): ApiResult {
  return json(
    { error: { code: 'INVALID_REQUEST', message: 'Méthode non autorisée pour cette adresse.', retryable: false } },
    405,
    { Allow: allowed.join(', ') },
  );
}

export function notFoundRoute(): ApiResult {
  return json({ error: new MagistraError('NOT_FOUND', 'Service introuvable.').toJSON() }, 404);
}

function misconfigured(deps: ServerDeps, what: 'auth' | 'store'): MagistraError {
  if (!deps.exposeConfigProblems) return new MagistraError('SERVER_MISCONFIGURED');
  const detail = what === 'auth'
    ? 'renseignez CLERK_SECRET_KEY (ou CLERK_JWT_KEY) dans le fichier .env'
    : 'renseignez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans le fichier .env';
  return new MagistraError('SERVER_MISCONFIGURED', `Le serveur Magistra n'est pas configuré : ${detail} (voir .env.example).`);
}

function requireStore(deps: ServerDeps): GenerationStore {
  if (!deps.store) throw misconfigured(deps, 'store');
  return deps.store;
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MagistraError('INVALID_REQUEST', 'Corps de requête invalide.');
  return body as Record<string, unknown>;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

async function aiStatus(deps: ServerDeps): Promise<ServerStatus['ai']> {
  const label = deps.config.ai.label;
  const cache = deps.healthCache;
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value as ServerStatus['ai'];
  let value: ServerStatus['ai'];
  try {
    const provider = deps.getProvider();
    const health = await provider.health(AbortSignal.timeout(deps.config.ai.healthTimeoutMs));
    value = health.ok
      ? { ok: true, label: provider.label || label, model: provider.model }
      : {
          ok: false,
          label: provider.label || label,
          model: provider.model,
          code: health.error?.code ?? 'AI_SERVER_UNAVAILABLE',
          message: health.error?.message ?? new MagistraError('AI_SERVER_UNAVAILABLE').message,
        };
  } catch (err) {
    const e = toMagistraError(err, 'AI_SERVER_UNAVAILABLE');
    value = { ok: false, label, ...(deps.config.ai.model ? { model: deps.config.ai.model } : {}), code: e.code, message: e.message };
  }
  deps.healthCache = { at: Date.now(), ttl: value.ok ? 30_000 : 10_000, value };
  return value;
}

async function status(deps: ServerDeps): Promise<ApiResult> {
  const research = deps.research.config;
  const body: ServerStatus = {
    ai: await aiStatus(deps),
    research: {
      academic: research.academic,
      web: Boolean(research.searxngUrl),
      institutional: Boolean(research.searxngUrl),
      wikipedia: research.wikipedia,
    },
    maxDocumentChars: deps.config.maxDocumentChars,
  };
  return json(body);
}

const ADMISSION_ERRORS: Record<Exclude<GenerationAdmission['status'], 'ok'>, ErrorCode> = {
  busy: 'GENERATION_BUSY',
  rate_limited: 'RATE_LIMITED',
  saturated: 'AI_BUSY',
};

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`délai de ${ms} ms dépassé`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Anti-abus avant toute génération, dans cet ordre :
 *  1. places de l'instance (mémoire) : GENERATION_BUSY si l'utilisateur a déjà ses générations en
 *     cours ici, AI_BUSY si l'instance a atteint MAX_CONCURRENT_GENERATIONS ;
 *  2. compteur partagé (base), vérifié et mis à jour en une seule opération atomique : générations
 *     en cours toutes instances confondues (GENERATION_BUSY), débit de l'utilisateur (RATE_LIMITED),
 *     débit de tout le déploiement (AI_BUSY : saturation du service, l'enseignant n'y est pour rien).
 * Renvoie la fonction (idempotente, qui ne lève jamais) libérant les places réservées.
 */
async function admitGeneration(userId: string, store: GenerationStore, deps: ServerDeps): Promise<() => Promise<void>> {
  const { config } = deps;
  const ttlSeconds = generationSlotTtlSeconds(config);
  const local = deps.activeGenerations.acquire(userId, {
    max: config.maxConcurrentGenerations,
    maxPerUser: config.maxConcurrentGenerationsPerUser,
    ttlMs: ttlSeconds * 1_000,
  });
  if (!local.ok) throw new MagistraError(local.reason === 'busy' ? 'GENERATION_BUSY' : 'AI_BUSY');

  let slotId: string | null = null;
  const limits = {
    windowSeconds: RATE_WINDOW_SECONDS,
    maxRequests: config.rateLimitPerMinute,
    maxGlobalRequests: config.rateLimitGlobalPerMinute,
    maxActive: config.maxConcurrentGenerationsPerUser,
    activeTtlSeconds: ttlSeconds,
  };
  if (limits.maxRequests > 0 || limits.maxGlobalRequests > 0 || limits.maxActive > 0) {
    let admission: GenerationAdmission = { status: 'ok', slotId: null };
    try {
      admission = await store.beginGeneration(userId, limits);
    } catch (err) {
      // Protection technique uniquement : une panne du compteur ne bloque pas les enseignants
      // (les plafonds de l'instance restent appliqués).
      deps.log('Anti-abus indisponible (requête acceptée)', err);
    }
    if (admission.status !== 'ok') {
      local.release();
      throw new MagistraError(ADMISSION_ERRORS[admission.status]);
    }
    slotId = admission.slotId;
  }

  let released: Promise<void> | undefined;
  return () => {
    released ??= (async () => {
      local.release();
      if (!slotId) return;
      try {
        await withTimeout(store.endGeneration(userId, slotId), RELEASE_TIMEOUT_MS);
      } catch (err) {
        deps.log('Fin de génération non enregistrée (la place expirera automatiquement)', err);
      }
    })();
    return released;
  };
}

async function generate(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const store = requireStore(deps);
  // Toute propriété « userId » éventuellement présente dans le corps est ignorée par la validation.
  const request = validateGenerationRequest(await req.readJson());
  const provider = deps.getProvider();
  const release = await admitGeneration(userId, store, deps);

  const clientSignal = req.signal;
  const timeout = AbortSignal.timeout(deps.config.ai.timeoutMs);
  const signal = AbortSignal.any([clientSignal, timeout]);

  async function* events(): AsyncGenerator<GenerationEvent> {
    try {
      const pipeline = runGeneration(request, {
        provider,
        research: deps.research,
        // Enregistrement TOUJOURS sous l'utilisateur du jeton vérifié.
        save: record => store.saveGeneration(userId, record),
        signal,
        maxOutputTokens: deps.config.ai.maxOutputTokens,
        // Les nouveaux essais ont lieu dans ce flux : la place de génération reste tenue jusqu'à la fin.
        retryDelaysMs: deps.config.ai.retryDelaysMs,
      });
      for await (const event of pipeline) {
        if (event.type === 'error' && event.code === 'GENERATION_ABORTED' && timeout.aborted && !clientSignal.aborted) {
          const e = new MagistraError('AI_TIMEOUT', 'La génération a dépassé la durée maximale autorisée par le serveur. Réessayez avec une demande plus courte.');
          yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable };
          continue;
        }
        yield event;
      }
    } finally {
      // Succès, erreur, annulation ou déconnexion du client : la place est libérée AVANT la fin de
      // la réponse (une fonction Vercel peut être suspendue dès que la réponse est terminée).
      await release();
    }
  }
  return { type: 'stream', events: events(), close: release };
}

function parseLimit(raw: string | null): number {
  if (!raw) return HISTORY_LIMITS.default;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(HISTORY_LIMITS.max, Math.max(1, n)) : HISTORY_LIMITS.default;
}

async function history(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const favorites = req.query.get('favorites');
  const page = await requireStore(deps).listGenerations(userId, {
    favoritesOnly: favorites === '1' || favorites === 'true',
    cursor: req.query.get('cursor') || undefined,
    limit: parseLimit(req.query.get('limit')),
  });
  return json(page);
}

async function generation(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const store = requireStore(deps);
  const id = requireUuid(req.query.get('id'));
  if (req.method === 'GET') return json(await store.getGeneration(userId, id));
  if (req.method === 'DELETE') {
    await store.deleteGeneration(userId, id);
    return json({ ok: true });
  }
  const body = requireObject(await req.readJson());
  if (typeof body.isFavorite !== 'boolean') throw new MagistraError('INVALID_REQUEST', 'Le champ « isFavorite » doit valoir true ou false.');
  await store.setFavorite(userId, id, body.isFavorite);
  return json({ ok: true });
}

async function stats(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const raw = req.query.get('tz');
  const tz = raw ? normalizeTimeZone(raw) : deps.config.defaultTimeZone;
  if (!tz) throw new MagistraError('INVALID_REQUEST', 'Fuseau horaire inconnu.');
  return json(await requireStore(deps).getStats(userId, tz));
}

async function profile(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const store = requireStore(deps);
  if (req.method === 'GET') return json({ profile: await store.getProfile(userId) });
  const body = requireObject(await req.readJson());
  if (!('profile' in body)) throw new MagistraError('INVALID_REQUEST', 'Profil manquant.');
  const value: TeacherProfile | null = sanitizeProfile(body.profile, true);
  await store.saveProfile(userId, value);
  return json({ ok: true });
}

async function account(userId: string, deps: ServerDeps): Promise<ApiResult> {
  await requireStore(deps).deleteAccount(userId);
  return json({ ok: true });
}

/** Webhook Clerk : « user.deleted » → même suppression que DELETE /api/account ; autres évènements ignorés. */
async function clerkWebhook(req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const key = deps.config.clerkWebhookKey;
  if (!key) {
    const e = deps.exposeConfigProblems
      ? new MagistraError('SERVER_MISCONFIGURED', 'Webhook Clerk non configuré : renseignez CLERK_WEBHOOK_SECRET (voir .env.example).')
      : new MagistraError('SERVER_MISCONFIGURED');
    return json({ error: e.toJSON() }, 503);
  }
  const body = await req.readRaw(WEBHOOK_BODY_LIMIT);
  try {
    verifyWebhook(key, req.headers, body.text, Math.floor(deps.now().getTime() / 1_000));
  } catch (err) {
    if (!body.exact) deps.log('Webhook Clerk refusé : corps déjà analysé par l’hébergeur (sur Vercel, définissez NODEJS_HELPERS=0)');
    throw err;
  }
  let event: { type?: unknown; data?: { id?: unknown } } | null;
  try {
    event = JSON.parse(body.text) as typeof event;
  } catch {
    throw new MagistraError('INVALID_REQUEST', 'Corps de webhook JSON invalide.');
  }
  if (!event || typeof event !== 'object' || event.type !== 'user.deleted') return json({ ok: true, ignored: true });
  const userId = event.data?.id;
  if (!isValidUserId(userId)) throw new MagistraError('INVALID_REQUEST', 'Identifiant d’utilisateur manquant ou invalide.');
  // Idempotent : un compte déjà effacé (webhook renvoyé) ne produit aucune erreur.
  await requireStore(deps).deleteAccount(userId);
  return json({ ok: true });
}

/** Traite une requête API déjà associée à une route. Ne lève jamais : toute erreur devient une réponse JSON. */
export async function handleApi(route: RouteName, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  try {
    const allowed = ROUTE_METHODS[route];
    if (!allowed.includes(req.method)) return methodNotAllowed(allowed);
    // Webhook Clerk : authentifié par sa signature, jamais par un jeton de session.
    if (route === 'clerk-webhook') return await clerkWebhook(req, deps);
    if (!deps.verifier) throw misconfigured(deps, 'auth');
    const userId = await authenticate(req.headers, deps.verifier);
    switch (route) {
      case 'status':
        return await status(deps);
      case 'generate':
        return await generate(userId, req, deps);
      case 'history':
        return await history(userId, req, deps);
      case 'generation':
        return await generation(userId, req, deps);
      case 'stats':
        return await stats(userId, req, deps);
      case 'profile':
        return await profile(userId, req, deps);
      case 'account':
        return await account(userId, deps);
    }
  } catch (err) {
    return errorResult(err, deps.log);
  }
}
