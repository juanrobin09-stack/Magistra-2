// Mesures de vitesse dans le processus principal : « done » les porte, l'historique local n'en contient aucune,
// le moteur du site (connecteur) les reçoit sans changement de protocole. Fournisseur simulé, aucun réseau.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { EnginePlacement, EngineTimings } from '../../shared/ai/timings.js';
import type { GenerationEvent } from '../../shared/types.js';
import { GenerationManager, type GenerationPayload } from '../../electron/generation.js';
import { LocalStore } from '../../electron/localStore.js';
import { publicEvent } from '../../electron/connector/status.js';

let dir: string;
let store: LocalStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-gen-metrics-'));
  store = new LocalStore(dir, { warn: () => undefined });
  await store.init();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REQUEST = {
  type: 'cours', niveau: 'licence_2', matiere: 'mathematiques', sujet: 'Espaces vectoriels', researchMode: 'documents',
  documents: [{ docId: 'd1', docName: 'poly.pdf', kind: 'pdf', locator: { type: 'pages', start: 3, end: 4 }, text: 'Un espace vectoriel est un ensemble muni de deux lois.' }],
};

const TIMINGS: EngineTimings = { totalMs: 9_000, loadMs: 0, promptTokens: 300, promptMs: 3_000, promptTokensPerSecond: 100, outputTokens: 90, outputMs: 6_000, tokensPerSecond: 15 };
const PLACEMENT: EnginePlacement = { processor: 'gpu', gpuPercent: 100, sizeBytes: 4_000_000_000, sizeVramBytes: 4_000_000_000, contextTokens: 12_288 };

function manager() {
  const payloads: GenerationPayload[] = [];
  const gm = new GenerationManager({
    store,
    resolveProvider: async () => new MockProvider({ reply: '# Cours\n\nContenu [S1].', model: 'ministral-3:3b', contextTokens: 12_288, usage: { timings: TIMINGS, placement: PLACEMENT } }),
    describeActive: async () => ({ label: 'Magistra Léger', contextTokens: 12_288, ready: true, privacy: { level: 'local', message: 'IA locale' } }),
    send: p => {
      payloads.push(p);
      return true;
    },
    fetch: async () => {
      throw new Error('aucun accès réseau dans ce test');
    },
  });
  return { gm, payloads };
}

async function until(events: () => GenerationEvent[]): Promise<GenerationEvent[]> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const list = events();
    if (list.some(e => e.type === 'done' || e.type === 'error')) return list;
    if (Date.now() > deadline) throw new Error('génération non terminée');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('GenerationManager — mesures de vitesse', () => {
  it('fenêtre : « done » porte les mesures du moteur ; l’historique local n’en contient aucune', async () => {
    const { gm, payloads } = manager();
    const { jobId } = gm.start(REQUEST);
    const events = await until(() => payloads.filter(p => p.jobId === jobId).map(p => p.event));
    const done = events.at(-1);
    if (done?.type !== 'done') throw new Error('« done » attendu');
    expect(done.metrics).toMatchObject({ engine: TIMINGS, placement: PLACEMENT, contextTokens: 12_288 });
    expect(done.metrics?.totalMs).toBeGreaterThanOrEqual(0);
    const saved = await store.get(done.id!);
    expect(JSON.stringify(saved)).not.toMatch(/metrics|totalMs|tokensPerSecond|gpuPercent|sizeVramBytes/);
  });

  it('site (connecteur) : « done » porte la génération à enregistrer ET les mesures, filtre inchangé', async () => {
    const { gm } = manager();
    const received: GenerationEvent[] = [];
    const handle = gm.startExternal(REQUEST, { owner: 'navigateur-1', send: e => { received.push(publicEvent(e)); return true; }, requireLocal: true });
    await handle.finished;
    const done = received.at(-1);
    if (done?.type !== 'done') throw new Error('« done » attendu');
    expect(done.record).toBeDefined();
    expect(done.metrics?.engine).toEqual(TIMINGS);
    expect(JSON.stringify(done.record)).not.toMatch(/metrics|totalMs|tokensPerSecond/);
    // Ligne NDJSON telle qu'envoyée au navigateur : tout reste du JSON simple.
    const line = JSON.parse(JSON.stringify(done)) as Record<string, unknown>;
    expect(line.metrics).toEqual(done.metrics);
  });
});
