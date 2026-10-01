// Exports du contenu généré : PDF fidèle, Markdown, copie, impression.
// jsPDF, les polices et l'analyseur ne sont chargés qu'au premier export PDF.

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MagistraError } from '@shared/errors';
import PrintView from './PrintView';

export interface ExportDoc {
  title: string;
  content: string;
  meta?: { type?: string; niveau?: string; matiere?: string; date?: string };
}

// ─── Nom de fichier ──────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 80;

/**
 * Nom de fichier sûr sous Windows, macOS et Linux : accents conservés, caractères interdits
 * (\ / : * ? " < > |) et caractères de contrôle retirés, longueur bornée, repli « magistra ».
 */
export function safeFileName(title: string, ext: string): string {
  const extension = String(ext ?? '').replace(/^\.+/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'txt';
  let base = String(title ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    // Caractères invisibles et de contrôle bidirectionnel (un nom piégé pourrait masquer son extension).
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const chars = [...base];
  if (chars.length > MAX_NAME_LENGTH) {
    let cut = chars.slice(0, MAX_NAME_LENGTH).join('');
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= 40) cut = cut.slice(0, lastSpace);
    base = cut.replace(/[.\s]+$/, '');
  }
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}_`;
  if (!base) base = 'magistra';
  return `${base}.${extension}`;
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Laisser le temps au navigateur (ou à Electron) de lire le fichier.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Écritures que le PDF de Magistra ne sait pas dessiner : idéogrammes (chinois, japonais, coréen), arabe et hébreu
 * (ni liaison des lettres, ni sens de lecture), écritures indiennes, thaï, birman, khmer, éthiopien… Les polices
 * intégrées (DejaVu) ne contiennent pas ces glyphes et en embarquer une coûterait plusieurs Mo : le PDF afficherait
 * « � » ou des lettres isolées dans le mauvais sens. L'impression du navigateur, elle, les rend correctement.
 */
const BROWSER_PDF_SCRIPTS = new RegExp(
  '[\\u0590-\\u08ff' // hébreu, arabe, syriaque, thaana, n'ko, samaritain, arabe étendu
  + '\\u0900-\\u0dff' // devanagari … sinhala
  + '\\u0e00-\\u0fff' // thaï, lao, tibétain
  + '\\u1000-\\u109f\\u1200-\\u139f\\u1780-\\u17ff' // birman, éthiopien, khmer
  + '\\u2e80-\\u2fdf\\u3000-\\u303f\\u3040-\\u30ff\\u3100-\\u31ff\\u3400-\\u4dbf\\u4e00-\\u9fff' // CJK, kana, bopomofo
  + '\\uac00-\\ud7af' // hangul
  + '\\ufb1d-\\ufdff\\ufe70-\\ufeff' // formes de présentation hébraïques et arabes
  + '\\uff66-\\uffdc]', // kana et hangul demi-chasse
);

/** Vrai si le texte contient une écriture que le PDF ne peut pas rendre fidèlement (voir BROWSER_PDF_SCRIPTS). */
export function needsBrowserPdf(text: string): boolean {
  return BROWSER_PDF_SCRIPTS.test(String(text ?? ''));
}

export const PDF_UNSUPPORTED_SCRIPT_MESSAGE =
  "Ce document contient du chinois, de l'arabe ou une autre écriture que le PDF ne sait pas reproduire fidèlement. "
  + 'Utilisez « Imprimer » puis « Enregistrer au format PDF » pour un rendu correct, ou « Markdown » / « Copier » pour le reprendre dans Word.';

/** Télécharge le document au format PDF (texte fidèle, polices Unicode intégrées). */
export async function exportPdf(doc: ExportDoc): Promise<void> {
  // Écriture non prise en charge : message clair plutôt qu'un PDF rempli de « � » (aucune police géante embarquée).
  if (needsBrowserPdf(`${doc.title ?? ''}\n${doc.content ?? ''}`)) {
    // Code autre qu'INTERNAL : les appelants (ResultPanel) n'affichent le message que pour les autres codes.
    throw new MagistraError('DOCUMENT_UNSUPPORTED', PDF_UNSUPPORTED_SCRIPT_MESSAGE);
  }
  try {
    const [pdfModule, fontModule] = await Promise.all([import('./pdf'), import('./fonts')]);
    const fonts = await fontModule.loadPdfFonts(pdfModule.requiredFonts(doc.content ?? ''));
    const pdf = pdfModule.markdownToPdf(doc, fonts);
    downloadBlob(pdf.output('blob'), safeFileName(doc.title, 'pdf'));
  } catch (err) {
    throw new MagistraError('INTERNAL', 'Création du PDF impossible. Réessayez ou utilisez « Imprimer ».', { cause: err });
  }
}

/** Télécharge le contenu Markdown (UTF-8), précédé du titre s'il n'en contient pas déjà un. */
export function exportMarkdown(doc: ExportDoc): void {
  const content = String(doc.content ?? '').replace(/\r\n?/g, '\n');
  const title = doc.title?.trim();
  const body = title && !/^\s*#\s/.test(content) ? `# ${title}\n\n${content}` : content;
  const text = body.endsWith('\n') ? body : `${body}\n`;
  downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), safeFileName(doc.title, 'md'));
}

// ─── Presse-papiers ──────────────────────────────────────────────────────────

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  let ok: boolean;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
    try {
      if (previous && selection) {
        selection.removeAllRanges();
        selection.addRange(previous);
      }
      active?.focus?.();
    } catch {
      // Sélection non restaurable : sans conséquence.
    }
  }
  return ok;
}

/** Copie le texte ; renvoie false en cas d'échec (ne rejette jamais). */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission refusée ou contexte non sécurisé : repli ci-dessous.
  }
  try {
    return legacyCopy(value);
  } catch {
    return false;
  }
}

// ─── Impression ──────────────────────────────────────────────────────────────

let activePrint: { host: HTMLElement; cleanup: () => void } | null = null;

/**
 * Imprime le document : il est rendu dans une zone dédiée (.print-root) et seule cette zone
 * est imprimée (voir @media print dans index.css). Fonctionne dans le navigateur et dans
 * l'application Windows (window.print ouvre la boîte de dialogue d'impression du système).
 */
export function printDocument(doc: ExportDoc): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  activePrint?.cleanup();

  const host = document.createElement('div');
  host.className = 'print-root';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  let root: Root | null = createRoot(host);
  const previousTitle = document.title;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', cleanup);
    document.documentElement.classList.remove('mg-printing');
    document.title = previousTitle;
    try {
      root?.unmount();
    } catch {
      // Déjà démonté.
    }
    root = null;
    host.remove();
    if (activePrint?.host === host) activePrint = null;
  };
  activePrint = { host, cleanup };

  try {
    flushSync(() => root!.render(createElement(PrintView, { doc })));
  } catch {
    cleanup();
    return;
  }
  document.documentElement.classList.add('mg-printing');
  // Titre de la fenêtre = nom proposé par « Enregistrer au format PDF ».
  if (doc.title?.trim()) document.title = doc.title.trim();
  window.addEventListener('afterprint', cleanup);

  const run = () => {
    if (done) return;
    try {
      window.print();
    } catch {
      cleanup();
    }
  };
  // Laisser la mise en page se faire (chargement des polices KaTeX, DM Sans) avant d'imprimer.
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  schedule(() => {
    const ready = typeof document.fonts?.ready?.then === 'function' ? document.fonts.ready : null;
    if (!ready) {
      run();
      return;
    }
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      run();
    };
    ready.then(start, start);
    setTimeout(start, 1_500); // ne jamais bloquer l'impression sur une police
  });
}
