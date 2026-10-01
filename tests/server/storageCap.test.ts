// Plafond de stockage par utilisateur : un compte ne peut pas remplir la base. Même règle dans MemoryStore,
// FileStore et le déclencheur SQL (atomique) ; erreur claire (jamais STORAGE_ERROR), sur toutes les voies
// d'enregistrement (POST /api/generation et enregistrement qui suit POST /api/generate).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewGenerationRecord } from '../../shared/pipeline.js';
import type { GenerationEvent } from '../../shared/types.js';
import { FileStore } from '../../server/fileStore.js';
import { MemoryStore, STORAGE_FULL_MESSAGE, STORAGE_LIMITS, StorageFullError, SupabaseStore, type GenerationStore } from '../../server/store.js';
import { call, readNdjson, startApi, testDeps, validRequest, type TestServer } from './helpers.js';

let server: TestServer | undefined;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'magistra-plafond-'));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function record(contenu = '# Cours\n\nContenu.'): NewGenerationRecord {
  return { type: 'cours', niveau: 'licence_1', matiere: 'informatique', sujet: 'Les graphes', contenu, sources: [], params: {} };
}

const saveBody = (contenu = '# Cours\n\nContenu.') => JSON.stringify({ record: record(contenu) });

/** Le même scénario pour chaque stockage : plafond de 2 contenus puis plafond de volume. */
function sharedCases(make: (limits: { maxRecords: number; maxBytes: number }) => GenerationStore) {
  it('refuse le contenu au-delà du nombre maximal, avec une erreur claire et non réessayable', async () => {
    const store = make({ maxRecords: 2, maxBytes: 1_000_000 });
    await store.saveGeneration('user_A', record());
    const second = await store.saveGeneration('user_A', record());
    const err = await store.saveGeneration('user_A', record()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageFullError);
    expect(err).toMatchObject({ code: 'INVALID_REQUEST', retryable: false, message: STORAGE_FULL_MESSAGE });
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(2);

    // Supprimer un contenu libère une place.
    await store.deleteGeneration('user_A', second.id);
    await expect(store.saveGeneration('user_A', record())).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('refuse le contenu qui ferait dépasser le volume maximal (octets UTF-8)', async () => {
    const store = make({ maxRecords: 100, maxBytes: 100 });
    await store.saveGeneration('user_A', record('é'.repeat(30))); // 60 octets
    await expect(store.saveGeneration('user_A', record('é'.repeat(30)))).rejects.toBeInstanceOf(StorageFullError); // 120 > 100
    await expect(store.saveGeneration('user_A', record('a'.repeat(40)))).resolves.toBeDefined(); // 100 : accepté
  });

  it('le plafond d’un utilisateur ne touche pas les autres', async () => {
    const store = make({ maxRecords: 1, maxBytes: 1_000_000 });
    await store.saveGeneration('user_A', record());
    await expect(store.saveGeneration('user_A', record())).rejects.toBeInstanceOf(StorageFullError);
    await expect(store.saveGeneration('user_B', record())).resolves.toBeDefined();
  });

  it('enregistrements simultanés : jamais plus que le plafond', async () => {
    const store = make({ maxRecords: 3, maxBytes: 1_000_000 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => store.saveGeneration('user_A', record())));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(3);
  });
}

describe('plafond de stockage : MemoryStore', () => {
  sharedCases(limits => new MemoryStore({ storageLimits: limits }));
});

describe('plafond de stockage : FileStore', () => {
  sharedCases(limits => new FileStore(dir, { storageLimits: limits }));

  it('le plafond est recalculé après un redémarrage (contenus déjà sur le disque)', async () => {
    await new FileStore(dir, { storageLimits: { maxRecords: 1, maxBytes: 1_000_000 } }).saveGeneration('user_A', record());
    const reopened = new FileStore(dir, { storageLimits: { maxRecords: 1, maxBytes: 1_000_000 } });
    await expect(reopened.saveGeneration('user_A', record())).rejects.toBeInstanceOf(StorageFullError);
  });
});

describe('plafond de stockage : SupabaseStore (déclencheur SQL)', () => {
  const failing = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  it('l’erreur du déclencheur devient une erreur claire non réessayable, sans détail technique', async () => {
    const store = new SupabaseStore({
      url: 'https://projet.supabase.co',
      serviceRoleKey: 'k',
      fetch: failing({ code: 'MG001', message: 'magistra_storage_full', details: null, hint: null }),
    });
    const err = await store.saveGeneration('user_A', record()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageFullError);
    expect(err).toMatchObject({ code: 'INVALID_REQUEST', retryable: false, message: STORAGE_FULL_MESSAGE });
    expect(JSON.stringify((err as StorageFullError).toJSON())).not.toContain('magistra_storage_full');
  });

  it('toute autre erreur de la base reste un STORAGE_ERROR', async () => {
    const store = new SupabaseStore({ url: 'https://projet.supabase.co', serviceRoleKey: 'k', fetch: failing({ code: '42P01', message: 'relation absente' }) });
    await expect(store.saveGeneration('user_A', record())).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  });

  it('supabase-schema.sql : déclencheur sous verrou par utilisateur, mêmes plafonds que le serveur', () => {
    const sql = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase-schema.sql'), 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.magistra_check_storage_cap()');
    expect(sql).toMatch(/BEFORE INSERT ON public\.generations\s+FOR EACH ROW EXECUTE FUNCTION public\.magistra_check_storage_cap\(\)/);
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('magistra_storage:' || NEW.user_id, 0))");
    expect(sql).toContain("USING ERRCODE = 'MG001'");
    expect(sql).toContain("'magistra_storage_full'");
    expect(sql).toContain(`v_max_records CONSTANT integer := ${STORAGE_LIMITS.maxRecords};`);
    expect(sql).toContain(`v_max_bytes   CONSTANT bigint  := ${STORAGE_LIMITS.maxBytes};`);
  });
});

