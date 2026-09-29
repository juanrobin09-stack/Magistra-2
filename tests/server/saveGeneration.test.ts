// POST /api/generation : génération faite par Magistra locale (application Windows, via le connecteur) puis
// enregistrée par le site dans l'historique du compte. Identité = jeton vérifié ; débit limité par le même compteur
// que les générations ; contenu entièrement revalidé (entrée non fiable : le serveur ne l'a pas produite).

import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { SaveGenerationBody } from '../../shared/apiContract.js';
import { MagistraError } from '../../shared/errors.js';
import { runGeneration } from '../../shared/pipeline.js';
import type { GenerationEvent, GenerationRecord, GenerationRecordDraft, HistoryPage } from '../../shared/types.js';
import { generationSlotTtlSeconds } from '../../server/config.js';
import { MemoryStore, type GenerationStore } from '../../server/store.js';
import { collect, jsonResponse, mockFetch } from '../shared/helpers.js';
import { call, startApi, testDeps, validRequest, type TestServer } from './helpers.js';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const draft: GenerationRecordDraft = {
  type: 'cours',
  niveau: 'licence_1',
  matiere: 'informatique',
  discipline: 'Algorithmique',
  sujet: 'Les graphes orientés',
  contenu: '# Les graphes orientés\n\nUn graphe orienté est un couple (S, A) [S1].\n\n## Sources\n\n- [S1] cours.pdf — pages 3 à 4',
  sources: [
    { n: 1, kind: 'document', title: 'cours.pdf', docName: 'cours.pdf', locator: { type: 'pages', start: 3, end: 4, partial: true, labels: { start: 'xii', end: 'xiii' } } },
    { n: 2, kind: 'hal', title: 'Théorie des graphes', authors: ['Anne Martin', 'Paul Durand'], year: 2020, venue: 'Revue X', doi: '10.1000/hal.1', url: 'https://hal.science/hal-1' },
  ],
  params: { researchMode: 'documents_internet', duree: '2 h', objectifs: 'Définir un graphe', documents: ['cours.pdf'] },
  truncated: false,
  internetUsed: true,
  model: 'ministral-3:8b',
};

