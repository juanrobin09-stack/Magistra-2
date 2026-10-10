// Fenêtre de production → preload → IPC → vrai HTTP Chromium → contrôle SHA-256
// → shell.openPath Windows → fermeture. Profil neuf, version suivante fictive,
// programme Windows inoffensif : aucune installation ni publication de test.
import { _electron as electron, expect, test as baseTest, type ElectronApplication, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASES_API_URL } from '../electron/updateCheck';
import { UPDATE_CHECKSUMS_FILE, LEGACY_UPDATE_CHECKSUMS_FILE } from '../shared/updateAssets';
import type { UpdateProgress } from '../shared/ipc';
import type { UpdateFlowProbe } from './electron-update-flow-harness';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const test = baseTest.extend<{ releaseState: 'next' | 'current' }>({ releaseState: ['next', { option: true }] });
test.skip(process.platform !== 'win32', 'Le lancement natif Windows est vérifié dans le job windows-package.');
let temporary: string;
let application: ElectronApplication | undefined;
let page: Page;
let server: Server | undefined;
let ollama: { url: string; close(): Promise<void> } | undefined;
let currentVersion: string;
let nextVersion: string;
let installerName: string;
let bytes: Buffer;
let sha256: string;
let installerRequests: number;
let mode: 'valid' | 'truncated' | 'corrupt' | 'current';
let pageErrors: string[];

const releases = 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases';
const cdn = 'https://release-assets.githubusercontent.com/magistra-update-fixture';
const downloads = () => path.join(temporary, 'downloads');
const proofFile = () => path.join(temporary, 'proof.json');

async function probe(): Promise<UpdateFlowProbe> {
  return JSON.parse(await readFile(proofFile(), 'utf8')) as UpdateFlowProbe;
}
async function configure(values: Partial<Pick<UpdateFlowProbe, 'confirmation' | 'launchError'>>) {
  await application!.evaluate((_, value) => {
    Object.assign((globalThis as unknown as { __updateFlow: UpdateFlowProbe }).__updateFlow, value);
  }, values);
}

