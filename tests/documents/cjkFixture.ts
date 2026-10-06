// PDF minimal à police CID non intégrée et sans ToUnicode. Sa lecture exige les
// CMaps Adobe distribuées avec pdf.js (cas fréquent des documents asiatiques).
export function makeCjkPdf(encoding = 'UniJIS-UCS2-H', collection = 'Japan1', font = 'HeiseiMin-W3', hexText = '30533093306B3061306F'): Uint8Array {
  const content = `BT /F1 20 Tf 50 700 Td <${hexText}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Type /Font /Subtype /Type0 /BaseFont /${font} /Encoding /${encoding} /DescendantFonts [5 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${font} /CIDSystemInfo << /Registry (Adobe) /Ordering (${collection}) /Supplement 2 >> /FontDescriptor 6 0 R /DW 1000 >>`,
    `<< /Type /FontDescriptor /FontName /${font} /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
