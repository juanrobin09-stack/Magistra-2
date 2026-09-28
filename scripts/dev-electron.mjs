#!/usr/bin/env node
// Développement de l'application Windows :
//   1. démarre le serveur Vite (rechargement à chaud de l'interface React) ;
//   2. construit electron/ en mode surveillance (esbuild) ;
//   3. lance Electron avec VITE_DEV_SERVER_URL, et le relance à chaque modification du processus principal.
// Usage : npm run dev:electron

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { createServer } from 'vite';
import { watchElectron } from './build-electron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1' } });
await vite.listen();
const devUrl = vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${vite.config.server.port}/`;
console.log(`[dev-electron] Interface servie par Vite : ${devUrl}`);

let child = null;
let restarting = false;
let shuttingDown = false;
let restartTimer = null;

function electronArgs() {
  const args = ['.'];
  // Linux en root (conteneurs) : le bac à sable du système doit être désactivé pour démarrer.
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
  return args;
}

function startElectron() {
  child = spawn(electronPath, electronArgs(), {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl, NODE_ENV: 'development' },
  });
  child.on('exit', code => {
    child = null;
    if (restarting) {
      restarting = false;
      startElectron();
    } else if (!shuttingDown) {
      // Fenêtre fermée par l'utilisateur : on arrête tout.
      void shutdown(code ?? 0);
    }
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!child) return startElectron();
    console.log('[dev-electron] Processus principal modifié : redémarrage d’Electron…');
    restarting = true;
    child.kill();
  }, 150);
}

// Premier passage : Electron démarre quand le main ET le preload sont construits ; ensuite, chaque
// reconstruction relance Electron (le preload n'est relu qu'au chargement de la fenêtre).
const initialBuilds = new Set();
let started = false;
const watcher = await watchElectron(kind => {
  if (!started) {
    initialBuilds.add(kind);
    if (initialBuilds.has('main') && initialBuilds.has('preload')) {
      started = true;
      startElectron();
    }
    return;
  }
  restartElectron();
});

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  child?.kill();
  await Promise.allSettled([watcher.dispose(), vite.close()]);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
