// Chargement des polices DejaVu pour l'export PDF (navigateur et application Windows).
// Les fichiers TTF sont servis par l'application elle-même (aucun service tiers) et ne sont
// téléchargés qu'au premier export PDF, puis gardés en mémoire pour la session.

import regularUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import boldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';
import italicUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url';
import boldItalicUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url';
import monoUrl from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import type { FontKey, PdfFonts } from './pdf';

const URLS: Record<FontKey, string> = {
  regular: regularUrl,
  bold: boldUrl,
  italic: italicUrl,
  bolditalic: boldItalicUrl,
  mono: monoUrl,
};

const cache = new Map<FontKey, Promise<ArrayBuffer>>();

function fetchFont(key: FontKey): Promise<ArrayBuffer> {
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(URLS[key])
      .then(res => {
        if (!res.ok) throw new Error(`Police ${key} indisponible (${res.status}).`);
        return res.arrayBuffer();
      })
      .catch(err => {
        cache.delete(key); // nouvel essai au prochain export
        throw err;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** Charge les polices demandées (DejaVu Sans normal et gras toujours inclus). */
export async function loadPdfFonts(keys: readonly FontKey[] = ['regular', 'bold', 'italic', 'bolditalic', 'mono']): Promise<PdfFonts> {
  const wanted = new Set<FontKey>(['regular', 'bold', ...keys]);
  const entries = await Promise.all([...wanted].map(async key => [key, await fetchFont(key)] as const));
  const fonts = Object.fromEntries(entries) as Partial<Record<FontKey, ArrayBuffer>>;
  return {
    regular: fonts.regular!,
    bold: fonts.bold!,
    italic: fonts.italic,
    bolditalic: fonts.bolditalic,
    mono: fonts.mono,
  };
}
