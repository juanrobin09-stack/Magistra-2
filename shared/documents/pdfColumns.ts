// Ordre de lecture d'une page PDF sur deux colonnes. Module pur : il ne dépend pas de pdf.js, seulement de la forme des
// éléments de texte (`str`, `transform`, `width`, `hasEOL`).
//
// pdf.js donne les éléments dans l'ordre du flux du PDF. Quand la mise en page écrit les deux colonnes ligne par ligne,
// la ligne de la colonne de gauche et la ligne voisine de la colonne de droite se retrouvent bout à bout : l'article
// est lu en traversant la page. On ne réordonne que si la page est SÛREMENT sur deux colonnes ; au moindre doute l'ordre
// d'origine est rendu tel quel (une colonne, texte en retrait, tableau, table des matières, formulaire, page presque
// vide, texte tourné : rien ne change).
//
// Le flux d'origine décide d'abord : on ne réordonne que ce qui est écrit EN TRAVERSANT la page (critère 5). Un flux déjà
// colonne par colonne (article bien produit) se lit correctement tel quel ; un tableau écrit cellule par cellule (Word,
// LibreOffice, reportlab) ne doit surtout pas être réordonné : toutes les cellules de gauche, puis toutes celles de droite,
// feraient perdre la correspondance rangée par rangée.
//
// Critères, tous nécessaires (les seuils sont volontairement exigeants) :
//  1. Gouttière : une seule bande verticale vide, large d'au moins un corps de texte et d'au plus 30 % de la largeur du
//     texte, que 15 % des lignes au plus traversent (légende, intertitre centré). Les lignes d'un seul bloc de texte de
//     70 % de la largeur du texte ou plus (titre, chapeau) ne comptent pas dans cette recherche. Plusieurs gouttières
//     qui conviennent : trois colonnes, tableau ou grille, on ne touche à rien.
//  2. Colonnes de TEXTE : dans une bande (suite de lignes qu'aucune ligne pleine largeur n'interrompt), au moins
//     6 lignes de chaque côté, LONGUES (25 lettres ou chiffres au moins en médiane) et qui remplissent leur colonne (largeur médiane
//     d'au moins 85 % de celle de la colonne : un texte au fil de l'eau remplit ses lignes à un mot près, des cellules de
//     longueurs quelconques non) ; chaque ligne est un seul bloc de texte (15 % de lignes coupées d'un blanc large au plus :
//     les cellules d'un tableau, les points de conduite suivis d'un numéro de page en font plusieurs). Une colonne de
//     chiffres, de libellés courts, de numéros de page ou de champs à remplir n'est pas une colonne de texte. Les deux
//     colonnes ont des largeurs comparables (rapport de 1 à 2).
//  3. Pas un tableau : si des sauts d'interligne marqués (changement de rangée) tombent à la même hauteur dans les deux
//     colonnes, ce sont les rangées d'un tableau dont les cellules sont des paragraphes, pas deux colonnes d'article.
//  4. Une grande partie de la page : les bandes à deux colonnes regroupent au moins 60 % des lignes.
//  5. Le flux traverse la page : dans la bande, le flux d'origine passe de la colonne de gauche à la ligne voisine de la
//     colonne de droite (même ligne visuelle, côtés opposés) sur la plupart des lignes, sans trou dans une colonne (deux
//     colonnes dont les lignes de base diffèrent de plus de 70 % du corps ne partagent pas de ligne visuelle : pas de balayage).
//     Prioritaire sur les autres : une bande dont le flux est colonne par colonne ou cellule par cellule reste telle quelle,
//     même si elle ressemble à deux colonnes de texte et n'a aucun saut d'interligne net (cellules sans marge, rangées à
//     cellules de nombres de lignes différents).
//
// Une ligne pleine largeur sépare deux bandes : lue après la bande qui la précède et avant celle qui la suit. Dans une
// bande à deux colonnes, la colonne de gauche est lue en entier avant celle de droite, chacune dans l'ordre du flux ; le
// reste de la page garde l'ordre du flux. Temps O(n log n) : tris et balayages, aucune comparaison deux à deux.

