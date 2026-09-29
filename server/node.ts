// Adaptateur Node (IncomingMessage / ServerResponse) pour les routes /api/*.
// Utilisé tel quel par les fonctions Vercel (api/*.ts), le serveur autonome et le serveur de
// développement Vite : une seule implémentation pour tous les hébergements.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { MagistraError, toMagistraError } from '../shared/errors.js';
import type { GenerationEvent } from '../shared/types.js';
import { REQUEST_LIMITS } from '../shared/validation.js';
import { getProcessDeps, type ServerDeps } from './deps.js';
import { errorResult, handleApi, notFoundRoute, routeFromPath, type ApiRequest, type ApiResult, type RouteName } from './handlers.js';

export type DepsSource = ServerDeps | (() => ServerDeps | Promise<ServerDeps>);

/** En-têtes communs à toutes les réponses de l'API (pas de CORS : même origine uniquement). */
export const API_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

/** Intervalle des lignes vides envoyées pour garder la connexion ouverte (ignorées par le client). */
const HEARTBEAT_MS = 15_000;

function tooLarge(): MagistraError {
  return new MagistraError(
    'DOCUMENT_TOO_LARGE',
    `Demande trop volumineuse (${Math.round(REQUEST_LIMITS.bodyBytes / 1_000_000)} Mo maximum) : retirez des documents ou raccourcissez les textes.`,
  );
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return true; // absent : on tente l'analyse JSON
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(value.trim());
}

function parseJson(text: string): unknown {
  if (!text.trim()) throw new MagistraError('INVALID_REQUEST', 'Corps de requête manquant.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MagistraError('INVALID_REQUEST', 'Corps de requête JSON invalide.');
  }
}

function rawTooLarge(): MagistraError {
  return new MagistraError('DOCUMENT_TOO_LARGE', 'Corps de requête trop volumineux.');
}

/** Lit le flux de la requête en s'arrêtant dès que la limite est dépassée. */
function readStream(req: IncomingMessage, limit: number, overLimit: () => MagistraError = tooLarge): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };
    const fail = (err: MagistraError) => {
      if (settled) return;
      settled = true;
      cleanup();
      // On cesse de lire : la connexion sera fermée après la réponse d'erreur.
      req.pause();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(overLimit());
      else chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = () => fail(new MagistraError('INVALID_REQUEST', 'Lecture de la requête impossible.'));
    const onAborted = () => fail(new MagistraError('GENERATION_ABORTED'));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

/**
 * Lit le corps JSON d'une requête (1 Mo maximum).
 * Compatible avec les « helpers » de Vercel, qui peuvent avoir déjà lu et analysé le corps (req.body).
 */
export async function readJsonBody(req: IncomingMessage, limit: number = REQUEST_LIMITS.bodyBytes): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const contentType = req.headers['content-type'];
  if (!isJsonContentType(typeof contentType === 'string' ? contentType : undefined)) {
    throw new MagistraError('INVALID_REQUEST', 'Format de requête invalide : JSON attendu.');
  }

  // Corps déjà lu par l'hébergeur (Vercel) : propriété « body » définie sur la requête.
  if (Object.getOwnPropertyDescriptor(req, 'body') || req.readableEnded) {
    let body: unknown;
    try {
      body = (req as IncomingMessage & { body?: unknown }).body;
    } catch {
      throw new MagistraError('INVALID_REQUEST', 'Corps de requête JSON invalide.');
    }
    if (body === undefined || body === null) throw new MagistraError('INVALID_REQUEST', 'Corps de requête manquant.');
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      if (Buffer.byteLength(text) > limit) throw tooLarge();
      return parseJson(text);
    }
    if (Buffer.byteLength(JSON.stringify(body)) > limit) throw tooLarge();
    return body;
  }

  const buffer = await readStream(req, limit);
  return parseJson(buffer.toString('utf8'));
}

/**
 * Lit le corps brut d'une requête (webhooks signés). Si l'hébergeur l'a déjà lu et analysé (helpers de
 * Vercel), le texte est reconstitué par JSON.stringify et `exact` vaut false : la signature ne
 * correspond alors que si l'émetteur a sérialisé son JSON de la même façon.
 */
