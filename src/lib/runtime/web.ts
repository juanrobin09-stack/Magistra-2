// Mode web : données sur le serveur Magistra (Supabase côté serveur), IA via le serveur configuré
// par l'administrateur. Chaque appel porte le jeton de session Clerk.

import { API_ROUTES, type ServerStatus } from '@shared/apiContract';
import { MagistraError } from '@shared/errors';
import { safeStoredProfile } from '@shared/validation';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, HistoryPage, TeacherProfile, UsageStats,
} from '@shared/types';
import { authedFetch, authedJson, readEventStream, type TokenGetter } from './http';
import type { DataStore, GenerationClient } from './types';

export class ApiDataStore implements DataStore {
  readonly kind = 'web' as const;
  private readonly getToken: TokenGetter;
  private readonly userId: string;

  constructor(getToken: TokenGetter, userId: string) {
    this.getToken = getToken;
    this.userId = userId;
  }

  listGenerations(query: { favoritesOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (query.favoritesOnly) params.set('favorites', '1');
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    return authedJson<HistoryPage>(this.getToken, `${API_ROUTES.history}?${params}`);
  }

  getGeneration(id: string): Promise<GenerationRecord> {
    return authedJson<GenerationRecord>(this.getToken, `${API_ROUTES.generation}?id=${encodeURIComponent(id)}`);
  }

  async setFavorite(id: string, value: boolean): Promise<void> {
    await authedFetch(this.getToken, `${API_ROUTES.generation}?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: value }),
    });
  }

  async deleteGeneration(id: string): Promise<void> {
    await authedFetch(this.getToken, `${API_ROUTES.generation}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getStats(): Promise<UsageStats> {
    // « Aujourd'hui » et « cette semaine » sont calculés dans le fuseau horaire de l'enseignant.
    let tz = 'Europe/Paris';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
    } catch {
      // fuseau par défaut
    }
    return authedJson<UsageStats>(this.getToken, `${API_ROUTES.stats}?tz=${encodeURIComponent(tz)}`);
  }

  private cacheKey(): string {
    return `magistra_profile_${this.userId}`;
  }

  async getProfile(): Promise<TeacherProfile | null> {
    try {
      const { profile } = await authedJson<{ profile: TeacherProfile | null }>(this.getToken, API_ROUTES.profile);
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
      await authedFetch(this.getToken, API_ROUTES.profile, { method: 'PUT', body: JSON.stringify({ profile }) });
    } else {
      await authedFetch(this.getToken, API_ROUTES.profile, { method: 'PUT', body: JSON.stringify({ profile: null }) });
    }
    try {
      if (profile) localStorage.setItem(this.cacheKey(), JSON.stringify(profile));
      else localStorage.removeItem(this.cacheKey());
    } catch {
      // ignore
    }
  }

  async clearAllData(): Promise<void> {
    await authedFetch(this.getToken, API_ROUTES.account, { method: 'DELETE' });
    try {
      localStorage.removeItem(this.cacheKey());
    } catch {
      // ignore
    }
  }
}

export class ApiGenerationClient implements GenerationClient {
  readonly kind = 'web' as const;
  private readonly getToken: TokenGetter;

  constructor(getToken: TokenGetter) {
    this.getToken = getToken;
  }

  async capabilities(): Promise<Capabilities> {
    const status = await authedJson<ServerStatus>(this.getToken, API_ROUTES.status);
    return {
      maxDocumentChars: status.maxDocumentChars,
      // Serveur antérieur sans le champ « wikipedia » : Wikipédia y était toujours actif.
      research: { ...status.research, wikipedia: status.research.wikipedia ?? true },
      privacy: {
        level: 'server',
        message: `Les données utilisées pour la génération (demande et extraits de vos documents) sont transmises au serveur Magistra puis au serveur d'IA configuré par l'administrateur (${status.ai.label}). Vos fichiers originaux ne quittent pas votre navigateur.`,
      },
      engineLabel: status.ai.label,
      ready: status.ai.ok,
    };
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
      const e = err instanceof MagistraError ? err : new MagistraError('NETWORK_ERROR');
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
