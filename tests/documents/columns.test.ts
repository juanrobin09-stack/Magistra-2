// PDF sur deux colonnes : un article dont le flux écrit les deux colonnes ligne par ligne était lu en traversant la page
// (une ligne de gauche collée à la ligne voisine de droite). Il est lu colonne de gauche, puis colonne de droite ;
// tableau, table des matières, formulaire, une colonne, texte en retrait et page presque vide ne bougent pas. Seul le flux
// d'origine décide : un flux déjà colonne par colonne (article bien produit) ou cellule par cellule (tableau) est rendu tel quel.

import { describe, expect, it } from 'vitest';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdf, pdfItemsToText, type PdfJsLike } from '@shared/documents/extract';
import { readingOrder } from '@shared/documents/pdfColumns';
import { makePdfPlaced, SVT_COURSE_PAGES, wrapToWidth, type PdfPlaced } from './fixtures';

const pdfjs = pdfjsLegacy as unknown as PdfJsLike;
const BOUND_MS = 8000;

interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

/** Élément de texte comme pdf.js le fournit : corps 10 par défaut, 5 pt par caractère. */
function item(str: string, x: number, y: number, size = 10, hasEOL = false): TextItem {
  return { str, dir: 'ltr', transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, hasEOL };
}

/** Découpe un texte en lignes d'au plus `max` caractères, aux espaces. */
function wrap(text: string, max = 44): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const ARTICLE = wrap(SVT_COURSE_PAGES.slice(1, 5).join(' '));
const LEFT = ARTICLE.slice(0, 18);
const RIGHT = ARTICLE.slice(18, 36);
const X_LEFT = 50;
const X_RIGHT = 310;
const TOP = 780;
const LEADING = 14;

const column = (lines: string[], x: number, top = TOP): TextItem[] => lines.map((line, i) => item(line, x, top - i * LEADING));

/**
 * Flux d'un PDF qui écrit les deux colonnes ligne par ligne. `pdfjsStyle` : comme pdf.js, une espace entre les deux blocs
 * d'une même ligne (largeur de la gouttière), la fin de ligne sur le dernier bloc, puis un marqueur de fin de ligne vide.
 */
function rowByRow(left: TextItem[], right: TextItem[], pdfjsStyle = false): TextItem[] {
  const out: TextItem[] = [];
  for (let r = 0; r < Math.max(left.length, right.length); r++) {
    const l = left[r];
    const rt = right[r];
    if (l) out.push(l);
    if (l && rt && pdfjsStyle) {
      const end = l.transform[4] + l.width;
      out.push({ ...item(' ', end, l.transform[5]), width: rt.transform[4] - end, height: 0 });
    }
    if (rt) out.push({ ...rt, hasEOL: pdfjsStyle });
    if (pdfjsStyle) out.push({ ...item('', 0, (l ?? rt).transform[5]), width: 0, height: 0, hasEOL: true });
  }
  return out;
}

/** Flux d'un PDF qui écrit la colonne de gauche en entier, puis celle de droite (LaTeX) : chaque ligne finit par une fin de ligne. */
const columnByColumn = (left: TextItem[], right: TextItem[]): TextItem[] => [...left, ...right].map(i => ({ ...i, hasEOL: true }));

const read = (items: unknown[]) => pdfItemsToText(readingOrder(items)).trimEnd();

