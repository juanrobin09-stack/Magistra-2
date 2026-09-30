// Lecture robuste des flux HTTP (SSE et NDJSON) avec délais d'inactivité.

import { MagistraError } from '../errors.js';
import type { FetchLike } from './provider.js';

export interface TimeoutOptions {
  /** Délai max avant le premier octet utile (chargement du modèle). */
  firstChunkMs: number;
  /** Délai max entre deux morceaux. */
  idleMs: number;
}

/** Combine un signal utilisateur et un contrôleur interne (pour les délais). */
export function linkSignals(external?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  if (!external) return { controller, dispose: () => {} };
  if (external.aborted) controller.abort(external.reason);
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener('abort', onAbort, { once: true });
  return { controller, dispose: () => external.removeEventListener('abort', onAbort) };
}

function abortError(): Error {
  const err = new Error('Opération annulée.');
  err.name = 'AbortError';
  return err;
}

/**
 * Rejette dès que le signal est annulé, même si l'opération sous-jacente ne l'écoute pas
 * (implémentation de fetch ou flux qui ignore l'annulation).
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      err => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Envoie la requête avec un délai maximal d'attente des en-têtes de réponse.
 * Au-delà, le contrôleur est annulé et une erreur AI_TIMEOUT est levée.
 */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  controller: AbortController,
  timeoutMs: number,
): Promise<Response> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await raceAbort(fetchImpl(url, { ...init, signal: controller.signal }), controller.signal);
  } catch (err) {
    if (timedOut) throw new MagistraError('AI_TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Itère sur les lignes d'un corps de réponse en appliquant des délais d'inactivité.
 * En cas de dépassement, le contrôleur est annulé et une erreur AI_TIMEOUT est levée.
 * Si l'itération s'arrête avant la fin du flux, le flux est annulé (la connexion est libérée
 * et le moteur cesse de générer).
 */
export async function* readLines(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  timeouts: TimeoutOptions,
  external?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let first = true;
  let timedOut = false;
  let finished = false;

  try {
    while (true) {
      const wait = first ? timeouts.firstChunkMs : timeouts.idleMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new MagistraError('AI_TIMEOUT'));
        }, wait);
      });
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await Promise.race([raceAbort(reader.read(), controller.signal), timeout]);
      } catch (err) {
        if (timedOut) throw new MagistraError('AI_TIMEOUT');
        if (external?.aborted) throw new MagistraError('GENERATION_ABORTED');
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (result.done) {
        finished = true;
        break;
      }
      first = false;
      buffer += decoder.decode(result.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    if (!finished) {
      // Arrêt anticipé (annulation, délai, fin logique du flux) : on libère la connexion.
      reader.cancel().catch(() => {});
    }
    try {
      reader.releaseLock();
    } catch {
      /* flux déjà fermé */
    }
  }
}

