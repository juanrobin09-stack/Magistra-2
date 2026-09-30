// Adaptateur Node : fonctions Vercel (route imposée, corps déjà analysé par l'hébergeur).

import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryPage } from '../../shared/types.js';
import { createRouteHandler, readJsonBody } from '../../server/node.js';
import { routeFromPath } from '../../server/handlers.js';
import { MemoryStore } from '../../server/store.js';
import { call, listen, testDeps, validRequest, type TestServer } from './helpers.js';

function fakeRequest(options: { body?: () => unknown; stream?: string; headers?: Record<string, string> }): IncomingMessage {
  const req = Readable.from(options.stream !== undefined ? [Buffer.from(options.stream)] : []) as unknown as IncomingMessage;
  (req as { headers: Record<string, string> }).headers = { 'content-type': 'application/json', ...options.headers };
  if (options.body) Object.defineProperty(req, 'body', { get: options.body, enumerable: true, configurable: true });
  return req;
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('readJsonBody', () => {
  it('lit le flux de la requête', async () => {
    await expect(readJsonBody(fakeRequest({ stream: '{"a":1}' }))).resolves.toEqual({ a: 1 });
  });

  it('utilise le corps déjà analysé par Vercel (objet, texte ou Buffer)', async () => {
    await expect(readJsonBody(fakeRequest({ body: () => ({ a: 2 }) }))).resolves.toEqual({ a: 2 });
    await expect(readJsonBody(fakeRequest({ body: () => '{"a":3}' }))).resolves.toEqual({ a: 3 });
    await expect(readJsonBody(fakeRequest({ body: () => Buffer.from('{"a":4}') }))).resolves.toEqual({ a: 4 });
  });

  it('JSON invalide signalé par Vercel → INVALID_REQUEST', async () => {
    const req = fakeRequest({ body: () => { throw new Error('Invalid JSON'); } });
    await expect(readJsonBody(req)).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
  });

  it('corps volumineux (déclaré ou déjà lu) → 413', async () => {
    await expect(readJsonBody(fakeRequest({ stream: '{}', headers: { 'content-length': '2000000' } }))).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(fakeRequest({ body: () => ({ x: 'y'.repeat(1_100_000) }) }))).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(fakeRequest({ stream: `"${'z'.repeat(1_100_000)}"` }))).rejects.toMatchObject({ status: 413 });
  });

  it('corps vide ou type de contenu non JSON → 400', async () => {
    await expect(readJsonBody(fakeRequest({ stream: '' }))).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(fakeRequest({ stream: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('fonctions Vercel (createRouteHandler)', () => {
  it('la route est imposée par le fichier, quel que soit le chemin', async () => {
    const store = new MemoryStore();
    await store.saveGeneration('user_A', { type: 'cours', niveau: 'licence_1', matiere: 'droit', sujet: 's', contenu: 'c', sources: [], params: {} });
    const handler = createRouteHandler('history', testDeps({ store }));
    server = await listen((req, res) => void handler(req, res));
    const res = await call(server.url, '/api/history?limit=5', 'token-A');
    expect(res.status).toBe(200);
    expect(((await res.json()) as HistoryPage).items).toHaveLength(1);
    const post = await call(server.url, '/api/history', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(post.status).toBe(405);
  });

  it('routeFromPath ne reconnaît que les routes du contrat', () => {
    expect(routeFromPath('/api/generate')).toBe('generate');
    expect(routeFromPath('/api/history/')).toBe('history');
    expect(routeFromPath('/api/../history')).toBeNull();
    expect(routeFromPath('/api/constructor')).toBeNull();
    expect(routeFromPath('/api/usage')).toBeNull();
    expect(routeFromPath('/api')).toBeNull();
  });
});
