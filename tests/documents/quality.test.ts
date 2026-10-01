// Qualité de l'analyse des documents : chaque amélioration est vérifiée sur un exemple français réaliste, avec
// le résultat d'AVANT (ancien comportement, rappelé en commentaire ou recalculé) et celui d'APRÈS.

import { describe, expect, it } from 'vitest';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDocument, extractPdf, pdfItemsToText, stripRunningLines, type PdfJsLike } from '@shared/documents/extract';
import { chunkDocument, mergeAdjacent, rankChunks, selectPassages, MAX_MERGED_PASSAGE_CHARS } from '@shared/documents/retrieve';
import { QUERY_STOPWORDS, stem, tokenize } from '@shared/documents/text';
import type { ExtractedDocument } from '@shared/documents/types';
import { formatLocator } from '@shared/citations';
import { REQUEST_LIMITS } from '@shared/validation';
import {
  docxParagraph, HISTOIRE_COURSE_PAGES, makeDocxFromBody, makePdf, makePdfRuns, makePptxFromSlides, slideTextXml, slideWithTableXml, SVT_COURSE_PAGES,
} from './fixtures';

const pdfjs = pdfjsLegacy as unknown as PdfJsLike;

function pagedDoc(id: string, name: string, pages: string[], kind: 'pdf' | 'pptx' = 'pdf'): ExtractedDocument {
  const type = kind === 'pdf' ? 'pages' : 'slides';
  return {
    id,
    name,
    kind,
    units: pages.map((text, i) => ({ locator: { type, start: i + 1, end: i + 1 }, text })),
    stats: { chars: pages.reduce((n, p) => n + p.length, 0) },
    warnings: [],
  };
}

const spanOf = (p: { locator: { start: number; end: number } }) => p.locator.end - p.locator.start + 1;

// ─── 33 : exposants et indices PDF ──────────────────────────────────────────────

describe('PDF : exposants et indices (constat 33)', () => {
  it('PDF réel : « CO2 », « mc2 », « 3.108 m.s-1 » restent dans leur ligne, les vraies lignes restent séparées', async () => {
    const bytes = makePdfRuns([[
      [{ text: 'Le CO' }, { text: '2', size: 8, raise: -3 }, { text: ' est un gaz à effet de serre.' }],
      [{ text: 'Équation : E = mc' }, { text: '2', size: 8, raise: 4 }, { text: ' et v = 3.10' }, { text: '8', size: 8, raise: 4 }, { text: ' m.s' }, { text: '-1', size: 8, raise: 4 }],
      [{ text: 'Troisième ligne, normale.' }],
    ]]);
    const doc = await extractPdf({ id: 'p', name: 'physique.pdf', bytes }, pdfjs);
    // AVANT : « Le CO\n2 est un gaz à effet de serre.\nÉquation : E = mc\n2 et v = 3.10\n8 m.s\n-1\nTroisième ligne, normale. »
    expect(doc.units[0].text).toBe('Le CO2 est un gaz à effet de serre.\nÉquation : E = mc2 et v = 3.108 m.s-1\nTroisième ligne, normale.');
  });

  const item = (str: string, x: number, y: number, size: number, width: number) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size });

  it('de vraies lignes consécutives ne sont jamais fusionnées, même de tailles différentes ou à interligne serré', () => {
    // Interligne normal (14 pt pour 12 pt).
    expect(pdfItemsToText([item('Première ligne', 60, 700, 12, 80), item('Deuxième ligne', 60, 686, 12, 80)])).toBe('Première ligne\nDeuxième ligne');
    // Titre 20 pt puis sous-titre 10 pt très serré (11,5 pt) : la ligne suivante revient à gauche.
    expect(pdfItemsToText([item('Les fractions', 60, 700, 20, 120), item('Rappels de cours', 60, 688.5, 10, 80)])).toBe('Les fractions\nRappels de cours');
    // Note de bas de page en petit corps juste sous le texte.
    expect(pdfItemsToText([item('Texte du cours.', 60, 100, 12, 90), item('1 Source : manuel.', 60, 90, 8, 80)])).toBe('Texte du cours.\n1 Source : manuel.');
  });

  it('mots d’une même ligne : espace conservé pour un écart normal, collé seulement pour un exposant', () => {
    expect(pdfItemsToText([item('Les', 60, 700, 12, 20), item('élèves', 84, 700, 12, 36)])).toBe('Les élèves');
    expect(pdfItemsToText([item('x', 60, 700, 12, 7), item('2', 67, 704, 8, 5), item('+1', 72.5, 700, 12, 15)])).toBe('x2+1');
  });
});

