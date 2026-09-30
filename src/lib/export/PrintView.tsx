// Document mis en page pour l'impression (rendu dans une zone dédiée, voir printDocument).

import MarkdownView from '@/components/MarkdownView';
import type { ExportDoc } from './index';
import { formatExportDate, metaLine } from './format';

export default function PrintView({ doc }: { doc: ExportDoc }) {
  const meta = metaLine(doc.meta);
  return (
    <article className="print-document" lang="fr">
      <header className="print-header">
        <h1 className="print-title">{doc.title?.trim() || 'Document sans titre'}</h1>
        {meta && <p className="print-meta">{meta}</p>}
        <p className="print-meta">{formatExportDate(doc.meta?.date)}</p>
      </header>
      <MarkdownView content={doc.content ?? ''} className="print-prose" />
    </article>
  );
}
