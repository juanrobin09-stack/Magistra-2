// Outils de test : vraies polices DejaVu et extraction du texte d'un PDF avec pdf.js (Node).

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { jsPDF } from 'jspdf';
import type { PdfFonts } from '@/lib/export/pdf';

const require = createRequire(import.meta.url);
export const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');

export function loadTestFonts(): PdfFonts {
  const read = (file: string) => new Uint8Array(readFileSync(path.join(FONT_DIR, file)));
  return {
    regular: read('DejaVuSans.ttf'),
    bold: read('DejaVuSans-Bold.ttf'),
    italic: read('DejaVuSans-Oblique.ttf'),
    bolditalic: read('DejaVuSans-BoldOblique.ttf'),
    mono: read('DejaVuSansMono.ttf'),
  };
}

export interface ExtractedItem {
  str: string;
  page: number;
  x: number;
  y: number;
  width: number;
  size: number;
  fontName: string;
}

export interface ExtractedPdf {
  numPages: number;
  pages: string[];
  text: string;
  items: ExtractedItem[];
  links: { page: number; url: string }[];
  bytes: number;
}

export async function extractPdf(pdf: jsPDF, dumpName?: string): Promise<ExtractedPdf> {
  const buffer = new Uint8Array(pdf.output('arraybuffer'));
  const dumpDir = process.env.MAGISTRA_PDF_DUMP;
  if (dumpDir && dumpName) {
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(path.join(dumpDir, `${dumpName}.pdf`), buffer);
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  const items: ExtractedItem[] = [];
  const links: { page: number; url: string }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      text += raw.str + (raw.hasEOL ? '\n' : '');
      if (raw.str) {
        items.push({
          str: raw.str,
          page: p,
          x: raw.transform[4],
          y: raw.transform[5],
          width: raw.width,
          size: Math.hypot(raw.transform[0], raw.transform[1]),
          fontName: raw.fontName,
        });
      }
    }
    pages.push(text);
    for (const annot of await page.getAnnotations()) {
      const url = typeof annot.unsafeUrl === 'string' ? annot.unsafeUrl : annot.url;
      if (annot.subtype === 'Link' && typeof url === 'string') links.push({ page: p, url });
    }
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { numPages, pages, text: pages.join('\n'), items, links, bytes: buffer.byteLength };
}

/** Lignes de texte (une ligne = éléments de même ordonnée sur une page). */
export function textLines(extracted: ExtractedPdf): string[] {
  const byLine = new Map<string, ExtractedItem[]>();
  for (const item of extracted.items) {
    const key = `${item.page}:${Math.round(item.y)}`;
    const list = byLine.get(key) ?? [];
    list.push(item);
    byLine.set(key, list);
  }
  return [...byLine.values()].map(list => list.sort((a, b) => a.x - b.x).map(i => i.str).join(''));
}
