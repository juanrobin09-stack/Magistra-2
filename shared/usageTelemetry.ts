import { SITE_ORIGIN } from './site.js';

// Compteurs facultatifs de l'application Windows. Aucune donnée de travail, aucun identifiant permanent.
export const USAGE_ENDPOINT = `${SITE_ORIGIN}/api/usage`;
export const USAGE_MAX_AGE_DAYS = 35;
export const USAGE_RETENTION_DAYS = 400;
export const USAGE_MAX_OPENINGS = 10_000;

export interface DailyUsageReport {
  v: 1;
  kind: 'day';
  period: string;
  token: string;
  openings: number;
  firstUse?: true;
  cohort?: string;
  returned7?: true;
  returned30?: true;
}
export interface MonthlyUsageReport { v: 1; kind: 'month'; period: string; token: string }
export type UsageReport = DailyUsageReport | MonthlyUsageReport;
export interface UsageSnapshot {
  days: Array<{ period: string; active: number; openings: number }>;
  months: Array<{ period: string; active: number }>;
  cohorts: Array<{ period: string; firstUses: number; returned7: number; returned30: number }>;
}

const DAY_MS = 86_400_000;
export function usageDay(date: Date): string { return date.toISOString().slice(0, 10); }
export function usageMonth(date: Date): string { return date.toISOString().slice(0, 7); }
export function usageDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(ms) && usageDay(new Date(ms)) === value ? ms : null;
}

/** Liste blanche fermée : même un champ facultatif inattendu (nom, document, IP…) fait refuser le rapport. */
export function parseUsageReport(raw: unknown, now: Date = new Date()): UsageReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || (r.kind !== 'day' && r.kind !== 'month') || typeof r.token !== 'string' || !/^[a-f0-9]{32}$/.test(r.token)) return null;
  const today = usageDate(usageDay(now))!;
  if (r.kind === 'month') {
    if (Object.keys(r).some(k => !['v', 'kind', 'period', 'token'].includes(k))) return null;
    if (typeof r.period !== 'string' || !/^\d{4}-\d{2}$/.test(r.period)) return null;
    const start = usageDate(r.period + '-01');
    if (start === null || start > today) return null;
    const date = new Date(start);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
    if (today - end > USAGE_MAX_AGE_DAYS * DAY_MS) return null;
    return { v: 1, kind: 'month', period: r.period, token: r.token };
  }
  if (Object.keys(r).some(k => !['v', 'kind', 'period', 'token', 'openings', 'firstUse', 'cohort', 'returned7', 'returned30'].includes(k))) return null;
  const day = usageDate(r.period);
  if (day === null || day > today || today - day > USAGE_MAX_AGE_DAYS * DAY_MS) return null;
  if (!Number.isInteger(r.openings) || (r.openings as number) < 0 || (r.openings as number) > USAGE_MAX_OPENINGS) return null;
  for (const key of ['firstUse', 'returned7', 'returned30']) if (r[key] !== undefined && r[key] !== true) return null;
  const flagged = r.firstUse === true || r.returned7 === true || r.returned30 === true;
  if (flagged) {
    const cohort = usageDate(r.cohort);
    if (cohort === null || cohort > day) return null;
    const delta = (day - cohort) / DAY_MS;
    if (r.firstUse && (delta !== 0 || r.returned7 || r.returned30)) return null;
    if (r.returned7 && (delta < 1 || delta > 7 || !r.returned30)) return null;
    if (r.returned30 && (delta < 1 || delta > 30)) return null;
  } else if (r.cohort !== undefined) return null;
  return { v: 1, kind: 'day', period: r.period as string, token: r.token, openings: r.openings as number,
    ...(r.firstUse ? { firstUse: true } : {}), ...(flagged ? { cohort: r.cohort as string } : {}),
    ...(r.returned7 ? { returned7: true } : {}), ...(r.returned30 ? { returned30: true } : {}) };
}
