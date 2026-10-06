import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build, createServer, type ViteDevServer } from 'vite';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDocument } from '@shared/documents/extract';
import { pdfResourceOptions, withLocalPdfResources, type PdfJsModule } from '@/lib/documents/pdf';
import { pdfAssets } from '../../scripts/pdfAssets';
import { createAppProtocolHandler } from '../../electron/protocol';
import { makeCjkPdf } from './cjkFixture';
import { makeStandardFontPdf } from './fixtures';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

describe('ressources PDF locales et import des polices CID', () => {
  let root: string;
  let dist: string;
  let server: ViteDevServer;
  let address: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'magistra-pdf-resources-'));
    dist = path.join(root, 'dist');
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>PDF resources</body></html>');
    await build({ configFile: false, root, base: '/magistra/', plugins: [pdfAssets()], logLevel: 'silent', build: { outDir: dist } });
    server = await createServer({ configFile: false, root, base: '/magistra/', plugins: [pdfAssets()], logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    address = server.resolvedUrls!.local[0].replace(/\/$/, '');
  });

  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('applique les ressources à chaque ouverture sans changer les données ou les réglages de lecture', () => {
    const getDocument = vi.fn();
    const lib = withLocalPdfResources({ getDocument } as unknown as PdfJsModule, '/magistra/');
    const bytes = makeCjkPdf();
    lib.getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true });
    expect(getDocument).toHaveBeenCalledWith({
      ...pdfResourceOptions('/magistra/'),
      data: bytes, useSystemFonts: false, disableFontFace: true,
    });
    expect(pdfResourceOptions('/magistra/')).toMatchObject({
      cMapUrl: '/magistra/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/magistra/pdfjs/standard_fonts/',
      iccUrl: '/magistra/pdfjs/iccs/',
      wasmUrl: '/magistra/pdfjs/wasm/', useWorkerFetch: false,
    });
  });

  it('embarque toutes les CMaps, polices, décodeurs et leurs notices dans la construction', async () => {
    for (const folder of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
      const installed = (await readdir(path.join(packageRoot, folder))).sort();
      expect((await readdir(path.join(dist, 'pdfjs', folder))).sort()).toEqual(installed);
    }
    expect(await readFile(path.join(dist, 'pdfjs/LICENSE'))).toEqual(await readFile(path.join(packageRoot, 'LICENSE')));
  });

  it('sert les octets attendus en développement, y compris avec une base URL', async () => {
    for (const resource of ['cmaps/UniJIS-UCS2-H.bcmap', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'wasm/openjpeg_nowasm_fallback.js']) {
      const response = await fetch(`${address}/pdfjs/${resource}`);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(await readFile(path.join(packageRoot, resource))));
      if (resource.endsWith('.wasm')) expect(response.headers.get('content-type')).toBe('application/wasm');
      if (resource.endsWith('.js')) expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    }
    expect((await fetch(`${address}/pdfjs/cmaps/introuvable.bcmap`)).status).toBe(404);
  });

  it('sert les mêmes ressources hors connexion avec le protocole Windows app://', async () => {
    const handler = createAppProtocolHandler(dist);
    for (const resource of ['cmaps/Adobe-Japan1-UCS2.bcmap', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm']) {
      const response = await handler(new Request(`app://magistra/pdfjs/${resource}`));
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(await readFile(path.join(packageRoot, resource))));
    }
  });

  it('reproduit l’ancien refus d’un PDF japonais sélectionnable quand ses CMaps manquent', async () => {
    const warning = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(extractDocument({ id: 'jp', name: 'japonais.pdf', bytes: makeCjkPdf() }, { pdfjs })).rejects.toMatchObject({ code: 'DOCUMENT_SCANNED' });
    } finally {
      warning.mockRestore();
    }
  });

  it('rend une page à police standard non intégrée avec les polices embarquées, sans police système', async () => {
    const lib = withLocalPdfResources(pdfjs, dist.replace(/\\/g, '/'));
    const task = lib.getDocument({ data: makeStandardFontPdf(['Cours pour les eleves']), useSystemFonts: false, disableFontFace: true });
    const document = await task.promise;
    const factory = document.canvasFactory as {
      create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
      destroy(pair: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): void;
    };
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const pair = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: pair.canvas, canvasContext: pair.context, viewport }).promise;
      const pixels = pair.context.getImageData(0, 0, pair.canvas.width, pair.canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 3] > 0) ink++;
      expect(ink).toBeGreaterThan(100);
    } finally {
      factory.destroy(pair);
      await task.destroy();
    }
  });

  for (const [name, encoding, collection, font, text, hex] of [
    ['japonais', 'UniJIS-UCS2-H', 'Japan1', 'HeiseiMin-W3', 'こんにちは', '30533093306B3061306F'],
    ['japonais vertical', 'UniJIS-UCS2-V', 'Japan1', 'HeiseiMin-W3', 'こんにちは', '30533093306B3061306F'],
    ['chinois', 'UniGB-UCS2-H', 'GB1', 'STSong-Light', '你好', '4F60597D'],
    ['coréen', 'UniKS-UCS2-H', 'Korea1', 'HYSMyeongJo-Medium', '안녕', 'C548B155'],
  ]) {
    it(`extrait le ${name} d’un PDF sans police intégrée ni ToUnicode, avec les seules ressources du build`, async () => {
      const lib = withLocalPdfResources(pdfjs, dist.replace(/\\/g, '/'));
      const document = await extractDocument({ id: name, name: `${name}.pdf`, bytes: makeCjkPdf(encoding, collection, font, hex) }, { pdfjs: lib });
      expect(document.units).toEqual([{ locator: { type: 'pages', start: 1, end: 1 }, text }]);
      expect(document.warnings).toEqual([]);
    });
  }
});
