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
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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

/** Lit un message d'erreur JSON éventuel sans jamais le propager tel quel à l'utilisateur. */
export async function readErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const parsed = safeJsonParse(text) as { error?: unknown; message?: unknown; detail?: unknown } | undefined;
    if (parsed && typeof parsed === 'object') {
      const e = parsed.error;
      if (typeof e === 'string') return e;
      if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
        return (e as { message: string }).message;
      }
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.detail === 'string') return parsed.detail;
    }
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

const NETWORK_CODES = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/;

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TypeError') return true; // « fetch failed » / « terminated » (Node) — « Failed to fetch » (navigateur)
  const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
  return typeof code === 'string' && NETWORK_CODES.test(code);
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
