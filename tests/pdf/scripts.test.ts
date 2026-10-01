// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPdf, needsBrowserPdf, PDF_UNSUPPORTED_SCRIPT_MESSAGE } from '@/lib/export';

describe('needsBrowserPdf — écritures que le PDF ne sait pas dessiner', () => {
  it.each([
    ['chinois', '你好，世界'],
    ['pinyin avec caractères', 'Nǐ hǎo : 你好'],
    ['arabe', 'مرحبا بالعالم'],
    ['arabe (formes de présentation)', 'ﻣﺮﺣﺒﺎ'],
    ['hébreu', 'שלום'],
    ['japonais (kana)', 'こんにちは'],
    ['coréen', '안녕하세요'],
    ['hindi', 'नमस्ते'],
    ['thaï', 'สวัสดี'],
  ])('%s est détecté', (_name, text) => {
    expect(needsBrowserPdf(text)).toBe(true);
  });

  it('le français (accents, formules, tableaux), le grec et le cyrillique ne sont pas signalés', () => {
    const latin = '## Évaluation : œuvre de Molière\n\nÇa, où, déjà, naïve. H₂O, x² ≥ 3, π ≈ 3,14 — « guillemets » €\n\n| a < b | ℝ |\n| --- | --- |\n| α | β |\n\nПривет, Δ, Σ';
    expect(needsBrowserPdf(latin)).toBe(false);
    expect(needsBrowserPdf('')).toBe(false);
  });
});

describe('exportPdf — écritures non prises en charge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('chinois et arabe : message clair, aucun PDF « � » téléchargé, aucune police chargée', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    for (const content of ['# 汉语\n\n你好 世界', 'مرحبا بالعالم']) {
      const err = await exportPdf({ title: 'Texte', content }).catch((e: unknown) => e);
      expect(err).toMatchObject({ message: PDF_UNSUPPORTED_SCRIPT_MESSAGE });
      // Code différent d'INTERNAL : les boutons d'export affichent ce message (et non « L'export PDF a échoué »).
      expect((err as { code: string }).code).not.toBe('INTERNAL');
    }
    expect(PDF_UNSUPPORTED_SCRIPT_MESSAGE).toMatch(/Imprimer/);
    expect(PDF_UNSUPPORTED_SCRIPT_MESSAGE).toMatch(/Markdown/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('un titre en chinois suffit à déclencher le message', async () => {
    await expect(exportPdf({ title: '汉语', content: 'Bonjour' })).rejects.toMatchObject({ message: PDF_UNSUPPORTED_SCRIPT_MESSAGE });
  });
});