describe('PDF : deux colonnes (lecture colonne de gauche, puis colonne de droite)', () => {
  it('flux ligne par ligne : la colonne de gauche est lue en entier, puis celle de droite', () => {
    const items = rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT));
    // AVANT : chaque ligne de la colonne de gauche collée à la ligne voisine de la colonne de droite.
    expect(pdfItemsToText(items).split('\n').slice(0, 2)).toEqual([`${LEFT[0]} ${RIGHT[0]}`, `${LEFT[1]} ${RIGHT[1]}`]);
    const ordered = readingOrder(items);
    expect(ordered).toHaveLength(items.length);
    expect(pdfItemsToText(ordered).trimEnd()).toBe([...LEFT, ...RIGHT].join('\n'));
  });

  it('flux comme pdf.js (espace entre les blocs, fins de ligne, marqueurs vides) : même lecture, aucune ligne collée', () => {
    const items = rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT), true);
    expect(pdfItemsToText(items).split('\n')[0]).toBe(`${LEFT[0]} ${RIGHT[0]}`);
    expect(read(items)).toBe([...LEFT, ...RIGHT].join('\n'));
  });

  it('flux déjà colonne par colonne (LaTeX) : lecture identique, entrée rendue telle quelle', () => {
    const items = columnByColumn(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT));
    expect(readingOrder(items)).toBe(items);
    expect(read(items)).toBe([...LEFT, ...RIGHT].join('\n'));
    expect(read(items)).toBe(pdfItemsToText(items).trimEnd());
  });

  it('flux balayé : l’article est réordonné (nouveau tableau, aucun élément perdu)', () => {
    const items = rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT));
    const ordered = readingOrder(items);
    expect(ordered).not.toBe(items);
    expect(ordered).toHaveLength(items.length);
  });

  it('colonne de droite plus courte que celle de gauche, ou plus longue : même ordre', () => {
    expect(read(rowByRow(column(LEFT, X_LEFT), column(RIGHT.slice(0, 9), X_RIGHT)))).toBe([...LEFT, ...RIGHT.slice(0, 9)].join('\n'));
    expect(read(rowByRow(column(LEFT.slice(0, 10), X_LEFT), column(RIGHT, X_RIGHT)))).toBe([...LEFT.slice(0, 10), ...RIGHT].join('\n'));
  });

  it('une ligne isolée sans vis-à-vis dans la colonne de droite (ligne perdue, légende) : le flux balayé est toujours réordonné', () => {
    const right = column(RIGHT, X_RIGHT).filter((_, i) => i !== 7);
    const items = [...column(LEFT, X_LEFT), ...right].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    expect(read(items)).toBe([...LEFT, ...right.map(i => i.str)].join('\n'));
  });

  it('titre pleine largeur : lu en premier, puis la colonne de gauche, puis celle de droite', () => {
    const title = item('La photosynthèse chez les plantes vertes', 190, TOP + 30, 16);
    expect(title.transform[4] + title.width).toBeGreaterThan(X_RIGHT);
    const items = [title, ...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT))];
    expect(read(items)).toBe([title.str, ...LEFT, ...RIGHT].join('\n'));
    // Titre écrit à la fin du flux : toujours lu en premier (il est en haut de la page).
    expect(read([...items.slice(1), title])).toBe([title.str, ...LEFT, ...RIGHT].join('\n'));
  });

  it('une ligne pleine largeur sépare deux bandes : gauche et droite de la première, la ligne, puis gauche et droite de la seconde', () => {
    const [leftA, rightA, leftB, rightB] = [ARTICLE.slice(0, 8), ARTICLE.slice(8, 16), ARTICLE.slice(16, 24), ARTICLE.slice(24, 32)];
    const heading = item('2. Les échanges gazeux de la feuille', 190, TOP - 8 * LEADING - 6, 12);
    const bandB = TOP - 8 * LEADING - 30;
    const items = [...rowByRow(column(leftA, X_LEFT), column(rightA, X_RIGHT), true), heading, ...rowByRow(column(leftB, X_LEFT, bandB), column(rightB, X_RIGHT, bandB), true)];
    expect(read(items)).toBe([...leftA, ...rightA, heading.str, ...leftB, ...rightB].join('\n'));
  });

  it('première page d’un article : titre et chapeau de plusieurs lignes pleine largeur, puis deux colonnes', () => {
    const title = item('La photosynthèse chez les plantes vertes', 190, TOP + 150, 16);
    const abstract = wrap(SVT_COURSE_PAGES[0], 95).slice(0, 8).map((line, i) => item(line, 50, TOP + 120 - i * LEADING));
    expect(abstract.every(a => a.width > 400)).toBe(true);
    const left = LEFT.slice(0, 16);
    const right = RIGHT.slice(0, 16);
    const items = [title, ...abstract, ...rowByRow(column(left, X_LEFT), column(right, X_RIGHT), true)];
    expect(read(items)).toBe([title.str, ...abstract.map(a => a.str), ...left, ...right].join('\n'));
  });

  it('en-tête et pied de page pleine largeur : en tête et en queue de la lecture', () => {
    const header = item('Lycée Jean Moulin - SVT Seconde', 190, TOP + 40, 9);
    const footer = item('Page 3 / 6', 270, 40, 9);
    const items = [footer, header, ...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT), true)];
    expect(read(items)).toBe([header.str, ...LEFT, ...RIGHT, footer.str].join('\n'));
  });

  it('paragraphes qui changent à des hauteurs différentes dans chaque colonne (espacement entre paragraphes) : toujours lu en colonnes', () => {
    // Colonne de gauche : paragraphes de 6, 7 et 5 lignes ; colonne de droite : 5, 7 et 6 lignes ; 6 pt entre deux paragraphes.
    const spaced = (lines: string[], x: number, breaksAfter: number[]) => lines.map((line, i) => item(line, x, TOP - i * LEADING - 6 * breaksAfter.filter(b => b <= i).length));
    const left = spaced(LEFT, X_LEFT, [6, 13]);
    const right = spaced(RIGHT, X_RIGHT, [5, 12]);
    expect(read(rowByRow(left, right, true))).toBe([...LEFT, ...RIGHT].join('\n'));
  });

  it('un titre dont le texte finit par une espace reste sur sa ligne', () => {
    const title = { ...item('Les échanges gazeux ', 190, TOP + 30, 16), hasEOL: false };
    expect(read([...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT)), title])).toBe(['Les échanges gazeux ', ...LEFT, ...RIGHT].join('\n'));
  });

  it('un exposant dans une colonne reste dans sa ligne', () => {
    const left = column(LEFT, X_LEFT);
    const sup = { ...item('2', X_LEFT + left[3].width + 1, TOP - 3 * LEADING + 4, 6), width: 3 };
    const items = rowByRow(left, column(RIGHT, X_RIGHT));
    items.splice(items.indexOf(left[3]) + 1, 0, sup);
    expect(read(items)).toBe([...LEFT.slice(0, 3), `${LEFT[3]}2`, ...LEFT.slice(4), ...RIGHT].join('\n'));
  });

  it('césure en fin de colonne : le mot est rejoint par le nettoyage du texte, comme à l’intérieur d’une colonne', () => {
    const left = [...LEFT.slice(0, -1), 'les stomates permettent la photo-'];
    const right = ['synthèse de la plante verte et les échanges', ...RIGHT.slice(1)];
    const text = read(rowByRow(column(left, X_LEFT), column(right, X_RIGHT)));
    expect(text).toContain('permettent la photo-\nsynthèse de la plante verte');
  });
});