// ─── 39 : en-têtes, pieds de page, scans ───────────────────────────────────────

describe('PDF : en-têtes et pieds de page répétés, PDF scanné (constat 39)', () => {
  const HEADER = 'Lycée Jean Moulin - SVT Seconde - Chapitre 3 : la photosynthèse';
  const footer = (n: number) => `Année 2025-2026 - Mme Durand - Page ${n}/6`;
  const body = (n: number) => [`Partie ${n} : le cours continue avec un contenu propre à la page ${n}.`, 'Les plantes vertes fabriquent leur matière grâce à la lumière.'];
  const six = (n: number) => [HEADER, ...body(n), footer(n)];

  it('retire l’en-tête et le pied de page des pages 2 à 6, garde la première occurrence et tout le contenu', async () => {
    const bytes = makePdf([1, 2, 3, 4, 5, 6].map(six));
    const doc = await extractDocument({ id: 'p', name: 'cours.pdf', bytes }, { pdfjs });
    const texts = doc.units.map(u => u.text);
    // AVANT : les 6 pages portaient « Lycée Jean Moulin - … » et « Année 2025-2026 - Mme Durand - Page n/6 ».
    expect(texts[0]).toBe([HEADER, ...body(1), footer(1)].join('\n'));
    for (let n = 2; n <= 6; n++) {
      expect(texts[n - 1], `page ${n}`).toBe(body(n).join('\n'));
    }
    expect(texts.filter(t => t.includes('Lycée Jean Moulin'))).toHaveLength(1);
    expect(texts.filter(t => t.includes('Mme Durand'))).toHaveLength(1);
    expect(doc.warnings).toEqual([]);
  });

  it('ne touche jamais au contenu : « Exercice n », en-tête de tableau, peu de pages, répétition minoritaire', () => {
    const pages = (first: (n: number) => string, count = 6) => Array.from({ length: count }, (_, n) => `${first(n + 1)}\nTexte numéro ${n + 1} sur les fractions et les décimaux.`);
    // Chaque page commence par « Exercice n » (chiffres différents) : contenu, pas un en-tête.
    const exercices = pages(n => `Exercice ${n} - Calculer des fractions`);
    expect(stripRunningLines(exercices)).toEqual(exercices);
    // En-tête de tableau répété, sans séparateur ni numéro de page : conservé.
    const tableau = pages(() => 'Élément Rôle principal Dose');
    expect(stripRunningLines(tableau)).toEqual(tableau);
    // Moins de 4 pages : jamais touché.
    const courte = pages(() => HEADER, 3);
    expect(stripRunningLines(courte)).toEqual(courte);
    // Répété sur 3 pages de 6 seulement (moins de 60 %).
    const minoritaire = pages(n => (n <= 3 ? HEADER : `Sujet de la partie ${n} - exercices`));
    expect(stripRunningLines(minoritaire)).toEqual(minoritaire);
    // Une page réduite à l'en-tête n'est pas vidée.
    const seule = [...pages(() => HEADER, 5), HEADER];
    expect(stripRunningLines(seule)[5]).toBe(HEADER);
  });

  it('couche de texte réduite à des numéros de page : refusée comme un scan (DOCUMENT_SCANNED)', async () => {
    // AVANT : acceptée (3 caractères, aucun avertissement) : l'enseignant croyait son cours analysé.
    await expect(extractDocument({ id: 's', name: 'scan.pdf', bytes: makePdf([['1'], ['2'], ['3']]) }, { pdfjs })).rejects.toMatchObject({ code: 'DOCUMENT_SCANNED' });
  });

  it('filigrane « Scanned by CamScanner » + numéro : accepté mais signalé', async () => {
    const pages = [1, 2, 3, 4].map(n => [`Scanned by CamScanner`, String(n)]);
    const doc = await extractDocument({ id: 's', name: 'scan.pdf', bytes: makePdf(pages) }, { pdfjs });
    expect(doc.warnings).toEqual([expect.stringContaining('très peu de texte sélectionnable')]);
  });

  it('un cours dense et une fiche d’exercices de deux pages ne déclenchent aucun avertissement', async () => {
    const dense = await extractDocument({ id: 'd', name: 'cours.pdf', bytes: makePdf([1, 2, 3, 4].map(n => [`Partie ${n} : la photosynthèse transforme l’énergie lumineuse en énergie chimique.`, 'La chlorophylle absorbe la lumière rouge et bleue, et réfléchit la lumière verte.', 'Le glucose produit est transformé en amidon puis stocké dans les organes de réserve.'])) }, { pdfjs });
    expect(dense.warnings).toEqual([]);
    const fiche = await extractDocument({ id: 'f', name: 'fiche.pdf', bytes: makePdf([['Exercice 1 : calculer 3/4 + 1/8.'], ['Exercice 2 : simplifier 12/18.']]) }, { pdfjs });
    expect(fiche.warnings).toEqual([]);
  });
});

