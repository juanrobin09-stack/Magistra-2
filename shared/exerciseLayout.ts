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
//
// Jamais de bloc de code créé : après une ligne vide, une ligne en retrait de 4 colonnes ou plus au-delà du texte de
// l'élément de liste qui la contient (ou de la marge, hors liste) serait affichée en police à chasse fixe, « ** »
// compris. Une telle ligne reste collée à la précédente (texte du même paragraphe, comme avant), et des choix ainsi en
// retrait restent tels quels (une puce n'y ferait qu'un « - » visible). Les éléments de liste ne sont retenus que
// lorsque CommonMark les lit à coup sûr comme tels (ListContext) : au moindre doute, la marge compte, et la ligne est
// laissée telle quelle. Temps linéaire, même sur une ligne de milliers d'espaces.

const FENCE_RE = /^\s*(```+|~~~+)/;
const MATH_OPEN_RE = /^\s{0,3}\$\$/;
const MATH_CLOSE_RE = /^\s*\$\$\s*$/;
/** Choix de QCM ou sous-question lettrée (« A) 7 », « b. … », « (C) … »), éventuellement déjà en liste à puces. */
const CHOICE_RE = /^\s*(?:[-*+][ \t]+)?\(?[A-Fa-f][).][ \t]+\S/;
const BULLET_RE = /^(\s*)[-*+][ \t]+/;
/** Élément de liste (puce ou numéro) : groupe 0 = tout ce qui précède le texte de l'élément. */
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?=\S)/;
/** Élément de liste lu par parties : retrait, marqueur (numéro éventuel), espaces avant le texte. */
const LIST_MARKER_RE = /^([ \t]*)([-*+]|(\d{1,9})[.)])([ \t]+)(?=\S)/;
/** Filet horizontal (« - - - », « *** », « ___ »), une fois les espaces retirés : jamais un élément de liste. */
const THEMATIC_BREAK_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
/**
 * Question, exercice ou affirmation numérotés, hors élément de liste (« **Question 2.** », « **2.** », « Question 2 : »).
 * Jamais deux « \s* » à la suite : sur une longue suite d'espaces, la recherche deviendrait quadratique.
 */
const QUESTION_START_RE =
  /^\s*(?:(?:\*\*|__)\s*(?:(?:[Qq]uestion|[Ee]xercice|[Aa]ffirmation)\s+)?\d{1,2}\s*[.:)]|(?:(?:\*\*|__)\s*)?(?:[Qq]uestion|[Ee]xercice|[Aa]ffirmation)\s+\d{1,2}(?![\p{L}\d]))/u;

/** Fin de ligne qui force déjà un retour à la ligne (deux espaces ou « \ ») : la mise en page voulue est respectée. */
function endsWithHardBreak(line: string): boolean {
  return line.endsWith('  ') || line.endsWith('\\');
}

/** Colonne atteinte après `prefix` (une tabulation avance jusqu'au multiple de 4 suivant, comme en CommonMark). */
function columnAfter(prefix: string): number {
  let column = 0;
  for (const ch of prefix) column = ch === '\t' ? column + 4 - (column % 4) : column + 1;
  return column;
}

/** Retrait d'une ligne, en colonnes. */
function indentOf(line: string): number {
  return columnAfter(/^[ \t]*/.exec(line)![0]);
}

/** Colonne du texte d'un élément de liste (« 1. Question » → 3), ou null si la ligne n'en est pas un. */
function listContentColumn(line: string | undefined): number | null {
  const m = line === undefined ? null : LIST_ITEM_RE.exec(line);
  return m ? m[0].length : null;
}

interface ListItem {
  /** Retrait du marqueur, en colonnes. */
  indent: number;
  /** Colonne du texte de l'élément : une ligne qui la continue doit être au moins en retrait jusqu'à elle. */
  column: number;
  /** Puce, ou liste numérotée commençant à 1 : peut interrompre un paragraphe (CommonMark). */
  interrupts: boolean;
}

function listItem(line: string): ListItem | null {
  const m = LIST_MARKER_RE.exec(line);
  if (!m || THEMATIC_BREAK_RE.test(line.replace(/[ \t]/g, ''))) return null;
  const markerEnd = columnAfter(m[1] + m[2]);
  const spaces = columnAfter(m[1] + m[2] + m[4]) - markerEnd;
  return {
    indent: columnAfter(m[1]),
    // Cinq espaces ou plus après le marqueur : le texte commence par du code, l'élément s'ouvre juste après le marqueur.
    column: spaces > 4 ? markerEnd + 1 : markerEnd + spaces,
    interrupts: m[3] === undefined || Number(m[3]) === 1,
  };
}

/**
 * Éléments de liste ouverts dans le texte produit, retenus seulement quand CommonMark les lit à coup sûr comme tels :
 * en tête de bloc (début du texte, après une ligne vide ou un titre), puce ou numéro 1 (qui interrompent un
 * paragraphe), ou élément suivant d'une liste déjà reconnue (retrait inférieur au texte d'un élément ouvert). Ils sont
 * oubliés dès qu'une ligne revient en deçà de leur texte. Un élément réel mais non reconnu ne fait que rendre la mise
 * en page plus prudente ; un élément retenu à tort pourrait faire naître un bloc de code : d'où ces seules règles.
 */
class ListContext {
  private columns: number[] = [];
  private afterText = false;

  clone(): ListContext {
    const copy = new ListContext();
    copy.columns = [...this.columns];
    copy.afterText = this.afterText;
    return copy;
  }

  /** Colonne du texte de l'élément le plus profond que continue une ligne de ce retrait (0 hors liste). */
  private base(indent: number): number {
    for (let k = this.columns.length - 1; k >= 0; k--) if (this.columns[k] <= indent) return this.columns[k];
    return 0;
  }

  /** Vrai si la ligne commence un bloc de texte ou un élément de liste, même précédée d'une ligne vide (jamais du code). */
  fits(line: string): boolean {
    const indent = indentOf(line);
    return indent - this.base(indent) <= 3;
  }

  /** Ligne ajoutée au texte produit ; `structure` faux dans un bloc de code ou une formule. */
  add(line: string, structure = true): void {
    if (!line.trim()) {
      this.afterText = false;
      return;
    }
    const indent = indentOf(line);
    let closed = false;
    while (this.columns.length && this.columns[this.columns.length - 1] > indent) {
      this.columns.pop();
      closed = true;
    }
    const item = structure ? listItem(line) : null;
    if (item && item.indent - this.base(item.indent) <= 3 && (item.interrupts || closed || !this.afterText)) {
      this.columns.push(item.column);
    }
    this.afterText = !(structure && HEADING_RE.test(line));
  }
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
  const context = new ListContext();
  const emit = (line: string, structure = true) => {
    out.push(line);
    context.add(line, structure);
  };
  let fence: string | null = null;
  let inMath = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence) {
      emit(line, false);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      emit(line, false);
      continue;
    }
    if (inMath) {
      emit(line, false);
      if (MATH_CLOSE_RE.test(line)) inMath = false;
      continue;
    }
    if (MATH_OPEN_RE.test(line) && !line.trim().slice(2).includes('$$')) {
      inMath = true;
      emit(line, false);
      continue;
    }

    if (CHOICE_RE.test(line)) {
      let end = i + 1;
      while (end < lines.length && CHOICE_RE.test(lines[end])) end++;
      if (end - i >= 2) {
        const items = choiceItems(lines.slice(i, end), listContentColumn(out[out.length - 1]));
        // Chaque choix doit devenir un vrai élément de liste ; sinon (retrait de 4 colonnes ou plus hors d'une liste),
        // les lignes restent telles quelles.
        const trial = context.clone();
        const safe = items.every(item => {
          const fits = trial.fits(item);
          trial.add(item);
          return fits;
        });
        if (!safe) {
          for (const choice of lines.slice(i, end)) emit(choice);
          i = end - 1;
          continue;
        }
        for (const item of items) emit(item);
        // Texte collé au dernier choix (question suivante, « Réponse : … ») : il en serait la suite, dans la puce.
        const next = lines[end];
        if (
          next !== undefined && next.trim() && listContentColumn(next) === null
          && indentOf(next) <= indentOf(items[items.length - 1]) && context.fits(next)
        ) {
          emit('');
        }
        i = end - 1;
        continue;
      }
    }

    if (QUESTION_START_RE.test(line) && out.length > 0) {
      const previous = out[out.length - 1];
      if (previous.trim() && !HEADING_RE.test(previous) && !endsWithHardBreak(previous) && context.fits(line)) emit('');
    }
    emit(line);
  }
  return out.join('\n');
}
