// Numérotation des listes d'un DOCX : le numéro ou la puce que Word calcule à l'affichage est rendu devant le texte
// (word/numbering.xml, styles de paragraphe de word/styles.xml). Avant : « Mélanger les réactifs » sans le « 2. ».

import { afterEach, describe, expect, it } from 'vitest';
import { extractDocument, parseDocxParagraphs } from '@shared/documents/extract';
import { createNumbering } from '@shared/documents/numbering';
import { DOCUMENT_LIMITS } from '@shared/documents/types';
import { MagistraError } from '@shared/errors';
import { docxParagraph, makeDocxFromBody, makeDocxWithParts } from './fixtures';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const BOUND_MS = 6000;

const lvl = (ilvl: number, format: string, text: string | null, extra = '') =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>${text === null ? '' : `<w:lvlText w:val="${text}"/>`}<w:lvlJc w:val="left"/>${extra}</w:lvl>`;
const abstractNum = (id: number, levels: string[], head = '') => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${head}${levels.join('')}</w:abstractNum>`;
const num = (id: number, abstractId: number, overrides = '') => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/>${overrides}</w:num>`;
const numbering = (...parts: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>${parts.join('')}</w:numbering>`;
const item = (text: string, numId: number | string, ilvl = 0, style?: string) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const body = (...parts: string[]) => `<w:body>${parts.join('')}</w:body>`;
const texts = (xml: string, numberingXml: string, stylesXml?: string) =>
  parseDocxParagraphs(xml, createNumbering(numberingXml, stylesXml)).map(p => p.text);

/** Liste à un niveau par défaut : numéros « 1. », puces, lettres « a) », romains « i. ». */
const BASIC = numbering(
  abstractNum(0, [lvl(0, 'decimal', '%1.')]),
  abstractNum(1, [lvl(0, 'bullet', '')]),
  abstractNum(2, [lvl(0, 'lowerLetter', '%1)')]),
  abstractNum(3, [lvl(0, 'lowerRoman', '%1.')]),
  abstractNum(4, [lvl(0, 'upperLetter', '%1.')]),
  abstractNum(5, [lvl(0, 'upperRoman', '%1.')]),
  num(1, 0), num(2, 1), num(3, 2), num(4, 3), num(5, 4), num(6, 5),
);

