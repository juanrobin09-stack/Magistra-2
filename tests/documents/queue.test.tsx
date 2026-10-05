// @vitest-environment jsdom
// Analyse des documents deux par deux (constat 30) : pic de mémoire borné quand l'enseignant dépose 12 fichiers,
// en un ou en plusieurs dépôts successifs.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtractedDocument } from '@shared/documents/types';
import { useSourceDocuments, type UseSourceDocuments } from '@/components/generate/useSourceDocuments';
import { extractFile } from '@/lib/documents';
import { createLimiter, EXTRACTION_CONCURRENCY } from '@/lib/documents/queue';

vi.mock('@/lib/documents', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/documents')>();
  return { ...original, extractFile: vi.fn() };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createLimiter', () => {
  it('ne lance jamais plus de tâches que la limite, dans l’ordre, et les termine toutes', async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started.push(i);
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
    });
    const run = createLimiter(2);
    await Promise.all(tasks.map(task => run(task)));
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('la limite vaut pour toutes les tâches confiées au même limiteur, même soumises par lots successifs', async () => {
    let running = 0;
    let peak = 0;
    const started: string[] = [];
    const batch = (name: string, count: number) => Array.from({ length: count }, (_, i) => async () => {
      started.push(`${name}${i}`);
      running++;
      peak = Math.max(peak, running);
      await tick();
      await tick();
      running--;
    });
    const run = createLimiter(2);
    const first = batch('a', 5).map(task => run(task));
    await tick();
    const second = batch('b', 5).map(task => run(task));
    await Promise.all([...first, ...second]);
    expect(peak).toBe(2);
    expect(started).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'b0', 'b1', 'b2', 'b3', 'b4']);
    // Deux limiteurs sont indépendants.
    const other = createLimiter(1);
    let both = 0;
    let bothPeak = 0;
    const hold = async () => {
      bothPeak = Math.max(bothPeak, ++both);
      await tick();
      both--;
    };
    await Promise.all([run(hold), run(hold), other(hold)]);
    expect(bothPeak).toBe(3);
  });

  it('une tâche qui échoue, même avant son premier await, libère sa place et n’empêche pas les suivantes', async () => {
    const done: number[] = [];
    const run = createLimiter(1);
    await Promise.all([
      run(async () => {
        throw new Error('échec');
      }),
      run(() => {
        throw new Error('échec synchrone');
      }),
      run(async () => void done.push(3)),
      run(async () => void done.push(4)),
    ]);
    expect(done).toEqual([3, 4]);
  });

  it('limite nulle ou négative : une tâche à la fois', async () => {
    let running = 0;
    let peak = 0;
    const run = createLimiter(0);
    await Promise.all(Array.from({ length: 4 }, () => run(async () => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
    })));
    expect(peak).toBe(1);
  });
});

