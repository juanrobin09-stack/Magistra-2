import { describe, expect, it } from 'vitest';
import {
  cleanEnginePlacement, cleanEngineTimings, MAX_ENGINE_DURATION_MS, ollamaTimingsFromChunk, placementFromPs,
} from '../../shared/ai/timings';

/** Dernier objet réel d'un /api/chat d'Ollama (durées en NANOSECONDES). */
const FINAL = {
  model: 'ministral-3:3b',
  done: true,
  done_reason: 'stop',
  total_duration: 48_123_456_789,
  load_duration: 1_234_567_890,
  prompt_eval_count: 321,
  prompt_eval_duration: 2_500_000_000,
  eval_count: 45,
  eval_duration: 4_500_000_000,
};

describe('ollamaTimingsFromChunk — durées en nanosecondes lues en millisecondes', () => {
  it('dernier objet complet : millisecondes arrondies, jetons par seconde calculés sur les durées exactes', () => {
    expect(ollamaTimingsFromChunk(FINAL)).toEqual({
      totalMs: 48_123,
      loadMs: 1_235,
      promptTokens: 321,
      promptMs: 2_500,
      promptTokensPerSecond: 128.4,
      outputTokens: 45,
      outputMs: 4_500,
      tokensPerSecond: 10,
    });
  });

  it('jetons déjà en mémoire (prompt_eval_cached_count, réponse réelle d’Ollama 0.34.4) : hors de la vitesse de lecture', () => {
    // 544 jetons dont 534 déjà en mémoire, lus en 0,29 s : seuls 10 jetons ont été lus, soit ≈ 35 jetons/s (et non 1 878).
    const timings = ollamaTimingsFromChunk({
      ...FINAL, prompt_eval_count: 544, prompt_eval_cached_count: 534, prompt_eval_duration: 289_725_000,
    });
    expect(timings).toMatchObject({ promptTokens: 544, promptCachedTokens: 534, promptMs: 290, promptTokensPerSecond: 34.5 });
    // Rien en mémoire (champ à 0 ou absent) : aucun champ « promptCachedTokens ».
    expect(ollamaTimingsFromChunk({ ...FINAL, prompt_eval_cached_count: 0 })).not.toHaveProperty('promptCachedTokens');
    expect(ollamaTimingsFromChunk(FINAL)).not.toHaveProperty('promptCachedTokens');
    // Tout en mémoire : rien n'a été lu, donc aucune vitesse de lecture.
    expect(ollamaTimingsFromChunk({ ...FINAL, prompt_eval_cached_count: 321 })).toMatchObject({ promptCachedTokens: 321 });
    expect(ollamaTimingsFromChunk({ ...FINAL, prompt_eval_cached_count: 321 })?.promptTokensPerSecond).toBeUndefined();
    // Valeurs incohérentes (plus que le prompt, négatif, texte) : ignorées.
    for (const cachedCount of [322, -1, 'beaucoup', Number.NaN, null]) {
      const t = ollamaTimingsFromChunk({ ...FINAL, prompt_eval_cached_count: cachedCount });
      expect(t, String(cachedCount)).not.toHaveProperty('promptCachedTokens');
      expect(t?.promptTokensPerSecond).toBe(128.4);
    }
  });

  it('une durée prise pour des millisecondes serait absurde (> 24 h) : l’unité est bien la nanoseconde', () => {
    const timings = ollamaTimingsFromChunk({ ...FINAL, total_duration: 90_000_000_000 });
    expect(timings?.totalMs).toBe(90_000);
    expect(ollamaTimingsFromChunk({ total_duration: 90_000_000_000 * 1_000 })).toBeUndefined();
  });

  it('modèle déjà chargé : load_duration 0 est une mesure (0 ms), pas une absence', () => {
    expect(ollamaTimingsFromChunk({ ...FINAL, load_duration: 0 })?.loadMs).toBe(0);
  });

  it('durée nulle : pas de vitesse ; jetons nuls : pas de vitesse non plus', () => {
    const timings = ollamaTimingsFromChunk({ ...FINAL, eval_duration: 0, prompt_eval_count: 0 });
    expect(timings).toMatchObject({ outputMs: 0, outputTokens: 45, promptTokens: 0 });
    expect(timings?.tokensPerSecond).toBeUndefined();
    expect(timings?.promptTokensPerSecond).toBeUndefined();
  });

  it('très courte durée : la vitesse vient des nanosecondes, pas de la durée arrondie à 0 ms', () => {
    expect(ollamaTimingsFromChunk({ eval_count: 2, eval_duration: 400_000 })).toMatchObject({ outputMs: 0, tokensPerSecond: 5_000 });
  });

  it.each([
    ['champ non numérique', { ...FINAL, eval_duration: '4500000000' }],
    ['nombre négatif', { ...FINAL, eval_duration: -1 }],
    ['NaN', { ...FINAL, eval_duration: Number.NaN }],
    ['Infinity', { ...FINAL, eval_duration: Number.POSITIVE_INFINITY }],
    ['valeur absurde (> 24 h)', { ...FINAL, eval_duration: (MAX_ENGINE_DURATION_MS + 1) * 1_000_000 }],
    ['null', { ...FINAL, eval_duration: null }],
    ['objet', { ...FINAL, eval_duration: { ns: 1 } }],
  ])('%s : la durée est ignorée, les autres mesures restent', (_name, chunk) => {
    const timings = ollamaTimingsFromChunk(chunk);
    expect(timings).toBeDefined();
    expect(timings?.outputMs).toBeUndefined();
    expect(timings?.tokensPerSecond).toBeUndefined();
    expect(timings?.promptMs).toBe(2_500);
    expect(timings?.loadMs).toBe(1_235);
  });

  it('jetons négatifs, NaN, absurdes ou en texte : ignorés', () => {
    const timings = ollamaTimingsFromChunk({ ...FINAL, prompt_eval_count: -5, eval_count: 'quarante' });
    expect(timings?.promptTokens).toBeUndefined();
    expect(timings?.outputTokens).toBeUndefined();
    expect(timings?.promptTokensPerSecond).toBeUndefined();
    expect(ollamaTimingsFromChunk({ ...FINAL, eval_count: 1e12 })?.outputTokens).toBeUndefined();
    expect(ollamaTimingsFromChunk({ ...FINAL, eval_count: Number.NaN })?.outputTokens).toBeUndefined();
  });

  it('rien d’exploitable : undefined (les seuls nombres de jetons sont déjà dans usage)', () => {
    expect(ollamaTimingsFromChunk({ done: true, prompt_eval_count: 321, eval_count: 45 })).toBeUndefined();
    expect(ollamaTimingsFromChunk({})).toBeUndefined();
    expect(ollamaTimingsFromChunk({ total_duration: 'x', load_duration: -3, eval_duration: Number.NaN })).toBeUndefined();
    for (const junk of [null, undefined, 42, 'texte', true, [], [FINAL]]) expect(ollamaTimingsFromChunk(junk)).toBeUndefined();
  });

  it('n’expose que des nombres : aucun texte du dernier objet ne traverse', () => {
    const timings = ollamaTimingsFromChunk({ ...FINAL, message: { content: 'Texte secret' }, context: [1, 2, 3] });
    expect(JSON.stringify(timings)).not.toContain('secret');
    expect(Object.values(timings ?? {}).every(v => typeof v === 'number')).toBe(true);
  });
});

