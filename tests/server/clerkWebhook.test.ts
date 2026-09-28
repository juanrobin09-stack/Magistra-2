// POST /api/clerk-webhook : signature Svix vérifiée à la main, « user.deleted » → effacement des données.

import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWebhookSecret, WEBHOOK_TOLERANCE_SECONDS } from '../../server/clerkWebhook.js';
import { loadConfig } from '../../server/config.js';
import { createRouteHandler, readRawBody } from '../../server/node.js';
import { routeFromPath } from '../../server/handlers.js';
import { MemoryStore } from '../../server/store.js';
import { listen, startApi, testDeps, type TestServer } from './helpers.js';

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const NOW_S = Math.floor(NOW / 1_000);

/** Signature calculée indépendamment du code testé. */
function sign(id: string, timestamp: number, body: string, key: Buffer = KEY): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function deletedEvent(userId: string): string {
  return JSON.stringify({ data: { deleted: true, id: userId, object: 'user' }, object: 'event', type: 'user.deleted' });
}

interface SendOptions {
  body?: string;
  id?: string;
  timestamp?: number;
  signature?: string;
  headers?: Record<string, string>;
}

function send(base: string, options: SendOptions = {}): Promise<Response> {
  const body = options.body ?? deletedEvent('user_A');
  const id = options.id ?? 'msg_2abc';
  const timestamp = options.timestamp ?? NOW_S;
  return fetch(`${base}/api/clerk-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(timestamp),
      'svix-signature': options.signature ?? sign(id, timestamp, body),
      ...options.headers,
    },
    body,
  });
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const user of ['user_A', 'user_B']) {
    await store.saveGeneration(user, { type: 'cours', niveau: 'licence_1', matiere: 'droit', sujet: 's', contenu: 'c', sources: [], params: {} });
    await store.saveProfile(user, { displayName: user, etablissement: '', cycle: '', niveaux: [], matierePrincipale: 'droit' });
    await store.beginGeneration(user, { windowSeconds: 60, maxRequests: 10, maxGlobalRequests: 0, maxActive: 2, activeTtlSeconds: 370 });
  }
  return store;
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serve(store: MemoryStore, env: Record<string, string> = { CLERK_WEBHOOK_SECRET: SECRET }, logs: string[] = []): Promise<string> {
  server = await startApi(testDeps({ store, env, overrides: { now: () => new Date(NOW), log: message => logs.push(message) } }));
  return server.url;
}

describe('POST /api/clerk-webhook', () => {
  it('user.deleted signé : toutes les données de l’utilisateur sont effacées, sans jeton de session', async () => {
    const store = await seededStore();
    const url = await serve(store);
    const res = await send(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(0);
    expect(await store.getProfile('user_A')).toBeNull();
    expect(store.requestCount('user_A')).toBe(0);
    expect(store.activeCount('user_A')).toBe(0);
    // Les autres comptes ne sont pas touchés.
    expect((await store.listGenerations('user_B', { limit: 10 })).items).toHaveLength(1);
    expect(await store.getProfile('user_B')).not.toBeNull();
  });

  it('rejeu : renvoyé dans le délai, sans effet (idempotent) ; au-delà de 5 minutes, refusé', async () => {
    const store = await seededStore();
    const url = await serve(store);
    const first = await send(url);
    expect(first.status).toBe(200);
    const again = await send(url);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
    expect((await store.listGenerations('user_B', { limit: 10 })).items).toHaveLength(1);

    const old = NOW_S - WEBHOOK_TOLERANCE_SECONDS - 1;
    const replayed = await send(url, { timestamp: old, body: deletedEvent('user_B') });
    expect(replayed.status).toBe(401);
    expect((await replayed.json()).error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Webhook expiré ou horodatage invalide.' });
    const future = await send(url, { timestamp: NOW_S + WEBHOOK_TOLERANCE_SECONDS + 1, body: deletedEvent('user_B') });
    expect(future.status).toBe(401);
    expect(await store.getProfile('user_B')).not.toBeNull();
    const edge = await send(url, { timestamp: NOW_S - WEBHOOK_TOLERANCE_SECONDS, body: deletedEvent('user_B') });
    expect(edge.status).toBe(200);
    expect(await store.getProfile('user_B')).toBeNull();
  });

  it('signature invalide, corps ou horodatage modifiés, mauvais secret : 401 et rien n’est effacé', async () => {
    const store = await seededStore();
    const url = await serve(store);
    const body = deletedEvent('user_A');
    const cases: SendOptions[] = [
      { signature: sign('msg_2abc', NOW_S, body, randomBytes(24)) },
      { signature: sign('msg_2abc', NOW_S, deletedEvent('user_B')) },
      { signature: sign('msg_autre', NOW_S, body) },
      { signature: sign('msg_2abc', NOW_S - 1, body) },
      { signature: 'v1,' },
      { signature: 'v1,pas-du-base64!!' },
      { signature: sign('msg_2abc', NOW_S, body).replace('v1,', 'v2,') },
      { timestamp: Number.NaN },
    ];
    for (const options of cases) {
      const res = await send(url, { body, ...options });
      expect(res.status, JSON.stringify(options)).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    }
    expect(await store.getProfile('user_A')).not.toBeNull();
  });

  it('plusieurs signatures (rotation du secret) : une seule valide suffit ; en-têtes « webhook-* » acceptés', async () => {
    const store = await seededStore();
    const url = await serve(store);
    const body = deletedEvent('user_A');
    const multi = await send(url, { body, signature: `v1,${randomBytes(32).toString('base64')} ${sign('msg_2abc', NOW_S, body)}` });
    expect(multi.status).toBe(200);
    const standard = await fetch(`${url}/api/clerk-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'webhook-id': 'm2', 'webhook-timestamp': String(NOW_S), 'webhook-signature': sign('m2', NOW_S, deletedEvent('user_B')) },
      body: deletedEvent('user_B'),
    });
    expect(standard.status).toBe(200);
    expect(await store.getProfile('user_B')).toBeNull();
  });

  it('en-têtes manquants : 400 ; autre évènement : 200 ignoré ; identifiant invalide : 400 ; méthode : 405', async () => {
    const store = await seededStore();
    const url = await serve(store);
    const missing = await fetch(`${url}/api/clerk-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: deletedEvent('user_A') });
    expect(missing.status).toBe(400);
    // Un jeton de session ne remplace pas la signature.
    const bearer = await fetch(`${url}/api/clerk-webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-A' }, body: deletedEvent('user_A'),
    });
    expect(bearer.status).toBe(400);

    const created = JSON.stringify({ data: { id: 'user_A' }, object: 'event', type: 'user.created' });
    const ignored = await send(url, { body: created });
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toEqual({ ok: true, ignored: true });

    for (const bad of [JSON.stringify({ type: 'user.deleted', data: {} }), JSON.stringify({ type: 'user.deleted', data: { id: 'a&b=c' } })]) {
      const res = await send(url, { body: bad });
      expect(res.status).toBe(400);
    }
    const notJson = await send(url, { body: 'pas du json' });
    expect(notJson.status).toBe(400);
    expect(await store.getProfile('user_A')).not.toBeNull();

    const get = await fetch(`${url}/api/clerk-webhook`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });

  it('corps trop volumineux : 413', async () => {
    const url = await serve(new MemoryStore());
    const res = await send(url, { body: JSON.stringify({ type: 'user.updated', data: { x: 'y'.repeat(300_000) } }) });
    expect(res.status).toBe(413);
  });

  it('secret absent ou invalide : 503, problème de configuration signalé, aucune exception', async () => {
    const store = await seededStore();
    const url = await serve(store, {});
    const res = await send(url);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SERVER_MISCONFIGURED');
    expect(await store.getProfile('user_A')).not.toBeNull();

    const withClerk = loadConfig({ CLERK_SECRET_KEY: 'sk_test_x' });
    expect(withClerk.clerkWebhookKey).toBeNull();
    expect(withClerk.problems.join('\n')).toContain('CLERK_WEBHOOK_SECRET manquant');
    for (const bad of ['whsec_', 'whsec_!!!', 'whsec_c2hvcnQ=', 'n’importe quoi']) {
      const cfg = loadConfig({ CLERK_SECRET_KEY: 'sk_test_x', CLERK_WEBHOOK_SECRET: bad });
      expect(cfg.clerkWebhookKey, bad).toBeNull();
      expect(cfg.problems.join('\n')).toContain('CLERK_WEBHOOK_SECRET invalide');
    }
    expect(Buffer.from(loadConfig({ CLERK_WEBHOOK_SECRET: SECRET }).clerkWebhookKey!)).toEqual(KEY);
    expect(Buffer.from(parseWebhookSecret(KEY.toString('base64'))!)).toEqual(KEY);
  });

  it('routage : /api/clerk-webhook reconnu, formes voisines refusées', () => {
    expect(routeFromPath('/api/clerk-webhook')).toBe('clerk-webhook');
    expect(routeFromPath('/api/clerk-webhook/')).toBe('clerk-webhook');
    expect(routeFromPath('/api/clerk--webhook')).toBeNull();
    expect(routeFromPath('/api/-clerk')).toBeNull();
    expect(routeFromPath('/api/clerk_webhook')).toBeNull();
  });
});

