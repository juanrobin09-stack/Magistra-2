// Mise en page des QCM, vrai/faux et questions numérotées.
//
// Les formats QCM et vrai/faux demandent « un choix par ligne » (« A) 7 », « B) 12 »…) et des affirmations
// « **1.** … ☐ Vrai ☐ Faux ». Or, en Markdown, « A) » n'est pas une puce et « **1.** » n'est que du gras : des lignes
// consécutives forment UN paragraphe, affiché d'un seul tenant (« Question 1. Combien font 3 × 4 ? A) 7 B) 12 C) 34
// D) 1 »). Le prompt demande une mise en page correcte, mais un petit modèle ne la suit pas toujours :
// normalizeExerciseLayout la corrige, de façon déterministe et idempotente (une seconde passe ne change plus rien) :
//  - au moins deux lignes consécutives de choix (« A) … », « b. … », « (C) … ») deviennent une liste à puces, rangée
//    sous la question quand celle-ci est un élément de liste ; une ligne vide la sépare du texte qui la suit
//    immédiatement (sinon cette ligne serait rattachée au dernier choix) ;
//  - une ligne vide est insérée avant une question, un exercice ou une affirmation numérotés hors liste
//    (« **Question 2.** », « **2.** », « Question 2 : B — … ») collés à la ligne précédente.
// Jamais dans un bloc de code, une formule « $$ » ou un tableau. La pipeline l'applique au document final et au texte
// partiel (contenu enregistré et exporté ainsi) ; l'affichage l'applique aussi pendant la rédaction et aux anciens
// contenus de l'historique (MarkdownView, parseMarkdown).

const FENCE_RE = /^\s*(```+|~~~+)/;
const MATH_OPEN_RE = /^\s{0,3}\$\$/;
const MATH_CLOSE_RE = /^\s*\$\$\s*$/;
/** Choix de QCM ou sous-question lettrée (« A) 7 », « b. … », « (C) … »), éventuellement déjà en liste à puces. */
const CHOICE_RE = /^\s*(?:[-*+][ \t]+)?\(?[A-Fa-f][).][ \t]+\S/;
const BULLET_RE = /^(\s*)[-*+][ \t]+/;
/** Élément de liste (puce ou numéro) : groupe 0 = tout ce qui précède le texte de l'élément. */
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?=\S)/;
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
/** Question, exercice ou affirmation numérotés, hors élément de liste (« **Question 2.** », « **2.** », « Question 2 : »). */
const QUESTION_START_RE =
  /^\s*(?:(?:\*\*|__)\s*(?:(?:[Qq]uestion|[Ee]xercice|[Aa]ffirmation)\s+)?\d{1,2}\s*[.:)]|(?:\*\*|__)?\s*(?:[Qq]uestion|[Ee]xercice|[Aa]ffirmation)\s+\d{1,2}(?![\p{L}\d]))/u;
/** Fin de ligne qui force déjà un retour à la ligne (deux espaces ou « \ ») : la mise en page voulue est respectée. */
const HARD_BREAK_RE = /(?: {2,}|\\)$/;

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].length;
}

/** Colonne du texte d'un élément de liste (« 1. Question » → 3), ou null si la ligne n'en est pas un. */
function listContentColumn(line: string | undefined): number | null {
  const m = line === undefined ? null : LIST_ITEM_RE.exec(line);
  return m ? m[0].length : null;
}

/** Lignes de choix converties en liste à puces (les lignes déjà en puces sont gardées telles quelles). */
function choiceItems(run: readonly string[], parentColumn: number | null): string[] {
  // Sous une question en liste : les choix sont rangés dans son élément (sauf si le modèle a déjà posé des puces).
  const nest = parentColumn !== null && run.every(line => !BULLET_RE.test(line));
  return run.map(line => {
    if (BULLET_RE.test(line)) return line;
    const indent = /^\s*/.exec(line)![0];
    const column = nest && indent.length < parentColumn ? ' '.repeat(parentColumn) : indent;
    return `${column}- ${line.slice(indent.length)}`;
  });
}

/** Mise en page des choix de QCM et des questions numérotées (voir l'en-tête) ; texte inchangé s'il n'y a rien à faire. */
export function normalizeExerciseLayout(text: string): string {
  if (typeof text !== 'string' || !text.includes('\n')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    if (inMath) {
      out.push(line);
      if (MATH_CLOSE_RE.test(line)) inMath = false;
      continue;
    }
    if (MATH_OPEN_RE.test(line) && !line.trim().slice(2).includes('$$')) {
      inMath = true;
      out.push(line);
      continue;
    }

    if (CHOICE_RE.test(line)) {
      let end = i + 1;
      while (end < lines.length && CHOICE_RE.test(lines[end])) end++;
      if (end - i >= 2) {
        const items = choiceItems(lines.slice(i, end), listContentColumn(out[out.length - 1]));
        out.push(...items);
        // Texte collé au dernier choix (question suivante, « Réponse : … ») : il en serait la suite, dans la puce.
        const next = lines[end];
        if (next !== undefined && next.trim() && listContentColumn(next) === null && indentOf(next) <= indentOf(items[items.length - 1])) {
          out.push('');
        }
        i = end - 1;
        continue;
      }
    }

    if (QUESTION_START_RE.test(line) && out.length > 0) {
      const previous = out[out.length - 1];
      if (previous.trim() && !HEADING_RE.test(previous) && !HARD_BREAK_RE.test(previous)) out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}