/** Extrait les charges utiles « data: » d'un flux Server-Sent Events. */
export async function* readSSE(lines: AsyncIterable<string>): AsyncGenerator<string> {
  let data: string[] = [];
  for await (const line of lines) {
    if (line === '') {
      if (data.length) {
        yield data.join('\n');
        data = [];
      }
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length) yield data.join('\n');
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Détail d'une réponse d'erreur d'un serveur d'IA. Sert UNIQUEMENT au diagnostic et au choix du message :
 * il n'est jamais montré tel quel à l'utilisateur.
 */
export interface HttpErrorDetail {
  /** Message d'erreur du serveur (tronqué à 500 caractères). */
  message: string;
  /**
   * Codes et types d'erreur en minuscules : error.type, error.code, type, code, errors[].code
   * (« invalid_model », « rate_limit_exceeded », « 4006 »…).
   */
  codes: string[];
  /**
   * Attente conseillée avant un nouvel essai (ms), d'après Retry-After, x-ratelimit-reset(-requests|-tokens),
   * ratelimit-reset, ou les en-têtes recopiés dans error.metadata.headers (OpenRouter).
   */
  retryAfterMs?: number;
}

/** Accès aux en-têtes insensible à la casse (Headers, ou objet simple comme error.metadata.headers). */
interface HeaderReader {
  get(name: string): string | null;
}

function headerReader(source: unknown): HeaderReader | undefined {
  if (!source || typeof source !== 'object') return undefined;
  if (typeof (source as Headers).get === 'function') return source as Headers;
  const entries = Object.entries(source as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => [k.toLowerCase(), String(v)] as const);
  const map = new Map(entries);
  return { get: name => map.get(name.toLowerCase()) ?? null };
}

/** Durée écrite « 2m59.56s », « 7.66s », « 500ms », « 1h2m » (OpenAI, Groq) → ms. */
function parseDuration(value: string): number | undefined {
  const v = value.trim().toLowerCase();
  if (!/^(\d+(\.\d+)?(ms|h|m|s))+$/.test(v)) return undefined;
  let ms = 0;
  for (const [, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const x = Number(n);
    ms += unit === 'h' ? x * 3_600_000 : unit === 'm' ? x * 60_000 : unit === 's' ? x * 1_000 : x;
  }
  return ms;
}

/**
 * Délai d'attente d'après la valeur d'un en-tête de limitation de débit, en ms (undefined si illisible) :
 * nombre de secondes, horodatage Unix (secondes ou millisecondes), durée « 1m30s », date HTTP ou ISO.
 */
export function parseRetryDelay(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 1e12) return Math.max(0, n - now); // horodatage en millisecondes (OpenRouter)
    if (n > 1e9) return Math.max(0, n * 1_000 - now); // horodatage en secondes
    return n * 1_000; // nombre de secondes
  }
  const duration = parseDuration(v);
  if (duration !== undefined) return duration;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Attente conseillée par les en-têtes d'une réponse 429 (ms). Priorité : Retry-After, puis x-ratelimit-reset /
 * ratelimit-reset, puis x-ratelimit-reset-requests / -tokens (celui dont le « remaining » vaut 0, sinon le plus long).
 */
export function retryDelayFromHeaders(headers: unknown, now: number = Date.now()): number | undefined {
  const h = headerReader(headers);
  if (!h) return undefined;
  for (const name of ['retry-after', 'x-ratelimit-reset', 'ratelimit-reset']) {
    const delay = parseRetryDelay(h.get(name), now);
    if (delay !== undefined) return delay;
  }
  const scoped = ['requests', 'tokens']
    .map(kind => ({ exhausted: h.get(`x-ratelimit-remaining-${kind}`)?.trim() === '0', delay: parseRetryDelay(h.get(`x-ratelimit-reset-${kind}`), now) }))
    .filter((x): x is { exhausted: boolean; delay: number } => x.delay !== undefined);
  if (scoped.length === 0) return undefined;
  const exhausted = scoped.filter(x => x.exhausted);
  return Math.max(...(exhausted.length ? exhausted : scoped).map(x => x.delay));
}

function pushCode(codes: string[], value: unknown): void {
  if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))) {
    const c = String(value).trim().toLowerCase();
    if (!codes.includes(c)) codes.push(c);
  }
}

/**
 * Message, codes et en-têtes recopiés d'un corps d'erreur JSON, quel que soit le format :
 * OpenAI / vLLM ({ error: { message, type, code } }), Mistral ({ object: 'error', message, type, code }),
 * OpenRouter ({ error: { message, code, metadata: { headers } } }), Cloudflare ({ errors: [{ code, message }] }),
 * FastAPI ({ detail } ou { detail: [{ msg }] }), Ollama ({ error: '…' }).
 */
export function errorDetailFromBody(parsed: unknown, raw = ''): { message: string; codes: string[]; metadataHeaders?: unknown } {
  const codes: string[] = [];
  let message = '';
  let metadataHeaders: unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const body = parsed as Record<string, unknown>;
    const e = body.error;
    if (typeof e === 'string') message = e;
    else if (e && typeof e === 'object') {
      const err = e as Record<string, unknown>;
      if (typeof err.message === 'string') message = err.message;
      pushCode(codes, err.type);
      pushCode(codes, err.code);
      pushCode(codes, err.status);
      const meta = err.metadata as Record<string, unknown> | undefined;
      if (meta && typeof meta === 'object') metadataHeaders = meta.headers;
    }
    pushCode(codes, body.type);
    pushCode(codes, body.code);
    if (Array.isArray(body.errors)) {
      for (const item of body.errors as unknown[]) {
        if (item && typeof item === 'object') {
          pushCode(codes, (item as Record<string, unknown>).code);
          if (!message && typeof (item as Record<string, unknown>).message === 'string') message = (item as { message: string }).message;
        }
      }
    }
    if (!message && typeof body.message === 'string') message = body.message;
    if (!message && typeof body.detail === 'string') message = body.detail;
    if (!message && Array.isArray(body.detail)) {
      const first = (body.detail as unknown[])[0] as { msg?: unknown } | undefined;
      if (typeof first?.msg === 'string') message = first.msg;
    }
  }
  if (!message) message = raw;
  return { message: message.slice(0, 500), codes, ...(metadataHeaders !== undefined ? { metadataHeaders } : {}) };
}

