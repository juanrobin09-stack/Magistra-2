import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const PDF_RESOURCES = ['cmaps', 'standard_fonts', 'iccs', 'wasm'] as const;
const require = createRequire(import.meta.url);

/** Ressources pdf.js identiques en développement et dans dist/ (donc app.asar). */
export function pdfAssets(): Plugin {
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const files = new Map<string, string>();
  let route = '/pdfjs/';
  return {
    name: 'magistra-local-pdf-resources',
    configResolved(config) {
      route = `${config.base.replace(/\/$/, '')}/pdfjs/`;
      for (const folder of PDF_RESOURCES) {
        const dir = path.join(pdfRoot, folder);
        const entries = readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile());
        if (entries.length === 0) throw new Error(`Ressources PDF absentes : ${folder}.`);
        for (const entry of entries) files.set(`${folder}/${entry.name}`, path.join(dir, entry.name));
      }
      // Les ressources conservent leurs notices ; la licence du lecteur est aussi distribuée.
      files.set('LICENSE', path.join(pdfRoot, 'LICENSE'));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith(route)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        // Seuls les fichiers du paquet inventoriés sont servis. Aucun chemin fourni
        // dans la requête n'est joint au système de fichiers.
        const file = files.get(pathname.slice(route.length));
        if (!file) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const bytes = readFileSync(file);
        const type = file.endsWith('.wasm') ? 'application/wasm'
          : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
            : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Length', bytes.byteLength);
        res.end(req.method === 'HEAD' ? undefined : bytes);
      });
    },
    generateBundle() {
      for (const [name, file] of files) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(file) });
      }
    },
  };
}