/** Forme minimale d'un élément de texte de pdf.js. */
interface LayoutItem {
  str?: unknown;
  hasEOL?: boolean;
  transform?: unknown;
  width?: unknown;
}

const MIN_COLUMN_LINES = 6;
const MIN_LINE_CHARS = 25;
const MIN_FILL = 0.85;
const MAX_BROKEN_LINES = 0.15;
const MAX_WIDTH_RATIO = 2;
const MAX_CROSSING_SHARE = 0.15;
/** Part de la largeur du texte à partir de laquelle un bloc de texte est « pleine largeur » (titre, chapeau) : il ne compte pas dans la recherche de la gouttière. */
const WIDE_RUN = 0.7;
const MAX_GUTTER_SHARE = 0.3;
const MAX_GUTTER_CANDIDATES = 3;
const MIN_BAND_SHARE = 0.6;
/**
 * Lignes d'une bande où le flux passe d'une colonne à sa voisine sans quitter la ligne visuelle : au moins autant qu'une
 * colonne de texte en exige, pour que quelques cellules d'une ligne dans un tableau ne passent pas pour un balayage.
 */
const MIN_SWEPT_LINES = MIN_COLUMN_LINES;
/**
 * Part de ces lignes dans la plus grande de deux étendues : celle où le flux alterne (de la première à la dernière
 * alternance) et la colonne la plus courte. Un article écrit ligne par ligne alterne sur toutes les lignes de la colonne la
 * plus courte (la fin de l'autre colonne n'a plus de vis-à-vis, hors de l'étendue) ; les rangées d'un tableau écrit ligne par
 * ligne laissent un trou dans la colonne de la cellule la plus courte, au milieu de l'étendue. 90 % tolère une ligne isolée
 * mal alignée, pas un tableau dont les cellules diffèrent d'une ligne ou plus dans plusieurs rangées.
 */
const MIN_SWEPT_SHARE = 0.9;
/** Deux éléments sont sur la même ligne si leurs lignes de base diffèrent de moins de cette part du plus petit corps (exposants, indices). */
const LINE_TOLERANCE = 0.7;
/** Écart horizontal (en corps de texte) sous lequel deux éléments voisins d'une ligne forment un même bloc de texte. */
const RUN_GAP = 0.6;
/** Largeur minimale de la gouttière, en corps de texte. */
const GUTTER_MIN = 1;
/** Saut d'interligne (en interlignes médians) au-delà duquel on change de paragraphe ou de rangée. */
const BIG_GAP = 1.35;
/** Écart de hauteur (en corps de texte) sous lequel deux débuts de rangée sont à la même hauteur : les cellules d'un tableau commencent exactement sur la même ligne de base. */
const ROW_TOLERANCE = 0.1;
/** Texte tourné (filigrane, page paysage) : composante verticale de l'axe du texte au-delà de laquelle on ne touche à rien, en part du corps. */
const MAX_TILT = 0.1;

const NON_SPACE = /\S/;

/** Valeur de rang `rank` (0 à 1) de la liste triée. */
function quantile(values: number[], rank: number): number {
  if (values.length === 0) return 0;
  return Float64Array.from(values).sort()[Math.floor(rank * (values.length - 1))];
}

const median = (values: number[]) => quantile(values, 0.5);

/** Lettres et chiffres d'un texte : points de conduite, traits de remplissage et filets (« ____ », « ..... ») ne font pas une ligne de texte. */
function countWordChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c >= 0xc0) count++;
  }
  return count;
}

/** Même élément, avec fin de ligne forcée. */
function withEndOfLine(item: unknown): unknown {
  return item && typeof item === 'object' && !(item as LayoutItem).hasEOL ? { ...(item as object), hasEOL: true } : item;
}

