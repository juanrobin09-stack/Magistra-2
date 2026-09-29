// Construit le serveur Node autonome : server/standalone.ts → dist-server/standalone.js
// et l'outil de vérification de l'IA : server/aiCheck.ts → dist-server/ai-check.js
//
//   npm run build          (interface → dist/)
//   npm run build:server   (serveur  → dist-server/standalone.js et dist-server/ai-check.js)
//   npm start              (node dist-server/standalone.js)
//   node dist-server/ai-check.js [options]   (vérification sans dépendances de développement)
//
// Les dépendances npm (@clerk/backend, @supabase/supabase-js) restent externes :
// elles sont chargées depuis node_modules (npm ci --omit=dev suffit en production).
//
// « npm run ai:check [-- options] » appelle ce script avec --run-ai-check : server/aiCheck.ts est compilé à la
// volée dans node_modules/.cache/magistra/, puis exécuté avec les options restantes (voir server/aiCheck.ts).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  legalComments: 'none',
};

const args = process.argv.slice(2);

if (args[0] === '--run-ai-check') {
  const outfile = path.join(root, 'node_modules', '.cache', 'magistra', 'ai-check.mjs');
  await build({ ...common, entryPoints: [path.join(root, 'server', 'aiCheck.ts')], outfile, sourcemap: 'inline', logLevel: 'warning' });
  const { main } = await import(pathToFileURL(outfile).href);
  // Racine du projet transmise : le module compilé vit dans node_modules/.cache, pas à côté de server/.
  process.exitCode = await main(args.slice(1), { projectRoot: root });
} else {
  const outfile = process.env.MAGISTRA_SERVER_OUTFILE
    ? path.resolve(process.env.MAGISTRA_SERVER_OUTFILE)
    : path.join(root, 'dist-server', 'standalone.js');

  await build({
    ...common,
    entryPoints: [path.join(root, 'server', 'standalone.ts')],
    outfile,
    sourcemap: true,
    logLevel: 'info',
    banner: { js: '// Magistra — serveur autonome (généré par scripts/build-server.mjs, ne pas modifier).' },
  });

  await build({
    ...common,
    entryPoints: [path.join(root, 'server', 'aiCheck.ts')],
    outfile: path.join(path.dirname(outfile), 'ai-check.js'),
    sourcemap: true,
    logLevel: 'info',
    banner: { js: '// Magistra — vérification de l\'IA (généré par scripts/build-server.mjs, ne pas modifier).' },
  });
}
