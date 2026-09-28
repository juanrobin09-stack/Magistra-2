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

async function zipDocx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`);
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
