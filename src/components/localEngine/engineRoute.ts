// Moteur de la prochaine génération sur le site web (Magistra locale ou serveur en ligne), lu SANS attendre : même
// règle que HybridGenerationClient.route() (choix enregistré, sinon Magistra locale si ce navigateur est appairé,
// sinon serveur en ligne), à partir de l'état du contrôleur. Sert au bandeau de la page Générer, aux réglages et à la
// pastille de la barre latérale ; la page Générer revérifie le moteur réel (hybrid.route()) juste avant d'envoyer.

import { useEffect, useRef } from 'react';
import type { ProviderInfo, Capabilities } from '@shared/types';
import type { LocalEngineController, LocalEngineState } from '@/lib/localConnector/controller';
import { useEngineChoice, type EngineChoice } from '@/lib/localConnector/engineChoice';
import type { EngineRoute } from '@/lib/runtime/hybrid';
import { DEFAULT_SERVER_NAME } from './texts';

export interface EngineRouteInfo {
  /** Moteur de la prochaine génération ; null tant qu'il dépend d'un appairage pas encore vérifié. */
  route: EngineRoute | null;
  /** Choix effectif (enregistré, ou par défaut d'après l'appairage connu). */
  choice: EngineChoice;
  /** L'enseignant a enregistré un choix explicite dans ce navigateur. */
  explicit: boolean;
  setChoice(choice: EngineChoice): void;
}

/**
 * L'appairage indiqué par l'état est-il fiable ? Pendant la toute première vérification (« idle », puis « checking »
 * sans appairage connu), l'état n'a pas encore lu le magasin : « non appairé » n'y veut rien dire. Un appairage
 * annoncé, lui, est toujours réel.
 */
export function pairingKnown(state: LocalEngineState): boolean {
  if (state.kind === 'idle') return false;
  return state.kind !== 'checking' || state.paired;
}

/**
 * `state` null : hors du site web (aucun contrôleur) — le moteur est alors celui du mode d'exécution et `route` vaut
 * null.
 */
export function useEngineRoute(state: LocalEngineState | null): EngineRouteInfo {
  // Les deux lectures ne diffèrent que sans choix enregistré (valeur par défaut « local » si appairé, « serveur »
  // sinon) : égales, elles donnent le choix enregistré.
  const [ifPaired, setChoice] = useEngineChoice(true);
  const [ifUnpaired] = useEngineChoice(false);
  const explicit = ifPaired === ifUnpaired;
  const known = state !== null && pairingKnown(state);
  const choice: EngineChoice = explicit ? ifPaired : state?.paired ? ifPaired : ifUnpaired;
  let route: EngineRoute | null = null;
  if (state) {
    if (explicit) route = ifPaired === 'local' ? 'local-connector' : 'server';
    else if (known) route = state.paired ? 'local-connector' : 'server';
  }
  return { route, choice, explicit, setChoice };
}

/**
 * Clé qui change quand l'état de Magistra locale change (capacités à relire) : sorte, appairage, autorisation,
 * erreur, et état du moteur (prêt, local, libellé, occupé, causes).
 */
export function engineStateKey(state: LocalEngineState): string {
  const s = state.status;
  return JSON.stringify([
    state.kind, state.paired, state.permission, state.error?.code ?? null,
    s ? [s.engine.ready, s.engine.local, s.engine.label, s.busy, s.engine.notReady?.code ?? null, s.engine.warning?.code ?? null] : null,
  ]);
}

/**
 * Prestataire du serveur en ligne à annoncer : fiche de /api/status (capacités du serveur), sinon celle annoncée au
 * démarrage par /api/mode.
 */
export function serverProvider(serverCaps: Capabilities | null, announced: ProviderInfo | undefined): ProviderInfo | undefined {
  return serverCaps?.providerInfo ?? announced;
}

/** Nom du destinataire des textes quand le serveur en ligne génère (« OVHcloud AI Endpoints »…). */
export function serverProviderName(serverCaps: Capabilities | null, announced: ProviderInfo | undefined): string {
  const provider = serverProvider(serverCaps, announced);
  if (provider?.label) return provider.label;
  const label = serverCaps?.engineLabel?.trim();
  return label || DEFAULT_SERVER_NAME;
}

/**
 * Capacités lues pour un autre moteur que celui annoncé (appairage changé dans un autre onglet, état pas encore relu) :
 * l'état de Magistra locale est relu, puis les capacités — une seule fois par écart, jamais de boucle de requêtes.
 */
export function useRouteCapsHeal(
  controller: LocalEngineController | null,
  route: EngineRoute | null,
  caps: Capabilities | null,
  loading: boolean,
  reload: () => void,
): void {
  const healed = useRef('');
  useEffect(() => {
    if (!controller || !route || !caps || loading) return;
    if (caps.route === route) {
      healed.current = '';
      return;
    }
    const mismatch = `${route}>${caps.route ?? ''}`;
    if (healed.current === mismatch) return;
    healed.current = mismatch;
    void controller.refresh();
    reload();
  }, [controller, route, caps, loading, reload]);
}
