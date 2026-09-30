// Mode démonstration (site sans authentification configurée).
// Honnête : exemples pré-rédigés, aucune IA ; historique et favoris réellement conservés dans ce navigateur.

import { EXAMPLE_NOTICE, runDemoGeneration } from '@shared/demo';
import { MagistraError } from '@shared/errors';
import { getMatiereLabel, getToolLabel } from '@shared/catalog';
import { getNiveauLabel } from '@shared/levels';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, GenerationSummary, HistoryPage, TeacherProfile, UsageStats,
} from '@shared/types';
import { displaySujet, safeStoredProfile } from '@shared/validation';
import { computeStats, excerptOf, paginate } from './history';
import type { DataStore, GenerationClient } from './types';

const HISTORY_KEY = 'magistra_demo_history_v2';
const PROFILE_KEY = 'magistra_demo_profile_v2';
const LEGACY_PROFILE_KEY = 'magistra_teacher_profile';
const MAX_ITEMS = 200;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw new MagistraError('STORAGE_ERROR', 'Espace de stockage du navigateur plein : supprimez des éléments de l’historique.', { cause: err });
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DemoDataStore implements DataStore {
  readonly kind = 'demo' as const;

  private all(): GenerationRecord[] {
    return read<GenerationRecord[]>(HISTORY_KEY, []);
  }

  add(record: Omit<GenerationRecord, 'id' | 'createdAt' | 'isFavorite'>): GenerationRecord {
    const full: GenerationRecord = { ...record, id: newId(), createdAt: new Date().toISOString(), isFavorite: false };
    const items = [full, ...this.all()].slice(0, MAX_ITEMS);
    write(HISTORY_KEY, items);
    return full;
  }

  async listGenerations(query: { favoritesOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<HistoryPage> {
    const summaries: GenerationSummary[] = this.all()
      .filter(r => !query.favoritesOnly || r.isFavorite)
      .map(r => ({
        id: r.id, createdAt: r.createdAt, type: r.type, niveau: r.niveau, matiere: r.matiere,
        discipline: r.discipline, sujet: r.sujet, isFavorite: r.isFavorite, excerpt: excerptOf(r.contenu),
      }));
    return paginate(summaries, query.cursor, query.limit);
  }

  async getGeneration(id: string): Promise<GenerationRecord> {
    const found = this.all().find(r => r.id === id);
    if (!found) throw new MagistraError('NOT_FOUND');
    return found;
  }

  async setFavorite(id: string, value: boolean): Promise<void> {
    const items = this.all();
    const item = items.find(r => r.id === id);
    if (!item) throw new MagistraError('NOT_FOUND');
    item.isFavorite = value;
    write(HISTORY_KEY, items);
  }

  async deleteGeneration(id: string): Promise<void> {
    write(HISTORY_KEY, this.all().filter(r => r.id !== id));
  }

  async getStats(): Promise<UsageStats> {
    return computeStats(this.all());
  }

  async getProfile(): Promise<TeacherProfile | null> {
    // Données du navigateur : relues et validées (un profil modifié ou corrompu ne fait rien planter).
    const profile = safeStoredProfile(read<unknown>(PROFILE_KEY, null));
    if (profile) return profile;
    // Reprise de l'ancien profil (versions précédentes de Magistra).
    const raw = read<{ niveaux?: unknown } | null>(LEGACY_PROFILE_KEY, null);
    const legacy = raw && Array.isArray(raw.niveaux) ? safeStoredProfile(raw) : null;
    if (legacy) {
      write(PROFILE_KEY, legacy);
      return legacy;
    }
    return null;
  }

  async saveProfile(profile: TeacherProfile | null): Promise<void> {
    if (profile) write(PROFILE_KEY, profile);
    else {
      try {
        localStorage.removeItem(PROFILE_KEY);
        localStorage.removeItem(LEGACY_PROFILE_KEY);
        localStorage.removeItem('magistra_onboarding_done');
      } catch {
        // ignore
      }
    }
  }

  async clearAllData(): Promise<void> {
    try {
      for (const key of [HISTORY_KEY, PROFILE_KEY, LEGACY_PROFILE_KEY, 'magistra_onboarding_done', 'magistra_contents', 'magistra_api_key']) {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }
}

export class DemoGenerationClient implements GenerationClient {
  readonly kind = 'demo' as const;
  private readonly store: DemoDataStore;

  constructor(store: DemoDataStore) {
    this.store = store;
  }

  async capabilities(): Promise<Capabilities> {
    return {
      maxDocumentChars: 40_000,
      research: { academic: false, web: false, institutional: false, wikipedia: false },
      privacy: {
        level: 'demo',
        message: "Mode démonstration : exemples pré-rédigés, aucune IA n'est utilisée. Vos données restent dans ce navigateur.",
      },
      engineLabel: 'Démonstration',
      ready: true,
    };
  }

  async generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    for await (const event of runDemoGeneration(request, { signal })) {
      if (event.type !== 'done') {
        onEvent(event);
        continue;
      }
      try {
        const record = this.store.add({
          type: request.type,
          niveau: request.niveau,
          matiere: request.matiere,
          discipline: request.discipline,
          sujet: displaySujet(request, getToolLabel(request.type, request.niveau), getNiveauLabel(request.niveau), getMatiereLabel(request.matiere)),
          contenu: event.content,
          sources: [],
          params: { researchMode: request.researchMode, demo: true },
          model: 'démonstration',
        });
        onEvent({ ...event, saved: true, id: record.id });
      } catch (err) {
        const e = err instanceof MagistraError ? err : new MagistraError('STORAGE_ERROR');
        onEvent({ type: 'warning', code: e.code, message: e.message });
        onEvent(event);
      }
    }
  }
}

/**
 * Application Windows, IA de l'ordinateur pas encore prête : « Voir un exemple pré-rédigé » (page Générer) affiche le
 * MÊME exemple que la démonstration du site (même moteur d'exemples, runDemoGeneration), à la demande explicite de
 * l'enseignant, marqué « Exemple pré-rédigé — ce n'est pas l'IA » (et dans le texte lui-même, copié ou exporté :
 * EXAMPLE_NOTICE). Jamais enregistré : l'historique de l'application ne contient que des contenus générés par l'IA
 * (choix le plus simple et le plus honnête).
 */
export class ExampleGenerationClient implements GenerationClient {
  readonly kind = 'local' as const;

  async capabilities(): Promise<Capabilities> {
    return {
      maxDocumentChars: 0,
      research: { academic: false, web: false, institutional: false, wikipedia: false },
      privacy: { level: 'demo', message: "Exemple pré-rédigé : aucune IA n'est utilisée et rien n'est envoyé." },
      engineLabel: 'Exemple pré-rédigé',
      ready: true,
    };
  }

  async generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    for await (const event of runDemoGeneration(request, { signal, notice: EXAMPLE_NOTICE })) onEvent(event);
  }
}
