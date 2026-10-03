// Typographie française du document final : espace insécable avant « : », « ; », « ! » et « ? », et à l'intérieur des
// guillemets « … ». Sans elle, « Corrigé : B » se coupe en fin de ligne et laisse « : » seul au début de la suivante
// (à l'écran, dans le PDF exporté et dans Word).
//
// Fonction pure et idempotente, appliquée au document FINAL seulement (jamais aux morceaux affichés en direct).
// Ne touchent jamais : blocs de code et code en ligne, formules ($…$, $$…$$, \(…\), \[…\]), adresses, balises HTML,
// destinations de liens, lignes de séparation de tableau, citations [S1].

import { mapProse } from './citations.js';

/** Espace insécable (U+00A0 plutôt que U+202F : présent dans les polices du PDF, de Word et du site). */
const NBSP = ' ';
/** Marqueur interne d'un passage protégé (caractère d'usage privé, absent des textes réels). */
const HOLD = '';

/**
 * Passages à ne jamais modifier. L'ordre compte : les plus englobants d'abord.
 * Motifs en temps linéaire, même sur une sortie dégénérée (lignes de milliers d'espaces, « <a » ou « \( » répétés et
 * jamais fermés) : un corps de balise, de formule ou de lien ne contient pas de nouvelle ouverture, et deux blocs
 * d'espaces ne se suivent pas sans caractère entre eux, sinon chaque début possible reparcourt toute la suite.
 * Dans une formule, « \\ » (saut de ligne LaTeX, « \\[2pt] » compris) est une unité : il ne ferme ni n'ouvre rien.
 */
const PROTECTED: readonly RegExp[] = [
  /\$\$[\s\S]*?\$\$/g,
  /(?<!\\)\\\((?:\\\\|\\(?![\\()])|[^\\])*\\\)/g,
  /(?<!\\)\\\[(?:\\\\|\\(?![\\[\]])|[^\\])*\\\]/g,
  /\$[^$\n]+\$/g,
  /<\/?[A-Za-z][^<>\n]*>/g,
  /\b(?:https?:\/\/|www\.)[^\s<>"'[\]()]*/gi,
  /\]\((?:[^)\n\]]|\](?!\())*\)/g,
  /\[\s*(?:Sources?\s+|S\s?)\d{1,3}[^\]\n]{0,100}\]/g,
  /^[ \t]*(?:\|[ \t]*)?:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*(?:\|[ \t]*)?$/gm,
];

/** Espace(s) avant « : ; ! ? » : après un mot ou un signe qui le ferme, et avant un blanc, une fin de ligne, « * », « _ », « ) » ou « » ». */
const BEFORE_PUNCTUATION = /(?<=[\p{L}\p{N})\]»*_%’”"'…])[ \t]+(?=[:;!?](?![^\s*_)»]))/gu;
/** Espace(s) après « « » et avant « » » (guillemets français). */
const AFTER_OPENING = /«[ \t]+(?=\S)/g;
const BEFORE_CLOSING = /(?<=\S)[ \t]+»/g;

function space(prose: string): string {
  const held: string[] = [];
  let out = prose;
  for (const re of PROTECTED) {
    out = out.replace(re, found => {
      held.push(found);
      return `${HOLD}${held.length - 1}${HOLD}`;
    });
  }
  out = out
    .replace(BEFORE_PUNCTUATION, NBSP)
    .replace(AFTER_OPENING, `«${NBSP}`)
    .replace(BEFORE_CLOSING, `${NBSP}»`);
  // Un passage protégé peut en contenir un autre (adresse dans une destination de lien) : restitution en plusieurs passes.
  const marker = new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g');
  for (let pass = 0; pass < PROTECTED.length && out.includes(HOLD); pass++) {
    out = out.replace(marker, (_m, i: string) => held[Number(i)] ?? '');
  }
  return out;
}

/** Texte final avec les espaces insécables de la typographie française (voir l'en-tête du fichier). */
export function normalizeFrenchTypography(text: string): string {
  // Un marqueur interne déjà présent dans le texte (jamais en pratique) rendrait la restauration ambiguë : texte rendu tel quel.
  if (text.includes(HOLD)) return text;
  return mapProse(text, space);
}