export async function readRawBody(req: IncomingMessage, limit: number): Promise<{ text: string; exact: boolean }> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw rawTooLarge();
  if (Object.getOwnPropertyDescriptor(req, 'body') || req.readableEnded) {
    let body: unknown;
    try {
      body = (req as IncomingMessage & { body?: unknown }).body;
    } catch {
      throw new MagistraError('INVALID_REQUEST', 'Corps de requête JSON invalide.');
    }
    const exact = Buffer.isBuffer(body) || typeof body === 'string';
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body);
    if (Buffer.byteLength(text) > limit) throw rawTooLarge();
    return { text, exact };
  }
  const buffer = await readStream(req, limit, rawTooLarge);
  return { text: buffer.toString('utf8'), exact: true };
}

function setHeaders(res: ServerResponse, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.statusCode = status;
  setHeaders(res, { ...API_HEADERS, ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

function sendResult(res: ServerResponse, result: Extract<ApiResult, { type: 'json' }>): void {
  sendJson(res, result.status, result.body, result.headers);
}

function waitDrainOrClose(res: ServerResponse): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}

/** Envoie un flux NDJSON : un évènement JSON par ligne, transmis immédiatement. */
export async function sendEventStream(res: ServerResponse, events: AsyncIterable<GenerationEvent>, signal: AbortSignal): Promise<void> {
  res.writeHead(200, {
    ...API_HEADERS,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true);
  const closed = () => signal.aborted || res.destroyed || res.writableEnded;
  const flush = () => (res as ServerResponse & { flush?: () => void }).flush?.();
  let lastWrite = Date.now();
  const heartbeat = setInterval(() => {
    if (!closed() && Date.now() - lastWrite >= HEARTBEAT_MS - 100) {
      res.write('\n');
      flush();
      lastWrite = Date.now();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    for await (const event of events) {
      // Client parti : on laisse le pipeline se terminer (interruption en cours) sans rien écrire.
      if (closed()) continue;
      const ok = res.write(`${JSON.stringify(event)}\n`);
      flush();
      lastWrite = Date.now();
      if (!ok) await waitDrainOrClose(res);
    }
  } catch (err) {
    if (!closed()) {
      const e = toMagistraError(err);
      res.write(`${JSON.stringify({ type: 'error', code: e.code, message: e.message, retryable: e.retryable })}\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

async function resolveDeps(source: DepsSource): Promise<ServerDeps> {
  return typeof source === 'function' ? await source() : source;
}

export interface NodeHandlerOptions {
  /** Route imposée (fonctions Vercel) ; sinon déduite du chemin « /api/<route> ». */
  route?: RouteName;
  deps?: DepsSource;
}

/** Traite une requête /api/* ; ne lève jamais. */
export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse, options: NodeHandlerOptions = {}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  // Fermeture de la connexion avant la fin de la réponse = annulation par le client.
  res.once('close', () => {
    if (!res.writableFinished) abort();
  });
  req.once('aborted', abort);
  // Une écriture après la déconnexion du client ne doit jamais faire tomber le serveur.
  res.on('error', abort);

  let deps: ServerDeps | undefined;
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = options.route ?? routeFromPath(url.pathname);
    if (!route) {
      sendResult(res, notFoundRoute() as Extract<ApiResult, { type: 'json' }>);
      return;
    }
    deps = await resolveDeps(options.deps ?? getProcessDeps);
    let bodyRejected = false;
    const apiRequest: ApiRequest = {
      method: (req.method ?? 'GET').toUpperCase(),
      query: url.searchParams,
      headers: req.headers,
      readJson: async () => {
        try {
          return await readJsonBody(req);
        } catch (err) {
          bodyRejected = true;
          throw err;
        }
      },
      readRaw: async limit => {
        try {
          return await readRawBody(req, limit);
        } catch (err) {
          bodyRejected = true;
          throw err;
        }
      },
      signal: controller.signal,
      ...(req.socket?.remoteAddress ? { remoteAddress: req.socket.remoteAddress } : {}),
    };
    const result = await handleApi(route, apiRequest, deps);
    if (result.type === 'json') {
      // Corps refusé (trop volumineux…) : la connexion est fermée plutôt que de lire le reste.
      sendJson(res, result.status, result.body, { ...result.headers, ...(bodyRejected ? { Connection: 'close' } : {}) });
      return;
    }
    try {
      await sendEventStream(res, result.events, controller.signal);
    } finally {
      // Filet de sécurité : libère la génération même si le flux n'a jamais été parcouru.
      await result.close?.();
    }
  } catch (err) {
    const result = errorResult(err, deps?.log) as Extract<ApiResult, { type: 'json' }>;
    sendResult(res, result);
  }
}

/** Fabrique le gestionnaire d'une fonction Vercel (api/<route>.ts). */
export function createRouteHandler(route: RouteName, deps?: DepsSource): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return (req, res) => handleNodeRequest(req, res, { route, deps });
}
