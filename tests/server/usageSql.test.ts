// Vrai PostgreSQL WASM local, sans base distante ni connexion réseau.
// PGlite ne possède qu'une connexion : Promise.all vérifie les transactions mises en file,
// pas les conflits de verrous entre plusieurs connexions Neon (à vérifier aussi sur staging).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSnapshot } from '../../shared/usageTelemetry.js';
import { createNeonUsageStore } from '../../server/usageStore.js';

let db: PGlite;
let today: string;
let month: string;
let previousMonth: string;
const schema = readFileSync(new URL('../../server/usage-schema.sql', import.meta.url), 'utf8');
const RECORD = 'SELECT public.magistra_record_usage($1,$2,$3,$4,$5,$6::date,$7,$8)';
const TABLES = ['magistra_usage_daily', 'magistra_usage_monthly', 'magistra_usage_cohorts', 'magistra_usage_dedup', 'magistra_usage_maintenance'];

vi.mock('@neondatabase/serverless', () => ({
  neon: () => ({ query: async (text: string, values: unknown[]) => (await db.query(text, values)).rows }),
}));

function hash(n: number): string { return n.toString(16).padStart(64, '0'); }
function dayAgo(n: number): string {
  return new Date(Date.parse(today + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
}
interface DayFlags { first?: boolean; cohort?: string; r7?: boolean; r30?: boolean }
async function day(tokenHash: string, openings = 1, period = today, flags: DayFlags = {}) {
  return db.query(RECORD, ['day', period, tokenHash, openings, flags.first ?? false, flags.cohort ?? null, flags.r7 ?? false, flags.r30 ?? false]);
}
async function monthly(tokenHash: string, period = month) {
  return db.query(RECORD, ['month', period, tokenHash, 0, false, null, false, false]);
}
async function snapshot(): Promise<UsageSnapshot> {
  const result = await db.query<{ snapshot: UsageSnapshot }>('SELECT public.magistra_usage_snapshot() AS snapshot');
  return result.rows[0].snapshot;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(schema);
  const date = await db.query<{ today: string; month: string; previous: string }>(`SELECT
    to_char(current_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS today,
    to_char(current_timestamp AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
    to_char((current_timestamp AT TIME ZONE 'UTC') - interval '1 month', 'YYYY-MM') AS previous`);
  ({ today, month, previous: previousMonth } = date.rows[0]);
  await db.exec('CREATE ROLE usage_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO usage_reader;');
}, 60_000);
beforeEach(async () => {
  await db.exec(`TRUNCATE public.magistra_usage_daily, public.magistra_usage_monthly,
    public.magistra_usage_cohorts, public.magistra_usage_dedup;
    UPDATE public.magistra_usage_maintenance SET purged_on = DATE '1970-01-01';`);
});
afterAll(async () => { await db?.close(); });

describe('Migration et comptage usage dans le moteur PostgreSQL réel', () => {
  it('réexécute la migration sans perdre les données ni ouvrir les permissions', async () => {
    await day(hash(1), 3);
    // Migration d'une ancienne définition PL/pgSQL VOLATILE vers la nouvelle lecture SQL STABLE.
    await db.exec(`CREATE OR REPLACE FUNCTION public.magistra_usage_snapshot()
      RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
      BEGIN PERFORM public.magistra_usage_purge(); RETURN '{}'::jsonb; END; $$;`);
    await db.exec(schema);
    expect(await snapshot()).toEqual({ days: [{ period: today, active: 1, openings: 3 }], months: [], cohorts: [] });
    const functions = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_proc
      WHERE proname IN ('magistra_usage_purge','magistra_record_usage','magistra_usage_snapshot')`);
    expect(functions.rows[0].count).toBe(3);
  });

  it('traite 20 rapports simultanés de la même empreinte : DAU1 et seulement le maximum des ouvertures', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, n) => day(hash(1), (n * 7) % 20)));
    expect((await snapshot()).days).toEqual([{ period: today, active: 1, openings: 19 }]);
    await Promise.all([day(hash(2), 2), day(hash(3), 3), day(hash(1), 8), day(hash(1), 19)]);
    expect((await snapshot()).days).toEqual([{ period: today, active: 3, openings: 24 }]);
    const dedup = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup');
    expect(dedup.rows[0].count).toBe(3);
  });

  it('compte les MAU directement, sans additionner les utilisateurs des différents jours', async () => {
    await Promise.all([day(hash(1)), day(hash(2)), day(hash(1), 1, dayAgo(1)), day(hash(2), 1, dayAgo(1))]);
    await Promise.all([monthly(hash(10)), monthly(hash(20)), monthly(hash(10)), monthly(hash(20))]);
    const stats = await snapshot();
    expect(stats.days.reduce((total, row) => total + row.active, 0)).toBe(4);
    expect(stats.months).toEqual([{ period: month, active: 2 }]);
  });

  it('déduplique séparément les mois et les jours au changement de mois', async () => {
    await monthly(hash(1));
    await monthly(hash(1), previousMonth);
    await monthly(hash(1));
    await day(hash(1));
    const stats = await snapshot();
    expect(stats.months).toEqual([{ period: previousMonth, active: 1 }, { period: month, active: 1 }]);
    expect(stats.days).toEqual([{ period: today, active: 1, openings: 1 }]);
  });

  it('fusionne les flags de cohorte et réessais désordonnés sans doubler les premiers usages ni les retours', async () => {
    const cohort = dayAgo(1);
    await day(hash(1), 0, cohort, { first: true, cohort });
    await day(hash(1), 1, cohort, { first: true, cohort });
    await day(hash(2), 0, cohort, { first: true, cohort });
    await Promise.all(Array.from({ length: 8 }, () => day(hash(10), 2, today, { cohort, r7: true, r30: true })));
    await day(hash(20), 3, today, { cohort, r30: true });
    await day(hash(20), 1, today, { cohort, r7: true, r30: true });
    await day(hash(20), 0); // Ancien snapshot sans flag ni cohorte : rien n'est effacé.
    const stats = await snapshot();
    expect(stats.cohorts).toEqual([{ period: cohort, firstUses: 2, returned7: 2, returned30: 2 }]);
    expect(stats.days).toEqual([{ period: cohort, active: 2, openings: 1 }, { period: today, active: 2, openings: 5 }]);
  });

  it('annule intégralement un rapport qui tente de changer la cohorte d’une même empreinte', async () => {
    await day(hash(1), 1, today, { cohort: dayAgo(2), r7: true, r30: true });
    const before = await snapshot();
    await expect(day(hash(1), 100, today, { cohort: dayAgo(3), r7: true, r30: true })).rejects.toMatchObject({ code: '22023' });
    expect(await snapshot()).toEqual(before);
    const dedup = await db.query<{ openings: number }>('SELECT openings FROM public.magistra_usage_dedup');
    expect(dedup.rows[0].openings).toBe(1);
  });

  it.each([
    ['hash invalide', () => ['day', today, 'identifier', 1, false, null, false, false]],
    ['kind invalide', () => ['week', today, hash(1), 1, false, null, false, false]],
    ['ouvertures négatives', () => ['day', today, hash(1), -1, false, null, false, false]],
    ['ouvertures excessives', () => ['day', today, hash(1), 10001, false, null, false, false]],
    ['jour futur', () => ['day', dayAgo(-1), hash(1), 1, false, null, false, false]],
    ['jour expiré', () => ['day', dayAgo(36), hash(1), 1, false, null, false, false]],
    ['cohorte absente', () => ['day', today, hash(1), 1, true, null, false, false]],
    ['premier usage incohérent', () => ['day', today, hash(1), 1, true, dayAgo(1), false, false]],
    ['retour7 sans retour30', () => ['day', today, hash(1), 1, false, dayAgo(1), true, false]],
    ['retour7 au jour8', () => ['day', today, hash(1), 1, false, dayAgo(8), true, true]],
    ['retour30 au jour31', () => ['day', today, hash(1), 1, false, dayAgo(31), false, true]],
    ['cohorte sans flag', () => ['day', today, hash(1), 1, false, dayAgo(1), false, false]],
    ['mois enrichi', () => ['month', month, hash(1), 1, false, null, false, false]],
  ])('refuse %s directement en SQL, sans ligne partielle', async (_label, values) => {
    await expect(db.query(RECORD, values())).rejects.toMatchObject({ code: '22023' });
    expect(await snapshot()).toEqual({ days: [], months: [], cohorts: [] });
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup')).rows[0].count).toBe(0);
  });

  it('accepte les bornes à 35 jours, retour7 au jour7 et retour30 au jour30', async () => {
    await day(hash(1), 1, dayAgo(35));
    await day(hash(2), 0, today, { cohort: dayAgo(7), r7: true, r30: true });
    await day(hash(3), 0, today, { cohort: dayAgo(30), r30: true });
    const stats = await snapshot();
    expect(stats.days).toHaveLength(2);
    expect(stats.cohorts).toEqual([{ period: dayAgo(30), firstUses: 0, returned7: 0, returned30: 1 },
      { period: dayAgo(7), firstUses: 0, returned7: 1, returned30: 1 }]);
  });

  it('fixe la TTL à la fin de période plus 45 jours, sans la prolonger aux réessais', async () => {
    await day(hash(1), 1, dayAgo(35));
    await monthly(hash(2));
    const expiry = await db.query<{ kind: string; correct: boolean }>(`SELECT kind, expires_at =
      CASE WHEN kind = 'day' THEN ((period + 1)::timestamp AT TIME ZONE 'UTC') + interval '45 days'
      ELSE ((period + interval '1 month') AT TIME ZONE 'UTC') + interval '45 days' END AS correct
      FROM public.magistra_usage_dedup ORDER BY kind`);
    expect(expiry.rows).toEqual([{ kind: 'day', correct: true }, { kind: 'month', correct: true }]);
    const before = await db.query('SELECT expires_at FROM public.magistra_usage_dedup ORDER BY kind');
    await day(hash(1), 8, dayAgo(35));
    await monthly(hash(2));
    expect((await db.query('SELECT expires_at FROM public.magistra_usage_dedup ORDER BY kind')).rows).toEqual(before.rows);
  });

  it('lit sans modifier la base puis purge explicitement les expirations une fois par jour', async () => {
    await db.query(`INSERT INTO public.magistra_usage_dedup (kind,period,token_hash,expires_at)
      VALUES ('day',$1::date,$2,current_timestamp-interval '1 day'), ('day',$3::date,$4,current_timestamp+interval '1 day')`,
    [dayAgo(46), hash(1), today, hash(2)]);
    await db.query('INSERT INTO public.magistra_usage_daily VALUES ($1::date,1,1),($2::date,2,2)', [dayAgo(400), dayAgo(399)]);
    await db.query('INSERT INTO public.magistra_usage_cohorts VALUES ($1::date,1,0,0),($2::date,2,0,0)', [dayAgo(400), dayAgo(399)]);
    await db.exec(`INSERT INTO public.magistra_usage_monthly VALUES
      ((date_trunc('month',current_timestamp AT TIME ZONE 'UTC')-interval '14 months')::date,1),
      (date_trunc('month',current_timestamp AT TIME ZONE 'UTC')::date,2);`);
    expect(await snapshot()).toEqual({ days: [{ period: dayAgo(399), active: 2, openings: 2 }],
      months: [{ period: month, active: 2 }], cohorts: [{ period: dayAgo(399), firstUses: 2, returned7: 0, returned30: 0 }] });
    const maintenance = await db.query<{ unchanged: boolean }>("SELECT purged_on = DATE '1970-01-01' AS unchanged FROM public.magistra_usage_maintenance");
    expect(maintenance.rows[0].unchanged).toBe(true);
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup')).rows[0].count).toBe(2);
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_daily')).rows[0].count).toBe(2);
    await db.query('SELECT public.magistra_usage_purge()');
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup')).rows[0].count).toBe(1);
    await db.query(`INSERT INTO public.magistra_usage_dedup (kind,period,token_hash,expires_at)
      VALUES ('day',$1::date,$2,current_timestamp-interval '1 day')`, [dayAgo(46), hash(3)]);
    await db.query('SELECT public.magistra_usage_purge()');
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup')).rows[0].count).toBe(2);
    await db.exec("UPDATE public.magistra_usage_maintenance SET purged_on = DATE '1970-01-01'");
    await db.query('SELECT public.magistra_usage_purge()');
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.magistra_usage_dedup')).rows[0].count).toBe(1);
  });

  it('déclare la fonction stable et fonctionne dans une transaction strictement READ ONLY', async () => {
    const metadata = await db.query<{ volatility: string; language: string }>(`SELECT p.provolatile AS volatility, l.lanname AS language
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.proname = 'magistra_usage_snapshot'`);
    expect(metadata.rows).toEqual([{ volatility: 's', language: 'sql' }]);
    await db.exec('BEGIN READ ONLY');
    try {
      expect(await snapshot()).toEqual({ days: [], months: [], cohorts: [] });
    } finally { await db.exec('ROLLBACK'); }
    expect((await db.query<{ unchanged: boolean }>("SELECT purged_on = DATE '1970-01-01' AS unchanged FROM public.magistra_usage_maintenance")).rows[0].unchanged).toBe(true);
  });

  it('refuse les tables et fonctions à un rôle qui ne possède que les droits PUBLIC', async () => {
    await day(hash(1));
    await db.exec('SET ROLE usage_reader');
    try {
      for (const table of TABLES) await expect(db.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('SELECT public.magistra_usage_snapshot()')).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('SELECT public.magistra_usage_purge()')).rejects.toMatchObject({ code: '42501' });
      await expect(day(hash(2))).rejects.toMatchObject({ code: '42501' });
    } finally { await db.exec('RESET ROLE'); }
  });

  it('RLS masque toutes les lignes même si un rôle tiers reçoit par erreur un droit SELECT', async () => {
    await day(hash(1));
    await db.exec('GRANT SELECT, INSERT ON public.magistra_usage_daily TO usage_reader; SET ROLE usage_reader;');
    try {
      expect((await db.query('SELECT * FROM public.magistra_usage_daily')).rows).toEqual([]);
      await expect(db.query('INSERT INTO public.magistra_usage_daily VALUES ($1::date,1,1)', [dayAgo(1)])).rejects.toMatchObject({ code: '42501' });
    } finally { await db.exec('RESET ROLE; REVOKE SELECT, INSERT ON public.magistra_usage_daily FROM usage_reader;'); }
  });

  it('branche aussi le vrai store TypeScript au moteur SQL sans envoyer les jetons bruts', async () => {
    const store = createNeonUsageStore('postgresql://test:test@local.example.test/usage', 'test-hmac-secret-with-at-least-32-bytes');
    const token = '1234567890abcdef1234567890abcdef';
    await Promise.all(Array.from({ length: 20 }, (_, openings) => store.record({ v: 1, kind: 'day', period: today, token, openings })));
    expect((await store.snapshot()).days).toEqual([{ period: today, active: 1, openings: 19 }]);
    const hashes = await db.query<{ token_hash: string }>('SELECT token_hash FROM public.magistra_usage_dedup');
    expect(hashes.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes.rows[0].token_hash).not.toContain(token);
  });
});