describe('plafond de stockage : API', () => {
  it('POST /api/generation : 409 avec un message français clair, non réessayable ; une suppression libère la place', async () => {
    const store = new MemoryStore({ storageLimits: { maxRecords: 1, maxBytes: 1_000_000 } });
    server = await startApi(testDeps({ store }));
    const first = await call(server.url, '/api/generation', 'token-A', { method: 'POST', body: saveBody() });
    expect(first.status).toBe(201);
    const { id } = await first.json() as { id: string };

    const refused = await call(server.url, '/api/generation', 'token-A', { method: 'POST', body: saveBody() });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: STORAGE_FULL_MESSAGE, retryable: false } });

    // Un autre compte n'est pas touché.
    expect((await call(server.url, '/api/generation', 'token-B', { method: 'POST', body: saveBody() })).status).toBe(201);

    expect((await call(server.url, `/api/generation?id=${id}`, 'token-A', { method: 'DELETE' })).status).toBe(200);
    expect((await call(server.url, '/api/generation', 'token-A', { method: 'POST', body: saveBody() })).status).toBe(201);
  });

  it('POST /api/generate : le contenu généré est quand même renvoyé, avec un avertissement « historique plein »', async () => {
    const store = new MemoryStore({ storageLimits: { maxRecords: 0, maxBytes: 1_000_000 } });
    server = await startApi(testDeps({ store }));
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);
    const warning = events.find((e): e is Extract<GenerationEvent, { type: 'warning' }> => e.type === 'warning' && e.code === 'STORAGE_ERROR');
    expect(warning?.message).toContain(STORAGE_FULL_MESSAGE);
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', saved: false });
    expect(done.content).toContain('Contenu simulé du cours');
    expect((await store.listGenerations('user_A', { limit: 10 })).items).toHaveLength(0);
  });

  it('POST /api/generate : une panne de stockage ordinaire garde le message générique', async () => {
    const store = new MemoryStore();
    store.saveGeneration = async () => {
      throw new Error('disque en panne');
    };
    server = await startApi(testDeps({ store }));
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    const warning = (await readNdjson(res)).find((e): e is Extract<GenerationEvent, { type: 'warning' }> => e.type === 'warning');
    expect(warning?.message).not.toContain('plein');
  });
});
