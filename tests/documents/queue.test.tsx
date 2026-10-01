// @vitest-environment jsdom
// Analyse des documents deux par deux (constat 30) : pic de mémoire borné quand l'enseignant dépose 12 fichiers.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtractedDocument } from '@shared/documents/types';
import { useSourceDocuments, type UseSourceDocuments } from '@/components/generate/useSourceDocuments';
import { extractFile } from '@/lib/documents';
import { EXTRACTION_CONCURRENCY, runLimited } from '@/lib/documents/queue';

vi.mock('@/lib/documents', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/documents')>();
  return { ...original, extractFile: vi.fn() };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('runLimited', () => {
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
    await runLimited(tasks, 2);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('une tâche qui échoue n’empêche pas les suivantes', async () => {
    const done: number[] = [];
    await runLimited([
      async () => {
        throw new Error('échec');
      },
      async () => void done.push(2),
      async () => void done.push(3),
    ], 2);
    expect(done).toEqual([2, 3]);
  });

  it('limite supérieure au nombre de tâches, liste vide', async () => {
    await runLimited([], 2);
    const done: number[] = [];
    await runLimited([async () => void done.push(1)], 5);
    expect(done).toEqual([1]);
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