/** Géométrie des éléments qui portent du texte, indexée comme `items`. */
interface Geometry {
  x0: Float64Array;
  x1: Float64Array;
  y: Float64Array;
  size: Float64Array;
  /** Lettres et chiffres de chaque élément. */
  chars: Int32Array;
  /** Indices des éléments qui portent du texte, dans l'ordre du flux. */
  real: number[];
}

/** Côté de la gouttière d'un élément : 0 à gauche, 1 à droite (d'après son centre). */
const sideOf = (g: Geometry, i: number, center: number) => ((g.x0[i] + g.x1[i]) / 2 < center ? 0 : 1);

/** Géométrie des éléments de texte, ou null si la page ne permet pas de décider (texte tourné, élément illisible). */
function readGeometry(items: unknown[]): Geometry | null {
  const n = items.length;
  const g: Geometry = { x0: new Float64Array(n), x1: new Float64Array(n), y: new Float64Array(n), size: new Float64Array(n), chars: new Int32Array(n), real: [] };
  for (let i = 0; i < n; i++) {
    const item = items[i] as LayoutItem | null;
    if (!item || typeof item.str !== 'string' || !NON_SPACE.test(item.str)) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) return null;
    const [a, b, , d, tx, ty] = t as number[];
    const fontSize = Math.hypot(a, b);
    if (![a, b, d, tx, ty].every(Number.isFinite) || !(fontSize > 0) || a < 0 || d < 0 || Math.abs(b) > MAX_TILT * fontSize) return null;
    const width = typeof item.width === 'number' && Number.isFinite(item.width) && item.width > 0 ? item.width : item.str.length * fontSize * 0.5;
    g.x0[i] = tx;
    g.x1[i] = tx + width;
    g.y[i] = ty;
    g.size[i] = fontSize;
    g.chars[i] = countWordChars(item.str);
    g.real.push(i);
  }
  return g;
}

/** Ligne visuelle : éléments `order[from..to[` (de gauche à droite) et blocs de texte `runA/runB[runs..runsEnd[`. */
interface Line {
  from: number;
  to: number;
  runs: number;
  runsEnd: number;
}

interface PageLines {
  /** Éléments de texte de haut en bas, puis de gauche à droite dans chaque ligne. */
  order: number[];
  lines: Line[];
  /** Blocs de texte de chaque ligne : séquences d'éléments séparées de moins d'un petit écart. */
  runA: number[];
  runB: number[];
  /** Ligne visuelle de chaque élément, indexée comme `items` (-1 : élément sans texte). */
  lineOf: Int32Array;
}

/** Regroupe les éléments en lignes visuelles (haut en bas) et chaque ligne en blocs de texte. */
function buildLines(g: Geometry, body: number): PageLines {
  const { x0, x1, y, size } = g;
  const runGap = RUN_GAP * body;
  const order = g.real.slice().sort((p, q) => y[q] - y[p] || x0[p] - x0[q]);
  const lines: Line[] = [];
  const runA: number[] = [];
  const runB: number[] = [];
  const lineOf = new Int32Array(g.x0.length).fill(-1);
  const closeLine = (from: number, to: number) => {
    const part = order.slice(from, to).sort((p, q) => x0[p] - x0[q]);
    const runs = runA.length;
    let a = x0[part[0]];
    let b = x1[part[0]];
    order[from] = part[0];
    for (let k = 1; k < part.length; k++) {
      const i = part[k];
      order[from + k] = i;
      if (x0[i] - b <= runGap) b = Math.max(b, x1[i]);
      else {
        runA.push(a);
        runB.push(b);
        a = x0[i];
        b = x1[i];
      }
    }
    runA.push(a);
    runB.push(b);
    for (let k = from; k < to; k++) lineOf[order[k]] = lines.length;
    lines.push({ from, to, runs, runsEnd: runA.length });
  };
  let start = 0;
  for (let k = 1; k < order.length; k++) {
    const first = order[start];
    const i = order[k];
    if (y[first] - y[i] > LINE_TOLERANCE * Math.min(size[first], size[i])) {
      closeLine(start, k);
      start = k;
    }
  }
  closeLine(start, order.length);
  return { order, lines, runA, runB, lineOf };
}

