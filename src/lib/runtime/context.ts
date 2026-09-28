import { createContext, useContext } from 'react';
import type { RuntimeMode, RuntimeValue } from './types';
import { getBridge } from './local';

export const RuntimeContext = createContext<RuntimeValue | null>(null);

export function useRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime doit être utilisé dans un RuntimeProvider.');
  return value;
}

export const CLERK_PUBLISHABLE_KEY: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || undefined;

/** Windows (Electron) → local ; site avec Clerk configuré → web ; sinon → démonstration. */
export function detectMode(): RuntimeMode {
  if (getBridge()) return 'local';
  if (CLERK_PUBLISHABLE_KEY) return 'web';
  return 'demo';
}

/** Variante tolérante : null hors d'un contexte runtime (pages publiques du site web). */
export function useOptionalRuntime(): RuntimeValue | null {
  return useContext(RuntimeContext);
}
