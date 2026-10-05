import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { build, createServer, type ViteDevServer } from 'vite';
import { ocrAssets } from '../../scripts/ocrAssets';
import { createAppProtocolHandler } from '../../electron/protocol';

const require = createRequire(import.meta.url);
const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
const workerRoot = path.dirname(require.resolve('tesseract.js/package.json'));
const languages = ['fra', 'eng', 'jpn'];
const variants = ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'];
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(checksum(actual)).toBe(checksum(expected));
}

describe('moteur OCR et modèles embarqués, sans serveur externe', () => {
  let root: string;
  let dist: string;
  let server: ViteDevServer;
  let address: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'magistra-ocr-resources-'));
    dist = path.join(root, 'dist');
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>OCR resources</body></html>');
    await build({ configFile: false, root, base: '/magistra/', plugins: [ocrAssets()], logLevel: 'silent', build: { outDir: dist } });
    server = await createServer({ configFile: false, root, base: '/magistra/', plugins: [ocrAssets()], logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    address = server.resolvedUrls!.local[0].replace(/\/$/, '');
  });

  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('embarque les trois variantes LSTM, chacune avec son lanceur JS et son binaire WASM', async () => {
    expect((await readdir(path.join(dist, 'ocr/core'))).sort()).toEqual([
      'LICENSE', ...variants.flatMap(name => [`${name}.wasm`, `${name}.wasm.js`]),
    ].sort());
    for (const name of variants) {
      for (const ext of ['.wasm', '.wasm.js']) {
        expectSameBytes(await readFile(path.join(dist, 'ocr/core', name + ext)), await readFile(path.join(coreRoot, name + ext)));
      }
    }
    expectSameBytes(await readFile(path.join(dist, 'ocr/worker.min.js')), await readFile(path.join(workerRoot, 'dist/worker.min.js')));
  });

  it('embarque des modèles français, anglais et japonais gz valides avec leurs notices', async () => {
    expect((await readdir(path.join(dist, 'ocr/lang'))).sort()).toEqual(languages.map(language => `${language}.traineddata.gz`).sort());
    for (const language of languages) {
      const dataRoot = path.dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
      const bytes = await readFile(path.join(dist, 'ocr/lang', `${language}.traineddata.gz`));
      expectSameBytes(bytes, await readFile(path.join(dataRoot, '4.0.0_best_int', `${language}.traineddata.gz`)));
      expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
      expect(gunzipSync(bytes).byteLength).toBeGreaterThan(100_000);
      expect(JSON.parse(await readFile(path.join(dist, 'ocr/notices', `${language}.json`), 'utf8'))).toMatchObject({ name: `@tesseract.js-data/${language}` });
    }
    expect(await readFile(path.join(dist, 'ocr/LICENSE-tesseract.md'))).toEqual(await readFile(path.join(workerRoot, 'LICENSE.md')));
    expect(await readFile(path.join(dist, 'ocr/core/LICENSE'))).toEqual(await readFile(path.join(coreRoot, 'LICENSE')));
  });

  it('sert les six fichiers core et le worker en développement avec les types MIME attendus', async () => {
    for (const resource of ['worker.min.js', ...variants.flatMap(name => [`core/${name}.wasm`, `core/${name}.wasm.js`])]) {
      const response = await fetch(`${address}/ocr/${resource}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(resource.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/wasm');
      expectSameBytes(Buffer.from(await response.arrayBuffer()), await readFile(path.join(dist, 'ocr', resource)));
    }
    expect((await fetch(`${address}/ocr/core/introuvable.wasm`)).status).toBe(404);
    expect((await fetch(`${address}/ocr/worker.min.js`, { method: 'POST' })).status).toBe(405);
  });

  it('sert les modèles gzip sans Content-Encoding pour laisser le moteur les décompresser', async () => {
    for (const language of languages) {
      const response = await fetch(`${address}/ocr/lang/${language}.traineddata.gz`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBeNull();
      expectSameBytes(Buffer.from(await response.arrayBuffer()), await readFile(path.join(dist, 'ocr/lang', `${language}.traineddata.gz`)));
    }
  });

  it('sert tous les fichiers du moteur en app://, y compris les trois modèles hors connexion', async () => {
    const handler = createAppProtocolHandler(dist);
    const resources = ['worker.min.js', ...variants.flatMap(name => [`core/${name}.wasm`, `core/${name}.wasm.js`]), ...languages.map(language => `lang/${language}.traineddata.gz`)];
    for (const resource of resources) {
      const response = await handler(new Request(`app://magistra/ocr/${resource}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBeNull();
      expectSameBytes(Buffer.from(await response.arrayBuffer()), await readFile(path.join(dist, 'ocr', resource)));
      if (resource.endsWith('.wasm')) expect(response.headers.get('content-type')).toBe('application/wasm');
      if (resource.endsWith('.js')) expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    }
    expect((await handler(new Request('app://magistra/ocr/lang/absent.traineddata.gz'))).status).toBe(404);
  });
});