// ─── 38 : DOCX avec le seul style « Titre » ────────────────────────────────────

describe('DOCX avec le seul style « Titre » (constat 38)', () => {
  const sub = (t: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
  const para = (t: string) => docxParagraph(t);
  const intertitres = ['Les causes', 'Les grandes batailles', 'La vie dans les tranchées', 'L’arrière', 'Les civils', 'La fin de la guerre', 'Les conséquences'];

  it('Titre + intertitres en gras manuel : blocs de paragraphes, plus une section unique citée par le titre du fichier', async () => {
    const body = [docxParagraph('La Première Guerre mondiale', 'Title'), ...intertitres.flatMap(t => [sub(t), para(`${t} : un paragraphe de cours bien détaillé.`)])].join('');
    const doc = await extractDocument({ id: 'd', name: 'guerre.docx', bytes: await makeDocxFromBody(body) });
    // AVANT : 1 seule unité « section « La Première Guerre mondiale » » contenant tout le cours.
    expect(doc.stats.sections).toBeUndefined();
    expect(doc.units.map(u => u.locator.type)).toEqual(['paragraphs', 'paragraphs']);
    expect(doc.units.map(u => formatLocator(u.locator))).toEqual(['paragraphes 1 à 8', 'paragraphes 9 à 15']);
    expect(doc.units.map(u => u.text).join('\n\n')).toContain('Les conséquences : un paragraphe de cours bien détaillé.');
  });

  it('Titre + au moins un vrai titre de section : sections conservées', async () => {
    const body = [docxParagraph('Cours de géométrie', 'Title'), docxParagraph('Thalès', 'Heading1'), para('Rapports de longueurs.'), docxParagraph('Pythagore', 'Heading1'), para('Triangle rectangle.')].join('');
    const doc = await extractDocument({ id: 'd', name: 'geo.docx', bytes: await makeDocxFromBody(body) });
    expect(doc.units.map(u => u.locator.type)).toEqual(['section', 'section', 'section']);
    expect(doc.stats.sections).toBe(3);
  });

  it('un seul titre « Titre1 » (sans autre) : blocs de paragraphes', async () => {
    const doc = await extractDocument({ id: 'd', name: 'fiche.docx', bytes: await makeDocxFromBody([docxParagraph('Fiche', 'Titre1'), para('Texte un.'), para('Texte deux.')].join('')) });
    expect(doc.units.map(u => u.locator)).toEqual([{ type: 'paragraphs', start: 1, end: 3 }]);
  });
});

// ─── 40 : lignes de tableau PPTX ───────────────────────────────────────────────

describe('PPTX : tableaux (constat 40)', () => {
  it('chaque ligne de tableau redevient une ligne « cellule | cellule | cellule »', async () => {
    const rows = [['Fraction', 'Décimal', 'Pourcentage'], ['1/2', '0,5', '50 %'], ['1/4', '0,25', '25 %']];
    const bytes = await makePptxFromSlides([slideWithTableXml('Fractions, décimaux et pourcentages', rows, 'Un quart, c’est 25 %.'), slideTextXml(['Conclusion', 'Retenir les équivalences'])]);
    const doc = await extractDocument({ id: 'p', name: 'fractions.pptx', bytes });
    // AVANT : « Fractions, décimaux et pourcentages\nFraction\nDécimal\nPourcentage\n1/2\n0,5\n50 %\n1/4\n0,25\n25 %\nUn quart, c’est 25 %. »
    expect(doc.units[0].text).toBe('Fractions, décimaux et pourcentages\nFraction | Décimal | Pourcentage\n1/2 | 0,5 | 50 %\n1/4 | 0,25 | 25 %\nUn quart, c’est 25 %.');
    // Les diapositives sans tableau gardent exactement leur sortie.
    expect(doc.units[1].text).toBe('Conclusion\nRetenir les équivalences');
  });

  it('cellules vides ou fusionnées : colonnes alignées ; ligne entièrement vide ignorée', async () => {
    const rows = [['Élément', '', 'Dose'], ['', '', ''], ['Azote', 'croissance lente', '200']];
    const bytes = await makePptxFromSlides([slideWithTableXml('Carences', rows)]);
    const doc = await extractDocument({ id: 'p', name: 'carences.pptx', bytes });
    expect(doc.units[0].text).toBe('Carences\nÉlément | | Dose\nAzote | croissance lente | 200');
  });
});

// ─── 37 : racinisation -aux → -al ───────────────────────────────────────────────

describe('racinisation : pluriels en -aux (constat 37)', () => {
  it('animaux / animal, journaux / journal, chevaux / cheval, mondiaux / mondial se rapprochent', () => {
    // AVANT : stem('animaux') = 'anim' ≠ stem('animal') = 'animal'.
    for (const [pluriel, singulier] of [['animaux', 'animal'], ['journaux', 'journal'], ['chevaux', 'cheval'], ['mondiaux', 'mondial'], ['hôpitaux', 'hôpital']]) {
      const norm = (w: string) => tokenize(w)[0];
      expect(norm(pluriel), pluriel).toBe(norm(singulier));
    }
  });

  it('mots courts et autres terminaisons inchangés', () => {
    // Mots de 5 lettres ou moins : règle -aux non appliquée (« beaux » garde son ancienne racine « beau »).
    for (const w of ['faux', 'eaux', 'taux', 'maux']) expect(stem(w)).toBe(w);
    expect(stem('beaux')).toBe('beau');
    expect(stem('gouvernances')).toBe(stem('gouvernance'));
    expect(stem('cellules')).toBe('cellul');
    expect(tokenize('Les élèves étudient la photosynthèse chez les végétaux')).toEqual(['elev', 'etudient', 'photosynthes', 'vegetal']);
  });

  it('un cours qui écrit « animal » est retrouvé par le sujet « Les animaux de la ferme » avec un budget serré', () => {
    const filler = 'Le calendrier de la ferme suit les saisons : labours, semis et récoltes rythment le travail des agriculteurs du village. ';
    const pages = [filler.repeat(8), `Chaque animal de la basse-cour a son rôle : la poule pond, l’animal de trait tire la charrue. ${'Le vétérinaire visite régulièrement l’animal malade. '.repeat(10)}`, filler.repeat(8)];
    const doc = pagedDoc('ferme', 'Ferme.pdf', pages);
    const budget = pages[1].length + 10;
    const [passage] = selectPassages([doc], 'Les animaux de la ferme', { budgetChars: budget });
    expect(passage.locator).toMatchObject({ start: 2, end: 2 });
    // AVANT : « animaux » → « anim » ne rejoignait pas « animal » : le passage 2 n'était pas favorisé.
    const before = rankChunks(chunkDocument(doc), 'ferme').sort((a, b) => b.score - a.score);
    expect(before[0].locator.start).not.toBe(2);
  });
});

// ─── 34 : granularité des citations ────────────────────────────────────────────

describe('citations : passages de taille raisonnable (constat 34)', () => {
  const course = pagedDoc('svt', 'cours_svt.pdf', SVT_COURSE_PAGES);
  const total = SVT_COURSE_PAGES.reduce((n, p) => n + p.length, 0);

  it('un cours de 6 pages (≈ 6,9 ko) qui tient dans le budget : passages de 2 pages au plus, texte complet', () => {
    // Pages de ≈ 1 150 caractères, comme un polycopié courant.
    const pages = SVT_COURSE_PAGES.map(p => `${p} ${p.slice(0, 300)}`);
    expect(pages.reduce((n, p) => n + p.length, 0)).toBeGreaterThan(6_500);
    const passages = selectPassages([pagedDoc('svt', 'cours_svt.pdf', pages)], 'photosynthèse', { budgetChars: 12_026 });
    // AVANT : un seul passage « pages 1 à 6 » (plus de 6 500 caractères) : toutes les citations renvoyaient à [S1].
    expect(passages.map(p => formatLocator(p.locator))).toEqual(['pages 1 à 2', 'pages 3 à 4', 'pages 5 à 6']);
    expect(passages.every(p => p.text.length <= MAX_MERGED_PASSAGE_CHARS)).toBe(true);
    // Rien n'est perdu : tout le texte est transmis, dans l'ordre.
    expect(passages.map(p => p.text).join('\n\n')).toBe(pages.join('\n\n'));
  });

  it('le cours de 5 ko du jeu d’essai : deux passages de 3 pages, jamais « pages 1 à 6 »', () => {
    const passages = selectPassages([course], 'photosynthèse', { budgetChars: 12_026 });
    expect(passages.map(p => formatLocator(p.locator))).toEqual(['pages 1 à 3', 'pages 4 à 6']);
    expect(passages.map(p => p.text).join('\n\n')).toBe(SVT_COURSE_PAGES.join('\n\n'));
    expect(total).toBeLessThan(6_000);
  });

  it('diaporama de 48 diapositives : pas de « diapositives 1 à 45 », et jamais plus d’extraits que le serveur n’en accepte', () => {
    const slides = Array.from({ length: 48 }, (_, i) => `Diapositive ${i + 1} : ${'Les fractions égales représentent la même quantité. '.repeat(4)}`);
    const deck = pagedDoc('deck', 'diaporama_maths.pptx', slides, 'pptx');
    for (const budget of [3_000, 12_000, 40_000, 120_000]) {
      const passages = selectPassages([deck], 'fractions égales', { budgetChars: budget });
      expect(passages.length, `budget ${budget}`).toBeLessThanOrEqual(REQUEST_LIMITS.maxPassages);
      expect(passages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(budget);
    }
    const all = selectPassages([deck], 'fractions', { budgetChars: 120_000 });
    expect(Math.max(...all.map(spanOf))).toBeLessThanOrEqual(15);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('si le découpage fin dépassait le nombre d’extraits accepté, retour à des passages plus larges (rien n’est écarté)', () => {
    // 80 pages de ~1 790 caractères : deux pages ne tiennent jamais dans 3 000 caractères.
    const pages = Array.from({ length: 80 }, (_, i) => `Page ${i + 1} : ${'Une phrase de cours sur la démocratie athénienne. '.repeat(34)}`.slice(0, 1_790));
    const doc = pagedDoc('gros', 'manuel.pdf', pages);
    const fine = mergeAdjacent(chunkDocument(doc).slice(0, 70));
    expect(fine.length).toBeGreaterThan(REQUEST_LIMITS.maxPassages);
    const passages = selectPassages([doc], 'démocratie', { budgetChars: 120_000 });
    expect(passages.length).toBeLessThanOrEqual(REQUEST_LIMITS.maxPassages);
    expect(passages.reduce((n, p) => n + p.text.length, 0)).toBeGreaterThan(110_000);
  });

  it('des sections différentes ne sont jamais fusionnées, une même section longue est découpée', async () => {
    const md = `# Partie A\n\n${'Une phrase sur la démocratie. '.repeat(250)}\n\n# Partie B\n\nCourt.\n`;
    const doc = await extractDocument({ id: 'm', name: 'cours.md', bytes: new TextEncoder().encode(md) });
    const passages = selectPassages([doc], 'démocratie', { budgetChars: 100_000 });
    expect(passages.length).toBeGreaterThanOrEqual(3);
    expect(passages.at(-1)!.locator).toMatchObject({ type: 'section', start: 2 });
    expect(passages.filter(p => (p.locator as { start: number }).start === 1).every(p => p.text.length <= MAX_MERGED_PASSAGE_CHARS)).toBe(true);
  });
});

// ─── 41 : requête de sélection ────────────────────────────────────────────────

describe('requête de sélection : mots génériques et poids du sujet (constat 41)', () => {
  const SUJET = 'Les échanges gazeux de la feuille';
  const OBJECTIFS = 'Les élèves doivent comprendre et savoir expliquer le rôle de la lumière dans la séance';
  const CONSIGNES = 'Prévoir une activité en groupe avec un schéma, une trace écrite et des exemples concrets';
  const QUERY = `${SUJET} ${OBJECTIFS} ${CONSIGNES}`;
  const PARTS = [{ text: SUJET, weight: 3 }, { text: OBJECTIFS, weight: 1 }, { text: CONSIGNES, weight: 1 }];
  const course = pagedDoc('svt', 'cours_svt.pdf', SVT_COURSE_PAGES);
  const chunks = chunkDocument(course);
  const ranking = (scored: { locator: { start: number }; score: number }[]) => [...scored].sort((a, b) => b.score - a.score).map(c => c.locator.start);

  it('les mots génériques sont une liste à part : l’indexation des documents ne change pas', () => {
    for (const w of ['élèves', 'savoir', 'expliquer', 'séance', 'activité', 'exercices', 'comprendre', 'objectifs', 'consignes', 'comment', 'pourquoi', 'selon']) {
      expect(QUERY_STOPWORDS.has(tokenize(w)[0]), w).toBe(true);
    }
    for (const w of ['photosynthèse', 'lumière', 'stomates', 'feuille', 'gouvernance']) expect(QUERY_STOPWORDS.has(tokenize(w)[0]), w).toBe(false);
    // « élèves » reste un terme du corpus.
    expect(tokenize('Les élèves doivent savoir expliquer')).toEqual(['eleves', 'doivent', 'savoir', 'expliquer'].map(w => tokenize(w)[0]));
  });

  it('avec la requête complète, la page des échanges gazeux reprend la tête du classement', () => {
    const before = ranking(rankChunks(chunks, QUERY));
    const filtered = ranking(rankChunks(chunks, QUERY, 1.4, 0.75, { dropGenericQueryWords: true }));
    const weighted = ranking(rankChunks(chunks, PARTS, 1.4, 0.75, { dropGenericQueryWords: true }));
    // AVANT : 6, 1, 2, 3… — le bilan (6) et l'introduction (1), pleins de « savoir », « expliquer », « exercice »,
    // « séance », devançaient la page qui traite le sujet.
    expect(before.slice(0, 3)).toEqual([6, 1, 2]);
    expect(filtered.slice(0, 2)).toEqual([1, 2]);
    expect(weighted[0]).toBe(2);
  });

  it('budget d’une seule page : la requête pondérée choisit la page du sujet (en un seul texte : l’introduction)', () => {
    const budget = Math.max(...SVT_COURSE_PAGES.map(p => p.length)) + 10;
    const [old] = selectPassages([course], QUERY, { budgetChars: budget });
    expect(old.locator.start).toBe(1);
    const [now] = selectPassages([course], PARTS, { budgetChars: budget });
    expect(now.locator).toMatchObject({ start: 2, end: 2 });
  });

  it('sans l’option ni poids, le classement est strictement celui d’avant (pipeline, recherche web)', () => {
    const plain = rankChunks(chunks, QUERY).map(c => c.score);
    expect(rankChunks(chunks, QUERY, 1.4, 0.75, {}).map(c => c.score)).toEqual(plain);
    expect(rankChunks(chunks, [{ text: QUERY, weight: 1 }]).map(c => c.score)).toEqual(plain);
    expect(rankChunks(chunks, QUERY, 1.4, 0.75, { dropGenericQueryWords: false }).map(c => c.score)).toEqual(plain);
  });

  it('une requête faite uniquement de mots génériques est gardée telle quelle', () => {
    const only = rankChunks(chunks, 'Les exercices', 1.4, 0.75, { dropGenericQueryWords: true });
    expect(only.map(c => c.score)).toEqual(rankChunks(chunks, 'Les exercices').map(c => c.score));
    expect(Math.max(...only.map(c => c.score))).toBeGreaterThan(0);
  });

  it('deux documents : le meilleur passage de chacun reste garanti', () => {
    const hist = pagedDoc('hist', 'cours_histoire.pdf', HISTOIRE_COURSE_PAGES);
    const passages = selectPassages([course, hist], PARTS, { budgetChars: 2_600 });
    expect(new Set(passages.map(p => p.docId))).toEqual(new Set(['svt', 'hist']));
  });
});
