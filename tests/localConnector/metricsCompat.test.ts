// Compatibilité de l'évènement « done » avec ses mesures (metrics, facultatives) : un client strict ne casse pas avec
// des mesures, une application plus ancienne qui n'en envoie pas non plus. Rien n'est enregistré dans l'historique.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_PORTS } from '@shared/localConnector';
import type { GenerationEvent, GenerationMetrics, GenerationRecordDraft, GenerationRequest } from '@shared/types';
import { createLocalEngineController } from '@/lib/localConnector/controller';
import { resetEngineChoiceMemory } from '@/lib/localConnector/engineChoice';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import { HybridGenerationClient } from '@/lib/runtime/hybrid';
import { readEventStream } from '@/lib/runtime/http';
import { generationReducer, initialGenerationState } from '@/lib/generation/state';
import { speedView } from '@/lib/generation/speed';
import { publicEvent } from '../../electron/connector/status';
import { DEFAULT_EVENTS, fakeClock, FakeConnector } from './fakeConnector';

const [P1] = CONNECTOR_PORTS;

const REQUEST: GenerationRequest = { type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'La fable', researchMode: 'documents' };

const METRICS: GenerationMetrics = {
  totalMs: 48_000, prepMs: 100, firstWordMs: 9_000, contextTokens: 12_288, promptTokens: 400, outputBudgetTokens: 2_000,
  engine: { totalMs: 40_000, loadMs: 0, promptTokens: 380, promptMs: 3_000, promptTokensPerSecond: 126.7, outputTokens: 250, outputMs: 30_000, tokensPerSecond: 8.3 },
  placement: { processor: 'cpu', gpuPercent: 0, sizeBytes: 4_000_000_000, sizeVramBytes: 0 },
};

type Done = Extract<GenerationEvent, { type: 'done' }>;

function withMetrics(extra: Record<string, unknown> = {}): GenerationEvent[] {
  return DEFAULT_EVENTS.map(e => (e.type === 'done' ? ({ ...e, metrics: METRICS, ...extra } as GenerationEvent) : structuredClone(e)));
}

function setup(events: GenerationEvent[]) {
  const clock = fakeClock();
  const connector = new FakeConnector(clock.now);
  connector.setPort(P1, 'magistra');
  connector.events = structuredClone(events);
  const controller = createLocalEngineController({
    origin: 'https://magistra-2.vercel.app',
    fetch: connector.fetch as typeof fetch,
    store: new MemoryPairingStore(),
    openUrl: connector.openUrl,
    permission: async () => 'granted',
    now: clock.now,
    sleep: clock.sleep,
  });
  const saved: GenerationRecordDraft[] = [];
  const saveDraft = vi.fn(async (draft: GenerationRecordDraft) => {
    saved.push(draft);
    return { id: 'gen-42' };
  });
  const server = { kind: 'web' as const, capabilities: vi.fn(), generate: vi.fn() };
  const client = new HybridGenerationClient(server as never, controller, saveDraft);
  return { connector, controller, client, saved, saveDraft };
}

async function run(events: GenerationEvent[]) {
  const ctx = setup(events);
  await ctx.controller.connect();
  const received: GenerationEvent[] = [];
  await ctx.client.generate(REQUEST, e => received.push(e), new AbortController().signal);
  return { ...ctx, received };
}

beforeEach(() => {
  resetEngineChoiceMemory();
});

describe('« done » avec metrics à travers le connecteur local', () => {
  it('Magistra locale : les mesures arrivent à l’interface, l’enregistrement du compte n’en contient aucune', async () => {
    const { received, saved } = await run(withMetrics());
    const done = received.find((e): e is Done => e.type === 'done');
    expect(done).toMatchObject({ saved: true, id: 'gen-42', metrics: METRICS });
    expect(done).not.toHaveProperty('record');
    expect(speedView(done?.metrics)?.headline).toBe('Rédigé en 48 s');
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0])).not.toMatch(/metrics|totalMs|tokensPerSecond|gpuPercent/);
  });

  it('application plus ancienne : pas de metrics, déroulé identique, rien à afficher', async () => {
    const { received, saved } = await run(structuredClone(DEFAULT_EVENTS));
    const done = received.find((e): e is Done => e.type === 'done');
    expect(done).toMatchObject({ saved: true, id: 'gen-42' });
    expect(done).not.toHaveProperty('metrics');
    expect(saved).toHaveLength(1);
    expect(speedView(done?.metrics)).toBeUndefined();
    expect(received.map(e => e.type)).toEqual(['status', 'delta', 'delta', 'done']);
  });

  it('application plus récente : champs inconnus dans metrics ou dans « done » ignorés, sans erreur', async () => {
    const future = DEFAULT_EVENTS.map(e => (e.type === 'done'
      ? ({ ...e, metrics: { ...METRICS, gpu: { name: 'inconnu' }, nouveau: [1, 2] }, futur: true } as unknown as GenerationEvent)
      : structuredClone(e)));
    const { received } = await run(future);
    const done = received.find((e): e is Done => e.type === 'done');
    expect(done).toMatchObject({ saved: true, id: 'gen-42' });
    expect(speedView(done?.metrics)?.rows.length).toBeGreaterThan(0);
  });

  it('mesures illisibles envoyées par une application : « done » reçu quand même, rien d’affiché', async () => {
    const junk = DEFAULT_EVENTS.map(e => (e.type === 'done' ? ({ ...e, metrics: 'beaucoup' } as unknown as GenerationEvent) : structuredClone(e)));
    const { received, saved } = await run(junk);
    const done = received.find((e): e is Done => e.type === 'done');
    expect(done).toMatchObject({ saved: true, id: 'gen-42' });
    expect(saved).toHaveLength(1);
    expect(speedView(done?.metrics)).toBeUndefined();
  });
});

describe('consommateurs stricts d’évènements', () => {
  it('flux NDJSON : « done » avec metrics lu tel quel, et sans metrics', async () => {
    const lines = withMetrics().map(e => JSON.stringify(e)).join('\n');
    const read = async (text: string) => {
      const events: GenerationEvent[] = [];
      await readEventStream(new Response(text, { headers: { 'content-type': 'application/x-ndjson' } }), e => events.push(e), new AbortController().signal);
      return events;
    };
    expect((await read(lines)).at(-1)).toMatchObject({ type: 'done', metrics: METRICS });
    const older = DEFAULT_EVENTS.map(e => JSON.stringify(e)).join('\n');
    const events = await read(older);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.at(-1)).not.toHaveProperty('metrics');
  });

  it('filtre des évènements de l’application vers le site : « done » et ses mesures passent sans modification', () => {
    const done = withMetrics().at(-1) as Done;
    expect(publicEvent(done)).toBe(done);
    expect(publicEvent(done)).toMatchObject({ metrics: METRICS });
  });

  it('état de la génération : « done » avec ou sans metrics', () => {
    const base = generationReducer(initialGenerationState(), { type: 'start', runId: 1, request: REQUEST });
    const withM = generationReducer(base, { type: 'event', runId: 1, event: withMetrics().at(-1)! });
    expect(withM.phase).toBe('done');
    expect(withM.result?.metrics).toEqual(METRICS);
    const without = generationReducer(base, { type: 'event', runId: 1, event: DEFAULT_EVENTS.at(-1)! });
    expect(without.phase).toBe('done');
    expect(without.result?.metrics).toBeUndefined();
  });
});