describe('placementFromPs — /api/ps', () => {
  const GB = 1_000_000_000;
  const ps = (entry: Record<string, unknown>) => ({ models: [{ name: 'ministral-3:3b', model: 'ministral-3:3b', size: 4 * GB, size_vram: 0, context_length: 12_288, ...entry }] });

  it('processeur : size_vram 0 (réponse réelle d’un Ollama sans carte graphique)', () => {
    expect(placementFromPs(ps({}), 'ministral-3:3b')).toEqual({
      processor: 'cpu', gpuPercent: 0, sizeBytes: 4 * GB, sizeVramBytes: 0, contextTokens: 12_288,
    });
  });

  it('carte graphique : tout le modèle en mémoire de carte (size_vram ≥ size)', () => {
    expect(placementFromPs(ps({ size_vram: 4 * GB }), 'ministral-3:3b')).toMatchObject({ processor: 'gpu', gpuPercent: 100 });
    expect(placementFromPs(ps({ size_vram: 5 * GB }), 'ministral-3:3b')).toMatchObject({ processor: 'gpu', gpuPercent: 100 });
  });

  it('partagé : pourcentage arrondi, jamais 0 % ni 100 % pour un modèle en partie seulement sur la carte', () => {
    expect(placementFromPs(ps({ size_vram: 1_600_000_000 }), 'ministral-3:3b')).toMatchObject({ processor: 'mixed', gpuPercent: 40, sizeVramBytes: 1_600_000_000 });
    expect(placementFromPs(ps({ size_vram: 3_999_900_000 }), 'ministral-3:3b')?.gpuPercent).toBe(99);
    expect(placementFromPs(ps({ size_vram: 1 }), 'ministral-3:3b')).toMatchObject({ processor: 'mixed', gpuPercent: 1 });
    expect(placementFromPs(ps({ size_vram: 2_500_000_000 }), 'ministral-3:3b')?.gpuPercent).toBe(63);
  });

  it('size_vram absent : processeur (aucune mémoire de carte déclarée)', () => {
    const entry = { name: 'ministral-3:3b', size: 4 * GB };
    expect(placementFromPs({ models: [entry] }, 'ministral-3:3b')).toMatchObject({ processor: 'cpu', gpuPercent: 0, sizeVramBytes: 0 });
    expect(placementFromPs({ models: [{ ...entry, size_vram: null }] }, 'ministral-3:3b')?.processor).toBe('cpu');
  });

  it('choisit l’entrée du modèle : « :latest » implicite, casse, champ « model » seul ; jamais un autre modèle chargé', () => {
    const body = { models: [{ name: 'autre:7b', size: 9 * GB, size_vram: 9 * GB }, { model: 'Ministral-3:LATEST', size: 6 * GB, size_vram: 0 }] };
    expect(placementFromPs(body, 'ministral-3')).toMatchObject({ processor: 'cpu', sizeBytes: 6 * GB });
    expect(placementFromPs(body, 'ministral-3:latest')).toMatchObject({ processor: 'cpu' });
    expect(placementFromPs(body, 'ministral-3:8b')).toBeUndefined();
    expect(placementFromPs(body, 'registry.ollama.ai/library/autre:7b')).toMatchObject({ processor: 'gpu' });
  });

  it('contexte absent ou invalide : omis', () => {
    expect(placementFromPs(ps({ context_length: undefined }), 'ministral-3:3b')).not.toHaveProperty('contextTokens');
    expect(placementFromPs(ps({ context_length: -3 }), 'ministral-3:3b')).not.toHaveProperty('contextTokens');
    expect(placementFromPs(ps({ context_length: 'grand' }), 'ministral-3:3b')).not.toHaveProperty('contextTokens');
  });

  it('sans donnée exploitable : undefined, jamais une valeur inventée', () => {
    expect(placementFromPs({ models: [] }, 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs({}, 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs({ models: 'x' }, 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size: undefined }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size: 0 }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size: -4 }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size: Number.NaN }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size_vram: 'plein' }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size_vram: -1 }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({ size_vram: Number.POSITIVE_INFINITY }), 'ministral-3:3b')).toBeUndefined();
    expect(placementFromPs(ps({}), '')).toBeUndefined();
    for (const junk of [null, undefined, 3, 'ps', [], { models: [null, 4, 'x', []] }]) expect(placementFromPs(junk, 'ministral-3:3b')).toBeUndefined();
  });
});

