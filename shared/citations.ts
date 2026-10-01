// Citations vérifiables.
// Principe : les numéros [n] et la liste « Sources utilisées » sont produits par le code
// à partir des sources réellement fournies au modèle. Le modèle ne peut ni inventer une page,
// ni un document, ni une référence : toute citation inconnue est retirée.

import type { DocumentPassage, Locator, SourceRef } from './types.js';

/**
 * Localisation en toute lettre, toujours sur une seule ligne. Le titre de section vient du document (texte de tiers : un
 * « <w:br/> » de Word, un titre Markdown en lien) : `clean` le rend inoffensif là où il est affiché.
 */
export function formatLocator(locator: Locator, clean: (title: string) => string = singleLine): string {
  const range = (singular: string, plural: string) =>
    locator.start === locator.end ? `${singular} ${locator.start}` : `${plural} ${locator.start} à ${locator.end}`;
  switch (locator.type) {
    case 'pages':
      if (locator.labels) {
        // Numéro imprimé d'abord (celui que l'enseignant lit), position dans le fichier ensuite.
        const { start, end } = locator.labels;
        return locator.start === locator.end
          ? `page ${start} (p. ${locator.start} du PDF)`
          : `pages ${start} à ${end} (p. ${locator.start} à ${locator.end} du PDF)`;
      }
      return range('page', 'pages');
    case 'slides':
      return range('diapositive', 'diapositives');
    case 'lines':
      return range('ligne', 'lignes');
    case 'paragraphs':
      return range('paragraphe', 'paragraphes');
    case 'section': {
      const title = locator.title ? clean(truncate(locator.title, 80)) : '';
      return title ? `section « ${title} »` : range('section', 'sections');
    }
    default:
      return '';
  }
}

