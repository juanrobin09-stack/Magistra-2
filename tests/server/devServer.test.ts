// « npm run dev » : API montée dans Vite (server/dev.ts), mode personnel sur l'hôte par défaut de Vite (localhost),
// adresse d'accès affichée sous les adresses de Vite, jamais de mode personnel quand Vite écoute sur le réseau.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModeInfo } from '../../shared/apiContract.js';
import { DEFAULT_DATA_DIR_NAME } from '../../server/config.js';
import { devStartupLines, handleDevRequest, type DevServerInfo } from '../../server/dev.js';
import { ACCESS_TOKEN_FILE } from '../../server/personal.js';
import { DATA_DIR_NAME, listenHost, magistraDevApi, targetsDataDir } from '../../server/viteDevApi.js';
import { call, listen, type TestServer } from './helpers.js';

let dir: string;
let server: TestServer | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'magistra-dev-'));
  // Journal du serveur de développement (console) : silencieux pendant les tests.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Serveur HTTP qui délègue /api/* à server/dev.ts, comme le plugin Vite, avec l'hôte d'écoute simulé. */
async function startDev(env: Record<string, string>, host: string | null): Promise<{ api: TestServer; info: DevServerInfo }> {
  const info: DevServerInfo = { root: dir, host };
  const api = await listen((req, res) => {
    void handleDevRequest(req, res, env, info);
  });
  info.port = Number(new URL(api.url).port);
  return { api, info };
}