/**
 * Centres des zones verticales à gauche et à droite desquelles il y a du texte et que presque aucune ligne ne couvre
 * (balayage des blocs de texte triés), ou null s'il y en a trop pour être une mise en page en colonnes. Les lignes pleine
 * largeur (un bloc de texte d'au moins 70 % de la largeur du texte : titre, chapeau) ne comptent pas : beaucoup de lignes
 * de chapeau en tête de page n'empêchent pas de trouver la gouttière des colonnes qui suivent.
 */
function findGutters(page: PageLines, minWidth: number): number[] | null {
  const { lines, runA, runB } = page;
  let left = Infinity;
  let right = -Infinity;
  for (let r = 0; r < runA.length; r++) {
    left = Math.min(left, runA[r]);
    right = Math.max(right, runB[r]);
  }
  const textWidth = right - left;
  const starts: number[] = [];
  const ends: number[] = [];
  let narrowLines = 0;
  for (const line of lines) {
    let wide = false;
    for (let r = line.runs; r < line.runsEnd; r++) if (runB[r] - runA[r] >= WIDE_RUN * textWidth) wide = true;
    if (wide) continue;
    narrowLines++;
    for (let r = line.runs; r < line.runsEnd; r++) {
      starts.push(runA[r]);
      ends.push(runB[r]);
    }
  }
  if (narrowLines < 2 * MIN_COLUMN_LINES) return [];
  return sweepGutters(Float64Array.from(starts).sort(), Float64Array.from(ends).sort(), Math.floor(MAX_CROSSING_SHARE * narrowLines), minWidth, textWidth);
}

/**
 * Balayage des débuts et fins (triés) des blocs de texte : zones que `maxCovered` blocs au plus couvrent, larges d'au
 * moins `minWidth` et d'au plus 30 % du texte, avec du texte de chaque côté. Une zone par centre rendu.
 */
function sweepGutters(starts: Float64Array, ends: Float64Array, maxCovered: number, minWidth: number, textWidth: number): number[] | null {
  const centers: number[] = [];
  let covered = 0;
  // Début de la zone peu couverte en cours ; -Infinity : marge de gauche (pas une gouttière, il n'y a pas de texte avant).
  let lowFrom: number | null = -Infinity;
  let s = 0;
  let e = 0;
  while (s < starts.length || e < ends.length) {
    const at = s < starts.length && starts[s] <= ends[e] ? starts[s] : ends[e];
    while (s < starts.length && starts[s] === at) {
      covered++;
      s++;
    }
    while (e < ends.length && ends[e] === at) {
      covered--;
      e++;
    }
    if (covered > maxCovered) {
      const width = lowFrom === null ? 0 : at - lowFrom;
      if (lowFrom !== null && Number.isFinite(lowFrom) && width >= minWidth && width <= MAX_GUTTER_SHARE * textWidth) {
        centers.push((lowFrom + at) / 2);
        if (centers.length > MAX_GUTTER_CANDIDATES) return null;
      }
      lowFrom = null;
    } else if (lowFrom === null) {
      lowFrom = at;
    }
  }
  return centers;
}

/** Part de chaque côté de la gouttière dans une bande : une entrée par ligne qui y a du texte. */
interface Side {
  chars: number[];
  widths: number[];
  ys: number[];
  min: number;
  max: number;
  /** Lignes coupées par un blanc large (plusieurs blocs de texte) : cellules de tableau, numéro de page ou chiffre à droite. */
  broken: number;
}

