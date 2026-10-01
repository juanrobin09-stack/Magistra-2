#!/usr/bin/env node
// Construit le processus principal et le preload d'Electron avec esbuild.
//
//   electron/main.ts    → dist-electron/main.js     (ESM, Node 22, dépendances regroupées)
//   electron/preload.ts → dist-electron/preload.cjs (CommonJS, compatible bac à sable : seul require('electron'))
//
// Tout le code (shared/, server/safeFetch…) est regroupé : l'application empaquetée n'embarque aucun node_modules.
// Usage : node scripts/build-electron.mjs [--watch] [--sourcemap]

import { build, context } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './mainModule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'dist-electron');

/** Options esbuild partagées par le build et le mode développement. */
export function electronBuildOptions({ sourcemap = false } = {}) {
  const common = {
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    target: 'node22',
    external: ['electron'],
    sourcemap: sourcemap ? 'linked' : false,
    legalComments: 'none',
    logLevel: 'warning',
    charset: 'utf8',
  };
  return {
    main: {
      ...common,
      entryPoints: [path.join(root, 'electron/main.ts')],
      outfile: path.join(outDir, 'main.js'),
      format: 'esm',
      // Certaines dépendances CommonJS regroupées peuvent appeler require() : on le fournit en ESM.
      banner: {
        js: "import { createRequire as __magistraCreateRequire } from 'node:module';\nconst require = __magistraCreateRequire(import.meta.url);",
      },
    },
    preload: {
      ...common,
      entryPoints: [path.join(root, 'electron/preload.ts')],
      outfile: path.join(outDir, 'preload.cjs'),
      format: 'cjs',
    },
  };
}

export async function buildElectron({ sourcemap = false } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const options = electronBuildOptions({ sourcemap });
  await Promise.all([build(options.main), build(options.preload)]);
}

/** Mode surveillance : `onRebuild(kind)` est appelé après chaque reconstruction réussie. */
export async function watchElectron(onRebuild) {
  await mkdir(outDir, { recursive: true });
  const options = electronBuildOptions({ sourcemap: true });
  const notify = kind => ({
    name: `notify-${kind}`,
    setup(b) {
      b.onEnd(result => {
        if (result.errors.length === 0) onRebuild?.(kind);
      });
    },
  });
  const contexts = await Promise.all([
    context({ ...options.main, plugins: [notify('main')] }),
    context({ ...options.preload, plugins: [notify('preload')] }),
  ]);
  await Promise.all(contexts.map(c => c.watch()));
  return { dispose: () => Promise.all(contexts.map(c => c.dispose())) };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    await watchElectron(kind => console.log(`[build-electron] ${kind} reconstruit`));
    console.log('[build-electron] Surveillance des fichiers electron/ et shared/…');
  } else {
    const started = Date.now();
    try {
      await buildElectron({ sourcemap: args.includes('--sourcemap') });
      console.log(`[build-electron] dist-electron/main.js et dist-electron/preload.cjs construits en ${Date.now() - started} ms`);
    } catch (err) {
      console.error('[build-electron] Échec de la construction :', err?.message ?? err);
      process.exit(1);
    }
  }
}
