// Vrai réseau Chromium : les mocks fetch de Node ne reproduisent pas les redirections Electron.
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = Buffer.alloc(1024 * 1024, 173);
let temporary: string;
let application: ElectronApplication;
let server: Server;
let base: string;
let assetRequests = 0;

interface ProbeResult { status?: number; location?: string | null; body?: boolean; bytes?: number; sha256?: string; error?: string; errorName?: string }
function probe(url: string, read = true, timeoutMs = 5000): Promise<ProbeResult> {
  return application.evaluate(async (_, args) => {
    const run = (globalThis as unknown as { __nativeUpdateProbe: (url: string, read: boolean, timeout: number) => Promise<ProbeResult> }).__nativeUpdateProbe;
    return run(args.url, args.read, args.timeoutMs);
  }, { url, read, timeoutMs });
}

test.beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'magistra-updater-e2e-'));
  const harness = path.join(temporary, 'updater.cjs');
  await build({ entryPoints: [path.join(root, 'e2e/electron-updater-harness.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: harness });
  server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/redirect-again' }); response.end(); }
    else if (request.url === '/redirect-again') { response.writeHead(307, { Location: '/asset' }); response.end(); }
    else if (request.url === '/asset') {
      assetRequests++;
      response.writeHead(200, { 'Content-Length': bytes.length });
      response.write(bytes.subarray(0, 256 * 1024));
      setTimeout(() => response.end(bytes.subarray(256 * 1024)), 25);
    } else if (request.url === '/truncated') {
      response.writeHead(200, { 'Content-Length': 100000 });
      response.write('partial');
      setTimeout(() => response.destroy(), 25);
    } else if (request.url === '/slow') { response.writeHead(200); response.write('partial'); }
    else if (request.url !== '/wait') { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  env.MAGISTRA_USER_DATA_DIR = path.join(temporary, 'profile');
  const args = [harness];
  if (process.platform === 'linux') args.push('--disable-gpu', '--no-sandbox');
  application = await electron.launch({ args, cwd: root, env, timeout: 60000 });
});

test.afterAll(async () => {
  await application?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  // Seul le dossier créé par mkdtemp est supprimé.
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('redirections natives retournées sans accès à la destination, puis téléchargement intact', async () => {
  const redirect = await probe(base + '/redirect', false);
  expect(redirect).toMatchObject({ status: 302, body: false });
  expect(assetRequests).toBe(0);
  const next = await probe(new URL(redirect.location!, base).href, false);
  expect(next.status).toBe(307);
  expect(assetRequests).toBe(0);
  const asset = await probe(new URL(next.location!, base).href);
  expect(asset).toMatchObject({ status: 200, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  expect(assetRequests).toBe(1);
});

test('une réponse interrompue ne devient jamais un téléchargement complet', async () => {
  const result = await probe(base + '/truncated');
  expect(result.error).toBeTruthy();
  expect(result.sha256).toBeUndefined();
});

test('le délai annule la requête avant les en-têtes et pendant le corps', async () => {
  for (const url of ['/wait', '/slow']) {
    const result = await probe(base + url, true, 100);
    expect(result.errorName).toBe('TimeoutError');
    expect(result.sha256).toBeUndefined();
  }
});
