// Fichiers de test générés par programme (aucun binaire versionné).

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { loadTestFonts } from '../pdf/helpers';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** PDF dont chaque page contient les lignes indiquées (police DejaVu : accents et symboles). Page vide : []. */
export function makePdf(pages: string[][]): Uint8Array {
  const fonts = loadTestFonts();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let binary = '';
  for (const b of fonts.regular as Uint8Array) binary += String.fromCharCode(b);
  doc.addFileToVFS('DejaVuSans.ttf', binary);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');
  doc.setFontSize(12);
  pages.forEach((lines, index) => {
    if (index > 0) doc.addPage();
    if (lines.length === 0) {
      // Page « scannée » : uniquement un dessin, aucun texte.
      doc.setFillColor(200, 200, 200);
      doc.rect(60, 60, 300, 400, 'F');
      return;
    }
    lines.forEach((line, i) => doc.text(line, 60, 80 + i * 20));
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Ajoute des numéros de page imprimés (/PageLabels) à un PDF produit par jsPDF.
 * `nums` suit la syntaxe PDF, par exemple « 0 << /S /r >> 2 << /S /D >> » : pages i, ii puis 1, 2…
 * Le remplacement garde la même longueur : la table xref reste valide.
 */
export function withPageLabels(pdf: Uint8Array, nums: string): Uint8Array {
  let binary = '';
  for (const b of pdf) binary += String.fromCharCode(b);
  const original = '/OpenAction [3 0 R /FitH null]\n/PageLayout /OneColumn';
  const labels = `/PageLabels << /Nums [${nums}] >>`;
  if (!binary.includes(original) || labels.length > original.length) throw new Error('Catalogue jsPDF inattendu.');
  binary = binary.replace(original, labels.padEnd(original.length, ' '));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** PDF avec la police standard Helvetica non intégrée (cas fréquent des PDF administratifs). */
export function makeStandardFontPdf(lines: string[]): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'normal');
  lines.forEach((line, i) => doc.text(line, 60, 80 + i * 20));
  return new Uint8Array(doc.output('arraybuffer'));
}

function docxParagraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p w:rsidR="00A1">${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

async function zipDocx(bodyXml: string, parts: Record<string, string | Uint8Array> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`);
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
}

/** DOCX avec préambule, titres (Heading1 / Titre1), paragraphes, un tableau et un paragraphe vide auto-fermant. */
export function makeDocxWithHeadings(): Promise<Uint8Array> {
  const table = `<w:tbl><w:tblPr/>${[['Critère', 'Points'], ['x > 3 et a < b', '2'], ['Rédaction', '3']]
    .map(row => `<w:tr>${row.map(cell => `<w:tc><w:tcPr/>${docxParagraph(cell)}</w:tc>`).join('')}</w:tr>`)
    .join('')}</w:tbl>`;
  const body = [
    docxParagraph('Préambule : document de travail.'),
    docxParagraph('Introduction', 'Heading1'),
    '<w:p w:rsidR="00B2"><w:r><w:t xml:space="preserve">Les élèves découvrent </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>la démocratie</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>',
    docxParagraph('Deuxième paragraphe de l’introduction.'),
    docxParagraph('Évaluation', 'Titre1'),
    table,
    '<w:p w:rsidR="00C3" w:rsidRDefault="00C3"/>',
    docxParagraph('Dernier paragraphe : 2025-2026.'),
  ].join('');
  return zipDocx(body);
}

/** DOCX sans aucun titre : paragraphes numérotés. */
export function makeDocxWithoutHeadings(count: number): Promise<Uint8Array> {
  return zipDocx(Array.from({ length: count }, (_, i) => docxParagraph(`Paragraphe numéro ${i + 1} : réflexion sur l’égalité.`)).join(''));
}

function slideXml(texts: string[], ns = 'p:sld'): string {
  const paragraphs = texts.map(t => `<a:p><a:r><a:rPr lang="fr-FR"/><a:t>${escapeXml(t)}</a:t></a:r></a:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${ns} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></${ns}>`;
}

/**
 * PPTX de 3 diapositives. L'ordre de présentation (presentation.xml) diffère de l'ordre des
 * fichiers : diapositive 1 = slide2.xml, 2 = slide1.xml, 3 = slide3.xml. slide1.xml a des notes.
 */
export async function makePptx(): Promise<Uint8Array> {
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="256" r:id="rId12"/><p:sldId id="257" r:id="rId11"/><p:sldId id="258" r:id="rId13"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId11" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId12" Type="${REL}/slide" Target="slides/slide2.xml"/><Relationship Id="rId13" Type="${REL}/slide" Target="slides/slide3.xml"/></Relationships>`);
  zip.file('ppt/slides/slide2.xml', slideXml(['La Révolution française', 'Cours de 4e — 2025-2026']));
  zip.file('ppt/slides/slide1.xml', slideXml(['Les causes', 'Crise financière & inégalités']));
  zip.file('ppt/slides/slide3.xml', slideXml(['Conclusion', 'x > 3 ne s’applique pas ici']));
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/notesSlides/notesSlide1.xml', slideXml(['Penser à distribuer la frise chronologique.', '2'], 'p:notes'));
  return zip.generateAsync({ type: 'uint8array' });
}

/** Encodage Windows-1252 (Latin-1 + quelques signes) pour les tests. */
export function encodeWindows1252(text: string): Uint8Array {
  const special: Record<string, number> = { '€': 0x80, '’': 0x92, 'œ': 0x9c, 'Œ': 0x8c, '…': 0x85, '–': 0x96, '—': 0x97, '«': 0xab, '»': 0xbb };
  return new Uint8Array([...text].map(ch => special[ch] ?? ch.charCodeAt(0)));
}

// ─── Fixtures des correctifs de robustesse et de qualité d'extraction ───────────

/** Un fragment de ligne : texte, corps (pt) et décalage vertical (pt, positif = vers le haut : exposant). */
export interface PdfRun {
  text: string;
  size?: number;
  raise?: number;
}

/** PDF dont les lignes sont composées de fragments de tailles et de hauteurs différentes (exposants, indices). */
export function makePdfRuns(pages: PdfRun[][][]): Uint8Array {
  const fonts = loadTestFonts();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let binary = '';
  for (const b of fonts.regular as Uint8Array) binary += String.fromCharCode(b);
  doc.addFileToVFS('DejaVuSans.ttf', binary);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');
  pages.forEach((lines, index) => {
    if (index > 0) doc.addPage();
    lines.forEach((runs, i) => {
      let x = 60;
      for (const run of runs) {
        const size = run.size ?? 12;
        doc.setFontSize(size);
        doc.text(run.text, x, 80 + i * 20 - (run.raise ?? 0));
        x += doc.getTextWidth(run.text);
      }
    });
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Texte posé à une position précise de la page (pt, origine en haut à gauche), dans l'ordre d'écriture du flux du PDF. */
export interface PdfPlaced {
  text: string;
  x: number;
  y: number;
  size?: number;
}

/** Document jsPDF A4 (points) avec la police DejaVu des fixtures. */
function newTestPdf(): jsPDF {
  const fonts = loadTestFonts();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let binary = '';
  for (const b of fonts.regular as Uint8Array) binary += String.fromCharCode(b);
  doc.addFileToVFS('DejaVuSans.ttf', binary);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');
  return doc;
}

/** Découpe un texte en lignes qui tiennent dans `widthPt` points (police et corps de ces fixtures), comme une mise en page. */
export function wrapToWidth(text: string, widthPt: number, size = 10): string[] {
  const doc = newTestPdf();
  doc.setFontSize(size);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && doc.getTextWidth(candidate) > widthPt) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/** PDF dont les textes sont posés aux positions données : mises en page sur colonnes, tableaux, tables des matières. */
export function makePdfPlaced(pages: PdfPlaced[][]): Uint8Array {
  const doc = newTestPdf();
  pages.forEach((texts, index) => {
    if (index > 0) doc.addPage();
    for (const t of texts) {
      doc.setFontSize(t.size ?? 10);
      doc.text(t.text, t.x, t.y);
    }
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

/** DOCX construit à partir de paragraphes déjà en XML. */
export function makeDocxFromBody(bodyXml: string): Promise<Uint8Array> {
  return zipDocx(bodyXml);
}

/** DOCX avec des parties supplémentaires (« word/numbering.xml », « word/styles.xml »…), en XML ou en octets. */
export function makeDocxWithParts(bodyXml: string, parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  return zipDocx(bodyXml, parts);
}

export { docxParagraph };

/** Cellule de tableau PowerPoint (un paragraphe) ; une cellule vide garde son paragraphe vide, comme PowerPoint. */
function pptxCell(text: string): string {
  const body = text ? `<a:p><a:r><a:rPr lang="fr-FR"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="fr-FR"/></a:p>';
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${body}</a:txBody><a:tcPr/></a:tc>`;
}

/** Diapositive : un titre, puis un tableau, puis éventuellement une phrase. */
export function slideWithTableXml(title: string, rows: string[][], after?: string): string {
  const table = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid/>${rows
    .map(row => `<a:tr h="370840">${row.map(c => pptxCell(c)).join('')}</a:tr>`)
    .join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const para = (t: string) => `<a:p><a:r><a:rPr lang="fr-FR"/><a:t>${escapeXml(t)}</a:t></a:r></a:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${para(title)}</p:txBody></p:sp>${table}${after ? `<p:sp><p:txBody><a:bodyPr/>${para(after)}</p:txBody></p:sp>` : ''}</p:spTree></p:cSld></p:sld>`;
}

/** Diapositive de texte simple (un paragraphe par ligne). */
export function slideTextXml(texts: string[]): string {
  return slideXml(texts);
}

/**
 * PPTX à partir de diapositives en XML. `order` donne, dans l'ordre de présentation, les numéros (à partir de 1) des
 * fichiers de diapositives référencés : un numéro répété référence plusieurs fois la même diapositive.
 */
export async function makePptxFromSlides(slides: string[], order?: number[]): Promise<Uint8Array> {
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ids = order ?? slides.map((_, i) => i + 1);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldIdLst>${ids.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + n}"/>`).join('')}</p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${101 + i}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml));
  return zip.generateAsync({ type: 'uint8array' });
}

/** DOCX dont word/document.xml fait `xmlBytes` octets décompressés (quelques Ko compressés : bombe de décompression). */
export async function makeDocxBomb(xmlBytes: number): Promise<Uint8Array> {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>';
  const tail = '</w:t></w:r></w:p></w:body></w:document>';
  const enc = new TextEncoder();
  const body = new Uint8Array(xmlBytes).fill(0x61);
  body.set(enc.encode(head), 0);
  body.set(enc.encode(tail), xmlBytes - tail.length);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', body, { compression: 'DEFLATE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Remplace, dans l'annuaire central du zip, la taille décompressée annoncée de l'entrée de ce nom. */
export function forgeDeclaredSize(zip: Uint8Array, entryName: string, declared: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer);
  const name = new TextEncoder().encode(entryName);
  for (let i = 0; i + 46 + name.length < out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const len = view.getUint16(i + 28, true);
    const candidate = out.subarray(i + 46, i + 46 + len);
    if (len === name.length && candidate.every((b, k) => b === name[k])) {
      view.setUint32(i + 24, declared, true);
      return out;
    }
  }
  throw new Error('Entrée introuvable dans l’annuaire central.');
}

// ─── Cours réaliste pour les tests de sélection des passages ────────────────────

/** Cours de SVT de seconde sur la photosynthèse (6 pages d'environ 1 100 caractères, vocabulaire d'un vrai polycopié). */
export const SVT_COURSE_PAGES: string[] = [
  'Chapitre 3 : la photosynthèse. Introduction. Ce chapitre ouvre le thème « La Terre, la vie et l’organisation du vivant ». Au cours de cette séance, les élèves doivent savoir expliquer comment une plante verte fabrique sa propre matière. Avant de commencer, chaque élève rappelle ce qu’il sait déjà : une plante a besoin d’eau, de lumière et d’air pour pousser. La séance propose une activité de recherche en groupe, avec un exemple concret observé dans le jardin du lycée. Pour comprendre, il faut savoir observer, expliquer et conclure. Une trace écrite sera rédigée à la fin de la séance, avec un schéma légendé et des exemples. Les consignes de travail sont données en début d’heure et chaque groupe rend un compte rendu. L’enseignante passe dans les rangs pour aider les élèves qui rencontrent des difficultés, puis reprend les exemples au tableau avant de distribuer les exercices.',
  'Les échanges gazeux de la feuille pendant la photosynthèse. La feuille d’une plante verte échange des gaz avec l’air par de minuscules ouvertures appelées stomates. Les stomates se situent surtout sur la face inférieure de la feuille. Le nombre de stomates par millimètre carré, ou densité stomatique, varie selon les espèces : environ 250 stomates par mm² chez le haricot. Lorsque les stomates sont ouverts, le dioxyde de carbone de l’air pénètre dans la feuille tandis que le dioxygène produit est rejeté. Ces échanges gazeux se mesurent avec un dispositif d’expérimentation assistée par ordinateur : à la lumière, la photosynthèse est active et la concentration en dioxyde de carbone de l’enceinte diminue alors que celle du dioxygène augmente. À l’obscurité, c’est l’inverse, car la plante respire. La photosynthèse consomme donc du dioxyde de carbone et rejette du dioxygène ; la surface totale d’une feuille de 40 cm² porte ainsi plus de dix mille stomates.',
  'Le rôle de la lumière et de la chlorophylle. Les chloroplastes, présents dans les cellules chlorophylliennes, contiennent des pigments verts, dont la chlorophylle. La chlorophylle absorbe surtout les lumières rouge et bleue, et peu la lumière verte, qui est réfléchie : c’est pourquoi les feuilles paraissent vertes. Une feuille panachée, partiellement blanche, ne fabrique de l’amidon que dans ses zones vertes. L’énergie lumineuse captée est convertie en énergie chimique, utilisée pour construire les molécules organiques. Sans lumière, la photosynthèse s’arrête. L’intensité lumineuse et sa durée influencent directement la quantité de matière produite par la plante. Les plantes d’ombre possèdent davantage de chlorophylle par cellule que les plantes de pleine lumière, ce qui leur permet de capter les faibles éclairements du sous-bois.',
  'Le devenir de la matière produite. À partir du dioxyde de carbone et de l’eau, la plante fabrique du glucose, un sucre simple. Le glucose est transformé en amidon, stocké dans les feuilles, les tiges, les racines ou les graines, par exemple dans le tubercule de pomme de terre ou le grain de blé. L’amidon se met en évidence avec de l’eau iodée, qui prend alors une couleur bleu-noir. Une partie du glucose est transportée par la sève élaborée vers les organes en croissance : bourgeons, racines, fruits. La matière organique ainsi fabriquée est à la base de toutes les chaînes alimentaires : les animaux, qui ne savent pas la produire, la prélèvent en consommant des végétaux ou d’autres animaux. Le bilan s’écrit : dioxyde de carbone plus eau, en présence de lumière, donnent du glucose et du dioxygène.',
  'Les facteurs qui influencent la photosynthèse. La température, l’éclairement, la concentration en dioxyde de carbone et la disponibilité en eau modifient l’intensité de la photosynthèse. Entre 20 et 30 degrés, l’activité est maximale chez la plupart des espèces tempérées ; au-delà de 40 degrés, les enzymes sont altérées et la production chute. En agronomie, les serres permettent de maîtriser ces facteurs pour augmenter les rendements : éclairage d’appoint, enrichissement de l’air en dioxyde de carbone, arrosage raisonné. Les agriculteurs choisissent aussi la date de semis et la densité de plantation pour que chaque feuille reçoive assez de lumière. Un champ de maïs bien exposé produit ainsi plus de matière sèche par hectare qu’une parcelle ombragée par une haie ou un bâtiment voisin.',
  'Bilan et exercices. Après la séance, les élèves doivent savoir expliquer la photosynthèse en quelques lignes. Exercice 1 : comprendre un graphique et expliquer l’évolution de la concentration en dioxygène. Exercice 2 : à titre d’exemple, une activité en groupe où chaque élève doit expliquer le protocole expérimental à ses camarades. Exercice 3 : savoir rédiger la trace écrite avec un schéma bilan, puis expliquer chaque flèche. Consigne : chaque élève explique, avec un exemple, ce qu’il a compris de la séance et sait faire. Exercice 4 : comprendre un texte documentaire et savoir expliquer les mots difficiles. Les élèves rangent ensuite leur matériel, relisent la trace écrite et notent les objectifs de la prochaine séance dans leur cahier de textes ; l’enseignante ramasse les comptes rendus des groupes.',
];

/** Cours d'histoire de troisième (guerre totale) : deuxième document, sans rapport avec la photosynthèse. */
export const HISTOIRE_COURSE_PAGES: string[] = [
  'Introduction : une guerre totale. La Première Guerre mondiale mobilise des millions d’hommes et l’ensemble des économies. Les élèves doivent savoir expliquer ce que signifie « guerre totale » et comprendre pourquoi les civils sont touchés. Cette séance propose une activité sur un exemple : la vie à l’arrière en 1916. Les consignes sont données au tableau et chaque élève rédige une trace écrite.',
  'La bataille de Verdun, 1916. Du 21 février au 19 décembre 1916, Allemands et Français s’affrontent autour de Verdun. Plus de trois cent mille soldats trouvent la mort. Les poilus vivent dans les tranchées, sous les bombardements, dans la boue. Verdun devient le symbole de la résistance française et de la violence des combats.',
  'L’économie de guerre. Les usines se convertissent à la production d’obus ; les femmes remplacent les hommes dans les champs et les ateliers. L’État intervient dans l’économie, rationne les denrées et lance des emprunts nationaux. La propagande et la censure encadrent l’opinion.',
];