describe('PDF : mises en page qui ne sont pas deux colonnes de texte (ordre du flux conservé)', () => {
  /** L'ordre n'est pas touché : même tableau rendu, donc exactement le texte d'origine. */
  function expectUntouched(items: unknown[]) {
    const ordered = readingOrder(items);
    expect(ordered).toBe(items);
    return pdfItemsToText(ordered).trimEnd();
  }

  it('tableau de cellules courtes : l’ordre ligne par ligne est conservé', () => {
    const xs = [50, 200, 400];
    const rows = [['Élément', 'Rôle principal', 'Dose'], ['Azote', 'croissance des feuilles', '200'], ['Phosphore', 'développement racinaire', '80'], ['Potassium', 'résistance au froid', '150'], ['Calcium', 'solidité des parois', '60'], ['Magnésium', 'chlorophylle', '40'], ['Soufre', 'protéines', '30'], ['Fer', 'synthèse de la chlorophylle', '5'], ['Zinc', 'enzymes', '2'], ['Cuivre', 'transport des électrons', '1'], ['Bore', 'formation des parois', '1'], ['Manganèse', 'photolyse de l’eau', '3'], ['Chlore', 'équilibre osmotique', '4'], ['Nickel', 'métabolisme de l’azote', '1'], ['Sodium', 'régulation de l’eau', '6']];
    const items = rows.flatMap((row, r) => row.map((cell, c) => item(cell, xs[c], 700 - r * 20, 10, c === 2)));
    expect(expectUntouched(items)).toBe(rows.map(row => row.join(' ')).join('\n'));
  });

  it('tableau à deux colonnes de libellés et de nombres : inchangé', () => {
    const rows = Array.from({ length: 16 }, (_, i) => [`Série ${i + 1} : mesure du débit`, `${(i + 1) * 3},5 L/min`]);
    const items = rows.flatMap((row, r) => [item(row[0], 60, 700 - r * 18), item(row[1], 330, 700 - r * 18, 10, true)]);
    expect(expectUntouched(items)).toBe(rows.map(row => row.join(' ')).join('\n'));
  });

  it('tableau à deux colonnes de textes longs : les rangées de hauteurs différentes séparées par un interligne restent lues rangée par rangée', () => {
    // Chaque rangée : une cellule de 3 lignes à gauche, une de 2 lignes à droite, commençant à la même hauteur.
    const items: TextItem[] = [];
    const reading: string[] = [];
    let y = TOP;
    for (let row = 0; row < 6; row++) {
      const left = ARTICLE.slice(row * 5, row * 5 + 3);
      const right = ARTICLE.slice(row * 5 + 3, row * 5 + 5);
      for (let k = 0; k < 3; k++) {
        items.push(item(left[k], X_LEFT, y - k * LEADING));
        if (right[k]) items.push(item(right[k], X_RIGHT, y - k * LEADING, 10, true));
        reading.push(right[k] ? `${left[k]} ${right[k]}` : left[k]);
      }
      y -= 3 * LEADING + 12;
    }
    expect(expectUntouched(items)).toBe(reading.join('\n'));
  });

  it('table des matières avec points de conduite et numéros de page à droite : inchangée', () => {
    const titles = Array.from({ length: 16 }, (_, i) => `Chapitre ${i + 1} ${ARTICLE[i].slice(0, 30)}`);
    // Une seule chaîne par ligne.
    const oneItem = titles.map((t, i) => item(`${t} ${'.'.repeat(Math.round(60 - t.length / 2))} ${i * 7 + 3}`, 60, 700 - i * 20, 10, true));
    expect(expectUntouched(oneItem)).toBe(oneItem.map(i => i.str).join('\n'));
    // Titre, points de conduite et numéro de page en trois éléments ; puis sans points de conduite.
    for (const leaders of [true, false]) {
      const items = titles.flatMap((t, i) => {
        const y = 700 - i * 20;
        const dots = item('.'.repeat(Math.round((500 - 60 - t.length * 5) / 5) - 2), 60 + t.length * 5 + 5, y);
        return [item(t, 60, y), ...(leaders ? [dots] : []), item(String(i * 7 + 3), 500, y, 10, true)];
      });
      expectUntouched(items);
    }
  });

  it('formulaire : libellés et champs à remplir sur deux demi-pages, ou étiquettes à gauche : inchangé', () => {
    const labels = ['Nom de l’élève', 'Prénom de l’élève', 'Classe fréquentée', 'Date de naissance', 'Enseignant référent', 'Établissement d’accueil', 'Responsable légal', 'Numéro de téléphone', 'Adresse électronique', 'Régime de restauration', 'Allergies connues', 'Médecin traitant', 'Assurance scolaire', 'Personne à prévenir'];
    const twoHalves = labels.flatMap((label, i) => {
      const y = 700 - i * 24;
      return [item(`${label} :`, 50, y), item('_'.repeat(20), 190, y), item(`${label} :`, 320, y), item('_'.repeat(20), 460, y, 10, true)];
    });
    expectUntouched(twoHalves);
    const simple = labels.flatMap((label, i) => [item(`${label} :`, 60, 700 - i * 24), item('.'.repeat(60), 250, 700 - i * 24, 10, true)]);
    expectUntouched(simple);
  });

  it('une seule colonne, avec retrait de première ligne, citation en retrait et liste à puces : inchangée', () => {
    const wide = wrap(SVT_COURSE_PAGES.slice(1, 4).join(' '), 90);
    const items = wide.map((line, i) => {
      const quote = i >= 4 && i < 7;
      return item(line, quote ? 100 : i % 6 === 0 ? 75 : 60, TOP - i * LEADING, 10, true);
    });
    expect(items.length).toBeGreaterThan(14);
    expect(expectUntouched(items)).toBe(items.map(i => i.str).join('\n'));
    const bullets = Array.from({ length: 14 }, (_, i) => [item('•', 60, TOP - i * 2 * LEADING), item(ARTICLE[i], 80, TOP - i * 2 * LEADING, 10, true), item(ARTICLE[i + 14], 80, TOP - (i * 2 + 1) * LEADING, 10, true)]).flat();
    expectUntouched(bullets);
  });

  it('page presque vide, ou trop peu de lignes par colonne : inchangée', () => {
    expectUntouched(rowByRow(column(LEFT.slice(0, 2), X_LEFT), column(RIGHT.slice(0, 2), X_RIGHT)));
    expectUntouched(rowByRow(column(LEFT.slice(0, 5), X_LEFT), column(RIGHT.slice(0, 5), X_RIGHT)));
    expectUntouched([]);
    expectUntouched([item('Page 3', 280, 40)]);
  });

  it('dernière page d’un article : colonne de droite de quelques lignes seulement, ordre du flux conservé', () => {
    expectUntouched(rowByRow(column(LEFT, X_LEFT), column(RIGHT.slice(0, 4), X_RIGHT)));
  });

  it('trois colonnes : inchangé', () => {
    const cols = [0, 14, 28].map(from => ARTICLE.slice(from, from + 14).map(l => l.slice(0, 34)));
    const items = cols[0].flatMap((_, r) => [item(cols[0][r], 50, TOP - r * LEADING), item(cols[1][r], 240, TOP - r * LEADING), item(cols[2][r], 430, TOP - r * LEADING, 10, true)]);
    expectUntouched(items);
  });

  it('colonne de libellés courts ou de chiffres à côté d’un texte : inchangée', () => {
    const notes = Array.from({ length: 14 }, (_, i) => item(['Notion', 'Date', 'Mot-clé', 'Formule'][i % 4], 50, TOP - i * LEADING));
    expectUntouched(rowByRow(notes, column(ARTICLE.slice(0, 14), 150)));
    const numbers = Array.from({ length: 14 }, (_, i) => item(String(1200 + i * 3), 50, TOP - i * LEADING));
    expectUntouched(rowByRow(numbers, column(ARTICLE.slice(0, 14), X_RIGHT)));
  });

  it('deux colonnes de libellés courts ou de nombres, de même largeur et alignées : ce n’est pas du texte, inchangé', () => {
    const labels = Array.from({ length: 16 }, (_, i) => `Mesure n° ${String(i + 1).padStart(2, '0')}`);
    const values = Array.from({ length: 16 }, (_, i) => `Valeur ${String(i * 3 + 100)} L`);
    expectUntouched(rowByRow(column(labels, 50), column(values, 130)));
    const numbers = Array.from({ length: 16 }, (_, i) => String(120_000 + i * 7));
    expectUntouched(rowByRow(column(numbers, 50), column(numbers, 130)));
  });

  it('deux colonnes de phrases d’une ligne de longueurs quelconques (liste de définitions) : chaque ligne ne remplit pas sa colonne, inchangé', () => {
    const lengths = [30, 44, 34, 30, 40, 32, 44, 36, 30, 42, 38, 31, 44, 33];
    const left = lengths.map((n, i) => ARTICLE[i].slice(0, n));
    const right = lengths.map((_, i) => ARTICLE[i + 14].slice(0, lengths[(i + 5) % lengths.length]));
    expectUntouched(rowByRow(column(left, 50), column(right, 310)));
  });

  it('quatre colonnes de textes (grille d’évaluation) : inchangé, même si deux moitiés ressemblent à deux colonnes', () => {
    const cell = (from: number) => ARTICLE.slice(from, from + 14).map(l => l.slice(0, 32));
    const cols = [cell(0), cell(14), cell(28), cell(42)];
    const items = cols[0].flatMap((_, r) => cols.map((col, c) => item(col[r], 50 + c * 180, TOP - r * LEADING, 10, c === 3)));
    expectUntouched(items);
  });

  it('gouttière démesurée (plus de 30 % de la largeur du texte) : inchangé', () => {
    const half = (from: number) => ARTICLE.slice(from, from + 14).map(l => l.slice(0, 34));
    expectUntouched(rowByRow(column(half(0), 50), column(half(14), 420)));
  });

  it('deux colonnes de largeurs très différentes (bandeau latéral étroit) : inchangé', () => {
    const narrow = column(ARTICLE.slice(0, 14).map(l => l.slice(0, 32)), 50);
    expectUntouched(rowByRow(narrow, column(wrap(SVT_COURSE_PAGES.slice(1, 4).join(' '), 70).slice(0, 14), 250)));
  });

  it('un texte tourné (filigrane en diagonale, page paysage) sur la page : inchangé', () => {
    const items = [...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT)), { ...item('CONFIDENTIEL', 200, 400, 40), transform: [28, 28, -28, 28, 200, 400] }];
    expectUntouched(items);
    expectUntouched([...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT)), { ...item('x', 10, 10), transform: [10, 0, 0] }]);
  });

  it('éléments sans texte, marqueurs et valeurs inattendues : sans erreur, ordre conservé', () => {
    const items = [{ type: 'beginMarkedContent' }, null, { str: 42 }, { str: '   ', transform: [10, 0, 0, 10, 0, 0], width: 3 }, ...rowByRow(column(LEFT.slice(0, 3), X_LEFT), column(RIGHT.slice(0, 3), X_RIGHT))];
    expect(readingOrder(items)).toBe(items);
    // Dans une page en colonnes, ils suivent l'élément précédent du flux ou sont retirés de la colonne.
    const mixed = [{ type: 'beginMarkedContent' }, null, ...rowByRow(column(LEFT, X_LEFT), column(RIGHT, X_RIGHT), true), { type: 'endMarkedContent' }];
    expect(read(mixed)).toBe([...LEFT, ...RIGHT].join('\n'));
  });
});

