// Moteur choisi par l'enseignant sur le site web : Magistra locale (IA de cet ordinateur, via l'application Windows)
// ou serveur Magistra en ligne. Mémorisé dans ce navigateur (localStorage « magistra_engine_choice »).
//
// Sans choix enregistré : Magistra locale si ce navigateur est appairé (recommandé), sinon le serveur en ligne. Un
// appairage réussi ou constaté (vérification de l'état) enregistre Magistra locale comme choix
// (adoptLocalChoiceAfterPairing), sauf choix déjà fait.
// Seul un choix EXPLICITE de l'enseignant (setEngineChoice) fait passer de l'un à l'autre : aucun code ne bascule
// silencieusement du local vers un tiers, même quand Magistra locale est injoignable.

import { useSyncExternalStore } from 'react';

export type EngineChoice = 'local' | 'server';

export const ENGINE_CHOICE_STORAGE_KEY = 'magistra_engine_choice';

const listeners = new Set<() => void>();
/** Choix gardé en mémoire quand le stockage du navigateur est indisponible (navigation privée stricte). */
let memoryChoice: EngineChoice | null = null;
/** Stockage du navigateur inutilisable pendant cette visite : la mémoire fait foi. */
let storageBroken = false;

function isEngineChoice(value: unknown): value is EngineChoice {
  return value === 'local' || value === 'server';
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Choix enregistré, ou null (aucun choix, ou valeur illisible). */
function readStoredChoice(): EngineChoice | null {
  if (storageBroken) return memoryChoice;
  const store = storage();
  if (!store) return memoryChoice;
  try {
    const value = store.getItem(ENGINE_CHOICE_STORAGE_KEY);
    return isEngineChoice(value) ? value : null;
  } catch {
    return memoryChoice;
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent): void {
  // Autre onglet : choix modifié, ou stockage entièrement vidé (key === null).
  if (event.key === ENGINE_CHOICE_STORAGE_KEY || event.key === null) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Choix enregistré (localStorage 'magistra_engine_choice'), sinon : appairé → 'local', sinon 'server'. */
export function getEngineChoice(paired: boolean): EngineChoice {
  return readStoredChoice() ?? (paired ? 'local' : 'server');
}

/** Enregistre le choix EXPLICITE de l'enseignant et prévient les abonnés (cet onglet ; les autres par « storage »). */
export function setEngineChoice(choice: EngineChoice): void {
  if (!isEngineChoice(choice)) return;
  memoryChoice = choice;
  const store = storage();
  if (!store) {
    storageBroken = true;
  } else {
    try {
      store.setItem(ENGINE_CHOICE_STORAGE_KEY, choice);
    } catch {
      // Stockage plein ou refusé : le choix vaut pour cette visite.
      storageBroken = true;
    }
  }
  notify();
}

/**
 * Appairage réussi : sans choix enregistré, Magistra locale devient le choix EXPLICITE de ce navigateur. Sans cela, le
 * choix par défaut suivrait l'appairage : une autorisation retirée dans l'application (ou un appairage oublié) ferait
 * passer d'elle-même la génération suivante au serveur en ligne, chez un tiers. Magistra locale reste donc choisie
 * (« non prête », cause affichée) jusqu'à ce que l'enseignant choisisse lui-même le serveur (avec confirmation).
 * Un choix déjà enregistré — le serveur en ligne compris — n'est jamais modifié.
 */
export function adoptLocalChoiceAfterPairing(): void {
  if (readStoredChoice() === null) setEngineChoice('local');
}

function serverSnapshot(): EngineChoice | null {
  return null;
}

/** [choix courant, setEngineChoice] ; suit les changements de cet onglet et des autres. */
export function useEngineChoice(paired: boolean): [EngineChoice, (choice: EngineChoice) => void] {
  const stored = useSyncExternalStore(subscribe, readStoredChoice, serverSnapshot);
  return [stored ?? (paired ? 'local' : 'server'), setEngineChoice];
}

/** Réservé aux tests : oublie le choix gardé en mémoire. */
export function resetEngineChoiceMemory(): void {
  memoryChoice = null;
  storageBroken = false;
}
