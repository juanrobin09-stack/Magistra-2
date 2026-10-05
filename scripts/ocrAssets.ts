import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);

/** Ressources épinglées et locales : aucune installation ou connexion requise chez l'enseignant. */
export function ocrAssets(): Plugin {
  const files = new Map<string, string>();
  let route = '/ocr/';
  return {
    name: 'magistra-local-ocr',
    configResolved(config) {
      route = `${config.base.replace(/\/$/, '')}/ocr/`;
      const workerRoot = path.dirname(require.resolve('tesseract.js/package.json'));
      const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
      files.set('worker.min.js', path.join(workerRoot, 'dist', 'worker.min.js'));
      files.set('LICENSE-tesseract.md', path.join(workerRoot, 'LICENSE.md'));
      files.set('core/LICENSE', path.join(coreRoot, 'LICENSE'));
      for (const name of readdirSync(coreRoot)) {
        if (/^tesseract-core(?:-(?:relaxedsimd|simd))?-lstm\.wasm(?:\.js)?$/.test(name)) {
          files.set(`core/${name}`, path.join(coreRoot, name));
        }
      }
      if (files.size !== 9) throw new Error('Les six fichiers du moteur OCR LSTM sont nécessaires.');
      for (const language of ['fra', 'eng', 'jpn']) {
        const root = path.dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
        files.set(`lang/${language}.traineddata.gz`, path.join(root, '4.0.0_best_int', `${language}.traineddata.gz`));
        // La distribution garde les références, versions et licences des modèles.
        files.set(`notices/${language}.json`, path.join(root, 'package.json'));
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith(route)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
        const file = files.get(pathname.slice(route.length));
        if (!file) { res.statusCode = 404; res.end(); return; }
        const bytes = readFileSync(file);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Length', bytes.byteLength);
        // Les traineddata.gz sont décompressés par le moteur, pas par HTTP.
        res.end(req.method === 'HEAD' ? undefined : bytes);
      });
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}