describe('hôte d’écoute de Vite', () => {
  it('par défaut localhost ; --host (true, « ») = toutes les interfaces', () => {
    expect(listenHost(undefined)).toBe('localhost');
    expect(listenHost(false)).toBe('localhost');
    expect(listenHost(true)).toBeNull();
    expect(listenHost('')).toBeNull();
    expect(listenHost('0.0.0.0')).toBe('0.0.0.0');
    expect(listenHost('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('npm run dev sans Clerk', () => {
  it('mode personnel : adresse d’accès affichée, jeton exigé, historique dans le dossier du projet', async () => {
    // Dossier du projet déjà présent : conservé aussi sur Windows, sans écrire dans le vrai profil du testeur.
    const dataDir = path.join(dir, DEFAULT_DATA_DIR_NAME);
    mkdirSync(dataDir);
    const env = { AI_AUTODETECT: 'false' };
    const { api, info } = await startDev(env, 'localhost');
    server = api;
    expect(await (await fetch(`${api.url}/api/mode`)).json() as ModeInfo).toEqual({ auth: 'personal' });
    const token = readFileSync(path.join(dataDir, ACCESS_TOKEN_FILE), 'utf8').trim();
    const lines = (await devStartupLines(env, info)).join('\n');
    expect(lines).toContain('Mode personnel');
    expect(lines).toContain(`http://localhost:${info.port}/#acces=${token}`);
    // Aucune IA configurée ni détectée : cause précise au démarrage.
    expect(lines).toContain('IA non branchée');

    expect((await call(api.url, '/api/status')).status).toBe(401);
    expect((await call(api.url, '/api/status', 'mauvais-jeton')).status).toBe(401);
    const status = await call(api.url, '/api/status', token);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ ai: { ok: false, code: 'AI_NOT_CONFIGURED' } });
    const history = await call(api.url, '/api/history', token);
    expect(await history.json()).toEqual({ items: [] });
  });

  it('Vite ouvert au réseau (--host) : jamais de mode personnel automatique, l’interface reste en démonstration', async () => {
    const env = { MAGISTRA_DATA_DIR: dir, AI_AUTODETECT: 'false' };
    const { api } = await startDev(env, null);
    server = api;
    expect(await (await fetch(`${api.url}/api/mode`)).json()).toEqual({ auth: 'none' });
    expect((await call(api.url, '/api/status', 'n-importe-quoi')).status).toBe(500);
  });

  it('MAGISTRA_AUTH=personal avec Vite ouvert au réseau : refus explicite, aucune route utilisable', async () => {
    const env = { MAGISTRA_AUTH: 'personal', MAGISTRA_DATA_DIR: dir, AI_AUTODETECT: 'false' };
    const { api, info } = await startDev(env, '0.0.0.0');
    server = api;
    expect((await devStartupLines(env, info))[0]).toContain('DÉMARRAGE REFUSÉ');
    const res = await call(api.url, '/api/status', 'n-importe-quoi');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({
      code: 'SERVER_MISCONFIGURED', message: expect.stringContaining('HOST=127.0.0.1'),
    });
  });
});

// ─── Le serveur de développement ne sert JAMAIS le dossier de données (jeton d'accès, historique, profil) ───

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'JETON-SECRET-0123456789abcdefghijklmnopqrstuvwxyz';

/** Préfixe Vite /@fs/ valide aussi pour un chemin Windows C:/… (jamais /@fsC:/…). */
function viteFilePath(file: string): string {
  return `/@fs/${file.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

/** Vrai serveur Vite (racine temporaire, port libre). */
async function startVite(config: InlineConfig): Promise<{ vite: ViteDevServer; url: string }> {
  const vite = await createServer({
    root: dir,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1', strictPort: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ...config,
  });
  await vite.listen();
  const port = (vite.httpServer!.address() as AddressInfo).port;
  return { vite, url: `http://127.0.0.1:${port}` };
}

/** Fichiers secrets (dans `dataDir`) et fichiers ordinaires de la racine. */
function seed(dataDir: string): void {
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Magistra</title>');
  writeFileSync(path.join(dir, 'note.txt'), 'contenu public');
  writeFileSync(path.join(dir, '.env.local'), `AI_API_KEY=${SECRET}`);
  mkdirSync(path.join(dataDir, 'users', 'abc'), { recursive: true });
  writeFileSync(path.join(dataDir, ACCESS_TOKEN_FILE), `${SECRET}\n`);
  writeFileSync(path.join(dataDir, 'users', 'abc', 'profile.json'), JSON.stringify({ etablissement: SECRET }));
}

/** GET brut (adresse transmise telle quelle, sans normalisation ; une connexion par requête). */
function rawGet(url: string, p: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: p, method: 'GET', agent: false, headers: { Origin: 'http://localhost:8080' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Chaque adresse est refusée (403 ou 404) et ne renvoie jamais le secret, même avec l'origine d'une autre page locale. */
async function expectRefused(url: string, paths: readonly string[]): Promise<void> {
  for (const p of paths) {
    const res = await rawGet(url, p);
    expect([403, 404], p).toContain(res.status);
    expect(res.body, p).not.toContain(SECRET);
  }
}

describe('npm run dev : dossier de données jamais servi par Vite', () => {
  let vite: ViteDevServer | undefined;
  afterEach(async () => {
    await vite?.close();
    vite = undefined;
  });

  it('même nom de dossier que le serveur (DEFAULT_DATA_DIR_NAME)', () => {
    expect(DATA_DIR_NAME).toBe(DEFAULT_DATA_DIR_NAME);
  });

  it('adresses encodées, en majuscules ou avec barres obliques inverses : reconnues', () => {
    for (const u of ['/.magistra-data/access-token', '/%2emagistra-data/x', '/%252Emagistra-data/x', '/.MAGISTRA-DATA/x',
      '/@fs/home/p/.magistra-data/access-token?raw', '/src/..\\.magistra-data\\x', '//.magistra-data/x']) {
      expect(targetsDataDir(u), u).toBe(true);
    }
    for (const u of ['/', '/src/main.tsx', '/api/status', '/magistra-data/x', '/.magistra-database/x', undefined]) {
      expect(targetsDataDir(u), String(u)).toBe(false);
    }
  });

  it('configuration réelle du projet (vite.config.ts) : jeton et profil refusés, application servie', async () => {
    seed(path.join(dir, '.magistra-data'));
    const started = await startVite({ configFile: path.join(PROJECT_ROOT, 'vite.config.ts') });
    vite = started.vite;
    const url = started.url;
    expect((await rawGet(url, '/note.txt')).status).toBe(200);
    const publicFile = await rawGet(url, `${viteFilePath(path.join(dir, 'note.txt'))}?raw`);
    expect(publicFile.status).toBe(200);
    expect(publicFile.body).toContain('contenu public');
    await expectRefused(url, [
      '/.magistra-data/access-token',
      '/.magistra-data/access-token?raw',
      '/.magistra-data/access-token?import',
      '/.magistra-data/access-token?url',
      '/.magistra-data/access-token?inline',
      '/%2emagistra-data/access-token',
      '/.MAGISTRA-DATA/access-token',
      '/src/../.magistra-data/access-token',
      '//.magistra-data/access-token',
      `${viteFilePath(path.join(dir, '.magistra-data', ACCESS_TOKEN_FILE))}?raw`,
      '/.magistra-data/users/abc/profile.json',
      '/.magistra-data/users/abc/profile.json?raw',
      // Protections par défaut de Vite conservées.
      '/.env.local',
      '/.env.local?raw',
    ]);
  });

  it('MAGISTRA_DATA_DIR placé dans la racine sous un autre nom : refusé aussi', async () => {
    const dataDir = path.join(dir, 'donnees');
    seed(dataDir);
    const started = await startVite({ configFile: false, plugins: [magistraDevApi({ MAGISTRA_DATA_DIR: dataDir, AI_AUTODETECT: 'false' })] });
    vite = started.vite;
    expect((await rawGet(started.url, '/note.txt')).status).toBe(200);
    const publicFile = await rawGet(started.url, `${viteFilePath(path.join(dir, 'note.txt'))}?raw`);
    expect(publicFile.status).toBe(200);
    expect(publicFile.body).toContain('contenu public');
    await expectRefused(started.url, [
      '/donnees/access-token',
      '/donnees/access-token?raw',
      '/donnees/users/abc/profile.json',
      `${viteFilePath(path.join(dataDir, ACCESS_TOKEN_FILE))}?raw`,
      `${viteFilePath(path.join(dataDir, ACCESS_TOKEN_FILE))}?import`,
      `${viteFilePath(path.join(dataDir, ACCESS_TOKEN_FILE))}?url`,
      '/.env.local',
    ]);
  });
});