/** Lit une réponse d'erreur (corps et en-têtes) sans jamais la propager telle quelle à l'utilisateur. */
export async function readErrorDetail(res: Response, now: number = Date.now()): Promise<HttpErrorDetail> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  const { message, codes, metadataHeaders } = errorDetailFromBody(safeJsonParse(text), text);
  const retryAfterMs = retryDelayFromHeaders(res.headers, now) ?? retryDelayFromHeaders(metadataHeaders, now);
  return { message, codes, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

/** Lit un message d'erreur JSON éventuel sans jamais le propager tel quel à l'utilisateur. */
export async function readErrorText(res: Response): Promise<string> {
  return (await readErrorDetail(res)).message;
}

const NETWORK_CODES = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/;
/** Erreurs réseau de Chromium (net.fetch d'Electron) : « net::ERR_CONNECTION_REFUSED »… */
const CHROMIUM_NET_ERROR = /net::ERR_[A-Z_]+/;

/** Codes et messages d'une erreur et de ses causes (fetch de Node : TypeError → cause → AggregateError). */
function errorClues(err: unknown): { codes: string[]; messages: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== 'object' || seen.has(e) || depth > 4) return;
    seen.add(e);
    const x = e as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof x.code === 'string') codes.push(x.code);
    if (typeof x.message === 'string') messages.push(x.message);
    visit(x.cause, depth + 1);
    if (Array.isArray(x.errors)) for (const sub of x.errors) visit(sub, depth + 1);
  };
  visit(err, 0);
  return { codes, messages };
}

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TypeError') return true; // « fetch failed » / « terminated » (Node) — « Failed to fetch » (navigateur)
  const { codes, messages } = errorClues(err);
  return codes.some(c => NETWORK_CODES.test(c)) || messages.some(m => CHROMIUM_NET_ERROR.test(m));
}

/**
 * Nature d'une panne réseau (null si ce n'est pas une erreur réseau) :
 *  - 'refused'     : connexion refusée (rien n'écoute à cette adresse : serveur arrêté, mauvais port) ;
 *  - 'dns'         : nom introuvable (ENOTFOUND, EAI_AGAIN, ERR_NAME_NOT_RESOLVED) ;
 *  - 'unreachable' : réseau ou hôte inaccessible (EHOSTUNREACH, ENETUNREACH) ;
 *  - 'tls'         : certificat HTTPS refusé ;
 *  - 'bad_port'    : port interdit par fetch (« bad port » : 1, 9, 6000, 6665-6669, 10080…), refusé sans connexion ;
 *  - 'other'       : coupure, réinitialisation, délai de connexion… (souvent passager).
 * Toutes, sauf 'other', ne se résolvent pas en réessayant quelques secondes plus tard.
 */
export type NetworkFailure = 'refused' | 'dns' | 'unreachable' | 'tls' | 'bad_port' | 'other';

export function networkFailureKind(err: unknown): NetworkFailure | null {
  if (!isNetworkError(err)) return null;
  const { codes, messages } = errorClues(err);
  const all = [...codes, ...messages].join(' ');
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(all)) return 'refused';
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME|EAI_NODATA|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/.test(all)) return 'dns';
  if (/EHOSTUNREACH|ENETUNREACH|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_UNREACHABLE/.test(all)) return 'unreachable';
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS_|ERR_SSL_|ERR_CERT_|EPROTO/.test(all)) return 'tls';
  if (/\bbad port\b|ERR_UNSAFE_PORT/i.test(all)) return 'bad_port';
  return 'other';
}

/** Vrai si le signal a été annulé par un délai (AbortSignal.timeout), et non par l'utilisateur. */
export function abortedByTimeout(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name === 'TimeoutError';
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Première lettre en minuscule, sauf pour un sigle (« vLLM », « LM Studio » restent intacts). */
export function lowerFirst(text: string): string {
  if (text.length < 2) return text.toLowerCase();
  const [a, b] = [text[0], text[1]];
  return b === b.toLowerCase() && b !== b.toUpperCase() ? a.toLowerCase() + text.slice(1) : text;
}
