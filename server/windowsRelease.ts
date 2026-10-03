// Dernière version STABLE de l'application Windows, pour la section « Magistra pour Windows » du site
// (GET /api/windows-release : route publique, sans aucun secret).
//
// Une requête vers l'API GitHub, à une adresse fixe (dépôt officiel) : GET /repos/<dépôt>/releases/latest. GitHub n'y
// renvoie jamais de brouillon ni de préversion ; c'est tout de même revérifié ici (draft === false et
// prerelease === false), comme tout le reste de la réponse, traitée comme une entrée NON FIABLE :
//  - version : étiquette « vX.Y.Z » stricte ; aucune version n'est codée en dur, c'est la release publiée qui fait foi ;
//  - installateur : fichier « Magistra-Setup-X.Y.Z.exe » de CETTE version (même numéro que l'étiquette), entièrement
//    déposé, de taille entière positive ; lien de téléchargement direct accepté seulement s'il vaut exactement
//    https://github.com/<dépôt>/releases/download/vX.Y.Z/Magistra-Setup-X.Y.Z.exe (aucun autre dépôt ni hôte, aucun
//    « .. », aucun encodage « % », aucun identifiant, aucune requête ni ancre) ;
//  - SHA-256 : champ « digest » de l'asset (« sha256:<64 hex> ») s'il existe, sinon le fichier SHA256SUMS.txt de la
//    même version (64 Ko au plus, ligne « <hex>  <nom> » produite par sha256sum, voir .github/workflows/release.yml) ;
//    sinon absent — jamais inventé ;
//  - redirections suivies à la main, 3 au plus : vers https://api.github.com seulement pour l'API (dépôt renommé ou
//    transféré : GitHub ne redirige /repos/<dépôt> que dans ce cas, et ses liens portent alors le NOUVEAU nom — le
//    dépôt canonique est lu dans html_url de la release, validé, et sert à vérifier les liens et à construire
//    releaseUrl), vers github.com et *.githubusercontent.com seulement pour SHA256SUMS.txt ; réponses bornées en
//    taille ; 8 s au total pour l'ensemble.
// Le jeton GitHub facultatif (GITHUB_TOKEN, serveur uniquement) n'est envoyé qu'à https://api.github.com ; il n'apparaît
// jamais dans la réponse ni dans les journaux (qui ne recopient d'ailleurs rien de ce que GitHub renvoie).
//
// Réponses : installateur trouvé → WindowsReleaseInfo ; aucune version stable (404 de GitHub, ou release non stable) →
// { available: false, reason: 'none' } ; GitHub injoignable, en erreur ou réponse inattendue → reason 'unavailable'.
// Dans les deux derniers cas, `releasesUrl` (page officielle des versions) sert de repli à l'interface.
//
// Cache mémoire (WindowsReleaseCache, un par instance du serveur) : une requête vers GitHub toutes les 10 min au plus,
// requêtes simultanées regroupées ; GitHub en panne → la dernière réponse valide (24 h au plus) est resservie, et un
// nouvel essai a lieu après 1 min. Sans jeton, l'API GitHub n'accepte que 60 requêtes par heure et par adresse IP.

import type { FetchLike } from '../shared/ai/provider.js';
import type { WindowsReleaseInfo, WindowsReleaseResponse } from '../shared/apiContract.js';

/** Dépôt officiel de Magistra (celui que l'application Windows interroge pour « Rechercher une mise à jour »). */
export const DEFAULT_RELEASES_REPO = 'juanrobin09-stack/magistra-downloads';

/** Systèmes pris en charge par l'installateur (NSIS x64, voir electron-builder.json), tels qu'affichés. */
export const WINDOWS_REQUIREMENTS = 'Windows 10 ou 11 (64 bits)';

/** Nom du fichier d'empreintes publié avec chaque version (voir .github/workflows/release.yml). */
export const CHECKSUMS_FILE_NAME = 'SHA256SUMS.txt';
/**
 * Nom FIXE de l'installateur, publié par release.yml à côté de Magistra-Setup-X.Y.Z.exe (même fichier) :
 * https://github.com/<dépôt>/releases/latest/download/Magistra-Setup.exe télécharge toujours la dernière version stable.
 */
export const STABLE_INSTALLER_NAME = 'Magistra-Setup.exe';

