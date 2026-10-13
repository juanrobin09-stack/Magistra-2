import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUsageRouteHandler, fetchDownloadSnapshot, isUsageOwner } from '../../server/usageRoutes.js';
import { parseUsageReport, type UsageSnapshot } from '../../shared/usageTelemetry.js';
import { renderUsageDashboard, usageMetrics } from '../../server/usageDashboard.js';

const NOW = new Date('2026-10-13T12:00:00Z');
const PASSWORD = 'private-fixture-password-with-32-random-bytes';
const ENV = { MAGISTRA_STATS_OWNER_LOGIN: 'juan', MAGISTRA_STATS_OWNER_PASSWORD_HASH: createHash('sha256').update(PASSWORD).digest('hex') };
const AUTH = 'Basic ' + Buffer.from('juan:' + PASSWORD).toString('base64');
const REPORT = { v: 1, kind: 'day', period: '2026-10-13', token: 'a'.repeat(32), openings: 2 };
const SNAPSHOT: UsageSnapshot = { days: [{ period: '2026-10-13', active: 2, openings: 7 }], months: [{ period: '2026-10', active: 3 }], cohorts: [
  { period: '2026-09-01', firstUses: 10, returned7: 6, returned30: 8 },
  { period: '2026-10-12', firstUses: 30, returned7: 0, returned30: 0 },
] };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); }))); });
async function start(route: 'collect' | 'dashboard' | 'maintenance', options: Parameters<typeof createUsageRouteHandler>[1] = {}) {
  const record = vi.fn(async () => undefined); const snapshot = vi.fn(async () => SNAPSHOT);
  const handler = createUsageRouteHandler(route, { env: ENV, now: () => NOW, store: { record, snapshot }, downloads: async () => null, ...options });
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  return { url: `http://127.0.0.1:${address.port}`, record, snapshot };
}

describe('statistiques privées — contrôle HTTP réel', () => {
  it('réserve la maintenance au secret dédié Vercel, pas au compte de lecture', async () => {
    const purge = vi.fn(async () => undefined);
    const secret = 'e'.repeat(64);
    const api = await start('maintenance', { env: { ...ENV, CRON_SECRET: secret }, store: { record: async () => undefined, snapshot: async () => SNAPSHOT, purge } });
    for (const authorization of ['', AUTH, 'Bearer wrong']) {
      expect((await fetch(api.url, { headers: { authorization } })).status).toBe(401);
    }
    expect(purge).not.toHaveBeenCalled();
    const r = await fetch(api.url, { headers: { authorization: 'Bearer ' + secret } });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ maintained: true }); expect(purge).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'Bearer arbitrary', 'Basic eA==', 'Basic ' + Buffer.from('other:' + PASSWORD).toString('base64'), 'Basic ' + Buffer.from('juan:wrong').toString('base64')])('refuse toute lecture sans les identifiants propriétaire (%s)', async authorization => {
    const api = await start('dashboard'); const r = await fetch(api.url + '/?format=json', { headers: { authorization } });
    expect(r.status).toBe(401); expect(await r.text()).not.toContain('firstUses'); expect(api.snapshot).not.toHaveBeenCalled();
    expect(r.headers.get('cache-control')).toContain('no-store'); expect(r.headers.get('www-authenticate')).toContain('Basic');
  });
  it('refuse aussi quand la configuration privée est absente', async () => {
    const api = await start('dashboard', { env: {} }); const r = await fetch(api.url, { headers: { authorization: AUTH } });
    expect(r.status).toBe(401); expect(api.snapshot).not.toHaveBeenCalled();
  });
  it('protège le HTML et le JSON côté serveur, sans cache public', async () => {
    const api = await start('dashboard');
    for (const path of ['/', '/?format=json']) {
      const r = await fetch(api.url + path, { headers: { authorization: AUTH } }); expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
      expect(r.headers.get('vercel-cdn-cache-control')).toBe('no-store');
      expect(r.headers.get('x-robots-tag')).toContain('noindex'); expect(r.headers.get('access-control-allow-origin')).toBeNull();
      const body = await r.text(); expect(body).not.toContain(PASSWORD); expect(body).not.toContain(ENV.MAGISTRA_STATS_OWNER_PASSWORD_HASH);
    }
  });
  it('ne laisse pas lire de statistiques par l’endpoint public de collecte', async () => {
    const api = await start('collect'); const r = await fetch(api.url);
    expect(r.status).toBe(405); expect(api.snapshot).not.toHaveBeenCalled(); expect(api.record).not.toHaveBeenCalled();
  });
  it('accepte un petit compteur uniquement et ne renvoie ni données ni jeton', async () => {
    const api = await start('collect'); const r = await fetch(api.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REPORT) });
    expect(r.status).toBe(202); expect(await r.json()).toEqual({ accepted: true }); expect(api.record).toHaveBeenCalledWith(REPORT);
  });
  it.each(['document', 'prompt', 'apiKey', 'ip', 'email', 'userId'])('refuse entièrement les champs personnels ou de travail (%s)', async field => {
    const api = await start('collect'); const r = await fetch(api.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...REPORT, [field]: 'private' }) });
    expect(r.status).toBe(400); expect(api.record).not.toHaveBeenCalled(); expect(await r.text()).not.toContain('private');
  });
  it('refuse les requêtes d’un site tiers et les corps surdimensionnés', async () => {
    const api = await start('collect');
    const foreign = await fetch(api.url, { method: 'POST', headers: { origin: 'https://other.test', 'content-type': 'application/json' }, body: JSON.stringify(REPORT) });
    expect(foreign.status).toBe(403);
    const oversized = await fetch(api.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...REPORT, padding: 'x'.repeat(2000) }) });
    expect(oversized.status).toBe(400); expect(api.record).not.toHaveBeenCalled();
  });
  it('garde une panne de base confidentielle et réessayable', async () => {
    const api = await start('collect', { store: { record: async () => { throw new Error('postgres://private:secret@host'); }, snapshot: async () => SNAPSHOT } });
    const r = await fetch(api.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REPORT) });
    expect(r.status).toBe(503); expect(await r.text()).not.toContain('secret');
  });
});

