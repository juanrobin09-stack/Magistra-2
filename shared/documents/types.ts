import type { DocKind, Locator } from '../types.js';

/** Unité logique d'un document : une page, une diapositive, une section… */
export interface DocumentUnit {
  locator: Locator;
  text: string;
}

export interface ExtractedDocument {
  id: string;
  name: string;
  kind: DocKind;
  units: DocumentUnit[];
  stats: {
    pages?: number;
    slides?: number;
    sections?: number;
    paragraphs?: number;
    lines?: number;
    chars: number;
  };
  warnings: string[];
}

export interface Chunk {
  docId: string;
  docName: string;
  kind: DocKind;
  locator: Locator;
  text: string;
  /** Position du morceau dans le document (ordre de lecture). */
  order: number;
}

/** Limites de sécurité (éviter de bloquer la machine avec un fichier démesuré). */
export const DOCUMENT_LIMITS = {
  maxFileBytes: 60 * 1024 * 1024,
  maxCharsPerDocument: 3_000_000,
  maxDocuments: 12,
  maxPdfPages: 2_000,
  /** Pages nécessitant de l'OCR, bornées séparément du texte natif pour garder l'analyse raisonnable. */
  maxOcrPages: 100,
  /** DOCX / PPTX : une entrée XML décompressée au-delà de cette taille est refusée (bombe de décompression). */
  maxXmlEntryBytes: 80 * 1024 * 1024,
  /** DOCX / PPTX : total décompressé lu dans un même fichier. */
  maxUncompressedBytes: 200 * 1024 * 1024,
  /** DOCX / PPTX : nombre d'entrées du zip (un vrai fichier Office en a quelques centaines). */
  maxZipEntries: 10_000,
  /** DOCX : définitions de listes (numbering.xml) et styles de paragraphe (styles.xml) lus ; au-delà, ignorés. */
  maxNumberingEntries: 10_000,
  maxSlides: 2_000,
};
