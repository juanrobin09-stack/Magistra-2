// Statistiques facultatives : aucun profil, contenu, clé API ou identifiant permanent.
// Un jeton quotidien et un jeton mensuel indépendants ; seuls des compteurs sont transmis.
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { USAGE_ENDPOINT, USAGE_MAX_AGE_DAYS, USAGE_MAX_OPENINGS, type DailyUsageReport, type MonthlyUsageReport, type UsageReport } from '../shared/usageTelemetry.js';
import { writeJsonAtomic } from './jsonFile.js';

export { USAGE_ENDPOINT } from '../shared/usageTelemetry.js';

/** Un consentement illisible n'autorise aucune collecte et ne bloque jamais le démarrage. */
export async function readUsageConsent(readPreferences: () => Promise<{ usageStatsEnabled?: boolean; usageStatsChoiceMade?: boolean }>): Promise<boolean> {
  try {
    const prefs = await readPreferences();
    return prefs.usageStatsEnabled === true && prefs.usageStatsChoiceMade === true;
  } catch {
    return false;
  }
}

const DAY_MS = 86_400_000;
const MAX_DAYS = USAGE_MAX_AGE_DAYS;
const MAX_MONTHS = 3;
const MAX_FILE_BYTES = 65_536;
const MAX_OPENINGS = USAGE_MAX_OPENINGS;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const MAX_BATCH = 8;

interface UsageResponse { status: number; body?: { cancel(): Promise<void> } | null }

export interface UsageStatsDeps {
  file: string;
  platform: string;
  isPackaged: boolean;
  smoke?: boolean;
  fetch: (url: string, init: RequestInit) => Promise<UsageResponse>;
  now?: () => Date;
  tokenFactory?: () => string;
  timeoutMs?: number;
  /** Horloge des seuls envois statistiques ; permet de tester les délais sans geler les écritures disque. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

interface Entry<T extends UsageReport> { report: T; pending: boolean; rejected?: true }
interface State {
  v: 1;
  cohort: string | null;
  /** Accusé de réception local du dénominateur de cohorte ; jamais transmis. */
  firstUseAcknowledged: boolean;
  returned7: boolean;
  returned30: boolean;
  days: Entry<DailyUsageReport>[];
  months: Entry<MonthlyUsageReport>[];
  failures: number;
  retryAt: number;
}

