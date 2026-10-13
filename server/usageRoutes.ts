import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseUsageReport } from '../shared/usageTelemetry.js';
import { SITE_ORIGIN } from '../shared/site.js';
import { createNeonUsageStore, type UsageStore } from './usageStore.js';
import { renderUsageDashboard, type DownloadSnapshot } from './usageDashboard.js';

type Env = Record<string, string | undefined>;
export interface UsageRouteOptions { env?: Env; now?: () => Date; store?: UsageStore; downloads?: () => Promise<DownloadSnapshot | null> }
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
function respond(res: ServerResponse, status: number, body: unknown, html = false): void {
  const content = html ? String(body) : JSON.stringify(body);
  res.statusCode = status;
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(content));
  res.end(content);
}
function same(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function isUsageOwner(header: unknown, env: Env): boolean {
  const owner = env.MAGISTRA_STATS_OWNER_LOGIN;
  const hash = env.MAGISTRA_STATS_OWNER_PASSWORD_HASH;
  if (!owner || !hash || !/^[a-f0-9]{64}$/.test(hash) || typeof header !== 'string' || header.length > 512) return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header);
  if (!match) return false;
  const value = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = value.indexOf(':');
  if (colon < 1 || colon > 100 || value.length > 300) return false;
  const userOK = same(value.slice(0, colon), owner);
  const passwordOK = same(createHash('sha256').update(value.slice(colon + 1)).digest('hex'), hash);
  return userOK && passwordOK;
}

async function readReport(req: IncomingMessage): Promise<unknown> {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('body');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new Error('body');
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(String(declared)) || Number(declared) > 1024)) throw new Error('body');
  // Vercel peut avoir analysé le JSON avant le gestionnaire ; appliquer aussi la limite dans ce cas.
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const json = typeof parsed === 'string' || Buffer.isBuffer(parsed) ? String(parsed) : JSON.stringify(parsed);
    if (Buffer.byteLength(json) > 1024) throw new Error('body');
    return JSON.parse(json);
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1024) throw new Error('body');
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function fetchDownloadSnapshot(fetcher: typeof fetch = fetch): Promise<DownloadSnapshot | null> {
  try {
    const releases: DownloadSnapshot['releases'] = [];
    // Budget commun : la lecture SQL peut déjà prendre 10 s dans une fonction Vercel limitée à 15 s.
    const signal = AbortSignal.timeout(2500);
    let complete = false;
    for (let page = 1; page <= 5; page++) {
      signal.throwIfAborted();
      const response = await fetcher(`https://api.github.com/repos/juanrobin09-stack/Magistra-Downloads/releases?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Magistra-private-dashboard' }, signal, redirect: 'error', credentials: 'omit' });
      if (!response.ok) return null;
      const list = await response.json() as unknown;
      if (!Array.isArray(list)) return null;
      for (const r of list) {
        if (!r || typeof r !== 'object' || r.draft || r.prerelease || !/^v\d+\.\d+\.\d+$/.test(r.tag_name) || !Array.isArray(r.assets)) continue;
        let downloads = 0;
        for (const a of r.assets) {
          if (a && a.state === 'uploaded' && typeof a.name === 'string'
            && /^(?:Magistra-Setup(?:-\d+\.\d+\.\d+)?\.exe|Magistra-\d+\.\d+\.\d+-win-x64\.zip)$/.test(a.name)
            && Number.isSafeInteger(a.download_count) && a.download_count >= 0) downloads += a.download_count;
        }
        releases.push({ version: r.tag_name, downloads });
      }
      if (list.length < 100) { complete = true; break; }
    }
    return { total: releases.reduce((n, r) => n + r.downloads, 0), releases, complete };
  } catch { return null; }
}

/** Endpoint d'écriture sans lecture publique, et tableau entièrement protégé côté serveur. */
export function createUsageRouteHandler(route: 'collect' | 'dashboard' | 'maintenance', options: UsageRouteOptions = {}) {
  let configuredStore: UsageStore | undefined;
  const loadStore = (env: Env): UsageStore | null => {
    if (options.store) return options.store;
    if (!env.MAGISTRA_STATS_DATABASE_URL || !env.MAGISTRA_STATS_HASH_SECRET || env.MAGISTRA_STATS_HASH_SECRET.length < 32) return null;
    return configuredStore ??= createNeonUsageStore(env.MAGISTRA_STATS_DATABASE_URL, env.MAGISTRA_STATS_HASH_SECRET);
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const env = options.env ?? process.env;
    const now = (options.now ?? (() => new Date()))();
    try {
      if (req.method !== (route === 'collect' ? 'POST' : 'GET')) {
        res.setHeader('Allow', route === 'collect' ? 'POST' : 'GET'); respond(res, 405, { error: 'Méthode non autorisée.' }); return;
      }
      if (route === 'maintenance') {
        const secret = env.CRON_SECRET;
        if (!secret || secret.length < 32 || typeof req.headers.authorization !== 'string' || !same(req.headers.authorization, 'Bearer ' + secret)) {
          respond(res, 401, { error: 'Authentification requise.' }); return;
        }
        const store = loadStore(env);
        if (!store?.purge) { respond(res, 503, { error: 'Maintenance non configurée.' }); return; }
        await store.purge();
        respond(res, 200, { maintained: true });
      } else if (route === 'dashboard') {
        if (!isUsageOwner(req.headers.authorization, env)) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Magistra - tableau prive", charset="UTF-8"');
          respond(res, 401, { error: 'Authentification requise.' }); return;
        }
        const store = loadStore(env);
        if (!store) { respond(res, 503, { error: 'Statistiques non configurées.' }); return; }
        const snapshot = await store.snapshot();
        const url = new URL(req.url ?? '/', SITE_ORIGIN);
        if (url.searchParams.get('format') === 'json') { respond(res, 200, { measuredAt: now.toISOString(), ...snapshot }); return; }
        const downloads = await (options.downloads ?? fetchDownloadSnapshot)();
        respond(res, 200, renderUsageDashboard(snapshot, downloads, now, url.searchParams.get('month') ?? undefined), true);
      } else {
        if (req.headers.origin && req.headers.origin !== 'app://magistra') { respond(res, 403, { error: 'Origine non autorisée.' }); return; }
        let raw: unknown;
        try { raw = await readReport(req); } catch { respond(res, 400, { error: 'Rapport invalide.' }); return; }
        const report = parseUsageReport(raw, now);
        if (!report) { respond(res, 400, { error: 'Rapport invalide.' }); return; }
        const store = loadStore(env);
        if (!store) { respond(res, 503, { error: 'Mesure momentanément indisponible.' }); return; }
        await store.record(report);
        respond(res, 202, { accepted: true });
      }
    } catch { respond(res, 503, { error: 'Statistiques momentanément indisponibles.' }); }
  };
}
