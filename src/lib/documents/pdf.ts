// Les tables de caractères (CMaps), polices de substitution et décodeurs sont
// embarqués avec l'application. Les PDF japonais/chinois/coréens et les PDF sans
// polices intégrées se lisent ainsi sans CDN ni connexion Internet.

import { MagistraError } from '@shared/errors';
import type * as PdfJs from 'pdfjs-dist';

export type PdfJsModule = typeof PdfJs;

export function pdfResourceOptions(base: string) {
  const root = `${base.replace(/\/$/, '')}/pdfjs/`;
  return {
    cMapUrl: `${root}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}standard_fonts/`,
    iccUrl: `${root}iccs/`,
    wasmUrl: `${root}wasm/`,
    // app:// est un protocole Electron autorisé, mais pdf.js ne le considère pas
    // comme une URL HTTP utilisable par son worker. Les factories de la page
    // chargent les mêmes ressources locales aussi bien en app:// qu'en HTTPS.
    useWorkerFetch: false,
  };
}

/** Conserve l'API pdf.js, en appliquant les ressources à chaque ouverture. */
export function withLocalPdfResources(lib: PdfJsModule, base: string): PdfJsModule {
  const resources = pdfResourceOptions(base);
  return {
    ...lib,
    getDocument(params = {}) {
      return lib.getDocument({ ...resources, ...params });
    },
  };
}

let pdfjsPromise: Promise<PdfJsModule> | null = null;

/** Les builds legacy incluent les polyfills nécessaires aux navigateurs anciens. */
function supportsModernPdfJs(): boolean {
  const mapProto = Map.prototype as unknown as { getOrInsertComputed?: unknown };
  const math = Math as unknown as { sumPrecise?: unknown };
  return typeof mapProto.getOrInsertComputed === 'function' && typeof math.sumPrecise === 'function';
}

export function loadPdfJs(): Promise<PdfJsModule> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = supportsModernPdfJs()
      ? await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      : await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return withLocalPdfResources(lib, import.meta.env.BASE_URL);
  })().catch(err => {
    pdfjsPromise = null;
    throw new MagistraError('DOCUMENT_UNSUPPORTED', 'Lecture des PDF indisponible. Rechargez la page puis réessayez.', { cause: err });
  });
  return pdfjsPromise;
}
