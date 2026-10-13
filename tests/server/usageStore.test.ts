import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNeonUsageStore } from '../../server/usageStore.js';
import type { UsageReport, UsageSnapshot } from '../../shared/usageTelemetry.js';

const driver = vi.hoisted(() => ({
  neon: vi.fn(),
  query: vi.fn<(sql: string, values: unknown[], options: unknown) => Promise<Record<string, unknown>[]>>(),
}));
vi.mock('@neondatabase/serverless', () => ({ neon: driver.neon }));

const DATABASE_URL = 'postgresql://usage_test:test-password@metrics.example.test/usage?sslmode=require';
const SECRET = 'test-only-hmac-secret-at-least-32-bytes';
const TOKEN = '1234567890abcdef1234567890abcdef';
const DAY = '2026-10-13';
const EMPTY: UsageSnapshot = { days: [], months: [], cohorts: [] };
function report(extra: Partial<Extract<UsageReport, { kind: 'day' }>> = {}): UsageReport {
  return { v: 1, kind: 'day', period: DAY, token: TOKEN, openings: 1, ...extra };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  driver.neon.mockReset().mockReturnValue({ query: driver.query });
  driver.query.mockReset().mockResolvedValue([{ snapshot: EMPTY }]);
});
afterEach(() => vi.useRealTimers());

