// Outils texte : normalisation, découpage en mots, racinisation légère du français.

const STOPWORDS = new Set(`
a à au aux avec ce ces cet cette ceci cela ça dans de des du elle elles en et eux il ils je la le les leur leurs lui ma mais me même mes moi mon ne nos notre nous on ou où par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y
est sont été être avoir ont a ai as avons avez fait faire plus moins très tout tous toute toutes sans sous entre vers chez comme si non oui alors aussi ainsi donc car ni or puis dont quand leurs cela celui celle ceux celles
d l j m n s t c qu
the of and to in is are for on with as by an be this that from at or it its was were which
`.split(/\s+/).filter(Boolean));

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeForSearch(text: string): string {
  return stripAccents(text.toLowerCase()).replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

const SUFFIXES = [
  'issements', 'issement', 'atrices', 'atrice', 'ateurs', 'ateur', 'ations', 'ation', 'ements', 'ement',
  'ances', 'ance', 'ences', 'ence', 'ites', 'ite', 'ives', 'ive', 'euses', 'euse', 'eurs', 'eur',
  'ismes', 'isme', 'istes', 'iste', 'iques', 'ique', 'ables', 'able', 'ibles', 'ible', 'es', 's', 'x', 'e',
];

/** Noms dont le pluriel en -yaux / -iaux se rattache à un singulier en -au (et non en -al comme « loyaux », « mondiaux »). */
const PLURALS_IN_AU = new Set(['noyaux', 'tuyaux', 'boyaux', 'joyaux', 'materiaux']);

/** Pluriels en -aux dont le singulier est en -ail : travaux / travail, vitraux / vitrail, « emaux » (émaux) / émail. */
const PLURALS_IN_AIL = new Map([
  ['travaux', 'travail'], ['vitraux', 'vitrail'], ['coraux', 'corail'], ['soupiraux', 'soupirail'], ['vantaux', 'vantail'], ['emaux', 'email'],
]);

/**
 * Racinisation très légère : suffisante pour rapprocher « gouvernance » / « gouverner » / « gouvernances ».
 * Seuls pluriels irréguliers traités : -eaux → -eau (niveaux, réseaux, tableaux, bateaux), les noms de PLURALS_IN_AU
 * (noyaux, tuyaux, matériaux) et ceux de PLURALS_IN_AIL (travaux, vitraux, émaux) ; sinon -aux → -al (animaux / animal,
 * journaux / journal, chevaux / cheval). Les mots de 4 lettres ou moins (faux, eaux, taux) et les autres -aux de
 * 5 lettres restent tels quels. Aucune règle verbale ou dérivationnelle : elles rapprocheraient aussi des mots sans
 * rapport et déplaceraient le classement de tous les documents. Le mot est supposé déjà normalisé (minuscules, sans
 * accents), comme le fait `tokenize`.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('aux')) {
    const singularInAil = PLURALS_IN_AIL.get(word);
    if (singularInAil) return singularInAil;
    if (word.endsWith('eaux') || PLURALS_IN_AU.has(word)) return word.slice(0, -1);
    if (word.length > 5) return `${word.slice(0, -3)}al`;
  }
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

const UNICODE_WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const LATIN_WORD = /^[a-z0-9]+$/;
const CJK_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const wordSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;

/**
 * Le classement doit aussi retrouver les passages japonais, arabes ou cyrilliques.
 * Le traitement latin reste identique (apostrophes, mots vides et racinisation).
 * La segmentation évite de traiter une phrase japonaise sans espaces comme un seul mot ;
 * sur un ancien navigateur, les bigrammes CJK bornent le travail à la longueur du texte.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const addWord = (word: string) => {
    if (LATIN_WORD.test(word)) {
      if (word.length > 1 && !STOPWORDS.has(word)) tokens.push(stem(word));
    } else {
      tokens.push(word);
    }
  };
  for (const match of normalizeForSearch(text).matchAll(UNICODE_WORD)) {
    const word = match[0];
    if (LATIN_WORD.test(word)) {
      addWord(word);
    } else if (wordSegmenter) {
      for (const part of wordSegmenter.segment(word)) {
        if (part.isWordLike) addWord(part.segment);
      }
    } else if (CJK_WORD.test(word)) {
      const chars = Array.from(word);
      for (let i = 0; i < chars.length; i++) {
        tokens.push(chars[i]);
        if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
      }
    } else {
      addWord(word);
    }
  }
  return tokens;
}

/**
 * Mots pédagogiques ou interrogatifs très fréquents dans les objectifs et les consignes d'une demande (« les élèves
 * doivent comprendre et savoir expliquer… »). Ils ne désignent pas le sujet : retirés de la REQUÊTE de sélection des
 * passages, jamais du texte des documents (l'indexation ne change pas). Comparés après normalisation et racinisation.
 */
const GENERIC_QUERY_WORDS = `
élève élèves séance séances activité activités exercice exercices comprendre comprend savoir expliquer explique
exemple exemples objectif objectifs consigne consignes comment pourquoi peut peuvent doit doivent plusieurs chaque
après selon permet permettre capable
`.split(/\s+/).filter(Boolean);

export const QUERY_STOPWORDS: ReadonlySet<string> = new Set(GENERIC_QUERY_WORDS.map(w => stem(normalizeForSearch(w))));

/** Nettoie un texte extrait : espaces multiples, césures de fin de ligne, caractères de contrôle. */
export function cleanExtractedText(text: string): string {
  return text
    // Caractères de contrôle issus de l'extraction : retirés volontairement.
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\u00ad/g, '')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Nettoyage MINIMAL d'un fichier texte ou Markdown écrit par l'enseignant : l'indentation, les tabulations
 * et les espaces internes sont conservés (code Python, tableaux alignés). Seuls sont retirés les caractères
 * de contrôle, les espaces de fin de ligne et les lignes vides en excès.
 */
export function cleanPlainText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .split('\n')
    .map(trimLineEnd)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

/** Retire les espaces, tabulations et espaces insécables de fin de ligne, en temps linéaire (aucune regex ancrée en fin). */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 32 && c !== 9 && c !== 0xa0) break;
    end--;
  }
  return end === line.length ? line : line.slice(0, end);
}

/** Octets 0x80 à 0x9f de Windows-1252 ; les cinq positions non définies conservent leur contrôle C1. */
const WINDOWS_1252_C1 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

/** Décode du texte brut : UTF-8 par défaut, repli Windows-1252 si le fichier n'est manifestement pas en UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  // UTF-16 avec BOM (« Unicode » du Bloc-notes de Windows).
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const data = hasBom ? bytes.subarray(3) : bytes;
  try {
    // U+FFFD peut faire partie d'un UTF-8 valide : seul le décodage strict révèle
    // des octets invalides, sans corrompre les accents et les autres écritures.
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    // Certaines distributions Node décodent ce label comme Latin-1 : le remappage
    // des contrôles C1 restaure œ, €, apostrophes et tirets. Un navigateur conforme
    // produit déjà ces caractères et reste inchangé ; les UTF-8 valides n'entrent pas ici.
    return new TextDecoder('windows-1252').decode(data)
      .replace(/[\u0080-\u009f]/g, c => WINDOWS_1252_C1.charAt(c.charCodeAt(0) - 0x80));
  }
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}
