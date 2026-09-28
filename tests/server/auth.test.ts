// Isolation des utilisateurs : A ne peut JAMAIS lire, modifier ou supprimer les données de B,
// ni agir sous son identité. L'identité vient exclusivement du jeton vérifié.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GenerationRecord, HistoryPage, TeacherProfile, UsageStats } from '../../shared/types.js';
import { MemoryStore } from '../../server/store.js';
import type { ServerDeps } from '../../server/deps.js';
import { call, generateAs, startApi, testDeps, validRequest, type TestServer } from './helpers.js';

const profileA: TeacherProfile = {
  displayName: 'Alice',
  etablissement: 'Université A',
  cycle: 'superieur',
  niveaux: ['licence_1'],
  matierePrincipale: 'informatique',
};

describe('isolation des utilisateurs (jeton Clerk vérifié côté serveur)', () => {
  let store: MemoryStore;
  let deps: ServerDeps;
  let server: TestServer;
  let idA: string;

  beforeAll(async () => {
    store = new MemoryStore();
    deps = testDeps({ store });
    server = await startApi(deps);
  });

  afterAll(() => server.close());

  beforeEach(async () => {
    await store.deleteAccount('user_A');
    await store.deleteAccount('user_B');
    idA = await generateAs(server.url, 'token-A');
    const put = await call(server.url, '/api/profile', 'token-A', { method: 'PUT', body: JSON.stringify({ profile: profileA }) });
    expect(put.status).toBe(200);
  });

  it('enregistre la génération de A sous user_A, même si le corps prétend le contraire', async () => {
    expect(store.ownerOf(idA)).toBe('user_A');
    const forged = await generateAs(server.url, 'token-A', { ...validRequest, userId: 'user_B', user_id: 'user_B' });
    expect(store.ownerOf(forged)).toBe('user_A');
    const listB = await (await call(server.url, '/api/history', 'token-B')).json() as HistoryPage;
    expect(listB.items).toHaveLength(0);
  });

  it('B ne voit pas l’historique de A (y compris avec un userId forgé dans l’URL)', async () => {
    const res = await call(server.url, '/api/history?userId=user_A&user_id=user_A', 'token-B');
    expect(res.status).toBe(200);
    const page = await res.json() as HistoryPage;
    expect(page.items).toEqual([]);
    const own = await (await call(server.url, '/api/history', 'token-A')).json() as HistoryPage;
    expect(own.items.map(i => i.id)).toEqual([idA]);
  });

  it('B ne peut pas lire un contenu de A', async () => {
    const res = await call(server.url, `/api/generation?id=${idA}`, 'token-B');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    const ok = await call(server.url, `/api/generation?id=${idA}`, 'token-A');
    expect(ok.status).toBe(200);
    const record = await ok.json() as GenerationRecord;
    expect(record.id).toBe(idA);
    expect(record.contenu).toContain('Contenu simulé');
  });

  it('B ne peut pas mettre en favori un contenu de A', async () => {
    const res = await call(server.url, `/api/generation?id=${idA}`, 'token-B', {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: true, userId: 'user_A' }),
    });
    expect(res.status).toBe(404);
    const record = await store.getGeneration('user_A', idA);
    expect(record.isFavorite).toBe(false);
  });

  it('B ne peut pas supprimer un contenu de A', async () => {
    const res = await call(server.url, `/api/generation?id=${idA}`, 'token-B', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(store.ownerOf(idA)).toBe('user_A');
  });

  it('B ne peut ni lire ni modifier le profil de A', async () => {
    const readB = await (await call(server.url, '/api/profile?userId=user_A', 'token-B')).json() as { profile: TeacherProfile | null };
    expect(readB.profile).toBeNull();
    const put = await call(server.url, '/api/profile', 'token-B', {
      method: 'PUT',
      body: JSON.stringify({ userId: 'user_A', profile: { ...profileA, displayName: 'Pirate' } }),
    });
    expect(put.status).toBe(200);
    expect((await store.getProfile('user_A'))?.displayName).toBe('Alice');
    expect((await store.getProfile('user_B'))?.displayName).toBe('Pirate');
  });

  it('la suppression du compte de B ne touche pas aux données de A', async () => {
    const res = await call(server.url, '/api/account', 'token-B', { method: 'DELETE', body: JSON.stringify({ userId: 'user_A' }) });
    expect(res.status).toBe(200);
    expect(store.ownerOf(idA)).toBe('user_A');
    expect(await store.getProfile('user_A')).not.toBeNull();
  });

  it('DELETE /api/account supprime toutes les données de l’utilisateur du jeton', async () => {
    const res = await call(server.url, '/api/account', 'token-A', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.ownerOf(idA)).toBeUndefined();
    expect(await store.getProfile('user_A')).toBeNull();
    expect(store.requestCount('user_A')).toBe(0);
  });

  it('les statistiques sont propres à chaque utilisateur', async () => {
    const a = await (await call(server.url, '/api/stats?tz=Europe/Paris', 'token-A')).json() as UsageStats;
    const b = await (await call(server.url, '/api/stats?tz=Europe/Paris', 'token-B')).json() as UsageStats;
    expect(a.total).toBe(1);
    expect(a.topMatiere).toEqual({ matiere: 'informatique', count: 1 });
    expect(b).toEqual({ total: 0, favorites: 0, today: 0, week: 0 });
  });

  describe('jeton absent ou invalide → 401 UNAUTHENTICATED sur toutes les routes', () => {
    const routes: [string, string][] = [
      ['GET', '/api/status'],
      ['POST', '/api/generate'],
      ['GET', '/api/history'],
      ['GET', '/api/generation?id=00000000-0000-4000-8000-000000000000'],
      ['PATCH', '/api/generation?id=00000000-0000-4000-8000-000000000000'],
      ['DELETE', '/api/generation?id=00000000-0000-4000-8000-000000000000'],
      ['GET', '/api/stats'],
      ['GET', '/api/profile'],
      ['PUT', '/api/profile'],
      ['DELETE', '/api/account'],
    ];
    const tokens: [string, Record<string, string>][] = [
      ['sans en-tête', {}],
      ['jeton inconnu', { Authorization: 'Bearer token-inconnu' }],
      ['schéma Basic', { Authorization: 'Basic dXNlcl9BOng=' }],
      ['Bearer vide', { Authorization: 'Bearer ' }],
      ['userId forgé seul', { 'X-User-Id': 'user_A' }],
    ];
    for (const [method, path] of routes) {
      for (const [label, headers] of tokens) {
        it(`${method} ${path} (${label})`, async () => {
          const body = ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify({ ...validRequest, userId: 'user_A', profile: profileA }) : undefined;
          const res = await call(server.url, path, undefined, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body });
          expect(res.status).toBe(401);
          const json = await res.json();
          expect(json.error.code).toBe('UNAUTHENTICATED');
          expect(json.error.message).toBe('Session expirée : reconnectez-vous.');
        });
      }
    }
  });

  it('un identifiant non-UUID est refusé', async () => {
    const res = await call(server.url, '/api/generation?id=1%20OR%201=1', 'token-A');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('aucun en-tête CORS n’est renvoyé (même origine uniquement)', async () => {
    const res = await call(server.url, '/api/history', 'token-A', { headers: { Origin: 'https://site-malveillant.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const preflight = await fetch(`${server.url}/api/history`, { method: 'OPTIONS', headers: { Origin: 'https://site-malveillant.example' } });
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('historique : pagination sans limite artificielle', () => {
  it('parcourt 130 contenus par pages, sans doublon ni oubli, favoris filtrés', async () => {
    let t = Date.parse('2026-09-01T08:00:00.000Z');
    const store = new MemoryStore({ now: () => new Date((t += 1_000)) });
    const deps = testDeps({ store });
    const server = await startApi(deps);
    try {
      const ids: string[] = [];
      for (let i = 0; i < 130; i++) {
        const { id } = await store.saveGeneration('user_A', {
          type: 'cours', niveau: 'licence_1', matiere: 'informatique', sujet: `Sujet ${i}`,
          contenu: `# Titre ${i}\n\n${'Texte '.repeat(100)}`, sources: [], params: {},
        });
        ids.push(id);
        if (i % 10 === 0) await store.setFavorite('user_A', id, true);
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await call(server.url, `/api/history?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'token-A');
        expect(res.status).toBe(200);
        const page = await res.json() as HistoryPage;
        for (const item of page.items) {
          expect(item).not.toHaveProperty('contenu');
          expect(item.excerpt.length).toBeLessThanOrEqual(241);
        }
        seen.push(...page.items.map(i => i.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual([...ids].reverse());

      const all = await (await call(server.url, '/api/history?limit=500', 'token-A')).json() as HistoryPage;
      expect(all.items).toHaveLength(130);
      expect(all.nextCursor).toBeUndefined();

      const fav = await (await call(server.url, '/api/history?favorites=1', 'token-A')).json() as HistoryPage;
      expect(fav.items).toHaveLength(13);
      expect(fav.items.every(i => i.isFavorite)).toBe(true);

      const bad = await call(server.url, '/api/history?cursor=%27%3B--', 'token-A');
      expect(bad.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});

describe('statistiques exactes selon le fuseau', () => {
  it('compte aujourd’hui depuis minuit à Paris, et la semaine sur 7 jours glissants', async () => {
    let now = new Date('2026-09-27T21:30:00.000Z'); // 27/09, 23 h 30 à Paris
    const store = new MemoryStore({ now: () => now });
    await store.saveGeneration('user_A', { type: 'cours', niveau: 'licence_1', matiere: 'droit', sujet: 'a', contenu: 'x', sources: [], params: {} });
    now = new Date('2026-09-27T22:30:00.000Z'); // 28/09, 0 h 30 à Paris
    await store.saveGeneration('user_A', { type: 'cours', niveau: 'licence_1', matiere: 'droit', sujet: 'b', contenu: 'x', sources: [], params: {} });
    await store.saveGeneration('user_A', { type: 'cours', niveau: 'licence_1', matiere: 'histoire', sujet: 'c', contenu: 'x', sources: [], params: {} });
    now = new Date('2026-09-10T10:00:00.000Z');
    await store.saveGeneration('user_A', { type: 'cours', niveau: 'licence_1', matiere: 'histoire', sujet: 'd', contenu: 'x', sources: [], params: {} });
    now = new Date('2026-09-28T09:00:00.000Z');

    const deps = testDeps({ store });
    const server = await startApi(deps);
    try {
      const paris = await (await call(server.url, '/api/stats?tz=Europe/Paris', 'token-A')).json() as UsageStats;
      expect(paris).toEqual({ total: 4, favorites: 0, today: 2, week: 3, topMatiere: { matiere: 'droit', count: 2 } });
      const utc = await (await call(server.url, '/api/stats?tz=UTC', 'token-A')).json() as UsageStats;
      expect(utc.today).toBe(0);
      const byDefault = await (await call(server.url, '/api/stats', 'token-A')).json() as UsageStats;
      expect(byDefault.today).toBe(2);
      const invalid = await call(server.url, '/api/stats?tz=Mars/Olympus', 'token-A');
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.message).toBe('Fuseau horaire inconnu.');
    } finally {
      await server.close();
    }
  });
});
