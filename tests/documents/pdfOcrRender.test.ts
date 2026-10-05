import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentImportProgress, PdfPageLike } from '@shared/documents/extract';
import { createPdfPageRecognizer, sparsePageHasImage } from '@/lib/documents/pdfOcr';

const imageOps = vi.hoisted(() => ({
  paintImageXObject: 85, paintInlineImageXObject: 86, paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88, paintImageMaskXObject: 83, paintImageMaskXObjectGroup: 84,
  paintImageMaskXObjectRepeat: 89, paintSolidColorImageMask: 90,
}));
vi.mock('@/lib/documents/pdf', () => ({ loadPdfJs: vi.fn(async () => ({ OPS: imageOps })) }));

const ocr = vi.hoisted(() => ({
  recognize: vi.fn(async (_canvas: HTMLCanvasElement) => ({ text: 'Cours reconnu 日本語', confidence: 92 })),
  dispose: vi.fn(async () => {}),
  create: vi.fn(),
}));
vi.mock('@/lib/documents/ocr', () => ({
  createOcrSession: ocr.create.mockImplementation(() => ({ recognize: ocr.recognize, dispose: ocr.dispose })),
}));

const progress: DocumentImportProgress = { stage: 'recognizing', page: 1, pages: 1 };
const recognizers: ReturnType<typeof createPdfPageRecognizer>[] = [];
function recognizer(options: Parameters<typeof createPdfPageRecognizer>[0] = {}) {
  const value = createPdfPageRecognizer(options);
  recognizers.push(value);
  return value;
}
function canvasDocument() {
  const canvases: Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }> = [];
  const createElement = vi.fn(() => {
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({})) };
    canvases.push(canvas);
    return canvas;
  });
  vi.stubGlobal('document', { createElement });
  return { canvases, createElement };
}
type TestRender = (options: { canvas: HTMLCanvasElement }) => { promise: Promise<void>; cancel(): void };
function page(width: number, height: number, render: TestRender = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))) {
  return {
    getTextContent: vi.fn(async () => ({ items: [] })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })),
    render,
  } as unknown as PdfPageLike;
}

afterEach(async () => {
  await Promise.all(recognizers.splice(0).map(value => value.dispose()));
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rendu PDF avant OCR : limites et interruption', () => {
  it('rejette une page aux dimensions impossibles avant de créer un bitmap ou un moteur', async () => {
    const { createElement } = canvasDocument();
    await expect(recognizer().recognize(page(Infinity, 500), progress)).rejects.toMatchObject({ code: 'DOCUMENT_UNREADABLE' });
    expect(createElement).not.toHaveBeenCalled();
    expect(ocr.create).not.toHaveBeenCalled();
  });

  it('ne commence pas un rendu annulé', async () => {
    const { createElement } = canvasDocument();
    const controller = new AbortController();
    controller.abort();
    await expect(recognizer({ signal: controller.signal }).recognize(page(600, 800), progress)).rejects.toMatchObject({ name: 'AbortError' });
    expect(createElement).not.toHaveBeenCalled();
    expect(ocr.create).not.toHaveBeenCalled();
  });

  it('borne une très grande page et libère son bitmap après la reconnaissance', async () => {
    const { canvases } = canvasDocument();
    let dimensions: number[] = [];
    const render = vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
      dimensions = [canvas.width, canvas.height];
      return { promise: Promise.resolve(), cancel: vi.fn() };
    });
    const value = recognizer();
    await expect(value.recognize(page(100_000, 100_000, render), progress)).resolves.toMatchObject({ text: 'Cours reconnu 日本語' });
    expect(Math.max(...dimensions)).toBeLessThanOrEqual(4096);
    // L'arrondi d'une dimension entière peut ajouter une ligne et une colonne.
    expect(dimensions[0] * dimensions[1]).toBeLessThan(6_010_000);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    await value.dispose();
    expect(ocr.dispose).toHaveBeenCalledTimes(1);
  });

  it('annule un rendu en cours et ne démarre pas OCR ensuite', async () => {
    const { canvases } = canvasDocument();
    const controller = new AbortController();
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((_resolve, no) => { reject = no; });
    const cancel = vi.fn(() => reject(new Error('render cancelled')));
    const result = recognizer({ signal: controller.signal }).recognize(page(600, 800, vi.fn(() => ({ promise, cancel }))), progress);
    const settled = expect(result).rejects.toThrow('render cancelled');
    controller.abort();
    await settled;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(ocr.create).not.toHaveBeenCalled();
  });

  it('arrête un rendu qui dépasse le délai et libère la mémoire', async () => {
    vi.useFakeTimers();
    const { canvases } = canvasDocument();
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((_resolve, no) => { reject = no; });
    const cancel = vi.fn(() => reject(new Error('render timeout')));
    const result = recognizer().recognize(page(600, 800, vi.fn(() => ({ promise, cancel }))), progress);
    const settled = expect(result).rejects.toThrow('render timeout');
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(ocr.create).not.toHaveBeenCalled();
  });

  it('libère le bitmap même lorsque le moteur OCR échoue', async () => {
    const { canvases } = canvasDocument();
    ocr.recognize.mockRejectedValueOnce(new Error('OCR failed'));
    await expect(recognizer().recognize(page(600, 800), progress)).rejects.toThrow('OCR failed');
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
  });
});

