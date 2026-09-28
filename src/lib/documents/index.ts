// Lecture locale des documents de l'enseignant (PDF, DOCX, PPTX, TXT, MD).
// Le fichier est lu dans la page, jamais envoyé : seul le texte extrait (avec la localisation
// exacte de chaque passage) est ensuite utilisé. pdf.js n'est chargé qu'à la première lecture
// d'un PDF, avec son worker servi par l'application.

import { MagistraError, isMagistraError } from '@shared/errors';
import { extractDocument, describeDocument, type PdfJsLike } from '@shared/documents/extract';
import { selectPassages } from '@shared/documents/retrieve';
import { DOCUMENT_LIMITS, type ExtractedDocument } from '@shared/documents/types';

export { selectPassages, describeDocument, DOCUMENT_LIMITS };
export type { ExtractedDocument };

/** Formats acceptés par le sélecteur de fichiers. */
export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md';

const SUPPORTED = new Set(['pdf', 'docx', 'pptx', 'txt', 'md', 'markdown', 'text']);

let pdfjsPromise: Promise<PdfJsLike> | null = null;

/**
 * La version moderne de pdf.js utilise des API JavaScript très récentes
 * (Map.prototype.getOrInsertComputed, Math.sumPrecise) : sur un navigateur qui ne les a pas,
 * on charge la version « legacy » (polyfills inclus). L'application Windows utilise la moderne.
 */
function supportsModernPdfJs(): boolean {
  const mapProto = Map.prototype as unknown as { getOrInsertComputed?: unknown };
  const math = Math as unknown as { sumPrecise?: unknown };
  return typeof mapProto.getOrInsertComputed === 'function' && typeof math.sumPrecise === 'function';
}

function loadPdfJs(): Promise<PdfJsLike> {
  pdfjsPromise ??= (async () => {
    if (supportsModernPdfJs()) {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib as unknown as PdfJsLike;
    }
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib as unknown as PdfJsLike;
  })().catch(err => {
    pdfjsPromise = null;
    throw new MagistraError('DOCUMENT_UNSUPPORTED', 'Lecture des PDF indisponible. Rechargez la page puis réessayez.', { cause: err });
  });
  return pdfjsPromise;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extrait le texte d'un fichier choisi par l'enseignant, entièrement sur cet appareil. */
export async function extractFile(file: File): Promise<ExtractedDocument> {
  const name = file.name || 'document';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (!SUPPORTED.has(ext)) throw new MagistraError('DOCUMENT_UNSUPPORTED');
  if (file.size > DOCUMENT_LIMITS.maxFileBytes) {
    throw new MagistraError('DOCUMENT_TOO_LARGE', `« ${name} » dépasse ${Math.round(DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024)} Mo.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw new MagistraError('DOCUMENT_UNREADABLE', `Document impossible à lire : « ${name} ».`, { cause: err });
  }
  try {
    const pdfjs = ext === 'pdf' ? await loadPdfJs() : undefined;
    return await extractDocument({ id: randomId(), name, bytes }, { pdfjs });
  } catch (err) {
    if (isMagistraError(err)) throw err;
    throw new MagistraError('DOCUMENT_UNREADABLE', `Document impossible à lire : « ${name} ».`, { cause: err });
  }
}