/** Hauteurs (lignes de base) des débuts de paragraphe ou de rangée : lignes qui suivent un saut d'interligne marqué. */
function breakStarts(ys: number[]): number[] {
  if (ys.length < 3) return [];
  const gaps = ys.slice(1).map((v, i) => ys[i] - v);
  // Interligne courant : le quartile bas, qui reste l'interligne même quand la moitié des sauts sont des changements de rangée.
  const leading = quantile(gaps, 0.25);
  const out: number[] = [];
  gaps.forEach((gap, i) => {
    if (gap > BIG_GAP * leading) out.push(ys[i + 1]);
  });
  return out;
}

/** Des changements de rangée à la même hauteur dans les deux colonnes : les cellules d'un tableau, pas des colonnes d'article. */
function sameRowBreaks(left: number[], right: number[], tolerance: number): boolean {
  const a = breakStarts(left);
  const b = breakStarts(right);
  let same = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const diff = a[i] - b[j];
    if (Math.abs(diff) <= tolerance) {
      same++;
      i++;
      j++;
    } else if (diff > 0) i++;
    else j++;
  }
  return same >= 2 && same >= 0.5 * Math.min(a.length, b.length);
}

/** Les lignes `[from, to[` (qu'aucune ligne pleine largeur ne traverse) sont-elles deux colonnes de texte de part et d'autre de `center` ? */
function isTextColumns(g: Geometry, page: PageLines, from: number, to: number, center: number, body: number): boolean {
  const sides: Side[] = [0, 1].map(() => ({ chars: [], widths: [], ys: [], min: Infinity, max: -Infinity, broken: 0 }));
  for (let l = from; l < to; l++) {
    const line = page.lines[l];
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    const chars = [0, 0];
    const runs = [0, 0];
    const y = [0, 0];
    for (let k = line.from; k < line.to; k++) {
      const i = page.order[k];
      const s = sideOf(g, i, center);
      // Hauteur propre à chaque colonne : deux colonnes dont les lignes de base diffèrent un peu partagent une même ligne visuelle.
      if (min[s] === Infinity) y[s] = g.y[i];
      min[s] = Math.min(min[s], g.x0[i]);
      max[s] = Math.max(max[s], g.x1[i]);
      chars[s] += g.chars[i];
    }
    // Aucun bloc de texte d'une ligne qui n'est pas pleine largeur ne chevauche la gouttière : il est tout à gauche ou tout à droite.
    for (let r = line.runs; r < line.runsEnd; r++) runs[page.runB[r] <= center ? 0 : 1]++;
    for (const s of [0, 1]) {
      if (chars[s] === 0) continue;
      const side = sides[s];
      side.chars.push(chars[s]);
      side.widths.push(max[s] - min[s]);
      side.ys.push(y[s]);
      side.min = Math.min(side.min, min[s]);
      side.max = Math.max(side.max, max[s]);
      if (runs[s] > 1) side.broken++;
    }
  }
  const widths = sides.map(side => side.max - side.min);
  for (let s = 0; s < 2; s++) {
    const side = sides[s];
    if (side.chars.length < MIN_COLUMN_LINES || !(widths[s] > 0)) return false;
    if (median(side.chars) < MIN_LINE_CHARS || median(side.widths) < MIN_FILL * widths[s]) return false;
    if (side.broken > MAX_BROKEN_LINES * side.chars.length) return false;
  }
  const ratio = widths[0] / widths[1];
  if (ratio > MAX_WIDTH_RATIO || ratio < 1 / MAX_WIDTH_RATIO) return false;
  return !sameRowBreaks(sides[0].ys, sides[1].ys, ROW_TOLERANCE * body);
}

/**
 * Bandes (suites de lignes qu'aucune ligne pleine largeur n'interrompt) dont le flux d'origine TRAVERSE la page : sur la
 * plupart de leurs lignes, l'élément qui suit celui de la colonne de gauche dans le flux (parmi ceux de la bande) est sur la
 * même ligne visuelle, côté droit, ou l'inverse. C'est le cas d'un article dont le PDF stocke les lignes dans l'ordre de
 * balayage. Un flux colonne par colonne, ou cellule par cellule (tableau), ne passe d'un côté à l'autre qu'en changeant de
 * ligne : aucune alternance, la bande n'est pas réordonnée. Voir `MIN_SWEPT_LINES` et `MIN_SWEPT_SHARE` pour les seuils.
 * Une valeur par bande, dans l'ordre des bandes.
 */