describe('cleanEngineTimings / cleanEnginePlacement — mesures reçues d’ailleurs', () => {
  it('ne garde que les champs connus, numériques et plausibles (jamais de texte)', () => {
    const cleaned = cleanEngineTimings({
      totalMs: 1_000, loadMs: -1, promptTokens: 12, promptCachedTokens: 4, promptMs: Number.NaN, outputTokens: '5', outputMs: 90, tokensPerSecond: 4.26,
      prompt: 'Texte du prompt', content: 'Contenu', extra: { a: 1 },
    });
    expect(cleaned).toEqual({ totalMs: 1_000, promptTokens: 12, promptCachedTokens: 4, outputMs: 90, tokensPerSecond: 4.3 });
    expect(cleanEngineTimings({ totalMs: MAX_ENGINE_DURATION_MS + 1 })).toBeUndefined();
    for (const junk of [null, 'x', 4, [], {}]) expect(cleanEngineTimings(junk)).toBeUndefined();
  });

  it('placement : énumération connue et tailles cohérentes, sinon rien', () => {
    const ok = { processor: 'mixed', gpuPercent: 40, sizeBytes: 1_000, sizeVramBytes: 400, contextTokens: 8_192, nom: 'secret' };
    expect(cleanEnginePlacement(ok)).toEqual({ processor: 'mixed', gpuPercent: 40, sizeBytes: 1_000, sizeVramBytes: 400, contextTokens: 8_192 });
    expect(cleanEnginePlacement({ ...ok, processor: 'tpu' })).toBeUndefined();
    expect(cleanEnginePlacement({ ...ok, processor: 'gpu' })).toBeUndefined();
    expect(cleanEnginePlacement({ ...ok, sizeBytes: 0 })).toBeUndefined();
    expect(cleanEnginePlacement({ ...ok, sizeVramBytes: 'beaucoup' })).toBeUndefined();
    for (const junk of [null, 'gpu', 4, [], {}]) expect(cleanEnginePlacement(junk)).toBeUndefined();
  });
});