// Tableau à grille de deux colonnes de 250 pt (texte à 50 et 310 pt) dont les cellules sont des paragraphes : une rangée suit
// la précédente à un interligne plus la marge de cellule, sans saut d'interligne net, et les cellules d'une même rangée n'ont
// pas le même nombre de lignes. Seul le flux d'origine dit si la page est lue en traversant les colonnes.
type TableRow = [string[], string[]];
type TableCells = { left: TextItem[]; right: TextItem[] }[];
const TABLE_TEXT = wrap(SVT_COURSE_PAGES.join(' '));

/** Rangées dont les cellules ont `[lignes à gauche, lignes à droite]` (le motif se répète jusqu'à `count` rangées), prises dans la suite du texte. */
function rowsOf(sizes: [number, number][], count = sizes.length): TableRow[] {
  let at = 0;
  const take = (n: number) => Array.from({ length: n }, () => TABLE_TEXT[at++ % TABLE_TEXT.length]);
  return Array.from({ length: count }, (_, r) => {
    const [a, b] = sizes[r % sizes.length];
    return [take(a), take(b)];
  });
}

/** Éléments de chaque cellule : une rangée commence à la hauteur de la précédente moins sa cellule la plus haute et la marge. */
function gridTable(rows: TableRow[], margin = 1, top = TOP): TableCells {
  let y = top;
  return rows.map(([left, right]) => {
    const cells = { left: column(left, X_LEFT, y), right: column(right, X_RIGHT, y) };
    y -= Math.max(left.length, right.length) * LEADING + margin;
    return cells;
  });
}

