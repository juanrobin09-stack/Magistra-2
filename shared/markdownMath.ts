// Formules écrites avec les délimiteurs LaTeX « \( … \) » et « \[ … \] », ou « $ … $ » avec des espaces intérieurs.
//
// L'affichage (MarkdownView) et l'export PDF (parseMarkdown) ne reconnaissent que « $…$ » et « $$…$$ » (remark-math).
// En Markdown, « \( » n'est qu'une parenthèse échappée : « \( 3 \times 4 \) » s'affichait « ( 3 \times 4 ) », commande
// LaTeX comprise, et « \[ x^2 + 1 = 0 \] » devenait « [ x^2 + 1 = 0 ] ». Beaucoup de modèles (surtout les petits)
// écrivent pourtant ainsi, malgré la consigne du prompt. De même, « $ \frac{1}{2} $ » (espaces intérieurs) restait du
// texte brut : la règle qui protège les montants (« 5 $ et 10 $ », guardMath) l'écartait.
//
// normalizeMathDelimiters convertit ces écritures au moment de l'affichage et de l'export SEULEMENT : le texte
// enregistré reste celui du modèle. Le code (blocs et code en ligne) n'est jamais modifié ; des crochets échappés
// qui ne contiennent pas de formule (« \[Date\] », « \[Source 1\] ») restent tels quels.
//  - « \( … \) » (sur une ligne) : formule LaTeX → « $$…$$ » en ligne (jamais apparié par erreur à un « $ » monétaire
//    de la même phrase) ; nombre ou calcul simple sans commande ni inégalité (« \(12\) », « \(x = 3\) ») → texte
//    simple (la virgule décimale reste « 3,5 ») ; texte entre parenthèses échappées (« \(voir annexe\) ») → inchangé ;
//  - « \[ … \] » (éventuellement sur plusieurs lignes) contenant une formule : seul sur sa ou ses lignes → bloc « $$ »
//    sur ses propres lignes (même retrait, pour rester dans un élément de liste ; mêmes marqueurs « > » dans une
//    citation) ; au milieu d'une ligne → « $$…$$ » en ligne ;
//  - « $ \frac{1}{2} $ » : espaces intérieurs retirés si le contenu contient une commande LaTeX (un montant n'en a pas).
// Ce qui devient une formule est rendu sûr pour KaTeX (mathSafe) : « % » n'y commence pas un commentaire, et un blanc
// à compléter (« (1) ________ » d'un texte à trous, « ___ ») n'y est pas lu comme un indice.
//
// Temps linéaire, même sur une sortie dégénérée (longues suites d'espaces, délimiteurs jamais fermés) : l'affichage
// refait la conversion à chaque morceau reçu pendant la rédaction.

/** Commande LaTeX, exposant, indice ou accolade : le contenu est une formule. */
const TEX = /\\[a-zA-Z]+|[\^_{}]/;
/** Égalité, somme ou inégalité (formule en bloc sans commande : « \[ x + 1 = 0 \] »). */
const OPERATOR = /[=+<>≤≥×÷−]/;
/** Mot de trois lettres ou plus : du texte entre parenthèses ou crochets échappés, pas une formule. */
const WORD = /\p{L}{3,}/u;
/**
 * Nombre ou calcul simple, affiché tel quel sans risque de mise en forme Markdown. Jamais « < » ni « > » : dans le
 * texte, « a<b et b>0 » serait lu comme une balise HTML (« <b et b> ») puis retiré avec le texte qu'elle contient ;
 * une inégalité reste donc une formule.
 */