export const WINDOWS_RELEASE_LIMITS = {
  /** Délai total (API GitHub, puis SHA256SUMS.txt si nécessaire). */
  timeoutMs: 8_000,
  /** Durée de vie d'une version trouvée en cache. */
  cacheTtlMs: 10 * 60_000,
  /**
   * Aucune version téléchargeable (rien de publié, ou release publiée dont l'installateur est encore en construction ou
   * en cours d'envoi) : nouvel essai au bout d'une minute, pour que le bouton « Télécharger » s'active dès que
   * l'installateur est joint (et non 10 minutes plus tard).
   */
  noneTtlMs: 60_000,
  /** Après une réponse « indisponible » : nouvel essai au bout d'une minute (sans marteler GitHub). */
  failureTtlMs: 60_000,
  /** Ancienneté maximale de la dernière réponse valide resservie quand GitHub ne répond pas. */
  staleMaxMs: 24 * 3_600_000,
  /** Réponse JSON de l'API (notes de version et liste des fichiers comprises). */
  maxReleaseBytes: 1_000_000,
  maxChecksumBytes: 64 * 1024,
  maxRedirects: 3,
  /** Taille maximale d'un fichier de release sur GitHub (2 Gio). */
  maxInstallerBytes: 2 * 1024 ** 3,
} as const;

/** En-tête Cache-Control d'une version trouvée. */
export const WINDOWS_RELEASE_CACHE_CONTROL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400';
/**
 * Aucune version téléchargeable, ou GitHub indisponible : cache HTTP court (navigateur et CDN), sans réponse périmée
 * resservie, pour que le prochain visiteur obtienne l'installateur dès qu'il est joint (ou dès le retour de GitHub).
 */
export const WINDOWS_RELEASE_SHORT_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';

const API_ORIGIN = 'https://api.github.com';
const USER_AGENT = 'Magistra-web (outil pedagogique)';
const TAG_RE = /^v((?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5}))$/;
const INSTALLER_RE = /^Magistra-Setup-(\d+\.\d+\.\d+)\.exe$/;
const DIGEST_RE = /^sha256:([0-9a-fA-F]{64})$/;
const CHECKSUM_LINE_RE = /^([0-9a-fA-F]{64})\s+\*?(.+)$/;

// ─── Dépôt ──────────────────────────────────────────────────────────────────

// Compte GitHub : lettres, chiffres et tirets simples, sans tiret en tête ni en fin, 39 caractères au plus.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** « propriétaire/dépôt » GitHub valide (MAGISTRA_RELEASES_REPO), casse conservée ; sinon null. */
export function parseReleasesRepo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!OWNER_RE.test(owner) || !REPO_NAME_RE.test(name) || name === '.' || name === '..') return null;
  return `${owner}/${name}`;
}

/** Page officielle des versions (repli de l'interface quand l'installateur n'est pas proposé). */
export function releasesPageUrl(repo: string): string {
  return `https://github.com/${repo}/releases`;
}

/**
 * Lien direct de téléchargement d'un fichier de la version `tag`, accepté seulement s'il vaut EXACTEMENT
 * https://github.com/<dépôt>/releases/download/<tag>/<fichier> : le propriétaire et le dépôt sont comparés sans
 * tenir compte de la casse (comme GitHub), tout le reste à l'identique. Aucune normalisation n'est tolérée
 * (« .. », « ./ », « % », barre oblique inverse, port, identifiants, requête, ancre) : l'adresse analysée doit être
 * la chaîne reçue elle-même.
 */
export function verifiedDownloadUrl(raw: unknown, repo: string, tag: string, fileName: string): string | null {
  if (typeof raw !== 'string' || raw.length > 500 || raw.includes('%') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.href !== raw || url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
  const prefix = `https://github.com/${repo}/`;
  if (raw.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  if (raw.slice(prefix.length) !== `releases/download/${tag}/${fileName}`) return null;
  return raw;
}

/** Empreinte du fichier `fileName` dans un SHA256SUMS.txt (format de sha256sum) ; absente ou ambiguë → undefined. */
export function checksumFor(text: string, fileName: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split('\n')) {
    const match = CHECKSUM_LINE_RE.exec(line.trim());
    if (!match || match[2].trim() !== fileName) continue;
    const hex = match[1].toLowerCase();
    // Deux lignes contradictoires pour le même fichier : aucune empreinte plutôt qu'une empreinte douteuse.
    if (found !== undefined && found !== hex) return undefined;
    found = hex;
  }
  return found;
}

// ─── Requêtes ───────────────────────────────────────────────────────────────

class ReleaseFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseFetchError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

/**
 * Suit les redirections à la main (3 au plus), uniquement vers les adresses que `allowed` accepte. `redirected` : au
 * moins une redirection suivie.
 */
async function fetchFollowing(
  fetchImpl: FetchLike, url: string, init: RequestInit, allowed: (url: URL) => boolean,
): Promise<{ res: Response; redirected: boolean }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    if (res.type !== 'opaqueredirect' && (res.status < 300 || res.status >= 400)) return { res, redirected: hop > 0 };
    await discard(res);
    const location = res.headers.get('location');
    let next: URL | null;
    try {
      next = location ? new URL(location, current) : null;
    } catch {
      next = null;
    }
    if (!next || hop >= WINDOWS_RELEASE_LIMITS.maxRedirects || !allowed(next)) throw new ReleaseFetchError('redirection refusée');
    current = next.href;
  }
}

