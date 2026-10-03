// Dernière version STABLE de l'application Windows (GET /api/windows-release, route publique du serveur Magistra).
//
// La réponse est revérifiée ici champ par champ (seul un lien https vers les versions du dépôt sur github.com est
// retenu, empreinte en hexadécimal strict…). Le bouton « Télécharger » télécharge TOUJOURS un fichier, jamais une page
// GitHub, et passe dès que possible par le lien DU SITE (/telecharger, redirection du serveur vers le fichier) :
//  - version connue : le lien du site, qui renvoie à son installateur (Magistra-Setup-X.Y.Z.exe) ;
//  - GitHub momentanément injoignable depuis le serveur : le lien du site, qui renvoie à l'installateur de la dernière
//    version stable sous son nom fixe ;
//  - réponse absente, illisible ou inattendue (hébergement statique sans API, 404, erreur réseau, délai dépassé) :
//    l'installateur de la dernière version stable sous son nom fixe (WINDOWS_DOWNLOAD_URL, publié par release.yml) ;
//  - aucune version stable publiée : rien à télécharger, le bouton est inactif et le dit.

import { useEffect, useState } from 'react';
import type { API_ROUTES, WindowsReleaseInfo, WindowsReleaseResponse } from '@shared/apiContract';
import { safeExternalUrl, WINDOWS_DOWNLOAD_URL, WINDOWS_RELEASES_URL } from '@/lib/links';

/**
 * Route de la dernière version (celle de API_ROUTES, vérifiée par le type). Importer API_ROUTES lui-même embarquerait
 * toutes les routes du serveur dans le site vitrine, qui n'en appelle qu'une.
 */
const WINDOWS_RELEASE_ROUTE: typeof API_ROUTES.windowsRelease = '/api/windows-release';

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
  /**
   * Version exacte inconnue (serveur ou GitHub injoignable, hébergement sans API) : téléchargement direct de
   * l'installateur de la dernière version stable, sous son nom fixe — sans taille ni version à annoncer.
   */
  | { status: 'direct'; downloadUrl: string }
  /** Aucune version stable publiée (réponse sûre du serveur) : rien à télécharger, jamais un renvoi vers une page vide. */
  | { status: 'none' };

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
    return { available: false, reason: raw.reason, releasesUrl: githubUrl(raw.releasesUrl, '/releases') ?? WINDOWS_RELEASES_URL };
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
  const releaseUrl = githubUrl(raw.releaseUrl, '/releases') ?? WINDOWS_RELEASES_URL;
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

/**
 * Lien de téléchargement DU SITE (GET /telecharger, server/handlers.ts : redirection vers le fichier de la dernière
 * version) : c'est lui que le bouton affiche et que l'on partage ; le clic télécharge l'installateur sans quitter la page.
 * Il n'existe que là où le serveur du site répond : il n'est donc proposé qu'après une réponse de GET /api/windows-release.
 */
export const SITE_DOWNLOAD_PATH = '/telecharger';

/**
 * Lien de l'installateur à télécharger ; undefined pendant la recherche de la version ou si aucune n'est publiée.
 * Version connue : le lien du site ; sinon le lien retenu par fetchWindowsRelease (celui du site si son serveur a
 * répondu, le fichier sous son nom fixe s'il est injoignable).
 */
export function installerUrl(release: WindowsReleaseState): string | undefined {
  if (release.status === 'ready') return SITE_DOWNLOAD_PATH;
  if (release.status === 'direct') return release.downloadUrl;
  return undefined;
}

/** Version inconnue : téléchargement direct de la dernière version stable (nom fixe), par défaut sans passer par le site. */
function direct(downloadUrl: string = WINDOWS_DOWNLOAD_URL): WindowsReleaseState {
  return { status: 'direct', downloadUrl };
}

/** Interroge le serveur Magistra ; ne lève jamais (repli : téléchargement direct de la dernière version stable). */
export async function fetchWindowsRelease(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = WINDOWS_RELEASE_TIMEOUT_MS,
): Promise<WindowsReleaseState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(WINDOWS_RELEASE_ROUTE, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return direct();
    const parsed = parseWindowsRelease(await res.json());
    if (!parsed) return direct();
    if (parsed.available) return { status: 'ready', release: parsed };
    // GitHub injoignable depuis le serveur : le serveur, lui, répond ; son lien renvoie au fichier sous son nom fixe.
    return parsed.reason === 'none' ? { status: 'none' } : direct(SITE_DOWNLOAD_PATH);
  } catch {
    return direct();
  } finally {
    clearTimeout(timer);
  }
}

/** Une seule requête par visite (la réponse change rarement ; le serveur la met déjà en cache). */
let shared: Promise<WindowsReleaseState> | null = null;

function loadShared(): Promise<WindowsReleaseState> {
  shared ??= fetchWindowsRelease().then(state => {
    // Version inconnue (échec passager) ou pas encore publiée : une prochaine page redemandera.
    if (state.status !== 'ready') shared = null;
    return state;
  });
  return shared;
}

/** Réservé aux tests : oublie la réponse gardée pour la visite. */
export function resetWindowsReleaseCache(): void {
  shared = null;
}

/**
 * Dernière version publiée. Le site en démonstration la demande aussi : le site public sans comptes garde son API (seul
 * un hébergement statique n'en a pas, et sa réponse 404 ou HTML donne le téléchargement direct). `enabled` faux
 * (application Windows, déjà installée) : aucune requête, téléchargement direct de la dernière version stable.
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
  if (!enabled) return direct();
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
