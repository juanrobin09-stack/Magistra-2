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
};
