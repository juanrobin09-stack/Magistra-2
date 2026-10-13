import { existsSync, mkdtempSync, promises as fsp, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readUsageConsent, UsageStats, USAGE_ENDPOINT, type UsageStatsDeps } from '../../electron/usageStats.js';
import { parseUsageReport, type DailyUsageReport, type MonthlyUsageReport, type UsageReport } from '../../shared/usageTelemetry.js';

let dir: string;
let file: string;
let current: Date;
let sequence: number;
let instances: UsageStats[];
let fetchMock: ReturnType<typeof vi.fn<UsageStatsDeps['fetch']>>;
let timerTime: number;
let timerSequence: number;
let scheduled: Map<number, { at: number; callback: () => void }>;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-usage-'));
  file = path.join(dir, 'usage-statistics.json');
  current = new Date('2026-01-01T10:00:00.000Z');
  sequence = 0;
  instances = [];
  fetchMock = vi.fn(async () => ({ status: 204 }));
  timerTime = 0;
  timerSequence = 0;
  scheduled = new Map();
  // Seuls les délais du transport sont pilotés : les retries d'écriture Windows
  // gardent leurs vrais timers, y compris quand rename rencontre un verrou temporaire.
});

afterEach(() => {
  for (const instance of instances) instance.dispose();
  vi.restoreAllMocks();
  // Vérifier le dossier créé par le test avant tout effacement récursif.
  if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('magistra-usage-')) throw new Error('Dossier de test inattendu');
  rmSync(dir, { recursive: true, force: true });
});

function create(overrides: Partial<UsageStatsDeps> = {}): UsageStats {
  const stats = new UsageStats({
    file, platform: 'win32', isPackaged: true, fetch: fetchMock,
    now: () => new Date(current), tokenFactory: () => (++sequence).toString(16).padStart(32, '0'),
    schedule: (callback, delayMs) => {
      const id = ++timerSequence;
      scheduled.set(id, { at: timerTime + delayMs, callback });
      return () => { scheduled.delete(id); };
    },
    ...overrides,
  });
  instances.push(stats);
  return stats;
}

function disk() {
  return JSON.parse(readFileSync(file, 'utf8')) as {
    cohort: string | null; firstUseAcknowledged: boolean; returned7: boolean; returned30: boolean; failures: number; retryAt: number;
    days: { report: DailyUsageReport; pending: boolean; rejected?: true }[];
    months: { report: MonthlyUsageReport; pending: boolean; rejected?: true }[];
  };
}
function reports(): UsageReport[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string) as UsageReport);
}
function advanceDays(days: number): void { current = new Date(current.getTime() + days * 86_400_000); }
async function waitForRequest(count = 1): Promise<void> {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(count), { timeout: 500, interval: 1 });
}
async function advanceTransportTimers(ms: number): Promise<void> {
  const until = timerTime + ms;
  for (;;) {
    const due = [...scheduled].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
    if (!due) break;
    const [id, timer] = due;
    timerTime = timer.at;
    scheduled.delete(id);
    timer.callback();
    await Promise.resolve();
  }
  timerTime = until;
}

