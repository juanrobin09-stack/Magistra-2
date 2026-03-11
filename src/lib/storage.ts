import type { GeneratedContent } from '@/types';

const STORAGE_KEYS = {
  API_KEY: 'magistra_api_key',
  CONTENTS: 'magistra_contents',
} as const;

export function saveApiKey(key: string): void {
  try { localStorage.setItem(STORAGE_KEYS.API_KEY, key); } catch { /* storage unavailable */ }
}
export function getApiKey(): string | null {
  try { return localStorage.getItem(STORAGE_KEYS.API_KEY); } catch { return null; }
}
export function removeApiKey(): void {
  try { localStorage.removeItem(STORAGE_KEYS.API_KEY); } catch { /* storage unavailable */ }
}

export function saveContent(content: GeneratedContent): void {
  const all = getAllContents();
  all.unshift(content);
  try { localStorage.setItem(STORAGE_KEYS.CONTENTS, JSON.stringify(all.slice(0, 100))); } catch { /* storage full or unavailable */ }
}

export function getAllContents(): GeneratedContent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONTENTS);
    if (!raw) return [];
    return JSON.parse(raw).map((c: GeneratedContent) => ({ ...c, createdAt: new Date(c.createdAt) }));
  } catch { return []; }
}

export function deleteContent(id: string): void {
  const all = getAllContents().filter(c => c.id !== id);
  try { localStorage.setItem(STORAGE_KEYS.CONTENTS, JSON.stringify(all)); } catch { /* noop */ }
}

export function toggleFavorite(id: string): void {
  const all = getAllContents().map(c =>
    c.id === id ? { ...c, isFavorite: !c.isFavorite } : c
  );
  try { localStorage.setItem(STORAGE_KEYS.CONTENTS, JSON.stringify(all)); } catch { /* noop */ }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