function sweptBands(g: Geometry, page: PageLines, center: number, bandOfLine: Int32Array, bandCount: number): Uint8Array {
  const { lines, lineOf } = page;
  /** 1 : le flux passe d'un côté à l'autre sur cette ligne ; bit 0 / bit 1 de `sides` : il y a du texte à gauche / à droite. */
  const crossed = new Uint8Array(lines.length);
  const sides = new Uint8Array(lines.length);
  const previous = new Int32Array(bandCount).fill(-1);
  for (const i of g.real) {
    const l = lineOf[i];
    const band = bandOfLine[l];
    if (band === -1) continue;
    const s = sideOf(g, i, center);
    sides[l] |= 1 << s;
    const p = previous[band];
    if (p !== -1 && lineOf[p] === l && sideOf(g, p, center) !== s) crossed[l] = 1;
    previous[band] = i;
  }
  const count = new Int32Array(bandCount);
  const first = new Int32Array(bandCount).fill(-1);
  const last = new Int32Array(bandCount).fill(-1);
  const left = new Int32Array(bandCount);
  const right = new Int32Array(bandCount);
  for (let l = 0; l < lines.length; l++) {
    const band = bandOfLine[l];
    if (band === -1) continue;
    left[band] += sides[l] & 1;
    right[band] += sides[l] >> 1;
    if (!crossed[l]) continue;
    count[band]++;
    if (first[band] === -1) first[band] = l;
    last[band] = l;
  }
  const swept = new Uint8Array(bandCount);
  for (let band = 0; band < bandCount; band++) {
    const extent = Math.max(last[band] - first[band] + 1, Math.min(left[band], right[band]));
    swept[band] = count[band] >= MIN_SWEPT_LINES && count[band] >= MIN_SWEPT_SHARE * extent ? 1 : 0;
  }
  return swept;
}

/** Répartition des lignes en groupes de lecture : une suite de groupes, chacun lu en entier avant le suivant. */
interface Layout {
  /** Groupe de chaque ligne ; pour une ligne de bande à deux colonnes, groupe de la colonne de gauche (celle de droite : +1). */
  groupOfLine: Int32Array;
  inColumns: Uint8Array;
  groups: number;
  /** Groupes qui sont une colonne (gauche ou droite). */
  columnGroups: Set<number>;
}

function layoutFor(g: Geometry, page: PageLines, center: number, body: number): Layout | null {
  const { lines, runA, runB } = page;
  const crossing = lines.map(line => {
    for (let r = line.runs; r < line.runsEnd; r++) if (runA[r] < center && center < runB[r]) return true;
    return false;
  });
  const bandOfLine = new Int32Array(lines.length).fill(-1);
  let bands = 0;
  for (let l = 0; l < lines.length; ) {
    if (crossing[l]) l++;
    else {
      while (l < lines.length && !crossing[l]) bandOfLine[l++] = bands;
      bands++;
    }
  }
  const swept = sweptBands(g, page, center, bandOfLine, bands);
  const layout: Layout = { groupOfLine: new Int32Array(lines.length), inColumns: new Uint8Array(lines.length), groups: 0, columnGroups: new Set() };
  let plain = -1;
  let columnLines = 0;
  for (let l = 0; l < lines.length; ) {
    let end = l;
    if (!crossing[l]) while (end < lines.length && !crossing[end]) end++;
    if (end > l && swept[bandOfLine[l]] && isTextColumns(g, page, l, end, center, body)) {
      const left = layout.groups;
      layout.groups += 2;
      layout.columnGroups.add(left).add(left + 1);
      for (let k = l; k < end; k++) {
        layout.groupOfLine[k] = left;
        layout.inColumns[k] = 1;
      }
      columnLines += end - l;
      plain = -1;
    } else {
      // Ligne pleine largeur ou bande qui n'est pas en colonnes (ou dont le flux ne traverse pas la page) : ordre du flux, groupe commun avec les lignes voisines du même genre.
      if (plain === -1) plain = layout.groups++;
      end = Math.max(end, l + 1);
      for (let k = l; k < end; k++) layout.groupOfLine[k] = plain;
    }
    l = end;
  }
  return columnLines >= MIN_BAND_SHARE * lines.length ? layout : null;
}