describe('consentement et exclusion des exécutions de test', () => {
  it.each([
    [{}, false],
    [{ usageStatsEnabled: true }, false],
    [{ usageStatsChoiceMade: true }, false],
    [{ usageStatsEnabled: false, usageStatsChoiceMade: true }, false],
    [{ usageStatsEnabled: true, usageStatsChoiceMade: false }, false],
    [{ usageStatsEnabled: true, usageStatsChoiceMade: true }, true],
  ])('lecture du consentement : %j autorise la collecte=%s', async (prefs, expected) => {
    const reader = vi.fn(async () => prefs);
    expect(await readUsageConsent(reader)).toBe(expected);
    expect(reader).toHaveBeenCalledOnce();
  });

  it.each(['EACCES', 'EBUSY'])('une erreur %s de lecture des préférences désactive sans bloquer le démarrage', async code => {
    const reader = vi.fn(async () => { throw Object.assign(new Error('lecture indisponible'), { code }); });
    const consent = await readUsageConsent(reader);
    expect(consent).toBe(false);
    const stats = create();
    await stats.init(consent);
    await stats.recordOpen();
    await stats.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });

  it('reste désactivé par défaut, sans fichier, jeton ou requête', async () => {
    const tokenFactory = vi.fn(() => 'a'.repeat(32));
    const stats = create({ tokenFactory });
    await stats.recordOpen();
    await stats.recordActivity();
    await stats.flush();
    await stats.init(false);
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    { platform: 'darwin', isPackaged: true },
    { platform: 'linux', isPackaged: true },
    { platform: 'win32', isPackaged: false },
    { platform: 'win32', isPackaged: true, smoke: true },
  ])('ne collecte rien dans un contexte exclu : %j', async options => {
    const stats = create(options);
    await stats.init(true);
    await stats.recordOpen();
    await stats.recordActivity();
    await stats.flush();
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('init avec consentement ne compte pas un lancement non qualifié', async () => {
    const stats = create();
    await stats.init(true);
    await stats.init(true);
    await stats.flush();
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un appel recordOpen désactivé ne consomme pas l’ouverture après opt-in', async () => {
    const stats = create();
    await stats.init(false);
    await stats.recordOpen();
    await stats.setEnabled(true);
    await stats.recordOpen();
    expect(disk().days[0].report).toMatchObject({ openings: 1, firstUse: true });
  });

  it('une alternance off/on rapprochée purge l’ancienne période mesurée', async () => {
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    const oldToken = disk().days[0].report.token;
    advanceDays(1);
    await Promise.all([stats.setEnabled(false), stats.setEnabled(true)]);
    await stats.recordOpen();
    expect(disk().days).toHaveLength(1);
    expect(disk().days[0].report).toMatchObject({ period: '2026-01-02', openings: 1, firstUse: true, cohort: '2026-01-02' });
    expect(disk().days[0].report.token).not.toBe(oldToken);
    expect(disk().days[0].report.returned7).toBeUndefined();
  });

  it('une purge momentanément bloquée ne réutilise pas l’ancien consentement', async () => {
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    const oldToken = disk().days[0].report.token;
    vi.spyOn(fsp, 'rm').mockRejectedValueOnce(Object.assign(new Error('verrou temporaire'), { code: 'EACCES' }));
    await stats.setEnabled(false);
    await stats.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    advanceDays(2);
    await stats.setEnabled(true);
    await stats.recordOpen();
    expect(disk().days).toHaveLength(1);
    expect(disk().days[0].report).toMatchObject({ firstUse: true, cohort: '2026-01-03' });
    expect(disk().days[0].report.token).not.toBe(oldToken);
  });

  it('une désactivation purge le backlog, les jetons, la cohorte et les retours', async () => {
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    const previousToken = disk().days[0].report.token;
    await stats.setEnabled(false);
    await stats.recordActivity();
    await stats.flush();
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    advanceDays(12);
    await stats.setEnabled(true);
    await stats.recordOpen();
    const next = disk();
    expect(next.days).toHaveLength(1);
    expect(next.days[0].report).toMatchObject({ firstUse: true, cohort: '2026-01-13', openings: 1 });
    expect(next.days[0].report.token).not.toBe(previousToken);
    expect(next.returned7).toBe(false);
    expect(next.returned30).toBe(false);
  });
});

describe('ouvertures, activité réelle, jours et mois UTC', () => {
  it('écrit avant envoi deux rapports séparés sans profil, version ou identifiant lié', async () => {
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    expect(fetchMock).not.toHaveBeenCalled();
    const saved = disk();
    expect(saved.days[0].pending).toBe(true);
    expect(saved.months[0].pending).toBe(true);
    await stats.flush();
    const sent = reports();
    expect(sent).toEqual([
      { v: 1, kind: 'day', period: '2026-01-01', token: saved.days[0].report.token, openings: 1, firstUse: true, cohort: '2026-01-01' },
      { v: 1, kind: 'month', period: '2026-01', token: saved.months[0].report.token },
    ]);
    expect(sent[0].token).not.toBe(sent[1].token);
    for (const report of sent) expect(parseUsageReport(report, current)).toEqual(report);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(USAGE_ENDPOINT);
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Magistra-usage/1' } });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.body).not.toMatch(/profile|document|version|email|installationId|userData|monthlyToken|dailyToken/i);
    }
    expect(disk().days[0].pending).toBe(false);
    expect(disk().months[0].pending).toBe(false);
  });

  it('ne compte qu’une ouverture par session, même pour des appels concurrents', async () => {
    const stats = create();
    await stats.init(true);
    await Promise.all([stats.recordOpen(), stats.recordOpen(), stats.recordActivity(), stats.recordOpen()]);
    expect(disk().days[0].report.openings).toBe(1);
    await stats.flush();
    await stats.recordOpen();
    await stats.recordActivity();
    await stats.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un verrou Windows transitoire ne bloque pas la file d’écritures des appels concurrents', async () => {
    const stats = create();
    await stats.init(true);
    const rename = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(Object.assign(new Error('fichier momentanément verrouillé'), { code: 'EBUSY' }));
    await Promise.all([stats.recordOpen(), stats.recordOpen(), stats.recordActivity()]);
    expect(rename).toHaveBeenCalledTimes(2);
    expect(disk().days[0].report.openings).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await stats.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un redémarrage conserve les jetons mais augmente le compteur cumulatif du jour', async () => {
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    const token = disk().days[0].report.token;
    first.dispose();
    const second = create();
    await second.init(true);
    await second.recordOpen();
    await second.flush();
    expect(reports()).toHaveLength(3);
    expect(reports()[2]).toMatchObject({ token, kind: 'day', openings: 2, firstUse: true });
    expect(reports().filter(report => report.kind === 'month')).toHaveLength(1);
  });

  it('une application restée ouverte produit un jour actif avec zéro nouvelle ouverture', async () => {
    current = new Date('2026-01-01T23:59:59.000Z');
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    current = new Date('2026-01-02T00:00:01.000Z');
    await stats.recordActivity();
    await stats.recordOpen();
    await stats.flush();
    expect(reports()[2]).toMatchObject({ kind: 'day', period: '2026-01-02', openings: 0, cohort: '2026-01-01', returned7: true, returned30: true });
    expect(reports()[2].token).not.toBe(reports()[0].token);
    expect(reports().filter(report => report.kind === 'month')).toHaveLength(1);
  });

  it('une première interaction sans ouverture qualifiée compte un participant actif', async () => {
    const stats = create();
    await stats.init(true);
    await stats.recordActivity();
    await stats.recordActivity();
    await stats.flush();
    expect(reports()[0]).toMatchObject({ kind: 'day', openings: 0, firstUse: true, cohort: '2026-01-01' });
    expect(reports()).toHaveLength(2);
  });

  it('fait tourner le jeton mensuel au changement de mois UTC sans le lier aux jours', async () => {
    current = new Date('2026-01-31T23:59:59.000Z');
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    current = new Date('2026-02-01T00:00:01.000Z');
    await stats.recordActivity();
    await stats.flush();
    const sent = reports();
    expect(sent.map(report => [report.kind, report.period])).toEqual([
      ['day', '2026-01-31'], ['month', '2026-01'], ['day', '2026-02-01'], ['month', '2026-02'],
    ]);
    expect(new Set(sent.map(report => report.token)).size).toBe(4);
  });
});

describe('cohortes et retours calculés uniquement localement', () => {
  it.each([[35, true], [36, false]])('reconnexion J%d : le premier jour reste envoyable=%s', async (reconnectDay, firstDaySendable) => {
    const first = create();
    await first.init(true);
    await first.recordActivity();
    advanceDays(7);
    await first.recordActivity();
    first.dispose();
    advanceDays(reconnectDay - 7);
    const reconnect = create();
    await reconnect.init(true);
    await reconnect.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(daily.some(report => report.firstUse)).toBe(firstDaySendable);
    expect(daily.find(report => report.period === '2026-01-08')?.returned7 === true).toBe(firstDaySendable);
    expect(disk().firstUseAcknowledged).toBe(firstDaySendable);
    for (const report of reports()) expect(parseUsageReport(report, current)).toEqual(report);
  });

  it('à J37, un premier jour jamais acquitté ne laisse pas de retour orphelin à J7', async () => {
    fetchMock.mockResolvedValueOnce({ status: 503 });
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    expect(disk().firstUseAcknowledged).toBe(false);
    advanceDays(7);
    await first.recordActivity();
    const returningToken = disk().days[1].report.token;
    expect(disk().days[1].report).toMatchObject({ returned7: true, returned30: true, cohort: '2026-01-01' });
    first.dispose();
    advanceDays(30);
    fetchMock.mockClear();
    const reconnect = create();
    await reconnect.init(true);
    await reconnect.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(daily).toEqual([{ v: 1, kind: 'day', period: '2026-01-08', token: returningToken, openings: 0 }]);
    expect(disk().firstUseAcknowledged).toBe(false);
    for (const report of reports()) {
      expect(parseUsageReport(report, current)).toEqual(report);
      expect(report).not.toHaveProperty('firstUseAcknowledged');
    }
  });

  it('à J37, un premier jour acquitté conserve le retour J7 encore envoyable après redémarrage', async () => {
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    expect(disk().firstUseAcknowledged).toBe(true);
    advanceDays(7);
    await first.recordActivity();
    const returningToken = disk().days[1].report.token;
    first.dispose();
    advanceDays(30);
    fetchMock.mockClear();
    const reconnect = create();
    await reconnect.init(true);
    await reconnect.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(daily).toEqual([{ v: 1, kind: 'day', period: '2026-01-08', token: returningToken, openings: 0,
      returned7: true, returned30: true, cohort: '2026-01-01' }]);
    expect(disk().firstUseAcknowledged).toBe(true);
    expect(parseUsageReport(daily[0], current)).toEqual(daily[0]);
  });

  it('acquitte le premier jour avant de transmettre son retour dans le même flush', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const report = JSON.parse(init.body as string) as DailyUsageReport;
      if (report.kind === 'day' && report.returned7) expect(disk().firstUseAcknowledged).toBe(true);
      return { status: 204 };
    });
    const stats = create();
    await stats.init(true);
    await stats.recordActivity();
    advanceDays(7);
    await stats.recordActivity();
    expect(disk().firstUseAcknowledged).toBe(false);
    await stats.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ firstUse: true, period: '2026-01-01' });
    expect(daily[1]).toMatchObject({ returned7: true, returned30: true, period: '2026-01-08' });
    expect(disk().firstUseAcknowledged).toBe(true);
  });

  it('un premier rapport définitivement refusé ne génère pas de retour de cohorte', async () => {
    fetchMock.mockResolvedValueOnce({ status: 400 });
    const stats = create();
    await stats.init(true);
    await stats.recordActivity();
    await stats.flush();
    expect(disk().firstUseAcknowledged).toBe(false);
    advanceDays(7);
    await stats.recordActivity();
    fetchMock.mockClear();
    await stats.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ period: '2026-01-08', openings: 0 });
    expect(daily[0]).not.toHaveProperty('returned7');
    expect(daily[0]).not.toHaveProperty('returned30');
    expect(daily[0]).not.toHaveProperty('cohort');
  });

  it.each([
    [1, true, true], [7, true, true], [8, false, true], [30, false, true], [31, false, false],
  ])('retour à J%d : semaine=%s, mois=%s', async (days, week, month) => {
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    first.dispose();
    advanceDays(days);
    const next = create();
    await next.init(true);
    await next.recordOpen();
    await next.flush();
    const daily = reports().filter((report): report is DailyUsageReport => report.kind === 'day')[1];
    expect(daily.firstUse).toBeUndefined();
    expect(daily.returned7 === true).toBe(week);
    expect(daily.returned30 === true).toBe(month);
    expect(daily.cohort).toBe(month ? '2026-01-01' : undefined);
    expect(parseUsageReport(daily, current)).toEqual(daily);
  });

  it('ne répète les flags retour ni sur un deuxième jour ni après redémarrage', async () => {
    let stats = create();
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    advanceDays(1);
    await stats.recordActivity();
    await stats.flush();
    stats.dispose();
    advanceDays(1);
    stats = create();
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    const days = reports().filter((report): report is DailyUsageReport => report.kind === 'day');
    expect(days.map(report => [report.firstUse, report.returned7, report.returned30])).toEqual([
      [true, undefined, undefined], [undefined, true, true], [undefined, undefined, undefined],
    ]);
    expect(days[2].cohort).toBeUndefined();
  });
});

