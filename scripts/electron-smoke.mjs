#!/usr/bin/env node
// Test de démarrage réel de l'application Electron (fenêtre, preload, rendu, pont IPC).
//
// Prérequis : `npx vite build` (dist/) et `node scripts/build-electron.mjs` (dist-electron/).
// Usage :
//   node scripts/electron-smoke.mjs                 démarrage simple
//   node scripts/electron-smoke.mjs --mock-ollama   + faux serveur Ollama : vérifie ai.status (moteur « running »)
//   node scripts/electron-smoke.mjs --mock-ollama --generate   + une génération complète de bout en bout
// Variables : MAGISTRA_DIST_DIR (dossier dist/ de remplacement, hors application empaquetée),
//             MAGISTRA_SMOKE_TIMEOUT_MS (45 000 par défaut).
// Sous Linux sans affichage, le test est lancé sous xvfb-run automatiquement.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const withMock = args.includes('--mock-ollama');
const generate = args.includes('--generate');
const PREFIX = 'MAGISTRA_SMOKE_RESULT ';

const distDir = process.env.MAGISTRA_DIST_DIR ? path.resolve(process.env.MAGISTRA_DIST_DIR) : path.join(root, 'dist');
for (const [file, hint] of [
  [path.join(distDir, 'index.html'), 'lancez « npx vite build » (ou définissez MAGISTRA_DIST_DIR)'],
  [path.join(root, 'dist-electron', 'main.js'), 'lancez « node scripts/build-electron.mjs »'],
  [path.join(root, 'dist-electron', 'preload.cjs'), 'lancez « node scripts/build-electron.mjs »'],
]) {
  if (!existsSync(file)) {
    console.error(`[smoke] Fichier manquant : ${path.relative(root, file)} — ${hint}.`);
    process.exit(1);
  }
}

let mock = null;
const env = { ...process.env, MAGISTRA_SMOKE_TEST: '1', ELECTRON_ENABLE_LOGGING: '1' };
delete env.ELECTRON_RUN_AS_NODE;
if (withMock) {
  const { startMockOllama } = await import('./mock-ollama.mjs');
  mock = await startMockOllama({ port: 0, pullMs: 300, chatDelayMs: 5 });
  env.MAGISTRA_OLLAMA_URL = mock.url;
  env.MAGISTRA_SMOKE_EXPECT_ENGINE = 'running';
  console.log(`[smoke] Faux serveur Ollama : ${mock.url}`);
}
if (generate) env.MAGISTRA_SMOKE_GENERATE = '1';

const electronArgs = ['.', '--smoke-test'];
if (process.platform === 'linux') {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  // Conteneurs (root) et CI Linux récents : le bac à sable du système n'est pas disponible.
  if (isRoot || process.env.CI) electronArgs.push('--no-sandbox');
  electronArgs.push('--disable-gpu');
}

let command = electronPath;
let commandArgs = electronArgs;
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  const hasXvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0;
  if (!hasXvfb) {
    console.error('[smoke] Aucun affichage (DISPLAY) et xvfb-run introuvable : installez xvfb.');
    process.exit(1);
  }
  command = 'xvfb-run';
  commandArgs = ['-a', electronPath, ...electronArgs];
}

const started = Date.now();
const child = spawn(command, commandArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let result = null;
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.startsWith(PREFIX)) {
      try {
        result = JSON.parse(line.slice(PREFIX.length));
      } catch {
        result = { ok: false, reason: 'résultat illisible' };
      }
    } else if (line.trim()) {
      process.stdout.write(`[electron] ${line}\n`);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => {
  for (const line of chunk.split('\n')) {
    // Bruit habituel de Chromium sous Linux sans bus système : sans intérêt pour le test.
    if (line.trim() && !/dbus|Failed to connect to the bus|viz_main_impl|gpu_init|angle_platform|ffmpeg|GLib-GIO/.test(line)) {
      process.stderr.write(`[electron] ${line}\n`);
    }
  }
});

const hardTimeout = setTimeout(() => {
  console.error('[smoke] Délai global dépassé : arrêt forcé.');
  child.kill('SIGKILL');
}, Number(process.env.MAGISTRA_SMOKE_TIMEOUT_MS ?? 45_000) + 45_000);

child.on('exit', async (code, signal) => {
  clearTimeout(hardTimeout);
  await mock?.close();
  const duration = Date.now() - started;
  if (result) console.log(JSON.stringify(result, null, 2));
  const ok = code === 0 && result?.ok === true;
  console.log(ok
    ? `[smoke] SUCCÈS en ${duration} ms`
    : `[smoke] ÉCHEC (code ${code ?? signal}${result?.reason ? ` — ${result.reason}` : ''})`);
  process.exit(ok ? 0 : 1);
});