/** Flux d'un tableau écrit cellule par cellule (Word, LibreOffice, reportlab, LaTeX) : la cellule de gauche en entier, puis celle de droite, rangée après rangée. */
const cellByCellFlow = (cells: TableCells): TextItem[] => cells.flatMap(c => [...c.left, ...c.right]).map(i => ({ ...i, hasEOL: true }));
/** Flux d'un tableau lu ligne visuelle par ligne visuelle (balayage) : chaque ligne de la cellule de gauche est suivie de la ligne voisine de la cellule de droite. */
const sweptFlow = (cells: TableCells): TextItem[] => cells.flatMap(c => rowByRow(c.left, c.right));

const cellReading = (rows: TableRow[]) => rows.flatMap(([left, right]) => [...left, ...right]).join('\n');
const sweptReading = (rows: TableRow[]) =>
  rows.flatMap(([left, right]) => Array.from({ length: Math.max(left.length, right.length) }, (_, k) => (left[k] && right[k] ? `${left[k]} ${right[k]}` : left[k] ?? right[k]))).join('\n');

describe('PDF : tableau de cellules en paragraphes (rangées conservées)', () => {
  const UNEVEN: Record<string, [number, number][]> = {
    'cellules tantôt plus longues à gauche, tantôt à droite': [[4, 2], [2, 4], [5, 3], [3, 5], [4, 2]],
    'cellule de gauche toujours plus longue': [[5, 3], [4, 2], [6, 4], [3, 2], [5, 3]],
    'cellule de droite toujours plus longue': [[2, 4], [3, 5], [2, 4], [3, 6], [2, 5]],
  };
  const MARGINS = [0, 1, 4];

  for (const [name, sizes] of Object.entries(UNEVEN)) {
    for (const margin of MARGINS) {
      it(`${name}, marge de ${margin} pt, écrit cellule par cellule : lu rangée par rangée, entrée rendue telle quelle`, () => {
        const rows = rowsOf(sizes);
        const items = cellByCellFlow(gridTable(rows, margin));
        expect(readingOrder(items)).toBe(items);
        expect(read(items)).toBe(cellReading(rows));
      });

      it(`${name}, marge de ${margin} pt, écrit ligne par ligne : « cellule gauche | cellule droite » par rangée, entrée rendue telle quelle`, () => {
        const rows = rowsOf(sizes);
        const items = sweptFlow(gridTable(rows, margin));
        expect(readingOrder(items)).toBe(items);
        expect(read(items)).toBe(sweptReading(rows));
      });
    }
  }

  it('cellules de même longueur dans chaque rangée, écrites cellule par cellule : rendu tel quel', () => {
    const rows = rowsOf([[3, 3], [4, 4], [3, 3], [4, 4], [3, 3]]);
    for (const margin of MARGINS) {
      const items = cellByCellFlow(gridTable(rows, margin));
      expect(readingOrder(items)).toBe(items);
      expect(read(items)).toBe(cellReading(rows));
    }
  });

  it('tableau en flux pdf.js (espaces entre blocs, fins de ligne, marqueurs vides), cellules inégales : rendu tel quel', () => {
    const rows = rowsOf(UNEVEN['cellules tantôt plus longues à gauche, tantôt à droite']);
    const cells = gridTable(rows);
    const marker = (at: TextItem) => ({ ...item('', 0, at.transform[5]), width: 0, height: 0, hasEOL: true });
    const swept = cells.flatMap(c => rowByRow(c.left, c.right, true));
    expect(readingOrder(swept)).toBe(swept);
    const byCell = cells.flatMap(c => [...c.left, ...c.right]).flatMap(i => [{ ...i, hasEOL: false }, marker(i)]);
    expect(readingOrder(byCell)).toBe(byCell);
  });

  it('article balayé suivi, sous un intertitre pleine largeur, d’un tableau écrit cellule par cellule : l’article est réordonné, le tableau garde ses rangées', () => {
    const left = TABLE_TEXT.slice(0, 28);
    const right = TABLE_TEXT.slice(28, 56);
    const heading = item('3. Doses apportées selon les besoins', 190, TOP - 28 * LEADING - 6, 12);
    const rows = rowsOf([[3, 2], [2, 4], [4, 3], [3, 3]]).map(([l, r]): TableRow => [l.map(s => s.toUpperCase()), r.map(s => s.toUpperCase())]);
    const items = [...rowByRow(column(left, X_LEFT), column(right, X_RIGHT), true), heading, ...cellByCellFlow(gridTable(rows, 1, TOP - 28 * LEADING - 30))];
    const ordered = readingOrder(items);
    expect(ordered).not.toBe(items);
    expect(pdfItemsToText(ordered).trimEnd()).toBe([...left, ...right, heading.str, cellReading(rows)].join('\n'));
  });
});