describe('Neon usage store : contrat, confidentialité et accès atomique', () => {
  it('ne crée pas de client au chargement ni à la construction ; partage le premier chargement concurrent', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    expect(driver.neon).not.toHaveBeenCalled();
    await Promise.all([store.record(report()), store.snapshot(), store.record(report({ openings: 4 }))]);
    expect(driver.neon).toHaveBeenCalledExactlyOnceWith(DATABASE_URL);
    expect(driver.query).toHaveBeenCalledTimes(3);
  });

  it('envoie un HMAC par période et une seule instruction paramétrée, jamais le jeton brut', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    await store.record(report({ openings: 5, firstUse: true, cohort: DAY }));
    const [sql, values, options] = driver.query.mock.calls[0];
    expect(sql).toMatch(/^SELECT public\.magistra_record_usage\(/);
    expect(sql).not.toMatch(/CREATE|ALTER|INSERT|UPDATE|DELETE/i);
    expect(values).toEqual(['day', DAY, createHmac('sha256', SECRET).update(`day|${DAY}|${TOKEN}`).digest('hex'), 5, true, DAY, false, false]);
    expect(JSON.stringify(values)).not.toContain(TOKEN);
    expect(JSON.stringify(values)).not.toContain(SECRET);
    expect(options).toEqual({ fetchOptions: { signal: expect.any(AbortSignal) } });
  });

  it('les réessais et snapshots cumulatifs désordonnés gardent la même clé de déduplication', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    await Promise.all([5, 2, 5, 1, 4].map(openings => store.record(report({ openings }))));
    const calls = driver.query.mock.calls;
    expect(new Set(calls.map(([, values]) => values[2])).size).toBe(1);
    expect(calls.map(([, values]) => values[3]).sort()).toEqual([1, 2, 4, 5, 5]);
    expect(calls.every(([sql]) => sql.startsWith('SELECT public.magistra_record_usage('))).toBe(true);
  });

  it('isole jours, mois et jetons sans utiliser un identifiant permanent', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    await store.record(report());
    await store.record(report({ period: '2026-10-12' }));
    await store.record(report({ token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    await store.record({ v: 1, kind: 'month', period: '2026-10', token: TOKEN });
    await store.record({ v: 1, kind: 'month', period: '2026-09', token: TOKEN });
    const hashes = driver.query.mock.calls.map(([, values]) => values[2]);
    expect(new Set(hashes).size).toBe(5);
    expect(hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(driver.query.mock.calls[3][1].slice(3)).toEqual([0, false, null, false, false]);
  });

  it('transmet le premier usage sans imposer une nouvelle ouverture de fenêtre', async () => {
    await createNeonUsageStore(DATABASE_URL, SECRET).record(report({ openings: 0, firstUse: true, cohort: DAY }));
    expect(driver.query.mock.calls[0][1].slice(3)).toEqual([0, true, DAY, false, false]);
  });

  it('transmet les retours de cohorte comme flags cumulatifs de ce jour', async () => {
    await createNeonUsageStore(DATABASE_URL, SECRET).record(report({ cohort: '2026-10-08', returned7: true, returned30: true }));
    expect(driver.query.mock.calls[0][1].slice(3)).toEqual([1, false, '2026-10-08', true, true]);
  });

  it.each([
    { ...report(), token: 'raw-identifier' },
    { ...report(), ip: '203.0.113.1' },
    { ...report(), document: 'contenu privé' },
    { ...report(), userAgent: 'browser' },
    { ...report(), openings: -1 },
    { ...report(), openings: 1.5 },
    { ...report(), openings: 10001 },
    { ...report(), period: '2026-02-30' },
    { ...report(), period: '2026-10-14' },
    { ...report(), period: '2026-09-07' },
    { ...report(), cohort: '2026-10-12' },
    { ...report(), firstUse: true, cohort: '2026-10-12' },
    { ...report(), firstUse: true, cohort: DAY, returned30: true },
    { ...report(), returned7: true, cohort: '2026-10-08' },
    { ...report(), returned7: true, returned30: true, cohort: '2026-10-05' },
    { ...report(), returned30: true, cohort: '2026-09-12' },
    { v: 1, kind: 'month', token: TOKEN, period: '2026-11' },
    { v: 1, kind: 'month', token: TOKEN, period: '2026-08' },
    { v: 1, kind: 'month', token: TOKEN, period: '2026-10', openings: 1 },
  ])('refuse les rapports incohérents ou enrichis avant tout accès au pilote (%#)', async raw => {
    await expect(createNeonUsageStore(DATABASE_URL, SECRET).record(raw as UsageReport)).rejects.toThrow('Invalid usage report');
    expect(driver.neon).not.toHaveBeenCalled();
    expect(driver.query).not.toHaveBeenCalled();
  });

  it('accepte la borne de rattrapage à 35 jours et un mois dont la fin est encore admissible', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    await store.record(report({ period: '2026-09-08' }));
    await store.record({ v: 1, kind: 'month', period: '2026-09', token: TOKEN });
    expect(driver.query).toHaveBeenCalledTimes(2);
  });

  it('ne renvoie que les agrégats, même si un résultat SQL contient des champs supplémentaires', async () => {
    driver.query.mockResolvedValue([{ snapshot: {
      days: [{ period: DAY, active: 2, openings: 5, token_hash: 'hash-private' }],
      months: [{ period: '2026-10', active: 2, token: TOKEN }],
      cohorts: [{ period: '2026-10-08', firstUses: 3, returned7: 1, returned30: 2, ip: 'private' }],
      dedup: ['hash-private'],
    } }]);
    const result = await createNeonUsageStore(DATABASE_URL, SECRET).snapshot();
    expect(result).toEqual({ days: [{ period: DAY, active: 2, openings: 5 }], months: [{ period: '2026-10', active: 2 }],
      cohorts: [{ period: '2026-10-08', firstUses: 3, returned7: 1, returned30: 2 }] });
    expect(driver.query.mock.calls[0][0]).toBe('SELECT public.magistra_usage_snapshot() AS snapshot');
    expect(driver.query.mock.calls[0][1]).toEqual([]);
  });

  it('ne purge que sur un appel explicite de maintenance', async () => {
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    await store.snapshot();
    expect(driver.query).toHaveBeenCalledTimes(1);
    expect(driver.query.mock.calls[0][0]).not.toContain('purge');
    expect(store.purge).toBeTypeOf('function');
    await store.purge?.();
    expect(driver.query.mock.calls[1][0]).toBe('SELECT public.magistra_usage_purge()');
    expect(driver.query.mock.calls[1][1]).toEqual([]);
  });

  it.each([
    null, {}, { days: null, months: [], cohorts: [] },
    { days: [{ period: DAY, active: -1, openings: 0 }], months: [], cohorts: [] },
    { days: [{ period: DAY, active: Number.MAX_SAFE_INTEGER + 1, openings: 0 }], months: [], cohorts: [] },
    { days: [{ period: DAY, active: '1', openings: 0 }], months: [], cohorts: [] },
    { days: [], months: [{ period: '2026-00', active: 1 }], cohorts: [] },
  ])('signale un résultat SQL invalide au lieu de le transformer en zéros (%#)', async snapshot => {
    driver.query.mockResolvedValue([{ snapshot }]);
    await expect(createNeonUsageStore(DATABASE_URL, SECRET).snapshot()).rejects.toThrow('Usage storage unavailable');
  });

  it('efface les détails potentiellement secrets des erreurs du pilote', async () => {
    driver.query.mockRejectedValue(new Error(`connection failed: ${DATABASE_URL}; ${SECRET}; token ${TOKEN}`));
    const store = createNeonUsageStore(DATABASE_URL, SECRET);
    const error = await store.record(report()).catch((value: unknown) => value);
    expect(error).toEqual(new Error('Usage storage unavailable'));
    expect((error as Error).cause).toBeUndefined();
    await expect(store.snapshot()).rejects.toThrow('Usage storage unavailable');
  });

  it('ne divulgue pas la configuration invalide et ne charge pas le pilote', () => {
    expect(() => createNeonUsageStore('https://secret.example.test/password', SECRET)).toThrow('Usage storage misconfigured');
    expect(() => createNeonUsageStore(DATABASE_URL, 'short')).toThrow('Usage storage misconfigured');
    expect(driver.neon).not.toHaveBeenCalled();
  });
});

