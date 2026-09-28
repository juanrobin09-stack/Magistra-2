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
  'ismes', 'isme', 'istes', 'iste', 'iques', 'ique', 'ables', 'able', 'ibles', 'ible', 'aux', 'es', 's', 'x', 'e',
];

/** Racinisation très légère : suffisante pour rapprocher « gouvernance » / « gouverner » / « gouvernances ». */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

export function tokenize(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

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
    .replace(/[ \t\u00a0]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\s+$/g, '');
}

/** Décode du texte brut : UTF-8 par défaut, repli Windows-1252 si le fichier n'est manifestement pas en UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  // UTF-16 avec BOM (« Unicode » du Bloc-notes de Windows).
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(hasBom ? bytes.subarray(3) : bytes);
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements > 0 && replacements / Math.max(1, utf8.length) > 0.001) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
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