describe('PDF : lecture en colonnes, jamais de texte perdu', () => {
  it('pages aléatoires (colonnes décalées, titres, éléments vides, valeurs absurdes) : aucune erreur, tout le texte conservé une seule fois', () => {
    let seed = 20_260_501;
    const rnd = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const texts = (list: unknown[]) => list.filter(i => typeof (i as TextItem)?.str === 'string' && (i as TextItem).str.trim()).map(i => (i as TextItem).str).sort();
    let reordered = 0;
    for (let page = 0; page < 300; page++) {
      const items: unknown[] = [];
      const rows = between(4, 24);
      // Balayage régulier (colonnes pleines, sans trou, lignes alignées : réordonné) ou colonnes décalées, courtes, privées de lignes au hasard
      // (trous comme les cellules inégales d'un tableau : ordre conservé).
      const complete = rnd() < 0.5;
      const jitter = complete || rnd() < 0.5 ? 0 : between(1, 9);
      const cut = (line: string, n: number) => line.slice(0, n);
      const [leftX, rightX] = [between(30, 80), between(280, 340)];
      for (let r = 0; r < rows; r++) {
        const n = complete ? between(38, 44) : between(rnd() < 0.3 ? 8 : 30, 44);
        const left = item(cut(ARTICLE[r % ARTICLE.length], n) + (rnd() < 0.1 ? ' ' : ''), leftX, TOP - r * LEADING + (jitter ? between(-jitter, jitter) : 0));
        const right = item(cut(ARTICLE[(r * 3 + 1) % ARTICLE.length], rnd() < 0.8 ? n : between(5, 44)), rightX, TOP - r * LEADING + (jitter ? between(-jitter, jitter) : 0));
        items.push(left);
        if (rnd() < 0.2) items.push({ type: 'beginMarkedContent' });
        if (complete || rnd() < 0.8) items.push(right);
        if (rnd() < 0.3) items.push({ ...item(' ', 0, 0), width: between(0, 40) });
        if (rnd() < 0.5) items.push({ ...item('', 0, 0), hasEOL: true });
      }
      if (rnd() < 0.5) items.splice(between(0, items.length), 0, item(`Titre ${page}`, between(100, 250), TOP + between(10, 60), between(10, 20)));
      if (rnd() < 0.1) items.push({ ...item('x', between(0, 500), between(0, 800)), transform: [between(-3, 12), between(-3, 3), 0, between(-2, 12), between(0, 500), between(0, 800)] });
      if (rnd() < 0.05) items.push({ ...item('NaN', 1, 1), transform: [10, 0, 0, 10, Number.NaN, 5] });
      if (rnd() < 0.5) items.reverse();
      const ordered = readingOrder(items);
      if (ordered !== items) reordered++;
      expect(texts(ordered), `page ${page}`).toEqual(texts(items));
      expect(() => pdfItemsToText(ordered)).not.toThrow();
    }
    // Le tirage contient de vraies pages en colonnes comme des pages où rien ne doit bouger.
    expect(reordered).toBeGreaterThan(10);
    expect(reordered).toBeLessThan(290);
  });
});