describe('fonction Vercel et corps déjà lu par l’hébergeur', () => {
  function fakeRequest(body: () => unknown, headers: Record<string, string>): IncomingMessage {
    const req = Readable.from([]) as unknown as IncomingMessage;
    Object.assign(req, { method: 'POST', url: '/api/clerk-webhook', headers: { 'content-type': 'application/json', ...headers } });
    Object.defineProperty(req, 'body', { get: body, enumerable: true, configurable: true });
    return req;
  }

  it('readRawBody : Buffer/texte exacts, objet reconstitué (exact = false)', async () => {
    await expect(readRawBody(fakeRequest(() => Buffer.from('{"a":1}'), {}), 100)).resolves.toEqual({ text: '{"a":1}', exact: true });
    await expect(readRawBody(fakeRequest(() => '{"a":2}', {}), 100)).resolves.toEqual({ text: '{"a":2}', exact: true });
    await expect(readRawBody(fakeRequest(() => ({ a: 3 }), {}), 100)).resolves.toEqual({ text: '{"a":3}', exact: false });
    await expect(readRawBody(fakeRequest(() => 'x'.repeat(101), {}), 100)).rejects.toMatchObject({ status: 413 });
  });

  it('createRouteHandler : JSON compact déjà analysé par Vercel → signature vérifiée sur sa reconstitution', async () => {
    const store = await seededStore();
    const logs: string[] = [];
    const deps = testDeps({ store, env: { CLERK_WEBHOOK_SECRET: SECRET }, overrides: { now: () => new Date(NOW), log: m => logs.push(m) } });
    const handler = createRouteHandler('clerk-webhook', deps);
    server = await listen((req, res) => {
      // Simule les « helpers » de Vercel : corps déjà lu et analysé.
      const raw = req.headers['x-test-raw'] as string;
      const parsed = JSON.parse(raw) as unknown;
      Object.defineProperty(req, 'body', { get: () => parsed, enumerable: true, configurable: true });
      req.resume();
      req.on('end', () => void handler(req, res));
    });
    const post = (raw: string) => fetch(`${server!.url}/api/clerk-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-raw': raw, 'svix-id': 'm', 'svix-timestamp': String(NOW_S), 'svix-signature': sign('m', NOW_S, raw) },
      body: raw,
    });
    // Sérialisation non compacte : la reconstitution diffère, la signature est refusée (jamais acceptée à tort).
    const spaced = await post(JSON.stringify(JSON.parse(deletedEvent('user_A')), null, 1).replace(/\n/g, ' '));
    expect(spaced.status).toBe(401);
    expect(logs.some(m => m.includes('NODEJS_HELPERS=0'))).toBe(true);
    expect(await store.getProfile('user_A')).not.toBeNull();
    const compact = await post(deletedEvent('user_A'));
    expect(compact.status).toBe(200);
    expect(await store.getProfile('user_A')).toBeNull();
  });
});
