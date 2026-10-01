// Idées de sujets affichées : tirées une seule fois par classe et matière (pas de scintillement à chaque rendu ni à la
// saisie), puis renouvelées à la demande sans répéter celles déjà montrées tant qu'il en reste.

import { useCallback, useState } from 'react';
import { nextDeck, startDeck, type SuggestionDeck } from '@shared/suggestions';

interface DeckState extends SuggestionDeck {
  key: string;
  /** Graine propre à ce tirage ; chaque renouvellement la fait avancer (reproductible si Math.random l'est). */
  seed: number;
}

const newSeed = () => Math.floor(Math.random() * 0x100000000);

function fresh(all: readonly string[], count: number, key: string): DeckState {
  const seed = newSeed();
  return { key, seed, ...startDeck(all, count, seed) };
}

/**
 * `all` : toutes les idées de la classe et de la matière ; `key` change avec elles (nouveau tirage).
 * Retourne les idées à afficher, `canShuffle` (il y en a plus que `count`) et `shuffle` (« Autres idées »).
 */
export function useSuggestionDeck(all: readonly string[], count: number, key: string) {
  const [state, setState] = useState<DeckState>(() => fresh(all, count, key));
  // Changement de classe ou de matière : on repart d'un nouveau tirage, dès ce rendu (pas d'image intermédiaire).
  let current = state;
  if (state.key !== key) {
    current = fresh(all, count, key);
    setState(current);
  }
  const shuffle = useCallback(() => {
    setState(prev => {
      const seed = prev.seed + 1;
      return { key: prev.key, seed, ...nextDeck(all, count, prev, seed) };
    });
  }, [all, count]);
  return { shown: current.shown, canShuffle: new Set(all).size > count, shuffle };
}
