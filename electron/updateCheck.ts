// Vérification des versions stables au démarrage et à la demande. Aucun document transmis.
import type { FetchLike } from '../shared/ai/provider.js';
import { MagistraError } from '../shared/errors.js';
import { LEGACY_UPDATE_CHECKSUMS_FILE, UPDATE_CHECKSUMS_FILE } from '../shared/updateAssets.js';
import type { UpdateCheckResult } from '../shared/ipc.js';
import { isSafeExternalUrl } from './security.js';

export const RELEASES_API_URL = 'https://api.github.com/repos/juanrobin09-stack/magistra-downloads/releases/latest';
/**
 * Seules pages de version que l'application accepte d'ouvrir. Propriétaire et dépôt sont comparés sans tenir compte de
 * la casse, comme le fait GitHub : l'API renvoie le nom exact du dépôt (« Magistra-Downloads »).
 */
export const RELEASES_PAGE_PREFIX = 'https://github.com/juanrobin09-stack/magistra-downloads/releases/';
const API_ORIGIN = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** Pas de réponse (hors ligne, proxy, délai dépassé). */
export const UPDATE_CHECK_OFFLINE_MESSAGE = 'Vérification impossible (pas de connexion Internet ?)';
/** Réponse reçue mais inutilisable (erreur du service, contenu inattendu, lien hors du dépôt officiel). */
export const UPDATE_CHECK_UNAVAILABLE_MESSAGE = 'Vérification impossible pour le moment : le service des versions (GitHub) a renvoyé une réponse inattendue. Réessayez plus tard.';

// ─── Versions ───────────────────────────────────────────────────────────────

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE = /^[vV]?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** « 2.1.0 », « v2.1.0 », « 2.1.0-beta.1 » ; null si ce n'est pas un numéro de version semver. */
export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const m = SEMVER_RE.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split('.') : [] };
}

/** Numéro de version affiché (sans « v » ni métadonnées de construction). */
export function formatVersion(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;
}

/** Ordre semver : négatif si a < b, 0 si égales, positif si a > b (2.1.0-beta < 2.1.0). */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ─── Requête ────────────────────────────────────────────────────────────────

/** Page de version du dépôt officiel (forme normalisée), ou null. */
export function releasePageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !isSafeExternalUrl(value)) return null;
  try {
    const u = new URL(value);
    // Forme normalisée (« .. », « %2e%2e » résolus) : le préfixe est vérifié sur l'adresse réellement ouverte.
    const prefix = u.href.slice(0, RELEASES_PAGE_PREFIX.length);
    if (u.origin !== 'https://github.com' || prefix.toLowerCase() !== RELEASES_PAGE_PREFIX || u.href.length <= RELEASES_PAGE_PREFIX.length) return null;
    return u.href;
  } catch {
    return null;
  }
}

function unavailable(cause?: unknown): MagistraError {
  return new MagistraError('NETWORK_ERROR', UPDATE_CHECK_UNAVAILABLE_MESSAGE, cause === undefined ? undefined : { cause });
}

async function readBounded(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw unavailable();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface UpdateCheckDeps {
  fetch: FetchLike;
  /** app.getVersion(). */
  currentVersion: string;
  timeoutMs?: number;
}

export async function checkForUpdate(deps: UpdateCheckDeps): Promise<UpdateCheckResult> {
  const current = parseVersion(deps.currentVersion);
  if (!current) throw unavailable();
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Magistra/${formatVersion(current)} (outil pedagogique)`,
  };

  let url = RELEASES_API_URL;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      res = await deps.fetch(url, { headers, redirect: 'manual', signal });
    } catch (err) {
      throw new MagistraError('NETWORK_ERROR', UPDATE_CHECK_OFFLINE_MESSAGE, { cause: err });
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => undefined);
      // Redirection acceptée seulement vers l'API GitHub elle-même (dépôt renommé ou transféré).
      const location = res.headers.get('location');
      let next: URL | null;
      try {
        next = location ? new URL(location, url) : null;
      } catch {
        next = null;
      }
      if (!next || next.origin !== API_ORIGIN || next.username || next.password || hop === MAX_REDIRECTS) throw unavailable();
      url = next.href;
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw unavailable();

  // Dépôt sans aucune version publiée.
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { currentVersion: formatVersion(current), latestVersion: null, upToDate: true };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw unavailable();
  }

  let data: unknown;
  try {
    data = JSON.parse(await readBounded(res));
  } catch (err) {
    if (err instanceof MagistraError) throw err;
    if (signal.aborted) throw new MagistraError('NETWORK_ERROR', UPDATE_CHECK_OFFLINE_MESSAGE, { cause: err });
    throw unavailable(err);
  }
  const release = (data && typeof data === 'object' ? data : {}) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  const latest = parseVersion(release.tag_name);
  const page = releasePageUrl(release.html_url);
  if (!latest || !page) throw unavailable();

  if (release.draft === true || release.prerelease === true) throw unavailable();
  const upToDate = compareVersions(latest, current) <= 0;
  let installer: UpdateCheckResult['installer'];
  if (!upToDate && latest.prerelease.length === 0 && Array.isArray(release.assets)) {
    const name = `Magistra-Setup-${formatVersion(latest)}.exe`;
    const assets = release.assets as { name?: unknown; browser_download_url?: unknown; size?: unknown }[];
    const setup = assets.filter(a => a && a.name === name);
    const checksumName = assets.some(a => a?.name === UPDATE_CHECKSUMS_FILE) ? UPDATE_CHECKSUMS_FILE : LEGACY_UPDATE_CHECKSUMS_FILE;
    const sums = assets.filter(a => a && a.name === checksumName);
    const safeAsset = (value: unknown, filename: string): value is string => {
      if (typeof value !== 'string') return false;
      try {
        const url = new URL(value);
        const expected = `/juanrobin09-stack/magistra-downloads/releases/download/${release.tag_name}/${filename}`;
        return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
          && url.pathname.toLowerCase() === expected.toLowerCase();
      } catch { return false; }
    };
    if (setup.length === 1 && sums.length === 1 && safeAsset(setup[0].browser_download_url, name)
      && safeAsset(sums[0].browser_download_url, checksumName)
      && typeof setup[0].size === 'number' && Number.isSafeInteger(setup[0].size)
      && setup[0].size > 0 && setup[0].size <= 512 * 1024 * 1024) {
      installer = { name, url: setup[0].browser_download_url, checksumsUrl: sums[0].browser_download_url, size: setup[0].size };
    }
  }
  return {
    currentVersion: formatVersion(current),
    latestVersion: formatVersion(latest),
    upToDate,
    ...(upToDate ? {} : { url: page }),
    ...(installer ? { installer } : {}),
  };
}
