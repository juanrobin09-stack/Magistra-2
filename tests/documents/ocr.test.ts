import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOcrSession, OCR_LANGUAGES, type OcrEngine, type OcrProgressCallback, type OcrSession } from '@/lib/documents/ocr';

const image = new Blob(['page'], { type: 'image/png' });
const sessions: OcrSession[] = [];
function session(options: Parameters<typeof createOcrSession>[0] = {}) {
  const value = createOcrSession(options);
  sessions.push(value);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function engine(overrides: Partial<OcrEngine> = {}): OcrEngine {
  return {
    initialize: vi.fn(async () => {}),
    recognize: vi.fn(async () => ({ text: ' Bonjour 日本語 \n', confidence: 93 })),
    terminate: vi.fn(),
    ...overrides,
  };
}
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(value => value.dispose()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OCR locale : cycle de vie du moteur', () => {
  it('ne crée aucun moteur pour un fichier qui n’a pas besoin d’OCR et dispose reste idempotent', async () => {
    const factory = vi.fn(() => engine());
    const value = session({ engineFactory: factory });
    await value.dispose();
    await value.dispose();
    expect(factory).not.toHaveBeenCalled();
    await expect(value.recognize(image)).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
  });

  it('initialise une fois, réutilise le moteur pour chaque page, puis le termine une fois', async () => {
    const worker = engine();
    const factory = vi.fn(() => worker);
    const value = session({ engineFactory: factory });
    expect(await value.recognize(image)).toEqual({ text: 'Bonjour 日本語', confidence: 93 });
    await value.recognize(image);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.initialize).toHaveBeenCalledTimes(1);
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    await value.dispose();
    await value.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('une panne de page termine le moteur défaillant et recommence une seule fois sur un nouveau moteur', async () => {
    const broken = engine({ recognize: vi.fn(async () => { throw new Error('panne'); }) });
    const healthy = engine();
    const factory = vi.fn().mockReturnValueOnce(broken).mockReturnValueOnce(healthy);
    const value = session({ engineFactory: factory });
    await expect(value.recognize(image)).resolves.toMatchObject({ text: 'Bonjour 日本語' });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(broken.terminate).toHaveBeenCalledTimes(1);
    expect(healthy.terminate).not.toHaveBeenCalled();
  });

  it('une panne persistante produit une erreur bornée ; une page suivante peut encore réussir', async () => {
    const broken = () => engine({ recognize: vi.fn(async () => { throw new Error('page illisible'); }) });
    const first = broken(), second = broken(), healthy = engine();
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(healthy);
    const value = session({ engineFactory: factory });
    await expect(value.recognize(image)).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(second.terminate).toHaveBeenCalledTimes(1);
    await expect(value.recognize(image)).resolves.toMatchObject({ text: 'Bonjour 日本語' });
  });

  for (const operation of ['initialize', 'recognize'] as const) {
    it(`un ${operation} suspendu dépasse le délai, termine chaque moteur et règle la promesse`, async () => {
      vi.useFakeTimers();
      const workers: OcrEngine[] = [];
      const factory = vi.fn(() => {
        const worker = engine({ [operation]: vi.fn(() => new Promise(() => {})) });
        workers.push(worker);
        return worker;
      });
      const value = session({ engineFactory: factory, timeoutMs: 25 });
      const result = value.recognize(image);
      const checked = expect(result).rejects.toMatchObject({ code: operation === 'initialize' ? 'OCR_INITIALIZATION_FAILED' : 'OCR_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(55);
      await checked;
      expect(workers).toHaveLength(2);
      for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  }

  it('une initialisation irrécupérable bloque les pages suivantes sans relancer le moteur', async () => {
    const factory = vi.fn(() => engine({ initialize: async () => { throw new Error('modèles absents'); } }));
    const value = session({ engineFactory: factory });
    await expect(value.recognize(image)).rejects.toMatchObject({ code: 'OCR_INITIALIZATION_FAILED' });
    await expect(value.recognize(image)).rejects.toMatchObject({ code: 'OCR_INITIALIZATION_FAILED' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('dispose annule immédiatement une page suspendue, sans attendre son délai ni réessayer', async () => {
    const suspended = deferred<{ text: string; confidence: number }>();
    const worker = engine({ recognize: vi.fn(() => suspended.promise) });
    const factory = vi.fn(() => worker);
    const value = session({ engineFactory: factory });
    const result = value.recognize(image);
    const checked = expect(result).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
    await flush();
    await value.dispose();
    await checked;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    // Une réponse tardive du moteur supprimé ne réactive pas la session.
    suspended.resolve({ text: 'trop tard', confidence: 99 });
    await flush();
    await expect(value.recognize(image)).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
  });

  it('retirer un fichier via AbortSignal termine le moteur et ignore une progression tardive', async () => {
    const controller = new AbortController();
    const pending = deferred<{ text: string; confidence: number }>();
    const worker = engine({ recognize: vi.fn(() => pending.promise) });
    let progress!: OcrProgressCallback;
    const onProgress = vi.fn();
    const value = session({ signal: controller.signal, onProgress, engineFactory: callback => { progress = callback; return worker; } });
    const result = value.recognize(image);
    const checked = expect(result).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
    await flush();
    controller.abort();
    await checked;
    const before = onProgress.mock.calls.length;
    progress({ stage: 'recognizing', progress: 0.8 });
    expect(onProgress).toHaveBeenCalledTimes(before);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('OCR locale : mémoire et concurrence', () => {
  it('les pages d’un même fichier restent séquentielles même si les appels sont simultanés', async () => {
    const first = deferred<{ text: string; confidence: number }>();
    const worker = engine({ recognize: vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue({ text: 'page 2', confidence: 80 }) });
    const value = session({ engineFactory: () => worker });
    const a = value.recognize(image), b = value.recognize(image);
    await flush();
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    first.resolve({ text: 'page 1', confidence: 90 });
    expect((await a).text).toBe('page 1');
    expect((await b).text).toBe('page 2');
  });

  it('deux documents ne font jamais résider deux moteurs ; le second attend la fin du premier', async () => {
    const first = engine(), second = engine();
    const firstFactory = vi.fn(() => first), secondFactory = vi.fn(() => second);
    const a = session({ engineFactory: firstFactory }), b = session({ engineFactory: secondFactory });
    await a.recognize(image);
    const result = b.recognize(image);
    await flush();
    expect(secondFactory).not.toHaveBeenCalled();
    await a.dispose();
    await result;
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(secondFactory).toHaveBeenCalledTimes(1);
  });

  it('annuler un document dans la file n’empêche pas le document suivant de recevoir la place', async () => {
    const a = session({ engineFactory: () => engine() });
    const skipped = vi.fn(() => engine()), last = vi.fn(() => engine());
    const b = session({ engineFactory: skipped }), c = session({ engineFactory: last });
    await a.recognize(image);
    const waitingB = b.recognize(image), waitingC = c.recognize(image);
    const checked = expect(waitingB).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
    await flush();
    await b.dispose();
    await checked;
    await a.dispose();
    await waitingC;
    expect(skipped).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
  });

  it('annuler pendant l’attribution initiale de la place la libère aussi', async () => {
    const a = session({ engineFactory: () => engine() });
    const result = a.recognize(image);
    const checked = expect(result).rejects.toMatchObject({ code: 'OCR_DISPOSED' });
    await Promise.resolve();
    await a.dispose();
    await checked;
    const b = session({ engineFactory: () => engine() });
    await expect(b.recognize(image)).resolves.toMatchObject({ text: 'Bonjour 日本語' });
  });
});

describe('OCR locale : sortie et affichage', () => {
  it('un résultat vide est valide et ne déclenche pas de réessai ; la confiance est bornée', async () => {
    const worker = engine({ recognize: vi.fn().mockResolvedValueOnce({ text: '\u0000\n', confidence: NaN }).mockResolvedValueOnce({ text: 'x', confidence: 120 }) });
    const factory = vi.fn(() => worker);
    const value = session({ engineFactory: factory });
    expect(await value.recognize(image)).toEqual({ text: '', confidence: 0 });
    expect(await value.recognize(image)).toEqual({ text: 'x', confidence: 100 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('une erreur du composant de progression n’interrompt pas la lecture', async () => {
    const value = session({ engineFactory: () => engine(), onProgress: () => { throw new Error('affichage'); } });
    await expect(value.recognize(image)).resolves.toMatchObject({ text: 'Bonjour 日本語' });
  });
});

describe('Tesseract 7 : protocole et assets locaux', () => {
  it('charge uniquement /ocr et transmet les octets de l’image, avec les trois langues', async () => {
    const calls: Array<{ workerId: string; jobId: string; action: string; payload: Record<string, unknown> }> = [];
    const terminate = vi.fn();
    class WorkerMock {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      constructor(url: string) { expect(url).toBe('app://magistra/ocr/worker.min.js'); }
      postMessage(packet: typeof calls[number], transfer: Transferable[]) {
        calls.push(packet);
        if (packet.action === 'recognize') {
          expect(packet.payload.image).toBeInstanceOf(Uint8Array);
          expect(transfer).toHaveLength(1);
        }
        queueMicrotask(() => this.onmessage?.({ data: { ...packet, status: 'resolve', data: packet.action === 'recognize' ? { text: '日本語', confidence: 92 } : undefined } }));
      }
      terminate = terminate;
    }
    vi.stubGlobal('window', { location: { href: 'app://magistra/generer' } });
    vi.stubGlobal('Worker', WorkerMock);
    const value = session();
    expect(await value.recognize(image)).toEqual({ text: '日本語', confidence: 92 });
    expect(calls.map(call => call.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize']);
    expect(calls[0].payload).toMatchObject({ options: { corePath: 'app://magistra/ocr/core', lstmOnly: true } });
    expect(calls[1].payload).toMatchObject({ langs: OCR_LANGUAGES, options: { langPath: 'app://magistra/ocr/lang', cacheMethod: 'none', gzip: true } });
    expect(calls[2].payload).toMatchObject({ langs: 'fra+eng+jpn', oem: 1 });
    await value.dispose();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