function emptyState(): State {
  return { v: 1, cohort: null, firstUseAcknowledged: false, returned7: false, returned30: false, days: [], months: [], failures: 0, retryAt: 0 };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function dayValue(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
function monthValue(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function dayStamp(day: string): number { return Date.parse(`${day}T00:00:00.000Z`); }
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** Validation restrictive du fichier local ; les champs inconnus ne sont jamais repris dans un envoi. */
function parseState(raw: unknown): State | null {
  const value = object(raw);
  if (!value || value.v !== 1 || (value.cohort !== null && !dayValue(value.cohort))
    || (value.firstUseAcknowledged !== undefined && typeof value.firstUseAcknowledged !== 'boolean')
    || typeof value.returned7 !== 'boolean' || typeof value.returned30 !== 'boolean'
    || (value.returned7 && !value.returned30) || !integer(value.failures, 20) || !integer(value.retryAt, 8.64e15)
    || !Array.isArray(value.days) || value.days.length > MAX_DAYS || !Array.isArray(value.months) || value.months.length > MAX_MONTHS) return null;
  const days: Entry<DailyUsageReport>[] = [];
  const months: Entry<MonthlyUsageReport>[] = [];
  const tokens = new Set<string>();
  const periods = new Set<string>();
  for (const rawEntry of [...value.days, ...value.months]) {
    const entry = object(rawEntry);
    const report = object(entry?.report);
    if (!entry || typeof entry.pending !== 'boolean' || (entry.rejected !== undefined && entry.rejected !== true)
      || !report || report.v !== 1 || typeof report.token !== 'string' || !/^[a-f0-9]{32}$/.test(report.token)
      || tokens.has(report.token)) return null;
    tokens.add(report.token);
    const rejected = entry.rejected === true ? { rejected: true as const } : {};
    if (report.kind === 'day' && value.days.includes(rawEntry)) {
      if (!dayValue(report.period) || !integer(report.openings, MAX_OPENINGS) || periods.has(report.period)) return null;
      periods.add(report.period);
      for (const flag of ['firstUse', 'returned7', 'returned30']) if (report[flag] !== undefined && report[flag] !== true) return null;
      const firstUse = report.firstUse === true;
      const returned7 = report.returned7 === true;
      const returned30 = report.returned30 === true;
      if ((firstUse && (returned7 || returned30)) || (returned7 && !returned30)) return null;
      const hasCohort = firstUse || returned7 || returned30;
      if (hasCohort) {
        if (!dayValue(report.cohort) || report.cohort !== value.cohort) return null;
        const age = (dayStamp(report.period) - dayStamp(report.cohort)) / DAY_MS;
        if ((firstUse && age !== 0) || (returned7 && (age < 1 || age > 7)) || (returned30 && (age < 1 || age > 30))) return null;
      } else if (report.cohort !== undefined) return null;
      days.push({ pending: entry.pending, ...rejected, report: {
        v: 1, kind: 'day', period: report.period, token: report.token, openings: report.openings,
        ...(firstUse ? { firstUse: true } : {}), ...(hasCohort ? { cohort: report.cohort as string } : {}),
        ...(returned7 ? { returned7: true } : {}), ...(returned30 ? { returned30: true } : {}),
      } });
    } else if (report.kind === 'month' && value.months.includes(rawEntry)) {
      if (!monthValue(report.period) || periods.has(report.period)) return null;
      periods.add(report.period);
      months.push({ pending: entry.pending, ...rejected, report: { v: 1, kind: 'month', period: report.period, token: report.token } });
    } else return null;
  }
  // Le fichier peut avoir été altéré : pas plusieurs jours avec le même évènement de cohorte.
  for (const flag of ['firstUse', 'returned7', 'returned30'] as const) {
    if (days.filter(entry => entry.report[flag]).length > 1) return null;
  }
  if (!value.cohort && (value.firstUseAcknowledged || value.returned7 || value.returned30 || days.length || months.length)) return null;
  if (days.some(entry => (entry.report.returned7 && !value.returned7) || (entry.report.returned30 && !value.returned30))) return null;
  return { v: 1, cohort: value.cohort as string | null, firstUseAcknowledged: value.firstUseAcknowledged === true,
    returned7: value.returned7, returned30: value.returned30,
    days, months, failures: value.failures, retryAt: value.retryAt };
}

export class UsageStats {
  private readonly eligible: boolean;
  private readonly now: () => Date;
  private readonly tokenFactory: () => string;
  private readonly timeoutMs: number;
  private readonly defer: NonNullable<UsageStatsDeps['schedule']>;
  private state = emptyState();
  private initialized = false;
  private enabled = false;
  private desiredEnabled = false;
  private disposed = false;
  private sessionOpened = false;
  private purgePending = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private timer: (() => void) | null = null;
  private timerAt = 0;

  constructor(private readonly deps: UsageStatsDeps) {
    this.eligible = deps.platform === 'win32' && deps.isPackaged === true && deps.smoke !== true;
    this.now = deps.now ?? (() => new Date());
    this.tokenFactory = deps.tokenFactory ?? (() => randomBytes(16).toString('hex'));
    this.timeoutMs = Math.max(100, Math.min(30_000, deps.timeoutMs ?? 10_000));
    this.defer = deps.schedule ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return () => clearTimeout(timer);
    });
  }

  /** Une erreur statistique ne doit jamais empêcher l'application de fonctionner. */
  private enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
    const run = this.queue.then(task).catch(() => undefined);
    this.queue = run;
    return run;
  }

  private clearTimer(): void {
    this.timer?.();
    this.timer = null;
    this.timerAt = 0;
  }

  private schedule(delay = 0): void {
    if (!this.enabled || this.disposed) return;
    const target = this.now().getTime() + delay;
    if (this.timer && this.timerAt <= target) return;
    this.clearTimer();
    this.timerAt = target;
    this.timer = this.defer(() => { this.timer = null; this.timerAt = 0; void this.flush(); }, Math.max(0, delay));
  }

  private prune(state: State): void {
    const today = this.now().toISOString().slice(0, 10);
    const cutoff = dayStamp(today) - MAX_DAYS * DAY_MS;
    state.days = state.days.filter(entry => dayStamp(entry.report.period) >= cutoff && entry.report.period <= today)
      .sort((a, b) => a.report.period.localeCompare(b.report.period)).slice(-MAX_DAYS);
    // Un retour ne peut pas être compté sans son participant initial : une longue
    // période hors ligne peut expirer le premier jour avant un retour plus récent.
    // Tant que le premier rapport reste envoyable, il précède les retours dans flush.
    const firstUse = state.days.find(entry => entry.report.firstUse && entry.report.period === state.cohort);
    if (!state.firstUseAcknowledged && (!firstUse || firstUse.rejected)) {
      for (const entry of state.days) {
        if (!entry.report.returned7 && !entry.report.returned30) continue;
        delete entry.report.returned7;
        delete entry.report.returned30;
        delete entry.report.cohort;
      }
    }
    const oldestMonth = new Date(cutoff).toISOString().slice(0, 7);
    state.months = state.months.filter(entry => entry.report.period >= oldestMonth && entry.report.period <= today.slice(0, 7))
      .sort((a, b) => a.report.period.localeCompare(b.report.period)).slice(-MAX_MONTHS);
  }

  private async commit(next: State): Promise<void> {
    await writeJsonAtomic(this.deps.file, next);
    this.state = next;
  }

  async init(enabled: boolean): Promise<void> {
    await this.setEnabled(enabled);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed || !this.eligible) return;
    if (enabled === true && this.enabled && this.desiredEnabled) return;
    this.desiredEnabled = enabled === true;
    const epoch = ++this.epoch;
    // Retrait immédiat du consentement, même pendant une écriture ou un appel réseau.
    if (!this.desiredEnabled) {
      this.enabled = false;
      this.purgePending = true;
      this.abort?.abort();
      this.clearTimer();
    }
    await this.enqueue(async () => {
      if (this.disposed || epoch !== this.epoch) return;
      if (!this.desiredEnabled) {
        this.state = emptyState();
        this.sessionOpened = false;
        this.initialized = true;
        await fsp.rm(this.deps.file, { force: true });
        this.purgePending = false;
        return;
      }
      // Une alternance rapide off/on ne doit ni conserver l'ancien consentement ni sa file.
      // Si l'effacement est impossible, la collecte reste suspendue jusqu'à une purge réussie.
      if (this.purgePending) {
        this.state = emptyState();
        this.sessionOpened = false;
        this.initialized = true;
        await fsp.rm(this.deps.file, { force: true });
        this.purgePending = false;
      }
      if (!this.initialized) {
        try {
          const stat = await fsp.stat(this.deps.file);
          const parsed = stat.size <= MAX_FILE_BYTES ? parseState(JSON.parse(await fsp.readFile(this.deps.file, 'utf8'))) : null;
          if (parsed) this.state = parsed;
          else await fsp.rm(this.deps.file, { force: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
          if (err instanceof SyntaxError) await fsp.rm(this.deps.file, { force: true });
        }
        this.initialized = true;
      }
      if (epoch !== this.epoch || this.disposed) return;
      this.enabled = true;
      const next = structuredClone(this.state);
      this.prune(next);
      // Aucun fichier n'est créé avant une première activité réelle.
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await this.commit(next);
      if (this.hasPending()) this.schedule(Math.max(0, this.state.retryAt - this.now().getTime()));
    });
  }

  private newToken(state: State): string {
    const used = new Set([...state.days, ...state.months].map(entry => entry.report.token));
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = this.tokenFactory();
      if (/^[a-f0-9]{32}$/.test(token) && !used.has(token)) return token;
    }
    throw new Error('Jeton statistique indisponible');
  }

  private async record(opening: boolean): Promise<void> {
    const epoch = this.epoch;
    await this.enqueue(async () => {
      if (!this.enabled || this.disposed || epoch !== this.epoch || (opening && this.sessionOpened)) return;
      const next = structuredClone(this.state);
      this.prune(next);
      const day = this.now().toISOString().slice(0, 10);
      let entry = next.days.find(item => item.report.period === day);
      let changed = false;
      if (!entry) {
        const report: DailyUsageReport = { v: 1, kind: 'day', period: day, token: this.newToken(next), openings: 0 };
        if (!next.cohort) {
          next.cohort = day;
          report.firstUse = true;
          report.cohort = day;
        } else {
          const age = (dayStamp(day) - dayStamp(next.cohort)) / DAY_MS;
          if (age >= 1 && age <= 7 && !next.returned7) {
            report.returned7 = true;
            report.returned30 = true;
            report.cohort = next.cohort;
            next.returned7 = true;
            next.returned30 = true;
          } else if (age >= 1 && age <= 30 && !next.returned30) {
            report.returned30 = true;
            report.cohort = next.cohort;
            next.returned30 = true;
          }
        }
        entry = { report, pending: true };
        next.days.push(entry);
        changed = true;
      }
      if (opening && entry.report.openings < MAX_OPENINGS) {
        entry.report.openings++;
        entry.pending = !entry.rejected;
        changed = true;
      }
      const month = day.slice(0, 7);
      if (!next.months.some(item => item.report.period === month)) {
        next.months.push({ pending: true, report: { v: 1, kind: 'month', period: month, token: this.newToken(next) } });
        changed = true;
      }
      if (changed) {
        this.prune(next);
        await this.commit(next);
        if (epoch === this.epoch && this.enabled) this.schedule(Math.max(0, next.retryAt - this.now().getTime()));
      }
      if (opening) this.sessionOpened = true;
    });
  }

  /** À appeler une fois l'interface prête, pas au simple démarrage du processus. */
  async recordOpen(): Promise<void> { await this.record(true); }
  /** Interaction réelle : pas un focus, un heartbeat ou une vérification automatique. */
  async recordActivity(): Promise<void> { await this.record(false); }

  private hasPending(): boolean {
    return [...this.state.days, ...this.state.months].some(entry => entry.pending && !entry.rejected);
  }

  private request(report: UsageReport): Promise<number> {
    const controller = new AbortController();
    this.abort = controller;
    return new Promise(resolve => {
      let finished = false;
      let cancelTimeout = () => {};
      const finish = (status: number) => {
        if (finished) return;
        finished = true;
        cancelTimeout();
        controller.signal.removeEventListener('abort', onAbort);
        if (this.abort === controller) this.abort = null;
        resolve(status);
      };
      const onAbort = () => finish(-1);
      cancelTimeout = this.defer(() => { controller.abort(); finish(-1); }, this.timeoutMs);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      void Promise.resolve().then<UsageResponse>(() => {
        if (controller.signal.aborted) return { status: -1 };
        return this.deps.fetch(USAGE_ENDPOINT, {
          method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Magistra-usage/1' }, body: JSON.stringify(report),
        });
      }).then(response => {
        void Promise.resolve().then(() => response.body?.cancel()).catch(() => undefined);
        finish(response.status);
      }, () => finish(-1));
    });
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.disposed) return;
    if (this.flushing) return this.flushing;
    this.clearTimer();
    const task = this.runFlush().catch(() => { if (this.enabled) this.schedule(BASE_RETRY_MS); });
    this.flushing = task;
    try { await task; } finally { if (this.flushing === task) this.flushing = null; }
  }

  private async runFlush(): Promise<void> {
    const epoch = this.epoch;
    await this.queue;
    if (!this.enabled || this.disposed || epoch !== this.epoch) return;
    if (this.state.retryAt > this.now().getTime()) {
      this.schedule(this.state.retryAt - this.now().getTime());
      return;
    }
    const prepared = await this.enqueue(async () => {
      const next = structuredClone(this.state);
      this.prune(next);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await this.commit(next);
      return true;
    });
    if (!prepared) { this.schedule(BASE_RETRY_MS); return; }
    for (let count = 0; count < MAX_BATCH; count++) {
      if (!this.enabled || this.disposed || epoch !== this.epoch) return;
      const entry = [...this.state.days, ...this.state.months].find(item => item.pending && !item.rejected);
      if (!entry) return;
      const report = structuredClone(entry.report);
      const status = await this.request(report);
      if (!this.enabled || this.disposed || epoch !== this.epoch) return;
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if ((status >= 200 && status < 300) || permanent) {
        const saved = await this.enqueue(async () => {
          if (!this.enabled || this.disposed || epoch !== this.epoch) return false;
          const next = structuredClone(this.state);
          if (!permanent && report.kind === 'day' && report.firstUse && report.cohort === next.cohort) {
            next.firstUseAcknowledged = true;
          }
          const current = [...next.days, ...next.months].find(item => item.report.token === report.token);
          if (current && JSON.stringify(current.report) === JSON.stringify(report)) {
            current.pending = false;
            if (permanent) current.rejected = true;
          }
          next.failures = 0;
          next.retryAt = 0;
          await this.commit(next);
          return true;
        });
        if (!saved) { this.schedule(BASE_RETRY_MS); return; }
      } else {
        await this.enqueue(async () => {
          if (!this.enabled || this.disposed || epoch !== this.epoch) return;
          const next = structuredClone(this.state);
          next.failures = Math.min(20, next.failures + 1);
          next.retryAt = this.now().getTime() + Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (next.failures - 1));
          await this.commit(next);
        });
        this.schedule(Math.max(BASE_RETRY_MS, this.state.retryAt - this.now().getTime()));
        return;
      }
    }
    if (this.hasPending()) this.schedule();
  }

  /** L'arrêt ne force pas un dernier envoi et ne ralentit pas la fermeture. */
  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.epoch++;
    this.clearTimer();
    this.abort?.abort();
  }
}
