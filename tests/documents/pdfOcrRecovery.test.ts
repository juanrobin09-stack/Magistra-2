import { describe, expect, it, vi } from 'vitest';
import { extractDocument, type PdfJsLike } from '@shared/documents/extract';
import { DOCUMENT_LIMITS } from '@shared/documents/types';

const input = { id: 'source', name: 'vocabulaire.pdf', bytes: new TextEncoder().encode('%PDF-1.7\n') };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function expectPromptRejection(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(await Promise.race([
      work.then(() => 'resolved', () => 'rejected'),
      new Promise<string>(resolve => { timer = setTimeout(() => resolve('still pending'), 250); }),
    ])).toBe('rejected');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pdf(pages: string[], textFailure = -1) {
  const destroy = vi.fn(async () => {});
  const cleanup = pages.map(() => vi.fn());
  const pageObjects = pages.map((text, i) => ({
    getTextContent: async () => {
      if (i === textFailure) throw new Error('Font mapping failed');
      return { items: text ? [{ str: text, hasEOL: true }] : [] };
    },
    cleanup: cleanup[i],
  }));
  const lib: PdfJsLike = { getDocument: () => ({
    promise: Promise.resolve({ numPages: pages.length, getPage: async n => pageObjects[n - 1] }), destroy,
  }) };
  return { lib, destroy, cleanup, pageObjects };
}

describe('récupération locale des pages PDF', () => {
  it('récupère seulement la page image, garde les pages natives et leurs citations exactes', async () => {
    const source = pdf(['Introduction', '', 'Conclusion']);
    const recognizePdfPage = vi.fn(async () => ({ text: '日本語の語彙 : 猫 et 犬', confidence: 92 }));
    const onProgress = vi.fn();
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage, onProgress });
    expect(doc.units.map(unit => [unit.locator.start, unit.text])).toEqual([
      [1, 'Introduction'], [2, '日本語の語彙 : 猫 et 犬'], [3, 'Conclusion'],
    ]);
    expect(recognizePdfPage).toHaveBeenCalledExactlyOnceWith(source.pageObjects[1], { stage: 'recognizing', page: 2, pages: 3 });
    expect(onProgress).toHaveBeenCalledWith({ stage: 'recognizing', page: 2, pages: 3 });
    expect(doc.warnings.join(' ')).toContain('1 page(s) lues par reconnaissance');
    expect(source.destroy).toHaveBeenCalledOnce();
    source.cleanup.forEach(cleanup => expect(cleanup).toHaveBeenCalledOnce());
  });

  it('ne confond plus de courts mots japonais avec une pagination ou un scan', async () => {
    const source = pdf(['猫', '犬', '鳥']);
    const recognizePdfPage = vi.fn();
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage });
    expect(doc.units.map(unit => unit.text)).toEqual(['猫', '犬', '鳥']);
    expect(recognizePdfPage).not.toHaveBeenCalled();
  });

  it('un scan avec un filigrane sélectionnable déclenche OCR au lieu de présenter le filigrane comme le cours', async () => {
    const source = pdf(['CONFIDENTIEL']);
    const hasPdfPageImages = vi.fn(async () => true);
    const recognizePdfPage = vi.fn(async () => ({ text: 'Le contenu du cours dans l’image', confidence: 92 }));
    const doc = await extractDocument(input, { pdfjs: source.lib, hasPdfPageImages, recognizePdfPage });
    expect(doc.units[0].text).toBe('Le contenu du cours dans l’image');
    expect(recognizePdfPage).toHaveBeenCalledOnce();
    expect(doc.warnings.join(' ')).toContain('1 page(s) lues par reconnaissance');
  });

  it('un filigrane natif est conservé avec avertissement si le contenu de l’image ne peut pas être reconnu', async () => {
    const source = pdf(['CONFIDENTIEL']);
    const doc = await extractDocument(input, { pdfjs: source.lib, hasPdfPageImages: async () => true,
      recognizePdfPage: async () => ({ text: '', confidence: 0 }) });
    expect(doc.units[0].text).toBe('CONFIDENTIEL');
    expect(doc.warnings.join(' ')).toContain('reconnaissance a échoué');
  });

  it('un mot japonais court sans image ne déclenche pas OCR', async () => {
    const source = pdf(['猫']);
    const hasPdfPageImages = vi.fn(async () => false);
    const recognizePdfPage = vi.fn();
    const doc = await extractDocument(input, { pdfjs: source.lib, hasPdfPageImages, recognizePdfPage });
    expect(doc.units[0].text).toBe('猫');
    expect(hasPdfPageImages).toHaveBeenCalledOnce();
    expect(recognizePdfPage).not.toHaveBeenCalled();
  });

  it('une inspection des images défaillante conserve le texte natif et signale le contenu potentiellement ignoré', async () => {
    const source = pdf(['Introduction']);
    const doc = await extractDocument(input, { pdfjs: source.lib, hasPdfPageImages: async () => { throw new Error('image inspect failed'); } });
    expect(doc.units[0].text).toBe('Introduction');
    expect(doc.warnings.join(' ')).toContain('texte présent dans ces images peut ne pas avoir été lu');
  });

  it('récupère la couche illisible et les polices provoquant une erreur d’extraction', async () => {
    const source = pdf(['\uE000\uE001\uE002', 'natif'], 1);
    let index = 0;
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage: async () => ({ text: ['Bonjour', '世界'][index++], confidence: 90 }) });
    expect(doc.units.map(unit => unit.text)).toEqual(['Bonjour', '世界']);
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it('échec d’une page : les suivantes sont récupérées avec avertissement de contenu incomplet', async () => {
    const source = pdf(['Cours natif', '', '']);
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage: async (_, progress) => {
      if (progress.page === 2) throw new Error('Unreadable image');
      return { text: 'Suite du cours', confidence: 90 };
    } });
    expect(doc.units.map(unit => unit.locator.start)).toEqual([1, 3]);
    expect(doc.warnings.join(' ')).toContain('1 page(s) sans texte exploitable');
    expect(doc.warnings.join(' ')).toContain('reconnaissance a échoué');
  });

  it('échec du démarrage OCR : aucune répétition par page et texte natif conservé', async () => {
    const source = pdf(['', '', 'Cours conservé', '']);
    const recognizePdfPage = vi.fn(async () => { throw { code: 'OCR_INITIALIZATION_FAILED' }; });
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage });
    expect(recognizePdfPage).toHaveBeenCalledOnce();
    expect(doc.units.map(unit => [unit.locator.start, unit.text])).toEqual([[3, 'Cours conservé']]);
    expect(doc.warnings.join(' ')).toContain('n’a pas pu démarrer');
  });

  it('reconnaissance incertaine : contenu conservé avec une demande explicite de vérification', async () => {
    const source = pdf(['']);
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage: async () => ({ text: 'Cours reconnu', confidence: 42 }) });
    expect(doc.units[0].text).toBe('Cours reconnu');
    expect(doc.warnings.join(' ')).toContain('reconnaissance incertaine');
  });

  it('reconnaissance vide : erreur compréhensible sans affirmer que le fichier est forcément un scan', async () => {
    const source = pdf(['']);
    await expect(extractDocument(input, { pdfjs: source.lib, recognizePdfPage: async () => ({ text: '', confidence: 0 }) }))
      .rejects.toMatchObject({ code: 'DOCUMENT_SCANNED', message: expect.stringContaining('Aucun texte exploitable') });
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it('borne les pages OCR, indique la limite, puis garde une page native située après la limite', async () => {
    const source = pdf([...Array(DOCUMENT_LIMITS.maxOcrPages + 1).fill(''), 'Dernière page native']);
    const recognizePdfPage = vi.fn(async () => ({ text: 'Une page reconnue', confidence: 90 }));
    const doc = await extractDocument(input, { pdfjs: source.lib, recognizePdfPage });
    expect(recognizePdfPage).toHaveBeenCalledTimes(DOCUMENT_LIMITS.maxOcrPages);
    expect(doc.units.at(-1)).toMatchObject({ text: 'Dernière page native', locator: { start: DOCUMENT_LIMITS.maxOcrPages + 2 } });
    expect(doc.warnings.join(' ')).toContain('nécessitent un fichier séparé');
  });

  it('annulation pendant OCR : pas de texte tardif et toutes les ressources sont libérées', async () => {
    const source = pdf(['']);
    const controller = new AbortController();
    await expect(extractDocument(input, { pdfjs: source.lib, signal: controller.signal, recognizePdfPage: async () => {
      controller.abort(); return { text: 'Ne pas utiliser', confidence: 90 };
    } })).rejects.toBeDefined();
    expect(source.destroy).toHaveBeenCalledOnce();
    expect(source.cleanup[0]).toHaveBeenCalledOnce();
  });

  it('fichier protégé : diagnostic précis et tâche de chargement détruite même sans document', async () => {
    const destroy = vi.fn(async () => {});
    const lib: PdfJsLike = { getDocument: () => ({ destroy, promise: Promise.reject({ name: 'PasswordException' }) }) };
    await expect(extractDocument(input, { pdfjs: lib })).rejects.toMatchObject({ code: 'DOCUMENT_PROTECTED' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('annule immédiatement un chargement suspendu même si la destruction du worker ne répond pas', async () => {
    const controller = new AbortController();
    const destroy = vi.fn(() => new Promise<void>(() => {}));
    const loading = deferred<Awaited<ReturnType<PdfJsLike['getDocument']>['promise']>>();
    const lib: PdfJsLike = { getDocument: () => ({ destroy, promise: loading.promise }) };
    const work = extractDocument(input, { pdfjs: lib, signal: controller.signal });
    controller.abort();
    await expectPromptRejection(work);
    expect(destroy).toHaveBeenCalledOnce();
    // Une erreur tardive du chargement interrompu reste traitée.
    loading.reject(new Error('late worker error'));
    await Promise.resolve();
  });

  it('annule une extraction native suspendue et libère la page et la tâche une seule fois', async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const text = deferred<{ items: unknown[] }>();
    const cleanup = vi.fn(() => { throw new Error('cleanup failed'); });
    const destroy = vi.fn(() => new Promise<void>(() => {}));
    const lib: PdfJsLike = { getDocument: () => ({ destroy, promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ cleanup, getTextContent: () => { started.resolve(); return text.promise; } }),
    }) }) };
    const work = extractDocument(input, { pdfjs: lib, signal: controller.signal });
    await started.promise;
    controller.abort();
    await expectPromptRejection(work);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    text.reject(new Error('late text error'));
    await Promise.resolve();
  });

  for (const operation of ['labels', 'page'] as const) {
    it(`annule une attente native suspendue des ${operation} sans bloquer les autres documents`, async () => {
      const controller = new AbortController();
      const started = deferred<void>();
      const destroy = vi.fn(async () => {});
      const lib: PdfJsLike = { getDocument: () => ({ destroy, promise: Promise.resolve({
        numPages: 1,
        getPageLabels: () => {
          if (operation === 'labels') { started.resolve(); return new Promise(() => {}); }
          return Promise.resolve(null);
        },
        getPage: () => { started.resolve(); return new Promise(() => {}); },
      }) }) };
      const work = extractDocument(input, { pdfjs: lib, signal: controller.signal });
      await started.promise;
      controller.abort();
      await expectPromptRejection(work);
      expect(destroy).toHaveBeenCalledOnce();
    });
  }

  it('annule une inspection des images suspendue sans conserver de texte tardif', async () => {
    const source = pdf(['CONFIDENTIEL']);
    const controller = new AbortController();
    const started = deferred<void>();
    const inspection = deferred<boolean>();
    const work = extractDocument(input, { pdfjs: source.lib, signal: controller.signal,
      hasPdfPageImages: () => { started.resolve(); return inspection.promise; } });
    await started.promise;
    controller.abort();
    await expectPromptRejection(work);
    expect(source.destroy).toHaveBeenCalledOnce();
    expect(source.cleanup[0]).toHaveBeenCalledOnce();
    inspection.resolve(true);
    await Promise.resolve();
  });

  it('un nettoyage défaillant ne masque jamais le diagnostic de mot de passe', async () => {
    const destroy = vi.fn(async () => { throw new Error('worker cleanup failed'); });
    const lib: PdfJsLike = { getDocument: () => ({ destroy, promise: Promise.reject({ name: 'PasswordException' }) }) };
    await expect(extractDocument(input, { pdfjs: lib })).rejects.toMatchObject({ code: 'DOCUMENT_PROTECTED' });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
