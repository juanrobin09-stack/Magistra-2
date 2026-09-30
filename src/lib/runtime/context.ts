import { createContext, useContext } from 'react';
import type { ProviderInfo } from '@shared/types';
import type { RuntimeMode, RuntimeValue } from './types';
import { BUILD_CLERK_PUBLISHABLE_KEY, getRuntimeConfig } from './mode';

export const RuntimeContext = createContext<RuntimeValue | null>(null);

export function useRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime doit être utilisé dans un RuntimeProvider.');
  return value;
}

/** Clé publiable Clerk fournie au build (repli quand le serveur ne la communique pas via /api/mode). */
export const CLERK_PUBLISHABLE_KEY: string | undefined = BUILD_CLERK_PUBLISHABLE_KEY;

/**
 * Mode d'exécution découvert au démarrage (main.tsx) : Windows (Electron) → local ; serveur personnel →
 * personal ; site avec Clerk → web ; sinon → démonstration. Avant la découverte : détection statique.
 */
export function detectMode(): RuntimeMode {
  return getRuntimeConfig().mode;
}

/** Contact de l'administrateur du site (GET /api/mode), s'il est configuré. */
export function adminContact(): string | undefined {
  return getRuntimeConfig().adminContact;
}

/**
 * Prestataire d'IA annoncé par le serveur au démarrage (GET /api/mode), sans attendre /api/status : la page Générer
 * nomme ainsi le destinataire des textes même si la vérification tarde ou échoue.
 */
export function configuredProvider(): ProviderInfo | undefined {
  return getRuntimeConfig().providerInfo;
}

/** Variante tolérante : null hors d'un contexte runtime (pages publiques du site web). */
export function useOptionalRuntime(): RuntimeValue | null {
  return useContext(RuntimeContext);
}