/** Localisation affichée, avec « (extrait) » quand seule une partie du passage a été transmise au modèle. */
export function formatLocatorFull(locator: Locator, clean?: (title: string) => string): string {
  const base = formatLocator(locator, clean);
  return locator.partial ? `${base} (extrait)` : base;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Passage documentaire numéroté, prêt à être inséré dans le prompt. */
export interface NumberedPassage {
  n: number;
  heading: string;
  text: string;
  ref: SourceRef;
}

export function documentSourceRef(p: DocumentPassage, n: number): SourceRef {
  return { n, kind: 'document', title: p.docName, docName: p.docName, locator: p.locator };
}

/** Texte de tiers ramené à une seule ligne (retours à la ligne, tabulations et caractères de contrôle deviennent une espace). */
function singleLine(value: string): string {
  return value.replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/**
 * Titre, auteur ou revue d'une source (texte de tiers : page web, notice Crossref, nom de fichier) rendu inoffensif
 * dans la liste « Sources utilisées » : une seule ligne, aucune syntaxe de lien, d'image, de code ou de HTML (un titre
 * ne doit jamais devenir un lien cliquable ni ajouter un titre ou une ligne), et pas d'adresse que le rendu
 * transformerait en lien : « https://exemple.fr/x » devient « exemple.fr/x ». Un titre ordinaire (lettres, points,
 * parenthèses) est inchangé.
 */
function mdSafe(value: string): string {
  return singleLine(value)
    // Sans « https:// » ni « www. » : le rendu en ferait des liens cliquables (même après un échappement).
    .replace(/\b(?:https?:\/\/|www\.)/gi, '')
    .replace(/[\\`<>[\]*_]/g, m => `\\${m}`);
}

export function formatSourceLine(s: SourceRef): string {
  if (s.kind === 'document') {
    return `[S${s.n}] ${mdSafe(s.docName ?? s.title)}${s.locator ? ` — ${formatLocatorFull(s.locator, mdSafe)}` : ''}`;
  }
  const authorList = s.authors && s.authors.length
    ? `${s.authors.slice(0, 3).map(mdSafe).join(', ')}${s.authors.length > 3 ? ' et al.' : ''}`
    : '';
  const authors = authorList ? `${authorList.replace(/\.+$/, '')}. ` : '';
  const title = mdSafe(s.title).replace(/[.\s]+$/, '');
  const year = s.year ? ` (${s.year})` : '';
  const venue = s.venue ? `. *${mdSafe(s.venue)}*` : '';
  const originLabel = s.kind === 'hal' ? 'HAL'
    : s.kind === 'crossref' ? 'Crossref'
      : s.kind === 'wikipedia' ? 'Wikipédia'
        : s.kind === 'institutional' ? 'Source institutionnelle'
          : '';
  const origin = originLabel && originLabel !== s.venue ? ` — ${originLabel}` : '';
  const link = s.doi ? ` https://doi.org/${s.doi}` : s.url ? ` ${s.url}` : '';
  return `[S${s.n}] ${authors}${title}${year}${venue}${origin}.${link}`;
}

/**
 * Le modèle cite ses sources sous la forme [S1], [S1, S3] ou [S2-S4].
 * Un préfixe distinct est indispensable : « [0, 1] », « [a, b] » (intervalles mathématiques) ne doivent
 * jamais être touchés. Le « S » majuscule est exigé : « [s1, s2] » peut être un intervalle.
 * Une localisation ajoutée par le modèle (« [S1, p. 14] ») est retirée : seule la localisation
 * vérifiée, produite par le code, figure dans « Sources utilisées ».
 */
const LOCATOR_WORDS = '(?:[Pp]{1,2}\\.|[Pp]ages?|[Pp]\\b|[Dd]iapo(?:sitive)?s?|[Ss]lides?|[Ss]ections?|§|[Ll]ignes?|[Ll]\\.|[Pp]aragraphes?|[Cc]hap(?:itre)?s?\\.?|[Ff]ol\\.|[Ff]euillets?)';
const CITATION_SOURCE = `\\[\\s*(?:Sources?\\s+|S\\s?)(\\d{1,3})((?:\\s*[,;–-]\\s*(?:S\\s?)?\\d{1,3}(?!\\d))*)(?:\\s*[,;:]?\\s*${LOCATOR_WORDS}[^\\]\\n]{0,80}|\\s*[,;:]\\s*[^\\]\\n]{1,80})?\\s*\\]`;

function citationRegex(): RegExp {
  return new RegExp(CITATION_SOURCE, 'g');
}

function parseCitation(first: string, rest: string): number[] {
  const tokens = `${first}${rest}`.replace(/S\s?/g, '');
  return expandCitation(tokens);
}

/**
 * Applique `fn` au texte courant uniquement : les blocs de code (``` / ~~~) et le code en ligne (`…`)
 * ne sont JAMAIS modifiés (variables S0, S1…, tableaux, DOI dans du code).
 */
export function mapProse(text: string, fn: (prose: string) => string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let buffer: string[] = [];
  const flushProse = () => {
    if (!buffer.length) return;
    const joined = buffer.join('\n');
    // Code en ligne : segments `…` (même nombre d'accents graves à l'ouverture et à la fermeture).
    const parts = joined.split(/(`+[^`\n]*?`+)/g);
    out.push(parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join(''));
    buffer = [];
  };
  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      flushProse();
      fence = marker;
      out.push(line);
      continue;
    }
    buffer.push(line);
  }
  flushProse();
  return out.join('\n');
}

/** Marqueur du bloc de code encore ouvert à la fin du texte (même lecture des blocs que mapProse), sinon null. */
export function unclosedFence(text: string): string | null {
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
    }
  }
  return fence;
}

/**
 * Pseudo-citations numériques non vérifiées, hors code : « [12] », « [4, p. 45] », « [1 ; p. 3] ».
 * Jamais : les intervalles « [0, 1] » / « [1, 2] », les indices « t[3] », les notes « [^1] »,
 * les liens « [1](…) » ni les définitions de référence « [1]: … ».
 */
const BARE_NUMERIC_CITATION = new RegExp(
  `(?<![\\w\\])^])\\[\\s*\\d{1,3}\\s*(?:[,;:]?\\s*${LOCATOR_WORDS}[^\\]\\n]{0,60})?\\](?![(:\\[])`,
  'g',
);

/** Numéros cités dans le texte ([S1], [S1, S3], [S2-S4]), code compris. */
export function citedNumbers(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(citationRegex())) {
    const nums = parseCitation(m[1], m[2] ?? '');
    if (nums.includes(0)) continue;
    for (const n of nums) found.add(n);
  }
  return found;
}

/** Numéros cités hors blocs de code et code en ligne. */
function citedNumbersInProse(text: string): Set<number> {
  const found = new Set<number>();
  mapProse(text, prose => {
    for (const n of citedNumbers(prose)) found.add(n);
    return prose;
  });
  return found;
}

function expandCitation(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(/\s*[,;]\s*/)) {
    const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part.trim());
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (b >= a && b - a < 50) for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d+$/.test(part.trim())) {
      out.push(parseInt(part.trim(), 10));
    }
  }
  return out;
}

const SOURCES_WORDS = '(?:sources?(?:\\s+utilis[ée]es)?|r[ée]f[ée]rences(?:\\s+bibliographiques)?|bibliographie(?:\\s+[\\p{L}-]+)?|webographie|sitographie|pour aller plus loin\\s*:\\s*sources|lectures\\s+(?:compl[ée]mentaires|conseill[ée]es|sugg[ée]r[ée]es))';
/** Titre Markdown (« ## Bibliographie »). */
const SOURCES_HEADING = new RegExp(`^#{1,6}\\s*\\**\\s*${SOURCES_WORDS}\\s*\\**\\s*:?\\s*\\**\\s*$`, 'iu');
/**
 * Pseudo-titre sur une ligne seule (« **Références bibliographiques :** », « Bibliographie : »).
 * « Sources » seul n'est pas retenu ici : « **Sources :** » suivi d'une liste peut être du vrai contenu
 * (cours sur les sources du droit, sources historiques…).
 */
const PSEUDO_WORDS = '(?:sources\\s+utilis[ée]es|r[ée]f[ée]rences(?:\\s+bibliographiques)?|bibliographie(?:\\s+[\\p{L}-]+)?|webographie|sitographie|lectures\\s+(?:compl[ée]mentaires|conseill[ée]es|sugg[ée]r[ée]es))';
const SOURCES_PSEUDO_HEADING = new RegExp(`^(?:\\*\\*|__)?\\s*${PSEUDO_WORDS}\\s*:?\\s*(?:\\*\\*|__)?\\s*:?\\s*$`, 'iu');
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)]|\[\d+\])\s+/;
/**
 * Ligne qui a l'allure d'une référence bibliographique (« Dupont, J. (2018). Titre… », « Martin P., 2019, … »,
 * lien ou DOI seul) : après un pseudo-titre de bibliographie, ces lignes sont retirées même hors liste.
 * Une ligne de texte ordinaire arrête le retrait : le contenu qui suit est conservé.
 */
const REFERENCE_LINE = new RegExp(
  '^\\s*(?:'
  + "\\p{Lu}[\\p{L}'’-]+(?:,\\s*|\\s+)(?:\\p{Lu}\\.|\\p{Lu}[\\p{L}-]+)[^\\n]*(?:\\(\\d{4}[a-z]?\\)|\\b\\d{4}[a-z]?[.,)])"
  + '|(?:https?:\\/\\/|doi:|10\\.\\d{4,9}\\/)\\S+\\s*$'
  + '|[*_][^*_\\n]+[*_][^\\n]*\\b\\d{4}\\b'
  + ')',
  'u',
);

interface StrippedSections {
  text: string;
  removed: string;
}

function splitModelSourcesSections(text: string): StrippedSections {
  const lines = text.split('\n');
  const out: string[] = [];
  const removed: string[] = [];
  let skipLevel = 0;
  let skipList = false;
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) inFence = !inFence;
    if (inFence) {
      if (skipLevel) removed.push(line);
      else out.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s/.exec(line);
    if (skipLevel) {
      if (heading && heading[1].length <= skipLevel) skipLevel = 0;
      else {
        removed.push(line);
        continue;
      }
    }
    if (skipList) {
      if (trimmed === '' || LIST_ITEM.test(line) || REFERENCE_LINE.test(line)) {
        removed.push(line);
        continue;
      }
      skipList = false;
    }
    if (SOURCES_HEADING.test(trimmed)) {
      skipLevel = /^(#{1,6})/.exec(trimmed)![1].length;
      removed.push(line);
      continue;
    }
    if (SOURCES_PSEUDO_HEADING.test(trimmed)) {
      skipList = true;
      removed.push(line);
      continue;
    }
    out.push(line);
  }
  // Séparateurs horizontaux orphelins laissés en fin de texte par la section retirée.
  while (out.length && /^\s*(?:-{3,}|\*{3,}|_{3,})?\s*$/.test(out[out.length - 1])) out.pop();
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), removed: removed.join('\n') };
}

/** Retire une section « Sources / Bibliographie » rédigée par le modèle (elle est reconstruite par le code). */
export function stripModelSourcesSection(text: string): string {
  return splitModelSourcesSections(text).text;
}

/** DOI nu, préfixé (« doi: ») ou sous forme d'URL (https://doi.org/…). */
const DOI_RE = /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:\s*)?\b(10\.\d{4,9}\/[^\s"<>)\]]*[^\s"<>)\].,;:])/gi;
/** Lien Markdown pointant vers un DOI : [texte](https://doi.org/10.…). */
const DOI_LINK_RE = /\[([^\]\n]{0,300})\]\(\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)(10\.\d{4,9}\/[^\s)]+)\s*\)/gi;
const UNVERIFIED = '[référence non vérifiée retirée]';
/** URL http(s) nue ; la ponctuation qui la suit n'en fait pas partie. */
const URL_RE = /\bhttps?:\/\/[^\s<>"'[\]()]*[^\s<>"'[\]().,;:!?»]/gi;
/** Lien (ou image) Markdown vers une URL http(s) : [texte](https://…). */
const MD_LINK_RE = /(!?)\[([^\]\n]{0,300})\]\(\s*<?((?:https?:\/\/|www\.|mailto:)[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/gi;
/** Lien automatique : <https://…> (ou <mailto:…>). */
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^\s>]+)>/gi;
/**
 * Adresse « www.… » nue : le rendu Markdown (GFM) en fait un lien cliquable, comme « https://… ». Jamais celle qui
 * suit « / », « @ » ou « . » (déjà une partie d'une adresse complète ou d'un courriel).
 */
const WWW_RE = /(?<![\w/@.:-])www\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^\s<>"'[\]()]*[^\s<>"'[\]().,;:!?»])?/gi;
const UNVERIFIED_LINK = '[lien non vérifié retiré]';

/** Hôte (sans « www. ») + chemin, pour comparer deux adresses. */
function urlKey(raw: string): string | null {
  try {
    const u = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

/** Adresses http(s) (et « www.… ») présentes dans un texte (documents, demande de l'enseignant). */
export function extractUrls(text: string): string[] {
  return [...(text.match(URL_RE) ?? []), ...(text.match(WWW_RE) ?? [])];
}
/** Marqueur interne d'une citation retirée (caractère d'usage privé, absent des textes réels). */
const REMOVED = '\uE000';

export interface FinalizeResult {
  content: string;
  used: SourceRef[];
  removedCitations: number;
  unverifiedDois: number;
  unverifiedLinks: number;
}

export interface FinalizeOptions {
  /**
   * Adresses légitimes en plus de celles des sources : celles qui figurent dans les documents fournis
   * ou dans la demande de l'enseignant.
   */
  allowedUrls?: readonly string[];
  /**
   * Adresses légitimes mais seulement TELLES QUELLES (même hôte, même chemin, même paramètres) : celles trouvées dans le
   * texte de pages web ou d'encyclopédie. Une page qui cite « https://exemple.fr » n'autorise pas « https://exemple.fr/x?d=… ».
   */
  allowedExactUrls?: readonly string[];
  /**
   * Texte COMPLET (et non partiel) : si des sources ont été fournies mais qu'aucune n'est citée, une mention
   * le signale à l'enseignant (sinon rien n'indiquerait que le contenu ne s'appuie pas sur ses documents).
   */
  flagUncited?: boolean;
}

/** Mention ajoutée quand aucune des sources fournies n'est citée (texte complet). */
export function uncitedSourcesNote(provided: readonly SourceRef[]): string {
  const what = provided.some(s => s.kind === 'document') ? 'sur vos documents' : 'sur les sources trouvées';
  return `> Aucune des sources fournies n'est citée dans ce contenu : il ne s'appuie peut-être pas ${what}. `
    + 'Vérifiez-le avant diffusion, ou relancez la génération.';
}

/**
 * Finalise le texte généré :
 * 1. retire toute citation [Sn] qui ne correspond à aucune source fournie ;
 * 2. neutralise tout DOI, et tout lien, qui n'appartient ni aux sources fournies ni à la demande ;
 * 3. retire la bibliographie éventuellement rédigée par le modèle ;
 * 4. ajoute « Sources utilisées », construite uniquement à partir des sources réellement citées,
 *    avec leur localisation exacte (pages, diapositives, section).
 * Le reste du texte (typographie, indentation, intervalles « [0, 1] ») n'est jamais modifié.
 */
export function finalizeCitations(text: string, provided: SourceRef[], options: FinalizeOptions = {}): FinalizeResult {
  const byN = new Map(provided.map(s => [s.n, s]));
  let removedCitations = 0;
  let unverifiedLinks = 0;
  const knownUrls = [...provided.map(s => s.url), ...(options.allowedUrls ?? [])]
    .map(u => (u ? urlKey(u) : null))
    .filter((k): k is string => Boolean(k));
  const exactUrls = new Set((options.allowedExactUrls ?? []).map(u => urlKey(u)).filter((k): k is string => Boolean(k)));
  // Même adresse, ou page située sous une adresse fournie (même site, chemin plus précis).
  const isKnownUrl = (url: string) => {
    if (url.includes('\uE001')) return true; // DOI fourni, déjà protégé
    const key = urlKey(url);
    return key !== null && (exactUrls.has(key) || knownUrls.some(k => key === k || key.startsWith(`${k}/`)));
  };

  const normalize = (match: string, first: string, rest: string | undefined) => {
    const nums = parseCitation(first, rest ?? '');
    // « [S0, S1, S2] » : une liste contenant 0 n'est pas une citation (les sources commencent à 1).
    if (nums.includes(0)) return match;
    const valid = [...new Set(nums.filter(n => byN.has(n)))];
    removedCitations += nums.length - nums.filter(n => byN.has(n)).length;
    if (nums.length === 0) removedCitations++;
    if (valid.length === 0) return REMOVED;
    return `[${valid.map(n => `S${n}`).join(', ')}]`;
  };

  // La bibliographie rédigée par le modèle est retirée : une source seulement énumérée à cet endroit,
  // sans citation dans le texte, n'est pas présentée comme « utilisée ».
  const sections = splitModelSourcesSections(text.replaceAll(REMOVED, ''));

  const knownDois = provided.map(s => s.doi?.trim()).filter((d): d is string => Boolean(d));
  const knownDoiSet = new Set(knownDois.map(d => d.toLowerCase()));
  let unverifiedDois = 0;

  let content = mapProse(sections.text, prose => {
    // 1. Citations [Sn] : normalisées ; inconnues retirées ; localisation proposée par le modèle retirée.
    let out = prose.replace(citationRegex(), normalize);
    // 2. Pseudo-citations numériques jamais vérifiées (« [12] », « [4, p. 45] ») : retirées.
    out = out.replace(BARE_NUMERIC_CITATION, () => {
      removedCitations++;
      return REMOVED;
    });
    // 3. DOI : les DOI fournis (même avec parenthèses) sont protégés, les autres neutralisés.
    const protectedDois: string[] = [];
    for (const doi of knownDois) {
      const re = new RegExp(doi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, found => {
        protectedDois.push(found);
        return `\uE001${protectedDois.length - 1}\uE001`;
      });
    }
    out = out.replace(DOI_LINK_RE, (match, _label: string, doi: string) => {
      if (knownDoiSet.has(doi.toLowerCase().replace(/[.,;:]+$/, ''))) return match;
      unverifiedDois++;
      return UNVERIFIED;
    });
    out = out.replace(DOI_RE, (match, doi: string) => {
      if (knownDoiSet.has(doi.toLowerCase())) return match;
      unverifiedDois++;
      return UNVERIFIED;
    });
    // 4. Liens : seuls ceux des sources fournies ou de la demande restent ; le texte d'un lien est gardé.
    out = out.replace(MD_LINK_RE, (match, _bang: string, label: string, url: string) => {
      if (isKnownUrl(url)) return match;
      unverifiedLinks++;
      return label.trim() ? label : UNVERIFIED_LINK;
    });
    out = out.replace(AUTOLINK_RE, (match, url: string) => {
      if (isKnownUrl(url)) return match;
      unverifiedLinks++;
      return UNVERIFIED_LINK;
    });
    out = out.replace(URL_RE, url => {
      if (isKnownUrl(url)) return url;
      unverifiedLinks++;
      return UNVERIFIED_LINK;
    });
    out = out.replace(WWW_RE, url => {
      if (isKnownUrl(url)) return url;
      unverifiedLinks++;
      return UNVERIFIED_LINK;
    });
    out = out.replace(/\uE001(\d+)\uE001/g, (_m, i: string) => protectedDois[Number(i)] ?? '');
    // Nettoyage limité aux emplacements des citations retirées : le reste du texte est intact.
    return out
      .replace(new RegExp(`^${REMOVED}[ \\t]*`, 'gm'), '')
      .replace(new RegExp(`[ \\t]*${REMOVED}`, 'g'), '');
  }).trimEnd();

  const cited = citedNumbersInProse(content);
  const used = provided.filter(s => cited.has(s.n));
  // Bloc de code laissé ouvert par le modèle (clôture oubliée ou isolée) : refermé ici, sinon « Sources utilisées »
  // et les mentions ajoutées ci-dessous s'afficheraient en texte brut, à l'intérieur de ce bloc.
  const openFence = unclosedFence(content);
  if (openFence) content += `\n${openFence}`;
  // Les citations vérifiées gardent leur forme « [S1] » : elles restent distinguables de tout « [1] »
  // (intervalle mathématique, numérotation) et renvoient à la liste « Sources utilisées » ci-dessous.
  if (used.length > 0) {
    content += `${content ? '\n\n' : ''}---\n\n## Sources utilisées\n\n${used.map(s => `- ${formatSourceLine(s)}`).join('\n')}\n`;
  }
  const notes: string[] = [];
  if (removedCitations > 0) notes.push('des citations qui ne correspondaient à aucune source fournie');
  if (unverifiedDois > 0) notes.push('des références (DOI) non vérifiables');
  if (unverifiedLinks > 0) notes.push('des liens absents des sources fournies');
  if (notes.length) {
    content += `\n> Magistra a retiré automatiquement ${notes.join(' et ')}. Vérifiez toute référence avant diffusion.\n`;
  }
  if (options.flagUncited && provided.length > 0 && used.length === 0 && content.trim()) {
    content += `\n\n${uncitedSourcesNote(provided)}\n`;
  }
  return { content, used, removedCitations, unverifiedDois, unverifiedLinks };
}
