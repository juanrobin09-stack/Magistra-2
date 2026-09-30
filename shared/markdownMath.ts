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
//    de la même phrase) ; nombre ou calcul simple sans commande (« \(12\) », « \(x = 3\) ») → texte simple (la virgule
//    décimale reste « 3,5 ») ; texte entre parenthèses échappées (« \(voir annexe\) ») → inchangé ;
//  - « \[ … \] » (éventuellement sur plusieurs lignes) contenant une formule : seul sur sa ou ses lignes → bloc « $$ »
//    sur ses propres lignes (même retrait, pour rester dans un élément de liste) ; au milieu d'une ligne → « $$…$$ » en
//    ligne ;
//  - « $ \frac{1}{2} $ » : espaces intérieurs retirés si le contenu contient une commande LaTeX (un montant n'en a pas).

/** Commande LaTeX, exposant, indice ou accolade : le contenu est une formule. */
const TEX = /\\[a-zA-Z]+|[\^_{}]/;
/** Égalité, somme ou inégalité (formule en bloc sans commande : « \[ x + 1 = 0 \] »). */
const OPERATOR = /[=+<>≤≥×÷−]/;
/** Mot de trois lettres ou plus : du texte entre parenthèses ou crochets échappés, pas une formule. */
const WORD = /\p{L}{3,}/u;
/** Nombre ou calcul simple, affiché tel quel sans risque de mise en forme Markdown. */
const SIMPLE = /^[\p{L}\p{N}\s.,;:!?=+\-−×÷·/<>≤≥%°'’()]+$/u;

const DISPLAY_RE = /(?<!\\)\\\[([\s\S]{0,4000}?)(?<!\\)\\\]/g;
const INLINE_RE = /(?<!\\)\\\(([^\n]{0,1000}?)(?<!\\)\\\)/g;
/** « $ … $ » simple (jamais « $$ »), espaces intérieurs capturés à part. */
const SPACED_DOLLARS_RE = /(?<![\\$])\$(?!\$)([ \t]*)([^$\n]{1,1000}?)([ \t]*)(?<!\\)\$(?!\$)/g;
const FENCE_RE = /^\s*(```+|~~~+)/;
/** Code en ligne : même lecture que mapProse (shared/citations.ts). */
const INLINE_CODE_RE = /`+[^`\n]*?`+/g;
/** Début du repère d'un code en ligne masqué : une formule qui en contient un n'est pas convertie. */
const CODE_MARK = '\uE000';
const CODE_END = '\uE001';
const CODE_RESTORE_RE = /\uE000(\d+)\uE001/g;

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

function displayMath(match: string, inner: string, offset: number, whole: string): string {
  const tex = inner.trim();
  if (!tex || tex.includes(CODE_MARK) || !(TEX.test(tex) || (OPERATOR.test(tex) && !WORD.test(tex)))) return match;
  const lineStart = whole.lastIndexOf('\n', offset - 1) + 1;
  const end = offset + match.length;
  const lineEnd = whole.indexOf('\n', end);
  const before = whole.slice(lineStart, offset);
  const after = whole.slice(end, lineEnd === -1 ? undefined : lineEnd);
  if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after)) {
    // Seule sur sa ou ses lignes : bloc « $$ » (le retrait de la ligne, déjà écrit avant, est repris à chaque ligne).
    const body = tex.split('\n').map(l => l.trim()).filter(Boolean).map(l => `${before}${l}`);
    return ['$$', ...body, `${before}$$`].join('\n');
  }
  return `$$${tex.replace(/\s+/g, ' ')}$$`;
}

function inlineMath(match: string, inner: string): string {
  const tex = inner.trim();
  if (!tex || tex.includes(CODE_MARK)) return match;
  if (TEX.test(tex)) return `$$${tex}$$`;
  if (WORD.test(tex)) return match;
  return SIMPLE.test(tex) ? tex : `$$${tex}$$`;
}

function convert(prose: string): string {
  return prose
    .replace(DISPLAY_RE, displayMath)
    .replace(INLINE_RE, inlineMath)
    .replace(SPACED_DOLLARS_RE, (match, lead: string, tex: string, trail: string) => (
      (lead || trail) && /\\[a-zA-Z]/.test(tex) ? `$${tex}$` : match
    ));
}

/** Délimiteurs de formules convertis pour remark-math (voir l'en-tête) ; texte sans formule rendu tel quel. */
export function normalizeMathDelimiters(text: string): string {
  if (typeof text !== 'string' || !/\\[([]|\$/.test(text)) return text;
  return mapOutsideCode(text, convert);
}
