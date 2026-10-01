// Modes web et personnel : données sur le serveur Magistra, IA via le serveur configuré par
// l'administrateur (ou par l'enseignant lui-même en mode personnel). Chaque appel porte le jeton :
// session Clerk (web) ou code d'accès du mode personnel.

import { API_ROUTES, type SaveGenerationBody, type ServerStatus } from '@shared/apiContract';
import { defaultMessage, isErrorCode, MagistraError } from '@shared/errors';
import { safeStoredProfile } from '@shared/validation';
import type {
  AINotice, Capabilities, GenerationEvent, GenerationRecord, GenerationRecordDraft, GenerationRequest, HistoryPage,
  TeacherProfile, UsageStats,
} from '@shared/types';
import { parseProviderInfo, serverPrivacyMessage } from '@/lib/ai-ui/server';
import { authedFetch, authedJson, readEventStream, type TokenGetter } from './http';
import type { DataStore, GenerationClient } from './types';

export type ServerRuntimeKind = 'web' | 'personal';

/** Mode personnel : un 401 signifie que le code d'accès est absent ou refusé (et non une session expirée). */
export const PERSONAL_UNAUTHENTICATED_MESSAGE =
  "Code d'accès refusé : ouvrez à nouveau le lien affiché dans le terminal où Magistra a démarré (ou collez le code d'accès).";

function adaptError(kind: ServerRuntimeKind, err: unknown): unknown {
  if (kind === 'personal' && err instanceof MagistraError && err.code === 'UNAUTHENTICATED') {
    return new MagistraError('UNAUTHENTICATED', PERSONAL_UNAUTHENTICATED_MESSAGE);
  }
  return err;
}

const PROFILE_CACHE_PREFIX = 'magistra_profile_';

/**
 * Efface la copie hors ligne du profil (nom, établissement, matières) de TOUS les comptes de ce navigateur.
 * Appelée à la déconnexion : sur un poste partagé, le collègue suivant ne retrouve rien dans le stockage local.
 * Les autres clés (choix du moteur, appairage…) ne sont pas touchées.
 */
export function clearProfileCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PROFILE_CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // stockage local indisponible : rien à effacer
  }
}

/**
 * Efface seulement sur une vraie transition « utilisateur connecté → plus d'utilisateur ». Le chargement initial
 * (utilisateur encore `undefined`) et une page ouverte sans session n'effacent rien.
 */
export function createSignOutWatcher(onSignOut: () => void): (resources: { user?: { id?: string } | null }) => void {
  let previousUserId: string | null = null;
  return ({ user }) => {
    if (user) {
      previousUserId = user.id ?? 'inconnu';
    } else if (user === null && previousUserId !== null) {
      previousUserId = null;
      onSignOut();
    }
  };
}

export class ApiDataStore implements DataStore {
  readonly kind: ServerRuntimeKind;
  private readonly getToken: TokenGetter;
  private readonly userId: string;

  constructor(getToken: TokenGetter, userId: string, kind: ServerRuntimeKind = 'web') {
    this.getToken = getToken;
    this.userId = userId;
    this.kind = kind;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    try {
      return await authedJson<T>(this.getToken, url, init);
    } catch (err) {
      throw adaptError(this.kind, err);
    }
  }

  private async send(url: string, init: RequestInit): Promise<void> {
    try {
      await authedFetch(this.getToken, url, init);
    } catch (err) {
      throw adaptError(this.kind, err);
    }
  }