describe('Migration SQL usage : propriétés nécessaires aux transactions réelles', () => {
  const sql = readFileSync(new URL('../../server/usage-schema.sql', import.meta.url), 'utf8');
  it('réserve la déduplication sous clé unique et verrou, puis applique seulement des deltas cumulatifs', () => {
    expect(sql).toContain('PRIMARY KEY (kind, period, token_hash)');
    expect(sql).toMatch(/ON CONFLICT \(kind, period, token_hash\) DO NOTHING/);
    expect(sql).toMatch(/SELECT \* INTO STRICT v_old[\s\S]*?FOR UPDATE/);
    expect(sql).toContain('greatest(v_old.openings, p_openings) - v_old.openings');
    expect(sql).toContain('magistra_usage_daily.openings + EXCLUDED.openings');
    expect(sql).toContain("IF p_kind = 'month' THEN");
    expect(sql).not.toMatch(/sum\s*\(\s*active\s*\)/i);
  });
  it('borne la conservation et ferme l’accès public, sans identifiants permanents dans le snapshot', () => {
    expect(sql).toContain("INTERVAL '45 days'");
    expect(sql).toContain('v_today - 399');
    expect(sql).toContain('purged_on < v_today RETURNING');
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(5);
    expect(sql.match(/FROM PUBLIC/g)).toHaveLength(4);
    const snapshotBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.magistra_usage_snapshot()'), sql.indexOf('-- Le rôle propriétaire'));
    expect(snapshotBody).toContain('LANGUAGE sql STABLE SECURITY INVOKER');
    expect(snapshotBody).not.toMatch(/token_hash|magistra_usage_dedup|\bip\b|user_agent|PERFORM|DELETE|UPDATE|INSERT|magistra_usage_purge/);
    expect(sql).not.toMatch(/SECURITY DEFINER|CREATE POLICY|GRANT.*PUBLIC/);
  });
});