function save(base: string, token: string | undefined, body: unknown, path = '/api/generation'): Promise<Response> {
  return call(base, path, token, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('POST /api/generation — enregistrement d’une génération de Magistra locale', () => {
  it('enregistre sous l’utilisateur du jeton : 201 { id }, puis lisible dans l’historique', async () => {
    let t = Date.parse('2026-09-29T08:00:00.000Z');
    const store = new MemoryStore({ now: () => new Date(t) });
    server = await startApi(testDeps({ store }));

    const res = await save(server.url, 'token-A', { record: draft } satisfies SaveGenerationBody);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const { id } = await res.json() as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.ownerOf(id)).toBe('user_A');

    t += 1_000;
    const record = await (await call(server.url, `/api/generation?id=${id}`, 'token-A')).json() as GenerationRecord;
    expect(record).toEqual({ ...draft, id, createdAt: '2026-09-29T08:00:00.000Z', isFavorite: false });
    const page = await (await call(server.url, '/api/history', 'token-A')).json() as HistoryPage;
    expect(page.items.map(i => i.id)).toEqual([id]);
    // Invisible pour un autre compte.
    expect((await call(server.url, `/api/generation?id=${id}`, 'token-B')).status).toBe(404);
  });

  it('identifiant, date, favori et utilisateur du corps ignorés : attribués par le serveur', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store }));
    const forgedId = '00000000-0000-4000-8000-000000000000';
    const res = await save(server.url, 'token-A', {
      userId: 'user_B',
      id: forgedId,
      record: { ...draft, id: forgedId, createdAt: '1999-01-01T00:00:00.000Z', isFavorite: true, userId: 'user_B', user_id: 'user_B' },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(id).not.toBe(forgedId);
    expect(store.ownerOf(id)).toBe('user_A');
    expect(store.ownerOf(forgedId)).toBeUndefined();
    const record = await store.getGeneration('user_A', id);
    expect(record.isFavorite).toBe(false);
    expect(record.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(record).not.toHaveProperty('userId');
    expect(record).not.toHaveProperty('user_id');
    expect((await store.listGenerations('user_B', { limit: 10 })).items).toHaveLength(0);
  });

  it('jeton absent ou invalide : 401, rien n’est enregistré ni compté', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store }));
    for (const token of [undefined, 'token-inconnu']) {
      const res = await save(server.url, token, { record: draft });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    }
    expect(store.requestCount('user_A')).toBe(0);
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(0);
  });

  it('validation : 400 avec un message explicite, rien n’est enregistré', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store }));
    const cases: [unknown, string][] = [
      [{}, 'Contenu à enregistrer manquant.'],
      [{ record: null }, 'Contenu à enregistrer invalide.'],
      [{ record: [draft] }, 'Contenu à enregistrer invalide.'],
      [{ record: { ...draft, type: 'inconnu' } }, 'Type de contenu inconnu.'],
      [{ record: { ...draft, niveau: 'maternelle_xl' } }, 'Niveau inconnu.'],
      [{ record: { ...draft, matiere: 'alchimie' } }, 'Matière inconnue.'],
      [{ record: { ...draft, contenu: '  \n ' } }, 'Contenu vide : rien à enregistrer.'],
      [{ record: { ...draft, contenu: 'x'.repeat(200_001) } }, 'Le champ « contenu » est trop long (200000 caractères maximum).'],
      [{ record: { ...draft, sujet: 'x'.repeat(401) } }, 'Le champ « sujet » est trop long (400 caractères maximum).'],
      [{ record: { ...draft, sources: [{ ...draft.sources[1], url: 'javascript:alert(1)' }] } }, 'Adresse de source invalide.'],
      [{ record: { ...draft, params: { ...draft.params, researchMode: 'web' } } }, 'Champ « mode de recherche » invalide.'],
      [{ record: { ...draft, truncated: 'non' } }, 'Champ « contenu tronqué » invalide.'],
      [[draft], 'Corps de requête invalide.'],
    ];
    for (const [body, message] of cases) {
      const res = await save(server.url, 'token-A', body);
      expect(res.status, message).toBe(400);
      const json = await res.json();
      expect(json.error.code, message).toBe('INVALID_REQUEST');
      expect(json.error.message).toBe(message);
    }
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(0);
  });

  it('identifiant dans l’adresse, corps non JSON ou trop volumineux : refusés', async () => {
    server = await startApi(testDeps());
    const withId = await save(server.url, 'token-A', { record: draft }, '/api/generation?id=00000000-0000-4000-8000-000000000000');
    expect(withId.status).toBe(400);
    expect((await withId.json()).error.message).toBe('L’identifiant d’un nouveau contenu est attribué par le serveur.');

    const notJson = await call(server.url, '/api/generation', 'token-A', { method: 'POST', body: 'record=1', headers: { 'Content-Type': 'text/plain' } });
    expect(notJson.status).toBe(400);
    const broken = await save(server.url, 'token-A', '{"record": ');
    expect(broken.status).toBe(400);

    const huge = await save(server.url, 'token-A', { record: { ...draft, contenu: 'é'.repeat(600_000) } });
    expect(huge.status).toBe(413);
    expect((await huge.json()).error.code).toBe('DOCUMENT_TOO_LARGE');
  });

  it('débit : même limite par utilisateur que /api/generate (compteur partagé), sans toucher aux autres comptes', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '3' } }));
    const generated = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(generated.status).toBe(200);
    await generated.text();
    for (let i = 0; i < 2; i++) expect((await save(server.url, 'token-A', { record: draft })).status).toBe(201);
    const limited = await save(server.url, 'token-A', { record: draft });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('20');
    expect(await limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Trop de demandes en peu de temps : patientez quelques secondes.', retryable: true },
    });
    // Le débit est vérifié avant la lecture du corps : un corps invalide refusé pour débit n'est pas analysé.
    expect((await save(server.url, 'token-A', 'pas du JSON')).status).toBe(429);
    const other = await save(server.url, 'token-B', { record: draft });
    expect(other.status).toBe(201);
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(3);
    // Aucune place de génération n'est réservée par un enregistrement.
    expect(store.activeCount('user_A')).toBe(0);
  });

  it('limite GLOBALE du serveur d’IA : les enregistrements de Magistra locale ne la consomment jamais (jamais de faux AI_BUSY)', async () => {
    const store = new MemoryStore();
    // Cinq enseignants (token-A … token-E).
    const verifier = async (token: string) => {
      const m = /^token-([A-E])$/.exec(token);
      if (!m) throw new MagistraError('UNAUTHENTICATED');
      return `user_${m[1]}`;
    };
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '10', RATE_LIMIT_GLOBAL_PER_MINUTE: '2' }, overrides: { verifier } }));
    for (const token of ['token-A', 'token-A', 'token-C', 'token-C']) expect((await save(server.url, token, { record: draft })).status).toBe(201);
    // Le serveur d'IA n'a rien fait : les générations en ligne passent.
    for (const token of ['token-B', 'token-D']) {
      const generated = await call(server.url, '/api/generate', token, { method: 'POST', body: JSON.stringify(validRequest) });
      expect(generated.status).toBe(200);
      await generated.text();
    }
    // La limite globale s'applique bien aux générations elles-mêmes.
    const saturated = await call(server.url, '/api/generate', 'token-E', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(saturated.status).toBe(503);
    expect((await saturated.json()).error.code).toBe('AI_BUSY');
    // Et les enregistrements restent possibles (ils ne passent pas par le serveur d'IA).
    expect((await save(server.url, 'token-E', { record: draft })).status).toBe(201);
  });

  it('compteur partagé (Supabase) : enregistrement compté « save », avec la durée de vie des places d’une génération', async () => {
    const store = new MemoryStore();
    const seen: Parameters<GenerationStore['beginGeneration']>[1][] = [];
    const begin = store.beginGeneration.bind(store);
    store.beginGeneration = async (userId, limits) => {
      seen.push(limits);
      return begin(userId, limits);
    };
    const deps = testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '10' } });
    server = await startApi(deps);
    expect((await save(server.url, 'token-A', { record: draft })).status).toBe(201);
    expect(seen).toEqual([{ windowSeconds: 60, maxRequests: 10, maxGlobalRequests: 0, maxActive: 0, activeTtlSeconds: generationSlotTtlSeconds(deps.config), kind: 'save' }]);
    // Jamais la fenêtre de débit (60 s) : le ménage de la base libérerait trop tôt les générations en cours des autres.
    expect(generationSlotTtlSeconds(deps.config)).toBeGreaterThan(60);
  });

  it('RATE_LIMIT_PER_MINUTE=0 : aucune limite, aucun compteur', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '0' } }));
    for (let i = 0; i < 12; i++) expect((await save(server.url, 'token-A', { record: draft })).status).toBe(201);
    expect(store.requestCount('user_A')).toBe(0);
  });

  it('compteur anti-abus en panne : enregistrement accepté, panne journalisée', async () => {
    const store = new MemoryStore();
    store.beginGeneration = async () => {
      throw new Error('base injoignable');
    };
    const logs: string[] = [];
    server = await startApi(testDeps({ store, overrides: { log: m => logs.push(m) } }));
    expect((await save(server.url, 'token-A', { record: draft })).status).toBe(201);
    expect(logs).toContain('Anti-abus indisponible (enregistrement accepté)');
  });

  it('stockage absent ou en panne : erreur claire, sans détail technique', async () => {
    server = await startApi(testDeps({ store: null }));
    const misconfigured = await save(server.url, 'token-A', { record: draft });
    expect(misconfigured.status).toBe(500);
    expect((await misconfigured.json()).error.code).toBe('SERVER_MISCONFIGURED');
    await server.close();

    const failing: GenerationStore = new MemoryStore();
    failing.saveGeneration = async () => {
      throw new MagistraError('STORAGE_ERROR', undefined, { cause: new Error('disque plein /var/lib/secret') });
    };
    server = await startApi(testDeps({ store: failing }));
    const res = await save(server.url, 'token-A', { record: draft });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({ code: 'STORAGE_ERROR', message: "Impossible d'enregistrer dans l'historique.", retryable: false });
    expect(text).not.toContain('secret');
  });

  it('bout à bout : la génération produite par la pipeline (includeRecord) passe telle quelle, via NDJSON', async () => {
    // Côté application Windows : même pipeline, sans sauvegarde locale, la génération à enregistrer jointe à « done ».
    const research = mockFetch(url => {
      const host = new URL(url).hostname;
      if (host === 'api.archives-ouvertes.fr') {
        return jsonResponse({ response: { docs: [{ title_s: ['Gouvernance des SI et performance'], authFullName_s: ['Anne Martin'], producedDateY_i: 2020, doiId_s: '10.1000/hal.1', uri_s: 'https://hal.science/hal-1', abstract_s: ['Résumé : la gouvernance des systèmes d’information améliore la performance.'] }] } });
      }
      if (host === 'api.crossref.org') return jsonResponse({ message: { items: [] } });
      return jsonResponse({ query: { search: [] } });
    });
    const events = await collect(runGeneration({
      type: 'cours', niveau: 'master_1', matiere: 'systemes_information', sujet: 'La gouvernance des SI', duree: '2 h',
      objectifs: 'Comprendre les référentiels', researchMode: 'documents_internet',
      documents: [{ docId: 'd1', docName: 'Cours gouvernance.pdf', kind: 'pdf', locator: { type: 'pages', start: 14, end: 18 }, text: 'La gouvernance des SI aligne le SI sur la stratégie.' }],
    }, {
      provider: new MockProvider({ reply: 'La gouvernance aligne SI et stratégie [S1]. Voir aussi [S2].', model: 'ministral-3:8b' }),
      research: { config: { academic: true, wikipedia: true, timeoutMs: 2_000 }, deps: { fetch: research } },
      includeRecord: true,
    }));
    const done = events.find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    expect(done?.saved).toBe(false);
    const wire = JSON.parse(JSON.stringify(done)) as Extract<GenerationEvent, { type: 'done' }>;
    expect(wire.record).toBeDefined();
    expect(wire.record!.sources.some(s => s.kind === 'hal')).toBe(true);

    const store = new MemoryStore();
    server = await startApi(testDeps({ store }));
    const res = await save(server.url, 'token-A', { record: wire.record });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const { id: _id, createdAt: _createdAt, isFavorite, ...stored } = await store.getGeneration('user_A', id);
    expect(isFavorite).toBe(false);
    expect(stored).toEqual(wire.record);
    expect(stored.contenu).toBe(done!.content);
  });
});
