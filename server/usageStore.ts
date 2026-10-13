// Statistiques facultatives Windows : seules des empreintes temporaires par période atteignent la base.
// Le schéma se déploie séparément (usage-schema.sql), jamais depuis une requête HTTP.
import { createHmac } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { parseUsageReport, usageDate, type UsageReport, type UsageSnapshot } from '../shared/usageTelemetry.js';

export interface UsageStore {
  record(report: UsageReport): Promise<void>;
  snapshot(): Promise<UsageSnapshot>;
  /** Maintenance explicite, réservée au cron privé ; la lecture des statistiques ne modifie rien. */
  purge?(): Promise<void>;
}

const RECORD_SQL = 'SELECT public.magistra_record_usage($1, $2, $3, $4, $5, $6::date, $7, $8)';
const SNAPSHOT_SQL = 'SELECT public.magistra_usage_snapshot() AS snapshot';
const PURGE_SQL = 'SELECT public.magistra_usage_purge()';
const storageError = () => new Error('Usage storage unavailable');

function counter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw storageError();
  return value;
}

function aggregateRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw storageError();
  return value as Record<string, unknown>[];
}

function period(value: unknown, monthly = false): string {
  if (typeof value !== 'string' || (monthly && !/^\d{4}-\d{2}$/.test(value)) || usageDate(monthly ? `${value}-01` : value) === null) throw storageError();
  return value;
}

/** Liste blanche de sortie : même une réponse SQL enrichie ne peut divulguer de jeton ou d'empreinte. */
function snapshotOf(raw: unknown): UsageSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw storageError();
  const data = raw as Record<string, unknown>;
  return {
    days: aggregateRows(data.days).map(row => ({ period: period(row.period), active: counter(row.active), openings: counter(row.openings) })),
    months: aggregateRows(data.months).map(row => ({ period: period(row.period, true), active: counter(row.active) })),
    cohorts: aggregateRows(data.cohorts).map(row => ({ period: period(row.period), firstUses: counter(row.firstUses), returned7: counter(row.returned7), returned30: counter(row.returned30) })),
  };
}

/** Configuration serveur explicite ; import du pilote et création du client seulement au premier appel. */
export function createNeonUsageStore(databaseUrl: string, hmacSecret: string): UsageStore {
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2
      || typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error();
  } catch {
    throw new Error('Usage storage misconfigured');
  }
  let client: Promise<NeonQueryFunction<false, false>> | undefined;
  const load = () => {
    client ??= import('@neondatabase/serverless').then(({ neon }) => neon(databaseUrl)).catch(() => {
      client = undefined;
      throw storageError();
    });
    return client;
  };
  const query = async (sql: string, values: unknown[] = []) => {
    try {
      return await (await load()).query(sql, values, { fetchOptions: { signal: AbortSignal.timeout(10_000) } });
    } catch {
      // Les erreurs du pilote peuvent contenir l'URL de connexion ou des paramètres ; aucune cause brute exposée.
      throw storageError();
    }
  };

  return {
    async record(report) {
      const valid = parseUsageReport(report);
      if (!valid) throw new Error('Invalid usage report');
      const tokenHash = createHmac('sha256', hmacSecret).update(`${valid.kind}|${valid.period}|${valid.token}`).digest('hex');
      const day = valid.kind === 'day' ? valid : undefined;
      // Une seule instruction : déduplication, deltas, agrégats et purge sont atomiques dans PostgreSQL.
      await query(RECORD_SQL, [valid.kind, valid.period, tokenHash, day?.openings ?? 0,
        day?.firstUse === true, day?.cohort ?? null, day?.returned7 === true, day?.returned30 === true]);
    },
    async snapshot() {
      const rows = await query(SNAPSHOT_SQL);
      return snapshotOf(rows[0]?.snapshot);
    },
    async purge() {
      await query(PURGE_SQL);
    },
  };
}
