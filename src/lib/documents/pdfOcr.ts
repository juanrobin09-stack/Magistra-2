import type { PDFPageProxy } from 'pdfjs-dist';
import { MagistraError } from '@shared/errors';
import type { DocumentImportProgress, ExtractDeps, PdfPageLike } from '@shared/documents/extract';
import type { OcrSession } from './ocr';
import { loadPdfJs } from './pdf';

const MAX_PIXELS = 6_000_000;
const MAX_DIMENSION = 4096;
const RENDER_TIMEOUT_MS = 60_000;
const INSPECTION_TIMEOUT_MS = 30_000;

/** Appelé uniquement pour une couche de texte courte : un filigrane ne doit pas cacher un scan. */
export async function sparsePageHasImage(rawPage: PdfPageLike, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const page = rawPage as PDFPageProxy;
  if (typeof page.getOperatorList !== 'function') return false;
  const { OPS } = await loadPdfJs();
  signal?.throwIfAborted();
  const images = new Set([
    OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup,
    OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
  ]);
  const operators = await new Promise<Awaited<ReturnType<PDFPageProxy['getOperatorList']>>>((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new MagistraError('DOCUMENT_UNREADABLE', 'L’analyse de cette page a dépassé le délai prévu.'))), INSPECTION_TIMEOUT_MS);
    const cancel = () => finish(() => reject(signal?.reason ?? new DOMException('Lecture arrêtée', 'AbortError')));
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      settle();
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    // La tâche du document sera détruite par extractPdf lors d'une annulation ; cette attente
    // se règle immédiatement, y compris si l'opérateur en cours ne répond plus.
    Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return page.getOperatorList();
    }).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
  signal?.throwIfAborted();
  return operators.fnArray.some(operator => images.has(operator));
}

/** Rendu borné d'une seule page. Le moteur et les images ne quittent jamais cet appareil. */
export function createPdfPageRecognizer(options: {
  signal?: AbortSignal;
  onProgress?: (progress: DocumentImportProgress) => void;
} = {}): {
  recognize: NonNullable<ExtractDeps['recognizePdfPage']>;
  hasImages(page: PdfPageLike): Promise<boolean>;
  dispose(): Promise<void>;
} {
  let session: OcrSession | undefined;
  let current: DocumentImportProgress | undefined;
  return {
    hasImages: page => sparsePageHasImage(page, options.signal),
    async recognize(rawPage: PdfPageLike, progress: DocumentImportProgress) {
      options.signal?.throwIfAborted();
      current = progress;
      const page = rawPage as PDFPageProxy;
      const original = page.getViewport({ scale: 1 });
      if (!(original.width > 0) || !(original.height > 0) || !Number.isFinite(original.width * original.height)) {
        throw new MagistraError('DOCUMENT_UNREADABLE', 'Cette page possède des dimensions impossibles à lire.');
      }
      const scale = Math.min(2, MAX_DIMENSION / Math.max(original.width, original.height), Math.sqrt(MAX_PIXELS / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new MagistraError('DOCUMENT_UNREADABLE', 'Impossible de préparer cette page pour la reconnaissance de texte.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      try {
        const render = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' });
        cancel = () => render.cancel();
        options.signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, RENDER_TIMEOUT_MS);
        await render.promise;
        clearTimeout(timer);
        options.signal?.throwIfAborted();
        session ??= (await import('./ocr')).createOcrSession({
          signal: options.signal,
          onProgress: () => { if (current) options.onProgress?.(current); },
        });
        return await session.recognize(canvas);
      } finally {
        if (timer) clearTimeout(timer);
        if (cancel) options.signal?.removeEventListener('abort', cancel);
        // Libérer le bitmap avant de passer à la page suivante.
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    async dispose() {
      current = undefined;
      await session?.dispose();
      session = undefined;
    },
  };
}
