// SupabaseStore : chaque requête envoyée à Supabase est filtrée par l'utilisateur du jeton,
// avec des valeurs encodées (aucune concaténation brute dans les filtres PostgREST).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HistoryPage } from '../../shared/types.js';
import { SupabaseStore } from '../../server/store.js';
import { call, generateAs, startApi, testDeps, validRequest, type TestServer } from './helpers.js';

interface Captured {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

const ID_A = '6f1c2b1e-8d4f-4b7a-9d1e-2a3b4c5d6e7f';
const NEW_ID = '11111111-2222-4333-8444-555555555555';
const SLOT_ID = '99999999-8888-4777-8666-555555555555';

/** Faux PostgREST : répond de façon plausible et enregistre chaque requête. */
function fakeSupabase(options: { begin?: unknown; activeTableMissing?: boolean } = {}) {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    captured.push({ method, url, headers, body });
    const wantsObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const path = url.pathname;
    if (path.endsWith('/rpc/magistra_register_request')) return reply(true);
    if (path.endsWith('/rpc/magistra_begin_generation')) return reply(options.begin ?? { status: 'ok', id: SLOT_ID });
    if (path.endsWith('/rpc/magistra_end_generation')) return reply(true);
    if (path.endsWith('/rpc/magistra_stats')) return reply({ total: 3, favorites: 1, today: 2, week: 3, top_matiere: 'droit', top_count: 2 });
    if (path.endsWith('/generations')) {
      if (method === 'POST') return reply(wantsObject ? { id: NEW_ID } : [{ id: NEW_ID }], 201);
      if (method === 'GET') {
        const own = url.searchParams.get('user_id') === 'eq.user_A' && url.searchParams.get('id') === `eq.${ID_A}`;
        if (url.searchParams.has('id')) {
          return reply(own ? [{
            id: ID_A, created_at: '2026-09-28T10:00:00.123456+00:00', type: 'cours', niveau: 'licence_1', matiere: 'droit',
            discipline: null, sujet: 'Contrats', contenu: '# Contrats', sources: [], params: {}, is_favorite: false,
            truncated: false, internet_used: false, model: 'mock',
          }] : []);
        }
        return reply([{
          id: ID_A, created_at: '2026-09-28T10:00:00.123456+00:00', type: 'cours', niveau: 'licence_1', matiere: 'droit',
          discipline: null, sujet: 'Contrats', is_favorite: false, excerpt: '# Contrats\n\nLe contrat **synallagmatique**…',
        }]);
      }
      if (method === 'PATCH' || method === 'DELETE') {
        const own = url.searchParams.get('user_id') === 'eq.user_A' && url.searchParams.get('id') === `eq.${ID_A}`;
        return reply(own ? [{ id: ID_A }] : []);
      }
    }
    if (path.endsWith('/profiles')) {
      if (method === 'GET') return reply([{ data: { displayName: 'Alice', etablissement: 'U', cycle: 'superieur', niveaux: ['master_1'], matierePrincipale: 'droit' } }]);
      return reply([], method === 'POST' ? 201 : 200);
    }
    if (path.endsWith('/api_requests')) return reply([]);
    if (path.endsWith('/active_generations')) {
      return options.activeTableMissing
        ? reply({ code: 'PGRST205', message: "Could not find the table 'public.active_generations' in the schema cache" }, 404)
        : reply([]);
    }
    return reply({ message: 'inattendu' }, 404);
  }) as typeof fetch;
  return { captured, fetchImpl };
}

/** Filtre « user_id » (ou « id » pour les profils) d'une requête capturée. */
function ownerFilter(c: Captured): string | null {
  if (c.url.pathname.includes('/rpc/')) return (c.body as { p_user_id?: string }).p_user_id ?? null;
  if (c.url.pathname.endsWith('/profiles')) {
    if (c.method === 'POST') return (c.body as { id?: string }).id ?? null;
    return c.url.searchParams.get('id');
  }
  if (c.method === 'POST') return (c.body as { user_id?: string }).user_id ?? null;
  return c.url.searchParams.get('user_id');
}