/** Corps de la réponse en texte, `maxBytes` au plus (lecture interrompue au-delà). */
async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(res);
    throw new ReleaseFetchError('réponse trop volumineuse');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ReleaseFetchError('réponse trop volumineuse');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isApiUrl(url: URL): boolean {
  return url.origin === API_ORIGIN && !url.username && !url.password;
}

/** Hébergement des fichiers de release : github.com, puis son réseau de diffusion (*.githubusercontent.com). */
function isReleaseFileUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'));
}

// ─── Analyse de la release ──────────────────────────────────────────────────

interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  digest?: string;
}

type ParsedRelease =
  | { kind: 'not-stable' }
  /**
   * Version stable publiée SANS son installateur (encore en construction par release.yml, ou en cours d'envoi) : rien à
   * télécharger pour l'instant — comme « aucune version », jamais un lien qui mènerait à une erreur 404.
   */
  | { kind: 'no-installer'; tag: string; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; tag: string; version: string; publishedAt: string; installer: ReleaseAsset; checksums?: ReleaseAsset };

/** Fichier de la release, entièrement déposé, au lien vérifié et de taille acceptable ; sinon null. */
function assetOf(raw: unknown, repo: string, tag: string, name: string, maxBytes: number): ReleaseAsset | null {
  if (!isRecord(raw) || raw.name !== name) return null;
  // « uploaded » : dépôt terminé (« open » : fichier en cours d'envoi, incomplet).
  if (raw.state !== undefined && raw.state !== 'uploaded') return null;
  const size = raw.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) return null;
  const downloadUrl = verifiedDownloadUrl(raw.browser_download_url, repo, tag, name);
  if (!downloadUrl) return null;
  const digest = typeof raw.digest === 'string' ? DIGEST_RE.exec(raw.digest)?.[1]?.toLowerCase() : undefined;
  return { name, downloadUrl, size, ...(digest ? { digest } : {}) };
}

/**
 * Dépôt canonique d'une release lu dans son html_url (« https://github.com/<propriétaire>/<dépôt>/releases/tag/<tag> »,
 * exactement, pour CETTE étiquette) : utilisé après une redirection de l'API (dépôt renommé ou transféré). Sinon null.
 */
export function repoFromReleaseHtmlUrl(raw: unknown, tag: string): string | null {
  if (typeof raw !== 'string' || raw.length > 500 || raw.includes('%') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.href !== raw || url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password
    || url.search || url.hash) return null;
  const parts = url.pathname.split('/');
  if (parts.length !== 6 || parts[0] !== '' || parts[3] !== 'releases' || parts[4] !== 'tag' || parts[5] !== tag) return null;
  return parseReleasesRepo(`${parts[1]}/${parts[2]}`);
}

function parseRelease(data: unknown, repo: string): ParsedRelease {
  if (!isRecord(data)) return { kind: 'invalid', reason: 'réponse inattendue' };
  // Jamais un brouillon ni une préversion, même si GitHub en renvoyait une.
  if (data.draft !== false || data.prerelease !== false) return { kind: 'not-stable' };
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  const version = TAG_RE.exec(tag)?.[1];
  if (!version) return { kind: 'invalid', reason: 'étiquette de version inattendue (format attendu : vX.Y.Z)' };
  const published = typeof data.published_at === 'string' ? Date.parse(data.published_at) : Number.NaN;
  if (!Number.isFinite(published)) return { kind: 'invalid', reason: 'date de publication absente' };
  if (!Array.isArray(data.assets)) return { kind: 'invalid', reason: 'liste des fichiers absente' };

  const expected = `Magistra-Setup-${version}.exe`;
  const candidates = data.assets.filter(a => {
    const name = isRecord(a) && typeof a.name === 'string' ? a.name : '';
    return INSTALLER_RE.exec(name)?.[1] === version;
  });
  if (candidates.length === 0) return { kind: 'no-installer', tag, reason: `installateur ${expected} pas encore joint à la version` };
  if (candidates.length !== 1) return { kind: 'invalid', reason: `plusieurs installateurs ${expected} dans la version` };
  // Fichier en cours d'envoi (« open ») : bientôt disponible, pas une erreur.
  if (isRecord(candidates[0]) && candidates[0].state === 'open') {
    return { kind: 'no-installer', tag, reason: `installateur ${expected} en cours d'envoi` };
  }
  const installer = assetOf(candidates[0], repo, tag, expected, WINDOWS_RELEASE_LIMITS.maxInstallerBytes);
  if (!installer) return { kind: 'invalid', reason: `installateur ${expected} incomplet ou lien de téléchargement refusé` };
  const checksumAssets = data.assets.filter(a => isRecord(a) && a.name === CHECKSUMS_FILE_NAME);
  const checksums = checksumAssets.length === 1
    ? assetOf(checksumAssets[0], repo, tag, CHECKSUMS_FILE_NAME, WINDOWS_RELEASE_LIMITS.maxChecksumBytes) ?? undefined
    : undefined;
  return { kind: 'ok', tag, version, publishedAt: new Date(published).toISOString(), installer, ...(checksums ? { checksums } : {}) };
}

