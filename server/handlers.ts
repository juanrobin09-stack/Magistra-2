// Logique des routes /api/*, indépendante de l'hébergeur (Vercel, serveur Node autonome, Vite).
// Contrat : shared/apiContract.ts.
//
// Ordre des vérifications pour chaque requête :
//   (mode personnel : connexion locale, Host et Origin) → méthode autorisée → routes publiques /api/mode et
//   /api/windows-release → serveur configuré → jeton vérifié (Clerk : identité = claim « sub » ; mode personnel :
//   jeton secret) → paramètres validés → opération filtrée par l'utilisateur du jeton.

import type { ServerStatus } from '../shared/apiContract.js';
import { isMagistraError, MagistraError, toMagistraError, type ErrorCode } from '../shared/errors.js';
import { runGeneration } from '../shared/pipeline.js';
import { officialSitesPath } from '../shared/research/index.js';
import type { GenerationEvent, TeacherProfile } from '../shared/types.js';
import { validateGenerationRecordDraft, validateGenerationRequest } from '../shared/validation.js';
import { authenticate } from './auth.js';
import { verifyWebhook, WEBHOOK_BODY_LIMIT } from './clerkWebhook.js';
import { generationSlotTtlSeconds, maxDocumentCharsFor } from './config.js';
import type { ActiveAI, ServerDeps } from './deps.js';
import { isValidUserId, requireUuid } from './ids.js';
import { personalUnauthenticated } from './personal.js';
import { sanitizeProfile } from './profile.js';
import { HISTORY_LIMITS, isStorageFullError, STORAGE_FULL_MESSAGE, type GenerationAdmission, type GenerationStore } from './store.js';
import { normalizeTimeZone } from './time.js';
import { downloadLocation, fetchLatestWindowsRelease, windowsReleaseCacheControl } from './windowsRelease.js';

export type RouteName =
  | 'mode' | 'status' | 'generate' | 'history' | 'generation' | 'windows-release' | 'download' | 'stats' | 'profile' | 'account'
  | 'clerk-webhook';

export const ROUTE_METHODS: Record<RouteName, readonly string[]> = {
  mode: ['GET'],
  status: ['GET'],
  generate: ['POST'],
  history: ['GET'],
  generation: ['GET', 'POST', 'PATCH', 'DELETE'],
  'windows-release': ['GET'],
  download: ['GET'],
  stats: ['GET'],
  profile: ['GET', 'PUT'],
  account: ['DELETE'],
  'clerk-webhook': ['POST'],
};

export function isRouteName(value: string): value is RouteName {
  return Object.prototype.hasOwnProperty.call(ROUTE_METHODS, value);
}

/**
 * Adresse de téléchargement du site, à partager telle quelle (« magistra-2.vercel.app/telecharger ») : même route que
 * /api/download (réécriture dans vercel.json ; alias du serveur autonome et du serveur de développement).
 */
export const DOWNLOAD_PATH = '/telecharger';

/** « /api/history » ou « /api/history/ » → « history » ; « /telecharger » → « download » ; toute autre forme → null. */
export function routeFromPath(pathname: string): RouteName | null {
  if (pathname === DOWNLOAD_PATH || pathname === `${DOWNLOAD_PATH}/`) return 'download';
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
  /** Adresse de la connexion (contrôle du mode personnel), si l'hébergeur la fournit. */
  remoteAddress?: string;
}

