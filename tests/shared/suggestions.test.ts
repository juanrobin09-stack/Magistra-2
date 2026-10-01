import { describe, expect, it } from 'vitest';
import { getMatieresForNiveau } from '../../shared/catalog';
import { ALL_NIVEAUX } from '../../shared/levels';
import { getSujetSuggestions, nextDeck, pickSuggestions, startDeck } from '../../shared/suggestions';
import { NIVEAU_SETS, SUGGESTIONS_DATA } from '../../shared/suggestionsData';
import { LEGACY_SUGGESTIONS, RENAMED_SUGGESTIONS } from './suggestionsLegacy';

describe('données des idées de sujets', () => {
  it('chaque couple classe x matière proposé (hors « Autre ») a au moins 4 idées', () => {
    const poor: string[] = [];
    for (const niveau of ALL_NIVEAUX) {
      for (const m of getMatieresForNiveau(niveau)) {
        if (m.value === 'autre') continue;
        const n = getSujetSuggestions(m.value, niveau).length;
        if (n < 4) poor.push(`${niveau}/${m.value}: ${n}`);
      }
    }
    expect(poor).toEqual([]);
  });

  it('idées courtes, sans doublon par couple, sans formulation d’outil', () => {
    for (const niveau of ALL_NIVEAUX) {
      for (const m of getMatieresForNiveau(niveau)) {
        const list = getSujetSuggestions(m.value, niveau);
        expect(new Set(list).size, `${niveau}/${m.value}`).toBe(list.length);
        for (const s of list) {
          expect(s.trim(), s).toBe(s);
          expect(s.length, s).toBeGreaterThan(2);
          expect(s.length, s).toBeLessThanOrEqual(60);
          expect(s, s).not.toMatch(/^(Évaluation|Evaluation|Exercices?|Cours|Séquence|Fiche de prép\w*|Corrigé|Appréciations?) sur\b/i);
          expect(s, s).not.toMatch(/\n/);
        }
      }
    }
  });

  it('classes valides et sans doublon ; index d’ensembles cohérents', () => {
    expect(NIVEAU_SETS.length).toBeGreaterThan(0);
    for (const set of NIVEAU_SETS) {
      expect(set.length).toBeGreaterThan(0);
      expect(new Set(set).size).toBe(set.length);
      for (const niveau of set) expect(ALL_NIVEAUX).toContain(niveau);
    }
    for (const [matiere, entries] of Object.entries(SUGGESTIONS_DATA)) {
      for (const [sujet, index] of entries ?? []) {
        expect(NIVEAU_SETS[index], `${matiere} / ${sujet}`).toBeDefined();
      }
    }
  });

  it('seules les classes où la matière est proposée reçoivent des idées', () => {
    for (const niveau of ALL_NIVEAUX) {
      const offered = new Set(getMatieresForNiveau(niveau).map(m => m.value));
      for (const matiere of Object.keys(SUGGESTIONS_DATA) as (keyof typeof SUGGESTIONS_DATA)[]) {
        if (!offered.has(matiere)) expect(getSujetSuggestions(matiere, niveau), `${niveau}/${matiere}`).toEqual([]);
      }
    }
  });

  it('aucune idée de l’ancienne table n’a été perdue (ni reformulée sans trace)', () => {
    const lost: string[] = [];
    for (const [matiere, sujet, niveaux] of LEGACY_SUGGESTIONS) {
      const now = RENAMED_SUGGESTIONS[sujet] ?? sujet;
      for (const niveau of niveaux) {
        if (!getSujetSuggestions(matiere, niveau).includes(now)) lost.push(`${niveau}/${matiere}: ${sujet}`);
      }
    }
    expect(lost).toEqual([]);
    expect(LEGACY_SUGGESTIONS.length).toBeGreaterThan(150);
  });

  it('adaptées à la classe exacte', () => {
    expect(getSujetSuggestions('mathematiques', 'cp')).not.toContain('Le théorème de Pythagore');
    expect(getSujetSuggestions('mathematiques', '4eme')).toContain('Le théorème de Pythagore');
    expect(getSujetSuggestions('histoire_geo', 'cm2')).not.toContain('Les Gaulois');
  });
});