// ─── Cache ──────────────────────────────────────────────────────────────────

export interface WindowsReleaseCache {
  /** Dernière réponse, servie telle quelle pendant sa durée de vie. */
  entry?: { repo: string; at: number; ttl: number; value: WindowsReleaseResponse };
  /** Dernière réponse valide (version trouvée ou aucune version stable), resservie si GitHub ne répond plus. */
  lastGood?: { repo: string; at: number; value: WindowsReleaseResponse };
  /** Requête en cours (les appels simultanés l'attendent au lieu d'interroger GitHub à leur tour). */
  pending?: { repo: string; promise: Promise<WindowsReleaseResponse> };
}

export function createWindowsReleaseCache(): WindowsReleaseCache {
  return {};
}

// ─── Point d'entrée ─────────────────────────────────────────────────────────

export interface WindowsReleaseOptions {
  fetch: FetchLike;
  /** « propriétaire/dépôt », déjà validé (parseReleasesRepo). */
  repo: string;
  /** Jeton GitHub facultatif (serveur uniquement) : envoyé à https://api.github.com seulement. */
  token?: string;
  now?: () => number;
  /** Cache mémoire à utiliser (absent : aucune mise en cache). */
  cache?: WindowsReleaseCache;
  timeoutMs?: number;
  /** Journal de l'administrateur : causes seulement (jamais le jeton ni un contenu renvoyé par GitHub). */
  log?: (message: string) => void;
}

