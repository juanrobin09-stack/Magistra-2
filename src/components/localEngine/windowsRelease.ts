// Dernière version STABLE de l'application Windows (GET /api/windows-release, route publique du serveur Magistra).
//
// La réponse est revérifiée ici champ par champ (seul un lien https vers les versions du dépôt sur github.com est
// retenu, empreinte en hexadécimal strict…). Toute réponse absente, illisible ou inattendue (hébergement statique
// sans API, 404, erreur réseau, délai dépassé) donne le repli : un lien vers la page des versions (WINDOWS_DOWNLOAD_URL).

import { useEffect, useState } from 'react';
import { API_ROUTES, type WindowsReleaseInfo, type WindowsReleaseResponse } from '@shared/apiContract';
import { safeExternalUrl, WINDOWS_DOWNLOAD_URL } from '@/lib/links';

/** Configuration requise affichée (celle du serveur si elle est lisible). */
export const WINDOWS_REQUIREMENTS_TEXT = 'Windows 10 ou 11 (64 bits)';
/**
 * Délai de la requête : au-delà, le repli est affiché. Au-dessus du budget GitHub du serveur (8 s, après quoi il renvoie
 * sa dernière réponse valide) plus une marge (démarrage à froid de la fonction, trajet), et sous sa durée maximale
 * (15 s, vercel.json) : la réponse du serveur, même tardive, n'est jamais abandonnée en chemin.
 */
export const WINDOWS_RELEASE_TIMEOUT_MS = 12_000;

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const FILE_RE = /^Magistra-Setup-(\d{1,4}\.\d{1,4}\.\d{1,6})\.exe$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const MAX_SIZE_BYTES = 4 * 1024 ** 3;

export type WindowsReleaseState =
  | { status: 'loading' }
  | { status: 'ready'; release: WindowsReleaseInfo }
  /** Aucune version stable publiée (« none ») ou information indisponible (« unavailable ») : lien de repli. */
  | { status: 'fallback'; reason: 'none' | 'unavailable'; releasesUrl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lien https vers github.com uniquement (jamais un autre domaine, jamais d'identifiants dans l'adresse). */
function githubUrl(value: unknown, pathPrefix: string): string | null {
  const href = safeExternalUrl(value);
  if (!href) return null;
  const url = new URL(href);
  if (url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
  return url.pathname.includes(pathPrefix) ? href : null;
}

/** Réponse de GET /api/windows-release vérifiée ; null si elle est inattendue. */
export function parseWindowsRelease(raw: unknown): WindowsReleaseResponse | null {
  if (!isRecord(raw)) return null;
  if (raw.available === false) {
    if (raw.reason !== 'none' && raw.reason !== 'unavailable') return null;
    return { available: false, reason: raw.reason, releasesUrl: githubUrl(raw.releasesUrl, '/releases') ?? WINDOWS_DOWNLOAD_URL };
  }
  if (raw.available !== true) return null;
  const { version, fileName, sizeBytes, sha256, publishedAt, requirements } = raw;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return null;
  const file = typeof fileName === 'string' ? FILE_RE.exec(fileName) : null;
  if (!file || file[1] !== version) return null;
  const downloadUrl = githubUrl(raw.downloadUrl, '/releases/download/');
  if (!downloadUrl || !downloadUrl.endsWith(`/${fileName}`)) return null;
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) return null;
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) return null;
  const releaseUrl = githubUrl(raw.releaseUrl, '/releases') ?? WINDOWS_DOWNLOAD_URL;
  const info: WindowsReleaseInfo = {
    available: true,
    version,
    fileName: fileName as string,
    downloadUrl,
    sizeBytes,
    publishedAt,
    releaseUrl,
    requirements: typeof requirements === 'string' && requirements.trim() && requirements.length <= 80 ? requirements.trim() : WINDOWS_REQUIREMENTS_TEXT,
  };
  if (typeof sha256 === 'string' && SHA256_RE.test(sha256)) info.sha256 = sha256.toLowerCase();
  return info;
}

function fallback(reason: 'none' | 'unavailable', releasesUrl = WINDOWS_DOWNLOAD_URL): WindowsReleaseState {
  return { status: 'fallback', reason, releasesUrl };
}

/** Interroge le serveur Magistra ; ne lève jamais (repli sur la page des versions). */
export async function fetchWindowsRelease(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = WINDOWS_RELEASE_TIMEOUT_MS,
): Promise<WindowsReleaseState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API_ROUTES.windowsRelease, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return fallback('unavailable');
    const parsed = parseWindowsRelease(await res.json());
    if (!parsed) return fallback('unavailable');
    return parsed.available ? { status: 'ready', release: parsed } : fallback(parsed.reason, parsed.releasesUrl);
  } catch {
    return fallback('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/** Une seule requête par visite (la réponse change rarement ; le serveur la met déjà en cache). */
let shared: Promise<WindowsReleaseState> | null = null;

function loadShared(): Promise<WindowsReleaseState> {
  shared ??= fetchWindowsRelease().then(state => {
    // Échec passager : une prochaine page réessaiera.
    if (state.status === 'fallback' && state.reason === 'unavailable') shared = null;
    return state;
  });
  return shared;
}

/** Réservé aux tests : oublie la réponse gardée pour la visite. */
export function resetWindowsReleaseCache(): void {
  shared = null;
}

/**
 * Dernière version publiée. `enabled` faux (site sans API : démonstration, application Windows) : aucune requête,
 * repli immédiat sur la page des versions.
 */
export function useWindowsRelease(enabled: boolean): WindowsReleaseState {
  const [state, setState] = useState<{ enabled: boolean; value: WindowsReleaseState } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadShared().then(value => {
      if (!cancelled) setState({ enabled, value });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  if (!enabled) return fallback('unavailable');
  return state?.enabled ? state.value : { status: 'loading' };
}

// ─── Mise en forme (français) ───────────────────────────────────────────────

/** « 85,3 Mo » (mébioctets, comme l'Explorateur de fichiers de Windows). */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const digits = mb >= 100 ? 0 : 1;
  return `${mb.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}\u00a0Mo`;
}

/** « 29 septembre 2026 » ; date illisible : null. */
export function formatDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
