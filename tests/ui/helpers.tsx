// Outils de test minimalistes (sans @testing-library) : rendu React 19 dans jsdom + évènements.

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GenerationRecord, GenerationSummary, HistoryPage, TeacherProfile, UsageStats } from '@shared/types';
import { paginate, computeStats, excerptOf } from '@/lib/runtime/history';
import type { DataStore, GenerationClient, RuntimeMode, RuntimeValue } from '@/lib/runtime/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLDivElement;
  root: Root;
  rerender: (ui: ReactElement) => Promise<void>;
  unmount: () => void;
}

const mounted: Rendered[] = [];

export async function render(ui: ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  const rendered: Rendered = {
    container,
    root,
    rerender: async next => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(rendered);
  return rendered;
}

export function cleanup(): void {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
}

/** Laisse les promesses (chargements simulés) se résoudre. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('Élément introuvable pour le clic');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    (el as HTMLElement).click();
  });
}

export async function keyDown(el: Element | null, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  if (!el) throw new Error(`Élément introuvable pour la touche ${key}`);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event;
}

export async function typeInto(input: HTMLInputElement | null, value: string): Promise<void> {
  if (!input) throw new Error('Champ introuvable');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function byText<T extends Element = HTMLElement>(root: ParentNode, selector: string, text: string | RegExp): T | null {
  const els = Array.from(root.querySelectorAll<T>(selector));
  return els.find(el => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? ''))) ?? null;
}

export function button(root: ParentNode, text: string | RegExp): HTMLButtonElement | null {
  return byText<HTMLButtonElement>(root, 'button', text);
}

// ─── Faux runtime ───────────────────────────────────────────────────────────

export function makeRecord(i: number, patch: Partial<GenerationRecord> = {}): GenerationRecord {
  const createdAt = new Date(Date.UTC(2026, 8, 28, 12, 0, 0) - i * 3_600_000).toISOString();
  return {
    id: `gen-${i}`,
    createdAt,
    type: 'cours',
    niveau: '4eme',
    matiere: 'mathematiques',
    sujet: `Sujet ${i}`,
    contenu: `# Titre ${i}\n\nContenu numéro ${i}.`,
    isFavorite: false,
    sources: [],
    params: {},
    ...patch,
  };
}

function toSummary(r: GenerationRecord): GenerationSummary {
  return {
    id: r.id, createdAt: r.createdAt, type: r.type, niveau: r.niveau, matiere: r.matiere,
    discipline: r.discipline, sujet: r.sujet, isFavorite: r.isFavorite, excerpt: excerptOf(r.contenu),
  };
}

/** Magasin en mémoire (pagination par décalage, comme le mode démonstration). */
export class MemoryStore implements DataStore {
  readonly kind = 'demo' as const;
  records: GenerationRecord[];
  profile: TeacherProfile | null;
  calls: { method: string; args: unknown[] }[] = [];
  failures: Partial<Record<keyof DataStore, number>> = {};

  constructor(records: GenerationRecord[] = [], profile: TeacherProfile | null = null) {
    this.records = records;
    this.profile = profile;
  }

  private maybeFail(method: keyof DataStore): void {
    const left = this.failures[method] ?? 0;
    if (left > 0) {
      this.failures[method] = left - 1;
      const err = new Error('Échec simulé');
      (err as Error & { name: string }).name = 'SimulatedError';
      throw err;
    }
  }

  async listGenerations(query: { favoritesOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<HistoryPage> {
    this.calls.push({ method: 'listGenerations', args: [query] });
    this.maybeFail('listGenerations');
    const items = this.records.filter(r => !query.favoritesOnly || r.isFavorite).map(toSummary);
    return paginate(items, query.cursor, query.limit);
  }

  async getGeneration(id: string): Promise<GenerationRecord> {
    this.calls.push({ method: 'getGeneration', args: [id] });
    this.maybeFail('getGeneration');
    const found = this.records.find(r => r.id === id);
    if (!found) {
      const { MagistraError } = await import('@shared/errors');
      throw new MagistraError('NOT_FOUND');
    }
    return { ...found };
  }

  async setFavorite(id: string, value: boolean): Promise<void> {
    this.calls.push({ method: 'setFavorite', args: [id, value] });
    this.maybeFail('setFavorite');
    const found = this.records.find(r => r.id === id);
    if (found) found.isFavorite = value;
  }

  async deleteGeneration(id: string): Promise<void> {
    this.calls.push({ method: 'deleteGeneration', args: [id] });
    this.maybeFail('deleteGeneration');
    this.records = this.records.filter(r => r.id !== id);
  }

  async getStats(): Promise<UsageStats> {
    this.calls.push({ method: 'getStats', args: [] });
    this.maybeFail('getStats');
    return computeStats(this.records);
  }

  async getProfile(): Promise<TeacherProfile | null> {
    return this.profile;
  }

  async saveProfile(profile: TeacherProfile | null): Promise<void> {
    this.calls.push({ method: 'saveProfile', args: [profile] });
    this.maybeFail('saveProfile');
    this.profile = profile;
  }

  async clearAllData(): Promise<void> {
    this.records = [];
    this.profile = null;
  }
}

const stubClient: GenerationClient = {
  kind: 'demo',
  capabilities: async () => ({
    maxDocumentChars: 1000,
    research: { academic: false, web: false, institutional: false, wikipedia: false },
    privacy: { level: 'demo', message: '' },
    engineLabel: 'Test',
    ready: true,
  }),
  generate: async () => undefined,
};

export function fakeRuntime(store: MemoryStore, overrides: Partial<RuntimeValue> & { mode?: RuntimeMode } = {}): RuntimeValue {
  return {
    mode: 'demo',
    store,
    client: stubClient,
    user: null,
    profile: store.profile,
    profileStatus: 'ready',
    profileError: null,
    saveProfile: async p => store.saveProfile(p),
    reloadProfile: async () => undefined,
    ...overrides,
  };
}

export const PROFILE_COLLEGE: TeacherProfile = {
  displayName: 'M. Martin',
  etablissement: 'Collège Victor Hugo',
  cycle: 'college',
  niveaux: ['4eme'],
  matierePrincipale: 'mathematiques',
};