async function loadRelease(o: WindowsReleaseOptions): Promise<WindowsReleaseResponse> {
  const releasesUrl = releasesPageUrl(o.repo);
  const log = o.log ?? (() => undefined);
  const unavailable = (cause: string): WindowsReleaseResponse => {
    log(`Version Windows indisponible : ${cause}.`);
    return { available: false, reason: 'unavailable', releasesUrl };
  };
  const signal = AbortSignal.timeout(o.timeoutMs ?? WINDOWS_RELEASE_LIMITS.timeoutMs);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
    ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
  };

  let res: Response;
  let redirected: boolean;
  try {
    ({ res, redirected } = await fetchFollowing(o.fetch, `${API_ORIGIN}/repos/${o.repo}/releases/latest`, { headers, signal }, isApiUrl));
  } catch (err) {
    return unavailable(err instanceof ReleaseFetchError ? `GitHub : ${err.message}` : signal.aborted ? 'GitHub n’a pas répondu à temps' : 'GitHub injoignable');
  }
  // Aucune version stable publiée (ou dépôt inconnu) : GitHub répond 404 sur /releases/latest.
  if (res.status === 404) {
    await discard(res);
    return { available: false, reason: 'none', releasesUrl };
  }
  if (!res.ok) {
    const limited = (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0';
    await discard(res);
    return unavailable(limited
      ? `limite de requêtes de l'API GitHub atteinte${o.token ? '' : ' (renseignez GITHUB_TOKEN pour la relever)'}`
      : `GitHub a répondu ${res.status}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(await readBounded(res, WINDOWS_RELEASE_LIMITS.maxReleaseBytes)) as unknown;
  } catch (err) {
    return unavailable(err instanceof ReleaseFetchError ? `GitHub : ${err.message}` : signal.aborted ? 'GitHub n’a pas répondu à temps' : 'réponse de GitHub illisible');
  }

  // Dépôt renommé ou transféré (redirection de l'API) : liens et page de la version au nom canonique.
  let repo = o.repo;
  if (redirected) {
    const tag = isRecord(data) && typeof data.tag_name === 'string' ? data.tag_name : '';
    const canonical = isRecord(data) ? repoFromReleaseHtmlUrl(data.html_url, tag) : null;
    if (!canonical) {
      // Brouillon ou préversion : aucune version stable, quel que soit le nom du dépôt.
      if (isRecord(data) && (data.draft !== false || data.prerelease !== false)) return { available: false, reason: 'none', releasesUrl };
      return unavailable('dépôt renommé : adresse de la version inattendue');
    }
    repo = canonical;
  }

  const release = parseRelease(data, repo);
  if (release.kind === 'not-stable') return { available: false, reason: 'none', releasesUrl };
  if (release.kind === 'no-installer') {
    log(`Version Windows ${release.tag} : ${release.reason}.`);
    return { available: false, reason: 'none', releasesUrl };
  }
  if (release.kind === 'invalid') return unavailable(release.reason);

  let sha256 = release.installer.digest;
  if (!sha256 && release.checksums) {
    // Fichier public : aucun jeton transmis. Un échec ne rend pas la version indisponible, l'empreinte est seulement omise.
    try {
      const { res: sums } = await fetchFollowing(o.fetch, release.checksums.downloadUrl, {
        headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
        signal,
      }, isReleaseFileUrl);
      if (!sums.ok) {
        await discard(sums);
        log(`Version Windows : ${CHECKSUMS_FILE_NAME} illisible (GitHub a répondu ${sums.status}) ; empreinte SHA-256 non affichée.`);
      } else {
        sha256 = checksumFor(await readBounded(sums, WINDOWS_RELEASE_LIMITS.maxChecksumBytes), release.installer.name);
        if (!sha256) log(`Version Windows : ${release.installer.name} absent de ${CHECKSUMS_FILE_NAME} ; empreinte SHA-256 non affichée.`);
      }
    } catch {
      log(`Version Windows : ${CHECKSUMS_FILE_NAME} inaccessible ; empreinte SHA-256 non affichée.`);
    }
  }

  const info: WindowsReleaseInfo = {
    available: true,
    version: release.version,
    fileName: release.installer.name,
    downloadUrl: release.installer.downloadUrl,
    sizeBytes: release.installer.size,
    ...(sha256 ? { sha256 } : {}),
    publishedAt: release.publishedAt,
    releaseUrl: `https://github.com/${repo}/releases/tag/${release.tag}`,
    requirements: WINDOWS_REQUIREMENTS,
  };
  return info;
}

/**
 * Installateur Windows de la dernière version STABLE du dépôt `repo` (voir l'en-tête du fichier). Ne lève jamais :
 * toute panne devient { available: false, reason: 'unavailable' }.
 */
export async function fetchLatestWindowsRelease(options: WindowsReleaseOptions): Promise<WindowsReleaseResponse> {
  const { cache, repo } = options;
  const now = options.now ?? Date.now;
  const safeLoad = () => loadRelease(options).catch((): WindowsReleaseResponse => {
    options.log?.('Version Windows indisponible : erreur inattendue.');
    return { available: false, reason: 'unavailable', releasesUrl: releasesPageUrl(repo) };
  });
  if (!cache) return safeLoad();

  const entry = cache.entry;
  if (entry && entry.repo === repo && now() - entry.at < entry.ttl) return entry.value;
  if (cache.pending && cache.pending.repo === repo) return cache.pending.promise;

  const promise = safeLoad().then(value => {
    const at = now();
    if (value.available || value.reason === 'none') {
      cache.lastGood = { repo, at, value };
      // Rien à télécharger : état passager (installateur en cours d'ajout), redemandé au bout d'une minute.
      const ttl = value.available ? WINDOWS_RELEASE_LIMITS.cacheTtlMs : WINDOWS_RELEASE_LIMITS.noneTtlMs;
      cache.entry = { repo, at, ttl, value };
      return value;
    }
    // GitHub indisponible : dernière réponse valide si elle est assez récente ; nouvel essai dans une minute.
    const good = cache.lastGood;
    const served = good && good.repo === repo && at - good.at < WINDOWS_RELEASE_LIMITS.staleMaxMs ? good.value : value;
    cache.entry = { repo, at, ttl: WINDOWS_RELEASE_LIMITS.failureTtlMs, value: served };
    return served;
  }).finally(() => {
    if (cache.pending?.promise === promise) cache.pending = undefined;
  });
  cache.pending = { repo, promise };
  return promise;
}

/** En-tête Cache-Control de la réponse HTTP (cache court tant qu'aucun installateur n'est proposé). */
export function windowsReleaseCacheControl(response: WindowsReleaseResponse): string {
  return response.available ? WINDOWS_RELEASE_CACHE_CONTROL : WINDOWS_RELEASE_SHORT_CACHE_CONTROL;
}