describe('useSourceDocuments : analyse deux par deux', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.mocked(extractFile).mockReset();
  });

  function mount() {
    const snapshots: UseSourceDocuments[] = [];
    function Harness() {
      snapshots.push(useSourceDocuments('demo', null));
      return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(<Harness />));
    return () => snapshots[snapshots.length - 1];
  }

  const fakeDoc = (name: string): ExtractedDocument => ({
    id: name, name, kind: 'txt', units: [{ locator: { type: 'lines', start: 1, end: 1 }, text: `Texte de ${name}` }], stats: { lines: 1, chars: 10 }, warnings: [],
  });

  it('12 fichiers : au plus 2 analyses simultanées, tous les documents finissent prêts', async () => {
    expect(EXTRACTION_CONCURRENCY).toBe(2);
    let running = 0;
    let peak = 0;
    vi.mocked(extractFile).mockImplementation(async (file: File) => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return fakeDoc(file.name);
    });
    const latest = mount();
    const files = Array.from({ length: 12 }, (_, i) => new File([`contenu ${i}`], `cours-${i + 1}.txt`, { lastModified: 1_700_000_000_000 + i }));
    await act(async () => {
      latest().addFiles(files);
      for (let i = 0; i < 40; i++) await tick();
    });
    expect(peak).toBe(2);
    expect(extractFile).toHaveBeenCalledTimes(12);
    expect(latest().docs.map(d => d.status)).toEqual(Array(12).fill('ready'));
    expect(latest().readyDocs).toHaveLength(12);
    expect(latest().analyzing).toBe(false);
  });

  /** extractFile suspendu : chaque appel attend que le test le libère, ce qui rend les comptes déterministes. */
  function holdExtractions() {
    const release: (() => void)[] = [];
    const state = { running: 0, peak: 0, names: [] as string[] };
    vi.mocked(extractFile).mockImplementation(async (file: File) => {
      state.names.push(file.name);
      state.peak = Math.max(state.peak, ++state.running);
      await new Promise<void>(resolve => release.push(resolve));
      state.running--;
      return fakeDoc(file.name);
    });
    const drain = async () => {
      for (let i = 0; i < 20; i++) {
        await act(async () => {
          release.splice(0).forEach(r => r());
          for (let k = 0; k < 3; k++) await tick();
        });
      }
    };
    return { state, drain };
  }

  const makeFiles = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => new File([`contenu ${from + i}`], `cours-${from + i}.txt`, { lastModified: 1_700_000_000_000 + from + i }));

  it('quitter la vue arrête les lectures en cours et ne démarre aucun fichier en attente', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(extractFile).mockImplementation((_file, options) => new Promise((_resolve, reject) => {
      const signal = options!.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Lecture arrêtée', 'AbortError')), { once: true });
    }));
    const latest = mount();
    await act(async () => {
      latest().addFiles(makeFiles(1, 6));
      await tick();
    });
    expect(signals).toHaveLength(2);
    await act(async () => {
      root!.unmount();
      root = null;
      for (let i = 0; i < 6; i++) await tick();
    });
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(extractFile).toHaveBeenCalledTimes(2);
  });

  it('retirer un fichier en cours annule sa lecture et laisse démarrer le suivant', async () => {
    const signals = new Map<string, AbortSignal>();
    const release = new Map<string, () => void>();
    vi.mocked(extractFile).mockImplementation((file, options) => new Promise((resolve, reject) => {
      const signal = options!.signal!;
      signals.set(file.name, signal);
      release.set(file.name, () => resolve(fakeDoc(file.name)));
      signal.addEventListener('abort', () => reject(new DOMException('Lecture arrêtée', 'AbortError')), { once: true });
    }));
    const latest = mount();
    await act(async () => {
      latest().addFiles(makeFiles(1, 3));
      await tick();
    });
    await act(async () => {
      latest().remove(latest().docs[0].key);
      for (let i = 0; i < 3; i++) await tick();
    });
    expect(signals.get('cours-1.txt')!.aborted).toBe(true);
    expect([...signals.keys()]).toEqual(['cours-1.txt', 'cours-2.txt', 'cours-3.txt']);
    await act(async () => {
      release.get('cours-2.txt')!();
      release.get('cours-3.txt')!();
      await tick();
    });
    expect(latest().readyDocs.map(doc => doc.name)).toEqual(['cours-2.txt', 'cours-3.txt']);
  });

  it('deux dépôts successifs de 6 fichiers : jamais plus de 2 analyses simultanées, dans l’ordre des dépôts', async () => {
    const { state, drain } = holdExtractions();
    const latest = mount();
    await act(async () => {
      latest().addFiles(makeFiles(1, 6));
      await tick();
    });
    expect(state.running).toBe(2);
    // Second dépôt pendant que le premier est en cours : AVANT, il lançait 2 analyses de plus (4 en même temps).
    await act(async () => {
      latest().addFiles(makeFiles(7, 6));
      await tick();
    });
    expect(state.running).toBe(2);
    expect(extractFile).toHaveBeenCalledTimes(2);
    await drain();
    expect(state.peak).toBe(2);
    expect(state.names).toEqual(Array.from({ length: 12 }, (_, i) => `cours-${i + 1}.txt`));
    expect(latest().docs.map(d => d.status)).toEqual(Array(12).fill('ready'));
    expect(latest().analyzing).toBe(false);
  });

  it('fichiers ajoutés un par un pendant l’analyse des premiers : toujours 2 analyses au plus', async () => {
    const { state, drain } = holdExtractions();
    const latest = mount();
    for (let i = 1; i <= 6; i++) {
      await act(async () => {
        latest().addFiles(makeFiles(i, 1));
        await tick();
      });
    }
    expect(state.running).toBe(2);
    expect(extractFile).toHaveBeenCalledTimes(2);
    await drain();
    expect(state.peak).toBe(2);
    expect(latest().readyDocs).toHaveLength(6);
  });

  it('un document retiré avant son tour n’est pas analysé ; une erreur n’arrête pas les autres', async () => {
    const release: (() => void)[] = [];
    vi.mocked(extractFile).mockImplementation(async (file: File) => {
      await new Promise<void>(resolve => release.push(resolve));
      if (file.name === 'abime.txt') throw new Error('illisible');
      return fakeDoc(file.name);
    });
    const latest = mount();
    const files = ['a.txt', 'abime.txt', 'c.txt', 'd.txt'].map((name, i) => new File([`x${i}`], name, { lastModified: 1_700_000_000_000 + i }));
    await act(async () => {
      latest().addFiles(files);
      await tick();
    });
    // Deux analyses en cours : a.txt et abime.txt. On retire d.txt avant son tour.
    expect(extractFile).toHaveBeenCalledTimes(2);
    const removedKey = latest().docs.find(d => d.name === 'd.txt')!.key;
    await act(async () => {
      latest().remove(removedKey);
      await tick();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        release.splice(0).forEach(r => r());
        for (let k = 0; k < 5; k++) await tick();
      });
    }
    expect(vi.mocked(extractFile).mock.calls.map(c => (c[0] as File).name)).toEqual(['a.txt', 'abime.txt', 'c.txt']);
    expect(latest().docs.map(d => [d.name, d.status])).toEqual([['a.txt', 'ready'], ['abime.txt', 'error'], ['c.txt', 'ready']]);
  });
});