describe('couche de texte courte : présence d’un scan', () => {
  function operatorPage(fnArray: number[], getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }> = vi.fn(async () => ({ fnArray, argsArray: [] }))) {
    return { getTextContent: async () => ({ items: [] }), getOperatorList } as unknown as PdfPageLike;
  }

  for (const [name, operator] of Object.entries(imageOps)) {
    it(`détecte ${name} sans rendre de bitmap ni démarrer le moteur OCR`, async () => {
      const { createElement } = canvasDocument();
      expect(await sparsePageHasImage(operatorPage([1, 20, operator]))).toBe(true);
      expect(createElement).not.toHaveBeenCalled();
      expect(ocr.create).not.toHaveBeenCalled();
    });
  }

  it('une page avec seulement du texte/des tracés (notamment japonais court) n’est pas un scan', async () => {
    expect(await sparsePageHasImage(operatorPage([1, 20, 44]))).toBe(false);
  });

  it('une annulation préalable ne lance aucune inspection', async () => {
    const controller = new AbortController();
    controller.abort();
    const getOperatorList = vi.fn(async () => ({ fnArray: [85], argsArray: [] }));
    await expect(sparsePageHasImage(operatorPage([], getOperatorList), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getOperatorList).not.toHaveBeenCalled();
  });

  it('annule une inspection suspendue ; une réponse tardive reste inoffensive', async () => {
    const controller = new AbortController();
    let resolve!: (operators: { fnArray: number[]; argsArray: unknown[] }) => void;
    const getOperatorList = vi.fn(() => new Promise<{ fnArray: number[]; argsArray: unknown[] }>(yes => { resolve = yes; }));
    const result = sparsePageHasImage(operatorPage([], getOperatorList), controller.signal);
    const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    for (let n = 0; n < 6; n++) await Promise.resolve();
    controller.abort();
    await checked;
    resolve({ fnArray: [85], argsArray: [] });
    await Promise.resolve();
  });

  it('règle une inspection qui ne répond plus après le délai prévu', async () => {
    vi.useFakeTimers();
    const getOperatorList = vi.fn(() => new Promise<{ fnArray: number[]; argsArray: unknown[] }>(() => {}));
    const result = sparsePageHasImage(operatorPage([], getOperatorList));
    const checked = expect(result).rejects.toMatchObject({ code: 'DOCUMENT_UNREADABLE' });
    await vi.advanceTimersByTimeAsync(30_000);
    await checked;
  });
});