async function enterDashboard() {
  await expect(page.getByTestId('app-intro')).toBeVisible();
  await page.getByTestId('app-intro').click();
  await page.getByRole('link', { name: /Commencer/ }).first().click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.locator('#onb-nom').fill('Test mise à jour');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Supérieur/ }).click();
  await page.getByRole('button', { name: /^Master 1$/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Commencer à générer/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(() => {
    const target = window as unknown as { magistra: { app: { onUpdateProgress(fn: (p: UpdateProgress) => void): unknown } }; __updateEvents: UpdateProgress[] };
    target.__updateEvents = [];
    target.magistra.app.onUpdateProgress(event => target.__updateEvents.push(event));
  });
}

test.beforeEach(async ({ releaseState }) => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'magistra-update-flow-'));
  await mkdir(downloads());
  const profile = path.join(temporary, 'profile');
  await mkdir(profile);
  await writeFile(path.join(profile, 'document-preserve.txt'), 'Document à conserver');
  currentVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  nextVersion = `${major}.${minor}.${patch + 1}`;
  installerName = `Magistra-Setup-${nextVersion}.exe`;
  bytes = await readFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'));
  sha256 = createHash('sha256').update(bytes).digest('hex');
  installerRequests = 0;
  mode = releaseState === 'current' ? 'current' : 'valid';
  pageErrors = [];
  const sums = `${sha256}  ${installerName}\n`;
  server = createServer((request, response) => {
    if (request.url === '/latest') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        tag_name: `v${mode === 'current' ? currentVersion : nextVersion}`, draft: false, prerelease: false,
        html_url: `${releases}/tag/v${mode === 'current' ? currentVersion : nextVersion}`,
        assets: [
          { name: installerName, size: bytes.length, state: 'uploaded', browser_download_url: `${releases}/download/v${nextVersion}/${installerName}` },
          { name: UPDATE_CHECKSUMS_FILE, size: Buffer.byteLength(sums), state: 'uploaded', browser_download_url: `${releases}/download/v${nextVersion}/${UPDATE_CHECKSUMS_FILE}` },
        ],
      }));
    } else if (request.url === '/redirect-sums' || request.url === '/redirect-installer') {
      response.writeHead(302, { Location: `${cdn}/${request.url.endsWith('sums') ? 'sums' : 'installer'}` });
      response.end();
    } else if (request.url === '/sums') {
      response.end(sums);
    } else if (request.url === '/installer') {
      installerRequests++;
      response.writeHead(200, { 'Content-Length': bytes.length });
      const payload = mode === 'corrupt' ? Buffer.alloc(bytes.length, 42) : bytes;
      response.write(payload.subarray(0, 1024));
      // La progression et le bouton désactivé sont observables dans la fenêtre.
      setTimeout(() => mode === 'truncated' ? response.destroy() : response.end(payload.subarray(1024)), 500);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = path.join(temporary, 'config.json');
  await writeFile(config, JSON.stringify({ profile, downloads: downloads(), proof: proofFile(), routes: {
    [RELEASES_API_URL]: `${base}/latest`,
    [`${releases}/download/v${nextVersion}/${UPDATE_CHECKSUMS_FILE}`]: `${base}/redirect-sums`,
    [`${releases}/download/v${nextVersion}/${installerName}`]: `${base}/redirect-installer`,
    [`${cdn}/sums`]: `${base}/sums`, [`${cdn}/installer`]: `${base}/installer`,
  } }));
  const harness = path.join(temporary, 'main-preload.cjs');
  await build({ entryPoints: [path.join(root, 'e2e/electron-update-flow-harness.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: harness });
  const mock = await import(pathToFileURL(path.join(root, 'scripts/mock-ollama.mjs')).href) as {
    startMockOllama(options: { port: number; models: string[] }): Promise<{ url: string; close(): Promise<void> }>;
  };
  ollama = await mock.startMockOllama({ port: 0, models: [] });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  for (const key of Object.keys(env)) {
    if (/^MAGISTRA_|^VITE_DEV_SERVER_URL$|^ELECTRON_RUN_AS_NODE$/.test(key)) delete env[key];
    else if (key.toUpperCase() === 'PATH') env[key] = env[key].split(path.delimiter).filter(p => !/[\\/]Ollama([\\/]|$)/i.test(p)).join(path.delimiter);
  }
  Object.assign(env, {
    MAGISTRA_UPDATE_FLOW_CONFIG: config, MAGISTRA_USER_DATA_DIR: profile,
    MAGISTRA_OLLAMA_URL: ollama.url, MAGISTRA_CONNECTOR_DISABLED: '1',
    LOCALAPPDATA: path.join(temporary, 'local-app-data'),
    ProgramFiles: path.join(temporary, 'program-files'), ProgramW6432: path.join(temporary, 'program-files'),
    'ProgramFiles(x86)': path.join(temporary, 'program-files-x86'),
  });
  application = await electron.launch({ args: ['-r', harness, root], cwd: root, env, timeout: 60_000 });
  page = await application.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await enterDashboard();
});

test.afterEach(async () => {
  const testInfo = test.info();
  // Conserver la preuve avant la suppression du seul dossier créé par mkdtemp.
  try {
    const saved = testInfo.outputPath('updater-main-proof.json');
    await writeFile(saved, await readFile(proofFile()));
    await testInfo.attach('updater-main-proof', { path: saved, contentType: 'application/json' });
  } catch { /* démarrage échoué */ }
  await application?.close().catch(() => undefined);
  application = undefined;
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  await ollama?.close();
  ollama = undefined;
  if (temporary) {
    const target = path.resolve(temporary);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('magistra-update-flow-')) throw new Error('Dossier de nettoyage hors du test');
    // Windows peut garder l'exécutable ou son dossier verrouillé brièvement après
    // ShellExecute (processus lancé et antivirus) : attendre sa libération.
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

function notice() { return page.getByRole('region', { name: 'Mises à jour de Magistra' }).first(); }
function installButton() { return notice().getByRole('button', { name: 'Télécharger et installer', exact: true }); }
async function screenshot(name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

test('annuler ne télécharge rien ; réessayer lance le fichier vérifié et ferme uniquement le test', async () => {
  await expect(notice()).toContainText(`Magistra ${nextVersion} est disponible. Version installée : ${currentVersion}.`);
  await screenshot('mise-a-jour-disponible');
  expect(installerRequests).toBe(0);
  await configure({ confirmation: 0 });
  await installButton().click();
  await expect.poll(async () => (await probe()).dialogs.length).toBe(1);
  await expect(installButton()).toBeEnabled();
  expect(installerRequests).toBe(0);
  expect((await probe()).launches).toEqual([]);
  expect((await probe()).requests.every(url => url === RELEASES_API_URL)).toBe(true);
  await configure({ confirmation: 1 });
  const child = application!.process();
  const closed = application!.waitForEvent('close');
  await installButton().click();
  await expect(notice().getByRole('button', { name: /Téléchargement/ })).toBeDisabled();
  const progress = await page.evaluate(() => (window as unknown as { __updateEvents: UpdateProgress[] }).__updateEvents);
  expect(progress.some(event => event.phase === 'downloading')).toBe(true);
  await closed;
  const proof = await probe();
  expect(proof.dialogs).toHaveLength(2);
  expect(proof.dialogs[1]).toMatchObject({ title: 'Mettre à jour Magistra', buttons: ['Annuler', 'Télécharger et installer'] });
  expect(proof.dialogs[1].detail).toContain('Enregistrez votre travail');
  expect(proof.requests.some(url => url.endsWith(UPDATE_CHECKSUMS_FILE))).toBe(true);
  expect(proof.requests.some(url => url.endsWith(LEGACY_UPDATE_CHECKSUMS_FILE))).toBe(false);
  expect(proof.requests).toContain(`${cdn}/installer`);
  expect(proof.launches).toHaveLength(1);
  expect(proof.launches[0]).toMatchObject({ sha256, result: '' });
  expect(proof.progress.filter((event, index, list) => event.phase !== list[index - 1]?.phase).map(event => event.phase))
    .toEqual(['downloading', 'verifying', 'installing']);
  expect(proof.progress).toContainEqual({ phase: 'downloading', percent: 100 });
  expect(installerRequests).toBe(1);
  await expect.poll(() => child.exitCode).toBe(0);
  expect(await readFile(path.join(temporary, 'profile/document-preserve.txt'), 'utf8')).toBe('Document à conserver');
  expect(pageErrors).toEqual([]);
});

test('réseau interrompu : erreur lisible, fichier supprimé et nouvelle tentative fonctionnelle', async () => {
  mode = 'truncated';
  await installButton().click();
  await expect(notice()).toContainText('Le téléchargement de la mise à jour a été interrompu.');
  await screenshot('interruption-et-reprise');
  await expect(installButton()).toBeEnabled();
  await expect(notice().getByRole('button', { name: 'Télécharger depuis le site Magistra' })).toBeVisible();
  expect((await probe()).launches).toEqual([]);
  await expect.poll(() => readdir(downloads())).toEqual([]);
  mode = 'valid';
  const closed = application!.waitForEvent('close');
  await installButton().click();
  await closed;
  expect((await probe()).launches).toEqual([expect.objectContaining({ sha256, result: '' })]);
  expect(installerRequests).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('fichier corrompu de même taille : installation refusée, nettoyage et application utilisable', async () => {
  mode = 'corrupt';
  await installButton().click();
  await expect(notice()).toContainText('Fichier incomplet ou empreinte incorrecte : installation annulée.');
  expect((await probe()).launches).toEqual([]);
  await expect.poll(() => readdir(downloads())).toEqual([]);
  await expect(installButton()).toBeEnabled();
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Historique', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/history$/);
  expect(application!.process().exitCode).toBeNull();
  expect(pageErrors).toEqual([]);
});

test('refus de lancement Windows : aucune fausse réussite ; réessayer reste possible', async () => {
  await configure({ launchError: true });
  await installButton().click();
  await expect(notice()).toContainText('Windows n’a pas pu ouvrir l’installateur.');
  await expect(installButton()).toBeEnabled();
  await expect(notice().getByRole('button', { name: 'Installateur lancé…' })).toHaveCount(0);
  await expect.poll(() => readdir(downloads())).toEqual([]);
  expect(application!.process().exitCode).toBeNull();
  await configure({ launchError: false });
  const closed = application!.waitForEvent('close');
  await installButton().click();
  await closed;
  expect((await probe()).launches).toEqual([
    expect.objectContaining({ sha256, result: 'Échec Windows simulé' }),
    expect.objectContaining({ sha256, result: '' }),
  ]);
  expect(pageErrors).toEqual([]);
});

test.describe('version déjà actuelle', () => {
  test.use({ releaseState: 'current' });
  test('la recherche manuelle confirme la version sans proposer ni télécharger un installateur', async () => {
    await expect(notice()).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Réglages', exact: true }).click();
    await notice().getByRole('button', { name: 'Rechercher une mise à jour' }).click();
    await expect(notice()).toContainText(`Magistra est à jour (version ${currentVersion}).`);
    await expect(installButton()).toHaveCount(0);
    expect(installerRequests).toBe(0);
    const proof = await probe();
    expect(proof.dialogs).toEqual([]);
    expect(proof.launches).toEqual([]);
    expect(proof.requests.every(url => url === RELEASES_API_URL)).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});