describe('PDF : lecture en colonnes, temps borné', () => {
  it('60 000 lignes sur deux colonnes : ordre juste, en temps quasi linéaire', () => {
    const rows = 30_000;
    const left = Array.from({ length: rows }, (_, i) => item(ARTICLE[i % ARTICLE.length], X_LEFT, 9_000_000 - i * LEADING));
    const right = Array.from({ length: rows }, (_, i) => item(ARTICLE[(i + 7) % ARTICLE.length], X_RIGHT, 9_000_000 - i * LEADING));
    const items = rowByRow(left, right, true);
    const t0 = performance.now();
    const ordered = readingOrder(items);
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    const strs = ordered.filter(i => (i as TextItem).str.trim()).map(i => (i as TextItem).str);
    expect(strs).toHaveLength(2 * rows);
    expect(strs[0]).toBe(ARTICLE[0]);
    expect(strs[rows - 1]).toBe(ARTICLE[(rows - 1) % ARTICLE.length]);
    expect(strs[rows]).toBe(ARTICLE[7]);
  });

  it('plus de 30 000 éléments mot à mot sur deux colonnes : ordre juste', () => {
    const wordItems = (line: string, x: number, y: number) => {
      let at = x;
      return line.split(' ').map(word => {
        const w = item(word, at, y);
        at += w.width + 5;
        return w;
      });
    };
    const rows = 3_000;
    const items: TextItem[] = [];
    for (let i = 0; i < rows; i++) {
      items.push(...wordItems(ARTICLE[i % 18], X_LEFT, 9_000_000 - i * LEADING), ...wordItems(ARTICLE[18 + (i % 18)], X_RIGHT, 9_000_000 - i * LEADING));
    }
    expect(items.length).toBeGreaterThan(30_000);
    const t0 = performance.now();
    const ordered = readingOrder(items) as TextItem[];
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    const firstRight = ordered.findIndex(i => i.transform[4] >= X_RIGHT);
    expect(ordered.slice(0, firstRight).every(i => i.transform[4] < X_RIGHT)).toBe(true);
    expect(ordered.slice(firstRight).every(i => i.transform[4] >= X_RIGHT)).toBe(true);
    expect(firstRight).toBe(items.filter(i => i.transform[4] < X_RIGHT).length);
  });

  it('60 000 lignes écrites colonne par colonne : rendues telles quelles, en temps borné', () => {
    const rows = 30_000;
    const left = Array.from({ length: rows }, (_, i) => item(ARTICLE[i % ARTICLE.length], X_LEFT, 9_000_000 - i * LEADING));
    const right = Array.from({ length: rows }, (_, i) => item(ARTICLE[(i + 7) % ARTICLE.length], X_RIGHT, 9_000_000 - i * LEADING));
    const items = columnByColumn(left, right);
    const t0 = performance.now();
    const ordered = readingOrder(items);
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    expect(ordered).toBe(items);
  });

  it('tableau de 20 000 rangées (plus de 130 000 éléments) à cellules inégales, écrit cellule par cellule ou ligne par ligne : rendu tel quel, en temps borné', () => {
    const cells = gridTable(rowsOf([[4, 2], [2, 4], [5, 3], [3, 5], [4, 2]], 20_000));
    for (const items of [cellByCellFlow(cells), sweptFlow(cells)]) {
      expect(items.length).toBeGreaterThan(130_000);
      const t0 = performance.now();
      const ordered = readingOrder(items);
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(ordered).toBe(items);
    }
  });

  it('pages piégées (200 000 éléments sur une ligne, sur des lignes toutes différentes, tous au même point, grille de 400 colonnes) : temps borné, ordre conservé', () => {
    const samples: TextItem[][] = [
      Array.from({ length: 200_000 }, (_, i) => item('ab', (i % 400) * 12, 9_000_000 - Math.floor(i / 400) * 12)),
      Array.from({ length: 200_000 }, (_, i) => item('mot', i * 3, 500)),
      Array.from({ length: 200_000 }, (_, i) => item('une ligne de texte', 50, 9_000_000 - i * 12)),
      Array.from({ length: 200_000 }, () => item('mot', 100, 100)),
      Array.from({ length: 100_000 }, (_, i) => item('une ligne de texte assez longue pour la page', (i % 2) * 260 + 50, 9_000_000 - Math.floor(i / 2) * 12 - (i % 7) * 0.3)),
    ];
    for (const items of samples) {
      const t0 = performance.now();
      const ordered = readingOrder(items);
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(ordered).toHaveLength(items.length);
    }
  });
});

