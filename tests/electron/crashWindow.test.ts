// Arrêts du processus d'affichage : fenêtre glissante (une boucle de plantages est fatale, des plantages espacés non).

import { describe, expect, it } from 'vitest';
import { RENDERER_CRASH_WINDOW_MS, RENDERER_MAX_RELOADS, recordRendererCrash } from '../../electron/crashWindow.js';

describe('recordRendererCrash', () => {
  it('quatre plantages en une minute : le quatrième est fatal', () => {
    const crashes: number[] = [];
    const t0 = 1_000_000;
    const answers = [0, 15_000, 30_000, 45_000].map(dt => recordRendererCrash(crashes, t0 + dt));
    expect(answers).toEqual([true, true, true, false]);
  });

  it('plantages espacés de plus de la fenêtre : on recharge toujours (même après des jours)', () => {
    const crashes: number[] = [];
    let t = 1_000_000;
    for (let i = 0; i < 20; i++) {
      expect(recordRendererCrash(crashes, t), `plantage ${i + 1}`).toBe(true);
      t += RENDERER_CRASH_WINDOW_MS + 1_000;
    }
    expect(crashes).toHaveLength(1);
  });

  it('les plantages anciens sortent de la fenêtre au fil du temps', () => {
    const crashes: number[] = [];
    const t0 = 5_000_000;
    for (let i = 0; i < RENDERER_MAX_RELOADS; i++) expect(recordRendererCrash(crashes, t0 + i)).toBe(true);
    // Le suivant, plus de 5 minutes après les premiers, est accepté.
    expect(recordRendererCrash(crashes, t0 + RENDERER_CRASH_WINDOW_MS + 10)).toBe(true);
  });
});
