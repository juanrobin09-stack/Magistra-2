// Client HTTP authentifié pour l'API web.

import { isErrorCode, MagistraError } from '@shared/errors';
import type { GenerationEvent } from '@shared/types';

export type TokenGetter = () => Promise<string | null>;

async function parseError(res: Response): Promise<MagistraError> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
      const code = body.error?.code;
      if (isErrorCode(code)) {
        return new MagistraError(code, typeof body.error?.message === 'string' ? body.error.message : undefined);
      }
    } catch {
      // corps illisible : message générique ci-dessous
    }
  }
  if (res.status === 401) return new MagistraError('UNAUTHENTICATED');
  if (res.status === 403) return new MagistraError('FORBIDDEN');
  if (res.status === 404) return new MagistraError('NOT_FOUND');
  if (res.status === 429) return new MagistraError('RATE_LIMITED');
  if (res.status === 504) return new MagistraError('AI_TIMEOUT', 'Le serveur Magistra a mis trop de temps à répondre.');
  // Passerelle ou hébergeur momentanément indisponible (déploiement, surcharge) : on peut réessayer.
  if (res.status === 502 || res.status === 503) {
    return new MagistraError('NETWORK_ERROR', 'Le serveur Magistra est momentanément indisponible. Réessayez dans quelques instants.');
  }
  // Page HTML ou réponse inattendue : le serveur n'expose probablement pas l'API.
  return new MagistraError('SERVER_MISCONFIGURED');
}

export async function authedFetch(getToken: TokenGetter, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  if (!token) throw new MagistraError('UNAUTHENTICATED');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (err) {
    if (init.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    throw new MagistraError('NETWORK_ERROR', undefined, { cause: err });
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function authedJson<T>(getToken: TokenGetter, url: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(getToken, url, init);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new MagistraError('SERVER_MISCONFIGURED');
  return (await res.json()) as T;
}

const EVENT_TYPES = new Set<GenerationEvent['type']>(['status', 'sources', 'warning', 'delta', 'done', 'error']);

/** Réponse qui n'est pas le flux de génération (page HTML, JSON…) : l'API n'est pas servie à cette adresse. */
export const NOT_A_STREAM_MESSAGE =
  "Réponse inattendue du serveur Magistra : le service de génération n'est pas accessible à cette adresse. Contactez l'administrateur.";

function isGenerationEvent(value: unknown): value is GenerationEvent {
  return typeof value === 'object' && value !== null && EVENT_TYPES.has((value as { type?: GenerationEvent['type'] }).type!);
}

/** Lit un flux NDJSON d'évènements de génération. */
export async function readEventStream(res: Response, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
  const type = res.headers.get('content-type') ?? '';
  if (!res.body || !type.includes('application/x-ndjson')) throw new MagistraError('SERVER_MISCONFIGURED', NOT_A_STREAM_MESSAGE);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let validEvents = 0;
  let invalidLines = 0;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      invalidLines++;
      return;
    }
    if (!isGenerationEvent(event)) {
      invalidLines++;
      return;
    }
    validEvents++;
    if (event.type === 'done' || event.type === 'error') finished = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    buffer += decoder.decode();
    handleLine(buffer);
  } catch (err) {
    if (signal.aborted) {
      if (!finished) onEvent({ type: 'error', code: 'GENERATION_ABORTED', message: new MagistraError('GENERATION_ABORTED').message, retryable: true });
      return;
    }
    throw new MagistraError('NETWORK_ERROR', 'La connexion au serveur a été interrompue pendant la génération.', { cause: err });
  }
  if (!finished) {
    // Rien de lisible reçu : ce n'était pas le flux de génération (et non une coupure réseau).
    if (!signal.aborted && validEvents === 0 && invalidLines > 0) throw new MagistraError('SERVER_MISCONFIGURED', NOT_A_STREAM_MESSAGE);
    const e = signal.aborted ? new MagistraError('GENERATION_ABORTED') : new MagistraError('NETWORK_ERROR', 'La connexion au serveur a été interrompue pendant la génération.');
    onEvent({ type: 'error', code: e.code, message: e.message, retryable: true });
  }
}
