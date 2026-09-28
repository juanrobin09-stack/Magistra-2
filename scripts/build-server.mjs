// Construit le serveur Node autonome : server/standalone.ts → dist-server/standalone.js
//
//   npm run build          (interface → dist/)
//   npm run build:server   (serveur  → dist-server/standalone.js)
//   npm start              (node dist-server/standalone.js)
//
// Les dépendances npm (@clerk/backend, @supabase/supabase-js) restent externes :
// elles sont chargées depuis node_modules (npm ci --omit=dev suffit en production).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = process.env.MAGISTRA_SERVER_OUTFILE
  ? path.resolve(process.env.MAGISTRA_SERVER_OUTFILE)
  : path.join(root, 'dist-server', 'standalone.js');

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'server', 'standalone.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  banner: { js: '// Magistra — serveur autonome (généré par scripts/build-server.mjs, ne pas modifier).' },
});