  listGenerations(query: { favoritesOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (query.favoritesOnly) params.set('favorites', '1');
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    return this.json<HistoryPage>(`${API_ROUTES.history}?${params}`);
  }

  getGeneration(id: string): Promise<GenerationRecord> {
    return this.json<GenerationRecord>(`${API_ROUTES.generation}?id=${encodeURIComponent(id)}`);
  }

  /**
   * Enregistre dans l'historique du compte une génération faite par Magistra locale (connecteur local) : résultat,
   * sources citées et paramètres de la demande (sujet, consignes, contenu à adapter, noms des documents…), jamais le
   * texte des extraits de documents ni le travail d'élève (POST /api/generation).
   */
  async saveGenerationDraft(draft: GenerationRecordDraft): Promise<{ id: string }> {
    const body: SaveGenerationBody = { record: draft };
    const result = await this.json<{ id?: unknown }>(API_ROUTES.generation, { method: 'POST', body: JSON.stringify(body) });
    if (!result || typeof result.id !== 'string' || !result.id) throw new MagistraError('STORAGE_ERROR');
    return { id: result.id };
  }

  async setFavorite(id: string, value: boolean): Promise<void> {
    await this.send(`${API_ROUTES.generation}?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: value }),
    });
  }

  async deleteGeneration(id: string): Promise<void> {
    await this.send(`${API_ROUTES.generation}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getStats(): Promise<UsageStats> {
    // « Aujourd'hui » et « cette semaine » sont calculés dans le fuseau horaire de l'enseignant.
    let tz = 'Europe/Paris';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
    } catch {
      // fuseau par défaut
    }
    return this.json<UsageStats>(`${API_ROUTES.stats}?tz=${encodeURIComponent(tz)}`);
  }

  private cacheKey(): string {
    return `${PROFILE_CACHE_PREFIX}${this.userId}`;
  }

  async getProfile(): Promise<TeacherProfile | null> {
    try {
      const { profile } = await this.json<{ profile: TeacherProfile | null }>(API_ROUTES.profile);
      try {
        if (profile) localStorage.setItem(this.cacheKey(), JSON.stringify(profile));
        else localStorage.removeItem(this.cacheKey());
      } catch {
        // stockage local indisponible : sans incidence
      }
      return profile;
    } catch (err) {
      // Hors ligne : on retombe sur la copie locale de CE compte (jamais celle d'un autre utilisateur).
      if (err instanceof MagistraError && err.code === 'NETWORK_ERROR') {
        try {
          const cached = localStorage.getItem(this.cacheKey());
          if (cached) {
            const profile = safeStoredProfile(JSON.parse(cached));
            if (profile) return profile;
          }
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  async saveProfile(profile: TeacherProfile | null): Promise<void> {
    if (profile) {
      await this.send(API_ROUTES.profile, { method: 'PUT', body: JSON.stringify({ profile }) });
    } else {
      await this.send(API_ROUTES.profile, { method: 'PUT', body: JSON.stringify({ profile: null }) });
    }
    try {
      if (profile) localStorage.setItem(this.cacheKey(), JSON.stringify(profile));
      else localStorage.removeItem(this.cacheKey());
    } catch {
      // ignore
    }
  }

  async clearAllData(): Promise<void> {
    await this.send(API_ROUTES.account, { method: 'DELETE' });
    try {
      localStorage.removeItem(this.cacheKey());
    } catch {
      // ignore
    }
  }
}

function cleanNotice(value: unknown): AINotice | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!isErrorCode(v.code)) return undefined;
  return { code: v.code, message: typeof v.message === 'string' && v.message.trim() ? v.message : defaultMessage(v.code) };
}

/**
 * Capacités du serveur Magistra (GET /api/status) : IA prête ou non, avec la CAUSE précise,
 * avertissement non bloquant, et prestataire qui reçoit réellement les textes.
 */
export function serverCapabilities(status: ServerStatus): Capabilities {
  const ai = status.ai;
  const providerInfo = parseProviderInfo(ai.providerInfo);
  const ready = ai.ok === true;
  const caps: Capabilities = {
    maxDocumentChars: status.maxDocumentChars,
    // Serveur antérieur sans le champ « wikipedia » : Wikipédia y était toujours actif.
    research: { ...status.research, wikipedia: status.research.wikipedia ?? true },
    privacy: { level: 'server', message: serverPrivacyMessage(ai.label, providerInfo) },
    engineLabel: providerInfo?.label ?? ai.label,
    ready,
  };
  if (!ready) {
    const code = isErrorCode(ai.code) ? ai.code : 'AI_SERVER_UNAVAILABLE';
    caps.notReady = { code, message: typeof ai.message === 'string' && ai.message.trim() ? ai.message : defaultMessage(code) };
  } else {
    const warning = cleanNotice(ai.warning);
    if (warning) caps.aiWarning = warning;
  }
  if (providerInfo) caps.providerInfo = providerInfo;
  return caps;
}

export class ApiGenerationClient implements GenerationClient {
  readonly kind: ServerRuntimeKind;
  private readonly getToken: TokenGetter;

  constructor(getToken: TokenGetter, kind: ServerRuntimeKind = 'web') {
    this.getToken = getToken;
    this.kind = kind;
  }

  async capabilities(): Promise<Capabilities> {
    try {
      return serverCapabilities(await authedJson<ServerStatus>(this.getToken, API_ROUTES.status));
    } catch (err) {
      throw adaptError(this.kind, err);
    }
  }

  async generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await authedFetch(this.getToken, API_ROUTES.generate, {
        method: 'POST',
        body: JSON.stringify(request),
        signal,
        headers: { Accept: 'application/x-ndjson' },
      });
    } catch (err) {
      const adapted = adaptError(this.kind, err);
      const e = adapted instanceof MagistraError ? adapted : new MagistraError('NETWORK_ERROR');
      onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
      return;
    }
    try {
      await readEventStream(res, onEvent, signal);
    } catch (err) {
      const e = err instanceof MagistraError ? err : new MagistraError('NETWORK_ERROR');
      onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
    }
  }
}
