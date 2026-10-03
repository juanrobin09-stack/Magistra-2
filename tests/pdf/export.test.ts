// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { copyText, exportMarkdown, exportPdf, printDocument, safeFileName, type ExportDoc } from '@/lib/export';
import { finalizeCitations } from '@shared/citations';
import { FONT_DIR } from './helpers';

describe('safeFileName', () => {
  it.each([
    ['Évaluation : fractions (6e)', 'pdf', 'Évaluation fractions (6e).pdf'],
    ['Cours/chapitre 1\\2 *brouillon*?', 'md', 'Cours chapitre 1 2 brouillon.md'],
    ['« Séquence » <HTML> | "test"', '.pdf', '« Séquence » HTML test.pdf'],
    ['   ...  ', 'pdf', 'magistra.pdf'],
    ['', 'md', 'magistra.md'],
    ['Titre.', 'pdf', 'Titre.pdf'],
    ['CON', 'pdf', 'CON_.pdf'],
    ['Ligne\nnouvelle\tligne', 'pdf', 'Ligne nouvelle ligne.pdf'],
    ['Cœur, forêt & œuvre — 2025-2026', 'pdf', 'Cœur, forêt & œuvre — 2025-2026.pdf'],
  ])('%j → %j', (title, ext, expected) => {
    expect(safeFileName(title, ext)).toBe(expected);
  });

  it('borne la longueur en gardant des mots entiers', () => {
    const name = safeFileName('Séquence '.repeat(30), 'pdf');
    const base = name.slice(0, -4);
    expect([...base].length).toBeLessThanOrEqual(80);
    expect(base.endsWith('Séquence')).toBe(true);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('retire les caractères de contrôle bidirectionnels (extension masquée)', () => {
    expect(safeFileName('facture\u202Efdp.exe', 'pdf')).toBe('facturefdp.exe.pdf');
  });
});

describe('exports navigateur', () => {
  let downloads: { name: string; blob: Blob }[];
  const blobs = new Map<string, Blob>();

  beforeEach(() => {
    downloads = [];
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:test/${n++}`;
        blobs.set(url, blob);
        return url;
      }),
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: blobs.get(this.href)! });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exportMarkdown télécharge un fichier .md UTF-8 avec le titre', async () => {
    exportMarkdown({ title: 'Cours : les fractions', content: 'Texte avec é, œ, H₂O et x > 3.' });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('Cours les fractions.md');
    expect(downloads[0].blob.type).toBe('text/markdown;charset=utf-8');
    const bytes = new Uint8Array(await downloads[0].blob.arrayBuffer());
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe('# Cours : les fractions\n\nTexte avec é, œ, H₂O et x > 3.\n');
  });

  it('exportMarkdown : « Sources utilisées » garde le niveau de fiabilité de chaque source', async () => {
    const { content } = finalizeCitations('Cadre officiel [S1], publication [S2], encyclopédie [S3].', [
      { n: 1, kind: 'institutional', title: 'Éducation en vue du développement durable', venue: 'UNESCO', url: 'https://www.unesco.org/fr/esd' },
      { n: 2, kind: 'openalex', title: 'Photosynthesis', venue: 'Plant Journal', doi: '10.1000/x1' },
      { n: 3, kind: 'wikipedia', title: 'Photosynthèse', venue: 'Wikipédia', url: 'https://fr.wikipedia.org/wiki/P' },
    ]);
    exportMarkdown({ title: 'Cours', content });
    const text = await downloads[0].blob.text();
    expect(text).toContain('- [S1] Éducation en vue du développement durable — Source officielle · UNESCO. https://www.unesco.org/fr/esd');
    expect(text).toContain('*Plant Journal* — Publication scientifique · OpenAlex. https://doi.org/10.1000/x1');
    expect(text).toContain('- [S3] Photosynthèse — Encyclopédie collaborative (à recouper) · Wikipédia. https://fr.wikipedia.org/wiki/P');
  });

  it('exportMarkdown ne duplique pas un titre déjà présent', async () => {
    exportMarkdown({ title: 'Plan', content: '# Plan\n\n- a' });
    expect(await downloads[0].blob.text()).toBe('# Plan\n\n- a\n');
  });

  it('exportPdf charge les polices à la demande et télécharge un vrai PDF', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const file = path.basename(String(input).split('?')[0]);
      return new Response(readFileSync(path.join(FONT_DIR, file)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const doc: ExportDoc = {
      title: 'Évaluation : x > 3',
      content: '## Exercice\n\n- 2 * 3 = 6\n- -5 + 10\n\n| a < b | H₂O |\n| --- | --- |\n| CO₂ | 2025-2026 |',
      meta: { niveau: '6e', matiere: 'Mathématiques', type: 'Évaluation', date: '2026-09-28' },
    };
    await exportPdf(doc);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('Évaluation x 3.pdf'); // « : » et « > » sont interdits dans un nom de fichier
    // Seules les polices nécessaires sont téléchargées (ni italique ni chasse fixe ici).
    const fetched = fetchMock.mock.calls.map(c => path.basename(String(c[0])));
    expect(fetched.sort()).toEqual(['DejaVuSans-Bold.ttf', 'DejaVuSans.ttf']);
    const data = new Uint8Array(await downloads[0].blob.arrayBuffer());
    expect(new TextDecoder().decode(data.slice(0, 5))).toBe('%PDF-');
    const task = pdfjs.getDocument({ data, verbosity: 0 });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join('');
    await task.destroy();
    for (const s of ['Évaluation : x > 3', '2 * 3 = 6', '-5 + 10', 'a < b', 'H₂O', 'CO₂', '2025-2026', '6e · Mathématiques · Évaluation']) {
      expect(text).toContain(s);
    }
  });

  it('exportPdf rejette avec un message clair si les polices sont indisponibles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(exportPdf({ title: 'x', content: '*italique*' })).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('PDF'),
    });
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('utilise navigator.clipboard quand il est disponible', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('H₂O > CO₂')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('H₂O > CO₂');
  });

  it('se replie sur execCommand si le presse-papiers refuse', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('refusé'); }) } });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await expect(copyText('texte')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('renvoie false sans jamais rejeter si tout échoue', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: () => { throw new Error('non'); }, configurable: true });
    await expect(copyText('texte')).resolves.toBe(false);
  });
});

describe('printDocument', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('imprime uniquement la zone dédiée puis nettoie après impression', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    document.title = 'Magistra';
    printDocument({ title: 'Séance 3', content: '## Objectifs\n\n| a | b |\n| - | - |\n| x > 3 | $x^2$ |', meta: { niveau: 'CM2', matiere: 'Sciences' } });
    const root = document.querySelector('.print-root');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('aria-hidden')).toBe('true');
    expect(root!.textContent).toContain('Séance 3');
    expect(root!.textContent).toContain('CM2 · Sciences');
    expect(root!.querySelector('.prose-content table')).not.toBeNull();
    expect(root!.querySelector('.katex')).not.toBeNull();
    expect(document.documentElement.classList.contains('mg-printing')).toBe(true);
    expect(document.title).toBe('Séance 3');
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.print-root')).toBeNull();
    expect(document.documentElement.classList.contains('mg-printing')).toBe(false);
    expect(document.title).toBe('Magistra');
  });

  it('remplace une impression précédente non terminée', () => {
    vi.stubGlobal('print', vi.fn());
    printDocument({ title: 'A', content: 'a' });
    printDocument({ title: 'B', content: 'b' });
    const roots = document.querySelectorAll('.print-root');
    expect(roots).toHaveLength(1);
    expect(roots[0].textContent).toContain('B');
    window.dispatchEvent(new Event('afterprint'));
  });
});
