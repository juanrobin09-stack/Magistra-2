// Idées de sujets : toutes celles qui conviennent à la classe exacte, puis tirage aléatoire (reproductible) de quelques-unes.
// Les données (volumineuses) sont dans suggestionsData.ts : ce module n'est importé que par les pages « Générer » et
// « Tableau de bord », jamais par le noyau de l'application (il ne doit pas être ré-exporté par catalog.ts).

import type { Matiere } from './catalog.js';
import type { NiveauScolaire } from './levels.js';
import { NIVEAU_SETS, SUGGESTIONS_DATA } from './suggestionsData.js';

// Pour chaque classe, les ensembles de NIVEAU_SETS qui la contiennent (calculé une fois, à la demande).
const SETS_OF: Partial<Record<NiveauScolaire, ReadonlySet<number>>> = {};

function setsContaining(niveau: NiveauScolaire): ReadonlySet<number> {
  let found = SETS_OF[niveau];
  if (!found) {
    found = new Set(NIVEAU_SETS.flatMap((set, index) => (set.includes(niveau) ? [index] : [])));
    SETS_OF[niveau] = found;
  }
  return found;
}

/** Idées de sujets adaptées à la classe exacte (jamais « Pythagore » en CP, ni en 6e). Vide s'il n'y en a aucune. */
export function getSujetSuggestions(matiere: Matiere, niveau: NiveauScolaire): string[] {
  const sets = setsContaining(niveau);
  return (SUGGESTIONS_DATA[matiere] ?? []).filter(([, set]) => sets.has(set)).map(([sujet]) => sujet);
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) : même graine, même suite. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Tire au hasard `count` idées distinctes de `all`. Avec une graine, le tirage est reproductible ; sans graine, il
 * utilise Math.random. Les idées de `exclude` ne sont reprises que lorsque la liste est épuisée (moins de `count`
 * idées restantes) : on complète alors avec elles, sans doublon. Le résultat compte au plus `count` idées.
 */
export function pickSuggestions(
  all: readonly string[],
  count: number,
  seed?: number,
  exclude: readonly string[] = [],
): string[] {
  const wanted = Math.max(0, Math.floor(count));
  if (wanted === 0) return [];
  const random = seed === undefined ? Math.random : seededRandom(seed);
  const unique = [...new Set(all)];
  const excluded = new Set(exclude);
  const fresh = shuffled(unique.filter(s => !excluded.has(s)), random);
  if (fresh.length >= wanted) return fresh.slice(0, wanted);
  return [...fresh, ...shuffled(unique.filter(s => excluded.has(s)), random)].slice(0, wanted);
}

/** Les idées affichées et celles déjà montrées depuis le début de la série (pour ne pas les répéter). */
export interface SuggestionDeck {
  shown: string[];
  seen: string[];
}

/** Première série d'idées : `count` idées au hasard. */
export function startDeck(all: readonly string[], count: number, seed?: number): SuggestionDeck {
  const shown = pickSuggestions(all, count, seed);
  return { shown, seen: shown };
}

/**
 * Série suivante : `count` idées jamais montrées jusqu'ici. Quand il n'en reste plus assez, on montre ce qui reste puis
 * on complète avec d'autres (jamais celles qui viennent d'être affichées) : une nouvelle série commence.
 */
export function nextDeck(all: readonly string[], count: number, deck: SuggestionDeck, seed?: number): SuggestionDeck {
  const unique = [...new Set(all)];
  if (unique.length <= count) return { shown: unique, seen: unique };
  const seen = new Set(deck.seen);
  const left = unique.filter(s => !seen.has(s));
  if (left.length >= count) {
    const shown = pickSuggestions(left, count, seed);
    return { shown, seen: [...deck.seen, ...shown] };
  }
  const refill = pickSuggestions(unique.filter(s => !left.includes(s)), count - left.length, seed, deck.shown);
  const shown = [...left, ...refill];
  return { shown, seen: shown };
}
