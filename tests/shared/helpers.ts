// Outils de test : fetch simulé, flux HTTP découpés, sans aucun accès réseau.

export const encoder = new TextEncoder();

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface BodyOptions {
  /** Délai avant chaque morceau. */
  delayMs?: number;
  /** Après le dernier morceau, le flux reste ouvert sans plus rien envoyer (serveur bloqué). */
  hang?: boolean;
  /** Après le dernier morceau, le flux échoue avec cette erreur (connexion coupée). */
  error?: Error;
}

/** Corps de réponse en flux, livré morceau par morceau (chaînes ou octets bruts). */
export function streamBody(chunks: (string | Uint8Array)[], opts: BodyOptions = {}): ReadableStream<Uint8Array> & { cancelled: () => boolean } {
  let i = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (opts.delayMs) await sleep(opts.delayMs);
      if (i < chunks.length) {
        const c = chunks[i++];
        controller.enqueue(typeof c === 'string' ? encoder.encode(c) : c);
        return;
      }
      if (opts.error) {
        controller.error(opts.error);
        return;
      }
      if (opts.hang) {
        await new Promise(() => {});
        return;
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return Object.assign(stream, { cancelled: () => cancelled });
}

/** Découpe un texte en morceaux de taille fixe (en octets : un caractère accentué peut être coupé en deux). */
export function splitBytes(text: string, size: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

export function streamResponse(body: ReadableStream<Uint8Array>, contentType = 'text/event-stream', status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

/** Erreur réseau telle que la produit fetch dans Node (undici). */
export function networkError(code = 'ECONNREFUSED'): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} 127.0.0.1:11434`), { code }) });
}

export interface RecordedCall {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

/**
 * fetch simulé : chaque appel est enregistré puis confié au gestionnaire.
 * Le gestionnaire peut renvoyer une Response, lever une erreur, ou renvoyer une promesse qui ne se résout jamais.
 */
export function mockFetch(handler: (url: string, init: RequestInit | undefined, index: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, init, body });
    return handler(url, init, calls.length - 1);
  };
  return Object.assign(fn, { calls });
}

/** Promesse qui ne se résout jamais (serveur qui accepte la connexion mais ne répond pas). */
export function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Capture l'erreur levée par une fonction asynchrone. */
export async function catchError(fn: () => Promise<unknown>): Promise<{ code?: string; message: string; name?: string }> {
  try {
    await fn();
  } catch (err) {
    return err as { code?: string; message: string; name?: string };
  }
  throw new Error("Une erreur était attendue, mais l'appel a réussi.");
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** SSE au format OpenAI. */
export function sseChunk(content: string | null, finish: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
}

/** Ligne NDJSON au format Ollama /api/chat. */
export function ollamaLine(content: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ model: 'm', message: { role: 'assistant', content }, done: false, ...extra })}\n`;
}
