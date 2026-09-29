// Actions de l'enseignant sur Magistra locale (rechercher, connecter, ouvrir, déconnecter), avec l'explication
// OBLIGATOIRE avant la demande d'autorisation du navigateur : quand l'autorisation « applications de cet appareil »
// n'est pas encore accordée (permission 'prompt'), toute action qui joindrait l'application est d'abord mise en
// attente et l'interface explique ce que le navigateur va demander ; l'action ne part qu'après « Continuer ».

import { useCallback, useState } from 'react';
import type { LocalEngineController, LocalEngineState } from '@/lib/localConnector/controller';

export type LocalAction = 'detect' | 'connect' | 'openApp' | 'disconnect';

/** Contrôleurs pour lesquels l'enseignant a lui-même lancé une recherche (« n'est pas encore détectée » ≠ accueil). */
const searched = new WeakSet<LocalEngineController>();

/** L'enseignant a déjà demandé une recherche de Magistra pendant cette visite. */
export function wasSearched(controller: LocalEngineController): boolean {
  return searched.has(controller);
}

export function markSearched(controller: LocalEngineController): void {
  searched.add(controller);
}

/** Lance l'action sur le contrôleur (les erreurs sont déjà traduites en état par le contrôleur). */
export function runLocalAction(controller: LocalEngineController, action: LocalAction): Promise<void> {
  if (action === 'detect' || action === 'openApp' || action === 'connect') markSearched(controller);
  const run = {
    detect: () => controller.detect(),
    connect: () => controller.connect(),
    openApp: () => controller.openApp(),
    disconnect: () => controller.disconnect(),
  }[action];
  return run().catch(() => undefined);
}

export interface LocalActions {
  /** Action en attente de l'explication de l'autorisation du navigateur. */
  pending: LocalAction | null;
  /** Demande une action : explication d'abord si le navigateur va demander l'autorisation. */
  request(action: LocalAction): void;
  /** Lance l'action sans explication (l'explication est déjà affichée à côté du bouton). */
  run(action: LocalAction): void;
  /** « Continuer » : l'action en attente part (la demande du navigateur peut apparaître). */
  confirm(): void;
  cancel(): void;
}

export function useLocalActions(engine: { state: LocalEngineState; controller: LocalEngineController }): LocalActions {
  const { controller } = engine;
  const permission = engine.state.permission;
  const [pending, setPending] = useState<LocalAction | null>(null);

  const run = useCallback((action: LocalAction) => {
    setPending(null);
    void runLocalAction(controller, action);
  }, [controller]);

  const request = useCallback((action: LocalAction) => {
    if (permission === 'prompt') setPending(action);
    else run(action);
  }, [permission, run]);

  const confirm = useCallback(() => {
    if (pending) run(pending);
  }, [pending, run]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, request, run, confirm, cancel };
}