describe('PDF : extraction réelle (pdf.js) d’un article sur deux colonnes', () => {
  /** Mise en page jsPDF (corps 10) : lignes de 225 pt au plus, colonnes à 50 et 310 pt, écrites ligne par ligne. */
  const lines = wrapToWidth(SVT_COURSE_PAGES.slice(1, 5).join(' '), 225);
  const left = lines.slice(0, 18);
  const right = lines.slice(18, 36);
  const placed = (leftLines: string[], rightLines: string[], top = 110): PdfPlaced[] =>
    Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, i) => [
      ...(leftLines[i] ? [{ text: leftLines[i], x: 50, y: top + i * 14 }] : []),
      ...(rightLines[i] ? [{ text: rightLines[i], x: 310, y: top + i * 14 }] : []),
    ]).flat();

  async function rawText(bytes: Uint8Array): Promise<string> {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    return pdfItemsToText(content.items);
  }

  it('titre pleine largeur puis deux colonnes écrites ligne par ligne : colonne de gauche, puis colonne de droite', async () => {
    const title = { text: 'La photosynthèse chez les plantes vertes', x: 120, y: 70, size: 16 };
    const bytes = makePdfPlaced([[title, ...placed(left, right)]]);
    // AVANT : « Lecture … » mélangeait la première ligne de gauche et la première ligne de droite.
    expect((await rawText(bytes)).split('\n')[1]).toContain(`${left[0]}`);
    expect((await rawText(bytes)).split('\n')[1]).toContain(`${right[0]}`);
    const doc = await extractPdf({ id: 'p', name: 'article.pdf', bytes }, pdfjs);
    expect(doc.units[0].text).toBe([title.text, ...left, ...right].join('\n'));
  });

  it('un tableau et une table des matières du même PDF restent lus ligne par ligne', async () => {
    const xs = [50, 200, 400];
    const rows = [['Élément', 'Rôle principal', 'Dose'], ['Azote', 'croissance des feuilles', '200'], ['Phosphore', 'développement racinaire', '80'], ['Potassium', 'résistance au froid', '150'], ['Calcium', 'solidité des parois', '60'], ['Magnésium', 'chlorophylle', '40'], ['Soufre', 'protéines', '30'], ['Fer', 'synthèse de la chlorophylle', '5']];
    const table = rows.flatMap((row, r) => row.map((text, c) => ({ text, x: xs[c], y: 100 + r * 20 })));
    const toc = ['Chapitre 1 La photosynthèse', 'Chapitre 2 Les échanges gazeux', 'Chapitre 3 La chlorophylle', 'Chapitre 4 Le devenir de la matière', 'Chapitre 5 Les facteurs de la production', 'Chapitre 6 Bilan', 'Chapitre 7 Prolongements'].flatMap((text, i) => [
      { text, x: 60, y: 100 + i * 20 },
      { text: '.'.repeat(40), x: 300, y: 100 + i * 20 },
      { text: String(i * 7 + 3), x: 500, y: 100 + i * 20 },
    ]);
    const doc = await extractPdf({ id: 'p', name: 'documents.pdf', bytes: makePdfPlaced([table, toc]) }, pdfjs);
    expect(doc.units[0].text).toBe(rows.map(row => row.join(' ')).join('\n'));
    expect(doc.units[1].text.split('\n')[0]).toBe(`Chapitre 1 La photosynthèse ${'.'.repeat(40)} 3`);
    expect(doc.units[1].text.split('\n')).toHaveLength(7);
  });

  it('tableau à cellules de longueurs différentes, sans interligne entre rangées, écrit cellule par cellule ou ligne par ligne : lu rangée par rangée', async () => {
    let at = 0;
    const rows = ([[4, 2], [2, 4], [5, 3], [3, 5], [4, 2]] as const).map(([a, b]): [string[], string[]] => {
      const row: [string[], string[]] = [lines.slice(at, at + a), lines.slice(at + a, at + a + b)];
      at += a + b;
      return row;
    });
    const placedTable = (flow: 'cells' | 'lines'): PdfPlaced[] => {
      let top = 110;
      return rows.flatMap(([l, r]) => {
        const lp = l.map((text, k) => ({ text, x: 50, y: top + k * 14 }));
        const rp = r.map((text, k) => ({ text, x: 310, y: top + k * 14 }));
        top += Math.max(l.length, r.length) * 14 + 1;
        if (flow === 'cells') return [...lp, ...rp];
        return Array.from({ length: Math.max(l.length, r.length) }, (_, k) => [...(lp[k] ? [lp[k]] : []), ...(rp[k] ? [rp[k]] : [])]).flat();
      });
    };
    const byCell = await extractPdf({ id: 'p', name: 'tableau.pdf', bytes: makePdfPlaced([placedTable('cells')]) }, pdfjs);
    expect(byCell.units[0].text).toBe(rows.flatMap(([l, r]) => [...l, ...r]).join('\n'));
    const byLine = await extractPdf({ id: 'p', name: 'tableau.pdf', bytes: makePdfPlaced([placedTable('lines')]) }, pdfjs);
    const expected = rows.flatMap(([l, r]) => Array.from({ length: Math.max(l.length, r.length) }, (_, k) => [l[k], r[k]].filter(Boolean).join(' '))).join('\n');
    expect(byLine.units[0].text).toBe(expected);
  });

  it('césure entre le bas de la colonne de gauche et le haut de celle de droite : le mot est reconstitué', async () => {
    const hyphenated = [...left.slice(0, -1), 'les stomates permettent la photo-'];
    const continued = ['synthèse de la plante verte et les échanges', ...right.slice(1)];
    const doc = await extractPdf({ id: 'p', name: 'article.pdf', bytes: makePdfPlaced([placed(hyphenated, continued)]) }, pdfjs);
    expect(doc.units[0].text).toContain('permettent la photosynthèse de la plante verte');
  });
});