const SIMPLE = /^[\p{L}\p{N}\s.,;:!?=+\-−×÷·/≤≥%°'’()]+$/u;

// Le contenu d'une formule ne contient jamais un autre délimiteur ouvrant non échappé : chaque recherche s'arrête au
// délimiteur suivant, d'où un temps linéaire même quand aucun n'est fermé (« \[ » répété, rédaction en cours).
const DISPLAY_RE = /(?<!\\)\\\[((?:(?!(?<!\\)\\\[)[\s\S]){0,4000}?)(?<!\\)\\\]/g;
const INLINE_RE = /(?<!\\)\\\(((?:(?!(?<!\\)\\\()[^\n]){0,1000}?)(?<!\\)\\\)/g;
/**
 * « $ … $ » simple (jamais « $$ ») : les espaces de tête sont capturés tous d'un coup (le contenu commence par autre
 * chose qu'un espace), ceux de fin retirés après coup. Deux suites d'espaces qui se disputaient les mêmes caractères
 * rendaient la recherche cubique : « 5 $ » suivi de milliers d'espaces figeait l'affichage.
 */
const SPACED_DOLLARS_RE = /(?<![\\$])\$(?!\$)([ \t]*)(?![ \t])([^$\n]{1,1000}?)(?<!\\)\$(?!\$)/g;
const FENCE_RE = /^\s*(```+|~~~+)/;
/** Code en ligne : même lecture que mapProse (shared/citations.ts). */
const INLINE_CODE_RE = /`+[^`\n]*?`+/g;
/** Début du repère d'un code en ligne masqué : une formule qui en contient un n'est pas convertie. */
const CODE_MARK = '';
const CODE_END = '';
const CODE_RESTORE_RE = /(\d+)/g;
/** « $ » non échappé dans une formule à convertir : « $$…$$ » serait fermé trop tôt (« \( 5 $ \) »). */
const BARE_DOLLAR = /(?<!\\)\$/;
/** Marqueurs de citation en tête de ligne (« > », « >> », « > > »). */
const QUOTE_PREFIX_RE = /^[ \t]*(?:>[ \t]*)*/;

/**
 * Applique `fn` au texte hors code : les blocs de code (``` ou ~~~) sont recopiés tels quels, et le code en ligne est
 * masqué pendant l'appel (repères du plan privé d'Unicode) puis restitué. Contrairement à mapProse, `fn` reçoit des
 * lignes entières : elle peut savoir si une formule occupe toute sa ligne.
 */
function mapOutsideCode(text: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (!buffer.length) return;
    const codes: string[] = [];
    const masked = buffer.join('\n').replace(INLINE_CODE_RE, code => `${CODE_MARK}${codes.push(code) - 1}${CODE_END}`);
    out.push(fn(masked).replace(CODE_RESTORE_RE, (mark, i: string) => codes[Number(i)] ?? mark));
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      flush();
      fence = marker;
      out.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * Contenu rendu sûr pour KaTeX, seulement là où du texte devient une formule :
 *  - « % » y commencerait un commentaire : la suite disparaîtrait sans erreur (« 20 % \times 150 » affichait « 20 ») ;
 *  - une suite d'au moins deux « _ » n'est jamais un indice mais un blanc à compléter (« (1) ________ » posé par le
 *    texte à trous, « 3 + ___ = 5 ») : KaTeX la refusait (« Expected group after '_' ») et affichait une erreur rouge.
 *    Elle devient « \_ » répété, le trait des blancs que shared/cloze.ts pose lui-même dans une formule.
 * Ce qui est déjà échappé (« \% », « \_ », « \\ ») est laissé tel quel.
 */
function mathSafe(tex: string): string {
  return tex.replace(/\\[\s\S]|_{2,}|%/g, token => {
    if (token[0] === '\\') return token;
    return token === '%' ? '\\%' : '\\_'.repeat(token.length);
  });
}

/** `text` sans ses espaces et tabulations de fin (sans expression régulière : temps linéaire). */
function trimBlanksEnd(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return text.slice(0, end);
}

function displayMath(match: string, inner: string, offset: number, whole: string): string {
  const lineStart = whole.lastIndexOf('\n', offset - 1) + 1;
  const end = offset + match.length;
  const lineEnd = whole.indexOf('\n', end);
  const before = whole.slice(lineStart, offset);
  const after = whole.slice(end, lineEnd === -1 ? undefined : lineEnd);
  // Dans une citation, les lignes suivantes commencent par « > » : ces marqueurs ne font pas partie de la formule.
  const quoted = before.trimStart().startsWith('>');
  const lines = inner.split('\n').map(line => (quoted ? line.replace(QUOTE_PREFIX_RE, '') : line).trim()).filter(Boolean);
  const tex = lines.join('\n');
  if (!tex || tex.includes(CODE_MARK) || BARE_DOLLAR.test(tex) || !(TEX.test(tex) || (OPERATOR.test(tex) && !WORD.test(tex)))) return match;
  if (/^[ \t>]*$/.test(before) && /^[ \t]*$/.test(after)) {
    // Seule sur sa ou ses lignes : bloc « $$ ». Ce qui précède « \[ » (retrait d'un élément de liste, marqueurs de
    // citation), déjà écrit sur la première ligne, est repris au début de chacune des suivantes.
    return ['$$', ...lines.map(line => `${before}${mathSafe(line)}`), `${before}$$`].join('\n');
  }
  return `$$${mathSafe(tex.replace(/\s+/g, ' '))}$$`;
}

function inlineMath(match: string, inner: string): string {
  const tex = inner.trim();
  if (!tex || tex.includes(CODE_MARK) || BARE_DOLLAR.test(tex)) return match;
  if (TEX.test(tex)) return `$$${mathSafe(tex)}$$`;
  if (WORD.test(tex)) return match;
  return SIMPLE.test(tex) ? tex : `$$${mathSafe(tex)}$$`;
}

function spacedDollars(match: string, lead: string, body: string): string {
  const tex = trimBlanksEnd(body);
  return (lead || tex.length < body.length) && /\\[a-zA-Z]/.test(tex) ? `$${mathSafe(tex)}$` : match;
}

function convert(prose: string): string {
  return prose
    .replace(DISPLAY_RE, displayMath)
    .replace(INLINE_RE, inlineMath)
    .replace(SPACED_DOLLARS_RE, spacedDollars);
}

/** Délimiteurs de formules convertis pour remark-math (voir l'en-tête) ; texte sans formule rendu tel quel. */
export function normalizeMathDelimiters(text: string): string {
  if (typeof text !== 'string' || !/\\[([]|\$/.test(text)) return text;
  return mapOutsideCode(text, convert);
}