describe('définitions et minimisation des statistiques', () => {
  it('compare le mot de passe et le propriétaire, jamais un simple nom transmis', () => {
    expect(isUsageOwner(AUTH, ENV)).toBe(true); expect(isUsageOwner('juan', ENV)).toBe(false); expect(isUsageOwner(AUTH, {})).toBe(false);
  });
  it.each(['2026-02-30', '2026-10-14', '2026-08-01'])('refuse un jour invalide, futur ou trop ancien %s', period => {
    expect(parseUsageReport({ ...REPORT, period }, NOW)).toBeNull();
  });
  it('calcule le MAU indépendamment du DAU et moyenne ouvertures/MAU', () => {
    const m = usageMetrics(SNAPSHOT, NOW); expect(m.today).toBe(2); expect(m.monthly).toBe(3); expect(m.average).toBeCloseTo(7 / 3);
    expect(m.retention7).toEqual({ base: 10, returned: 6, percent: 60 }); expect(m.retention30).toEqual({ base: 10, returned: 8, percent: 80 });
  });
  it('ne transforme pas l’absence de participants en taux de rétention nul', () => {
    expect(usageMetrics({ days: [], months: [], cohorts: [] }, NOW).retention7.percent).toBeNull();
  });
  it('signale le mois partiellement expiré et retire sa moyenne trompeuse', () => {
    const snapshot = { days: [{ period: '2025-09-30', active: 2, openings: 6 }], months: [{ period: '2025-09', active: 10 }], cohorts: [] };
    const now = new Date('2026-11-02T12:00:00Z');
    expect(usageMetrics(snapshot, now, '2025-09')).toMatchObject({ partialMonth: true, average: null });
    expect(renderUsageDashboard(snapshot, null, now, '2025-09')).toContain('Historique partiel');
  });
  it('échappe les valeurs du HTML et ne charge aucun tiers ni script', () => {
    const html = renderUsageDashboard(SNAPSHOT, { total: 5, complete: true, releases: [{ version: '<script>bad</script>', downloads: 5 }] }, NOW, '<script>bad</script>');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain(' src='); expect(html).toContain('noindex,nofollow');
  });
  it('reprend le total demandé et continue de compter les nouveaux téléchargements sans modifier les versions', () => {
    for (const [total, displayed] of [[42, 56], [43, 57]]) {
      const html = renderUsageDashboard(SNAPSHOT, { total, complete: true, releases: [{ version: 'v2.0.11', downloads: total }] }, NOW);
      expect(html).toContain(`<h2>Téléchargements</h2><strong>${displayed}</strong>`);
      expect(html).toContain(`<td>v2.0.11</td><td>${total}</td>`);
      expect(html).toContain('<td>Reprise manuelle (version non attribuée)</td><td>14</td>');
    }
    expect(renderUsageDashboard(SNAPSHOT, null, NOW)).toContain('<h2>Téléchargements</h2><strong>Indisponible</strong>');
    expect(renderUsageDashboard(SNAPSHOT, { total: 42, complete: false, releases: [] }, NOW)).toContain('Historique GitHub partiel.');
  });
  it('additionne les installateurs et exclut licences, contrôles et préversions', async () => {
    const fixture = [{ tag_name: 'v2.0.10', draft: false, prerelease: false, assets: [
      { name: 'Magistra-Setup-2.0.10.exe', state: 'uploaded', download_count: 5 },
      { name: 'Magistra-Setup.exe', state: 'uploaded', download_count: 3 },
      { name: 'Magistra-2.0.10-win-x64.zip', state: 'uploaded', download_count: 2 },
      { name: 'SHA256SUMS-v2.txt', state: 'uploaded', download_count: 200 },
    ] }, { tag_name: 'v2.0.11', draft: true, assets: [] }];
    const f = vi.fn(async () => new Response(JSON.stringify(fixture))) as unknown as typeof fetch;
    expect(await fetchDownloadSnapshot(f)).toEqual({ total: 10, complete: true, releases: [{ version: 'v2.0.10', downloads: 10 }] });
  });
  it('borne l’ensemble des pages GitHub sans empêcher le tableau de répondre', async () => {
    const requests: AbortSignal[] = [];
    const server = createServer((_req, res) => {
      setTimeout(() => {
        if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array(100).fill({ draft: true }))); }
      }, 1600).unref();
    });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const delayed: typeof fetch = (_url, init) => { requests.push(init!.signal!); return fetch(`http://127.0.0.1:${address.port}`, init); };
    const api = await start('dashboard', { downloads: () => fetchDownloadSnapshot(delayed) });
    const response = await fetch(api.url, { headers: { authorization: AUTH } });
    expect(response.status).toBe(200); expect(await response.text()).toContain('Indisponible');
    expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]); expect(requests[0].aborted).toBe(true);
  });
});
