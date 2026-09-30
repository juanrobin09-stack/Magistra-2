// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MagistraError } from '@shared/errors';
import type { Capabilities, GenerationEvent, GenerationRequest } from '@shared/types';
import { useGeneration, type UseGeneration } from '@/hooks/useGeneration';
import type { GenerationClient } from '@/lib/runtime/types';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const REQ: GenerationRequest = { type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'Pythagore', researchMode: 'documents' };

const CAPS: Capabilities = {
  maxDocumentChars: 1000,
  research: { academic: false, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'demo', message: 'Démo' },
  engineLabel: 'Test',
  ready: true,
};

type Emit = (request: GenerationRequest, onEvent: (e: GenerationEvent) => void, signal: AbortSignal) => Promise<void>;

function makeClient(generate: Emit): GenerationClient & { generate: ReturnType<typeof vi.fn> } {
  return { kind: 'demo', capabilities: async () => CAPS, generate: vi.fn(generate) };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(client: GenerationClient, interval = 40) {
  const snapshots: UseGeneration[] = [];
  function Harness() {
    const g = useGeneration(client, interval);
    snapshots.push(g);
    return null;
  }
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root!.render(<Harness />));
  return { latest: () => snapshots[snapshots.length - 1], snapshots };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('useGeneration', () => {
  it('« Arrêter » puis « Recommencer » : la relance attend la fin réelle de la génération annulée', async () => {
    let finishFirst!: () => void;
    let calls = 0;
    const client = makeClient(async (_req, onEvent, signal) => {
      calls++;
      if (calls === 1) {
        // Génération annulée qui met du temps à se terminer (démarrage du moteur local…).
        await new Promise<void>(resolve => {
          finishFirst = resolve;
        });
        expect(signal.aborted).toBe(true);
        return;
      }
      onEvent({ type: 'done', content: 'RELANCÉ', sources: [], truncated: false, internetUsed: false, saved: true, id: 'id2', model: 'm' });
    });
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    act(() => h.latest().stop());
    await act(async () => {
      h.latest().restart();
      await sleep(20);
    });
    // La seconde génération n'est pas lancée tant que la première n'est pas terminée.
    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(h.latest().state.phase).toBe('running');
    await act(async () => {
      finishFirst();
      await sleep(20);
    });
    expect(client.generate).toHaveBeenCalledTimes(2);
    expect(h.latest().state.phase).toBe('done');
    expect(h.latest().state.result?.content).toBe('RELANCÉ');
  });

  it('GENERATION_BUSY est proposé à nouveau (« Réessayer »)', () => {
    expect(new MagistraError('GENERATION_BUSY').retryable).toBe(true);
  });

  it('texte progressif limité en fréquence, puis contenu final', async () => {
    const client = makeClient(async (_req, onEvent) => {
      onEvent({ type: 'status', stage: 'generating', message: 'Rédaction en cours…' });
      for (let i = 0; i < 200; i++) onEvent({ type: 'delta', text: 'x' });
      await sleep(80);
      onEvent({ type: 'done', content: 'FINAL', sources: [], truncated: false, internetUsed: false, saved: true, id: 'id1', model: 'm' });
    });
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    expect(h.latest().state.phase).toBe('running');
    expect(h.latest().state.status).toBe('Rédaction en cours…');
    // Premier morceau affiché immédiatement, le reste regroupé au rendu suivant.
    expect(h.latest().state.text).toBe('x');
    await act(async () => {
      await sleep(60);
    });
    expect(h.latest().state.phase).toBe('running');
    expect(h.latest().state.text).toBe('x'.repeat(200));
    await act(async () => {
      await sleep(80);
    });
    const texts = new Set(h.snapshots.map(s => s.state.text).filter(t => t && t !== 'FINAL'));
    // 200 morceaux reçus d'un coup → 2 rendus du texte (pas 200).
    expect(texts.size).toBe(2);
    expect(h.latest().state.phase).toBe('done');
    expect(h.latest().state.text).toBe('FINAL');
    expect(h.latest().isRunning).toBe(false);
  });

  it('« Arrêter » : signal annulé, texte conservé, « Génération interrompue »', async () => {
    let seenSignal: AbortSignal | null = null;
    const client = makeClient((_req, onEvent, signal) => new Promise(resolve => {
      seenSignal = signal;
      onEvent({ type: 'delta', text: 'Début' });
      signal.addEventListener('abort', () => {
        onEvent({ type: 'error', code: 'GENERATION_ABORTED', message: 'Génération interrompue.', retryable: true });
        resolve();
      });
    }));
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    await act(async () => {
      h.latest().stop();
    });
    expect(seenSignal!.aborted).toBe(true);
    expect(h.latest().state.phase).toBe('aborted');
    expect(h.latest().state.text).toBe('Début');
    expect(h.latest().state.error).toBeNull();
  });

  it('« Recommencer » relance la même requête', async () => {
    const client = makeClient(async (_req, onEvent) => {
      onEvent({ type: 'done', content: 'ok', sources: [], truncated: false, internetUsed: false, saved: false, model: 'm' });
    });
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    await act(async () => {
      h.latest().restart();
    });
    expect(client.generate).toHaveBeenCalledTimes(2);
    expect(client.generate.mock.calls[1][0]).toBe(REQ);
  });

  it('exception du client : erreur précise, réessayable selon le code', async () => {
    const client = makeClient(async () => {
      throw new MagistraError('AI_SERVER_UNAVAILABLE');
    });
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    expect(h.latest().state.phase).toBe('error');
    expect(h.latest().state.error).toEqual({ code: 'AI_SERVER_UNAVAILABLE', message: "Serveur d'IA indisponible. Réessayez dans quelques instants.", retryable: true });
  });

  it('flux terminé sans évènement final : erreur explicite', async () => {
    const client = makeClient(async (_req, onEvent) => {
      onEvent({ type: 'delta', text: 'a' });
    });
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    expect(h.latest().state.phase).toBe('error');
    expect(h.latest().state.text).toBe('a');
  });

  it('quitter la page interrompt la génération', async () => {
    let seenSignal: AbortSignal | null = null;
    const client = makeClient((_req, _onEvent, signal) => new Promise(resolve => {
      seenSignal = signal;
      signal.addEventListener('abort', () => resolve());
    }));
    const h = mount(client);
    await act(async () => {
      h.latest().start(REQ);
    });
    act(() => root!.unmount());
    root = null;
    expect(seenSignal!.aborted).toBe(true);
  });
});