describe('SupabaseStore (supabase-js avec fetch injecté)', () => {
  const fake = fakeSupabase();
  let server: TestServer;

  beforeAll(async () => {
    const store = new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'cle-service-role-de-test', fetch: fake.fetchImpl });
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '10' } }));
  });

  afterAll(() => server.close());

  it('toutes les requêtes sont filtrées par l’utilisateur du jeton (user_A), jamais par une valeur du navigateur', async () => {
    fake.captured.length = 0;
    await generateAs(server.url, 'token-A', { ...validRequest, userId: 'user_B' });
    expect((await call(server.url, '/api/history?userId=user_B', 'token-A')).status).toBe(200);
    expect((await call(server.url, `/api/generation?id=${ID_A}`, 'token-A')).status).toBe(200);
    expect((await call(server.url, `/api/generation?id=${ID_A}`, 'token-A', { method: 'PATCH', body: JSON.stringify({ isFavorite: true, user_id: 'user_B' }) })).status).toBe(200);
    expect((await call(server.url, `/api/generation?id=${ID_A}`, 'token-A', { method: 'DELETE' })).status).toBe(200);
    expect((await call(server.url, '/api/stats?tz=Europe/Paris', 'token-A')).status).toBe(200);
    expect((await call(server.url, '/api/profile', 'token-A')).status).toBe(200);
    expect((await call(server.url, '/api/profile', 'token-A', {
      method: 'PUT',
      body: JSON.stringify({ userId: 'user_B', profile: { displayName: 'Alice', etablissement: '', cycle: '', niveaux: [], matierePrincipale: 'droit' } }),
    })).status).toBe(200);
    expect((await call(server.url, '/api/account', 'token-A', { method: 'DELETE' })).status).toBe(200);

    expect(fake.captured.length).toBeGreaterThanOrEqual(11);
    for (const c of fake.captured) {
      const owner = ownerFilter(c);
      const expected = c.url.pathname.includes('/rpc/') || c.method === 'POST' ? 'user_A' : 'eq.user_A';
      expect(owner, `${c.method} ${c.url.pathname}${c.url.search}`).toBe(expected);
      // La clé service_role n'est envoyée qu'à Supabase, dans les en-têtes.
      expect(c.headers.get('apikey')).toBe('cle-service-role-de-test');
    }
    // Débit et concurrence vérifiés en un seul appel ; la place est libérée à la fin du flux.
    const begin = fake.captured.find(c => c.url.pathname.endsWith('/rpc/magistra_begin_generation'));
    expect(begin?.body).toEqual({
      p_user_id: 'user_A', p_window_seconds: 60, p_max_requests: 10, p_max_global_requests: 120, p_max_active: 2, p_active_ttl_seconds: 280 + 90,
    });
    const end = fake.captured.find(c => c.url.pathname.endsWith('/rpc/magistra_end_generation'));
    expect(end?.body).toEqual({ p_user_id: 'user_A', p_generation_id: SLOT_ID });
    expect(fake.captured.some(c => c.url.pathname.endsWith('/rpc/magistra_register_request'))).toBe(false);
    const stats = fake.captured.find(c => c.url.pathname.endsWith('/rpc/magistra_stats'));
    expect(stats?.body).toEqual({ p_user_id: 'user_A', p_tz: 'Europe/Paris' });
    const insert = fake.captured.find(c => c.method === 'POST' && c.url.pathname.endsWith('/generations'));
    expect(insert?.body).toMatchObject({ user_id: 'user_A', type: 'cours', niveau: 'licence_1', matiere: 'informatique' });
    const deletions = fake.captured.filter(c => c.method === 'DELETE').map(c => c.url.pathname.split('/').pop());
    expect(deletions).toEqual(expect.arrayContaining(['generations', 'profiles', 'api_requests', 'active_generations']));
  });

  it('un contenu d’un autre utilisateur (aucune ligne renvoyée) donne NOT_FOUND', async () => {
    const res = await call(server.url, `/api/generation?id=${ID_A}`, 'token-B', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const patch = await call(server.url, `/api/generation?id=${ID_A}`, 'token-B', { method: 'PATCH', body: JSON.stringify({ isFavorite: true }) });
    expect(patch.status).toBe(404);
    const get = await call(server.url, `/api/generation?id=${ID_A}`, 'token-B');
    expect(get.status).toBe(404);
  });

  it('l’historique renvoie des résumés (extrait nettoyé, sans contenu complet) et un curseur exploitable', async () => {
    const page = await (await call(server.url, '/api/history?limit=1', 'token-A')).json() as HistoryPage;
    expect(page.items[0]).toMatchObject({ id: ID_A, sujet: 'Contrats', isFavorite: false, excerpt: 'Contrats Le contrat synallagmatique …' });
    expect(page.items[0]).not.toHaveProperty('contenu');
    expect(page.nextCursor).toBeUndefined();
    const req = fake.captured[fake.captured.length - 1];
    expect(req.url.searchParams.get('select')).toBe('id,created_at,type,niveau,matiere,discipline,sujet,is_favorite,excerpt');
    expect(req.url.searchParams.get('limit')).toBe('2');
    expect(req.url.searchParams.get('order')).toBe('created_at.desc,id.desc');
  });

  it('encode les valeurs : un identifiant contenant des caractères spéciaux ne peut pas ajouter de filtre', async () => {
    const f = fakeSupabase();
    const store = new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'k', fetch: f.fetchImpl });
    const hostile = 'user_x|evil@a.b:c';
    await store.listGenerations(hostile, { limit: 5, cursor: Buffer.from(`2026-09-28T10:00:00.123456+00:00|${ID_A}`).toString('base64url') });
    const req = f.captured[0];
    expect(req.url.searchParams.get('user_id')).toBe(`eq.${hostile}`);
    expect(req.url.search).toContain(`user_id=eq.${encodeURIComponent(hostile)}`);
    const or = req.url.searchParams.get('or');
    expect(or).toBe(`(created_at.lt."2026-09-28T10:00:00.123456+00:00",and(created_at.eq."2026-09-28T10:00:00.123456+00:00",id.lt.${ID_A}))`);
    // Le « + » du fuseau est encodé (sinon PostgREST le lirait comme une espace).
    expect(req.url.search).toContain('%2B00%3A00');
    // Un identifiant forgé contenant « & » ou « # » est refusé avant toute requête.
    await expect(store.listGenerations('user_A&user_id=eq.user_B', { limit: 5 })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(store.getGeneration('user_A#', ID_A)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(f.captured).toHaveLength(1);
  });

  it('refuse un identifiant de contenu non-UUID sans interroger Supabase', async () => {
    const f = fakeSupabase();
    const store = new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'k', fetch: f.fetchImpl });
    for (const bad of ['1', `${ID_A}&user_id=eq.user_B`, `${ID_A}#`, 'not-a-uuid', '']) {
      await expect(store.getGeneration('user_A', bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(store.setFavorite('user_A', bad, true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(store.deleteGeneration('user_A', bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(store.listGenerations('user_A', { limit: 5, cursor: 'bidon' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.captured).toHaveLength(0);
  });

  it('une panne de Supabase devient STORAGE_ERROR, sans détail technique', async () => {
    const failing = (async () => new Response(JSON.stringify({ message: 'relation "generations" does not exist', code: '42P01' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    const store = new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'k', fetch: failing });
    const s = await startApi(testDeps({ store }));
    try {
      const res = await call(s.url, '/api/history', 'token-A');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('STORAGE_ERROR');
      expect(JSON.stringify(json)).not.toContain('relation');
    } finally {
      await s.close();
    }
  });
});

describe('SupabaseStore : générations simultanées (magistra_begin_generation / magistra_end_generation)', () => {
  const store = (f: ReturnType<typeof fakeSupabase>) => new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'k', fetch: f.fetchImpl });
  const limits = { windowSeconds: 60, maxRequests: 10, maxGlobalRequests: 120, maxActive: 2, activeTtlSeconds: 370 };

  it('traduit la réponse de la fonction SQL', async () => {
    await expect(store(fakeSupabase()).beginGeneration('user_A', limits)).resolves.toEqual({ status: 'ok', slotId: SLOT_ID });
    await expect(store(fakeSupabase({ begin: { status: 'ok', id: null } })).beginGeneration('user_A', { ...limits, maxActive: 0 }))
      .resolves.toEqual({ status: 'ok', slotId: null });
    await expect(store(fakeSupabase({ begin: { status: 'busy' } })).beginGeneration('user_A', limits)).resolves.toEqual({ status: 'busy' });
    await expect(store(fakeSupabase({ begin: { status: 'rate_limited' } })).beginGeneration('user_A', limits)).resolves.toEqual({ status: 'rate_limited' });
    await expect(store(fakeSupabase({ begin: { status: 'saturated' } })).beginGeneration('user_A', limits)).resolves.toEqual({ status: 'saturated' });
    for (const odd of [true, { status: 'ok', id: 'pas-un-uuid' }, { status: 'autre' }]) {
      await expect(store(fakeSupabase({ begin: odd })).beginGeneration('user_A', limits)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    }
    const f = fakeSupabase();
    await store(f).endGeneration('user_A', SLOT_ID.toUpperCase());
    expect(f.captured[0].body).toEqual({ p_user_id: 'user_A', p_generation_id: SLOT_ID });
    await expect(store(f).endGeneration('user_A', 'x&id=eq.y')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.captured).toHaveLength(1);
  });

  it('enregistrement (« save ») : p_kind transmis ; génération : jamais (compatible avec une base pas encore migrée)', async () => {
    const f = fakeSupabase({ begin: { status: 'ok', id: null } });
    await store(f).beginGeneration('user_A', limits);
    await store(f).beginGeneration('user_A', { ...limits, maxGlobalRequests: 0, maxActive: 0, kind: 'save' });
    const bodies = f.captured.filter(c => c.url.pathname.endsWith('/rpc/magistra_begin_generation')).map(c => c.body as Record<string, unknown>);
    expect(bodies[0]).not.toHaveProperty('p_kind');
    expect(bodies[1]).toMatchObject({ p_kind: 'save', p_max_global_requests: 0, p_max_active: 0 });
  });

  it('« busy » → 429 GENERATION_BUSY, « rate_limited » → 429 RATE_LIMITED, « saturated » → 503 AI_BUSY, sans flux ni libération', async () => {
    for (const [status, code, http] of [['busy', 'GENERATION_BUSY', 429], ['rate_limited', 'RATE_LIMITED', 429], ['saturated', 'AI_BUSY', 503]] as const) {
      const f = fakeSupabase({ begin: { status } });
      const deps = testDeps({ store: store(f) });
      const s = await startApi(deps);
      try {
        const res = await call(s.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
        expect(res.status).toBe(http);
        expect((await res.json()).error.code).toBe(code);
        expect(f.captured.some(c => c.url.pathname.endsWith('/rpc/magistra_end_generation'))).toBe(false);
        // La place réservée sur l'instance est rendue.
        expect(deps.activeGenerations.count()).toBe(0);
      } finally {
        await s.close();
      }
    }
  });

  it('la suppression du compte réussit même si la table active_generations n’existe pas encore', async () => {
    const f = fakeSupabase({ activeTableMissing: true });
    await expect(store(f).deleteAccount('user_A')).resolves.toBeUndefined();
    expect(f.captured.filter(c => c.method === 'DELETE').map(c => c.url.pathname.split('/').pop()))
      .toEqual(['active_generations', 'generations', 'profiles', 'api_requests']);
  });
});