describe('backlog borné et retries idempotents', () => {
  it('réessaie le même rapport et le même jeton après 503, avec backoff persistant', async () => {
    fetchMock.mockResolvedValueOnce({ status: 503 });
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    const originalBody = fetchMock.mock.calls[0][1].body;
    expect(disk().failures).toBe(1);
    expect(disk().retryAt).toBe(current.getTime() + 30_000);
    first.dispose();
    const next = create();
    await next.init(true);
    await next.flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    current = new Date(current.getTime() + 30_000);
    await next.flush();
    expect(fetchMock.mock.calls[1][1].body).toBe(originalBody);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(disk().failures).toBe(0);
    expect(disk().retryAt).toBe(0);
  });

  it.each([408, 429])('traite HTTP %d comme temporaire', async status => {
    fetchMock.mockResolvedValue({ status });
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    expect(disk().days[0].pending).toBe(true);
    expect(disk().days[0].rejected).toBeUndefined();
    expect(disk().retryAt).toBeGreaterThan(current.getTime());
  });

  it.each([400, 401, 403, 404, 410, 413, 422])('cesse de renvoyer une entrée invalide après HTTP %d', async status => {
    fetchMock.mockResolvedValue({ status });
    const first = create();
    await first.init(true);
    await first.recordOpen();
    await first.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(disk().days[0].rejected).toBe(true);
    first.dispose();
    const next = create();
    await next.init(true);
    await next.recordOpen();
    await next.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('borne la file à 35 jours et ne soumet pas de rapports expirés', async () => {
    const stats = create();
    await stats.init(true);
    for (let day = 0; day < 45; day++) {
      await stats.recordActivity();
      advanceDays(1);
    }
    expect(disk().days).toHaveLength(35);
    expect(disk().months.length).toBeLessThanOrEqual(3);
    advanceDays(36);
    await stats.flush();
    expect(reports().every(report => parseUsageReport(report, current) !== null)).toBe(true);
    expect(reports().filter(report => report.kind === 'day')).toHaveLength(0);
    expect(disk().days).toHaveLength(0);
  });

  it('ne bloque pas indéfiniment si le transport ignore l’AbortSignal', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const stats = create({ timeoutMs: 100 });
    await stats.init(true);
    await stats.recordOpen();
    const sending = stats.flush();
    await waitForRequest();
    await advanceTransportTimers(100);
    await sending;
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(disk().days[0].pending).toBe(true);
    expect(disk().failures).toBe(1);
  });

  it('la désactivation interrompt un envoi en cours sans recréer le fichier purgé', async () => {
    let resolve!: (value: { status: number }) => void;
    fetchMock.mockImplementation(() => new Promise(done => { resolve = done; }));
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    const sending = stats.flush();
    await waitForRequest();
    await stats.setEnabled(false);
    await sending;
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    resolve({ status: 204 });
    await Promise.resolve();
    await stats.flush();
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('dispose interrompt le transport mais conserve le backlog pour une prochaine session consentie', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const stats = create();
    await stats.init(true);
    await stats.recordOpen();
    const sending = stats.flush();
    await waitForRequest();
    stats.dispose();
    await sending;
    await stats.recordActivity();
    await stats.flush();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(disk().days[0].pending).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('persistance défensive et liste blanche des données', () => {
  it('ignore les champs ajoutés au fichier et ne transmet que le contrat autorisé', async () => {
    const first = create();
    await first.init(true);
    await first.recordOpen();
    first.dispose();
    const altered = JSON.parse(readFileSync(file, 'utf8'));
    altered.email = 'prof@example.test';
    altered.installationId = 'NE-JAMAIS-ENVOYER';
    altered.days[0].report.documentText = 'Contenu confidentiel du cours';
    altered.months[0].report.dailyToken = altered.days[0].report.token;
    writeFileSync(file, JSON.stringify(altered));
    const next = create();
    await next.init(true);
    await next.flush();
    expect(reports()).toHaveLength(2);
    for (const report of reports()) {
      expect(parseUsageReport(report, current)).toEqual(report);
      expect(JSON.stringify(report)).not.toMatch(/prof@|NE-JAMAIS|confidentiel|dailyToken/);
    }
  });

  it.each(['{JSON invalide', 'x'.repeat(70_000)])('supprime un fichier corrompu ou surdimensionné sans l’archiver', async contents => {
    writeFileSync(file, contents);
    const stats = create();
    await stats.init(true);
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await stats.recordActivity();
    expect(disk().days[0].report.firstUse).toBe(true);
  });

  it('refuse une collision des jetons quotidiens et mensuels sans écrire ni envoyer', async () => {
    const stats = create({ tokenFactory: () => 'a'.repeat(32) });
    await stats.init(true);
    await stats.recordOpen();
    await stats.flush();
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('une erreur de stockage reste sans effet sur le fonctionnement et n’envoie rien', async () => {
    writeFileSync(file, 'obstacle');
    const stats = create({ file: path.join(file, 'usage.json') });
    await expect(stats.init(true)).resolves.toBeUndefined();
    await expect(stats.recordOpen()).resolves.toBeUndefined();
    await expect(stats.flush()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
