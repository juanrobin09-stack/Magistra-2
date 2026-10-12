// Charge seulement les modules purs de référencement depuis les sources du dépôt, dans un cache local non publié.
// Aucun module de l'application, variable d'environnement ou fichier généré publié n'est exécuté.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiled = path.join(root, 'node_modules/.cache/magistra', `site-seo-source-${process.pid}-${randomUUID()}.cjs`);
await build({
  absWorkingDir: root,
  stdin: { contents: "export * from './shared/site.ts'; export * from './shared/siteSeo.ts'; export * from './shared/siteIndexing.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, outfile: compiled, platform: 'node', format: 'cjs', legalComments: 'none',
});
let source;
try { source = createRequire(import.meta.url)(compiled); }
finally { rmSync(compiled, { force: true }); }
export const siteSeoSource = source;
