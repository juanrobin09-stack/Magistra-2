// net.fetch refuse les redirections manuelles au lieu de retourner leur statut et leur en-tête Location.
// net.request expose cet événement : le transport renvoie la redirection sans jamais la suivre lui-même.
// Les fonctions de mise à jour valident alors chaque destination avant une nouvelle requête.
import type { ClientRequest, ClientRequestConstructorOptions } from 'electron';
import type { FetchLike } from '../shared/ai/provider.js';

type RequestFactory = (options: ClientRequestConstructorOptions) => ClientRequest;
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

export function createUpdateFetch(requestFactory: RequestFactory): FetchLike {
  return (url, init = {}) => new Promise<Response>((resolve, reject) => {
    if ((init.method ?? 'GET') !== 'GET' || init.body != null) {
      reject(new TypeError('Le transport de mise à jour accepte uniquement GET.'));
      return;
    }
    const signal = init.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const request = requestFactory({ url, method: 'GET', redirect: 'manual',
      headers: Object.fromEntries(new Headers(init.headers)), useSessionCookies: false });
    let replied = false;
    let done = false;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const clean = () => signal?.removeEventListener('abort', abort);
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clean();
      if (replied) body?.error(error);
      else reject(error);
    };
    const abort = () => { fail(signal?.reason ?? new DOMException('Interruption', 'AbortError')); request.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', fail);
    // ClientRequest est un Writable : close peut suivre finish avant la réponse.
    // Les erreurs réseau et le signal restent actifs jusqu'à la fin du corps reçu.
    request.on('redirect', (status, _method, location) => {
      if (done) return;
      done = true;
      clean();
      resolve(new Response(null, { status, headers: { location } }));
      // Ne pas appeler followRedirect : l'appelant contrôle d'abord l'URL retournée.
      request.abort();
    });
    request.on('response', response => {
      if (done) return;
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
      }
      let received = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          response.on('error', fail);
          response.on('aborted', () => fail(new Error('Téléchargement interrompu.')));
          // Electron demande d'enregistrer end avant data.
          response.on('end', () => {
            if (done) return;
            done = true;
            clean();
            controller.close();
          });
          response.on('data', chunk => {
            if (done) return;
            received += chunk.byteLength;
            if (received > MAX_RESPONSE_BYTES) {
              fail(new Error('Téléchargement trop volumineux.'));
              request.abort();
              return;
            }
            controller.enqueue(chunk);
          });
        },
        cancel() { done = true; clean(); request.abort(); },
      });
      replied = true;
      const empty = [204, 205, 304].includes(response.statusCode);
      resolve(new Response(empty ? null : stream, { status: response.statusCode, headers }));
    });
    if (signal?.aborted) abort();
    else request.end();
  });
}