export type ApiResult =
  | { type: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  /** Redirection 302 vers une adresse construite par le serveur (jamais tirée de la requête). */
  | { type: 'redirect'; location: string; headers?: Record<string, string> }
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
  if (what === 'auth' && deps.startupError) return new MagistraError('SERVER_MISCONFIGURED', deps.startupError);
  const detail = what === 'auth'
    ? 'renseignez CLERK_SECRET_KEY (ou CLERK_JWT_KEY) dans le fichier .env, ou utilisez le mode personnel sur cet ordinateur (MAGISTRA_AUTH=personal)'
    : 'renseignez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans le fichier .env, ou MAGISTRA_STORE=file';
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

interface AIStatusValue {
  ai: ServerStatus['ai'];
  maxDocumentChars: number;
}

/**
 * État de l'IA pour /api/status : cause précise (code et message) quand elle n'est pas utilisable, avertissement non
 * bloquant (état non vérifié…), fiche du prestataire qui reçoit les textes. Test borné par AI_HEALTH_TIMEOUT_MS
 * (un délai dépassé donne « état non vérifié », jamais « indisponible »). Jamais d'adresse ni de clé.
 */
async function aiStatus(deps: ServerDeps): Promise<AIStatusValue> {
  const cache = deps.healthCache;
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value as AIStatusValue;
  let value: AIStatusValue;
  try {
    const active = await deps.resolveAI();
    const { provider } = active;
    const label = provider.label || active.label;
    const info = active.providerInfo ? { providerInfo: active.providerInfo } : {};
    const health = await provider.health(AbortSignal.timeout(deps.config.ai.healthTimeoutMs));
    value = {
      ai: health.ok
        ? {
            ok: true,
            label,
            model: provider.model,
            ...(health.warning ? { warning: { code: health.warning.code, message: health.warning.message } } : {}),
            ...info,
          }
        : {
            ok: false,
            label,
            model: provider.model,
            code: health.error?.code ?? 'AI_SERVER_UNAVAILABLE',
            message: health.error?.message ?? new MagistraError('AI_SERVER_UNAVAILABLE').message,
            ...info,
          },
      // IA détectée : les extraits acceptés suivent son contexte réel.
      maxDocumentChars: active.origin === 'detection' ? maxDocumentCharsFor(active.contextTokens) : deps.config.maxDocumentChars,
    };
  } catch (err) {
    const e = toMagistraError(err, 'AI_SERVER_UNAVAILABLE');
    const { label, model, providerInfo } = deps.config.ai;
    value = {
      ai: { ok: false, label, ...(model ? { model } : {}), code: e.code, message: e.message, ...(providerInfo ? { providerInfo } : {}) },
      maxDocumentChars: deps.config.maxDocumentChars,
    };
  }
  deps.healthCache = { at: Date.now(), ttl: value.ai.ok && !value.ai.warning ? 30_000 : 10_000, value };
  return value;
}

async function status(deps: ServerDeps): Promise<ApiResult> {
  const research = deps.research.config;
  const { ai, maxDocumentChars } = await aiStatus(deps);
  const body: ServerStatus = {
    ai,
    research: {
      academic: research.academic,
      web: Boolean(research.searxngUrl),
      institutional: officialSitesPath(research, deps.research.deps) !== null,
      wikipedia: research.wikipedia,
    },
    maxDocumentChars,
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
async function admitGeneration(userId: string, store: GenerationStore, deps: ServerDeps, timeoutMs: number): Promise<() => Promise<void>> {
  const { config } = deps;
  const ttlSeconds = generationSlotTtlSeconds({ ai: { timeoutMs } });
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

/**
 * Journal d'une génération échouée (F8) : code, libellé du serveur d'IA et modèle UNIQUEMENT. Jamais le sujet, la
 * demande, un extrait, le contenu produit, l'identifiant de l'enseignant ni une clé.
 */
function logGenerationFailure(deps: ServerDeps, active: Pick<ActiveAI, 'label' | 'model'>, code: ErrorCode): void {
  deps.log(`Génération échouée : ${code} (${active.label.slice(0, 80)}, modèle ${(active.model || 'non renseigné').slice(0, 120)})`);
}

async function generate(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const store = requireStore(deps);
  // Toute propriété « userId » éventuellement présente dans le corps est ignorée par la validation.
  const request = validateGenerationRequest(await req.readJson());
  let active: ActiveAI;
  try {
    active = await deps.resolveAI();
  } catch (err) {
    // Erreur inattendue : journalisée en détail par handleApi.
    if (!isMagistraError(err)) throw err;
    // Aucune IA utilisable (non configurée, adresse impossible, rien de détecté) : même ligne de journal que les
    // autres échecs, puis réponse d'erreur sans nouvelle journalisation.
    const label = deps.localAI ? 'IA locale (détection automatique)' : deps.config.ai.label;
    logGenerationFailure(deps, { label, model: deps.config.ai.model ?? '' }, err.code);
    return errorResult(err);
  }
  const { provider } = active;
  const release = await admitGeneration(userId, store, deps, active.timeoutMs);

  const clientSignal = req.signal;
  const timeout = AbortSignal.timeout(active.timeoutMs);
  const signal = AbortSignal.any([clientSignal, timeout]);

  async function* events(): AsyncGenerator<GenerationEvent> {
    // Historique plein : le contenu généré est quand même renvoyé, avec un avertissement précis (pas le message générique).
    let storageFull = false;
    try {
      const pipeline = runGeneration(request, {
        provider,
        research: deps.research,
        // Enregistrement TOUJOURS sous l'utilisateur du jeton vérifié.
        save: async record => {
          try {
            return await store.saveGeneration(userId, record);
          } catch (err) {
            if (isStorageFullError(err)) storageFull = true;
            throw err;
          }
        },
        signal,
        maxOutputTokens: deps.config.ai.maxOutputTokens,
        // Les nouveaux essais ont lieu dans ce flux : la place de génération reste tenue jusqu'à la fin.
        retryDelaysMs: deps.config.ai.retryDelaysMs,
        // Ollama sur la machine du serveur : chargement du modèle annoncé (« Chargement du modèle… »).
        preloadModel: provider.kind === 'ollama' && provider.local,
      });
      for await (const event of pipeline) {
        if (event.type === 'error' && event.code === 'GENERATION_ABORTED' && timeout.aborted && !clientSignal.aborted) {
          const e = new MagistraError('AI_TIMEOUT', 'La génération a dépassé la durée maximale autorisée par le serveur. Réessayez avec une demande plus courte.');
          logGenerationFailure(deps, active, e.code);
          yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable };
          continue;
        }
        // Arrêt demandé par l'enseignant (ou déconnexion) : pas un échec.
        if (event.type === 'error' && !(event.code === 'GENERATION_ABORTED' && clientSignal.aborted)) {
          logGenerationFailure(deps, active, event.code);
          deps.onGenerationError(event.code);
        }
        yield storageFull && event.type === 'warning' && event.code === 'STORAGE_ERROR' ? { ...event, message: `Le contenu est affiché mais n'a pas été enregistré. ${STORAGE_FULL_MESSAGE}` } : event;
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

/**
 * Limitation de débit d'un enregistrement (POST /api/generation) : même compteur partagé, même opération atomique et
 * même limite par utilisateur (RATE_LIMIT_PER_MINUTE) que POST /api/generate — une génération faite par Magistra
 * locale compte comme une demande de génération POUR L'ENSEIGNANT. Ni place de génération (rien ne s'exécute ici), ni
 * limite globale : l'enregistrement est compté comme « save », hors du budget global qui protège le serveur d'IA (il
 * ne le consomme pas non plus). Durée de vie des places transmise telle quelle (celle d'une génération) : le ménage de
 * la base ne libère jamais trop tôt les places des générations en cours. Une panne du compteur ne bloque pas les
 * enseignants, comme pour les générations.
 */
async function admitSave(userId: string, store: GenerationStore, deps: ServerDeps): Promise<void> {
  const maxRequests = deps.config.rateLimitPerMinute;
  if (maxRequests <= 0) return;
  let admission: GenerationAdmission;
  try {
    admission = await store.beginGeneration(userId, {
      windowSeconds: RATE_WINDOW_SECONDS,
      maxRequests,
      maxGlobalRequests: 0,
      maxActive: 0,
      activeTtlSeconds: generationSlotTtlSeconds(deps.config),
      kind: 'save',
    });
  } catch (err) {
    deps.log('Anti-abus indisponible (enregistrement accepté)', err);
    return;
  }
  if (admission.status !== 'ok') throw new MagistraError(ADMISSION_ERRORS[admission.status]);
}

/**
 * POST /api/generation : génération faite par Magistra locale (IA de l'ordinateur de l'enseignant, via le connecteur
 * de l'application Windows), enregistrée dans l'historique du compte. Ordre : jeton vérifié (handleApi) → débit →
 * validation complète du contenu (validateGenerationRecordDraft : entrée non fiable, le serveur ne l'a pas produite)
 * → enregistrement sous l'utilisateur du jeton. Identifiant, date et favori sont attribués ici : ceux du corps, comme
 * tout champ « userId », sont ignorés.
 */
async function saveGeneration(userId: string, req: ApiRequest, deps: ServerDeps, store: GenerationStore): Promise<ApiResult> {
  if (req.query.has('id')) throw new MagistraError('INVALID_REQUEST', 'L’identifiant d’un nouveau contenu est attribué par le serveur.');
  await admitSave(userId, store, deps);
  const body = requireObject(await req.readJson());
  if (!('record' in body)) throw new MagistraError('INVALID_REQUEST', 'Contenu à enregistrer manquant.');
  const draft = validateGenerationRecordDraft(body.record);
  const { id } = await store.saveGeneration(userId, draft);
  return json({ id }, 201);
}

async function generation(userId: string, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  const store = requireStore(deps);
  if (req.method === 'POST') return await saveGeneration(userId, req, deps, store);
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

/**
 * GET /api/windows-release : installateur de la dernière version STABLE publiée sur le dépôt officiel (voir
 * windowsRelease.ts). Toujours 200 : « aucune version » et « GitHub indisponible » font partie de la réponse, avec la
 * page des versions en repli. Réponse publique, mise en cache par le CDN (jamais le jeton GitHub).
 */
async function windowsRelease(deps: ServerDeps): Promise<ApiResult> {
  const { repo, token } = deps.config.releases;
  const body = await fetchLatestWindowsRelease({
    fetch: deps.releasesFetch,
    repo,
    ...(token ? { token } : {}),
    now: () => deps.now().getTime(),
    cache: deps.releasesCache,
    log: message => deps.log(message),
  });
  return json(body, 200, { 'Cache-Control': windowsReleaseCacheControl(body) });
}

/**
 * GET /telecharger (= /api/download) : le bouton « Télécharger » du site pointe ici, sur le site lui-même, et le clic
 * télécharge l'installateur Windows sans jamais afficher de page GitHub :
 *  - dernière version stable connue : redirection vers son installateur (Magistra-Setup-X.Y.Z.exe, lien vérifié) ;
 *  - GitHub momentanément injoignable : redirection vers le même installateur sous son nom fixe
 *    (…/releases/latest/download/Magistra-Setup.exe, publié par release.yml) ;
 *  - aucune version publiée : retour à la section « Magistra pour Windows » de l'accueil, qui l'explique.
 * L'adresse de redirection est construite par le serveur (dépôt de la configuration), jamais tirée de la requête.
 */
async function download(deps: ServerDeps): Promise<ApiResult> {
  const { repo, token } = deps.config.releases;
  const release = await fetchLatestWindowsRelease({
    fetch: deps.releasesFetch,
    repo,
    ...(token ? { token } : {}),
    now: () => deps.now().getTime(),
    cache: deps.releasesCache,
    log: message => deps.log(message),
  });
  const headers = { 'Cache-Control': 'no-store' };
  return { type: 'redirect', location: downloadLocation(release, repo), headers };
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
/** Authentifie la requête ; en mode personnel, le message indique comment retrouver l'adresse d'accès. */
async function authenticateRequest(req: ApiRequest, deps: ServerDeps): Promise<string> {
  if (!deps.verifier) throw misconfigured(deps, 'auth');
  try {
    return await authenticate(req.headers, deps.verifier);
  } catch (err) {
    if (deps.personal && isMagistraError(err) && err.code === 'UNAUTHENTICATED') throw personalUnauthenticated();
    throw err;
  }
}

export async function handleApi(route: RouteName, req: ApiRequest, deps: ServerDeps): Promise<ApiResult> {
  try {
    // Mode personnel : connexion locale, en-tête Host local et Origin identique, avant toute autre chose.
    deps.personal?.checkRequest(req);
    const allowed = ROUTE_METHODS[route];
    if (!allowed.includes(req.method)) return methodNotAllowed(allowed);
    // Mode d'authentification : public, sans aucun secret (clé PUBLIABLE Clerk seulement).
    if (route === 'mode') return json(deps.modeInfo);
    // Dernière version stable de l'application Windows : publique (page d'accueil), sans aucun secret.
    if (route === 'windows-release') return await windowsRelease(deps);
    // Téléchargement de l'installateur Windows : public (bouton « Télécharger » de l'accueil).
    if (route === 'download') return await download(deps);
    // Webhook Clerk : authentifié par sa signature, jamais par un jeton de session.
    if (route === 'clerk-webhook') return await clerkWebhook(req, deps);
    const userId = await authenticateRequest(req, deps);
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
