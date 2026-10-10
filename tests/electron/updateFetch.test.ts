import { EventEmitter } from 'node:events';
import type { ClientRequest, ClientRequestConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createUpdateFetch } from '../../electron/updateFetch';

function fixture(run: (request: EventEmitter) => void) {
  const request = new EventEmitter();
  const abort = vi.fn(() => { request.emit('error', new Error('Redirect was cancelled')); request.emit('close'); });
  const factory = vi.fn((_options: ClientRequestConstructorOptions) => Object.assign(request, {
    abort, end: () => queueMicrotask(() => run(request)), followRedirect: vi.fn(),
  }) as unknown as ClientRequest);
  return { fetch: createUpdateFetch(factory), factory, request, abort };
}
function response(request: EventEmitter) {
  const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/plain' } });
  request.emit('response', incoming);
  return incoming;
}

describe('transport natif des mises à jour', () => {
  it('retourne la redirection sans la suivre et sans propager son annulation native', async () => {
    const f = fixture(request => request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/file', {}));
    const res = await f.fetch('https://github.com/file', { redirect: 'manual', headers: { Accept: 'text/plain' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://release-assets.githubusercontent.com/file');
    expect(res.body).toBeNull();
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.factory.mock.results[0].value.followRedirect).not.toHaveBeenCalled();
    expect(f.factory).toHaveBeenCalledWith({ url: 'https://github.com/file', method: 'GET', redirect: 'manual', headers: { accept: 'text/plain' }, useSessionCookies: false });
  });

  it('transmet les octets et les en-têtes et libère le signal après la fin', async () => {
    const f = fixture(request => {
      request.emit('close'); // fermeture du Writable après finish, avant la réponse réseau
      const incoming = response(request);
      expect(incoming.listenerCount('end')).toBe(1);
      incoming.emit('data', Buffer.from('日本語'));
      incoming.emit('data', Buffer.from(' français'));
      incoming.emit('end');
      request.emit('close');
    });
    const controller = new AbortController();
    const res = await f.fetch('https://github.com/file', { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('日本語 français');
    controller.abort();
    expect(f.abort).not.toHaveBeenCalled();
  });

  it('signale une erreur avant les en-têtes et une coupure pendant le corps', async () => {
    const failed = fixture(request => request.emit('error', new Error('offline')));
    await expect(failed.fetch('https://github.com/file')).rejects.toThrow('offline');
    const cut = fixture(request => { const incoming = response(request); incoming.emit('data', Buffer.from('partial')); incoming.emit('aborted'); });
    const res = await cut.fetch('https://github.com/file');
    await expect(res.text()).rejects.toThrow('Téléchargement interrompu');
  });

  it('respecte le délai avant et après les en-têtes, et l’annulation du lecteur', async () => {
    const waiting = fixture(() => undefined);
    await expect(waiting.fetch('https://github.com/file', { signal: AbortSignal.timeout(15) })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(waiting.abort).toHaveBeenCalledOnce();
    const streaming = fixture(response);
    const res = await streaming.fetch('https://github.com/file', { signal: AbortSignal.timeout(15) });
    await expect(res.text()).rejects.toMatchObject({ name: 'TimeoutError' });
    const cancelled = fixture(response);
    await (await cancelled.fetch('https://github.com/file')).body!.cancel();
    expect(cancelled.abort).toHaveBeenCalledOnce();
  });

  it('ne crée aucune requête pour un signal déjà annulé ou une méthode autre que GET', async () => {
    const f = fixture(() => undefined);
    await expect(f.fetch('https://github.com/file', { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(f.fetch('https://github.com/file', { method: 'POST', body: 'private' })).rejects.toThrow('uniquement GET');
    expect(f.factory).not.toHaveBeenCalled();
  });
});
