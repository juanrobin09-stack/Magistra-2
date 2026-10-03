// Corpus de non-régression du choix du tableau des séances (shared/planTable.ts) : plans réalistes générés de façon
// déterministe (graine fixe), avec le tableau des séances (en-têtes variés, numérotations variées, trous, début à 2,
// tableau coupé en deux) et des tableaux « leurres » placés avant ou après (objectifs numérotés, chronologie, matrice de
// renvois, évaluations, questions…). Chaque cas dit ce qu'une lecture juste doit rendre : les numéros du vrai tableau et,
// pour chaque ligne, un texte d'origine de sa première cellule de texte.

/** Un plan du corpus et le résultat attendu. */
export interface CorpusCase {
  /** Texte Markdown du plan. */
  markdown: string;
  /** Nombre de séances demandé, s'il l'a été. */
  requested?: number;
  /** Lignes du vrai tableau, dans l'ordre : numéro et texte qui doit figurer dans la ligne lue. */
  expected: { numero: number; marker: string }[];
  /** Traits du cas (tableaux leurres, défaut du vrai tableau, nombre demandé), pour le rapport par famille. */
  traits: string[];
}

type Random = () => number;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Random, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const chance = (r: Random, p: number): boolean => r() < p;
const between = (r: Random, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
function weighted<T>(r: Random, list: readonly { value: T; weight: number }[]): T {
  let left = r() * list.reduce((sum, item) => sum + item.weight, 0);
  for (const item of list) {
    left -= item.weight;
    if (left < 0) return item.value;
  }
  return list[list.length - 1].value;
}
function shuffled<T>(r: Random, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TITLES = [
  'L\'Ancien Régime', 'La prise de la Bastille', 'La fin de la monarchie', 'La Terreur', 'Napoléon Bonaparte', 'Les états de la matière',
  'Fusion et solidification', 'Les fractions décimales', 'Additionner des fractions', 'Le cycle de l\'eau', 'La photosynthèse',
  'Le passé composé', 'Les accords du participe', 'Lire un poème', 'Écrire un récit', 'Les volcans', 'Les séismes', 'Le climat tempéré',
  'Les ressources naturelles', 'La démocratie athénienne', 'Rome et son empire', 'Les inégalités mondiales', 'Les mégapoles',
  'Les circuits électriques', 'La loi d\'Ohm', 'Les équations du premier degré', 'Le théorème de Thalès', 'Les probabilités',
  'La lecture d\'un graphique', 'Le développement durable', 'La Première Guerre mondiale', 'Les tranchées', 'Le traité de Versailles',
  'Les mouvements de la Terre', 'Le système solaire', 'Les saisons', 'La respiration cellulaire', 'La digestion', 'Le mouvement des astres',
  'La mise en scène théâtrale', 'Le discours argumentatif', 'La description d\'un lieu', 'Les figures de style', 'Le conte merveilleux',
  'La symétrie axiale', 'Les angles', 'Les triangles', 'Les quadrilatères', 'Le périmètre et l\'aire', 'Les volumes',
  'Les énergies renouvelables', 'La biodiversité', 'Les chaînes alimentaires', 'Les écosystèmes', 'Les rythmes biologiques',
  'Les migrations', 'Les échanges commerciaux', 'La mondialisation', 'Les frontières', 'Les paysages ruraux',
] as const;

const PHRASES = [
  'Étude de documents', 'Frise chronologique', 'Débat en classe', 'Travail en groupes', 'Manipulation guidée', 'Exercices d\'application',
  'Lecture et reformulation', 'Carte mentale', 'Expérience en binôme', 'Quiz de révision', 'Production écrite', 'Mise en commun',
] as const;

const OBJECTIVES = [
  'Situer les grandes étapes', 'Comprendre les causes', 'Analyser des documents', 'Expliquer le vocabulaire', 'Comparer deux sources',
  'Mesurer une grandeur', 'Savoir calculer', 'Rédiger un paragraphe', 'Identifier les acteurs', 'Représenter une situation',
] as const;

const EVENTS = [
  'Convocation des états généraux', 'Serment du Jeu de paume', 'Prise de la Bastille', 'Nuit du 4 août', 'Fuite du roi à Varennes',
  'Proclamation de la République', 'Exécution du roi', 'Loi des suspects', 'Chute de Robespierre', 'Coup d\'État de Brumaire',
] as const;

interface Template {
  /** Colonnes après celle du numéro. */
  columns: readonly string[];
}

/** Colonnes du tableau des séances, avec leur fréquence (la consigne de l'outil demande « numéro | titre | objectif | activités | durée | évaluation »). */
const TEMPLATES: readonly { value: Template; weight: number }[] = [
  { value: { columns: ['Titre', 'Objectif', 'Activités', 'Durée', 'Évaluation'] }, weight: 30 },
  { value: { columns: ['Titre', 'Objectif', 'Activités', 'Durée', 'Organisation'] }, weight: 8 },
  { value: { columns: ['Titre', 'Objectif', 'Durée'] }, weight: 10 },
  { value: { columns: ['Titre', 'Objectifs', 'Activités'] }, weight: 8 },
  { value: { columns: ['Thème', 'Activités', 'Durée'] }, weight: 5 },
  { value: { columns: ['Titre', 'Objectif'] }, weight: 6 },
  { value: { columns: ['Titre'] }, weight: 3 },
  { value: { columns: ['Description', 'Durée'] }, weight: 4 },
  { value: { columns: ['Intitulé', 'Compétences', 'Évaluation'] }, weight: 3 },
  { value: { columns: ['Étape', 'Contenu', 'Durée'] }, weight: 3 },
  { value: { columns: ['Notion', 'Question', 'Activités'] }, weight: 2 },
  { value: { columns: ['Phase', 'Capacité', 'Support'] }, weight: 2 },
  { value: { columns: ['Objectif', 'Activités', 'Durée'] }, weight: 5 },
  { value: { columns: ['Thématique', 'Support', 'Organisation'] }, weight: 3 },
  { value: { columns: ['Contenu', 'Durée'] }, weight: 3 },
];

const NUMBER_HEADERS: readonly { value: string; weight: number }[] = [
  { value: 'N°', weight: 20 }, { value: 'Séance', weight: 35 }, { value: 'N° de séance', weight: 12 }, { value: 'Numéro', weight: 8 },
  { value: '#', weight: 5 }, { value: 'Séance n°', weight: 5 }, { value: 'N° séance', weight: 5 }, { value: 'Numéro de séance', weight: 10 },
];

type NumberStyle = 'plain' | 'seance' | 's' | 'dot' | 'bold';

function numberCell(style: NumberStyle, k: number): string {
  switch (style) {
    case 'seance': return `Séance ${k}`;
    case 's': return `S${k}`;
    case 'dot': return `${k}.`;
    case 'bold': return `**${k}**`;
    default: return String(k);
  }
}

/** Valeur d'une cellule du vrai tableau selon son en-tête (le premier texte « libre » est le repère du cas). */
function realCell(r: Random, header: string, title: string, k: number): string {
  switch (header) {
    case 'Titre': case 'Thème': case 'Intitulé': case 'Étape': case 'Phase': case 'Notion': case 'Thématique': return title;
    case 'Objectif': case 'Objectifs': case 'Capacité': case 'Compétences': return `${pick(r, OBJECTIVES)} (${k})`;
    case 'Durée': return pick(r, ['55 min', '1 h', '45 min', '50 min']);
    case 'Évaluation': return pick(r, ['—', 'Formative', 'Diagnostique', 'Sommative']);
    case 'Organisation': return pick(r, ['Classe entière', 'Groupes', 'Binômes']);
    default: return `${pick(r, PHRASES)} ${k}`;
  }
}

interface Table {
  lines: string[];
}

function formatTable(r: Random, header: readonly string[], rows: readonly (readonly string[])[], borders: boolean, separated: boolean): Table {
  const join = (cells: readonly string[]) => (borders ? `| ${cells.join(' | ')} |` : cells.join(' | '));
  const lines = [join(header)];
  if (separated) lines.push(join(header.map(() => pick(r, ['---', ':---', '---:', ':---:']))));
  for (const cells of rows) lines.push(join(cells));
  return { lines };
}

interface RealTable {
  lines: string[];
  expected: { numero: number; marker: string }[];
  traits: string[];
  /** Nombre de séances que la demande annonce. */
  intended: number;
}

/** Le vrai tableau des séances : en-têtes, numérotation et défauts tirés au sort. */
function buildReal(r: Random): RealTable {
  const traits: string[] = [];
  const intended = weighted(r, [
    { value: 3, weight: 10 }, { value: 4, weight: 18 }, { value: 5, weight: 18 }, { value: 6, weight: 24 }, { value: 7, weight: 8 },
    { value: 8, weight: 10 }, { value: 10, weight: 8 }, { value: 12, weight: 4 },
  ]);
  const template = weighted(r, TEMPLATES);
  const numberHeader = weighted(r, NUMBER_HEADERS);
  const style: NumberStyle = numberHeader === 'Séance' && chance(r, 0.25) ? 'seance' : weighted<NumberStyle>(r, [
    { value: 'plain', weight: 70 }, { value: 's', weight: 6 }, { value: 'dot', weight: 8 }, { value: 'bold', weight: 6 }, { value: 'seance', weight: 10 },
  ]);
  const titles = shuffled(r, TITLES).slice(0, intended);
  const header = [numberHeader, ...template.columns];

  // Défaut du tableau : trou, début à 2, ou rien.
  const defect = weighted<'none' | 'gap' | 'start2' | 'split'>(r, [
    { value: 'none', weight: 70 }, { value: 'gap', weight: 10 }, { value: 'start2', weight: 6 }, { value: 'split', weight: 14 },
  ]);
  let numbers = Array.from({ length: intended }, (_, i) => i + 1);
  if (defect === 'gap' && intended >= 4) {
    const hole = between(r, 2, intended - 1);
    numbers = numbers.filter(n => n !== hole);
  }
  if (defect === 'start2') numbers = numbers.slice(1);
  // Le modèle se trompe parfois de nombre : une séance de moins (trou en fin) ou de plus.
  const count = weighted<'exact' | 'fewer' | 'more'>(r, [{ value: 'exact', weight: 80 }, { value: 'fewer', weight: 12 }, { value: 'more', weight: 8 }]);
  if (count === 'fewer' && numbers.length >= 3 && defect === 'none') numbers = numbers.slice(0, -1);
  if (count === 'more' && defect === 'none') numbers = [...numbers, intended + 1];
  const rowsOf = (list: readonly number[]) => list.map(k => {
    const title = titles[k - 1] ?? `${pick(r, TITLES)} ${k}`;
    const cells = [numberCell(style, k), ...template.columns.map(column => realCell(r, column, title, k))];
    return cells;
  });
  const expected = numbers.map(k => {
    const row = rowsOf([k])[0];
    return { numero: k, row };
  });
  const borders = chance(r, 0.9);
  const separated = !borders ? true : chance(r, 0.95);
  const lines: string[] = [];
  // Premier texte libre de chaque ligne : le repère de la séance (même texte que dans la cellule).
  const markerOf = (cells: readonly string[]) => cells.slice(1).find(cell => /[a-zé]{3}/i.test(cell) && !/^(?:\d+ ?(?:min|h)|—)$/.test(cell)) ?? cells[0];
  if (defect === 'split' && numbers.length >= 4) {
    const cut = between(r, 2, numbers.length - 2);
    lines.push(...formatTable(r, header, expected.slice(0, cut).map(e => e.row), borders, separated).lines);
    lines.push('', pick(r, ['**Suite du tableau**', 'Suite :', '### Séances suivantes', '(suite)']), '');
    lines.push(...formatTable(r, header, expected.slice(cut).map(e => e.row), borders, separated).lines);
    traits.push('défaut:tableau-coupé');
  } else {
    lines.push(...formatTable(r, header, expected.map(e => e.row), borders, separated).lines);
    traits.push(`défaut:${defect === 'split' ? 'aucun' : defect}`);
    if (count !== 'exact' && defect === 'none') traits.push(`nombre-écrit:${count === 'fewer' ? 'moins' : 'plus'}`);
  }
  return { lines, expected: expected.map(e => ({ numero: e.numero, marker: markerOf(e.row) })), traits, intended };
}

type LureKind = 'objectifs' | 'chronologie' | 'competences' | 'questions' | 'matrice' | 'evaluation' | 'evaluation-seance' | 'periodes' | 'objectifs-riche';

/** Un tableau leurre : numéroté ou non, que la lecture ne doit pas préférer au tableau des séances. */
function buildLure(r: Random, kind: LureKind, intended: number): string[] {
  const m = chance(r, 0.3) ? intended : between(r, 1, 9);
  const number = pick(r, ['N°', 'N°', '#', 'Numéro', 'N° objectif']);
  const rows = (n: number, cell: (k: number) => string[]) => Array.from({ length: n }, (_, k) => cell(k + 1));
  const bordered = chance(r, 0.9);
  switch (kind) {
    case 'objectifs':
      return formatTable(r, [number, pick(r, ['Objectif', 'Objectifs visés', 'Compétence visée'])], rows(m, k => [String(k), `${OBJECTIVES[(k - 1) % OBJECTIVES.length]} (L${k})`]), bordered, true).lines;
    case 'objectifs-riche':
      return formatTable(r, [number, 'Objectif', pick(r, ['Évaluation', 'Compétence', 'Durée'])], rows(m, k => [String(k), `${OBJECTIVES[(k + 2) % OBJECTIVES.length]} (L${k})`, pick(r, ['Quiz', 'Oral', '10 min'])]), bordered, true).lines;
    case 'chronologie':
      return formatTable(r, [number, 'Événement', 'Date'], rows(Math.max(3, m), k => [String(k), EVENTS[(k - 1) % EVENTS.length], String(1788 + k)]), bordered, true).lines;
    case 'competences':
      return formatTable(r, [number, 'Compétence', 'Niveau de maîtrise'], rows(Math.max(3, Math.min(m, 6)), k => [String(k), `Compétence ${k} du socle`, pick(r, ['Début', 'Acquis', 'À renforcer'])]), bordered, true).lines;
    case 'questions':
      return formatTable(r, [number, 'Question', 'Réponse attendue'], rows(Math.max(4, m), k => [String(k), `Question de repérage ${k} ?`, `Réponse ${k}`]), bordered, true).lines;
    case 'matrice':
      return formatTable(r, ['Compétence', pick(r, ['Séances concernées', 'Séances associées', 'Séances liées'])], [
        ['Lire', '1, 3, 5'], ['Écrire', '2 et 4'], ['Compter', '1-2 ; 3-4'], ['Calculer', String(intended)],
      ], bordered, true).lines;
    case 'evaluation':
      return formatTable(r, ['Évaluation', 'Séance', 'Durée'], [
        ['Diagnostique', '1', '20 min'], ['Formative', String(Math.max(2, Math.floor(intended / 2))), '10 min'], ['Sommative', String(intended), '55 min'],
      ], bordered, true).lines;
    case 'evaluation-seance':
      return formatTable(r, ['Séance', 'Évaluation'], [['1', 'Diagnostique'], [String(Math.max(2, intended)), 'Sommative']], bordered, true).lines;
    default:
      return formatTable(r, ['Période', 'Séances'], [['Période 1', `1 à ${Math.max(2, Math.floor(intended / 2))}`], ['Période 2', `${Math.floor(intended / 2) + 1} à ${intended}`]], bordered, true).lines;
  }
}

const LURE_KINDS: readonly { value: LureKind; weight: number }[] = [
  { value: 'objectifs', weight: 30 }, { value: 'objectifs-riche', weight: 8 }, { value: 'chronologie', weight: 10 }, { value: 'competences', weight: 10 },
  { value: 'questions', weight: 8 }, { value: 'matrice', weight: 10 }, { value: 'evaluation', weight: 10 }, { value: 'evaluation-seance', weight: 8 },
  { value: 'periodes', weight: 6 },
];

const PROSE_BEFORE = [
  '# Séquence — Plan', '', '**Niveau :** 4ème', '', '## Problématique', '', 'Comment une société change-t-elle en profondeur ?', '',
];
const PROSE_AFTER = ['', '## Évaluation sommative prévue', '', 'Un devoir en classe de 55 minutes.', '', '## Prolongements', '', 'Visite d\'un musée.'];

/** Plans du corpus : `count` cas déterministes pour la graine donnée. */
export function buildCorpus(count: number, seed = 20_261_003): CorpusCase[] {
  const r = seededRandom(seed);
  const cases: CorpusCase[] = [];
  for (let i = 0; i < count; i++) {
    const real = buildReal(r);
    const traits = [...real.traits];
    const lureCount = weighted(r, [{ value: 0, weight: 22 }, { value: 1, weight: 45 }, { value: 2, weight: 25 }, { value: 3, weight: 8 }]);
    const before: string[][] = [];
    const after: string[][] = [];
    for (let k = 0; k < lureCount; k++) {
      const kind = weighted(r, LURE_KINDS);
      traits.push(`leurre:${kind}`);
      (chance(r, 0.62) ? before : after).push(buildLure(r, kind, real.intended));
    }
    if (lureCount === 0) traits.push('leurre:aucun');
    const requestedKnown = chance(r, 0.65);
    const requested = requestedKnown
      ? chance(r, 0.85) ? real.intended : Math.max(1, real.intended + pick(r, [-2, -1, 1, 2]))
      : undefined;
    traits.push(requested === undefined ? 'demandé:inconnu' : requested === real.intended ? 'demandé:exact' : 'demandé:autre');
    const parts: string[] = [];
    if (chance(r, 0.7)) parts.push(...PROSE_BEFORE);
    for (const table of before) parts.push(...table, '', pick(r, ['## Évaluation diagnostique', '## Tableau synoptique', '', 'Voici le détail :']), '');
    if (before.length === 0 && chance(r, 0.6)) parts.push('## Tableau synoptique', '');
    parts.push(...real.lines);
    for (const table of after) parts.push('', pick(r, ['## Compléments', 'Pour mémoire :', '## Évaluation prévue']), '', ...table);
    if (chance(r, 0.7)) parts.push(...PROSE_AFTER);
    let markdown = parts.join('\n');
    if (chance(r, 0.04)) markdown = `\`\`\`markdown\n${markdown}\n\`\`\``;
    if (chance(r, 0.04)) markdown = markdown.replace(/\n/g, '\r\n');
    cases.push({ markdown, ...(requested !== undefined ? { requested } : {}), expected: real.expected, traits });
  }
  return cases;
}

/** Résultat d'une lecture (numéro, ligne en clair) comparé à ce que le cas attend : vrai si c'est le bon tableau, ligne par ligne. */
export function isRightTable(read: readonly { numero: number; ligne: string }[], expected: CorpusCase['expected']): boolean {
  if (read.length !== expected.length) return false;
  return read.every((session, i) => session.numero === expected[i].numero && session.ligne.includes(expected[i].marker));
}
