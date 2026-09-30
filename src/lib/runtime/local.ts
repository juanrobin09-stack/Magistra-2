// Mode Windows local : tout passe par le pont IPC sécurisé (window.magistra).
// Aucun compte, aucune clé, aucune donnée ne quitte l'ordinateur (sauf recherche en ligne choisie).

import { MagistraError, isErrorCode } from '@shared/errors';
import type { MagistraBridge } from '@shared/ipc';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, HistoryPage, TeacherProfile, UsageStats,
} from '@shared/types';
import type { DataStore, GenerationClient } from './types';

export function getBridge(): MagistraBridge | null {
  const w = window as unknown as { magistra?: MagistraBridge };
  return w.magistra?.isElectron ? w.magistra : null;
}

/** Les erreurs IPC arrivent sous forme de message « CODE|message lisible ». */
export function fromIpcError(err: unknown): MagistraError {
  const raw = err instanceof Error ? err.message : String(err);
  const match = /([A-Z_]+)\|([\s\S]+)$/.exec(raw);
  if (match && isErrorCode(match[1])) return new MagistraError(match[1], match[2]);
  return new MagistraError('INTERNAL');
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw fromIpcError(err);
  }
}

export class LocalDataStore implements DataStore {
  readonly kind = 'local' as const;
  private readonly bridge: MagistraBridge;

  constructor(bridge: MagistraBridge) {
    this.bridge = bridge;
  }

  listGenerations(query: { favoritesOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<HistoryPage> {
    return call(() => this.bridge.data.list(query));
  }

  async getGeneration(id: string): Promise<GenerationRecord> {
    const record = await call(() => this.bridge.data.get(id));
    if (!record) throw new MagistraError('NOT_FOUND');
    return record;
  }

  setFavorite(id: string, value: boolean): Promise<void> {
    return call(() => this.bridge.data.setFavorite(id, value));
  }

  deleteGeneration(id: string): Promise<void> {
    return call(() => this.bridge.data.delete(id));
  }

  getStats(): Promise<UsageStats> {
    return call(() => this.bridge.data.stats());
  }

  getProfile(): Promise<TeacherProfile | null> {
    return call(() => this.bridge.profile.get());
  }

  saveProfile(profile: TeacherProfile | null): Promise<void> {
    return call(() => this.bridge.profile.set(profile));
  }

  clearAllData(): Promise<void> {
    return call(() => this.bridge.data.clearAll());
  }
}

export class LocalGenerationClient implements GenerationClient {
  readonly kind = 'local' as const;
  private readonly bridge: MagistraBridge;

  constructor(bridge: MagistraBridge) {
    this.bridge = bridge;
  }

  capabilities(): Promise<Capabilities> {
    return call(() => this.bridge.generation.capabilities());
  }

  generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      let jobId: string | null = null;
      let finished = false;
      const pending: { jobId: string; event: GenerationEvent }[] = [];
      const finish = () => {
        if (finished) return;
        finished = true;
        unsubscribe();
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const handle = (payload: { jobId: string; event: GenerationEvent }) => {
        if (jobId === null) {
          pending.push(payload);
          return;
        }
        if (payload.jobId !== jobId || finished) return;
        onEvent(payload.event);
        if (payload.event.type === 'done' || payload.event.type === 'error') finish();
      };
      const unsubscribe = this.bridge.generation.onEvent(handle);
      const onAbort = () => {
        if (jobId) void this.bridge.generation.cancel(jobId);
      };
      signal.addEventListener('abort', onAbort);

      this.bridge.generation.start(request).then(
        ({ jobId: id }) => {
          jobId = id;
          for (const p of pending.splice(0)) handle(p);
          if (signal.aborted) onAbort();
        },
        err => {
          const e = fromIpcError(err);
          onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
          finish();
        },
      );
    });
  }
}