describe('DOCX : numérotation des listes', () => {
  it('liste numérotée : « 1. », « 2. », « 3. » devant chaque élément, le texte hors liste est inchangé', async () => {
    const bytes = await makeDocxWithParts(
      [docxParagraph('Protocole expérimental'), item('Peser le sel', 1), item('Verser l’eau', 1), item('Mélanger', 1), docxParagraph('Fin du protocole.')].join(''),
      { 'word/numbering.xml': BASIC },
    );
    const doc = await extractDocument({ id: 'd', name: 'protocole.docx', bytes });
    // AVANT : « Protocole expérimental\n\nPeser le sel\n\nVerser l’eau\n\nMélanger\n\nFin du protocole. »
    expect(doc.units[0].text).toBe('Protocole expérimental\n\n1. Peser le sel\n\n2. Verser l’eau\n\n3. Mélanger\n\nFin du protocole.');
  });

  it('liste à puces : « - » devant chaque élément, quel que soit le caractère de la puce', () => {
    const symbol = numbering(abstractNum(0, [lvl(0, 'bullet', '&#xF0B7;'), lvl(1, 'bullet', 'o'), lvl(2, 'bullet', '§')]), num(1, 0));
    expect(texts(body(item('a', 1), item('b', 1, 1), item('c', 1, 2), item('d', 1)), symbol)).toEqual(['- a', '- b', '- c', '- d']);
  });

  it('numbering.xml tel que Word l’écrit (espaces de noms, nsid, tmpl, niveaux « tentative », puce Symbol)', async () => {
    const wordLevel = (ilvl: number, format: string, text: string, font = '') =>
      `<w:lvl w:ilvl="${ilvl}" w:tplc="040C00${ilvl}F"${ilvl > 0 ? ' w:tentative="1"' : ''}><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + ilvl * 360}" w:hanging="360"/></w:pPr>${font}</w:lvl>`;
    const symbol = '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>';
    const wordNumbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ${W} mc:Ignorable="w14 w15"><w:abstractNum w:abstractNumId="3" w15:restartNumberingAfterBreak="0"><w:nsid w:val="5B8D1C2E"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="E4F0A2C6"/>${wordLevel(0, 'decimal', '%1.')}${wordLevel(1, 'lowerLetter', '%2.')}${wordLevel(2, 'lowerRoman', '%3.')}</w:abstractNum><w:abstractNum w:abstractNumId="4" w15:restartNumberingAfterBreak="0"><w:nsid w:val="7A3B9D10"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="1C2D3E4F"/>${wordLevel(0, 'bullet', '', symbol)}${wordLevel(1, 'bullet', 'o')}</w:abstractNum><w:num w:numId="1" w16cid:durableId="123"><w:abstractNumId w:val="3"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="4"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>`;
    const para = (text: string, numId: number, ilvl: number) =>
      `<w:p w14:paraId="1A2B3C4D" w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6"><w:pPr><w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr><w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:pPr><w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const bytes = await makeDocxWithParts(
      [para('Préparer le matériel', 1, 0), para('une balance', 1, 1), para('des béchers', 1, 1), para('Peser 5 g de sel', 1, 0), para('Penser à', 2, 0), para('mettre les lunettes', 2, 1), para('Noter les résultats', 3, 0)].join(''),
      { 'word/numbering.xml': wordNumbering },
    );
    const doc = await extractDocument({ id: 'd', name: 'tp.docx', bytes });
    expect(doc.units[0].text).toBe('1. Préparer le matériel\n\na. une balance\n\nb. des béchers\n\n2. Peser 5 g de sel\n\n- Penser à\n\n- mettre les lunettes\n\n1. Noter les résultats');
  });

  it('formats : lettres minuscules et majuscules, chiffres romains, avec le motif du niveau', () => {
    const list = (id: number) => body(item('x', id), item('y', id), item('z', id));
    expect(texts(list(3), BASIC)).toEqual(['a) x', 'b) y', 'c) z']);
    expect(texts(list(4), BASIC)).toEqual(['i. x', 'ii. y', 'iii. z']);
    expect(texts(list(5), BASIC)).toEqual(['A. x', 'B. y', 'C. z']);
    expect(texts(list(6), BASIC)).toEqual(['I. x', 'II. y', 'III. z']);
    const many = Array.from({ length: 30 }, (_, i) => item(`n${i + 1}`, 4)).join('');
    const romans = texts(body(many), BASIC);
    expect([romans[3], romans[8], romans[13], romans[18], romans[28]]).toEqual(['iv. n4', 'ix. n9', 'xiv. n14', 'xix. n19', 'xxix. n29']);
    // Après « z », Word répète la lettre : « aa », « bb »…
    const alphabet = texts(body(Array.from({ length: 28 }, (_, i) => item(`n${i + 1}`, 3)).join('')), BASIC);
    expect([alphabet[25], alphabet[26], alphabet[27]]).toEqual(['z) n26', 'aa) n27', 'bb) n28']);
  });

  it('formats inattendus : chiffres, zéro initial, « aucun » sans préfixe, motifs sans numéro', () => {
    const odd = numbering(
      abstractNum(0, [lvl(0, 'ordinalText', '%1.')]),
      abstractNum(1, [lvl(0, 'decimalZero', '%1 -')]),
      abstractNum(2, [lvl(0, 'none', '%1')]),
      abstractNum(3, [lvl(0, 'decimal', 'Exercice %1 :')]),
      abstractNum(4, [lvl(0, 'decimal', null)]),
      abstractNum(5, [lvl(0, 'decimal', '')]),
      ...[1, 2, 3, 4, 5, 6].map((id, i) => num(id, i)),
    );
    expect(texts(body(item('x', 1)), odd)).toEqual(['1. x']);
    expect(texts(body(item('x', 2)), odd)).toEqual(['01 - x']);
    expect(texts(body(item('x', 3)), odd)).toEqual(['x']);
    expect(texts(body(item('x', 4), item('y', 4)), odd)).toEqual(['Exercice 1 : x', 'Exercice 2 : y']);
    // Motif absent : « %n. » du niveau ; motif vide : rien devant le texte.
    expect(texts(body(item('x', 5)), odd)).toEqual(['1. x']);
    expect(texts(body(item('x', 6)), odd)).toEqual(['x']);
  });

  it('listes imbriquées : « 1. », « a) », « i. », les niveaux inférieurs repartent après un niveau supérieur', () => {
    const nested = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'lowerLetter', '%2)'), lvl(2, 'lowerRoman', '%3.')]), num(1, 0));
    const xml = body(
      item('Les causes', 1), item('économiques', 1, 1), item('la dette', 1, 2), item('les impôts', 1, 2), item('politiques', 1, 1),
      item('Les événements', 1), item('la prise de la Bastille', 1, 1), item('la nuit du 4 août', 1, 1), item('abolition', 1, 2),
      item('Bilan', 1),
    );
    expect(texts(xml, nested)).toEqual([
      '1. Les causes', 'a) économiques', 'i. la dette', 'ii. les impôts', 'b) politiques',
      '2. Les événements', 'a) la prise de la Bastille', 'b) la nuit du 4 août', 'i. abolition',
      '3. Bilan',
    ]);
  });

  it('motif multi-niveaux « 1.1 » : le numéro du niveau supérieur est repris', () => {
    const outline = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'decimal', '%1.%2'), lvl(2, 'decimal', '%1.%2.%3')]), num(1, 0));
    const xml = body(item('A', 1), item('A1', 1, 1), item('A1a', 1, 2), item('A1b', 1, 2), item('A2', 1, 1), item('B', 1), item('B1', 1, 1));
    expect(texts(xml, outline)).toEqual(['1. A', '1.1 A1', '1.1.1 A1a', '1.1.2 A1b', '1.2 A2', '2. B', '2.1 B1']);
  });

  it('niveau supérieur jamais vu : sa valeur de départ est utilisée dans le motif', () => {
    const outline = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'decimal', '%1.%2')]), num(1, 0));
    expect(texts(body(item('sous-point', 1, 1), item('autre', 1, 1)), outline)).toEqual(['1.1 sous-point', '1.2 autre']);
  });

  it('une liste interrompue par un paragraphe continue sa numérotation, une autre liste (numId) repart de 1', () => {
    const xml = body(item('a', 1), item('b', 1), docxParagraph('Commentaire.'), item('c', 1), item('autre liste', 7), item('encore', 7));
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0), num(7, 0));
    expect(texts(xml, doc)).toEqual(['1. a', '2. b', 'Commentaire.', '3. c', '1. autre liste', '2. encore']);
  });

  it('redémarrage imposé (startOverride) et valeur de départ du niveau', () => {
    const doc = numbering(
      abstractNum(0, [lvl(0, 'decimal', '%1.').replace('w:start w:val="1"', 'w:start w:val="4"')]),
      num(1, 0),
      num(2, 0, '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride>'),
    );
    expect(texts(body(item('a', 1), item('b', 1)), doc)).toEqual(['4. a', '5. b']);
    expect(texts(body(item('a', 2), item('b', 2)), doc)).toEqual(['10. a', '11. b']);
  });

  it('un élément de liste vide garde son numéro (le suivant n’est pas décalé)', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    const empty = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>';
    expect(texts(body(item('a', 1), empty, item('c', 1)), doc)).toEqual(['1. a', '3. c']);
  });

  it('numId 0, liste inconnue, niveau non défini ou hors bornes : aucun préfixe', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0), '<w:num w:numId="2"><w:abstractNumId w:val="99"/></w:num>');
    expect(texts(body(item('a', 0), item('b', 5), item('c', 2), item('d', 1, 3), item('e', 1, 12), item('f', 1)), doc)).toEqual(['a', 'b', 'c', 'd', 'e', '1. f']);
  });

  it('un paragraphe de tableau n’est pas numéroté et n’avance aucun compteur (« cellule | cellule » inchangé)', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    const cell = (t: string) => `<w:tc>${item(t, 1)}</w:tc>`;
    const xml = body(item('a', 1), `<w:tbl><w:tr>${cell('x')}${cell('y')}</w:tr></w:tbl>`, item('b', 1));
    expect(texts(xml, doc)).toEqual(['1. a', 'x | y', '2. b']);
  });

  it('les anciennes propriétés d’une modification suivie (pPrChange) ne donnent pas de numéro', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    const was = '<w:pPrChange w:id="1"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:pPrChange>';
    const unlisted = `<w:p><w:pPr>${was}</w:pPr><w:r><w:t>plus dans la liste</w:t></w:r></w:p>`;
    const listed = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${was}</w:pPr><w:r><w:t>dans la liste</w:t></w:r></w:p>`;
    expect(texts(body(unlisted, listed), doc)).toEqual(['plus dans la liste', '1. dans la liste']);
  });

  it('un paragraphe imbriqué (zone de texte) ne prête pas sa liste au paragraphe qui le contient', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    const outer = `<w:p><w:r><w:t>Texte</w:t></w:r><w:r><w:pict><w:txbxContent>${item('dans la zone', 1)}</w:txbxContent></w:pict></w:r></w:p>`;
    const out = texts(body(outer), doc);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Texte/);
  });

  it('un niveau hors des neuf niveaux possibles est lu sans numéro', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    expect(texts(body(item('a', 1, 9), item('b', 1)), doc)).toEqual(['a', '1. b']);
  });

  it('les compteurs et les motifs tolèrent des valeurs extrêmes (départ énorme, motif démesuré, niveau 9)', () => {
    const doc = numbering(
      abstractNum(0, [lvl(0, 'lowerLetter', `${'%1'.repeat(5_000)}`).replace('w:start w:val="1"', 'w:start w:val="99999999999"')]),
      abstractNum(1, [lvl(0, 'decimal', '%1.')]),
      num(1, 0), num(2, 1),
    );
    const [first] = texts(body(item('x', 1)), doc);
    expect(first.length).toBeLessThan(400);
    expect(texts(body(item('x', 2, 9)), doc)).toEqual(['x']);
  });
});

describe('DOCX : numérotation héritée d’un style', () => {
  const styles = (...s: string[]) => `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:docDefaults/>${s.join('')}</w:styles>`;
  const style = (id: string, inner: string, type = 'paragraph') => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${id}"/>${inner}</w:style>`;
  const styled = (text: string, styleId: string, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

  const headings = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.', '<w:pStyle w:val="Titre1"/>'), lvl(1, 'decimal', '%1.%2', '<w:pStyle w:val="Titre2"/>')]), num(1, 0));

  it('titres numérotés par leur style (« 1. Introduction », « 1.1 Contexte »), niveau lu dans le style ou dans la liste', () => {
    const s = styles(
      style('Titre1', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'),
      // Pas d'ilvl dans le style : le niveau est celui qui déclare « Titre2 » dans la liste.
      style('Titre2', '<w:basedOn w:val="Titre1"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'),
    );
    const xml = body(styled('Introduction', 'Titre1'), styled('Contexte', 'Titre2'), styled('Enjeux', 'Titre2'), styled('Développement', 'Titre1'), styled('Texte courant.', 'Normal'));
    expect(texts(xml, headings, s)).toEqual(['1. Introduction', '1.1 Contexte', '1.2 Enjeux', '2. Développement', 'Texte courant.']);
  });

  it('un style qui hérite (basedOn) d’un style numéroté en hérite, ilvl du style compris', () => {
    const s = styles(
      style('Liste', '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
      style('ListeBis', '<w:basedOn w:val="Liste"/>'),
      style('ListeTer', '<w:basedOn w:val="ListeBis"/>'),
    );
    expect(texts(body(styled('a', 'ListeTer'), styled('b', 'ListeBis')), headings, s)).toEqual(['1.1 a', '1.2 b']);
  });

  it('numId 0 dans le paragraphe ou dans un style dérivé retire la numérotation héritée', () => {
    const s = styles(
      style('Liste', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'),
      style('SansNumero', '<w:basedOn w:val="Liste"/><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>'),
    );
    const retire = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>';
    expect(texts(body(styled('a', 'Liste'), styled('b', 'SansNumero'), styled('c', 'Liste', retire), styled('d', 'Liste')), headings, s)).toEqual(['1. a', 'b', 'c', '2. d']);
  });

  it('la liste du paragraphe prime sur celle de son style', () => {
    const s = styles(style('Liste', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'));
    const bullets = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), abstractNum(1, [lvl(0, 'bullet', '')]), num(1, 0), num(2, 1));
    expect(texts(body(styled('a', 'Liste'), item('b', 2, 0, 'Liste')), bullets, s)).toEqual(['1. a', '- b']);
  });

  it('styles cycliques, trop profonds ou sans identifiant : ignorés sans boucle', () => {
    const s = styles(
      style('A', '<w:basedOn w:val="B"/>'), style('B', '<w:basedOn w:val="A"/>'),
      '<w:style w:type="paragraph"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      style('Car', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>', 'character'),
    );
    expect(texts(body(styled('a', 'A'), styled('b', 'B'), styled('c', 'Car')), headings, s)).toEqual(['a', 'b', 'c']);
  });

  it('titres numérotés : la section est citée avec son numéro, comme à l’écran', async () => {
    const s = styles(
      style('Heading1', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'),
      style('Heading2', '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
    );
    const bytes = await makeDocxWithParts(
      [styled('Les causes', 'Heading1'), docxParagraph('Texte un.'), styled('La dette', 'Heading2'), docxParagraph('Texte deux.'), styled('Les effets', 'Heading1'), docxParagraph('Texte trois.')].join(''),
      { 'word/numbering.xml': headings, 'word/styles.xml': s },
    );
    const doc = await extractDocument({ id: 'd', name: 'cours.docx', bytes });
    expect(doc.units.map(u => (u.locator as { title?: string }).title)).toEqual(['1. Les causes', '1.1 La dette', '2. Les effets']);
    expect(doc.units[1].text).toBe('1.1 La dette\n\nTexte deux.');
  });

  it('liste définie par un style de liste (numStyleLink) : niveaux repris de la liste qui porte le styleLink', () => {
    const doc = numbering(
      abstractNum(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'lowerLetter', '%2)')], '<w:styleLink w:val="MaListe"/>'),
      abstractNum(1, [], '<w:numStyleLink w:val="MaListe"/>'),
      num(1, 0), num(2, 1),
    );
    expect(texts(body(item('a', 2), item('b', 2, 1), item('c', 2)), doc)).toEqual(['1. a', 'a) b', '2. c']);
  });
});

describe('DOCX : numérotation absente ou invalide (lecture inchangée)', () => {
  const plain = body(docxParagraph('Étape un'), docxParagraph('Étape deux'));
  const listBody = [item('Étape un', 1), item('Étape deux', 1)].join('');
  const asBefore = 'Étape un\n\nÉtape deux';

  async function read(parts: Record<string, string | Uint8Array>): Promise<string> {
    const doc = await extractDocument({ id: 'd', name: 'liste.docx', bytes: await makeDocxWithParts(listBody, parts) });
    return doc.units.map(u => u.text).join('\n\n');
  }

  it('sans numbering.xml, ou avec un fichier vide ou qui n’est pas du XML : texte inchangé', async () => {
    expect(parseDocxParagraphs(plain).map(p => p.text)).toEqual(['Étape un', 'Étape deux']);
    expect(await read({})).toBe(asBefore);
    expect(await read({ 'word/numbering.xml': '' })).toBe(asBefore);
    expect(await read({ 'word/numbering.xml': 'ceci n’est pas du XML <<<' })).toBe(asBefore);
    expect(await read({ 'word/numbering.xml': new Uint8Array([0xff, 0xfe, 0x00, 0x81, 0x80, 0x3c]) })).toBe(asBefore);
  });

  it('numbering.xml tronqué, sans liste ou avec des balises jamais refermées : texte inchangé, aucune erreur', async () => {
    expect(await read({ 'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"` })).toBe(asBefore);
    expect(await read({ 'word/numbering.xml': numbering() })).toBe(asBefore);
    expect(await read({ 'word/numbering.xml': numbering('<w:abstractNum w:abstractNumId="0">'.repeat(1000), '<w:num w:numId="1">'.repeat(1000)) })).toBe(asBefore);
    // Liste déclarée mais jamais définie : aucun préfixe.
    expect(await read({ 'word/numbering.xml': numbering(num(1, 4)) })).toBe(asBefore);
  });

  it('entrée numbering.xml corrompue dans le zip : le document se lit sans numérotation', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('word/document.xml', `<w:document ${W}>${body(listBody)}</w:document>`);
    zip.file('word/numbering.xml', BASIC.repeat(40), { compression: 'DEFLATE' });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    // Les octets compressés de numbering.xml sont écrasés : flux deflate invalide.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const name = new TextEncoder().encode('word/numbering.xml');
    for (let i = 0; i + 30 + name.length < bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x04034b50 || view.getUint16(i + 26, true) !== name.length) continue;
      const start = i + 30 + name.length + view.getUint16(i + 28, true);
      if (!name.every((b, k) => bytes[i + 30 + k] === b)) continue;
      bytes.fill(0xff, start, start + Math.min(16, view.getUint32(i + 18, true)));
    }
    const doc = await extractDocument({ id: 'd', name: 'abime.docx', bytes });
    expect(doc.units[0].text).toBe(asBefore);
  });

  it('styles.xml illisible : les listes portées par le paragraphe restent numérotées', async () => {
    const doc = await extractDocument({
      id: 'd',
      name: 'liste.docx',
      bytes: await makeDocxWithParts(listBody, { 'word/numbering.xml': BASIC, 'word/styles.xml': '<w:styles><w:style w:styleId="X"' }),
    });
    expect(doc.units[0].text).toBe('1. Étape un\n\n2. Étape deux');
  });

  it('un document sans liste garde exactement la même sortie qu’avant, avec ou sans numbering.xml', async () => {
    const bytes = await makeDocxFromBody(plain);
    const withParts = await makeDocxWithParts(plain, { 'word/numbering.xml': BASIC });
    const a = await extractDocument({ id: 'a', name: 'a.docx', bytes });
    const b = await extractDocument({ id: 'b', name: 'b.docx', bytes: withParts });
    expect(b.units).toEqual(a.units);
    expect(b.stats).toEqual(a.stats);
  });
});

describe('DOCX : numérotation, temps et mémoire bornés', () => {
  const saved = { ...DOCUMENT_LIMITS };
  afterEach(() => Object.assign(DOCUMENT_LIMITS, saved));

  it('document de 50 000 éléments de liste sur trois niveaux : analyse rapide, compteurs justes', async () => {
    const nested = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'lowerLetter', '%2)'), lvl(2, 'lowerRoman', '%3.')]), num(1, 0));
    const count = 50_000;
    const xml = body(Array.from({ length: count }, (_, i) => item(`Élément ${i + 1}`, 1, i % 3 === 0 ? 0 : (i % 3))).join(''));
    const t0 = performance.now();
    const out = texts(xml, nested);
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    expect(out).toHaveLength(count);
    expect(out.slice(0, 4)).toEqual(['1. Élément 1', 'a) Élément 2', 'i. Élément 3', '2. Élément 4']);
    expect(out.slice(48_000, 48_003)).toEqual(['16001. Élément 48001', 'a) Élément 48002', 'i. Élément 48003']);
    expect(out[count - 1]).toBe(`a) Élément ${count}`);
  });

  it('numbering.xml énorme (30 000 listes) ou jamais refermé : lu en temps linéaire, au plus maxNumberingEntries définitions', () => {
    const defs = Array.from({ length: 30_000 }, (_, i) => `<w:abstractNum w:abstractNumId="${i}">${lvl(0, 'decimal', '%1.')}</w:abstractNum>`).join('');
    const nums = Array.from({ length: 30_000 }, (_, i) => num(i + 1, i)).join('');
    let t0 = performance.now();
    const list = createNumbering(numbering(defs, nums));
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    expect(list).not.toBeNull();
    // Au-delà de la borne, les listes ne sont plus lues : seul un numId bien en deçà reçoit un numéro.
    expect(list!.prefix(item('x', 5))).toBe('1. ');
    expect(list!.prefix(item('x', DOCUMENT_LIMITS.maxNumberingEntries + 5))).toBe('');
    for (const bad of ['<w:abstractNum w:abstractNumId="1">'.repeat(200_000), '<w:num w:numId="1">'.repeat(200_000), '<w:lvl w:ilvl="0">'.repeat(200_000), `<w:abstractNum w:abstractNumId="0">${'<w:lvl w:ilvl="0"><w:numFmt w:val="'.repeat(100_000)}`]) {
      t0 = performance.now();
      createNumbering(numbering(bad));
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
    }
  });

  it('100 000 paragraphes dont le <w:pPr> n’est jamais refermé : analyse rapide', () => {
    const doc = numbering(abstractNum(0, [lvl(0, 'decimal', '%1.')]), num(1, 0));
    const xml = body('<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:r><w:t>x</w:t></w:r></w:p>'.repeat(50_000), '<w:p><w:pPr><w:pPrChange>'.repeat(50_000));
    const t0 = performance.now();
    parseDocxParagraphs(xml, createNumbering(doc));
    expect(performance.now() - t0).toBeLessThan(BOUND_MS);
  });

  it('un numbering.xml qui se décompresse au-delà de la limite est refusé comme les autres parties', async () => {
    DOCUMENT_LIMITS.maxXmlEntryBytes = 1024 * 1024;
    const bomb = `<w:numbering ${W}>${' '.repeat(4 * 1024 * 1024)}</w:numbering>`;
    const bytes = await makeDocxWithParts(item('x', 1), { 'word/numbering.xml': bomb });
    const err = await extractDocument({ id: 'b', name: 'bombe.docx', bytes }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MagistraError);
    expect((err as MagistraError).code).toBe('DOCUMENT_TOO_LARGE');
  });
});