/**
 * Éléments triés par groupe de lecture (tri stable). Dans une colonne, les éléments sans texte (espaces que pdf.js insère
 * entre deux blocs d'une même ligne, fins de ligne, marqueurs) sont retirés : ils collaient les lignes de la colonne ;
 * chaque fin de ligne est reposée d'après la ligne visuelle, la dernière ligne de la colonne comprise. Chaque groupe se
 * termine par une fin de ligne : un titre dont le texte finit par une espace ne se colle pas à la première ligne de colonne.
 */
function assemble(items: unknown[], g: Geometry, page: PageLines, layout: Layout, center: number): unknown[] {
  const n = items.length;
  const { lineOf } = page;
  const groupOf = new Int32Array(n).fill(-1);
  page.lines.forEach((line, l) => {
    for (let k = line.from; k < line.to; k++) {
      const i = page.order[k];
      groupOf[i] = layout.groupOfLine[l] + (layout.inColumns[l] ? sideOf(g, i, center) : 0);
    }
  });
  // Un élément sans texte suit celui qui le précède dans le flux.
  const keep = new Uint8Array(n);
  let carry = groupOf[g.real[0]];
  for (let i = 0; i < n; i++) {
    if (groupOf[i] === -1) groupOf[i] = carry;
    else carry = groupOf[i];
    keep[i] = lineOf[i] !== -1 || !layout.columnGroups.has(groupOf[i]) ? 1 : 0;
  }
  const next = new Int32Array(layout.groups + 1);
  for (let i = 0; i < n; i++) if (keep[i]) next[groupOf[i] + 1]++;
  for (let k = 0; k < layout.groups; k++) next[k + 1] += next[k];
  const out = new Array<unknown>(next[layout.groups]);
  const origin = new Int32Array(out.length);
  const fill = next.slice();
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const at = fill[groupOf[i]]++;
    out[at] = items[i];
    origin[at] = i;
  }
  for (let group = 0; group < layout.groups; group++) {
    const inColumn = layout.columnGroups.has(group);
    for (let at = next[group]; at < next[group + 1]; at++) {
      if (at + 1 === next[group + 1] || (inColumn && lineOf[origin[at]] !== lineOf[origin[at + 1]])) out[at] = withEndOfLine(out[at]);
    }
  }
  return out;
}

/**
 * Éléments de texte de la page dans l'ordre de lecture. Renvoie `items` lui-même (même référence) quand la page n'est
 * pas sûrement sur deux colonnes ou que son flux ne traverse pas la page (déjà colonne par colonne, tableau cellule par cellule).
 */
export function readingOrder(items: unknown[]): unknown[] {
  if (items.length < 2 * MIN_COLUMN_LINES) return items;
  const g = readGeometry(items);
  if (!g || g.real.length < 2 * MIN_COLUMN_LINES) return items;
  const body = median(g.real.map(i => g.size[i]));
  const page = buildLines(g, body);
  if (page.lines.length < 2 * MIN_COLUMN_LINES) return items;
  const centers = findGutters(page, GUTTER_MIN * body);
  if (!centers) return items;
  // Chaque gouttière candidate est mise à l'épreuve ; une seule doit convaincre.
  let found: { center: number; layout: Layout } | null = null;
  for (const center of centers) {
    const layout = layoutFor(g, page, center, body);
    if (!layout) continue;
    if (found) return items;
    found = { center, layout };
  }
  return found ? assemble(items, g, page, found.layout, found.center) : items;
}
