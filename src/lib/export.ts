import jsPDF from 'jspdf';

export function exportToPDF(content: string, title: string): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  
  // Clean markdown for PDF
  const cleaned = content
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/>\s/g, '  ')
    .replace(/---/g, '————————————————————')
    .replace(/\|.*\|/g, (match) => match.replace(/\|/g, '  '))
    .replace(/[-☐☑✓✗]/g, '•');
  
  const pageWidth = 170;
  const lines = doc.splitTextToSize(cleaned, pageWidth);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Magistra', 20, 20);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 140);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 20, 27);
  
  doc.setDrawColor(200, 182, 255);
  doc.setLineWidth(0.5);
  doc.line(20, 30, 190, 30);
  
  doc.setTextColor(30, 30, 40);
  doc.setFontSize(11);
  
  let y = 38;
  const lineHeight = 5.5;
  
  for (const line of lines) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, 20, y);
    y += lineHeight;
  }
  
  doc.save(`magistra_${title.slice(0, 30).replace(/\s/g, '_')}.pdf`);
}

export function exportToText(content: string, title: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `magistra_${title.slice(0, 30).replace(/\s/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function copyToClipboard(content: string): Promise<void> {
  return navigator.clipboard.writeText(content);
}