describe('pickSuggestions', () => {
  const ALL = Array.from({ length: 20 }, (_, i) => `Idée ${i}`);

  it('même graine, même tirage ; graines différentes, tirages différents', () => {
    expect(pickSuggestions(ALL, 6, 42)).toEqual(pickSuggestions(ALL, 6, 42));
    const draws = new Set(Array.from({ length: 10 }, (_, seed) => pickSuggestions(ALL, 6, seed).join('|')));
    expect(draws.size).toBeGreaterThan(5);
  });

  it('sans doublon, dans la liste, au plus `count` idées', () => {
    for (let seed = 0; seed < 30; seed++) {
      const picked = pickSuggestions([...ALL, ...ALL.slice(0, 5)], 6, seed);
      expect(picked).toHaveLength(6);
      expect(new Set(picked).size).toBe(6);
      for (const s of picked) expect(ALL).toContain(s);
    }
    expect(pickSuggestions(ALL.slice(0, 3), 6, 1)).toHaveLength(3);
    expect(pickSuggestions([], 6, 1)).toEqual([]);
    expect(pickSuggestions(ALL, 0, 1)).toEqual([]);
  });

  it('sans graine, utilise Math.random', () => {
    const picks = new Set(Array.from({ length: 12 }, () => pickSuggestions(ALL, 6).join('|')));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('ne rend jamais une idée exclue tant qu’il en reste d’autres', () => {
    const exclude = ALL.slice(0, 14);
    for (let seed = 0; seed < 30; seed++) {
      expect(pickSuggestions(ALL, 6, seed, exclude).every(s => !exclude.includes(s))).toBe(true);
    }
  });

  it('liste épuisée : complète avec les idées exclues, sans doublon', () => {
    const exclude = ALL.slice(0, 17); // il n'en reste que 3 hors exclusion
    for (let seed = 0; seed < 30; seed++) {
      const picked = pickSuggestions(ALL, 6, seed, exclude);
      expect(picked).toHaveLength(6);
      expect(new Set(picked).size).toBe(6);
      for (const s of ALL.slice(17)) expect(picked).toContain(s);
    }
  });
});

describe('série d’idées (« Autres idées »)', () => {
  const ALL = Array.from({ length: 14 }, (_, i) => `Idée ${i}`);

  it('ne répète aucune idée tant que la liste n’est pas épuisée, puis recommence sans doublon visible', () => {
    let deck = startDeck(ALL, 6, 7);
    const seen = new Set(deck.shown);
    expect(deck.shown).toHaveLength(6);
    deck = nextDeck(ALL, 6, deck, 8);
    expect(deck.shown.every(s => !seen.has(s))).toBe(true);
    deck.shown.forEach(s => seen.add(s));
    // 2 idées restantes : on les montre, complétées par d'autres, jamais celles qui viennent de disparaître de l'écran.
    const previous = deck.shown;
    deck = nextDeck(ALL, 6, deck, 9);
    expect(deck.shown).toHaveLength(6);
    expect(new Set(deck.shown).size).toBe(6);
    for (const s of ALL.filter(s => !seen.has(s))) expect(deck.shown).toContain(s);
    expect(deck.shown.filter(s => previous.includes(s)).length).toBeLessThanOrEqual(4);
  });

  it('liste de la taille de l’affichage ou moins : rien à renouveler', () => {
    const small = ALL.slice(0, 5);
    const deck = startDeck(small, 6, 1);
    expect(deck.shown.slice().sort()).toEqual(small.slice().sort());
    expect(nextDeck(small, 6, deck, 2).shown.slice().sort()).toEqual(small.slice().sort());
  });
});
