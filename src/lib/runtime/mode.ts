// Découverte du mode d'exécution AU DÉMARRAGE (et non plus au moment du build).
//
//  - Application Windows (pont Electron) → « local », sans aucune requête ;
//  - sinon, GET /api/mode (public, sans secret, délai court) :
//      'personal' → mode personnel (serveur sur ce poste, code d'accès, sans compte) ;
//      'clerk'    → site web avec comptes, clé PUBLIABLE reçue du serveur (repli : clé du build) ;
//      'none', échec, délai dépassé, 404 ou page HTML (hébergement statique sans API)
//                 → comportement historique : clé Clerk du build → web, sinon démonstration.

import { API_ROUTES, type AuthMode, type ModeInfo } from '@shared/apiContract';
import type { ProviderInfo } from '@shared/types';
import { parseProviderInfo } from '@/lib/ai-ui/server';
import { getBridge } from './local';
import type { RuntimeMode } from './types';

/** Délai maximal de la découverte : au-delà, l'interface démarre avec le comportement historique. */
export const MODE_DISCOVERY_TIMEOUT_MS = 3000;

/** Clé publiable Clerk fournie au build (VITE_CLERK_PUBLISHABLE_KEY), repli quand le serveur ne la donne pas. */
export const BUILD_CLERK_PUBLISHABLE_KEY: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || undefined;

export interface RuntimeConfig {
  mode: RuntimeMode;
  /** Clé publiable Clerk (mode web uniquement). */
  clerkPublishableKey?: string;
  /** Contact de l'administrateur du site (affiché quand l'IA n'est pas prête), facultatif. */
  adminContact?: string;
  /** Prestataire d'IA de la configuration du serveur (GET /api/mode), annoncé avant la réponse de /api/status. */
  providerInfo?: ProviderInfo;
}

const AUTH_MODES: readonly AuthMode[] = ['clerk', 'personal', 'none'];
/** Clé PUBLIABLE seulement (pk_test_… / pk_live_…) : jamais une clé secrète. */
const PUBLISHABLE_KEY_RE = /^pk_(test|live)_[A-Za-z0-9+/=_-]{4,300}$/;
const ADMIN_CONTACT_MAX = 200;

function cleanAdminContact(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > ADMIN_CONTACT_MAX ? `${text.slice(0, ADMIN_CONTACT_MAX - 1)}…` : text;
}

/** Valide la réponse de GET /api/mode (null si elle est illisible). */
export function parseModeInfo(value: unknown): ModeInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.auth !== 'string' || !AUTH_MODES.includes(v.auth as AuthMode)) return null;
  const info: ModeInfo = { auth: v.auth as AuthMode };
  if (typeof v.clerkPublishableKey === 'string' && PUBLISHABLE_KEY_RE.test(v.clerkPublishableKey.trim())) {
    info.clerkPublishableKey = v.clerkPublishableKey.trim();
  }
  const contact = cleanAdminContact(v.adminContact);
  if (contact) info.adminContact = contact;
  const provider = parseProviderInfo(v.providerInfo);
  if (provider) info.providerInfo = provider;
  return info;
}

/**
 * GET /api/mode avec un délai court. Renvoie null en cas d'échec (réseau, délai dépassé, 404, 500,
 * page HTML d'un hébergement statique, JSON illisible) : l'appelant applique alors le comportement historique.
 */
export async function fetchModeInfo(fetchImpl: typeof fetch = fetch, timeoutMs = MODE_DISCOVERY_TIMEOUT_MS): Promise<ModeInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API_ROUTES.mode, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    return parseModeInfo(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Décision pure : pont Electron > réponse du serveur > clé du build > démonstration. */
export function resolveRuntimeConfig(
  info: ModeInfo | null,
  env: { hasBridge: boolean; buildKey?: string },
): RuntimeConfig {
  if (env.hasBridge) return { mode: 'local' };
  const contact = info?.adminContact ? { adminContact: info.adminContact } : {};
  const provider = info?.providerInfo && info.auth !== 'none' ? { providerInfo: info.providerInfo } : {};
  if (info?.auth === 'personal') return { mode: 'personal', ...contact, ...provider };
  const key = (info?.auth === 'clerk' ? info.clerkPublishableKey : undefined) ?? env.buildKey;
  if (key) return { mode: 'web', clerkPublishableKey: key, ...contact, ...provider };
  return { mode: 'demo', ...contact };
}

/** Découverte complète (appelée une seule fois, avant le premier rendu). */
export async function discoverRuntimeConfig(options: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  hasBridge?: boolean;
  buildKey?: string;
} = {}): Promise<RuntimeConfig> {
  const hasBridge = options.hasBridge ?? getBridge() !== null;
  const buildKey = 'buildKey' in options ? options.buildKey : BUILD_CLERK_PUBLISHABLE_KEY;
  if (hasBridge) return { mode: 'local' };
  const info = await fetchModeInfo(options.fetchImpl ?? fetch, options.timeoutMs);
  return resolveRuntimeConfig(info, { hasBridge, buildKey });
}

let current: RuntimeConfig | null = null;

/** Mémorise le mode découvert (main.tsx, avant le rendu). */
export function setRuntimeConfig(config: RuntimeConfig | null): void {
  current = config;
}

/** Mode courant : celui découvert au démarrage, sinon la détection statique (pont, clé du build). */
export function getRuntimeConfig(): RuntimeConfig {
  return current ?? resolveRuntimeConfig(null, { hasBridge: getBridge() !== null, buildKey: BUILD_CLERK_PUBLISHABLE_KEY });
}
